// Ask Exor (owner 2026-10-20, "do one"): the tools, the grounded loop, the limits, the routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, askDoFetch, serveAsk, searchProducts, runTool, TOOLS, SYSTEM, MODEL, ASK_DO } from "../src/ask.js";
import { groupBuylistPrintings } from "../src/cards.js";

const T0 = Date.UTC(2026, 9, 22, 15, 0, 0);
const ORIGIN = "https://w.example";
class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
}
const cx = (clock) => ({ storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {} });
async function call(c, path, body) { const url = new URL(ORIGIN + path); const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url); return (await askDoFetch(c, req, url)).json(); }

// The storefront's predictive search, as a fake fetch.
const suggest = (products) => async (u) => {
  if (!String(u).includes("/search/suggest.json")) return new Response("no", { status: 404 });
  return Response.json({ resources: { results: { products } } });
};
const PRODUCTS = [
  { title: "Bloomburrow Collector Booster Box", price: "289.95", available: true, type: "MTG Sealed", url: "/products/bloomburrow-collector-booster-box?variant=1", image: "//cdn.example/bb.png" },
  { title: "Bloomburrow Play Booster Box", price: "159.95", available: false, type: "MTG Sealed", url: "/products/bloomburrow-play-booster-box", image: "" },
];

// A fake Anthropic client: a script of responses, one per request, and a record of what was sent.
function fakeClient(script) {
  const sent = [];
  return { sent, beta: { messages: { create: async (params) => { sent.push({ ...params, messages: JSON.parse(JSON.stringify(params.messages)) }); const next = script.shift(); if (!next) throw new Error("script exhausted"); if (next instanceof Error) throw next; return next; } } } };
}
const text = (t, stop) => ({ stop_reason: stop || "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 800 } });
const toolCall = (name, input, id) => ({ stop_reason: "tool_use", content: [{ type: "text", text: "Let me check." }, { type: "tool_use", id: id || "tu_1", name, input }], usage: { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 1000 } });

test("tools are strict and read-only; search_products shapes the store's answer; unknown tools refuse", async () => {
  for (const t of TOOLS) { assert.equal(t.strict, true); assert.equal(t.input_schema.additionalProperties, false); assert.ok(Array.isArray(t.input_schema.required)); }
  assert.deepEqual(TOOLS.map((t) => t.name), ["search_products", "upcoming_events", "buy_price", "market_pulse"]);
  const r = await searchProducts({ query: "bloomburrow", limit: 5 }, suggest(PRODUCTS));
  assert.deepEqual(r.products[0], { title: "Bloomburrow Collector Booster Box", price: "289.95", available: true, type: "MTG Sealed", url: "https://exorgames.com/products/bloomburrow-collector-booster-box", image: "https://cdn.example/bb.png" });
  assert.equal(r.products[1].available, false); assert.equal(r.products[1].image, "");
  assert.deepEqual(await searchProducts({ query: "  " }, suggest(PRODUCTS)), { products: [] });
  await assert.rejects(searchProducts({ query: "x" }, async () => new Response("down", { status: 503 })), /search 503/);
  await assert.rejects(runTool("rm_rf", {}, {}), /unknown tool/);
  assert.match(SYSTEM, /Never state that something is in stock/); assert.match(SYSTEM, /call buy_price FIRST/); assert.equal(MODEL, "claude-opus-5-5");
});

// BinderPOS's buylist search, as its hits look: a card per printing with variants (conditions) x cardBuylistTypes (finishes).
const bp = (id, cardName, setName, rows) => ({ id, cardName, setName, variants: rows.map(([cond, types]) => ({ variantName: cond, cardBuylistTypes: types.map(([type, buy, credit, max]) => ({ type, buyPrice: buy, creditBuyPrice: credit, maxPurchaseQuantity: max })) })) });
const BOLTS = [
  bp(1, "Lightning Bolt", "Magic Player Rewards 2010", [["Lightly Played", [["Foil", 28.72, 40.22, 1]]]]),
  bp(2, "Lightning Bolt", "Revised Edition", [["Near Mint", [["Normal", 1.5, 2.1, 8]]], ["Lightly Played", [["Normal", 1.2, 1.7, 8]]], ["Damaged", [["Normal", 0.1, 0.2, 8]]]]),
  bp(3, "Lightning Bolt (Borderless)", "Modern Horizons 3", [["Near Mint", [["Normal", 2.0, 2.8, 4], ["Foil", 3.0, 4.2, 2]]]]),
  bp(4, "Lightning Bolt", "Limited Edition Alpha", [["Near Mint", [["Normal", 0, 0, 0]]]]),   // on their list, every price 0
  bp(5, "Lightning Helix", "Ravnica", [["Near Mint", [["Normal", 0.5, 0.7, 8]]]]),
  bp(2, "Lightning Bolt", "Revised Edition", []),   // a duplicate hit from the next page
];
test("buy_price: every printing of the card, best offer first, the named set flagged when missing; the tool wraps it with the staff-quote note", async () => {
  const r = groupBuylistPrintings(BOLTS, "lightning bolt", "");
  assert.deepEqual(r.printings.map((p) => p.set), ["Magic Player Rewards 2010", "Modern Horizons 3", "Revised Edition", "Limited Edition Alpha"]);
  assert.equal(r.printings_on_buylist, 4); assert.equal(r.buying, true);
  assert.deepEqual(r.printings[2].offers, [{ condition: "Near Mint", finish: "Normal", cash: "1.50", credit: "2.10", max: 8 }, { condition: "Lightly Played", finish: "Normal", cash: "1.20", credit: "1.70", max: 8 }], "Damaged dropped");
  assert.deepEqual(r.printings[3].offers, [], "all-zero prices = listed but not bought");
  const beta = groupBuylistPrintings(BOLTS, "Lightning Bolt", "Beta");
  assert.equal(beta.set_asked, "Beta"); assert.equal(beta.set_on_buylist, false); assert.equal(beta.printings.length, 4, "the whole list still shows");
  const rev = groupBuylistPrintings(BOLTS, "Lightning Bolt", "revised");
  assert.equal(rev.set_on_buylist, true); assert.deepEqual(rev.printings.map((p) => p.set), ["Revised Edition"]);
  assert.deepEqual(groupBuylistPrintings(BOLTS, "Black Lotus", ""), { card: "Black Lotus", printings_on_buylist: 0, buying: false, printings: [] });
  const calls = [];
  const searchFn = async (game, kw, off) => { calls.push([game, kw, off]); return off === 0 ? BOLTS : []; };
  const out = await runTool("buy_price", { card_name: "Lightning Bolt", game: "Magic", set: "Beta" }, { searchFn });
  assert.deepEqual(calls, [["mtg", "Lightning Bolt", 0]], "one page when it is short");
  assert.equal(out.game, "mtg"); assert.equal(out.buying, true); assert.equal(out.set_on_buylist, false); assert.match(out.staff_quote, /charlottetown@exorgames.com/); assert.match(out.sellPage, /sell-to-exor-games/);
  assert.deepEqual(await runTool("buy_price", { card_name: " " }, { searchFn }), { error: "give the card's name" });
  const t = TOOLS.find((x) => x.name === "buy_price"); assert.deepEqual(Object.keys(t.input_schema.properties), ["card_name", "game", "set"]); assert.deepEqual(t.input_schema.required, ["card_name"]);
});

test("ask: a tool round feeds the store's answer back; products come out as cards; the request is shaped for caching, medium effort and fallbacks", async () => {
  const client = fakeClient([toolCall("search_products", { query: "bloomburrow collector" }), text("Yes: the Bloomburrow Collector Booster Box is in stock at $289.95: https://exorgames.com/products/bloomburrow-collector-booster-box")]);
  const r = await ask({ ANTHROPIC_API_KEY: "k" }, "do you have bloomburrow collector boxes?", [], { client, fetchFn: suggest(PRODUCTS), now: T0 });
  assert.equal(r.ok, true); assert.match(r.answer, /in stock at \$289\.95/); assert.equal(r.rounds, 1); assert.deepEqual(r.toolsUsed, ["search_products"]);
  assert.equal(r.products.length, 1, "cards only for the products the answer names"); assert.equal(r.products[0].title, "Bloomburrow Collector Booster Box");
  const quiet = await ask({ ANTHROPIC_API_KEY: "k" }, "any bloomburrow?", [], { client: fakeClient([toolCall("search_products", { query: "bloomburrow" }), text("Yes, two Bloomburrow boxes are listed; the Play Booster Box is sold out at the moment.")]), fetchFn: suggest(PRODUCTS), now: T0 });
  assert.deepEqual(quiet.products, [], "no link named, no cards");
  const both = await ask({ ANTHROPIC_API_KEY: "k" }, "bloomburrow boxes?", [], { client: fakeClient([toolCall("search_products", { query: "bloomburrow" }), text("Play Booster Box (sold out): exorgames.com/products/bloomburrow-play-booster-box. Collector: https://exorgames.com/products/bloomburrow-collector-booster-box.")]), fetchFn: suggest(PRODUCTS), now: T0 });
  assert.deepEqual(both.products.map((p) => p.title), ["Bloomburrow Play Booster Box", "Bloomburrow Collector Booster Box"], "in the answer's order, bare links count");
  assert.deepEqual(r.usage, { input: 2100, output: 100, cacheRead: 1800 });
  const p1 = client.sent[0];
  assert.equal(p1.model, "claude-opus-5-5"); assert.equal(p1.max_tokens, 1024); assert.deepEqual(p1.betas, ["server-side-fallback-2026-07-01"]); assert.equal(p1.fallbacks, "default");
  assert.deepEqual(p1.output_config, { effort: "medium" }); assert.equal(p1.thinking, undefined, "adaptive by default on this model");
  assert.deepEqual(p1.system[0].cache_control, { type: "ephemeral" }); assert.equal(p1.tools, TOOLS);
  assert.deepEqual(p1.messages, [{ role: "user", content: "do you have bloomburrow collector boxes?" }]);
  const p2 = client.sent[1];
  assert.equal(p2.messages.length, 3); assert.equal(p2.messages[1].role, "assistant"); assert.equal(p2.messages[2].role, "user");
  const tr = p2.messages[2].content[0];
  assert.equal(tr.type, "tool_result"); assert.equal(tr.tool_use_id, "tu_1"); assert.equal(tr.is_error, false);
  assert.equal(JSON.parse(tr.content).products.length, 2);
});

test("ask: history rides along (last six turns, a dangling user turn dropped); a tool failure is reported to the model, not fatal; rounds are capped; refusals and empty questions", async () => {
  let client = fakeClient([text("Sure.")]);
  const hist = [];
  for (let i = 0; i < 5; i++) hist.push({ role: "user", content: "q" + i }, { role: "assistant", content: "a" + i });
  hist.push({ role: "user", content: "dangling" });
  await ask({}, "next", hist, { client });
  const m = client.sent[0].messages;
  assert.equal(m.length, 6, "five history turns kept (the dangling one went) plus the question");
  assert.equal(m[0].content, "a2"); assert.equal(m[m.length - 1].content, "next");
  client = fakeClient([toolCall("search_products", { query: "x" }), text("The search is down right now; try again in a moment.")]);
  const r = await ask({}, "x?", [], { client, fetchFn: async () => new Response("", { status: 500 }) });
  assert.equal(r.ok, true); assert.deepEqual(r.toolsUsed, []);
  const tr = client.sent[1].messages[2].content[0];
  assert.equal(tr.is_error, true); assert.match(JSON.parse(tr.content).error, /search 500/);
  const loop = fakeClient([1, 2, 3, 4, 5, 6].map((i) => toolCall("search_products", { query: "again" }, "tu_" + i)));
  const capped = await ask({}, "loop", [], { client: loop, fetchFn: suggest([]) });
  assert.equal(capped.ok, true); assert.equal(capped.rounds, 5); assert.match(capped.answer, /could not put an answer together|Let me check/);
  assert.equal(loop.sent.length, 5, "four tool rounds, then the fifth call ends it");
  const refused = await ask({}, "something", [], { client: fakeClient([text("", "refusal")]) });
  assert.equal(refused.answer, "That is not something I can help with here.");
  assert.equal((await ask({}, "   ", [])).ok, false);
  const api = Object.assign(new Error("overloaded"), { status: 429 });
  const busy = await ask({}, "hi", [], { client: fakeClient([api]) });
  assert.equal(busy.ok, false); assert.equal(busy.status, 429); assert.match(busy.error, /could not answer|busy/);
});

test("DO: limits per address per hour and per day; day counts; sweep", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  for (let i = 0; i < 20; i++) assert.equal((await call(c, "/_ask/allow", { ipHash: "abc" })).allowed, true);
  const no = await call(c, "/_ask/allow", { ipHash: "abc" });
  assert.equal(no.allowed, false); assert.match(no.reason, /one hour/);
  assert.equal((await call(c, "/_ask/allow", { ipHash: "def" })).allowed, true, "another address");
  await call(c, "/_ask/note", { ok: true, tools: 2, input: 2000, output: 100, cacheRead: 1500 });
  await call(c, "/_ask/note", { ok: false });
  let h = await call(c, "/_ask/health");
  assert.deepEqual(h.today, { day: "2026-10-22", asks: 21, answered: 1, failed: 1, limited: 1, tools: 2, input: 2000, output: 100, cacheRead: 1500 });
  clock.t = T0 + 2 * 3600e3;
  assert.equal((await call(c, "/_ask/allow", { ipHash: "abc" })).allowed, true, "a new hour");
  assert.deepEqual((await call(c, "/_ask/sweep", {})).counts, { rows: 2 }, "the two old hourly rows");
  await c.storage.put("day:2026-10-22", { asks: 1500, answered: 0, failed: 0, limited: 0, tools: 0, input: 0, output: 0, cacheRead: 0 });
  clock.t = T0;
  const full = await call(c, "/_ask/allow", { ipHash: "zzz" });
  assert.equal(full.allowed, false); assert.match(full.reason, /today/);
});

test("routes: 503 without a key; the gate; a grounded answer with cards; health counts only; CORS for the store", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const env = { ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n !== ASK_DO) return new Response("wrong store", { status: 404 }); return askDoFetch(c, req, url); } }) }, ASSETS: { fetch: async () => new Response("<!doctype html><title>Ask</title>", { headers: { "content-type": "text/html" } }) } };
  const go = (path, body, extra) => { const url = new URL(ORIGIN + path); const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://exorgames.com", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) }) : new Request(url); return serveAsk(req, env, url, null, extra); };
  let r = await go("/ask.json", { q: "hi" });
  assert.equal(r.status, 503); assert.equal((await r.json()).configured, false);
  env.ANTHROPIC_API_KEY = "k";
  const client = fakeClient([toolCall("search_products", { query: "bloomburrow" }), text("In stock: https://exorgames.com/products/bloomburrow-collector-booster-box")]);
  r = await go("/ask.json", { q: "bloomburrow?" }, { client, fetchFn: suggest(PRODUCTS) });
  assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), "https://exorgames.com");
  const j = await r.json();
  assert.equal(j.ok, true); assert.match(j.answer, /In stock/); assert.equal(j.products.length, 1, "the one product the answer links"); assert.equal(j.products[0].title, "Bloomburrow Collector Booster Box"); assert.ok(typeof j.ms === "number");
  let h = await (await go("/ask/health")).json();
  assert.equal(h.configured, true); assert.equal(h.today.asks, 1); assert.equal(h.today.answered, 1); assert.equal(h.today.tools, 1); assert.deepEqual(h.tools, ["search_products", "upcoming_events", "buy_price", "market_pulse"]);
  assert.equal(JSON.stringify(h).includes("bloomburrow"), false, "no questions in health");
  for (let i = 0; i < 19; i++) await go("/ask.json", { q: "again" }, { client: fakeClient([text("ok")]) });
  r = await go("/ask.json", { q: "once more" }, { client: fakeClient([text("ok")]) });
  assert.equal(r.status, 429); assert.equal((await r.json()).limited, true);
  r = await go("/ask");
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/html/);
  const url = new URL(ORIGIN + "/ask.json");
  assert.equal((await serveAsk(new Request(url, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env, url, null)).headers.get("access-control-allow-origin"), "https://exorgames.com", "an unknown origin gets the store's, not its own");
  assert.equal((await go("/ask/nope")).status, 404);
});
