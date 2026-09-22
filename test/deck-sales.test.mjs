import { test } from "node:test";
import assert from "node:assert/strict";
import { deckSaleOf } from "../src/deck-sales.js";

const line = (title, quantity, productType, amount, deck) => ({ title, quantity, product: { productType }, originalTotalSet: { shopMoney: { amount: String(amount) } }, customAttributes: deck ? [{ key: "_deck", value: "1" }] : [] });
const order = (name, attrs, lines, total) => ({ name, createdAt: "2026-09-22T19:29:03Z", displayFinancialStatus: "PAID", totalPriceSet: { shopMoney: { amount: String(total) } }, customAttributes: attrs, lineItems: { nodes: lines } });
const DB = [{ key: "Deck Builder", value: "Magic: The Gathering, 1 card, $4.95" }];

test("order #205473: a stale cart attribute over a sealed-only cart is not a Deck Builder sale", () => {
  assert.equal(deckSaleOf(order("#205473", DB, [line("MTG REALITY FRACTURE COMMANDER DECK PRE ORDER ^ SEPT 25/26", 1, "Magic Sealed Product", 89.95, false)], 89.95)), null);
});

test("lines tagged _deck count, and only their value", () => {
  const r = deckSaleOf(order("#1", DB, [line("Sol Ring [Commander 2016]", 2, "MTG Single", 6.10, true), line("Booster Box", 1, "Magic Sealed Product", 150, false)], 156.10));
  assert.equal(r.mode, "lines"); assert.equal(r.cents, 610); assert.equal(r.tag, "Magic: The Gathering, 1 card, $4.95");
  assert.deepEqual(r.items.map((i) => [i.t, i.q, i.d]), [["Sol Ring [Commander 2016]", 2, 1], ["Booster Box", 1, 0]]);
  assert.equal(deckSaleOf(order("#2", [], [line("Sol Ring [Commander 2016]", 1, "MTG Single", 3.05, true)], 3.05)).mode, "lines");   // no cart attribute needed
});

test("attribute-only orders (before the line property) count when a single was bought, at the whole order's value", () => {
  const r = deckSaleOf(order("#3", DB, [line("Sol Ring [Commander 2016]", 1, "MTG Single", 3.05, false), line("Sleeves", 1, "Supplies", 9.99, false)], 13.04));
  assert.equal(r.mode, "legacy"); assert.equal(r.cents, 1304);
  assert.equal(deckSaleOf(order("#4", [], [line("Sol Ring [Commander 2016]", 1, "MTG Single", 3.05, false)], 3.05)), null);   // no attribute, no tag: not ours
  assert.equal(deckSaleOf(null), null);
});
