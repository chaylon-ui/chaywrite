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
  ["Chaos Space Marines", /\bchaos space marines?\b|\bheretic astartes\b|\bcsm\b|\bkill team: legionaries\b|\bfellgor\b/],
  ["Chaos Knights", /\bchaos knights?\b/],
  ["Chaos Daemons", /\bchaos daemons?\b/],
  ["Death Guard", /\bdeath guard\b/],
  ["Thousand Sons", /\bthousand sons\b/],
  ["World Eaters", /\bworld eaters\b/],
  ["Emperor's Children", /\bemperor'?s children\b/],
  ["Black Templars", /\bblack templars?\b/],
  ["Blood Angels", /\bblood angels?\b/],
  ["Dark Angels", /\bdark angels?\b/],
  ["Space Wolves", /\bspace wolf|\bspace wolves\b/],
  ["Deathwatch", /\bdeathwatch\b/],
  ["Grey Knights", /\bgrey knights?\b/],
  ["Legiones Astartes", /\blegiones astartes\b/],                 // The Horus Heresy
  ["Space Marines", /\bspace marines?\b|\badeptus astartes\b|\bs\/m\b|\bimp\.? fists\b|\bimperial fists\b|\biron hands\b|\bultramarines?\b|\bsalamanders\b|\braven guard\b|\bwhite scars\b|\bwhite consuls\b|\bprimaris\b/],
  ["Adepta Sororitas", /\badepta sor[io]r[io]tas\b|\bsisters of battle\b|\bnovitiates\b/],
  ["Adeptus Custodes", /\badeptus custodes\b|\bcustodes\b/],
  ["Adeptus Mechanicus", /\bmechanicus\b/],
  ["Astra Militarum", /\bastra militarum\b|\bimperial guard\b|\bveteran guardsmen\b|\bkasrkin\b|\btempestus\b/],
  ["Imperial Knights", /\bimperial knights?\b/],
  ["Agents of the Imperium", /\bagents of the imperium\b|\bimperial agents\b|\binquisition\b|\binquisitorial\b|\bassassinorum\b|\bnavy breachers\b|\bexaction squad\b/],
  ["Aeldari", /\baeldari\b|\bcraftworlds?\b|\bharlequins?\b|\bynnari\b|\bvoidscarred\b/],
  ["Drukhari", /\bdrukhari\b|\bhand of the archon\b/],
  ["Genestealer Cults", /\bgenestealer cults?\b/],
  ["Leagues of Votann", /\bleagues? of votann\b|\bvotann\b|\bhearthkyn\b/],
  ["Necrons", /\bnecrons?\b/],
  ["Orks", /\borks?\b(?! flesh)|\bkommandos\b/],
  ["T'au Empire", /\bt'?au empire\b|\bt'au\b|\btau\b|\bfarsight\b/],
  ["Tyranids", /\btyranids?\b/],
  // Warhammer: Age of Sigmar
  ["Stormcast Eternals", /\bstormcast\b|\bs\/eternals\b/],
  ["Cities of Sigmar", /\bcities of sigmar\b|\bc\/o\/s\b|\bfreeguild\b|\bflagellants\b|\btahlia vedra\b/],
  ["Fyreslayers", /\bfyreslayers?\b/],
  ["Kharadron Overlords", /\bkharadron\b/],
  ["Lumineth Realm-lords", /\blumineth\b|\bvanari\b|\bhurakan\b/],
  ["Idoneth Deepkin", /\bidoneth\b|\bakhelian\b|\bnamarti\b|\blotann\b/],
  ["Daughters of Khaine", /\bdaughters of khaine\b/],
  ["Sylvaneth", /\bsylvaneth\b|\bsylv\b/],
  ["Seraphon", /\bseraphon\b/],
  ["Blades of Khorne", /\bblades of khorne\b/],
  ["Disciples of Tzeentch", /\bdisciples\W+(of\W+)?tzeentch\b|\btzeentch\b|\bkairic\b|\btzaangors?\b/],
  ["Maggotkin of Nurgle", /\bmaggotkin\b|\brotbringers?\b/],
  ["Hedonites of Slaanesh", /\bhedonites\b/],
  ["Slaves to Darkness", /\bslaves to darkness\b|\bdarkoath\b|\bchaos warshrine\b|\bchaos lord\b/],
  ["Skaven", /\bskaven\b/],
  ["Helsmiths of Hashut", /\bhelsmiths\b/],
  ["Flesh-eater Courts", /\bflesh-?eater courts?\b/],
  ["Nighthaunt", /\bnighthaunt\b/],
  ["Ossiarch Bonereapers", /\bossiarch\b/],
  ["Soulblight Gravelords", /\bsoulbl?i?ght\b|\bs\/b gravelords\b|\bgravelords\b/],
  ["Orruk Warclans", /\borruks?\b|\bironjawz\b|\bkruleboyz\b/],
  ["Gloomspite Gitz", /\bgloomspite\b|\bgloom\.?\W*gitz\b|\bsquig|\btroggoths?\b|\bgobbapalooza\b/],
  ["Ogor Mawtribes", /\bogor mawtribes\b|\bogors?\b|\bleadbelchers\b|\bgnoblars?\b/],
  ["Sons of Behemat", /\bsons of behemat\b/],
  ["Beasts of Chaos", /\bbeasts of chaos\b|\bungors\b/],
  // Warhammer: The Old World
  ["Kingdom of Bretonnia", /\bbretonnia\b/],
  ["Tomb Kings of Khemri", /\btomb kings\b|\bsettra\b/],
];

// 40K datasheet armies that are one chapter of the Space Marines
const CHAPTERS = /^(ultramarines|white scars|raven guard|iron hands|imperial fists|salamanders|crimson fists|black templars?)$/i;

// not an army's product: paints and their names, hobby supplies, novels
const NOT_ARMY = /^(base|layer|shade|contrast|dry|technical|air|spray)\b|\b(warhammer colou?r|citadel|paint|spray|brush|drybrush|primer|glue|tufts?|texture|varnish|tools?|cutters|file set|bases?|tape measure|painting handle|mug|keychain|glass|mousepad)\b|^black library\b|\bbl:|\b(paperback|novel|audiobook)\b|\(pb\)/i;
// a hardback is a novel unless it is a rules book
const HARDBACK = /\bhardback\b|\(hb\)/i, RULES = /\b(codex|battletome|index|army book|arcane journal|liber)\b/i;

// title, vendor, type, datasheet army -> army label or ""
export function armyOf(title, vendor, type, whArmy) {
  // Games Workshop's own listings, and wargames listed under another vendor (the Baneblade is)
  if (!/^games workshop$/i.test(vendor || "") && !/^tabletop wargames$/i.test(type || "")) return "";
  if (/paint|books?/i.test(type || "")) return "";
  const t = String(title || "").toLowerCase().replace(/\s+/g, " ");
  if (NOT_ARMY.test(t) || /^horus heresy:/.test(t)) return "";
  if (HARDBACK.test(t) && !RULES.test(t)) return "";
  if (/^blood bowl\b/.test(t)) return "";                            // Blood Bowl teams are not armies
  for (const [label, re] of ARMIES) if (re.test(t)) return label;
  if (!whArmy) return "";
  return CHAPTERS.test(whArmy) ? "Space Marines" : String(whArmy);
}

/* GET /army/preview.json - read-only: every Games Workshop product's title and the army the
   rules give it (what the nightly run would write), for checking coverage before and after.
   Public data only (titles), edge-cached 10 minutes. */
export async function serveArmyPreview(request, env, ctx, gql, page, parse, query) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/army/preview.json?v=2");
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
