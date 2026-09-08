import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCartNote, attribute, cardMatches, ORDER_LEAD_MS, ORDER_LAG_MS } from "../src/hold.js";

const NOTE = "BinderPOS Cart #32608973\n\n--- Tenders ---\n\nStore credit added to customer: $90.00\n\n--- Items sold to store ---\n\nPlease refer to cart #32608973 in the BinderPOS portal for buy items\n\n\n--- Total discount from transaction for bought items ---\n\n$-110.00";

test("a BinderPOS buy cart's order note", () => {
  const p = parseCartNote(NOTE);
  assert.equal(p.cart, "32608973");
  assert.equal(p.bought, true);
  assert.equal(p.boughtTotal, "-110.00");
  assert.deepEqual(p.tenders, ["Store credit added to customer: $90.00"]);
});

test("a sales-only cart and a non-BinderPOS note", () => {
  const p = parseCartNote("BinderPOS Cart #1\n\n--- Tenders ---\n\nCash: $20.00\n");
  assert.equal(p.cart, "1");
  assert.equal(p.bought, false);
  assert.equal(p.boughtTotal, null);
  assert.deepEqual(p.tenders, ["Cash: $20.00"]);
  const q = parseCartNote(null);
  assert.equal(q.cart, null);
  assert.equal(q.bought, false);
});

const rise = (ts, extra) => ({ ts, title: "Lightning Bolt [Magic Player Rewards 2010]", variantTitle: "Near Mint Foil", single: true, ...(extra || {}) });
const order = (ts, extra) => ({ id: "7", name: "#202119", ts, cart: "32608973", bought: true, ...(extra || {}) });

test("a rise inside the window is the cart's; outside it is not", () => {
  const t = 1_000_000_000;
  assert.equal(attribute(rise(t), [order(t - 5000)], []).reason, "cart");
  assert.equal(attribute(rise(t), [order(t - ORDER_LEAD_MS)], []).reason, "cart");
  assert.equal(attribute(rise(t), [order(t + ORDER_LAG_MS)], []).reason, "cart");
  assert.equal(attribute(rise(t), [order(t - ORDER_LEAD_MS - 1)], []).reason, "none");
  assert.equal(attribute(rise(t), [order(t + ORDER_LAG_MS + 1)], []).reason, "none");
  assert.equal(attribute(rise(t), [order(t, { bought: false })], []).reason, "none");
  const r = attribute(rise(t), [order(t - 30000, { cart: "far" }), order(t - 2000, { cart: "near" })], []);
  assert.equal(r.cart, "near");
  assert.equal(r.offset, 2);
  assert.equal(r.decision, "hold");
});

test("a submitted buylist's card matches by name, set, condition and finish", () => {
  const card = { n: "Lightning Bolt", s: "Magic Player Rewards 2010", c: "Near Mint", t: "Foil", q: 1 };
  assert.equal(cardMatches(card, rise(0)), true);
  assert.equal(cardMatches({ ...card, t: "Normal" }, rise(0)), false);
  assert.equal(cardMatches({ ...card, c: "Lightly Played" }, rise(0)), false);
  assert.equal(cardMatches({ ...card, n: "Other" }, rise(0)), false);
  assert.equal(cardMatches({ ...card, c: "" }, rise(0)), true);
  const r = attribute(rise(0), [], [{ number: "908722", cards: [card] }]);
  assert.equal(r.reason, "buylist");
  assert.equal(r.buylist, "908722");
});
