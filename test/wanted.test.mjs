import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRow, parseMovers, pickWanted, matchHit, buildWanted } from "../src/wanted.js";

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
});

test("buildWanted: movers page -> picked names -> BinderPOS hits in rank order, with the mover's numbers attached; misses listed", async () => {
  const asked = [];
  const search = async (name) => { asked.push(name); return name === "Omnipresence" ? [] : [hit(name, "Reality Fracture", 5), hit(name, "Other", 2)]; };
  const v = await buildWanted({ fetchFn: async () => new Response(page, { status: 200 }), search, n: 10 });
  assert.equal(v.count, 3);
  assert.deepEqual(v.hits.map((h) => [h.cardName, h.setName, h.wanted.rank, h.wanted.pct]), [["Samut, Tyrant of Naktamun", "Reality Fracture", 1, 178], ["Gideon's Memorial", "Reality Fracture", 2, 19], ["Starting Town", "Reality Fracture", 3, 7]]);   // its slug (final-fantasy) matches neither hit, so the better offer wins
  assert.deepEqual(v.missed, ["Omnipresence"]);
  assert.deepEqual(asked, ["Samut, Tyrant of Naktamun", "Omnipresence", "Gideon's Memorial", "Starting Town"]);
  assert.equal(v.picked.length, 4);
  await assert.rejects(buildWanted({ fetchFn: async () => new Response("nope", { status: 403 }), search }), /HTTP 403/);
  await assert.rejects(buildWanted({ fetchFn: async () => new Response("<html></html>", { status: 200 }), search }), /no movers rows/);
});
