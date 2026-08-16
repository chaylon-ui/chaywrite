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

/* Energy/Trainer read from a description's "Card Type: …" line — Japanese
   Pokémon singles (the SortSwift catalogue) carry it there, not in tags. */
function pkmBodyType(body) {
  const m = /card\s*type:\s*([a-z]+)/i.exec(body || "");
  if (!m) return null;
  const e = PKM_ENERGIES.find((x) => x.toLowerCase() === m[1].toLowerCase());
  if (e) return e;
  if (/^(trainer|item|supporter|stadium|tool)$/i.test(m[1])) return "Trainer";
  return null;
}

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
    laneOf(tags, title, body) {
      // Weakness tags look like "Grass [x2]" — anything with '[' is not the
      // card's own energy type, so skip those before matching.
      const clean = tags.filter((t) => t.indexOf("[") === -1);
      const energy = PKM_ENERGIES.find((e) => clean.includes(e));
      if (energy) return energy;
      if (clean.some((t) => PKM_TRAINER.includes(t))) return "Trainer";
      if (clean.includes("Energy")) return "Colorless";
      // Japanese singles (SortSwift) carry no energy tags — the type lives in
      // the description instead: "Card Type: Psychic HP: 90 …".
      const bt = pkmBodyType(body);
      if (bt) return bt;
      return "Colorless";
    },
    typeOf(tags, title, body) {
      const clean = tags.filter((t) => t.indexOf("[") === -1);
      if (clean.some((t) => PKM_TRAINER.includes(t))) return "Trainer";
      const energy = PKM_ENERGIES.find((e) => clean.includes(e));
      if (energy) return energy + " Pokémon";
      const bt = pkmBodyType(body);
      if (bt) return bt === "Trainer" ? "Trainer" : bt + " Pokémon";
      return "Pokémon";
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

  // These three games carry NO lane tags — but their descriptions are
  // structured ("Card Type: Leader … Rarity: Rare … Color: Red"), so lanes
  // parse from the body text (passed as the third laneOf/typeOf argument).
  starwars: {
    match: /star\s*wars/i,
    perLane: 30, // 5 lanes x 30 = up to 150 cards (3-4 pages)
    lanes: ["Leader", "Base", "Unit", "Event", "Upgrade"],
    colorNames: { Leader: "Leaders", Base: "Bases", Unit: "Units", Event: "Events", Upgrade: "Upgrades" },
    fallbackLane: "Unit",
    laneOf(tags, title, body) {
      const m = /card\s*type:\s*(leader|base|unit|event|upgrade)/i.exec(body || "");
      return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Unit";
    },
    typeOf(tags, title, body) { return this.laneOf(tags, title, body) || "SWU Single"; },
  },

  onepiece: {
    match: /one\s*piece/i,
    perLane: 20, // 7 lanes x 20 = up to 140 cards
    lanes: ["Red", "Green", "Blue", "Purple", "Black", "Yellow", "Multi"],
    colorNames: Object.fromEntries(["Red", "Green", "Blue", "Purple", "Black", "Yellow"].map((l) => [l, l]).concat([["Multi", "Multicolor"]])),
    fallbackLane: "Multi",
    laneOf(tags, title, body) {
      const m = /color:\s*([a-z/ ]+)/i.exec(body || "");
      if (!m) return "Multi";
      const colors = m[1].split(/[/\s]+/).map((c) => c[0] ? c[0].toUpperCase() + c.slice(1).toLowerCase() : "")
        .filter((c) => ["Red", "Green", "Blue", "Purple", "Black", "Yellow"].includes(c));
      return colors.length === 1 ? colors[0] : "Multi";
    },
    typeOf(tags, title, body) {
      const t = ["Leader", "Character", "Event", "Stage"].find((x) => (tags || []).includes(x))
        || (/card\s*type:\s*(leader|character|event|stage)/i.exec(body || "") || [])[1];
      return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "One Piece Single";
    },
  },

  riftbound: {
    match: /riftbound/i,
    perLane: 20,
    lanes: ["Legend", "Champion", "Unit", "Signature", "Spell", "Gear", "Rune", "Battlefield"],
    colorNames: { Legend: "Legends", Champion: "Champions", Unit: "Units", Signature: "Signatures", Spell: "Spells", Gear: "Gear", Rune: "Runes", Battlefield: "Battlefields" },
    fallbackLane: "Unit",
    laneOf(tags, title, body) {
      const m = /card\s*type:\s*(legend|champion|signature|unit|spell|gear|rune|battlefield)/i.exec(body || "");
      return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Unit";
    },
    typeOf(tags, title, body) { return this.laneOf(tags, title, body) || "Riftbound Single"; },
  },

  // Sports singles carry their lane in the TITLE ("… Young Guns …",
  // "… Rookie Auto …"), not in tags (tags are just the season, e.g. 22/23).
  hockey: {
    match: /hockey/i,
    lanes: ["Rookie Auto", "Young Guns", "Autos", "Rookies", "Base"],
    colorNames: { "Rookie Auto": "Rookie Autos", "Young Guns": "Young Guns", Autos: "Autographs", Rookies: "Rookies", Base: "Base & Inserts" },
    fallbackLane: "Base",
    laneOf(tags, title) { return sportsLane(title); },
    typeOf(tags, title) { return sportsLane(title) === "Base" ? "Hockey Single" : sportsLane(title); },
  },

  basketball: {
    match: /basketball/i,
    lanes: ["Rookie Auto", "Autos", "Rookies", "Base"],
    colorNames: { "Rookie Auto": "Rookie Autos", Autos: "Autographs", Rookies: "Rookies", Base: "Base & Inserts" },
    fallbackLane: "Base",
    laneOf(tags, title) { return sportsLane(title); },
    typeOf(tags, title) { return sportsLane(title) === "Base" ? "Basketball Single" : sportsLane(title); },
  },
};

