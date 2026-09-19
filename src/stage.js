/* ---------------- Staged buylists: our approval before BinderPOS ----------------
   Owner, 2026-09-19: "recreate the cart system using binderpos sort of like
   the buylist system ... when submitted it goes to a staging area and then
   when we approve the stage it then goes through binderpos as normal to
   increase card quantities".

   What changes: /buylist/api/submit (src/buylist.js) used to forward the
   repriced list to BinderPOS on the spot. With staging on it stores the
   list here instead, tells staff, and answers the shopper that the list is
   with us for review. Staff open /buylist/staged (staff PIN), see every
   pending list with its cards and prices, and approve or reject it. Approve
   makes the very call submit used to make - submitToBinderPos() in
   src/buylist.js, the same function - so from BinderPOS's point of view
   nothing is different: a buylist arrives, staff complete it in the portal
   as they do today, the customer is paid and the stock rises. Reject keeps
   the list here with a note and sends nothing anywhere.

   Nothing in this file talks to BinderPOS directly; the one place that
   does is buylist.js, and this module calls it. Prices are re-read from
   BinderPOS at approval exactly as they were at submit, so a list that sat
   for a day goes in at that day's buylist prices, and any difference from
   what the shopper saw is recorded on the record for staff to see.

   Off switch: the worker var BUYLIST_STAGING="off" returns submit to the
   direct path with no deploy. Default is on.

   Storage: its own Durable Object instance (STAGE_DO, class BinderRoom in
   room.js like the hold, price and enrichment jobs), /_stage/* paths only.
     st:<id>     one record: {id, ts, customer, paymentType, cards[], totals,
                 repriced, status: staged|approved|rejected, events[], note,
                 bp: {number, upstream, cleared} once approved}
   Approved and rejected records are pruned after KEEP_MS by the alarm;
   staged ones are never pruned - a forgotten list should stay visible. */

import { repriceCards, submitToBinderPos, cleanCards } from "./buylist.js";
import { ntfyTarget } from "./autoprice.js";

export const STAGE_DO = "buylist-stage";
const KEEP_MS = 90 * 86400e3;
const PRUNE_EVERY_MS = 24 * 3600e3;
const MAX_LIST = 300;
const MINE_MAX = 20;
const STATUSES = ["staged", "approved", "rejected"];
const STAFF_PAGE = "/buylist/staged";
const ADMIN_CUSTOMER = "https://admin.shopify.com/store/most-wanted-ca/customers/";

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const SHOP = (env) => (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";

export function stagingOn(env) {
  return String((env && env.BUYLIST_STAGING) || "on").trim().toLowerCase() !== "off";
}

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
// where it stands.
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
  return { id, ts, customer, customerName, customerEmail, paymentType, cards, totals: totalsOf(cards), repriced, status: "staged", note: "", events: [{ ts, action: "submitted" }], bp: null };
}
const strs = (v) => (Array.isArray(v) ? v.slice(0, 100).map((s) => String(s).slice(0, 200)) : []);

