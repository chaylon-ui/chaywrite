import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRow, parseRows, parseMovers, pickWanted, matchHit, buildWanted, startWanted, stepWanted, resultOf, internalCandidates, tallySales, baseName, PROFILES, MOVERS_URL, MORE_URLS } from "../src/wanted.js";

// One row exactly as MTGGoldfish served it on 2026-09-22 (probe 35782007459),
// whitespace collapsed; a second with an apostrophe entity in the name.
const row = (name, slug, num, code, price, dollars, pct, sign) => `<tr> <td class='text-end'> <div class='common-price-change'> <span class='${sign}'>${dollars}</span> <span aria-label='Increase Indicator' class='fa fa-arrow-up color-rising' role='img'></span> </div> </td> <td class='text-center'><i class='set-symbol ss ss-fra'></i></td> <td class='col-card movers-card-menu-cell'> <div class='movers-card-cell'> <span class="dropdown deck-preview-actions card-tray-card-menu" data-card-tray-card="true" data-card-uuid="01a0afd1" data-card-url="/price/${slug}/${num}/x"><button name="button" type="button" class="btn btn-sm dropdown-toggle">m</button><ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="/price/${slug}/${num}/x">View Card Details</a></li><li><button name="button" type="button" class="dropdown-item" data-card-tray-card-action="add">Add to Card Tray</button></li><li><a class="dropdown-item" href="/price_alerts?card_id=x&amp;type=paper">Create Price Alert</a></li></ul></span> <span class='card_id card_name'><a data-card-id="${name} &lt;01a0afd1&gt; [${code}]" data-full-image="https://cards.mtggoldfish.com/images/01a0afd1/variants/265/370/card_image.webp" data-full-image-rotation="FALSE" rel="popover" data-turbo-frame="_top" href="/price/${slug}/${num}/x#paper">${name}</a> <span class='card-num'>#${num}</span></span> </div> </td> <td class='text-end'> $ ${price} </td> <td class='text-end'> <span class='${sign}'>${pct}</span> </td> </tr>`;
const table = (title, rows) => `<div class='movers-table-container'> <table class='table table-bordered table-striped table-movers'> <thead> <tr> <th colspan='5'>${title}</th> </tr> </thead> <tbody> ${rows.join(" ")} </tbody> </table> </div>`;
const page = `<h1>Movers &amp; Shakers</h1> <h2>Daily Change</h2> <div class='movers-container'>${
  table("Top Winners", [row("Samut, Tyrant of Naktamun", "reality-fracture", "220", "FRA", "49.98", "+7.12", "+17%", "increase"), row("Starting Town", "final-fantasy", "289", "FIN", "12.08", "+0.75", "+7%", "increase")])}${
  table("Top Losers", [row("Tarmogoyf", "reality-fracture", "116", "FRA", "8.97", "-25.45", "-74%", "decrease")])}</div> <h2>Weekly Change</h2> <div class='movers-container'>${
  table("Top Winners", [row("Samut, Tyrant of Naktamun", "reality-fracture", "220", "FRA", "49.98", "+31.99", "+178%", "increase"), row("Omnipresence", "reality-fracture", "110", "FRA", "49.38", "+29.39", "+147%", "increase"), row("Gideon&#39;s Memorial", "reality-fracture", "198", "FRA", "6.16", "+1.00", "+19%", "increase")])}${
  table("Top Losers", [row("Hexhaven Invigorator", "reality-fracture", "106", "FRA", "43.66", "-30.12", "-41%", "decrease")])}</div>`;

test("parseRow reads name, set code and slug, number, price, dollar and percent change", () => {
  const r = parseRow(row("Samut, Tyrant of Naktamun", "reality-fracture", "220", "FRA", "49.98", "+31.99", "+178%", "increase"));
  assert.deepEqual(r, { name: "Samut, Tyrant of Naktamun", setCode: "FRA", setSlug: "reality-fracture", number: "220", image: "https://cards.mtggoldfish.com/images/01a0afd1/variants/265/370/card_image.webp", price: 49.98, change: 31.99, pct: 178 });
  assert.equal(parseRow("<tr><td>Top Winners</td></tr>"), null);
  assert.equal(parseRow(row("Gideon&#39;s Memorial", "reality-fracture", "198", "FRA", "6.16", "-1.00", "-19%", "decrease")).name, "Gideon's Memorial");
});

