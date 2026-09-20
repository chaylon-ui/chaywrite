/* ---------------- 9Pocket by Exor: our approval before BinderPOS ----------------
   Owner, 2026-09-19: "recreate the cart system using binderpos sort of like
   the buylist system ... when submitted it goes to a staging area and then
   when we approve the stage it then goes through binderpos as normal to
   increase card quantities"; then "lists out the buylists similar to
   binderpos pending list ... go into a new page where it's like a worksheet
   ... call it '9Pocket by Exor'"; 2026-09-20: add cards to a submitted
   buylist, email + password accounts, an admin section with permissions.

   What changes: /buylist/api/submit (src/buylist.js) used to forward the
   repriced list to BinderPOS on the spot. With 9Pocket on it stores the
   list here instead, gives it a number (9P-1001, 9P-1002, ...), emails the
   customer their list and our instructions (src/stage-email.js), tells
   staff, and answers the shopper that the list is with us for review.
   Staff sign in to /9pocket (src/stage-auth.js: accounts and sessions live
   here too): a list of every buylist, and a worksheet per buylist where
   quantities and prices can be changed, cards added, then approve or
   reject. Approve makes the very call submit used to make -
   submitToBinderPos() in src/buylist.js, the same function, with the
   customer's own Shopify id - so from BinderPOS's point of view nothing is
   different: a buylist arrives under that customer, staff complete it in the
   portal as they do today, the customer is paid and the stock rises. Reject
   keeps the list here with a note and sends nothing anywhere.

   Prices at approval: BinderPOS's prices of the day are re-read (repriceCards,
   the same step submit takes) for every line EXCEPT one a staff member typed
   a price for on the worksheet - that price is kept, because the worksheet is
   where staff correct the estimate (owner: "edit prices"). A card added by
   staff goes through the same repriceCards check first, so only a card the
   store is buying today can be added, at the day's price.

   Accounts: role admin (everything, plus /9pocket/admin) or staff with
   per-account permissions (edit, prices, add, approve, email). The first
   admin is created once on /9pocket/setup, which only the staff PIN opens
   and only while no account exists. Every event on a buylist records who.

   Off switch: the worker var BUYLIST_STAGING="off" returns submit to the
   direct path with no deploy. Default is on.

   Storage: its own Durable Object instance (STAGE_DO, class BinderRoom in
   room.js like the hold, price and enrichment jobs), /_stage/* paths only.
     st:<id>     one record: {id, number, ts, customer, customerName,
                 customerEmail, paymentType, cards[], totals, repriced,
                 status: staged|approved|rejected, note, customerNote,
                 events[{ts, action, by}], bp: {number, upstream, cleared}
                 once approved, email: {status, at, to, id|error}}
     seq         the last buylist number handed out
     u:<email>   an account {email, name, role, perms, hash, salt, iter,
                 disabled, createdAt, createdBy}
     s:<token>   a session {email, at, exp}
     la:<email>  failed-login counter {n, at}
   Approved and rejected records are pruned after KEEP_MS by the alarm;
   staged ones are never pruned - a forgotten list should stay visible. */

import { repriceCards, submitToBinderPos, cleanCards } from "./buylist.js";
import { ntfyTarget } from "./autoprice.js";
import { buildEmail, sendEmail, emailConfigured } from "./stage-email.js";
import { BASE, renderLoginForm, renderSetup, renderAdmin, renderList, renderSheet, renderDenied, safeImage } from "./stage-ui.js";
import { hashPassword, verifyPassword, newToken, parseCookies, sessionCookie, clearCookie, publicUser, can, permsFrom, normEmail, validEmail, SESSION_DAYS, LOCK_AFTER, LOCK_MS, COOKIE, MIN_PASSWORD } from "./stage-auth.js";
export { safeImage };

export const STAGE_DO = "buylist-stage";
const KEEP_MS = 90 * 86400e3;
const PRUNE_EVERY_MS = 24 * 3600e3;
const MAX_LIST = 300;
const MINE_MAX = 20;
const STATUSES = ["staged", "approved", "rejected"];
const SEQ_START = 1000;                      // the first buylist is 9P-1001
const LEGACY = "/buylist/staged";            // the page's first address; redirects
const FIRST_ADMIN_EMAIL = "chaylon@exorgames.com";   // pre-filled on the setup page (owner, 2026-09-20)

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const SHOP = (env) => (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
const by = (b) => String((b && b.by) || "").slice(0, 160);

export function stagingOn(env) {
  return String((env && env.BUYLIST_STAGING) || "on").trim().toLowerCase() !== "off";
}
export const numberOf = (seq) => "9P-" + String(seq);

/* ---------------- pure helpers (test/stage.test.mjs) ---------------- */

// Cash and store-credit totals of a repriced list, plus the unit count.
export function totalsOf(cards) {
  let cash = 0, credit = 0, units = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    const q = Math.max(0, parseInt(c && c.quantity, 10) || 0);
    units += q;
    cash += q * (Number(c && c.cashBuyPrice) || 0);
    credit += q * (Number(c && c.storeCreditBuyPrice) || 0);
  }
  return { cash: Math.round(cash * 100) / 100, credit: Math.round(credit * 100) / 100, units, lines: Array.isArray(cards) ? cards.length : 0 };
}

