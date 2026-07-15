const HOST = "https://most-wanted-ca.myshopify.com";
const feedUrl = (collection, page) =>
  `${HOST}/collections/${collection}/products.json?limit=250&page=${page}`;

const PAGES = 4;        // up to 1000 products per collection
const PER_LANE = 12;    // cards kept per lane (8-col trays hold 24)
const MIN_PRICE = 10;   // strictly over $10, like the MTG feed always was
const MAX_PRICE = 1e5;
const TTL_S = 600;
const TRAY = 40;        // 5 shelves × 8 columns — keep in sync with tv/phone

/* ---------------- Game lane schemes ----------------
   Each game defines: how to recognise its products, its lanes (display
   order), pretty lane names, and how to lane a single product from its
   tags. Lane keys are strings; the UIs colour pips/frames from them. */

const MTG_COLOR_TAG = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G" };
const MTG_TYPE_TAGS = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact", "Land"];

const PKM_ENERGIES = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Colorless"];
const PKM_TRAINER = ["Item", "Supporter", "Stadium", "Pokémon Tool", "Pokemon Tool", "Tool"];

const YGO_ATTRS = ["Dark", "Light", "Earth", "Water", "Fire", "Wind", "Divine"];

const GAMES = {
  mtg: {
    match: /^mtg\b/i,
    lanes: ["W", "U", "B", "R", "G", "M", "C"],
    colorNames: { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", M: "Multicolor", C: "Colorless" },
    fallbackLane: "C",
    laneOf(tags) {
      const colors = tags.filter((t) => MTG_COLOR_TAG[t]);
      return colors.length === 0 ? "C" : colors.length === 1 ? MTG_COLOR_TAG[colors[0]] : "M";
    },
    typeOf(tags) { return MTG_TYPE_TAGS.find((t) => tags.includes(t)) || "MTG Single"; },
  },

  pokemon: {
    match: /pokemon/i,
    lanes: [...PKM_ENERGIES, "Trainer"],
    colorNames: Object.fromEntries([...PKM_ENERGIES, "Trainer"].map((l) => [l, l])),
    fallbackLane: "Colorless",
    laneOf(tags) {
      // Weakness tags look like "Grass [x2]" — anything with '[' is not the
      // card's own energy type, so skip those before matching.
      const clean = tags.filter((t) => t.indexOf("[") === -1);
      const energy = PKM_ENERGIES.find((e) => clean.includes(e));
      if (energy) return energy;
      if (clean.some((t) => PKM_TRAINER.includes(t))) return "Trainer";
      if (clean.includes("Energy")) return "Colorless";
      return "Colorless";
    },
    typeOf(tags) {
      const clean = tags.filter((t) => t.indexOf("[") === -1);
      if (clean.some((t) => PKM_TRAINER.includes(t))) return "Trainer";
      const energy = PKM_ENERGIES.find((e) => clean.includes(e));
      return energy ? energy + " Pokémon" : "Pokémon";
    },
  },

  yugioh: {
    match: /yu-?gi-?oh/i,
    lanes: ["Spell", "Trap", ...YGO_ATTRS, "Monster"],
    colorNames: Object.fromEntries(["Spell", "Trap", ...YGO_ATTRS, "Monster"].map((l) => [l, l === "Monster" ? "Monster" : l])),
    fallbackLane: "Monster",
    laneOf(tags) {
      if (tags.includes("Spell")) return "Spell";
      if (tags.includes("Trap")) return "Trap";
      const attr = YGO_ATTRS.find((a) => tags.includes(a));
      return attr || "Monster";
    },
    typeOf(tags) {
      const t = tags.find((x) => /monster|spell|trap/i.test(x));
      return t || "Yu-Gi-Oh!";
    },
  },
};

function gameOf(productType) {
  const pt = productType || "";
  for (const [key, g] of Object.entries(GAMES)) if (g.match.test(pt)) return key;
  return null;
}

export async function serveCards(request, ctx, collection = "new-arrivals") {
  collection = /^[a-z0-9][a-z0-9-]{0,80}$/.test(collection) ? collection : "new-arrivals";
  const cache = caches.default;
  const cacheKey = new Request(new URL("/cards.json?c=" + collection, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const products = [];
  const trouble = [];
  try {
    for (let p = 1; p <= PAGES; p++) {
      const r = await fetch(feedUrl(collection, p), {
        headers: { accept: "application/json", "user-agent": "ExorBinderTV/1.0 (+workers.dev)" },
      });
      if (!r.ok) { trouble.push(`page ${p}: HTTP ${r.status}`); break; }
      const d = await r.json();
      if (!d.products || d.products.length === 0) break;
      products.push(...d.products);
    }
  } catch (e) {
    trouble.push(String((e && e.message) || e));
  }

  const built = buildCards(products);
  if (built.cards.length === 0) {
    return Response.json(
      { error: "feed unavailable", detail: trouble, cards: [] },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const version = fnv(built.cards.map((c) => c.variantId).join(","));
  const res = Response.json(
    {
      version,
      updated: new Date().toISOString(),
      count: built.cards.length,
      game: built.game,
      colorNames: built.colorNames,
      cards: built.cards,
    },
    { headers: { "cache-control": `public, max-age=${TTL_S}` } },
  );
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* Phone-driven search: Shopify's public predictive-search endpoint finds
   matching products, then each hit is hydrated via /products/{handle}.js for
   variants/tags/type. No price floor here — searching is deliberate. */
export async function serveSearch(request) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  const out = { q, count: 0, cards: [] };
  if (q.length < 2) return Response.json(out, { headers: { "cache-control": "no-store" } });
  try {
    const sr = await fetch(
      `${HOST}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=hide`,
      { headers },
    );
    if (!sr.ok) throw new Error("suggest HTTP " + sr.status);
    const hits = ((await sr.json())?.resources?.results?.products) || [];
    const prods = await Promise.all(hits.map(async (h) => {
      try {
        const pr = await fetch(`${HOST}/products/${h.handle}.js`, { headers });
        if (!pr.ok) return null;
        const p = await pr.json();
        // Normalise /products/{handle}.js (type + cent prices + protocol-
        // relative image URLs) to the products.json shape buildCards expects.
        const abs = (u) => (typeof u === "string" && u.startsWith("//") ? "https:" + u : u);
        const imgs = (p.images && p.images.length ? p.images : [p.featured_image]).filter(Boolean);
        return {
          title: p.title, handle: p.handle, product_type: p.type, tags: p.tags || [],
          images: imgs.map((src) => ({ src: abs(src) })),
          variants: (p.variants || []).map((v) => ({ id: v.id, title: v.title, price: (v.price / 100).toFixed(2), available: !!v.available })),
        };
      } catch { return null; }
    }));
    const built = buildCards(prods.filter(Boolean), { minPrice: 0, perLane: 99 });
    out.cards = built.cards; out.count = built.cards.length;
    out.game = built.game; out.colorNames = built.colorNames;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return Response.json(out, { headers: { "cache-control": "public, max-age=30" } });
}

function buildCards(products, opts = {}) {
  const minPrice = opts.minPrice ?? MIN_PRICE;
  const perLane = opts.perLane ?? PER_LANE;
  // Decide the lane scheme from the dominant game in the feed; stragglers
  // from other games (mixed collections) fall into the fallback lane.
  const counts = { mtg: 0, pokemon: 0, yugioh: 0 };
  for (const p of products) {
    if (!/single/i.test(p.product_type || "")) continue;
    const g = gameOf(p.product_type);
    if (g) counts[g]++;
  }
  const gameKey = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const game = counts[gameKey] > 0 ? gameKey : "mtg";
  const spec = GAMES[game];

  const byLane = Object.fromEntries(spec.lanes.map((l) => [l, []]));
  const seen = new Set();

  for (const p of products) {
    if (!/single/i.test(p.product_type || "")) continue;
    const eligible = (p.variants || []).filter(
      (v2) => v2.available && +v2.price > minPrice && +v2.price < MAX_PRICE,
    );
    if (eligible.length === 0) continue;
    const v = eligible.reduce((a, b) => (+b.price > +a.price ? b : a));

    const tags = p.tags || [];
    const ownGame = gameOf(p.product_type);
    const lane = ownGame === game ? spec.laneOf(tags) : spec.fallbackLane;

    const set = (p.title.match(/\[([^\]]+)\]/) || [, ""])[1];
    const name = p.title.replace(/\s*\[[^\]]*\]\s*/g, " ").trim();
    const key = name + "|" + set;
    if (seen.has(key)) continue;
    seen.add(key);

    (byLane[lane] || byLane[spec.fallbackLane]).push({
      name,
      color: lane,
      set,
      type: ownGame === game ? spec.typeOf(tags) : (p.product_type || "Single"),
      price: (+v.price).toFixed(2),
      foil: /foil/i.test(v.title || ""),
      condition: (v.title || "").replace(/\s*(reverse\s+)?holofoil\s*/i, " ").replace(/\s*foil\s*/i, " ").trim(),
      image: (p.images && p.images[0] && p.images[0].src) || null,
      variantId: v.id,
      url: "https://exorgames.com/products/" + p.handle,
    });
  }

  let laned = spec.lanes.flatMap((l) =>
    byLane[l].sort((a, b) => +b.price - +a.price).slice(0, perLane),
  );
  if (laned.length < TRAY) {
    laned = spec.lanes
      .flatMap((l) => byLane[l])
      .sort((a, b) => +b.price - +a.price)
      .slice(0, perLane * spec.lanes.length);
  }
  return { game, colorNames: spec.colorNames, cards: laned };
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
