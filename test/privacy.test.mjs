import { test } from "node:test";
import assert from "node:assert/strict";
import { harden, isStaffPath } from "../src/harden.js";
import { RETENTION, accessWhat, logAccess } from "../src/access-log.js";
import { stageDoFetch, serveStage } from "../src/stage.js";
import { requestsDoFetch } from "../src/requests.js";
import { winDoFetch } from "../src/win.js";
import { retentionTick } from "../src/retention.js";
import { seenDoFetch } from "../src/discord-seen.js";
import { impactDoFetch } from "../src/impact.js";
import { pushDoFetch } from "../src/push.js";

/* The privacy protections of 2026-10-20 (owner: "what other protections can
   you do"): response hardening, the customer-data access log, the nightly
   retention sweep across the 9Pocket, requests and contest stores. */

const DAY = 86400e3;
const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);

// In-memory Durable Object storage: get / put / delete / list with prefix,
// start (inclusive, key order) and limit, as the sweep uses them.
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) {
    const out = new Map(); const keys = [...this.m.keys()].sort();
    for (const k of keys) {
      if (o && o.prefix && !k.startsWith(o.prefix)) continue;
      if (o && o.start && k < o.start) continue;
      out.set(k, this.m.get(k));
      if (o && o.limit && out.size >= o.limit) break;
    }
    return out;
  }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
function cx(clock) { return { storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {}, mem: {}, adminGql: async () => null }; }
const ORIGIN = "https://w.example";
async function call(fn, c, path, body) {
  const url = new URL(ORIGIN + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await fn(c, req, url);
  return r.json();
}
// A fake env whose ROOM routes each named store to its module.
function envWith(stores) {
  const route = (n) => async (req) => {
    const url = new URL(req.url); const c = stores[n];
    if (!c) return new Response("no such store", { status: 404 });
    if (url.pathname.startsWith("/_stage/")) return stageDoFetch(c, req, url);
    if (url.pathname.startsWith("/_req/")) return requestsDoFetch(c, req, url);
    if (url.pathname.startsWith("/_win/")) return winDoFetch(c, req, url);
    if (url.pathname.startsWith("/_seen/")) return seenDoFetch(c, req, url);
    if (url.pathname.startsWith("/_imp/")) return impactDoFetch(c, req, url);
    if (url.pathname.startsWith("/_push/")) return pushDoFetch(c, req, url);
    return new Response("no such path", { status: 404 });
  };
  return { ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: route(n) }) } };
}

