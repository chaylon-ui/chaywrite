/* ---------------- /binder/search — cached BinderPOS product search ----------------
   The storefront's advanced-search widget (assets/advancedSearch.js) POSTs
   every query to portal.binderpos.com/external/shopify/products/forStore
   (limit 18). Measured from a GitHub runner (run 33644704151, 2026-09-02):
   the page-default query — in stock, price descending, page 1 — takes
   25.9s cold / ~3.2s warm for Pokémon and a 60s timeout then 34s / 18s
   for MTG, while everything else the page does is 0.1-0.4s. The theme
   cannot make BinderPOS's query faster; it can avoid asking cold, and
   avoid asking at all for the default landing. So:

   - Same URL contract as forStore: POST the widget's JSON body verbatim,
     get BinderPOS's JSON back verbatim (+ CORS, + x-xg-cache header).
   - The body is canonicalised (keys sorted, null / '' / [] dropped — the
     same rule sections/binder-prefetch.liquid uses) and sha256'd into the
     cache key, so cosmetic differences between the widget, the theme's
     prefetch and the cron all land on one entry.
   - Entries live in ONE Durable Object (env.ROOM, name CACHE_DO) so every
     colo shares them: caches.default is per-datacentre, and a cron warming
     Toronto would never help a shopper routed through Montreal. Bodies
     are stored gzip'd (raw answers run 84-134KB; DO values cap at 128KB).
   - Freshness: < FRESH_MS served as-is (hit; "warm" when the cron wrote
     it); FRESH_MS..STALE_MS served immediately as "stale" while one
     background refresh runs (stale-while-revalidate, so no shopper waits
     on a cold BinderPOS call for a known body); older/absent is fetched
     synchronously ("miss"), stored, returned.
   - A 60s caches.default layer in front absorbs bursts within a colo.
   - The pre-warm re-fetches the page-default body for every supported
     game plus page 2 for pokemon and mtg every 5 min, through the same
     upstream call, key and store. It runs from TWO clocks that share one
     lock: the worker cron (wrangler.toml [triggers], scheduled() in
     index.js) and the cache DO's own alarm (room.js) - the deploy logs of
     2026-09-02 showed the registered cron never invoked the handler, and
     a DO alarm is delivered by the runtime itself.
   - Any cache trouble falls through to a direct BinderPOS call: the cache
     must never be the reason a shopper gets nothing. Errors are never
     cached. */

export const CACHE_DO = "binder-search-cache";
export const STORE = "most-wanted-ca.myshopify.com";

const UPSTREAM = "https://portal.binderpos.com/external/shopify/products/forStore";
const GAMES_URL = "https://api.binderpos.com/external/shopify/supportedGames?storeUrl=" + STORE;
const DO_ORIGIN = "https://" + CACHE_DO + ".internal"; // the DO only reads the path
const KEY_V = "v1";               // bump to roll every cache key
const PAGE = 18;                  // the widget's page size
const FRESH_MS = 5 * 60e3;        // served as hit/warm
const STALE_MS = 20 * 60e3;       // served as stale + background refresh
const LOCK_MS = 60e3;             // one background refresh per key per minute
const WARM_SKIP_MS = 60e3;        // cron leaves an entry this young alone
const EDGE_S = 60;                // caches.default burst layer
const UPSTREAM_TIMEOUT_MS = 55000;
const GAMES_TIMEOUT_MS = 15000;
const MAX_LIMIT = 50;
const MAX_BODY = 16 * 1024;
const MAX_GZ = 120 * 1024;        // DO storage values cap at 128 KiB
const MAX_GAMES = 12;
const WARM_LOCK_MS = 12 * 60e3;   // one warm run at a time, globally
export const WARM_EVERY_MS = 5 * 60e3; // the DO alarm's cadence (mirrors the cron)

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  "access-control-expose-headers": "x-xg-cache, x-xg-age",
};

const msg = (e) => String((e && e.message) || e || "error").slice(0, 200);

/* ---- body -> key ---------------------------------------------------- */

