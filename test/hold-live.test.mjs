import { test } from "node:test";
import assert from "node:assert/strict";
import { planHold, variantMatches, productTitle, arrivalFromCart, arrivalFromBuylist, pollLive, liveOnRise, liveStatus, liveHealth, settingsOf, RETRY_FOR_MS } from "../src/hold-live.js";
import { holdDoFetch, holdDoAlarm } from "../src/hold.js";

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, JSON.parse(JSON.stringify(b))); return; } this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async deleteAll() { this.m.clear(); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) { if (o && o.prefix && !k.startsWith(o.prefix)) continue; if (o && o.start && k < o.start) continue; if (o && o.end && k >= o.end) continue; out.set(k, this.m.get(k)); if (o && o.limit && out.size >= o.limit) break; } return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const T0 = 1_760_000_000_000;
const ITEM = (n) => "gid://shopify/InventoryItem/" + n, LOC = "gid://shopify/Location/9", VAR = (n) => "gid://shopify/ProductVariant/" + n;

// A pretend shop: variants, their stock by state, and every move made.
function shop() {
  const inv = { [ITEM(1)]: { available: 3, quality_control: 0, damaged: 0 }, [ITEM(2)]: { available: 0, quality_control: 0, damaged: 0 }, [ITEM(3)]: { available: 1, quality_control: 0, damaged: 0 } };
  const variants = {
    111: { id: VAR(111), title: "Near Mint", sku: "MTG-BOLT-NM", item: ITEM(1), product: { id: "gid://shopify/Product/1", title: "Lightning Bolt [Fourth Edition]", productType: "MTG Single", handle: "bolt" } },
    222: { id: VAR(222), title: "Near Mint Foil", sku: "OP-ZORO-F", item: ITEM(2), product: { id: "gid://shopify/Product/2", title: "Roronoa Zoro (OP12-020) [Legacy of the Master]", productType: "One Piece Single", handle: "zoro" } },
    333: { id: VAR(333), title: "Near Mint", sku: "MTG-SOL-NM", item: ITEM(3), product: { id: "gid://shopify/Product/3", title: "Sol Ring [Commander Legends]", productType: "MTG Single", handle: "sol" } },
    334: { id: VAR(334), title: "Near Mint Foil", sku: "MTG-SOL-NMF", item: ITEM(3), product: { id: "gid://shopify/Product/3", title: "Sol Ring [Commander Legends]", productType: "MTG Single", handle: "sol" } },
  };
  const moves = [];
  const level = (item) => ({ location: { id: LOC }, quantities: Object.entries(inv[item]).map(([name, quantity]) => ({ name, quantity })) });
  const vnode = (v) => ({ id: v.id, title: v.title, sku: v.sku, product: v.product, inventoryItem: { id: v.item, inventoryLevels: { nodes: [level(v.item)] } } });
  const adminGql = async (q, vars) => {
    if (q.includes("productVariant(id")) { const v = variants[vars.id.replace(/\D/g, "")]; return { productVariant: v ? vnode(v) : null }; }
    if (q.includes("products(first:3")) {
      const want = (vars.q.match(/title:"(.*)"/) || [])[1];
      const ps = {};
      for (const v of Object.values(variants)) if (v.product.title === want) (ps[v.product.id] = ps[v.product.id] || { ...v.product, variants: { nodes: [] } }).variants.nodes.push(vnode(v));
      return { products: { nodes: Object.values(ps) } };
    }
    if (q.includes("inventoryLevel(locationId")) return { inventoryItem: { inventoryLevel: level(vars.id) } };
    if (q.includes("inventoryMoveQuantities")) {
      const ch = vars.input.changes[0];
      const st = inv[ch.inventoryItemId];
      moves.push({ item: ch.inventoryItemId, n: ch.quantity, from: ch.from.name, to: ch.to.name, reason: vars.input.reason, ref: vars.input.referenceDocumentUri, ledger: ch.to.ledgerDocumentUri || ch.from.ledgerDocumentUri });
      if (!st || st[ch.from.name] < ch.quantity) return { inventoryMoveQuantities: { userErrors: [{ message: "not enough in " + ch.from.name }] } };
      st[ch.from.name] -= ch.quantity; st[ch.to.name] = (st[ch.to.name] || 0) + ch.quantity;
      return { inventoryMoveQuantities: { userErrors: [], inventoryAdjustmentGroup: { createdAt: "x", reason: vars.input.reason } } };
    }
    if (q.includes("webhookSubscriptions")) return { webhookSubscriptions: { edges: [] } };
    return null;
  };
  return { inv, moves, adminGql };
}
const CART = (id, submitted, lines) => ({ id, submitted, staff: "jordan@exorgames.com", till: "Truro", customer: null, portalUrl: "https://portal.binderpos.com/#/pointOfSale/carts/" + id, payout: { cash: 186, credit: 0, total: 186 }, lines });
const L = (o) => ({ id: "l", title: "", condition: "Near Mint", variantId: "", qty: 1, buying: true, paid: 1, image: "https://images.binderpos.com/x.jpg", ...o });

