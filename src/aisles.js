/* ---------------- The 3D shop's aisles and its graded-card cabinet ----------------
   Owner, 2026-11-10: "make the store much larger so we can display all our product on the
   shelves for gunpla, figures, board games, etc.. where you have headers above the aisles
   and ... scroll through all the products we have in stock", and a tall locked glass
   showcase "you can put graded cards in ... take it out of showcase and flip it over to see
   the back ... Fill it with all graded cards", where a card priced $999,999 "says to ask".

   GET /showcase/aisles.json            the aisles and how many products each holds in stock
   GET /showcase/aisle.json?cat=&after= one page (100) of an aisle's products by title, with the
                                        cursor for the next page: the page walks down an aisle
                                        and asks for more as it goes
   GET /showcase/graded.json            every graded card in stock: front and back photo, grade,
                                        price, and ask:true where the price is the placeholder
   Read from Shopify's Admin API, each answer cached ten minutes. */

import { adminGql } from "./price-history.js";
import { gqlPatient, preorderDate, sealedName } from "./boxes.js";

export const AISLES = [
  { key: "gunpla", label: "Gunpla", q: 'product_type:"Gunpla"' },
  { key: "models", label: "Model Kits", q: 'product_type:"Plastic Model Kit"' },
  { key: "figures", label: "Figures & Funko", q: '(product_type:"Figures" OR product_type:"Funko")' },
  { key: "blind", label: "Blind Boxes", q: 'product_type:"Blind Box"' },
  { key: "board", label: "Board Games", q: 'product_type:"Board Games"' },
  { key: "wargames", label: "Warhammer", q: 'product_type:"Tabletop Wargames"' },
];
const BASE = "status:active AND published_status:published AND inventory_total:>0 AND ";
export const AISLE_PAGE = 100;
export const ASK_PRICE = 999999;        // the till's placeholder for "not priced yet"

const HEAD = (s) => ({ "content-type": "application/json", "cache-control": s ? "public, max-age=" + s : "no-store", "access-control-allow-origin": "*" });
const json = (o, status, s) => new Response(JSON.stringify(o), { status: status || 200, headers: HEAD(s) });
const run = (env, o, q, v) => gqlPatient(() => (o.gqlFn ? o.gqlFn(q, v) : adminGql({ env, fetch: (u, i) => fetch(u, i) }, q, v)), o.waitMs);
async function cached(o, ctx, keyUrl, build) {
  const cache = o.gqlFn ? null : caches.default, key = new Request(keyUrl);
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out; try { out = await build(); } catch (e) { out = { ok: false, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? 600 : 0);
  if (out.ok && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export const COUNTS_Q = "query{" + AISLES.map((a, i) => "a" + i + ":productsCount(query:" + JSON.stringify(BASE + a.q) + "){count}").join(" ") + "}";
export async function serveAisles(request, env, ctx, url, opts) {
  const o = opts || {};
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/aisles.json", url).toString(), async () => {
    const r = await run(env, o, COUNTS_Q, {});
    return { ok: true, aisles: AISLES.map((a, i) => ({ key: a.key, label: a.label, count: Number((r.data && r.data["a" + i] && r.data["a" + i].count) || 0) })).filter((a) => a.count > 0) };
  });
}

export const AISLE_Q = `query($q:String!,$after:String){products(first:${AISLE_PAGE},after:$after,sortKey:TITLE,query:$q){pageInfo{hasNextPage endCursor}nodes{title handle media(first:1){nodes{preview{image{url width height}}}} variants(first:1){nodes{id price inventoryQuantity availableForSale}}}}}`;
// rows [name, handle, price, image | null, picture width / height, variant id, in stock]
export function aisleRows(products, now) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || ""); if (!title) continue;
    const pre = preorderDate(title); if (pre !== null && !(pre <= now)) continue;
    const v = ((p.variants && p.variants.nodes) || [])[0];
    if (!v || !(+v.inventoryQuantity > 0) || !(+v.price > 0) || v.availableForSale === false) continue;
    const pic = ((((p.media && p.media.nodes) || [])[0] || {}).preview || {}).image;
    out.push([sealedName(title), String(p.handle || ""), String(v.price), (pic && pic.url) || null,
      pic && pic.width > 0 && pic.height > 0 ? Math.round((pic.width / pic.height) * 100) / 100 : 1, String(v.id || "").replace(/^.*\//, ""), +v.inventoryQuantity]);
  }
  return out;
}
export async function serveAisle(request, env, ctx, url, opts) {
  const o = opts || {};
  const a = AISLES.find((x) => x.key === String(url.searchParams.get("cat") || "").toLowerCase());
  if (!a) return json({ ok: false, error: "cat must be one of " + AISLES.map((x) => x.key).join(", ") }, 400);
  const after = String(url.searchParams.get("after") || "");
  if (after && !/^[A-Za-z0-9+/=_-]{1,600}$/.test(after)) return json({ ok: false, error: "bad cursor" }, 400);
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/aisle.json?cat=" + a.key + "&after=" + encodeURIComponent(after), url).toString(), async () => {
    const r = await run(env, o, AISLE_Q, { q: BASE + a.q, after: after || null });
    const c = (r.data && r.data.products) || {};
    return { ok: true, cat: a.key, rows: aisleRows(c.nodes, o.now || Date.now()), next: c.pageInfo && c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null };
  });
}

