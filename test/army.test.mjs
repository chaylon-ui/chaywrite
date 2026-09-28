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

test("The Old World and The Horus Heresy use their own armies; AoS units named alone", () => {
  for (const [t, want] of [
    ["WARHAMMER: THE OLD WORLD EMPIRE OF MAN EMPIRE KNIGHTS", "Empire of Man"],
    ["WARHAMMER: THE OLD WORLD GRAND MASTER OF THE KNIGHTS PANTHER", "Empire of Man"],
    ["WARHAMMER: THE OLD WORLD ORC & GOBLIN TRIBES: ORC BOYZ MOB", "Orc & Goblin Tribes"],
    ["WARHAMMER: THE OLD WORLD BLACK ORC BIGBOSS", "Orc & Goblin Tribes"],
    ["WARHAMMER: THE OLD WORLD: DWARFEN MOUNTAIN HOLDS: DWARF HAMMERERS", "Dwarfen Mountain Holds"],
    ["WARHAMMER: THE OLD WORLD HIGH ELVES REALMS PHOENIX GUARD", "High Elf Realms"],
    ["WARHAMMER: THE OLD WORLD HANDMAIDEN OF THE EVERQUEEN", "High Elf Realms"],
    ["WARHAMMER: THE OLD WORLD WOOD ELF REALMS GLADE GUARD", "Wood Elf Realms"],
    ["WARHAMMER: THE OLD WORLD WARRIORS OF CHAOS CHAOS MARAUDERS", "Warriors of Chaos"],
    ["WARHAMMER: THE OLD WORLD SORCERER OF CHAOS ON CHAOS STEED", "Warriors of Chaos"],
    ["WARHAMMER: THE OLD WORLD BEASTMEN BRAYHERDS GOR HERD", "Beastmen Brayherds"],
    ["WARHAMMER THE OLD WORLD GRAND CATHAY JADE LANCERS", "Grand Cathay"],
    ["WARHAMMER: THE OLD WORLD KOB: KNIGHTS OF THE REALM ON FOOT", "Kingdom of Bretonnia"],
    ["WARHAMMER: THE OLD WORLD USHABTI WITH RITUAL BLADES", "Tomb Kings of Khemri"],
    ["WARHAMMER: THE OLD WORLD TERRAIN FORTIFIED MANOR OF THE EMPIRE", ""],
    ["WARHAMMER: THE OLD WORLD RULEBOOK", ""],
    ["WARHAMMER: THE HORUS HERESY SOLAR AUXILIA LEMAN RUSS STRIKE TANK", "Solar Auxilia"],
    ["WARHAMMER: THE HORUS HERESY MECHANICUM URSARAX COHORT", "Mechanicum"],
    ["WARHAMMER: THE HORUS HERESY LEGION ASTARTES FALCHION SUPER-HEAVY TANK DESTROYER", "Legiones Astartes"],
    ["WARHAMMER: HORUS HERESY: SCORPIUS MISSILE TANK", "Legiones Astartes"],
    ["WARHAMMER: THE HORUS HERESY MKVI ASSAULT MARINES", "Legiones Astartes"],
    ["WARHAMMER THE HORUS HERESY LEGIONS IMPERIALIS: SOLAR AUXILIA BATTLE GROUP", ""],
    ["WARHAMMER: THE HORUS HERESY CERASTUS KNIGHT ACHERON", ""],
    ["WARHAMMER: AGE OF SIGMAR F-E COURTS: USHORAN MORTARCH OF DELUSION", "Flesh-eater Courts"],
    ["WARHAMMER: AGE OF SIGMAR FACTION PACK: FLESH-EATERS COURTS", "Flesh-eater Courts"],
    ["WARHAMMER: AGE OF SIGMAR GLOOSMPITE GITZ: SNARLPACK CAVALRY", "Gloomspite Gitz"],
    ["WARHAMMER: AGE OF SIGMAR SLAVE TO DARKNESS: ETERNUS BLADE OF THE FIRST PRINCE", "Slaves to Darkness"],
    ["WARHAMMER: AGE OF SIGMAR HELL PIT ABOMINATION", "Skaven"],
    ["WARHAMMER: AGE OF SIGMAR SKAVENTIDE", ""],
    ["WARHAMMER: AGE OF SIGMAR GRIMGHAST REAPERS", "Nighthaunt"],
    ["WARHAMMER: AGE OF SIGMAR GORE-GRUNTAS", "Orruk Warclans"],
    ["WARHAMMER: AGE OF SIGMAR DRACOTHIAN GUARD FULMINATORS", "Stormcast Eternals"],
    ["WARHAMMER: AGE OF SIGMAR EXALTED DEATHBRINGER WITH RUINOUS AXE", "Blades of Khorne"],
    ["WARHAMMER: AGE OF SIGMAR SLAUGHTER QUEEN ON CAULDRON OF BLOOD", "Daughters of Khaine"],
    ["WARHAMMER 40000 KILL TEAM RAVENERS", "Tyranids"],
    ["WARHAMMER 40,000 KILL TEAM DEATH KORPS KREIG REGIMENT VETERAN INFANTRY", "Astra Militarum"],
  ]) assert.equal(armyOf(t, GW, TT, ""), want, t);
});

test("40K typos, curly apostrophes and Kill Team units", () => {
  for (const [t, want] of [
    ["WARHAMMER 40,000 ASTRA MILITARIUM COMBAT PATROL", "Astra Militarum"],
    ["WARHAMMER 40,000 SAPCE MARINES INFERNUS MARINES+ PAINTS", "Space Marines"],
    ["WARHAMMER 40,000 SPACES WOLVES ARMY SET", "Space Wolves"],
    ["WARHAMMER 40,000 KILL TEAM T’AU EMPIRE RECON SPECIALISTS PATHFINDERS", "T'au Empire"],
    ["WARHAMMER 40,000 T’AU EMPIRE RETALIATION CADRE BATTLEFORCE", "T'au Empire"],
    ["WARHAMMER 40,000 KILL TEAM FARSTALKER KINBAND KROOT MERCENARY CREW", "T'au Empire"],
    ["WARHAMMER 40,000 KILL TEAM: XV26 STEALTH BATTLESUITS", "T'au Empire"],
    ["WARHAMMER 40,000 KILL TEAM BLADES OF KHAINE ALEDARI STRIKING SCORPION ASPECT WARRIORS", "Aeldari"],
    ["WARHAMMER 40,000 COMBAT PATROL IRON WARRIORS", "Chaos Space Marines"],
    ["WARHAMMER 40,000 COMBAT PATROL DEATH KORPS OF KRIEG", "Astra Militarum"],
    ["WARHAMMER 40,000 LORD OF CONTAGION AND BLIGHTLORD TERMINATORS", "Death Guard"],
    ["WARHAMMER 40,000 ARKS OF OMEN: ANGRON", "World Eaters"],
    ["WARHAMMER 40,000 KILL TEAM: MANDRAKES", "Drukhari"],
    ["WARHAMMER 40,000 KILL TEAM: HERNKYN YAEGIRS", "Leagues of Votann"],
    ["WARHAMMER 40,000 KILL TEAM: WOLF SCOUTS", "Space Wolves"],
    ["WARHAMMER 40,000 KRIEG PB (ENGLISH)", ""],
    ["WARHAMMER 40,000 STARTER SET", ""],
  ]) assert.equal(armyOf(t, GW, TT, ""), want, t);
});
