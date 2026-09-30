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
     s:<token>   a session {email, at, exp, mfa} - mfa: made through the emailed code
     la:<email>  failed-login counter {n, at}
     mf:<id>     a sign-in waiting for its emailed code {email, hash, exp, tries, sends, sentAt}
     mfr:<email> codes asked for {n, at} (CODE_STARTS per LOCK_MS)
     dv:<token>  a remembered device {email, at, exp, label} (DEVICE_DAYS)
     cfg         staff access settings {pinOff, pinOffBy, pinOffAt} (src/staff-access.js)
     pinuse      where the old staff PIN last opened something {route: ms}
     pr:<id>     a device waiting to be paired {code, kind, exp, status, key?, name?} (PAIR_TTL_MS)
     pc:<code>   the pairing code -> its pr:<id>
     dk:<sha256> a device or service key {id, name, kind, perms, by, at, used} - only the hash is kept
   Approved and rejected records are pruned after KEEP_MS by the alarm;
   staged ones are never pruned - a forgotten list should stay visible. */

import { repriceCards, submitToBinderPos, cleanCards, conditionsFor } from "./buylist.js";
import { ntfyPublish } from "./autoprice.js";
import { buildEmail, buildDecisionEmail, buildCodeEmail, sendEmail, emailConfigured } from "./stage-email.js";
import { dryRunPlan, pushBuylistPrices } from "./stage-sync.js";
import { HOLD_DO } from "./hold.js";
import { serveRequestsStaff } from "./requests.js";
import { BASE, renderLoginForm, renderCodeForm, renderSetup, renderAdmin, renderList, renderSheet, renderDenied, renderHeld, safeImage } from "./stage-ui.js";
import { hashPassword, verifyPassword, newToken, parseCookies, sessionCookie, clearCookie, publicUser, can, permsFrom, limitsFrom, normEmail, validEmail, SESSION_DAYS, LOCK_AFTER, LOCK_MS, COOKIE, MIN_PASSWORD,
  newCode, codeHash, cleanCode, sameHex, maskEmail, deviceTokens, deviceCookie, challengeCookie, deviceLabel, STAFF_PERMS,
  CODE_TTL_MS, CODE_TRIES, CODE_SENDS, CODE_RESEND_MS, CODE_STARTS, DEVICE_DAYS, DEVICE_KEEP, CHALLENGE_COOKIE } from "./stage-auth.js";
export { safeImage };

