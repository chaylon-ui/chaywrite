import { test } from "node:test";
import assert from "node:assert/strict";
import { niceUp, autoStep, decide, margin, categoryOf, normUpc, readProduct, nextRunAt, DEFAULT_CONFIG } from "../src/autoprice.js";

test("margin: profit and share of the selling price, from unit cost", () => {
  assert.deepEqual(margin(219.95, 150), { amount: 69.95, pct: 31.8 });
  assert.deepEqual(margin(89.95, 100), { amount: -10.05, pct: -11.2 });   // under cost shows negative, never hidden
  assert.equal(margin(219.95, null), null);
  assert.equal(margin(219.95, 0), null);
  assert.equal(margin(null, 150), null);
});

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
  assert.deepEqual(s.marginNow, { amount: 50, pct: 50 });   // today's margin shows even when there is nothing to suggest
  assert.equal(s.marginSuggested, undefined);
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
  assert.deepEqual(d.marginNow, { amount: 20, pct: 20 });          // at today's $100
  assert.deepEqual(d.marginSuggested, { amount: 9.95, pct: 11.1 });   // at the suggested $89.95
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

import { signSession, verifySession, safeEqual } from "../src/autoprice.js";
test("login sessions: signed, expiring, keyed by the secret; constant-time compare", async () => {
  const tok = await signSession("secret-a", { u: "owner", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await verifySession("secret-a", tok)).u, "owner");
  assert.equal(await verifySession("secret-b", tok), null);                       // another password: no session
  assert.equal(await verifySession("secret-a", tok.slice(0, -2) + "xx"), null);   // tampered signature
  const old = await signSession("secret-a", { u: "owner", exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(await verifySession("secret-a", old), null);                       // expired
  assert.equal(await verifySession("secret-a", "garbage"), null);
  assert.equal(await safeEqual("hunter2", "hunter2"), true);
  assert.equal(await safeEqual("hunter2", "hunter3"), false);
  assert.equal(await safeEqual("", "x"), false);
});

test("report rows print our margin under today's price and under the suggested price", async () => {
  const { renderPage } = await import("../src/autoprice.js");
  const d = decide({ price: 219.95, cost: 150, tcgMarket: 198.98 }, { ...DEFAULT_CONFIG }, FX);
  const rows = [
    { id: "gid://shopify/Product/1", title: "Box A", handle: "box-a", type: "MTG Sealed", stock: 0, ...d },
    { id: "gid://shopify/Product/2", title: "Box B", handle: "box-b", type: "MTG Sealed", stock: 3, ...decide({ price: 100, cost: 110, tcgMarket: 30 }, { ...DEFAULT_CONFIG }, FX) },
    { id: "gid://shopify/Product/3", title: "Box C", handle: "box-c", type: "MTG Sealed", stock: 0, ...decide({ price: 50, cost: null, tcgMarket: 30 }, { ...DEFAULT_CONFIG }, FX) },
  ];
  const page = renderPage({ mode: "shadow", config: DEFAULT_CONFIG }, { rows }, { configured: true });
  assert.match(page, /\$219\.95<\/b><div class="muted">cost \$150\.00<\/div><div class="muted mg" [^>]*>margin \$69\.95 · 31\.8%<\/div>/);
  assert.match(page, new RegExp("\\$" + d.suggested.toFixed(2) + "</b><div class=\"muted mg\" [^>]*>margin \\$" + d.marginSuggested.amount.toFixed(2) + " · " + d.marginSuggested.pct + "%</div>"));
  assert.match(page, /class="muted mg neg"[^>]*>margin \$-10\.00 · -10%<\/div>/);   // Box B is priced under cost today: red
  assert.match(page, /cost —<\/div><div class="muted" title="No unit cost[^"]*">margin: no cost<\/div>/);   // Box C has no cost
});

test("follow 401 Games: their in-stock price is the price; out of stock alerts and falls back to TCGplayer", () => {
  const follow = { ...DEFAULT_CONFIG, compMode: "follow" };
  const f = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: true, handle: "eoe-pbb" } }, follow, FX);
  assert.equal(f.priceFrom, "401");
  assert.equal(f.suggested, 199.95);   // TCG would say 309.95; bypassed
  assert.equal(f.alert, null);
  assert.equal(f.reason, "following 401 Games at $199.95 in stock");
  assert.equal(f.comp.used, true);
  assert.equal(f.marketCad, 262.98);   // still shown, not used
  const noTcg = decide({ price: 0, cost: 120, comp: { price: 199.95, available: true } }, follow, FX);   // no TCGplayer match at all
  assert.equal(noTcg.suggested, 199.95);
  assert.equal(noTcg.action, "set");
  const pct = decide({ price: 229.95, cost: 149.76, comp: { price: 199.95, available: true } }, { ...follow, compPct: 10 }, FX);
  assert.equal(pct.suggested, 219.95);
  assert.equal(pct.reason, "following 401 Games at $199.95 in stock (+10%)");
  const fl = decide({ price: 219.95, cost: 200, tcgMarket: 189.07, comp: { price: 199.95, available: true } }, follow, FX);
  assert.equal(fl.suggested, 229.95);   // cost + 10% floor still wins
  assert.equal(fl.reason, "floor (401 Games is lower)");
  const out = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: false } }, follow, FX);
  assert.equal(out.priceFrom, "market");
  assert.equal(out.suggested, 309.95);   // the TCGplayer path, as with no 401 at all
  assert.equal(out.alert, "401 Games is out of stock: priced from TCGplayer instead");
  assert.equal(out.reason, "market");
  const none = decide({ price: 229.95, cost: 149.76 }, follow, FX);   // not carried there, no TCGplayer match either
  assert.equal(none.action, "skip");
  assert.equal(none.alert, "401 Games does not list it: priced from TCGplayer instead");
  assert.match(none.reason, /^401 Games does not list it, and no match/);
  const per = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, compMode: "follow", comp: { price: 199.95, available: true } }, { ...DEFAULT_CONFIG, compMode: "off" }, FX);
  assert.equal(per.priceFrom, "401");   // the product's own setting wins over the page's
  const cap = decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: true } }, { ...DEFAULT_CONFIG }, FX);
  assert.equal(cap.suggested, 199.95);   // the hold mode is unchanged
  assert.equal(cap.reason, "401 Games has it at $199.95 in stock");
});

