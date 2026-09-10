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

import { HOLD_DO } from "./hold.js";
import { portalConfigured, portalPost } from "./portal.js";

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

/* Server-side truth for what leaves the browser (owner, 2026-09-10: "Go").
   A saved or submitted card object carries the prices the page had, and
   neither BinderPOS's overlay nor ours used to recompute them, so an edited
   request could quote any price. At submit every line now takes BinderPOS's
   CURRENT buy prices for its card, condition and finish from the portal's
   allPrices (staff login, src/portal.js), its quantity is capped at what the
   store will take, a line the store takes none of is dropped (or priced at
   the over-limit rate when the rule allows), and the Shopify variant id is
   the portal's. Fails closed: no portal answer, no submission. */
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const normType = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const NAME_TO_ID = {
  "magic: the gathering": "mtg", "magic the gathering": "mtg", "pokémon": "pokemon", "pokemon": "pokemon", "yu-gi-oh!": "yugioh", "yugioh": "yugioh",
  "one piece card game": "one", "disney lorcana": "lor", "lorcana": "lor", "star wars: unlimited": "swu", "flesh and blood": "fleshAndBlood",
  "sorcery: contested realm": "scr", "riftbound": "riftbound",
};
const KNOWN_IDS = ["mtg", "pokemon", "yugioh", "one", "ones", "lor", "swu", "fleshAndBlood", "scr", "riftbound"];
// BinderPOS's supported games as {id, name}, memoised for MEMO_TTL; [] when
// they cannot be fetched (the tables above still cover the known names).
async function gamesList(env) {
  let games = memoGet("games");
  if (!games) {
    const r = await passthrough(`${PORTAL}/external/shopify/${STORE_ID}/supportedGames`, {}).catch(() => null);
    games = r ? normaliseGames(r.body) : [];
    if (games.length) memoSet("games", games);
  }
  return games;
}
function gameIdOf(c, games) {
  // A card object carries the game as a name ("Magic: The Gathering" on the
  // search hits the page adds from) or as an id ("mtg").
  games = games || [];
  for (const raw of [c.gameId, c.game]) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const lc = s.toLowerCase();
    const known = KNOWN_IDS.find((k) => k.toLowerCase() === lc) || games.map((g) => String(g.id || "")).find((k) => k && k.toLowerCase() === lc);
    if (known) return known;
    if (NAME_TO_ID[lc]) return NAME_TO_ID[lc];
    const hit = games.find((g) => String(g.name || "").toLowerCase() === lc);
    if (hit && hit.id) return String(hit.id);
    if (/^[A-Za-z]{2,24}$/.test(s)) return s;   // an id we have not met; send it as-is
  }
  return "mtg";
}
async function repriceCards(env, cards) {
  if (!portalConfigured(env)) throw new Error("the price check is not configured on the worker");
  const games = await gamesList(env);
  const seen = new Set(), pairs = [];
  for (const c of cards) {
    const game = gameIdOf(c, games);
    const key = game + "|" + String(c.cardId);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ game, id: Number(c.cardId) });
  }
  const priced = new Map();   // "cardId|conditionId|finish" -> today's offer
  for (let i = 0; i < pairs.length; i += 20) {              // the portal's own batch size, one request at a time
    const grouped = new Map();
    for (const p of pairs.slice(i, i + 20)) { if (!grouped.has(p.game)) grouped.set(p.game, []); grouped.get(p.game).push(p.id); }
    const res = await portalPost(env, "/api/buylists/cards/allPrices", Array.from(grouped, ([game, ids]) => ({ game, ids })));
    for (const card of Array.isArray(res) ? res : []) {
      for (const v of card.variants || []) {
        for (const t of v.cardBuylistTypes || []) {
          const entry = {
            buy: Number(t.buyPrice), credit: Number(t.creditBuyPrice), max: Number(t.maxPurchaseQuantity) || 0,
            overstock: !!t.canPurchaseOverstock, overBuy: t.overStockBuyPrice, overCredit: t.creditOverstockBuyPrice,
            productVariantId: t.productVariantId,
          };
          for (const f of [t.type, t.legacyType]) if (f) priced.set(String(card.id) + "|" + String(v.id) + "|" + normType(f), entry);
        }
      }
    }
  }
  const out = [], dropped = [], changed = [], capped = [];
  for (const c of cards) {
    const label = String(c.cardName || c.cardId) + " · " + String(c.conditionName || c.condition) + (c.type && c.type !== "Normal" ? " · " + c.type : "");
    const p = priced.get(String(c.cardId) + "|" + String(c.condition) + "|" + normType(c.type));
    if (!p || !Number.isFinite(p.buy) || !Number.isFinite(p.credit)) { dropped.push(label + " (not on the buylist right now)"); continue; }
    let buy = p.buy, credit = p.credit, max = p.max;
    if (!(max > 0)) {
      if (p.overstock && (p.overBuy != null || p.overCredit != null)) {
        buy = p.overBuy != null ? Number(p.overBuy) : buy;
        credit = p.overCredit != null ? Number(p.overCredit) : credit;
        max = 999;
      } else { dropped.push(label + " (limit reached)"); continue; }
    }
    let q = Math.max(1, parseInt(c.quantity, 10) || 1);
    if (q > max) { capped.push(label + " (" + q + " to " + max + ")"); q = max; }
    if (Math.abs(Number(c.cashBuyPrice) - buy) > 0.005 || Math.abs(Number(c.storeCreditBuyPrice) - credit) > 0.005) {
      changed.push(label + " (" + money(c.cashBuyPrice) + " cash / " + money(c.storeCreditBuyPrice) + " credit is now " + money(buy) + " / " + money(credit) + ")");
    }
    out.push({ ...c, quantity: String(q), cashBuyPrice: buy, storeCreditBuyPrice: credit, shopifyVariantId: p.productVariantId != null ? p.productVariantId : c.shopifyVariantId });
  }
  return { cards: out, dropped, changed, capped };
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
    // BinderPOS's current prices and limits replace whatever the browser sent.
    let repriced;
    try { repriced = await repriceCards(env, cards); }
    catch (e) {
      return json({ error: "We could not confirm today's prices with BinderPOS (" + String((e && e.message) || e).slice(0, 120) + "). Nothing was sent; please try again in a minute.", accepted: false }, 502, cors);
    }
    cards = repriced.cards;
    if (!cards.length) {
      return json({ error: "None of these cards can be bought right now: " + repriced.dropped.join("; "), accepted: false, repriced: { dropped: repriced.dropped, changed: [], capped: [] } }, 409, cors);
    }
    if (url.searchParams.get("dry") === "1") {
      // A rehearsal (the deploy smoke uses it): what would be sent, without sending.
      return json({ dry: true, paymentType, submitted: cards.length,
        cards: cards.map((c) => ({ cardId: c.cardId, cardName: c.cardName, condition: c.conditionName, type: c.type, quantity: c.quantity, cash: c.cashBuyPrice, credit: c.storeCreditBuyPrice, shopifyVariantId: c.shopifyVariantId })),
        repriced: { changed: repriced.changed, capped: repriced.capped, dropped: repriced.dropped } }, 200, cors);
    }
    const r = await passthrough(SUBMIT_URL(customer), { method: "POST", body: JSON.stringify({ paymentType, buylistCards: cards }) });
    const accepted = r.status >= 200 && r.status < 300 && !(r.body && r.body.actionPass === false);
    let cleared = null, confirmation = "";
    if (accepted) {
      // Tell the hold-on-arrival log which cards this buylist listed, so
      // their arrival can be attributed when staff complete it (src/hold.js).
      try {
        await env.ROOM.get(env.ROOM.idFromName(HOLD_DO)).fetch(new Request(new URL("/_hold/buylist", url).toString(), {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ number: r.body && r.body.data != null ? String(r.body.data) : "", customer, paymentType,
            cards: cards.slice(0, 100).map((c) => ({ n: c.cardName, s: c.setName, c: c.conditionName, t: c.type, q: c.quantity })) }),
        }));
      } catch {}
      // clearBuylist() in their app: the draft is saved back empty.
      const c = await passthrough(SAVE_URL(customer), { method: "POST", body: "[]" });
      cleared = c.status;
      const t = await passthrough(CONFIRM_URL, {}).catch(() => null);
      if (t && typeof t.body === "string") confirmation = t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return json({ upstream: r.status, paymentType, submitted: cards.length, accepted, cleared, confirmation, reply: r.body,
      repriced: { changed: repriced.changed, capped: repriced.capped, dropped: repriced.dropped } }, 200, cors);
  }

  return json({ error: "not found" }, 404, cors);
}