// Keys sorted recursively; null / undefined / '' / [] dropped. Array order
// is kept (sortTypes order is meaningful).
export function canon(o) {
  if (Array.isArray(o)) return o.map(canon);
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o).sort()) {
      const v = o[k];
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = canon(v);
    }
    return out;
  }
  return o;
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function keyOf(body) {
  return sha256Hex(KEY_V + ":" + JSON.stringify(canon(body)));
}

// The widget's page-default body for a game (what binder-prefetch.liquid
// predicts for /pages/advanced-search?game=<g>&availabilty=true&order=price-descending).
export function defaultBody(game, offset = 0) {
  return {
    storeUrl: STORE, game, strict: null,
    sortTypes: [{ type: "price", asc: false, order: 1 }],
    variants: null, title: "", priceGreaterThan: 0, priceLessThan: null,
    instockOnly: true, limit: PAGE, offset, setNames: [], rarities: [], types: [],
  };
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be a JSON object";
  if (body.storeUrl !== STORE) return "storeUrl must be " + STORE;
  const lim = body.limit;
  if (typeof lim !== "number" || !Number.isFinite(lim) || lim < 1 || lim > MAX_LIMIT) return "limit must be a number 1-" + MAX_LIMIT;
  const off = body.offset;
  if (off !== undefined && off !== null && (typeof off !== "number" || !Number.isFinite(off) || off < 0)) return "offset must be a number >= 0";
  return "";
}

/* ---- gzip helpers ----------------------------------------------------- */

export async function gzipText(text) {
  const s = new Response(text).body.pipeThrough(new CompressionStream("gzip"));
  return new Response(s).arrayBuffer();
}
const gzip = gzipText;

async function gunzip(buf) {
  const s = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).text();
}

/* ---- the global store (BinderRoom DO, /_cache/* paths in room.js) ------ */

const cacheStub = (env) => env.ROOM.get(env.ROOM.idFromName(CACHE_DO));
const doCall = (env, path, init) => cacheStub(env).fetch(new Request(DO_ORIGIN + path, init));

// null when absent or past STALE_MS; else { text?, age, state, warm, refresh }.
// `refresh` is true when the DO granted THIS caller the background-refresh
// lock (it stays false for other callers for LOCK_MS).
async function doGet(env, key, metaOnly) {
  const q = "?k=" + key + "&fresh=" + FRESH_MS + "&stale=" + STALE_MS + "&lock=" + LOCK_MS + (metaOnly ? "&meta=1" : "");
  const r = await cacheStub(env).fetch(new Request(DO_ORIGIN + "/_cache/get" + q));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("cache get HTTP " + r.status);
  const rec = {
    age: parseInt(r.headers.get("x-age"), 10) || 0,
    state: r.headers.get("x-state") === "stale" ? "stale" : "fresh",
    warm: r.headers.get("x-warm") === "1",
    refresh: r.headers.get("x-refresh") === "1",
  };
  if (!metaOnly) rec.text = await gunzip(await r.arrayBuffer());
  return rec;
}

async function doPut(env, key, text, warm) {
  const gz = await gzip(text);
  if (gz.byteLength > MAX_GZ) throw new Error("gz too large: " + gz.byteLength);
  const r = await cacheStub(env).fetch(new Request(DO_ORIGIN + "/_cache/put?k=" + key + "&w=" + (warm ? 1 : 0), { method: "POST", body: gz }));
  if (!r.ok) throw new Error("cache put HTTP " + r.status);
  return true;
}

/* ---- upstream ---------------------------------------------------------- */

// Identical misses arriving together in one isolate share one BinderPOS
// call (a 25s cold query must not be multiplied by a tab-happy shopper).
const inflight = new Map();
function upstream(key, raw) {
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: raw,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      return { status: r.status, text: await r.text() };
    })();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
  }
  return p;
}

// One BinderPOS round trip, checked: { ok: true, text, status } or
// { ok: false, upstream, error }. Never throws.
async function ask(key, raw) {
  let up;
  try { up = await upstream(key, raw); }
  catch (e) { return { ok: false, upstream: 0, error: /abort|timeout/i.test(msg(e)) ? "upstream timeout" : msg(e) }; }
  if (up.status < 200 || up.status >= 300) return { ok: false, upstream: up.status };
  try { JSON.parse(up.text); }
  catch { return { ok: false, upstream: up.status, error: "upstream body is not JSON" }; }
  return { ok: true, text: up.text, status: up.status };
}

