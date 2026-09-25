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

/* ---- "Other units like this" (owner, 2026-09-25: "possible to make these
   clickable so you can bring up other warhammer comps? like how we do by
   boardgames") ------------------------------------------------------------------
   The Unit specs card's Army, Datasheet, Unit size, Points and keyword values
   are chips; a chip opens the other 40K boxes we have in stock that share it.
   The index behind it is every published, in-stock 40K product that carries
   exor.wh_unit, kept by the enrich DO beside the board games index. Unit
   size, points and keywords stay inside the clicked unit's army (a list is
   built from one army); army and datasheet go store-wide. */
export const WINDEX_QUERY = W40K_QUERY + " AND published_status:published AND inventory_total:>0";
export const WINDEX_PAGE = `query($q:String!,$n:Int!,$after:String){
  products(first:$n, query:$q, sortKey:ID, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      handle title totalInventory
      featuredImage{ url }
      priceRangeV2{ minVariantPrice{ amount } }
      variants(first:1){ nodes{ id availableForSale } }
      wu: metafield(namespace:"exor", key:"wh_unit"){ value }
    }
  }
}`;
export const UNIT_KINDS = ["army", "datasheet", "size", "points", "keyword"];
export const UNIT_LIMIT_MAX = 48;

const fold = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// "1", "5-10": the unit's model range as the card prints it
export function sizeKey(models) {
  if (!Array.isArray(models) || !models.length) return "";
  const lo = num(models[0], 0), hi = num(models[1], lo);
  return hi > lo ? lo + "-" + hi : String(lo);
}

export function parseWindexPage(data) {
  const pr = data && data.products;
  const items = [];
  for (const n of (pr && pr.nodes) || []) {
    if (!n || !n.handle || !n.wu || !n.wu.value) continue;
    let u;
    try { u = JSON.parse(n.wu.value); } catch (e) { continue; }
    if (!u || !u.name) continue;
    const v = (n.variants && n.variants.nodes && n.variants.nodes[0]) || null;
    const pts = (u.points || []).map((r) => num(r && r[1], 0)).filter((x) => x > 0);
    items.push({
      h: n.handle,
      t: String(n.title || ""),
      q: num(n.totalInventory, 0),
      i: (n.featuredImage && n.featuredImage.url) || "",
      p: Math.round(num(n.priceRangeV2 && n.priceRangeV2.minVariantPrice && n.priceRangeV2.minVariantPrice.amount, 0) * 100),
      v: v && v.availableForSale !== false ? String(v.id || "").replace(/^gid:\/\/shopify\/\w+\//, "") : "",
      f: String(u.faction || ""),
      n: String(u.name || "").replace(/\s*\[legends\]/i, ""),
      z: sizeKey(u.models),
      pt: pts.length ? Math.min(...pts) : 0,
      k: [...(u.keywords || []), ...(u.factionKeywords || [])].map(String),
    });
  }
  return { items, cursor: (pr && pr.pageInfo && pr.pageInfo.endCursor) || null, hasNext: !!(pr && pr.pageInfo && pr.pageInfo.hasNextPage) };
}

// Points "around" a value: within 15% either way (at least 10 pts), so a
// 70-pt Trukk finds the 60-80 pt units of its army.
export function pointsNear(a, b) {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) <= Math.max(10, b * 0.15);
}

export function likeUnits(units, kind, value, army, exclude, limit) {
  const want = fold(value), arm = fold(army), ex = fold(exclude);
  if (!UNIT_KINDS.includes(kind) || !want) return { count: 0, units: [] };
  const target = kind === "points" ? num(String(value).replace(/[^\d.]/g, ""), 0) : 0;
  const scoped = kind === "size" || kind === "points" || kind === "keyword";
  const hit = (units || []).filter((u) => {
    if (!u || !u.h || (ex && fold(u.h) === ex)) return false;
    if (scoped && arm && fold(u.f) !== arm) return false;
    if (kind === "army") return fold(u.f) === want;
    if (kind === "datasheet") return fold(u.n) === want;
    if (kind === "size") return fold(u.z) === want;
    if (kind === "points") return pointsNear(u.pt, target);
    return (u.k || []).some((k) => fold(k) === want);
  });
  hit.sort((a, b) => {
    if (kind === "points") { const d = Math.abs(a.pt - target) - Math.abs(b.pt - target); if (d) return d; }
    const n = String(a.n).localeCompare(String(b.n));
    return n || String(a.t).localeCompare(String(b.t));
  });
  const n = Math.max(1, Math.min(UNIT_LIMIT_MAX, num(limit, 24)));
  return {
    count: hit.length,
    units: hit.slice(0, n).map((u) => ({
      handle: u.h, title: u.t, url: "/products/" + u.h,
      image: u.i ? u.i + (u.i.indexOf("?") > -1 ? "&" : "?") + "width=360" : null,
      price: (u.p / 100).toFixed(2), qty: u.q, variant: u.v || null,
      army: u.f, datasheet: u.n, size: u.z, points: u.pt || null,
    })),
  };
}