// A card's picture, for the staff page only: the imageUrl BinderPOS's search
// put on the card object (their TCGplayer scan), kept only when it is an
// https URL. Anything else draws no thumbnail rather than a broken one.
export function safeImage(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 400 ? s : "";
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

// What the shopper may see of their own records: status and totals, never
// the staff note or the BinderPOS reply body.
export function mineView(rec) {
  return {
    id: rec.id, ts: rec.ts, status: rec.status, paymentType: rec.paymentType, totals: rec.totals,
    cards: (rec.cards || []).map((c) => ({ cardName: c.cardName, setName: c.setName, conditionName: c.conditionName, type: c.type, quantity: c.quantity, cash: c.cashBuyPrice, credit: c.storeCreditBuyPrice })),
    reference: rec.bp && rec.bp.number ? rec.bp.number : null,
    decidedAt: (rec.events || []).filter((e) => e.action === "approved" || e.action === "rejected").map((e) => e.ts).pop() || null,
    customerNote: rec.status === "rejected" && rec.customerNote ? rec.customerNote : "",
  };
}

// The staff edit: quantities and removals only. Every card kept must be one
// of the record's own (matched by card, condition and finish), so an edit
// can never add a line the shopper did not send.
export function applyEdit(rec, edit) {
  const want = new Map();
  for (const e of Array.isArray(edit) ? edit : []) {
    if (!e) continue;
    want.set(lineKey(e), Math.max(0, Math.min(999, parseInt(e.quantity, 10) || 0)));
  }
  const cards = [];
  for (const c of rec.cards || []) {
    const k = lineKey(c);
    if (!want.has(k)) { cards.push(c); continue; }        // untouched line
    const q = want.get(k);
    if (q > 0) cards.push({ ...c, quantity: String(q) });  // q of 0 removes it
  }
  return cards;
}
const lineKey = (c) => String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase();

/* ---------------- the DO side ---------------- */

export async function stageDoFetch(cx, request, url) {
  await armAlarm(cx);
  if (url.pathname === "/_stage/put" && request.method === "POST") {
    const rec = shapeRecord(await bodyOf(request), cx.now());
    if (!rec) return doJson({ ok: false, error: "customer, paymentType and cards[] required" }, 400);
    await cx.storage.put("st:" + rec.id, rec);
    return doJson({ ok: true, id: rec.id, totals: rec.totals });
  }
  if (url.pathname === "/_stage/get") {
    const rec = await cx.storage.get("st:" + String(url.searchParams.get("id") || "").slice(0, 40));
    return rec ? doJson({ ok: true, record: rec }) : doJson({ ok: false, error: "no such record" }, 404);
  }
  if (url.pathname === "/_stage/list") {
    const status = String(url.searchParams.get("status") || "");
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days"), 10) || 30));
    const since = cx.now() - days * 86400e3;
    const all = await listAll(cx);
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
    if (b.repricedAtApproval && typeof b.repricedAtApproval === "object") rec.repricedAtApproval = { changed: strs(b.repricedAtApproval.changed), capped: strs(b.repricedAtApproval.capped), dropped: strs(b.repricedAtApproval.dropped) };
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
    rec.cards = cards; rec.totals = totalsOf(cards);
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "edited" }]).slice(-20);
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
  if (url.pathname === "/_stage/health") {
    const all = await listAll(cx);
    const counts = {};
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    return doJson({ ok: true, counts, oldestStaged: all.filter((r) => r.status === "staged").map((r) => r.ts).sort()[0] || null });
  }
  return doJson({ ok: false, error: "not found" }, 404);
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
// id; the staff push is best-effort and never fails the submission.
export async function stageSubmit(env, url, { customer, paymentType, cards, repriced }) {
  // The customer's name and email for staff (owner, 2026-09-19: "include the
  // customer name"). Looked up here, once, so the record carries it.
  const who = await lookupCustomer(env, customer);
  const j = await doCall(env, url.origin, "/_stage/put", { customer, customerName: who.name, customerEmail: who.email, paymentType, cards, repriced });
  if (!j.ok) throw new Error(j.error || "could not stage the list");
  try { await notifyStaff(env, url, { id: j.id, customer, customerName: who.name, paymentType, totals: j.totals }); } catch {}
  return { id: j.id, totals: j.totals };
}

// The shopper's own records, for the sell page.
export async function stageMine(env, url, customer) {
  const j = await doCall(env, url.origin, "/_stage/mine?customer=" + encodeURIComponent(customer));
  return j.ok ? j.records : [];
}

async function notifyStaff(env, url, s) {
  const t = ntfyTarget(env && env.AUTOPRICE_NTFY);
  if (!t) return;
  const headers = { "content-type": "application/json" };
  if (env.AUTOPRICE_NTFY_TOKEN) headers.authorization = "Bearer " + String(env.AUTOPRICE_NTFY_TOKEN).trim();
  const body = `${s.totals.units} card${s.totals.units === 1 ? "" : "s"} · ${money(s.totals.cash)} cash / ${money(s.totals.credit)} credit · ${s.paymentType} · ${s.customerName || "customer " + s.customer}`;
  await fetch(t.server + "/", { method: "POST", headers, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ topic: t.topic, title: "Buylist to review", message: body, priority: 3, tags: ["inbox_tray"], click: url.origin + STAFF_PAGE }) });
}