export const STAGE_DO = "buylist-stage";
const KEEP_MS = 90 * 86400e3;
const PRUNE_EVERY_MS = 24 * 3600e3;
const MAX_LIST = 300;
const MINE_MAX = 20;
const STATUSES = ["staged", "approved", "rejected"];
export const PAYMENT_TYPES = ["Cash", "Store Credit"];
const SEQ_START = 1000;                      // the first buylist is 9P-1001
const LEGACY = "/buylist/staged";            // the page's first address; redirects
// The staff screens a sign-in may return to (src/staff-access.js): same site, known pages only.
const STAFF_NEXT = /^\/(staff|pickups|admin|portal\/buylists|deckstats|tv)(\?[^#\s"'<>]*)?$/;
// Pairing (src/staff-access.js): a device shows a code, an admin types it on 9Pocket > Admin.
const PAIR_TTL_MS = 10 * 60e3;
const PAIR_MAX_WAITING = 20;
const PAIR_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";   // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
function pairCode() {
  const a = new Uint8Array(1);
  let out = "";
  while (out.length < 6) { crypto.getRandomValues(a); if (a[0] < 250) out += PAIR_ALPHABET[a[0] % 25]; }   // 250 = 10 x 25: no bias
  return out;
}
const DEVICE_KINDS = { "pos-tile": "POS tablet (pickups tile)", "binderpos-addon": "BinderPOS add-on", service: "Service", other: "Device" };
const cleanKind = (k) => (DEVICE_KINDS[k] ? k : "other");
const kindLabel = (k) => DEVICE_KINDS[cleanKind(k)];
// A device or service may use store screens only (never admin), ticked one by one.
function devicePerms(src) {
  const out = {};
  for (const p of STAFF_PERMS) {
    const v = src && (Array.isArray(src) ? src.includes(p.key) : src[p.key] != null ? src[p.key] : src["perm_" + p.key]);
    out[p.key] = v === true || v === "on" || v === "1" || v === "true";
  }
  return out;
}
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
// Drop the price that the list's payment type does not pay from each edit
// entry: cash on a Store Credit list, credit on a Cash list.
export function lockUnpaidPrice(rec, edit) {
  const credit = String((rec && rec.paymentType) || "").toLowerCase().includes("credit");
  return (Array.isArray(edit) ? edit : []).map((e) => {
    if (!e || typeof e !== "object") return e;
    const { cashBuyPrice, storeCreditBuyPrice, ...rest } = e;
    return credit ? { ...rest, storeCreditBuyPrice } : { ...rest, cashBuyPrice };
  });
}

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
  if (p === "/_stage/bpsync" && post) {
    // What happened when the worksheet's prices were pushed to BinderPOS.
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    const r = b.result && typeof b.result === "object" ? b.result : {};
    rec.bpSync = { at: cx.now(), by: by(b), ok: !!r.ok, saved: !!r.saved, verified: r.verified == null ? null : !!r.verified, changes: Number(r.changes) || 0, matched: Number(r.matched) || 0, error: String(r.error || "").slice(0, 200), message: String(r.message || "").slice(0, 200) };
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: r.ok && r.saved ? "prices pushed to BinderPOS" + (r.verified ? "" : " (unverified)") : r.ok ? "BinderPOS prices already matched" : "BinderPOS price push failed", by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/regrade" && post) {
    // Staff re-graded some copies of a line (owner, 2026-09-22: "if there is
    // more than one qty per card, I need to be able to edit each qty
    // condition"): `take` copies leave the line at `key` and join (or start)
    // the line for `card`, which the worker has already priced for its new
    // condition. Taking every copy removes the source line.
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (rec.status !== "staged") return doJson({ ok: false, error: "already " + rec.status }, 409);
    const src = (rec.cards || []).find((c) => lineKey(c) === String(b.key || ""));
    if (!src) return doJson({ ok: false, error: "no such line" }, 404);
    const card = b.card && typeof b.card === "object" && b.card.cardId != null ? b.card : null;
    if (!card) return doJson({ ok: false, error: "card required" }, 400);
    if (lineKey(card) === lineKey(src)) return doJson({ ok: false, error: "that is the condition it already has" }, 400);
    const have = Math.max(0, parseInt(src.quantity, 10) || 0);
    const take = Math.max(1, Math.min(have, parseInt(b.take, 10) || 1));
    const rest = (rec.cards || []).map((c) => c === src ? { ...c, quantity: String(have - take) } : c).filter((c) => (parseInt(c.quantity, 10) || 0) > 0);
    const m = mergeAdded(rest, { ...card, quantity: String(take) });
    rec.cards = m.cards; rec.totals = totalsOf(m.cards);
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "regraded " + take + " × " + lineLabel(src) + " → " + String(card.conditionName || card.condition), by: by(b) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec, merged: m.merged, take });
  }
  if (p === "/_stage/payment" && post) {
    // Cash <-> Store Credit while the list waits (owner, 2026-09-22: "a
    // secondary way that if the customer changed their mind we could update
    // it there"). Approval sends whatever is on the record.
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (rec.status !== "staged") return doJson({ ok: false, error: "already " + rec.status }, 409);
    const pt = String(b.paymentType || "");
    if (!PAYMENT_TYPES.includes(pt)) return doJson({ ok: false, error: "paymentType must be Cash or Store Credit" }, 400);
    if (pt !== rec.paymentType) {
      rec.paymentType = pt;
      rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "paid as " + pt, by: by(b) }]).slice(-30);
      await cx.storage.put(key, rec);
    }
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
    const entry = { status: String(e.status || "failed").slice(0, 20), at: cx.now(), to: String(e.to || "").slice(0, 160), id: String(e.id || "").slice(0, 64), error: String(e.error || "").slice(0, 200), kind: String(e.kind || "confirmation").slice(0, 20) };
    // The confirmation is the record's email; a decision email (approved /
    // rejected, sent only when staff asked) is kept beside it.
    if (entry.kind === "confirmation") rec.email = entry; else rec.decisionEmail = entry;
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: (entry.status === "sent" ? "emailed" : "email " + entry.status) + (entry.kind === "confirmation" ? "" : " (" + entry.kind + ")"), by: by(b) }]).slice(-30);
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
    // disabled, or a new password: signed out everywhere, remembered devices forgotten
    if (next.disabled || (cur && u.hash && u.hash !== cur.hash)) await dropSessions(cx, email);
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
    await cx.storage.put("s:" + token, { email, at: cx.now(), exp: cx.now() + SESSION_DAYS * 86400e3, mfa: b.mfa === true });
    return doJson({ ok: true });
  }
  if (p === "/_stage/session") {
    const token = String(url.searchParams.get("token") || "");
    const s = /^[0-9a-f]{64}$/.test(token) ? await cx.storage.get("s:" + token) : null;
    if (!s) return doJson({ ok: false, error: "no session" }, 404);
    if (s.exp < cx.now()) { await cx.storage.delete("s:" + token); return doJson({ ok: false, error: "expired" }, 404); }
    return doJson({ ok: true, email: s.email, mfa: s.mfa === true });
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
  // ---- the emailed sign-in code and remembered devices (src/stage-auth.js) ----
  if (p === "/_stage/2fa/start" && post) {
    const email = normEmail((await bodyOf(request)).email);
    if (!email) return doJson({ ok: false, error: "email required" }, 400);
    const now = cx.now(), rk = "mfr:" + email;
    const r0 = (await cx.storage.get(rk)) || { n: 0, at: 0 };
    const r = now - r0.at > LOCK_MS ? { n: 0, at: now } : r0;
    if (r.n >= CODE_STARTS) return doJson({ ok: false, error: "Too many sign-in codes asked for. Try again in 15 minutes." }, 429);
    r.n += 1;
    await cx.storage.put(rk, r);
    const id = newToken(), code = newCode();
    await cx.storage.put("mf:" + id, { email, hash: await codeHash(id, code), exp: now + CODE_TTL_MS, tries: 0, sends: 1, sentAt: now });
    return doJson({ ok: true, id, code, email });
  }
  if (p === "/_stage/2fa/resend" && post) {
    const id = String((await bodyOf(request)).id || "");
    const key = "mf:" + id, now = cx.now();
    const c = /^[0-9a-f]{64}$/.test(id) ? await cx.storage.get(key) : null;
    if (!c || c.exp < now) { if (c) await cx.storage.delete(key); return doJson({ ok: false, gone: true, error: "That sign-in has expired. Enter your password again." }); }
    if (c.sends >= CODE_SENDS) return doJson({ ok: false, email: c.email, error: "No more codes for this sign-in. Use the last one, or start again." });
    if (now - c.sentAt < CODE_RESEND_MS) return doJson({ ok: false, email: c.email, error: "The last code went out a moment ago - give it a minute to arrive." });
    const code = newCode();
    Object.assign(c, { hash: await codeHash(id, code), exp: now + CODE_TTL_MS, sends: c.sends + 1, sentAt: now });
    await cx.storage.put(key, c);
    return doJson({ ok: true, code, email: c.email });
  }
  if (p === "/_stage/2fa/check" && post) {
    const b = await bodyOf(request);
    const id = String(b.id || ""), key = "mf:" + id, now = cx.now();
    const c = /^[0-9a-f]{64}$/.test(id) ? await cx.storage.get(key) : null;
    if (!c || c.exp < now) { if (c) await cx.storage.delete(key); return doJson({ ok: false, gone: true, error: "That code has expired. Enter your password again for a new one." }); }
    // counted before comparing, so guesses sent side by side still count
    c.tries += 1;
    await cx.storage.put(key, c);
    const code = cleanCode(b.code);
    if (code.length === 6 && sameHex(await codeHash(id, code), c.hash)) { await cx.storage.delete(key); return doJson({ ok: true, email: c.email }); }
    if (c.tries >= CODE_TRIES) { await cx.storage.delete(key); return doJson({ ok: false, gone: true, error: "Too many wrong codes. Enter your password again for a new one." }); }
    const left = CODE_TRIES - c.tries;
    return doJson({ ok: false, email: c.email, left, error: "That code is not right - " + left + " tr" + (left === 1 ? "y" : "ies") + " left." });
  }
  if (p === "/_stage/device/put" && post) {
    const b = await bodyOf(request);
    const token = String(b.token || ""), email = normEmail(b.email);
    if (!/^[0-9a-f]{64}$/.test(token) || !email) return doJson({ ok: false, error: "bad device" }, 400);
    await cx.storage.put("dv:" + token, { email, at: cx.now(), exp: cx.now() + DEVICE_DAYS * 86400e3, label: String(b.label || "").slice(0, 60) });
    return doJson({ ok: true });
  }
  if (p === "/_stage/device/match" && post) {
    // Is one of this browser's remembered tokens this account's?
    const b = await bodyOf(request);
    const email = normEmail(b.email), now = cx.now();
    for (const t of (Array.isArray(b.tokens) ? b.tokens : []).slice(0, DEVICE_KEEP)) {
      if (!/^[0-9a-f]{64}$/.test(String(t))) continue;
      const d = await cx.storage.get("dv:" + t);
      if (!d) continue;
      if (d.exp < now) { await cx.storage.delete("dv:" + t); continue; }
      if (d.email === email) return doJson({ ok: true });
    }
    return doJson({ ok: false });
  }
  // ---- staff access (src/staff-access.js): the old staff PIN's switch, and where it was last used ----
  if (p === "/_stage/cfg") {
    const c = (await cx.storage.get("cfg")) || {};
    return doJson({ ok: true, pinOff: c.pinOff === true, pinOffBy: c.pinOffBy || "", pinOffAt: c.pinOffAt || null, pinUse: (await cx.storage.get("pinuse")) || {} });
  }
  if (p === "/_stage/cfg/pin" && post) {
    const b = await bodyOf(request);
    const c = (await cx.storage.get("cfg")) || {};
    Object.assign(c, { pinOff: b.off === true, pinOffBy: String(b.by || "").slice(0, 160), pinOffAt: cx.now() });
    await cx.storage.put("cfg", c);
    return doJson({ ok: true, pinOff: c.pinOff });
  }
  if (p === "/_stage/pinuse" && post) {
    const route = String((await bodyOf(request)).route || "").replace(/[^\w./ -]/g, "").slice(0, 60);
    if (!route) return doJson({ ok: false, error: "route required" }, 400);
    const u = (await cx.storage.get("pinuse")) || {};
    u[route] = cx.now();
    const keep = Object.entries(u).sort((a, b) => b[1] - a[1]).slice(0, 40);
    await cx.storage.put("pinuse", Object.fromEntries(keep));
    return doJson({ ok: true });
  }
  // ---- till devices and services (src/staff-access.js): pairing, keys ----
  if (p === "/_stage/pair/start" && post) {
    const b = await bodyOf(request);
    const now = cx.now();
    const waiting = await cx.storage.list({ prefix: "pr:" });
    const gone = [];
    for (const [k, v] of waiting) if (!v || v.exp < now) gone.push(k, "pc:" + (v && v.code));
    if (gone.length) await cx.storage.delete(gone.slice(0, 128));
    if (waiting.size - gone.length / 2 >= PAIR_MAX_WAITING) return doJson({ ok: false, error: "Too many devices waiting to be paired. Try again in a few minutes." }, 429);
    let code = "";
    for (let i = 0; i < 5 && (!code || (await cx.storage.get("pc:" + code))); i++) code = pairCode();
    const id = newToken();
    await cx.storage.put("pr:" + id, { code, kind: cleanKind(b.kind), exp: now + PAIR_TTL_MS, status: "waiting" });
    await cx.storage.put("pc:" + code, id);
    return doJson({ ok: true, id, code: code.slice(0, 3) + "-" + code.slice(3), expiresIn: Math.round(PAIR_TTL_MS / 1000) });
  }
  if (p === "/_stage/pair/poll") {
    const id = String(url.searchParams.get("id") || "");
    const pr = /^[0-9a-f]{64}$/.test(id) ? await cx.storage.get("pr:" + id) : null;
    if (!pr || pr.exp < cx.now()) { if (pr) await cx.storage.delete(["pr:" + id, "pc:" + pr.code]); return doJson({ ok: true, status: "expired" }); }
    if (pr.status !== "approved") return doJson({ ok: true, status: "waiting" });
    // handed over once, then forgotten: only the hash stays (dk:)
    await cx.storage.delete("pr:" + id);
    return doJson({ ok: true, status: "approved", key: pr.key, name: pr.name, perms: pr.perms });
  }
  if (p === "/_stage/pair/approve" && post) {
    const b = await bodyOf(request);
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const id = code.length === 6 ? await cx.storage.get("pc:" + code) : null;
    const pr = id ? await cx.storage.get("pr:" + id) : null;
    if (!pr || pr.exp < cx.now() || pr.status !== "waiting") return doJson({ ok: false, error: "No device is showing that code (codes last 10 minutes). Get a new code on the device and try again." });
    const name = String(b.name || "").trim().slice(0, 60) || kindLabel(pr.kind);
    const perms = devicePerms(b.perms);
    if (!Object.values(perms).some(Boolean)) return doJson({ ok: false, error: "Tick at least one thing the device may do." });
    const key = newToken();
    const rec = { id: newToken().slice(0, 16), name, kind: pr.kind, perms, by: String(b.by || "").slice(0, 160), at: cx.now(), used: 0 };
    await cx.storage.put("dk:" + (await sha256Hex(key)), rec);
    Object.assign(pr, { status: "approved", key, name, perms, exp: cx.now() + PAIR_TTL_MS });
    await cx.storage.put("pr:" + id, pr);
    await cx.storage.delete("pc:" + code);
    return doJson({ ok: true, id: rec.id, name });
  }
  if (p === "/_stage/device-key/create" && post) {
    const b = await bodyOf(request);
    const perms = devicePerms(b.perms);
    if (!Object.values(perms).some(Boolean)) return doJson({ ok: false, error: "Tick at least one thing the key may do." });
    const key = newToken();
    const rec = { id: newToken().slice(0, 16), name: String(b.name || "").trim().slice(0, 60) || "Service", kind: "service", perms, by: String(b.by || "").slice(0, 160), at: cx.now(), used: 0 };
    await cx.storage.put("dk:" + (await sha256Hex(key)), rec);
    return doJson({ ok: true, key, id: rec.id, name: rec.name });
  }
  if (p === "/_stage/device-key") {
    const h = String(url.searchParams.get("hash") || "");
    const d = /^[0-9a-f]{64}$/.test(h) ? await cx.storage.get("dk:" + h) : null;
    return d ? doJson({ ok: true, device: d }) : doJson({ ok: false }, 404);
  }
  if (p === "/_stage/device-key/used" && post) {
    const h = String((await bodyOf(request)).hash || "");
    const d = /^[0-9a-f]{64}$/.test(h) ? await cx.storage.get("dk:" + h) : null;
    if (d) { d.used = cx.now(); await cx.storage.put("dk:" + h, d); }
    return doJson({ ok: !!d });
  }
  if (p === "/_stage/device-keys") {
    const m = await cx.storage.list({ prefix: "dk:" });
    return doJson({ ok: true, devices: [...m.values()].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0)) });
  }
  if (p === "/_stage/device-key/revoke" && post) {
    const id = String((await bodyOf(request)).id || "");
    const m = await cx.storage.list({ prefix: "dk:" });
    for (const [k, v] of m) if (v && v.id === id) { await cx.storage.delete(k); return doJson({ ok: true, name: v.name }); }
    return doJson({ ok: false, error: "no such device" });
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
  const gone = [];
  for (const prefix of ["s:", "dv:"]) {
    const m = await cx.storage.list({ prefix });
    for (const [k, v] of m) if (v && v.email === email) gone.push(k);
  }
  // storage.delete takes at most 128 keys at a time
  for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
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

// The approve / reject email, only when the staff member ticked the box.
// Never throws; the outcome is written on the record beside the confirmation.
async function emailDecision(env, url, rec, kind, who) {
  if (!rec) return { ok: false, status: "failed", error: "no record" };
  if (!rec.customerEmail) { try { await backfillNames(env, url, { records: [rec] }); } catch {} }
  let out;
  try { out = await sendEmail(env, rec.customerEmail, buildDecisionEmail(rec, kind)); }
  catch (e) { out = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
  try { await doCall(env, url.origin, "/_stage/email", { id: rec.id, email: { ...out, to: rec.customerEmail || "", kind }, by: who || "" }); } catch {}
  return out;
}

async function notifyStaff(env, url, s) {
  const body = `${s.number ? s.number + " · " : ""}${s.totals.units} card${s.totals.units === 1 ? "" : "s"} · ${money(s.totals.cash)} cash / ${money(s.totals.credit)} credit · ${s.paymentType} · ${s.customerName || "customer " + s.customer}`;
  return ntfyPublish(env, { title: "9Pocket: buylist to review", message: body, priority: 3, tags: ["inbox_tray"], click: url.origin + BASE + "/b/" + encodeURIComponent(s.id) });
}

/* ---- accounts, worker side ---- */

async function usersExist(env, origin) {
  const j = await doCall(env, origin, "/_stage/users");
  return !!(j.ok && j.users.length);
}

// The signed-in account for a request (its cookie's session), or null. Also
// used by the auto-pricer (src/autoprice.js), which reads the account's
// auto-pricing permissions from it.
export async function currentUser(request, env, origin) {
  if (!env || !env.ROOM) return null;
  const t = parseCookies(request)[COOKIE] || "";
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const s = await doCall(env, origin, "/_stage/session?token=" + t);
  // only a session made through the emailed code counts (older ones sign in again)
  if (!s.ok || !s.mfa) return null;
  const u = await doCall(env, origin, "/_stage/user?email=" + encodeURIComponent(s.email));
  if (!u.ok || !u.user || u.user.disabled) return null;
  return publicUser(u.user);
}

// Staff access settings for src/staff-access.js (the PIN switch, where the PIN was last used).
export async function stageCfg(env, origin) { return doCall(env, origin, "/_stage/cfg"); }
export async function notePinUse(env, origin, route) { return doCall(env, origin, "/_stage/pinuse", { route }); }
// Device and service keys (src/staff-access.js): looked up by hash, never stored in the clear.
export async function deviceByHash(env, origin, hash) { const j = await doCall(env, origin, "/_stage/device-key?hash=" + hash); return j.ok ? j.device : null; }
export async function noteDeviceUse(env, origin, hash) { return doCall(env, origin, "/_stage/device-key/used", { hash }); }
// GET/POST /device/pair/* (index.js): a device asks for a code, then waits for an admin to type it.
export async function servePair(request, env, url) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "cache-control": "no-store" };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (url.pathname === "/device/pair/start" && request.method === "POST") {
    let b = {}; try { b = (await request.json()) || {}; } catch {}
    const j = await doCall(env, url.origin, "/_stage/pair/start", { kind: b.kind });
    return Response.json(j.ok ? { id: j.id, code: j.code, expiresIn: j.expiresIn } : { error: j.error || "failed" }, { status: j.ok ? 200 : 429, headers: cors });
  }
  if (url.pathname === "/device/pair/poll") {
    const j = await doCall(env, url.origin, "/_stage/pair/poll?id=" + encodeURIComponent(url.searchParams.get("id") || ""));
    return Response.json(j.status === "approved" ? { status: "approved", key: j.key, name: j.name } : { status: j.status || "expired" }, { headers: cors });
  }
  return Response.json({ error: "not found" }, { status: 404, headers: cors });
}

