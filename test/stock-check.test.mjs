import { test } from "node:test";
import assert from "node:assert/strict";
import { inScopeType, isPreorder, seriesOf, rateWindow, stalled, reorder, categoryDrop, visibleLook, visibleReorder, shouldStart, parseOrdersPage, parseScanPage, parseLookup, parseOpen, openQuery, doWork, stockCheckTick, stockDoFetch, serveStockStaff, canView, canAct, dayOf, STOCK_DO, RUN_HOUR_UTC, SNOOZE_DAYS, DAY_MS, ORDERS_Q, SCAN_Q, LOOKUP_Q, TYPES_Q } from "../src/stock-check.js";
import { renderStock, renderStockDenied } from "../src/stock-check-ui.js";
import { SC_PERMS, ALL_PERMS, permsFrom, can } from "../src/stage-auth.js";

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, structuredClone(this.m.get(x))); return out; } return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, structuredClone(b)); return; } this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, structuredClone(this.m.get(k))); return out; }
}
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);   // 2026-10-14 12:00Z
const TODAY = dayOf(T0);
function cx(clock) { return { storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {}, mem: {} }; }
async function call(c, path, body) {
  const url = new URL("https://sc.internal" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await stockDoFetch(c, req, url);
  return r.json();
}
function envWith(c, extra) {
  return { SHOPIFY_ADMIN_TOKEN: "t", ...(extra || {}), ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { assert.equal(n, STOCK_DO); return stockDoFetch(c, req, new URL(req.url)); } }) } };
}
const series = (spec) => { const a = new Array(90).fill(0); for (const [i, n] of Object.entries(spec)) a[Number(i)] = n; return a; };

test("scope: singles, slabs, tickets and the console placeholders are out; everything else in", () => {
  for (const t of ["MTG Single", "Pokemon Japan Singles", "Lorcana Single Graded", "Yugioh Single Graded", "Event Ticket", "BulkCardEvaluation", "Internal Used", "Used", "PlayStation 5", "Nintendo 64", "Sega Genesis", "Gameboy Advance", "Xbox One"]) assert.equal(inScopeType(t), false, t);
  for (const t of ["Magic Sealed Product", "Board Games", "Games Workshop", "Paint", "Sleeves & Toploaders", "Funko", "", "TBD", "Spark of Rebellion", "One Piece Sealed"]) assert.equal(inScopeType(t), true, t || "(blank)");
  assert.equal(isPreorder("MTG STAR TREK BUNDLE PRE ORDER ^ NOV 6/26"), true);
  assert.equal(isPreorder("RIFTBOUND VAULT (LIMIT 1) PREORDER"), true);
  assert.equal(isPreorder("Pre-Order Deck Box"), true);
  assert.equal(isPreorder("Preordained Playmat"), false);
});

