/* ---------------- Shipping a buylist in: the choice, the tracking number, the chase ----------------
   Owner, 2026-11-02: "before submitting a buylist, the person selling the cards must pick
   if they are bringing it in or shipping the order to us ... keep track of orders being
   shipped and allow for an opportunity to send an email and allow the customer to update
   it with a tracking number"; then: nothing changes on the way to BinderPOS (a submission
   still goes there at once, as it does today), 9Pocket keeps the shipping side of it;
   "approve on arrival" is a habit the Shipping tab supports, not a gate; one chase after
   three days with no tracking, never a second, and nothing waits on it - a customer who
   never adds tracking is fine, staff mark the list received when the parcel turns up.

   The side record lives in the 9Pocket room (src/stage.js, the /_stage/ship/* routes),
   keyed by the BinderPOS list number (the 9P number when staging is on):
     sh:<number> {number, ts, customer, customerName, customerEmail, paymentType, totals,
                  delivery: in-store|ship, token, state: awaiting|shipped|received,
                  carrier, tracking, trackedAt, trackedBy, receivedAt, receivedBy,
                  askedAt, chasedAt, lastAsk, events[]}
   pruned with decided buylists (RETENTION.buylistDays). The customer's link is
   /buylist/track?n=<number>&t=<token>: a one-field page, no login. */

import { sendEmail, buildTrackingEmail, buildNoticeEmail } from "./stage-email.js";

export const STAGE_DO_NAME = "buylist-stage";   // src/stage.js STAGE_DO (a string here, so this module imports nothing of it)
export const SITE = "https://exor-binder.nevski.workers.dev";
export const TRACK_PATH = "/buylist/track";
export const CHASE_AFTER_MS = 3 * 86400e3;
export const CHASE_WINDOW_MS = 30 * 86400e3;   // a list older than this is never chased (it predates the feature, or the parcel came and went)
export const DELIVERIES = ["in-store", "ship"];
export const STATES = ["awaiting", "shipped", "received"];
export const CARRIERS = [["canada-post", "Canada Post"], ["ups", "UPS"], ["fedex", "FedEx"], ["purolator", "Purolator"], ["dhl", "DHL"], ["other", "Other"]];
export const CARRIER_KEYS = CARRIERS.map((c) => c[0]);
export const DELIVERY_LABEL = { "in-store": "Bringing them in", ship: "Shipping them to us" };
export const STATE_LABEL = { awaiting: "awaiting tracking", shipped: "shipped", received: "received" };

export const deliveryOf = (v) => (DELIVERIES.includes(v) ? v : null);
export const carrierName = (k) => (CARRIERS.find((c) => c[0] === k) || [k, k])[1];
export const trackUrl = (origin, number, token) => (origin || SITE) + TRACK_PATH + "?n=" + encodeURIComponent(number) + "&t=" + encodeURIComponent(token);
export const randomToken = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));

// A tracking number as typed: spaces and dashes dropped, capitals, 6-40 letters and digits.
export function cleanTracking(s) {
  const t = String(s == null ? "" : s).replace(/[\s-]+/g, "").toUpperCase().slice(0, 40);
  return /^[A-Z0-9]{6,40}$/.test(t) ? t : "";
}
// Who the number looks like it belongs to (the customer may pick; this is the default).
export function carrierGuess(t) {
  const n = cleanTracking(t);
  if (!n) return "";
  if (/^1Z[A-Z0-9]{16}$/.test(n)) return "ups";
  if (/^\d{16}$/.test(n)) return "canada-post";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) return "canada-post";   // RA123456789CA, the international form
  if (/^\d{12}$|^\d{15}$|^\d{20}$|^\d{22}$/.test(n)) return "fedex";
  if (/^JD\d{18}$/.test(n) || /^\d{10}$/.test(n)) return "dhl";
  return "";
}
export function carrierLink(carrier, t) {
  const n = encodeURIComponent(cleanTracking(t));
  if (!n) return "";
  return carrier === "canada-post" ? "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=" + n
    : carrier === "ups" ? "https://www.ups.com/track?tracknum=" + n
    : carrier === "fedex" ? "https://www.fedex.com/fedextrack/?trknbr=" + n
    : carrier === "purolator" ? "https://www.purolator.com/en/shipping/tracker?pin=" + n
    : carrier === "dhl" ? "https://www.dhl.com/ca-en/home/tracking.html?tracking-id=" + n
    : "";
}

// What a staff screen sees of a side record: everything but the customer's token.
export function shipView(r) {
  if (!r) return null;
  const { token, ...rest } = r;
  return { ...rest, carrierName: r.carrier ? carrierName(r.carrier) : "", trackingUrl: r.tracking ? carrierLink(r.carrier, r.tracking) : "", stateLabel: STATE_LABEL[r.state] || r.state, deliveryLabel: DELIVERY_LABEL[r.delivery] || r.delivery };
}

