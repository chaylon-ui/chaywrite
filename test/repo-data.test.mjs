import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { apiUrlFor, repoFetch, serveThemeStage, repoDataHealth, _resetRepoMemo, RAW_PREFIX, WORKER_REF } from "../src/repo-data.js";

// The repo goes private (owner, 2026-09-29): every file the worker reads from it goes through
// the contents API with GITHUB_DATA_TOKEN, falling back to the anonymous raw URL.

const RAW = RAW_PREFIX + "main/data/paint-colours.json";
const API = "https://api.github.com/repos/chaylon-ui/chaywrite/contents/data/paint-colours.json?ref=main";
const TOKEN = "test-token-not-real";

function fakeFetch(routes) {
  const calls = [];
  const fn = async (u, init) => {
    calls.push({ u: String(u), init });
    const h = routes[String(u)];
    if (h === undefined) return new Response("nope", { status: 404 });
    if (h instanceof Error) throw h;
    return typeof h === "function" ? h(init) : new Response(h.body, { status: h.status || 200, headers: h.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

test("raw URLs of this repo map to the contents API; everything else is left alone", () => {
  assert.equal(apiUrlFor(RAW), API);
  assert.equal(apiUrlFor(RAW_PREFIX + "main/data/autoprice/tcg-3.json"), "https://api.github.com/repos/chaylon-ui/chaywrite/contents/data/autoprice/tcg-3.json?ref=main");
  assert.equal(apiUrlFor(RAW_PREFIX + WORKER_REF + "/theme-stage/a-1234abcd.js"),
    "https://api.github.com/repos/chaylon-ui/chaywrite/contents/theme-stage/a-1234abcd.js?ref=claude%2Fshopify-site-improvements-ztgdt8");
  assert.equal(apiUrlFor("https://raw.githubusercontent.com/other/repo/main/x.json"), null);
  assert.equal(apiUrlFor(RAW_PREFIX + "some-branch/x.json"), null, "unknown refs are not guessed");
  assert.equal(apiUrlFor(RAW_PREFIX + "main/data/../secrets.json"), null);
  assert.equal(apiUrlFor(RAW_PREFIX + "main/"), null);
});

test("no token: the anonymous raw read, exactly as before (same init, cf and all)", async () => {
  _resetRepoMemo();
  const f = fakeFetch({ [RAW]: { body: '{"a":1}' } });
  const init = { headers: { accept: "application/json" }, cf: { cacheTtl: 3600 } };
  const r = await repoFetch({}, RAW, init, { fetchFn: f });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { a: 1 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].u, RAW);
  assert.equal(f.calls[0].init, init);
});

test("with the token: the contents API, bearer + raw media type, no cf; the token never goes in the URL", async () => {
  _resetRepoMemo();
  const f = fakeFetch({ [API]: { body: '{"b":2}' } });
  const r = await repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, RAW, { headers: { accept: "application/json", "user-agent": "X/1" }, cf: { cacheTtl: 1 } }, { fetchFn: f });
  assert.deepEqual(await r.json(), { b: 2 });
  assert.equal(r.headers.get("x-repo-data"), "api");
  assert.equal(f.calls.length, 1);
  const { u, init } = f.calls[0];
  assert.ok(!u.includes(TOKEN));
  assert.equal(init.headers.get("authorization"), "Bearer " + TOKEN);
  assert.equal(init.headers.get("accept"), "application/vnd.github.raw+json");
  assert.equal(init.headers.get("user-agent"), "X/1");
  assert.equal(init.cf, undefined);
});

test("a refused token falls back to the raw read while the repo is public", async () => {
  for (const status of [401, 403, 404, 500]) {
    _resetRepoMemo();
    const f = fakeFetch({ [API]: { body: "no", status }, [RAW]: { body: '{"c":3}' } });
    const r = await repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, RAW, {}, { fetchFn: f });
    assert.equal(r.status, 200, "status " + status);
    assert.deepEqual(await r.json(), { c: 3 });
    assert.deepEqual(f.calls.map((c) => c.u), [API, RAW]);
    // the raw read never carries the token
    assert.ok(!JSON.stringify(f.calls[1].init || {}).includes(TOKEN));
  }
});

test("both refused: the API's answer comes back (401 says the token is the problem)", async () => {
  _resetRepoMemo();
  const f = fakeFetch({ [API]: { body: "bad creds", status: 401 }, [RAW]: { body: "404", status: 404 } });
  const r = await repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, RAW, {}, { fetchFn: f });
  assert.equal(r.status, 401);
  const f2 = fakeFetch({ [API]: new TypeError("network"), [RAW]: { body: "404", status: 404 } });
  assert.equal((await repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, RAW, {}, { fetchFn: f2 })).status, 404);
});

