import { test } from "node:test";
import assert from "node:assert/strict";
import { shelvesFor, serveShowcase, serveShowcaseIcon, serveShowcaseAlike, iconKeys, CASES, SHELF_MAX, SHOWCASE_COLLECTION } from "../src/showcase.js";
import { oracleOf } from "../src/cards.js";

// a 1x1 PNG, the shape the kiosk admin stores (data URL, base64)
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const settingsFn = async () => ({ gicons: { mtg: PNG1, pokemon: PNG1, sleeves: PNG1, yugioh: "javascript:alert(1)" } });

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
  assert.deepEqual(Object.keys(shelves[0].cards[0]).sort(), ["color", "condition", "foil", "game", "image", "name", "price", "set", "text", "type", "url", "variantId"], "only what the page draws");
  assert.equal(shelves[0].tape, "the case up front"); assert.equal(shelves[1].tape, "$100 and up");
  const many = Array.from({ length: 90 }, (_, i) => card("Card" + i, 30 + i));
  assert.equal(shelvesFor([], many).find((s) => s.key === "mid").cards.length, SHELF_MAX);
  assert.deepEqual(shelvesFor([], []), []);
  // an extra shelf (the Japanese Pokémon one) takes its cards before the bands and is laid after them
  const jp = [{ key: "jp", label: "Japanese", tape: "Japanese singles · 日本語", cards: [card("Mewtwo", 240), card("Lillie", 95, { set: "Dream League" })] }];
  const withJp = shelvesFor([], [card("Mewtwo", 240), card("Pidgey", 12)], jp);
  assert.deepEqual(withJp.map((s) => [s.key, s.cards.map((c) => c.name)]), [["low", ["Pidgey"]], ["jp", ["Mewtwo", "Lillie"]]], "the Mewtwo in both feeds sits on the Japanese shelf, not in the $100+ band");
  assert.equal(withJp[1].tape, "Japanese singles · 日本語");
});

test("serveShowcase: one case per game from the showcase feed and the game's feed; a failed feed is reported, not fatal; unknown game = the first case", async () => {
  const asked = [];
  const cardsFn = async (collection, showcase) => {
    asked.push([collection, showcase]);
    if (collection === SHOWCASE_COLLECTION) return [card("Charizard", 450), { ...card("Black Lotus", 9000), game: "mtg" }];
    if (collection === "pokemon-singles-new-arrivals") return [card("Pidgey", 12), card("Mewtwo", 240)];
    if (collection === "pokemon-japanese-singles") return [card("Lillie", 95, { set: "Dream League" })];
    throw new Error("feed down");
  };
  const go = (q) => serveShowcase(new Request("https://w.example/showcase.json" + q), {}, {}, { cardsFn, settingsFn });
  let r = await go("?game=pokemon");
  assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "*"); assert.match(r.headers.get("cache-control"), /max-age=300/);
  let j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.game, "pokemon"); assert.equal(j.label, "Pokémon"); assert.equal(j.count, 4);
  assert.deepEqual(j.cases.map((c) => c.key), CASES.map((c) => c.key));
  assert.deepEqual(j.icons, ["mtg", "pokemon"], "only the cases with a real data-URL icon; sleeves is not a case, the bad yugioh value is dropped");
  assert.deepEqual(j.shelves.map((s) => [s.key, s.cards.map((c) => c.name)]), [["picks", ["Charizard"]], ["high", ["Mewtwo"]], ["low", ["Pidgey"]], ["jp", ["Lillie"]]], "the showcase's Magic card stays out of the Pokémon case; the Japanese shelf sits last");
  assert.equal(j.trouble, undefined);
  assert.deepEqual(asked, [[SHOWCASE_COLLECTION, true], ["pokemon-singles-new-arrivals", false], ["pokemon-japanese-singles", false]]);
  // the game feed failing still gives the top shelf, with a note
  r = await go("?game=mtg"); j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j.shelves.map((s) => s.key), ["picks"]); assert.equal(j.shelves[0].cards[0].name, "Black Lotus"); assert.match(j.trouble[0], /feed down/);
  // nothing at all: 503, not cached
  r = await go("?game=yugioh"); assert.equal(r.status, 503); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await (await go("?game=nope")).json()).game, "mtg");
  assert.equal((await serveShowcase(new Request("https://w.example/showcase.json", { method: "OPTIONS" }), {}, {}, { cardsFn })).status, 204);
  // a settings failure means text tabs, not a broken case
  const noSettings = async () => { throw new Error("room down"); };
  j = await (await serveShowcase(new Request("https://w.example/showcase.json?game=pokemon"), {}, {}, { cardsFn, settingsFn: noSettings })).json();
  assert.equal(j.ok, true); assert.deepEqual(j.icons, []);
});