test("stalled: steady seller gone quiet with stock is flagged; the exclusions hold", () => {
  // sold 9 in the 30 days ending day 65 (index), nothing since: 24 days quiet
  const s = series({ 40: 1, 45: 2, 50: 1, 55: 2, 60: 1, 63: 1, 65: 1 });
  const f = stalled({ qty: 3, cents: 9995, title: "Box" }, s, TODAY);
  assert.ok(f, "flagged");
  assert.equal(f.daysSince, 24);
  assert.equal(f.window, 30); assert.equal(f.soldWindow, 9);
  assert.equal(f.expected, 7.2); assert.ok(f.p0 < 0.001);
  assert.equal(f.atRisk, 299.85);
  assert.equal(stalled({ qty: 0, cents: 9995, title: "Box" }, s, TODAY), null, "no stock, nothing to look for");
  assert.equal(stalled({ qty: 3, cents: 9995, title: "Box PRE ORDER ^ NOV 6" }, s, TODAY), null, "preorders are out");
  assert.equal(stalled({ qty: 3, cents: 9995, title: "Box", restockDay: TODAY - 10 }, s, TODAY), null, "restocked after the last sale: clock restarted");
  assert.ok(stalled({ qty: 3, cents: 9995, title: "Box", restockDay: TODAY - 40 }, s, TODAY), "an older restock does not matter");
  // slow seller: 2 in the whole window never reaches MIN_SALES
  assert.equal(stalled({ qty: 3, cents: 100, title: "x" }, series({ 10: 1, 50: 1 }), TODAY), null);
  // steady but the quiet spell is too short to mean anything: 1/day for 30 days, 2 days quiet
  assert.equal(stalled({ qty: 3, cents: 100, title: "x" }, series(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [58 + i, 1]))), TODAY), null);
  // 1 a day for 30 days then 4 quiet days: 4 expected -> flagged
  const f2 = stalled({ qty: 1, cents: 100, title: "x" }, series(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [56 + i, 1]))), TODAY);
  assert.ok(f2 && f2.daysSince === 4 && f2.expected === 4);
  // widened window: only 1 sale in the 30 days before the last one, 4 in 60 -> the 60-day rate, 49 quiet days
  const f3 = stalled({ qty: 2, cents: 100, title: "x" }, series({ 0: 1, 5: 1, 10: 1, 40: 1 }), TODAY);
  assert.ok(f3 && f3.window === 60 && f3.soldWindow === 4 && f3.daysSince === 49 && f3.expected === 3.3, JSON.stringify(f3));
  assert.equal(rateWindow(series({ 89: 1 }), 89), null);
});

test("reorder: sold out after steady sales; missed sales from the rate before", () => {
  const s = series({ 30: 2, 40: 1, 50: 2, 60: 1, 69: 2 });   // 8 in the 60 days before the last sale (day 69), out 20 days
  const f = reorder({ title: "Sleeves", cents: 1299 }, s, TODAY, 0);
  assert.ok(f);
  assert.equal(f.daysOut, 20); assert.equal(f.sold60, 8); assert.equal(f.sold30, 6);
  assert.equal(f.missed, 2.7); assert.equal(f.missedRevenue, 34.64, "from the unrounded rate: 8/60 x 20 x 12.99");
  assert.equal(reorder({ title: "Sleeves", cents: 1299 }, s, TODAY, 2), null, "in stock: not a reorder");
  assert.equal(reorder({ title: "Box PRE ORDER ^ DEC 1", cents: 1 }, s, TODAY, 0), null);
  assert.equal(reorder({ title: "x", cents: 1 }, series({ 69: 2 }), TODAY, 0), null, "2 sales do not make a steady seller");
  assert.equal(reorder({ title: "x", cents: 1 }, series({}), TODAY, 0), null);
});

test("categoryDrop: the whole type cooling off", () => {
  const typeS = new Array(90).fill(0);
  for (let i = 30; i <= 65; i++) typeS[i] = 10;   // 10/day before
  for (let i = 66; i < 90; i++) typeS[i] = 2;     // 2/day after
  assert.equal(categoryDrop(typeS, TODAY - 24, TODAY, 30), 0.8);
  assert.equal(categoryDrop(null, TODAY - 24, TODAY, 30), null);
  assert.equal(categoryDrop(new Array(90).fill(0), TODAY - 24, TODAY, 30), null);
  // the item's own sales are taken out: a type whose only seller is this item says nothing
  assert.equal(categoryDrop(typeS, TODAY - 24, TODAY, 30, typeS), null);
  const own = new Array(90).fill(0); for (let i = 30; i <= 65; i++) own[i] = 1;
  assert.equal(categoryDrop(typeS, TODAY - 24, TODAY, 30, own), 0.78, "9/day before from the others, 2/day after");
  const thin = new Array(90).fill(0); thin[60] = 3; thin[65] = 3;
  assert.equal(categoryDrop(thin, TODAY - 24, TODAY, 30), null, "6 units from the others is too little to call a trend");
});

