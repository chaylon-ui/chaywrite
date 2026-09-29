/* Reads this repo's own files (chaylon-ui/chaywrite) for the worker.

   The data files (data/*.json, data/autoprice/*) and the theme uploads (theme-stage/) were read
   anonymously from raw.githubusercontent.com, which only works while the repo is PUBLIC. The
   owner (2026-09-29, "make sure my git isn't public") chose to make it private, so:

   - with GITHUB_DATA_TOKEN set (a fine-grained token: this repo only, Contents read-only) a
     read goes to the contents API with that token, which works public or private;
   - without the token, or when the API refuses (token expired or revoked, or GitHub is down),
     the anonymous raw URL is tried, exactly as before, which works while the repo is public.

   Callers keep the raw.githubusercontent.com URL they always had: it names the file and is the
   cache key. `ttl` (seconds) keeps a copy in this isolate and in the colo cache, for the readers
   that run per shopper request (paints, eavy); a Durable Object run reads once and passes none.
   Never log the token or put it in a URL. */

export const REPO = "chaylon-ui/chaywrite";
export const RAW_PREFIX = "https://raw.githubusercontent.com/" + REPO + "/";
export const WORKER_REF = "claude/shopify-site-improvements-ztgdt8";
// the branches the worker reads from; the longest first, as one may prefix another
const REFS = [WORKER_REF, "main"];
const UA = "exor-binder/1.0 (+https://github.com/" + REPO + ")";
const MEMO_MAX_BYTES = 1500000;

/* raw.githubusercontent.com/<repo>/<ref>/<path> -> contents API URL, or null for anything else. */
export function apiUrlFor(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith(RAW_PREFIX)) return null;
  const rest = rawUrl.slice(RAW_PREFIX.length).split(/[?#]/)[0];
  for (const ref of REFS) {
    if (!rest.startsWith(ref + "/")) continue;
    let segs;
    try { segs = rest.slice(ref.length + 1).split("/").map((s) => decodeURIComponent(s)); } catch { return null; }
    if (!segs.length || segs.some((s) => !s || s === "." || s === "..")) return null;
    return "https://api.github.com/repos/" + REPO + "/contents/" + segs.map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(ref);
  }
  return null;
}

function tokenOf(env) {
  const t = env && env.GITHUB_DATA_TOKEN;
  return typeof t === "string" && t.trim() ? t.trim() : "";
}

function apiInit(init, token) {
  const h = new Headers((init && init.headers) || undefined);
  h.set("authorization", "Bearer " + token);
  h.set("accept", "application/vnd.github.raw+json");
  h.set("x-github-api-version", "2022-11-28");
  if (!h.has("user-agent")) h.set("user-agent", UA);
  const out = { method: "GET", headers: h };
  if (init && init.signal) out.signal = init.signal;
  return out;
}

// raw.githubusercontent.com sends every text file as text/plain; the callers read JSON with .json()
const typed = (buf, status, via, ctype) => new Response(buf, { status, headers: { "content-type": ctype || "application/octet-stream", "x-repo-data": via } });

const memo = new Map();
export function _resetRepoMemo() { memo.clear(); }

function cacheKey(rawUrl) {
  return new Request("https://repo-data.internal/" + rawUrl.slice(RAW_PREFIX.length));
}
function colo() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch { return null; }
}

/* fetch() for a file of this repo. Anything that is not a raw URL of this repo goes straight
   through, untouched. Returns a Response whose `x-repo-data` header says where the bytes came
   from: api, raw, memo or cache. */
export async function repoFetch(env, rawUrl, init, opts) {
  const o = opts || {};
  const fetchFn = o.fetchFn || ((u, i) => fetch(u, i));
  const api = apiUrlFor(rawUrl);
  if (!api) return fetchFn(rawUrl, init);
  const ttl = Math.max(0, Number(o.ttl) || 0);
  const now = o.now ? o.now() : Date.now();

  if (ttl) {
    const m = memo.get(rawUrl);
    if (m && m.exp > now) return typed(m.buf.slice(0), 200, "memo", m.ctype);
    const cache = colo();
    if (cache) {
      try {
        const hit = await cache.match(cacheKey(rawUrl));
        if (hit) {
          const buf = await hit.arrayBuffer();
          const ctype = hit.headers.get("content-type");
          if (buf.byteLength <= MEMO_MAX_BYTES) memo.set(rawUrl, { exp: now + ttl * 1000, buf, ctype });
          return typed(buf.slice(0), 200, "cache", ctype);
        }
      } catch { /* a cache fault is a miss */ }
    }
  }

  let res = null, via = "raw";
  const token = tokenOf(env);
  if (token) {
    try {
      const r = await fetchFn(api, apiInit(init, token));
      if (r.ok) { res = r; via = "api"; }
      else if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 429) res = r;
      else return r;
    } catch (e) {
      if (e && e.name === "TimeoutError") throw e;
    }
  }
  if (!res || !res.ok) {
    const apiRes = res;
    // anonymous, as before; `cf` and the caller's headers apply here only
    try {
      const r = await fetchFn(rawUrl, init);
      if (r.ok || !apiRes) res = r;
    } catch (e) {
      if (!apiRes) throw e;
    }
    if (!res.ok) return res;
  }

  if (!ttl) return via === "api" ? relabel(res, via) : res;
  const buf = await res.arrayBuffer();
  const ctype = res.headers.get("content-type") || "text/plain; charset=utf-8";
  if (buf.byteLength <= MEMO_MAX_BYTES) memo.set(rawUrl, { exp: now + ttl * 1000, buf, ctype });
  const cache = colo();
  if (cache) {
    const put = cache.put(cacheKey(rawUrl), new Response(buf.slice(0), { headers: { "content-type": ctype, "cache-control": "max-age=" + ttl } })).catch(() => {});
    if (o.ctx && o.ctx.waitUntil) o.ctx.waitUntil(put); else await put;
  }
  return typed(buf.slice(0), 200, via, ctype);
}

