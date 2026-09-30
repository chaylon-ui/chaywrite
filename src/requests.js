/* ---------------- Item requests ----------------
   Owner, 2026-09-30: "when something is sold out it would be nice to have a
   button that customers could use to ask for an order with an amount they
   would like to order of an item ... anything that it hasn't carried they
   can still contact the store to special order it ... an email was sent to
   charlottetown@exorgames.com but also having a backend that our employees
   could have a login for to see items people have been requesting by product
   type, date, the logged in customer email address/name, and a way to
   communicate with them ... when that item comes back in that is requested,
   we get an email ... we would also like to be able to turn off requests so
   if people are requesting hot products we know we are never getting back in".

   Customer side (theme, assets/xg-requests.js): a sold-out product page shows
   "Request this item" (quantity, name, email, note) and /pages/special-order
   takes a request for something the store does not list. Both POST to
   /requests/api/new here; the page first asks /requests/api/status?product=
   so a product (or the whole feature) that is switched off shows no button.

   Staff side: /9pocket/requests (list: status tabs, product type, days,
   search by customer or item), /9pocket/requests/r/<id> (one request: the
   customer, the thread, reply by email, mark ordered / arrived / closed /
   declined, switch requests off for that product) and the global switch.
   Accounts need the "requests" permission (admins always).

   Mail (src/stage-email.js sendEmail, Resend): every new request goes to
   REQUESTS_EMAIL_TO (default charlottetown@exorgames.com) with reply-to set to
   the customer, so a reply from the inbox reaches them; the customer gets a
   confirmation; staff replies from 9Pocket go out under the same address; and
   the alarm below emails the store when a requested variant is back in stock.

   Storage: its own Durable Object instance (REQUESTS_DO, class BinderRoom in
   room.js like the stage, hold and price jobs), /_req/* paths only.
     rq:<id>    {id, number, ts, kind: restock|special, productId, variantId,
                 variantTitle, handle, title, type, vendor, image, url, qty,
                 name, email, customerId, note, status: open|ordered|arrived|
                 closed|declined, events[{ts, action, by, note}],
                 messages[{ts, from: staff|customer, by, text, email}],
                 stock: {available, qty, checkedAt, notifiedAt}, mail: {...}}
     rqseq      the last request number handed out (RQ-1001 ...)
     rqcfg      {off, offBy, offAt, offProducts: {<productId>: {title, by, at}}}
     rqrl:<ip>  new-request counter per address {n, at}
   The alarm checks the stock of open restock requests every CHECK_MS and
   prunes decided requests after KEEP_MS. */

import { sendEmail, buildNoticeEmail, emailConfigured } from "./stage-email.js";
import { can } from "./stage-auth.js";
import { BASE } from "./stage-ui.js";
import { renderRequests, renderRequest } from "./requests-ui.js";

export const REQUESTS_DO = "requests";
export const STATUSES = ["open", "ordered", "arrived", "closed", "declined"];
export const KINDS = ["restock", "special"];
export const DEFAULT_TO = "charlottetown@exorgames.com";
export const CHECK_MS = 30 * 60e3;          // stock check for open restock requests
const KEEP_MS = 180 * 86400e3;              // decided requests are pruned after this
const RL_MAX = 8, RL_MS = 3600e3;           // new requests per address per hour
const MAX_LIST = 500;
const MAX_QTY = 999;
const ORIGINS = ["https://exorgames.com", "https://www.exorgames.com", "https://most-wanted-ca.myshopify.com"];
const STORE = "https://exorgames.com";
const ADMIN_CUSTOMER = "https://admin.shopify.com/store/most-wanted-ca/customers/";

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const text = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
export const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 160);
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const rand = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };
export const numberOf = (n) => "RQ-" + (1000 + n);

/* ---- the record ---- */

