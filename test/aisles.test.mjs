import { test } from "node:test";
import assert from "node:assert/strict";
import { AISLES, secQuery, aisleRows, gradedOf, serveAisles, serveAisle, serveGraded, AISLE_PAGE } from "../src/aisles.js";

/* The 3D shop's aisles and graded cabinet (owner, 2026-11-10). */
const P = (title, qty, o) => Object.assign({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), productType: "Figures",
  media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/a.jpg", width: 1500, height: 2000 } } }, { preview: { image: { url: "https://cdn.shopify.com/b.jpg", width: 1500, height: 2000 } } }] },
  variants: { nodes: [{ id: "gid://shopify/ProductVariant/5", price: "24.95", inventoryQuantity: qty }] } }, o || {});
const U = (s) => new URL("https://w.example/showcase/" + s);
const now = Date.UTC(2026, 10, 10);

test("aisles.json: each aisle in signed sections, every product in exactly one; the newest first; empty sections and aisles left out", async () => {
  assert.equal(AISLES.length, 6);
  const g = AISLES[0], B = 'status:active AND published_status:published AND inventory_total:>0 AND product_type:"Gunpla"';
  assert.equal(secQuery(g, "hg", now), B + " AND title:HG*");
  assert.equal(secQuery(g, "mg", now), B + " AND title:MG AND NOT title:HG* AND NOT title:RG");
  assert.equal(secQuery(g, "rest", now), B + " AND NOT title:HG* AND NOT title:RG AND NOT title:MG AND NOT title:SD*");
  assert.equal(secQuery(g, "new", now), B + " AND created_at:>=2026-10-11"); assert.equal(secQuery(g, "nope", now), null);
  for (const a of AISLES) for (const k of a.order || []) assert.ok(k === "rest" || a.secs.some((s) => s[0] === k), a.key + " order names " + k);
  for (const a of AISLES) if (a.order) assert.equal(a.order.length, a.secs.length + 1, a.key + " order lists every section and the rest");
  const asked = [];
  const j = await (await serveAisles(new Request(U("aisles.json")), {}, {}, U("aisles.json"), { now, gqlFn: async (q) => { asked.push(q); const n = asked.length;
    return n === 1 ? { data: { s0: { count: 60 }, s1: { count: 111 }, s2: { count: 19 }, s3: { count: 51 }, s4: { count: 0 }, s5: { count: 35 } } } : n === 4 ? { data: {} } : { data: { s0: { count: 0 }, s1: { count: 7 } } }; } })).json();
  assert.equal(asked.length, 6); assert.match(asked[0], /^query\{s0:productsCount\(query:".*created_at:>=2026-10-11"\)\{count\} s1:productsCount/);
  assert.deepEqual(j.aisles.map((a) => a.key + ":" + a.count), ["gunpla:216", "models:7", "figures:7", "board:7", "wargames:7"]);
  assert.deepEqual(j.aisles[0].secs, [{ key: "new", label: "New this month", count: 48 }, { key: "hg", label: "High Grade", count: 111 }, { key: "rg", label: "Real Grade", count: 19 }, { key: "mg", label: "Master Grade", count: 51 }, { key: "rest", label: "More Gunpla", count: 35 }]);
  assert.equal(j.aisles[4].secs[0].label, "Warhammer 40,000");   // the order they stand in, not the order they claim in
  const bad = await (await serveAisles(new Request(U("aisles.json")), {}, {}, U("aisles.json"), { gqlFn: async () => { throw new Error("down"); } })).json(); assert.equal(bad.ok, false);
});
test("aisle.json: a page of rows by title with the next cursor; sold out, unpriced and pre-orders still to come are left out; a product without a picture stays", async () => {
  const rows = aisleRows([P("ALPHA KIT (LIMIT 1)", 3), P("BETA SOLD OUT", 0), P("GAMMA PRE ORDER ^ DEC 20/26", 4), P("DELTA NO PICTURE", 2, { media: { nodes: [] } }), P("EPSILON FREE", 1, { variants: { nodes: [{ id: "x/1", price: "0.00", inventoryQuantity: 1 }] } })], now);
  assert.deepEqual(rows, [["ALPHA KIT", "alpha-kit-limit-1-", "24.95", "https://cdn.shopify.com/a.jpg", 0.75, "5", 3], ["DELTA NO PICTURE", "delta-no-picture", "24.95", null, 1, "5", 2]]);
  const seen = [];
  const go = (q, gqlFn) => serveAisle(new Request(U("aisle.json" + q)), {}, {}, U("aisle.json" + q), { gqlFn, now });
  let j = await (await go("?cat=board", async (q, v) => { seen.push(v); return { data: { products: { pageInfo: { hasNextPage: true, endCursor: "eyJsYXN0X2lkIjo5fQ==" }, nodes: [P("CATAN", 2)] } } }; })).json();
  assert.equal(j.ok, true); assert.equal(j.rows.length, 1); assert.equal(j.next, "eyJsYXN0X2lkIjo5fQ=="); assert.match(seen[0].q, /product_type:"Board Games"/); assert.equal(seen[0].after, null);
  j = await (await go("?cat=board&after=eyJsYXN0X2lkIjo5fQ%3D%3D", async (q, v) => { seen.push(v); return { data: { products: { pageInfo: { hasNextPage: false }, nodes: [] } } }; })).json();
  assert.equal(j.next, null); assert.equal(seen[1].after, "eyJsYXN0X2lkIjo5fQ==");
  j = await (await go("?cat=gunpla&sec=rg", async (q, v) => { seen.push(v); seen.push(q); return { data: { products: { pageInfo: { hasNextPage: false }, nodes: [P("RG NU GUNDAM", 1)] } } }; })).json();
  assert.equal(j.sec, "rg"); assert.match(seen[2].q, /product_type:"Gunpla" AND title:RG AND NOT title:HG\*$/); assert.match(seen[3], /sortKey:TITLE,query/);
  j = await (await go("?cat=gunpla&sec=new", async (q, v) => { seen.push(q); return { data: { products: { pageInfo: { hasNextPage: true, endCursor: "abc" }, nodes: [P("HG NEW KIT", 1)] } } }; })).json();
  assert.equal(j.next, null); assert.match(seen[4], /sortKey:CREATED_AT,reverse:true/);   // the newest: one page is the whole bay
  assert.equal((await go("?cat=gunpla&sec=zz", async () => { throw new Error("not asked"); })).status, 400);
  assert.equal((await go("?cat=everything", async () => { throw new Error("not asked"); })).status, 400);
  assert.equal((await go("?cat=board&after=" + encodeURIComponent('" OR 1'), async () => { throw new Error("not asked"); })).status, 400);
  assert.equal(AISLE_PAGE, 100);
});
test("graded.json: every graded card with front and back, the grade read from the title, the placeholder price marked ask; ask first, then dearest first", async () => {
  const G = (title, price, o) => P(title, 1, Object.assign({ productType: "Pokemon Single Graded", variants: { nodes: [{ id: "gid://shopify/ProductVariant/8", price, inventoryQuantity: 1 }] } }, o || {}));
  const rows = gradedOf([G("Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9", "89.95"), G("Mew ex (205/165) [Scarlet & Violet: 151] Graded CGC 10 Gem Mint", "999999.00"),
    G("Charizard (SWSH066) [Sword & Shield Black Star Promos] Graded BGS 9.5 Gem Mint", "144.95"), P("Ungraded Thing", 1), P("ULTRA PRO GRADED CARD SLEEVES 100CT", 4, { productType: "Sleeves & Toploaders" }), P("GRADED SLAB STORAGE CASE BLACK", 2, { productType: "Accessories" }), G("One Photo Graded TAG 5 Excellent", "229.95", { media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/f.jpg", width: 3024, height: 4032 } } }] } }), G("No Photo Graded PSA 10", "50.00", { media: { nodes: [] } })]);
  assert.deepEqual(rows.map((r) => [r.grade, r.price, r.ask, !!r.back]), [["CGC 10", "999999.00", true, true], ["TAG 5", "229.95", false, false], ["BGS 9.5", "144.95", false, true], ["PSA 9", "89.95", false, true]]);
  assert.equal(rows[0].front, "https://cdn.shopify.com/a.jpg"); assert.equal(rows[0].back, "https://cdn.shopify.com/b.jpg"); assert.equal(rows[0].ar, 0.75); assert.equal(rows[0].variantId, "8");
  let n = 0;
  const j = await (await serveGraded(new Request(U("graded.json")), {}, {}, U("graded.json"), { gqlFn: async (q, v) => { n++; return n === 1 ? { data: { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [G("A Graded PSA 10", "10.00")] } } } : { data: { products: { pageInfo: { hasNextPage: false }, nodes: [G("B Graded PSA 9", "20.00")] } } }; } })).json();
  assert.equal(j.ok, true); assert.equal(n, 2); assert.deepEqual(j.rows.map((r) => r.name), ["B Graded PSA 9", "A Graded PSA 10"]);
});
