import { test } from "node:test";
import assert from "node:assert/strict";
import { inScopeType, isPreorder, seriesOf, rateWindow, stalled, reorder, categoryDrop, visibleLook, visibleReorder, shouldStart, parseOrdersPage, parseScanPage, parseLookup, parseOpen, openQuery, doWork, stockCheckTick, stockDoFetch, serveStockStaff, canView, canAct, dayOf, STOCK_DO, RUN_HOUR_UTC, SNOOZE_DAYS, DAY_MS, ORDERS_Q, SCAN_Q, LOOKUP_Q, TYPES_Q, distributorUrl, parseDistributors, distributorsText, buildStockEmail, itemFacts, adminEmails, reorderLink, validLink, normUpc, udIndex, udPickLeaves, udWords, udGroupFor, resolveUniversal, UD_ITEM } from "../src/stock-check.js";
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
const STAGE_USERS = { ok: true, users: [{ email: "boss@x.test", name: "Boss", role: "admin" }, { email: "v@x.test", role: "staff" }, { email: "old@x.test", role: "admin", disabled: true }, { email: "two@x.test", role: "admin" }] };
function envWith(c, extra) {
  return { SHOPIFY_ADMIN_TOKEN: "t", ...(extra || {}), ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => {
    if (n === "buylist-stage") { assert.match(new URL(req.url).pathname, /^\/_stage\/users$/); return Response.json(STAGE_USERS); }
    assert.equal(n, STOCK_DO); return stockDoFetch(c, req, new URL(req.url)); } }) } };
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

test("distributor links: a template per vendor, {q} = the title, a web search otherwise", () => {
  assert.equal(distributorUrl("PLAMOD", "HG Gundam Aerial", null), "https://www.plamod.com/retailer/search?q=HG%20Gundam%20Aerial");
  assert.equal(distributorUrl("plamod", "x", {}), "https://www.plamod.com/retailer/search?q=x");
  assert.equal(distributorUrl("Arcane Tinmen", "Dragon Shield Matte Black", null), "https://www.google.com/search?q=Arcane%20Tinmen%20Dragon%20Shield%20Matte%20Black");
  assert.equal(distributorUrl("Universal Distribution", "MTG Box", null, "195166150611"), "https://ca.universaldist.com/search-list?keyword=195166150611", "Universal searches by barcode");
  assert.equal(distributorUrl("Universal Distribution", "MTG Box", null, ""), "https://ca.universaldist.com/search-list?keyword=MTG%20Box", "no barcode: the title");
  assert.equal(distributorUrl("Acme", "Thing", parseDistributors("Acme = https://acme.test/s?u={upc}&t={q}"), "0012345678"), "https://acme.test/s?u=0012345678&t=Thing");
  assert.equal(distributorUrl("", "Mystery Box", null), "https://www.google.com/search?q=Mystery%20Box");
  const map = parseDistributors("Universal Distribution = https://example.test/search?q={q}\n  Games Workshop=https://trade.example.test/find/{q}&x=1 \nbad line\nNo Scheme = http://insecure.test/{q}\n");
  assert.deepEqual(Object.keys(map), ["universal distribution", "games workshop"]);
  assert.equal(map["universal distribution"].name, "Universal Distribution");
  assert.equal(distributorUrl("Universal Distribution", "MTG Box & Co", map), "https://example.test/search?q=MTG%20Box%20%26%20Co");
  assert.equal(distributorUrl("GAMES WORKSHOP", "Paint", map), "https://trade.example.test/find/Paint&x=1");
  assert.equal(distributorsText(map), "Universal Distribution = https://example.test/search?q={q}\nGames Workshop = https://trade.example.test/find/{q}&x=1");
  // a saved per-product link beats the vendor's search
  const r = { pid: "1", vendor: "Universal Distribution", title: "MTG Box", sku: "195166", barcode: "195166150611" };
  assert.deepEqual(reorderLink(r, { distributors: map }), { url: "https://example.test/search?q=MTG%20Box", label: "Universal Distribution reorder page", saved: false }, "an admin's template wins over the built-in one");
  assert.deepEqual(reorderLink(r, {}), { url: "https://ca.universaldist.com/search-list?keyword=195166150611", label: "Universal Distribution reorder page", saved: false }, "built in: Universal's search by the barcode");
  assert.deepEqual(reorderLink(r, { distributors: map, links: { 1: { url: "https://ca.universaldist.com/item/detail/b6e53b18" } } }), { url: "https://ca.universaldist.com/item/detail/b6e53b18", label: "Universal Distribution item page", saved: true });
  assert.equal(validLink("https://ca.universaldist.com/item/detail/x"), true); assert.equal(validLink("http://x.test"), false); assert.equal(validLink("javascript:alert(1)"), false);
});