// A new request from the browser, or null when it cannot be one. A restock
// request names a product; a special order names what the shopper wants.
export function shapeRequest(b, now) {
  if (!b || typeof b !== "object") return null;
  const kind = KINDS.includes(b.kind) ? b.kind : "restock";
  const email = normEmail(b.email);
  if (!validEmail(email)) return null;
  const title = text(b.title, 200);
  if (!title) return null;
  const productId = digits(b.productId);
  if (kind === "restock" && !productId) return null;
  let qty = parseInt(b.qty, 10);
  if (!(qty >= 1)) qty = 1;
  if (qty > MAX_QTY) qty = MAX_QTY;
  const handle = text(b.handle, 200).replace(/[^a-z0-9-]/gi, "");
  let url = text(b.url, 300);
  if (!/^https:\/\/(www\.)?exorgames\.com\//.test(url)) url = handle ? STORE + "/products/" + handle : "";
  let image = text(b.image, 400);
  if (!/^https:\/\/[^\s"'<>]+$/i.test(image)) image = "";
  return {
    id: tsKey(now) + "-" + rand(),
    ts: now, kind,
    productId, variantId: digits(b.variantId), variantTitle: text(b.variantTitle, 120),
    handle, title, type: text(b.type, 80), vendor: text(b.vendor, 80), image, url,
    qty, name: text(b.name, 80), email, customerId: digits(b.customerId), note: text(b.note, 1000),
    status: "open", events: [{ ts: now, action: "requested", by: email }], messages: [],
    stock: { available: null, qty: null, checkedAt: 0, notifiedAt: 0 }, mail: {},
  };
}

// The list's filters: status, product type, days back, and words matched
// against the customer, the item and the reference.
export function filterRequests(all, f, now) {
  const status = String((f && f.status) || "");
  const type = String((f && f.type) || "");
  const days = Math.max(0, Math.min(3650, parseInt(f && f.days, 10) || 0));
  const since = days ? now - days * 86400e3 : 0;
  const words = String((f && f.q) || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r) => [r.number, r.title, r.variantTitle, r.name, r.email, r.type, r.vendor, r.note].join(" ").toLowerCase();
  return all.filter((r) => (!status || r.status === status) && (!type || r.type === type) && (!since || r.ts >= since || r.status === "open") && (!words.length || words.every((w) => hay(r).includes(w))));
}

// Which open restock requests need a stock look: the variants they name.
export function variantsToCheck(all) {
  const ids = new Set();
  for (const r of all) if (r.status === "open" && r.kind === "restock" && r.variantId) ids.add(r.variantId);
  return [...ids];
}

// A stock answer applied to a request: true when the store should be told
// (it just came back in, and nobody was told for this return yet).
export function applyStock(rec, s, now) {
  const wasAvailable = rec.stock && rec.stock.available === true;
  const available = !!(s && s.available);
  rec.stock = { available, qty: s && s.qty != null ? Number(s.qty) : null, checkedAt: now, notifiedAt: (rec.stock && rec.stock.notifiedAt) || 0 };
  if (available && !wasAvailable && rec.status === "open") return true;
  return false;
}

/* ---- the Durable Object side ---- */

async function loadCfg(cx) { return (await cx.storage.get("rqcfg")) || { off: false, offProducts: {} }; }
async function listAll(cx) {
  const m = await cx.storage.list({ prefix: "rq:" });
  const out = [];
  for (const [, v] of m) if (v && v.id) out.push(v);
  out.sort((a, b) => b.ts - a.ts);
  return out;
}
async function nextNumber(cx) { const n = ((await cx.storage.get("rqseq")) || 0) + 1; await cx.storage.put("rqseq", n); return numberOf(n); }
async function armAlarm(cx) {
  if (cx.mem.armed) return;
  cx.mem.armed = true;
  try { if ((await cx.storage.getAlarm()) == null) await cx.storage.setAlarm(cx.now() + 60e3); } catch {}
}
const by = (b) => String((b && b.by) || "").slice(0, 160);

export async function requestsDoFetch(cx, request, url) {
  await armAlarm(cx);
  const p = url.pathname;
  const post = request.method === "POST";
  if (p === "/_req/status") {
    const cfg = await loadCfg(cx);
    const pid = digits(url.searchParams.get("product"));
    const off = !!cfg.off || !!(pid && cfg.offProducts && cfg.offProducts[pid]);
    return doJson({ ok: true, on: !off, off: !!cfg.off, product: pid && cfg.offProducts && cfg.offProducts[pid] ? "off" : "on" });
  }
  if (p === "/_req/new" && post) {
    const b = await bodyOf(request);
    const ip = String(b.ip || "").slice(0, 64);
    if (ip) {
      const rl = (await cx.storage.get("rqrl:" + ip)) || { n: 0, at: 0 };
      if (cx.now() - rl.at > RL_MS) { rl.n = 0; rl.at = cx.now(); }
      if (rl.n >= RL_MAX) return doJson({ ok: false, error: "too many requests from this connection; try again in an hour" }, 429);
      rl.n++; if (!rl.at) rl.at = cx.now();
      await cx.storage.put("rqrl:" + ip, rl);
    }
    const rec = shapeRequest(b, cx.now());
    if (!rec) return doJson({ ok: false, error: "an email address and the item are needed" }, 400);
    const cfg = await loadCfg(cx);
    if (cfg.off) return doJson({ ok: false, error: "off", message: "Requests are closed at the moment." }, 409);
    if (rec.productId && cfg.offProducts && cfg.offProducts[rec.productId]) return doJson({ ok: false, error: "off", message: "We are not taking requests for this item." }, 409);
    rec.number = await nextNumber(cx);
    await cx.storage.put("rq:" + rec.id, rec);
    return doJson({ ok: true, id: rec.id, number: rec.number, record: rec });
  }
  if (p === "/_req/get") {
    const rec = await cx.storage.get("rq:" + String(url.searchParams.get("id") || "").slice(0, 40));
    if (!rec) return doJson({ ok: false, error: "no such request" }, 404);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_req/list") {
    const all = await listAll(cx);
    const f = { status: url.searchParams.get("status"), type: url.searchParams.get("type"), days: url.searchParams.get("days"), q: url.searchParams.get("q") };
    const out = filterRequests(all, f, cx.now()).slice(0, MAX_LIST);
    const counts = {}, types = {};
    for (const r of all) { counts[r.status] = (counts[r.status] || 0) + 1; if (r.type) types[r.type] = (types[r.type] || 0) + 1; }
    const cfg = await loadCfg(cx);
    return doJson({ ok: true, count: out.length, total: all.length, counts, types, records: out, cfg });
  }
  if (p === "/_req/mark" && post) {
    const b = await bodyOf(request);
    const key = "rq:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such request" }, 404);
    const status = String(b.status || "");
    if (!STATUSES.includes(status)) return doJson({ ok: false, error: "bad status" }, 400);
    rec.status = status;
    if (typeof b.note === "string") rec.staffNote = text(b.note, 1000);
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: status, by: by(b) }]).slice(-40);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_req/message" && post) {
    const b = await bodyOf(request);
    const key = "rq:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such request" }, 404);
    const t = text(b.text, 3000);
    if (!t) return doJson({ ok: false, error: "an empty message" }, 400);
    rec.messages = (rec.messages || []).concat([{ ts: cx.now(), from: b.from === "customer" ? "customer" : "staff", by: by(b), text: t, email: b.email && typeof b.email === "object" ? { status: String(b.email.status || ""), id: String(b.email.id || ""), error: String(b.email.error || "").slice(0, 200) } : null }]).slice(-60);
    rec.events = (rec.events || []).concat([{ ts: cx.now(), action: "replied", by: by(b) }]).slice(-40);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_req/mail" && post) {
    const b = await bodyOf(request);
    const key = "rq:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such request" }, 404);
    rec.mail = { ...(rec.mail || {}), ...(b.mail && typeof b.mail === "object" ? b.mail : {}) };
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_req/cfg") return doJson({ ok: true, cfg: await loadCfg(cx) });
  if (p === "/_req/cfg/set" && post) {
    const b = await bodyOf(request);
    const cfg = await loadCfg(cx);
    if (!cfg.offProducts) cfg.offProducts = {};
    if (typeof b.off === "boolean") { cfg.off = b.off; cfg.offBy = by(b); cfg.offAt = cx.now(); }
    const pid = digits(b.product);
    if (pid) {
      if (b.productOff) cfg.offProducts[pid] = { title: text(b.title, 200), by: by(b), at: cx.now() };
      else delete cfg.offProducts[pid];
    }
    await cx.storage.put("rqcfg", cfg);
    return doJson({ ok: true, cfg });
  }
  if (p === "/_req/stock/check" && post) {
    const r = await checkStock(cx, (await bodyOf(request)).notify !== false);
    return doJson({ ok: true, ...r });
  }
  if (p === "/_req/inv" && post) {
    // an inventory webhook: look soon rather than at the next half hour
    try { const at = await cx.storage.getAlarm(); if (at == null || at > cx.now() + 90e3) await cx.storage.setAlarm(cx.now() + 60e3); } catch {}
    return doJson({ ok: true });
  }
  if (p === "/_req/health") {
    const all = await listAll(cx);
    const counts = {};
    for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
    const cfg = await loadCfg(cx);
    let alarm = null; try { alarm = await cx.storage.getAlarm(); } catch {}
    return doJson({ ok: true, total: all.length, counts, off: !!cfg.off, productsOff: Object.keys(cfg.offProducts || {}).length, nextCheck: alarm, lastCheck: cx.mem.lastCheck || null });
  }
  return doJson({ ok: false, error: "no such path" }, 404);
}

