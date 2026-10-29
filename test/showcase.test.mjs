import { test } from "node:test";
import assert from "node:assert/strict";
import { shelvesFor, serveShowcase, CASES, SHELF_MAX, SHOWCASE_COLLECTION } from "../src/showcase.js";

/* The Showcase (owner, 2026-10-29): the physical showcase's cards on the top
   shelf, the game's singles below in price bands, priciest first, no card
   twice, nothing without a price. */
const card = (name, price, extra) => ({ name, set: "Base Set", price: String(price), image: "https://cdn.example/" + name + ".jpg", url: "https://exorgames.com/products/" + name.toLowerCase(), variantId: 1, foil: false, condition: "NM", game: "pokemon", color: "fire", tags: ["x"], ...(extra || {}) });

test("shelvesFor: picks on top, then $100+, $25-$100, under $25; duplicates and unpriced dropped; capped per shelf", () => {
  const picks = [card("Charizard", 450), card("Blastoise", 180), card("Charizard", 450, { set: "Base Set" })];
  const cards = [card("Pidgey", 12), card("Mewtwo", 240), card("Charizard", 455), card("Raichu", 60), card("Rattata", 0), card("Mew", 99.95), card("Zapdos", 100)];
  const shelves = shelvesFor(picks, cards);
  assert.deepEqual(shelves.map((s) => s.key), ["picks", "high", "mid", "low"]);
  assert.deepEqual(shelves[0].cards.map((c) => c.name), ["Charizard", "Blastoise"], "the showcase's own cards, priciest first, once");
  assert.deepEqual(shelves[1].cards.map((c) => c.name), ["Mewtwo", "Zapdos"], "$100 and up; the Charizard already on the top shelf is not laid twice");
  assert.deepEqual(shelves[2].cards.map((c) => c.name), ["Mew", "Raichu"]);
  assert.deepEqual(shelves[3].cards.map((c) => c.name), ["Pidgey"], "Rattata has no price");
  assert.deepEqual(Object.keys(shelves[0].cards[0]).sort(), ["color", "condition", "foil", "game", "image", "name", "price", "set", "url", "variantId"], "only what the page draws");
  assert.equal(shelves[0].tape, "the case up front"); assert.equal(shelves[1].tape, "$100 and up");
  const many = Array.from({ length: 90 }, (_, i) => card("Card" + i, 30 + i));
  assert.equal(shelvesFor([], many).find((s) => s.key === "mid").cards.length, SHELF_MAX);
  assert.deepEqual(shelvesFor([], []), []);
});

test("serveShowcase: one case per game from the showcase feed and the game's feed; a failed feed is reported, not fatal; unknown game = the first case", async () => {
  const asked = [];
  const cardsFn = async (collection, showcase) => {
    asked.push([collection, showcase]);
    if (collection === SHOWCASE_COLLECTION) return [card("Charizard", 450), { ...card("Black Lotus", 9000), game: "mtg" }];
    if (collection === "pokemon-singles-new-arrivals") return [card("Pidgey", 12), card("Mewtwo", 240)];
    throw new Error("feed down");
  };
  const go = (q) => serveShowcase(new Request("https://w.example/showcase.json" + q), {}, {}, { cardsFn });
  let r = await go("?game=pokemon");
  assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.match(r.headers.get("cache-control"), /max-age=300/);
  let j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.game, "pokemon"); assert.equal(j.label, "Pokémon"); assert.equal(j.count, 3);
  assert.deepEqual(j.cases.map((c) => c.key), CASES.map((c) => c.key));
  assert.deepEqual(j.shelves.map((s) => [s.key, s.cards.map((c) => c.name)]), [["picks", ["Charizard"]], ["high", ["Mewtwo"]], ["low", ["Pidgey"]]], "the showcase's Magic card stays out of the Pokémon case");
  assert.deepEqual(asked, [[SHOWCASE_COLLECTION, true], ["pokemon-singles-new-arrivals", false]]);
  // the game feed failing still gives the top shelf, with a note
  r = await go("?game=mtg"); j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j.shelves.map((s) => s.key), ["picks"]); assert.equal(j.shelves[0].cards[0].name, "Black Lotus"); assert.match(j.trouble[0], /feed down/);
  // nothing at all: 503, not cached
  r = await go("?game=yugioh"); assert.equal(r.status, 503); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await (await go("?game=nope")).json()).game, "mtg");
  assert.equal((await serveShowcase(new Request("https://w.example/showcase.json", { method: "OPTIONS" }), {}, {}, { cardsFn })).status, 204);
});
