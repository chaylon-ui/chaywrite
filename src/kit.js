/* GET /kit.json?for=wh|gunpla|sleeves - the in-stock add-ons a product page offers
   next to what the shopper is looking at (owner, 2026-09-29: "do number 1 [Complete
   the kit] ... gunpla what the grades mean, show upsell products and things like the
   liner markers ... Do the board game sleeves suggestions").

   wh      Warhammer / wargame boxes: clippers, plastic glue, primer spray, a brush.
   gunpla  Gunpla kits: nippers, Gundam markers / panel liners, top coat, sanding.
   sleeves Board-game sleeves we stock, each with the card size it fits and the
           pack count, for the theme to match against a game's card sizes
           (exor.sleeves) - see fitSleeves().

   Picked live from our own catalogue (Admin search, in stock and on the Online Store
   only), so a tool that sells out simply stops being offered. Every category returns
   up to MAX picks, best first: a preferred brand / wording, then the most stock.
   Edge-cached for 30 minutes per list. */

const KIT_V = "1";
const TTL_S = 1800;
const MAX = 4;

const NODE = "handle title productType vendor totalInventory onlineStoreUrl featuredImage{url} variants(first:5){nodes{legacyResourceId price availableForSale}}";
const SEARCH_Q = `query($q:String!){products(first:100,query:$q,sortKey:INVENTORY_TOTAL,reverse:true){nodes{${NODE}}}}`;

const BASE_Q = "status:active AND inventory_total:>0 AND -product_type:*Single*";

/* q: the Admin search (wide); re / not: the title test that decides; prefer: ranks
   first. why: the one line the page shows under the name. */
export const RULES = {
  wh: [
    { key: "clippers", label: "Clippers", why: "Cut the parts off the frame cleanly.",
      q: "title:*clipper* OR title:*cutter* OR title:*nipper*",
      re: /clipper|cutter|nipper/i, not: /\bmat\b|glass|knife|blade|refill|replacement/i, prefer: /citadel|army painter|plastic/i },
    { key: "glue", label: "Plastic glue", why: "Welds the plastic parts together.",
      q: "title:*glue* OR title:*cement*",
      re: /plastic glue|plastic cement|thin cement|quick cement/i, not: /refill|250 ?ml|basing|super|cyano|magnet|crystal|applicator/i, prefer: /citadel|army painter/i },
    { key: "primer", label: "Primer spray", why: "One undercoat so the paint grips.",
      q: "title:*primer* OR title:*spray*",
      re: /spray|aerosol/i, also: /primer|chaos black|wraithbone|grey seer|corax white|leadbelcher|retributor|mechanicus standard grey|zandri dust|macragge blue|mephiston red|death guard green/i,
      not: /air primer|\b17 ?ml\b|varnish|purity seal|munitorum|ltd|limited/i, prefer: /chaos black|matte black|black|grey seer|wraithbone|grey|gray|white/i },
    { key: "brush", label: "Brush", why: "A good all-round brush to start with.",
      q: "title:*brush*",
      re: /brush/i, not: /\bset\b|kit|mega|terrain|drybrush|\bxl\b|airbrush|cleaner|soap|holder|rack/i, prefer: /regiment|detail|base|layer|highlighting/i },
  ],
  gunpla: [
    { key: "nippers", label: "Nippers", why: "Snip parts off the runner without stress marks.",
      q: "title:*nipper*",
      re: /nipper/i, not: /cap|case|replacement|blade/i, prefer: /entry|basic|easy|bandai|mr/i },
    { key: "markers", label: "Gundam markers & panel liners", why: "Line the panel gaps so the detail pops.",
      q: "title:*marker* OR title:*panel lin* OR title:*liner*",
      re: /marker|panel lin|liner|real touch/i, not: /eraser|remover|decal|board|dry erase|whiteboard/i, prefer: /gundam marker|panel lin|real touch/i },
    { key: "topcoat", label: "Top coat", why: "A clear matte or gloss finish that hides the plastic shine.",
      q: "title:*top coat* OR title:*topcoat* OR title:*clear* OR title:*varnish*",
      re: /top ?coat|super clear|flat clear|premium top|varnish/i, not: /brush-on|\b17 ?ml\b|glue|sleeve|stand|base/i, prefer: /top ?coat|mr\.? ?super clear/i },
    { key: "sanding", label: "Sanding sticks & files", why: "Smooth off the nub marks after cutting.",
      q: "title:*sanding* OR title:*file* OR title:*sponge*",
      re: /sanding|\bfiles?\b|sponge|polish/i, not: /folder|binder|profile|sleeve|deck/i, prefer: /sanding|godhand|mr/i },
  ],
};

/* Board-game sleeves: the CARD size each product fits (w x h mm; the smaller side
   first) and its count. Brands name board-game sleeves by the card they take;
   Ultra Pro prints the size in the title. Titles we cannot size are left out. */
