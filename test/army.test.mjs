import { test } from "node:test";
import assert from "node:assert/strict";
import { armyOf } from "../src/army.js";
const GW = "Games Workshop", TT = "Tabletop Wargames";
test("titles name their army, shorthands included", () => {
  for (const [t, want] of [
    ["WARHAMMER 40,000 ADEPTA SORORITAS PENITENT CRUSADER HOST BATTLEFORCE", "Adepta Sororitas"],
    ["WARHAMMER 40,000 ADEPTA SORIRITAS: MINISTORUM PRIEST WITH VINDICTOR", "Adepta Sororitas"],
    ["WARHAMMER 40,000 ADEPT/MECHANICUS: SKORPIUS DISINTEGR", "Adeptus Mechanicus"],
    ["WARHAMMER 40,000 ADEPTUS CUSTODES DICE", "Adeptus Custodes"],
    ["CHAOS SPACE MARINES: RHINO", "Chaos Space Marines"],
    ["WARHAMMER 40,000 SPACE MARINES: INTERCESSORS", "Space Marines"],
    ["IMP. FISTS PRIMARIS UPGRADES & TRANSFE", "Space Marines"],
    ["GREY KNIGHTS GRAND MASTER VOLDUS", "Grey Knights"],
    ["GENESTEALER CULTS: NEXOS", "Genestealer Cults"],
    ["WARHAMMER 40,000 ORKS TRUKK", "Orks"],
    ["WARHAMMER: AGE OF SIGMAR C/O/S: FREEGUILD CAVALIER MARSHAL", "Cities of Sigmar"],
    ["WARHAMMER: AGE OF SIGMAR ORRUK WARCLANS: TUSKBOSS ON MAW-GR", "Orruk Warclans"],
    ["CHAOS BATTLETOME: MAGGOTKIN OF NURGLE - GAMER'S EDITION", "Maggotkin of Nurgle"],
    ["Endless Spells: Nighthaunt", "Nighthaunt"],
    ["WARHAMMER: AGE OF SIGMAR SERAPHON ARMY SET (ENGLISH)", "Seraphon"],
  ]) assert.equal(armyOf(t, GW, TT, ""), want, t);
});
test("paints, supplies, novels, Blood Bowl and non-GW products get none", () => {
  for (const [t, ty] of [["CONTRAST: BLOOD ANGELS RED (18ML)", "Paint"], ["BASE: DEATH GUARD GREEN", "Paint"], ["CITADEL DEATH GUARD GREEN SPRAY", TT],
    ["CONTRAST: ORK FLESH (18ML)", "Paint"], ["BLACK LIBRARY WARHAMMER 40,000 DA RED GOBBO COLLECTION", TT], ["HORUS HERESY: FULGRIM (PB)", TT],
    ["BLOOD BOWL: SKAVEN TEAM", TT], ["CITADEL 25MM ROUND BASES (100 PACK)", TT], ["WARHAMMER 40,000 SPACE MARINES PAINT SET", TT]])
    assert.equal(armyOf(t, GW, ty, ""), "", t);
  assert.equal(armyOf("ORKS BOX", "Some Other Vendor", TT, ""), "");
});
test("no army in the title -> the datasheet's", () => {
  assert.equal(armyOf("WARHAMMER 40,000 CANOPTEK SPYDERS", GW, TT, "Necrons"), "Necrons");
  assert.equal(armyOf("WARHAMMER 40,000 SOMETHING", GW, TT, ""), "");
});
