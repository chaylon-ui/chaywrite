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
  const put = await call(c, "/_stage/put", { customer: "3957471740057", customerName: "Ada Lovelace", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS, repriced: { changed: [], capped: ["x"], dropped: [] } });
  assert.equal(put.status, 200);
  assert.ok(put.body.ok && put.body.id);
  assert.equal(put.body.totals.units, 4);
  assert.equal(put.body.number, "9P-1001");
  const id = put.body.id;
  // numbers count up; the shopper's view carries the number
  const put2 = await call(c, "/_stage/put", { customer: "222", paymentType: "Cash", cards: CARDS });
  assert.equal(put2.body.number, "9P-1002");
  assert.equal((await call(c, "/_stage/mine?customer=222")).body.records[0].number, "9P-1002");
  // the email outcome is written on the record and shows in its history
  const em = await call(c, "/_stage/email", { id, email: { status: "sent", to: "ada@example.test", id: "re_1" } });
  assert.equal(em.body.record.email.status, "sent");
  assert.equal(em.body.record.events.at(-1).action, "emailed");
  // an edit can carry the staff note and a price; the note alone is not an "edited" event
  const pe = await call(c, "/_stage/edit", { id, edit: [{ cardId: "202", condition: "2", type: "foil", quantity: "1", cashBuyPrice: "2.75" }], note: "foil looks off" });
  assert.equal(pe.body.record.note, "foil looks off");
  assert.equal(pe.body.record.cards[1].staffPriced, true);
  assert.equal(pe.body.record.totals.cash, 7.25);
  // staff see the name (list/get), the shopper's view never carries it
  assert.equal((await call(c, "/_stage/get?id=" + id)).body.record.customerName, "Ada Lovelace");
  assert.ok(!JSON.stringify((await call(c, "/_stage/mine?customer=3957471740057")).body).includes("Lovelace"));

  const bad = await call(c, "/_stage/put", { customer: "", paymentType: "Cash", cards: CARDS });
  assert.equal(bad.status, 400);

  let list = await call(c, "/_stage/list");
  assert.equal(list.body.count, 2);
  assert.equal(list.body.counts.staged, 2);
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
  assert.deepEqual(ok.body.record.events.map((e) => e.action), ["submitted", "emailed", "edited", "edited", "approved"]);

  const again = await call(c, "/_stage/mark", { id, status: "rejected" });
  assert.equal(again.status, 409);
  const editLate = await call(c, "/_stage/edit", { id, edit: [] });
  assert.equal(editLate.status, 409);

  const view = (await call(c, "/_stage/mine?customer=3957471740057")).body.records[0];
  assert.equal(view.status, "approved");
  assert.equal(view.reference, "8812");
  assert.equal(view.decidedAt, T0 + 3600e3);

  const health = await call(c, "/_stage/health");
  assert.deepEqual(health.body.counts, { approved: 1, staged: 1 });
  assert.equal(health.body.oldestStaged, T0);
  assert.equal(health.body.lastNumber, "9P-1002");
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

test("a name can be filled in later without touching the list or its events", async () => {
  const c = cx({ t: T0 });
  const { body: { id } } = await call(c, "/_stage/put", { customer: "777777777", paymentType: "Cash", cards: CARDS });
  assert.equal((await call(c, "/_stage/get?id=" + id)).body.record.customerName, "");
  const w = await call(c, "/_stage/who", { id, customerName: "Grace Hopper", customerEmail: "grace@example.test" });
  assert.equal(w.status, 200);
  const rec = (await call(c, "/_stage/get?id=" + id)).body.record;
  assert.equal(rec.customerName, "Grace Hopper");
  assert.equal(rec.status, "staged");
  assert.deepEqual(rec.events.map((e) => e.action), ["submitted"]);
  assert.ok(!JSON.stringify((await call(c, "/_stage/mine?customer=777777777")).body).includes("Hopper"));
  assert.equal((await call(c, "/_stage/who", { id: "missing", customerName: "x" })).status, 404);
});