// /buylist/staged (page), /buylist/staged.json, /buylist/staged/control
export async function serveStage(request, env, url, staffOk) {
  const noStore = { "cache-control": "no-store" };
  if (url.pathname === "/buylist/staged/health") {
    const j = await doCall(env, url.origin, "/_stage/health");
    const out = { ...j, staging: stagingOn(env) ? "on" : "off", customerLookup: env && env.SHOPIFY_ADMIN_TOKEN ? "configured" : "no token" };
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
  if (url.pathname === "/buylist/staged.json") {
    if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: noStore });
    const j = await doCall(env, url.origin, "/_stage/list?status=" + encodeURIComponent(url.searchParams.get("status") || "") + "&days=" + encodeURIComponent(url.searchParams.get("days") || "30"));
    return Response.json({ ...j, staging: stagingOn(env) ? "on" : "off" }, { headers: noStore });
  }
  if (url.pathname === "/buylist/staged/control" && request.method === "POST") {
    if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: noStore });
    const result = await control(env, url, form || {});
    if (form && form.__form) return new Response(null, { status: 303, headers: { location: STAFF_PAGE + "?k=" + encodeURIComponent(k) + (result.ok ? "" : "&err=" + encodeURIComponent(result.error || "failed")), ...noStore } });
    return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
  }
  if (url.pathname === STAFF_PAGE) {
    if (!ok) return new Response(renderLogin(k ? "That key was not accepted." : ""), { status: k ? 403 : 200, headers: { "content-type": "text/html; charset=utf-8", ...noStore } });
    const j = await doCall(env, url.origin, "/_stage/list?days=" + encodeURIComponent(url.searchParams.get("days") || "30"));
    await backfillNames(env, url, j);
    return new Response(renderPage(j, k, env, url.searchParams.get("err") || ""), { headers: { "content-type": "text/html; charset=utf-8", ...noStore } });
  }
  return Response.json({ error: "not found" }, { status: 404, headers: noStore });
}

