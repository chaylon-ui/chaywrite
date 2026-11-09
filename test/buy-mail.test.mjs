import { test } from "node:test";
import assert from "node:assert/strict";
import { pollBuyMail, setBuyMail, settingsOf, cartBuys, POLL_MS, LOOKBACK_MS, BUYLIST_NOTIFY_DEFAULT } from "../src/buy-mail.js";
import { buildCartEmail } from "../src/stage-email.js";
import { stageDoAlarm, stageDoFetch } from "../src/stage.js";
import { renderAdmin } from "../src/stage-ui.js";

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, JSON.parse(JSON.stringify(b))); return; } this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const T0 = 1_762_700_000_000;
const MIN = 60e3;
const iso = (ms) => new Date(ms).toISOString();
const LINES = [{ id: "1", title: "Lightning Bolt [Magic 2011]", condition: "Near Mint", qty: 3, buying: true, paid: 1.5, sell: 3.99 }, { id: "2", title: "Sol Ring [Commander Legends]", condition: "Lightly Played Foil", qty: 1, buying: true, paid: 8, sell: 19.99 }];
const SOLD = [{ id: "3", title: "Booster", condition: "", qty: 1, buying: false, price: 5.99 }];
const CART = (id, submitted, lines, extra) => ({ id, submitted: iso(submitted), staff: "jo@exorgames.com", till: "Front counter", customer: { id: "9", name: "Ada Lovelace", email: "ada@example.test", phone: "(902) 555-0100" }, payout: { cash: 12.5, credit: 0, other: 0, total: 12.5 }, sold: { lines: 0, cards: 0, total: 0 }, lines, portalUrl: "https://portal.binderpos.com/#/pointOfSale/carts/" + id, ...(extra || {}) });

