import { test } from "node:test";
import assert from "node:assert/strict";
import { niceUp, autoStep, decide, categoryOf, normUpc, readProduct, nextRunAt, DEFAULT_CONFIG } from "../src/autoprice.js";

test("normal-looking numbers: rounded UP onto the .95 grid", () => {
  assert.equal(niceUp(223.76), 229.95);   // the owner's example
  assert.equal(niceUp(67.0), 69.95);
  assert.equal(niceUp(37.37), 37.95);   // under $50 the grid is $1
  assert.equal(niceUp(5.13), 5.95);
  assert.equal(niceUp(9.96), 10.95);
  assert.equal(niceUp(229.95), 229.95);   // already on the grid stays put
  assert.equal(niceUp(1200), 1249.95);
  assert.equal(niceUp(2765.04), 2799.95);   // the owner's example
  assert.equal(niceUp(6010), 6099.95);
  assert.equal(niceUp(223.76, "1"), 223.95);
  assert.equal(niceUp(223.76, "25"), 224.95);
  assert.equal(niceUp(223.76, "none"), 223.76);
  assert.equal(niceUp(0), null);
  assert.deepEqual([autoStep(10), autoStep(50), autoStep(199), autoStep(200), autoStep(999), autoStep(1000), autoStep(5000)], [1, 5, 5, 10, 10, 50, 100]);
});

test("UPC normalisation keeps the 12-digit core", () => {
  assert.equal(normUpc("0196214154186"), "196214154186");
  assert.equal(normUpc("196214154186"), "196214154186");
  assert.equal(normUpc("10196214154176"), "196214154176");
  assert.equal(normUpc("4582769982897"), "4582769982897");   // EAN-13, not a padded UPC
  assert.equal(normUpc(null), "");
});

test("product types map to TCGplayer categories", () => {
  assert.equal(categoryOf("Pokemon Sealed Product"), 3);
  assert.equal(categoryOf("Magic Sealed Product"), 1);
  assert.equal(categoryOf("YU-GI-OH Sealed Product"), 2);
  assert.equal(categoryOf("Disney Lorcana Sealed Product"), 71);
  assert.equal(categoryOf("One Piece Card Game Sealed Product"), 68);
  assert.equal(categoryOf("Star Wars Unlimited Sealed Product"), 79);
  assert.equal(categoryOf("Flesh and Blood Sealed Product"), 62);
  assert.equal(categoryOf("Riftbound Sealed Product"), 89);
  assert.equal(categoryOf("Hockey Sealed Product"), null);
});

// the guardrail cases below pin the cap on; the shipped default is markup 15, cap off
const cfg = { ...DEFAULT_CONFIG, markupPct: 0, maxMovePct: 15 };
const FX = 1.3909;

test("market x FX x markup, then the grid: Chaos Rising booster box", () => {
  const d = decide({ price: 219.95, cost: 150, tcgMarket: 198.98, round: "auto" }, cfg, FX);
  // 198.98 * 1.3909 = 276.76 -> +15% cap on 219.95 = 252.94 -> 259.95
  assert.equal(d.marketCad, 276.76);
  assert.equal(d.capped, "up");
  assert.equal(d.suggested, 259.95);
  assert.equal(d.action, "raise");
  const free = decide({ price: 219.95, cost: 150, tcgMarket: 198.98 }, { ...cfg, maxMovePct: 0 }, FX);
  assert.equal(free.suggested, 279.95);
  assert.equal(free.reason, "market");
});

test("per-item markup and floor win over the market", () => {
  const d = decide({ price: 10.95, cost: 6.54, tcgMarket: 5.13, markupPct: 20 }, { ...cfg, maxMovePct: 0 }, FX);
  // 5.13 * 1.3909 = 7.135 -> +20% = 8.56; floor = cost + 10% = 7.19 -> 8.95
  assert.equal(d.suggested, 8.95);
  assert.equal(d.action, "lower");
  // with the default 15% cap the same product only steps down to 9.31 -> 9.95
  const c = decide({ price: 10.95, cost: 6.54, tcgMarket: 5.13, markupPct: 20 }, cfg, FX);
  assert.equal(c.capped, "down");
  assert.equal(c.suggested, 9.95);
  const f = decide({ price: 10.95, cost: 6.54, tcgMarket: 5.13, floor: 10.5 }, cfg, FX);
  assert.equal(f.floor, 10.5);
  assert.equal(f.floorSrc, "ap_floor");
  assert.equal(f.suggested, 10.95);
  assert.equal(f.action, "hold");
  assert.equal(f.reason, "already at the suggested price");
});

