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

test("recipe shorthand, old Citadel names and step words", () => {
  const P = { swatches: [
    { b: "Citadel", n: "Doombull Brown", h: "#5D0009", items: [{ r: "Layer", u: "db", t: "LAYER: DOOMBULL BROWN", p: "4.59", a: true, v: 5 }] },
    { b: "Citadel", n: "Ushabti Bone", h: "#BBBB7F", items: [{ r: "Layer", u: "ub", t: "LAYER: USHABTI BONE", p: "4.59", a: true, v: 6 }] },
    { b: "Citadel", n: "Reikland Fleshshade", h: "#CA6C4D", items: [{ r: "Shade", u: "rf", t: "SHADE: REIKLAND FLESHSHADE", p: "7.25", a: true, v: 7 }] },
    { b: "Citadel", n: "Reikland Fleshshade Gloss", h: "#CA6C4D", items: [{ r: "Shade", u: "rfg", t: "SHADE: REIKLAND FLESHSHADE GLOSS", p: "7.25", a: false, v: 8 }] },
    { b: "Citadel", n: "Evil Sunz Scarlet", h: "#C01411", items: [{ r: "Layer", u: "ess", t: "x", p: "4.59", a: true, v: 2 }] },
  ] };
  const idx = citadelIndex(P);
  assert.deepEqual([resolvePaint(idx, "Doombull").name, resolvePaint(idx, "Doombull").handle], ["Doombull Brown", "db"]);
  const bb = resolvePaint(idx, "Bleached Bone");
  assert.deepEqual([bb.name, bb.was, bb.handle], ["Ushabti Bone", "Bleached Bone", "ub"]);
  assert.equal(resolvePaint(idx, "Reikland").handle, "rf");                       // the gloss is the same colour
  assert.equal(resolvePaint(idx, "Evil").handle, undefined);                      // too short to guess
  const D = { pages: { u: { url: "https://e/40k/orks/", title: "Orks", game: "40k", faction: "orks", sub: "",
    schemes: [{ slug: "g", name: "Orks (General)", areas: [
      { slug: "a", name: "Skin", paints: ["Basecoat Mix", "Evil Sunz Scarlet", "Previous mix", "Water", "Add White to previous mix", "Evil Sunz Scarlet"] },
      { slug: "b", name: "Mix only", paints: ["Highlight Mix"] }] }] } } };
  const r = forProduct(indexEavy(D), idx, "WARHAMMER 40,000 ORKS: BOYZ", "Orks");
  assert.deepEqual(r.schemes[0].areas.map((a) => [a.name, a.paints.map((p) => p.name)]), [["Skin", ["Evil Sunz Scarlet", "White"]]]);   // "Add White to previous mix" uses White
});

test("ratio tails trimmed, unresolved shorthand folded into the full name", () => {
  const P = { swatches: [{ b: "Citadel", n: "Corax White", h: "#FFFFFF", items: [{ r: "Base", u: "cw", t: "BASE: CORAX WHITE", p: "5", a: true, v: 9 }] }] };
  const D = { pages: { u: { url: "https://e/40k/astra-militarum/", title: "Astra Militarum", game: "40k", faction: "astra-militarum", sub: "",
    schemes: [{ slug: "dr", name: "Death Korps of Krieg: Death Riders", areas: [
      { slug: "s", name: "Krieg Steed Skin", paints: ["Sons of Horus", "Corax White :", "Base Mix", "Sons of Horus Green", "Corax White"] }] }] } } };
  const r = forProduct(indexEavy(D), citadelIndex(P), "DEATH RIDERS", "Astra Militarum");
  assert.deepEqual(r.schemes[0].areas[0].paints.map((p) => [p.name, p.handle || null]), [["Corax White", "cw"], ["Sons of Horus Green", null]]);
});

test("step notes yield the paint inside them or nothing", async () => {
  const { expand, resolveLoose } = await import("../src/eavy.js");
  assert.deepEqual(expand("Add White to previous mix"), ["White"]);
  assert.deepEqual(expand("Add Screaming Skull progressively to Basecoat"), ["Screaming Skull"]);
  assert.deepEqual(expand("Screaming Skull : White"), ["Screaming Skull", "White"]);
  assert.deepEqual(expand("Rhinox Hide1:1"), ["Rhinox Hide"]);
  assert.deepEqual(expand("Mephiston Red*"), ["Mephiston Red"]);
  assert.deepEqual(expand("Bestial Brown (Mournfang Brown"), ["Bestial Brown"]);
  const idx = citadelIndex({ swatches: [{ b: "Citadel", n: "Nuln Oil", h: "#14100E", items: [{ r: "Shade", u: "no", t: "SHADE: NULN OIL", p: "7", a: true, v: 1 }] }] });
  assert.equal(resolveLoose(idx, "Nuln Oil in the recesses").handle, "no");
  assert.equal(resolveLoose(idx, "Blue horror corner dot highlight"), null);
  assert.deepEqual(resolveLoose(idx, "Sons of Horus Green"), { name: "Sons of Horus Green" });
});