test("accounts, sessions and the failed-login counter", async () => {
  const now = { t: T0 };
  const c = cx(now);
  assert.deepEqual((await call(c, "/_stage/users")).body.users, []);
  const mk = await call(c, "/_stage/user/put", { user: { email: "Chaylon@ExorGames.com", name: "C", role: "admin", perms: {}, hash: "H", salt: "S", iter: 1 }, create: true });
  assert.equal(mk.status, 200);
  assert.equal(mk.body.user.email, "chaylon@exorgames.com");
  assert.ok(!("hash" in mk.body.user));
  assert.equal((await call(c, "/_stage/user/put", { user: { email: "chaylon@exorgames.com", hash: "x" }, create: true })).status, 409);
  assert.equal((await call(c, "/_stage/user/put", { user: { email: "nobody@x.co", name: "n" } })).status, 404);
  const full = await call(c, "/_stage/user?email=chaylon@exorgames.com");
  assert.equal(full.body.user.hash, "H");                       // the worker verifies with it
  assert.ok(!JSON.stringify((await call(c, "/_stage/users")).body).includes('"hash"'));
  // sessions
  const tok = "ab".repeat(32);
  assert.equal((await call(c, "/_stage/session/put", { token: "short", email: "chaylon@exorgames.com" })).status, 400);
  assert.equal((await call(c, "/_stage/session/put", { token: tok, email: "chaylon@exorgames.com" })).status, 200);
  assert.equal((await call(c, "/_stage/session?token=" + tok)).body.email, "chaylon@exorgames.com");
  now.t = T0 + 31 * 86400e3;
  assert.equal((await call(c, "/_stage/session?token=" + tok)).status, 404);   // expired and gone
  now.t = T0;
  await call(c, "/_stage/session/put", { token: tok, email: "chaylon@exorgames.com" });
  // disabling drops the sessions; a merge keeps the hash
  const dis = await call(c, "/_stage/user/put", { user: { email: "chaylon@exorgames.com", disabled: true } });
  assert.equal(dis.body.user.disabled, true);
  assert.equal((await call(c, "/_stage/session?token=" + tok)).status, 404);
  assert.equal((await call(c, "/_stage/user?email=chaylon@exorgames.com")).body.user.hash, "H");
  // failed logins: locked at the 10th within 15 minutes, cleared by a success
  for (let i = 1; i <= 9; i++) assert.equal((await call(c, "/_stage/attempt", { email: "chaylon@exorgames.com", ok: false })).body.locked, false);
  assert.equal((await call(c, "/_stage/attempt", { email: "chaylon@exorgames.com", ok: false })).body.locked, true);
  assert.equal((await call(c, "/_stage/locked?email=chaylon@exorgames.com")).body.locked, true);
  now.t = T0 + 16 * 60e3;
  assert.equal((await call(c, "/_stage/locked?email=chaylon@exorgames.com")).body.locked, false);
  await call(c, "/_stage/attempt", { email: "chaylon@exorgames.com", ok: true });
  assert.equal((await call(c, "/_stage/attempt", { email: "chaylon@exorgames.com", ok: false })).body.attempts, 1);
  // delete
  assert.equal((await call(c, "/_stage/user/del", { email: "chaylon@exorgames.com" })).status, 200);
  assert.equal((await call(c, "/_stage/user?email=chaylon@exorgames.com")).status, 404);
  assert.equal((await call(c, "/_stage/health")).body.accounts, 0);
});

test("a card added by staff joins the list, merges into a matching line, and is refused once decided", async () => {
  const c = cx({ t: T0 });
  const { body: { id } } = await call(c, "/_stage/put", { customer: "1", paymentType: "Cash", cards: CARDS });
  const add = await call(c, "/_stage/add", { id, card: { cardId: 303, cardName: "Counterspell", setName: "M25", game: "mtg", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "2", cashBuyPrice: 0.5, storeCreditBuyPrice: 0.65 }, by: "chaylon@exorgames.com" });
  assert.equal(add.status, 200);
  assert.equal(add.body.record.cards.length, 3);
  assert.equal(add.body.record.totals.units, 6);
  assert.equal(add.body.record.events.at(-1).action, "added Counterspell · Near Mint ×2");
  assert.equal(add.body.record.events.at(-1).by, "chaylon@exorgames.com");
  const again = await call(c, "/_stage/add", { id, card: { ...CARDS[1], quantity: "4" } });
  assert.equal(again.body.merged, true);
  assert.equal(again.body.record.cards[1].quantity, "5");
  assert.equal((await call(c, "/_stage/add", { id, card: {} })).status, 400);
  await call(c, "/_stage/mark", { id, status: "rejected" });
  assert.equal((await call(c, "/_stage/add", { id, card: CARDS[0] })).status, 409);
});

test("unknown paths and records answer 404", async () => {
  const c = cx({ t: T0 });
  assert.equal((await call(c, "/_stage/nope")).status, 404);
  assert.equal((await call(c, "/_stage/get?id=missing")).status, 404);
  assert.equal((await call(c, "/_stage/mark", { id: "missing", status: "approved" })).status, 404);
});