// Shopper path: fetch BinderPOS and store the answer best-effort (the
// shopper has their answer either way). -> { ok: true, text, upstream } or
// { ok: false, upstream, error }. With `ctx` the store runs in waitUntil;
// without it (background refresh) it is awaited. Errors never store.
async function fetchAndStore(env, ctx, key, raw) {
  const a = await ask(key, raw);
  if (!a.ok) return a;
  const put = doPut(env, key, a.text, false).catch((e) => console.log("binder-search: store failed: " + msg(e)));
  if (ctx) ctx.waitUntil(put); else await put;
  return { ok: true, text: a.text, upstream: a.status };
}

/* ---- responses ----------------------------------------------------------- */

function reply(body, status, tag, extra) {
  const h = new Headers(CORS);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  if (tag) h.set("x-xg-cache", tag);
  for (const k in extra || {}) h.set(k, extra[k]);
  return new Response(body, { status, headers: h });
}

const jsonErr = (status, obj, extra) => reply(JSON.stringify(obj), status, "", extra);

const upstreamErr = (r) => (r.upstream
  ? jsonErr(502, { ok: false, upstream: r.upstream })
  : jsonErr(504, { ok: false, upstream: 0, error: r.error || "upstream unreachable" }));

function edgePut(cache, edgeKey, text, tag) {
  return cache.put(edgeKey, new Response(text, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=" + EDGE_S, "x-xg-cache": tag },
  })).catch(() => {});
}

/* ---- POST /binder/search ------------------------------------------------- */

export async function serveBinderSearch(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return jsonErr(405, { ok: false, error: "POST only" }, { allow: "POST, OPTIONS" });

  let raw = "";
  try { raw = await request.text(); } catch { raw = ""; }
  if (raw.length > MAX_BODY) return jsonErr(413, { ok: false, error: "body too large" });
  let body;
  try { body = JSON.parse(raw); } catch { return jsonErr(400, { ok: false, error: "body must be JSON" }); }
  const bad = validate(body);
  if (bad) return jsonErr(400, { ok: false, error: bad });

  const key = await keyOf(body);
  const cache = caches.default;
  const edgeKey = new Request(new URL("/binder/search/" + KEY_V + "/" + key, request.url).toString());

  // 1) burst layer (this colo, 60s)
  try {
    const hit = await cache.match(edgeKey);
    if (hit) return reply(hit.body, 200, "hit");
  } catch (e) { console.log("binder-search: edge match failed: " + msg(e)); }

  // 2) the global DO store
  let rec = null;
  try { rec = await doGet(env, key, false); }
  catch (e) { console.log("binder-search: cache get failed: " + msg(e)); }
  if (rec) {
    const ageH = { "x-xg-age": String(Math.round(rec.age / 1000)) }; // seconds since BinderPOS answered
    if (rec.state === "fresh") {
      const tag = rec.warm ? "warm" : "hit";
      ctx.waitUntil(edgePut(cache, edgeKey, rec.text, tag));
      return reply(rec.text, 200, tag, ageH);
    }
    if (rec.refresh) {
      ctx.waitUntil(fetchAndStore(env, null, key, raw).then((r) => {
        if (!r.ok) console.log("binder-search: background refresh failed: " + JSON.stringify(r));
      }).catch((e) => console.log("binder-search: background refresh threw: " + msg(e))));
    }
    return reply(rec.text, 200, "stale", ageH);
  }

  // 3) miss: BinderPOS synchronously (the store is best-effort; a broken
  //    cache still leaves the shopper with a direct answer)
  const r = await fetchAndStore(env, ctx, key, raw);
  if (!r.ok) return upstreamErr(r);
  ctx.waitUntil(edgePut(cache, edgeKey, r.text, "miss"));
  return reply(r.text, 200, "miss");
}

/* ---- cron pre-warm ----------------------------------------------------------- */

