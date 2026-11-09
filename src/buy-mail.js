/* ---------------- In-store buy emails (owner, 2026-11-09) ----------------
   "Is it possible to send us the same email when a buylist comes in but
   send it for in store buys that are done?" ... "Can't you just watch
   submitted carts" -> while the switch is on, the stage room's alarm looks
   at BinderPOS every POLL_MS for POS carts submitted since the last look
   that bought something (src/portal.js buyCartsBetween: the lines, what we
   paid per card, the cash / credit paid out, the customer, staff and till)
   and sends one staff email per cart (src/stage-email.js buildCartEmail) to
   the Buylist emails list (9Pocket > Admin), each address on its own.
   Forward-only: carts submitted before the switch was turned on are
   remembered as seen and never sent. Each cart id is sent once; a cart
   whose every send failed is left unseen and tried again at the next look
   (the window is not advanced past it) for as long as it stays within
   LOOKBACK_MS. Online buylists are not repeated here: they already get the
   staff copy when they are submitted.
   Storage (the stage room): "buymail" {on, since, by, at, cartsFrom, seen[],
   lastPoll, lastError, sent, lastSent, lastCart}. */
import { buildCartEmail, sendEmail } from "./stage-email.js";

export const POLL_MS = 120e3;
export const LOOKBACK_MS = 6 * 3600e3;
const OVERLAP_MS = 30 * 60e3;        // re-read this much behind the last look: BinderPOS lists by id, late carts land late
const SEEN_MAX = 400;
export const BUYLIST_NOTIFY_DEFAULT = ["customerservice@exorgames.com"];
const KEY = "buymail";
const str = (v) => (v == null ? "" : String(v));
const errText = (e) => str((e && e.message) || e).slice(0, 200);
const json = (b, status) => Response.json(b, { status: status || 200, headers: { "cache-control": "no-store" } });
async function bodyOf(r) { try { return (await r.json()) || {}; } catch { return {}; } }

export function defaultSettings() { return { on: false, since: 0, by: "", at: null, cartsFrom: 0, seen: [], lastPoll: null, lastError: "", sent: 0, lastSent: null, lastCart: null }; }
export async function settingsOf(cx) { return { ...defaultSettings(), ...((await cx.storage.get(KEY)) || {}) }; }
async function save(cx, s) { s.seen = (s.seen || []).slice(-SEEN_MAX); await cx.storage.put(KEY, s); }

// Who gets it: the Buylist emails list (null = never saved: the default address; [] = off).
export async function recipientsOf(cx) {
  const c = (await cx.storage.get("cfg")) || {};
  return Array.isArray(c.buylistTo) ? c.buylistTo : BUYLIST_NOTIFY_DEFAULT.slice();
}

export const cartBuys = (c) => ((c && c.lines) || []).filter((l) => l && l.buying && l.qty > 0);
const submittedMs = (c) => Date.parse((c && c.submitted) || "") || 0;

export function statusView(s) {
  return { on: s.on === true, since: s.since || 0, by: s.by || "", at: s.at || null, lastPoll: s.lastPoll || null, lastError: s.lastError || "", sent: s.sent || 0, lastSent: s.lastSent || null, lastCart: s.lastCart || null, seen: (s.seen || []).length };
}

// The switch. On: the first look is in a few seconds; nothing before this moment is sent.
export async function setBuyMail(cx, on, by) {
  const s = await settingsOf(cx);
  const now = cx.now();
  if (on && !s.on) Object.assign(s, { on: true, since: now, by: str(by).slice(0, 160), at: now, cartsFrom: now, lastError: "" });
  else if (!on && s.on) Object.assign(s, { on: false, by: str(by).slice(0, 160), at: now });
  await save(cx, s);
  if (on) { try { await cx.storage.setAlarm(now + 5e3); } catch {} }
  return s;
}

// The look at BinderPOS: new buy carts since the last one -> one email each.
export async function pollBuyMail(cx) {
  const s = await settingsOf(cx);
  const now = cx.now();
  const out = { ok: true, on: s.on, carts: 0, sent: 0, skipped: 0, errors: [] };
  if (!s.on) return out;
  if (!cx.portal || typeof cx.portal.buyCartsBetween !== "function") { out.errors.push("no BinderPOS reader on this room"); return out; }
  const mem = cx.mem || (cx.mem = {});
  if (mem.buyMailBusy) return { ...out, busy: true };   // a look is already under way (the alarm and a "Look now" at once)
  mem.buyMailBusy = true;
  try {
    const to = await recipientsOf(cx);
    const send = cx.sendEmail || ((addr, msg, replyTo) => sendEmail(cx.env, addr, msg, { replyTo }));
    let stuck = false;
    try {
      const from = Math.max(s.cartsFrom || 0, now - LOOKBACK_MS) - OVERLAP_MS;
      const carts = (await cx.portal.buyCartsBetween(from, now)) || [];
      for (const c of carts.slice().sort((a, b) => submittedMs(a) - submittedMs(b))) {
        if (!c || !c.id || s.seen.includes(c.id)) continue;
        if (submittedMs(c) < s.since || !cartBuys(c).length) { s.seen.push(c.id); out.skipped++; continue; }   // before the switch, or nothing bought
        out.carts++;
        if (!to.length) { s.seen.push(c.id); continue; }   // the list is off: nobody to tell, the cart is done with
        const msg = buildCartEmail(c);
        const replyTo = c.customer && c.customer.email ? c.customer.email : null;
        const results = await Promise.all(to.map((a) => Promise.resolve().then(() => send(a, msg, replyTo)).catch((e) => ({ ok: false, error: errText(e) }))));
        const okN = results.filter((r) => r && r.ok).length;
        const failed = results.filter((r) => !r || !r.ok).map((r) => str((r && (r.error || r.status)) || "failed").slice(0, 120));
        if (okN) { s.seen.push(c.id); s.sent = (s.sent || 0) + okN; s.lastSent = now; s.lastCart = c.id; out.sent += okN; }
        else stuck = true;
        if (failed.length) out.errors.push("cart " + c.id + ": " + failed.slice(0, 2).join("; ") + (okN ? "" : " - will try again"));
        cx.log("buymail: cart " + c.id + " " + okN + "/" + to.length + " sent");   // counts only
      }
      if (!stuck) s.cartsFrom = now;   // a cart nobody got stays inside the next window
    } catch (e) { out.errors.push("carts: " + errText(e)); }
    s.lastPoll = now; s.lastError = out.errors.join(" · ");
    await save(cx, s);
  } finally { mem.buyMailBusy = false; }
  return out;
}

// The room's routes: /_stage/buymail (where it stands), /set {on, by}, /poll (a look now).
export async function buyMailDo(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/_stage/buymail") return json({ ok: true, ...statusView(await settingsOf(cx)) });
  if (p === "/_stage/buymail/set" && post) { const b = await bodyOf(request); return json({ ok: true, ...statusView(await setBuyMail(cx, b.on === true, b.by)) }); }
  if (p === "/_stage/buymail/poll" && post) { const r = await pollBuyMail(cx); return json({ ...r, status: statusView(await settingsOf(cx)) }); }
  return json({ ok: false, error: "not found" }, 404);
}
