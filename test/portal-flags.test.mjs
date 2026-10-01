// Cart flags: store credit paid to nobody, and low-margin buys (owner 2026-10-01).
import test from "node:test";
import assert from "node:assert/strict";
import { cartFlags, LOW_MARGIN_PCT } from "../src/portal.js";

const line = (o) => ({ id: "1", title: "Card", condition: "Near Mint", qty: 1, buying: true, paid: null, price: null, sell: null, image: "", discount: null, ...o });

test("store credit paid out with no customer is flagged with the amount; with a customer it is not", () => {
  const cart = { customer: null, payout: { cash: 0, credit: 0.99, other: 0, total: 0.99 }, lines: [line({ paid: 1.08, sell: 2.4 })] };
  assert.equal(cartFlags(cart).creditNoCustomer, 0.99);
  assert.equal(cartFlags({ ...cart, customer: { id: "5", name: "x" } }).creditNoCustomer, 0);
  assert.equal(cartFlags({ ...cart, payout: { cash: 0.99, credit: 0, other: 0, total: 0.99 } }).creditNoCustomer, 0);
});

test("low margin: lines paid above the threshold of their sell price, worst first; unpriced lines counted apart", () => {
  assert.equal(LOW_MARGIN_PCT, 75);
  const cart = { customer: { id: "5" }, payout: { cash: 10, credit: 0, other: 0, total: 10 }, lines: [
    line({ title: "fine", paid: 1.08, sell: 2.4 }),          // 45%
    line({ title: "credit rate", paid: 2.48, sell: 3.55 }),  // 70% - normal store-credit rate, not flagged
    line({ title: "steep", paid: 4.0, sell: 5.0, qty: 2 }),  // 80%
    line({ title: "over", paid: 6.0, sell: 5.0 }),           // 120%
    line({ title: "no price", paid: 3.0, sell: null }),
    line({ title: "sold", buying: false, price: 2.0, sell: 2.0 }),
  ] };
  const f = cartFlags(cart);
  assert.equal(f.lowMargin, 2);
  assert.equal(f.worstPct, 120);
  assert.equal(f.unpriced, 1);
  assert.deepEqual(f.lowLines.map((l) => l.title + " " + l.pct), ["steep 80", "over 120"]);
  assert.deepEqual(cartFlags({}), { creditNoCustomer: 0, lowMargin: 0, worstPct: 0, unpriced: 0, lowLines: [] });
});
