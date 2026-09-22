import { test } from "node:test";
import assert from "node:assert/strict";
import { planBuylistPrices, matchLine, finishKey, redactDetails } from "../src/stage-sync.js";

const THEIRS = [
  { id: 901, cardId: 101, cardName: "Sol Ring (Extended Art)", setName: "Commander Legends", type: "Normal", variantId: 1, variantName: "Near Mint", quantity: 1, cashBuyPrice: 5.28, storeCreditBuyPrice: 7.38, totalPrice: 5.28, productVariantId: "pv1" },
  { id: 902, cardId: 202, cardName: "Sol Ring", setName: "Judge Gift Cards 2005", type: "Foil", variantId: 1, variantName: "Near Mint", quantity: 1, cashBuyPrice: 488.88, storeCreditBuyPrice: 561.02, totalPrice: 488.88, productVariantId: "pv2" },
  { id: 903, cardId: 303, cardName: "Extra", setName: "X", type: "Non foil", variantId: 2, variantName: "Lightly Played", quantity: 2, cashBuyPrice: 1, storeCreditBuyPrice: 1.3, totalPrice: 2 },
];
const DETAILS = { id: 908738, paymentType: "Cash", approved: false, completed: false, ShopifyCustomer: { email: "a@b.c" }, customerEmail: "a@b.c", notes: "hi", cards: [{ id: 101 }], shopifyCustomerBuylistDetails: THEIRS, finalBuylistDetails: [] };
const OURS = [
  { cardId: "101", cardName: "Sol Ring (Extended Art)", setName: "Commander Legends", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "1", cashBuyPrice: 2, storeCreditBuyPrice: 2, staffPriced: true },
  { cardId: "202", cardName: "Sol Ring", setName: "Judge Gift Cards 2005", type: "Foil", condition: "", conditionName: "Near Mint", quantity: "1", cashBuyPrice: 488.88, storeCreditBuyPrice: 561.02 },
  { cardId: "404", cardName: "Missing", setName: "Y", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "1", cashBuyPrice: 3, storeCreditBuyPrice: 4 },
];

test("finishes: plain ones are one key, the rest match by name", () => {
  assert.equal(finishKey("Normal"), ""); assert.equal(finishKey("Non foil"), ""); assert.equal(finishKey(null), "");
  assert.equal(finishKey("Foil"), "foil"); assert.equal(finishKey("Reverse Holo"), "reverse holo");
});

test("a worksheet card finds its BinderPOS line by variant id, or by condition name when the id is missing", () => {
  assert.equal(matchLine(THEIRS, OURS[0]).id, 901);
  assert.equal(matchLine(THEIRS, OURS[1]).id, 902);            // condition "" -> by name, finish Foil
  assert.equal(matchLine(THEIRS, { ...OURS[1], type: "Normal" }), null);   // wrong finish
  assert.equal(matchLine(THEIRS, OURS[2]), null);
});

test("the plan: matched lines with both prices, the changes counted, unmatched on both sides, and the portal's payload shape", () => {
  const p = planBuylistPrices(DETAILS, OURS, "Cash");
  assert.equal(p.matched, 2); assert.equal(p.changes, 1);
  const sol = p.lines.find((l) => l.id === "901");
  assert.deepEqual({ bpCash: sol.bpCash, ourCash: sol.ourCash, bpCredit: sol.bpCredit, ourCredit: sol.ourCredit, change: sol.change, staffPriced: sol.staffPriced }, { bpCash: 5.28, ourCash: 2, bpCredit: 7.38, ourCredit: 2, change: true, staffPriced: true });
  assert.equal(p.lines.find((l) => l.id === "902").change, false);
  assert.deepEqual(p.unmatchedOurs.map((x) => x.cardId), ["404"]);
  assert.deepEqual(p.unmatchedTheirs.map((x) => x.id), ["903"]);
  // payload: their object, cards dropped, only the matched line changed, its total recomputed for the payment type
  assert.ok(!("cards" in p.payload) && p.payload.id === 908738 && p.payload.paymentType === "Cash");
  const l1 = p.payload.shopifyCustomerBuylistDetails.find((l) => l.id === 901);
  assert.deepEqual({ cash: l1.cashBuyPrice, credit: l1.storeCreditBuyPrice, qty: l1.quantity, total: l1.totalPrice, pv: l1.productVariantId }, { cash: 2, credit: 2, qty: 1, total: 2, pv: "pv1" });
  assert.deepEqual(p.payload.shopifyCustomerBuylistDetails.find((l) => l.id === 903), THEIRS[2]);   // untouched
  // store credit: the total follows the credit price
  const pc = planBuylistPrices(DETAILS, OURS, "Store Credit");
  assert.equal(pc.payload.shopifyCustomerBuylistDetails.find((l) => l.id === 901).totalPrice, 2);
  // the printed copy carries no customer
  const red = redactDetails(p.payload);
  assert.equal(red.ShopifyCustomer, "<present>"); assert.equal(red.customerEmail, "<present>"); assert.equal(red.notes, "<present>");
  assert.equal(red.shopifyCustomerBuylistDetails.length, 3);
});