test("the email to the admins: every item with its facts, state, note and links", () => {
  const items = [
    { list: "look", row: { vid: "11", pid: "1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", vtitle: "Default Title", vendor: "Universal Distribution", type: "Magic Sealed Product", sku: "195166", handle: "bloomburrow-box", qty: 3, daysSince: 24, expected: 7.2, atRisk: 479.85, state: { state: "not_found", byName: "Sam", at: T0, note: "checked the back twice" } } },
    { list: "hot", row: { vid: "33", pid: "3", title: "POKEMON 151 BOOSTER BUNDLE", vendor: "PLAMOD", type: "Pokemon Sealed Product", handle: "pk-151", qty: -1, daysOut: 10, perWeek: 2.1, sold60: 9, missedRevenue: 164.85, state: null } },
  ];
  const m77 = { vid: "77", pid: "7", title: "Mystery <Thing>", vendor: "", cents: 1299, state: "fewer", count: 2, byName: "Ann", at: T0, note: "one left" };
  items.push({ list: "missing", row: { ...m77, state: m77 } });   // as the control builds it from a Missing line
  const m = buildStockEmail(items, { by: "sam@x.test", byName: "Sam", message: "Please order the Pokémon today.", distributors: parseDistributors("Universal Distribution = https://example.test/s?q={q}"), links: { 3: { url: "https://ca.universaldist.com/item/detail/abc" } } });
  assert.equal(m.subject, "Stock check: 3 items from Sam");
  assert.match(m.html, /Please order the Pokémon today\./);
  assert.match(m.html, /Go look · Magic Sealed Product/); assert.match(m.html, /Order now · Pokemon Sealed Product/); assert.match(m.html, /Missing/);
  assert.match(m.html, /href="https:\/\/admin\.shopify\.com\/store\/most-wanted-ca\/products\/1"/);
  assert.match(m.html, /href="https:\/\/exorgames\.com\/products\/bloomburrow-box"/);
  assert.match(m.html, /href="https:\/\/example\.test\/s\?q=MTG%20BLOOMBURROW%20PLAY%20BOOSTER%20BOX"/, "the vendor's own search address");
  assert.match(m.html, /href="https:\/\/ca\.universaldist\.com\/item\/detail\/abc"[^>]*>PLAMOD item page</, "a saved item link wins over the vendor's search");
  assert.match(m.html, /Marked: Not found by Sam/); assert.match(m.html, /Note: checked the back twice/);
  assert.match(m.html, /Marked: Found fewer than listed \(found 2\) by Ann/);
  assert.match(m.html, /3 on the system · last sold 24 days ago · should have sold ~7 since · \$479\.85 at risk/);
  assert.match(m.html, /out 10 days · sells ~2\.1 a week · 9 sold in the 60 days before · ~\$164\.85 missed so far/);
  assert.match(m.html, /Mystery &lt;Thing&gt;/, "escaped"); assert.doesNotMatch(m.html, /Mystery <Thing>/);
  assert.match(m.text, /Go look: MTG BLOOMBURROW PLAY BOOSTER BOX\n  Universal Distribution/);
  assert.match(m.text, /Marked: Not found - checked the back twice/);
  assert.deepEqual(itemFacts("missing", { cents: 1299 }), ["$12.99 each"]);
});

