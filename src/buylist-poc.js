/* ---------------- /buylist/poc/* — proof of concept, owner's account only ----------------
   Question from the owner (2026-09-04): can our own front end sit on top of
   BinderPOS's buylist? Read from their own app (portal.binderpos.com/shopify/
   js/buylist.js?v=4, the page their shim opens in an iframe), the contract is:

     GET  /external/shopify/<storeId>/buylist/forMe?shopifyCustomerId=<id>
          -> the shopper's saved (draft) list, a JSON array
     POST /external/shopify/<storeId>/buylist/save/forMe?shopifyCustomerId=<id>
          body: that array                     -> saves the draft
     POST /external/shopify/<storeId>/buylist/submit/forMe?shopifyCustomerId=<id>
          body: {paymentType, buylistCards}     -> creates a real submission

   and the card object the app saves is
     {cardId, cardName, setName, game, type, imageUrl, quantity, cashBuyPrice,
      storeCreditBuyPrice, condition, conditionName, shopifyVariantId}
   built from a search hit: e.id / e.cardName / e.setName / e.game /
   e.imageUrl, a variant n (n.id = condition, n.variantName), and that
   variant's cardBuylistTypes entry p (p.type, p.buyPrice, p.creditBuyPrice,
   p.productVariantId, p.maxCanBuy).

   The shopper is identified by the query parameter and nothing else. So:

   - search  GET  /buylist/poc/search?q=&game=   keyed buylist search, first
                                                  hits raw, so the shape is
                                                  seen rather than assumed
   - list    GET  /buylist/poc/list              the owner's saved list

   Phase one is read-only. The save half - POST buylist/save/forMe with the
   card array, which would put a card into the owner's own draft list for
   them to see in BinderPOS's overlay - is held back until the owner
   explicitly approves a write into their list. Only the OWNER's own
   customer id is ever used (the store owner's account, chosen by them for
   this test). There is deliberately no submit route: a submission creates a
   money-bearing record and stays on BinderPOS's own button. Nothing here
   exposes the key. Remove this file when the proof of concept is decided. */

const PORTAL = "https://portal.binderpos.com";
const STORE_ID = "a648e57a-678f-45eb-bae0-f8deb7940192";   // from BinderPOS's bootstrap for this shop
const STORE_URL = "most-wanted-ca.myshopify.com";
const OWNER = "3957471740057";                               // the owner's own Shopify customer id
const UA = "ExorBuylistPoc/0.1 (+workers.dev)";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

async function passthrough(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 2000); }
  return { status: r.status, contentType: r.headers.get("content-type"), body };
}

export async function serveBuylistPoc(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/buylist/poc/search") {
    const q = String(url.searchParams.get("q") || "").slice(0, 80);
    const game = String(url.searchParams.get("game") || "mtg").slice(0, 24);
    if (q.length < 2) return json({ error: "q too short" }, 400);
    const key = env && env.BINDERPOS_API_KEY;
    if (!key) return json({ error: "no key on this worker" }, 503);
    const qs = new URLSearchParams({ storeUrl: STORE_URL, keyword: q, game, buyingEnabled: "true", limit: "3", offset: "0" });
    const r = await passthrough(`${PORTAL}/external/shopify/buylist/cards/forStore?${qs}`, {
      headers: { accept: "application/json", authorization: key, "user-agent": UA },
    });
    // Trim: the first two hits, each with its first two variants, so the
    // shape is readable in a log without dumping a whole set.
    let hits = r.body;
    if (Array.isArray(hits)) hits = hits.slice(0, 2).map(trimHit);
    else if (hits && Array.isArray(hits.products)) hits = hits.products.slice(0, 2).map(trimHit);
    return json({ upstream: r.status, q, game, hits });
  }

  if (path === "/buylist/poc/list") {
    const r = await passthrough(`${PORTAL}/external/shopify/${STORE_ID}/buylist/forMe?shopifyCustomerId=${OWNER}`, {
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
    });
    return json({ upstream: r.status, contentType: r.contentType, customer: OWNER, list: r.body });
  }

  // Phase one is read-only. The save half (POST buylist/save/forMe with the
  // card array) is held back until the owner explicitly approves a write
  // into their own BinderPOS draft list.

  return json({ error: "not found" }, 404);
}

function trimHit(h) {
  if (!h || typeof h !== "object") return h;
  const out = {};
  for (const k of Object.keys(h)) {
    if (k === "variants" && Array.isArray(h[k])) out.variants = h[k].slice(0, 2);
    else out[k] = h[k];
  }
  return out;
}
