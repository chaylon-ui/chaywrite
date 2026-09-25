import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGunplaTitle, indexKits, matchKit, gunplaMetafields, sigOf, kitInfo } from "../src/gunpla.js";

// Real titles from the store's Gunpla product type (2026-09-23).
const cases = [
  ["HGUC 1/144 #116 Sinanju", { code: "HGUC", line: "Universal Century", scale: "1/144", number: "116", series: "", name: "Sinanju" }],
  ["HGUC #45 1/144 MS-14JG Gelgoog Jager \"Gundam 0080\"", { code: "HGUC", number: "45", series: "Gundam 0080", name: "MS-14JG Gelgoog Jager" }],
  ["1/144 HGAW GUNDAM X", { code: "HGAW", line: "After War", scale: "1/144", name: "GUNDAM X" }],
  ["BB365 SINANJU", { code: "BB", grade: "BB Senshi", number: "365", name: "SINANJU" }],
  ["SD SANGOKU SOKETSUDEN [08] Lyu Bu SINANJU & RED HARE", { code: "SD SANGOKU", number: "8", name: "Lyu Bu SINANJU & RED HARE" }],
  ["EX-Standard 009 Destiny Gundam", { code: "SDEX", number: "9", name: "Destiny Gundam" }],
  ["Mega Size Model - 1/48 Scale Unicorn Gundam [Destroy Mode]", { code: "MEGA SIZE", scale: "1/48", name: "Unicorn Gundam [Destroy Mode]" }],
  ["HGUC 1/144 #240 Nightingale 'Char's Counterattack Beltorchika Children', Model Kit", { number: "240", series: "Char's Counterattack Beltorchika Children", name: "Nightingale" }],
  ["HG 1/144 R02 Duel Gundam Assault Shroud", { code: "HG", number: "R02", name: "Duel Gundam Assault Shroud" }],
  ["HG 00 1/144 #22 00 Gundam \"Gundam 00\"", { code: "HG00", line: "Gundam 00", number: "22", name: "00 Gundam" }],
  ["Orphans HG 1/144 Gundam Barbatos", { code: "HGIBO", line: "Iron-Blooded Orphans", name: "Gundam Barbatos" }],
  ["HG 1/144 GUNDVÃ–LVA", { name: "GUNDVOLVA" }],
  ["MG Destiny Gundam", { code: "MG", grade: "Master Grade", scale: "1/100", scaleStated: false }],
  ["PG UNLEASHED 1/60 RX-78-2 GUNDAM", { code: "PG UNLEASHED", grade: "Perfect Grade Unleashed", scale: "1/60" }],
  ["HGBD:R 1/144 EARTHREE GUNDAM", { code: "HGBD:R", line: "Build Divers Re:RISE" }],
  ["ENTRY GRADE 1/144 LAH GUNDAM", { code: "EG", grade: "Entry Grade" }],
  ["RE 1/100 MSN-04 II Nightingale", { code: "RE/100", scale: "1/100" }],
  ["HG Evangelion 01 (New Movie Ver.)", { code: "HG", scale: "", name: "Evangelion 01 (New Movie Ver.)" }],
];
test("parseGunplaTitle reads grade, line, scale, number, series and name from our real titles", () => {
  for (const [title, want] of cases) {
    const got = parseGunplaTitle(title);
    for (const k of Object.keys(want)) assert.equal(got[k], want[k], title + " -> " + k);
  }
  assert.equal(parseGunplaTitle("1/1 GUNPLA-KUN DX SET (WITH RUNNER Ver. RECREATION PARTS)"), null);
  assert.equal(parseGunplaTitle("GG Char's Customize MS Collection"), null);
});

test("matchKit: same grade family, scale and name; HGUC finds Bandai's HG page; model numbers optional; duplicates refused", () => {
  const idx = indexKits({ kits: {
    a: { name: "HG 1/144 GM SNIPER", launch: "2017-07" },
    b: { name: "MG 1/100 SINANJU STEIN (NARRATIVE Ver.)", launch: "2018-03-24" },
    c: { name: "MG 1/100 GOUF CUSTOM", launch: "2016-01" },
    d: { name: "RG 1/144 NU GUNDAM", launch: "2019" }, e: { name: "RG 1/144 Nu GUNDAM", launch: "2023" },
    f: { name: "HG 1/144 GM SNIPER II", launch: "2020-01" },
  } });
  const m = (t) => { const k = matchKit(parseGunplaTitle(t), idx); return k ? k.id : null; };
  assert.equal(m("HGUC 1/144 GM Sniper"), "a");
  assert.equal(m("HGUC 1/144 #146 GM Sniper II"), "f");                  // not "GM Sniper"
  assert.equal(m("MG 1/100 SINANJU STEIN (NARRATIVE Ver.)"), "b");
  assert.equal(m("MG 1/100 MS-07B3 GOUF CUSTOM"), "c");                    // model number dropped
  assert.equal(m("RG 1/144 Nu GUNDAM"), null);                              // two Bandai kits, same name
  assert.equal(m("RG 1/144 Sinanju"), null);                                // not on Bandai's list
  assert.equal(m("MG 1/100 GM Sniper"), null);                              // wrong grade family
});

