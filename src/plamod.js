/* PLAMOD (our Gunpla / figure / blind-box distributor) - the product list the
   weekly PLAMOD runner works from.

   Owner, 2026-09-23: official product images for our kits - "I get gunpla
   from here: https://www.plamod.com/retailer", "I also get figures from
   there and blind boxes". PLAMOD's retailer portal lists every product with
   its barcode and the retailer image set (Download ZIP), and the images
   themselves are plain public files on images.plamod.com. The runner
   (.github/workflows/plamod-sync.yml) signs in to the portal with the
   owner's retailer account; it has no Shopify access, so it reads WHAT to
   look up from here: every active Gunpla / Figures / Blind Box product with
   its barcode and the image files it already has.

   Nothing here is private - titles, barcodes and product images are all on
   the storefront - and nothing is written. Cached for an hour. */

export const PLAMOD_TYPES = ["Gunpla", "Figures", "Blind Box"];
const QUERY = "status:active AND (" + PLAMOD_TYPES.map((t) => "product_type:'" + t + "'").join(" OR ") + ")";
const PAGE_Q = `query($q:String!,$after:String){products(first:50,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title productType variants(first:1){nodes{barcode sku}} media(first:8){nodes{... on MediaImage{image{url}}}}}}}`;

// "…/files/56E3EAA2-8CE1-11E6-8588-1A8B06F1886E-L.png?v=1" -> "56E3EAA2-8CE1-11E6-8588-1A8B06F1886E":
// PLAMOD names every image by a GUID, and the copies already on our products
// kept that name, so the runner can tell which PLAMOD images a product has.
export function imageKey(url) {
  // Upper-case and right after a "/": Shopify's own renamed copies
  // ("1_1f0115b9-….jpg") carry a lower-case uuid that is not a PLAMOD name.
  const m = String(url || "").match(/\/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})(?:-[A-Z])?(?:_[0-9a-f-]{36})?\.(?:png|jpe?g|webp)/);
  return m ? m[1].toUpperCase() : null;
}

export async function plamodTargets(gql) {
  const items = [];
  let after = null;
  let waits = 0;
  for (let i = 0; i < 80; i++) {
    let d;
    try { d = await gql(PAGE_Q, { q: QUERY, after }); }
    catch (e) {
      // Shopify's query budget refills at ~100 points a second; ~2000
      // products is ~40 pages, so a few short waits are normal.
      if (e && e.throttled && waits++ < 60) { await new Promise((r) => setTimeout(r, 3000)); i--; continue; }
      throw e;
    }
    const p = d && d.products;
    if (!p) break;
    for (const n of p.nodes) {
      const v = (n.variants && n.variants.nodes && n.variants.nodes[0]) || {};
      const barcode = String(v.barcode || v.sku || "").replace(/\D/g, "");
      const imgs = ((n.media && n.media.nodes) || []).map((m) => m && m.image && m.image.url).filter(Boolean);
      items.push({
        id: n.id, title: n.title, type: n.productType,
        barcode: /^\d{8,14}$/.test(barcode) ? barcode : "",
        images: imgs.length,
        keys: imgs.map(imageKey).filter(Boolean),
        urls: imgs.map((u) => String(u).split("?")[0]),
      });
    }
    if (!p.pageInfo.hasNextPage) break;
    after = p.pageInfo.endCursor;
  }
  return items;
}