test("the report flags follow-mode products that fell back to TCGplayer", async () => {
  const { renderPage } = await import("../src/autoprice.js");
  const follow = { ...DEFAULT_CONFIG, compMode: "follow" };
  const rows = [
    { id: "gid://shopify/Product/1", title: "Box A", handle: "a", type: "MTG Sealed", stock: 0, ...decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: true, handle: "a" } }, follow, FX) },
    { id: "gid://shopify/Product/2", title: "Box B", handle: "b", type: "MTG Sealed", stock: 0, ...decide({ price: 229.95, cost: 149.76, tcgMarket: 189.07, comp: { price: 199.95, available: false } }, follow, FX) },
  ];
  const page = renderPage({ mode: "shadow", config: follow }, { rows }, { configured: true });
  assert.match(page, /<div class="alert"><b>⚠ 1 product set to follow 401 Games is priced from TCGplayer instead<\/b>/);
  assert.match(page, /Box B<\/a> · 401 Games is out of stock: priced from TCGplayer instead · now \$229\.95 → \$309\.95/);
  assert.match(page, /<tr class="a-raise alerted">/);
  assert.match(page, /<div class="warn">⚠ 401 Games is out of stock: priced from TCGplayer instead<\/div>/);
  assert.match(page, /<b>401 Games \$199\.95<\/b><div class="muted">followed · TCGplayer not used: TCG \$189\.07 US = \$262\.98 CAD<\/div>/);
  assert.match(page, /<option value="follow" selected>/);
});

import { indexRows, isCaseRow, tok as tok2 } from "../src/autoprice.js";
test("a single item never prices from its Case row: shared UPC, SV8.5 token, SV: prefix (Prismatic Evolutions SPC, 2026-09-15)", () => {
  const title = "POKEMON SV8.5 PRISMATIC EVOLUTIONS SUPER PREMIUM COLLECTION";
  assert.deepEqual(tok2(title), ["sv85", "prismatic", "evolutions", "super", "premium", "collection"]);   // one set-code token (dropped by the matchers), no stray "5"
  const single = { id: 622770, set: "SV: Prismatic Evolutions", name: "Prismatic Evolutions Super-Premium Collection", upc: "196214112568", market: 253.21 };
  const kase = { id: 638058, set: "SV: Prismatic Evolutions", name: "Prismatic Evolutions Super-Premium Collection Case", upc: "0196214112568", market: 1219.47 };
  const code = { id: 632695, set: "SV: Prismatic Evolutions", name: "Code Card - Prismatic Evolutions Super-Premium Collection", upc: "", market: 1.54 };
  assert.equal(nameMatch(title, [code, kase, single]).id, 622770);
  assert.equal(nameMatch("POKEMON SV8.5 PRISMATIC EVOLUTIONS SUPER PREMIUM COLLECTION CASE", [code, kase, single]).id, 638058);
  // the UPC slot: the non-case row wins whatever the file order
  assert.equal(indexRows([single, kase]).byUpc["196214112568"].id, 622770);
  assert.equal(indexRows([kase, single]).byUpc["196214112568"].id, 622770);
  assert.equal(isCaseRow(kase), true);
  assert.equal(isCaseRow(single), false);
  // the series prefix on both sides
  assert.equal(nameMatch("POKEMON XY EVOLUTIONS BOOSTER BOX", [{ id: 1, set: "XY: Evolutions", name: "Evolutions Booster Box", market: 700 }, { id: 2, set: "XY: Evolutions", name: "Evolutions Booster Box Case", market: 4000 }]).id, 1);
  // and 401 Games' naming of the same product now lines up
  const hit = pickComp(title, "196214112568", [{ title: "Pokemon - Prismatic Evolutions Super-Premium Collection", handle: "pe-spc", available: true, variants: [{ price: "299.99", available: true }] }]);
  assert.equal(hit && hit.handle, "pe-spc");
});