export const GRADED_Q = `query($after:String){products(first:100,after:$after,sortKey:CREATED_AT,reverse:true,query:${JSON.stringify(BASE + "title:Graded")}){pageInfo{hasNextPage endCursor}nodes{title handle productType media(first:2){nodes{preview{image{url width height}}}} variants(first:1){nodes{id price inventoryQuantity availableForSale}}}}}`;
const GRADE_RE = /\bGraded\s+((?:PSA|BGS|CGC|TAG|SGC|ACE|AGS|HGA|GMA|MNT)\s*[0-9]+(?:\.[0-9])?)/i;
// The cabinet's cards: the ones to ask about first (the grails), then the dearest down to the cheapest.
export function gradedOf(products) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || "");
    if (!/\bgraded\b/i.test(title) && !/graded/i.test(String((p && p.productType) || ""))) continue;
    const v = ((p.variants && p.variants.nodes) || [])[0];
    if (!v || !(+v.inventoryQuantity > 0) || !(+v.price > 0) || v.availableForSale === false) continue;
    const pics = ((p.media && p.media.nodes) || []).map((m) => m && m.preview && m.preview.image).filter((i) => i && i.url);
    if (!pics.length) continue;
    const g = GRADE_RE.exec(title);
    out.push({ name: title.replace(/\s+/g, " ").trim(), handle: String(p.handle || ""), price: String(v.price), ask: +v.price >= ASK_PRICE,
      front: pics[0].url, back: pics[1] ? pics[1].url : null, ar: pics[0].width > 0 && pics[0].height > 0 ? Math.round((pics[0].width / pics[0].height) * 100) / 100 : .75,
      variantId: String(v.id || "").replace(/^.*\//, ""), grade: g ? g[1].replace(/\s+/g, " ").toUpperCase() : "" });
  }
  return out.sort((a, b) => (b.ask - a.ask) || (+b.price - +a.price));
}
export async function serveGraded(request, env, ctx, url, opts) {
  const o = opts || {};
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/graded.json", url).toString(), async () => {
    let nodes = [], after = null;
    for (let i = 0; i < 4; i++) {
      const r = await run(env, o, GRADED_Q, { after });
      const c = (r.data && r.data.products) || {}; nodes = nodes.concat(c.nodes || []);
      if (!c.pageInfo || !c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
    }
    return { ok: true, rows: gradedOf(nodes) };
  });
}
