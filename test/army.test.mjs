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
  assert.equal(armyOf("ORKS BOX", "Some Other Vendor", "Board Games", ""), "");   // not GW and not a wargame
});
test("no army in the title -> the datasheet's", () => {
  assert.equal(armyOf("WARHAMMER 40,000 CANOPTEK SPYDERS", GW, TT, "Necrons"), "Necrons");
  assert.equal(armyOf("WARHAMMER 40,000 SOMETHING", GW, TT, ""), "");
});

test("shorthands, units named without their army, Kill Team boxes, codex hardbacks", () => {
  for (const [t, want] of [
    ["WARHAMMER: AGE OF SIGMAR S/B GRAVELORDS: WIGHT KING ON STEED", "Soulblight Gravelords"],
    ["WARHAMMER: AGE OF SIGMAR SOULBIGHT GRAVELORDS BATTLEFORCE - VENGORIAN COURT", "Soulblight Gravelords"],
    ["WARHAMMER: AGE OF SIGMAR S/ETERNALS: CRYPTBORN'S STORMWING", "Stormcast Eternals"],
    ["WARHAMMER: AGE OF SIGMAR SYLV: BELTHANOS FIRST THORN OF KURNO", "Sylvaneth"],
    ["WARHAMMER: AGE OF SIGMAR GLOOM./GITZ: BRAGGIT'S BOTTLE-SNATCHA", "Gloomspite Gitz"],
    ["WARHAMMER: AGE OF SIGMAR DISCIPLES/TZEENTCH: FLAMERS OF TZEENT", "Disciples of Tzeentch"],
    ["WARHAMMER: AGE OF SIGMAR LEADBELCHERS", "Ogor Mawtribes"],
    ["WARHAMMER: AGE OF SIGMAR ROCKGUT TROGGOTHS", "Gloomspite Gitz"],
    ["WARHAMMER: AGE OF SIGMAR NAMARTI THRALLS", "Idoneth Deepkin"],
    ["WARHAMMER: AGE OF SIGMAR DARKOATH SAVAGERS", "Slaves to Darkness"],
    ["WARHAMMER 40,000 KILL TEAM: KOMMANDOS", "Orks"],
    ["WARHAMMER 40,000 KILL TEAM: HEARTHKYN SALVAGERS", "Leagues of Votann"],
    ["WARHAMMER 40,000 KILL TEAM: LEGIONARIES", "Chaos Space Marines"],
    ["CODEX: THOUSAND SONS (HB) (ENGLISH)", "Thousand Sons"],
    ["WARHAMMER: THE HORUS HERESY LEGIONES ASTARTES: MKIII TACTICAL SQUAD", "Legiones Astartes"],
    ["WARHAMMER: THE OLD WORLD TOMB KINGS OF KHEMRI: NECROSPHINX", "Tomb Kings of Khemri"],
  ]) assert.equal(armyOf(t, GW, TT, ""), want, t);
  assert.equal(armyOf("WARHAMMER 40,000 ASTRA MILITARUM BANEBLADE", "Exor Games", TT, ""), "Astra Militarum");
  assert.equal(armyOf("WARHAMMER 40,000 ULTRAMARINES CHIEF LIBRARIAN TIGURIUS", GW, TT, "Ultramarines"), "Space Marines");
  assert.equal(armyOf("WARHAMMER 40,000 CANOPTEK THING", GW, TT, "Ultramarines"), "Space Marines");
  for (const t of ["WARHAMMER 40K KEYCHAIN BLOOD ANGELS", "WARHAMMER 40K MUG ULTRAMARINES 320ML X2", "WARHAMMER 40,000 BL: WHITE CONSULS: CAPTAIN MESSINIUS", "BLACK LIBRARY DARK ANGELS HARDBACK"]) assert.equal(armyOf(t, GW, TT, ""), "", t);
  assert.equal(armyOf("BATTLETECH COUNTERS PACK BATTLEFORCE", "Catalyst", TT, ""), "");
});
