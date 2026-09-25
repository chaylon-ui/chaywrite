/* Game system for the collection filter (owner, 2026-09-25: "can you add
   these filters and others to the filter pane? so I can filter by say, Blood
   Bowl for example"). The Cloud Search sidebar filters on product
   metafields, so every wargames product gets exor.game_system - a list,
   because a Kill Team box is also a Warhammer 40,000 box.

   The rules mirror the store's own smart collections (vendor/type + "title
   contains", case-insensitive), so a product that shows in "All Blood Bowl"
   filters as Blood Bowl. Pure function of title, vendor and type: the enrich
   DO recomputes it nightly and writes only what changed. */

export const GS_QUERY = "status:active AND (vendor:'Games Workshop' OR product_type:'Tabletop Wargames')";
export const GS_PAGE = `query($q:String!,$after:String){products(first:100,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title vendor productType gs: metafield(namespace:"exor", key:"game_system"){ value }}}}`;

const GW = (v) => /^games workshop$/i.test(v || "");
const WARGAME = (t) => /^tabletop wargames$/i.test(t || "");

// [label, needs Games Workshop vendor (else: type Tabletop Wargames), title pattern]
export const GAME_SYSTEMS = [
  ["Warhammer 40,000", true, /warhammer 40,000|warhammer 40k\b/i],
  ["Kill Team", true, /kill team/i],
  ["Age of Sigmar", true, /age of sigmar/i],
  ["The Horus Heresy", true, /horus heresy/i],
  ["The Old World", true, /the old world/i],
  ["Necromunda", true, /necromunda/i],
  ["Blood Bowl", true, /blood ?bowl/i],
  ["Legions Imperialis", true, /legions imperialis/i],
  ["Middle-earth", true, /middle-earth|middle earth/i],
  ["Warcry", true, /warcry/i],
  ["Warhammer Underworlds", true, /underworlds/i],
  ["Aeronautica Imperialis", true, /aeronautica imperialis/i],
  ["Adeptus Titanicus", true, /adeptus titanicus/i],
  ["Bolt Action", false, /bolt action/i],
  ["BattleTech", false, /battletech/i],
];

export function gameSystems(title, vendor, type) {
  const out = [];
  const t = String(title || "");
  for (const [label, gwOnly, re] of GAME_SYSTEMS) {
    if (gwOnly ? !GW(vendor) : !WARGAME(type)) continue;
    if (re.test(t)) out.push(label);
  }
  return out;
}

export function parseGsPage(data) {
  const p = data && data.products;
  if (!p) return { items: [], hasNext: false, cursor: null };
  return {
    items: p.nodes.map((n) => ({ id: n.id, title: n.title, vendor: n.vendor, type: n.productType, cur: (n.gs && n.gs.value) || "" })),
    hasNext: p.pageInfo.hasNextPage,
    cursor: p.pageInfo.endCursor,
  };
}

/* {set, del} for one product: set when the list changed, delete when a
   product that had one no longer matches any system. */
export function gsPlan(it) {
  const want = gameSystems(it.title, it.vendor, it.type);
  const value = want.length ? JSON.stringify(want) : "";
  let cur = "";
  try { cur = it.cur ? JSON.stringify(JSON.parse(it.cur)) : ""; } catch (e) { cur = it.cur || ""; }
  if (value === cur) return { want, set: [], del: [] };
  if (!value) return { want, set: [], del: [{ ownerId: it.id, namespace: "exor", key: "game_system" }] };
  return { want, set: [{ ownerId: it.id, namespace: "exor", key: "game_system", type: "list.single_line_text_field", value }], del: [] };
}