test("parseMovers splits daily and weekly, winners and losers; pickWanted takes weekly winners first, then daily, no repeats", () => {
  const p = parseMovers(page);
  assert.deepEqual(p.daily.winners.map((c) => c.name), ["Samut, Tyrant of Naktamun", "Starting Town"]);
  assert.deepEqual(p.daily.losers.map((c) => c.name), ["Tarmogoyf"]);
  assert.deepEqual(p.weekly.winners.map((c) => c.name), ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial"]);
  assert.deepEqual(p.weekly.losers.map((c) => c.name), ["Hexhaven Invigorator"]);
  assert.deepEqual(pickWanted(p, 10).map((c) => c.name), ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial", "Starting Town"]);
  assert.deepEqual(pickWanted(p, 2).map((c) => c.name), ["Samut, Tyrant of Naktamun", "Omnipresence"]);
  assert.deepEqual(pickWanted(parseMovers(""), 10), []);
});

const hit = (cardName, setName, cash) => ({ id: cardName + "|" + setName, cardName, setName, variants: [{ variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: cash, creditBuyPrice: cash * 1.3 }] }] });
test("matchHit wants the exact name from the named set, else a regular printing, else the best offer", () => {
  const entry = { name: "Ghalta, Stampede Tyrant", setSlug: "lost-caverns-of-ixalan" };
  const hits = [hit("Ghalta, Stampede Tyrant // Foo", "Weird", 99), hit("Ghalta, Stampede Tyrant", "The Lost Caverns of Ixalan", 10), hit("Ghalta, Stampede Tyrant", "Commander: The Lost Caverns of Ixalan", 12), hit("Ghalta, Stampede Tyrant", "Secret Lair Drop", 30)];
  assert.equal(matchHit(entry, hits).setName, "The Lost Caverns of Ixalan");   // both carry the slug's words; the one named exactly wins
  assert.equal(matchHit({ name: "Ghalta, Stampede Tyrant", setSlug: "nowhere-set" }, hits).setName, "The Lost Caverns of Ixalan");   // Secret Lair pays more but is special; of the regulars, the cheapest (most common)
  assert.equal(matchHit({ name: "Ghalta, Stampede Tyrant", setSlug: "" }, hits).setName, "The Lost Caverns of Ixalan");
  assert.equal(matchHit({ name: "Ghalta, Stampede Tyrant", setSlug: "the-lost-caverns-of-ixalan" }, hits).setName, "The Lost Caverns of Ixalan");   // the exact set wins over one containing its words
  assert.equal(matchHit({ name: "Not There", setSlug: "" }, hits), null);
  assert.equal(matchHit({ name: "GHALTA, stampede tyrant" }, [hit("Ghalta, Stampede Tyrant", "X", 1)]).setName, "X");   // case and punctuation do not matter
  // a printing with no offer the store will take is not a match (the page would say "Not currently buying this printing")
  const dead = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [{ variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: 0, creditBuyPrice: 0 }] }] };
  const capped = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [{ variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: 4, creditBuyPrice: 5, maxPurchaseQuantity: 0 }] }] };
  const none = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [] };
  assert.equal(matchHit({ name: "Lyra, Tolarian Archangel" }, [dead, capped, none]), null);
  assert.equal(matchHit({ name: "Lyra, Tolarian Archangel" }, [dead, hit("Lyra, Tolarian Archangel", "Other", 2)]).setName, "Other");
  // regular printings beat promos and judge cards that pay more; the exact set beats one that merely contains its words
  const bolts = [hit("Lightning Bolt", "Judge Gift Cards 1998", 90), hit("Lightning Bolt", "Alpha Edition", 400), hit("Lightning Bolt", "Magic 2010", 1), hit("Lightning Bolt", "Secret Lair Drop", 12)];
  assert.equal(matchHit({ name: "Lightning Bolt", setSlug: "" }, bolts).setName, "Magic 2010");
  const emer = [hit("Emeritus of Conflict", "Secrets of Strixhaven Promos", 9), hit("Emeritus of Conflict", "Secrets of Strixhaven", 4)];
  assert.equal(matchHit({ name: "Emeritus of Conflict", setSlug: "secrets-of-strixhaven" }, emer).setName, "Secrets of Strixhaven");
  assert.equal(matchHit({ name: "Emeritus of Conflict", setSlug: "secrets-of-strixhaven-promos" }, emer).setName, "Secrets of Strixhaven Promos");
  // no penny printings: the cheapest regular printing worth $0.25 or more, and none at all when nothing clears it
  const umbras = [hit("Boar Umbra", "Planechase Anthology", 0.01), hit("Boar Umbra", "Rise of the Eldrazi", 0.4), hit("Boar Umbra", "Commander 2018", 0.3)];
  assert.equal(matchHit({ name: "Boar Umbra", setSlug: "" }, umbras).setName, "Commander 2018");
  assert.equal(matchHit({ name: "Boar Umbra", setSlug: "planechase-anthology" }, umbras).setName, "Commander 2018");   // the exact set pays a penny: another printing instead
  assert.equal(matchHit({ name: "Boar Umbra", setSlug: "" }, [hit("Boar Umbra", "Planechase Anthology", 0.02)]), null);
});

