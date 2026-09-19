/* ---------------- 9Pocket by Exor: our approval before BinderPOS ----------------
   Owner, 2026-09-19: "recreate the cart system using binderpos sort of like
   the buylist system ... when submitted it goes to a staging area and then
   when we approve the stage it then goes through binderpos as normal to
   increase card quantities"; then "lists out the buylists similar to
   binderpos pending list ... go into a new page where it's like a worksheet
   ... call it '9Pocket by Exor'".

   What changes: /buylist/api/submit (src/buylist.js) used to forward the
   repriced list to BinderPOS on the spot. With 9Pocket on it stores the
   list here instead, gives it a number (9P-1001, 9P-1002, ...), emails the
   customer their list and our instructions (src/stage-email.js), tells
   staff, and answers the shopper that the list is with us for review.
   Staff open /9pocket (staff PIN): a list of every buylist, and a worksheet
   per buylist where quantities and prices can be changed and saved, then
   approve or reject. Approve makes the very call submit used to make -
   submitToBinderPos() in src/buylist.js, the same function, with the
   customer's own Shopify id - so from BinderPOS's point of view nothing is
   different: a buylist arrives under that customer, staff complete it in the
   portal as they do today, the customer is paid and the stock rises. Reject
   keeps the list here with a note and sends nothing anywhere.

   Prices at approval: BinderPOS's prices of the day are re-read (repriceCards,
   the same step submit takes) for every line EXCEPT one a staff member typed
   a price for on the worksheet - that price is kept, because the worksheet is
   where staff correct the estimate (owner: "edit prices").

   Off switch: the worker var BUYLIST_STAGING="off" returns submit to the
   direct path with no deploy. Default is on.

   Storage: its own Durable Object instance (STAGE_DO, class BinderRoom in
   room.js like the hold, price and enrichment jobs), /_stage/* paths only.
     st:<id>     one record: {id, number, ts, customer, customerName,
                 customerEmail, paymentType, cards[], totals, repriced,
                 status: staged|approved|rejected, note, customerNote,
                 events[], bp: {number, upstream, cleared} once approved,
                 email: {status, at, to, id|error}}
     seq         the last buylist number handed out
   Approved and rejected records are pruned after KEEP_MS by the alarm;
   staged ones are never pruned - a forgotten list should stay visible. */

import { repriceCards, submitToBinderPos, cleanCards } from "./buylist.js";
import { ntfyTarget } from "./autoprice.js";
import { buildEmail, sendEmail, emailConfigured } from "./stage-email.js";
import { BASE, renderLogin, renderList, renderSheet, safeImage } from "./stage-ui.js";
export { safeImage };