function relabel(res, via) {
  const h = new Headers(res.headers);
  h.set("x-repo-data", via);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ---------- theme uploads ----------
   Shopify's themeFilesUpsert takes a URL and fetches the file itself. The files are committed
   under theme-stage/ on the worker branch as <name>-<first 8 hex of their md5>.<ext>, and
   GET /theme-stage/<that name> serves them from here, so uploads keep working with the repo
   private. Only such names are served, and only when the bytes' md5 matches the name: nothing
   can be listed, and a stale or corrupted file is refused rather than uploaded. Everything goes
   out as text/plain (images as themselves) with nosniff and a sandbox CSP, as raw.github did,
   so nothing served here can run as a page on this origin. */
export const STAGE_RE = /^([A-Za-z0-9._-]{1,120})-([0-9a-f]{8})\.(liquid|js|css|json|svg|txt|png|jpe?g|gif|webp|woff2?)$/;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", woff: "font/woff", woff2: "font/woff2" };

async function md5Hex(buf) {
  const d = await crypto.subtle.digest("MD5", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const plain = (status, text) => new Response(text + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function serveThemeStage(request, env, url, opts) {
  const o = opts || {};
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "GET only");
  const name = url.pathname.slice("/theme-stage/".length);
  const m = STAGE_RE.exec(name);
  if (!m) return plain(404, "not found");
  let r;
  try {
    r = await repoFetch(env, RAW_PREFIX + WORKER_REF + "/theme-stage/" + name, { signal: AbortSignal.timeout(20000) }, { fetchFn: o.fetchFn });
  } catch { return plain(502, "could not read the file"); }
  if (r.status === 404) return plain(404, "not found");
  if (!r.ok) return plain(502, "could not read the file (HTTP " + r.status + ")");
  const buf = await r.arrayBuffer();
  const md5 = await (o.md5 || md5Hex)(buf);
  if (!md5.startsWith(m[2])) return plain(409, "the file's md5 " + md5 + " does not match its name");
  return new Response(request.method === "HEAD" ? null : buf, {
    status: 200,
    headers: {
      "content-type": IMAGE_TYPES[m[3]] || "text/plain; charset=utf-8",
      "content-length": String(buf.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-md5": md5,
      "x-repo-data": r.headers.get("x-repo-data") || "raw",
    },
  });
}

/* ---------- /repo-data/health ----------
   Whether the token is set, whether the API read with it works, and whether the anonymous
   raw read still works (true = the repo is still public). Statuses and sizes only. */
const HEALTH_FILE = RAW_PREFIX + "main/data/paintpicker-aos.json";

export async function repoDataHealth(env, opts) {
  const o = opts || {};
  const fetchFn = o.fetchFn || ((u, i) => fetch(u, i));
  const token = tokenOf(env);
  const out = { ok: false, token: !!token, file: HEALTH_FILE.slice(RAW_PREFIX.length), api: null, raw: null };
  if (token) {
    try {
      const r = await fetchFn(apiUrlFor(HEALTH_FILE), apiInit({ signal: AbortSignal.timeout(15000) }, token));
      const buf = r.ok ? await r.arrayBuffer() : null;
      out.api = { status: r.status, bytes: buf ? buf.byteLength : null, rateRemaining: r.headers.get("x-ratelimit-remaining") };
    } catch (e) { out.api = { error: String((e && e.name) || "fetch failed") }; }
  }
  try {
    const r = await fetchFn(HEALTH_FILE, { signal: AbortSignal.timeout(15000) });
    const buf = r.ok ? await r.arrayBuffer() : null;
    out.raw = { status: r.status, bytes: buf ? buf.byteLength : null };
  } catch (e) { out.raw = { error: String((e && e.name) || "fetch failed") }; }
  out.public = !!(out.raw && out.raw.status === 200);
  // reads keep working if the token works, or while the repo is public
  out.ok = !!((out.api && out.api.status === 200) || out.public);
  out.readsVia = out.api && out.api.status === 200 ? "api" : out.public ? "raw" : "none";
  return out;
}