const morePage = (names) => `<h1>Top Weekly Winners</h1>${table("Top Weekly Winners", names.map((nm, i) => row(nm, "some-set", String(i), "SET", "3.00", "+1.00", "+10%", "increase")))}`;
test("parseRows reads every card row of a View More page", () => {
  assert.deepEqual(parseRows(morePage(["A", "B", "C"])).map((c) => c.name), ["A", "B", "C"]);
  assert.deepEqual(parseRows(""), []);
});

test("buildWanted: front-page winners first, in rank order, with the mover's numbers attached; misses listed", async () => {
  const asked = [];
  const search = async (name) => { asked.push(name); return name === "Omnipresence" ? [] : [hit(name, "Reality Fracture", 5), hit(name, "Other", 2)]; };
  const fetchFn = async (url) => new Response(url === MOVERS_URL ? page : morePage([]), { status: 200 });
  const v = await buildWanted({ fetchFn, search, n: 10, delayMs: 0 });
  assert.equal(v.count, 3);
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.setName, h.wanted.rank, h.wanted.source]), [["Samut, Tyrant of Naktamun", "Reality Fracture", 1, "movers"], ["Gideon's Memorial", "Reality Fracture", 2, "movers"], ["Starting Town", "Other", 3, "movers"]]);   // its slug (final-fantasy) matches neither hit, so the cheaper regular printing wins
  assert.deepEqual(v.missed, ["Omnipresence"]);
  assert.deepEqual(asked, ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial", "Starting Town"]);
  assert.deepEqual(v.pages, [MOVERS_URL, MORE_URLS.weekly, MORE_URLS.daily]);   // both View More pages were tried and were empty
  assert.equal(v.picked.length, 4);
  assert.deepEqual(v.probe.map((p) => [p.name, p.got, p.matched]), [["Samut, Tyrant of Naktamun", 2, "Reality Fracture"], ["Omnipresence", 0, null], ["Gideon's Memorial", 2, "Reality Fracture"], ["Starting Town", 2, "Other"]]);
  await assert.rejects(buildWanted({ fetchFn: async () => new Response("nope", { status: 403 }), search }), /HTTP 403/);
  await assert.rejects(buildWanted({ fetchFn: async () => new Response("<html></html>", { status: 200 }), search }), /no movers rows/);
});

test("buildWanted walks the View More lists when the front page's winners are not on the buylist, and stops at n", async () => {
  const asked = [];
  const onBuylist = new Set(["Weekly 3", "Weekly 7", "Daily 1"]);
  const search = async (name) => { asked.push(name); return onBuylist.has(name) ? [hit(name, "Some Set", 4)] : []; };
  const weekly = Array.from({ length: 12 }, (_, i) => "Weekly " + i), daily = ["Daily 0", "Daily 1"];
  const fetchFn = async (url) => new Response(url === MOVERS_URL ? page : url === MORE_URLS.weekly ? morePage(weekly) : morePage(daily), { status: 200 });
  const v = await buildWanted({ fetchFn, search, n: 2, delayMs: 0 });
  assert.deepEqual(v.hits.map((h) => h.cardName), ["Weekly 3", "Weekly 7"]);
  assert.equal(v.count, 2);
  assert.deepEqual(v.pages, [MOVERS_URL, MORE_URLS.weekly]);                    // the daily list was never needed
  assert.ok(!asked.includes("Daily 1"));
  assert.ok(asked.length <= 4 + 10);                                              // front page (4) + at most two batches of five
  // nothing anywhere: every name tried, count 0, no throw
  const none = await buildWanted({ fetchFn, search: async () => [], n: 10, delayMs: 0 });
  assert.equal(none.count, 0);
  assert.deepEqual(none.pages, [MOVERS_URL, MORE_URLS.weekly, MORE_URLS.daily]);
  assert.equal(none.tried, 4 + 12 + 2);
});

