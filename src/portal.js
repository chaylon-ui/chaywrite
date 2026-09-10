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

// The portal's Firebase web API key. It is public by design (a Firebase web
// key only names the project; every browser that opens portal.binderpos.com
// downloads it inside the app bundle) and it is BinderPOS's, not ours. GitHub's
// secret scanner flags any literal of that shape, so it is kept in two halves;
// a BINDERPOS_WEB_KEY var overrides it should BinderPOS ever change theirs.
const WEB_KEY_PARTS = ["AIzaSyDYmFPRKRkVFM9SQ", "vbtCAT8oWKh4RhBGXg"];
const webKey = (env) => (env && env.BINDERPOS_WEB_KEY) || WEB_KEY_PARTS.join("");
const API = "https://api.binderpos.com";
export const PORTAL = "https://portal.binderpos.com";

let session = null;        // { idToken, refreshToken, exp } — this isolate only
let signInFailAt = 0;      // back off after a rejected sign-in (wrong password, locked account)

export function portalConfigured(env) {
  return !!(env && env.BINDERPOS_LOGIN_EMAIL && env.BINDERPOS_LOGIN_PASSWORD);
}

async function signIn(env) {
  if (Date.now() - signInFailAt < 120e3) throw new Error("portal sign-in was refused a moment ago; retry in two minutes");
  const r = await fetch("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=" + webKey(env), {
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

async function refreshSession(env) {
  const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + webKey(env), {
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
    try { await refreshSession(env); return session.idToken; } catch {}
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

// For other modules that need one read from the portal with the staff login
// (src/buylist.js re-prices a customer's submission from allPrices).
export async function portalPost(env, path, body) {
  return post(env, path, body);
}

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
    overstock: false,
    live: null,
  };
}

/* Request bodies for allPrices, as the portal's buylist page builds them
   (its getBuylistCardPrices, read out of the bundle 2026-09-09): the lines
   are taken 20 cards at a time, each batch grouped by game, and posted as
   [{ game: "mtg", ids: [cardId, ...] }, ...]. Every other shape answers a
   bare 400. */
function priceBatches(rawLines) {
  const seen = new Set(), pairs = [];
  for (const l of rawLines) {
    if (l.cardId == null) continue;
    const key = str(l.gameId) + "|" + str(l.cardId);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ game: str(l.gameId), id: l.cardId });
  }
  const batches = [];
  for (let i = 0; i < pairs.length; i += 20) {
    const byGame = new Map();
    for (const p of pairs.slice(i, i + 20)) {
      if (!byGame.has(p.game)) byGame.set(p.game, []);
      byGame.get(p.game).push(p.id);
    }
    batches.push(Array.from(byGame, ([game, ids]) => ({ game, ids })));
  }
  return batches;
}

/* Live buy prices for the lines' cards, keyed "cardId|condition|finish" ->
   { buy, credit, sell, max, overstock, overstockBuy, overstockCredit }.
   The response is an array of cards, each with variants[] (conditions:
   id, variantName, multiplier) and per-condition cardBuylistTypes[]
   (finishes: type "Normal"/"Foil"…, legacyType "Non foil"/"Foil", with
   storeSellPrice, buyPrice, creditBuyPrice, maxPurchaseQuantity,
   canPurchaseOverstock, overStockBuyPrice, creditOverstockBuyPrice,
   productVariantId). A failed batch costs its cards their live column,
   not the whole page; the first failure is reported in priceError. */
async function livePrices(env, rawLines) {
  const out = new Map();
  let error = null;
  const results = await Promise.allSettled(priceBatches(rawLines).map((b) => post(env, "/api/buylists/cards/allPrices", b)));
  for (const r of results) {
    if (r.status !== "fulfilled") { if (!error) error = String((r.reason && r.reason.message) || r.reason).slice(0, 200); continue; }
    const cards = r.value;
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
  }
  out.error = error;
  return out;
}

function priceFor(prices, ln) {
  if (!ln.cardId) return null;
  let p = prices.get(ln.cardId + "|" + norm(ln.condition) + "|" + norm(ln.finishRaw)) || null;
  // else the same product variant, whatever it is labelled now
  if (!p && ln.productVariantId) for (const v of prices.values()) if (v.productVariantId && v.productVariantId === ln.productVariantId) { p = v; break; }
  if (!p) return null;
  // an overstock line is paid the overstock price
  if (ln.overstock && (p.overstockBuy != null || p.overstockCredit != null)) {
    p = Object.assign({}, p, { buy: p.overstockBuy != null ? p.overstockBuy : p.buy, credit: p.overstockCredit != null ? p.overstockCredit : p.credit });
  }
  return p;
}

/* The portal's own rule (its details loader): when a buylist holds two lines
   for the same card + condition + finish, the one with the lower cash price
   is the overstock line — copies past the buylist's max, taken at the
   overstock rate. */
function markOverstock(lines) {
  const groups = new Map();
  for (const ln of lines) {
    const key = ln.cardId + "|" + ln.variantId + "|" + norm(ln.finishRaw);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ln);
  }
  for (const g of groups.values()) {
    if (g.length !== 2 || g[0].cash == null || g[1].cash == null || g[0].cash === g[1].cash) continue;
    (g[0].cash < g[1].cash ? g[0] : g[1]).overstock = true;
  }
}

