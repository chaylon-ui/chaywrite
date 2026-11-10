/* ---------------- The four-row boxes behind the case ----------------
   Owner, 2026-11-04: "in the back of the showcase you can see white four
   laners on a shelf that they can click on and then pick the card game, set,
   and then cycle through the four laners like if they were in an actual card
   store where they are alphabetical, sort of a top down view"; then "why
   can't it just work like search results".

   It works like search results. Nothing is copied or rebuilt: the set list
   comes from BinderPOS's own catalogue (GET portal.binderpos.com/api/cards/
   <game>/sets, a plain array, 88-1,052 names) and a set's cards come from the
   same feed the site's advanced search uses (POST .../products/forStore with
   setNames [set], instockOnly, up to 400 a call, 0.3-0.7 s), read when the
   set is opened and cached a few minutes at the edge. Each product carries
   its Shopify variant ids, prices and stock, so Add to cart works as is.

   Routes (index.js):
     GET /showcase/boxes.json?game=     the shelf: the game's sets, cut into
                                        boxes of ~SETS_PER_BOX, labelled by initials
     GET /showcase/set.json?game=&set=  one set's in-stock cards, alphabetical:
                                        rows [name, handle, price, image, variantId, condition, foil, copies]
     GET /showcase/card.json?handle=    every copy of one card in stock, live from Shopify
                                        (when a card is picked up; the case uses it too) */

import { adminGql } from "./price-history.js";

export const STORE = "most-wanted-ca.myshopify.com";
export const SETS_PER_BOX = 70;
export const FEED_PAGE = 400;          // forStore honours 400 (probe 2026-11-04: Dominaria, 229 in stock, one call)
export const FEED_CAP = 2000;          // cards per set at most
export const FEED_URL = "https://portal.binderpos.com/external/shopify/products/forStore";
export const SETS_URL = (g) => "https://portal.binderpos.com/api/cards/" + g + "/sets";

// Showcase game key -> BinderPOS game id and the label on the box
export const BOX_GAMES = {
  mtg: { bp: "mtg", label: "Magic" },
  pokemon: { bp: "pokemon", label: "Pokémon" },
  yugioh: { bp: "yugioh", label: "Yu-Gi-Oh!" },
  onepiece: { bp: "one", label: "One Piece" },
  starwars: { bp: "swu", label: "Star Wars" },
  riftbound: { bp: "riftbound", label: "Riftbound" },
};

const NO_STORE = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const CACHED = (s) => ({ "content-type": "application/json", "cache-control": "public, max-age=" + s, "access-control-allow-origin": "*" });
const json = (o, status, h) => new Response(JSON.stringify(o), { status: status || 200, headers: h || NO_STORE });
const FEED_HEADERS = { "content-type": "application/json", accept: "application/json", origin: "https://exorgames.com", "user-agent": "exor-binder showcase (exorgames.com; one set per call)" };

const isFoil = (v) => /foil|holo/i.test(String((v && v.title) || ""));
export function condOf(title) {
  return String(title || "").replace(/\s*\/\s*(english|normal)\b/gi, "").replace(/\s*-?\s*(foil|holo(foil)?)\s*$/i, "").replace(/\s*\/\s*$/, "").trim();
}
const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
const initial = (s) => { const m = String(s).match(/[A-Za-z0-9]/); return m ? m[0].toUpperCase() : "#"; };

// The set names of a game -> boxes of SETS_PER_BOX, alphabetical, labelled by initials.
export function boxesOf(names) {
  const sets = [...new Set(names.map((s) => String(s || "").trim()).filter(Boolean))].sort(byName);
  const boxes = [];
  for (let i = 0; i < sets.length; i += SETS_PER_BOX) {
    const chunk = sets.slice(i, i + SETS_PER_BOX), a = initial(chunk[0]), z = initial(chunk[chunk.length - 1]);
    boxes.push({ n: boxes.length + 1, label: a === z ? a : a + " – " + z, sets: chunk });
  }
  if (boxes.length === 1) boxes[0].label = "A – Z";
  return { sets, boxes };
}