import { buildDigest, ntfyTarget, pctMove, sendNtfy } from "../src/autoprice.js";
test("ntfy digest: every change with its move, drastic ones first and flagged, 401 alerts, run counts", async () => {
  const run = { startedAt: 1000, apply: true, priced: 4, written: 3, skipped: 1, fx: 1.3909, errors: [], rows: [
    { title: "Chaos Rising Booster Box", current: 219.95, suggested: 229.95, action: "raise", applied: true },
    { title: "Wilds of Eldraine Collector Box", current: 1399.95, suggested: 1199.95, action: "lower", applied: true },   // -14.3%
    { title: "FF Collector Box", current: null, suggested: 2799.95, action: "set", applied: true },
    { title: "EoE Play Booster Pack", current: 6.95, suggested: 6.95, action: "hold", applied: false, lastChange: { at: 2000, from: 8.95, to: 6.95, by: "hand" } },   // -22.3% by hand
    { title: "Spider-Man Collector Box", current: 549.95, action: "skip", reason: "no match", alert: "401 Games is out of stock: priced from TCGplayer instead" },
  ] };
  const d = buildDigest(run, { ...DEFAULT_CONFIG, alertPct: 10 });
  assert.equal(d.title, "Auto-pricing: 4 price changes, 2 of 10% or more, 1 401 alert");
  assert.equal(d.priority, 4);
  assert.deepEqual(d.tags, ["rotating_light"]);
  assert.equal(d.click, "https://exor-binder.nevski.workers.dev/autoprice");
  const lines = d.body.split("\n");
  assert.equal(lines[0], "⚠ ↓ -14.3%  Wilds of Eldraine Collector Box: $1,399.95 → $1,199.95");
  assert.equal(lines[1], "⚠ ↓ -22.3%  EoE Play Booster Pack: $8.95 → $6.95 (by hand)");
  assert.equal(lines[2], "↑ +4.5%  Chaos Rising Booster Box: $219.95 → $229.95");
  assert.equal(lines[3], "set FF Collector Box: $2,799.95");
  assert.equal(lines[4], "⚠ Spider-Man Collector Box: 401 Games is out of stock: priced from TCGplayer instead (skipped: no match)");
  assert.equal(lines[5], "5 listed · 4 priced · 3 written · 1 skipped · FX 1.3909");
  assert.equal(d.worth, true);
  // a quiet nightly still reports, low priority; a quiet manual run is not worth a push
  const quiet = buildDigest({ startedAt: 1, apply: true, priced: 2, written: 0, skipped: 0, errors: [], rows: [{ title: "A", current: 10, suggested: 10, action: "hold" }] }, DEFAULT_CONFIG);
  assert.equal(quiet.title, "Auto-pricing: no price changes");
  assert.equal(quiet.priority, 2);
  assert.equal(quiet.worth, false);
  // shadow mode lists what it would have done
  const sh = buildDigest({ startedAt: 1, apply: false, priced: 1, written: 0, skipped: 0, errors: [], rows: [{ title: "A", current: 100, suggested: 89.95, action: "lower" }] }, DEFAULT_CONFIG);
  assert.equal(sh.title, "Auto-pricing (shadow): 1 price change, 1 of 10% or more");
  assert.match(sh.body, /^⚠ ↓ -10%  A: \$100\.00 → \$89\.95 \(not written: shadow\)\n/);   // -10.05% rounds to -10.0
  // a failed run says so at high priority
  const bad = buildDigest({ startedAt: 1, apply: true, error: "tick threw", errors: [], rows: [] }, DEFAULT_CONFIG);
  assert.equal(bad.title, "Auto-pricing: run failed");
  assert.match(bad.body, /✖ run failed: tick threw/);
  assert.equal(bad.priority, 4);
  // alert threshold off
  assert.equal(buildDigest(run, { ...DEFAULT_CONFIG, alertPct: 0 }).drastic.length, 0);
  assert.equal(pctMove(200, 220), 10);
  assert.equal(pctMove(null, 220), null);
  // targets
  assert.deepEqual(ntfyTarget("exor-prices"), { server: "https://ntfy.sh", topic: "exor-prices" });
  assert.deepEqual(ntfyTarget("https://ntfy.example.com/exor/prices"), { server: "https://ntfy.example.com", topic: "prices" });
  assert.equal(ntfyTarget(""), null);
  // the publish call: JSON to the server root with the topic inside, bearer token when set
  let got = null;
  const cx = { env: { AUTOPRICE_NTFY: "https://ntfy.sh/exor-prices", AUTOPRICE_NTFY_TOKEN: "tk_x" }, fetch: async (u, init) => { got = { u, init }; return { ok: true, status: 200 }; } };
  const r = await sendNtfy(cx, d);
  assert.equal(r.ok, true);
  assert.equal(got.u, "https://ntfy.sh/");
  assert.equal(got.init.headers.authorization, "Bearer tk_x");
  const sent = JSON.parse(got.init.body);
  assert.equal(sent.topic, "exor-prices");
  assert.equal(sent.priority, 4);
  assert.equal(sent.title, d.title);
  const off = await sendNtfy({ env: {}, fetch: async () => { throw new Error("must not be called"); } }, d);
  assert.equal(off.skipped, true);
});