// A record as it is stored: what the shopper sent (already repriced by
// buylist.js), the payment they chose, who they are (name and email from
// Shopify, looked up by the worker at submit - staff-only fields), and
// where it stands. The number is handed out by the DO (put).
export function shapeRecord(b, now) {
  const customer = digits(b && b.customer);
  const cards = cleanCards(b && b.cards) || [];
  const paymentType = String((b && b.paymentType) || "").slice(0, 20);
  if (!customer || !cards.length || !paymentType) return null;
  const ts = now;
  const id = tsKey(ts) + "-" + Math.random().toString(36).slice(2, 6);
  const repriced = b && b.repriced && typeof b.repriced === "object"
    ? { changed: strs(b.repriced.changed), capped: strs(b.repriced.capped), dropped: strs(b.repriced.dropped) }
    : { changed: [], capped: [], dropped: [] };
  const customerName = String((b && b.customerName) || "").trim().slice(0, 120);
  const customerEmail = String((b && b.customerEmail) || "").trim().slice(0, 160);
  return { id, number: "", ts, customer, customerName, customerEmail, paymentType, cards, totals: totalsOf(cards), repriced, status: "staged", note: "", events: [{ ts, action: "submitted" }], bp: null, email: null };
}
const strs = (v) => (Array.isArray(v) ? v.slice(0, 100).map((s) => String(s).slice(0, 200)) : []);

// What the shopper may see of their own records: status, number and
// totals, never the staff note, the customer's Shopify fields or the reply.
export function mineView(rec) {
  return {
    id: rec.id, number: rec.number || "", ts: rec.ts, status: rec.status, paymentType: rec.paymentType, totals: rec.totals,
    cards: (rec.cards || []).map((c) => ({ cardName: c.cardName, setName: c.setName, conditionName: c.conditionName, type: c.type, quantity: c.quantity, cash: c.cashBuyPrice, credit: c.storeCreditBuyPrice })),
    reference: rec.bp && rec.bp.number ? rec.bp.number : null,
    decidedAt: (rec.events || []).filter((e) => e.action === "approved" || e.action === "rejected").map((e) => e.ts).pop() || null,
    customerNote: rec.status === "rejected" && rec.customerNote ? rec.customerNote : "",
  };
}

// The staff edit from the worksheet: quantities (0 removes), and cash /
// store-credit prices. Every card kept must be one of the record's own
// (matched by card, condition and finish), so an edit can never add a line
// - adding is its own action (addCard) with its own BinderPOS check. A
// price that differs from the line's marks it staffPriced, and approval
// keeps that price instead of the day's.
export function applyEdit(rec, edit) {
  const want = new Map();
  for (const e of Array.isArray(edit) ? edit : []) if (e) want.set(lineKey(e), e);
  const cards = [];
  for (const c of rec.cards || []) {
    const e = want.get(lineKey(c));
    if (!e) { cards.push(c); continue; }        // untouched line
    const q = e.quantity == null || e.quantity === "" ? (parseInt(c.quantity, 10) || 0) : Math.max(0, Math.min(999, parseInt(e.quantity, 10) || 0));
    if (q <= 0) continue;                        // q of 0 removes it
    const n = { ...c, quantity: String(q) };
    for (const f of ["cashBuyPrice", "storeCreditBuyPrice"]) {
      const p = priceOf(e[f]);
      if (p != null && Math.abs(p - (Number(c[f]) || 0)) > 0.005) { n[f] = p; n.staffPriced = true; }
    }
    cards.push(n);
  }
  return cards;
}
export const lineKey = (c) => String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase();
function priceOf(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}
const lineLabel = (c) => String(c.cardName || c.cardId) + " · " + String(c.conditionName || c.condition) + (c.type && c.type !== "Normal" ? " · " + c.type : "");

// What an edit changes, for the permission check: quantities/removals need
// "edit", prices need "prices".
export function editNeeds(before, after) {
  const orig = new Map((before || []).map((c) => [lineKey(c), c]));
  let qty = (after || []).length !== (before || []).length, prices = false;
  for (const c of after || []) {
    const o = orig.get(lineKey(c));
    if (!o) { qty = true; continue; }
    if (String(o.quantity) !== String(c.quantity)) qty = true;
    if (Math.abs((Number(o.cashBuyPrice) || 0) - (Number(c.cashBuyPrice) || 0)) > 0.005 || Math.abs((Number(o.storeCreditBuyPrice) || 0) - (Number(c.storeCreditBuyPrice) || 0)) > 0.005) prices = true;
  }
  return { qty, prices };
}

// A card a staff member adds on the worksheet, as BinderPOS's card shape,
// before the day's-price check. Null when the essentials are missing.
export function shapeAdded(c) {
  if (!c || typeof c !== "object") return null;
  const cardId = String(c.cardId == null ? "" : c.cardId).replace(/\D/g, "").slice(0, 16);
  const cardName = String(c.cardName || "").trim().slice(0, 200);
  const condition = String(c.condition == null ? "" : c.condition).trim().slice(0, 16);
  if (!cardId || !cardName || !condition) return null;
  return {
    cardId: Number(cardId), cardName, setName: String(c.setName || "").trim().slice(0, 200), game: String(c.game || "").trim().slice(0, 60),
    type: String(c.type || "Normal").trim().slice(0, 40), condition: /^\d+$/.test(condition) ? Number(condition) : condition, conditionName: String(c.conditionName || "").trim().slice(0, 60),
    quantity: String(Math.max(1, Math.min(999, parseInt(c.quantity, 10) || 1))), imageUrl: safeImage(c.imageUrl), cashBuyPrice: 0, storeCreditBuyPrice: 0,
  };
}

// Merge an added card into a record's lines: the same card, condition and
// finish adds to the existing line (capped at 999), otherwise a new line.
export function mergeAdded(cards, card) {
  const out = (cards || []).slice();
  const i = out.findIndex((c) => lineKey(c) === lineKey(card));
  if (i < 0) { out.push(card); return { cards: out, merged: false }; }
  const q = Math.min(999, (parseInt(out[i].quantity, 10) || 0) + (parseInt(card.quantity, 10) || 0));
  out[i] = { ...out[i], quantity: String(q) };
  return { cards: out, merged: true };
}