test("harden: browser protections on every answer, more on staff screens, WebSockets untouched", () => {
  const pub = harden(new Response("hi", { headers: { "content-type": "text/html" } }), new URL(ORIGIN + "/win"));
  assert.equal(pub.headers.get("x-content-type-options"), "nosniff");
  assert.equal(pub.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(pub.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(pub.headers.get("x-frame-options"), null, "public pages may be framed (the store embeds them)");
  assert.equal(pub.headers.get("cache-control"), null, "public caching is the page's own business");
  assert.match(pub.headers.get("permissions-policy"), /camera=\(\)/);
  const staff = harden(new Response("hi", { headers: { "referrer-policy": "origin", "cache-control": "max-age=60" } }), new URL(ORIGIN + "/9pocket/b/123"));
  assert.equal(staff.headers.get("x-frame-options"), "DENY");
  assert.equal(staff.headers.get("referrer-policy"), "no-referrer", "staff screens never leak their address, whatever the page set");
  assert.equal(staff.headers.get("cache-control"), "max-age=60", "an existing cache-control wins");
  assert.equal(harden(new Response("x", { headers: { "cache-control": "" } }), new URL(ORIGIN + "/9pocket")).headers.get("x-frame-options"), "DENY");
  assert.equal(harden(new Response("x"), new URL(ORIGIN + "/9pocket")).headers.get("cache-control"), "no-store");
  const keep = new Response("k", { headers: { "x-content-type-options": "already" } });
  assert.equal(harden(keep, new URL(ORIGIN + "/cards.json")).headers.get("x-content-type-options"), "already", "existing headers win");
  const ws = { status: 101, webSocket: {}, headers: new Headers() };
  assert.equal(harden(ws, new URL(ORIGIN + "/ws")), ws, "a WebSocket upgrade passes through as is");
  assert.equal(harden(null, new URL(ORIGIN + "/")), null);
  for (const p of ["/9pocket", "/9pocket.json", "/9pocket/win", "/staff", "/pickups.json", "/admin/page-edit.json", "/portal/buylists.json", "/hold/shadow", "/deckstats.json", "/buylist/staged", "/autoprice", "/discord/preview"]) assert.ok(isStaffPath(p), p + " is a staff path");
  for (const p of ["/", "/win", "/win/verify", "/cards.json", "/buylist/api/x", "/9pocketx", "/holdings", "/stafford"]) assert.ok(!isStaffPath(p), p + " is public");
});

test("accessWhat: the 9Pocket screens that show customer data, with the record they show", () => {
  assert.deepEqual(accessWhat("/9pocket"), { what: "buylists list" });
  assert.deepEqual(accessWhat("/9pocket/"), { what: "buylists list" });
  assert.deepEqual(accessWhat("/9pocket.json"), { what: "buylists list (json)" });
  assert.deepEqual(accessWhat("/9pocket/b/01700000000000-abcd"), { what: "buylist", id: "01700000000000-abcd" });
  assert.deepEqual(accessWhat("/9pocket/held"), { what: "held stock" });
  assert.deepEqual(accessWhat("/9pocket/requests/RQ-1001"), { what: "request", id: "RQ-1001" });
  assert.deepEqual(accessWhat("/9pocket/win"), { what: "contest entries" });
  assert.deepEqual(accessWhat("/9pocket/win/export.csv"), { what: "contest export" });
  assert.deepEqual(accessWhat("/9pocket/admin/access.csv"), { what: "access log export" });
  assert.equal(accessWhat("/9pocket/login"), null, "signing in shows nobody's data");
  assert.equal(accessWhat("/9pocket/stock"), null);
  assert.equal(accessWhat("/9pocket/b/../x"), null);
});

test("access log in the 9Pocket DO: rows newest first, bounded fields, retention periods, CSV", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const S = (p, b) => call(stageDoFetch, c, p, b);
  assert.deepEqual(await S("/_stage/access", { who: "a@exor.test", via: "account", what: "buylist", id: "9P-1001" }), { ok: true });
  clock.t += 1000;
  await S("/_stage/access", { who: "x".repeat(400), via: "pin", what: "buylists list" });
  clock.t += 1000;
  await S("/_stage/access", { who: "automation", via: "automation", what: "buylists list (json)" });
  const all = (await S("/_stage/access")).rows;
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((r) => r.via), ["automation", "pin", "account"], "newest first");
  assert.equal(all[1].who.length, 160, "fields are bounded");
  assert.deepEqual(all[2], { t: T0, who: "a@exor.test", via: "account", what: "buylist", id: "9P-1001" });
  assert.equal((await S("/_stage/access?limit=2")).rows.length, 2);
  assert.equal((await S("/_stage/access?limit=99999")).rows.length, 3, "the limit is capped, never an error");
  const ret = await S("/_stage/retention");
  assert.deepEqual(ret.retention, RETENTION); assert.equal(ret.last, null);
  const h = await S("/_stage/health");
  assert.deepEqual(h.retention, RETENTION); assert.equal(h.lastSweep, null);
});

test("retention sweep in the 9Pocket DO: old access rows and buylists go, recent ones stay, once a day unless forced", async () => {
  const clock = { t: T0 - 3 * 365 * DAY }; const c = cx(clock);
  const S = (p, b) => call(stageDoFetch, c, p, b);
  await S("/_stage/access", { who: "old", via: "account", what: "buylist", id: "1" });   // 3 years ago
  clock.t = T0 - 10 * DAY;
  await S("/_stage/access", { who: "recent", via: "account", what: "buylist", id: "2" });
  clock.t = T0;
  await c.storage.put("st:a", { id: "a", ts: T0 - 400 * DAY, status: "staged" });     // never decided, > stagedDays
  await c.storage.put("st:b", { id: "b", ts: T0 - 100 * DAY, status: "approved" });   // decided, > buylistDays
  await c.storage.put("st:c", { id: "c", ts: T0 - 100 * DAY, status: "staged" });     // undecided but < stagedDays: stays
  await c.storage.put("st:d", { id: "d", ts: T0 - 10 * DAY, status: "rejected" });    // recent: stays
  const first = await S("/_stage/sweep", {});
  assert.equal(first.skipped, undefined, "the first sweep ever runs");
  assert.deepEqual(first.last.counts, { access: 1, buylists: 2 });
  assert.equal(first.last.at, T0);
  assert.deepEqual((await S("/_stage/access")).rows.map((r) => r.who), ["recent"]);
  assert.deepEqual([...(await c.storage.list({ prefix: "st:" })).keys()], ["st:c", "st:d"]);
  clock.t += 3600e3;
  const again = await S("/_stage/sweep", {});
  assert.equal(again.skipped, "not due"); assert.equal(again.last.at, T0);
  const forced = await S("/_stage/sweep", { force: true });
  assert.equal(forced.skipped, undefined); assert.deepEqual(forced.last.counts, { access: 0, buylists: 0 });
  clock.t += 21 * 3600e3;
  assert.equal((await S("/_stage/sweep", {})).skipped, undefined, "due again after 20 hours");
  const noted = await S("/_stage/sweep-note", { others: { requests: { requests: 2, rateRows: 1 } } });
  assert.deepEqual(noted.last.others, { requests: { requests: 2, rateRows: 1 } });
  assert.deepEqual((await S("/_stage/retention")).last.others, { requests: { requests: 2, rateRows: 1 } });
});

