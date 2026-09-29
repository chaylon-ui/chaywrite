/* GET /cards/search.json - our own singles search (owner, 2026-09-29, from a customer:
   "a 'Sort by' for 'Card Number' in the card search" and "when you search a Set and also a
   card name it adds both rather than combines both as a filter"; the xCloud Search & Filter
   app answers its two boxes as one OR search and its maker cannot change that).

   Params
     game   mtg | pokemon | yugioh | lorcana | onepiece | fab | swu | riftbound | dbs
     set    words of the set name ("reality fracture", "fracture", or a set code "FRA")
     name   words of the card name ("charm")
     rarity exact rarity tag ("Uncommon"), optional
     stock  1 = in stock only (default), 0 = everything
     sort   number (default) | name | price | price-desc | newest
     page   1-based, 24 a page

   How: one Admin search narrows by product type and by every word (name words in the
   title; set words in the title or a tag), then each hit is checked EXACTLY: the name
   words must all be in the card name (the title before "["), the set words must all be in
   the set (the title's [bracket] or a tag - Yu-Gi-Oh keeps its set name only in tags,
   the bracket holds the code) - so "charm" + "reality fracture" is the three Reality
   Fracture Charms, not every Charm.

   Card number: the second part of the BinderPOS SKU (FRA-155-EN-NF-1 -> 155,
   DUPO-EN008-EN-UL-1 -> EN008, TFC-206/204-ENC-... -> 206/204), sorted numerically on its
   digits (16 before 155), then by its letters. Cards without one sort last.

   Answer: { ok, total, page, pages, results: [{ handle, title, name, set, number, code,
   rarity, img, price, stock, created }], facets: { sets: [{name, n}], rarities: [...] } }
   Facets count the whole filtered result, before paging. Edge-cached 10 minutes per query. */

export const GAMES = {
  mtg: { type: "MTG Single", label: "Magic: The Gathering" },
  pokemon: { type: "Pokemon Single", label: "Pokémon" },
  yugioh: { type: "Yugioh Single", label: "Yu-Gi-Oh!" },
  lorcana: { type: "Lorcana Single", label: "Disney Lorcana" },
  onepiece: { type: "One Piece Single", label: "One Piece" },
  fab: { type: "Flesh And Blood Single", label: "Flesh and Blood" },
  swu: { type: "Star Wars: Unlimited Single", label: "Star Wars: Unlimited" },
  riftbound: { type: "Riftbound TCG Singles", label: "Riftbound" },
  dbs: { type: "Dragon Ball Super Single", label: "Dragon Ball Super" },
};

const CS_V = "1";
const TTL_S = 600;
const PER = 24;
const MAX_PAGES = 12;           // 12 x 250 = 3000 candidates at most per query
const RARITIES = /^(common|uncommon|rare|mythic|mythic rare|special|promo|token|legendary|enchanted|epic|super rare|secret rare|ultra rare|ultimate rare|ghost rare|starlight rare|collector's rare|quarter century secret rare|prismatic secret rare|double rare|illustration rare|special illustration rare|hyper rare|holo rare|rare holo|ace spec rare|shiny rare|shiny ultra rare|amazing rare|radiant rare|leader|majestic|marvel|fabled|super|short print)$/i;

const Q = `query($q:String!,$after:String){products(first:250,query:$q,after:$after){pageInfo{hasNextPage endCursor}nodes{handle title tags createdAt totalInventory featuredImage{url} priceRangeV2{minVariantPrice{amount}} variants(first:1){nodes{sku}}}}}`;

export const norm = (s) => String(s || "").toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9/]+/g, " ").trim();
export const words = (s) => norm(s).split(" ").filter((w) => w.length >= 1);
// Admin search wants no quotes / colons / wildcards of the shopper's own inside a term
const term = (w) => w.replace(/[^a-z0-9]/g, "");

export function splitTitle(title) {
  const t = String(title || "");
  const i = t.indexOf("[");
  const name = (i > -1 ? t.slice(0, i) : t).trim();
  const set = i > -1 ? (t.slice(i + 1).split("]")[0] || "").trim() : "";
  return { name, set };
}

export function numberOf(sku) {
  const parts = String(sku || "").split("-");
  if (parts.length < 3) return { code: "", number: "" };
  return { code: parts[0], number: parts[1] };
}

// "155" -> [155, ""], "EN008" -> [8, "EN"], "206/204" -> [206, "/204"], "S12a" -> [12, "Sa"]
export function numberKey(n) {
  const s = String(n || "");
  const m = s.match(/(\d+)/);
  if (!m) return [Infinity, s];
  return [Number(m[1]), s.replace(m[1], "")];
}

export function buildQuery(game, setW, nameW, stock, rarity) {
  const g = GAMES[game];
  const parts = [`product_type:'${g.type.replace(/'/g, "\\'")}'`, "status:active"];
  if (stock) parts.push("inventory_total:>0");
  for (const w of nameW) { const t = term(w); if (t.length >= 2) parts.push(`title:*${t}*`); }
  for (const w of setW) { const t = term(w); if (t.length >= 2) parts.push(`(title:*${t}*${/^[a-z]/.test(t) ? ` OR tag:*${t}*` : ""})`); }
  if (rarity) parts.push(`tag:'${String(rarity).replace(/'/g, "\\'")}'`);
  return parts.join(" AND ");
}

