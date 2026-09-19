import { test } from "node:test";
import assert from "node:assert/strict";
import { totalsOf, shapeRecord, mineView, applyEdit, stagingOn, safeImage } from "../src/stage.js";

const CARDS = [
  { cardId: 101, cardName: "Lightning Bolt", setName: "Magic 2011", game: "mtg", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "3", cashBuyPrice: 1.5, storeCreditBuyPrice: 1.95, shopifyVariantId: 9 },
  { cardId: 202, cardName: "Sol Ring", setName: "Commander Legends", game: "mtg", type: "Foil", condition: 2, conditionName: "Lightly Played", quantity: "1", cashBuyPrice: 2, storeCreditBuyPrice: 2.6, shopifyVariantId: 10 },
];

test("totals: units and money over the repriced lines", () => {
  const t = totalsOf(CARDS);
  assert.equal(t.units, 4);
  assert.equal(t.lines, 2);
  assert.equal(t.cash, 6.5);
  assert.equal(t.credit, 8.45);
  assert.deepEqual(totalsOf(null), { cash: 0, credit: 0, units: 0, lines: 0 });
});

test("a record needs a customer, a payment type and at least one card", () => {
  const now = 1_700_000_000_000;
  const r = shapeRecord({ customer: "3957471740057", paymentType: "Store Credit", cards: CARDS, repriced: { changed: ["x"], capped: [], dropped: [] } }, now);
  assert.ok(r && r.id.startsWith("01700000000000-"));
  assert.equal(r.status, "staged");
  assert.equal(r.customer, "3957471740057");
  assert.equal(r.totals.units, 4);
  assert.deepEqual(r.repriced, { changed: ["x"], capped: [], dropped: [] });
  assert.deepEqual(r.events.map((e) => e.action), ["submitted"]);
  assert.equal(r.customerName, "");
  const named = shapeRecord({ customer: "3957471740057", customerName: "  Ada Lovelace ", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS }, now);
  assert.equal(named.customerName, "Ada Lovelace");
  assert.equal(named.customerEmail, "ada@example.test");
  assert.equal(shapeRecord({ customer: "abc", paymentType: "Cash", cards: CARDS }, now), null);
  assert.equal(shapeRecord({ customer: "3957471740057", paymentType: "", cards: CARDS }, now), null);
  assert.equal(shapeRecord({ customer: "3957471740057", paymentType: "Cash", cards: [] }, now), null);
});

test("the shopper's view carries status and totals, never the staff note or the reply", () => {
  const r = shapeRecord({ customer: "3957471740057", customerName: "Ada Lovelace", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS }, 5);
  r.note = "check the foil"; r.status = "approved"; r.bp = { number: "8812", upstream: 200, cleared: 200, reply: { secret: true } };
  r.events.push({ ts: 9, action: "approved" });
  const v = mineView(r);
  assert.equal(v.status, "approved");
  assert.equal(v.reference, "8812");
  assert.equal(v.decidedAt, 9);
  assert.equal(v.cards.length, 2);
  assert.equal(v.cards[0].cardName, "Lightning Bolt");
  assert.ok(!("note" in v));
  assert.ok(!("bp" in v));
  assert.ok(!("customerName" in v) && !("customerEmail" in v));
  assert.ok(!JSON.stringify(v).includes("Lovelace"));
  assert.equal(v.customerNote, "");
  r.status = "rejected"; r.customerNote = "condition was Heavily Played";
  assert.equal(mineView(r).customerNote, "condition was Heavily Played");
});

test("a staff edit changes quantities or removes lines and can never add one", () => {
  const r = shapeRecord({ customer: "3957471740057", paymentType: "Cash", cards: CARDS }, 5);
  const out = applyEdit(r, [
    { cardId: "101", condition: "1", type: "normal", quantity: "2" },     // quantity down
    { cardId: "202", condition: "2", type: "foil", quantity: "0" },       // removed
    { cardId: "999", condition: "1", type: "normal", quantity: "5" },     // not in the record: ignored
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].cardId, 101);
  assert.equal(out[0].quantity, "2");
  assert.equal(out[0].cashBuyPrice, 1.5);   // price untouched by an edit
  // an untouched line keeps its quantity
  assert.equal(applyEdit(r, [])[0].quantity, "3");
});

test("a thumbnail is drawn only from an https image URL", () => {
  assert.equal(safeImage("https://product-images.tcgplayer.com/714709.jpg"), "https://product-images.tcgplayer.com/714709.jpg");
  assert.equal(safeImage(" https://x.example/a.png "), "https://x.example/a.png");
  assert.equal(safeImage("http://x.example/a.png"), "");
  assert.equal(safeImage("javascript:alert(1)"), "");
  assert.equal(safeImage('https://x.example/a.png" onerror="alert(1)'), "");
  assert.equal(safeImage(null), "");
  assert.equal(safeImage("https://x.example/" + "a".repeat(500)), "");
});

test("staging is on unless the var says off", () => {
  assert.equal(stagingOn({}), true);
  assert.equal(stagingOn({ BUYLIST_STAGING: "on" }), true);
  assert.equal(stagingOn({ BUYLIST_STAGING: "OFF " }), false);
  assert.equal(stagingOn(undefined), true);
});
