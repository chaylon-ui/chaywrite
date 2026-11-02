// Buylists being shipped (src/ship.js + the /_stage/ship/* room routes): the choice, the
// customer's tracking page, the staff actions, the one chase, the emails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageDoFetch, shapeRecord } from "../src/stage.js";
import { cleanTracking, carrierGuess, carrierLink, renderTrack, shipView, serveTrack, shipChase, shipAsk, trackUrl, TRACK_PATH, CHASE_AFTER_MS } from "../src/ship.js";
import { buildTrackingEmail, buildEmail } from "../src/stage-email.js";

class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, JSON.parse(JSON.stringify(b))); return; } this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
}
const T0 = 1_762_000_000_000;
function world() {
  const now = { t: T0 };
  const c = { storage: new MemStorage(), env: {}, now: () => now.t, log: () => {}, mem: {} };
  const env = { ROOM: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { const url = new URL(req.url); return stageDoFetch(c, req, url); } }) } };
  c.env = env;
  return { c, env, now };
}
const DAY = 86400e3;

test("tracking numbers: cleaned, carrier guessed, carrier link", () => {
  assert.equal(cleanTracking(" 1234 5678 9012 3456 "), "1234567890123456");
  assert.equal(cleanTracking("1z999aa10123456784"), "1Z999AA10123456784");
  assert.equal(cleanTracking("12-3"), "", "too short");
  assert.equal(cleanTracking("<script>"), "");
  assert.equal(carrierGuess("1234567890123456"), "canada-post");
  assert.equal(carrierGuess("RA123456789CA"), "canada-post");
  assert.equal(carrierGuess("1Z999AA10123456784"), "ups");
  assert.equal(carrierGuess("123456789012"), "fedex");
  assert.equal(carrierGuess("ABCDEFG"), "");
  assert.match(carrierLink("canada-post", "1234567890123456"), /^https:\/\/www\.canadapost-postescanada\.ca\/.*1234567890123456$/);
  assert.equal(carrierLink("other", "ABCDEFG"), "");
});

