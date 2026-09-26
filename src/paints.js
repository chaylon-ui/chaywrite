/* Paint colour picker data (owner, 2026-09-25: "Vallejo colour picker this is good" ->
   "can color picker help with the army painter, warhammer paints, etc" -> "Sure").

   GET /paints.json - every paint we sell from Vallejo, Citadel and The Army Painter,
   matched to a colour chart and grouped one swatch per colour:
     { generated, brands: [...], swatches: [{ b: brand, n: name, h: "#RRGGBB" | null,
         items: [{ r: range, c: code, t: title, u: handle, i: image, p: price, a: in stock,
                   v: variant id, s: "17 ml" }] }] }
   The chart is data/paint-colours.json on chaywrite main (tools/paint-colours.py).
   Products come from the brands' collections through the Admin API; only products on the
   online store are listed. Built on a miss and held at the edge for 15 minutes. Paints the
   chart does not know keep a swatch (h null - the page shows the bottle photo); sets,
   mediums, varnishes and tools are left out. */

export const PAINT_COLOURS_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/paint-colours.json";
const CACHE_KEY = "https://cache.internal/paints.json?v=3";

export const PAINT_BRANDS = [
  // GW's 2026 "Warhammer Colour" pots (same paints, new label) and a few unprefixed
  // six-packs sit outside the Citadel collection: the search picks them up
  { brand: "Citadel", collection: "citadel-collection",
    search: "status:active AND vendor:'Games Workshop' AND (product_type:Paint OR title:WARHAMMER\\ COLOUR*)" },
  { brand: "The Army Painter", collection: "all-the-army-painter" },
  { brand: "Vallejo", collection: "all-vallejo" },
];

const NODE = "handle title status onlineStoreUrl featuredImage{url} variants(first:10){nodes{legacyResourceId price availableForSale}}";
const PRODUCTS_Q = `query($h:String!,$after:String){collectionByHandle(handle:$h){products(first:250,after:$after){pageInfo{hasNextPage endCursor}nodes{${NODE}}}}}`;
const SEARCH_Q = `query($q:String!,$after:String){products(first:250,query:$q,after:$after){pageInfo{hasNextPage endCursor}nodes{${NODE}}}}`;

