import { test } from "node:test";
import assert from "node:assert/strict";
import { franchiseOf, lineOf, figPlan, parseFigPage, quotedSeries, franchiseCollection, lineCollection, FIG_LABELS, LINE_LABELS, FRANCHISES, LINES } from "../src/figtype.js";

test("franchise: PLAMOD series first, folded onto one label", () => {
  assert.equal(franchiseOf({ series: "ONE PIECE", title: "x" }), "One Piece");
  assert.equal(franchiseOf({ series: "Dragon Ball Super", title: "x" }), "Dragon Ball");
  assert.equal(franchiseOf({ series: "Dragon Ball Z", title: "x" }), "Dragon Ball");
  assert.equal(franchiseOf({ series: "Demon Slayer: Kimetsu no Yaiba", title: "x" }), "Demon Slayer");
  assert.equal(franchiseOf({ series: "Frieren: Beyond Journey's End", title: "x" }), "Frieren");
  assert.equal(franchiseOf({ series: "Mobile Suit Gundam: The Witch from Mercury", title: "x" }), "Gundam");
  assert.equal(franchiseOf({ series: "Pokémon", title: "x" }), "Pokemon");
});

test("franchise: the quoted series at the end of a Bandai title, then the title itself", () => {
  assert.equal(quotedSeries('Bandai Spirits Ichibansho Figure Shanks (Film Red) "One Piece"'), "One Piece");
  assert.equal(quotedSeries('Bandai Spirits S.H.Figuarts Eternal Sailor Moon "Pretty Guardian Sailor Moon Sailor Stars",'), "Pretty Guardian Sailor Moon Sailor Stars");
  assert.equal(franchiseOf({ series: "", title: 'Bandai Ichibansho Figure Queen (The Fierce Men Who Gathered at the Dragon) "One Piece"' }), "One Piece");
  assert.equal(franchiseOf({ series: "", title: "Joy Toy Adepta Sororitas Battle Sister Sister Jurel" }), "Warhammer 40K");
  assert.equal(franchiseOf({ series: "", title: "Funko POP! Animation: Naruto Shippuden - Kakashi" }), "Naruto");
  assert.equal(franchiseOf({ series: "", title: "(RERELEASE) NENDOROID HATSUNE MIKU SYMPHONY 5TH ANNIVERSARY VER." }), "Hatsune Miku");
  assert.equal(franchiseOf({ series: "", title: '2.5" NINTENDO ARTICULATED FIGURE' }), "Nintendo");
  assert.equal(franchiseOf({ series: "", title: "Some Unknown Thing" }), "");
});

test("line: the brand fact, the title, the product type", () => {
  assert.equal(lineOf({ brand: "POP UP PARADE", title: "x", productType: "Figures" }), "Pop Up Parade");
  assert.equal(lineOf({ brand: "S.H. Figuarts", title: "x", productType: "Figures" }), "S.H.Figuarts");
  assert.equal(lineOf({ brand: "Nendoroid", title: "x", productType: "Figures" }), "Nendoroid");
  assert.equal(lineOf({ brand: "Ichibansho", title: "x", productType: "Figures" }), "Ichibansho");
  assert.equal(lineOf({ brand: "SEGA Prize Figures", title: "x", productType: "Figures" }), "SEGA Prize");
  assert.equal(lineOf({ brand: "FuRyu Other Figures", title: "x", productType: "Figures" }), "FuRyu");
  assert.equal(lineOf({ brand: "Other Figures", title: "Good Smile Company Noodle Stopper Figure Aesop", productType: "Figures" }), "FuRyu");
  assert.equal(lineOf({ brand: "Figure", title: "Bandai Spirits Figuartszero Naruto Uzumaki", productType: "Figures" }), "FiguartsZERO");
  assert.equal(lineOf({ brand: "", title: "Kotobukiya ARTFX J Tanjiro 1/8 Scale", productType: "Figures" }), "ARTFX", "the named line beats the scale");
  assert.equal(lineOf({ brand: "", title: "Some Studio Rem 1/7 Scale Figure", productType: "Figures" }), "Scale figures");
  assert.equal(lineOf({ brand: "", title: "Funko POP! Animation: One Piece - Luffy", productType: "Funko" }), "Funko Pop!");
  assert.equal(lineOf({ brand: "", title: "Bandai Shokugan Miniaturely Tablet Sailor Moon SET", productType: "Blind Box" }), "Shokugan");
  assert.equal(lineOf({ brand: "", title: "One Piece Trading Figure Mystery Box", productType: "Blind Box" }), "Blind box");
  assert.equal(lineOf({ brand: "", title: "Nothing known", productType: "Blind Box" }), "Blind box");
  assert.equal(lineOf({ brand: "", title: "Nothing known", productType: "Figures", maker: "KOTOBUKIYA" }), "ARTFX");
  assert.equal(lineOf({ brand: "", title: "Nothing known", productType: "Figures" }), "");
});

test("plan: only fig:/figline: tags are added or removed", () => {
  const it = { title: 'Bandai Spirits Ichibansho Figure Shanks (Film Red) "One Piece"', series: "ONE PIECE", brand: "Ichibansho", productType: "Figures", tags: ["fig:Naruto", "hot", "figline:Ichibansho"] };
  const p = figPlan(it);
  assert.deepEqual(p.want, ["fig:One Piece", "figline:Ichibansho"]);
  assert.deepEqual(p.add, ["fig:One Piece"]);
  assert.deepEqual(p.remove, ["fig:Naruto"]);
  assert.deepEqual(figPlan({ title: "Unknown", productType: "Figures", tags: ["fig:One Piece"] }).remove, ["fig:One Piece"]);
  assert.deepEqual(figPlan({ title: "Unknown", productType: "Figures", tags: [] }).want, []);
});

test("handles and labels: Liquid handleize, no duplicate labels", () => {
  assert.equal(franchiseCollection("JoJo's Bizarre Adventure"), "figures-jojos-bizarre-adventure", "Liquid drops the apostrophe");
  assert.equal(franchiseCollection("Pokemon"), "figures-pokemon");
  assert.equal(lineCollection("S.H.Figuarts"), "figure-line-s-h-figuarts");
  assert.equal(lineCollection("Funko Pop!"), "figure-line-funko-pop");
  assert.equal(new Set(FIG_LABELS).size, FRANCHISES.length);
  assert.equal(new Set(LINE_LABELS).size, LINES.length);
  assert.equal(new Set(FIG_LABELS.map(franchiseCollection)).size, FRANCHISES.length, "distinct handles");
});

test("page parse", () => {
  const d = { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ id: "gid://shopify/Product/1", title: "T", tags: ["a"], productType: "Figures", series: { value: "ONE PIECE" }, brand: null, maker: { value: "SEGA" } }] } };
  const p = parseFigPage(d);
  assert.equal(p.items[0].series, "ONE PIECE");
  assert.equal(p.items[0].brand, "");
  assert.equal(p.items[0].maker, "SEGA");
  assert.equal(p.cursor, "c1");
  assert.equal(p.hasNext, true);
});