test("visibility: snoozes expire, missing hides, permanent dismissals stay, arrivals clear", () => {
  const now = T0;
  assert.deepEqual(visibleLook(null, now, false), { show: true, due: false });
  assert.equal(visibleLook({ state: "found_floor", until: now + 1000 }, now, false).show, false);
  assert.deepEqual(visibleLook({ state: "found_floor", until: now - 1000 }, now, false), { show: true, due: true });
  assert.equal(visibleLook({ state: "found_floor", until: now + 1000 }, now, true).due, true, "it sold after the check: the old snooze is moot");
  assert.equal(visibleLook({ state: "not_found", at: now }, now, false).missing, true);
  assert.equal(visibleLook({ state: "not_found", at: now, closed: { state: "turned_up" } }, now, false).show, true);
  assert.equal(visibleReorder({ state: "cant_reorder" }, now, 0).dismissed, true);
  assert.equal(visibleReorder({ state: "cant_reorder", closed: { state: "restored" } }, now, 0).show, true);
  assert.equal(visibleReorder({ state: "ordered", until: now + 1000 }, now, 0).show, false);
  assert.equal(visibleReorder({ state: "ordered", until: now + 1000 }, now, 3).arrived, true);
  assert.equal(visibleReorder({ state: "ordered", until: now - 1 }, now, 0).due, true);
});

test("shouldStart: first run at once, then once a day after 09:00Z, or when kicked", () => {
  assert.equal(shouldStart({}, T0), true);
  assert.equal(shouldStart({ lastRunDay: TODAY }, T0), false);
  assert.equal(shouldStart({ lastRunDay: TODAY, kick: true }, T0), true);
  assert.equal(shouldStart({ lastRunDay: TODAY - 1 }, Date.UTC(2026, 9, 14, RUN_HOUR_UTC - 1)), false);
  assert.equal(shouldStart({ lastRunDay: TODAY - 1 }, Date.UTC(2026, 9, 14, RUN_HOUR_UTC)), true);
});