async function startSession(env, origin, email, mfa) {
  const token = newToken();
  await doCall(env, origin, "/_stage/session/put", { token, email, mfa: mfa === true });
  return token;
}

// Email + password -> the account, or the reason not. The session comes
// after the second step (the emailed code, or a device that remembers it).
async function checkPassword(env, origin, email, password) {
  email = normEmail(email);
  if (!validEmail(email) || !password) return { ok: false, error: "Enter your email address and password." };
  const locked = await doCall(env, origin, "/_stage/locked?email=" + encodeURIComponent(email));
  if (locked.locked) return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  const u = await doCall(env, origin, "/_stage/user?email=" + encodeURIComponent(email));
  const good = u.ok && u.user && !u.user.disabled && (await verifyPassword(password, u.user));
  const a = await doCall(env, origin, "/_stage/attempt", { email, ok: good });
  if (!good) return { ok: false, error: a.locked ? "Too many attempts. Try again in 15 minutes." : (u.ok && u.user && u.user.disabled ? "That account is disabled." : "That email and password were not accepted.") };
  return { ok: true, email, user: publicUser(u.user) };
}

// The code to the account's own address. Internal mail: no reply-to.
async function emailCode(env, request, to, code, name, fetchFn) {
  if (!emailConfigured(env)) return { ok: false, error: "email is not set up on the worker (RESEND_API_KEY)" };
  return sendEmail(env, to, buildCodeEmail({ code, name, device: deviceLabel(request.headers.get("user-agent")) }), { replyTo: null, fetchFn });
}

