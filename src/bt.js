/* BattleTech box contents + unit facts (owner, 2026-09-25: "lets do battle tech").

   tools/battletech.py (weekly GitHub Action, chaywrite main) reads Sarna's
   ForcePack pages for what is in each box and MegaMek's unit files for each
   unit's plain facts, matches our BattleTech products by title, and commits
   data/battletech.json:
     { generated, counts, products: { <numeric product id>: facts } }
   facts = { pack, kind: "forcepack" | "salvage", units: [{ name, model, type,
             tons, cls, tech, role, walk, run, jump, year }], sig }
   Names and numbers only - no descriptions, no record sheets.

   This module gives that job its work list (/bt/targets.json: id + title of
   every active BattleTech product) and does the nightly apply, a phase of the
   enrich sweep: exor.bt_pack (json) + four filter fields + exor.bt_sig,
   written only when the signature changes, all deleted from a product the
   file no longer matches. Nothing else on the product is touched. */

export const BT_FILE_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/battletech.json";
export const BT_QUERY = "status:active AND title:*battletech*";
const TARGETS_Q = `query($q:String!,$after:String){products(first:250,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title}}}`;
export const BT_PAGE = `query($q:String!,$after:String){products(first:50,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title bsig: metafield(namespace:"exor", key:"bt_sig"){ value }}}}`;

/* Filter fields (the Cloud Search sidebar filters on plain metafields):
     bt_classes  list  weight classes in the box (Light, Medium, Heavy, Assault)
     bt_tech     list  Inner Sphere / Clan / Mixed
     bt_roles    list  MegaMek unit roles (Sniper, Striker, Brawler...)
     bt_types    list  BattleMech / Combat Vehicle / Battle Armor / ...
   BT_FACETS_V is part of the stored signature so a change here rewrites every
   product once. */
export const BT_FACETS_V = "b1";
export const BT_FACET_KEYS = ["bt_classes", "bt_tech", "bt_roles", "bt_types"];
const CLASS_ORDER = ["Ultralight", "Light", "Medium", "Heavy", "Assault", "Superheavy"];

function uniq(list) { const out = []; for (const x of list) if (x && out.indexOf(x) === -1) out.push(x); return out; }

export function btFacets(facts) {
  const units = (facts && facts.units) || [];
  const classes = uniq(units.map((u) => u.cls)).sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
  const tech = uniq(units.map((u) => (/clan/i.test(u.tech || "") ? "Clan" : /mixed/i.test(u.tech || "") ? "Mixed" : u.tech ? "Inner Sphere" : "")));
  const roles = uniq(units.map((u) => u.role)).sort();
  const types = uniq(units.map((u) => u.type));
  return { bt_classes: classes, bt_tech: tech, bt_roles: roles, bt_types: types };
}

export async function btTargets(gql) {
  const items = [];
  let after = null;
  let waits = 0;
  for (let i = 0; i < 20; i++) {
    let d;
    try { d = await gql(TARGETS_Q, { q: BT_QUERY, after }); }
    catch (e) {
      if (e && e.throttled && waits++ < 60) { await new Promise((r) => setTimeout(r, 3000)); i--; continue; }
      throw e;
    }
    const p = d && d.products;
    if (!p) break;
    for (const n of p.nodes) items.push({ id: n.id, title: n.title });
    if (!p.pageInfo.hasNextPage) break;
    after = p.pageInfo.endCursor;
  }
  return items;
}

export async function serveBtTargets(request, env, ctx, gql) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/bt/targets.json?v=2");
  const hit = await cache.match(key);
  if (hit) return hit;
  let body, status = 200;
  try {
    const items = await btTargets(gql);
    body = { generated: new Date().toISOString(), query: BT_QUERY, count: items.length, items };
  } catch (e) {
    status = 502;
    body = { error: String((e && e.message) || e).slice(0, 200) };
  }
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=3600" : "no-store" },
  });
  if (status === 200) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export function parseBtPage(data) {
  const p = data && data.products;
  if (!p) return { items: [], hasNext: false, cursor: null };
  return {
    items: p.nodes.map((n) => ({ id: n.id, title: n.title, sig: (n.bsig && n.bsig.value) || "" })),
    hasNext: p.pageInfo.hasNextPage,
    cursor: p.pageInfo.endCursor,
  };
}

/* {set, del, unset} for one product. */
export function btPlan(it, file) {
  const out = { set: [], del: [], unset: [] };
  const num = String(it.id || "").split("/").pop();
  const facts = file && file.products && file.products[num];
  if (facts && facts.units && facts.units.length && facts.sig) {
    const want = facts.sig + "+" + BT_FACETS_V;
    if (want === it.sig) return out;
    const { sig, ...pack } = facts;
    out.set.push({ ownerId: it.id, namespace: "exor", key: "bt_pack", type: "json", value: JSON.stringify(pack) });
    const f = btFacets(pack);
    for (const k of BT_FACET_KEYS) {
      if (!f[k].length) out.unset.push({ ownerId: it.id, namespace: "exor", key: k });
      else out.set.push({ ownerId: it.id, namespace: "exor", key: k, type: "list.single_line_text_field", value: JSON.stringify(f[k]) });
    }
    out.set.push({ ownerId: it.id, namespace: "exor", key: "bt_sig", type: "single_line_text_field", value: want });
  } else if (it.sig) {
    for (const k of ["bt_pack", "bt_sig", ...BT_FACET_KEYS]) out.del.push({ ownerId: it.id, namespace: "exor", key: k });
  }
  return out;
}