/* Variant titles double as conditions ("Near Mint Foil", "Lightly Played").
   Sports cards aren't conditioned at the store, and "Default Title" is
   Shopify's no-variant placeholder — both come back empty. */
const SPORTS_GAMES = new Set(["hockey", "basketball"]);
function condOf(vtitle, game) {
  if (game && SPORTS_GAMES.has(game)) return "";
  const t = String(vtitle || "");
  if (/^default title$/i.test(t)) return "";
  return t.replace(/\s*(reverse\s+)?holofoil\s*/i, " ").replace(/\s*foil\s*/i, " ")
    // SortSwift's Japanese singles variant like "Lightly Played / Japanese /
    // Holofoil" — the language isn't a condition, so it comes off the label.
    .replace(/\s*\/\s*japanese\s*\/?\s*/i, " ")
    .replace(/\s*\/\s*$/, "").replace(/\s{2,}/g, " ").trim();
}
/* Every in-stock printing of the product, so the phone can offer a
   condition toggle. Only attached when there's actually a choice. */
function variantsOf(eligible, game) {
  if (!eligible || eligible.length < 2) return undefined;
  return eligible.slice(0, 8).map((v) => ({
    variantId: v.id,
    price: (+v.price).toFixed(2),
    foil: /foil/i.test(v.title || ""),
    condition: condOf(v.title, game),
  }));
}

function sportsLane(title) {
  const t = String(title || "");
  const rookie = /rookie/i.test(t), auto = /\bauto/i.test(t);
  if (/young\s*guns?/i.test(t)) return "Young Guns";
  if (rookie && auto) return "Rookie Auto";
  if (auto) return "Autos";
  if (rookie) return "Rookies";
  return "Base";
}

function gameOf(productType) {
  const pt = productType || "";
  for (const [key, g] of Object.entries(GAMES)) if (g.match.test(pt)) return key;
  return null;
}

