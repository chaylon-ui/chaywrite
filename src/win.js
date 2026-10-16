/* ---------------- Enter to win: the Expo contest ----------------
   Owner, 2026-10-15: "an 'enter to win' section where people sign up for
   the contest scanning a QR code at the Atlantic Entertainment Expo in
   Moncton, NB ... opt in to our Omnisend email marketing with their name,
   email ... they should need to verify the email before it is added to our
   email list. Winner receives $100 store credit at ExorGames.com" - and the
   page tells them about Mallow Games (used video games, the buylist at
   mallowgames.com).

   Public, no sign-in: /win (landing page + entry form), /win/verify (the
   emailed confirmation link), /win/rules, /win/health. Admins only (9Pocket
   sign-in): /9pocket/win - open / close, settings, entries, Shopify status,
   the draw, CSV export.

   Flow: form -> pending record (48 h, random token) -> confirmation email
   (Resend) -> the link verifies the address -> the entry counts and, when
   the box was ticked, the person becomes a Shopify customer marked
   subscribed (confirmed opt-in) and tagged - Omnisend takes its list from
   Shopify's customers. Double opt-in: nothing is subscribed before the click. CLOSED by default: an
   admin opens it; while closed the public sees a holding page and an admin
   a preview (?preview=<key>; entries made that way are marked test and
   never drawn).

   Kept small on purpose: names and addresses live only in the win-contest
   DO and reach the admin screen, Shopify and the emails - never a log.
   Sign-ups are rate-limited per connection (a salted hash of the address,
   kept two hours) and a honeypot field drops bots. */

import { sendEmail, emailConfigured } from "./stage-email.js";
import { validEmail, normEmail } from "./stage-auth.js";
import { INTERESTS, REPLY_TO, renderLanding, renderHolding, renderCheckInbox, renderVerified, renderExpired, renderRules, renderNotFound, renderWinAdmin, renderWinDenied, buildVerifyEmail, buildAlreadyEmail, buildWinnerEmail } from "./win-ui.js";

export const WIN_DO = "win-contest";
export const WIN_BASE = "/win";
export const WIN_ADMIN = "/9pocket/win";
export const PENDING_MS = 48 * 3600e3;    // a confirmation link works this long
export const RATE_PER_HOUR = 8;           // sign-ups per connection per hour
export const PENDING_PER_EMAIL = 3;       // unconfirmed entries per address (re-sends)
export { INTERESTS, REPLY_TO };

export const DEFAULT_CFG = {
  open: false,
  event: "Atlantic Entertainment Expo",
  place: "Moncton, NB",
  dates: "October 17–18, 2026",
  prize: "$100 in store credit at ExorGames.com",
  closesAt: Date.UTC(2026, 9, 19, 2, 59, 0),   // Sunday October 18, 11:59 pm Atlantic (ADT)
  drawText: "Monday, October 19, 2026",
  consentRequired: true,
  tags: "AEE 2026, Moncton, Contest",
  salt: "",
  previewKey: "",
};
const CFG_KEYS = ["open", "event", "place", "dates", "prize", "closesAt", "drawText", "consentRequired", "tags"];

const noStore = { "cache-control": "no-store" };
const json = (o, status) => Response.json(o, { status: status || 200, headers: noStore });