export const STAGE_DO = "buylist-stage";
const KEEP_MS = 90 * 86400e3;
const PRUNE_EVERY_MS = 24 * 3600e3;
const MAX_LIST = 300;
const MINE_MAX = 20;
const STATUSES = ["staged", "approved", "rejected"];
const SEQ_START = 1000;                      // the first buylist is 9P-1001
const LEGACY = "/buylist/staged";            // the page's first address; redirects

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const SHOP = (env) => (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";

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
// the shopper did not send. A price that differs from the line's marks it
// staffPriced, and approval keeps that price instead of the day's.
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
const lineKey = (c) => String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase();
function priceOf(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}
const lineLabel = (c) => String(c.cardName || c.cardId) + " · " + String(c.conditionName || c.condition) + (c.type && c.type !== "Normal" ? " · " + c.type : "");

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
  if (url.pathname === "/_stage/put" && request.method === "POST") {
    const rec = shapeRecord(await bodyOf(request), cx.now());
    if (!rec) return doJson({ ok: false, error: "customer, paymentType and cards[] required" }, 400);
    rec.number = await nextNumber(cx);
    await cx.storage.put("st:" + rec.id, rec);
    return doJson({ ok: true, id: rec.id, number: rec.number, totals: rec.totals });
  }
  if (url.pathname === "/_stage/get") {
    const rec = await cx.storage.get("st:" + String(url.searchParams.get("id") || "").slice(0, 40));
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    if (!rec.number) { rec.number = await nextNumber(cx); await cx.storage.put("st:" + rec.id, rec); }
    return doJson({ ok: true, record: rec });
  }
  if (url.pathname === "/_stage/list") {
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
  if (url.pathname === "/_stage/mine") {
    const customer = digits(url.searchParams.get("customer"));
    if (!customer) return doJson({ ok: false, error: "customer required" }, 400);
    const all = await listAll(cx);
    return doJson({ ok: true, records: all.filter((r) => r.customer === customer).slice(0, MINE_MAX).map(mineView) });
  }
  if (url.pathname === "/_stage/mark" && request.method === "POST") {
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
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: status === "staged" ? "edited" : status }]).slice(-20);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (url.pathname === "/_stage/edit" && request.method === "POST") {
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
    if (changed) rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "edited" }]).slice(-20);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (url.pathname === "/_stage/who" && request.method === "POST") {
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
  if (url.pathname === "/_stage/email" && request.method === "POST") {
    // What happened to the customer's email (sent / failed / not configured).
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    const e = b.email && typeof b.email === "object" ? b.email : {};
    rec.email = { status: String(e.status || "failed").slice(0, 20), at: cx.now(), to: String(e.to || "").slice(0, 160), id: String(e.id || "").slice(0, 64), error: String(e.error || "").slice(0, 200) };
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: rec.email.status === "sent" ? "emailed" : "email " + rec.email.status }]).slice(-20);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (url.pathname === "/_stage/health") {
    const all = await listAll(cx);
    const counts = {};
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    return doJson({ ok: true, counts, oldestStaged: all.filter((r) => r.status === "staged").map((r) => r.ts).sort()[0] || null, lastNumber: numberOf((await cx.storage.get("seq")) || SEQ_START) });
  }
  return doJson({ ok: false, error: "not found" }, 404);
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
  try { await emailCustomer(env, url, (await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(j.id))).record); } catch {}
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
async function emailCustomer(env, url, rec) {
  if (!rec) return { ok: false, status: "failed", error: "no record" };
  let out;
  try { out = await sendEmail(env, rec.customerEmail, buildEmail(rec)); }
  catch (e) { out = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
  try { await doCall(env, url.origin, "/_stage/email", { id: rec.id, email: { ...out, to: rec.customerEmail || "" } }); } catch {}
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

// /9pocket (list), /9pocket/b/<id> (worksheet), /9pocket/email/<id>
// (preview), /9pocket.json, /9pocket/control, /9pocket/health; the old
// /buylist/staged addresses redirect here.
export async function serveStage(request, env, url, staffOk) {
  const noStore = { "cache-control": "no-store" };
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", ...noStore } });
  if (url.pathname === LEGACY || url.pathname.startsWith(LEGACY + "/") || url.pathname === LEGACY + ".json") {
    const to = url.pathname === LEGACY + ".json" ? BASE + ".json" : url.pathname === LEGACY ? BASE : BASE + url.pathname.slice(LEGACY.length);
    return new Response(null, { status: 308, headers: { location: to + url.search, ...noStore } });
  }
  if (url.pathname === BASE + "/health") {
    const j = await doCall(env, url.origin, "/_stage/health");
    const out = { ...j, staging: stagingOn(env) ? "on" : "off", customerLookup: env && env.SHOPIFY_ADMIN_TOKEN ? "configured" : "no token", customerEmail: emailConfigured(env) ? "configured" : "no key" };
    // ?probe=1 (the deploy smoke): does the name lookup answer for a known
    // customer? Reports only whether a name came back, never the name.
    if (url.searchParams.get("probe") === "1") { const who = await lookupCustomer(env, "3957471740057"); out.customerLookupProbe = who.name ? "name returned" : "no name"; }
    return Response.json(out, { headers: noStore });
  }
  let k = url.searchParams.get("k") || "";
  let form = null;
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (/json/i.test(ct)) { form = await bodyOf(request); }
    else { try { const fd = await request.formData(); form = {}; for (const [a, b] of fd) form[a] = b; } catch { form = {}; } }
    if (form.k) k = String(form.k);
  }
  const ok = k ? await staffOk(env, url.origin, k) : false;
  if (url.pathname === BASE + ".json") {
    if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: noStore });
    const j = await doCall(env, url.origin, "/_stage/list?status=" + encodeURIComponent(url.searchParams.get("status") || "") + "&days=" + encodeURIComponent(url.searchParams.get("days") || "30"));
    return Response.json({ ...j, staging: stagingOn(env) ? "on" : "off" }, { headers: noStore });
  }
  if (url.pathname === BASE + "/control" && request.method === "POST") {
    if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: noStore });
    const result = await control(env, url, form || {});
    if (form && form.__form) {
      const back = form.id ? BASE + "/b/" + encodeURIComponent(String(form.id)) : BASE;
      const q = "?k=" + encodeURIComponent(k) + (result.ok ? (result.message ? "&msg=" + encodeURIComponent(result.message) : "") : "&err=" + encodeURIComponent(result.error || "failed"));
      return new Response(null, { status: 303, headers: { location: back + q, ...noStore } });
    }
    return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
  }
  const opts = { k, on: stagingOn(env), emailOn: emailConfigured(env), err: url.searchParams.get("err") || "", msg: url.searchParams.get("msg") || "" };
  if (url.pathname === BASE) {
    if (!ok) return html(renderLogin(k ? "That key was not accepted." : ""), k ? 403 : 200);
    const j = await doCall(env, url.origin, "/_stage/list?days=" + encodeURIComponent(url.searchParams.get("days") || "90"));
    await backfillNames(env, url, j);
    return html(renderList(j, opts));
  }
  const m = url.pathname.match(new RegExp("^" + BASE + "/(b|email)/([A-Za-z0-9-]{1,40})$"));
  if (m) {
    if (!ok) return html(renderLogin(k ? "That key was not accepted." : ""), k ? 403 : 200);
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(m[2]));
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