// A fake Universal Distribution site: two top-level categories, the MTG list
// holds the box's UPC (zero-padded, as their lists sometimes are).
function fakeUniversal() {
  const calls = [];
  const ud = { searchStatus: 0 };
  const fetchFn = async (u) => {
    calls.push(u);
    const path = new URL(u).pathname + new URL(u).search;
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/api/v1/en/itemcategories") return json([{ code: "2000", parentCode: null, description: "TRADING CARD GAMES" }, { code: "2010", parentCode: "2000", description: "MAGIC THE GATHERING" }, { code: "2020", parentCode: "2000", description: "POKEMON" }, { code: "2030", parentCode: "2000", description: "YU-GI-OH!" }, { code: "4000", parentCode: null, description: "BOARDGAMES" }, { code: "4010", parentCode: "4000", description: "ASMODEE" }, { code: "4020", parentCode: "4000", description: "HASBRO" }]);
    if (/^\/api\/v1\/en\/items\/search\?keyword=/.test(path)) {
      if (ud.searchStatus) return new Response("", { status: ud.searchStatus });
      const k = decodeURIComponent(path.split("keyword=")[1]);
      return json({ items: k === "195166150611" ? [{ guid: "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a", sku: "195166150611", productName: "MTG THE BROTHERS WAR PRERELEASE PACK (16/1)", categoryCode: "2010" }] : k === "820650859991" ? [{ guid: "pk-151", sku: "820650859991", productName: "POKEMON 151 BOOSTER BUNDLE" }] : [] });
    }
    if (path === "/api/v1/en/items?category=2000") return json({ items: [] });   // a parent answers nothing
    if (path === "/api/v1/en/items?category=2010") return json({ items: [{ guid: "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a", sku: "00195166150611", productName: "MTG BLOOMBURROW PLAY BOOSTER BOX", categoryCode: "2010" }, { guid: "other", sku: "111", productName: "x" }] });
    if (path === "/api/v1/en/items?category=2020") return json({ items: [{ guid: "pk-151", sku: "820650859991", productName: "POKEMON 151 BOOSTER BUNDLE", categoryCode: "2020" }] });
    if (/\/api\/v1\/en\/items\?category=(2030|4010|4020)$/.test(path)) return json({ items: [] });
    return new Response("nope", { status: 404 });
  };
  ud.fetchFn = fetchFn; ud.calls = calls;
  return ud;
}

