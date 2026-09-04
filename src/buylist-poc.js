/* ---------------- /buylist/poc/* — proof of concept, owner's account only ----------------
   Question from the owner (2026-09-04): can our own front end sit on top of
   BinderPOS's buylist? Read from their own app (portal.binderpos.com/shopify/
   js/buylist.js?v=4, the page their shim opens in an iframe), the contract is:

     GET  /external/shopify/<storeId>/cards/<game>?keyword=&limit=&offset=
          -> search hits: id, cardName, setName, game, imageUrl, rarity,
             variants[] {id, variantName, cardBuylistTypes[] {type, buyPrice,
             creditBuyPrice, productVariantId, maxPurchaseQuantity}}
     GET  /external/shopify/<storeId>/buylist/forMe?shopifyCustomerId=<id>
          -> the shopper's saved (draft) list, a JSON array
     POST /external/shopify/<storeId>/buylist/save/forMe?shopifyCustomerId=<id>
          body: that array                     -> saves the draft
     POST /external/shopify/<storeId>/buylist/submit/forMe?shopifyCustomerId=<id>
          body: {paymentType, buylistCards}     -> creates a real submission;
          their app then saves [] (its clearBuylist) and shows
     GET  /external/shopify/<storeId>/buylistConfirmationText

   The card object their app saves is
     {cardId, cardName, setName, game, type, imageUrl, quantity, cashBuyPrice,
      storeCreditBuyPrice, condition, conditionName, shopifyVariantId}
   and the shopper is identified by the query parameter and nothing else.

   Second proof of concept (owner, 2026-09-04): a whole buylist front end of
   ours, public/buylist-poc.html + .js, on top of these calls:

     GET  /buylist/poc/            the page
     GET  /buylist/poc/search?q=&game=&limit=
     GET  /buylist/poc/list
     POST /buylist/poc/save        {cards}                 the draft (the cart)
     POST /buylist/poc/submit      {paymentType, cards?}   the real submission,
                                   then the draft is cleared like their app does

   Every call acts on the OWNER's own customer id, hard-wired here: this is
   a test on the owner's account, chosen by them, and the page carries no
   proof of who is using it. A shipped version must verify the shopper
   (Shopify app-proxy signature) before acting for any id. No key is used
   or exposed. Remove this file and public/buylist-poc.* when decided. */

const PORTAL = "https://portal.binderpos.com";
const STORE_ID = "a648e57a-678f-45eb-bae0-f8deb7940192";   // from BinderPOS's bootstrap for this shop
const OWNER = "3957471740057";                               // the owner's own Shopify customer id
const UA = "ExorBuylistPoc/0.2 (+workers.dev)";
const HEADERS = { accept: "application/json", "content-type": "application/json", "user-agent": UA };
const MAX_CARDS = 60;
const PAYMENT_TYPES = ["Cash", "Store Credit"];
const SETS_TTL = 6 * 3600 * 1000;
const setsMemo = {};   // game -> { at, list }; per isolate, so a cheap memo, not a cache

const LIST_URL = `${PORTAL}/external/shopify/${STORE_ID}/buylist/forMe?shopifyCustomerId=${OWNER}`;
const SAVE_URL = `${PORTAL}/external/shopify/${STORE_ID}/buylist/save/forMe?shopifyCustomerId=${OWNER}`;
const SUBMIT_URL = `${PORTAL}/external/shopify/${STORE_ID}/buylist/submit/forMe?shopifyCustomerId=${OWNER}`;
const CONFIRM_URL = `${PORTAL}/external/shopify/${STORE_ID}/buylistConfirmationText`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

async function passthrough(url, init) {
  const r = await fetch(url, { ...init, headers: HEADERS, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 2000); }
  return { status: r.status, contentType: r.headers.get("content-type"), body };
}

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

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

