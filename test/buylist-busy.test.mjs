import { test } from "node:test";
import assert from "node:assert/strict";
import { serveBuylist, cleanCards } from "../src/buylist.js";

// BinderPOS's portal answers Cloudflare 429 "error code: 1015" after ~8
// quick searches (probes 2026-09-23). The sell page must be able to tell
// that from "no such card", and a save it refuses must not look saved.
const W = "https://exor-binder.nevski.workers.dev";
const req = (path, init) => new Request(W + path, { headers: { origin: "https://exorgames.com" }, ...init });
function upstream(status, body) {
  globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

test("a rate-limited search is a 503 busy, not an empty result", async () => {
  upstream(429, "error code: 1015");
  const r = await serveBuylist(req("/buylist/api/search?q=fireball&game=mtg"), {});
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.busy, true);
  assert.equal(j.hits, undefined);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://exorgames.com");
});

test("a search that answers still passes its hits through", async () => {
  upstream(200, [{ id: 1, cardName: "Fireball" }]);
  const r = await serveBuylist(req("/buylist/api/search?q=fireball&game=mtg"), {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.count, 1);
  assert.equal(j.hits[0].cardName, "Fireball");
  // an empty answer is a real "nothing matches"
  upstream(200, []);
  const e = await (await serveBuylist(req("/buylist/api/search?q=zzzz&game=mtg"), {})).json();
  assert.deepEqual(e.hits, []);
});

test("a save BinderPOS refuses is an error the page sees", async () => {
  upstream(429, "error code: 1015");
  const body = JSON.stringify({ cards: [{ cardId: 1, quantity: "1" }] });
  const r = await serveBuylist(req("/buylist/api/save?customer=1234567", { method: "POST", body }), {});
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /did not save/);
  upstream(200, { actionPass: false, message: "nope" });
  assert.equal((await serveBuylist(req("/buylist/api/save?customer=1234567", { method: "POST", body }), {})).status, 502);
  upstream(200, { actionPass: true });
  assert.equal((await serveBuylist(req("/buylist/api/save?customer=1234567", { method: "POST", body }), {})).status, 200);
});

test("lists longer than 100 lines are kept whole", () => {
  const cards = Array.from({ length: 180 }, (_, i) => ({ cardId: i, quantity: "1" }));
  assert.equal(cleanCards(cards).length, 180);
  assert.equal(cleanCards(Array.from({ length: 900 }, (_, i) => ({ cardId: i }))).length, 500);
});

// "Cards we need most" (the sell page's first view) is built once a day,
// but what it shows we pay must be BinderPOS's price now (owner,
// 2026-09-23: "it needs to pull the price from binderpos every refresh").
test("the wanted strip's prices are BinderPOS's current ones", async () => {
  const { livePrices } = await import("../src/buylist.js");
  const env = { BINDERPOS_LOGIN_EMAIL: "x", BINDERPOS_LOGIN_PASSWORD: "y" };
  const asked = [];
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.includes("verifyPassword")) return new Response(JSON.stringify({ idToken: "t", expiresIn: 3600 }));
    if (u.includes("supportedGames")) return new Response(JSON.stringify(["mtg"]));
    if (u.includes("allPrices")) {
      asked.push(JSON.parse(init.body));
      return new Response(JSON.stringify([{ id: 11, variants: [{ id: 1, variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: 5.5, creditBuyPrice: 7.7, maxPurchaseQuantity: 3, productVariantId: 99 }] }] }]));
    }
    throw new Error("unexpected " + u);
  };
  const T = (type, buy) => ({ type, buyPrice: buy, creditBuyPrice: buy * 1.4, maxPurchaseQuantity: 8, productVariantId: 1 });
  const hits = [
    { id: 11, cardName: "Sol Ring", game: "Magic: The Gathering", variants: [{ id: 1, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 2), T("Foil", 9)] }] },
    { id: 22, cardName: "Gone Card", game: "Magic: The Gathering", variants: [{ id: 1, variantName: "Near Mint", cardBuylistTypes: [T("Normal", 1)] }] },
  ];
  const out = await livePrices(env, hits);
  assert.equal(asked.length, 1);                                   // one call for the whole strip
  assert.deepEqual(asked[0], [{ game: "mtg", ids: [11, 22] }]);
  assert.equal(out.length, 1);                                     // a card BinderPOS no longer returns is left out
  const [normal, foil] = out[0].variants[0].cardBuylistTypes;
  assert.equal(normal.buyPrice, 5.5); assert.equal(normal.creditBuyPrice, 7.7); assert.equal(normal.maxPurchaseQuantity, 3); assert.equal(normal.productVariantId, 99);
  assert.equal(foil.buyPrice, 0); assert.equal(foil.maxPurchaseQuantity, 0);   // an offer no longer there is not shown
  assert.equal(hits[0].variants[0].cardBuylistTypes[0].buyPrice, 2);           // the stored list is not mutated
});

test("the strip's own game is asked, whatever the cards' game label says", async () => {
  const { livePrices } = await import("../src/buylist.js");
  const env = { BINDERPOS_LOGIN_EMAIL: "x", BINDERPOS_LOGIN_PASSWORD: "y" };
  const asked = [];
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.includes("verifyPassword")) return new Response(JSON.stringify({ idToken: "t", expiresIn: 3600 }));
    if (u.includes("supportedGames")) return new Response(JSON.stringify(["mtg", "pokemon"]));
    if (u.includes("allPrices")) { asked.push(JSON.parse(init.body)); return new Response(JSON.stringify([{ id: 7, variants: [] }])); }
    throw new Error("unexpected " + u);
  };
  const out = await livePrices(env, [{ id: 7, cardName: "Charizard ex", game: "Pokémon TCG (English)", variants: [] }], "pokemon");
  assert.deepEqual(asked[0], [{ game: "pokemon", ids: [7] }]);
  assert.equal(out.length, 1);
});