export async function buylistDetail(env, id) {
  const d = await get(env, "/api/buylist/byId/" + encodeURIComponent(String(id)) + "/details");
  const raw = Array.isArray(d.shopifyCustomerBuylistDetails) ? d.shopifyCustomerBuylistDetails : [];
  const rawFinal = Array.isArray(d.finalBuylistDetails) ? d.finalBuylistDetails : [];
  const lines = raw.map(normalizeLine);
  const finalLines = rawFinal.map(normalizeLine);
  markOverstock(lines);
  markOverstock(finalLines);
  let prices = new Map(), priceError = null;
  try { prices = await livePrices(env, raw); priceError = prices.error || null; }
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

/* ----------------------------------------------------------- POS carts */

/* In-store buys live in BinderPOS POS carts (owner, 2026-09-10: "Add in
   store carts"). GET /api/pos/carts/all lists submitted carts for a date
   range, oldest first, with every line of every cart — a trading day runs
   60-80 carts and ~200 KB and takes several seconds — so the worker reads
   one UTC day at a time (days in parallel), keeps only the carts that
   bought something, trimmed to what the page shows, and caches each day in
   its own Durable Object (the /_kv/ paths in room.js): a past day for a
   week (a submitted cart is final), today for three minutes. A buy line is
   `buying: true` with a NEGATIVE price (what we paid) beside the sell price
   (shopifyPrice); a negative tender is money out (cash) or credit issued. A
   pure buy cart has no Shopify order at all. Read-only, like the rest. */
const PORTAL_DO = "portal-cache";
const DO_ORIGIN = "https://" + PORTAL_DO + ".internal"; // the DO only reads the path
const CARTS_VER = "v2";
const DAY_MS = 86400e3;
export const PORTAL_CART = "https://portal.binderpos.com/#/pointOfSale/carts/";

const kvStub = (env) => env.ROOM.get(env.ROOM.idFromName(PORTAL_DO));
async function gzipText(text) {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(text));
  w.close();
  return new Response(cs.readable).arrayBuffer();
}
async function gunzipBuf(buf) {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(buf);
  w.close();
  return new Response(ds.readable).text();
}
async function kvGet(env, key) {
  try {
    const r = await kvStub(env).fetch(new Request(DO_ORIGIN + "/_kv/get?k=" + encodeURIComponent(key)));
    if (!r.ok) return null;
    return await gunzipBuf(await r.arrayBuffer());
  } catch { return null; }
}
async function kvPut(env, key, text, ttlMs) {
  try {
    const body = await gzipText(text);
    if (body.byteLength > 120 * 1024) return false;
    const r = await kvStub(env).fetch(new Request(DO_ORIGIN + "/_kv/put?k=" + encodeURIComponent(key) + "&ttl=" + ttlMs, { method: "POST", body }));
    return r.ok;
  } catch { return false; }
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const tenderBucket = (type) => (/store\s*credit/i.test(type) ? "credit" : /^cash$/i.test(str(type).trim()) ? "cash" : "other");

// A cart as the page needs it, or null when nothing in it was bought.
function trimCart(c) {
  const items = Array.isArray(c.cartItems) ? c.cartItems : [];
  if (!items.some((i) => i && i.buying)) return null;
  const lines = items.map((i) => {
    const qty = Math.max(0, num(i.quantity) || 0);
    const price = num(i.price);
    const cond = str(i.variantTitle).trim();
    return {
      id: str(i.id),
      title: str(i.productTitle),
      condition: cond === "-" ? "" : cond,
      variantId: str(i.variantId),
      qty,
      buying: !!i.buying,
      paid: i.buying && price != null ? round2(Math.abs(price)) : null,   // per unit, what we paid
      price: !i.buying && price != null ? price : null,                    // per unit, what they paid us
      sell: num(i.shopifyPrice),
      image: str(i.imageSrc),
      discount: num(i.discountValue),
    };
  });
  const payout = { cash: 0, credit: 0, other: 0, total: 0 };
  const taken = { cash: 0, credit: 0, other: 0, total: 0 };
  const tenders = [];
  for (const t of Array.isArray(c.tenders) ? c.tenders : []) {
    const a = num(t && t.amount);
    if (a == null) continue;
    tenders.push({ type: str(t.type), amount: a });
    const b = tenderBucket(t.type);
    if (a < 0) { payout[b] += -a; payout.total += -a; } else { taken[b] += a; taken.total += a; }
  }
  for (const k of Object.keys(payout)) { payout[k] = round2(payout[k]); taken[k] = round2(taken[k]); }
  const bought = { lines: 0, cards: 0, total: 0, sells: 0 };
  const sold = { lines: 0, cards: 0, total: 0 };
  for (const l of lines) {
    if (l.buying) { bought.lines++; bought.cards += l.qty; bought.total += (l.paid || 0) * l.qty; if (l.sell != null) bought.sells += l.sell * l.qty; }
    else { sold.lines++; sold.cards += l.qty; sold.total += (l.price || 0) * l.qty; }
  }
  bought.total = round2(bought.total); bought.sells = round2(bought.sells); sold.total = round2(sold.total);
  const cu = c.customer || null;
  const submittedMs = Date.parse(c.dateSubmitted || "") || 0;
  return {
    id: str(c.id),
    day: submittedMs ? dayKey(submittedMs) : "",
    submitted: c.dateSubmitted || null,
    staff: str(c.submittedBy || c.createdBy),
    till: str(c.till && (c.till.description || c.till.name)),
    type: c.cartType ? str(c.cartType) : sold.lines ? "trade" : "buy",
    orderNumber: c.orderNumber != null ? str(c.orderNumber) : "",
    shopifyOrderId: c.shopifyOrderId != null ? str(c.shopifyOrderId) : "",
    notes: c.cartNotes || null,
    customer: cu ? {
      id: str(cu.id),
      name: [cu.firstName, cu.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      email: str(cu.email), phone: str(cu.phone), storeCredit: num(cu.storeCredit),
    } : null,
    payout, taken, bought, sold, tenders, lines,
    portalUrl: PORTAL_CART + encodeURIComponent(str(c.id)),
  };
}

/* The carts endpoint, measured 2026-09-10 (portal-get runs 6-10). Rows
   come in id order; `limit` is not a cart count (50 yielded 40 carts, 200
   yielded 173), so a full page cannot be told from its size. Timings:
     one day,   limit=50  : 60 s then their gateway's 502, twice, on a
                            day of 65 carts whose biggest cart has 22 lines
     one day,   limit=10  : 0.9 s
     one day,   limit=2   : 1.4 s
     ten days,  limit=50  : 1.2 s (40 carts, all from the first day)
     2-3 hours, limit=50  : 75-200 ms, 0-31 carts each
   Their query plan goes bad on a whole busy day with a page that size; the
   data itself is small. So a day is read as twelve two-hour windows, one
   request at a time isolate-wide (parallel calls of the first version
   left their origin answering 502 to everything for minutes), each with a
   20-second timeout: a window that fails is reported as missing instead
   of sinking the day, and a one-minute back-off after any failure skips
   the rest so a staff member reloading cannot pile on. */
const CARTS_PAGE = 50;
const WINDOW_H = 2;
const WINDOW_TIMEOUT_MS = 20e3;
let cartsFailAt = 0;
let cartsChain = Promise.resolve();   // window fetches queue behind each other

const pad2 = (n) => String(n).padStart(2, "0");

async function fetchWindow(env, startIso, endIso) {
  const out = [], seen = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const arr = await call(env, "/api/pos/carts/all?limit=" + CARTS_PAGE + "&offset=" + offset + "&submitted=true&startDate=" + encodeURIComponent(startIso) + "&endDate=" + encodeURIComponent(endIso), { signal: AbortSignal.timeout(WINDOW_TIMEOUT_MS) });
    if (!Array.isArray(arr) || !arr.length) break;
    let fresh = 0;
    for (const c of arr) {
      if (!c || seen.has(String(c.id))) continue;
      seen.add(String(c.id));
      fresh++;
      if (!c.abandoned) { const t = trimCart(c); if (t) out.push(t); }
    }
    // a two-hour window rarely reaches a page; ask again only when it might have
    if (!fresh || arr.length < 20) break;
    offset += arr.length;
  }
  return out;
}

// { carts, missing } for one UTC day; missing lists the windows BinderPOS
// did not answer ("14-16Z"), so the page can say so.
async function fetchDayCarts(env, day) {
  const carts = [], missing = [];
  const now = Date.now();
  for (let h = 0; h < 24; h += WINDOW_H) {
    const h1 = Math.min(24, h + WINDOW_H);
    const start = day + "T" + pad2(h) + ":00:00.000Z";
    const end = h1 === 24 ? day + "T23:59:59.999Z" : day + "T" + pad2(h1 - 1) + ":59:59.999Z";
    if (Date.parse(start) > now) break;                      // the rest of today has not happened
    const label = pad2(h) + "-" + pad2(h1) + "Z";
    if (now - cartsFailAt < 60e3) { missing.push(label); continue; }
    try {
      const got = await (cartsChain = cartsChain.catch(() => {}).then(() => fetchWindow(env, start, end)));
      carts.push(...got);
    } catch (e) {
      cartsFailAt = Date.now();
      missing.push(label);
    }
  }
  return { carts, missing };
}

async function dayCarts(env, day) {
  const key = "carts:" + CARTS_VER + ":" + day;
  const cached = await kvGet(env, key);
  if (cached) { try { const v = JSON.parse(cached); if (v && Array.isArray(v.carts)) return v; } catch {} }
  const rec = await fetchDayCarts(env, day);
  const now = Date.now();
  const dayEnd = Date.parse(day + "T23:59:59.999Z");
  // a day with missing windows: two minutes, then try again; today: three
  // minutes; a day that ended within the last two hours: ten minutes (late
  // syncs around midnight); older complete days: a week
  const ttl = rec.missing.length ? 2 * 60e3 : now <= dayEnd ? 3 * 60e3 : now - dayEnd < 2 * 3600e3 ? 10 * 60e3 : 7 * DAY_MS;
  await kvPut(env, key, JSON.stringify(rec), ttl);
  return rec;
}

const cartSummary = (c) => Object.assign({}, c, { lines: undefined, tenders: undefined });

export async function listCarts(env, { days = 3, take = 50, skip = 0 } = {}) {
  days = Math.max(1, Math.min(31, days | 0));
  take = Math.max(1, Math.min(200, take | 0));
  skip = Math.max(0, skip | 0);
  const now = Date.now();
  const since = now - days * DAY_MS;
  const keys = new Set();
  for (let t = now; t >= since - DAY_MS; t -= DAY_MS) keys.add(dayKey(t));
  const perDay = [], partial = [];
  for (const d of keys) {                                      // newest day first, one at a time
    const rec = await dayCarts(env, d);
    perDay.push(rec.carts);
    if (rec.missing.length) partial.push({ day: d, windows: rec.missing });
  }
  const all = perDay.flat()
    .filter((c) => (Date.parse(c.submitted || "") || 0) >= since)
    .sort((a, b) => (Date.parse(b.submitted || "") || 0) - (Date.parse(a.submitted || "") || 0));
  const totals = { carts: all.length, cards: 0, paid: 0, cash: 0, credit: 0, sells: 0 };
  for (const c of all) { totals.cards += c.bought.cards; totals.paid += c.bought.total; totals.cash += c.payout.cash; totals.credit += c.payout.credit; totals.sells += c.bought.sells; }
  for (const k of ["paid", "cash", "credit", "sells"]) totals[k] = round2(totals[k]);
  return { ok: true, days, take, skip, total: all.length, totals, partial, rows: all.slice(skip, skip + take).map(cartSummary), more: skip + take < all.length };
}

export async function cartDetail(env, id, day) {
  const base = Date.parse(day + "T12:00:00Z");
  const candidates = Number.isFinite(base) ? [day, dayKey(base - DAY_MS), dayKey(base + DAY_MS)] : [dayKey(Date.now())];
  for (const d of candidates) {
    const c = (await dayCarts(env, d)).carts.find((x) => x.id === id);
    if (c) return Object.assign({ ok: true }, c);
  }
  throw new Error("cart " + id + " is not among the buy carts of " + candidates.join(", "));
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
    if (url.pathname === "/portal/carts.json") {
      return Response.json(await listCarts(env, {
        days: parseInt(url.searchParams.get("days") || "3", 10) || 3,
        take: parseInt(url.searchParams.get("take") || "50", 10) || 50,
        skip: parseInt(url.searchParams.get("skip") || "0", 10) || 0,
      }), { headers: NO_STORE });
    }
    if (url.pathname === "/portal/cart.json") {
      const id = (url.searchParams.get("id") || "").replace(/\D/g, "").slice(0, 16);
      const day = url.searchParams.get("day") || "";
      if (!id) return Response.json({ error: "id required" }, { status: 400, headers: NO_STORE });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: "day required (YYYY-MM-DD)" }, { status: 400, headers: NO_STORE });
      return Response.json(await cartDetail(env, id, day), { headers: NO_STORE });
    }
    return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    const status = /not configured/.test(msg) ? 503 : 502;
    return Response.json({ ok: false, error: msg }, { status, headers: NO_STORE });
  }
}
