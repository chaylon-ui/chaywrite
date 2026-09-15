import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBuylistCard, buylistOffers } from "../src/cards.js";
import { bpGameId } from "../src/buylist.js";

// BinderPOS's public card search, as the sell-to-us page reads it
// (pyprobe 35024762553, 2026-09-15): art cards rank first, the real card
// carries its treatment in cardName and the set in setName.
const T = (type, buy, credit, max, sell) => ({ type, legacyType: type === "Normal" ? "Non foil" : type, buyPrice: buy, creditBuyPrice: credit, maxPurchaseQuantity: max, storeSellPrice: sell });
const hits = [
  { id: 38240, cardName: "Witch-king of Angmar Art Card", setName: "The Lord of the Rings: Tales of Middle-earth Art Series", variants: [{ id: 1768, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 0, 0, 4, 0.3)] }] },
  { id: 90001, cardName: "Witch-king of Angmar", setName: "The Lord of the Rings: Tales of Middle-earth", variants: [{ id: 1768, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 2.1, 2.94, 20, 4.95)] }] },
  { id: 90002, cardName: "Witch-king of Angmar (Borderless)", setName: "The Hobbit: Eternal-Legal", variants: [
    { id: 1768, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 14.1, 19.74, 12, 26.95), T("Foil", 14.9, 20.86, 12, 28.5)] },
    { id: 1769, variantName: "Lightly Played", cardBuylistTypes: [T("Normal", 12.82, 17.95, 12, 24.5), T("Foil", 13.57, 19.0, 0, 26)] },
    { id: 1772, variantName: "Damaged", cardBuylistTypes: [T("Normal", 0, 0, 0, 10)] },
  ] },
  { id: 90003, cardName: "Witch-king of Angmar (Borderless)", setName: "The Lord of the Rings: Tales of Middle-earth", variants: [{ id: 1768, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 5, 7, 8, 9.95)] }] },
];

test("the product title finds its own printing and set on the buylist", () => {
  assert.equal(pickBuylistCard(hits, "Witch-king of Angmar (Borderless) [The Hobbit: Eternal-Legal]").id, 90002);
  assert.equal(pickBuylistCard(hits, "Witch-king of Angmar (Borderless) [The Lord of the Rings: Tales of Middle-earth]").id, 90003);
  assert.equal(pickBuylistCard(hits, "Witch-king of Angmar [The Lord of the Rings: Tales of Middle-earth]").id, 90001);
  assert.equal(pickBuylistCard(hits, "Witch-king of Angmar (Borderless) [Some Other Set]"), null);   // two Borderless printings, neither in that set: never guess
  assert.equal(pickBuylistCard(hits, "Witch-king of Angmar Art Card").id, 38240);
  assert.equal(pickBuylistCard(hits, "Aragorn [The Hobbit: Eternal-Legal]"), null);
});

test("the rows are BinderPOS's own prices, plain first then foil, NM to DMG, zero rows dropped", () => {
  const rows = buylistOffers(hits[2]);
  assert.deepEqual(rows.map((r) => [r.condition, r.finish, r.cash, r.credit, r.max]), [
    ["Near Mint", "Normal", "14.10", "19.74", 12],
    ["Lightly Played", "Normal", "12.82", "17.95", 12],
    ["Near Mint", "Foil", "14.90", "20.86", 12],
    ["Lightly Played", "Foil", "13.57", "19.00", 0],
  ]);
  assert.equal(rows[2].foil, true);
  assert.equal(rows[0].set, "The Hobbit: Eternal-Legal");
  assert.deepEqual(buylistOffers({ variants: [] }), []);
});

test("cards.js game keys map to BinderPOS ids", () => {
  assert.equal(bpGameId("mtg"), "mtg");
  assert.equal(bpGameId("pokemon"), "pokemon");
  assert.equal(bpGameId("yugioh"), "yugioh");
  assert.equal(bpGameId("starwars"), "swu");
  assert.equal(bpGameId("onepiece"), "one");
  assert.equal(bpGameId("riftbound"), "riftbound");
  assert.equal(bpGameId("Magic: The Gathering"), "mtg");
});