test("Universal: UPCs match on their digits; the leaves to read come from the product's type and title", async () => {
  assert.equal(normUpc("00195166150611"), "195166150611"); assert.equal(normUpc("195166-150611"), "195166150611"); assert.equal(normUpc(""), "");
  const idx = udIndex([{ guid: "g1", sku: "0012345", productName: "A" }, { guid: "g2", sku: "", productName: "no sku" }, { guid: "g3", sku: "12345", productName: "dup" }]);
  assert.deepEqual(Object.keys(idx), ["12345"]); assert.equal(idx["12345"].guid, "g1", "first wins");
  assert.deepEqual(udWords("Magic: The Gathering Singles & Sealed Product"), ["MAGIC", "GATHERING"]);
  assert.equal(udGroupFor("Pokemon Sealed Product"), "2000"); assert.equal(udGroupFor("Board Games"), "4000"); assert.equal(udGroupFor("Paint"), "6300"); assert.equal(udGroupFor("Sleeves & Toploaders"), "9000"); assert.equal(udGroupFor("Games Workshop"), "3000"); assert.equal(udGroupFor("Gunpla"), "6500"); assert.equal(udGroupFor("Beverages"), "");
  const cats = [{ code: "2000", parentCode: null, description: "TRADING CARD GAMES" }, { code: "2010", parentCode: "2000", description: "MAGIC THE GATHERING" }, { code: "2020", parentCode: "2000", description: "POKEMON" }, { code: "4000", parentCode: null, description: "BOARDGAMES" }, { code: "4010", parentCode: "4000", description: "ASMODEE" }, { code: "4020", parentCode: "4000", description: "HASBRO" }];
  assert.deepEqual(udPickLeaves([{ type: "Magic Sealed Product", title: "MTG BLOOMBURROW PLAY BOOSTER BOX" }], cats), ["2010"], "a word of the type names the leaf");
  assert.deepEqual(udPickLeaves([{ type: "Board Games", title: "CATAN" }], cats), ["4010", "4020"], "no word matches: every leaf of the group");
  assert.deepEqual(udPickLeaves([{ type: "Pokemon Sealed Product", title: "x" }, { type: "Pokemon Sealed Product", title: "y" }, { type: "Magic Sealed Product", title: "z" }], cats), ["2020", "2010"], "most wanted first");
  assert.deepEqual(udPickLeaves([{ type: "Beverages", title: "Cola" }], cats), []);
  const ud = fakeUniversal();
  const r = await resolveUniversal([{ pid: "1", sku: "195166", barcode: "195166150611", type: "Magic Sealed Product", title: "MTG BLOOMBURROW PLAY BOOSTER BOX" }, { pid: "9", sku: "99999999", type: "Board Games", title: "Catan" }], ud.fetchFn);
  assert.deepEqual(r.links, { 1: UD_ITEM + "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a" });
  assert.equal(r.stats.wanted, 2); assert.equal(r.stats.searched, 2); assert.equal(r.stats.matched, 1, "found by the search");
  assert.equal(r.stats.lists, 0, "the search is the word: a miss there is a miss, no lists are read");
  assert.ok(!ud.calls.some((u) => /category=/.test(u)), "no category list read while the search answers");
  ud.calls.length = 0;
  const r2 = await resolveUniversal([{ pid: "1", sku: "195166150611", type: "Magic Sealed Product", title: "x" }], ud.fetchFn);
  assert.equal(r2.stats.searched, 1); assert.equal(r2.stats.lists, 0, "nothing left for the lists");
  // the search answering an error: everything goes through the lists
  ud.searchStatus = 401;
  const r3 = await resolveUniversal([{ pid: "1", sku: "195166150611", type: "Magic Sealed Product", title: "x" }], ud.fetchFn);
  assert.deepEqual(r3.links, { 1: UD_ITEM + "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a" }); assert.equal(r3.stats.searched, 0); assert.equal(r3.stats.lists, 1); assert.match(r3.stats.errors[0], /UD HTTP 401/);
  ud.searchStatus = 0;
  assert.deepEqual((await resolveUniversal([], ud.fetchFn)).stats.wanted, 0);
  assert.deepEqual((await resolveUniversal([{ pid: "1", sku: "195166", type: "Magic Sealed Product" }], ud.fetchFn)).stats.wanted, 0, "a 6-digit house code is not a UPC");
  const dead = await resolveUniversal([{ pid: "1", sku: "12345678", type: "Magic Sealed Product" }], async () => new Response("", { status: 503 }));
  assert.deepEqual(dead.links, {}); assert.match(dead.stats.errors[0], /UD HTTP 503/);
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
  const bundle = (d, n) => ({ id: "gid://shopify/Order/" + (200 + d), name: "#" + (4000 + d), createdAt: day(d, 16), lineItems: { nodes: [
    { quantity: n, variant: { id: "gid://shopify/ProductVariant/33" }, product: { id: "gid://shopify/Product/3", title: "POKEMON 151 BOOSTER BUNDLE", productType: "Pokemon Sealed Product", vendor: "Universal Distribution" } } ] } });
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q: q.slice(0, 40), v });
    if (q === ORDERS_Q) {
      if (!v.after) return { data: { orders: { pageInfo: { hasNextPage: true, endCursor: "p2" }, nodes: [box(50, 1), box(45, 2), box(40, 1), box(35, 2), box(30, 1)] } }, cost: { actualQueryCost: 500, throttleStatus: { currentlyAvailable: 600, restoreRate: 100 } } };
      return { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [box(27, 1), box(24, 1), sleeves(70, 2), sleeves(50, 3), sleeves(35, 2), sleeves(20, 1), bundle(38, 2), bundle(30, 3), bundle(18, 2), bundle(10, 2)] } }, cost: { actualQueryCost: 500, throttleStatus: { currentlyAvailable: 1900, restoreRate: 100 } } };
    }
    if (q === TYPES_Q) return { data: { productTypes: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: "Magic Sealed Product" }, { node: "MTG Single" }, { node: "Sleeves & Toploaders" }, { node: "Pokemon Sealed Product" }] } }, cost: null };
    if (q === SCAN_Q) {
      if (/Magic Sealed/.test(v.q)) return { data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "gid://shopify/ProductVariant/11", title: "Default Title", sku: "195166", barcode: "195166150611", price: "159.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution", handle: "bloomburrow-box", featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/box.jpg" } } } } }] } }, cost: null };
      return { data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }, cost: null };
    }
    if (q === LOOKUP_Q) return { data: { nodes: v.ids.map((id) => id.endsWith("/33")
      ? { id, title: "Default Title", sku: "PK151B", barcode: "", price: "54.95", inventoryQuantity: -1, product: { id: "gid://shopify/Product/3", title: "POKEMON 151 BOOSTER BUNDLE", productType: "Pokemon Sealed Product", vendor: "Universal Distribution", handle: "pk-151-bundle", status: "ACTIVE", featuredMedia: null }, inventoryItem: { inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: -1 }, { name: "committed", quantity: 0 }] }] } } }
      : id.endsWith("/11")
      ? { id, title: "Default Title", sku: "195166", barcode: "195166150611", price: "159.95", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", productType: "Magic Sealed Product", vendor: "Universal Distribution", handle: "bloomburrow-box", status: "ACTIVE", featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/box.jpg" } } } }, inventoryItem: { inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: 3 }, { name: "committed", quantity: 1 }, { name: "on_hand", quantity: 4 }, { name: "quality_control", quantity: 0 }] }] } } }
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
  const ud = fakeUniversal();
  const r = await stockCheckTick(env, { gql: fake.gql, now: () => clock.t, sleep: async (ms) => { slept.push(ms); }, budgetMs: 1e9, udFetch: ud.fetchFn });
  assert.equal(r.idle, true); assert.equal(r.phase, "done");
  assert.deepEqual(r.kinds, { orders: 2, types: 1, scan: 3, lookup: 1, open: 1, links: 1 }, "three in-scope types scanned, the singles type skipped, one Universal lookup");
  assert.equal((await c.storage.get("sc:dl:1")).url, UD_ITEM + "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a", "the box's Universal page was found by UPC");
  assert.equal((await c.storage.get("sc:dl:1")).auto, true);
  assert.equal(await c.storage.get("sc:dl:3"), undefined, "the bundle is Universal too but has no UPC in the lists");
  assert.ok(slept.some((ms) => ms > 0), "paced on the throttle status after the first orders page");
  const v = await call(c, "/_sc/view");
  assert.equal(v.links["1"].url, UD_ITEM + "b6e53b18-92d9-4bc2-b55d-fb5d56cd782a");
  assert.equal(v.meta.links.matched, 1);
  assert.equal(v.look.length, 1, "the box is in stock and went quiet");
  const b = v.look[0];
  assert.equal(b.vid, "11"); assert.equal(b.qty, 3); assert.equal(b.daysSince, 24); assert.equal(b.soldWindow, 9); assert.equal(b.window, 30);
  assert.deepEqual(b.q, { available: 3, committed: 1, on_hand: 4, quality_control: 0 });
  assert.deepEqual(b.open, [{ name: "#2101", at: b.open[0].at, ship: "pickup" }], "the committed unit's order number rides along");
  assert.equal(v.reorder.length, 2, "the sleeves and the bundle sold steadily and are at 0 or less");
  const sl = v.reorder.find((x) => x.vid === "22");
  // Order now: the bundle sold 9 in its last 30 days (fast); the sleeves only 3
  assert.deepEqual(v.hot.map((x) => x.vid), ["33"]);
  assert.equal(v.hot[0].sold30, 9); assert.equal(v.hot[0].perWeek, 2.1); assert.equal(v.hot[0].qty, -1, "below zero counts as out");
  assert.equal(v.status.hotMin, 6);
  assert.equal((await call(c, "/_sc/cfg", { hotMin: "0" })).ok, false);
  assert.equal((await call(c, "/_sc/cfg", { hotMin: "3" })).hotMin, 3);
  const v3 = await call(c, "/_sc/view");
  assert.deepEqual(v3.hot.map((x) => x.vid), ["33", "22"], "a lower threshold applies at once, fastest first");
  await call(c, "/_sc/cfg", { hotMin: 6 });
  assert.equal(sl.vid, "22"); assert.equal(sl.daysOut, 20); assert.equal(sl.sold60, 8, "70, 50, 35 and 20 days ago all fall in the 60 days before the last sale"); assert.equal(sl.vendor, "Arcane Tinmen"); assert.equal(sl.missed, 2.7); assert.equal(sl.missedRevenue, 34.64);
  const ledger = await c.storage.get("sc:l:" + (TODAY - 50));
  assert.deepEqual(ledger, { 11: 1, 22: 3 }, "the box and the sleeves sold that day; the single on the box order is not in the ledger");
  assert.equal(await c.storage.get("sc:m:99"), undefined, "no meta for singles either");
  assert.equal(v.meta.counts.scanned, 1); assert.equal(v.meta.counts.orders, 15); assert.equal(v.meta.counts.hot, 1);
  assert.equal(v.status.lastRunDay, TODAY);
  assert.equal(v.status.ordersSince.slice(0, 10), new Date((TODAY - 10) * DAY_MS).toISOString().slice(0, 10), "next run starts from the newest order seen");
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
  // reorder: ordered hides (from Order now too); cant_reorder is permanent; restore brings it back
  const re = (vv) => vv.reorder.filter((x) => x.vid === "22").length, hotN = (vv) => vv.hot.length;
  assert.equal(re(v), 1); assert.equal(hotN(v), 1);
  await call(c, "/_sc/mark", { vid: "22", state: "ordered", by: "sam@x.test", now: clock.t });
  await call(c, "/_sc/mark", { vid: "33", state: "ordered", by: "sam@x.test", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 0); assert.equal(hotN(v), 0, "ordered hides it from Order now as well");
  clock.t += (SNOOZE_DAYS + 1) * DAY_MS;
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 1); assert.equal(v.reorder.find((x) => x.vid === "22").due, true); assert.equal(hotN(v), 1);
  await call(c, "/_sc/mark", { vid: "22", state: "cant_reorder", by: "boss@x.test", byName: "Boss", note: "LOTR collector boxes are gone", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 0); assert.equal(v.dismissed.length, 1); assert.equal(v.dismissed[0].note, "LOTR collector boxes are gone");
  clock.t += 400 * DAY_MS;
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 0, "still dismissed a year later");
  assert.equal((await call(c, "/_sc/mark", { vid: "11", state: "restore", by: "boss@x.test" })).ok, false, "only a dismissed item can be restored");
  await call(c, "/_sc/mark", { vid: "22", state: "restore", by: "boss@x.test", now: clock.t });
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 1); assert.equal(v.dismissed.length, 0);
  // snooze until a date
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "snooze", until: "2020-01-01", by: "s" })).ok, false);
  assert.equal((await call(c, "/_sc/mark", { vid: "22", state: "snooze", until: new Date(clock.t + 5 * DAY_MS).toISOString().slice(0, 10), by: "s", now: clock.t })).ok, true);
  v = await call(c, "/_sc/view", { now: clock.t }); assert.equal(re(v), 0);
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
  // no Universal lookups here: the links phase must not reach the real site (the CI runner has
  // internet, and the real UPC resolved to the real page, which changed what the card showed)
  await stockCheckTick(env, { gql: fakeShopify(clock).gql, now: () => clock.t, sleep: async () => {}, budgetMs: 1e9, udFetch: async () => new Response("{}", { status: 404 }) });
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
  // the staff key (the runners) or an admin may queue a scan through the json
  assert.equal((await serve("/9pocket/stock.json?kick=1", viewer)).status, 403);
  const kicked = await (await serve("/9pocket/stock.json?kick=1", null, null, true)).json();
  assert.equal(kicked.kicked, true); assert.equal(kicked.health.kick, true);
  assert.equal((await (await serve("/9pocket/stock.json?kick=1", admin)).json()).kicked, true);
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
  const hotPage = await (await serve("/9pocket/stock?tab=hot", admin)).text();
  assert.match(hotPage, /Order now<b>1<\/b>/); assert.match(hotPage, /POKEMON 151 BOOSTER BUNDLE/); assert.doesNotMatch(hotPage, /Dragon Shield/); assert.match(hotPage, /sells ~2\.1 a week/); assert.match(hotPage, /name="hotMin"/);
  const hotStaff = await (await serve("/9pocket/stock?tab=hot", actor)).text();
  assert.doesNotMatch(hotStaff, /name="hotMin"/); assert.match(hotStaff, /sold at least 6/);
  let rc = await serve("/9pocket/stock/control", actor, { action: "cfg", hotMin: "3", json: "1" });
  assert.equal(rc.status, 400);
  rc = await serve("/9pocket/stock/control", admin, { action: "cfg", hotMin: "3", json: "1" });
  assert.equal(rc.status, 200); assert.match((await rc.json()).message, /3 or more/);
  assert.match(await (await serve("/9pocket/stock?tab=hot", admin)).text(), /Order now<b>2<\/b>/);
  await serve("/9pocket/stock/control", admin, { action: "cfg", hotMin: "6", json: "1" });
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
  // the title opens Shopify admin; the vendor link opens its reorder page
  assert.match(page, /<b><a href="https:\/\/admin\.shopify\.com\/store\/most-wanted-ca\/products\/1" target="_blank" rel="noopener" title="Open in Shopify">MTG BLOOMBURROW PLAY BOOSTER BOX<\/a><\/b>/);
  assert.match(page, /href="https:\/\/ca\.universaldist\.com\/search-list\?keyword=195166150611" target="_blank" rel="noopener">Universal Distribution reorder page ↗/, "Universal: their search by the barcode");
  assert.doesNotMatch(page, /class="pick"/, "no email boxes while the worker has no email key");
  assert.doesNotMatch(await (await serve("/9pocket/stock", actor)).text(), /Distributor websites/, "settings are the admins'");
  // admin sets the vendor's search address: the links change at once
  rc = await serve("/9pocket/stock/control", admin, { action: "cfg", distributors: "Universal Distribution = https://ud.example.test/search?text={q}", json: "1" });
  assert.equal(rc.status, 200); assert.match((await rc.json()).message, /1 vendor/);
  const adminPage = await (await serve("/9pocket/stock", admin)).text();
  assert.match(adminPage, /href="https:\/\/ud\.example\.test\/search\?text=MTG%20BLOOMBURROW%20PLAY%20BOOSTER%20BOX"/);
  assert.match(adminPage, /Distributor websites \(admins\)/); assert.match(adminPage, /Universal Distribution = https:\/\/ud\.example\.test\/search\?text=\{q\}<\/textarea>/);
  assert.match(adminPage, /Built in: PLAMOD = https:\/\/www\.plamod\.com/);
  assert.equal((await serve("/9pocket/stock/control", actor, { action: "cfg", distributors: "x = https://x.test/{q}", json: "1" })).status, 400);
  // a saved link per product: pasted once on the card, remembered
  assert.match(page, /class="setlink" data-pid="1">set link</); assert.match(page, /name="action" value="link"/);
  assert.doesNotMatch(await (await serve("/9pocket/stock", viewer)).text(), /class="setlink"/, "a viewer gets no set-link control");
  assert.equal((await serve("/9pocket/stock/control", viewer, { action: "link", pid: "1", url: "https://ca.universaldist.com/item/detail/b6e", json: "1" })).status, 400);
  assert.equal((await serve("/9pocket/stock/control", actor, { action: "link", pid: "1", url: "ftp://nope", json: "1" })).status, 400);
  rc = await serve("/9pocket/stock/control", actor, { action: "link", pid: "1", url: "https://ca.universaldist.com/item/detail/b6e53b18", title: "MTG BLOOMBURROW PLAY BOOSTER BOX", json: "1" });
  assert.equal(rc.status, 200); assert.match((await rc.json()).message, /Reorder link saved for MTG BLOOMBURROW/);
  const linked = await (await serve("/9pocket/stock", actor)).text();
  assert.match(linked, /href="https:\/\/ca\.universaldist\.com\/item\/detail\/b6e53b18" target="_blank" rel="noopener" class="saved" title="saved link">Universal Distribution item page ↗/);
  assert.match(linked, /class="setlink" data-pid="1">change link</);
  assert.equal((await serve("/9pocket/stock/control", actor, { action: "link", pid: "1", url: "", json: "1" })).status, 200, "an empty address clears it");
  assert.match(await (await serve("/9pocket/stock", actor)).text(), /Universal Distribution reorder page ↗/);
  // live keyword filter, chips and the floating Top button, on every tab
  assert.match(page, /<input type="search" id="scq" name="q"/); assert.match(page, /class="kw" data-kw="booster"/); assert.match(page, /class="kw" data-kw="blind"/);
  assert.match(page, /<div class="sc-card" data-hay="mtg bloomburrow play booster box default title 195166 195166150611 universal distribution magic sealed product">/);
  assert.match(page, /<button type="button" id="sctop"/);
  // card actions post in place (no reload): the script sends json=1 and retires the card; a full reload keeps the scroll position
  assert.match(page, /fd\.set\('json','1'\)/); assert.match(page, /function retire\(card,msg\)/); assert.match(page, /sessionStorage\.setItem\('scY'/); assert.match(page, /<div id="sctoast" role="status"><\/div>/);
  // owner, 2026-10-15: snooze showed "not found" - the form's `action` property is shadowed by the hidden
  // <input name="action">, so the URL must come from the attribute; the set-link form stays hidden until tapped
  assert.match(page, /fetch\(f\.getAttribute\('action'\)\|\|location\.pathname,/); assert.doesNotMatch(page, /fetch\(f\.action,/);
  assert.match(page, /\.sc-link\[hidden\]\{display:none\}/); assert.match(page, /class="sc-link" hidden><input type="hidden" name="action" value="link"><input type="hidden" name="tab"/); assert.match(page, /var acts=f\.querySelectorAll\('input\[name=action\]'\)/);
  assert.match(missingAdmin, /id="scq"/); assert.match(missingAdmin, /<tr data-hay="mtg bloomburrow play booster box/);
  assert.match(renderStockDenied({ user: other }), /cannot open the stock check/);
  assert.match(renderStock(null, { user: admin, tab: "look", err: "x" }), /No scan has finished yet/);
  // email: needs the key; then the boxes and the bar appear
  assert.equal((await serve("/9pocket/stock/control", actor, { action: "email", vids: "11,22", json: "1" })).status, 400);
  const sent = [];
  const fetchFn = async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
  const env2 = { ...env, RESEND_API_KEY: "re_test", EMAIL_FROM: "9Pocket <9pocket@exorgames.com>" };
  const serve2 = (path, user, form) => { const url = new URL("https://w.example" + path); const req = new Request(url, form ? { method: "POST" } : {}); return serveStockStaff(req, env2, url, user, form, { html, redirect, q, toLogin, opts: { user }, pinOk: false, fetchFn }); };
  const page2 = await (await serve2("/9pocket/stock", actor)).text();
  assert.match(page2, /<input type="checkbox" class="pick" value="11">/); assert.match(page2, /id="scbar"/); assert.match(page2, /Email to admins/);
  assert.doesNotMatch(await (await serve2("/9pocket/stock", viewer)).text(), /class="pick"/, "a viewer cannot email");
  assert.equal((await serve2("/9pocket/stock/control", viewer, { action: "email", vids: "11", json: "1" })).status, 400);
  assert.equal((await serve2("/9pocket/stock/control", actor, { action: "email", vids: "", json: "1" })).status, 400);
  await serve2("/9pocket/stock/control", actor, { action: "mark", state: "note", vid: "22", note: "rep says November", json: "1" });
  rc = await serve2("/9pocket/stock/control", actor, { action: "email", vids: "22,11,999,11", message: "Two for today", json: "1" });
  const rcText = await rc.text();
  assert.equal(rc.status, 200, rcText);
  assert.match(JSON.parse(rcText).message, /^Emailed 2 items to boss@x\.test, two@x\.test\.$/, "the enabled admin accounts only, each item once");
  assert.equal(sent.length, 1); assert.equal(sent[0].u, "https://api.resend.com/emails");
  assert.deepEqual(sent[0].body.to, ["boss@x.test", "two@x.test"]); assert.equal(sent[0].body.reply_to, "a@x.test");
  assert.equal(sent[0].body.subject, "Stock check: 2 items from Ann");
  assert.match(sent[0].body.html, /Two for today/); assert.match(sent[0].body.html, /Dragon Shield Matte Black/); assert.match(sent[0].body.html, /Note: rep says November/); assert.match(sent[0].body.html, /MTG BLOOMBURROW PLAY BOOSTER BOX/);
  assert.match(sent[0].body.html, /Marked: Not found by Ann, [^·<]+ · closed: Adjusted in BinderPOS/, "the box's last state and how it was closed ride along");
  const v2 = await call(c, "/_sc/view");
  const st22 = v2.reorder.find((x) => x.vid === "22").state;
  assert.equal(st22.hist[st22.hist.length - 1].state, "emailed"); assert.match(st22.hist[st22.hist.length - 1].note, /boss@x\.test/);
  // a failing send is reported, nothing recorded
  const env3 = { ...env2 };
  const serve3 = (path, user, form) => { const url = new URL("https://w.example" + path); return serveStockStaff(new Request(url, { method: "POST" }), env3, url, user, form, { html, redirect, q, toLogin, opts: { user }, pinOk: false, fetchFn: async () => new Response(JSON.stringify({ message: "nope" }), { status: 500 }) }); };
  rc = await serve3("/9pocket/stock/control", actor, { action: "email", vids: "11", json: "1" });
  assert.equal(rc.status, 400); assert.match((await rc.json()).error, /email failed: HTTP 500 nope/);
  assert.deepEqual(await adminEmails(env, "https://w.example"), ["boss@x.test", "two@x.test"]);
});
