import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { indexEavy, pickPage, forProduct, citadelIndex, resolvePaint, key } from "../src/eavy.js";

const DATA = { pages: {
  "https://eavy-archive.com/40k/adeptus-mechanicus/": { url: "https://eavy-archive.com/40k/adeptus-mechanicus/", title: "Adeptus Mechanicus", game: "40k", faction: "adeptus-mechanicus", sub: "",
    schemes: [{ slug: "mars-forge-world", name: "Mars Forge World", areas: [{ slug: "red-cloak", name: "Red Cloak", paints: ["Mephiston Red", "Evil Sunz Scarlet", "Black", "Liquitex Burnt Umber"] }] }] },
  "https://eavy-archive.com/40k/orks/": { url: "https://eavy-archive.com/40k/orks/", title: "Orks", game: "40k", faction: "orks", sub: "",
    schemes: [{ slug: "goffs", name: "Goffs", areas: [{ slug: "skin", name: "Skin", paints: ["Waaagh! Flesh"] }] },
      { slug: "ghazghkull-thraka", name: "Ghazghkull Thraka", areas: [{ slug: "armour", name: "Armour", paints: ["Leadbelcher"] }] }] },
  "https://eavy-archive.com/40k/space-marines/": { url: "https://eavy-archive.com/40k/space-marines/", title: "Space Marines", game: "40k", faction: "space-marines", sub: "",
    schemes: [{ slug: "ultramarines", name: "Ultramarines", areas: [{ slug: "armour", name: "Armour", paints: ["Macragge Blue"] }] },
      { slug: "blood-angels", name: "Blood Angels", areas: [{ slug: "armour", name: "Armour", paints: ["Mephiston Red"] }] }] },
  "https://eavy-archive.com/age-of-sigmar/stormcast-eternals/": { url: "https://eavy-archive.com/age-of-sigmar/stormcast-eternals/", title: "Stormcast Eternals", game: "age-of-sigmar", faction: "stormcast-eternals", sub: "",
    schemes: [{ slug: "hammers", name: "Hammers of Sigmar", areas: [{ slug: "armour", name: "Armour", paints: ["Retributor Armour"] }] }] },
} };
const PAINTS = { swatches: [
  { b: "Citadel", n: "Mephiston Red", h: "#960C09", items: [{ r: "Spray", u: "spray-mr", t: "SPRAY: MEPHISTON RED", p: "30.00", a: true, v: 9 }, { r: "Base", u: "base-mr", t: "BASE: MEPHISTON RED", p: "5.25", a: true, v: 1 }] },
  { b: "Citadel", n: "Evil Sunz Scarlet", h: "#C01411", items: [{ r: "Layer", u: "layer-ess", t: "LAYER: EVIL SUNZ SCARLET", p: "5.25", a: false, v: 2 }] },
  { b: "Citadel", n: "Abaddon Black", h: "#231F20", items: [{ r: "Base", u: "base-ab", t: "BASE: ABADDON BLACK", p: "5.25", a: true, v: 3 }] },
  { b: "Vallejo", n: "Leadbelcher", h: "#888888", items: [{ r: "Game Color", u: "v-x", t: "x", p: "1", a: true, v: 4 }] },
] };

test("the title naming a character picks that scheme first, on its army page", () => {
  const r = forProduct(indexEavy(DATA), citadelIndex(PAINTS), "WARHAMMER 40,000 ORKS: GHAZGHKULL THRAKA", "Orks");
  assert.equal(r.page.title, "Orks");
  assert.deepEqual(r.schemes.map((s) => s.name), ["Ghazghkull Thraka", "Goffs"]);
  assert.equal(r.schemes[0].url, "https://eavy-archive.com/40k/orks/?modal=ghazghkull-thraka");
  assert.equal(r.schemes[0].areas[0].url, "https://eavy-archive.com/40k/orks/?modal=ghazghkull-thraka&block=armour");
});

test("unit facts' faction picks the army; a chapter faction picks its scheme on the Space Marines page", () => {
  const ix = indexEavy(DATA);
  assert.equal(pickPage(ix, "ADEPTUS MECHANICUS: SKITARII RANGERS", "Adeptus Mechanicus").page.faction, "adeptus-mechanicus");
  const bl = pickPage(ix, "BLOOD ANGELS: DEATH COMPANY", "Blood Angels");
  assert.equal(bl.page.faction, "space-marines");
  assert.equal(bl.page.schemes[bl.first].name, "Blood Angels");
  assert.equal(pickPage(ix, "SPACE MARINES: INTERCESSORS", "Space Marines").first, 0);
});

test("no faction: an army name in the title; nothing matching -> null", () => {
  const ix = indexEavy(DATA);
  assert.equal(pickPage(ix, "STORMCAST ETERNALS: VINDICTORS", "").page.faction, "stormcast-eternals");
  assert.equal(pickPage(ix, "CITADEL COLOUR: PAINT SET", ""), null);
  assert.equal(pickPage(ix, "RED DICE", ""), null);
});

test("paints link to the pot a recipe means: in stock, Base before Spray; Black -> Abaddon Black; others plain", () => {
  const idx = citadelIndex(PAINTS);
  assert.equal(resolvePaint(idx, "Mephiston Red").handle, "base-mr");
  assert.equal(resolvePaint(idx, "Evil Sunz Scarlet").a, false);
  const b = resolvePaint(idx, "Black");
  assert.deepEqual([b.name, b.handle], ["Abaddon Black", "base-ab"]);
  assert.deepEqual(resolvePaint(idx, "Liquitex Burnt Umber"), { name: "Liquitex Burnt Umber" });
  assert.deepEqual(resolvePaint(idx, "Leadbelcher"), { name: "Leadbelcher" });   // only a Vallejo swatch by that name
  assert.equal(key("Gehenna's Gold"), key("Gehenna Gold"));
});

// the real file, when a copy is at hand (EAVY_DATA=path)
if (process.env.EAVY_DATA && existsSync(process.env.EAVY_DATA)) {
  test("real data: army pages parse and common titles resolve", () => {
    const ix = indexEavy(JSON.parse(readFileSync(process.env.EAVY_DATA, "utf8")));
    assert.ok(ix.armies.length > 20, "armies " + ix.armies.length);
    assert.equal(pickPage(ix, "WARHAMMER 40,000 ADEPTUS MECHANICUS: SKITARII RANGERS", "Adeptus Mechanicus").page.faction, "adeptus-mechanicus");
  });
}
