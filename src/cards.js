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
  return t.replace(/\s*(reverse\s+)?holofoil\s*/i, " ").replace(/\s*foil\s*/i, " ").trim();
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

/* Phone-driven search. With the SHOPIFY_ADMIN_TOKEN secret set the worker
   searches the FULL catalogue via the Admin API (predictive search caps at
   10 hits, which is why "Charizard" came up short); without it, it falls
   back to Shopify's public predictive search + per-handle hydration.
   No price floor here — searching is deliberate. */
export async function serveSearch(request, env) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  const out = { q, count: 0, cards: [] };
  if (q.length < 2) return Response.json(out, { headers: { "cache-control": "no-store" } });
  try {
    const token = env && env.SHOPIFY_ADMIN_TOKEN;
    let prods = null;
    if (token) {
      try { prods = await adminSearch(q, env); } catch { prods = null; }
    }
    if (!prods) prods = await suggestSearch(q, headers);
    const built = buildCards(prods.filter(Boolean), { minPrice: 0, perLane: 99 });
    out.cards = built.cards.slice(0, 80); out.count = out.cards.length;
    out.game = built.game; out.colorNames = built.colorNames;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return Response.json(out, { headers: { "cache-control": "public, max-age=30" } });
}

/* Full-catalogue title search through the Admin API (up to 40 products). */
async function adminSearch(q, env) {
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const safe = q.replace(/[*"\\()]/g, " ").trim();
  if (!safe) return null;
  const gql = `query($q:String!){products(first:40,query:$q){edges{node{
    title handle productType tags description(truncateAt:400) featuredImage{url}
    variants(first:30){edges{node{id title price availableForSale}}}}}}}`;
  const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query: gql, variables: { q: `status:active title:*${safe}*` } }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error("admin search HTTP " + r.status);
  const j = await r.json();
  const edges = j?.data?.products?.edges;
  if (!Array.isArray(edges)) throw new Error("admin search shape");
  return edges.map(({ node: p }) => ({
    title: p.title, handle: p.handle, product_type: p.productType, tags: p.tags || [], body_html: p.description || "",
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
        title: p.title, handle: p.handle, product_type: p.type, tags: p.tags || [], body_html: p.description || "",
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

/* The pickup board: every OPEN draft order, newest first — the POS tablets
   can't list third-party drafts natively, so /pickups shows them all (staff
   PIN-gated at the worker layer). Needs SHOPIFY_ADMIN_TOKEN. */
export async function servePickups(env) {
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return Response.json({ error: "no admin token" }, { status: 503, headers: { "access-control-allow-origin": "*" } });
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const gql = `{ draftOrders(first: 40, query: "status:open", reverse: true) { edges { node {
    id name createdAt totalPrice tags note
    lineItems(first: 25) { edges { node { title quantity variant { id } } } } } } } }`;
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
      note: String(n.note || "").slice(0, 140),
      items: (n.lineItems?.edges || []).map(({ node: li }) => ({
        t: li.title,
        q: li.quantity,
        // Numeric variant id so the POS tile can drop the line straight into
        // the POS cart (shopify.cart.addLineItem wants the bare number).
        v: Number(String(li.variant?.id || "").replace(/\D/g, "")) || 0,
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

/* In-stock filter for the "Alternatives in stock" strip. The TV/phone
   BROWSERS query strictlybetter.eu themselves (its API is CORS-open to
   browsers, but its Cloudflare zone 301-loops Worker-originated fetches),
   then hand the suggested names here to be mapped onto our actual stock.
   Names are |-separated — card names contain commas. */
const BETTER_TTL_S = 600;

export async function serveInstock(request, ctx) {
  const url = new URL(request.url);
  const names = String(url.searchParams.get("names") || "")
    .split("|").map((s) => s.trim().slice(0, 80)).filter((s) => s.length >= 2).slice(0, 8);
  const out = { count: 0, cards: [] };
  if (!names.length) return Response.json(out, { headers: { "cache-control": "no-store" } });
  const cache = caches.default;
  const cacheKey = new Request(new URL("/instock.json?n=" + encodeURIComponent(names.join("|").toLowerCase()), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const headers = { accept: "application/json", "user-agent": "ExorShowcaseTV/1.0 (+workers.dev)" };
  for (const n of names) {
    if (out.cards.length >= 4) break;
    const card = await findInStock(n, headers);
    if (card) out.cards.push(card);
  }
  out.count = out.cards.length;
  const res = Response.json(out, { headers: { "cache-control": `public, max-age=${BETTER_TTL_S}` } });
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

    const set = (p.title.match(/\[([^\]]+)\]/) || [, ""])[1];
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

    const set = (p.title.match(/\[([^\]]+)\]/) || [, ""])[1];
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
  const cards = [];
  for (const p of products) {
    const eligible = (p.variants || []).filter((v2) => v2.available && +v2.price > 0 && +v2.price < MAX_PRICE);
    if (eligible.length === 0) continue;
    const v = eligible.reduce((a, b) => (+b.price < +a.price ? b : a)); // lead with the cheapest in-stock option
    const raw = String(p.title || "")
      .replace(/^dragon\s*shield\s*(sleeves)?\s*/i, "").replace(/\s*\d+\s*ct\.?\s*$/i, "").trim() || p.title;
    // The catalogue titles SHOUT IN CAPS — settle them into Title Case for
    // the cue card and speech bubble (already-mixed-case titles untouched).
    const name = raw === raw.toUpperCase()
      ? raw.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (m, a, b) => a + b.toUpperCase())
      : raw;
    if (seen.has(name)) continue;
    seen.add(name);
    cards.push({
      name,
      color: "C",
      set: "Dragon Shield",
      game: "sleeves",
      type: "Card Sleeves",
      price: (+v.price).toFixed(2),
      foil: false,
      condition: "",
      variants: variantsOf(eligible, "sleeves"),
      image: (p.images && p.images[0] && p.images[0].src) || null,
      variantId: v.id,
      url: "https://exorgames.com/products/" + p.handle,
    });
  }
  return { game: "sleeves", colorNames: {}, cards };
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
