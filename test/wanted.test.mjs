import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRow, parseRows, parseMovers, pickWanted, matchHit, buildWanted, startWanted, stepWanted, resultOf, MOVERS_URL, MORE_URLS } from "../src/wanted.js";

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
test("matchHit wants the exact name from the movers' set, else the exact name the store pays most for", () => {
  const entry = { name: "Ghalta, Stampede Tyrant", setSlug: "lost-caverns-of-ixalan" };
  const hits = [hit("Ghalta, Stampede Tyrant // Foo", "Weird", 99), hit("Ghalta, Stampede Tyrant", "The Lost Caverns of Ixalan", 10), hit("Ghalta, Stampede Tyrant", "Commander: The Lost Caverns of Ixalan", 12), hit("Ghalta, Stampede Tyrant", "Secret Lair Drop", 30)];
  assert.equal(matchHit(entry, hits).setName, "Commander: The Lost Caverns of Ixalan");   // both carry the slug's words; the better offer wins
  assert.equal(matchHit({ name: "Ghalta, Stampede Tyrant", setSlug: "nowhere-set" }, hits).setName, "Secret Lair Drop");
  assert.equal(matchHit({ name: "Ghalta, Stampede Tyrant", setSlug: "" }, hits).setName, "Secret Lair Drop");
  assert.equal(matchHit({ name: "Not There", setSlug: "" }, hits), null);
  assert.equal(matchHit({ name: "GHALTA, stampede tyrant" }, [hit("Ghalta, Stampede Tyrant", "X", 1)]).setName, "X");   // case and punctuation do not matter
  // a printing with no offer the store will take is not a match (the page would say "Not currently buying this printing")
  const dead = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [{ variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: 0, creditBuyPrice: 0 }] }] };
  const capped = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [{ variantName: "Near Mint", cardBuylistTypes: [{ type: "Normal", buyPrice: 4, creditBuyPrice: 5, maxPurchaseQuantity: 0 }] }] };
  const none = { cardName: "Lyra, Tolarian Archangel", setName: "Reality Fracture", variants: [] };
  assert.equal(matchHit({ name: "Lyra, Tolarian Archangel" }, [dead, capped, none]), null);
  assert.equal(matchHit({ name: "Lyra, Tolarian Archangel" }, [dead, hit("Lyra, Tolarian Archangel", "Other", 2)]).setName, "Other");
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
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.setName, h.wanted.rank, h.wanted.pct]), [["Samut, Tyrant of Naktamun", "Reality Fracture", 1, 178], ["Gideon's Memorial", "Reality Fracture", 2, 19], ["Starting Town", "Reality Fracture", 3, 7]]);   // its slug (final-fantasy) matches neither hit, so the better offer wins
  assert.deepEqual(v.missed, ["Omnipresence"]);
  assert.deepEqual(asked, ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial", "Starting Town"]);
  assert.deepEqual(v.pages, [MOVERS_URL, MORE_URLS.weekly, MORE_URLS.daily]);   // both View More pages were tried and were empty
  assert.equal(v.picked.length, 4);
  assert.deepEqual(v.probe.map((p) => [p.name, p.got, p.matched]), [["Samut, Tyrant of Naktamun", 2, "Reality Fracture"], ["Omnipresence", 0, null], ["Gideon's Memorial", 2, "Reality Fracture"], ["Starting Town", 2, "Reality Fracture"]]);
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