test("the side record: put, the customer's tracking by token, the staff state, one chase", async () => {
  const { c, env, now } = world();
  const put = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88123", customer: "3957471740057", customerName: "Pat Example", customerEmail: "pat@example.test", paymentType: "Cash", totals: { cash: 42.5, credit: 55.25, units: 7, lines: 3 }, delivery: "ship" }) }))).json();
  assert.equal(put.ok, true);
  assert.match(put.token, /^[a-z0-9]{20,}$/);
  assert.equal(put.record.state, "awaiting");
  assert.equal(put.record.delivery, "ship");
  // a put without a choice is refused; a second put only changes the choice and keeps the token
  const bad = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88124" }) }))).json();
  assert.equal(bad.ok, false);
  const again = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88123", delivery: "in-store" }) }))).json();
  assert.equal(again.token, put.token);
  assert.equal(again.record.delivery, "in-store");
  await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/set", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88123", delivery: "ship", by: "ada@x.test" }) }))).json();
  // the customer's page: the wrong token is a 404, the right one shows the form, a save records the number and the carrier
  const url = new URL(trackUrl("https://w", "88123", "nope"));
  let r = await serveTrack(new Request(url), env, url, { form: {} });
  assert.equal(r.status, 404);
  const good = new URL(trackUrl("https://w", "88123", put.token));
  r = await serveTrack(new Request(good), env, good, { form: {} });
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.match(page, /Add your tracking number/);
  assert.match(page, /Buylist <b>88123<\/b> · 7 cards · Cash/);
  assert.match(page, /name="t" value="/);
  const sent = [];
  env.RESEND_API_KEY = "re_test";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "em_1" }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const post = new URL("https://w" + TRACK_PATH);
    r = await serveTrack(new Request(post, { method: "POST" }), env, post, { form: { n: "88123", t: put.token, tracking: "1234 5678 9012 3456", carrier: "" }, notifyTo: ["staff@x.test"] });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /We will watch for Canada Post 1234567890123456/);
    assert.equal(sent.length, 1, "staff told once");
    assert.match(sent[0].subject, /Buylist 88123: tracking number added/);
    assert.equal(sent[0].to[0], "staff@x.test");
    assert.equal(sent[0].reply_to, "pat@example.test", "reply goes to the customer");
    assert.doesNotMatch(sent[0].html + sent[0].text, /pat@example\.test/, "the address is not in the body");
  } finally { globalThis.fetch = realFetch; }
  const rec = (await c.storage.get("sh:88123"));
  assert.equal(rec.state, "shipped");
  assert.equal(rec.tracking, "1234567890123456");
  assert.equal(rec.carrier, "canada-post");
  assert.equal(rec.trackedBy, "customer");
  assert.equal(rec.delivery, "ship", "the list was in-store at the time; a tracking number makes it a shipped one");
  // a bad number on the page is refused with the form kept
  const post2 = new URL("https://w" + TRACK_PATH);
  r = await serveTrack(new Request(post2, { method: "POST" }), env, post2, { form: { n: "88123", t: put.token, tracking: "12", carrier: "" } });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /does not look like a tracking number/);
  // staff: received, then the view carries no token
  const set = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/set", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88123", state: "received", by: "ada@x.test" }) }))).json();
  assert.equal(set.record.state, "received");
  assert.equal(set.record.receivedBy, "ada@x.test");
  const v = shipView(set.record);
  assert.equal(v.token, undefined);
  assert.equal(v.carrierName, "Canada Post");
  assert.match(v.trackingUrl, /canadapost/);
  assert.equal(v.stateLabel, "received");
  assert.deepEqual(set.record.events.map((e) => e.action), ["submitted · ship", "delivery changed to in-store", "delivery changed to ship", "tracking canada-post 1234567890123456", "marked received"]);
  // the chase: a shipped list with no tracking, three days on, once; a received or tracked one never
  const put2 = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88200", customer: "1", customerName: "Sam", customerEmail: "sam@example.test", paymentType: "Store Credit", totals: { cash: 1, credit: 2, units: 1, lines: 1 }, delivery: "ship" }) }))).json();
  assert.equal(put2.ok, true);
  await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: "88201", customer: "2", customerEmail: "in@example.test", paymentType: "Cash", delivery: "in-store" }) }))).json();
  let ch = await shipChase(env, T0 + 2 * DAY);
  assert.deepEqual(ch, { due: 0, sent: 0, failed: 0 }, "too soon");
  const mails = [];
  globalThis.fetch = async (u, init) => { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "em_2" }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    now.t = T0 + 3 * DAY + 1000;
    ch = await shipChase(env, now.t);
    assert.deepEqual(ch, { due: 1, sent: 1, failed: 0 });
    assert.equal(mails[0].to[0], "sam@example.test");
    assert.match(mails[0].subject, /Buylist 88200 - a tracking number when you have one/);
    assert.match(mails[0].html, /images\.pricecharting|90A38806-3E70-440D-9CA9-E869B6C38946\.png/, "the Mallow banner rides along");
    assert.match(mails[0].html, new RegExp("/buylist/track\\?n=88200&amp;t=" + put2.token));
    assert.match(mails[0].text, new RegExp("/buylist/track\\?n=88200&t=" + put2.token));
    ch = await shipChase(env, now.t + DAY);
    assert.deepEqual(ch, { due: 0, sent: 0, failed: 0 }, "never a second");
    const r2 = await c.storage.get("sh:88200");
    assert.ok(r2.chasedAt > 0);
    assert.equal(r2.lastAsk.kind, "chase");
    assert.equal(r2.lastAsk.to, "s***@example.test");
    // the staff button: the ask email, recorded
    const ask = await shipAsk(env, "88200", "ada@x.test");
    assert.equal(ask.ok, true);
    assert.match(mails[1].subject, /Buylist 88200 - could you add your tracking number/);
    assert.equal(ask.record.lastAsk.kind, "ask");
    assert.ok(ask.record.askedAt > 0);
  } finally { globalThis.fetch = realFetch; }
  // the due query ignores a list older than the window
  const old = await c.storage.get("sh:88200"); old.chasedAt = null; old.ts = T0 - 40 * DAY; await c.storage.put("sh:88200", old);
  const due = await (await env.ROOM.get().fetch(new Request("https://w/_stage/ship/due", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: now.t }) }))).json();
  assert.equal(due.records.length, 0);
});

