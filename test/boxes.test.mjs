import test from "node:test";
import assert from "node:assert/strict";
import { rowOf, rowsOf, rowsFor, findRows, serveFind, boxesOf, condOf, copiesOf, setCards, SETS_PER_BOX, FEED_PAGE, STORE, sealedOf, sealedName, preorderDate, serveSealed, SEALED_MAX, wargamesOf, serveWargames, WARGAMES_MAX, shelfOf, serveShelf, SHELF_MAX, gqlPatient } from "../src/boxes.js";

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

/* Warhammer boxes on the 3D shop's hobby rack (owner, 2026-11-09). */
test("wargamesOf: kits in stock with a picture; novels, dice, card packs, journals and pre-orders still to come are left out", async () => {
  const now = Date.UTC(2026, 10, 9);
  const P = (title, qty, o) => Object.assign({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), createdAt: "2026-10-31T15:28:33Z", media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/k.jpg", width: 600, height: 620 } } }] }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/7", price: "56.10", inventoryQuantity: qty }] } }, o || {});
  const rows = wargamesOf([
    P("WARHAMMER: AGE OF SIGMAR KHAZALITE HOLDS ARMY SET", 4), P("WARHAMMER: AGE OF SIGMAR WHISPERBLADE HARDBACK", 1), P("WARHAMMER: THE HORUS HERESY SAGA GALAXY IN FLAMES PAPERBACK", 2),
    P("NECROMUNDA: HOUSE ORLOCK DICE", 2), P("NECROMUNDA ORLOCK ROAD WARRIORS", 3), P("NECROMUNDA ORLOCK CARD PACK", 3), P("NECROMUNDA UNDERHIVE JOURNAL ORLOCK HOUSE OF IRON", 3),
    P("WARHAMMER 40,000 NEW KIT PRE ORDER ^ DEC 4/26", 5), P("WARHAMMER 40,000 OUT NOW KIT PRE ORDER ^ NOV 1/26", 5), P("NO PICTURE KIT", 2, { media: { nodes: [] } }), P("SOLD OUT KIT", 0),
  ], now);
  assert.deepEqual(rows.map((r) => r.name), ["WARHAMMER: AGE OF SIGMAR KHAZALITE HOLDS ARMY SET", "NECROMUNDA ORLOCK ROAD WARRIORS", "WARHAMMER 40,000 OUT NOW KIT"]);
  assert.deepEqual(rows[1], { name: "NECROMUNDA ORLOCK ROAD WARRIORS", handle: "necromunda-orlock-road-warriors", price: "56.10", image: "https://cdn.shopify.com/k.jpg", ar: 0.97, variantId: "7", qty: 3, added: "2026-10-31" });
  assert.equal(wargamesOf(Array.from({ length: 30 }, (_, i) => P("KIT " + i, 1)), now).length, WARGAMES_MAX);
  const seen = [];
  const go = (gqlFn) => serveWargames(new Request("https://w.example/showcase/wargames.json"), {}, {}, new URL("https://w.example/showcase/wargames.json"), { gqlFn, now });
  let j = await (await go(async (q, v) => { seen.push(v.q); return { data: { products: { nodes: [P("NECROMUNDA ORLOCK ROAD WARRIORS", 3)] } } }; })).json();
  assert.equal(j.ok, true); assert.equal(j.rows.length, 1); assert.match(seen[0], /vendor:"Games Workshop"/); assert.match(seen[0], /product_type:"Tabletop Wargames"/);
  j = await (await go(async () => { throw new Error("shopify down"); })).json(); assert.equal(j.ok, false);
});

/* Gunpla, model kits and blind boxes on the 3D shop's right wall (owner, 2026-11-10). */
test("shelf.json: the kind's product type in stock with a picture, newest first; unknown kinds are refused", async () => {
  const now = Date.UTC(2026, 10, 10);
  const P = (title, qty, o) => Object.assign({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), createdAt: "2026-11-01T10:00:00Z", media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/g.jpg", width: 800, height: 600 } } }] }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/9", price: "32.95", inventoryQuantity: qty }] } }, o || {});
  const rows = shelfOf([P("HG 1/144 RX-78-2 GUNDAM", 3), P("MG 1/100 SOLD OUT", 0), P("RG 1/144 NEXT MONTH PRE ORDER ^ DEC 20/26", 4), P("NO PICTURE", 2, { media: { nodes: [] } }), P("PG 1/60 UNICORN (LIMIT 1)", 1)], now);
  assert.deepEqual(rows.map((r) => r.name), ["HG 1/144 RX-78-2 GUNDAM", "PG 1/60 UNICORN"]);
  assert.deepEqual(rows[0], { name: "HG 1/144 RX-78-2 GUNDAM", handle: "hg-1-144-rx-78-2-gundam", price: "32.95", image: "https://cdn.shopify.com/g.jpg", ar: 1.33, variantId: "9", qty: 3, added: "2026-11-01" });
  assert.equal(shelfOf(Array.from({ length: 40 }, (_, i) => P("KIT " + i, 1)), now).length, SHELF_MAX);
  const seen = [];
  const go = (q, gqlFn) => serveShelf(new Request("https://w.example/showcase/shelf.json" + q), {}, {}, new URL("https://w.example/showcase/shelf.json" + q), { gqlFn, now });
  for (const [kind, type] of [["gunpla", "Gunpla"], ["models", "Plastic Model Kit"], ["blind", "Blind Box"]]) {
    const j = await (await go("?kind=" + kind, async (qq, v) => { seen.push(v.q); return { data: { products: { nodes: [P("A KIT", 2)] } } }; })).json();
    assert.equal(j.ok, true); assert.equal(j.kind, kind); assert.equal(j.rows.length, 1); assert.ok(seen[seen.length - 1].includes('product_type:"' + type + '"'));
  }
  const bad = await go("?kind=everything", async () => { throw new Error("not asked"); }); assert.equal(bad.status, 400);
  const down = await (await go("?kind=gunpla", async () => { throw new Error("shopify down"); })).json(); assert.equal(down.ok, false);
});