test("Shopify page shapes", () => {
  const o = parseOrdersPage({ orders: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [
    { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-10-01T10:00:00Z", lineItems: { nodes: [
      { quantity: 2, variant: { id: "gid://shopify/ProductVariant/11" }, product: { id: "gid://shopify/Product/1", title: "Box", productType: "Magic Sealed Product", vendor: "UD" } },
      { quantity: 1, variant: null, product: { id: "gid://shopify/Product/2", title: "Gone", productType: "x", vendor: "" } },
      { quantity: 1, variant: { id: "gid://shopify/ProductVariant/12" }, product: null } ] } } ] } });
  assert.equal(o.orders.length, 1); assert.equal(o.orders[0].lines.length, 1); assert.deepEqual(o.orders[0].lines[0], { vid: "11", pid: "1", qty: 2, type: "Magic Sealed Product", vendor: "UD", title: "Box" });
  assert.equal(o.newest, "2026-10-01T10:00:00Z"); assert.equal(o.cursor, "c1"); assert.equal(o.hasNext, true);
  const s = parseScanPage({ productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "gid://shopify/ProductVariant/11", title: "Default Title", sku: "824968", barcode: "824968", price: "99.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "Box", productType: "Magic Sealed Product", vendor: "UD", handle: "box", featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/x.jpg" } } } } }] } });
  assert.deepEqual(s.variants[0], { vid: "11", pid: "1", title: "Box", vtitle: "Default Title", sku: "824968", barcode: "824968", cents: 9995, qty: 3, type: "Magic Sealed Product", vendor: "UD", handle: "box", image: "https://cdn.shopify.com/x.jpg", status: "" });
  const l = parseLookup({ nodes: [{ id: "gid://shopify/ProductVariant/11", title: "Default Title", price: "99.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "Box", productType: "Magic Sealed Product", vendor: "UD", handle: "box", status: "ACTIVE" }, inventoryItem: { inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: 3 }, { name: "committed", quantity: 1 }, { name: "on_hand", quantity: 4 }] }] } } }, null] });
  assert.equal(l.length, 1); assert.deepEqual(l[0].q, { available: 3, committed: 1, on_hand: 4 }); assert.equal(l[0].status, "ACTIVE");
  const items = [{ vid: "11", sku: "824968" }, { vid: "12", sku: "1234" }];
  assert.match(openQuery(items), /o0:orders\(first:5,query:"sku:824968 fulfillment_status:unfulfilled status:open"\)/);
  assert.deepEqual(parseOpen(items, { o0: { nodes: [{ name: "#1002", createdAt: "2026-10-10T00:00:00Z", displayFulfillmentStatus: "UNFULFILLED", shippingLine: null }] }, o1: { nodes: [] } }), { 11: [{ name: "#1002", at: "2026-10-10T00:00:00Z", ship: "pickup" }] });
  assert.throws(() => parseOrdersPage({}), /orders shape/);
});

// A fake Shopify: two orders pages (a sealed box selling steadily, a single
// that must be ignored, a sold-out sleeve pack), two product types, one scan
// page, a lookup, an open-orders page.
function fakeShopify(clock) {
  const day = (d, h) => new Date((TODAY - d) * DAY_MS + (h || 10) * 3600e3).toISOString();
  const box = (d, n) => ({ id: "gid://shopify/Order/" + d, name: "#" + (2000 + d), createdAt: day(d), lineItems: { nodes: [
    { quantity: n, variant: { id: "gid://shopify/ProductVariant/11" }, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution" } },
    { quantity: 4, variant: { id: "gid://shopify/ProductVariant/99" }, product: { id: "gid://shopify/Product/9", title: "Lightning Bolt", productType: "MTG Single", vendor: "" } } ] } });
  const sleeves = (d, n) => ({ id: "gid://shopify/Order/" + (100 + d), name: "#" + (3000 + d), createdAt: day(d, 14), lineItems: { nodes: [
    { quantity: n, variant: { id: "gid://shopify/ProductVariant/22" }, product: { id: "gid://shopify/Product/2", title: "Dragon Shield Matte Black", productType: "Sleeves & Toploaders", vendor: "Arcane Tinmen" } } ] } });
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q: q.slice(0, 40), v });
    if (q === ORDERS_Q) {
      if (!v.after) return { data: { orders: { pageInfo: { hasNextPage: true, endCursor: "p2" }, nodes: [box(50, 1), box(45, 2), box(40, 1), box(35, 2), box(30, 1)] } }, cost: { actualQueryCost: 500, throttleStatus: { currentlyAvailable: 600, restoreRate: 100 } } };
      return { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [box(27, 1), box(24, 1), sleeves(70, 2), sleeves(50, 3), sleeves(35, 2), sleeves(20, 1)] } }, cost: { actualQueryCost: 500, throttleStatus: { currentlyAvailable: 1900, restoreRate: 100 } } };
    }
    if (q === TYPES_Q) return { data: { productTypes: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: "Magic Sealed Product" }, { node: "MTG Single" }, { node: "Sleeves & Toploaders" }] } }, cost: null };
    if (q === SCAN_Q) {
      if (/Magic Sealed/.test(v.q)) return { data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "gid://shopify/ProductVariant/11", title: "Default Title", sku: "195166", barcode: "195166", price: "159.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution", handle: "bloomburrow-box", featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/box.jpg" } } } } }] } }, cost: null };
      return { data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }, cost: null };
    }
    if (q === LOOKUP_Q) return { data: { nodes: v.ids.map((id) => id.endsWith("/11")
      ? { id, title: "Default Title", sku: "195166", barcode: "195166", price: "159.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution", handle: "bloomburrow-box", status: "ACTIVE", featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/box.jpg" } } } }, inventoryItem: { inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: 3 }, { name: "committed", quantity: 1 }, { name: "on_hand", quantity: 4 }, { name: "quality_control", quantity: 0 }] }] } } }
      : { id, title: "Default Title", sku: "DS-BLK", barcode: "", price: "12.99", inventoryQuantity: 0, product: { id: "gid://shopify/Product/2", title: "Dragon Shield Matte Black", productType: "Sleeves & Toploaders", vendor: "Arcane Tinmen", handle: "ds-black", status: "ACTIVE", featuredMedia: null }, inventoryItem: { inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: 0 }, { name: "committed", quantity: 0 }] }] } } }) }, cost: null };
    if (/^query\{o0:orders/.test(q)) return { data: { o0: { nodes: [{ name: "#2101", createdAt: day(2), displayFulfillmentStatus: "UNFULFILLED", shippingLine: null }] } }, cost: null };
    throw new Error("unexpected query " + q.slice(0, 60));
  };
  return { gql, calls };
}