test("two sources average; none skips with a useful reason", () => {
  const d = decide({ price: 100, cost: 50, tcgMarket: 60, pcNew: 70 }, { ...cfg, maxMovePct: 0 }, FX);
  assert.equal(d.marketUsd, 65);
  assert.equal(d.sources.length, 2);
  const s = decide({ price: 100, cost: 50 }, cfg, FX);
  assert.equal(s.action, "skip");
  assert.match(s.reason, /no match/);
  const t = decide({ price: 100, cost: 50, tcgId: 1 }, cfg, FX);
  assert.match(t.reason, /no price from the sources/);
  const n = decide({ price: 100, cost: 50, tcgMarket: 60 }, cfg, null);
  assert.equal(n.reason, "no FX rate");
});

test("a fall is capped per run and never goes under the floor", () => {
  const d = decide({ price: 100, cost: 80, tcgMarket: 30 }, cfg, FX);
  // market 41.73 -> floor (cost + 10%) = 88 wins first, and 88 is inside the 15% cap -> 89.95
  assert.equal(d.capped, null);
  assert.equal(d.floor, 88);
  assert.equal(d.floorSrc, "cost+margin");
  assert.equal(d.suggested, 89.95);
  assert.equal(d.reason, "floor");
  const c = decide({ price: 100, cost: 20, tcgMarket: 30 }, cfg, FX);
  // market 41.73, floor 22: the fall is capped at 85 -> next $5 step ending .95 is 89.95
  assert.equal(c.capped, "down");
  assert.equal(c.suggested, 89.95);
  assert.match(c.reason, /capped at 15%/);
});

test("readProduct pulls variant, cost, UPC and the ap_* metafields", () => {
  const node = { id: "gid://shopify/Product/1", title: "POKEMON ME04 CHAOS RISING BOOSTER BOX", handle: "h", productType: "Pokemon Sealed Product", tags: ["auto-price"],
    variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/9", title: "Default Title", price: "219.95", barcode: "0196214154186", sku: "0196214154186", inventoryQuantity: 4, inventoryItem: { unitCost: { amount: "150.00" } } } }] },
    mf: { edges: [{ node: { key: "ap_floor", value: "200" } }, { node: { key: "ap_round", value: "10" } }, { node: { key: "series", value: "x" } }] } };
  const p = readProduct(node);
  assert.equal(p.category, 3);
  assert.equal(p.upc, "196214154186");
  assert.equal(p.cost, 150);
  assert.equal(p.price, 219.95);
  assert.equal(p.floor, 200);
  assert.equal(p.round, "10");
  assert.equal(p.markupPct, null);
  assert.equal(p.variants, 1);
  assert.equal(p.stock, 4);
});

test("the nightly clock is 22:30 UTC, today if still ahead", () => {
  const at = nextRunAt(Date.UTC(2026, 8, 15, 12, 0, 0));
  assert.equal(new Date(at).toISOString(), "2026-09-15T22:30:00.000Z");
  const late = nextRunAt(Date.UTC(2026, 8, 15, 22, 31, 0));
  assert.equal(new Date(late).toISOString(), "2026-09-16T22:30:00.000Z");
});

import { gameOf, searchQueryFor } from "../src/autoprice.js";
test("game labels and the add-to-list search query", () => {
  assert.equal(gameOf("Pokemon Sealed Product"), "Pokemon");
  assert.equal(gameOf("One Piece Card Game Sealed Product"), "One Piece Card Game");
  assert.equal(gameOf("MTG Single"), "MTG");
  assert.equal(gameOf(""), "Other");
  assert.equal(searchQueryFor("0196214154186"), "status:active (barcode:196214154186 OR barcode:0196214154186 OR sku:196214154186 OR sku:0196214154186)");
  assert.equal(searchQueryFor("chaos rising booster"), "status:active product_type:*Sealed* chaos rising booster");
  assert.equal(searchQueryFor(' "elite" (trainer)'), "status:active product_type:*Sealed* elite trainer");
});