test("gunplaMetafields: only real values, the Bandai facts on a match, a stable signature", () => {
  const idx = indexKits({ kits: { a: { name: "HG 1/144 GM SNIPER", launch: "2017-07-15", age: 8, price_yen: 1700, url: "https://x/01_1043/" } } });
  const r = gunplaMetafields("gid://p/1", "HGUC 1/144 GM Sniper", idx, "2026-09-24");
  const v = Object.fromEntries(r.metafields.map((m) => [m.key, m.value]));
  assert.equal(r.status, "ok");
  assert.deepEqual([v.gp_grade, v.gp_grade_code, v.gp_line, v.gp_scale, v.gp_release, v.gp_year, v.gp_age, v.gp_price_jpy, v.gp_bandai_url], ["High Grade", "HGUC", "Universal Century", "1/144", "2017-07-15", "2017", "8", "1700", "https://x/01_1043/"]);
  assert.ok(!("gp_number" in v) && !("gp_series" in v));                  // no empty facets
  assert.equal(v.gp_sig, r.sig);
  const again = gunplaMetafields("gid://p/1", "HGUC 1/144 GM Sniper", idx, "2026-09-25");
  assert.equal(again.sig, r.sig);                                           // the date does not change the signature
  const bare = gunplaMetafields("gid://p/1", "HGUC 1/144 GM Sniper", indexKits(null), "2026-09-25");
  assert.equal(bare.status, "title");
  assert.notEqual(bare.sig, r.sig);
  assert.equal(gunplaMetafields("gid://p/2", "GG Char's Customize MS Collection", idx, "2026-09-25"), null);
  assert.equal(sigOf([]), sigOf([]));
});

test("a Bandai name's model number must be in the title for a loose match (2026-09-23: RG Nu -> RX-93ff)", () => {
  const idx = indexKits({ kits: { ff: { name: "RG 1/144 RX-93ff ν GUNDAM", launch: "2022-04" }, g: { name: "HG 1/144 GUNDAM AERIAL", launch: "2022-10" } } });
  const m = (t) => { const k = matchKit(parseGunplaTitle(t), idx); return k ? k.id : null; };
  assert.equal(m("RG 1/144 Nu GUNDAM"), null);                              // not the Side-F kit
  assert.equal(m("RG 1/144 RX-93ff Nu Gundam"), "ff");                      // it names the variant
  assert.equal(m("HG 1/144 XVX-016 GUNDAM AERIAL"), "g");                   // our extra model number is still fine
});

test("gunplaMetafields lists the gp_ facts a product no longer has, so the sweep can delete them", () => {
  const r = gunplaMetafields("gid://p/1", "RG 1/144 Nu GUNDAM", indexKits(null), "2026-09-24");
  assert.equal(r.status, "title");
  for (const k of ["gp_release", "gp_year", "gp_age", "gp_price_jpy", "gp_bandai_url", "gp_bandai_name", "gp_number", "gp_series", "gp_line"]) assert.ok(r.clear.includes(k), k);
  assert.ok(!r.clear.includes("gp_scale") && !r.clear.includes("gp_grade"));
});

test("Pokemon Model Kits (owner, 2026-09-25): line in the key, number not; Bandai's é folded", () => {
  const idx = indexKits({ kits: {
    q8: { name: "Pokémon Model Kit QUICK!! 08 MIMIKYU", launch: "2021-12" },
    m: { name: "Pokémon Model Kit RESHIRAM" },
    b2: { name: "Pokémon Model Kit BIG 02 EEVEE" },
    e: { name: "Pokémon Model Kit EEVEE" },
  } });
  const m = (t) => { const k = matchKit(parseGunplaTitle(t), idx); return k ? k.id : null; };
  assert.equal(m("Pokemon Model Kit QUICK!! 08 MIMIKYU"), "q8");
  assert.equal(m("Pokemon Model Kit #13 Reshiram"), "m");
  assert.equal(m("POKEMON MODEL KIT EEVEE"), "e");                           // main line, not the Big one
  assert.equal(m("Pokemon Model Kit Quick! #04 Eevee"), null);               // a Quick!! Eevee Bandai's list lacks
  const p = parseGunplaTitle("Bandai 05 Scorbunny 'Pokemon', Bandai Spirits Hobby Pokemon Model Kit Quick!!");
  assert.deepEqual([p.grade, p.line, p.number, p.name], ["Pokémon Model Kit", "Quick!!", "5", "Scorbunny"]);
});

test("Bandai's PRODUCTS INFO becomes gp_info json, and is cleared when it goes away", () => {
  const info = { intro: "From GQuuuuuuX, RICK DOM joined as HG series!", features: ["Highly articulated.", " Transformable. "], includes: ["Weapons ×1 set"] };
  const idx = indexKits({ kits: { a: { name: "HG 1/144 GM SNIPER", info } } });
  const r = gunplaMetafields("gid://p/1", "HGUC 1/144 GM Sniper", idx, "2026-09-25");
  const mf = r.metafields.find((x) => x.key === "gp_info");
  assert.equal(mf.type, "json");
  assert.deepEqual(JSON.parse(mf.value), { intro: info.intro, features: ["Highly articulated.", "Transformable."], includes: ["Weapons ×1 set"] });
  const none = gunplaMetafields("gid://p/1", "HGUC 1/144 GM Sniper", indexKits({ kits: { a: { name: "HG 1/144 GM SNIPER" } } }), "2026-09-25");
  assert.ok(none.clear.includes("gp_info"));
  assert.notEqual(none.sig, r.sig);
  assert.equal(kitInfo({}), "");
});

test("a full-width 【Includes】 read as a feature splits into the box list (Challia's Rick Dom)", () => {
  const v = JSON.parse(kitInfo({ intro: "Challia Bull's Rick Dom!", features: ["Transformable.", "Includes a giant bazooka.", "【Includes】", "Weapons ×1 set", "Lead wire×1"] }));
  assert.deepEqual(v.features, ["Transformable.", "Includes a giant bazooka."]);
  assert.deepEqual(v.includes, ["Weapons ×1 set", "Lead wire×1"]);
});