function cx(now, sh, portal) {
  return { storage: new MemStorage(), env: { SHOPIFY_ADMIN_TOKEN: "t" }, adminGql: sh.adminGql, portal, now: () => now.t, log: () => {}, mem: {} };
}
async function call(c, path, body) {
  const url = new URL("https://w.example" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await holdDoFetch(c, req, url);
  return { status: r.status, body: await r.json() };
}

test("pure helpers: how much to hold, which variant fits, what an arrival looks like", () => {
  assert.deepEqual(planHold(2, 3), { now: 2, remaining: 0 });
  assert.deepEqual(planHold(2, 1), { now: 1, remaining: 1 });
  assert.deepEqual(planHold(2, 0), { now: 0, remaining: 2 });
  assert.deepEqual(planHold(-1, 5), { now: 0, remaining: 0 });
  assert.equal(productTitle("Sol Ring", "Commander Legends"), "Sol Ring [Commander Legends]");
  assert.equal(variantMatches("Near Mint Foil", "Near Mint", "Foil"), true);
  assert.equal(variantMatches("Near Mint", "Near Mint", "Foil"), false);
  assert.equal(variantMatches("Near Mint", "Near Mint", "Non-foil"), true);
  assert.equal(variantMatches("Lightly Played", "Near Mint", ""), false);
  const a = arrivalFromCart(CART("5", "2026-09-22T15:00:00.000Z", [L({ title: "A", variantId: "111", qty: 2 }), L({ title: "sold", buying: false, qty: 1 }), L({ title: "B", condition: "Near Mint Foil", variantId: "222" })]));
  assert.equal(a.key, "cart:5"); assert.equal(a.kind, "cart"); assert.equal(a.lines.length, 2); assert.equal(a.lines[1].finish, "Foil"); assert.equal(a.paid.cash, 186);
  const b = arrivalFromBuylist({ id: "916122", completed: "2026-09-22T16:00:00.000Z", paymentType: "Store Credit", customer: { name: "Ada" } }, { lines: [{ name: "Lightning Bolt", set: "Fourth Edition", condition: "Near Mint", finish: "Non-foil", qty: 2, cash: 1, credit: 3.68 }], paymentType: "Store Credit", customer: "Ada Lovelace" });
  assert.equal(b.key, "buylist:916122"); assert.equal(b.lines[0].title, "Lightning Bolt [Fourth Edition]"); assert.equal(b.paid.credit, 7.36); assert.equal(b.paid.type, "Store Credit"); assert.equal(b.customer, "Ada Lovelace");
});

test("off by default: a poll moves nothing and records nothing", async () => {
  const now = { t: T0 }, sh = shop();
  const c = cx(now, sh, { buyCartsBetween: async () => [CART("1", new Date(T0 - 60e3).toISOString(), [L({ title: "Lightning Bolt [Fourth Edition]", variantId: "111", qty: 2 })])], completedBuylists: async () => [], buylistLines: async () => ({ lines: [] }) });
  const r = await pollLive(c);
  assert.equal(r.on, false); assert.equal(r.carts, 0);
  assert.equal(sh.moves.length, 0);
  assert.equal(sh.inv[ITEM(1)].available, 3);
  const h = await liveHealth(c);
  assert.deepEqual([h.on, h.open, h.held], [false, 0, 0]);
  // the rise hook does nothing before the switch was ever touched
  assert.equal((await liveOnRise(c, "2", 5)).skipped, true);
});

test("switched on for one arrival: a cart is held, the rest waits for the push, no-product lines are reported, then it switches itself off", async () => {
  const now = { t: T0 }, sh = shop();
  const carts = [];
  let buylists = [];
  const c = cx(now, sh, { buyCartsBetween: async () => carts, completedBuylists: async () => buylists, buylistLines: async () => ({ lines: [] }) });
  // a cart from before the switch is never held
  carts.push(CART("old", new Date(T0 - 3600e3).toISOString(), [L({ title: "Lightning Bolt [Fourth Edition]", variantId: "111", qty: 1 })]));
  const set = await call(c, "/_hold/live/set", { on: "1", trial: "1", by: "chaylon@exorgames.com" });
  assert.equal(set.body.on, true); assert.equal(set.body.trial, 1);
  now.t = T0 + 5 * 60e3;
  carts.push(CART("32861204", new Date(T0 + 4 * 60e3).toISOString(), [
    L({ title: "Lightning Bolt [Fourth Edition]", variantId: "111", qty: 2 }),                       // 3 available: held at once
    L({ title: "Roronoa Zoro (OP12-020) [Legacy of the Master]", condition: "Near Mint Foil", variantId: "222", qty: 1 }),  // 0 available: waits for BinderPOS's push
    L({ title: "Sol Ring [Commander Legends]", condition: "Near Mint Foil", variantId: "", qty: 1 }),  // no variant id: found by title + condition
    L({ title: "Jinx, Loose Cannon", condition: "", variantId: "", qty: 3 }),                          // free-text line: no product
  ]));
  const r = await pollLive(c);
  assert.equal(r.carts, 1); assert.equal(r.on, false, "the trial of 1 switched it off");
  assert.deepEqual(sh.moves.map((m) => [m.item, m.n, m.from, m.to, m.reason]), [[ITEM(1), 2, "available", "quality_control", "quality_control"], [ITEM(3), 1, "available", "quality_control", "quality_control"]]);
  assert.equal(sh.moves[0].ref, "gid://exor-9pocket/Arrival/cart:32861204");
  assert.equal(sh.moves[0].ledger, "gid://exor-9pocket/Hold/cart:32861204");
  assert.equal(sh.inv[ITEM(1)].available, 1); assert.equal(sh.inv[ITEM(1)].quality_control, 2);
  let st = await liveStatus(c);
  assert.equal(st.open.length, 1);
  const rec = st.open[0];
  assert.equal(rec.status, "waiting");
  assert.deepEqual(rec.lines.map((l) => [l.status, l.held, l.remaining]), [["held", 2, 0], ["waiting", 0, 1], ["held", 1, 0], ["no-product", 0, 0]]);
  assert.equal(rec.lines[2].variantId, "334");   // the foil Sol Ring, not the plain one
  assert.equal(rec.held, 3);
  assert.deepEqual(st.counts, { held: 3, arrivals: 1, old24: 0, old72: 0, releasedToday: 0, notHeld: 1 });
  assert.match(st.notHeld[0].note, /no Shopify product named Jinx/);
  assert.match(st.history[0].text, /trial finished/);
  assert.match(st.history[1].text, /POS cart 32861204: held 3, 1 line waiting, 1 could not be held/);
  // the same cart again: not ingested twice (and the switch is off anyway)
  assert.equal((await pollLive(c)).carts, 0);
  assert.equal(sh.moves.length, 2);
  // BinderPOS pushes the Zoro: the inventory webhook's rise holds the waiting copy even though the switch is off
  sh.inv[ITEM(2)].available = 1;
  const rise = await call(c, "/_hold/inv", { item: "2", available: 1 });   // first sight = baseline only, so no rise yet
  assert.equal(rise.body.baseline, true);
  sh.inv[ITEM(2)].available = 2;
  await call(c, "/_hold/inv", { item: "2", available: 2 });
  assert.equal(sh.moves.length, 3); assert.equal(sh.inv[ITEM(2)].quality_control, 1); assert.equal(sh.inv[ITEM(2)].available, 1);
  st = await liveStatus(c);
  assert.equal(st.open[0].status, "held"); assert.equal(st.open[0].held, 4);
  // the counter: find the Sol Ring and release one
  const f = await call(c, "/_hold/live/find", { q: "sol ring" });
  assert.equal(f.body.matches.length, 1); assert.equal(f.body.matches[0].held, 1); assert.equal(f.body.matches[0].variantTitle, "Near Mint Foil");
  const key = f.body.matches[0].key, li = f.body.matches[0].line;
  const rel = await call(c, "/_hold/live/release", { key, line: li, n: 1, by: "sam@exorgames.com" });
  assert.equal(rel.body.ok, true); assert.equal(rel.body.moved, 1);
  assert.equal(sh.inv[ITEM(3)].available, 1); assert.equal(sh.inv[ITEM(3)].quality_control, 0);
  assert.equal(sh.moves.at(-1).reason, "quality_control");
  // one Bolt is damaged: it goes to damaged, never to the shelf; the other is released; the rest by Release all
  const dmg = await call(c, "/_hold/live/release", { key, line: 0, n: 1, to: "damaged", by: "sam@exorgames.com" });
  assert.equal(dmg.body.moved, 1); assert.equal(sh.inv[ITEM(1)].damaged, 1); assert.equal(sh.moves.at(-1).reason, "damaged");
  const all = await call(c, "/_hold/live/release", { key, by: "chaylon@exorgames.com" });
  assert.equal(all.body.moved, 2); assert.equal(all.body.status, "done");
  assert.equal(sh.inv[ITEM(1)].available, 2); assert.equal(sh.inv[ITEM(1)].quality_control, 0); assert.equal(sh.inv[ITEM(2)].available, 2);
  st = await liveStatus(c);
  assert.equal(st.open.length, 0); assert.equal(st.done.length, 1); assert.equal(st.counts.releasedToday, 3); assert.equal(st.counts.held, 0);   // the damaged copy is not "released"
  assert.ok(st.history.some((h) => /released all 2/.test(h.text)) && st.history.some((h) => /marked 1 × Lightning Bolt/.test(h.text)));
  // a completed buylist arrives while the switch is on again (no trial): matched by title, held
  await call(c, "/_hold/live/set", { on: true, trial: "0", by: "chaylon@exorgames.com" });
  now.t += 60e3;
  buylists = [{ id: "916140", completed: new Date(now.t - 10e3).toISOString(), paymentType: "Store Credit", customer: { name: "Ada Lovelace" }, portalUrl: "x" }];
  c.portal.buylistLines = async (id) => ({ id, paymentType: "Store Credit", completed: buylists[0].completed, customer: "Ada Lovelace", lines: [{ name: "Lightning Bolt", set: "Fourth Edition", condition: "Near Mint", finish: "Non-foil", qty: 2, cash: 1, credit: 3.68, image: "" }] });
  const r2 = await pollLive(c);
  assert.equal(r2.buylists, 1); assert.equal(r2.on, true);
  st = await liveStatus(c);
  assert.equal(st.open[0].kind, "buylist"); assert.equal(st.open[0].customer, "Ada Lovelace"); assert.equal(st.open[0].paid.credit, 7.36); assert.equal(st.open[0].held, 2);
  assert.equal(sh.inv[ITEM(1)].quality_control, 2);
  // stage 1's "remove" refuses while the live hold is on or holding
  const rm = await call(c, "/_hold/control", { action: "remove" });
  assert.match(rm.body.error, /live hold is on/);
  const health = await call(c, "/_hold/health");
  assert.equal(health.body.live.on, true); assert.equal(health.body.live.held, 2); assert.equal(health.body.live.open, 1);
  // the alarm polls every two minutes while on; housekeeping ran once
  await holdDoAlarm(c);
  assert.equal(c.storage.alarm, now.t + 120e3);
  await call(c, "/_hold/live/set", { on: false, by: "chaylon@exorgames.com" });
  assert.equal(sh.inv[ITEM(1)].quality_control, 2, "switching off releases nothing");
});

test("a line that never arrives is given up after 45 minutes and listed as not held", async () => {
  const now = { t: T0 }, sh = shop();
  const carts = [CART("7", new Date(T0).toISOString(), [L({ title: "Roronoa Zoro (OP12-020) [Legacy of the Master]", condition: "Near Mint Foil", variantId: "222", qty: 2 })])];
  const c = cx(now, sh, { buyCartsBetween: async () => carts, completedBuylists: async () => [], buylistLines: async () => ({ lines: [] }) });
  await call(c, "/_hold/live/set", { on: true, by: "a@b" });
  now.t = T0 + 60e3;
  await pollLive(c);
  let st = await liveStatus(c);
  assert.equal(st.open[0].lines[0].status, "waiting");
  now.t = T0 + 20 * 60e3;
  sh.inv[ITEM(2)].available = 1;              // one of the two shows up
  await pollLive(c);
  st = await liveStatus(c);
  assert.deepEqual([st.open[0].lines[0].held, st.open[0].lines[0].remaining, st.open[0].lines[0].status], [1, 1, "waiting"]);
  now.t = T0 + RETRY_FOR_MS + 2 * 60e3;
  await pollLive(c);
  st = await liveStatus(c);
  assert.equal(st.open[0].lines[0].status, "short");
  assert.equal(st.open[0].status, "held");    // the one copy that arrived is held and can be released
  assert.match(st.notHeld[0].note, /only 1 of 2 arrived/);
  const s = await settingsOf(c);
  assert.equal(s.on, true);
});