test("a timeout is not retried anonymously", async () => {
  _resetRepoMemo();
  const e = new Error("timed out"); e.name = "TimeoutError";
  const f = fakeFetch({ [API]: e, [RAW]: { body: "{}" } });
  await assert.rejects(() => repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, RAW, {}, { fetchFn: f }), /timed out/);
  assert.equal(f.calls.length, 1);
});

test("other URLs go straight through, token or not", async () => {
  const f = fakeFetch({ "https://example.com/x": { body: "hi" } });
  const r = await repoFetch({ GITHUB_DATA_TOKEN: TOKEN }, "https://example.com/x", { a: 1 }, { fetchFn: f });
  assert.equal(await r.text(), "hi");
  assert.deepEqual(f.calls[0].init, { a: 1 });
});

test("ttl: one read per ttl in this isolate, then the colo cache, then a fresh read", async () => {
  _resetRepoMemo();
  const store = new Map();
  globalThis.caches = { default: {
    match: async (r) => { const b = store.get(r.url); return b ? new Response(b.buf, { headers: b.h }) : undefined; },
    put: async (r, res) => { store.set(r.url, { buf: await res.arrayBuffer(), h: Object.fromEntries(res.headers) }); },
  } };
  try {
    let n = 0;
    const f = fakeFetch({ [API]: () => new Response('{"n":' + (++n) + "}", { headers: { "content-type": "text/plain" } }) });
    let t = 1000000;
    const env = { GITHUB_DATA_TOKEN: TOKEN };
    const read = async () => { const r = await repoFetch(env, RAW, {}, { fetchFn: f, ttl: 600, now: () => t }); return [r.headers.get("x-repo-data"), (await r.json()).n]; };
    assert.deepEqual(await read(), ["api", 1]);
    assert.equal(store.size, 1);
    const [key] = store.keys();
    assert.ok(!key.includes(TOKEN) && key.startsWith("https://repo-data.internal/"));
    assert.match(store.get(key).h["cache-control"], /max-age=600/);
    assert.deepEqual(await read(), ["memo", 1]);
    t += 601000;
    _resetRepoMemo();                      // another isolate in the same colo
    assert.deepEqual(await read(), ["cache", 1]);
    store.clear(); _resetRepoMemo();       // the colo copy expired too
    assert.deepEqual(await read(), ["api", 2]);
    assert.equal(f.calls.length, 2);
  } finally { delete globalThis.caches; _resetRepoMemo(); }
});

test("failed reads are not cached", async () => {
  _resetRepoMemo();
  let ok = false;
  const f = fakeFetch({ [RAW]: () => ok ? new Response("{}") : new Response("x", { status: 500 }) });
  assert.equal((await repoFetch({}, RAW, {}, { fetchFn: f, ttl: 600 })).status, 500);
  ok = true;
  assert.equal((await repoFetch({}, RAW, {}, { fetchFn: f, ttl: 600 })).status, 200);
  _resetRepoMemo();
});

// ---------- /theme-stage/ ----------

const md5 = async (buf) => createHash("md5").update(Buffer.from(buf)).digest("hex");
const JS = "window.x = 1;\n";
const JS_MD5 = createHash("md5").update(JS).digest("hex");
const NAME = "xg-thing-" + JS_MD5.slice(0, 8) + ".js";
const STAGE_RAW = RAW_PREFIX + WORKER_REF + "/theme-stage/" + NAME;
const stage = (path, fetchFn, env, method) => serveThemeStage(new Request("https://w.example" + path, { method: method || "GET" }), env || {}, new URL("https://w.example" + path), { fetchFn, md5 });

