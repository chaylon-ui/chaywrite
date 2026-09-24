/* Warhammer 40,000 unit specs (owner, 2026-09-24: "warhammer, lets do it").

   tools/w40k.py (weekly GitHub Action, chaywrite main) reads the community
   BSData wh40k-10e datasheets, matches our 40K unit boxes to them by
   faction + unit name, and commits data/w40k.json:
     { generated, bsdata, counts, products: { <numeric product id>: facts } }
   facts = { faction, name, legends, keywords, factionKeywords, models,
             sizes: [{m, p}], stats: [{name, M, T, SV, W, LD, OC}],
             weapons: { ranged: [...], melee: [...] }, source, sig }
   Numbers, names and keywords only - never rules text.

   This module gives that job its work list (/w40k/targets.json: id +
   title of every 40K product) and does the nightly apply, a phase of the
   enrich sweep after PLAMOD: exor.wh_unit (json) + exor.wh_sig, written
   only when the signature changes, and both deleted from a product the
   file no longer matches. Nothing else on the product is touched. */

export const W40K_FILE_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/w40k.json";
export const W40K_QUERY = "status:active AND (product_type:'Tabletop Wargames' OR product_type:'Games Workshop') AND (title:*40k* OR title:*40,000* OR title:*40000*)";
const TARGETS_Q = `query($q:String!,$after:String){products(first:250,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title}}}`;
export const W40K_PAGE = `query($q:String!,$after:String){products(first:50,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title wsig: metafield(namespace:"exor", key:"wh_sig"){ value }}}}`;

export async function w40kTargets(gql) {
  const items = [];
  let after = null;
  let waits = 0;
  for (let i = 0; i < 40; i++) {
    let d;
    try { d = await gql(TARGETS_Q, { q: W40K_QUERY, after }); }
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

export async function serveW40kTargets(request, env, ctx, gql) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/w40k/targets.json?v=1");
  const hit = await cache.match(key);
  if (hit) return hit;
  let body, status = 200;
  try {
    const items = await w40kTargets(gql);
    body = { generated: new Date().toISOString(), query: W40K_QUERY, count: items.length, items };
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

export function parseW40kPage(data) {
  const p = data && data.products;
  if (!p) return { items: [], hasNext: false, cursor: null };
  return {
    items: p.nodes.map((n) => ({ id: n.id, title: n.title, sig: (n.wsig && n.wsig.value) || "" })),
    hasNext: p.pageInfo.hasNextPage,
    cursor: p.pageInfo.endCursor,
  };
}

// One product + the file -> { set: [metafield inputs], del: [identifiers] }.
export function w40kPlan(it, file) {
  const out = { set: [], del: [] };
  const num = String(it.id || "").split("/").pop();
  const facts = file && file.products && file.products[num];
  if (facts && facts.name && facts.sig) {
    if (facts.sig === it.sig) return out;                     // unchanged
    const { sig, ...unit } = facts;
    out.set.push({ ownerId: it.id, namespace: "exor", key: "wh_unit", type: "json", value: JSON.stringify(unit) });
    out.set.push({ ownerId: it.id, namespace: "exor", key: "wh_sig", type: "single_line_text_field", value: String(sig) });
  } else if (it.sig) {
    // matched before, not any more (renamed, or the datasheet went away)
    out.del.push({ ownerId: it.id, namespace: "exor", key: "wh_unit" }, { ownerId: it.id, namespace: "exor", key: "wh_sig" });
  }
  return out;
}