export function matches(p, setW, nameW, rarity) {
  const { name, set } = splitTitle(p.title);
  const n = " " + norm(name) + " ";
  if (nameW.some((w) => n.indexOf(w) === -1)) return false;
  if (setW.length) {
    const sku = numberOf(p.variants && p.variants.nodes && p.variants.nodes[0] && p.variants.nodes[0].sku);
    const hay = [norm(set), ...(p.tags || []).map(norm), norm(sku.code)];
    // every set word inside ONE place (the bracket, a single tag or the set code)
    if (!hay.some((h) => setW.every((w) => h.indexOf(w) > -1))) return false;
  }
  if (rarity && !(p.tags || []).some((t) => t.toLowerCase() === String(rarity).toLowerCase())) return false;
  return true;
}

export function shape(p) {
  const { name, set } = splitTitle(p.title);
  const sku = numberOf(p.variants && p.variants.nodes && p.variants.nodes[0] && p.variants.nodes[0].sku);
  const tags = p.tags || [];
  const rarity = tags.find((t) => RARITIES.test(t)) || "";
  // Yu-Gi-Oh brackets hold the card code ("DUPO-EN008"): its set is the code's prefix
  const setName = /^[A-Z0-9]{2,6}-[A-Z]{0,3}\d+[A-Z]?$/.test(set) ? set.split("-")[0] : set;
  return {
    handle: p.handle, title: p.title, name, set: setName, number: sku.number, code: sku.code, rarity,
    img: (p.featuredImage && p.featuredImage.url) || null,
    price: p.priceRangeV2 && p.priceRangeV2.minVariantPrice ? Number(p.priceRangeV2.minVariantPrice.amount).toFixed(2) : null,
    stock: Math.max(0, Number(p.totalInventory) || 0), created: p.createdAt,
  };
}

export function sortRows(rows, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name) || a.set.localeCompare(b.set);
  const byNum = (a, b) => {
    const x = numberKey(a.number), y = numberKey(b.number);
    return a.set.localeCompare(b.set) || (x[0] - y[0]) || x[1].localeCompare(y[1]) || byName(a, b);
  };
  const cmp = {
    number: byNum,
    name: byName,
    price: (a, b) => (Number(a.price) || 0) - (Number(b.price) || 0) || byName(a, b),
    "price-desc": (a, b) => (Number(b.price) || 0) - (Number(a.price) || 0) || byName(a, b),
    newest: (a, b) => String(b.created).localeCompare(String(a.created)) || byName(a, b),
  }[sort] || byNum;
  return rows.slice().sort(cmp);
}

export function facets(rows) {
  const sets = new Map(), rar = new Map();
  for (const r of rows) {
    if (r.set) sets.set(r.set, (sets.get(r.set) || 0) + 1);
    if (r.rarity) rar.set(r.rarity, (rar.get(r.rarity) || 0) + 1);
  }
  const list = (m) => [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { sets: list(sets).slice(0, 40), rarities: list(rar) };
}

export async function serveCardSearch(request, env, ctx, gql) {
  const url = new URL(request.url);
  const cors = { "access-control-allow-origin": "*" };
  const game = GAMES[String(url.searchParams.get("game") || "mtg").toLowerCase()] ? String(url.searchParams.get("game") || "mtg").toLowerCase() : "mtg";
  const setW = words(url.searchParams.get("set")).slice(0, 6);
  const nameW = words(url.searchParams.get("name")).slice(0, 6);
  const rarity = String(url.searchParams.get("rarity") || "").slice(0, 40);
  const stock = url.searchParams.get("stock") !== "0";
  const sort = String(url.searchParams.get("sort") || "number");
  const page = Math.max(1, Math.min(200, parseInt(url.searchParams.get("page") || "1", 10) || 1));
  if (!setW.length && !nameW.length) return Response.json({ ok: false, error: "type a set or a card name" }, { status: 400, headers: cors });

  const cache = caches.default;
  const key = new Request("https://cache.internal/cards/search?v=" + CS_V + "&g=" + game + "&s=" + encodeURIComponent(setW.join(" ")) + "&n=" + encodeURIComponent(nameW.join(" ")) + "&r=" + encodeURIComponent(rarity.toLowerCase()) + "&k=" + (stock ? 1 : 0));
  let all = null;
  const hit = await cache.match(key);
  if (hit) { try { all = await hit.json(); } catch { all = null; } }
  if (!all) {
    const q = buildQuery(game, setW, nameW, stock, rarity);
    const rows = [];
    let after = null, capped = false;
    try {
      for (let i = 0; i < MAX_PAGES; i++) {
        const d = await gql(Q, { q, after });
        const c = d && d.products;
        if (!c) break;
        for (const p of c.nodes) if (matches(p, setW, nameW, rarity)) rows.push(shape(p));
        if (!c.pageInfo.hasNextPage) break;
        after = c.pageInfo.endCursor;
        if (i === MAX_PAGES - 1) capped = true;
      }
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message || e).slice(0, 140) }, { status: 502, headers: { ...cors, "cache-control": "no-store" } });
    }
    all = { rows, capped, at: new Date().toISOString() };
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(all), { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + TTL_S } })));
  }
  const sorted = sortRows(all.rows, sort);
  const pages = Math.max(1, Math.ceil(sorted.length / PER));
  const p = Math.min(page, pages);
  return Response.json({
    ok: true, game, total: sorted.length, capped: !!all.capped, page: p, pages, sort,
    results: sorted.slice((p - 1) * PER, p * PER), facets: facets(all.rows),
  }, { headers: { ...cors, "cache-control": "public, max-age=120" } });
}
