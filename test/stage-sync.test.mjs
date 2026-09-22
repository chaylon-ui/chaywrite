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

test("the real save: refuses without the right confirm or once BinderPOS has approved; posts the plan payload and verifies the re-read", async () => {
  const { pushBuylistPrices } = await import("../src/stage-sync.js");
  const rec = { id: "x", number: "9P-1004", paymentType: "Cash", bp: { number: "908738" }, cards: OURS.slice(0, 2) };
  // portal stubs are reached through the module's imports, so drive them with a fake fetch on api.binderpos.com
  const calls = [];
  const before = JSON.parse(JSON.stringify(DETAILS));
  const after = JSON.parse(JSON.stringify(DETAILS)); after.shopifyCustomerBuylistDetails[0].cashBuyPrice = 2; after.shopifyCustomerBuylistDetails[0].storeCreditBuyPrice = 2;
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("identitytoolkit")) return new Response(JSON.stringify({ idToken: "t", refreshToken: "r", expiresIn: "3600" }), { status: 200 });
    if (u.endsWith("/details")) { reads++; return new Response(JSON.stringify(reads === 1 ? before : after), { status: 200 }); }
    if (u.endsWith("/api/buylist/save")) { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 908738 }), { status: 200 }); }
    return new Response("nope", { status: 404 });
  };
  const env = { BINDERPOS_LOGIN_EMAIL: "s@x", BINDERPOS_LOGIN_PASSWORD: "p" };
  assert.match((await pushBuylistPrices(env, rec, { confirm: "1" })).error, /confirm must be/);
  const r = await pushBuylistPrices(env, rec, { confirm: "908738" });
  assert.equal(r.ok, true); assert.equal(r.saved, true); assert.equal(r.verified, true); assert.equal(r.changes, 1);
  assert.equal(calls.length, 1); assert.ok(!("cards" in calls[0])); assert.equal(calls[0].shopifyCustomerBuylistDetails[0].cashBuyPrice, 2);
  assert.equal(calls[0].ShopifyCustomer.email, "a@b.c");   // the real payload keeps the customer block
  assert.deepEqual(r.checks[0].now, { qty: 1, cash: 2, credit: 2 });
  // approved in BinderPOS: refused before any save
  reads = 0; before.approved = true;
  const no = await pushBuylistPrices(env, rec, { confirm: "908738" });
  assert.equal(no.ok, false); assert.match(no.error, /already has this buylist approved/); assert.equal(calls.length, 1);
});

test("conditionsFor: BinderPOS's conditions for one card, each with the offer per finish", async () => {
  const { conditionsFor } = await import("../src/buylist.js");
  const saved = globalThis.fetch;
  const posted = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("identitytoolkit")) return new Response(JSON.stringify({ idToken: "t", refreshToken: "r", expiresIn: "3600" }), { status: 200 });
    if (u.endsWith("/supportedGames")) return new Response(JSON.stringify([{ gameId: "mtg", gameName: "Magic: The Gathering" }]), { status: 200 });
    if (u.endsWith("/api/buylists/cards/allPrices")) {
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify([{ id: 101, variants: [
        { id: 1768, variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", legacyType: "Normal", buyPrice: 1.5, creditBuyPrice: 1.95, maxPurchaseQuantity: 8, productVariantId: 501 }, { type: "Foil", buyPrice: 4, creditBuyPrice: 5.2, maxPurchaseQuantity: 0, canPurchaseOverstock: true, overStockBuyPrice: 2, creditOverstockBuyPrice: 2.6 }] },
        { id: 1769, variantName: "Lightly Played", cardBuylistTypes: [{ type: "Normal", buyPrice: 1.1, creditBuyPrice: 1.43, maxPurchaseQuantity: 8 }] },
      ] }]), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  try {
    const env = { BINDERPOS_LOGIN_EMAIL: "s@x", BINDERPOS_LOGIN_PASSWORD: "p" };
    const conds = await conditionsFor(env, { cardId: "101", game: "mtg", type: "Normal" });
    assert.deepEqual(posted[0], [{ game: "mtg", ids: [101] }]);
    assert.deepEqual(conds.map((c) => [c.id, c.name]), [[1768, "Near Mint"], [1769, "Lightly Played"]]);
    assert.equal(conds[0].offers.normal.buy, 1.5); assert.equal(conds[0].offers.normal.productVariantId, 501);
    assert.equal(conds[0].offers.foil.max, 0); assert.equal(conds[0].offers.foil.overstock, true); assert.equal(conds[0].offers.foil.overBuy, 2);
    assert.equal(conds[1].offers.foil, undefined);
    assert.deepEqual(await conditionsFor(env, { cardId: "999", game: "mtg" }), []);
    await assert.rejects(conditionsFor({}, { cardId: "101" }), /not configured/);
  } finally { globalThis.fetch = saved; }
});
