import test from "node:test";
import assert from "node:assert/strict";
import { rowOf, rowsOf, boxesOf, condOf, copiesOf, setCards, SETS_PER_BOX, FEED_PAGE, STORE, sealedOf, sealedName, preorderDate, serveSealed, SEALED_MAX } from "../src/boxes.js";

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

/* New sealed booster boxes on the 3D shop's back wall (owner, 2026-11-09). */
test("sealedOf: booster boxes in stock, newest first as fed; packs, cases and pre-orders still to come are left out; titles cleaned", async () => {
  const now = Date.UTC(2026, 10, 9);
  const P = (title, qty, o) => Object.assign({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), createdAt: "2026-11-04T17:04:27Z", media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/a.jpg", width: 729, height: 1000 } } }] }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/42", price: "279.95", inventoryQuantity: qty }] } }, o || {});
  assert.equal(preorderDate("MTG X BOOSTER BOX"), null);
  assert.equal(preorderDate("MTG STAR TREK PLAY BOOSTER BOX  PRE ORDER ^ NOV 6/26"), Date.UTC(2026, 10, 6));
  assert.equal(preorderDate("YGO X BOOSTER BOX PRE ORDER ^ JAN 29/27"), Date.UTC(2027, 0, 29));
  assert.ok(Number.isNaN(preorderDate("X BOOSTER BOX PRE-ORDER soon")));
  assert.equal(sealedName("MTG STAR TREK COLLECTOR BOOSTER BOX (LIMIT 2)"), "MTG STAR TREK COLLECTOR BOOSTER BOX");
  assert.equal(sealedName("MTG STAR TREK PLAY BOOSTER BOX  PRE ORDER ^ NOV 6/26"), "MTG STAR TREK PLAY BOOSTER BOX");
  const rows = sealedOf([
    P("POKEMON ME06 DELTA REIGN BOOSTER PACK", 1459), P("POKEMON ME06 DELTA REIGN BOOSTER BUNDLE", 84), P("POKEMON ME06 DELTA REIGN BOOSTER BOX", 40),
    P("STAR WARS UNLIMITED ICONS 2027 BOOSTER CASE PRE ORDER ^ NOV 20/26", 2), P("STAR WARS UNLIMITED ICONS 2027 BOOSTER BOX PRE ORDER ^ NOV 20/26", 16),
    P("MTG STAR TREK PLAY BOOSTER BOX  PRE ORDER ^ NOV 6/26", 144), P("X BOOSTER BOX PRE-ORDER soon", 5), P("SOLD OUT BOOSTER BOX", 0),
    P("NO PICTURE BOOSTER BOX (LIMIT 1)", 3, { media: { nodes: [] } }), P("BOOSTER BOX CASE OF 6", 2),
  ], now);
  assert.deepEqual(rows.map((r) => r.name), ["POKEMON ME06 DELTA REIGN BOOSTER BOX", "MTG STAR TREK PLAY BOOSTER BOX", "NO PICTURE BOOSTER BOX"]);
  assert.deepEqual(rows[0], { name: "POKEMON ME06 DELTA REIGN BOOSTER BOX", handle: "pokemon-me06-delta-reign-booster-box", price: "279.95", image: "https://cdn.shopify.com/a.jpg", ar: 0.73, variantId: "42", qty: 40, added: "2026-11-04" });
  assert.equal(rows[2].image, null); assert.equal(rows[2].ar, 1);
  assert.equal(sealedOf(Array.from({ length: 20 }, (_, i) => P("SET " + i + " BOOSTER BOX", 1)), now).length, SEALED_MAX);
  // the route: the game's product type in the search, an unknown game answers an empty wall, a Shopify error is reported
  const seen = [];
  const go = (q, gqlFn) => serveSealed(new Request("https://w.example/showcase/sealed.json" + q), {}, {}, new URL("https://w.example/showcase/sealed.json" + q), { gqlFn, now });
  let j = await (await go("?game=pokemon", async (qq, v) => { seen.push(v.q); return { data: { products: { nodes: [P("POKEMON ME06 DELTA REIGN BOOSTER BOX", 40)] } } }; })).json();
  assert.equal(j.ok, true); assert.equal(j.game, "pokemon"); assert.equal(j.rows.length, 1);
  assert.match(seen[0], /product_type:"Pokemon Sealed Product"/); assert.match(seen[0], /inventory_total:>0/);
  j = await (await go("?game=chess", async () => { throw new Error("not called"); })).json(); assert.deepEqual(j.rows, []);
  j = await (await go("?game=mtg", async () => { throw new Error("shopify down"); })).json(); assert.equal(j.ok, false);
});