// Waiting lists that have no name yet (staged before the lookup shipped, or
// Shopify did not answer at submit): look up to five per page view and keep
// what comes back, so the page shows names without anyone resubmitting.
async function backfillNames(env, url, j) {
  if (!(env && env.SHOPIFY_ADMIN_TOKEN) || !j || !Array.isArray(j.records)) return;
  const todo = j.records.filter((r) => r.status === "staged" && !r.customerName).slice(0, 5);
  for (const r of todo) {
    try {
      const who = await lookupCustomer(env, r.customer);
      if (!who.name) continue;
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
    const j = await doCall(env, url.origin, "/_stage/mark", { id, status: "rejected", note: String(f.note || ""), customerNote: String(f.customerNote || f.note || "") });
    return j.ok ? { ok: true, id, status: "rejected" } : { ok: false, error: j.error };
  }
  if (action === "edit") {
    let edit = f.edit;
    if (typeof edit === "string") { try { edit = JSON.parse(edit); } catch { edit = null; } }
    const j = await doCall(env, url.origin, "/_stage/edit", { id, edit });
    return j.ok ? { ok: true, id, totals: j.record.totals } : { ok: false, error: j.error };
  }
  if (action === "approve") {
    const g = await doCall(env, url.origin, "/_stage/get?id=" + encodeURIComponent(id));
    if (!g.ok) return { ok: false, error: g.error };
    const rec = g.record;
    if (rec.status !== "staged") return { ok: false, error: "already " + rec.status };
    // Today's BinderPOS prices and limits, the same step submit takes.
    let repriced;
    try { repriced = await repriceCards(env, rec.cards); }
    catch (e) { return { ok: false, error: "could not confirm today's prices with BinderPOS: " + String((e && e.message) || e).slice(0, 160) }; }
    if (!repriced.cards.length) return { ok: false, error: "none of these cards can be bought right now: " + repriced.dropped.join("; ") };
    const r = await submitToBinderPos(env, url, rec.customer, rec.paymentType, repriced.cards);
    if (!r.accepted) return { ok: false, error: "BinderPOS did not accept the submission: " + ((r.reply && r.reply.message) || ("HTTP " + r.upstream)) };
    const j = await doCall(env, url.origin, "/_stage/mark", {
      id, status: "approved", note: String(f.note || rec.note || ""), cards: repriced.cards,
      bp: { number: r.reply && r.reply.data != null ? String(r.reply.data) : "", upstream: r.upstream, cleared: r.cleared },
      repricedAtApproval: { changed: repriced.changed, capped: repriced.capped, dropped: repriced.dropped },
    });
    return j.ok ? { ok: true, id, status: "approved", reference: j.record.bp && j.record.bp.number, repriced: { changed: repriced.changed, capped: repriced.capped, dropped: repriced.dropped } } : { ok: false, error: j.error };
  }
  return { ok: false, error: "action must be approve, reject or edit" };
}

/* ---------------- the staff page ---------------- */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false }) : "";
const CSS = `body{margin:0;padding:20px;font:14px/1.45 system-ui,sans-serif;color:#1d2327;background:#f4f6f7}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px}.muted{color:#6b7780}.wrap{max-width:1100px;margin:0 auto}.tag{display:inline-block;padding:2px 8px;border-radius:99px;font-weight:600;font-size:12px;vertical-align:middle;margin-left:8px}.tag-staged{background:#fde68a;color:#5b4300}.tag-approved{background:#d1fae5;color:#065f46}.tag-rejected{background:#fee2e2;color:#7f1d1d}.tag-off{background:#e5e7eb;color:#374151}.card{margin:12px 0;background:#fff;border:1px solid #dde3e7;border-radius:10px;padding:14px}.card h3{margin:0 0 6px;font-size:15px}.kv{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0}.kv b{color:#1d2327}table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}th{text-align:left;padding:6px 8px;background:#eef2f4;font-weight:600}td{padding:6px 8px;border-top:1px solid #eef2f4;vertical-align:middle}td.n,th.n{text-align:right;white-space:nowrap}td.t{width:52px;padding:4px 6px}.thumb{display:block;width:44px;height:auto;border-radius:4px;background:#eef2f4;transition:transform .12s ease}a.zoom{display:block;position:relative}a.zoom:hover .thumb,a.zoom:focus .thumb{transform:scale(4.2);transform-origin:left center;position:relative;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.4);border-radius:8px}.who{font-weight:600;color:#1d2327}input.q{width:56px;padding:3px 6px;border:1px solid #cbd3d9;border-radius:6px;text-align:right}.act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}button{padding:7px 12px;border-radius:8px;border:1px solid #cbd3d9;background:#fff;cursor:pointer;font:inherit}button.ok{background:#0d7a5f;border-color:#0d7a5f;color:#fff;font-weight:600}button.no{background:#fff;border-color:#b42318;color:#b42318}button.save{background:#eef2f4}.err{background:#fee2e2;color:#7f1d1d;padding:8px 12px;border-radius:8px;margin:10px 0}.note{font-size:13px;color:#5b4300;background:#fff8dc;border-radius:8px;padding:6px 10px;margin:6px 0}a{color:#0d7a5f}form.login{max-width:360px;margin:60px auto;background:#fff;border:1px solid #dde3e7;border-radius:10px;padding:20px}form.login input{width:100%;padding:8px 10px;border:1px solid #cbd3d9;border-radius:8px;margin:8px 0 12px;font:inherit}`;