export const NOT_PAINT = /\bset\b|\bsets\b|varnish|medium|softener|thinner|cleaner|retarder|flow improver|\bkit\b|\bcase\b|\bpack\b|brush|stencil|putty|glue|\bpaste\b|\bbase[sd]?\s*\(|\bbases\b|palette|\bmat\b|tuft|\btools?\b|hobby knife|tweezers|cutters?|\bfile\b|drybrush/i;

export const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sizeOf = (t) => { const m = /\b(\d+)\s*ML\b/i.exec(t); return m ? m[1] + " ml" : ""; };
// "(18ML)", "17 ML", and the till's truncated six-pack tails: "(18ML) 6-PA", "(6 P", "(6PA"
const stripSize = (s) => String(s).replace(/(?:\s|\()6\s*-?\s*PA?C?K?\b.*$/i, "").replace(/\(?\b\d+\s*ML\b\)?/ig, "").replace(/'S\b/ig, "").replace(/\s+/g, " ").trim();

const VALLEJO_RANGES = ["Game Color", "Game Air", "Model Color", "Model Air", "Mecha Color", "Xpress Color Intense", "Xpress Color", "Panzer Aces", "Metal Color", "Surface Primer", "Wash FX", "Weathering FX"];
const CITADEL_RANGES = ["Base", "Layer", "Shade", "Contrast", "Dry", "Technical", "Air", "Spray", "Glaze"];
const CITADEL_LOOSE = ["Base", "Layer", "Shade", "Contrast", "Technical", "Dry", "Glaze"];

/* Brand-specific reading of a product title -> { range, name } or null. */
export function parseTitle(brand, title) {
  const t = String(title || "");
  if (brand === "Vallejo") {
    const rest0 = t.replace(/^\s*vallejo\s*:?\s*/i, "");
    for (const r of VALLEJO_RANGES) {
      if (rest0.toUpperCase().indexOf(r.toUpperCase() + " ") !== 0) continue;
      const name = stripSize(rest0.slice(r.length).replace(/^\s*-\s*/, ""));
      // "GAME AIR PRIMER BLACK", "GAME COLOR WHITE PRIMER" are Surface Primers
      if (/^primer\s+|\s+primer$/i.test(name)) return { range: "Surface Primer", name: name.replace(/^primer\s+|\s+primer$/i, "") };
      return { range: r, name };
    }
    return null;
  }
  if (brand === "Citadel") {
    const m = /^\s*(?:citadel\s*(?:colou?r)?\s*[:\-]?\s*)?(base|layer|shade|contrast|dry|technical|air|spray|glaze)\s*(?:paint)?\s*[:\-]\s*(.+)$/i.exec(t)
      // "WARHAMMER COLOUR LAYER EVIL SUNZ SCARLET 12ML" - the 2026 label, colon optional
      || /^\s*warhammer\s+colou?r\s*[:\-]?\s*(base|layer|shade|contrast|dry|technical|air|spray|glaze)\b\s*[:\-]?\s*(.+)$/i.exec(t);
    if (!m) {
      // no range on the label ("WARHAMMER COLOUR MEPHISTON RED 12ML", "MEPHISTON RED 12ML (6-PACK)",
      // "CITADEL MEPHISTON RED SPRAY"): range null, buildSwatches keeps it only when the chart knows the name
      const spray = /\bspray\s*$/i.test(t);
      const name = stripSize(t.replace(/^\s*(?:warhammer\s+colou?r|citadel(?:\s+colou?r)?)\s*[:\-]?\s*/i, "").replace(/\bspray\s*$/i, ""));
      return name && !/[:]/.test(name) ? { range: spray ? "Spray" : null, name, loose: true } : null;
    }
    // "LAYER: LAYER:SKULLCRUSHER BRASS" repeats the range
    return { range: titleCase(m[1]), name: stripSize(m[2].replace(new RegExp("^\\s*" + m[1] + "\\s*:\\s*", "i"), "")) };
  }
  if (brand === "The Army Painter") {
    const u = t.toUpperCase();
    let range = "Warpaints";
    if (/SPEEDPAINT/.test(u)) range = /MARKER/.test(u) ? "Speedpaint Marker" : "Speedpaint";
    else if (/\bAIR\b/.test(u)) range = "Warpaints Air";
    else if (/FANATIC/.test(u)) range = /WASH/.test(u) ? "Warpaints Fanatic Wash" : "Warpaints Fanatic";
    else if (/PRIMER/.test(u)) range = "Warpaints Primer";
    else if (/QUICKSHADE/.test(u)) range = "Quickshade Washes Set";
    const after = t.indexOf(":") > -1 ? t.slice(t.lastIndexOf(":") + 1) : t.replace(/^\s*(the\s+army\s+painter\s*)?(warpaints?\s*)?/i, "");
    const name = stripSize(after.replace(/\b(the army painter|warpaints?|fanatic|speedpaint\s*(2\.0)?|acrylic|air|paint|marker|spray|colou?r primer)\b/ig, " "));
    if (!name) return null;
    return { range, name };
  }
  return null;
}

/* Find a title's colour in the brand's chart: its own range first, then the brand's other ranges. */
export function findColour(chart, brand, range, name, only) {
  const b = chart && chart[brand];
  if (!b) return null;
  const k0 = key(name);
  const keys = [k0, k0.replace(/scarlett/, "scarlet"), k0.replace(/(glaze|ink)$/, ""), k0.replace(/tone$/, ""), k0.replace(/flesh$/, "fleshtone"),
    k0.replace(/gray/g, "grey"), k0.replace(/grn$/, "green"), k0.replace(/fluo(?!rescent)/, "fluorescent"),
    k0.replace(/^(extraopaque|effects)/, ""), k0.replace(/metalmetal$/, "metal")].filter(Boolean);
  const sets = [range];
  if (only) sets.length = 1;
  else if (brand === "Vallejo") sets.push(range === "Game Air" ? "Game Color" : range === "Game Color" ? "Game Air" : "");
  if (!only) sets.push(...Object.keys(b));
  for (const s of sets) {
    const set = s && b[s];
    if (!set) continue;
    for (const k of keys) if (set[k]) return { code: set[k][0], hex: set[k][1], name: set[k][2] };
  }
  return null;
}

/* Products (Admin API rows) + chart -> swatches. Pure, for tests. */
export function buildSwatches(chart, byBrand) {
  const groups = new Map();
  const counts = {};
  for (const { brand, products } of byBrand) {
    const c = counts[brand] = { products: 0, matched: 0, photo: 0, skipped: 0 };
    for (const p of products) {
      if (!p || p.status !== "ACTIVE" || !p.onlineStoreUrl) continue;
      c.products++;
      const parsed = parseTitle(brand, p.title);
      if (!parsed) { c.skipped++; continue; }
      if (/\bmedium\b|varnish/i.test(parsed.name)) { c.skipped++; continue; }
      let col = null;
      if (parsed.loose) {
        // a label without its range: the chart says which one, in the order a painter means it
        for (const r of parsed.range ? [parsed.range] : CITADEL_LOOSE) {
          col = findColour(chart, brand, r, parsed.name, true);
          if (col) { parsed.range = r; break; }
        }
        if (!col) { c.skipped++; continue; }
      } else col = findColour(chart, brand, parsed.range, parsed.name);
      if (!col && NOT_PAINT.test(p.title)) { c.skipped++; continue; }
      const vs = (p.variants && p.variants.nodes) || [];
      const v = vs.find((x) => x.availableForSale) || vs[0];
      if (!v) { c.skipped++; continue; }
      col ? c.matched++ : c.photo++;
      const name = col ? col.name : titleCase(parsed.name);
      const gk = brand + "|" + (col ? key(name) : "p:" + p.handle);
      let g = groups.get(gk);
      if (!g) { g = { b: brand, n: name, h: col ? "#" + col.hex : null, items: [] }; groups.set(gk, g); }
      g.items.push({
        r: parsed.range, c: col ? col.code : "", t: p.title, u: p.handle,
        i: p.featuredImage ? p.featuredImage.url : null, p: v.price,
        a: vs.some((x) => x.availableForSale), v: Number(v.legacyResourceId), s: sizeOf(p.title),
      });
    }
  }
  return { counts, swatches: [...groups.values()] };
}

async function fetchSearch(gql, q) {
  const out = [];
  let after = null;
  for (let i = 0; i < 8; i++) {
    const d = await gql(SEARCH_Q, { q, after });
    const c = d && d.products;
    if (!c) break;
    out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return out;
}

async function fetchCollection(gql, handle) {
  const out = [];
  let after = null;
  for (let i = 0; i < 12; i++) {
    const d = await gql(PRODUCTS_Q, { h: handle, after });
    const c = d && d.collectionByHandle;
    if (!c) break;
    out.push(...c.products.nodes);
    if (!c.products.pageInfo.hasNextPage) break;
    after = c.products.pageInfo.endCursor;
  }
  return out;
}

/* Stale-while-revalidate (owner, 2026-09-26: the picker "taking a long time for it to load"):
   a rebuild reads every paint collection from the Admin API and takes seconds, so the answer is
   kept twice - FRESH for 15 minutes, a KEEP copy for 2 days. A request inside 15 minutes gets
   the fresh copy; after that it gets the kept copy AT ONCE and the rebuild runs in the
   background; only a colo that has never built one waits for a build. */
const FRESH_S = 900, KEEP_S = 172800;
const KEEP_KEY = CACHE_KEY + "&keep=1";

async function buildPaints(gql) {
  const cr = await fetch(PAINT_COLOURS_URL, { headers: { accept: "application/json" } });
  if (!cr.ok) throw new Error("paint colours HTTP " + cr.status);
  const chart = (await cr.json()).brands;
  const byBrand = [];
  for (const b of PAINT_BRANDS) {
    const products = await fetchCollection(gql, b.collection);
    if (b.search) {
      const seen = new Set(products.map((p) => p.handle));
      for (const p of await fetchSearch(gql, b.search)) if (p && !seen.has(p.handle)) { seen.add(p.handle); products.push(p); }
    }
    byBrand.push({ brand: b.brand, products });
  }
  const res = buildSwatches(chart, byBrand);
  return { ok: true, generated: new Date().toISOString(), brands: PAINT_BRANDS.map((b) => b.brand), counts: res.counts, swatches: res.swatches };
}

const jsonRes = (text, maxAge, extra) => new Response(text, {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=" + maxAge, ...(extra || {}) },
});

async function rebuildInto(cache, gql) {
  const text = JSON.stringify(await buildPaints(gql));
  await Promise.all([cache.put(CACHE_KEY, jsonRes(text, FRESH_S)), cache.put(KEEP_KEY, jsonRes(text, KEEP_S))]);
  return text;
}

export async function servePaints(request, env, ctx, gql) {
  const cache = caches.default;
  const hit = await cache.match(CACHE_KEY);
  if (hit) return hit;
  const kept = await cache.match(KEEP_KEY);
  if (kept) {
    ctx.waitUntil(rebuildInto(cache, gql).catch(() => null));
    const text = await kept.text();
    return jsonRes(text, 300, { "x-xg-paints": "kept" });
  }
  try {
    return jsonRes(await rebuildInto(cache, gql), FRESH_S);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 200) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  }
}
