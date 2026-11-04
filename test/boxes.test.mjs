import test from "node:test";
import assert from "node:assert/strict";
import { rowOf, rowsOf, boxesOf, condOf, copiesOf, setCards, SETS_PER_BOX, FEED_PAGE, STORE } from "../src/boxes.js";

const v = (sid, title, price, qty) => ({ shopifyId: sid, title, price, quantity: qty });
const product = (title, variants, img) => ({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, ""), img: img || "", variants });

test("a row from the feed: the best non-foil copy in stock, the foil only when that is all, the Shopify variant id, nothing in stock -> null", () => {
  const r = rowOf(product("Lightning Bolt [Modern Horizons 3]", [v(1, "Near Mint", 3.5, 0), v(2, "Lightly Played", 3.1, 2), v(3, "Near Mint Foil", 9, 1)], "https://images.binderpos.com/x.jpg"));
  assert.deepEqual(r, ["Lightning Bolt", "lightning-bolt-modern-horizons-3", "3.10", "https://images.binderpos.com/x.jpg", "2", "Lightly Played", 0, 3]);
  const f = rowOf(product("Sol Ring [Commander Masters]", [v(1, "Near Mint", 3, 0), v(3, "Lightly Played Foil", 8, 1), v(4, "Near Mint Foil", 9, 2)]));
  assert.deepEqual([f[2], f[5], f[6], f[7]], ["9.00", "Near Mint", 1, 3]);
  assert.equal(rowOf(product("Gone [Set]", [v(1, "Near Mint", 3, 0)])), null);
  assert.equal(rowOf(product("Freebie [Set]", [v(1, "Near Mint", 0, 4)])), null);
  assert.equal(rowOf(product("No Set", [v(1, "Near Mint / English", 2, 1)]))[5], "Near Mint");
  assert.equal(condOf("Heavily Played Holofoil"), "Heavily Played");
  // alphabetical, numeric-aware, dearest first among namesakes
  const rows = rowsOf([product("Swamp (10) [S]", [v(1, "Near Mint", 1, 1)]), product("Swamp (2) [S]", [v(2, "Near Mint", 1, 1)]), product("Ant [S]", [v(3, "Near Mint", 1, 1)]), product("Gone [S]", [v(4, "Near Mint", 1, 0)])]);
  assert.deepEqual(rows.map((r) => r[0]), ["Ant", "Swamp (2)", "Swamp (10)"]);
});

test("boxesOf: the set names, alphabetical and deduped, cut into boxes labelled by initials", () => {
  const names = Array.from({ length: 150 }, (_, i) => "Set " + String.fromCharCode(65 + (i % 26)) + " " + i).concat(["Alpha", "Alpha", "", "zendikar"]);
  const { sets, boxes } = boxesOf(names);
  assert.equal(sets.length, 152);
  assert.equal(boxes.length, Math.ceil(152 / SETS_PER_BOX));
  assert.equal(boxes[0].sets[0], "Alpha");
  assert.equal(boxes[boxes.length - 1].sets[boxes[boxes.length - 1].sets.length - 1], "zendikar");
  assert.ok(/^[A-Z#](?: – [A-Z#])?$/.test(boxes[0].label), boxes[0].label);
  assert.equal(boxesOf(["Only", "Two"]).boxes[0].label, "A – Z");
  assert.equal(boxesOf(["2017 Gift Pack", "Alpha"]).boxes[0].label, "A – Z");
});

test("setCards: pages the feed by FEED_PAGE until the count is reached, with the widget's body", async () => {
  const bodies = [];
  const fetcher = async (url, o) => {
    const b = JSON.parse(o.body); bodies.push(b);
    const page = b.offset === 0 ? Array.from({ length: FEED_PAGE }, (_, i) => product("Card " + i + " [Dominaria]", [v(1000 + i, "Near Mint", 1 + i, 1)])) : [product("Last [Dominaria]", [v(9, "Near Mint", 2, 1)])];
    return new Response(JSON.stringify({ count: FEED_PAGE + 1, products: page }), { status: 200 });
  };
  const r = await setCards("mtg", "Dominaria", fetcher);
  assert.equal(r.rows.length, FEED_PAGE + 1); assert.equal(r.count, FEED_PAGE + 1);
  assert.deepEqual(bodies.map((b) => b.offset), [0, FEED_PAGE]);
  assert.deepEqual([bodies[0].storeUrl, bodies[0].game, bodies[0].setNames, bodies[0].instockOnly, bodies[0].limit, bodies[0].sortTypes[0].type], [STORE, "mtg", ["Dominaria"], true, FEED_PAGE, "number"]);
});

test("copiesOf: every copy in stock at a price, non-foil first by condition, then foil", () => {
  const vv = (id, title, price, qty) => ({ id: "gid://shopify/ProductVariant/" + id, title, price: String(price), inventoryQuantity: qty, availableForSale: qty > 0 });
  const out = copiesOf({ variants: { nodes: [vv(5, "Heavily Played Foil", 4, 1), vv(1, "Near Mint", 3.5, 0), vv(2, "Lightly Played", 3.1, 2), vv(3, "Near Mint Foil", 9, 1), vv(4, "Moderately Played", 2.8, 5), vv(6, "Damaged", 0, 3)] } });
  assert.deepEqual(out.map((k) => [k.variantId, k.condition, k.foil, k.price, k.qty]), [["2", "Lightly Played", false, "3.10", 2], ["4", "Moderately Played", false, "2.80", 5], ["3", "Near Mint", true, "9.00", 1], ["5", "Heavily Played", true, "4.00", 1]]);
  assert.deepEqual(copiesOf(null), []);
});