test("the shipped defaults: markup on top of market, no per-run cap", () => {
  // MTG Final Fantasy Collector Booster Box: TCG $1728.65 US -> $2404.38 CAD, +15% = $2765.04 -> $2799.95
  const d = decide({ price: 899.95, cost: 459.55, tcgMarket: 1728.65 }, { ...DEFAULT_CONFIG }, FX);
  assert.equal(d.marketCad, 2404.38);
  assert.equal(d.raw, 2765.04);
  assert.equal(d.capped, null);
  assert.equal(d.suggested, 2799.95);
  assert.equal(d.action, "raise");
  assert.equal(d.reason, "market");
});

import { nameMatch, rowPrice, tok } from "../src/autoprice.js";
const ROWS = [
  { id: 1, set: "Wilds of Eldraine", name: "Wilds of Eldraine - Collector Booster Display", market: 300, mid: 320, low: 290 },
  { id: 2, set: "Wilds of Eldraine", name: "Wilds of Eldraine - Collector Booster Display Master Case", market: null, mid: null, low: null },
  { id: 3, set: "Wilds of Eldraine", name: "Wilds of Eldraine - Collector Booster Display (Japanese)", market: 250 },
  { id: 4, set: "Lorwyn Eclipsed", name: "Lorwyn Eclipsed - Play Booster Pack", market: 4.68 },
  { id: 5, set: "Lorwyn Eclipsed", name: "Lorwyn Eclipsed - Sleeved Play Booster Pack", market: 7.14 },
  { id: 6, set: "Lorwyn Eclipsed", name: "Lorwyn Eclipsed - Play Booster Display", market: 118.18 },
  { id: 7, set: "Kamigawa: Neon Dynasty", name: "Kamigawa: Neon Dynasty - Prerelease Pack", market: null, mid: 45, low: 40 },
  { id: 8, set: "ME04: Chaos Rising", name: "Chaos Rising Booster Box", market: 198.98 },
  { id: 9, set: "ME04: Chaos Rising", name: "Chaos Rising Booster Box Case", market: 1108 },
  { id: 10, set: "Commander: Lorwyn Eclipsed", name: "Lorwyn Eclipsed Commander Deck - Blight Curse", market: 35 },
];
test("name fallback: set + exact kind, box = display, never a case, pack, sleeved or Japanese stand-in", () => {
  assert.equal(nameMatch("MTG WILDS OF ELDRAINE COLLECTOR BOOSTER BOX", ROWS).id, 1);
  assert.equal(nameMatch("MTG WILDS OF ELDRAINE COLLECTOR BOOSTER BOX (LIMIT 1)", ROWS).id, 1);
  assert.equal(nameMatch("MTG LORWYN ECLIPSED PLAY BOOSTER PACK", ROWS).id, 4);
  assert.equal(nameMatch("MTG LORWYN ECLIPSED PLAY BOOSTER BOX", ROWS).id, 6);
  assert.equal(nameMatch("MTG KAMIGAWA NEON DYNASTY PRERELEASE PACK", ROWS).id, 7);
  assert.equal(nameMatch("POKEMON ME04 CHAOS RISING BOOSTER BOX", ROWS).id, 8);
  assert.equal(nameMatch("MTG LORWYN ECLIPSED COMMANDER DECK BLIGHT CURSE", ROWS).id, 10);
  assert.equal(nameMatch("MTG LORWYN ECLIPSED COLLECTOR BOOSTER BOX", ROWS), null);
  assert.equal(nameMatch("MTG WILDS OF ELDRAINE PLAY BOOSTER BOX", ROWS), null);
  assert.deepEqual(rowPrice(ROWS[6]), { usd: 45, kind: "mid" });
  assert.equal(rowPrice(ROWS[1]), null);
  assert.deepEqual(tok("MTG WILDS OF ELDRAINE COLLECTOR BOOSTER BOX (LIMIT 1)"), ["wilds", "eldraine", "collector", "booster", "box"]);
});