test("buildWanted keeps a lookup's status and body shape, and a thrown lookup, in its probe notes", async () => {
  const fetchFn = async (url) => new Response(url === MOVERS_URL ? page : morePage([]), { status: 200 });
  const answers = { "Samut, Tyrant of Naktamun": { status: 200, hits: [hit("Samut, Tyrant of Naktamun", "Reality Fracture", 9)], bodyType: "array" }, "Omnipresence": { status: 502, hits: [], bodyType: "text:Bad Gateway" } };
  const search = async (name) => { if (name === "Gideon's Memorial") throw new Error("boom"); return answers[name] || { status: 200, hits: [], bodyType: "array" }; };
  const v = await buildWanted({ fetchFn, search, n: 10, delayMs: 0 });
  assert.equal(v.count, 1);
  assert.deepEqual(v.probe.map((p) => [p.name, p.status, p.got, p.bodyType, p.error]), [["Samut, Tyrant of Naktamun", 200, 1, "array", null], ["Omnipresence", 502, 0, "text:Bad Gateway", null], ["Gideon's Memorial", null, 0, "error", "boom"], ["Starting Town", 200, 0, "array", null]]);
});

test("stepWanted does a few lookups per tick, keeps its place, and backs off on a 429 without losing the name", async () => {
  const weekly = Array.from({ length: 12 }, (_, i) => "Weekly " + i);
  const fetchFn = async (url) => new Response(url === MOVERS_URL ? page : url === MORE_URLS.weekly ? morePage(weekly) : morePage([]), { status: 200 });
  const asked = [];
  let limitNext = false;
  const search = async (name) => { asked.push(name); if (limitNext) { limitNext = false; return { status: 429, hits: [], bodyType: "text:error code: 1015" }; } return name === "Weekly 2" || name === "Weekly 5" ? { status: 200, hits: [hit(name, "S", 3)], bodyType: "array" } : { status: 200, hits: [], bodyType: "array" }; };
  let state = await startWanted({ fetchFn, search, n: 2 });
  let r = await stepWanted(state, { fetchFn, search, budget: 3, delayMs: 0 });
  assert.equal(r.done, false); assert.equal(r.state.tried, 3); assert.deepEqual(asked, ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial"]);
  limitNext = true;                                               // the next lookup is rate limited
  r = await stepWanted(JSON.parse(JSON.stringify(r.state)), { fetchFn, search, budget: 3, delayMs: 0 });   // state survives a JSON round trip
  assert.equal(r.done, false); assert.equal(r.state.tried, 3); assert.ok(r.state.backoffUntil > Date.now());
  assert.equal(r.state.queue[0].name, "Starting Town");            // put back for the next tick
  assert.equal(r.state.probe.at(-1).status, 429);
  r.state.backoffUntil = 0;
  r = await stepWanted(r.state, { fetchFn, search, budget: 5, delayMs: 0 });   // Starting Town, then the View More page: Weekly 0..3
  assert.equal(r.state.tried, 8); assert.equal(r.state.hits.length, 1); assert.equal(r.done, false);
  r = await stepWanted(r.state, { fetchFn, search, budget: 5, delayMs: 0 });   // Weekly 4, 5 -> two hits, done
  assert.equal(r.done, true);
  const v = resultOf(r.state);
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.wanted.rank]), [["Weekly 2", 1], ["Weekly 5", 2]]);
  assert.equal(v.tried, 10);
  assert.deepEqual(v.pages, [MOVERS_URL, MORE_URLS.weekly]);
});

