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
  assert.equal(niceUp(1200), 1224.95);
  assert.equal(niceUp(223.76, "1"), 223.95);
  assert.equal(niceUp(223.76, "25"), 224.95);
  assert.equal(niceUp(223.76, "none"), 223.76);
  assert.equal(niceUp(0), null);
  assert.deepEqual([autoStep(10), autoStep(50), autoStep(199), autoStep(200), autoStep(999), autoStep(1000)], [1, 5, 5, 10, 10, 25]);
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

const cfg = { ...DEFAULT_CONFIG };
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