export async function servePlamodTargets(request, env, ctx, gql) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/plamod/targets.json?v=2");
  const hit = await cache.match(key);
  if (hit) return hit;
  let body, status = 200;
  try {
    const items = await plamodTargets(gql);
    body = { generated: new Date().toISOString(), types: PLAMOD_TYPES, count: items.length, items };
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

/* ---- the nightly apply (a phase of the enrich sweep, after Gunpla) ---------

   data/plamod.json (committed by tools/plamod-sync.mjs) maps barcode ->
   { found, sku, photos:[{key,url}], dup:[keys], release, series, brand, maker }.
   For each of our products with a match:
     - photos: every PLAMOD photo the product does not have yet is added
       AFTER its existing ones (Shopify appends); never replaces or removes.
       "Does not have" = not the same file (PLAMOD's GUID name, which Shopify
       keeps), not the same picture (the runner's dup list), and never offered
       before (exor.pl_added) - so a photo the owner deletes stays deleted.
     - facts: exor.pl_release / pl_series / pl_brand / pl_maker / pl_sku,
       written only when they change (exor.pl_sig). No case / carton wording
       ever reaches here (the runner drops it; checked again below). */
export const PLAMOD_FILE_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/plamod.json";
export const PL_PAGE = `query($q:String!,$after:String){products(first:25,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title productType variants(first:1){nodes{barcode sku}} media(first:30){nodes{... on MediaImage{image{url}}}} added: metafield(namespace:"exor", key:"pl_added"){ value } psig: metafield(namespace:"exor", key:"pl_sig"){ value }}}}`;
export const PL_ADD_MEDIA = `mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) { productUpdate(product: $product, media: $media) { product { id } userErrors { field message } } }`;
export const PL_QUERY = QUERY;
const CASE_WORDS = /\b(cases?|cartons?|display(?:\s*box)?|box(?:es)?\s+of|sets?\s+of|packs?\s+of|\d+\s*(?:pcs?|pieces|packs?|boxes)|assort(?:ment|ed)?|inner|master\s*pack|bulk)\b/i;
const okFact = (s) => { s = String(s || "").trim(); return s && s.length <= 80 && !CASE_WORDS.test(s) ? s : ""; };
const MF = (ownerId, key, type, value) => ({ ownerId, namespace: "exor", key, type, value: String(value) });
function sig(list) {
  const s = list.map((m) => m.key + "=" + m.value).join("\n");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "v1:" + h.toString(16) + ":" + s.length;
}

export function parsePlPage(data) {
  const p = data && data.products;
  if (!p) return { items: [], hasNext: false, cursor: null };
  const items = p.nodes.map((n) => {
    const v = (n.variants && n.variants.nodes && n.variants.nodes[0]) || {};
    const bc = String(v.barcode || v.sku || "").replace(/\D/g, "");
    let added = [];
    try { added = JSON.parse((n.added && n.added.value) || "[]"); } catch {}
    const urls = ((n.media && n.media.nodes) || []).map((m) => m && m.image && m.image.url).filter(Boolean);
    return { id: n.id, title: n.title, type: n.productType, barcode: /^\d{8,14}$/.test(bc) ? bc : "", keys: urls.map(imageKey).filter(Boolean), added: Array.isArray(added) ? added : [], plSig: (n.psig && n.psig.value) || "" };
  });
  return { items, hasNext: p.pageInfo.hasNextPage, cursor: p.pageInfo.endCursor };
}

// One product + its PLAMOD entry -> what to do: { media, metafields } (both may be empty).
export function plamodPlan(it, entry) {
  const out = { media: [], metafields: [], newKeys: [] };
  if (!it || !entry || !entry.found) return out;
  const skip = new Set([...(it.keys || []), ...(it.added || []), ...(entry.dup || [])]);
  for (const p of entry.photos || []) {
    if (!p || !p.key || !/^https:\/\/images\.plamod\.com\//.test(p.url || "") || skip.has(p.key)) continue;
    skip.add(p.key);
    out.newKeys.push(p.key);
    out.media.push({ originalSource: p.url, mediaContentType: "IMAGE", alt: String(it.title || "").slice(0, 250) });
  }
  const facts = [];
  const rel = /^\d{4}-\d{2}(-\d{2})?$/.test(entry.release || "") ? entry.release : "";
  if (rel) facts.push(MF(it.id, "pl_release", "single_line_text_field", rel));
  for (const [k, v] of [["pl_series", entry.series], ["pl_brand", entry.brand], ["pl_maker", entry.maker], ["pl_sku", entry.sku]]) {
    const f = okFact(v);
    if (f) facts.push(MF(it.id, k, "single_line_text_field", f));
  }
  const s = sig(facts);
  if (s !== it.plSig) out.metafields.push(...facts, MF(it.id, "pl_sig", "single_line_text_field", s));
  if (out.newKeys.length) out.metafields.push(MF(it.id, "pl_added", "json", JSON.stringify([...(it.added || []), ...out.newKeys])));
  return out;
}