const order = (...items) => ({ lineItems: { nodes: items.map(([title, quantity, productType, totalInventory]) => ({ title, quantity, product: { productType, totalInventory } })) } });
test("tallySales counts Magic singles by card name with the sets sold and the lowest stock now; sealed and other games are ignored", () => {
  const t = tallySales([
    order(["Sol Ring [Commander 2016]", 2, "MTG Single", 0], ["Sol Ring (Borderless) (0421) [Commander Masters]", 1, "MTG Single", 5], ["Snow-Covered Forest (284) [Kaldheim]", 3, "MTG Single", 50], ["Charizard ex [Obsidian Flames]", 3, "Pokemon Single", 0], ["Bloomburrow Play Booster Box", 1, "MTG Sealed", 4]),
    order(["Sol Ring [Commander 2016]", 1, "MTG Single", 0], ["Roaming Throne [The Lost Caverns of Ixalan]", 4, "MTG Single", 9]),
  ]);
  assert.deepEqual(Object.keys(t).sort(), ["Roaming Throne", "Snow-Covered Forest", "Sol Ring"]);   // collector numbers and treatments stripped
  assert.deepEqual(t["Sol Ring"], { units: 4, sets: { "Commander 2016": 3, "Commander Masters": 1 }, inv: 0 });
  assert.deepEqual(t["Roaming Throne"], { units: 4, sets: { "The Lost Caverns of Ixalan": 4 }, inv: 9 });
});

test("internalCandidates interleaves best sellers (any stock) with deck-builder misses, skips basics, and notes a denied orders read", async () => {
  const io = {
    overview: async () => ({ miss: { mtg: [{ name: "Rogue's Passage", c: 26 }, { name: "Fireshrieker", c: 16 }, { name: "One Off", c: 1 }] } }),
    orders: async ({ after }) => after ? { orders: { nodes: [], pageInfo: { hasNextPage: false } } } : { orders: { nodes: [
      order(["Rogue's Passage [Commander 2014]", 2, "MTG Single", 0], ["Island [Bloomburrow]", 30, "MTG Single", 99]),
      order(["Roaming Throne [The Lost Caverns of Ixalan]", 5, "MTG Single", 1], ["Sol Ring [Commander 2016]", 9, "MTG Single", 40]),
    ], pageInfo: { hasNextPage: true, endCursor: "x" } } },
  };
  const r = await internalCandidates({}, io);
  assert.deepEqual(r.notes, { misses: 2, orders: 2, sold: 4, sellers: 3, ordersError: null, missesError: null });
  // seller, miss, seller, miss...: Sol Ring (9, plenty in stock - still a best seller), Rogue's Passage (miss 26), Roaming Throne (5), Fireshrieker (16); Rogue's Passage sold 2 but is already in
  assert.deepEqual(r.candidates.map((c) => c.name), ["Sol Ring", "Rogue's Passage", "Roaming Throne", "Fireshrieker"]);
  assert.equal(r.candidates[0].setSlug, "commander-2016");
  assert.ok(!("why" in r.candidates[0]));
  const denied = await internalCandidates({}, { overview: io.overview, orders: async () => ({ orders: null }) });
  assert.deepEqual(denied.candidates.map((c) => c.name), ["Rogue's Passage", "Fireshrieker"]);
  assert.match(denied.notes.ordersError, /orders not readable/);
});

test("startWanted puts internal candidates ahead of the movers, keeps going when the movers page fails, and the hits say why", async () => {
  const candidates = async () => ({ candidates: [{ name: "Rogue's Passage", setSlug: "commander-2014", source: "internal", misses: 26, units: 2, inv: 0 }], notes: { misses: 1 } });
  const fetchFn = async (url) => new Response(url === MOVERS_URL ? page : morePage([]), { status: 200 });
  const search = async (name) => [hit(name, "Commander 2014", 3), hit(name, "Reality Fracture", 5)];
  let state = await startWanted({ fetchFn, search, candidates, n: 3 });
  assert.deepEqual(state.queue.slice(0, 2).map((c) => c.name), ["Rogue's Passage", "Samut, Tyrant of Naktamun"]);
  assert.deepEqual(state.pages, ["internal", MOVERS_URL]);
  const r = await stepWanted(state, { fetchFn, search, budget: 3, delayMs: 0 });
  const v = resultOf(r.state);
  assert.equal(v.internal, 1);
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.setName, h.wanted.source, h.wanted.rank]), [["Rogue's Passage", "Commander 2014", "internal", 1], ["Samut, Tyrant of Naktamun", "Reality Fracture", "movers", 2], ["Omnipresence", "Reality Fracture", "movers", 3]]);
  assert.ok(v.hits.every((h) => !("why" in h.wanted) && !("misses" in h.wanted)));   // no reasons reach the page
  // movers page down: the internal list alone still builds
  const down = await startWanted({ fetchFn: async () => new Response("nope", { status: 503 }), search, candidates, n: 3 });
  assert.deepEqual(down.pages, ["internal"]); assert.equal(down.queue.length, 1); assert.match(down.sources.moversError, /503/);
  await assert.rejects(startWanted({ fetchFn: async () => new Response("nope", { status: 503 }), search, n: 3 }), /503/);
});