// supportedGames -> the identifiers the widget passes as ?game= (e.g.
// "pokemon", "mtg"). Seen in the deploy smoke (run 33648060842):
//   [{"gameId":"fleshAndBlood","gameName":"Flesh and Blood Singles","printings":[...]}, ...]
// so gameId is the identifier and gameName a display name. Strings and
// the other plausible keys stay accepted; display names (spaces,
// punctuation) never pass ID_RE.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;
const ID_KEYS = ["gameId", "game", "gameCode", "code", "key", "slug", "value", "id", "gameName", "name", "title", "label"];
export function gameIds(data) {
  let list = data;
  if (list && !Array.isArray(list) && typeof list === "object") {
    list = list.games || list.data || list.items || list.results || Object.values(list).find(Array.isArray) || [];
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    let id = "";
    if (typeof it === "string") id = it.trim();
    else if (it && typeof it === "object") {
      for (const k of ID_KEYS) {
        const v = it[k];
        if (typeof v === "string" && ID_RE.test(v.trim())) { id = v.trim(); break; }
      }
    }
    if (id && ID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_GAMES) break;
  }
  return out;
}

/* The warm loop reaches the cache through a small adapter so the SAME loop
   runs from the worker cron (DO stubs, below) and from inside the cache
   DO's alarm (direct storage; BinderRoom.cacheStore in room.js):
     meta(key)            -> { age, warm } | null
     put(key, text, warm) -> stores (throws on failure)
     lock(ttlMs)          -> { ok, age }   unlock()   note(summaryObj)      */
function stubStore(env) {
  return {
    meta: (key) => doGet(env, key, true),
    put: (key, text, warm) => doPut(env, key, text, warm),
    lock: async (ttl) => {
      const r = await doCall(env, "/_cache/lock?ttl=" + ttl, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      return { ok: r.status !== 409, age: j.age || 0 };
    },
    unlock: () => doCall(env, "/_cache/unlock", { method: "POST" }),
    note: (obj) => doCall(env, "/_cache/note", { method: "POST", body: JSON.stringify(obj) }),
  };
}

async function warmOne(store, game, offset) {
  const body = defaultBody(game, offset);
  const key = await keyOf(body);
  try {
    const m = await store.meta(key);
    if (m && m.age < WARM_SKIP_MS) return { status: "skip", age: m.age };
  } catch (e) { console.log("binder-warm: cache probe failed: " + msg(e)); }
  const raw = JSON.stringify(body);
  let a = await ask(key, raw);
  let retried = false;
  if (!a.ok && a.error === "upstream timeout") {
    // BinderPOS keeps computing after we hang up and caches its answer per
    // body (measured: 60s timeout, then 34s, then 18s), so one immediate
    // retry usually lands. Seen live on mtg page 1 (run 33652039890).
    retried = true;
    a = await ask(key, raw);
  }
  if (!a.ok) return { status: "error", upstream: a.upstream, error: a.error, retried };
  try { await store.put(key, a.text, true); }
  catch (e) { return { status: "error", upstream: a.status, error: "store failed: " + msg(e), retried }; }
  return { status: "warm", upstream: a.status, bytes: a.text.length, retried };
}

// Worker cron entry point (scheduled() in index.js).
export const warmBinderSearch = (env) => warmWithStore(stubStore(env), "cron");

// Sequential on purpose: BinderPOS's cold queries run 25-60s and the clock
// has wall-time to spare; parallel calls would only pile onto their box.
// One run at a time, globally: a slow BinderPOS can push a run past the
// next 5-min slot, and overlapping runs (or the cron and the alarm
// together) would double the load. The run's summary is kept in the DO
// for GET /binder/search/status.
export async function warmWithStore(store, via) {
  const t0 = Date.now();
  try {
    const l = await store.lock(WARM_LOCK_MS);
    if (!l.ok) {
      console.log("binder-warm(" + via + "): previous run still going (" + Math.round((l.age || 0) / 1000) + "s), skipping this slot");
      return { skipped: true, lockAge: l.age || 0 };
    }
  } catch (e) { console.log("binder-warm(" + via + "): lock failed, running anyway: " + msg(e)); }
  const summary = { via, at: t0, games: [], jobs: [], total: 0, ms: 0 };
  // Written after every body, not just at the end: an invocation the
  // platform cuts short (CPU or wall-clock limit) still leaves its trace.
  const note = () => Promise.resolve().then(() => store.note({ ...summary, ms: Date.now() - t0 }))
    .catch((e) => console.log("binder-warm: note failed: " + msg(e)));
  try {
    await warmAll(store, summary, note);
  } catch (e) {
    summary.error = msg(e);
    console.log("binder-warm(" + via + "): run failed: " + summary.error);
  } finally {
    summary.done = Date.now();
    summary.ms = summary.done - t0;
    await note();
    try { await store.unlock(); } catch {}
  }
  return summary;
}

async function warmAll(store, summary, note) {
  const t0 = summary.at;
  let games = [];
  try {
    const r = await fetch(GAMES_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(GAMES_TIMEOUT_MS) });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    games = gameIds(data);
    console.log("binder-warm: supportedGames HTTP " + r.status + " " + txt.length + "B -> " + JSON.stringify(games)
      + (games.length ? "" : " (head: " + txt.slice(0, 240) + ")"));
  } catch (e) { console.log("binder-warm: supportedGames failed: " + msg(e)); }

  // The four landing bodies first - pokemon and mtg (the measured slow
  // ones), pages 1 and 2 - then page 1 of whatever else supportedGames
  // lists, so a run cut short still refreshed what shoppers land on.
  const jobs = [];
  for (const g of ["pokemon", "mtg"]) jobs.push({ game: g, offset: 0 });
  for (const g of ["pokemon", "mtg"]) jobs.push({ game: g, offset: PAGE });
  for (const g of games) if (g !== "pokemon" && g !== "mtg") jobs.push({ game: g, offset: 0 });
  summary.games = games;
  summary.total = jobs.length;
  await note();

  const out = [];
  for (const j of jobs) {
    const t = Date.now();
    let res;
    try { res = await warmOne(store, j.game, j.offset); } catch (e) { res = { status: "error", error: msg(e) }; }
    res.ms = Date.now() - t;
    out.push({ ...j, ...res });
    summary.jobs = out;
    await note();
    console.log("binder-warm(" + summary.via + "): " + j.game + " offset=" + j.offset + " -> " + res.status
      + (res.upstream ? " upstream=" + res.upstream : "") + (res.error ? " " + res.error : "")
      + (res.bytes ? " " + res.bytes + "B" : "") + " " + res.ms + "ms");
  }
  console.log("binder-warm: " + jobs.length + " bodies in " + (Date.now() - t0) + "ms");
  return out;
}