export async function serveCards(request, ctx, collection = "new-arrivals", newToday = false, showcase = false, sleeves = false) {
  collection = /^[a-z0-9][a-z0-9-]{0,80}$/.test(collection) ? collection : "new-arrivals";
  const cache = caches.default;
  const cacheKey = new Request(new URL("/cards.json?c=" + collection + (newToday ? "&nt=1" : "") + (showcase ? "&sc=1" : "") + (sleeves ? "&sv=1" : ""), request.url).toString());
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

  let built;
  if (sleeves) {
    built = buildSleeves(products);
  } else if (showcase) {
    built = buildShowcase(products);
  } else if (newToday) {
    // Cards published today (store-local time), topped up with the next-newest
    // until at least 10 make the case. Same in-stock/over-$10 rules as always.
    const dayKey = (d) => new Date(d || 0).toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
    const today = dayKey(Date.now());
    const pool = [...products].sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));
    let take = pool.findIndex((p) => dayKey(p.published_at || p.created_at) !== today);
    if (take === -1) take = pool.length;
    built = buildCards(pool.slice(0, Math.max(take, 1)), { perLane: 99 });
    while (built.cards.length < 10 && take < pool.length) {
      take += 5;
      built = buildCards(pool.slice(0, take), { perLane: 99 });
    }
  } else {
    built = buildCards(products);
  }
  if (built.cards.length === 0) {
    return Response.json(
      { error: "feed unavailable", detail: trouble, cards: [] },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  await nameYgoSets(built.cards, request, ctx); // codes → real set names before caching

  const version = fnv(built.cards.map((c) => c.variantId).join(","));
  const res = Response.json(
    {
      version,
      updated: new Date().toISOString(),
      count: built.cards.length,
      game: built.game,
      colorNames: built.colorNames,
      cats: built.cats,
      cards: built.cards,
    },
    { headers: { "cache-control": `public, max-age=${TTL_S}` } },
  );
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* Yu-Gi-Oh cards carry bracket CODES ([DUPO-EN101]) as their set — swap in
   the real set name everywhere it shows (cue cards, set chips) and keep the
   searchable code in setq so set-browse still matches the titles. */
async function nameYgoSets(cards, request, ctx) {
  const need = (cards || []).some((c) => c && c.game === "yugioh" && /^[A-Z0-9]{2,6}-/.test(String(c.set || "")));
  if (!need) return;
  const names = await ygoSetNames(request, ctx);
  for (const c of cards) {
    if (!c || c.game !== "yugioh") continue;
    const m = String(c.set || "").match(/^([A-Z0-9]{2,6})-/);
    if (!m) continue;
    c.setq = m[1];
    c.set = names[m[1]] || m[1];
  }
}

/* Phone-driven search. With the SHOPIFY_ADMIN_TOKEN secret set the worker
   searches the FULL catalogue via the Admin API (predictive search caps at
   10 hits, which is why "Charizard" came up short); without it, it falls
   back to Shopify's public predictive search + per-handle hydration.
   No price floor here — searching is deliberate. */
export async function serveSearch(request, env) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const g = String(url.searchParams.get("g") || "").slice(0, 16); // set browse scopes to the active game
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  const out = { q, count: 0, cards: [] };
  if (q.length < 2) return Response.json(out, { headers: { "cache-control": "no-store" } });
  try {
    const token = env && env.SHOPIFY_ADMIN_TOKEN;
    let prods = null;
    if (token) {
      try { prods = await adminSearch(q, env, GAME_PTQ[g] || ""); } catch { prods = null; }
    }
    if (!prods) prods = await suggestSearch(q, headers);
    const built = buildCards(prods.filter(Boolean), { minPrice: 0, perLane: 199 });
    out.cards = built.cards.slice(0, 120); out.count = out.cards.length;
    out.game = built.game; out.colorNames = built.colorNames;
    await nameYgoSets(out.cards, request, null);
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return Response.json(out, { headers: { "cache-control": "public, max-age=30" } });
}

/* Full-catalogue title search through the Admin API (up to 40 products). */
async function adminSearch(q, env, ptq = "") {
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const safe = q.replace(/[*"\\()]/g, " ").trim();
  if (!safe) return null;
  // Two pages of 40 (the per-query cost stays at the long-proven level) so a
  // deep name like "charizard" surfaces the EXs and GXs, not just page one.
  const gql = `query($q:String!,$after:String){products(first:40,query:$q,after:$after){
    pageInfo{hasNextPage endCursor}
    edges{node{
    title handle productType vendor tags description(truncateAt:400) featuredImage{url}
    variants(first:20){edges{node{id title price availableForSale}}}}}}}`;
  let edges = [];
  let after = null;
  for (let page = 0; page < 2; page++) {
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({ query: gql, variables: { q: `status:active ${ptq} title:*${safe}*`.replace(/\s+/g, " "), after } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) { if (page) break; throw new Error("admin search HTTP " + r.status); }
    const pr = (await r.json())?.data?.products;
    if (!Array.isArray(pr?.edges)) { if (page) break; throw new Error("admin search shape"); }
    edges = edges.concat(pr.edges);
    if (!pr.pageInfo?.hasNextPage || !pr.pageInfo.endCursor) break;
    after = pr.pageInfo.endCursor;
  }
  return edges.map(({ node: p }) => ({
    title: p.title, handle: p.handle, product_type: p.productType, vendor: p.vendor || "", tags: p.tags || [], body_html: p.description || "",
    images: p.featuredImage ? [{ src: p.featuredImage.url }] : [],
    variants: (p.variants?.edges || []).map(({ node: v }) => ({
      id: +String(v.id).replace(/\D/g, ""), title: v.title, price: String(v.price), available: !!v.availableForSale,
    })),
  }));
}

/* Tokenless fallback: public predictive search (top 10) + handle hydration. */
async function suggestSearch(q, headers) {
  const sr = await fetch(
    `${HOST}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=hide`,
    { headers },
  );
  if (!sr.ok) throw new Error("suggest HTTP " + sr.status);
  const hits = ((await sr.json())?.resources?.results?.products) || [];
  return Promise.all(hits.map(async (h) => {
    try {
      const pr = await fetch(`${HOST}/products/${h.handle}.js`, { headers });
      if (!pr.ok) return null;
      const p = await pr.json();
      // Normalise /products/{handle}.js (type + cent prices + protocol-
      // relative image URLs) to the products.json shape buildCards expects.
      const abs = (u) => (typeof u === "string" && u.startsWith("//") ? "https:" + u : u);
      const imgs = (p.images && p.images.length ? p.images : [p.featured_image]).filter(Boolean);
      return {
        title: p.title, handle: p.handle, product_type: p.type, vendor: p.vendor || "", tags: p.tags || [], body_html: p.description || "",
        images: imgs.map((src) => ({ src: abs(src) })),
        variants: (p.variants || []).map((v) => ({ id: v.id, title: v.title, price: (v.price / 100).toFixed(2), available: !!v.available })),
      };
    } catch { return null; }
  }));
}

/* Live stock counts so the kiosk can stop customers adding more copies than
   we own. The public product feed only says in-stock yes/no, so real numbers
   need the Admin API (SHOPIFY_ADMIN_TOKEN) — without the secret this returns
   {} and the clients simply don't cap. Untracked or oversell-allowed
   variants come back null (no cap). Cached 60s. */
export async function serveQty(request, env, ctx) {
  const url = new URL(request.url);
  const ids = [...new Set(
    String(url.searchParams.get("ids") || "").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean),
  )].slice(0, 24);
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  if (!ids.length || !token) return Response.json({}, { headers: { "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/qty.json?ids=" + ids.sort().join(","), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const out = {};
  try {
    const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
    const gql = `query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{
      id inventoryQuantity inventoryPolicy inventoryItem{tracked}}}}`;
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: gql, variables: { ids: ids.map((i) => "gid://shopify/ProductVariant/" + i) } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error("qty HTTP " + r.status);
    const nodes = (await r.json())?.data?.nodes || [];
    for (const n of nodes) {
      if (!n || !n.id) continue;
      const id = String(n.id).replace(/\D/g, "");
      const uncapped = (n.inventoryItem && n.inventoryItem.tracked === false) || n.inventoryPolicy === "CONTINUE";
      out[id] = uncapped ? null : Math.max(0, n.inventoryQuantity | 0);
    }
  } catch { /* fall through with whatever we have — clients treat missing as uncapped */ }
  const res = Response.json(out, { headers: { "cache-control": "public, max-age=60" } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* Set-name suggestions for the Browse-by-set panel: set names live in the
   [brackets] of product titles, so a title search doubles as a directory.
   Names that START with the query rank first. Cached 10 minutes per query. */
/* Per-game product_type scoping so the Yu-Gi-Oh tab suggests Yu-Gi-Oh sets,
   not Magic ones (types verified against the live catalogue). */
const GAME_PTQ = {
  mtg: 'product_type:"MTG Single"',
  pokemon: 'product_type:"Pokemon Single"',
  yugioh: 'product_type:"Yugioh Single"',
  starwars: 'product_type:"Star Wars: Unlimited Single"',
  onepiece: 'product_type:"One Piece Single"',
  riftbound: "product_type:Riftbound*",
  hockey: "product_type:Hockey*",
  basketball: 'product_type:"Basketball Singles"',
};
/* Yu-Gi-Oh set-code → set-name directory (YGOPRODeck's public DB), cached a
   day. Lets "DUPO" surface as "Duel Power" while the search still runs on
   the code the titles actually carry. Failure → codes show as-is. */
async function ygoSetNames(request, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/ygosets.internal", request.url).toString());
  const hit = await cache.match(key);
  if (hit) { try { return await hit.json(); } catch {} }
  try {
    const r = await fetch("https://db.ygoprodeck.com/api/v7/cardsets.php", {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("http " + r.status);
    const arr = await r.json();
    const map = {};
    for (const s of arr || []) if (s && s.set_code && s.set_name) map[String(s.set_code).toUpperCase()] = String(s.set_name).slice(0, 60);
    const res = Response.json(map, { headers: { "cache-control": "public, max-age=86400" } });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
    else await cache.put(key, res.clone());
    return map;
  } catch { return {}; }
}

export async function serveSetSuggest(request, env, ctx) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 30);
  const g = String(url.searchParams.get("g") || "").slice(0, 16);
  const ptq = GAME_PTQ[g] || "";
  if (!q) return Response.json({ sets: [] }, { headers: { "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/setsuggest.json?q=" + encodeURIComponent(q) + "&g=" + encodeURIComponent(g), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const names = g === "yugioh" ? await ygoSetNames(request, ctx) : {};
  const found = new Map();
  try {
    if (!token) throw new Error("no token");
    const safe = q.replace(/[*"\\()[\]]/g, " ").trim();
    const gql = `query($q:String!){products(first:100,query:$q){edges{node{title}}}}`;
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: gql, variables: { q: `status:active ${ptq} title:*${safe}*`.replace(/\s+/g, " ") } }),
      signal: AbortSignal.timeout(6000),
    });
    const edges = (await r.json())?.data?.products?.edges || [];
    for (const { node } of edges) {
      const m = String((node && node.title) || "").match(/\[([^\]]{2,60})\]/);
      if (!m) continue;
      let name = m[1].trim();
      // Yu-Gi-Oh style brackets carry card codes ([DUPO-EN101]) — fold those
      // into their set-code prefix so DUPO suggests once, not per card, and
      // translate the code to the real set name when the directory knows it.
      const code = name.match(/^([A-Z0-9]{2,6})-[A-Z]{0,4}\d/);
      const sq = code ? code[1] : name; // what the kiosk should SEARCH by
      const label = code ? (names[code[1]] || code[1]) : name;
      if (label.toLowerCase().includes(q) || sq.toLowerCase().includes(q))
        found.set(sq.toLowerCase(), { n: label, q: sq });
    }
  } catch {}
  const sets = [...found.values()].sort((a, b) => {
    const ap = a.n.toLowerCase().startsWith(q) ? 0 : 1, bp = b.n.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.n.localeCompare(b.n);
  }).slice(0, 24);
  const res = Response.json({ sets }, { headers: { "cache-control": "public, max-age=600" } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* The pickup board: every OPEN draft order, newest first — the POS tablets
   can't list third-party drafts natively, so /pickups shows them all (staff
   PIN-gated at the worker layer). Needs SHOPIFY_ADMIN_TOKEN. */
export async function servePickups(env) {
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return Response.json({ error: "no admin token" }, { status: 503, headers: { "access-control-allow-origin": "*" } });
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const gql = `{ draftOrders(first: 40, query: "status:open", reverse: true) { edges { node {
    id name createdAt totalPrice tags note2
    lineItems(first: 25) { edges { node { title quantity variantTitle variant { id sku barcode } } } } } } } }`;
  try {
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: gql }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    // GraphQL failures come back 200 with an errors array — surface them
    // instead of pretending the store has no pickups.
    if (!j?.data?.draftOrders) throw new Error(j?.errors?.[0]?.message || "draft orders unreadable (check the app's read_draft_orders scope)");
    const edges = j.data.draftOrders.edges || [];
    const orders = edges.map(({ node: n }) => ({
      name: n.name,
      did: String(n.id || "").replace(/\D/g, ""),
      createdAt: n.createdAt,
      total: n.totalPrice,
      kiosk: (n.tags || []).includes("showcase-tv"),
      note: String(n.note2 || "").slice(0, 140),
      items: (n.lineItems?.edges || []).map(({ node: li }) => ({
        t: li.title,
        q: li.quantity,
        // Numeric variant id so the POS tile can drop the line straight into
        // the POS cart (shopify.cart.addLineItem wants the bare number).
        v: Number(String(li.variant?.id || "").replace(/\D/g, "")) || 0,
        // BinderPOS's own per-condition barcode + SKU: the BinderPOS till
        // resolves these on scan, so the auto-loader userscript (and manual
        // screen-scanning) land the exact card/variant/condition.
        b: String(li.variant?.barcode || "").slice(0, 32),
        s: String(li.variant?.sku || "").slice(0, 48),
        // Condition/edition ("Lightly Played Holofoil") so the BinderPOS
        // auto-loader can verify the tile's condition dropdown before Add.
        vt: String(li.variantTitle || "").slice(0, 60),
      })),
    }));
    // CORS: the POS tile app (Shopify-hosted extension origin) reads this
    // endpoint cross-origin. The PIN is the auth; the origin doesn't matter.
    return Response.json({ orders }, { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502, headers: { "access-control-allow-origin": "*" } });
  }
}

/* "Mark done" from the POS tile (or anywhere staff-side): deletes the open
   draft order once it's been rung through the register, so the pickup list
   stays clean. did is digits-only (enforced by the router). */
export async function servePickupDone(env, did) {
  const cors = { "access-control-allow-origin": "*" };
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return Response.json({ error: "no admin token" }, { status: 503, headers: cors });
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const gql = `mutation { draftOrderDelete(input: {id: "gid://shopify/DraftOrder/${did}"}) { deletedId userErrors { message } } }`;
  try {
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: gql }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = (await r.json())?.data?.draftOrderDelete;
    if (!d?.deletedId) {
      const msg = d?.userErrors?.[0]?.message || "draft not found (already done?)";
      return Response.json({ ok: false, error: msg }, { status: 409, headers: cors });
    }
    return Response.json({ ok: true }, { headers: { ...cors, "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502, headers: cors });
  }
}

/* In-stock filter for the "Alternatives in stock" / Similar strips. The
   TV/phone BROWSERS query strictlybetter.eu themselves (its API is
   CORS-open to browsers, but its Cloudflare zone 301-loops
   Worker-originated fetches), then hand the suggested names here to be
   mapped onto our actual stock. Names are |-separated — card names contain
   commas. Up to 16 names checked in parallel; `max` (1–8, default 4 so the
   kiosk tray keeps its size) caps how many in-stock hits return, ranked
   order preserved. CORS-open so the exorgames.com product pages can reuse
   the same strip (read-only, public product data only). */
const BETTER_TTL_S = 600;

export async function serveInstock(request, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  const url = new URL(request.url);
  const names = String(url.searchParams.get("names") || "")
    .split("|").map((s) => s.trim().slice(0, 80)).filter((s) => s.length >= 2).slice(0, 16);
  const max = Math.min(8, Math.max(1, parseInt(url.searchParams.get("max"), 10) || 4));
  const out = { count: 0, cards: [] };
  if (!names.length) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/instock.json?m=" + max + "&n=" + encodeURIComponent(names.join("|").toLowerCase()), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  // Every name at once (two small same-store fetches each) — Promise.all
  // keeps the ranked order, then the first `max` in-stock hits win.
  const found = await Promise.all(names.map((n) => findInStock(n, headers)));
  out.cards = found.filter(Boolean).slice(0, max);
  out.count = out.cards.length;
  const res = Response.json(out, { headers: { ...cors, "cache-control": `public, max-age=${BETTER_TTL_S}` } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* Exact-name in-stock lookup via the shop's predictive search; returns the
   cheapest available copy normalised to the card shape the UIs speak. */
async function findInStock(name, headers) {
  try {
    const sr = await fetch(
      `${HOST}/search/suggest.json?q=${encodeURIComponent(name)}&resources[type]=product&resources[limit]=6&resources[options][unavailable_products]=hide`,
      { headers },
    );
    if (!sr.ok) return null;
    const hits = ((await sr.json())?.resources?.results?.products) || [];
    const want = name.toLowerCase();
    const hit = hits.find((h) => String(h.title || "").toLowerCase().replace(/\s*\[[^\]]*\]\s*$/, "").trim() === want);
    if (!hit) return null;
    const pr = await fetch(`${HOST}/products/${hit.handle}.js`, { headers });
    if (!pr.ok) return null;
    const p = await pr.json();
    if (!/single/i.test(p.type || "")) return null;
    const eligible = (p.variants || []).filter((v) => v.available && v.price > 0);
    if (!eligible.length) return null;
    const v = eligible.reduce((a, b) => (b.price < a.price ? b : a));
    const abs = (u) => (typeof u === "string" && u.startsWith("//") ? "https:" + u : u);
    const img = (p.images && p.images[0]) || p.featured_image || null;
    return {
      name: p.title.replace(/\s*\[[^\]]*\]\s*/g, " ").trim(),
      set: (p.title.match(/\[([^\]]+)\]/) || [, ""])[1],
      game: "mtg",
      type: "MTG Single",
      color: "C",
      price: (v.price / 100).toFixed(2),
      foil: /foil/i.test(v.title || ""),
      condition: condOf(v.title, "mtg"),
      image: img ? abs(img) : null,
      variantId: v.id,
      url: "https://exorgames.com/products/" + p.handle,
    };
  } catch { return null; }
}

/* ---------------- "Similar cards" candidate names ----------------
   StrictlyBetter's crowd graph is precise but thin — plenty of cards carry
   one pairing or none (Pyretic Ritual surfaced a single card). EDHREC
   publishes a functional "similar cards" list for nearly every Magic card
   as public page JSON; one fetch per card name per DAY (edge-cached) turns
   that into extra candidate names for the Similar strip. Names only — the
   strip still maps them onto real stock through /instock.json. Unknown
   card, outage, or shape drift → empty list, and the strip quietly shows
   whatever StrictlyBetter knew. */
const SIMILAR_TTL_S = 86400;    // EDHREC's similarity barely moves; be a polite guest
const SIMILAR_MISS_TTL_S = 600; // but never pin an outage's empty answer for a day
const SIMILAR_MAX = 16;

/* EDHREC page slugs: lowercased, accents flattened, punctuation dropped,
   spaces to hyphens; double-faced cards go by their front face. */
function edhSlug(name) {
  let n = String(name || "").split("//")[0].trim().toLowerCase();
  n = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/æ/g, "ae").replace(/œ/g, "oe");
  return n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function serveSimilar(request, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  const url = new URL(request.url);
  const name = String(url.searchParams.get("name") || "").trim().slice(0, 80);
  const slug = edhSlug(name);
  const out = { name, count: 0, names: [] };
  if (slug.length < 2) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/similar.json?n=" + encodeURIComponent(slug), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const r = await fetch(`https://json.edhrec.com/pages/cards/${slug}.json`, {
      headers: { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      // The similar list has moved around EDHREC's page JSON before — check
      // the shapes seen in the wild rather than one blessed path.
      const spots = [j?.similar, j?.container?.json_dict?.similar, j?.container?.similar, j?.panels?.similar];
      const list = spots.find((x) => Array.isArray(x) && x.length) || [];
      const seen = new Set([name.toLowerCase()]);
      for (const c of list) {
        const n = typeof c === "string" ? c : c && typeof c.name === "string" ? c.name : null;
        if (!n || seen.has(n.toLowerCase())) continue;
        seen.add(n.toLowerCase());
        out.names.push(n);
        if (out.names.length >= SIMILAR_MAX) break;
      }
    }
  } catch { /* fall through to the empty list */ }
  out.count = out.names.length;
  const ttl = out.count ? SIMILAR_TTL_S : SIMILAR_MISS_TTL_S;
  const res = Response.json(out, { headers: { ...cors, "cache-control": `public, max-age=${ttl}` } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- Sister-store search ----------------
   The other five Exor locations are separate Shopify stores, so their stock
   can't join this store's cart. exorgames.com search pages call this once
   per view; each sister's public predictive search answers (in-stock only),
   results interleave round-robin so one deep catalogue doesn't crowd out
   the rest, and the site renders link-out cards — each opens that store's
   own product page with its own cart, checkout and shipping. Per-query
   edge cache keeps the upstream cost (5 suggests + a product hydration per
   hit, ~30 fetches worst case) to once per unique search, not per shopper.
   Everything fails to an empty list, never an error. */
const SISTERS = [
  { store: "Summerside",  base: "https://exor-games-summserside.myshopify.com" },
  { store: "Bridgewater", base: "https://exor-games-bridgewater.myshopify.com" },
  { store: "Dartmouth",   base: "https://exor-games-dartmouth.myshopify.com" },
  { store: "New Glasgow", base: "https://exor-games-new-glasgow.myshopify.com" },
  { store: "Truro",       base: "https://exor-games-truro.myshopify.com" },
];
const SISTERS_TTL_S = 300;   // sister stock drifts; keep the window short
const SISTERS_PER_STORE = 5;
const SISTERS_MAX = 12;

export async function serveSisters(request, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 80);
  const out = { query: q, count: 0, cards: [] };
  if (q.length < 2) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/sisters.json?q=" + encodeURIComponent(q.toLowerCase()), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  const abs = (u) => (typeof u === "string" && u.startsWith("//") ? "https:" + u : u);
  const perStore = await Promise.all(SISTERS.map(async (s) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500); // one slow store must not stall the band
      const r = await fetch(
        `${s.base}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=${SISTERS_PER_STORE}&resources[options][unavailable_products]=hide&resources[options][fields]=title,product_type,variants.title`,
        { headers, signal: ctrl.signal },
      );
      clearTimeout(t);
      if (!r.ok) return [];
      const hits = ((await r.json())?.resources?.results?.products) || [];
      // suggest.json's product `price` is the minimum across ALL variants,
      // sold-out ones included — a $40.50 sold-out copy shadowed the $79.10
      // MP actually on the shelf. Hydrate each hit and price it from its
      // cheapest AVAILABLE variant; hits with nothing really available drop.
      const priced = await Promise.all(hits
        .filter((h) => h && h.title && h.url && h.handle && h.available !== false)
        .map(async (h) => {
          try {
            const c2 = new AbortController();
            const t2 = setTimeout(() => c2.abort(), 3500);
            const pr = await fetch(`${s.base}/products/${h.handle}.js`, { headers, signal: c2.signal });
            clearTimeout(t2);
            if (!pr.ok) return null;
            const p = await pr.json();
            const eligible = (p.variants || []).filter((v) => v.available && v.price > 0);
            if (!eligible.length) return null;
            const cents = eligible.reduce((a, v) => Math.min(a, v.price), Infinity);
            if (cents / 100 >= 99999) return null; // BinderPOS "email us" placeholder pricing
            const img = h.image || (h.featured_image && h.featured_image.url) ||
              (p.images && p.images[0]) || p.featured_image || null;
            return {
              store: s.store,
              name: String(h.title),
              price: (cents / 100).toFixed(2),
              image: img ? abs(String(img)) : null,
              url: s.base + String(h.url),
            };
          } catch { return null; }
        }));
      return priced.filter(Boolean);
    } catch { return []; }
  }));
  for (let i = 0; out.cards.length < SISTERS_MAX; i++) {
    let added = false;
    for (const list of perStore) {
      if (list[i]) {
        out.cards.push(list[i]);
        added = true;
        if (out.cards.length >= SISTERS_MAX) break;
      }
    }
    if (!added) break;
  }
  out.count = out.cards.length;
  const res = Response.json(out, { headers: { ...cors, "cache-control": `public, max-age=${SISTERS_TTL_S}` } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function buildCards(products, opts = {}) {
  const minPrice = opts.minPrice ?? MIN_PRICE;

  // Decide the lane scheme from the dominant game in the feed; stragglers
  // from other games (mixed collections) fall into the fallback lane.
  const counts = Object.fromEntries(Object.keys(GAMES).map((k) => [k, 0]));
  for (const p of products) {
    if (!/single/i.test(p.product_type || "")) continue;
    const g = gameOf(p.product_type);
    if (g) counts[g]++;
  }
  const gameKey = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const game = counts[gameKey] > 0 ? gameKey : "mtg";
  const spec = GAMES[game];
  // Games with deep in-stock catalogues run their lanes longer than the
  // default dozen (a caller's perLane — search, New Today — still wins).
  const perLane = opts.perLane ?? spec.perLane ?? PER_LANE;

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
    const body = String(p.body_html || "").replace(/<[^>]*>/g, " "); // lane facts live in the description for tagless games
    const ownGame = gameOf(p.product_type);
    const lane = ownGame === game ? spec.laneOf(tags, p.title, body) : spec.fallbackLane;

    // Japanese Pokémon singles bracket the CARD NUMBER ("Muk [004/092]") and
    // keep the set name in the vendor field — the cue card's set line should
    // read "Mystery of the Fossils", not a number.
    const jpk = /pokemon\s*japan/i.test(p.product_type || "");
    const set = (jpk && String(p.vendor || "").trim()) || (p.title.match(/\[([^\]]+)\]/) || [, ""])[1];
    const name = p.title.replace(/\s*\[[^\]]*\]\s*/g, " ").trim();
    const key = name + "|" + set;
    if (seen.has(key)) continue;
    seen.add(key);

    (byLane[lane] || byLane[spec.fallbackLane]).push({
      name,
      color: lane,
      set,
      game: ownGame || game, // per-card, so foil/Holo wording survives mixed decks (search, showcase)
      type: ownGame === game ? spec.typeOf(tags, p.title, body) : (p.product_type || "Single"),
      price: (+v.price).toFixed(2),
      foil: /foil/i.test(v.title || ""),
      condition: condOf(v.title, ownGame || game),
      variants: variantsOf(eligible, ownGame || game),
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

/* The physical showcase, mirrored: one mixed feed (the ESL-SHOWCASE tag),
   every game together. No price floor and no singles-only filter — being
   tagged IS the curation. Cards group by game: Magic first (by color), then
   Pokémon (by energy), Yu-Gi-Oh (Spell/Trap/attribute), then every other
   game bunched under its own name, priciest first within each lane. */
function buildShowcase(products) {
  const seen = new Set();
  const known = Object.fromEntries(Object.keys(GAMES).map((k) => [k, []]));
  const other = new Map(); // game name -> cards
  const colorNames = {};

  for (const p of products) {
    const eligible = (p.variants || []).filter((v2) => v2.available && +v2.price > 0 && +v2.price < MAX_PRICE);
    if (eligible.length === 0) continue;
    const v = eligible.reduce((a, b) => (+b.price > +a.price ? b : a));

    // Same swap as buildCards: Japanese Pokémon singles keep the set name in
    // the vendor field; the title bracket is the card number.
    const jpk = /pokemon\s*japan/i.test(p.product_type || "");
    const set = (jpk && String(p.vendor || "").trim()) || (p.title.match(/\[([^\]]+)\]/) || [, ""])[1];
    const name = p.title.replace(/\s*\[[^\]]*\]\s*/g, " ").trim();
    const key = name + "|" + set;
    if (seen.has(key)) continue;
    seen.add(key);

    const tags = p.tags || [];
    const body = String(p.body_html || "").replace(/<[^>]*>/g, " ");
    const g = gameOf(p.product_type);
    const spec = g && GAMES[g];
    // Games without a lane scheme lane under their own name, e.g. "Lorcana".
    const lane = spec ? spec.laneOf(tags, p.title, body) : (String(p.product_type || "").replace(/\bsingles?\b/gi, "").trim() || "Other");

    const card = {
      name,
      color: lane,
      set,
      game: g || null,
      type: spec ? spec.typeOf(tags, p.title, body) : (p.product_type || "Single"),
      price: (+v.price).toFixed(2),
      foil: /foil/i.test(v.title || ""),
      condition: condOf(v.title, g),
      variants: variantsOf(eligible, g),
      image: (p.images && p.images[0] && p.images[0].src) || null,
      variantId: v.id,
      url: "https://exorgames.com/products/" + p.handle,
    };
    if (spec) known[g].push(card);
    else {
      if (!other.has(lane)) other.set(lane, []);
      other.get(lane).push(card);
      colorNames[lane] = lane;
    }
  }

  const cards = [];
  for (const g of Object.keys(GAMES)) {
    const spec = GAMES[g];
    const byLane = {};
    for (const c of known[g]) (byLane[c.color] || (byLane[c.color] = [])).push(c);
    for (const l of spec.lanes) {
      if (!byLane[l]) continue;
      cards.push(...byLane[l].sort((a, b) => +b.price - +a.price));
      if (!(l in colorNames)) colorNames[l] = spec.colorNames[l];
    }
  }
  for (const gname of [...other.keys()].sort()) {
    cards.push(...other.get(gname).sort((a, b) => +b.price - +a.price));
  }
  return { game: "showcase", colorNames, cards };
}

/* The sleeve wall (accessories, not singles): every in-stock product in the
   collection, no price floor, in FEED ORDER — the collection is set to sort
   by Best selling in Shopify, so the top shelf is the top sellers. Names are
   trimmed of the shouty "DRAGON SHIELD SLEEVES … 100CT" wrapper. */
function buildSleeves(products) {
  const seen = new Set();
  let cards = [];
  for (const p of products) {
    const eligible = (p.variants || []).filter((v2) => v2.available && +v2.price > 0 && +v2.price < MAX_PRICE);
    if (eligible.length === 0) continue;
    const v = eligible.reduce((a, b) => (+b.price < +a.price ? b : a)); // lead with the cheapest in-stock option
    const title = String(p.title || "");
    const gw = /games\s*workshop/i.test(String(p.vendor || ""));
    const cat = gw ? gwCat(title, p.product_type) : null;
    // Filter facts straight from the title: pack count ("100CT", "60CT",
    // tolerating the odd "100C" typo), Japanese small-size line, and the
    // finish family. DUAL MATTE must be tested before MATTE. GW product
    // skips all this — its titles carry game systems, not sleeve specs.
    const ctm = gw ? null : title.match(/\b(\d{2,3})\s*c\.?t?\b/i);
    const ct = ctm ? ctm[1] : null;
    const jp = !gw && /japanese/i.test(title);
    const fin = gw ? "" : /dual\b[\s\S]*\bmatte|dual\s+matte/i.test(title) ? "dual"
      : /brushed/i.test(title) ? "brushed"
      : /matte/i.test(title) ? "matte"
      : /classic/i.test(title) ? "classic" : "";
    const raw = (gw ? gwTrimTitle(title) : title)
      .replace(/^dragon\s*shield\s*(sleeves)?\s*/i, "")
      .replace(/\bjapanese\s*/gi, "") // the size switch says it; keep the sticker short
      .replace(/\b\d{2,3}\s*c\.?t?\b\.?/gi, "") // count moves to its own sticker
      .replace(/\s{2,}/g, " ").trim() || p.title;
    // The catalogue titles SHOUT IN CAPS — settle them into Title Case for
    // the cue card and speech bubble (already-mixed-case titles untouched).
    const name = raw === raw.toUpperCase()
      ? raw.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (m, a, b) => a + b.toUpperCase())
      : raw;
    if (seen.has(name)) continue;
    seen.add(name);
    cards.push({
      name,
      ct,
      jp,
      fin,
      color: "C",
      cat: cat || undefined,
      // Generic shelves (board games, Warhammer) reuse this builder — only
      // actual Dragon Shield product gets the brand as its set line; GW
      // product shows its game system (the cue card's second line).
      set: gw ? (GW_LABEL[cat] || "") : /dragon\s*shield/i.test(title) ? "Dragon Shield" : "",
      game: "sleeves",
      type: gw ? "Warhammer" : "Card Sleeves",
      price: (+v.price).toFixed(2),
      foil: false,
      condition: "",
      variants: variantsOf(eligible, "sleeves"),
      image: (p.images && p.images[0] && p.images[0].src) || null,
      variantId: v.id,
      url: "https://exorgames.com/products/" + p.handle,
    });
  }
  // Warhammer wall: group by game system so all the Kill Team boxes sit
  // together (stable — the feed's newest-first order survives inside each
  // group), and hand the kiosk the list of groups present for filter chips.
  if (cards.some((c) => c.cat)) {
    const ord = (c) => { const i = GW_ORDER.indexOf(c.cat || "other"); return i < 0 ? GW_ORDER.length : i; };
    cards = cards.map((c, i) => [c, i]).sort((a, b) => ord(a[0]) - ord(b[0]) || a[1] - b[1]).map((x) => x[0]);
    const cats = GW_ORDER.filter((k) => cards.some((c) => c.cat === k)).map((k) => ({ k, label: GW_LABEL[k] }));
    return { game: "sleeves", colorNames: {}, cards, cats };
  }
  return { game: "sleeves", colorNames: {}, cards };
}

/* ---- Games Workshop shelf lines ----
   The store types nearly everything "Tabletop Wargames", so the game system
   lives in the TITLE. Checked in order: tools before paints (brushes and
   painting handles sit inside the Citadel/Warhammer Colour range), books
   before systems (Black Library novels mention 40K/AoS), Kill Team before
   40K (its titles start "WARHAMMER 40,000 KILL TEAM"). */
const GW_ORDER = ["w40k", "aos", "killteam", "heresy", "necromunda", "bloodbowl", "oldworld", "middle", "figures", "books", "paints", "tools", "other"];
const GW_LABEL = { w40k: "40K", aos: "Age of Sigmar", killteam: "Kill Team", heresy: "Horus Heresy", necromunda: "Necromunda",
  bloodbowl: "Blood Bowl", oldworld: "The Old World", middle: "Middle-earth", figures: "Figures", books: "Books", paints: "Paints", tools: "Tools", other: "More" };
const GW_TOOLS_RE = /\btool\s*(set|kit)s?\b|toolkit|painting\s+handle|dry\s*brush|\bbrush(es)?\b|clipper|mould\s+line|spray\s+stick|hobby\s+knife|emery|water\s+pot|super\s*glue|plastic\s+glue/i;
const GW_CATS = [
  ["tools", GW_TOOLS_RE],
  ["books", /paperback|hardback|\((?:pb|hb)\)|black\s+library|omnibus\b|novel\b/i],
  ["paints", /warhammer\s+colou?r|citadel|^\s*(?:base|layer|contrast|shade|technical|air|dry)\b\s*:?|\b1[28]\s*ml\b|\bspray\b|paint/i],
  ["killteam", /kill\s*team/i],
  ["necromunda", /necromunda/i],
  ["heresy", /horus\s+heresy|legions\s+imperialis/i],
  ["bloodbowl", /blood\s*bowl/i],
  ["oldworld", /old\s+world/i],
  ["aos", /age\s+of\s+sigmar|warcry|underworlds/i],
  ["middle", /middle.?earth|lord\s+of\s+the\s+rings/i],
  ["w40k", /warhammer\s*40|40[.,]000|\b40k\b/i],
];
function gwCat(title, ptype) {
  const pt = String(ptype || "");
  if (/figure/i.test(pt)) return "figures"; // Joy Toy collectibles
  if (/^paint/i.test(pt)) return GW_TOOLS_RE.test(title) ? "tools" : "paints";
  if (/^book/i.test(pt)) return "books";
  for (const [k, re] of GW_CATS) if (re.test(title)) return k;
  return "other";
}
/* Peel the system wrapper off the front of GW titles — the shelf tab and
   category chip already say it. "WARHAMMER 40,000 KILL TEAM: LEGIONARIES"
   sheds two layers and stickers as just "Legionaries". */
const GW_STRIP = [
  /^\s*warhammer\s*[:,–-]?\s+/i,
  /^\s*(?:the\s+)?(?:40[.,]?\s*000|40k)\s*[:–-]?\s*/i,
  /^\s*(?:the\s+)?age\s+of\s+sigmar\s*[:–-]?\s*/i,
  /^\s*(?:the\s+)?horus\s+heresy(?:\s+saga)?\s*[:–-]?\s*/i,
  /^\s*(?:the\s+)?old\s+world\s*[:–-]?\s*/i,
  /^\s*black\s+library\s*[:–-]?\s*/i,
  /^\s*(?:kill\s*team|necromunda|blood\s*bowl|warcry|underworlds|legions\s+imperialis)\s*[:–-]?\s*/i,
  /^\s*(?:citadel|warhammer)?\s*colou?r\s*[:–-]?\s*/i,
  /^\s*citadel\s*[:–-]?\s+/i,
];
function gwTrimTitle(title) {
  let t = String(title || "");
  for (let pass = 0; pass < 6; pass++) {
    const before = t;
    for (const re of GW_STRIP) t = t.replace(re, "");
    if (t === before) break;
  }
  return t.trim() || title;
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
