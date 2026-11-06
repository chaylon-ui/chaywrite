import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, remaining, cleanList, cleanLines, cardsOf, publicView, summaryView, visible, fixedDo, releaseFixed, renderLists, serveListsStaff, SEED, slug } from "../src/fixed-lists.js";
import { stageDoFetch, shapeRecord, STAGE_DO } from "../src/stage.js";
import { renderSheet, renderList } from "../src/stage-ui.js";
import { buildEmail, buildStaffBuylistEmail } from "../src/stage-email.js";
import { serveBuylist } from "../src/buylist.js";

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
const T0 = 1_762_400_000_000;
function cx(now) { return { storage: new MemStorage(), env: {}, now: () => now.t, log: () => {}, mem: {} }; }
async function call(c, path, body) {
  const url = new URL("https://w.example" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await stageDoFetch(c, req, url);
  return { status: r.status, body: await r.json() };
}
const OFFER = { cash: 3, credit: 4, sell: 8, fullUpTo: 10, afterCash: 1.5, afterCredit: 2, max: 50, bought: 0 };
const ADMIN = { email: "chaylon@exorgames.com", name: "Chaylon", role: "admin", perms: {} };
const PRICER = { email: "p@exorgames.com", name: "Pricer", role: "staff", perms: { prices: true } };
const LISTER = { email: "l@exorgames.com", name: "Lister", role: "staff", perms: { lists: true } };

test("quote: full price first, the lower pair past N, nothing past the cap", () => {
  const q = quote(OFFER, 30);
  assert.deepEqual(q.tiers, [{ qty: 10, cash: 3, credit: 4, after: false }, { qty: 20, cash: 1.5, credit: 2, after: true }]);
  assert.equal(q.cash, 60); assert.equal(q.credit, 80); assert.equal(q.refused, 0);
  const over = quote(OFFER, 60);
  assert.equal(over.take, 50); assert.equal(over.refused, 10);
  // the counts as they stand: 8 already reserved leaves 2 at full price
  const later = quote({ ...OFFER, bought: 8 }, 5);
  assert.deepEqual(later.tiers.map((t) => t.qty), [2, 3]);
  // no "then" pair: "first N" is the cap
  assert.equal(remaining({ ...OFFER, afterCash: null, afterCredit: null, max: null }), 10);
  assert.equal(quote({ ...OFFER, afterCash: null, afterCredit: null, max: null, bought: 10 }, 3).take, 0);
  // no limits at all
  assert.equal(remaining({ cash: 1, credit: 1 }), null);
  assert.equal(quote({ cash: 1, credit: 1.25 }, 7).credit, 8.75);
  // not buying
  assert.equal(remaining({ cash: 0, credit: null }), 0);
  assert.equal(quote({ cash: null, credit: null, max: 5 }, 2).take, 0);
});

test("cleanList: slugs, numbers, retired flags; bought is kept from the stored copy when the editor leaves it blank", () => {
  const prev = { id: "mcd", title: "Old", pv: "k", on: true, created: 1, items: [{ key: "pikachu", name: "Pikachu", image: "", offers: { loose: { ...OFFER, bought: 7 } } }] };
  const l = cleanList({ title: " McDonald's  toys ", blurb: "x", items: [
    { key: "Pikachu", name: "Pikachu", image: "https://cdn.shopify.com/p.png", offers: { loose: { cash: "3.00", credit: "4", sell: "", fullUpTo: "10", afterCash: "1.5", afterCredit: "2", max: "50", bought: "" } } },
    { name: "Eevee!", image: "javascript:alert(1)", retired: "on", offers: {} },
    { name: "pikachu" },   // duplicate key, dropped
  ] }, prev, 5, "me@x");
  assert.equal(l.id, "mcd"); assert.equal(l.title, "McDonald's toys"); assert.equal(l.on, true); assert.equal(l.pv, "k");
  assert.equal(l.items.length, 2);
  assert.deepEqual(l.items[0].offers.loose, { cash: 3, credit: 4, sell: null, fullUpTo: 10, afterCash: 1.5, afterCredit: 2, max: 50, bought: 7 });
  assert.equal(l.items[1].key, "eevee"); assert.equal(l.items[1].image, ""); assert.equal(l.items[1].retired, true);
  assert.deepEqual(l.items[1].offers.cib, { cash: null, credit: null, sell: null, fullUpTo: null, afterCash: null, afterCredit: null, max: null, bought: 0 });
  assert.equal(cleanList({}, null, 1, ""), null);
  assert.equal(slug("McDonald's Pokémon 2026"), "mcdonald-s-pokemon-2026");
});

test("the shopper's view carries what is left and the tiers, never the counts or the preview key", () => {
  const l = cleanList({ id: "t", title: "T", items: [{ key: "a", name: "A", image: "https://x/a.png", offers: { loose: { ...OFFER, bought: 8 }, cib: { cash: 2, credit: 2 }, new: {} } }, { key: "b", name: "B", retired: true }] }, null, 1, "");
  const v = publicView(l);
  assert.equal(v.items.length, 1);
  const o = v.items[0].offers;
  assert.deepEqual(o.loose, { buying: true, cash: 3, credit: 4, sell: 8, remaining: 42, fullLeft: 2, fullUpTo: 10, afterCash: 1.5, afterCredit: 2 });
  assert.deepEqual(o.cib, { buying: true, cash: 2, credit: 2, sell: null, remaining: null, fullLeft: null, fullUpTo: null, afterCash: null, afterCredit: null });
  assert.equal(o.new.buying, false);
  assert.equal(publicView({ ...l, conditions: [{ key: "cib", label: "Complete in box" }] }).conditions[1].label, "Complete in box with cards");
  assert.ok(!JSON.stringify(v).includes("bought") && !JSON.stringify(v).includes(l.pv));
  const s = summaryView(l);
  assert.deepEqual(s, { id: "t", title: "T", blurb: "", images: ["https://x/a.png"], count: 1, buying: 1 });
  assert.equal(visible(l, ""), false);
  assert.equal(visible(l, l.pv), true);
  assert.equal(visible({ ...l, on: true }, ""), true);
  assert.equal(visible(l, "wrong"), false);
});

test("cardsOf: one stage line per tier, marked fixed, with the refusals noted", () => {
  const l = cleanList({ id: "mcd", title: "McDonald's toys", items: [{ key: "pikachu", name: "Pikachu", image: "https://x/p.png", offers: { loose: OFFER, new: { cash: 5, credit: 6, max: 2 } } }] }, null, 1, "");
  const { cards, notes } = cardsOf(l, cleanLines([{ item: "pikachu", cond: "loose", qty: "12" }, { item: "pikachu", cond: "new", qty: 3 }, { item: "pikachu", cond: "cib", qty: 1 }, { item: "nobody", cond: "loose", qty: 1 }]));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].cardId, "fl:mcd:pikachu:loose"); assert.equal(cards[0].quantity, "10"); assert.equal(cards[0].cashBuyPrice, 3); assert.equal(cards[0].conditionName, "Loose");
  assert.equal(cards[1].cardId, "fl:mcd:pikachu:loose:after"); assert.equal(cards[1].quantity, "2"); assert.equal(cards[1].cashBuyPrice, 1.5); assert.equal(cards[1].conditionName, "Loose · after the first 10");
  assert.equal(cards[2].cardId, "fl:mcd:pikachu:new"); assert.equal(cards[2].quantity, "2"); assert.deepEqual(cards[2].fixed, { list: "mcd", item: "pikachu", cond: "new", after: false });
  assert.equal(cards[0].setName, "McDonald's toys"); assert.equal(cards[0].imageUrl, "https://x/p.png");
  assert.deepEqual(notes, ["Pikachu · New (sealed): we can take 2 more, not 3", "Pikachu · Complete in box with cards: we are not buying that one right now", "nobody · loose: not on this list"]);
  assert.deepEqual(cleanLines([{ item: "a", cond: "loose", qty: 0 }, { item: "a", cond: "loose", qty: 2 }, { item: "a", cond: "loose", qty: 3 }, "x"]), [{ item: "a", cond: "loose", qty: 2 }]);
});