test("requests sweep: decided requests past requestDays, open ones past openRequestDays, stale rate rows", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  await c.storage.put("rq:1", { id: "1", ts: T0 - 200 * DAY, status: "closed" });    // decided, > 180 d: goes
  await c.storage.put("rq:2", { id: "2", ts: T0 - 200 * DAY, status: "open" });      // open, < 365 d: stays
  await c.storage.put("rq:3", { id: "3", ts: T0 - 400 * DAY, status: "open" });      // open, > 365 d: goes
  await c.storage.put("rq:4", { id: "4", ts: T0 - 5 * DAY, status: "declined" });    // recent: stays
  await c.storage.put("rqrl:1.2.3.4", { n: 2, at: T0 - 2 * 3600e3 });                // older than the hour: goes
  await c.storage.put("rqrl:5.6.7.8", { n: 1, at: T0 - 600e3 });                     // stays
  const r = await call(requestsDoFetch, c, "/_req/sweep", {});
  assert.deepEqual(r, { ok: true, counts: { requests: 2, rateRows: 1 } });
  assert.deepEqual([...(await c.storage.list({ prefix: "rq" })).keys()], ["rq:2", "rq:4", "rqrl:5.6.7.8"]);
  assert.equal(RETENTION.requestDays, 180); assert.equal(RETENTION.openRequestDays, 365);
});

test("contest sweep: nothing until the contest has been closed for contestDaysAfterClose, then entries, tokens and draws go; counts stay", async () => {
  const closes = Date.UTC(2026, 9, 19, 2, 59, 0);
  const clock = { t: closes + 10 * DAY }; const c = cx(clock);
  const W = (p, b) => call(winDoFetch, c, p, b);
  await W("/_win/cfg", { closesAt: closes });
  await c.storage.put("win:e:a@x.test", { email: "a@x.test", first: "A", verifiedAt: closes - DAY });
  await c.storage.put("win:e:b@x.test", { email: "b@x.test", first: "B", verifiedAt: closes - DAY });
  await c.storage.put("win:p:tok1", { email: "c@x.test", at: closes - 3600e3, exp: closes + 48 * 3600e3 });   // long expired
  await c.storage.put("win:r:1234:abcd", { n: 1 });
  await c.storage.put("win:draws", [{ email: "a@x.test", first: "A", at: closes + DAY }]);
  await c.storage.put("win:v:2026-10-17", { visits: 40, signups: 9, confirmed: 7 });
  const early = await W("/_win/sweep", {});
  assert.deepEqual(early.counts, { due: false, entries: 0, pending: 0, draws: 0 });
  assert.equal((await c.storage.list({ prefix: "win:e:" })).size, 2, "entries stay while the owner may still need them");
  assert.equal((await c.storage.list({ prefix: "win:p:" })).size, 0, "an expired pending token is dropped at once");
  clock.t = closes + (RETENTION.contestDaysAfterClose + 1) * DAY;
  const late = await W("/_win/sweep", {});
  assert.deepEqual(late.counts, { due: true, entries: 2, pending: 0, draws: 1 });
  assert.equal((await c.storage.list({ prefix: "win:e:" })).size, 0);
  assert.equal((await c.storage.list({ prefix: "win:r:" })).size, 0);
  assert.equal(await c.storage.get("win:draws"), undefined);
  assert.deepEqual(await c.storage.get("win:v:2026-10-17"), { visits: 40, signups: 9, confirmed: 7 }, "counts carry no names and stay");
  assert.equal((await c.storage.get("win:cfg")).closesAt, closes, "the settings stay");
  const open = cx({ t: T0 }); await call(winDoFetch, open, "/_win/cfg", { closesAt: null });
  await open.storage.put("win:e:z@x.test", { email: "z@x.test" });
  assert.equal((await call(winDoFetch, open, "/_win/sweep", {})).counts.due, false, "a contest with no closing time is never swept");
});

