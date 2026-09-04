/* ---------------- /buylist/api/* and /buylist/poc/* — our buylist on top of BinderPOS ----------------
   Question from the owner (2026-09-04): can our own front end sit on top of
   BinderPOS's buylist? Read from their own app (portal.binderpos.com/shopify/
   js/buylist.js?v=4, the page their shim opens in an iframe), the contract is:

     GET  /external/shopify/<storeId>/supportedGames
     GET  /api/cards/<game>/sets                       -> set names, a JSON array
     GET  /external/shopify/<storeId>/cards/<game>?setName=&keyword=&limit=20&offset=
          -> search hits: id, cardName, setName, game, imageUrl, rarity,
             variants[] {id, variantName, cardBuylistTypes[] {type, buyPrice,
             creditBuyPrice, productVariantId, maxPurchaseQuantity}}.
             400 above a limit of 20; an empty keyword with a set browses it.
     GET  /external/shopify/<storeId>/buylist/forMe?shopifyCustomerId=<id>
          -> the shopper's saved (draft) list, a JSON array
     POST /external/shopify/<storeId>/buylist/save/forMe?shopifyCustomerId=<id>
          body: that array                     -> saves the draft
     POST /external/shopify/<storeId>/buylist/submit/forMe?shopifyCustomerId=<id>
          body: {paymentType, buylistCards}     -> creates a real submission;
          paymentType is "Cash" or "Store Credit"; their app then saves []
     GET  /external/shopify/<storeId>/buylistConfirmationText

   The card object their app saves is
     {cardId, cardName, setName, game, type, imageUrl, quantity, cashBuyPrice,
      storeCreditBuyPrice, condition, conditionName, shopifyVariantId}
   and the shopper is identified by the query parameter and nothing else:
   their overlay sends the id the page knows.

   Ours (owner, 2026-09-04): the shop's sell page (preview theme,
   sections/page.liquid) loads public/buylist.js + .css from here and calls

     /buylist/api/games | sets?game= | search?q=&game=&set=&offset=
     /buylist/api/list | save | submit                 ?customer=<id>

   for the signed-in customer, whose id the theme writes into the page: the
   same trust as BinderPOS's own overlay, no more. Browser calls are limited
   to the shop's origins by CORS. /buylist/poc/* is the same set of routes
   pinned to the OWNER's id, for the test page at /buylist/poc/. Set symbols
   for Magic come from Scryfall's set list, matched by name. No key is used
   or exposed. */

const PORTAL = "https://portal.binderpos.com";
const STORE_ID = "a648e57a-678f-45eb-bae0-f8deb7940192";   // from BinderPOS's bootstrap for this shop
const OWNER = "3957471740057";                               // the owner's own Shopify customer id
const UA = "ExorBuylist/1.0 (+https://exorgames.com)";
const HEADERS = { accept: "application/json", "content-type": "application/json", "user-agent": UA };
const ORIGINS = ["https://exorgames.com", "https://www.exorgames.com", "https://most-wanted-ca.myshopify.com"];
const PAGE = 20;                       // BinderPOS answers 400 above this
const MAX_OFFSET = 400;
const MAX_CARDS = 100;
const PAYMENT_TYPES = ["Cash", "Store Credit"];
const MEMO_TTL = 6 * 3600 * 1000;
const memo = {};                       // per isolate: games, set lists, Scryfall symbols

const LIST_URL = (c) => `${PORTAL}/external/shopify/${STORE_ID}/buylist/forMe?shopifyCustomerId=${c}`;
const SAVE_URL = (c) => `${PORTAL}/external/shopify/${STORE_ID}/buylist/save/forMe?shopifyCustomerId=${c}`;
const SUBMIT_URL = (c) => `${PORTAL}/external/shopify/${STORE_ID}/buylist/submit/forMe?shopifyCustomerId=${c}`;
const CONFIRM_URL = `${PORTAL}/external/shopify/${STORE_ID}/buylistConfirmationText`;

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const h = { "cache-control": "no-store" };
  if (ORIGINS.includes(origin)) {
    h["access-control-allow-origin"] = origin;
    h["vary"] = "origin";
    h["access-control-allow-methods"] = "GET, POST, OPTIONS";
    h["access-control-allow-headers"] = "content-type";
    h["access-control-max-age"] = "600";
  }
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json", ...(headers || {}) },
  });
}

async function passthrough(url, init) {
  const r = await fetch(url, { ...init, headers: HEADERS, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 2000); }
  return { status: r.status, contentType: r.headers.get("content-type"), body };
}