const DS_BG = [
  [/american mini/i, 41, 63], [/european mini/i, 44, 68], [/american standard/i, 57.5, 89],
  [/european standard/i, 59, 92], [/common standard/i, 63.5, 88], [/extra large/i, 65, 100],
  [/square/i, 70, 70], [/tarot/i, 70, 120], [/oversize/i, 80, 120],
];
const AT_BG = [
  [/\bmini\b/i, 41, 63], [/\bsmall\b/i, 44, 68], [/\bmedium\b/i, 57.5, 89], [/\blarge\b/i, 59, 92],
  [/\bstand/i, 63.5, 88], [/extra ?large|\bxl\b/i, 65, 100], [/tarot/i, 70, 120], [/square/i, 70, 70], [/overs/i, 80, 120],
];
export function sleeveFit(title) {
  const t = String(title || "");
  if (!/sleeve/i.test(t)) return null;
  const count = (t.match(/(\d{2,3})\s*ct\b/i) || [])[1];
  const mm = t.match(/(\d{2,3}(?:\.\d)?)\s*mm\s*x\s*(\d{2,3}(?:\.\d)?)\s*mm/i);
  let w = 0, h = 0;
  if (mm) { w = +mm[1]; h = +mm[2]; }
  else {
    const table = /dragon shield/i.test(t) && /\bbg\b|board game/i.test(t) ? DS_BG
      : /arcane tinmen/i.test(t) && /\bbg\b|board game/i.test(t) ? AT_BG : null;
    if (!table) return null;
    // "EXTRA LARGE" before "LARGE": the longest name that matches wins
    const hit = table.filter(([re]) => re.test(t)).sort((a, b) => String(b[0]).length - String(a[0]).length)[0];
    if (!hit) return null;
    w = hit[1]; h = hit[2];
  }
  if (w > h) [w, h] = [h, w];
  return { w, h, count: count ? +count : null };
}

/* A game's card sets [{n, w, h, label}] -> per set the sleeves that fit, snuggest
   first: the card must go in (within 0.5 mm) and not swim (at most 3.5 mm wider and
   4.5 mm longer). packs = how many of that product cover the set, when the count
   is known. */
export function fitSleeves(sets, sleeves) {
  return (sets || []).map((s) => {
    let w = +s.w, h = +s.h;
    if (w > h) [w, h] = [h, w];
    const fits = (sleeves || []).filter((p) => p.fit && p.fit.w + 0.5 >= w && p.fit.h + 0.5 >= h
      && p.fit.w - w <= 3.5 && p.fit.h - h <= 4.5)
      .map((p) => ({ ...p, slack: (p.fit.w - w) + (p.fit.h - h), packs: p.fit.count && s.n ? Math.ceil(s.n / p.fit.count) : null }))
      .sort((a, b) => a.slack - b.slack || (b.stock || 0) - (a.stock || 0));
    return { n: +s.n || null, w, h, label: s.label || "", sleeves: fits.slice(0, 3) };
  });
}

function pick(nodes, rule) {
  const out = [];
  for (const p of nodes || []) {
    if (!p || !p.onlineStoreUrl) continue;
    const t = String(p.title || "");
    if (!rule.re.test(t) || (rule.also && !rule.also.test(t)) || (rule.not && rule.not.test(t))) continue;
    const v = ((p.variants && p.variants.nodes) || []).find((x) => x.availableForSale);
    if (!v) continue;
    out.push({
      handle: p.handle, title: t, price: Number(v.price).toFixed(2), v: Number(v.legacyResourceId),
      img: (p.featuredImage && p.featuredImage.url) || null, stock: Number(p.totalInventory) || 0,
      pref: rule.prefer && rule.prefer.test(t) ? 1 : 0,
    });
  }
  out.sort((a, b) => b.pref - a.pref || b.stock - a.stock);
  return out;
}

async function build(gql, kind) {
  if (kind === "sleeves") {
    const d = await gql(SEARCH_Q, { q: BASE_Q + " AND (title:*sleeve*) AND (product_type:'Board Games Supplies' OR title:*BG*)" });
    const list = [];
    for (const p of pick(d && d.products && d.products.nodes, { re: /sleeve/i })) {
      const fit = sleeveFit(p.title);
      if (fit) { delete p.pref; list.push({ ...p, fit }); }
    }
    return { ok: true, for: kind, sleeves: list };
  }
  const rules = RULES[kind];
  const cats = [];
  for (const r of rules) {
    const d = await gql(SEARCH_Q, { q: BASE_Q + " AND (" + r.q + ")" });
    const items = pick(d && d.products && d.products.nodes, r).slice(0, MAX).map((x) => { delete x.pref; return x; });
    if (items.length) cats.push({ key: r.key, label: r.label, why: r.why, items });
  }
  return { ok: true, for: kind, cats };
}

export async function serveKit(request, env, ctx, gql) {
  const url = new URL(request.url);
  const kind = String(url.searchParams.get("for") || "").toLowerCase();
  const cors = { "access-control-allow-origin": "*" };
  if (!RULES[kind] && kind !== "sleeves") return Response.json({ ok: false, error: "for=wh|gunpla|sleeves" }, { status: 400, headers: cors });
  const cache = caches.default;
  const key = new Request("https://cache.internal/kit.json?v=" + KIT_V + "&for=" + kind);
  const hit = await cache.match(key);
  if (hit) return hit;
  let body;
  try { body = await build(gql, kind); }
  catch (e) { return Response.json({ ok: false, error: String(e && e.message || e).slice(0, 120) }, { status: 502, headers: { ...cors, "cache-control": "no-store" } }); }
  body.generated = new Date().toISOString();
  const res = Response.json(body, { headers: { ...cors, "cache-control": "public, max-age=" + TTL_S } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