/* ---- Pokemon (owner, 2026-09-23: "Just English") ---- */
const PKM = PROFILES.pokemon;
test("baseName drops the set, extra tags and every trailing (...)", () => {
  assert.equal(baseName("Pikachu (6/12) (Cosmos Holo) [Staff] [Some Set]"), "Pikachu");
  assert.equal(baseName("Boss's Orders (Ghetsis) (265/182)"), "Boss's Orders");
  assert.equal(baseName("Charizard ex"), "Charizard ex");
});

test("tallySales for Pokemon counts English singles by printing; Japanese, graded, sealed and Magic are left out", () => {
  const t = tallySales([
    order(["Charizard ex (199/165) [Scarlet & Violet: 151]", 2, "Pokemon Single", 0], ["Charizard ex (006/165) [Scarlet & Violet: 151]", 1, "Pokemon Single", 4], ["Pikachu (093) [Staff] [Mega Evolution Promo]", 1, "Pokemon Single", 0]),
    order(["Charizard ex (199/165) [Scarlet & Violet: 151]", 1, "Pokemon Single", 0], ["Charizard ex (201/165) [Japanese SV2a: Pokemon Card 151]", 5, "Pokemon Japan Singles", 0], ["Charizard (4/102) [Base Set] Graded PSA 9", 1, "Pokemon Single Graded", 0], ["Sol Ring [Commander 2016]", 3, "MTG Single", 0], ["Surging Sparks Booster Box", 2, "Pokemon Sealed Product", 5]),
  ], PKM);
  assert.deepEqual(Object.keys(t).sort(), ["Charizard ex (006/165) [Scarlet & Violet: 151]", "Charizard ex (199/165) [Scarlet & Violet: 151]", "Pikachu (093) [Staff] [Mega Evolution Promo]"]);
  assert.deepEqual(t["Charizard ex (199/165) [Scarlet & Violet: 151]"], { units: 3, sets: { "Scarlet & Violet: 151": 3 }, inv: 0, name: "Charizard ex", full: "Charizard ex (199/165)", set: "Scarlet & Violet: 151" });
  assert.equal(t["Pikachu (093) [Staff] [Mega Evolution Promo]"].full, "Pikachu (093) [Staff]");
  // Magic's tally is unchanged by the Pokemon profile existing
  assert.deepEqual(Object.keys(tallySales([order(["Charizard ex (199/165) [Scarlet & Violet: 151]", 2, "Pokemon Single", 0], ["Sol Ring [Commander 2016]", 3, "MTG Single", 0])])), ["Sol Ring"]);
});

test("matchHit for Pokemon: a sold printing matches only itself; a miss takes the cheapest regular English printing", () => {
  const sir = { name: "Charizard ex", printing: { full: "Charizard ex (199/165)", set: "Scarlet & Violet: 151" } };
  const hits = [hit("Charizard ex (006/165)", "Scarlet & Violet: 151", 3), hit("Charizard ex (199/165)", "Scarlet & Violet: 151", 60), hit("Charizard ex (201/165)", "Japanese SV2a: Pokemon Card 151", 40)];
  assert.equal(matchHit(sir, hits, PKM).cardName, "Charizard ex (199/165)");
  assert.equal(matchHit(sir, [hits[0]], PKM), null);                                           // another printing is another card
  assert.equal(matchHit({ name: "Charizard ex", printing: { full: "Charizard ex (201/165)", set: "Japanese SV2a: Pokemon Card 151" } }, hits, PKM), null);   // never a Japanese printing
  const candy = [hit("Rare Candy (191/198)", "Scarlet & Violet", 0.3), hit("Rare Candy (142/149)", "Sun & Moon", 0.5), hit("Rare Candy (256/198)", "Scarlet & Violet", 9), hit("Rare Candy (SWSH100)", "SWSH Black Star Promos", 0.4), hit("Rare Candy (089/100)", "Japanese Scarlet ex", 0.3), hit("Rare Candy (050/100)", "Some Set", 0.1)];
  // base names match across numbers; the promo and Japanese printings lose; $0.10 is under the floor; of the rest the cheapest
  assert.equal(matchHit({ name: "Rare Candy", setSlug: "" }, candy, PKM).cardName, "Rare Candy (191/198)");
  assert.equal(matchHit({ name: "Rare Candy", setSlug: "" }, [candy[4]], PKM), null);
  // Magic still compares whole names: a numbered Pokemon-style name is not "Rare Candy"
  assert.equal(matchHit({ name: "Rare Candy", setSlug: "" }, candy), null);
});