async function control(env, url, f) {
  const id = String(f.id || "").slice(0, 40);
  const action = String(f.action || "");
  if (!id) return { ok: false, error: "id required" };
  if (action === "reject") {
    // The form's one field is the reason the customer sees; the staff note
    // saved on the worksheet is left as it is.
    const body = { id, status: "rejected", customerNote: String(f.customerNote || f.note || "") };
    if (typeof f.staffNote === "string") body.note = f.staffNote;
    const j = await doCall(env, url.origin, "/_stage/mark", body);
    return j.ok ? { ok: true, id, status: "rejected", message: "Rejected. Nothing was sent to BinderPOS." } : { ok: false, error: j.error };
  }
  if (action === "edit") {
    let edit = f.edit;
    if (typeof edit === "string") { try { edit = JSON.parse(edit); } catch { edit = null; } }
    const body = { id, edit };
    if (typeof f.note === "string") body.note = f.note;
    const j = await doCall(env, url.origin, "/_stage/edit", body);
    return j.ok ? { ok: true, id, totals: j.record.totals, message: "Saved." } : { ok: false, error: j.error };
  }
  if (action === "email") {
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    let rec = g.record;
    if (!rec.customerEmail) { await backfillNames(env, url, { records: [rec] }); }
    const r = await emailCustomer(env, url, rec);
    return r.ok ? { ok: true, id, message: "Email sent to " + rec.customerEmail + "." } : { ok: false, error: "Email not sent: " + (r.error || r.status) };
  }
  if (action === "approve") {
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
      id, status: "approved", note: String(f.note || rec.note || ""), cards: merged.cards,
      bp: { number: r.reply && r.reply.data != null ? String(r.reply.data) : "", upstream: r.upstream, cleared: r.cleared },
      repricedAtApproval: merged.notes,
    });
    return j.ok ? { ok: true, id, status: "approved", reference: j.record.bp && j.record.bp.number, repriced: merged.notes, message: "Approved and sent to BinderPOS" + (j.record.bp && j.record.bp.number ? " as buylist " + j.record.bp.number : "") + "." } : { ok: false, error: j.error };
  }
  return { ok: false, error: "action must be approve, reject, edit or email" };
}