import { publishDigest, digestOp } from "../src/autoprice.js";
test("relay: a refused push stays pending on ap:digest until the GitHub relay acks it", async () => {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } };
  const d = { title: "Auto-pricing: 1 price change", body: "↑ +4.5%  A: $10.00 → $10.45", priority: 3, tags: ["moneybag"], click: "https://x/autoprice" };
  const refused = { env: { AUTOPRICE_NTFY: "exor", AUTOPRICE_NTFY_TOKEN: "tk_a" }, storage, now: () => 5000, fetch: async () => ({ ok: false, status: 429, text: async () => '{"code":42908,"http":429,"error":"limit reached: daily message quota reached"}' }) };
  const r = await publishDigest(refused, d, { runStartedAt: 4000, kind: "nightly" });
  assert.equal(r.ok, false);
  assert.equal(r.relay, true);
  assert.match(r.error, /HTTP 429/);
  let g = await digestOp(refused, null);
  assert.equal(g.digest.sent, false);
  assert.equal(g.digest.title, d.title);
  assert.equal(g.digest.runStartedAt, 4000);
  assert.match(g.digest.lastError, /HTTP 429/);
  // the relay sends it and acks; the run's ntfy column follows
  store.set("ap:runs", [{ startedAt: 4000, notify: "queued for the relay (ntfy HTTP 429)" }]);
  const a = await digestOp(refused, { op: "sent", by: "relay" });
  assert.equal(a.digest.sent, true);
  assert.equal(a.digest.sentBy, "relay");
  assert.equal(store.get("ap:runs")[0].notify, "sent by relay");
  // a second ack is a no-op
  const again = await digestOp(refused, { op: "sent", by: "someone" });
  assert.equal(again.digest.sentBy, "relay");
  // a direct success is marked sent by the worker
  const fine = { ...refused, fetch: async () => ({ ok: true, status: 200 }) };
  const ok = await publishDigest(fine, d, { runStartedAt: 6000, kind: "nightly" });
  assert.equal(ok.ok, true);
  assert.equal((await digestOp(fine, null)).digest.sentBy, "worker");
  // ntfy off: nothing left pending for the relay to send
  const off = { ...refused, env: {} };
  const o = await publishDigest(off, d, { runStartedAt: 7000, kind: "nightly" });
  assert.equal(o.skipped, true);
  assert.equal((await digestOp(off, null)).digest.sent, true);
});