test("a whole run: orders -> types -> scan -> compute -> lookup -> open -> finalize, then idle until tomorrow", async () => {
  const clock = { t: T0 };
  const c = cx(clock);
  const env = envWith(c);
  const fake = fakeShopify(clock);
  const slept = [];
  const r = await stockCheckTick(env, { gql: fake.gql, now: () => clock.t, sleep: async (ms) => { slept.push(ms); }, budgetMs: 1e9 });
  assert.equal(r.idle, true); assert.equal(r.phase, "done");
  assert.deepEqual(r.kinds, { orders: 2, types: 1, scan: 2, lookup: 1, open: 1 }, "two in-scope types scanned, the singles type skipped");
  assert.ok(slept.some((ms) => ms > 0), "paced on the throttle status after the first orders page");
  const v = await call(c, "/_sc/view");
  assert.equal(v.look.length, 1, "the box is in stock and went quiet");
  const b = v.look[0];
  assert.equal(b.vid, "11"); assert.equal(b.qty, 3); assert.equal(b.daysSince, 24); assert.equal(b.soldWindow, 9); assert.equal(b.window, 30);
  assert.deepEqual(b.q, { available: 3, committed: 1, on_hand: 4, quality_control: 0 });
  assert.deepEqual(b.open, [{ name: "#2101", at: b.open[0].at, ship: "pickup" }], "the committed unit's order number rides along");
  assert.equal(v.reorder.length, 1, "the sleeves sold steadily and are at 0");
  const sl = v.reorder[0];
  assert.equal(sl.vid, "22"); assert.equal(sl.daysOut, 20); assert.equal(sl.sold60, 8, "70, 50, 35 and 20 days ago all fall in the 60 days before the last sale"); assert.equal(sl.vendor, "Arcane Tinmen"); assert.equal(sl.missed, 2.7); assert.equal(sl.missedRevenue, 34.64);
  const ledger = await c.storage.get("sc:l:" + (TODAY - 50));
  assert.deepEqual(ledger, { 11: 1, 22: 3 }, "the box and the sleeves sold that day; the single on the box order is not in the ledger");
  assert.equal(await c.storage.get("sc:m:99"), undefined, "no meta for singles either");
  assert.equal(v.meta.counts.scanned, 1); assert.equal(v.meta.counts.orders, 11);
  assert.equal(v.status.lastRunDay, TODAY);
  assert.equal(v.status.ordersSince.slice(0, 10), new Date((TODAY - 20) * DAY_MS).toISOString().slice(0, 10), "next run starts from the newest order seen");
  // nothing more today
  const again = await stockCheckTick(env, { gql: async () => { throw new Error("must not be called"); }, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 });
  assert.equal(again.idle, true); assert.equal(again.phase, "idle");
  // tomorrow before 09:00Z: still idle; at 09:00Z a new run starts and asks for orders since the newest one seen
  clock.t = Date.UTC(2026, 9, 15, 8, 30);
  assert.equal((await stockCheckTick(env, { gql: fake.gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 })).phase, "idle");
  clock.t = Date.UTC(2026, 9, 15, 9, 5);
  const p = await call(c, "/_sc/plan", { now: clock.t });
  assert.equal(p.kind, "orders"); assert.ok(p.since > "2026-09-23", "incremental, not another 60-day backfill: " + p.since);
});