async function createAccount(env, origin, { email, name, password, role, perms, limits, createdBy }) {
  email = normEmail(email);
  if (!validEmail(email)) return { ok: false, error: "That is not an email address." };
  if (String(password || "").length < MIN_PASSWORD) return { ok: false, error: "The password needs at least " + MIN_PASSWORD + " characters." };
  const h = await hashPassword(password);
  const user = { email, name: String(name || "").trim().slice(0, 120), role: role === "admin" ? "admin" : "staff", perms: permsFrom(perms ? { perms } : {}), limits: limitsFrom(limits || {}), ...h, disabled: false, createdBy: String(createdBy || "").slice(0, 160) };
  return doCall(env, origin, "/_stage/user/put", { user, create: true });
}

/* ---- routes ---- */

// /9pocket (list), /9pocket/b/<id> (worksheet), /9pocket/email/<id>
// (preview), /9pocket.json, /9pocket/control, /9pocket/health,
// /9pocket/login|logout|setup, /9pocket/admin(+/control); the old
// /buylist/staged addresses redirect here.
export async function serveStage(request, env, url, staffOk, sopts) {
  const noStore = { "cache-control": "no-store" };
  const html = (s, status, extra) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", ...noStore, ...(extra || {}) } });
  const redirect = (to, extra) => new Response(null, { status: 303, headers: { location: to, ...noStore, ...(extra || {}) } });
  const redirectCookies = (to, cookies) => { const h = new Headers({ location: to, ...noStore }); for (const c of cookies) h.append("set-cookie", c); return new Response(null, { status: 303, headers: h }); };
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
  // the staff key while it is on, or the automation key (src/staff-access.js); "pinOk" for short
  const pinOk = k || request.headers.has("authorization") ? await staffOk(env, origin, k) : false;
  const q = (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; };
  // Where to land after signing in: a 9Pocket page, or the auto-pricer
  // (its login page sends 9Pocket accounts here).
  const nextOf = () => { const n = String((form && form.next) || url.searchParams.get("next") || ""); return (n.startsWith(BASE) && !n.startsWith(BASE + "/login")) || /^\/autoprice(\?|$)/.test(n) || STAFF_NEXT.test(n) ? n : BASE; };

  // ---- sign in / out / first account ----
  if (p === BASE + "/login") {
    if (!(await usersExist(env, origin))) return html(renderSetup({ k: pinOk ? k : "", err: pinOk ? "" : "No account exists yet. Open this page with the staff key (?k=...) to create the first admin account.", email: FIRST_ADMIN_EMAIL, noPin: !pinOk }), pinOk ? 200 : 403);
    if (request.method === "POST") {
      const r = await checkPassword(env, origin, form.email, form.password);
      if (!r.ok) return html(renderLoginForm({ err: r.error, email: String(form.email || ""), next: nextOf() }), 403);
      // a browser this account ticked "remember" on skips the code
      const dts = deviceTokens(request);
      if (dts.length && (await doCall(env, origin, "/_stage/device/match", { email: r.email, tokens: dts })).ok) {
        return redirect(nextOf(), { "set-cookie": sessionCookie(await startSession(env, origin, r.email, true), SESSION_DAYS * 86400) });
      }
      const st = await doCall(env, origin, "/_stage/2fa/start", { email: r.email });
      if (!st.ok) return html(renderLoginForm({ err: st.error || "Could not start the sign-in.", email: r.email, next: nextOf() }), 429);
      const sent = await emailCode(env, request, r.email, st.code, r.user && r.user.name, sopts && sopts.fetchFn);
      if (!sent.ok) return html(renderLoginForm({ err: "Your password is right, but the sign-in code could not be emailed (" + (sent.error || "send failed") + "). Ask an admin to check your account's email address.", email: r.email, next: nextOf() }), 502);
      return html(renderCodeForm({ masked: maskEmail(r.email), next: nextOf() }), 200, { "set-cookie": challengeCookie(st.id, Math.round(CODE_TTL_MS / 1000)) });
    }
    return html(renderLoginForm({ err: url.searchParams.get("err") || "", msg: url.searchParams.get("msg") || "", email: "", next: nextOf() }));
  }
  if (p === BASE + "/login/code" && request.method === "POST") {
    const id = String(parseCookies(request)[CHALLENGE_COOKIE] || "");
    const next = nextOf();
    const again = (err) => redirect(BASE + "/login" + q({ err, next: next === BASE ? "" : next }), { "set-cookie": challengeCookie("", 0) });
    if (!/^[0-9a-f]{64}$/.test(id)) return again("That sign-in has expired. Enter your password again.");
    if (form.resend) {
      const rs = await doCall(env, origin, "/_stage/2fa/resend", { id });
      if (!rs.ok) return rs.gone ? again(rs.error) : html(renderCodeForm({ masked: maskEmail(rs.email), err: rs.error, next }), 429);
      const u = await doCall(env, origin, "/_stage/user?email=" + encodeURIComponent(rs.email));
      const sent = await emailCode(env, request, rs.email, rs.code, u.ok && u.user && u.user.name, sopts && sopts.fetchFn);
      return html(renderCodeForm({ masked: maskEmail(rs.email), msg: sent.ok ? "A new code is on its way." : "", err: sent.ok ? "" : "The new code could not be emailed (" + (sent.error || "send failed") + ").", next }), sent.ok ? 200 : 502);
    }
    const c = await doCall(env, origin, "/_stage/2fa/check", { id, code: form.code });
    if (!c.ok) return c.gone ? again(c.error) : html(renderCodeForm({ masked: maskEmail(c.email), err: c.error, next, remember: !!form.remember }), 403);
    const cookies = [sessionCookie(await startSession(env, origin, c.email, true), SESSION_DAYS * 86400), challengeCookie("", 0)];
    if (form.remember) {
      const t = newToken();
      await doCall(env, origin, "/_stage/device/put", { token: t, email: c.email, label: deviceLabel(request.headers.get("user-agent")) });
      cookies.push(deviceCookie([t, ...deviceTokens(request)].slice(0, DEVICE_KEEP), DEVICE_DAYS * 86400));
    }
    return redirectCookies(next, cookies);
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
      const token = await startSession(env, origin, normEmail(form.email), true);   // the staff key stood in for the second step
      return redirect(BASE + "?msg=" + encodeURIComponent("Welcome - your admin account is ready."), { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
    }
    return html(renderSetup({ k, err: "", email: FIRST_ADMIN_EMAIL }));
  }

  const user = await currentUser(request, env, origin);
  const opts = { user, on: stagingOn(env), emailOn: emailConfigured(env), err: url.searchParams.get("err") || "", msg: url.searchParams.get("msg") || "" };
  const toLogin = () => redirect(BASE + "/login" + q({ next: p + (url.search && request.method === "GET" ? url.search : "") }));
  // Item requests (src/requests.js): the list, one request, its control.
  if (p === BASE + "/requests" || p === BASE + "/requests.json" || p.startsWith(BASE + "/requests/")) {
    return serveRequestsStaff(request, env, url, user, form, { html, redirect, q, toLogin, opts });
  }

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
    let newKey = null;
    if (p === BASE + "/admin/control" && request.method === "POST") {
      const result = await adminControl(env, origin, form || {}, user);
      // a new service key is shown once, on this answer - never in a redirect URL
      if (!result.newKey) return redirect(BASE + "/admin" + q(result.ok ? { msg: result.message } : { err: result.error || "failed" }));
      newKey = result.newKey; opts.msg = result.message;
    }
    const j = await doCall(env, origin, "/_stage/users");
    const dv = await doCall(env, origin, "/_stage/device-keys");
    return html(renderAdmin({ ...opts, users: j.ok ? j.users : [], cfg: await stageCfg(env, origin), devices: dv.ok ? dv.devices : [], newKey, origin }));
  }
  // Held stock: hold on arrival, stage 2 (src/hold-live.js). The switch is
  // an admin's; releasing needs the "release" permission or an admin.
  if (p === BASE + "/held" || p === BASE + "/held.json" || p === BASE + "/held/control") {
    const stub = env.ROOM.get(env.ROOM.idFromName(HOLD_DO));
    const hold = async (path, body) => { const r = await stub.fetch(new Request(origin + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {})); try { return await r.json(); } catch { return { ok: false, error: "hold DO: HTTP " + r.status }; } };
    if (p === BASE + "/held.json") {
      if (!user && !pinOk) return Response.json({ error: "sign in or staff key required" }, { status: 403, headers: noStore });
      return Response.json(await hold("/_hold/live/status"), { headers: noStore });
    }
    if (!user) return toLogin();
    if (p === BASE + "/held/control" && request.method === "POST") {
      const action = String((form && form.action) || "");
      const by = user.email;
      let result;
      if (action === "on" || action === "off") {
        if (user.role !== "admin") result = { ok: false, error: "Only an admin can switch the hold on or off." };
        else result = await hold("/_hold/live/set", { on: action === "on", trial: form.trial, by });
        if (result.ok) result.message = action === "on" ? ("Hold on arrival is ON" + (result.trial ? " for the next " + result.trial + " arrival" + (result.trial > 1 ? "s" : "") : "") + ". Every buy cart and completed buylist from now on is held.") : "Hold on arrival is OFF. Nothing was released; what is held stays held until you release it.";
      } else if (action === "check") {
        if (user.role !== "admin") result = { ok: false, error: "Only an admin can run a check." };
        else { const r = await hold("/_hold/live/poll"); result = r.ok ? { ok: true, message: "Checked BinderPOS: " + r.carts + " new cart" + (r.carts === 1 ? "" : "s") + ", " + r.buylists + " completed buylist" + (r.buylists === 1 ? "" : "s") + (r.waiting ? ", " + r.waiting + " line" + (r.waiting === 1 ? "" : "s") + " still waiting" : "") + (r.errors && r.errors.length ? ". " + r.errors.join(" · ") : ".") } : r; }
      } else if (action === "release" || action === "release-all" || action === "damaged") {
        if (!can(user, "release")) result = { ok: false, error: "Your account cannot release held stock. Ask an admin." };
        else {
          const r = await hold("/_hold/live/release", { key: form.key, line: action === "release-all" ? null : form.line, n: form.n, to: action === "damaged" ? "damaged" : "available", by });
          result = r.ok ? { ok: true, message: action === "damaged" ? "Marked " + r.moved + " damaged (kept off the shelf)." : "Released " + r.moved + "." + (r.status === "done" ? " That arrival is done." : "") } : { ok: false, error: r.error || (r.errors || []).join("; ") || "failed" };
        }
      } else result = { ok: false, error: "unknown action" };
      if (form && form.json) return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
      return redirect(BASE + "/held" + q(result.ok ? { msg: result.message, q: form.q } : { err: result.error || "failed", q: form.q }));
    }
    const d = await hold("/_hold/live/status" + (url.searchParams.get("q") ? "?q=" + encodeURIComponent(url.searchParams.get("q")) : ""));
    return html(renderHeld(d, { ...opts, q: url.searchParams.get("q") || "" }));
  }
  if (p === BASE) {
    if (!user) return (await usersExist(env, origin)) ? toLogin() : redirect(BASE + "/setup" + q({ k: pinOk ? k : "" }));
    const j = await doCall(env, origin, "/_stage/list?days=" + encodeURIComponent(url.searchParams.get("days") || "90"));
    await backfillNames(env, url, j);
    return html(renderList(j, opts));
  }
  // Dry run of the BinderPOS price carry-over (src/stage-sync.js): what
  // would be saved for this buylist, nothing sent. A signed-in account or
  // the staff key (the deploy smoke) may read it.
  const dr = p.match(new RegExp("^" + BASE + "/b/([A-Za-z0-9-]{1,40})/bp-plan\\.json$"));
  if (dr) {
    if (!user && !pinOk) return Response.json({ error: "sign in or staff key required" }, { status: 403, headers: noStore });
    const g = await doCall(env, origin, "/_stage/get?id=" + encodeURIComponent(dr[1]));
    if (!g.ok) return Response.json({ ok: false, error: "no such buylist" }, { status: 404, headers: noStore });
    const out = await dryRunPlan(env, g.record);
    return Response.json(out, { status: out.ok ? 200 : 400, headers: noStore });
  }
  const sv = p.match(new RegExp("^" + BASE + "/b/([A-Za-z0-9-]{1,40})/bp-save\\.json$"));
  if (sv) {
    // The real save (src/stage-sync.js pushBuylistPrices): admin account or
    // the staff key, POST only, and the BinderPOS number typed back as
    // confirm. The outcome is written on the record.
    if (request.method !== "POST") return Response.json({ error: "POST" }, { status: 405, headers: noStore });
    if (!(user && user.role === "admin") && !pinOk) return Response.json({ error: "admin sign-in or staff key required" }, { status: 403, headers: noStore });
    const g = await doCall(env, origin, "/_stage/get?id=" + encodeURIComponent(sv[1]));
    if (!g.ok) return Response.json({ ok: false, error: "no such buylist" }, { status: 404, headers: noStore });
    const out = await pushBuylistPrices(env, g.record, { confirm: (form && form.confirm) || url.searchParams.get("confirm") || "" });
    try { await doCall(env, origin, "/_stage/bpsync", { id: g.record.id, result: out, by: user ? user.email : "staff key" }); } catch {}
    return Response.json(out, { status: out.ok ? 200 : 400, headers: noStore });
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

// Move `take` copies of a worksheet line to another condition, at today's
// BinderPOS price for that condition and the line's finish. The condition is
// named (the worksheet offers the store's names); BinderPOS's own variant id
// and price come from its buylist for that card.
export async function regradeLine(env, url, rec, f, who) {
  const src = (rec.cards || []).find((c) => lineKey(c) === String(f.key || ""));
  if (!src) return { ok: false, error: "no such line on this buylist" };
  const want = String(f.conditionName || "").trim().toLowerCase();
  if (!want) return { ok: false, error: "which condition?" };
  const have = Math.max(0, parseInt(src.quantity, 10) || 0);
  const take = Math.max(1, Math.min(have, parseInt(f.take, 10) || 1));
  let conds;
  try { conds = await conditionsFor(env, src); }
  catch (e) { return { ok: false, error: "could not read BinderPOS's conditions for that card: " + String((e && e.message) || e).slice(0, 160) }; }
  const v = conds.find((x) => x.name.trim().toLowerCase() === want);
  if (!v) return { ok: false, error: "BinderPOS has no \"" + String(f.conditionName) + "\" for " + String(src.cardName) + " (it offers: " + (conds.map((x) => x.name).join(", ") || "nothing") + ")" };
  const o = v.offers[String(src.type || "Normal").toLowerCase().replace(/[^a-z0-9]+/g, "")];
  if (!o || !Number.isFinite(o.buy)) return { ok: false, error: "BinderPOS is not buying " + String(src.cardName) + " in " + v.name + (src.type && src.type !== "Normal" ? " " + src.type : "") + " right now" };
  let buy = o.buy, credit = o.credit;
  if (!(o.max > 0)) {
    if (o.overstock && (o.overBuy != null || o.overCredit != null)) { buy = o.overBuy != null ? Number(o.overBuy) : buy; credit = o.overCredit != null ? Number(o.overCredit) : credit; }
    else return { ok: false, error: "BinderPOS has all it wants of " + String(src.cardName) + " in " + v.name + " right now" };
  }
  const card = { ...src, condition: v.id, conditionName: v.name, cashBuyPrice: buy, storeCreditBuyPrice: credit, quantity: String(take), staffPriced: false, shopifyVariantId: o.productVariantId || src.shopifyVariantId };
  const j = await doCall(env, url.origin, "/_stage/regrade", { id: rec.id, key: String(f.key || ""), take, card, by: who });
  if (!j.ok) return { ok: false, error: j.error };
  return { ok: true, id: rec.id, totals: j.record.totals, take, message: (j.merged ? "Moved " : "Regraded ") + take + " × " + lineLabel(src) + " to " + v.name + " at " + money(buy) + " / " + money(credit) + (j.merged ? " (joined the existing line)" : "") + "." };
}

async function control(env, url, f, user) {
  const id = String(f.id || "").slice(0, 40);
  const action = String(f.action || "");
  const who = user.email;
  const deny = (what) => ({ ok: false, status: 403, error: "Your account cannot " + what + ". Ask an admin." });
  if (!id) return { ok: false, error: "id required" };
  // Staff ENABLE the customer's email at this stage (owner, 2026-09-22):
  // nothing goes out at approve / reject unless the box was ticked.
  const notify = f.notify === true || f.notify === "1" || f.notify === "on" || f.notify === "true";
  const mailNote = (r) => !notify ? "" : r.ok ? " Email sent to the customer." : " The customer email was not sent (" + (r.error || r.status) + ").";
  if (action === "payment") {
    if (!can(user, "edit")) return deny("change how the customer is paid");
    const j = await doCall(env, url.origin, "/_stage/payment", { id, paymentType: String(f.paymentType || ""), by: who });
    return j.ok ? { ok: true, id, paymentType: j.record.paymentType, message: "Paid as " + j.record.paymentType + "." } : { ok: false, error: j.error };
  }
  if (action === "reject") {
    if (!can(user, "approve")) return deny("approve or reject");
    // The form's one field is the reason the customer sees; the staff note
    // saved on the worksheet is left as it is.
    const body = { id, status: "rejected", customerNote: String(f.customerNote || f.note || ""), by: who };
    if (typeof f.staffNote === "string") body.note = f.staffNote;
    const j = await doCall(env, url.origin, "/_stage/mark", body);
    if (!j.ok) return { ok: false, error: j.error };
    const m = notify ? await emailDecision(env, url, j.record, "rejected", who) : { ok: true };
    return { ok: true, id, status: "rejected", message: "Rejected. Nothing was sent to BinderPOS." + mailNote(m) };
  }
  if (action === "edit") {
    let edit = f.edit;
    if (typeof edit === "string") { try { edit = JSON.parse(edit); } catch { edit = null; } }
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    // Only the paid-as price column can change (owner, 2026-09-22: a cash
    // price typed on a Store Credit list looked like a lost save). The
    // worksheet locks the other column; a hand-built request is trimmed too.
    edit = lockUnpaidPrice(g.record, edit);
    const needs = editNeeds(g.record.cards, applyEdit(g.record, edit));
    const noteChanged = typeof f.note === "string" && f.note !== (g.record.note || "");
    if ((needs.qty || noteChanged) && !can(user, "edit")) return deny("change quantities or notes");
    if (needs.prices && !can(user, "prices")) return deny("change prices");
    const body = { id, edit, by: who };
    if (typeof f.note === "string") body.note = f.note;
    const j = await doCall(env, url.origin, "/_stage/edit", body);
    return j.ok ? { ok: true, id, totals: j.record.totals, message: "Saved." } : { ok: false, error: j.error };
  }
  if (action === "regrade") {
    if (!can(user, "edit")) return deny("change conditions");
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    if (g.record.status !== "staged") return { ok: false, error: "already " + g.record.status };
    return regradeLine(env, url, g.record, f, who);
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
    if (!j.ok) return { ok: false, error: j.error };
    // The worksheet's prices into the pending BinderPOS buylist (owner,
    // 2026-09-22, after 9P-1005 arrived there at BinderPOS's own prices):
    // src/stage-sync.js, verified by a re-read; STAGE_BP_SYNC=off disables it.
    let sync = null;
    if (String((env && env.STAGE_BP_SYNC) || "") !== "off" && j.record.bp && j.record.bp.number) {
      try { sync = await pushBuylistPrices(env, j.record, { confirm: j.record.bp.number }); }
      catch (e) { sync = { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
      try { await doCall(env, url.origin, "/_stage/bpsync", { id, result: sync, by: who }); } catch {}
    }
    const syncNote = !sync ? "" : sync.ok && sync.saved ? " Worksheet prices saved in BinderPOS" + (sync.verified ? "." : " (could not be verified - check them there).") : sync.ok ? "" : " BinderPOS still has its own prices: " + (sync.error || "the save failed") + " - fix them there by hand.";
    const m = notify ? await emailDecision(env, url, j.record, "approved", who) : { ok: true };
    return { ok: true, id, status: "approved", reference: j.record.bp && j.record.bp.number, repriced: merged.notes, bpSync: sync, message: "Approved and sent to BinderPOS" + (j.record.bp && j.record.bp.number ? " as buylist " + j.record.bp.number : "") + "." + syncNote + mailNote(m) };
  }
  return { ok: false, error: "action must be approve, reject, edit, add, regrade, payment or email" };
}

// /9pocket/admin/control: accounts. Admin only (checked by the caller).
async function adminControl(env, origin, f, admin) {
  const action = String(f.action || "");
  const email = normEmail(f.email);
  if (action === "add") {
    const r = await createAccount(env, origin, { email: f.email, name: f.name, password: f.password, role: f.role, perms: permsFrom(f), limits: limitsFrom(f), createdBy: admin.email });
    return r.ok ? { ok: true, message: "Account created for " + email + "." } : { ok: false, error: r.error };
  }
  if (action === "device-pair") {
    const r = await doCall(env, origin, "/_stage/pair/approve", { code: f.code, name: f.name, perms: f, by: admin.email });
    return r.ok ? { ok: true, message: "Paired " + r.name + ". The device picks its key up within a few seconds." } : { ok: false, error: r.error };
  }
  if (action === "device-create") {
    const r = await doCall(env, origin, "/_stage/device-key/create", { name: f.name, perms: f, by: admin.email });
    return r.ok ? { ok: true, message: "Key created for " + r.name + ".", newKey: { name: r.name, key: r.key } } : { ok: false, error: r.error };
  }
  if (action === "device-revoke") {
    const r = await doCall(env, origin, "/_stage/device-key/revoke", { id: f.id });
    return r.ok ? { ok: true, message: "Revoked " + r.name + ". It stops working within a minute." } : { ok: false, error: r.error };
  }
  if (action === "pin-off" || action === "pin-on") {
    const r = await doCall(env, origin, "/_stage/cfg/pin", { off: action === "pin-off", by: admin.email });
    return r.ok ? { ok: true, message: action === "pin-off" ? "The staff PIN is off. Screens open with an account now (it can take up to a minute everywhere)." : "The staff PIN works again." } : { ok: false, error: r.error || "failed" };
  }
  if (!validEmail(email)) return { ok: false, error: "Which account? The email is missing." };
  const self = email === admin.email;
  if (action === "update") {
    const user = { email, name: String(f.name || "").trim().slice(0, 120), role: f.role === "admin" ? "admin" : "staff", perms: permsFrom(f), limits: limitsFrom(f) };
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