test("serveShowcaseIcon: the kiosk's data-URL logo served as an image, cached an hour; no icon or no such case = 404", async () => {
  const icon = (g, fn) => serveShowcaseIcon(new Request("https://w.example/showcase/icon/" + g + ".png"), {}, {}, g, { settingsFn: fn || settingsFn });
  let r = await icon("mtg");
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); assert.equal(r.headers.get("cache-control"), "public, max-age=3600"); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const b = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...b.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "PNG signature");
  assert.equal((await icon("riftbound")).status, 404, "no icon uploaded");
  assert.equal((await icon("yugioh")).status, 404, "not a data URL");
  assert.equal((await icon("sleeves")).status, 404, "not a case");
  assert.equal((await icon("mtg", async () => { throw new Error("room down"); })).status, 404);
  assert.deepEqual(iconKeys(null), []);
});

test("oracleOf: the rules text out of a BinderPOS description, entities and tags cleaned; nothing for other games", () => {
  const html = '<table class="singles-description-table"><tr><td>Type:</td><td>Legendary Artifact</td></tr></table><div class="single-description-div"><div class="oracle-text">\n  {T}: Add one mana of any color &amp; <i>draw</i> a card.\n </div><div class="flavor-text">A moment in time.</div></div>';
  assert.equal(oracleOf(html), "{T}: Add one mana of any color & draw a card.");
  assert.equal(oracleOf('<div class="oracle-text">' + "x".repeat(500) + "</div>").length, 400);
  assert.equal(oracleOf('<table><tr><td>Type:</td><td>Supporter</td></tr></table>'), "");
  assert.equal(oracleOf(null), "");
});

test("serveShowcaseAlike: EDHREC's names mapped onto stock for a Magic card; other games and short names answer empty", async () => {
  const similarFn = async (name) => ({ name, names: ["Mox Opal", "Chrome Mox", "Lotus Petal", 42, "Mana Crypt"] });
  const stockFn = async (n) => n === "Lotus Petal" ? null : n === "Mana Crypt" ? Promise.reject(new Error("search down")) : { name: n, set: "Masters", price: "99.00", foil: false, condition: "Near Mint", image: "https://cdn.example/" + n + ".jpg", variantId: 7, url: "https://exorgames.com/products/" + n.toLowerCase().replace(/ /g, "-") };
  const go = (q) => serveShowcaseAlike(new Request("https://w.example/showcase/alike.json" + q), {}, {}, { similarFn, stockFn });
  let r = await go("?game=mtg&name=Mox%20Amber"); let j = await r.json();
  assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /max-age=900/); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(j.names, ["Mox Opal", "Chrome Mox", "Lotus Petal", "Mana Crypt"], "strings only, in EDHREC's order");
  assert.deepEqual(j.cards.map((c) => c.name), ["Mox Opal", "Chrome Mox"], "the ones in stock, a failed lookup dropped");
  assert.equal(j.cards[0].game, "mtg"); assert.deepEqual(Object.keys(j.cards[0]).sort(), ["color", "condition", "foil", "game", "image", "name", "price", "set", "text", "type", "url", "variantId"]);
  j = await (await go("?game=pokemon&name=Steven")).json(); assert.deepEqual(j.cards, []); assert.deepEqual(j.names, []);
  j = await (await go("?game=mtg&name=M")).json(); assert.deepEqual(j.cards, []);
  j = await (await serveShowcaseAlike(new Request("https://w.example/showcase/alike.json?game=mtg&name=Mox%20Amber"), {}, {}, { similarFn: async () => { throw new Error("edhrec down"); }, stockFn })).json();
  assert.equal(j.ok, true); assert.deepEqual(j.cards, []);
  assert.equal((await serveShowcaseAlike(new Request("https://w.example/showcase/alike.json", { method: "OPTIONS" }), {}, {}, {})).status, 204);
});