function renderLogin(err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Buylists to review</title><style>${CSS}</style></head><body>
<form class="login" method="get" action="${STAFF_PAGE}"><h1>Buylists to review</h1><p class="muted">Staff key.</p>${err ? `<div class="err">${esc(err)}</div>` : ""}<input type="password" name="k" autofocus autocomplete="current-password"><button class="ok" type="submit">Open</button></form></body></html>`;
}

function renderPage(d, k, env, err) {
  const records = (d && d.records) || [];
  const staged = records.filter((r) => r.status === "staged");
  const done = records.filter((r) => r.status !== "staged");
  const counts = (d && d.counts) || {};
  const on = stagingOn(env);
  // The thumbnail (owner, 2026-09-19: "a thumbnail ... so we can see the
  // physical card to compare it"): BinderPOS's scan of the card, hover to
  // enlarge, click for the full image in a new tab.
  const thumb = (c) => { const u = safeImage(c.imageUrl); return `<td class="t">${u ? `<a class="zoom" href="${esc(u)}" target="_blank" rel="noopener" title="Open the full image"><img class="thumb" src="${esc(u)}" alt="" loading="lazy"></a>` : ""}</td>`; };
  const line = (c) => `<tr data-key="${esc(String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase())}">${thumb(c)}<td>${esc(c.cardName)} <span class="muted">[${esc(c.setName)}]</span></td><td>${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? " · " + esc(c.type) : ""}</td><td class="n"><input class="q" type="number" min="0" max="999" value="${esc(c.quantity)}" data-orig="${esc(c.quantity)}"></td><td class="n">${money(c.cashBuyPrice)}</td><td class="n">${money(c.storeCreditBuyPrice)}</td><td class="n">${money((parseInt(c.quantity, 10) || 0) * (Number(c.cashBuyPrice) || 0))} / ${money((parseInt(c.quantity, 10) || 0) * (Number(c.storeCreditBuyPrice) || 0))}</td></tr>`;
  const roLine = (c) => `<tr>${thumb(c)}<td>${esc(c.cardName)} <span class="muted">[${esc(c.setName)}]</span></td><td>${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? " · " + esc(c.type) : ""}</td><td class="n">${esc(c.quantity)}</td><td class="n">${money(c.cashBuyPrice)}</td><td class="n">${money(c.storeCreditBuyPrice)}</td><td class="n">${money((parseInt(c.quantity, 10) || 0) * (Number(c.cashBuyPrice) || 0))} / ${money((parseInt(c.quantity, 10) || 0) * (Number(c.storeCreditBuyPrice) || 0))}</td></tr>`;
  const head = `<thead><tr><th class="t"></th><th>Card</th><th>Condition</th><th class="n">Qty</th><th class="n">Cash</th><th class="n">Credit</th><th class="n">Line cash / credit</th></tr></thead>`;
  // Who sent it: name (and email) from Shopify when the lookup answered, the
  // id link to their Shopify admin record either way.
  const who = (r) => `${r.customerName ? `<span class="who">${esc(r.customerName)}</span>${r.customerEmail ? ` <span class="muted">${esc(r.customerEmail)}</span>` : ""} · ` : ""}<a href="${ADMIN_CUSTOMER}${esc(r.customer)}" target="_blank" rel="noopener">${r.customerName ? "Shopify record" : "customer " + esc(r.customer)}</a>`;
  const notes = (rp, label) => rp && (rp.changed.length || rp.capped.length || rp.dropped.length)
    ? `<div class="note"><b>${esc(label)}:</b> ${rp.changed.length ? "prices changed - " + esc(rp.changed.join("; ")) + ". " : ""}${rp.capped.length ? "quantities capped - " + esc(rp.capped.join("; ")) + ". " : ""}${rp.dropped.length ? "left out - " + esc(rp.dropped.join("; ")) + "." : ""}</div>` : "";
  const cardBlock = (r, editable) => `<div class="card" id="rec-${esc(r.id)}"><h3>${esc(when(r.ts))} <span class="tag tag-${esc(r.status)}">${esc(r.status)}</span> <span class="muted">· ${esc(r.paymentType)} · ${who(r)}${r.bp && r.bp.number ? " · BinderPOS reference " + esc(r.bp.number) : ""}</span></h3>
<div class="kv"><span>Cards <b>${r.totals.units}</b> (${r.totals.lines} line${r.totals.lines === 1 ? "" : "s"})</span><span>Cash <b>${money(r.totals.cash)}</b></span><span>Store credit <b>${money(r.totals.credit)}</b></span>${r.note ? `<span>Note <b>${esc(r.note)}</b></span>` : ""}</div>
${notes(r.repriced, "At submit")}${notes(r.repricedAtApproval, "At approval")}
<table>${head}<tbody>${(r.cards || []).map(editable ? line : roLine).join("")}</tbody></table>
${editable ? `<div class="act"><button class="save" type="button" onclick="saveEdit('${esc(r.id)}')">Save quantity changes</button><span class="muted">Set a quantity to 0 to leave that card out.</span></div>
<form method="post" action="${STAFF_PAGE}/control" class="act" onsubmit="return confirm('Send this buylist to BinderPOS now? It will appear there as a new online buylist under ${esc((r.customerName || "this customer").replace(/['\\\\]/g, ""))} at today\\'s prices.')"><input type="hidden" name="__form" value="1"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="action" value="approve"><input name="note" placeholder="staff note (optional)" style="flex:1 1 220px;padding:7px 10px;border:1px solid #cbd3d9;border-radius:8px"><button class="ok" type="submit">Approve → send to BinderPOS</button></form>
<form method="post" action="${STAFF_PAGE}/control" class="act" onsubmit="return confirm('Reject this buylist? Nothing is sent to BinderPOS; the customer sees it as declined with your note.')"><input type="hidden" name="__form" value="1"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="action" value="reject"><input name="note" placeholder="reason the customer will see" style="flex:1 1 220px;padding:7px 10px;border:1px solid #cbd3d9;border-radius:8px"><button class="no" type="submit">Reject</button></form>` : ""}
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Buylists to review</title><style>${CSS}</style></head><body><div class="wrap">
<h1>Buylists to review <span class="tag ${on ? "tag-staged" : "tag-off"}">${on ? "staging on" : "staging OFF - submissions go straight to BinderPOS"}</span></h1>
<p class="muted">Online buylists wait here until a staff member approves them. Approve sends the list to BinderPOS as a new online buylist under the customer who submitted it, at today's buylist prices - then it is completed in the BinderPOS portal exactly as before, which is when the customer is paid and the stock rises. Reject keeps it here and sends nothing. Hover a thumbnail to enlarge it, click for the full image. Atlantic time. <a href="${STAFF_PAGE}?k=${encodeURIComponent(k)}">refresh</a> · <a href="/portal/buylists?k=${encodeURIComponent(k)}">BinderPOS's list</a></p>
${err ? `<div class="err">${esc(err)}</div>` : ""}
<div class="kv"><span>Waiting <b>${counts.staged || 0}</b></span><span>Approved (90 days) <b>${counts.approved || 0}</b></span><span>Rejected (90 days) <b>${counts.rejected || 0}</b></span></div>
<h2>Waiting for approval · ${staged.length}</h2>
${staged.length ? staged.map((r) => cardBlock(r, true)).join("") : '<p class="muted">Nothing waiting.</p>'}
<h2>Decided · last 30 days · ${done.length}</h2>
${done.length ? done.map((r) => cardBlock(r, false)).join("") : '<p class="muted">Nothing decided yet.</p>'}
</div>
<script>
function saveEdit(id){var rows=document.querySelectorAll('#rec-'+id+' tr[data-key]');var edit=[];rows.forEach(function(tr){var inp=tr.querySelector('input.q');if(inp&&inp.value!==inp.getAttribute('data-orig')){var p=tr.getAttribute('data-key').split('|');edit.push({cardId:p[0],condition:p[1],type:p[2],quantity:inp.value});}});if(!edit.length){alert('No quantity was changed.');return;}
fetch('${STAFF_PAGE}/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:${JSON.stringify(k)},id:id,action:'edit',edit:edit})}).then(function(r){return r.json()}).then(function(j){if(!j.ok){alert(j.error||'failed');return;}location.reload();}).catch(function(e){alert(String(e));});}
</script></body></html>`;
}