test("the room: create off, reserve refused while off, on, reserve moves the counts, a rejected record gives them back", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const made = await call(c, "/_stage/fl/create", { ...SEED, by: "me" });
  assert.equal(made.status, 200); assert.equal(made.body.list.on, false); assert.equal(made.body.list.items.length, 15); assert.match(made.body.list.pv, /^[0-9a-f]{24}$/);
  assert.equal((await call(c, "/_stage/fl/create", { id: SEED.id })).status, 409);
  // prices in
  const l = made.body.list;
  l.items[0].offers.loose = { ...OFFER };
  l.items[0].offers.new = { cash: 5, credit: 6, max: 2 };
  const saved = await call(c, "/_stage/fl/save", { id: SEED.id, list: l, by: "me" });
  assert.equal(saved.body.list.items[0].offers.loose.max, 50);
  assert.equal(saved.body.list.on, false);           // saving never switches it on
  // off: nothing can be reserved
  const off = await call(c, "/_stage/fl/reserve", { id: SEED.id, lines: [{ item: "pikachu", cond: "loose", qty: 2 }] });
  assert.equal(off.status, 404);
  assert.equal((await call(c, "/_stage/fl/set", { id: SEED.id, on: true, by: "me" })).body.list.on, true);
  const r = await call(c, "/_stage/fl/reserve", { id: SEED.id, lines: [{ item: "pikachu", cond: "loose", qty: 12 }, { item: "pikachu", cond: "new", qty: 5 }] });
  assert.equal(r.status, 200); assert.equal(r.body.units, 14); assert.equal(r.body.cards.length, 3); assert.equal(r.body.title, SEED.title);
  const after = (await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list.items[0].offers;
  assert.equal(after.loose.bought, 12); assert.equal(after.new.bought, 2);
  // the next shopper sees the lower price and the limit
  const v = publicView((await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list).items[0].offers;
  assert.equal(v.loose.fullLeft, 0); assert.equal(v.loose.remaining, 38); assert.equal(v.new.remaining, 0);
  assert.equal((await call(c, "/_stage/fl/reserve", { id: SEED.id, lines: [{ item: "pikachu", cond: "new", qty: 1 }] })).status, 409);
  // the staged record carries the marker; rejecting it releases the units
  const put = await call(c, "/_stage/put", { customer: "3957471740057", paymentType: "Cash", cards: r.body.cards, fixed: { list: SEED.id, title: SEED.title } });
  assert.deepEqual(put.body.ok, true);
  const rec = (await call(c, "/_stage/get?id=" + put.body.id)).body.record;
  assert.deepEqual(rec.fixed, { list: SEED.id, title: SEED.title });
  assert.equal(rec.totals.units, 14);
  const rej = await call(c, "/_stage/mark", { id: put.body.id, status: "rejected", note: "never came", by: "me" });
  assert.equal(rej.body.record.released, 14);
  const back = (await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list.items[0].offers;
  assert.equal(back.loose.bought, 0); assert.equal(back.new.bought, 0);
  // release never goes below zero
  assert.equal(await releaseFixed(c, r.body.cards), 0);
  // off again, delete only when off
  assert.equal((await call(c, "/_stage/fl/set", { id: SEED.id, on: true })).body.list.on, true);
  assert.equal((await call(c, "/_stage/fl/set", { id: SEED.id, delete: true })).status, 409);
  await call(c, "/_stage/fl/set", { id: SEED.id, on: false });
  assert.equal((await call(c, "/_stage/fl/set", { id: SEED.id, delete: true })).body.deleted, SEED.id);
  assert.equal((await call(c, "/_stage/fl/list")).body.lists.length, 0);
});

test("the sell page's api: an off list is 'not found' like an unknown action; the preview key or ON reveals it; submit reserves and stages", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const env = { ROOM: { idFromName: (n) => n, get: (n) => { assert.equal(n, STAGE_DO); return { fetch: (req) => stageDoFetch(c, req, new URL(req.url)) }; } }, BUYLIST_STAGING: "off" };
  const get = async (path) => { const r = await serveBuylist(new Request("https://w.example" + path, { headers: { origin: "https://exorgames.com" } }), env); return { status: r.status, body: await r.json() }; };
  const post = async (path, body) => { const r = await serveBuylist(new Request("https://w.example" + path, { method: "POST", headers: { origin: "https://exorgames.com", "content-type": "application/json" }, body: JSON.stringify(body) }), env); return { status: r.status, body: await r.json() }; };
  await call(c, "/_stage/fl/create", { ...SEED, items: [{ key: "pikachu", name: "Pikachu", image: "https://x/p.png", offers: { loose: OFFER } }], by: "me" });
  const pv = (await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list.pv;
  assert.deepEqual((await get("/buylist/api/fixedlists")).body, { lists: [] });
  const hidden = await get("/buylist/api/fixed?id=" + SEED.id);
  const unknown = await get("/buylist/api/nothing-here");
  assert.equal(hidden.status, 404); assert.deepEqual(hidden.body, unknown.body);
  assert.equal((await get("/buylist/api/fixed?id=" + SEED.id + "&pv=wrong")).status, 404);
  const prev = await get("/buylist/api/fixed?id=" + SEED.id + "&pv=" + pv);
  assert.equal(prev.status, 200); assert.equal(prev.body.preview, true); assert.equal(prev.body.list.items[0].offers.loose.remaining, 50);
  assert.equal((await get("/buylist/api/fixedlists?pv=" + pv)).body.lists[0].id, SEED.id);
  // off: a submit is refused with the same not-found
  const refused = await post("/buylist/api/fixedsubmit?customer=3957471740057", { list: SEED.id, paymentType: "Cash", delivery: "in-store", lines: [{ item: "pikachu", cond: "loose", qty: 2 }] });
  assert.equal(refused.status, 404);
  await call(c, "/_stage/fl/set", { id: SEED.id, on: true });
  assert.equal((await get("/buylist/api/fixedlists")).body.lists[0].title, SEED.title);
  assert.equal((await get("/buylist/api/fixed?id=" + SEED.id)).body.preview, false);
  assert.equal((await post("/buylist/api/fixedsubmit?customer=3957471740057", { list: SEED.id, paymentType: "Cheque", lines: [] })).status, 400);
  const ok = await post("/buylist/api/fixedsubmit?customer=3957471740057", { list: SEED.id, paymentType: "Store Credit", delivery: "ship", lines: [{ item: "pikachu", cond: "loose", qty: 12 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.accepted, true); assert.equal(ok.body.staged, true); assert.equal(ok.body.units, 12); assert.equal(ok.body.noun, "item");
  assert.equal(ok.body.totals.credit, 44); assert.equal(ok.body.number, "9P-1001"); assert.equal(ok.body.delivery, "ship");
  assert.ok(ok.body.instructions && ok.body.instructions.sections.length);
  const rec = (await call(c, "/_stage/get?id=" + ok.body.id)).body.record;
  assert.equal(rec.fixed.list, SEED.id); assert.equal(rec.cards.length, 2); assert.equal(rec.delivery, "ship");
  assert.equal((await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list.items[0].offers.loose.bought, 12);
  // the shopper's own records list it like any other
  const mine = await get("/buylist/api/mine?customer=3957471740057");
  assert.equal(mine.body.records[0].cards[0].cardName, "Pikachu");
});

test("the record: emails say items, the worksheet approves without BinderPOS, the list shows the title", () => {
  const cards = [{ cardId: "fl:mcd:pikachu:loose", cardName: "Pikachu", setName: "McDonald's toys", game: "fixed", type: "Normal", condition: "loose", conditionName: "Loose", quantity: "3", cashBuyPrice: 3, storeCreditBuyPrice: 4, imageUrl: "https://cdn.shopify.com/x.png", fixed: { list: "mcd", item: "pikachu", cond: "loose", after: false } }];
  const r = shapeRecord({ customer: "3957471740057", customerName: "Ada", customerEmail: "ada@example.test", paymentType: "Cash", cards, fixed: { list: "mcd", title: "McDonald's toys" } }, T0);
  assert.deepEqual(r.fixed, { list: "mcd", title: "McDonald's toys" });
  assert.equal(shapeRecord({ customer: "1", paymentType: "Cash", cards, fixed: "nope" }, T0).fixed, null);
  r.number = "9P-1234";
  const e = buildEmail(r);
  assert.ok(e.html.includes(">Items<") && !e.html.includes(">Cards<"));
  assert.ok(e.text.includes("Items: 3"));
  const st = buildStaffBuylistEmail({ ...r, customerPhone: "" }, { staged: true });
  assert.ok(st.subject.startsWith("New McDonald's toys list 9P-1234: Ada - 3 items"));
  assert.ok(st.text.includes("fixed-price list: McDonald's toys (nothing goes to BinderPOS; pay at the counter)"));
  const sheet = renderSheet(r, { user: ADMIN, on: true, emailOn: true });
  assert.ok(sheet.includes("fixed-price · McDonald&#39;s toys"));
  assert.ok(sheet.includes('<button class="ok" type="submit">Approve</button>'));
  assert.ok(!sheet.includes("Approve → send to BinderPOS") && !sheet.includes('id="addcard"') && !sheet.includes('class="rg-open"'));
  assert.ok(sheet.includes("Pay it out at the counter"));
  const plain = renderSheet({ ...r, fixed: null }, { user: ADMIN, on: true, emailOn: true });
  assert.ok(plain.includes("Approve → send to BinderPOS") && plain.includes("Add a card"));
  const list = renderList({ records: [r], counts: { staged: 1 } }, { user: PRICER, on: true, emailOn: true });
  assert.ok(list.includes('title="fixed-price list">McDonald&#39;s toys</span>'));
});

test("the editor: the seed button, the switch, the preview link, the rows; the lists permission gates it", async () => {
  const none = renderLists({ user: ADMIN, lists: [], origin: "https://w.example" });
  assert.ok(none.includes('value="seed"') && none.includes("Create the McDonald's Pokémon list"));
  const l = cleanList({ ...SEED }, null, T0, "me");
  l.items[0].offers.loose = { ...OFFER, bought: 4 };
  const page = renderLists({ user: ADMIN, lists: [l], origin: "https://w.example" });
  assert.ok(!page.includes('value="seed"'));
  assert.ok(page.includes("OFF - nobody sees it") && page.includes('value="on"') && page.includes(">Switch on<"));
  assert.ok(page.includes("xgfl=" + SEED.id + "&amp;pv=" + l.pv + "#buylist"));
  assert.ok(page.includes('data-item="pikachu"') && page.includes('data-f="bought" value="4"') && page.includes("46 more"));
  assert.ok(page.includes('href="/9pocket/lists/control"') === false && page.includes('action="/9pocket/lists/control"'));
  const on = renderLists({ user: ADMIN, lists: [{ ...l, on: true }], origin: "https://w.example" });
  assert.ok(on.includes("ON - on the sell page") && on.includes(">Switch off<") && !on.includes('value="delete"'));
  assert.ok(renderLists({ user: PRICER, lists: [], denied: true }).includes("cannot edit the fixed-price lists"));
  // the route: denied without the permission, the control saves and switches
  const now = { t: T0 };
  const c = cx(now);
  const helpers = { html: (s, st) => new Response(s, { status: st || 200, headers: { "content-type": "text/html" } }), redirect: (to) => new Response(null, { status: 303, headers: { location: to } }), q: (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; }, toLogin: () => new Response(null, { status: 303, headers: { location: "/9pocket/login" } }), opts: { on: true, emailOn: true }, call: (path, body) => call(c, path, body).then((r) => r.body) };
  const url = (p) => new URL("https://w.example" + p);
  assert.equal((await serveListsStaff(new Request(url("/9pocket/lists")), {}, url("/9pocket/lists"), null, null, helpers)).status, 303);
  assert.equal((await serveListsStaff(new Request(url("/9pocket/lists")), {}, url("/9pocket/lists"), PRICER, null, { ...helpers, opts: { ...helpers.opts, user: PRICER } })).status, 403);
  const ok = await serveListsStaff(new Request(url("/9pocket/lists")), {}, url("/9pocket/lists"), LISTER, null, { ...helpers, opts: { ...helpers.opts, user: LISTER } });
  assert.equal(ok.status, 200); assert.ok((await ok.text()).includes('value="seed"'));
  const seeded = await serveListsStaff(new Request(url("/9pocket/lists/control"), { method: "POST" }), {}, url("/9pocket/lists/control"), LISTER, { action: "seed", __form: "1" }, { ...helpers, opts: { ...helpers.opts, user: LISTER } });
  assert.equal(seeded.status, 303); assert.ok(seeded.headers.get("location").includes("msg="));
  const saved = await serveListsStaff(new Request(url("/9pocket/lists/control"), { method: "POST" }), {}, url("/9pocket/lists/control"), LISTER, { action: "save", id: SEED.id, list: { title: "Toys", blurb: "b", items: [{ key: "pikachu", name: "Pikachu", image: "https://x/p.png", offers: { loose: { cash: "3", credit: "4" } } }] } }, { ...helpers, opts: { ...helpers.opts, user: LISTER } });
  assert.equal((await saved.json()).ok, true);
  const got = (await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list;
  assert.equal(got.title, "Toys"); assert.equal(got.items.length, 1); assert.equal(got.items[0].offers.loose.cash, 3); assert.equal(got.updatedBy, LISTER.email);
  const switched = await serveListsStaff(new Request(url("/9pocket/lists/control"), { method: "POST" }), {}, url("/9pocket/lists/control"), LISTER, { action: "on", id: SEED.id }, { ...helpers, opts: { ...helpers.opts, user: LISTER } });
  assert.ok((await switched.json()).message.includes("is ON"));
  assert.equal((await call(c, "/_stage/fl/get?id=" + SEED.id)).body.list.on, true);
  const del = await serveListsStaff(new Request(url("/9pocket/lists/control"), { method: "POST" }), {}, url("/9pocket/lists/control"), LISTER, { action: "delete", id: SEED.id }, { ...helpers, opts: { ...helpers.opts, user: LISTER } });
  assert.equal((await del.json()).ok, false);   // staff cannot delete, and it is on anyway
});

test("a list with the owner's own title: empty from the form, then the 15 toys added to it; or made with them from the start", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const H = { html: (s, st) => new Response(s, { status: st || 200 }), redirect: (to) => new Response(null, { status: 303, headers: { location: to } }), q: (o) => "?" + new URLSearchParams(Object.entries(o).filter(([, b]) => b)).toString(), toLogin: () => new Response(null, { status: 303 }), opts: { on: true, emailOn: true, user: ADMIN }, call: (path, body) => call(c, path, body).then((r) => r.body) };
  const url = (p) => new URL("https://w.example" + p);
  const ctl = (f) => serveListsStaff(new Request(url("/9pocket/lists/control"), { method: "POST" }), {}, url("/9pocket/lists/control"), ADMIN, f, H);
  // the owner's form, untouched (no withToys): an empty list under their title
  const made = await ctl({ action: "create", title: "2026 McDonalds Pokémon Toys", id: "", __form: "1" });
  assert.equal(made.status, 303); assert.ok(decodeURIComponent(made.headers.get("location")).replace(/\+/g, " ").includes("created (off). Add its items"));
  let l = (await call(c, "/_stage/fl/get?id=2026-mcdonalds-pokemon-toys")).body.list;
  assert.equal(l.title, "2026 McDonalds Pokémon Toys"); assert.equal(l.items.length, 0); assert.equal(l.on, false);
  // the editor offers the toys on that list
  const page = renderLists({ user: ADMIN, lists: [l] });
  assert.ok(page.includes('value="addseed"') && page.includes("Add the 15 McDonald's toys"));
  const added = await ctl({ action: "addseed", id: l.id });
  assert.ok((await added.json()).message.startsWith("Added the 15 McDonald's toys to \"2026 McDonalds Pokémon Toys\""));
  l = (await call(c, "/_stage/fl/get?id=2026-mcdonalds-pokemon-toys")).body.list;
  assert.equal(l.items.length, 15); assert.equal(l.items[0].key, "pikachu"); assert.ok(l.items[0].image.startsWith("https://cdn.shopify.com/"));
  assert.deepEqual(l.items[0].offers.loose, { cash: null, credit: null, sell: null, fullUpTo: null, afterCash: null, afterCredit: null, max: null, bought: 0 });
  assert.ok(!renderLists({ user: ADMIN, lists: [l] }).includes('value="addseed"'));
  // a second press changes nothing; a list with some of them gets the rest
  assert.ok((await (await ctl({ action: "addseed", id: l.id })).json()).message.includes("already has all 15"));
  await call(c, "/_stage/fl/save", { id: l.id, list: { ...l, items: l.items.slice(0, 3) } });
  assert.ok(renderLists({ user: ADMIN, lists: [(await call(c, "/_stage/fl/get?id=" + l.id)).body.list] }).includes("(12 missing)"));
  assert.ok((await (await ctl({ action: "addseed", id: l.id })).json()).message.startsWith("Added the 12"));
  // the form with the box ticked starts with the toys
  await ctl({ action: "create", title: "Toys two", withToys: "1" });
  assert.equal((await call(c, "/_stage/fl/get?id=toys-two")).body.list.items.length, 15);
});