test("two overlapping ticks: the second is told busy and a stale ingest is refused", async () => {
  const clock = { t: T0 };
  const c = cx(clock);
  const p1 = await call(c, "/_sc/plan", { now: clock.t });
  assert.equal(p1.kind, "orders"); assert.ok(p1.token);
  const p2 = await call(c, "/_sc/plan", { now: clock.t + 1000 });
  assert.equal(p2.kind, "busy");
  const bad = await call(c, "/_sc/ingest", { token: "nope", kind: "orders", orders: [], hasNext: false });
  assert.equal(bad.ok, false);
  const ok = await call(c, "/_sc/ingest", { token: p1.token, kind: "orders", orders: [], hasNext: false });
  assert.equal(ok.ok, true); assert.equal(ok.phase, "types");
  // the lease expires on its own if a tick dies
  const run = await c.storage.get("sc:run");
  run.lease = "dead"; run.leaseAt = clock.t - 10 * 60e3; await c.storage.put("sc:run", run);
  assert.equal((await call(c, "/_sc/plan", { now: clock.t })).kind, "types");
});

test("errors: three in a row skip the unit; orders denied is remembered", async () => {
  const clock = { t: T0 };
  const c = cx(clock);
  const env = envWith(c);
  let n = 0;
  const fake = fakeShopify(clock);
  const gql = async (q, v) => { if (q === ORDERS_Q) { n++; throw new Error("admin errors: [{\"message\":\"Access denied for orders field. Required access: read_orders\"}]"); } return fake.gql(q, v); };
  const r = await stockCheckTick(env, { gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 });
  assert.equal(n, 3); assert.equal(r.idle, true);
  const h = await call(c, "/_sc/health");
  assert.equal(h.ordersDenied, true); assert.equal(h.counts.scanned, 1);
  const v = await call(c, "/_sc/view");
  assert.equal(v.look.length, 0, "no sales history: nothing can be flagged");
  assert.equal(v.status.ordersDenied, true);
  assert.match(renderStock(v, { user: { role: "admin" }, tab: "look", admin: true, act: true }), /cannot read orders/);
});