test("retentionTick: the 9Pocket DO decides whether a sweep is due; the other stores follow and their counts are noted", async () => {
  const clock = { t: T0 };
  const stores = { "buylist-stage": cx(clock), requests: cx(clock), "win-contest": cx(clock), "discord-seen": cx(clock), impact: cx(clock), push: cx(clock) };
  await stores.requests.storage.put("rq:1", { id: "1", ts: T0 - 400 * DAY, status: "open" });
  await stores["discord-seen"].storage.put("seen:1", { id: "1", at: T0 - 800 * DAY });
  await stores["discord-seen"].storage.put("seen:2", { id: "2", at: T0 - 5 * DAY });
  const env = envWith(stores);
  const r1 = await retentionTick(env);
  assert.equal(r1.ran, true);
  assert.deepEqual(r1.stage, { access: 0, buylists: 0 });
  assert.deepEqual(r1.others, { requests: { requests: 1, rateRows: 0 }, contest: { due: false, entries: 0, pending: 0, draws: 0 }, discord: { members: 1, departed: 0 }, impact: { rows: 0, markers: 0 }, push: { digests: 0 } });
  assert.deepEqual((await call(stageDoFetch, stores["buylist-stage"], "/_stage/retention")).last.others, r1.others);
  assert.deepEqual(await retentionTick(env), { skipped: "not due" });
  clock.t += DAY;
  assert.equal((await retentionTick(env)).ran, true);
  assert.deepEqual(await retentionTick({}), { skipped: "no storage" });
  const broken = envWith({ "buylist-stage": cx(clock) });
  clock.t += DAY;
  const r2 = await retentionTick(broken);
  assert.equal(r2.ran, true);
  assert.deepEqual(r2.others, { requests: "failed", contest: "failed", discord: "failed", impact: "failed", push: "failed" }, "a store that cannot be reached is reported, not fatal");
});

test("logAccess: one bounded row to the 9Pocket DO, riding ctx.waitUntil when there is one", async () => {
  const clock = { t: T0 }; const stores = { "buylist-stage": cx(clock) };
  const env = envWith(stores);
  const waited = [];
  const ctx = { waitUntil: (p) => waited.push(p) };
  const p = logAccess(env, ctx, ORIGIN, { who: "a@exor.test", via: "account", what: "hold report", id: 42 });
  assert.equal(waited.length, 1); await p;
  const rows = (await call(stageDoFetch, stores["buylist-stage"], "/_stage/access")).rows;
  assert.deepEqual(rows, [{ t: T0, who: "a@exor.test", via: "account", what: "hold report", id: "42" }]);
  await logAccess(env, null, ORIGIN, { who: "b", via: "pin", what: "pickups (open draft orders)" });
  assert.equal((await call(stageDoFetch, stores["buylist-stage"], "/_stage/access")).rows.length, 2, "no ctx: still written");
  assert.equal(await logAccess({}, ctx, ORIGIN, { who: "x" }), undefined, "no storage: a quiet no-op");
});

test("serveStage: a successful staff view of customer data is logged with who opened it; denied and sign-in pages are not", async () => {
  const clock = { t: T0 }; const stores = { "buylist-stage": cx(clock) };
  const env = envWith(stores);
  const waited = [];
  const sopts = { ctx: { waitUntil: (p) => waited.push(p) } };
  const staffOk = async () => true; staffOk.last = { ok: true, via: "automation", who: "automation" };
  const get = (path) => { const url = new URL(ORIGIN + path); return serveStage(new Request(url), env, url, staffOk, sopts); };
  const r = await get("/9pocket.json?k=whatever");
  assert.equal(r.status, 200);
  await Promise.all(waited);
  let rows = (await call(stageDoFetch, stores["buylist-stage"], "/_stage/access")).rows;
  assert.deepEqual(rows, [{ t: T0, who: "automation", via: "automation", what: "buylists list (json)", id: "" }]);
  const denied = async () => false; denied.last = { ok: false };
  const url = new URL(ORIGIN + "/9pocket.json?k=wrong");
  assert.equal((await serveStage(new Request(url), env, url, denied, sopts)).status, 403);
  const login = new URL(ORIGIN + "/9pocket/login");
  assert.ok([200, 403].includes((await serveStage(new Request(login), env, login, denied, sopts)).status), "the sign-in page (403 = the setup page while no account exists)");
  await Promise.all(waited);
  rows = (await call(stageDoFetch, stores["buylist-stage"], "/_stage/access")).rows;
  assert.equal(rows.length, 1, "a refused call and the sign-in page write nothing");
});