test("gqlPatient: a throttled call is tried again, twice at most; any other error is thrown at once", async () => {
  let n = 0;
  assert.equal(await gqlPatient(async () => { if (++n < 3) throw new Error("throttled"); return "ok"; }, 0), "ok"); assert.equal(n, 3);
  n = 0; await assert.rejects(gqlPatient(async () => { n++; throw new Error("Throttled"); }, 0), /Throttled/); assert.equal(n, 3);
  n = 0; await assert.rejects(gqlPatient(async () => { n++; throw new Error("boom"); }, 0), /boom/); assert.equal(n, 1);
  // through a route: the second try answers
  n = 0;
  const j = await (await serveShelf(new Request("https://w.example/showcase/shelf.json?kind=gunpla"), {}, {}, new URL("https://w.example/showcase/shelf.json?kind=gunpla"), { waitMs: 0, now: Date.UTC(2026, 10, 10), gqlFn: async () => { if (++n < 2) throw new Error("throttled"); return { data: { products: { nodes: [] } } }; } })).json();
  assert.equal(j.ok, true); assert.equal(n, 2);
});

test("a set's box: every copy in stock is a row, the best condition first and the others behind it; foil after not foil", () => {
  const P = (title, vs) => ({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: "", variants: vs.map((x, i) => ({ shopifyId: "gid://shopify/ProductVariant/" + (i + 1), title: x[0], price: x[1], quantity: x[2] })) });
  const bolt = P("Lightning Bolt [M3]", [["Lightly Played", 3.1, 2], ["Near Mint", 3.5, 1], ["Damaged", 1, 1], ["Near Mint Foil", 9, 1], ["Moderately Played", 2.5, 0], ["Heavily Played", 2, 3]]);
  assert.deepEqual(rowsFor(bolt).map((r) => r[5] + (r[6] ? " foil" : "")), ["Near Mint", "Lightly Played", "Heavily Played", "Damaged", "Near Mint foil"]);
  assert.equal(rowOf(bolt)[5], "Near Mint"); assert.equal(rowsFor(bolt)[1][7], 8);
  const rows = rowsOf([P("Zap [M3]", [["Near Mint", 1, 1]]), bolt, P("Gone [M3]", [["Near Mint", 1, 0]])]);
  assert.deepEqual(rows.map((r) => r[0] + ":" + r[5]), ["Lightning Bolt:Near Mint", "Lightning Bolt:Lightly Played", "Lightning Bolt:Heavily Played", "Lightning Bolt:Damaged", "Lightning Bolt:Near Mint", "Zap:Near Mint"]);
});

test("find.json: asking for a card - the feed's title search, every copy in stock, the card asked for first, each row with its set", async () => {
  const P = (title, vs) => ({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), img: "", variants: vs.map((x, i) => ({ shopifyId: "gid://shopify/ProductVariant/" + (i + 1), title: x[0], price: x[1], quantity: x[2] })) });
  const prods = [P("Lightning Bolt Token [T]", [["Near Mint", 1, 1]]), P("Lightning Bolt [M3]", [["Lightly Played", 3, 1], ["Near Mint", 4, 1]]), P("Lightning Bolt [Alpha]", [["Heavily Played", 300, 1]]), P("Chain Lightning Bolt [X]", [["Near Mint", 2, 0]])];
  assert.deepEqual(findRows(prods, "lightning bolt").map((r) => r[0] + "|" + r[8] + "|" + r[5]), ["Lightning Bolt|Alpha|Heavily Played", "Lightning Bolt|M3|Near Mint", "Lightning Bolt|M3|Lightly Played", "Lightning Bolt Token|T|Near Mint"]);
  let sent = null;
  const U2 = (q) => new URL("https://w.example/showcase/find.json" + q);
  const j = await (await serveFind(new Request(U2("?game=mtg&q=Lightning%20%20Bolt")), {}, {}, U2("?game=mtg&q=Lightning%20%20Bolt"), { fetcher: async (u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ products: prods, count: 4 })); } })).json();
  assert.equal(j.ok, true); assert.equal(j.count, 4); assert.equal(sent.title, "Lightning Bolt"); assert.equal(sent.instockOnly, true); assert.deepEqual(sent.setNames, []);
  assert.equal((await serveFind(new Request(U2("?game=mtg&q=a")), {}, {}, U2("?game=mtg&q=a"), { fetcher: async () => { throw new Error("not asked"); } })).status, 400);
  assert.equal((await serveFind(new Request(U2("?game=nope&q=bolt")), {}, {}, U2("?game=nope&q=bolt"), { fetcher: async () => { throw new Error("not asked"); } })).status, 404);
});