export function rnd(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const randInt = (lo, hi) => lo + (crypto.getRandomValues(new Uint32Array(1))[0] % (hi - lo + 1));
export async function hashIp(ip, salt) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(salt) + ":" + String(ip)));
  return [...new Uint8Array(d)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const isOpen = (cfg, now) => !!(cfg && cfg.open && (!cfg.closesAt || now <= cfg.closesAt));
export const cleanName = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
export function cleanInterests(v) {
  const list = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
  return [...new Set(list.map((x) => String(x)).filter((x) => INTERESTS.includes(x)))];
}
export const tagsOf = (cfg) => String((cfg && cfg.tags) || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);

/* The winner must answer a mathematical skill-testing question before the
   prize goes out (Canadian contest practice); the draw makes one. */
export function skillQuestion() {
  const a = randInt(2, 12), b = randInt(2, 12), c = randInt(10, 50), d = randInt(1, 9);
  return { q: `(${a} × ${b}) + ${c} − ${d}`, a: a * b + c - d };
}

/* A datetime-local value typed in Atlantic time -> UTC ms (Intl gives the
   zone's offset at that instant: ADT until November 1, AST after). */
export function atlanticToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = (t) => Number((parts.find((p) => p.type === t) || {}).value);
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return guess + (guess - local);
}
export function utcToAtlanticInput(ms) {
  if (!ms) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${g("year")}-${g("month")}-${g("day")}T${String(g("hour")).padStart(2, "0")}:${g("minute")}`;
}

/* ---------- the win-contest Durable Object (paths /_win/*) ---------- */
async function cfgOf(cx) {
  const stored = (await cx.storage.get("win:cfg")) || {};
  const cfg = { ...DEFAULT_CFG, ...stored };
  let changed = false;
  if (!cfg.salt) { cfg.salt = rnd(16); changed = true; }
  if (!cfg.previewKey) { cfg.previewKey = rnd(12); changed = true; }
  if (changed) await cx.storage.put("win:cfg", cfg);
  return cfg;
}
const publicCfg = (cfg) => { const { salt, ...rest } = cfg; return rest; };
async function pendings(cx, now) {
  const all = await cx.storage.list({ prefix: "win:p:" });
  const live = [], dead = [];
  for (const [k, v] of all) (v && v.exp >= now ? live : dead).push([k, v]);
  if (dead.length) await cx.storage.delete(dead.map(([k]) => k));
  return live;
}
async function entries(cx) {
  const all = await cx.storage.list({ prefix: "win:e:" });
  return [...all.values()].sort((a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0));
}

export async function winDoFetch(cx, request, url) {
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const now = cx.now();

  if (p === "/_win/cfg") {
    const cfg = await cfgOf(cx);
    if (request.method !== "POST") return json(publicCfg(cfg));
    for (const k of CFG_KEYS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (k === "open" || k === "consentRequired") cfg[k] = !!v;
      else if (k === "closesAt") cfg[k] = Number(v) > 0 ? Number(v) : null;
      else cfg[k] = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
    }
    await cx.storage.put("win:cfg", cfg);
    return json({ ok: true, message: "open" in body && Object.keys(body).length === 1 ? (cfg.open ? "The contest is OPEN." : "The contest is closed.") : "Settings saved.", cfg: publicCfg(cfg) });
  }

  if (p === "/_win/enter" && request.method === "POST") {
    const cfg = await cfgOf(cx);
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({ ok: false, error: "email" });
    if (!isOpen(cfg, now) && !body.preview) return json({ ok: false, error: "closed" });
    if (body.ipHash) {
      const hour = Math.floor(now / 3600e3);
      const rk = `win:r:${hour}:${body.ipHash}`;
      const n = Number((await cx.storage.get(rk)) || 0);
      if (n >= RATE_PER_HOUR) return json({ ok: false, error: "rate" });
      await cx.storage.put(rk, n + 1);
      const old = [...(await cx.storage.list({ prefix: "win:r:" })).keys()].filter((k) => Number(k.split(":")[2]) < hour - 1);
      if (old.length) await cx.storage.delete(old);
    }
    const existing = await cx.storage.get("win:e:" + email);
    if (existing) return json({ ok: true, status: "already", first: existing.first });
    const mine = (await pendings(cx, now)).filter(([, v]) => v.email === email).length;
    if (mine >= PENDING_PER_EMAIL) return json({ ok: false, error: "pending" });
    const token = rnd(24);
    const rec = { email, first: cleanName(body.first), last: cleanName(body.last), consent: !!body.consent, interests: cleanInterests(body.interests), at: now, exp: now + PENDING_MS, preview: !!body.preview && !isOpen(cfg, now) };
    await cx.storage.put("win:p:" + token, rec);
    return json({ ok: true, status: "pending", token, first: rec.first });
  }

  if (p === "/_win/verify" && request.method === "POST") {
    const token = String(body.token || "");
    const key = "win:p:" + token;
    const pend = token.length >= 16 ? await cx.storage.get(key) : null;
    if (!pend) return json({ ok: false, error: "invalid" });
    if (pend.exp < now) { await cx.storage.delete(key); return json({ ok: false, error: "expired" }); }
    const existing = await cx.storage.get("win:e:" + pend.email);
    const others = (await pendings(cx, now)).filter(([, v]) => v.email === pend.email).map(([k]) => k);
    if (others.length) await cx.storage.delete(others);
    if (existing) return json({ ok: true, status: "already", entry: existing });
    const entry = { email: pend.email, first: pend.first, last: pend.last, consent: pend.consent, interests: pend.interests || [], enteredAt: pend.at, verifiedAt: now, test: !!pend.preview, shopify: { status: pend.consent ? "pending" : "no-consent" } };
    await cx.storage.put("win:e:" + entry.email, entry);
    return json({ ok: true, status: "verified", entry });
  }

  if (p === "/_win/synced" && request.method === "POST") {
    const email = normEmail(body.email);
    const e = await cx.storage.get("win:e:" + email);
    if (!e) return json({ ok: false, error: "no such entry" });
    const r = body.result || {};
    e.shopify = { status: r.ok ? r.status || "subscribed" : r.status || "failed", id: r.id || "", error: r.ok ? "" : String(r.error || "").slice(0, 160), at: now };
    await cx.storage.put("win:e:" + email, e);
    return json({ ok: true, entry: e, message: r.ok ? "Subscribed as a Shopify customer." : "Shopify: " + e.shopify.error });
  }

  if (p === "/_win/entry" && request.method === "POST") {
    const e = await cx.storage.get("win:e:" + normEmail(body.email));
    if (!e) return json({ ok: false, error: "no such entry" });
    return json({ ok: true, entry: e, cfg: publicCfg(await cfgOf(cx)) });
  }

  if (p === "/_win/delete" && request.method === "POST") {
    const email = normEmail(body.email);
    const e = await cx.storage.get("win:e:" + email);
    if (!e) return json({ ok: false, error: "no such entry" });
    await cx.storage.delete("win:e:" + email);
    const draws = ((await cx.storage.get("win:draws")) || []).filter((d) => d.email !== email);
    await cx.storage.put("win:draws", draws);
    return json({ ok: true, message: "Entry removed." });
  }

  if (p === "/_win/draw" && request.method === "POST") {
    const draws = (await cx.storage.get("win:draws")) || [];
    const drawn = new Set(draws.map((d) => d.email));
    const pool = (await entries(cx)).filter((e) => !e.test && !drawn.has(e.email));
    if (!pool.length) return json({ ok: false, error: draws.length ? "Every confirmed entry has been drawn already." : "No confirmed entries to draw from yet." });
    const w = pool[randInt(0, pool.length - 1)];
    const sq = skillQuestion();
    const d = { email: w.email, first: w.first, last: w.last, at: now, by: String(body.by || ""), q: sq.q, a: sq.a, emailed: null };
    draws.push(d);
    await cx.storage.put("win:draws", draws);
    return json({ ok: true, draw: d, message: `Drawn: ${w.first} ${w.last} (${w.email}). ${pool.length} entries were in the hat.` });
  }

  if (p === "/_win/winner-emailed" && request.method === "POST") {
    const draws = (await cx.storage.get("win:draws")) || [];
    const d = draws.find((x) => x.email === normEmail(body.email));
    if (!d) return json({ ok: false, error: "no such draw" });
    d.emailed = { at: now, ok: !!(body.result && body.result.ok), error: body.result && !body.result.ok ? String(body.result.error || "").slice(0, 160) : "" };
    await cx.storage.put("win:draws", draws);
    return json({ ok: true, message: d.emailed.ok ? "The winner has been emailed." : "Email failed: " + d.emailed.error });
  }

  if (p === "/_win/list") {
    const cfg = await cfgOf(cx);
    const list = await entries(cx);
    const pend = await pendings(cx, now);
    return json({ ok: true, cfg: publicCfg(cfg), entries: list, pending: pend.length, draws: (await cx.storage.get("win:draws")) || [], now });
  }

  if (p === "/_win/health") {
    const cfg = await cfgOf(cx);
    const list = await entries(cx);
    const real = list.filter((e) => !e.test);
    return json({ ok: true, open: isOpen(cfg, now), closesAt: cfg.closesAt, confirmed: real.length, onList: real.filter((e) => e.shopify && /^(subscribed|updated)$/.test(e.shopify.status)).length, pending: (await pendings(cx, now)).length, drawn: ((await cx.storage.get("win:draws")) || []).length });
  }

  return json({ ok: false, error: "no such path" }, 404);
}

/* ---------- Shopify customers (Omnisend takes its list from them) ----------
   Owner, 2026-10-16: "I don't need omnisend as I think it gets its email
   from the shopify orders and customers" - so a confirmed, consenting
   entrant becomes a Shopify customer (or updates the one with that address)
   marked SUBSCRIBED with CONFIRMED_OPT_IN - the click is the confirmation -
   and tagged for the event; Omnisend's Shopify sync carries that into the
   list. Same token and endpoint as the rest of the worker. */
export const API_VERSION = "2025-01";
export const DEFAULT_SHOP = "most-wanted-ca.myshopify.com";
export function shopifyConfigured(env) { return !!(env && env.SHOPIFY_ADMIN_TOKEN); }
export const shopifyUrl = (env) => `https://${(env && env.SHOPIFY_SHOP) || DEFAULT_SHOP}/admin/api/${API_VERSION}/graphql.json`;
async function gql(env, fetchFn, query, variables) {
  const f = fetchFn || fetch;
  const r = await f(shopifyUrl(env), { method: "POST", headers: { "content-type": "application/json", "X-Shopify-Access-Token": String(env.SHOPIFY_ADMIN_TOKEN || "").trim() }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Shopify HTTP " + r.status);
  if (!j || !j.data) throw new Error("Shopify: " + String((j && j.errors && j.errors[0] && j.errors[0].message) || "no data").slice(0, 140));
  return j.data;
}
const FIND = `query($q:String!){customers(first:5,query:$q){nodes{id email firstName lastName}}}`;
const CREATE = `mutation($in:CustomerInput!){customerCreate(input:$in){customer{id}userErrors{field message}}}`;
const UPDATE = `mutation($in:CustomerInput!){customerUpdate(input:$in){customer{id}userErrors{field message}}}`;
const TAG = `mutation($id:ID!,$t:[String!]!){tagsAdd(id:$id,tags:$t){userErrors{message}}}`;
const CONSENT = `mutation($in:CustomerEmailMarketingConsentUpdateInput!){customerEmailMarketingConsentUpdate(input:$in){customer{id}userErrors{field message}}}`;
const SCOPES = `{currentAppInstallation{accessScopes{handle}}}`;
const uerr = (node) => { const u = node && node.userErrors; return u && u.length ? u.map((e) => e.message).join("; ").slice(0, 160) : ""; };
const digitsOf = (gid) => String(gid || "").replace(/\D/g, "");
const fail = (error) => ({ ok: false, status: "failed", error: String(error).slice(0, 160), at: Date.now() });

export async function shopifySubscribe(env, entry, cfg, fetchFn) {
  if (!shopifyConfigured(env)) return { ok: false, status: "unconfigured", error: "SHOPIFY_ADMIN_TOKEN is not set on the worker", at: Date.now() };
  const consent = { marketingState: "SUBSCRIBED", marketingOptInLevel: "CONFIRMED_OPT_IN", consentUpdatedAt: new Date(entry.verifiedAt || Date.now()).toISOString() };
  const tags = tagsOf(cfg);
  try {
    const found = await gql(env, fetchFn, FIND, { q: "email:" + entry.email });
    const c = (((found.customers || {}).nodes) || []).find((n) => normEmail(n.email) === entry.email);
    if (!c) {
      const input = { email: entry.email, tags, emailMarketingConsent: consent, note: `Entered the ${cfg && cfg.event ? cfg.event : "Expo"} draw` };
      if (entry.first) input.firstName = entry.first;
      if (entry.last) input.lastName = entry.last;
      const d = await gql(env, fetchFn, CREATE, { in: input });
      const e = uerr(d.customerCreate); if (e) return fail(e);
      return { ok: true, status: "subscribed", id: digitsOf(d.customerCreate.customer && d.customerCreate.customer.id), at: Date.now() };
    }
    // already a customer: add the tags, fill a blank name, record the consent they just confirmed
    const t = await gql(env, fetchFn, TAG, { id: c.id, t: tags });
    const e1 = uerr(t.tagsAdd); if (e1) return fail(e1);
    if ((!c.firstName && entry.first) || (!c.lastName && entry.last)) {
      const input = { id: c.id };
      if (!c.firstName && entry.first) input.firstName = entry.first;
      if (!c.lastName && entry.last) input.lastName = entry.last;
      const u = await gql(env, fetchFn, UPDATE, { in: input });
      const e2 = uerr(u.customerUpdate); if (e2) return fail(e2);
    }
    const sc = await gql(env, fetchFn, CONSENT, { in: { customerId: c.id, emailMarketingConsent: consent } });
    const e3 = uerr(sc.customerEmailMarketingConsentUpdate); if (e3) return fail(e3);
    return { ok: true, status: "updated", id: digitsOf(c.id), at: Date.now() };
  } catch (e) { return fail((e && e.message) || e); }
}
/* Can the token write customers? (the admin screen, and health?probe=1) */
export async function shopifyScopes(env, fetchFn) {
  if (!shopifyConfigured(env)) return { ok: false, customersWrite: false, error: "no token" };
  try {
    const d = await gql(env, fetchFn, SCOPES, {});
    const h = (((d.currentAppInstallation || {}).accessScopes) || []).map((x) => x.handle);
    return { ok: true, customersWrite: h.includes("write_customers"), customersRead: h.includes("read_customers") || h.includes("write_customers") };
  } catch (e) { return { ok: false, customersWrite: false, error: String((e && e.message) || e).slice(0, 120) }; }
}

/* ---------- worker side ---------- */
const stub = (env) => env.ROOM.get(env.ROOM.idFromName(WIN_DO));
async function doCall(env, path, body) {
  const r = await stub(env).fetch(new Request("https://" + WIN_DO + ".internal" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}));
  return r.json();
}
async function formOf(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await request.json().catch(() => null)) || {};
  try {
    const fd = await request.formData(); const out = {};
    for (const [k, v] of fd) { if (typeof v !== "string") continue; out[k] = k in out ? [].concat(out[k], v) : v; }
    return out;
  } catch { return {}; }
}
export function validateEntry(f, cfg) {
  const first = cleanName(f.first), last = cleanName(f.last), email = normEmail(f.email);
  if (!first) return { error: "Please tell us your first name." };
  if (!validEmail(email)) return { error: "That email address doesn't look right." };
  if (!f.rules) return { error: "Please tick the box to accept the contest rules." };
  if (cfg.consentRequired && !f.consent) return { error: "Please tick the email box - the draw is for our email list, and that's how we reach the winner." };
  return { entry: { first, last, email, consent: !!f.consent, interests: cleanInterests(f.interests) } };
}
const ENTER_ERRORS = { rate: "Too many entries from this connection. Please try again in an hour.", pending: "We already sent you a confirmation email - check your inbox and spam folder, and tap the link there.", email: "That email address doesn't look right.", closed: "" };

export async function serveWin(request, env, url, ctx, sopts) {
  const p = url.pathname, origin = url.origin, fetchFn = sopts && sopts.fetchFn, now = Date.now();
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", ...noStore } });
  if (p === WIN_BASE + "/health") {
    const h = await doCall(env, "/_win/health");
    const probe = url.searchParams.get("probe") === "1" ? await shopifyScopes(env, fetchFn) : null;
    return json({ ...h, email: emailConfigured(env), shopify: shopifyConfigured(env), ...(probe ? { customersWrite: probe.customersWrite, scopeError: probe.error || null } : {}) });
  }
  const cfg = await doCall(env, "/_win/cfg");
  const preview = !!cfg.previewKey && url.searchParams.get("preview") === cfg.previewKey;
  const live = isOpen(cfg, now);
  const o = { origin, preview: preview && !live ? cfg.previewKey : "", live, ended: !!cfg.open && !live };
  if (p === WIN_BASE + "/rules") return html(renderRules(cfg, o));
  if (p === WIN_BASE + "/verify") {
    const r = await doCall(env, "/_win/verify", { token: url.searchParams.get("t") || "" });
    if (!r.ok) return html(renderExpired(cfg, { ...o, reason: r.error }), r.error === "expired" ? 410 : 404);
    if (r.status === "verified" && r.entry.consent) {
      const sub = await shopifySubscribe(env, r.entry, cfg, fetchFn);
      await doCall(env, "/_win/synced", { email: r.entry.email, result: sub });
    }
    return html(renderVerified(cfg, { ...o, first: r.entry.first, already: r.status === "already" }));
  }
  if (p === WIN_BASE || p === WIN_BASE + "/") {
    if (request.method === "POST") {
      if (!live && !preview) return html(renderHolding(cfg, o), 403);
      const f = await formOf(request);
      if (f.website) return html(renderCheckInbox(cfg, { ...o, first: cleanName(f.first), email: normEmail(f.email) }));   // honeypot: a bot filled the hidden field
      const v = validateEntry(f, cfg);
      if (v.error) return html(renderLanding(cfg, { ...o, err: v.error, f }), 400);
      const ip = request.headers.get("cf-connecting-ip") || "";
      const r = await doCall(env, "/_win/enter", { ...v.entry, ipHash: ip ? await hashIp(ip, cfg.salt || "") : "", preview: preview && !live });
      if (!r.ok) {
        if (r.error === "closed") return html(renderHolding(cfg, o), 403);
        return html(renderLanding(cfg, { ...o, err: ENTER_ERRORS[r.error] || "That did not save. Please try again.", f }), r.error === "rate" ? 429 : 400);
      }
      const msg = r.status === "already" ? buildAlreadyEmail({ first: r.first || v.entry.first, cfg, origin }) : buildVerifyEmail({ first: v.entry.first, link: origin + WIN_BASE + "/verify?t=" + r.token, cfg, origin });
      const sent = await sendEmail(env, v.entry.email, msg, { replyTo: REPLY_TO, fetchFn });
      if (r.status === "pending" && !sent.ok) return html(renderLanding(cfg, { ...o, err: "We could not send the confirmation email just now. Please try again in a moment.", f }), 502);
      return html(renderCheckInbox(cfg, { ...o, first: v.entry.first, email: v.entry.email }));
    }
    if (!live && !preview) return html(renderHolding(cfg, o));
    return html(renderLanding(cfg, o));
  }
  return html(renderNotFound(cfg, o), 404);
}

/* /9pocket/win: admins only. */
function cfgFrom(f) {
  const out = {};
  for (const k of ["event", "place", "dates", "prize", "drawText", "tags"]) if (k in f) out[k] = String(f[k] || "");
  if ("closes" in f) out.closesAt = atlanticToUtc(f.closes) || null;
  out.consentRequired = f.consentRequired === "1" || f.consentRequired === "on";
  return out;
}
const csvCell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function csvOf(list) {
  const rows = [["email", "first_name", "last_name", "email_consent", "interests", "entered_at", "confirmed_at", "shopify_customer", "test"]];
  for (const e of list) rows.push([e.email, e.first, e.last, e.consent ? "yes" : "no", (e.interests || []).join("; "), new Date(e.enteredAt).toISOString(), new Date(e.verifiedAt).toISOString(), (e.shopify && e.shopify.status) || "", e.test ? "test" : ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function serveWinStaff(request, env, url, user, form, h) {
  const { html, redirect, q, toLogin, opts, fetchFn } = h;
  const p = url.pathname, origin = url.origin;
  if (p === WIN_ADMIN + "/health") return json(await doCall(env, "/_win/health"));
  if (!user) return toLogin();
  if (user.role !== "admin") return html(renderWinDenied(opts), 403);
  if (p === WIN_ADMIN + "/export.csv") {
    const d = await doCall(env, "/_win/list");
    return new Response(csvOf(d.entries || []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="expo-contest-entries.csv"', ...noStore } });
  }
  if (p === WIN_ADMIN + "/control" && request.method === "POST") {
    const f = form || {};
    const action = String(f.action || "");
    let result;
    if (action === "cfg") result = await doCall(env, "/_win/cfg", cfgFrom(f));
    else if (action === "open" || action === "close") result = await doCall(env, "/_win/cfg", { open: action === "open" });
    else if (action === "draw") result = await doCall(env, "/_win/draw", { by: user.email });
    else if (action === "delete") result = await doCall(env, "/_win/delete", { email: f.email });
    else if (action === "retry") {
      const d = await doCall(env, "/_win/entry", { email: f.email });
      if (!d.ok) result = d;
      else if (!d.entry.consent) result = { ok: false, error: "That person did not tick the email box, so they are not subscribed." };
      else result = await doCall(env, "/_win/synced", { email: d.entry.email, result: await shopifySubscribe(env, d.entry, d.cfg, fetchFn) });
    } else if (action === "email_winner") {
      const d = await doCall(env, "/_win/list");
      const w = (d.draws || []).find((x) => x.email === normEmail(f.email));
      if (!w) result = { ok: false, error: "No such draw." };
      else result = await doCall(env, "/_win/winner-emailed", { email: w.email, result: await sendEmail(env, w.email, buildWinnerEmail({ first: w.first, question: w.q, cfg: d.cfg, origin }), { replyTo: REPLY_TO, fetchFn }) });
    } else if (action === "test_email") {
      const d = await doCall(env, "/_win/cfg");
      const sent = await sendEmail(env, user.email, buildVerifyEmail({ first: (user.name || "").split(/\s+/)[0] || "there", link: origin + WIN_BASE + "?preview=" + d.previewKey, cfg: d, origin, test: true }), { replyTo: REPLY_TO, fetchFn });
      result = sent.ok ? { ok: true, message: "A sample confirmation email is on its way to you." } : { ok: false, error: "Email: " + sent.error };
    } else result = { ok: false, error: "Unknown action." };
    return redirect(WIN_ADMIN + q(result.ok ? { msg: result.message || "Saved." } : { err: result.error || "failed" }));
  }
  if (p === WIN_ADMIN || p === WIN_ADMIN + "/") {
    const d = await doCall(env, "/_win/list");
    const scopes = await shopifyScopes(env, fetchFn);
    return html(renderWinAdmin(d, { ...opts, origin, emailOn: emailConfigured(env), shopifyOn: shopifyConfigured(env), customersWrite: scopes.customersWrite, scopeError: scopes.error || "", closesInput: utcToAtlanticInput(d.cfg && d.cfg.closesAt) }));
  }
  return html(renderWinDenied(opts), 404);
}