// One feed product -> one compact row, or null when nothing is in stock at a price.
// The card shown is the best non-foil copy in stock, the foil only when that is all.
export function rowOf(p) {
  const title = String((p && p.title) || "").trim();
  const m = title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const name = (m ? m[1] : title).trim();
  if (!name) return null;
  const vs = ((p && p.variants) || []).filter((v) => v && Number(v.price) > 0 && Number(v.quantity) > 0);
  if (!vs.length) return null;
  vs.sort((a, b) => (isFoil(a) - isFoil(b)) || (Number(b.price) - Number(a.price)));
  const v = vs[0];
  const copies = vs.reduce((n, x) => n + Math.max(0, Number(x.quantity) || 0), 0);
  return [name, String(p.handle || ""), Number(v.price).toFixed(2), String(p.img || p.tcgImage || ""), String(v.shopifyId || "").replace(/\D/g, ""), condOf(v.title), isFoil(v) ? 1 : 0, copies];
}
export function rowsOf(products) {
  return products.map(rowOf).filter(Boolean).sort((a, b) => byName(a[0], b[0]) || Number(b[2]) - Number(a[2]));
}

// One page of the feed for a set.
export async function feedPage(game, set, offset, fetcher) {
  const body = { storeUrl: STORE, game, strict: null, sortTypes: [{ type: "number", asc: true, order: 1 }], variants: null, title: "", priceGreaterThan: 0, priceLessThan: null, instockOnly: true, limit: FEED_PAGE, offset, setNames: [set], rarities: [], types: [] };
  const r = await (fetcher || fetch)(FEED_URL, { method: "POST", headers: FEED_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("feed HTTP " + r.status);
  const j = await r.json();
  return { products: Array.isArray(j && j.products) ? j.products : [], count: Number(j && j.count) || 0 };
}
export async function setCards(game, set, fetcher) {
  let products = [], count = 0, offset = 0;
  for (let i = 0; i < 6; i++) {
    const page = await feedPage(game, set, offset, fetcher);
    products = products.concat(page.products); count = page.count;
    offset += FEED_PAGE;
    if (page.products.length < FEED_PAGE || offset >= count || products.length >= FEED_CAP) break;
  }
  return { rows: rowsOf(products), count };
}

export async function serveBoxes(request, env, ctx, url) {
  const game = String(url.searchParams.get("game") || "mtg").toLowerCase();
  const g = BOX_GAMES[game];
  if (!g) return json({ ok: false, error: "no such game" }, 404);
  const cache = caches.default;
  if (url.pathname === "/showcase/set.json") {
    const set = String(url.searchParams.get("set") || "").trim().slice(0, 160);
    if (!set) return json({ ok: false, error: "set required" }, 400);
    const key = new Request(new URL("/showcase/set.json?game=" + game + "&set=" + encodeURIComponent(set), url).toString());
    const hit = await cache.match(key);
    if (hit) return hit;
    let out;
    try { const r = await setCards(g.bp, set); out = { ok: true, game, set, count: r.rows.length, feedCount: r.count, rows: r.rows }; }
    catch (e) { return json({ ok: false, game, set, error: String((e && e.message) || e).slice(0, 160) }, 502); }
    const res = json(out, 200, CACHED(600));
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
  const key = new Request(new URL("/showcase/boxes.json?game=" + game, url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let names;
  try {
    const r = await fetch(SETS_URL(g.bp), { headers: { accept: "application/json", "user-agent": FEED_HEADERS["user-agent"] }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("sets HTTP " + r.status);
    const j = await r.json();
    names = Array.isArray(j) ? j : Array.isArray(j && j.sets) ? j.sets : [];
  } catch (e) { return json({ ok: false, game, label: g.label, boxes: [], sets: [], error: String((e && e.message) || e).slice(0, 160) }, 502); }
  const { sets, boxes } = boxesOf(names.map((x) => (x && typeof x === "object" ? x.name || x.setName : x)));
  if (!sets.length) return json({ ok: false, game, label: g.label, boxes: [], sets: [], error: "no sets" }, 200, CACHED(120));
  const res = json({ ok: true, game, label: g.label, count: sets.length, boxes, sets }, 200, CACHED(3600));
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* A card picked up from a box (or the case): every copy in stock, read live
   from Shopify when the card comes into the hand (owner, 2026-11-04: "show
   the other conditions once you pick the card up, as well as if there is
   foil"). Live, so nothing is ever stale by a day. */
export const CARD_Q = `query($h:String!){productByHandle(handle:$h){title handle variants(first:30){nodes{id title price inventoryQuantity availableForSale}}}}`;
const COND_ORDER = ["near mint", "lightly played", "moderately played", "heavily played", "damaged"];
const condRank = (t) => { const x = String(t || "").toLowerCase(); const i = COND_ORDER.findIndex((c) => x.indexOf(c) === 0); return i < 0 ? 9 : i; };
export function copiesOf(product) {
  const vs = (((product && product.variants) || {}).nodes || []).filter((v) => v && Number(v.price) > 0 && (Number(v.inventoryQuantity) > 0 || v.availableForSale === true));
  const out = vs.map((v) => ({ variantId: String(v.id || "").replace(/\D/g, ""), condition: condOf(v.title), foil: isFoil(v), price: Number(v.price).toFixed(2), qty: Math.max(0, Number(v.inventoryQuantity) || 0) || null }));
  out.sort((a, b) => (a.foil - b.foil) || (condRank(a.condition) - condRank(b.condition)) || (Number(b.price) - Number(a.price)));
  return out;
}
export async function serveCard(request, env, ctx, url) {
  const handle = String(url.searchParams.get("handle") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 200);
  if (!handle) return json({ ok: false, error: "handle required" }, 400);
  if (!env || !env.SHOPIFY_ADMIN_TOKEN) return json({ ok: false, error: "not configured" }, 503);
  const cache = caches.default;
  const key = new Request(new URL("/showcase/card.json?handle=" + handle, url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let out;
  try {
    const r = await adminGql({ env, fetch: (u, o) => fetch(u, o) }, CARD_Q, { h: handle });
    const p = r.data && r.data.productByHandle;
    out = p ? { ok: true, handle, title: p.title, copies: copiesOf(p) } : { ok: false, handle, error: "no such card" };
  } catch (e) { out = { ok: false, handle, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? CACHED(120) : NO_STORE);
  if (out.ok && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ---------------- New sealed booster boxes on the back wall ----------------
   Owner, 2026-11-09: "put boxes of instock newest sealed booster boxes on the
   back wall too" (the 3D shop). GET /showcase/sealed.json?game= answers the
   game's newest booster boxes that are in stock, read from Shopify and cached
   ten minutes. A pre-order still to come is not in stock, whatever its
   inventory says; one whose date has passed is (the title keeps the words
   for a while after release day). */
export const SEALED_TYPES = {
  mtg: "Magic Sealed Product", pokemon: "Pokemon Sealed Product", yugioh: "YU-GI-OH Sealed Product",
  onepiece: "One Piece Card Game Sealed Product", starwars: "Star Wars Unlimited Sealed Product", riftbound: "Riftbound Sealed Product",
};
export const SEALED_MAX = 8;
export const SEALED_Q = `query($q:String!){products(first:60,sortKey:CREATED_AT,reverse:true,query:$q){nodes{title handle createdAt media(first:1){nodes{preview{image{url width height}}}} variants(first:3){nodes{id price inventoryQuantity availableForSale}}}}}`;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "… PRE ORDER ^ NOV 20/26" -> that day (UTC); null when the title names no pre-order; NaN when it does without a date we can read
export function preorderDate(title) {
  const m = /PRE[\s-]?ORDER/i.exec(String(title || "")); if (!m) return null;
  const d = /([A-Z]{3})[A-Z]*\.?\s+(\d{1,2})\s*\/\s*(\d{2,4})/i.exec(String(title).slice(m.index));
  if (!d || MONTHS[d[1].toLowerCase()] == null) return NaN;
  return Date.UTC(+d[3] < 100 ? 2000 + +d[3] : +d[3], MONTHS[d[1].toLowerCase()], +d[2]);
}
export const sealedName = (title) => String(title || "").replace(/\s*PRE[\s-]?ORDER.*$/i, "").replace(/\s*\(LIMIT\s*\d+\)/i, "").replace(/\s+/g, " ").trim();
// rows, newest first: { name, handle, price, image, ar (picture width / height), variantId, qty, added }
export function sealedOf(products, now) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || "");
    if (!/\bBOOSTER\s+BOX\b/i.test(title) || /\bCASE\b/i.test(title)) continue;
    const pre = preorderDate(title);
    if (pre !== null && !(pre <= now)) continue;
    const v = ((p.variants && p.variants.nodes) || []).find((x) => x && +x.inventoryQuantity > 0 && +x.price > 0 && x.availableForSale !== false);
    if (!v) continue;
    const im = (((p.media && p.media.nodes) || [])[0] || {}).preview; const pic = im && im.image;
    out.push({
      name: sealedName(title), handle: String(p.handle || ""), price: String(v.price), image: (pic && pic.url) || null,
      ar: pic && pic.width > 0 && pic.height > 0 ? Math.round((pic.width / pic.height) * 100) / 100 : 1,
      variantId: String(v.id || "").replace(/^.*\//, "") || null, qty: +v.inventoryQuantity, added: String(p.createdAt || "").slice(0, 10),
    });
    if (out.length >= SEALED_MAX) break;
  }
  return out;
}
export async function serveSealed(request, env, ctx, url, opts) {
  const o = opts || {};
  const game = String(url.searchParams.get("game") || "mtg").toLowerCase();
  const type = SEALED_TYPES[game];
  if (!type) return json({ ok: true, game, rows: [] }, 200, CACHED(600));
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  const cache = o.gqlFn ? null : caches.default;
  const key = new Request(new URL("/showcase/sealed.json?game=" + game, url).toString());
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out;
  try {
    const q = 'status:active AND published_status:published AND inventory_total:>0 AND product_type:"' + type + '" AND title:*BOOSTER*';
    const r = o.gqlFn ? await o.gqlFn(SEALED_Q, { q }) : await adminGql({ env, fetch: (u, i) => fetch(u, i) }, SEALED_Q, { q });
    out = { ok: true, game, rows: sealedOf(r.data && r.data.products && r.data.products.nodes, o.now || Date.now()) };
  } catch (e) { out = { ok: false, game, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? CACHED(600) : NO_STORE);
  if (out.ok && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ---------------- Warhammer boxes on the hobby rack ----------------
   Owner, 2026-11-09: "a rack with boxes of Warhammer product" (the 3D shop's
   hobby corner, beside the paint racks). GET /showcase/wargames.json answers
   the newest Games Workshop kits in stock: boxes of miniatures, so not the
   novels, dice, card packs, journals and rulebooks that share the product
   type. Same row shape as sealed.json; cached ten minutes. */
export const WARGAMES_MAX = 12;
const NOT_A_KIT = /\b(HARDBACK|PAPERBACK|SOFTBACK|NOVEL|DICE|CARD PACK|CARDS|JOURNAL|CODEX|BATTLETOME|RULEBOOK|RULES|WHITE DWARF|MAGAZINE|TOKENS?|TEMPLATES?|PAINT|BRUSH|SPRAY)\b/i;
export function wargamesOf(products, now) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || "");
    if (!title || NOT_A_KIT.test(title)) continue;
    const pre = preorderDate(title);
    if (pre !== null && !(pre <= now)) continue;
    const v = ((p.variants && p.variants.nodes) || []).find((x) => x && +x.inventoryQuantity > 0 && +x.price > 0 && x.availableForSale !== false);
    const im = (((p.media && p.media.nodes) || [])[0] || {}).preview; const pic = im && im.image;
    if (!v || !pic || !pic.url) continue;                  // a rack of boxes needs the box picture
    out.push({
      name: sealedName(title), handle: String(p.handle || ""), price: String(v.price), image: pic.url,
      ar: pic.width > 0 && pic.height > 0 ? Math.round((pic.width / pic.height) * 100) / 100 : 1,
      variantId: String(v.id || "").replace(/^.*\//, "") || null, qty: +v.inventoryQuantity, added: String(p.createdAt || "").slice(0, 10),
    });
    if (out.length >= WARGAMES_MAX) break;
  }
  return out;
}
export async function serveWargames(request, env, ctx, url, opts) {
  const o = opts || {};
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  const cache = o.gqlFn ? null : caches.default;
  const key = new Request(new URL("/showcase/wargames.json", url).toString());
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out;
  try {
    const q = 'status:active AND published_status:published AND inventory_total:>0 AND vendor:"Games Workshop" AND product_type:"Tabletop Wargames"';
    const r = o.gqlFn ? await o.gqlFn(SEALED_Q, { q }) : await adminGql({ env, fetch: (u, i) => fetch(u, i) }, SEALED_Q, { q });
    out = { ok: true, rows: wargamesOf(r.data && r.data.products && r.data.products.nodes, o.now || Date.now()) };
  } catch (e) { out = { ok: false, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? CACHED(600) : NO_STORE);
  if (out.ok && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ---------------- Gunpla, model kits and blind boxes on the 3D shop's right wall ----------------
   Owner, 2026-11-10 (the right wall circled): "Here can we put gunpla rack, models rack and another
   rack with blind boxes". GET /showcase/shelf.json?kind=gunpla|models|blind answers the newest
   products of that type in stock, with a picture; same row shape as sealed.json and wargames.json;
   cached ten minutes. */
export const SHELF_KINDS = {
  gunpla: 'product_type:"Gunpla"',
  models: 'product_type:"Plastic Model Kit"',
  blind: 'product_type:"Blind Box"',
};
export const SHELF_MAX = 12;
export function shelfOf(products, now) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || ""); if (!title) continue;
    const pre = preorderDate(title);
    if (pre !== null && !(pre <= now)) continue;
    const v = ((p.variants && p.variants.nodes) || []).find((x) => x && +x.inventoryQuantity > 0 && +x.price > 0 && x.availableForSale !== false);
    const im = (((p.media && p.media.nodes) || [])[0] || {}).preview; const pic = im && im.image;
    if (!v || !pic || !pic.url) continue;
    out.push({
      name: sealedName(title), handle: String(p.handle || ""), price: String(v.price), image: pic.url,
      ar: pic.width > 0 && pic.height > 0 ? Math.round((pic.width / pic.height) * 100) / 100 : 1,
      variantId: String(v.id || "").replace(/^.*\//, "") || null, qty: +v.inventoryQuantity, added: String(p.createdAt || "").slice(0, 10),
    });
    if (out.length >= SHELF_MAX) break;
  }
  return out;
}
export async function serveShelf(request, env, ctx, url, opts) {
  const o = opts || {};
  const kind = String(url.searchParams.get("kind") || "").toLowerCase();
  const type = SHELF_KINDS[kind];
  if (!type) return json({ ok: false, error: "kind must be one of " + Object.keys(SHELF_KINDS).join(", ") }, 400);
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  const cache = o.gqlFn ? null : caches.default;
  const key = new Request(new URL("/showcase/shelf.json?kind=" + kind, url).toString());
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out;
  try {
    const q = "status:active AND published_status:published AND inventory_total:>0 AND " + type;
    const r = o.gqlFn ? await o.gqlFn(SEALED_Q, { q }) : await adminGql({ env, fetch: (u, i) => fetch(u, i) }, SEALED_Q, { q });
    out = { ok: true, kind, rows: shelfOf(r.data && r.data.products && r.data.products.nodes, o.now || Date.now()) };
  } catch (e) { out = { ok: false, kind, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? CACHED(600) : NO_STORE);
  if (out.ok && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