test("internalCandidates for Pokemon: printings that sold twice or more, English misses, no basic energy or jumbo cards", async () => {
  const io = {
    overview: async () => ({ miss: { mtg: [{ name: "Sol Ring", c: 40 }], pokemon: [{ name: "Rare Candy", c: 12 }, { name: "Fire Energy", c: 9 }, { name: "Iono", c: 5 }] } }),
    orders: async () => ({ orders: { nodes: [
      order(["Charizard ex (199/165) [Scarlet & Violet: 151]", 3, "Pokemon Single", 0], ["Basic Fire Energy (010) (30th Celebration) [Mega Evolution Energies]", 8, "Pokemon Single", 0], ["Mega Hawlucha ex (116/217) (Jumbo Card) [Mega Evolution: Ascended Heroes]", 4, "Pokemon Single", 0]),
      order(["Iono (185/193) [Paldea Evolved]", 2, "Pokemon Single", 3], ["Pikachu (1/1) [Some Set]", 1, "Pokemon Single", 0], ["Sol Ring [Commander 2016]", 9, "MTG Single", 0]),
    ], pageInfo: { hasNextPage: false } } }),
  };
  const r = await internalCandidates({}, io, "pokemon");
  assert.deepEqual(r.candidates.map((c) => [c.name, c.printing ? c.printing.full : null]), [["Charizard ex", "Charizard ex (199/165)"], ["Rare Candy", null], ["Iono", "Iono (185/193)"], ["Iono", null]]);
  assert.equal(r.candidates[0].printing.set, "Scarlet & Violet: 151");
  assert.equal(r.notes.sellers, 2);
  // Magic's candidates are untouched by Pokemon data
  const m = await internalCandidates({}, io, "mtg");
  assert.deepEqual(m.candidates.map((c) => c.name), ["Sol Ring"]);
});

test("a Pokemon build never fetches MTGGoldfish, looks sold printings up in their set, and does not feature one card twice", async () => {
  let fetched = 0;
  const fetchFn = async () => { fetched++; return new Response(page, { status: 200 }); };
  const candidates = async () => ({ candidates: [
    { name: "Iono", key: "Iono (185/193) [Paldea Evolved]", printing: { full: "Iono (185/193)", set: "Paldea Evolved" }, source: "internal" },
    { name: "Iono", source: "internal" },
    { name: "Rare Candy", source: "internal" },
  ], notes: {} });
  const asked = [];
  const search = async (name, c) => { asked.push([name, c && c.printing ? c.printing.set : ""]); return name === "Iono" ? [hit("Iono (185/193)", "Paldea Evolved", 0.5), hit("Iono (254/193)", "Paldea Evolved", 20)] : [hit("Rare Candy (191/198)", "Scarlet & Violet", 0.3)]; };
  const v = await buildWanted({ game: "pokemon", fetchFn, search, candidates, n: 10, delayMs: 0 });
  assert.equal(fetched, 0);
  assert.equal(v.game, "pokemon"); assert.equal(v.source, "internal"); assert.deepEqual(v.pages, ["internal"]);
  assert.deepEqual(asked, [["Iono", "Paldea Evolved"], ["Iono", ""], ["Rare Candy", ""]]);
  // the Iono miss resolves to the same cheapest printing that sold: shown once
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.wanted.rank]), [["Iono (185/193)", 1], ["Rare Candy (191/198)", 2]]);
  await assert.rejects(startWanted({ game: "pokemon", fetchFn, search }), /no candidates/);
});
