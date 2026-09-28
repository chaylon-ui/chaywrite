/* Army filter (owner, 2026-09-28: "Is there a way for us to filter warhammer by army type?").

   exor.army (single line) on every Games Workshop product that belongs to one army - units,
   battleforces, army sets, codexes/battletomes, dice, datacards, upgrade sprues - so the
   Cloud Search sidebar can offer an "Army" filter across 40K and Age of Sigmar. The army
   comes from the title (the store's own shorthands included: "ADEPT/MECHANICUS",
   "C/O/S", "IMP. FISTS", "SORIRITAS"); when the title names none, the 40K datasheet's
   army (exor.wh_unit faction, via exor.wh_army) is used. Paints, brushes, bases, tools and
   Black Library novels get none - "BLOOD ANGELS RED" is a paint, not an army.
   Written by the enrich "gamesys" phase next to exor.game_system; exor.wh_army (the
   datasheet facet) is left as it is. */

// [label, title pattern] - more specific first (Chaos Space Marines before Space Marines)
export const ARMIES = [
  // Warhammer 40,000
  ["Chaos Space Marines", /\bchaos space marines?\b|\biron warriors\b|\bnight lords\b|\bnemesis claw\b|\bred corsairs\b|\bvashtorr\b|\bheretic astartes\b|\bcsm\b|\bkill team: legionaries\b|\bfellgor\b/],
  ["Chaos Knights", /\bchaos knights?\b/],
  ["Chaos Daemons", /\bchaos daemons?\b/],
  ["Death Guard", /\bdeath guard\b|\blord of contagion\b|\bblightlord\b/],
  ["Thousand Sons", /\bthousand sons\b/],
  ["World Eaters", /\bworld eaters\b|\bangron\b/],
  ["Emperor's Children", /\bemperor'?s children\b/],
  ["Black Templars", /\bblack templars?\b/],
  ["Blood Angels", /\bblood angels?\b/],
  ["Dark Angels", /\bdark angels?\b/],
  ["Space Wolves", /\bspace wolf|\bspaces? wolves\b|\bwolf scouts\b/],
  ["Deathwatch", /\bdeathwatch\b/],
  ["Grey Knights", /\bgrey knights?\b/],
  ["Legiones Astartes", /\blegiones astartes\b/],                 // The Horus Heresy, when the title leaves the game out
  ["Space Marines", /\bspace marines?\b|\bsapce marines?\b|\binfernus marines\b|\bsons of dorn\b|\badeptus astartes\b|\bs\/m\b|\bimp\.? fists\b|\bimperial fists\b|\biron hands\b|\bultramarines?\b|\bsalamanders\b|\braven guard\b|\bwhite scars\b|\bwhite consuls\b|\bprimaris\b/],
  ["Adepta Sororitas", /\badepta sor[io]r[io]tas\b|\bcelestian insidiants\b|\bsanctifiers\b|\bsisters of battle\b|\bnovitiates\b/],
  ["Adeptus Custodes", /\badeptus custodes\b|\bcustodes\b/],
  ["Adeptus Mechanicus", /\bmechanicus\b|\bbattleclade\b/],
  ["Astra Militarum", /\bastra militari?um\b|\bkrieg\b|\bratlings\b|\bimperial guard\b|\bveteran guardsmen\b|\bkasrkin\b|\bdeath korps\b|\btempestus\b/],
  ["Imperial Knights", /\bimperial knights?\b/],
  ["Agents of the Imperium", /\bagents of the imperium\b|\bimperial agents\b|\binquisition\b|\binquisitorial\b|\bassassinorum\b|\bnavy breachers\b|\bexaction squad\b/],
  ["Aeldari", /\bae?ldari\b|\baledari\b|\bstriking scorpions?\b|\bcraftworlds?\b|\bharlequins?\b|\bynnari\b|\bvoidscarred\b/],
  ["Drukhari", /\bdrukhari\b|\bmandrakes\b|\bhand of the archon\b/],
  ["Genestealer Cults", /\bgenestealer cults?\b|\bbrood brothers\b/],
  ["Leagues of Votann", /\bleagues? of votann\b|\bvotann\b|\bhearthkyn\b|\bhernkyn\b/],
  ["Necrons", /\bnecrons?\b|\bcanoptek circle\b/],
  ["Orks", /\borks?\b(?! flesh)|\bkommandos\b|\bwrecka krew\b/],
  ["T'au Empire", /\bt'?au empire\b|\bt'au\b|\btau\b|\bfarsight\b|\bkroot\b|\bfarstalker\b|\bvespid\b|\bxv\d+\b|\bstealth battlesuits\b|\bpathfinders\b/],
  ["Tyranids", /\btyranids?\b|\braveners?\b/],
  // Warhammer: Age of Sigmar
  ["Stormcast Eternals", /\bstormcast\b|\bdracothian\b|\bknight-arcanum\b|\bs\/eternals\b/],
  ["Cities of Sigmar", /\bcities of sigmar\b|\bc\/o\/s\b|\bfreeguild\b|\bflagellants\b|\btahlia vedra\b/],
  ["Fyreslayers", /\bfyreslayers?\b/],
  ["Kharadron Overlords", /\bkharadron\b|\bgrundstok\b/],
  ["Lumineth Realm-lords", /\blumineth\b|\bvanari\b|\bhurakan\b/],
  ["Idoneth Deepkin", /\bidoneth\b|\bakhelian\b|\bnamarti\b|\blotann\b/],
  ["Daughters of Khaine", /\bdaughters of khaine\b|\bslaughter queen\b|\bkhainite\b/],
  ["Sylvaneth", /\bsylvaneth\b|\bsylv\b/],
  ["Seraphon", /\bseraphon\b/],
  ["Blades of Khorne", /\bblades of khorne\b|\bdeathbringer\b/],
  ["Disciples of Tzeentch", /\bdisciples\W+(of\W+)?tzeentch\b|\btzeentch\b|\bkairic\b|\bgaunt summoner\b|\btzaangors?\b/],
  ["Maggotkin of Nurgle", /\bmaggotkin\b|\bgnarlmaw\b|\brotbringers?\b/],
  ["Hedonites of Slaanesh", /\bhedonites\b|\bdexcessa\b|\bglutos\b|\bsphiranx\b|\bepicurean\b/],
  ["Slaves to Darkness", /\bslaves? to darkness\b|\bfomoroid\b|\bogroid myrmidon\b|\bdarkoath\b|\bchaos warshrine\b|\bchaos lord\b/],
  ["Skaven", /\bskaven\b|\bclawlord\b|\bhell pit abomination\b/],
  ["Helsmiths of Hashut", /\bhelsmiths\b/],
  ["Flesh-eater Courts", /\bflesh-?eaters? courts?\b|\bf-e courts\b|\bterrorgheist\b|\bushoran\b/],
  ["Nighthaunt", /\bnighthaunt\b|\bgrimghast\b|\bbladegheist\b/],
  ["Ossiarch Bonereapers", /\bossiarch\b/],
  ["Soulblight Gravelords", /\bsoulbl?i?ght\b|\bs\/b gravelords\b|\bgravelords\b|\blauka vai\b|\bbelladamma\b/],
  ["Orruk Warclans", /\borruks?\b|\bgore-?gruntas\b|\bwarchanter\b|\bkillaboss\b|\bironjawz\b|\bkruleboyz\b/],
  ["Gloomspite Gitz", /\bgloomspite\b|\bgloosmpite\b|\bgloom\.?\W*gitz\b|\bsquig|\btroggoths?\b|\bgobbapalooza\b/],
  ["Ogor Mawtribes", /\bogor mawtribes\b|\bogors?\b|\bleadbelchers\b|\bgnoblars?\b/],
  ["Sons of Behemat", /\bsons of behemat\b/],
  ["Beasts of Chaos", /\bbeasts of chaos\b|\bungors\b/],
];

// The Horus Heresy and The Old World have their own armies; a title naming the game is
// matched against its list only ("EMPIRE OF MAN FLAGELLANTS" is not Cities of Sigmar,
// "ORC BOYZ" not Orks). Legions Imperialis is another game (epic scale): no army.
export const HERESY = [
  ["Solar Auxilia", /\bsolar auxilia\b/],
  ["Mechanicum", /\bmechanicum\b|\bskitarii\b|\bthanatar\b|\bursarax\b|\bvultarax\b|\bbattle-pilgrym\b/],
  ["Legiones Astartes", /\blegion(es|s)? astartes\b|\bmk ?(iii|iv|vi|vii)\b|\bcataphractii\b|\btartaros\b|\bdeathstorm\b|\b(contemptor|deredeo|leviathan) dreadnought|\b(predator|scorpius|sicaran|spartan|land raider|rhino|kratos|falchion|glaive|typhon|fellblade|mastodon|storm eagle|fire raptor|xiphon|sky-hunter)\b|\bbreacher squad\b|\bassault marines\b/],
];
export const OLD_WORLD = [
  ["Kingdom of Bretonnia", /\bbretonnia\b|\bkob:|\bprophetess(es)? of the lady\b|\broyal pegasus\b|\bknights of the realm\b|\bgrail\b/],
  ["Tomb Kings of Khemri", /\btomb kings\b|\bsettra\b|\bliche priest\b|\bnecrotect\b|\btomb scorpion\b|\bushabti\b|\bcasket of souls\b|\bapophas\b|\bnecrosphinx\b|\bskeleton (warriors|chariots|horsemen)\b/],
  ["Empire of Man", /\bempire\b|\bwitch hunter\b|\bwarrior priests? of (sigmar|ulric)\b|\bgrand master of the\b|\bstate (missile )?troops\b|\bpistoliers\b|\bdemigryph\b|\bwar altar\b|\bhelblaster\b/],
  ["Orc & Goblin Tribes", /\borcs? (&|and) goblin\b|\bgoblins?\b|\bblack orcs?\b|\borc (shaman|bosses|boyz|boar|bigboss)\b|\bsnotling\b|\bcommon trolls\b/],
  ["Dwarfen Mountain Holds", /\bdwarf(en)? mountain holds\b|\bdwarfs?\b|\bdwarven\b|\brunesmith\b|\bironbreakers\b|\bhammerers\b|\bquarrellers\b|\bgyrocopter\b/],
  ["High Elf Realms", /\bhigh el(f|ves)\b|\blothern\b|\beverqueen\b|\bphoenix guard\b|\bswordmasters\b|\bwhite lions\b|\bdragon princes\b|\bsilver helms\b|\bkorhil\b|\bavelorn\b|\bflamespyre\b/],
  ["Wood Elf Realms", /\bwood el(f|ves)\b|\bglade (guard|riders)\b|\beternal guard\b|\baraloth\b|\belven steed\b|\bwild riders\b|\bwardancers\b/],
  ["Warriors of Chaos", /\bwarriors of chaos\b|\bchaos (warriors|marauders?|knights|trolls|chariot)\b|\bmarauder horsemen\b|\bchampions? of chaos\b|\bsorcerer of chaos\b|\bchaos lord\b/],
  ["Beastmen Brayherds", /\bbeastm[ae]n\b|\bbrayherds?\b|\bbestigor\b|\bgor herd\b|\bminotaur\b|\bungor\b/],
  ["Grand Cathay", /\bgrand cathay\b|\bcathay(an)?\b|\bjade (warriors|lancers)\b|\bmiao ying\b|\bsky lantern\b|\bshugengan\b/],
];

// 40K datasheet armies that are one chapter of the Space Marines
const CHAPTERS = /^(ultramarines|white scars|raven guard|iron hands|imperial fists|salamanders|crimson fists|black templars?)$/i;

// not an army's product: paints and their names, hobby supplies, novels
const NOT_ARMY = /^(base|layer|shade|contrast|dry|technical|air|spray)\b|\b(warhammer colou?r|citadel|paint|spray|brush|drybrush|primer|glue|tufts?|texture|varnish|tools?|cutters|file set|bases?|tape measure|painting handle|mug|keychain|glass|mousepad)\b|^black library\b|\bbl:|\b(paperback|novel|audiobook|pb)\b|\(pb\)/i;
// a hardback is a novel unless it is a rules book
const HARDBACK = /\bhardback\b|\(hb\)/i, RULES = /\b(codex|battletome|index|army book|arcane journal|liber)\b/i;

// title, vendor, type, datasheet army -> army label or ""
export function armyOf(title, vendor, type, whArmy) {
  // Games Workshop's own listings, and wargames listed under another vendor (the Baneblade is)
  if (!/^games workshop$/i.test(vendor || "") && !/^tabletop wargames$/i.test(type || "")) return "";
  if (/paint|books?/i.test(type || "")) return "";
  const t = String(title || "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  if (NOT_ARMY.test(t) || /^horus heresy:/.test(t)) return "";
  if (HARDBACK.test(t) && !RULES.test(t)) return "";
  if (/^blood bowl\b/.test(t)) return "";                            // Blood Bowl teams are not armies
  if (/\bold world\b/.test(t)) {
    if (/\b(terrain|hills|walls and fences|movement tray)/.test(t)) return "";
    for (const [label, re] of OLD_WORLD) if (re.test(t)) return label;
    return "";
  }
  if (/\bhorus heresy\b/.test(t)) {
    if (/\blegions? imperialis\b|\btitan legions\b/.test(t)) return "";
    for (const [label, re] of HERESY) if (re.test(t)) return label;
    return "";
  }
  for (const [label, re] of ARMIES) if (re.test(t)) return label;
  if (!whArmy) return "";
  return CHAPTERS.test(whArmy) ? "Space Marines" : String(whArmy);
}

/* GET /army/preview.json - read-only: every Games Workshop product's title and the army the
   rules give it (what the nightly run would write), for checking coverage before and after.
   Public data only (titles), edge-cached 10 minutes. */
export async function serveArmyPreview(request, env, ctx, gql, page, parse, query) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/army/preview.json?v=3");
  const hit = await cache.match(key);
  if (hit) return hit;
  const items = [];
  let after = null;
  for (let i = 0; i < 80; i++) {
    const d = await gql(page, { q: query, after });
    const pg = parse(d);
    for (const it of pg.items) items.push({ t: it.title, ty: it.type, a: armyOf(it.title, it.vendor, it.type, it.whArmy), cur: it.army || "", wa: it.whArmy || "" });
    if (!pg.hasNext) break;
    after = pg.cursor;
  }
  const res = new Response(JSON.stringify({ generated: new Date().toISOString(), count: items.length, items }), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=600" },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