// The cards that go to BinderPOS at approval: the day's prices from
// repriceCards for every line, except a staff-priced line keeps its staff
// prices. The staffPriced flag itself never leaves (their card shape).
export function mergeApproval(recCards, repriced) {
  const locked = new Map((recCards || []).filter((c) => c.staffPriced).map((c) => [lineKey(c), c]));
  const kept = [];
  const cards = (repriced.cards || []).map((c) => {
    const { staffPriced, ...clean } = c;
    const l = locked.get(lineKey(c));
    if (!l) return clean;
    kept.push(lineLabel(l) + " (" + money(l.cashBuyPrice) + " cash / " + money(l.storeCreditBuyPrice) + " credit; the day's would be " + money(c.cashBuyPrice) + " / " + money(c.storeCreditBuyPrice) + ")");
    return { ...clean, cashBuyPrice: l.cashBuyPrice, storeCreditBuyPrice: l.storeCreditBuyPrice };
  });
  const lockedLabels = [...locked.values()].map(lineLabel);
  const changed = (repriced.changed || []).filter((s) => !lockedLabels.some((l) => s.startsWith(l + " (")));
  return { cards, notes: { changed, capped: repriced.capped || [], dropped: repriced.dropped || [], kept } };
}

// Who a Shopify customer id is, from the Admin API (SHOPIFY_ADMIN_TOKEN, the
// same token the hold report reads order customers with). Best-effort: no
// token, a slow answer or a missing customer leaves both blank and the staff
// page still shows the id link. Never called for the shopper's own view.
export async function lookupCustomer(env, id) {
  const blank = { name: "", email: "" };
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  const cid = digits(id);
  if (!token || !cid) return blank;
  try {
    const r = await fetch(`https://${SHOP(env)}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: "query($id:ID!){customer(id:$id){displayName email}}", variables: { id: "gid://shopify/Customer/" + cid } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return blank;
    const j = await r.json().catch(() => null);
    const c = j && j.data && j.data.customer;
    if (!c) return blank;
    return { name: String(c.displayName || "").trim().slice(0, 120), email: String(c.email || "").trim().slice(0, 160) };
  } catch { return blank; }
}

/* ---------------- the DO side ---------------- */

export async function stageDoFetch(cx, request, url) {
  await armAlarm(cx);
  const p = url.pathname;
  const post = request.method === "POST";
  if (p === "/_stage/put" && post) {
    const rec = shapeRecord(await bodyOf(request), cx.now());
    if (!rec) return doJson({ ok: false, error: "customer, paymentType and cards[] required" }, 400);
    rec.number = await nextNumber(cx);
    await cx.storage.put("st:" + rec.id, rec);
    return doJson({ ok: true, id: rec.id, number: rec.number, totals: rec.totals });
  }
  if (p === "/_stage/get") {
    const rec = await cx.storage.get("st:" + String(url.searchParams.get("id") || "").slice(0, 40));
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (!rec.number) { rec.number = await nextNumber(cx); await cx.storage.put("st:" + rec.id, rec); }
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/list") {
    const status = String(url.searchParams.get("status") || "");
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days"), 10) || 30));
    const since = cx.now() - days * 86400e3;
    const all = await listAll(cx);
    for (const r of all) if (!r.number) { r.number = await nextNumber(cx); await cx.storage.put("st:" + r.id, r); }   // lists from before numbers existed
    const out = all.filter((r) => (status ? r.status === status : true) && (r.status === "staged" || r.ts >= since)).slice(0, MAX_LIST);
    const counts = {};
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    return doJson({ ok: true, count: out.length, counts, records: out });
  }
  if (p === "/_stage/mine") {
    const customer = digits(url.searchParams.get("customer"));
    if (!customer) return doJson({ ok: false, error: "customer required" }, 400);
    const all = await listAll(cx);
    return doJson({ ok: true, records: all.filter((r) => r.customer === customer).slice(0, MINE_MAX).map(mineView) });
  }
  if (p === "/_stage/mark" && post) {
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    const status = String(b.status || "");
    if (!STATUSES.includes(status)) return doJson({ ok: false, error: "bad status" }, 400);
    if (rec.status !== "staged" && status !== rec.status) return doJson({ ok: false, error: "already " + rec.status }, 409);
    rec.status = status;
    if (typeof b.note === "string") rec.note = b.note.slice(0, 500);
    if (typeof b.customerNote === "string") rec.customerNote = b.customerNote.slice(0, 300);
    if (b.bp && typeof b.bp === "object") rec.bp = { number: String(b.bp.number || "").slice(0, 40), upstream: Number(b.bp.upstream) || 0, cleared: b.bp.cleared == null ? null : Number(b.bp.cleared), sentAt: cx.now() };
    if (b.repricedAtApproval && typeof b.repricedAtApproval === "object") rec.repricedAtApproval = { changed: strs(b.repricedAtApproval.changed), capped: strs(b.repricedAtApproval.capped), dropped: strs(b.repricedAtApproval.dropped), kept: strs(b.repricedAtApproval.kept) };
    if (Array.isArray(b.cards) && b.cards.length) { rec.cards = b.cards; rec.totals = totalsOf(b.cards); }
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: status === "staged" ? "edited" : status, by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/edit" && post) {
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (rec.status !== "staged") return doJson({ ok: false, error: "already " + rec.status }, 409);
    const cards = applyEdit(rec, b.edit);
    if (!cards.length) return doJson({ ok: false, error: "an edit cannot remove every card; reject the list instead" }, 400);
    const changed = JSON.stringify(cards) !== JSON.stringify(rec.cards);
    rec.cards = cards; rec.totals = totalsOf(cards);
    if (typeof b.note === "string") rec.note = b.note.slice(0, 500);
    if (changed) rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "edited", by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/add" && post) {
    // A card staff added on the worksheet, already checked against the day's
    // buylist by the worker (addCard below).
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (rec.status !== "staged") return doJson({ ok: false, error: "already " + rec.status }, 409);
    const card = b.card && typeof b.card === "object" && b.card.cardId != null ? b.card : null;
    if (!card) return doJson({ ok: false, error: "card required" }, 400);
    if ((rec.cards || []).length >= 100) return doJson({ ok: false, error: "a buylist holds at most 100 lines" }, 400);
    const m = mergeAdded(rec.cards, card);
    rec.cards = m.cards; rec.totals = totalsOf(m.cards);
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: (m.merged ? "added to " : "added ") + lineLabel(card) + " ×" + card.quantity, by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec, merged: m.merged });
  }
  if (p === "/_stage/who" && post) {
    // Backfill of the customer's name on a record that was staged before the
    // lookup existed (or when Shopify was slow at submit). No event: nothing
    // about the list changed.
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    rec.customerName = String(b.customerName || "").trim().slice(0, 120);
    rec.customerEmail = String(b.customerEmail || "").trim().slice(0, 160);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/email" && post) {
    // What happened to the customer's email (sent / failed / not configured).
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    const e = b.email && typeof b.email === "object" ? b.email : {};
    rec.email = { status: String(e.status || "failed").slice(0, 20), at: cx.now(), to: String(e.to || "").slice(0, 160), id: String(e.id || "").slice(0, 64), error: String(e.error || "").slice(0, 200) };
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: rec.email.status === "sent" ? "emailed" : "email " + rec.email.status, by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  // ---- accounts and sessions (src/stage-auth.js does the hashing) ----
  if (p === "/_stage/users") {
    const m = await cx.storage.list({ prefix: "u:" });
    const users = [...m.values()].filter((u) => u && u.email).map(publicUser).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return doJson({ ok: true, users });
  }
  if (p === "/_stage/user") {
    const u = await cx.storage.get("u:" + normEmail(url.searchParams.get("email")));
    return u ? doJson({ ok: true, user: u }) : doJson({ ok: false, error: "no such account" }, 404);
  }
  if (p === "/_stage/user/put" && post) {
    const b = await bodyOf(request);
    const u = b.user && typeof b.user === "object" ? b.user : null;
    const email = normEmail(u && u.email);
    if (!u || !email) return doJson({ ok: false, error: "email required" }, 400);
    const cur = await cx.storage.get("u:" + email);
    if (b.create && cur) return doJson({ ok: false, error: "an account with that email already exists" }, 409);
    if (!b.create && !cur) return doJson({ ok: false, error: "no such account" }, 404);
    const next = { ...(cur || { createdAt: cx.now() }), ...u, email };
    await cx.storage.put("u:" + email, next);
    if (next.disabled) await dropSessions(cx, email);
    return doJson({ ok: true, user: publicUser(next) });
  }
  if (p === "/_stage/user/del" && post) {
    const email = normEmail((await bodyOf(request)).email);
    if (!(await cx.storage.get("u:" + email))) return doJson({ ok: false, error: "no such account" }, 404);
    await cx.storage.delete("u:" + email);
    await dropSessions(cx, email);
    return doJson({ ok: true });
  }
  if (p === "/_stage/session/put" && post) {
    const b = await bodyOf(request);
    const token = String(b.token || ""), email = normEmail(b.email);
    if (!/^[0-9a-f]{64}$/.test(token) || !email) return doJson({ ok: false, error: "bad session" }, 400);
    await cx.storage.put("s:" + token, { email, at: cx.now(), exp: cx.now() + SESSION_DAYS * 86400e3 });
    return doJson({ ok: true });
  }
  if (p === "/_stage/session") {
    const token = String(url.searchParams.get("token") || "");
    const s = /^[0-9a-f]{64}$/.test(token) ? await cx.storage.get("s:" + token) : null;
    if (!s) return doJson({ ok: false, error: "no session" }, 404);
    if (s.exp < cx.now()) { await cx.storage.delete("s:" + token); return doJson({ ok: false, error: "expired" }, 404); }
    return doJson({ ok: true, email: s.email });
  }
  if (p === "/_stage/session/del" && post) {
    const token = String((await bodyOf(request)).token || "");
    if (/^[0-9a-f]{64}$/.test(token)) await cx.storage.delete("s:" + token);
    return doJson({ ok: true });
  }
  if (p === "/_stage/attempt" && post) {
    // Failed-login counter per address: LOCK_AFTER failures within LOCK_MS
    // lock the address until LOCK_MS after the last failure.
    const b = await bodyOf(request);
    const email = normEmail(b.email);
    if (!email) return doJson({ ok: false, error: "email required" }, 400);
    const key = "la:" + email;
    if (b.ok) { await cx.storage.delete(key); return doJson({ ok: true, locked: false }); }
    const cur = (await cx.storage.get(key)) || { n: 0, at: 0 };
    const n = cx.now() - cur.at > LOCK_MS ? 1 : cur.n + 1;
    await cx.storage.put(key, { n, at: cx.now() });
    return doJson({ ok: true, locked: n >= LOCK_AFTER, attempts: n });
  }
  if (p === "/_stage/locked") {
    const cur = await cx.storage.get("la:" + normEmail(url.searchParams.get("email")));
    return doJson({ ok: true, locked: !!(cur && cur.n >= LOCK_AFTER && cx.now() - cur.at < LOCK_MS) });
  }
  if (p === "/_stage/health") {
    const all = await listAll(cx);
    const counts = {};
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    const users = await cx.storage.list({ prefix: "u:" });
    return doJson({ ok: true, counts, oldestStaged: all.filter((r) => r.status === "staged").map((r) => r.ts).sort()[0] || null, lastNumber: numberOf((await cx.storage.get("seq")) || SEQ_START), accounts: users.size });
  }
  return doJson({ ok: false, error: "not found" }, 404);
}

async function dropSessions(cx, email) {
  const m = await cx.storage.list({ prefix: "s:" });
  const gone = [];
  for (const [k, v] of m) if (v && v.email === email) gone.push(k);
  if (gone.length) await cx.storage.delete(gone);
}

async function nextNumber(cx) {
  const seq = ((await cx.storage.get("seq")) || SEQ_START) + 1;
  await cx.storage.put("seq", seq);
  return numberOf(seq);
}

async function listAll(cx) {
  const m = await cx.storage.list({ prefix: "st:" });
  const out = [];
  for (const v of m.values()) if (v && v.id) out.push(v);
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

async function armAlarm(cx) {
  try { if ((await cx.storage.getAlarm()) == null) await cx.storage.setAlarm(cx.now() + PRUNE_EVERY_MS); } catch {}
}

export async function stageDoAlarm(cx) {
  try {
    const cutoff = cx.now() - KEEP_MS;
    const m = await cx.storage.list({ prefix: "st:" });
    const gone = [];
    for (const [k, v] of m) if (v && v.status !== "staged" && (v.ts || 0) < cutoff) gone.push(k);
    const s = await cx.storage.list({ prefix: "s:" });
    for (const [k, v] of s) if (!v || (v.exp || 0) < cx.now()) gone.push(k);
    if (gone.length) await cx.storage.delete(gone);
  } catch (e) { cx.log("stage: prune: " + ((e && e.message) || e)); }
  try { await cx.storage.setAlarm(cx.now() + PRUNE_EVERY_MS); } catch {}
}

/* ---------------- the worker side ---------------- */

const stub = (env) => env.ROOM.get(env.ROOM.idFromName(STAGE_DO));
async function doCall(env, origin, path, body) {
  const r = await stub(env).fetch(new Request(origin + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined));
  let j; try { j = await r.json(); } catch { j = { ok: false, error: "bad reply" }; }
  return j;
}

// Called by buylist.js in place of the BinderPOS call. Returns the record
// id and number; the customer email and the staff push are best-effort and
// never fail the submission.
export async function stageSubmit(env, url, { customer, paymentType, cards, repriced }) {
  const who = await lookupCustomer(env, customer);
  const j = await doCall(env, url.origin, "/_stage/put", { customer, customerName: who.name, customerEmail: who.email, paymentType, cards, repriced });
  if (!j.ok) throw new Error(j.error || "could not stage the list");
  try { await emailCustomer(env, url, (await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(j.id))).record, ""); } catch {}
  try { await notifyStaff(env, url, { id: j.id, number: j.number, customer, customerName: who.name, paymentType, totals: j.totals }); } catch {}
  return { id: j.id, number: j.number, totals: j.totals };
}

// The shopper's own records, for the sell page.
export async function stageMine(env, url, customer) {
  const j = await doCall(env, url.origin, "/_stage/mine?customer=" + encodeURIComponent(customer));
  return j.ok ? j.records : [];
}

// Build and send the customer's email for a record, and write the outcome
// on it. Never throws.
async function emailCustomer(env, url, rec, who) {
  if (!rec) return { ok: false, status: "failed", error: "no record" };
  let out;
  try { out = await sendEmail(env, rec.customerEmail, buildEmail(rec)); }
  catch (e) { out = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
  try { await doCall(env, url.origin, "/_stage/email", { id: rec.id, email: { ...out, to: rec.customerEmail || "" }, by: who || "" }); } catch {}
  return out;
}

async function notifyStaff(env, url, s) {
  const t = ntfyTarget(env && env.AUTOPRICE_NTFY);
  if (!t) return;
  const headers = { "content-type": "application/json" };
  if (env.AUTOPRICE_NTFY_TOKEN) headers.authorization = "Bearer " + String(env.AUTOPRICE_NTFY_TOKEN).trim();
  const body = `${s.number ? s.number + " · " : ""}${s.totals.units} card${s.totals.units === 1 ? "" : "s"} · ${money(s.totals.cash)} cash / ${money(s.totals.credit)} credit · ${s.paymentType} · ${s.customerName || "customer " + s.customer}`;
  await fetch(t.server + "/", { method: "POST", headers, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ topic: t.topic, title: "9Pocket: buylist to review", message: body, priority: 3, tags: ["inbox_tray"], click: url.origin + BASE + "/b/" + encodeURIComponent(s.id) }) });
}

/* ---- accounts, worker side ---- */

async function usersExist(env, origin) {
  const j = await doCall(env, origin, "/_stage/users");
  return !!(j.ok && j.users.length);
}

// The signed-in account for a request (its cookie's session), or null.
async function currentUser(request, env, origin) {
  const t = parseCookies(request)[COOKIE] || "";
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const s = await doCall(env, origin, "/_stage/session?token=" + t);
  if (!s.ok) return null;
  const u = await doCall(env, origin, "/_stage/user?email=" + encodeURIComponent(s.email));
  if (!u.ok || !u.user || u.user.disabled) return null;
  return publicUser(u.user);
}

async function startSession(env, origin, email) {
  const token = newToken();
  await doCall(env, origin, "/_stage/session/put", { token, email });
  return token;
}

// Email + password -> a session token, or the reason not.
async function login(env, origin, email, password) {
  email = normEmail(email);
  if (!validEmail(email) || !password) return { ok: false, error: "Enter your email address and password." };
  const locked = await doCall(env, origin, "/_stage/locked?email=" + encodeURIComponent(email));
  if (locked.locked) return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  const u = await doCall(env, origin, "/_stage/user?email=" + encodeURIComponent(email));
  const good = u.ok && u.user && !u.user.disabled && (await verifyPassword(password, u.user));
  const a = await doCall(env, origin, "/_stage/attempt", { email, ok: good });
  if (!good) return { ok: false, error: a.locked ? "Too many attempts. Try again in 15 minutes." : (u.ok && u.user && u.user.disabled ? "That account is disabled." : "That email and password were not accepted.") };
  return { ok: true, token: await startSession(env, origin, email), user: publicUser(u.user) };
}

async function createAccount(env, origin, { email, name, password, role, perms, createdBy }) {
  email = normEmail(email);
  if (!validEmail(email)) return { ok: false, error: "That is not an email address." };
  if (String(password || "").length < MIN_PASSWORD) return { ok: false, error: "The password needs at least " + MIN_PASSWORD + " characters." };
  const h = await hashPassword(password);
  const user = { email, name: String(name || "").trim().slice(0, 120), role: role === "admin" ? "admin" : "staff", perms: permsFrom(perms ? { perms } : {}), ...h, disabled: false, createdBy: String(createdBy || "").slice(0, 160) };
  return doCall(env, origin, "/_stage/user/put", { user, create: true });
}

/* ---- routes ---- */

// /9pocket (list), /9pocket/b/<id> (worksheet), /9pocket/email/<id>
// (preview), /9pocket.json, /9pocket/control, /9pocket/health,
// /9pocket/login|logout|setup, /9pocket/admin(+/control); the old
// /buylist/staged addresses redirect here.
export async function serveStage(request, env, url, staffOk) {
  const noStore = { "cache-control": "no-store" };
  const html = (s, status, extra) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", ...noStore, ...(extra || {}) } });
  const redirect = (to, extra) => new Response(null, { status: 303, headers: { location: to, ...noStore, ...(extra || {}) } });
  const origin = url.origin, p = url.pathname;
  if (p === LEGACY || p.startsWith(LEGACY + "/") || p === LEGACY + ".json") {
    const to = p === LEGACY + ".json" ? BASE + ".json" : p === LEGACY ? BASE : BASE + p.slice(LEGACY.length);
    return new Response(null, { status: 308, headers: { location: to + url.search, ...noStore } });
  }
  if (p === BASE + "/health") {
    const j = await doCall(env, origin, "/_stage/health");
    const out = { ...j, staging: stagingOn(env) ? "on" : "off", customerLookup: env && env.SHOPIFY_ADMIN_TOKEN ? "configured" : "no token", customerEmail: emailConfigured(env) ? "configured" : "no key" };
    // ?probe=1 (the deploy smoke): does the name lookup answer for a known
    // customer? Reports only whether a name came back, never the name.
    if (url.searchParams.get("probe") === "1") { const who = await lookupCustomer(env, "3957471740057"); out.customerLookupProbe = who.name ? "name returned" : "no name"; }
    return Response.json(out, { headers: noStore });
  }
  let form = null;
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (/json/i.test(ct)) { form = await bodyOf(request); }
    else { try { const fd = await request.formData(); form = {}; for (const [a, b] of fd) form[a] = b; } catch { form = {}; } }
  }
  const k = String((form && form.k) || url.searchParams.get("k") || "");
  const pinOk = k ? await staffOk(env, origin, k) : false;
  const q = (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; };
  const nextOf = () => { const n = String((form && form.next) || url.searchParams.get("next") || ""); return n.startsWith(BASE) && !n.startsWith(BASE + "/login") ? n : BASE; };

  // ---- sign in / out / first account ----
  if (p === BASE + "/login") {
    if (!(await usersExist(env, origin))) return html(renderSetup({ k: pinOk ? k : "", err: pinOk ? "" : "No account exists yet. Open this page with the staff key (?k=...) to create the first admin account.", email: FIRST_ADMIN_EMAIL, noPin: !pinOk }), pinOk ? 200 : 403);
    if (request.method === "POST") {
      const r = await login(env, origin, form.email, form.password);
      if (!r.ok) return html(renderLoginForm({ err: r.error, email: String(form.email || ""), next: nextOf() }), 403);
      return redirect(nextOf(), { "set-cookie": sessionCookie(r.token, SESSION_DAYS * 86400) });
    }
    return html(renderLoginForm({ err: url.searchParams.get("err") || "", msg: url.searchParams.get("msg") || "", email: "", next: nextOf() }));
  }
  if (p === BASE + "/logout" && request.method === "POST") {
    const t = parseCookies(request)[COOKIE] || "";
    if (/^[0-9a-f]{64}$/.test(t)) await doCall(env, origin, "/_stage/session/del", { token: t });
    return redirect(BASE + "/login?msg=" + encodeURIComponent("Signed out."), { "set-cookie": clearCookie() });
  }
  if (p === BASE + "/setup") {
    if (await usersExist(env, origin)) return redirect(BASE + "/login");
    if (!pinOk) return html(renderSetup({ k: "", err: k ? "That staff key was not accepted." : "The staff key is needed to create the first account (open this page with ?k=...).", email: FIRST_ADMIN_EMAIL, noPin: true }), 403);
    if (request.method === "POST") {
      if (String(form.password || "") !== String(form.password2 || "")) return html(renderSetup({ k, err: "The two passwords differ.", email: String(form.email || FIRST_ADMIN_EMAIL) }), 400);
      const r = await createAccount(env, origin, { email: form.email, name: form.name, password: form.password, role: "admin", perms: ["edit", "prices", "add", "approve", "email"], createdBy: "setup" });
      if (!r.ok) return html(renderSetup({ k, err: r.error, email: String(form.email || FIRST_ADMIN_EMAIL) }), 400);
      const token = await startSession(env, origin, normEmail(form.email));
      return redirect(BASE + "?msg=" + encodeURIComponent("Welcome - your admin account is ready."), { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }
    return html(renderSetup({ k, err: "", email: FIRST_ADMIN_EMAIL }));
  }

  const user = await currentUser(request, env, origin);
  const opts = { user, on: stagingOn(env), emailOn: emailConfigured(env), err: url.searchParams.get("err") || "", msg: url.searchParams.get("msg") || "" };
  const toLogin = () => redirect(BASE + "/login" + q({ next: p + (url.search && request.method === "GET" ? url.search : "") }));

  if (p === BASE + ".json") {
    if (!user && !pinOk) return Response.json({ error: "sign in or staff key required" }, { status: 403, headers: noStore });
    const j = await doCall(env, origin, "/_stage/list?status=" + encodeURIComponent(url.searchParams.get("status") || "") + "&days=" + encodeURIComponent(url.searchParams.get("days") || "30"));
    return Response.json({ ...j, staging: stagingOn(env) ? "on" : "off" }, { headers: noStore });
  }
  if (p === BASE + "/control" && request.method === "POST") {
    if (!user) return Response.json({ ok: false, error: "sign in required" }, { status: 403, headers: noStore });
    const result = await control(env, url, form || {}, user);
    if (form && form.__form) {
      const back = form.id ? BASE + "/b/" + encodeURIComponent(String(form.id)) : BASE;
      return redirect(back + q(result.ok ? { msg: result.message } : { err: result.error || "failed" }));
    }
    return Response.json(result, { status: result.ok ? 200 : (result.status || 400), headers: noStore });
  }
  if (p === BASE + "/admin" || p === BASE + "/admin/control") {
    if (!user) return toLogin();
    if (user.role !== "admin") return html(renderDenied(opts), 403);
    if (p === BASE + "/admin/control" && request.method === "POST") {
      const result = await adminControl(env, origin, form || {}, user);
      return redirect(BASE + "/admin" + q(result.ok ? { msg: result.message } : { err: result.error || "failed" }));
    }
    const j = await doCall(env, origin, "/_stage/users");
    return html(renderAdmin({ ...opts, users: j.ok ? j.users : [] }));
  }
  if (p === BASE) {
    if (!user) return (await usersExist(env, origin)) ? toLogin() : redirect(BASE + "/setup" + q({ k: pinOk ? k : "" }));
    const j = await doCall(env, origin, "/_stage/list?days=" + encodeURIComponent(url.searchParams.get("days") || "90"));
    await backfillNames(env, url, j);
    return html(renderList(j, opts));
  }
  const m = p.match(new RegExp("^" + BASE + "/(b|email)/([A-Za-z0-9-]{1,40})$"));
  if (m) {
    if (!user) return toLogin();
    const g = await doCall(env, origin, "/_stage/get?id=" + encodeURIComponent(m[2]));
    if (!g.ok) return html(renderList({ records: [], counts: {} }, { ...opts, err: "No such buylist." }), 404);
    const rec = g.record;
    if (!rec.customerName) await backfillNames(env, url, { records: [rec] });
    if (m[1] === "email") return html(buildEmail(rec).html);
    return html(renderSheet(rec, opts));
  }
  return Response.json({ error: "not found" }, { status: 404, headers: noStore });
}

// Lists that have no name yet (staged before the lookup shipped, or Shopify
// did not answer at submit): look up to five per page view and keep what
// comes back, so the pages show names without anyone resubmitting.
async function backfillNames(env, url, j) {
  if (!(env && env.SHOPIFY_ADMIN_TOKEN) || !j || !Array.isArray(j.records)) return;
  const todo = j.records.filter((r) => !r.customerName).slice(0, 5);
  for (const r of todo) {
    try {
      const who = await lookupCustomer(env, r.customer);
      if (!who.name && !who.email) continue;
      r.customerName = who.name; r.customerEmail = who.email;
      await doCall(env, url.origin, "/_stage/who", { id: r.id, customerName: who.name, customerEmail: who.email });
    } catch {}
  }
}

// A card added on the worksheet: shaped, checked against BinderPOS's
// buylist of the day (repriceCards: price, cap, variant id - a card the
// store is not buying is refused), then merged into the record.
export async function addCard(env, url, rec, raw, who) {
  const card = shapeAdded(raw);
  if (!card) return { ok: false, error: "card, condition and quantity required" };
  let rp;
  try { rp = await repriceCards(env, [card]); }
  catch (e) { return { ok: false, error: "could not check today's price with BinderPOS: " + String((e && e.message) || e).slice(0, 160) }; }
  if (!rp.cards.length) return { ok: false, error: "BinderPOS is not buying that right now: " + rp.dropped.join("; ") };
  const priced = rp.cards[0];
  const j = await doCall(env, url.origin, "/_stage/add", { id: rec.id, card: priced, by: who });
  if (!j.ok) return { ok: false, error: j.error };
  return { ok: true, id: rec.id, totals: j.record.totals, merged: j.merged, capped: rp.capped, message: (j.merged ? "Added to the existing line: " : "Added ") + lineLabel(priced) + " ×" + priced.quantity + " at " + money(priced.cashBuyPrice) + " / " + money(priced.storeCreditBuyPrice) + (rp.capped.length ? " (quantity capped at what the store takes)" : "") + "." };
}

async function control(env, url, f, user) {
  const id = String(f.id || "").slice(0, 40);
  const action = String(f.action || "");
  const who = user.email;
  const deny = (what) => ({ ok: false, status: 403, error: "Your account cannot " + what + ". Ask an admin." });
  if (!id) return { ok: false, error: "id required" };
  if (action === "reject") {
    if (!can(user, "approve")) return deny("approve or reject");
    // The form's one field is the reason the customer sees; the staff note
    // saved on the worksheet is left as it is.
    const body = { id, status: "rejected", customerNote: String(f.customerNote || f.note || ""), by: who };
    if (typeof f.staffNote === "string") body.note = f.staffNote;
    const j = await doCall(env, url.origin, "/_stage/mark", body);
    return j.ok ? { ok: true, id, status: "rejected", message: "Rejected. Nothing was sent to BinderPOS." } : { ok: false, error: j.error };
  }
  if (action === "edit") {
    let edit = f.edit;
    if (typeof edit === "string") { try { edit = JSON.parse(edit); } catch { edit = null; } }
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    const needs = editNeeds(g.record.cards, applyEdit(g.record, edit));
    const noteChanged = typeof f.note === "string" && f.note !== (g.record.note || "");
    if ((needs.qty || noteChanged) && !can(user, "edit")) return deny("change quantities or notes");
    if (needs.prices && !can(user, "prices")) return deny("change prices");
    const body = { id, edit, by: who };
    if (typeof f.note === "string") body.note = f.note;
    const j = await doCall(env, url.origin, "/_stage/edit", body);
    return j.ok ? { ok: true, id, totals: j.record.totals, message: "Saved." } : { ok: false, error: j.error };
  }
  if (action === "add") {
    if (!can(user, "add")) return deny("add cards");
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    if (g.record.status !== "staged") return { ok: false, error: "already " + g.record.status };
    let card = f.card;
    if (typeof card === "string") { try { card = JSON.parse(card); } catch { card = null; } }
    return addCard(env, url, g.record, card, who);
  }
  if (action === "email") {
    if (!can(user, "email")) return deny("send the customer email");
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    const rec = g.record;
    if (!rec.customerEmail) { await backfillNames(env, url, { records: [rec] }); }
    const r = await emailCustomer(env, url, rec, who);
    return r.ok ? { ok: true, id, message: "Email sent to " + rec.customerEmail + "." } : { ok: false, error: "Email not sent: " + (r.error || r.status) };
  }
  if (action === "approve") {
    if (!can(user, "approve")) return deny("approve or reject");
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    const rec = g.record;
    if (rec.status !== "staged") return { ok: false, error: "already " + rec.status };
    // Today's BinderPOS prices and limits, the same step submit takes; a
    // staff-typed price on the worksheet wins over the day's.
    let repriced;
    try { repriced = await repriceCards(env, rec.cards); }
    catch (e) { return { ok: false, error: "could not confirm today's prices with BinderPOS: " + String((e && e.message) || e).slice(0, 160) }; }
    if (!repriced.cards.length) return { ok: false, error: "none of these cards can be bought right now: " + repriced.dropped.join("; ") };
    const merged = mergeApproval(rec.cards, repriced);
    const r = await submitToBinderPos(env, url, rec.customer, rec.paymentType, merged.cards);
    if (!r.accepted) return { ok: false, error: "BinderPOS did not accept the submission: " + ((r.reply && r.reply.message) || ("HTTP " + r.upstream)) };
    const j = await doCall(env, url.origin, "/_stage/mark", {
      id, status: "approved", note: String(f.note || rec.note || ""), cards: merged.cards, by: who,
      bp: { number: r.reply && r.reply.data != null ? String(r.reply.data) : "", upstream: r.upstream, cleared: r.cleared },
      repricedAtApproval: merged.notes,
    });
    return j.ok ? { ok: true, id, status: "approved", reference: j.record.bp && j.record.bp.number, repriced: merged.notes, message: "Approved and sent to BinderPOS" + (j.record.bp && j.record.bp.number ? " as buylist " + j.record.bp.number : "") + "." } : { ok: false, error: j.error };
  }
  return { ok: false, error: "action must be approve, reject, edit, add or email" };
}

// /9pocket/admin/control: accounts. Admin only (checked by the caller).
async function adminControl(env, origin, f, admin) {
  const action = String(f.action || "");
  const email = normEmail(f.email);
  if (action === "add") {
    const r = await createAccount(env, origin, { email: f.email, name: f.name, password: f.password, role: f.role, perms: permsFrom(f), createdBy: admin.email });
    return r.ok ? { ok: true, message: "Account created for " + email + "." } : { ok: false, error: r.error };
  }
  if (!validEmail(email)) return { ok: false, error: "Which account? The email is missing." };
  const self = email === admin.email;
  if (action === "update") {
    const user = { email, name: String(f.name || "").trim().slice(0, 120), role: f.role === "admin" ? "admin" : "staff", perms: permsFrom(f) };
    if (self && user.role !== "admin") return { ok: false, error: "You cannot take admin away from your own account." };
    const r = await doCall(env, origin, "/_stage/user/put", { user });
    return r.ok ? { ok: true, message: "Saved " + email + "." } : { ok: false, error: r.error };
  }
  if (action === "password") {
    if (String(f.password || "").length < MIN_PASSWORD) return { ok: false, error: "The password needs at least " + MIN_PASSWORD + " characters." };
    const r = await doCall(env, origin, "/_stage/user/put", { user: { email, ...(await hashPassword(f.password)) } });
    return r.ok ? { ok: true, message: "Password changed for " + email + "." } : { ok: false, error: r.error };
  }
  if (action === "disable" || action === "enable") {
    if (self) return { ok: false, error: "You cannot disable your own account." };
    const r = await doCall(env, origin, "/_stage/user/put", { user: { email, disabled: action === "disable" } });
    return r.ok ? { ok: true, message: (action === "disable" ? "Disabled " : "Enabled ") + email + "." } : { ok: false, error: r.error };
  }
  if (action === "delete") {
    if (self) return { ok: false, error: "You cannot delete your own account." };
    const r = await doCall(env, origin, "/_stage/user/del", { email });
    return r.ok ? { ok: true, message: "Deleted " + email + "." } : { ok: false, error: r.error };
  }
  return { ok: false, error: "unknown action" };
}