test("staff states: found hides for 14 days then is due; not found goes to Missing and closes itself when it sells; dismissals are permanent until restored", async () => {
  const clock = { t: T0 };
  const c = cx(clock);
  const env = envWith(c);
  const fake = fakeShopify(clock);
  await stockCheckTick(env, { gql: fake.gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 });
  const m1 = await call(c, "/_sc/mark", { vid: "11", state: "found_overstock", by: "sam@x.test", byName: "Sam", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", now: clock.t });
  assert.equal(m1.ok, true); assert.equal(m1.state.until, clock.t + SNOOZE_DAYS * DAY_MS);
  let v = await call(c, "/_sc/view");
  assert.equal(v.look.length, 0, "hidden while snoozed");
  clock.t += (SNOOZE_DAYS + 1) * DAY_MS;
  v = await call(c, "/_sc/view", { now: clock.t });
  assert.equal(v.look.length, 1); assert.equal(v.look[0].due, true); assert.equal(v.look[0].state.byName, "Sam");
  // fewer than listed needs a count; not found -> missing
  assert.equal((await call(c, "/_sc/mark", { vid: "11", state: "fewer", by: "sam@x.test" })).ok, false);
  const nf = await call(c, "/_sc/mark", { vid: "11", state: "not_found", by: "sam@x.test", byName: "Sam", now: clock.t });
  assert.equal(nf.ok, true);
  v = await call(c, "/_sc/view", { now: clock.t });
  assert.equal(v.look.length, 0); assert.equal(v.missing.length, 1); assert.equal(v.missing[0].title, "MTG BLOOMBURROW PLAY BOOSTER BOX");
  // the next run finds it sold again (an hour after the mark) -> closed as turned up
  const fake2 = fakeShopify(clock);
  const base = fake2.gql;
  const markedAt = clock.t;
  clock.t += 2 * 3600e3;
  fake2.gql = async (q, vv) => { if (q === ORDERS_Q) return { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "gid://shopify/Order/777", name: "#2777", createdAt: new Date(markedAt + 3600e3).toISOString(), lineItems: { nodes: [{ quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" }, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution" } }] } }] } }, cost: null }; return base(q, vv); };
  await call(c, "/_sc/kick");
  const r2 = await stockCheckTick(env, { gql: fake2.gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 });
  assert.equal(r2.phase, "done");
  v = await call(c, "/_sc/view", { now: clock.t });
  assert.equal(v.missing[0].closed.state, "turned_up");
  assert.equal(v.look.length, 0, "it just sold: no longer stalled");
  // reorder: ordered hides; cant_reorder is permanent; restore brings it back
  assert.equal(v.reorder.length, 1);
  await call(c, "/_sc/mark", { vid: "22", state: "ordered", by: "sam@x.test", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 0);
  clock.t += (SNOOZE_DAYS + 1) * DAY_MS;
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 1); assert.equal(v.reorder[0].due, true);
  await call(c, "/_sc/mark", { vid: "22", state: "cant_reorder", by: "boss@x.test", byName: "Boss", note: "LOTR collector boxes are gone", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 0); assert.equal(v.dismissed.length, 1); assert.equal(v.dismissed[0].note, "LOTR collector boxes are gone");
  clock.t += 400 * DAY_MS;
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 0, "still dismissed a year later");
  assert.equal((await call(c, "/_sc/mark", { vid: "11", state: "restore", by: "boss@x.test" })).ok, false, "only a dismissed item can be restored");
  await call(c, "/_sc/mark", { vid: "22", state: "restore", by: "boss@x.test", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 1); assert.equal(v.dismissed.length, 0);
  // snooze until a date
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "snooze", until: "2020-01-01", by: "s" })).ok, false);
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "snooze", until: new Date(clock.t + 5 * DAY_MS).toISOString().slice(0, 10), by: "s", now: clock.t })).ok, true);
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(v.reorder.length, 0);
  // note on anything
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "note", note: "rep says November", by: "s" })).ok, true);
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "bogus", by: "s" })).ok, false);
});