test("the emails: the confirmation says the choice back and carries the link; the tracking emails name the list", () => {
  const rec = { number: "9P-1042", customerName: "Pat Example", paymentType: "Cash", cards: [{ cardName: "Sol Ring", setName: "C21", conditionName: "Near Mint", quantity: 1, cashBuyPrice: 2, storeCreditBuyPrice: 2.6 }], totals: { cash: 2, credit: 2.6, units: 1, lines: 1 }, delivery: "ship", trackUrl: "https://w/buylist/track?n=9P-1042&t=abc" };
  const m = buildEmail(rec);
  assert.match(m.html, /You told us you are shipping the cards\./);
  assert.match(m.html, /href="https:\/\/w\/buylist\/track\?n=9P-1042&amp;t=abc"[^>]*>Add the tracking number</);
  assert.match(m.text, /shipping the cards\. When you have a tracking number, add it here: https:\/\/w\/buylist\/track\?n=9P-1042&t=abc/);
  const m2 = buildEmail({ ...rec, delivery: "in-store" });
  assert.match(m2.html, /You told us you are bringing the cards in\./);
  assert.match(m2.html, /Decide to ship instead\? <a href="https:\/\/w\/buylist\/track\?n=9P-1042&amp;t=abc"/, "the link is there for a change of mind");
  assert.doesNotMatch(buildEmail({ ...rec, delivery: "in-store", trackUrl: null }).html, /tracking number/);
  const m3 = buildEmail({ ...rec, delivery: null });
  assert.doesNotMatch(m3.html, /You told us/);
  assert.match(m3.html, /Shipping the cards\? <a href=/, "an older script sent no choice: the link still rides");
  const ask = buildTrackingEmail({ number: "88123", customerName: "Pat Example", totals: { units: 7 } }, "ask", "https://w/buylist/track?n=88123&t=tok");
  assert.match(ask.subject, /^Buylist 88123 - could you add your tracking number\?/);
  assert.match(ask.html, /Hi Pat,/);
  assert.match(ask.html, /\(7 cards\)/);
  assert.match(ask.html, /Add the tracking number/);
  assert.match(ask.html, /Bringing the cards in instead\? Then there is nothing to do\./);
  assert.match(ask.text, /https:\/\/w\/buylist\/track\?n=88123&t=tok/);
  const chase = buildTrackingEmail({ number: "88123", customerName: "", totals: { units: 1 } }, "chase", "https://w/x");
  assert.match(chase.subject, /a tracking number when you have one/);
  assert.match(chase.html, /Hello,/);
  assert.match(chase.html, /this is the only reminder we send/);
  assert.match(chase.html, /mallowgames\.com\/sell-your-games/);
  assert.doesNotMatch(chase.html, /<script/);
});

test("a staged record keeps the delivery choice", () => {
  const rec = shapeRecord({ customer: "1", paymentType: "Cash", cards: [{ cardId: 1, cardName: "A", setName: "S", quantity: 1, cashBuyPrice: 1, storeCreditBuyPrice: 1, condition: 1, conditionName: "Near Mint", type: "Normal" }], delivery: "ship" }, T0);
  assert.equal(rec.delivery, "ship");
  assert.equal(rec.events[0].action, "submitted · ship");
  assert.equal(shapeRecord({ customer: "1", paymentType: "Cash", cards: rec.cards, delivery: "teleport" }, T0).delivery, null);
  assert.equal(renderTrack({ notFound: true }).includes("That link is not valid"), true);
});
