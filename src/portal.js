/* BinderPOS portal, read-only (owner, 2026-09-09: "build" — our own pending
   buylist screen that pulls from BinderPOS but lets us control the look).

   The worker signs in exactly as the portal's own web app does: Firebase
   Identity Toolkit `verifyPassword` with the staff login held as worker
   secrets (BINDERPOS_LOGIN_EMAIL / BINDERPOS_LOGIN_PASSWORD, synced from the
   repo's Actions secrets on deploy), then calls the same API the portal
   calls with `Authorization: Bearer <idToken>`. Tokens live an hour; the
   refresh token renews them without a new password round-trip. The session
   is held in isolate memory only — nothing is written to storage — so a
   cold isolate costs one sign-in (~400 ms).

   Endpoints (mapped read-only by the portal-buylists / portal-shapes probes,
   .github/workflows on main):
     POST /graphql            GetBuylists — Prisma-style list with where/orderBy/take/skip
     GET  /api/buylist/byId/<id>/details   customer + lines (quoted prices per line)
     POST /api/buylists/cards/allPrices    live buy / credit / sell prices per card,
                                           per condition and finish
     GET  /api/variants                    the store's conditions + buy multipliers
   Everything here is a GET or a read query. There is no approve, decline,
   complete or edit path on purpose: those stay in BinderPOS, which the page
   links to for each buylist. */

const FIREBASE_KEY = "AIzaSyDYmFPRKRkVFM9SQvbtCAT8oWKh4RhBGXg"; // the portal's public web key (ships in its bundle)
const API = "https://api.binderpos.com";
export const PORTAL = "https://portal.binderpos.com";

let session = null;        // { idToken, refreshToken, exp } — this isolate only
let signInFailAt = 0;      // back off after a rejected sign-in (wrong password, locked account)

export function portalConfigured(env) {
  return !!(env && env.BINDERPOS_LOGIN_EMAIL && env.BINDERPOS_LOGIN_PASSWORD);
}

async function signIn(env) {
  if (Date.now() - signInFailAt < 120e3) throw new Error("portal sign-in was refused a moment ago; retry in two minutes");
  const r = await fetch("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=" + FIREBASE_KEY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: env.BINDERPOS_LOGIN_EMAIL, password: env.BINDERPOS_LOGIN_PASSWORD, returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.idToken) {
    signInFailAt = Date.now();
    const why = j && j.error && j.error.message ? String(j.error.message).slice(0, 80) : "HTTP " + r.status;
    throw new Error("portal sign-in failed (" + why + ")");
  }
  session = { idToken: j.idToken, refreshToken: j.refreshToken || null, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 };
}