// Ask Shopify about every variant an open restock request names, write the
// answers on the requests, and email the store about the ones back in stock.
export async function checkStock(cx, notify) {
  const all = await listAll(cx);
  const ids = variantsToCheck(all);
  const out = { variants: ids.length, back: 0, emailed: false };
  if (!ids.length) return out;
  const stock = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map((v) => "gid://shopify/ProductVariant/" + v);
    const data = await cx.adminGql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id availableForSale inventoryQuantity inventoryPolicy } } }`, { ids: batch });
    if (!data || !Array.isArray(data.nodes)) { out.error = "no answer from Shopify"; return out; }
    for (const n of data.nodes) if (n && n.id) stock[n.id.replace(/\D/g, "")] = { available: n.inventoryQuantity > 0 || (n.inventoryPolicy === "CONTINUE" && !!n.availableForSale), qty: n.inventoryQuantity };
  }
  const back = [];
  for (const r of all) {
    if (!(r.status === "open" && r.kind === "restock" && r.variantId && stock[r.variantId])) continue;
    const tell = applyStock(r, stock[r.variantId], cx.now());
    if (tell) back.push(r);
    await cx.storage.put("rq:" + r.id, r);
  }
  out.back = back.length;
  cx.mem.lastCheck = { at: cx.now(), variants: ids.length, back: back.length };
  if (back.length && notify) {
    const msg = buildBackInStockEmail(back, cx.env);
    const sent = await sendEmail(cx.env, toList(cx.env), msg, { replyTo: null });
    out.emailed = !!sent.ok;
    if (!sent.ok) out.error = sent.error;
    for (const r of back) { r.stock.notifiedAt = cx.now(); r.events = (r.events || []).concat([{ ts: cx.now(), action: "back in stock", by: "stock check", note: sent.ok ? "store emailed" : "email " + sent.status }]).slice(-40); await cx.storage.put("rq:" + r.id, r); }
  }
  return out;
}

export async function requestsDoAlarm(cx) {
  try { await checkStock(cx, true); } catch (e) { cx.log("requests: stock check: " + ((e && e.message) || e)); }
  try {
    const cutoff = cx.now() - KEEP_MS;
    const m = await cx.storage.list({ prefix: "rq:" });
    const gone = [];
    for (const [k, v] of m) if (v && v.status !== "open" && (v.ts || 0) < cutoff) gone.push(k);
    const rl = await cx.storage.list({ prefix: "rqrl:" });
    for (const [k, v] of rl) if (!v || cx.now() - (v.at || 0) > RL_MS) gone.push(k);
    if (gone.length) await cx.storage.delete(gone);
  } catch (e) { cx.log("requests: prune: " + ((e && e.message) || e)); }
  try { await cx.storage.setAlarm(cx.now() + CHECK_MS); } catch {}
}

/* ---- mail ---- */

export function toList(env) { return String((env && env.REQUESTS_EMAIL_TO) || DEFAULT_TO).split(/[,\s]+/).filter(Boolean); }
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const itemLine = (r) => r.title + (r.variantTitle && r.variantTitle !== "Default Title" ? " - " + r.variantTitle : "");
const staffLink = (r) => "https://exor-binder.nevski.workers.dev" + BASE + "/requests/r/" + encodeURIComponent(r.id);

// To the store: one new request.
export function buildStaffEmail(r) {
  const special = r.kind === "special";
  return buildNoticeEmail({
    subject: (special ? "Special order " : "Item request ") + r.number + ": " + itemLine(r) + " x" + r.qty + (r.name ? " (" + r.name + ")" : ""),
    heading: (special ? "Special order request " : "Restock request ") + r.number,
    sub: when(r.ts) + " Atlantic",
    lines: [
      "Item: " + itemLine(r),
      "Quantity: " + r.qty,
      r.type ? "Product type: " + r.type : "",
      r.vendor ? "Vendor: " + r.vendor : "",
      r.url ? "Page: " + r.url : "",
      "Customer: " + (r.name || "(no name)") + " <" + r.email + ">" + (r.customerId ? " - signed in, customer " + r.customerId : " - not signed in"),
      r.note ? "Note: " + r.note : "",
    ],
    click: staffLink(r), clickLabel: "Open in 9Pocket",
    foot: "Reply to this email to answer " + (r.name || "the customer") + " directly, or open the request in 9Pocket to keep the conversation on the record and mark it ordered, arrived or closed.",
  });
}

// To the store: requested items that are back in stock.
export function buildBackInStockEmail(list) {
  const byItem = {};
  for (const r of list) { const k = r.productId + "|" + r.variantId; (byItem[k] = byItem[k] || []).push(r); }
  const lines = [];
  for (const k of Object.keys(byItem)) {
    const rs = byItem[k];
    lines.push("↑ " + itemLine(rs[0]) + (rs[0].stock && rs[0].stock.qty != null ? " - " + rs[0].stock.qty + " in stock" : ""));
    for (const r of rs) lines.push("   " + r.number + ": " + (r.name || r.email) + " wants " + r.qty + " (" + when(r.ts) + ")");
  }
  const n = list.length;
  return buildNoticeEmail({
    subject: "Back in stock: " + itemLine(list[0]) + (Object.keys(byItem).length > 1 ? " and more" : "") + " - " + n + " request" + (n === 1 ? "" : "s") + " waiting",
    heading: "Requested items are back in stock",
    sub: "Customers asked for these while they were sold out. Let them know, or mark the requests in 9Pocket.",
    lines, click: "https://exor-binder.nevski.workers.dev" + BASE + "/requests", clickLabel: "Open the requests",
    foot: "Sent by the Exor Games worker when a requested item's stock rises above zero. Each request is told once per return to stock.",
  });
}

const RED = "#d52c28", INK = "#1d2327", MUTED = "#6b7780", RULE = "#e6ebee", PAPER = "#f4f6f7";
const LOGO = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/exor-games-logo-transparent.png?v=1790375946";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// To the customer: a plain Exor Games email with a few paragraphs and the
// request's details; used for the confirmation and for staff replies.
export function buildCustomerEmail(o) {
  const r = o.request;
  const paras = (o.paragraphs || []).filter(Boolean);
  const details = [["Request", r.number], ["Item", itemLine(r)], ["Quantity", String(r.qty)], r.note && o.showNote ? ["Your note", r.note] : null].filter(Boolean);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${INK};padding:16px 28px"><img src="${LOGO}" width="132" alt="Exor Games" style="display:block;border:0;height:auto"></td></tr>
<tr><td style="padding:22px 28px 6px"><h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:${INK}">${esc(o.heading)}</h1>${paras.map((p) => `<p style="margin:0 0 12px;line-height:1.5;white-space:pre-line">${esc(p)}</p>`).join("")}</td></tr>
<tr><td style="padding:6px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${RULE};border-radius:10px;overflow:hidden">${details.map(([k, v], i) => `<tr><td style="padding:7px 12px;border-bottom:1px solid ${RULE};background:${i % 2 ? PAPER : "#fff"};color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.05em;width:110px">${esc(k)}</td><td style="padding:7px 12px;border-bottom:1px solid ${RULE};background:${i % 2 ? PAPER : "#fff"};font-size:14px">${esc(v)}</td></tr>`).join("")}</table></td></tr>
${r.url ? `<tr><td style="padding:16px 28px 22px"><a href="${esc(r.url)}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">See the item</a></td></tr>` : `<tr><td style="padding:10px"></td></tr>`}
<tr><td style="background:${PAPER};padding:14px 28px;font-size:12px;color:${MUTED};line-height:1.6">Exor Games, 51 Allen Street, Charlottetown, PE. Reply to this email to reach the store.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [o.heading, "", ...paras, "", ...details.map(([k, v]) => k + ": " + v), ...(r.url ? ["", r.url] : [])].join("\n");
  return { subject: o.subject, html, text };
}

