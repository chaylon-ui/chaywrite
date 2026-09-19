import { test } from "node:test";
import assert from "node:assert/strict";
import { stageDoFetch, stageDoAlarm } from "../src/stage.js";

// An in-memory stand-in for a Durable Object's storage: the four calls the
// stage module makes, with list({prefix}) returning a key-sorted Map.
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const T0 = 1_760_000_000_000;
function cx(now) { return { storage: new MemStorage(), env: {}, now: () => now.t, log: () => {}, mem: {} }; }
async function call(c, path, body) {
  const url = new URL("https://w.example" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await stageDoFetch(c, req, url);
  return { status: r.status, body: await r.json() };
}
const CARDS = [
  { cardId: 101, cardName: "Lightning Bolt", setName: "Magic 2011", game: "mtg", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "3", cashBuyPrice: 1.5, storeCreditBuyPrice: 1.95 },
  { cardId: 202, cardName: "Sol Ring", setName: "Commander Legends", game: "mtg", type: "Foil", condition: 2, conditionName: "Lightly Played", quantity: "1", cashBuyPrice: 2, storeCreditBuyPrice: 2.6 },
];

test("put, list, mine, edit, mark: the life of one staged list", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const put = await call(c, "/_stage/put", { customer: "3957471740057", paymentType: "Cash", cards: CARDS, repriced: { changed: [], capped: ["x"], dropped: [] } });
  assert.equal(put.status, 200);
  assert.ok(put.body.ok && put.body.id);
  assert.equal(put.body.totals.units, 4);
  const id = put.body.id;

  const bad = await call(c, "/_stage/put", { customer: "", paymentType: "Cash", cards: CARDS });
  assert.equal(bad.status, 400);

  let list = await call(c, "/_stage/list");
  assert.equal(list.body.count, 1);
  assert.equal(list.body.counts.staged, 1);
  assert.equal(list.body.records[0].status, "staged");

  const mine = await call(c, "/_stage/mine?customer=3957471740057");
  assert.equal(mine.body.records.length, 1);
  assert.equal(mine.body.records[0].status, "staged");
  assert.ok(!("note" in mine.body.records[0]));
  const other = await call(c, "/_stage/mine?customer=1234567");
  assert.equal(other.body.records.length, 0);

  const edit = await call(c, "/_stage/edit", { id, edit: [{ cardId: "202", condition: "2", type: "foil", quantity: "0" }, { cardId: "101", condition: "1", type: "normal", quantity: "2" }] });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.record.cards.length, 1);
  assert.equal(edit.body.record.totals.units, 2);
  const emptyEdit = await call(c, "/_stage/edit", { id, edit: [{ cardId: "101", condition: "1", type: "normal", quantity: "0" }] });
  assert.equal(emptyEdit.status, 400);

  now.t = T0 + 3600e3;
  const ok = await call(c, "/_stage/mark", { id, status: "approved", note: "fine", bp: { number: "8812", upstream: 200, cleared: 200 }, repricedAtApproval: { changed: ["Lightning Bolt · Near Mint ($1.50 cash / $1.95 credit is now $1.40 / $1.82)"], capped: [], dropped: [] }, cards: [{ ...CARDS[0], quantity: "2", cashBuyPrice: 1.4, storeCreditBuyPrice: 1.82 }] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.record.status, "approved");
  assert.equal(ok.body.record.bp.number, "8812");
  assert.equal(ok.body.record.totals.cash, 2.8);
  assert.deepEqual(ok.body.record.events.map((e) => e.action), ["submitted", "edited", "approved"]);

  const again = await call(c, "/_stage/mark", { id, status: "rejected" });
  assert.equal(again.status, 409);
  const editLate = await call(c, "/_stage/edit", { id, edit: [] });
  assert.equal(editLate.status, 409);

  const view = (await call(c, "/_stage/mine?customer=3957471740057")).body.records[0];
  assert.equal(view.status, "approved");
  assert.equal(view.reference, "8812");
  assert.equal(view.decidedAt, T0 + 3600e3);

  const health = await call(c, "/_stage/health");
  assert.deepEqual(health.body.counts, { approved: 1 });
  assert.equal(health.body.oldestStaged, null);
});

test("reject keeps the list with a note the shopper can see", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const { body: { id } } = await call(c, "/_stage/put", { customer: "555555555", paymentType: "Store Credit", cards: CARDS });
  const r = await call(c, "/_stage/mark", { id, status: "rejected", note: "staff only", customerNote: "these were Heavily Played" });
  assert.equal(r.body.record.status, "rejected");
  const view = (await call(c, "/_stage/mine?customer=555555555")).body.records[0];
  assert.equal(view.customerNote, "these were Heavily Played");
  assert.ok(!("note" in view));
});

test("the alarm prunes decided lists after 90 days and never a staged one", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const a = (await call(c, "/_stage/put", { customer: "1", paymentType: "Cash", cards: CARDS })).body.id;
  const b = (await call(c, "/_stage/put", { customer: "2", paymentType: "Cash", cards: CARDS })).body.id;
  await call(c, "/_stage/mark", { id: a, status: "rejected" });
  now.t = T0 + 91 * 86400e3;
  await stageDoAlarm(c);
  const list = await call(c, "/_stage/list?days=365");
  assert.deepEqual(list.body.records.map((r) => r.id), [b]);
  assert.equal(list.body.records[0].status, "staged");
  assert.ok(c.storage.alarm > now.t);
});

test("unknown paths and records answer 404", async () => {
  const c = cx({ t: T0 });
  assert.equal((await call(c, "/_stage/nope")).status, 404);
  assert.equal((await call(c, "/_stage/get?id=missing")).status, 404);
  assert.equal((await call(c, "/_stage/mark", { id: "missing", status: "approved" })).status, 404);
});
