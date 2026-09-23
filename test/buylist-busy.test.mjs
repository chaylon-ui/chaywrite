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