export function buildConfirmEmail(r) {
  const special = r.kind === "special";
  return buildCustomerEmail({
    request: r, showNote: true,
    subject: (special ? "We got your special order request " : "We got your request ") + r.number + " - " + itemLine(r),
    heading: (r.name ? "Thanks, " + r.name.split(/\s+/)[0] + "." : "Thanks.") + " We have your request.",
    paragraphs: [
      special ? "We will check whether we can order it and email you at " + r.email + " with what we find. Nothing is charged or reserved until we have talked."
        : "We will let you know at " + r.email + " when we can get it back in, or if it is not coming back. Nothing is charged or reserved yet.",
      "Questions? Just reply to this email.",
    ],
  });
}

export function buildReplyEmail(r, messageText, staffName) {
  return buildCustomerEmail({
    request: r,
    subject: "Re: your request " + r.number + " - " + itemLine(r),
    heading: "About your request " + r.number,
    paragraphs: [messageText, "- " + (staffName || "Exor Games")],
  });
}

async function sendAndRecord(env, origin, id, key, to, msg, opts) {
  const sent = await sendEmail(env, to, msg, opts);
  const stub = env.ROOM.get(env.ROOM.idFromName(REQUESTS_DO));
  try { await stub.fetch(new Request(origin + "/_req/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, mail: { [key]: { status: sent.status, at: Date.now(), id: sent.id || "", error: sent.error || "" } } }) })); } catch {}
  return sent;
}

/* ---- the public API (the store's pages call it from the browser) ---- */

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

export async function doCall(env, origin, path, body) {
  const stub = env.ROOM.get(env.ROOM.idFromName(REQUESTS_DO));
  const r = await stub.fetch(new Request(origin + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}));
  try { return await r.json(); } catch { return { ok: false, error: "bad answer" }; }
}

// /requests/api/status?product=<id>, /requests/api/new (POST JSON), /requests/health
export async function serveRequests(request, env, url, ctx) {
  const h = corsHeaders(request);
  const origin = url.origin, p = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (p === "/requests/health") {
    const j = await doCall(env, origin, "/_req/health");
    return Response.json({ ...j, email: emailConfigured(env) ? "configured" : "no key", to: toList(env).length + " address" + (toList(env).length === 1 ? "" : "es"), stockLookup: env.SHOPIFY_ADMIN_TOKEN ? "configured" : "no token" }, { headers: h });
  }
  if (p === "/requests/api/status") {
    const j = await doCall(env, origin, "/_req/status?product=" + encodeURIComponent(digits(url.searchParams.get("product"))));
    return Response.json({ ok: true, on: !!j.on }, { headers: h });
  }
  if (p === "/requests/api/new" && request.method === "POST") {
    const b = await bodyOf(request);
    // a filled honeypot field is a bot: say yes and keep nothing
    if (b.website) return Response.json({ ok: true, number: "RQ-0" }, { headers: h });
    const ip = request.headers.get("cf-connecting-ip") || "";
    const j = await doCall(env, origin, "/_req/new", { ...b, ip });
    if (!j.ok) return Response.json({ ok: false, error: j.message || j.error || "could not save the request" }, { status: j.error === "off" ? 409 : 400, headers: h });
    const rec = j.record;
    const mail = async () => {
      await sendAndRecord(env, origin, rec.id, "staff", toList(env), buildStaffEmail(rec), { replyTo: rec.email });
      await sendAndRecord(env, origin, rec.id, "confirm", rec.email, buildConfirmEmail(rec), { replyTo: toList(env)[0] });
    };
    if (ctx && ctx.waitUntil) ctx.waitUntil(mail()); else await mail();
    return Response.json({ ok: true, id: rec.id, number: rec.number }, { headers: h });
  }
  return Response.json({ ok: false, error: "no such path" }, { status: 404, headers: h });
}

/* ---- the staff pages, called from src/stage.js under /9pocket/requests ---- */

// helpers: { html, redirect, q, toLogin, opts } from serveStage; user may be null.
export async function serveRequestsStaff(request, env, url, user, form, helpers) {
  const { html, redirect, q, toLogin, opts } = helpers;
  const origin = url.origin, p = url.pathname;
  const noStore = { "cache-control": "no-store" };
  const R = BASE + "/requests";
  if (p === R + ".json") {
    if (!user) return Response.json({ error: "sign in required" }, { status: 403, headers: noStore });
    if (!can(user, "requests")) return Response.json({ error: "no requests permission" }, { status: 403, headers: noStore });
    return Response.json(await doCall(env, origin, "/_req/list?" + url.searchParams.toString()), { headers: noStore });
  }
  if (!user) return toLogin();
  if (!can(user, "requests")) return html(renderRequests(null, { ...opts, denied: true }), 403);
  if (p === R + "/control" && request.method === "POST") {
    const f = form || {};
    const action = String(f.action || "");
    const id = String(f.id || "").slice(0, 40);
    const by = user.email;
    let result;
    if (action === "mark") {
      const r = await doCall(env, origin, "/_req/mark", { id, status: f.status, note: f.note, by });
      result = r.ok ? { ok: true, message: "Marked " + r.record.status + "." } : r;
    } else if (action === "reply") {
      const textIn = String(f.text || "").trim();
      if (!textIn) result = { ok: false, error: "Write the message first." };
      else {
        const g = await doCall(env, origin, "/_req/get?id=" + encodeURIComponent(id));
        if (!g.ok) result = g;
        else {
          let sent = { status: "kept", ok: true };
          if (f.send !== "0") sent = await sendEmail(env, g.record.email, buildReplyEmail(g.record, textIn, user.name), { replyTo: toList(env)[0] });
          const m = await doCall(env, origin, "/_req/message", { id, text: textIn, from: "staff", by, email: { status: sent.status, id: sent.id, error: sent.error } });
          result = m.ok ? { ok: true, message: f.send === "0" ? "Noted (no email sent)." : sent.ok ? "Emailed " + g.record.email + "." : "Saved, but the email failed: " + (sent.error || sent.status) } : m;
        }
      }
    } else if (action === "product-off" || action === "product-on") {
      const r = await doCall(env, origin, "/_req/cfg/set", { product: f.product, productOff: action === "product-off", title: f.title, by });
      result = r.ok ? { ok: true, message: action === "product-off" ? "Requests are off for that product; its page shows no button now." : "Requests are back on for that product." } : r;
    } else if (action === "off" || action === "on") {
      if (user.role !== "admin") result = { ok: false, error: "Only an admin can switch requests on or off for the whole store." };
      else { const r = await doCall(env, origin, "/_req/cfg/set", { off: action === "off", by }); result = r.ok ? { ok: true, message: action === "off" ? "Requests are OFF for the whole store." : "Requests are ON." } : r; }
    } else if (action === "check") {
      const r = await doCall(env, origin, "/_req/stock/check", { notify: true });
      result = r.ok ? { ok: true, message: "Checked " + r.variants + " variant" + (r.variants === 1 ? "" : "s") + ": " + r.back + " back in stock" + (r.back ? (r.emailed ? ", the store was emailed." : ", but the email failed: " + (r.error || "")) : ".") + (r.error && !r.back ? " (" + r.error + ")" : "") } : r;
    } else result = { ok: false, error: "unknown action" };
    if (f.json) return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
    const back = id && action !== "product-off" && action !== "product-on" ? R + "/r/" + encodeURIComponent(id) : (id ? R + "/r/" + encodeURIComponent(id) : R);
    return redirect(back + q(result.ok ? { msg: result.message } : { err: result.error || "failed" }));
  }
  if (p.startsWith(R + "/r/")) {
    const id = decodeURIComponent(p.slice((R + "/r/").length)).slice(0, 40);
    const g = await doCall(env, origin, "/_req/get?id=" + encodeURIComponent(id));
    if (!g.ok) return html(renderRequests(null, { ...opts, err: "No such request." }), 404);
    const cfg = (await doCall(env, origin, "/_req/cfg")).cfg || {};
    return html(renderRequest(g.record, { ...opts, cfg, adminCustomer: ADMIN_CUSTOMER, emailTo: toList(env) }));
  }
  if (p === R) {
    const f = { status: url.searchParams.get("status") || "", type: url.searchParams.get("type") || "", days: url.searchParams.get("days") || "", q: url.searchParams.get("q") || "" };
    const s = new URLSearchParams(); for (const [a, b] of Object.entries(f)) if (b) s.set(a, b);
    const j = await doCall(env, origin, "/_req/list?" + s.toString());
    return html(renderRequests(j, { ...opts, filters: f, emailTo: toList(env) }));
  }
  return html(renderRequests(null, { ...opts, err: "No such page." }), 404);
}