const memoGet = (k) => { const m = memo[k]; return m && Date.now() - m.at < MEMO_TTL ? m.value : null; };
const memoSet = (k, value) => { memo[k] = { at: Date.now(), value }; };
const gameOf = (url) => String(url.searchParams.get("game") || "mtg").replace(/[^A-Za-z]/g, "").slice(0, 24) || "mtg";

// The list as their app stores it: objects with a cardId, quantity a string.
function cleanCards(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const c of v.slice(0, MAX_CARDS)) {
    if (!c || typeof c !== "object" || c.cardId == null) continue;
    const q = Math.max(1, Math.min(999, parseInt(c.quantity, 10) || 1));
    out.push({ ...c, quantity: String(q) });
  }
  return out;
}

// Their set list, whatever shape it comes in, as sorted unique names.
function normaliseSets(v) {
  const arr = Array.isArray(v) ? v : (v && (Array.isArray(v.sets) ? v.sets : Array.isArray(v.data) ? v.data : null));
  if (!arr) return [];
  const out = new Set();
  for (const s of arr) {
    const name = typeof s === "string" ? s : (s && (s.setName || s.name || s.label || s.set));
    if (typeof name === "string" && name.trim()) out.add(name.trim());
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// Their game list as {id, name}, the id being what /cards/<game> takes.
// supportedGames names only four of them ({gameId, gameName}); the rest come
// as a bare gameId. These are named here; an id nobody can name is left out
// rather than shown as a code (the e2e prints the raw list to catch new ones).
const GAME_NAMES = { one: "One Piece Card Game", lor: "Disney Lorcana", swu: "Star Wars: Unlimited", scr: "Sorcery: Contested Realm" };
function normaliseGames(v) {
  const arr = Array.isArray(v) ? v : (v && (Array.isArray(v.games) ? v.games : Array.isArray(v.data) ? v.data : null));
  if (!arr) return [];
  const isId = (x) => typeof x === "string" && /^[A-Za-z]+$/.test(x);
  const out = [];
  for (const g of arr) {
    if (typeof g === "string") { if (isId(g) && GAME_NAMES[g]) out.push({ id: g, name: GAME_NAMES[g] }); continue; }
    if (!g || typeof g !== "object") continue;
    const id = [g.gameId, g.game, g.code, g.id, g.name].find(isId);
    if (!id) continue;
    const name = [g.gameName, g.displayName, g.label, g.name].find((x) => typeof x === "string" && x.trim() && x.trim() !== id) || GAME_NAMES[id];
    if (name) out.push({ id, name: name.trim() });
  }
  return out;
}

// Scryfall's set list, name -> set symbol, for Magic. BinderPOS lists
// tokens, promos and prerelease cards as sets of their own; Scryfall draws
// those with the parent set's symbol, so they fall back to the parent.
async function scryfallSymbols() {
  const hit = memoGet("scryfall");
  if (hit) return hit;
  const r = await fetch("https://api.scryfall.com/sets", { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return {};
  const j = await r.json().catch(() => null);
  const byName = {};
  for (const s of (j && j.data) || []) {
    if (s && s.name && s.icon_svg_uri) byName[String(s.name).toLowerCase()] = s.icon_svg_uri;
  }
  if (Object.keys(byName).length) memoSet("scryfall", byName);
  return byName;
}
function symbolFor(byName, setName) {
  const n = String(setName).toLowerCase();
  if (byName[n]) return byName[n];
  const base = n.replace(/\s+(tokens?|prerelease promos|promos?|extras|art series|minigames|front cards|substitute cards|commander tokens|jumpstart front cards)$/, "");
  return byName[base] || null;
}

export async function serveBuylist(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(request);
  const m = url.pathname.match(/^\/buylist\/(poc|api)\/([a-z]*)$/);
  if (!m) return json({ error: "not found" }, 404, cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try { return await route(m[1], m[2], request, env, url, cors); }
  catch (e) { return json({ error: "upstream failed: " + ((e && e.message) || e) }, 502, cors); }
}

function customerOf(mode, url) {
  if (mode === "poc") return OWNER;
  const c = String(url.searchParams.get("customer") || "").replace(/\D/g, "");
  return c.length >= 6 && c.length <= 20 ? c : null;
}

async function route(mode, action, request, env, url, cors) {
  const cacheable = { ...cors, "cache-control": "public, max-age=3600" };

  if (action === "" && mode === "poc" && request.method === "GET") {
    const u = new URL("/buylist-poc.html", url);
    const res = await env.ASSETS.fetch(new Request(u.toString(), request));
    return new Response(res.body, { status: res.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  if (action === "games") {
    let games = memoGet("games");
    if (!games) {
      const r = await passthrough(`${PORTAL}/external/shopify/${STORE_ID}/supportedGames`, {});
      games = normaliseGames(r.body);
      if (!games.length) return json({ upstream: r.status, count: 0, games: [], raw: r.body }, 200, cors);
      memoSet("games", games);
    }
    return json({ count: games.length, games }, 200, cacheable);
  }

  if (action === "sets") {
    const game = gameOf(url);
    let names = memoGet("sets:" + game);
    if (!names) {
      const r = await passthrough(`${PORTAL}/api/cards/${game}/sets`, {});
      names = normaliseSets(r.body);
      if (!names.length) return json({ upstream: r.status, game, count: 0, sets: [], raw: typeof r.body === "string" ? r.body.slice(0, 300) : r.body }, 200, cors);
      memoSet("sets:" + game, names);
    }
    let symbols = {};
    if (game === "mtg") { try { symbols = await scryfallSymbols(); } catch { symbols = {}; } }
    const sets = names.map((name) => { const icon = symbolFor(symbols, name); return icon ? { name, icon } : { name }; });
    return json({ game, count: sets.length, withIcon: sets.filter((s) => s.icon).length, sets }, 200, cacheable);
  }

  if (action === "search") {
    const q = String(url.searchParams.get("q") || "").slice(0, 80);
    const game = gameOf(url);
    const set = String(url.searchParams.get("set") || "").slice(0, 120);
    const offset = Math.max(0, Math.min(MAX_OFFSET, parseInt(url.searchParams.get("offset"), 10) || 0));
    if (q.length < 2 && !set) return json({ error: "q too short" }, 400, cors);
    // The search BinderPOS's own app makes, no key, their page size.
    const qs = new URLSearchParams({ keyword: q, limit: String(PAGE), offset: String(offset) });
    if (set) qs.set("setName", set);
    const r = await passthrough(`${PORTAL}/external/shopify/${STORE_ID}/cards/${game}?${qs}`, {});
    const hits = Array.isArray(r.body) ? r.body : (r.body && Array.isArray(r.body.products) ? r.body.products : []);
    return json({ upstream: r.status, q, game, set, offset, count: hits.length, more: hits.length >= PAGE, hits, upstreamError: Array.isArray(r.body) ? undefined : r.body }, 200, cors);
  }

  const customer = customerOf(mode, url);
  if (!customer) return json({ error: "customer id required" }, 400, cors);

  if (action === "list") {
    const r = await passthrough(LIST_URL(customer), {});
    return json({ upstream: r.status, customer, list: r.body }, 200, cors);
  }

  if (action === "save" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "body must be JSON" }, 400, cors); }
    const cards = cleanCards(payload && payload.cards);
    if (!cards) return json({ error: "cards[] required" }, 400, cors);   // [] is allowed: that is how their app clears the list
    const r = await passthrough(SAVE_URL(customer), { method: "POST", body: JSON.stringify(cards) });
    return json({ upstream: r.status, sent: cards.length, reply: r.body }, 200, cors);
  }

  if (action === "submit" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "body must be JSON" }, 400, cors); }
    const paymentType = payload && PAYMENT_TYPES.includes(payload.paymentType) ? payload.paymentType : null;
    if (!paymentType) return json({ error: "paymentType must be one of " + PAYMENT_TYPES.join(", ") }, 400, cors);
    // Their app submits its own mirror of the list; ours sends the cart it
    // shows, falling back to the draft BinderPOS holds.
    let cards = cleanCards(payload.cards);
    if (!cards) {
      const r = await passthrough(LIST_URL(customer), {});
      cards = Array.isArray(r.body) ? r.body : [];
    }
    if (!cards.length) return json({ error: "the list is empty" }, 400, cors);
    const r = await passthrough(SUBMIT_URL(customer), { method: "POST", body: JSON.stringify({ paymentType, buylistCards: cards }) });
    const accepted = r.status >= 200 && r.status < 300 && !(r.body && r.body.actionPass === false);
    let cleared = null, confirmation = "";
    if (accepted) {
      // clearBuylist() in their app: the draft is saved back empty.
      const c = await passthrough(SAVE_URL(customer), { method: "POST", body: "[]" });
      cleared = c.status;
      const t = await passthrough(CONFIRM_URL, {}).catch(() => null);
      if (t && typeof t.body === "string") confirmation = t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return json({ upstream: r.status, paymentType, submitted: cards.length, accepted, cleared, confirmation, reply: r.body }, 200, cors);
  }

  return json({ error: "not found" }, 404, cors);
}
