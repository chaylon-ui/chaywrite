import { test } from "node:test";
import assert from "node:assert/strict";
import { splitTitle, numberOf, numberKey, buildQuery, matches, shape, sortRows, facets, words } from "../src/cardsearch.js";

const P = (title, sku, tags, extra) => ({ handle: title.toLowerCase().replace(/\W+/g, "-"), title, tags: tags || [], createdAt: "2026-09-01", totalInventory: 2,
  featuredImage: null, priceRangeV2: { minVariantPrice: { amount: "0.50" } }, variants: { nodes: [{ sku }] }, ...(extra || {}) });

const pool = [
  P("Theorix Charm [Reality Fracture]", "FRA-155-EN-NF-1", ["Reality Fracture", "Uncommon"]),
  P("Fatehold Charm [Reality Fracture]", "FRA-132-EN-NF-1", ["Reality Fracture", "Uncommon"]),
  P("Konstrari Charm [Reality Fracture]", "FRA-16-EN-NF-1", ["Reality Fracture", "Uncommon"]),
  P("Silverquill Charm [Secrets of Strixhaven Promos]", "PSOS-215-EN-NF-1", ["Secrets of Strixhaven Promos", "Uncommon"]),
  P("Reality Shift [Reality Fracture]", "FRA-40-EN-NF-1", ["Reality Fracture", "Rare"]),
  P("Elemental Hero Neos [DUPO-EN102] Ultra Rare", "DUPO-EN102-EN-LI-1", ["Duel Power", "Ultra Rare"]),
];

test("set + name is AND, exact per field", () => {
  const got = pool.filter((p) => matches(p, words("reality fracture"), words("charm"), "")).map((p) => p.title);
  assert.deepEqual(got, ["Theorix Charm [Reality Fracture]", "Fatehold Charm [Reality Fracture]", "Konstrari Charm [Reality Fracture]"]);
  // set words in the card NAME do not count as the set ("Reality Shift" is not a Charm, and name words must be in the name)
  assert.equal(matches(pool[4], words("fracture"), words("charm"), ""), false);
  // set code works, Yu-Gi-Oh set name from tags
  assert.equal(matches(pool[0], words("fra"), [], ""), true);
  assert.equal(matches(pool[5], words("duel power"), words("neos"), ""), true);
  assert.equal(matches(pool[5], words("reality"), words("neos"), ""), false);
});

test("card number from the SKU sorts numerically", () => {
  assert.deepEqual(numberOf("FRA-155-EN-NF-1"), { code: "FRA", number: "155" });
  assert.deepEqual(numberOf("TFC-206/204-ENC-EN-HF-1"), { code: "TFC", number: "206/204" });
  assert.deepEqual(numberKey("EN008"), [8, "EN"]);
  const rows = pool.slice(0, 3).map(shape);
  assert.deepEqual(sortRows(rows, "number").map((r) => r.number), ["16", "132", "155"]);
  assert.deepEqual(sortRows(rows, "name").map((r) => r.name), ["Fatehold Charm", "Konstrari Charm", "Theorix Charm"]);
});

test("query narrows with AND; Yu-Gi-Oh set shown as its code prefix; facets count", () => {
  const q = buildQuery("mtg", words("reality fracture"), words("charm"), true, "");
  assert.match(q, /product_type:'MTG Single' AND status:active AND inventory_total:>0 AND title:\*charm\* AND \(title:\*reality\* OR tag:\*reality\*\) AND \(title:\*fracture\* OR tag:\*fracture\*\)/);
  assert.equal(shape(pool[5]).set, "DUPO");
  assert.equal(shape(pool[5]).rarity, "Ultra Rare");
  const f = facets(pool.slice(0, 4).map(shape));
  assert.deepEqual(f.sets[0], { name: "Reality Fracture", n: 3 });
  assert.deepEqual(f.rarities, [{ name: "Uncommon", n: 4 }]);
  assert.deepEqual(splitTitle("Oko, Thief of Crowns (Borderless) [Throne of Eldraine]"), { name: "Oko, Thief of Crowns (Borderless)", set: "Throne of Eldraine" });
});