async function refreshSession() {
  const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + FIREBASE_KEY, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(session.refreshToken),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error("portal token refresh failed (HTTP " + r.status + ")");
  session = { idToken: j.id_token, refreshToken: j.refresh_token || session.refreshToken, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}

async function idToken(env) {
  if (!portalConfigured(env)) throw new Error("portal login not configured (BINDERPOS_LOGIN_EMAIL / BINDERPOS_LOGIN_PASSWORD)");
  if (session && Date.now() < session.exp - 120e3) return session.idToken;
  if (session && session.refreshToken) {
    try { await refreshSession(); return session.idToken; } catch {}
  }
  await signIn(env);
  return session.idToken;
}

async function call(env, path, init, retry = true) {
  const tok = await idToken(env);
  const headers = Object.assign({ accept: "application/json", origin: PORTAL, referer: PORTAL + "/" }, (init && init.headers) || {}, { authorization: "Bearer " + tok });
  const r = await fetch(API + path, Object.assign({}, init || {}, { headers }));
  if (r.status === 401 && retry) { session = null; return call(env, path, init, false); }
  const text = await r.text();
  if (!r.ok) throw new Error("BinderPOS " + path.split("?")[0] + " answered " + r.status + (text ? ": " + text.replace(/\s+/g, " ").slice(0, 160) : ""));
  try { return JSON.parse(text); }
  catch { throw new Error("BinderPOS " + path.split("?")[0] + " sent something that is not JSON"); }
}
const get = (env, path) => call(env, path);
const post = (env, path, body) => call(env, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function gql(env, query, variables) {
  const j = await post(env, "/graphql", { query, variables });
  if (j && j.errors && j.errors.length) throw new Error("BinderPOS GraphQL: " + String(j.errors[0].message || "error").slice(0, 200));
  return (j && j.data) || {};
}

/* ---------------------------------------------------------------- list */

const LIST_Q = `query GetBuylists($where: ShopifyCustomerBuylistWhereInput, $orderBy: [ShopifyCustomerBuylistOrderByWithRelationInput!], $take: Int, $skip: Int) {
  ShopifyCustomerBuylist(take: $take, skip: $skip, where: $where, orderBy: $orderBy) {
    id dateSubmitted dateApproved dateCompleted paymentType approved completed
    ShopifyCustomer { firstName lastName email }
  }
}`;

// The portal's own routes for a buylist by its stage (its side menu:
// buylists/pending, buylists/approved, buylists/completed; a row opens
// <stage>/moreDetail/<id>). The page links there for approve / decline /
// complete, which stay in BinderPOS.
export function portalUrl(stage, id) {
  const seg = stage === "approved" ? "approved" : stage === "completed" ? "completed" : "pending";
  return PORTAL + "/#/buylists/" + seg + "/moreDetail/" + encodeURIComponent(String(id));
}

function stageOf(b) {
  if (b.completed) return "completed";
  if (b.approved) return "approved";
  return "pending";
}

function customerOf(c) {
  c = c || {};
  return {
    name: [c.firstName, c.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    email: String(c.email || ""),
  };
}

/* status: pending (submitted, not yet approved) | approved (approved, not
   completed) | completed. since: ISO lower bound on that stage's date —
   the store has pending rows back to 2022 that were never processed, so
   the page defaults to a recent window. There is no count query (the API
   has no aggregate); `more` is inferred from a full page. */
export async function listBuylists(env, { status = "pending", take = 50, skip = 0, since = null } = {}) {
  const st = status === "approved" || status === "completed" ? status : "pending";
  const dateField = st === "approved" ? "dateApproved" : st === "completed" ? "dateCompleted" : "dateSubmitted";
  const where = st === "approved" ? { approved: { equals: true }, completed: { equals: false } }
    : st === "completed" ? { completed: { equals: true } }
    : { approved: { equals: false }, completed: { equals: false } };
  where[dateField] = since ? { not: null, gte: since } : { not: null };
  take = Math.max(1, Math.min(100, take | 0));
  skip = Math.max(0, skip | 0);
  const data = await gql(env, LIST_Q, { where, take, skip, orderBy: [{ [dateField]: "desc" }] });
  const rows = (data.ShopifyCustomerBuylist || []).map((b) => ({
    id: String(b.id),
    stage: stageOf(b),
    submitted: b.dateSubmitted || null,
    approved: b.dateApproved || null,
    completed: b.dateCompleted || null,
    paymentType: b.paymentType || "",
    customer: customerOf(b.ShopifyCustomer),
    portalUrl: portalUrl(stageOf(b), b.id),
  }));
  return { ok: true, status: st, take, skip, since: since || null, rows, more: rows.length === take };
}

/* -------------------------------------------------------------- detail */

const num = (v) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };
const str = (v) => (v === null || v === undefined ? "" : String(v));
const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// The finish label as staff read it. BinderPOS stores "Normal" / "Non foil"
// for the plain printing and e.g. "Foil", "Reverse Holofoil", "1st Edition"
// for the rest.
function finishLabel(type, foil) {
  const t = str(type).trim();
  if (!t) return foil ? "Foil" : "";
  if (/^(normal|non[ -]?foil)$/i.test(t)) return "Non-foil";
  return t;
}

/* A buylist line as the portal's details endpoint sends it (fields confirmed
   by the shapes probe, 2026-09-09): id, cardName, setName, rarity, cardId,
   game, gameId, gameName, type, foil, imageUrl, storeSellPrice, cashBuyPrice,
   storeCreditBuyPrice, quantity, variantId, variantName, productVariantId,
   shopifyCustomerBuylistId, totalPrice. The prices are what the customer was
   quoted when they submitted. */
function normalizeLine(l) {
  const qty = Math.max(0, num(l.quantity) || 0);
  const cash = num(l.cashBuyPrice), credit = num(l.storeCreditBuyPrice);
  return {
    id: str(l.id),
    cardId: str(l.cardId),
    name: str(l.cardName || l.name),
    set: str(l.setName),
    rarity: str(l.rarity),
    game: str(l.gameName || l.game),
    gameId: str(l.gameId),
    finish: finishLabel(l.type, l.foil),
    finishRaw: str(l.type),
    condition: str(l.variantName),
    variantId: str(l.variantId),
    qty,
    cash, credit,
    sell: num(l.storeSellPrice),
    total: num(l.totalPrice),
    cashTotal: cash != null ? round2(cash * qty) : null,
    creditTotal: credit != null ? round2(credit * qty) : null,
    image: str(l.imageUrl),
    productVariantId: str(l.productVariantId),
    live: null,
  };
}

// Request body the portal sends to allPrices — its bundle's helper posts
// whatever array it is handed (`payload: t`, default []); the shapes probe
// establishes the element shape.
function pricesBody(lines) {
  return lines.map((l) => ({ cardId: l.cardId, variantId: l.variantId, type: l.type }));
}

/* Live buy prices for the lines' cards, keyed "cardId|condition|finish" ->
   { buy, credit, sell, max, overstock, overstockBuy, overstockCredit }.
   The response is an array of cards, each with variants[] (conditions:
   id, variantName, multiplier) and per-condition cardBuylistTypes[]
   (finishes: type "Normal"/"Foil"…, legacyType "Non foil"/"Foil", with
   storeSellPrice, buyPrice, creditBuyPrice, maxPurchaseQuantity,
   canPurchaseOverstock, overStockBuyPrice, creditOverstockBuyPrice,
   productVariantId). */
async function livePrices(env, rawLines) {
  const out = new Map();
  if (!rawLines.length) return out;
  const cards = await post(env, "/api/buylists/cards/allPrices", pricesBody(rawLines));
  for (const c of Array.isArray(cards) ? cards : []) {
    for (const v of c.variants || []) {
      for (const t of v.cardBuylistTypes || []) {
        const entry = {
          buy: num(t.buyPrice), credit: num(t.creditBuyPrice), sell: num(t.storeSellPrice),
          max: num(t.maxPurchaseQuantity), overstock: !!t.canPurchaseOverstock,
          overstockBuy: num(t.overStockBuyPrice), overstockCredit: num(t.creditOverstockBuyPrice),
          condition: str(v.variantName), finish: finishLabel(t.legacyType || t.type),
          productVariantId: str(t.productVariantId),
        };
        for (const f of [t.legacyType, t.type]) if (f) out.set(str(c.id) + "|" + norm(v.variantName) + "|" + norm(f), entry);
      }
    }
  }
  return out;
}

function priceFor(prices, ln) {
  if (!ln.cardId) return null;
  const exact = prices.get(ln.cardId + "|" + norm(ln.condition) + "|" + norm(ln.finishRaw));
  if (exact) return exact;
  // the same product variant, whatever it is labelled now
  if (ln.productVariantId) for (const v of prices.values()) if (v.productVariantId && v.productVariantId === ln.productVariantId) return v;
  return null;
}

export async function buylistDetail(env, id) {
  const d = await get(env, "/api/buylist/byId/" + encodeURIComponent(String(id)) + "/details");
  const raw = Array.isArray(d.shopifyCustomerBuylistDetails) ? d.shopifyCustomerBuylistDetails : [];
  const rawFinal = Array.isArray(d.finalBuylistDetails) ? d.finalBuylistDetails : [];
  const lines = raw.map(normalizeLine);
  const finalLines = rawFinal.map(normalizeLine);
  let prices = new Map(), priceError = null;
  try { prices = await livePrices(env, raw); }
  catch (e) { priceError = String((e && e.message) || e).slice(0, 200); }
  const totals = { lines: lines.length, cards: 0, quoted: 0, quotedCash: 0, quotedCredit: 0, liveCash: 0, liveCredit: 0, livePriced: 0 };
  let quotedKnown = true;
  for (const ln of lines) {
    ln.live = priceFor(prices, ln);
    totals.cards += ln.qty;
    if (ln.total != null) totals.quoted += ln.total; else quotedKnown = false;
    if (ln.cashTotal != null) totals.quotedCash += ln.cashTotal;
    if (ln.creditTotal != null) totals.quotedCredit += ln.creditTotal;
    if (ln.live) {
      totals.livePriced++;
      if (ln.live.buy != null) totals.liveCash += ln.live.buy * ln.qty;
      if (ln.live.credit != null) totals.liveCredit += ln.live.credit * ln.qty;
    }
  }
  for (const k of ["quoted", "quotedCash", "quotedCredit", "liveCash", "liveCredit"]) totals[k] = round2(totals[k]);
  if (!quotedKnown) totals.quoted = null;
  const finalTotals = finalLines.length ? {
    lines: finalLines.length,
    cards: finalLines.reduce((s, l) => s + l.qty, 0),
    cash: round2(finalLines.reduce((s, l) => s + (l.cashTotal || 0), 0)),
    credit: round2(finalLines.reduce((s, l) => s + (l.creditTotal || 0), 0)),
    quoted: finalLines.every((l) => l.total != null) ? round2(finalLines.reduce((s, l) => s + l.total, 0)) : null,
  } : null;
  const c = d.shopifyCustomer || {};
  const stage = d.completed ? "completed" : d.approved ? "approved" : "pending";
  return {
    ok: true,
    id: str(d.id != null ? d.id : id),
    stage,
    portalUrl: portalUrl(stage, d.id != null ? d.id : id),
    submitted: d.submittedDate || null,
    completed: d.completedDate || null,
    paymentType: str(d.paymentType),
    flags: { submitted: !!d.submitted, approved: !!d.approved, completed: !!d.completed, pushProducts: !!d.pushProducts, applyStoreCredit: !!d.applyStoreCredit },
    declinedReason: d.declinedReason || null,
    approvedNotes: d.approvedNotes || null,
    customer: {
      name: [c.firstName, c.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      email: str(c.email),
      phone: str(c.phone),
      shopifyId: c.shopifyId != null ? str(c.shopifyId) : "",
      storeCredit: num(c.storeCredit),
      notes: c.notes || null,
      lastOrderName: c.lastOrderName || null,
      totalSpent: num(c.totalSpent),
      disabled: !!c.disabled,
    },
    lines,
    totals,
    finalLines,
    finalTotals,
    priceError,
  };
}

/* ------------------------------------------------------------- routes */

const NO_STORE = { "content-type": "application/json", "cache-control": "no-store" };

export async function servePortal(request, env, url, staffOk) {
  const k = url.searchParams.get("k") || "";
  if (!(await staffOk(env, url.origin, k))) {
    return Response.json({ error: "staff key required" }, { status: 403, headers: NO_STORE });
  }
  try {
    if (url.pathname === "/portal/status.json") {
      const configured = portalConfigured(env);
      let signedIn = false, error = null;
      if (configured) { try { await idToken(env); signedIn = true; } catch (e) { error = String((e && e.message) || e).slice(0, 200); } }
      return Response.json({ ok: true, configured, signedIn, tokenExpires: session ? new Date(session.exp).toISOString() : null, error }, { headers: NO_STORE });
    }
    if (url.pathname === "/portal/buylists.json") {
      const days = url.searchParams.get("days");
      let since = url.searchParams.get("since") || null;
      if (!since && days && /^\d{1,4}$/.test(days)) since = new Date(Date.now() - Number(days) * 864e5).toISOString();
      if (since && !/^\d{4}-\d{2}-\d{2}/.test(since)) since = null;
      const out = await listBuylists(env, {
        status: url.searchParams.get("status") || "pending",
        take: parseInt(url.searchParams.get("take") || "50", 10) || 50,
        skip: parseInt(url.searchParams.get("skip") || "0", 10) || 0,
        since,
      });
      return Response.json(out, { headers: NO_STORE });
    }
    if (url.pathname === "/portal/buylist.json") {
      const id = (url.searchParams.get("id") || "").replace(/\D/g, "").slice(0, 16);
      if (!id) return Response.json({ error: "id required" }, { status: 400, headers: NO_STORE });
      return Response.json(await buylistDetail(env, id), { headers: NO_STORE });
    }
    return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    const status = /not configured/.test(msg) ? 503 : 502;
    return Response.json({ ok: false, error: msg }, { status, headers: NO_STORE });
  }
}