test("permissions and pages", async () => {
  assert.ok(ALL_PERMS.some((p) => p.key === "sc_view") && ALL_PERMS.some((p) => p.key === "sc_act"));
  assert.equal(SC_PERMS.length, 2);
  const viewer = { email: "v@x.test", role: "staff", perms: permsFrom({ perm_sc_view: "on" }) };
  const actor = { email: "a@x.test", name: "Ann", role: "staff", perms: permsFrom({ perms: ["sc_act"] }) };
  const other = { email: "o@x.test", role: "staff", perms: permsFrom({ perm_edit: "on" }) };
  const admin = { email: "boss@x.test", role: "admin", perms: {} };
  assert.equal(canView(viewer), true); assert.equal(canAct(viewer), false);
  assert.equal(canView(actor), true); assert.equal(canAct(actor), true);
  assert.equal(canView(other), false); assert.equal(canView(admin), true); assert.equal(canAct(admin), true);
  assert.equal(can(viewer, "sc_view"), true);

  const clock = { t: T0 };
  const c = cx(clock);
  const env = envWith(c);
  await stockCheckTick(env, { gql: fakeShopify(clock).gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9 });
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html" } });
  const redirect = (to) => new Response(null, { status: 303, headers: { location: to } });
  const q = (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; };
  const toLogin = () => redirect("/9pocket/login");
  const serve = (path, user, form, pinOk) => { const url = new URL("https://w.example" + path); const req = new Request(url, form ? { method: "POST" } : {}); return serveStockStaff(req, env, url, user, form, { html, redirect, q, toLogin, opts: { user }, pinOk: !!pinOk }); };
  // health is open (no secrets), the json needs a permitted session or the staff key
  assert.equal((await (await serve("/9pocket/stock/health")).json()).ok, true);
  assert.equal((await serve("/9pocket/stock.json", null)).status, 403);
  assert.equal((await serve("/9pocket/stock.json", other)).status, 403);
  assert.equal((await serve("/9pocket/stock.json", viewer)).status, 200);
  assert.equal((await serve("/9pocket/stock.json", null, null, true)).status, 200);
  // the page
  assert.equal((await serve("/9pocket/stock", null)).status, 303);
  assert.equal((await serve("/9pocket/stock", other)).status, 403);
  const page = await (await serve("/9pocket/stock", actor)).text();
  assert.match(page, /Stock check/); assert.match(page, /MTG BLOOMBURROW PLAY BOOSTER BOX/); assert.match(page, /Where to look/);
  assert.match(page, /1 unit in open online order: #2101 \(pickup\)/, "the committed unit's order is named");
  assert.match(page, /data-confirm="This marks MTG BLOOMBURROW PLAY BOOSTER BOX as missing/, "Not found asks first");
  assert.match(page, /data-places="1"/, "and lists the places to check");
  assert.match(page, /name="state" value="found_floor"/);
  assert.match(page, /<dialog id="scd">/);
  assert.doesNotMatch(page, /Scan now/, "staff cannot start a scan");
  const viewerPage = await (await serve("/9pocket/stock", viewer)).text();
  assert.match(viewerPage, /can look but not mark/); assert.doesNotMatch(viewerPage, /value="not_found"/);
  const reorderPage = await (await serve("/9pocket/stock?tab=reorder", admin)).text();
  assert.match(reorderPage, /Dragon Shield Matte Black/); assert.match(reorderPage, /Arcane Tinmen/); assert.match(reorderPage, /data-confirm="Dragon Shield Matte Black will never be listed for reorder again/); assert.match(reorderPage, /Scan now/);
  assert.match(reorderPage, /sales missed/);
  // actions: a viewer cannot mark; an actor can; closing is admin-only
  let r = await serve("/9pocket/stock/control", viewer, { action: "mark", state: "found_floor", vid: "11", json: "1" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /can look but not mark/);
  r = await serve("/9pocket/stock/control", actor, { action: "mark", state: "not_found", vid: "11", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", json: "1" });
  assert.equal(r.status, 200);
  r = await serve("/9pocket/stock/control", actor, { action: "mark", state: "adjusted", vid: "11", json: "1" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Only an admin/);
  const missingStaff = await (await serve("/9pocket/stock?tab=missing", actor)).text();
  assert.match(missingStaff, /Not found/); assert.match(missingStaff, /waiting for an admin/); assert.match(missingStaff, /Ann/);
  const missingAdmin = await (await serve("/9pocket/stock?tab=missing", admin)).text();
  assert.match(missingAdmin, /Adjusted in BinderPOS/);
  r = await serve("/9pocket/stock/control", admin, { action: "mark", state: "adjusted", vid: "11", json: "1" });
  assert.equal(r.status, 200);
  r = await serve("/9pocket/stock/control", actor, { action: "scan", json: "1" });
  assert.equal(r.status, 400);
  r = await serve("/9pocket/stock/control", admin, { action: "scan", json: "1" });
  assert.equal(r.status, 200); assert.equal((await (await serve("/9pocket/stock/health")).json()).kick, true);
  // a form post redirects back to the same tab with the message
  r = await serve("/9pocket/stock/control", actor, { action: "mark", state: "note", vid: "22", note: "rep says Nov", tab: "reorder" });
  assert.equal(r.status, 303); assert.match(r.headers.get("location"), /^\/9pocket\/stock\?tab=reorder&msg=/);
  assert.match(renderStockDenied({ user: other }), /cannot open the stock check/);
  assert.match(renderStock(null, { user: admin, tab: "look", err: "x" }), /No scan has finished yet/);
});