const stub = (env) => env.ROOM.get(env.ROOM.idFromName(STAGE_DO_NAME));
async function call(env, path, body) {
  const r = await stub(env).fetch(new Request(SITE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined));
  let j; try { j = await r.json(); } catch { j = { ok: false, error: "bad reply" }; }
  return j;
}
export const shipPut = (env, rec) => call(env, "/_stage/ship/put", rec);
export const shipGet = (env, number) => call(env, "/_stage/ship/get?number=" + encodeURIComponent(number));
export const shipAll = (env) => call(env, "/_stage/ship/all");
export const shipTrack = (env, number, token, tracking, carrier) => call(env, "/_stage/ship/track", { number, token, tracking, carrier });
export const shipSet = (env, number, patch) => call(env, "/_stage/ship/set", { number, ...patch });
export const shipDue = (env, now) => call(env, "/_stage/ship/due", { now });
const mask = (e) => String(e || "").replace(/^(.).*(@.*)$/, "$1***$2");

// The staff "Ask for tracking" button: the email with the link, recorded on the record.
export async function shipAsk(env, number, by) {
  const g = await shipGet(env, number);
  if (!g.ok) return g;
  const r = g.record;
  if (!r.customerEmail) return { ok: false, error: "Shopify has no email address for this customer", record: r };
  let out;
  try { out = await sendEmail(env, r.customerEmail, buildTrackingEmail(r, "ask", trackUrl(SITE, r.number, r.token))); }
  catch (e) { out = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
  const a = await call(env, "/_stage/ship/asked", { number, kind: "ask", by, email: { status: out.status, error: out.error || "", to: mask(r.customerEmail) } });
  return { ok: !!out.ok, status: out.status, error: out.error || "", record: a.record || r };
}

// The chase, from the worker cron: once per list, three days after a shipped list with
// no tracking; the record remembers it (chasedAt), so a second never goes.
export async function shipChase(env, now) {
  if (!env || !env.ROOM) return { skipped: "no storage" };
  const due = await shipDue(env, now || Date.now());
  const records = (due && due.records) || [];
  let sent = 0, failed = 0;
  for (const r of records) {
    let out;
    try { out = await sendEmail(env, r.customerEmail, buildTrackingEmail(r, "chase", trackUrl(SITE, r.number, r.token))); }
    catch (e) { out = { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
    await call(env, "/_stage/ship/asked", { number: r.number, kind: "chase", by: "worker", email: { status: out.status, error: out.error || "", to: mask(r.customerEmail) } });
    if (out.ok) sent++; else failed++;
  }
  return { due: records.length, sent, failed };
}

/* ---- the customer's page: /buylist/track?n=<number>&t=<token> ---- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const CSS = `body{margin:0;background:#f4f6f7;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2327}.wrap{max-width:560px;margin:0 auto;padding:28px 16px 40px}.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(16,24,40,.06)}.head{background:#d52c28;color:#fff;padding:20px 24px}.head small{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.9}.head h1{margin:4px 0 0;font-size:22px;line-height:1.25}.body{padding:22px 24px}label{display:block;font-weight:600;margin:14px 0 6px}input,select{width:100%;box-sizing:border-box;font:inherit;padding:11px 12px;border:1px solid #cfd7dc;border-radius:10px;background:#fff}input:focus,select:focus{outline:2px solid #d52c28;outline-offset:1px}.btn{display:inline-block;margin-top:18px;background:#d52c28;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer}.muted{color:#6b7780;font-size:13px}.ok{background:#e8f5ec;border:1px solid #bfe3c8;border-radius:10px;padding:12px 14px;margin:0 0 14px}.err{background:#fdecec;border:1px solid #f3bdbd;border-radius:10px;padding:12px 14px;margin:0 0 14px}.now{background:#f4f6f7;border-radius:10px;padding:12px 14px;margin:0 0 6px}.foot{padding:14px 24px;background:#f4f6f7;font-size:12px;color:#6b7780}a{color:#d52c28}@media (prefers-color-scheme:dark){body{background:#111517;color:#eef2f4}.card{background:#181d20;box-shadow:none;border:1px solid #2a3236}input,select{background:#1d2327;color:#eef2f4;border-color:#39434a;color-scheme:dark}.muted{color:#8a969d}.now{background:#111517}.ok{background:#17301f;border-color:#2c5a3a;color:#d4f0dc}.err{background:#3a1c1c;border-color:#6a2d2d;color:#f5caca}.foot{background:#111517;color:#8a969d}a{color:#ff6a5e}}`;
export function renderTrack(o) {
  const r = o.record;
  const title = o.notFound ? "That link is not valid" : "Add your tracking number";
  const inner = o.notFound
    ? `<p>This tracking link does not match a buylist. Open the link from your buylist email again, or reply to that email and we will sort it out.</p>`
    : `${o.saved ? `<div class="ok"><b>Thank you.</b> We will watch for ${esc(carrierName(r.carrier))} ${esc(r.tracking)} and check your cards against your list as soon as it arrives.</div>` : ""}${o.error ? `<div class="err">${esc(o.error)}</div>` : ""}` +
      `${r.tracking && !o.saved ? `<div class="now">On file: <b>${esc(carrierName(r.carrier))} ${esc(r.tracking)}</b>${r.trackedAt ? `<span class="muted"> · added ${esc(new Date(r.trackedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" }))}</span>` : ""}. You can change it below.</div>` : ""}` +
      `<p>Buylist <b>${esc(r.number)}</b>${r.totals && r.totals.units ? ` · ${esc(r.totals.units)} card${r.totals.units === 1 ? "" : "s"}` : ""}${r.paymentType ? ` · ${esc(r.paymentType)}` : ""}</p>` +
      `<form method="post" action="${TRACK_PATH}"><input type="hidden" name="n" value="${esc(r.number)}"><input type="hidden" name="t" value="${esc(o.token)}">` +
      `<label for="tracking">Tracking number</label><input id="tracking" name="tracking" value="${esc(o.typed || r.tracking || "")}" inputmode="text" autocomplete="off" placeholder="e.g. 1234 5678 9012 3456" required>` +
      `<label for="carrier">Carrier</label><select id="carrier" name="carrier"><option value="">Let us work it out</option>${CARRIERS.map((c) => `<option value="${c[0]}"${(o.carrier || r.carrier) === c[0] ? " selected" : ""}>${esc(c[1])}</option>`).join("")}</select>` +
      `<button class="btn" type="submit">${r.tracking ? "Update the tracking number" : "Save the tracking number"}</button></form>` +
      `<p class="muted" style="margin-top:18px">Bringing the cards in instead? Then there is nothing to add here. Questions: <a href="mailto:customerservice@exorgames.com">customerservice@exorgames.com</a>.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Exor Games</title><style>${CSS}</style></head><body><div class="wrap"><div class="card"><div class="head"><small>9Pocket by Exor</small><h1>${esc(title)}</h1></div><div class="body">${inner}</div><div class="foot">Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6</div></div></div></body></html>`;
}
// GET shows the form, POST saves (number + token from the link; the token is the only key).
// o.notifyTo = the staff buylist email list, told when a number lands. Never needs a login.
export async function serveTrack(request, env, url, o) {
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const form = (o && o.form) || {};
  const number = String(form.n || url.searchParams.get("n") || "").trim().slice(0, 40), token = String(form.t || url.searchParams.get("t") || "").trim().slice(0, 80);
  if (!number || !token) return html(renderTrack({ notFound: true }), 404);
  const g = await shipGet(env, number);
  if (!g.ok || !g.record || g.record.token !== token) return html(renderTrack({ notFound: true }), 404);
  if (request.method !== "POST") return html(renderTrack({ record: g.record, token }));
  const typed = String(form.tracking || "");
  const t = await shipTrack(env, number, token, typed, String(form.carrier || ""));
  if (!t.ok) return html(renderTrack({ record: g.record, token, typed, carrier: String(form.carrier || ""), error: t.error || "That did not save; please try again." }), 400);
  const r = t.record;
  // staff hear of it the way they hear of a new list: one email per address, best effort
  if (o && Array.isArray(o.notifyTo) && o.notifyTo.length) {
    const msg = buildNoticeEmail({ subject: "Buylist " + r.number + ": tracking number added", heading: "Tracking added for buylist " + r.number, sub: (r.customerName || "The customer") + " entered it on the tracking page.",
      lines: [carrierName(r.carrier) + " " + r.tracking, "List: " + (r.totals && r.totals.units != null ? r.totals.units + " cards · " : "") + (r.paymentType || ""), "Submitted " + new Date(r.ts).toLocaleString("en-CA", { timeZone: "America/Halifax", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })],
      click: SITE + "/portal/buylists#/b/" + encodeURIComponent(r.number), clickLabel: "Open on 9Pocket", foot: "Sent by 9Pocket. Mark the list received on the Shipping tab when the parcel turns up." });
    for (const to of o.notifyTo) { try { await sendEmail(env, to, msg, { replyTo: r.customerEmail || undefined }); } catch {} }
  }
  return html(renderTrack({ record: r, token, saved: true }));
}