import { pickComp, compQuery, COMP } from "../src/autoprice.js";
test("401 Games: exact title tokens, in stock holds the price down", () => {
  const results = [
    { title: "MTG - EDGE OF ETERNITIES - PLAY BOOSTER BOX", handle: "eoe-pbb", available: true, variants: [{ barcode: "195166286334" }] },
    { title: "MTG - EDGE OF ETERNITIES - PLAY BOOSTER PACK", handle: "eoe-pbp", available: true },
    { title: "MTG - EDGE OF ETERNITIES - COLLECTOR BOOSTER BOX", handle: "eoe-cbb", available: true },
  ];
  assert.equal(pickComp("MTG EDGE OF ETERNITIES PLAY BOOSTER BOX", "195166286334", results).handle, "eoe-pbb");
  assert.equal(pickComp("MTG EDGE OF ETERNITIES SET BOOSTER BOX", "", results), null);
  assert.equal(compQuery("POKEMON ME04 CHAOS RISING BOOSTER BOX"), "chaos rising booster box");
  // TCG $189.07 -> $262.98 CAD +15% = $302.42 -> 309.95, but 401 has it at $199.95 in stock -> 199.95
  const d = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: true, handle: "eoe-pbb" } }, { ...DEFAULT_CONFIG }, FX);
  assert.equal(d.suggested, 199.95);
  assert.equal(d.action, "lower");
  assert.match(d.reason, /401 Games has it at \$199.95 in stock/);
  const off = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: false } }, { ...DEFAULT_CONFIG }, FX);
  assert.equal(off.suggested, 309.95);
  assert.equal(off.comp.used, false);
  const pct = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: true } }, { ...DEFAULT_CONFIG, compPct: 10 }, FX);
  assert.equal(pct.suggested, 219.95);   // 199.95 * 1.10 = 219.945 -> 219.95
  const floorWins = decide({ price: 229.95, cost: 200, tcgMarket: 189.07, comp: { price: 199.95, available: true } }, { ...DEFAULT_CONFIG }, FX);
  assert.equal(floorWins.suggested, 229.95);   // cost + 10% = 220 -> 229.95 beats the 401 cap
  assert.equal(COMP.base, "https://store.401games.ca");
});

test("401 Games naming: brand words and English are noise, Japanese is not, Kit = Pack", () => {
  const r = [
    { title: "MTG - Universes Beyond: Marvel's Spider-Man - Collector Booster Box", handle: "sm-cbb", available: true },
    { title: "MTG - Universes Beyond: Marvel's Spider-Man - Play Booster Box", handle: "sm-pbb", available: true },
    { title: "MTG - Kamigawa: Neon Dynasty - English Collector Booster Box", handle: "neo-cbb", available: true },
    { title: "MTG - Kamigawa: Neon Dynasty - Japanese Collector Booster Box", handle: "neo-jp", available: true },
    { title: "MTG - Universes Beyond: Marvel's Spider-Man - Prerelease Kit", handle: "sm-pre", available: true },
    { title: "MTG - Universes Beyond: Final Fantasy - Play Booster Box", handle: "ff-pbb", available: true },
  ];
  assert.equal(pickComp("MTG SPIDER-MAN COLLECTOR BOOSTER BOX (LIMIT 2)", "", r).handle, "sm-cbb");
  assert.equal(pickComp("MTG KAMIGAWA NEON DYNASTY COLLECTOR BOOSTER BOX", "", r).handle, "neo-cbb");
  assert.equal(pickComp("MTG KAMIGAWA NEON DYNASTY JAPANESE COLLECTOR BOOSTER BOX", "", r).handle, "neo-jp");
  assert.equal(pickComp("MTG SPIDER-MAN PRERELEASE PACK", "", r).handle, "sm-pre");
  assert.equal(pickComp("MTG FINAL FANTASY PLAY BOOSTER BOX", "", r).handle, "ff-pbb");
  assert.equal(pickComp("MTG FINAL FANTASY COLLECTOR BOOSTER BOX", "", r), null);
});