test("theme-stage serves a hash-named file whose md5 matches, as inert text", async () => {
  _resetRepoMemo();
  const f = fakeFetch({ [STAGE_RAW]: { body: JS } });
  const r = await stage("/theme-stage/" + NAME, f);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), JS);
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  assert.equal(r.headers.get("x-content-md5"), JS_MD5);
  assert.equal(r.headers.get("content-length"), String(Buffer.byteLength(JS)));
});

test("theme-stage reads through the token when it is set", async () => {
  _resetRepoMemo();
  const api = "https://api.github.com/repos/chaylon-ui/chaywrite/contents/theme-stage/" + NAME + "?ref=claude%2Fshopify-site-improvements-ztgdt8";
  const f = fakeFetch({ [api]: { body: JS } });
  const r = await stage("/theme-stage/" + NAME, f, { GITHUB_DATA_TOKEN: TOKEN });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-repo-data"), "api");
  assert.equal(f.calls.length, 1);
});

test("theme-stage refuses a file whose bytes do not match its name", async () => {
  _resetRepoMemo();
  const f = fakeFetch({ [STAGE_RAW]: { body: JS + "// tail" } });
  const r = await stage("/theme-stage/" + NAME, f);
  assert.equal(r.status, 409);
});

test("theme-stage: no listing, no unhashed or odd names, no traversal, GET/HEAD only", async () => {
  const f = fakeFetch({});
  for (const p of ["/theme-stage/", "/theme-stage/theme.liquid", "/theme-stage/x-1234abcd.html", "/theme-stage/../wrangler-1234abcd.js",
    "/theme-stage/a/b-1234abcd.js", "/theme-stage/x-1234ABCD.js", "/theme-stage/x-1234abc.js"]) {
    assert.equal((await stage(p, f)).status, 404, p);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await stage("/theme-stage/" + NAME, f, {}, "POST")).status, 405);
  assert.equal((await stage("/theme-stage/zz-1234abcd.css", f)).status, 404, "a missing file is a 404");
});

test("theme-stage: images keep their type", async () => {
  _resetRepoMemo();
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const name = "logo-" + createHash("md5").update(png).digest("hex").slice(0, 8) + ".png";
  const f = fakeFetch({ [RAW_PREFIX + WORKER_REF + "/theme-stage/" + name]: () => new Response(png) });
  const r = await stage("/theme-stage/" + name, f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
});

// ---------- /repo-data/health ----------

test("health: statuses and sizes only, never the token", async () => {
  const hRaw = RAW_PREFIX + "main/data/paintpicker-aos.json";
  const hApi = "https://api.github.com/repos/chaylon-ui/chaywrite/contents/data/paintpicker-aos.json?ref=main";
  let h = await repoDataHealth({}, { fetchFn: fakeFetch({ [hRaw]: { body: "12345" } }) });
  assert.deepEqual({ ok: h.ok, token: h.token, api: h.api, public: h.public, readsVia: h.readsVia }, { ok: true, token: false, api: null, public: true, readsVia: "raw" });
  // after the flip: raw 404, the token carries the reads
  h = await repoDataHealth({ GITHUB_DATA_TOKEN: TOKEN }, { fetchFn: fakeFetch({ [hApi]: { body: "12345", headers: { "x-ratelimit-remaining": "4999" } } }) });
  assert.equal(h.ok, true); assert.equal(h.public, false); assert.equal(h.readsVia, "api");
  assert.deepEqual(h.api, { status: 200, bytes: 5, rateRemaining: "4999" });
  assert.ok(!JSON.stringify(h).includes(TOKEN));
  // private and no working token: nothing can be read
  h = await repoDataHealth({ GITHUB_DATA_TOKEN: TOKEN }, { fetchFn: fakeFetch({ [hApi]: { body: "bad", status: 401 } }) });
  assert.equal(h.ok, false); assert.equal(h.readsVia, "none"); assert.equal(h.api.status, 401);
});
