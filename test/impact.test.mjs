// Sales impact of the site tools (owner 2026-10-20, "the upsell build").
import { test } from "node:test";
import assert from "node:assert/strict";
import { impactDoFetch, impactTick, serveImpact, renderImpact, attribute, toolOf, dayOf, weekOf, TOOLS, IMPACT_DO } from "../src/impact.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);   // Tue 2026-10-20 12:00 Atlantic
const ORIGIN = "https://w.example";

class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
}
const cx = (clock) => ({ storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {} });
async function call(c, path, body) {
  const url = new URL(ORIGIN + path);
  const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  return (await impactDoFetch(c, req, url)).json();
}
const envWith = (c, extra) => ({ SHOPIFY_ADMIN_TOKEN: "t", ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n !== IMPACT_DO) return new Response("wrong store", { status: 404 }); return impactDoFetch(c, req, url); } }) }, ...(extra || {}) });
const line = (o) => ({ quantity: 1, customAttributes: [], product: { productType: "MTG Single" }, originalTotalSet: { shopMoney: { amount: "4.95" } }, discountedTotalSet: { shopMoney: { amount: "4.95" } }, ...o });
const order = (name, at, lines, extra) => ({ name, createdAt: new Date(at).toISOString(), cancelledAt: null, totalPriceSet: { shopMoney: { amount: "50.00" } }, lineItems: { nodes: lines }, ...(extra || {}) });

test("days, weeks, tool markers and attribution", () => {
  assert.equal(dayOf(T0), "2026-10-20");
  assert.equal(weekOf(T0), "2026-10-19", "Monday of that Atlantic week");
  assert.equal(weekOf(Date.UTC(2026, 9, 19, 1, 0, 0)), "2026-10-12", "01:00Z on the 19th is still Sunday the 18th in Halifax");
  assert.equal(toolOf(line({ customAttributes: [{ key: "_xg", value: "paint-sheet" }] })), "paint-sheet");
  assert.equal(toolOf(line({ customAttributes: [{ key: "_deck", value: "1" }] })), "deck", "the Deck Builder's older marker");
  assert.equal(toolOf(line({ customAttributes: [{ key: "_xg", value: "nope" }] })), null);
  assert.equal(toolOf(line({ customAttributes: [{ key: "Engraving", value: "hi" }] })), null);
  const a = attribute(order("#1", T0, [
    line({ customAttributes: [{ key: "_xg", value: "paint-sheet" }], product: { productType: "Citadel Paint" }, quantity: 2, discountedTotalSet: { shopMoney: { amount: "11.90" } } }),
    line({ product: { productType: "Army Painter Speedpaint" }, quantity: 1, discountedTotalSet: { shopMoney: { amount: "6.50" } } }),
    line({ customAttributes: [{ key: "_deck", value: "1" }] }),
    line({}),
  ]));
  assert.deepEqual(a.tools, { "paint-sheet": { units: 2, cents: 1190 }, deck: { units: 1, cents: 495 } });
  assert.deepEqual(a.paint, { units: 3, cents: 1840 }, "paint lines by product type, whichever tool");
  assert.equal(a.allCents, 5000); assert.equal(a.at, T0); assert.equal(a.cancelled, false);
  const c = attribute(order("#2", T0, [line({ customAttributes: [{ key: "_xg", value: "deck" }] })], { cancelled_at: null, cancelledAt: "2026-10-20T16:00:00Z" }));
  assert.equal(c.cancelled, true); assert.deepEqual(c.tools, {}, "a cancelled order contributes nothing");
  assert.ok(Object.keys(TOOLS).length >= 13);
});