// A room with a pretend BinderPOS and a pretend Resend.
function world(carts) {
  const w = { t: T0, carts: carts || [], asked: [], sent: [], failing: new Set() };
  w.cx = {
    storage: new MemStorage(), env: {}, now: () => w.t, log: () => {}, mem: {},
    portal: { buyCartsBetween: async (a, b) => { w.asked.push([a, b]); return w.carts; } },
    sendEmail: async (to, msg, replyTo) => { w.sent.push({ to, subject: msg.subject, replyTo }); return w.failing.has(to) ? { ok: false, error: "resend down" } : { ok: true, id: "m" + w.sent.length }; },
  };
  return w;
}
async function call(c, path, body) {
  const url = new URL("https://w.example" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await stageDoFetch(c, req, url);
  return { status: r.status, body: await r.json() };
}

test("off: no look at BinderPOS, nothing sent", async () => {
  const w = world([CART("c1", T0 - MIN, LINES)]);
  const r = await pollBuyMail(w.cx);
  assert.deepEqual([r.on, r.carts, r.sent, w.asked.length, w.sent.length], [false, 0, 0, 0, 0]);
});

test("on: carts from before the switch are skipped, a new buy cart is emailed once to each address, a sold-only cart is not", async () => {
  const w = world();
  await w.cx.storage.put("cfg", { buylistTo: ["a@exorgames.com", "b@exorgames.com"] });
  await setBuyMail(w.cx, true, "chaylon@exorgames.com");
  assert.equal(w.cx.storage.alarm, T0 + 5e3, "the first look is armed for a few seconds out");
  w.t = T0 + 3 * MIN;
  w.carts = [CART("old", T0 - 10 * MIN, LINES), CART("new", T0 + MIN, LINES), CART("soldonly", T0 + 2 * MIN, SOLD), { id: "", submitted: iso(T0 + MIN), lines: LINES }];
  const r = await pollBuyMail(w.cx);
  assert.deepEqual([r.carts, r.sent, r.skipped, r.errors], [1, 2, 2, []]);
  assert.deepEqual(w.sent.map((s) => s.to).sort(), ["a@exorgames.com", "b@exorgames.com"]);
  assert.ok(w.sent.every((s) => s.replyTo === "ada@example.test" && /^In-store buy: Ada Lovelace - 4 cards, \$12\.50 cash · Front counter$/.test(s.subject)), JSON.stringify(w.sent));
  // the window: from 30 minutes before the switch (the overlap), to now
  assert.deepEqual(w.asked[0], [T0 - 30 * MIN, T0 + 3 * MIN]);
  const s = await settingsOf(w.cx);
  assert.deepEqual([s.seen.sort(), s.sent, s.lastCart, s.cartsFrom, s.lastPoll, s.lastError], [["new", "old", "soldonly"], 2, "new", T0 + 3 * MIN, T0 + 3 * MIN, ""]);
  // the same carts again: nothing is sent twice
  w.t = T0 + 5 * MIN;
  const r2 = await pollBuyMail(w.cx);
  assert.deepEqual([r2.carts, r2.sent, w.sent.length], [0, 0, 2]);
  assert.deepEqual(w.asked[1], [T0 + 3 * MIN - 30 * MIN, T0 + 5 * MIN]);
});

test("a cart nobody got is tried again next look; a cart one address got is done", async () => {
  const w = world();
  await w.cx.storage.put("cfg", { buylistTo: ["a@exorgames.com", "b@exorgames.com"] });
  await setBuyMail(w.cx, true, "x");
  w.t = T0 + 2 * MIN;
  w.carts = [CART("c1", T0 + MIN, LINES)];
  w.failing.add("a@exorgames.com"); w.failing.add("b@exorgames.com");
  const r = await pollBuyMail(w.cx);
  assert.deepEqual([r.carts, r.sent], [1, 0]);
  assert.match(r.errors[0], /^cart c1: resend down; resend down - will try again$/);
  let s = await settingsOf(w.cx);
  assert.deepEqual([s.seen, s.cartsFrom], [[], T0], "unseen, and the window is not moved past it");
  assert.equal(s.lastError, r.errors[0]);
  // one address comes back
  w.failing.delete("a@exorgames.com");
  w.t = T0 + 4 * MIN;
  const r2 = await pollBuyMail(w.cx);
  assert.deepEqual([r2.carts, r2.sent], [1, 1]);
  assert.match(r2.errors[0], /^cart c1: resend down$/);
  s = await settingsOf(w.cx);
  assert.deepEqual([s.seen, s.cartsFrom, s.sent], [["c1"], T0 + 4 * MIN, 1]);
  assert.equal(w.sent.filter((x) => x.to === "a@exorgames.com").length, 2);
});

test("the buylist list off ([]) means nobody is told, but the carts are still marked seen; the default list applies when none was saved", async () => {
  const w = world();
  await w.cx.storage.put("cfg", { buylistTo: [] });
  await setBuyMail(w.cx, true, "x");
  w.t = T0 + 2 * MIN; w.carts = [CART("c1", T0 + MIN, LINES)];
  const r = await pollBuyMail(w.cx);
  assert.deepEqual([r.carts, r.sent, (await settingsOf(w.cx)).seen], [1, 0, ["c1"]]);
  const w2 = world([CART("c2", T0 + MIN, LINES)]);
  await setBuyMail(w2.cx, true, "x"); w2.t = T0 + 2 * MIN;
  await pollBuyMail(w2.cx);
  assert.deepEqual(w2.sent.map((s) => s.to), BUYLIST_NOTIFY_DEFAULT);
});

test("a BinderPOS failure is reported and the window stays; a second look at once is refused as busy", async () => {
  const w = world();
  await setBuyMail(w.cx, true, "x");
  w.t = T0 + 2 * MIN;
  w.cx.portal.buyCartsBetween = async () => { throw new Error("BinderPOS carts backed off after a failure"); };
  const r = await pollBuyMail(w.cx);
  assert.deepEqual([r.carts, r.errors], [0, ["carts: BinderPOS carts backed off after a failure"]]);
  assert.equal((await settingsOf(w.cx)).cartsFrom, T0);
  let release; w.cx.portal.buyCartsBetween = () => new Promise((res) => { release = res; });
  const p1 = pollBuyMail(w.cx);
  await new Promise((res) => setTimeout(res, 5));
  const r2 = await pollBuyMail(w.cx);
  assert.equal(r2.busy, true);
  release([]); await p1;
  w.cx.portal.buyCartsBetween = async () => [];
  assert.equal((await pollBuyMail(w.cx)).busy, undefined);
});

test("the email: who, what we paid, the payout, the till and staff, the BinderPOS button; a walk-in and a trade read right", () => {
  const m = buildCartEmail(CART("31415", T0, LINES, { sold: { lines: 1, cards: 2, total: 11.98 }, notes: "paid from the float" }));
  assert.equal(m.subject, "In-store buy: Ada Lovelace - 4 cards, $12.50 cash · Front counter");
  for (const bit of ["In-store buy · cart 31415", "Ada Lovelace", "mailto:ada@example.test", "(902) 555-0100", "$12.50 cash", "Front counter", "jo@exorgames.com", "Lightning Bolt [Magic 2011]", "Near Mint", "$1.50", "$3.99", "$4.50", "Sol Ring [Commander Legends]", "$8.00", "$19.99", "Paid for 4 cards", "$12.50", 'href="https://portal.binderpos.com/#/pointOfSale/carts/31415"', "Open the cart in BinderPOS", "They also bought 2 cards from us in the same cart ($11.98).", "Cart notes: paid from the float", "Reply goes to the customer."]) assert.ok(m.html.includes(bit), "html has " + bit);
  assert.ok(m.text.includes("3 x Lightning Bolt [Magic 2011] · Near Mint - paid $1.50 each (sells for $3.99)") && m.text.includes("Paid out: $12.50 cash · 4 cards · $12.50 paid") && m.text.includes("Till: Front counter · Staff: jo@exorgames.com · When: "), m.text);
  assert.ok(!m.html.includes("undefined") && !m.text.includes("undefined"));
  const walk = buildCartEmail(CART("7", T0, [LINES[1]], { customer: null, payout: { cash: 0, credit: 8, other: 0, total: 8 }, till: "", staff: "" }));
  assert.equal(walk.subject, "In-store buy: walk-in - 1 card, $8.00 store credit");
  assert.ok(walk.html.includes("Walk-in (no customer on the cart)") && !walk.html.includes("mailto:") && !walk.html.includes("Reply goes to the customer"));
  const mixed = buildCartEmail(CART("8", T0, LINES, { payout: { cash: 10, credit: 2.5, other: 0, total: 12.5 } }));
  assert.ok(mixed.subject.includes("$10.00 cash + $2.50 store credit"));
  const none = buildCartEmail(CART("9", T0, LINES, { payout: { cash: 0, credit: 0, other: 0, total: 0 } }));
  assert.ok(none.html.includes("$12.50 (how it was paid out is not on the cart)"));
  assert.equal(cartBuys(CART("x", T0, [...LINES, ...SOLD])).length, 2);
});

test("the room's routes: status, the switch (alarm in 5 s), a look now", async () => {
  const w = world([CART("c1", T0 + MIN, LINES)]);
  let r = await call(w.cx, "/_stage/buymail");
  assert.deepEqual([r.status, r.body.ok, r.body.on, r.body.sent], [200, true, false, 0]);
  r = await call(w.cx, "/_stage/buymail/set", { on: true, by: "chaylon@exorgames.com" });
  assert.deepEqual([r.body.on, r.body.by, r.body.since, w.cx.storage.alarm], [true, "chaylon@exorgames.com", T0, T0 + 5e3]);
  w.t = T0 + 2 * MIN;
  r = await call(w.cx, "/_stage/buymail/poll", {});
  assert.deepEqual([r.body.ok, r.body.on, r.body.carts, r.body.sent, r.body.status.sent, r.body.status.lastCart], [true, true, 1, 1, 1, "c1"]);
  r = await call(w.cx, "/_stage/buymail/set", { on: false, by: "chaylon@exorgames.com" });
  assert.deepEqual([r.body.on, r.body.at], [false, T0 + 2 * MIN]);
  assert.equal((await call(w.cx, "/_stage/buymail/nope")).status, 404);
});

test("the room's alarm: the daily prune keeps its day, the look rides every two minutes only while on", async () => {
  const w = world([CART("c1", T0 + MIN, LINES)]);
  await w.cx.storage.put("st:old", { id: "old", status: "approved", ts: T0 - 400 * 86400e3 });
  await w.cx.storage.put("st:kept", { id: "kept", status: "staged", ts: T0 - 400 * 86400e3 });
  await stageDoAlarm(w.cx);
  const DAY = 24 * 3600e3;
  assert.deepEqual([await w.cx.storage.get("st:old"), !!(await w.cx.storage.get("st:kept")), await w.cx.storage.get("prune:at"), w.cx.storage.alarm], [undefined, true, T0 + DAY, T0 + DAY], "off: the prune ran and the next alarm is the next prune");
  await setBuyMail(w.cx, true, "x");
  w.t = T0 + 2 * MIN;
  await stageDoAlarm(w.cx);
  assert.deepEqual([w.sent.length, w.cx.storage.alarm, await w.cx.storage.get("prune:at")], [1, T0 + 2 * MIN + POLL_MS, T0 + DAY], "on: the cart was emailed, the next alarm is two minutes out, the prune day is untouched");
  await setBuyMail(w.cx, false, "x");
  w.t = T0 + 4 * MIN;
  await stageDoAlarm(w.cx);
  assert.equal(w.cx.storage.alarm, T0 + DAY, "off again: back to the prune clock");
  assert.ok(LOOKBACK_MS > POLL_MS);
});

test("the admin page shows the card: the switch, where it stands, the sample", () => {
  const ADMIN = { email: "chaylon@exorgames.com", name: "Chaylon", role: "admin", perms: {} };
  const base = { user: ADMIN, users: [ADMIN], cfg: { buylistTo: ["a@exorgames.com"] }, devices: [], origin: "https://w.example", access: [] };
  const off = renderAdmin({ ...base, buymail: { on: false, sent: 0 } });
  assert.ok(off.includes("In-store buy emails") && off.includes('value="buymail-on"') && off.includes(">Switch on<") && !off.includes('value="buymail-poll"') && off.includes('value="buymail-test"'));
  const on = renderAdmin({ ...base, buymail: { on: true, at: T0, by: "chaylon@exorgames.com", lastPoll: T0 + MIN, sent: 3, lastSent: T0 + MIN, lastError: "cart 5: resend down - will try again" } });
  assert.ok(on.includes('class="sw on">ON<') && on.includes('value="buymail-off"') && on.includes(">Look now<") && on.includes("3 emails sent") && on.includes("switched on ") && on.includes("by chaylon@exorgames.com") && on.includes("Last problem: cart 5: resend down - will try again"));
  assert.ok(renderAdmin(base).includes(">OFF<"), "no status at all reads as off");
});