import { stripSeries } from "../src/autoprice.js";
test("Elite Trainer = Elite Trainer Box = ETB; 401's spelled-out series is noise (Destined Rivals ETB, 2026-09-15)", () => {
  const title = "POKEMON SV10 DESTINED RIVALS ELITE TRAINER (LIMIT 2)";
  assert.deepEqual(tok2(title), ["sv10", "destined", "rivals", "elite", "trainer"]);
  assert.deepEqual(tok2("Destined Rivals Elite Trainer Box"), ["destined", "rivals", "elite", "trainer"]);
  assert.deepEqual(tok2("Destined Rivals ETB"), ["destined", "rivals", "elite", "trainer"]);
  const rows = [
    { id: 624675, set: "SV10: Destined Rivals", name: "Destined Rivals Pokemon Center Elite Trainer Box (Exclusive)", market: 450.78 },
    { id: 624676, set: "SV10: Destined Rivals", name: "Destined Rivals Elite Trainer Box", upc: "0820650859526", market: 116.69 },
    { id: 628398, set: "SV10: Destined Rivals", name: "Destined Rivals Elite Trainer Box Case", market: 1232.41 },
    { id: 633151, set: "SV10: Destined Rivals", name: "Code Card - Destined Rivals Elite Trainer Box", market: 0.29 },
  ];
  assert.equal(nameMatch(title, rows).id, 624676);   // not the Pokemon Center one, the case, or the code card
  assert.deepEqual(stripSeries(["scarlet", "violet", "destined", "rivals", "elite", "trainer"]), ["destined", "rivals", "elite", "trainer"]);
  const hit = pickComp(title, "196214159891", [
    { title: "Pokemon - Scarlet and Violet - Destined Rivals - Elite Trainer Box", handle: "dr-etb", available: true, variants: [{ price: "89.95" }] },
    { title: "Pokemon - Scarlet and Violet - Destined Rivals - Booster Bundle", handle: "dr-bb", available: true },
  ]);
  assert.equal(hit && hit.handle, "dr-etb");
  // the earlier cases still hold with the series stripped
  assert.equal(pickComp("MTG EDGE OF ETERNITIES PLAY BOOSTER BOX", "", [{ title: "MTG - Edge of Eternities - Play Booster Box", handle: "eoe", available: true }]).handle, "eoe");
});

import { kickRun } from "../src/autoprice.js";
test("an add during a running run queues one more run instead of being lost", async () => {
  const store = new Map();
  const cx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, setAlarm: async () => {} }, now: () => 100000, log: () => {} };
  store.set("ap:run", { startedAt: 90000, tickAt: 99000, done: false, phase: "comp" });
  const r = await kickRun(cx, { apply: true });
  assert.deepEqual(r, { ok: true, started: false, running: true, queued: true });
  assert.deepEqual(store.get("ap:again"), { apply: true, at: 100000 });
  assert.equal(store.get("ap:run").phase, "comp");   // the running run is untouched
  // once the run is done (or stale), a kick starts a fresh one
  store.set("ap:run", { startedAt: 90000, tickAt: 99000, done: true });
  const s = await kickRun(cx, { apply: false });
  assert.equal(s.started, true);
  assert.equal(store.get("ap:run").done, false);
});

import { upcRow } from "../src/autoprice.js";
test("Celebrations: '(Exclusive)' is noise, and a UPC shared by twins goes to the one the title names", () => {
  const rows = [
    { id: 242811, set: "Celebrations", name: "Celebrations Elite Trainer Box", upc: "0820650809439", market: 362.05 },
    { id: 251199, set: "Celebrations", name: "Celebrations Pokemon Center Elite Trainer Box (Exclusive)", upc: "0820650809439", market: 549.81 },
    { id: 251218, set: "Celebrations", name: "Code Card - Celebrations Elite Trainer Box", upc: "", market: 0.17 },
    { id: 251895, set: "Celebrations", name: "Celebrations Elite Trainer Box Case", upc: "0820650828942", market: 4199.99 },
    { id: 261802, set: "Celebrations", name: "Celebrations Pokemon Center Elite Trainer Box Case (Exclusive)", upc: "", market: 2340 },
  ];
  const pc = "POKEMON CELEBRATIONS POKEMON CENTER ELITE TRAINER BOX";
  const plain = "POKEMON CELEBRATIONS ELITE TRAINER BOX";
  assert.deepEqual(tok2("Celebrations Pokemon Center Elite Trainer Box (Exclusive)"), ["celebrations", "center", "elite", "trainer"]);
  assert.equal(nameMatch(pc, rows).id, 251199);      // our barcode 820650809866 is on no TCGplayer row: the name finds it
  assert.equal(nameMatch(plain, rows).id, 242811);
  const ixc = indexRows(rows);
  assert.equal(upcRow(ixc, "820650809439", plain).id, 242811);   // the shared UPC: each twin gets its own row
  assert.equal(upcRow(ixc, "820650809439", pc).id, 251199);
  assert.equal(upcRow(ixc, "820650828942", plain).id, 251895);   // a lone UPC row as before (the case check comes later)
  assert.equal(upcRow(ixc, "000000000000", plain), null);
});