test("DO: beacons by day, orders counted once into day and week rows, the report's windows, sweep, health", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  assert.deepEqual(await call(c, "/_imp/hit", { tool: "paint-sheet", ev: "open" }), { ok: true });
  await call(c, "/_imp/hit", { tool: "paint-sheet", ev: "add" });
  assert.equal((await call(c, "/_imp/hit", { tool: "smoke", ev: "add" })).ok, false);
  assert.equal((await call(c, "/_imp/hit", { tool: "deck", ev: "buy" })).ok, false);
  const harvest = [
    attribute(order("#100", T0 - 2 * DAY, [line({ customAttributes: [{ key: "_xg", value: "paint-sheet" }], product: { productType: "Citadel Paint" }, discountedTotalSet: { shopMoney: { amount: "7.00" } } })])),
    attribute(order("#101", T0 - 40 * DAY, [line({ customAttributes: [{ key: "_deck", value: "1" }], quantity: 3, discountedTotalSet: { shopMoney: { amount: "15.00" } } }), line({ product: { productType: "Vallejo Primer" } })])),
    attribute(order("#102", T0 - 100 * DAY, [line({})])),
    attribute(order("#103", T0 - DAY, [line({ customAttributes: [{ key: "_xg", value: "deck" }] })], { cancelledAt: "2026-10-19T00:00:00Z" })),
  ];
  let r = await call(c, "/_imp/orders", { orders: harvest, scan: { since: "2026-10-20T00:00:00Z", pages: 1 } });
  assert.equal(r.added, 4); assert.equal(r.tagged, 2, "the cancelled one is not counted");
  r = await call(c, "/_imp/orders", { orders: harvest });
  assert.equal(r.added, 0, "the same orders again change nothing");
  const rep = await call(c, "/_imp/report");
  assert.deepEqual(rep.windows[7], { "paint-sheet": { open: 1, add: 1, orders: 1, units: 1, cents: 700 } });
  assert.deepEqual(rep.windows[30], rep.windows[7]);
  assert.deepEqual(rep.windows[90].deck, { open: 0, add: 0, orders: 1, units: 3, cents: 1500 });
  assert.deepEqual(rep.weeks.map((w) => w.week), ["2026-10-12", "2026-09-07", "2026-07-06"], "Oct 18 is a Sunday: week of Mon Oct 12; the cancelled Oct 19 order makes no week row");
  const wk = rep.weeks.find((w) => w.week === "2026-09-07");
  assert.deepEqual(wk, { week: "2026-09-07", orders: 1, cents: 5000, paintOrders: 1, paintUnits: 1, paintCents: 495 });
  assert.equal(rep.weeks[0].orders, 1);
});

test("DO: cancelled orders stay out of the week rows", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  await call(c, "/_imp/orders", { orders: [attribute(order("#1", T0, [line({})], { cancelledAt: "2026-10-20T00:00:00Z" })), attribute(order("#2", T0, [line({})]))] });
  const rep = await call(c, "/_imp/report");
  assert.deepEqual(rep.weeks, [{ week: "2026-10-19", orders: 1, cents: 5000, paintOrders: 0, paintUnits: 0, paintCents: 0 }]);
  clock.t = T0 + 500 * DAY;
  const sw = await call(c, "/_imp/sweep", {});
  assert.deepEqual(sw.counts, { rows: 1, markers: 2 });
  const h = await call(c, "/_imp/health");
  assert.equal(h.weeks, 0); assert.equal(h.orders, 2);
});