export async function serveBuylistPoc(request, env) {
  try { return await route(request, env); }
  catch (e) { return json({ error: "upstream failed: " + ((e && e.message) || e) }, 502); }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/buylist/poc/" && request.method === "GET") {
    const u = new URL("/buylist-poc.html", url);
    const res = await env.ASSETS.fetch(new Request(u.toString(), request));
    return new Response(res.body, { status: res.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  if (path === "/buylist/poc/search") {
    const q = String(url.searchParams.get("q") || "").slice(0, 80);
    const game = String(url.searchParams.get("game") || "mtg").replace(/[^A-Za-z]/g, "").slice(0, 24);
    const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get("limit"), 10) || 20));
    const set = String(url.searchParams.get("set") || "").slice(0, 120);
    if (q.length < 2 && !set) return json({ error: "q too short" }, 400);
    // The search BinderPOS's own app makes - no key. Their form's set field
    // is named setName, so that is passed on; with a set and no keyword it
    // browses the set. Their API answers 400 to a page above 20, so the
    // page size is theirs.
    const qs = new URLSearchParams({ keyword: q, limit: String(limit), offset: "0" });
    if (set) qs.set("setName", set);
    const r = await passthrough(`${PORTAL}/external/shopify/${STORE_ID}/cards/${game}?${qs}`, {});
    let hits = Array.isArray(r.body) ? r.body : (r.body && Array.isArray(r.body.products) ? r.body.products : []);
    const upstreamCount = hits.length;
    if (set) hits = hits.filter((h) => h && String(h.setName || "").trim() === set);
    return json({ upstream: r.status, q, game, set, upstreamCount, count: hits.length, hits, upstreamError: Array.isArray(r.body) ? undefined : r.body });
  }

  if (path === "/buylist/poc/sets") {
    const game = String(url.searchParams.get("game") || "mtg").replace(/[^A-Za-z]/g, "").slice(0, 24);
    const m = setsMemo[game];
    if (m && Date.now() - m.at < SETS_TTL) return json({ game, count: m.list.length, sets: m.list, memo: true });
    // The list their own search page loads.
    const r = await passthrough(`${PORTAL}/api/cards/${game}/sets`, {});
    const list = normaliseSets(r.body);
    if (list.length) setsMemo[game] = { at: Date.now(), list };
    return json({ upstream: r.status, game, count: list.length, sets: list, sample: list.length ? undefined : (typeof r.body === "string" ? r.body.slice(0, 300) : r.body) });
  }

  if (path === "/buylist/poc/list") {
    const r = await passthrough(LIST_URL, {});
    return json({ upstream: r.status, contentType: r.contentType, customer: OWNER, list: r.body });
  }

  if (path === "/buylist/poc/save" && request.method === "POST") {
    const payload = await readBody(request);
    if (!payload) return json({ error: "body must be JSON" }, 400);
    if (payload.customer && String(payload.customer) !== OWNER) return json({ error: "proof of concept writes only to the owner's own list" }, 403);
    const cards = cleanCards(payload.cards);
    if (!cards) return json({ error: "cards[] required" }, 400);   // [] is allowed: that is how their app clears the list
    const r = await passthrough(SAVE_URL, { method: "POST", body: JSON.stringify(cards) });
    return json({ upstream: r.status, contentType: r.contentType, sent: cards.length, reply: r.body });
  }

  if (path === "/buylist/poc/submit" && request.method === "POST") {
    const payload = await readBody(request);
    if (!payload) return json({ error: "body must be JSON" }, 400);
    if (payload.customer && String(payload.customer) !== OWNER) return json({ error: "proof of concept submits only for the owner's own account" }, 403);
    const paymentType = PAYMENT_TYPES.includes(payload.paymentType) ? payload.paymentType : null;
    if (!paymentType) return json({ error: "paymentType must be one of " + PAYMENT_TYPES.join(", ") }, 400);
    // Their app submits its own mirror of the list; ours sends the cart it
    // shows, falling back to the draft BinderPOS holds.
    let cards = cleanCards(payload.cards);
    if (!cards) {
      const r = await passthrough(LIST_URL, {});
      cards = Array.isArray(r.body) ? r.body : [];
    }
    if (!cards.length) return json({ error: "the list is empty" }, 400);
    const r = await passthrough(SUBMIT_URL, { method: "POST", body: JSON.stringify({ paymentType, buylistCards: cards }) });
    const accepted = r.status >= 200 && r.status < 300 && !(r.body && r.body.actionPass === false);
    let cleared = null, confirmation = "";
    if (accepted) {
      // clearBuylist() in their app: the draft is saved back empty.
      const c = await passthrough(SAVE_URL, { method: "POST", body: "[]" });
      cleared = c.status;
      const t = await passthrough(CONFIRM_URL, {}).catch(() => null);
      if (t && typeof t.body === "string") confirmation = t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return json({ upstream: r.status, contentType: r.contentType, paymentType, submitted: cards.length, accepted, cleared, confirmation, reply: r.body });
  }

  return json({ error: "not found" }, 404);
}