/* ---- GET /binder/search/status ------------------------------------------- */

// Read-only, public: the last cron run (per-game status + ms) and the age of
// the four landing entries, so a deploy smoke or a browser can tell whether
// the pre-warm is doing its job without wrangler tail. No secrets, no bodies.
export async function serveBinderSearchStatus(env) {
  const want = [["pokemon", 0], ["mtg", 0], ["pokemon", PAGE], ["mtg", PAGE]];
  const keys = await Promise.all(want.map(([g, o]) => keyOf(defaultBody(g, o))));
  let st;
  try { st = await (await doCall(env, "/_cache/status?ks=" + keys.join(","))).json(); }
  catch (e) { return jsonErr(503, { ok: false, error: "cache unavailable: " + msg(e) }); }
  const now = Date.now();
  const entries = {};
  want.forEach(([g, o], i) => {
    const e = st.entries && st.entries[keys[i]];
    entries[g + "/" + o] = e ? { ageS: Math.round(e.age / 1000), warm: e.warm, bytes: e.bytes, state: e.age < FRESH_MS ? "fresh" : e.age < STALE_MS ? "stale" : "expired" } : null;
  });
  const last = st.last && typeof st.last === "object" ? st.last : null;
  return reply(JSON.stringify({
    ok: true,
    now,
    cron: last ? { ...last, agoS: Math.round((now - (last.done || last.at)) / 1000) } : null,
    running: st.lockAge != null ? { forS: Math.round(st.lockAge / 1000) } : null,
    alarmInS: st.alarmIn != null ? Math.round(st.alarmIn / 1000) : null,
    entries,
    freshS: FRESH_MS / 1000,
    staleS: STALE_MS / 1000,
  }), 200, "");
}