test("impactTick: pages through new orders, hands them to the store, moves the cursor, reports errors, waits ten minutes between looks", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const env = envWith(c);
  const pages = [
    { nodes: [order("#1", T0 - 3 * DAY, [line({ customAttributes: [{ key: "_xg", value: "quick-add" }] })]), order("#2", T0 - 2 * DAY, [line({})])], pageInfo: { hasNextPage: true, endCursor: "c1" } },
    { nodes: [order("#3", T0 - DAY, [line({ customAttributes: [{ key: "_xg", value: "card-finder" }], quantity: 2 })])], pageInfo: { hasNextPage: false, endCursor: null } },
  ];
  const calls = [];
  const f = async (u, init) => { const b = JSON.parse(init.body); calls.push(b.variables); const after = b.variables.after; return new Response(JSON.stringify({ data: { orders: after ? pages[1] : pages[0] } }), { status: 200, headers: { "content-type": "application/json" } }); };
  const t1 = await impactTick(env, { now: T0, fetchFn: f });
  assert.deepEqual({ ran: t1.ran, pages: t1.pages, orders: t1.orders, added: t1.added, tagged: t1.tagged, done: t1.done, error: t1.error }, { ran: true, pages: 2, orders: 3, added: 3, tagged: 2, done: true, error: null });
  assert.match(calls[0].q, /^created_at:>='2026-06-22T15:00:00.000Z'$/, "the first look backfills 120 days");
  assert.equal(calls[1].after, "c1");
  const scan = (await call(c, "/_imp/scan")).scan;
  assert.equal(scan.since, new Date(T0 - DAY).toISOString(), "next look starts at the newest order seen");
  assert.equal(scan.done, true);
  assert.deepEqual(await impactTick(env, { now: T0 + 60e3, fetchFn: f }), { skipped: "not due" });
  const t2 = await impactTick(env, { now: T0 + 11 * 60e3, fetchFn: f });
  assert.equal(t2.added, 0, "page one again: already counted");
  const bad = await impactTick(env, { now: T0 + 30 * 60e3, fetchFn: async () => new Response("{\"errors\":[{\"message\":\"boom\"}]}", { status: 200 }) });
  assert.match(bad.error, /boom/); assert.equal(bad.done, false);
  assert.match((await call(c, "/_imp/scan")).scan.lastError, /boom/);
  assert.equal(await impactTick({ ROOM: env.ROOM }), null, "no admin token: nothing runs");
  const rep = await call(c, "/_imp/report");
  assert.equal(rep.windows[7]["quick-add"].orders, 1); assert.equal(rep.windows[7]["card-finder"].units, 2);
});

test("serveImpact: the beacon answers 204 always, counts known tools, ignores the rest; OPTIONS for CORS", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const env = envWith(c);
  const post = (body, type) => { const url = new URL(ORIGIN + "/impact"); return serveImpact(new Request(url, { method: "POST", headers: { "content-type": type || "text/plain" }, body }), env, url, null); };
  let r = await post(JSON.stringify({ tool: "ticker", ev: "add" }));
  assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  await post(JSON.stringify({ tool: "ticker", ev: "open" }), "application/json");
  assert.equal((await post(JSON.stringify({ tool: "evil", ev: "add" }))).status, 204);
  assert.equal((await post("not json")).status, 204);
  const url = new URL(ORIGIN + "/impact");
  assert.equal((await serveImpact(new Request(url, { method: "OPTIONS" }), env, url, null)).status, 204);
  assert.equal((await serveImpact(new Request(url), env, url, null)).status, 405);
  const rep = await call(c, "/_imp/report");
  assert.deepEqual(rep.windows[7], { ticker: { open: 1, add: 1, orders: 0, units: 0, cents: 0 } });
});

test("renderImpact: tables per window, the paint weeks, the scan state", () => {
  const rep = { windows: { 7: { "paint-sheet": { open: 10, add: 4, orders: 2, units: 3, cents: 2100 } }, 30: {}, 90: {} }, weeks: [{ week: "2026-10-19", orders: 40, cents: 400000, paintOrders: 4, paintUnits: 9, paintCents: 6000 }], scan: { scanAt: T0, orders: 120, tagged: 7, startAt: T0 - 120 * DAY, done: false }, tools: TOOLS, now: T0 };
  const html = renderImpact({ user: { email: "a@exor.test", role: "admin" }, rep });
  assert.match(html, /Paint sheet \(bottle sheet\)/);
  assert.match(html, /<td class="n">10<\/td><td class="n">4<\/td><td class="n">2<\/td><td class="n">3<\/td><td class="n">\$21\.00<\/td><td class="n">50%<\/td>/);
  assert.match(html, /Nothing yet in the last 30 days/);
  assert.match(html, /2026-10-19<\/td><td class="n">9<\/td><td class="n">\$60\.00<\/td><td class="n">4<\/td><td class="n">40<\/td><td class="n">10\.0%<\/td><td class="n">\$4,000\.00/);
  assert.match(html, /still backfilling/);
  assert.match(html, /120 orders read/);
});
