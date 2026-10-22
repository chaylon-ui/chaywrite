/* ---------------- Enter to win: the contests ----------------
   Owner, 2026-10-15: "an 'enter to win' section where people sign up for
   the contest scanning a QR code at the Atlantic Entertainment Expo in
   Moncton, NB ... opt in to our Omnisend email marketing with their name,
   email ... they should need to verify the email before it is added to our
   email list. Winner receives $100 store credit at ExorGames.com" - and the
   page tells them about Mallow Games (used video games, the buylist at
   mallowgames.com). That was the first contest.
   Owner, 2026-10-22: "I should be able to make a new contest for whatever
   reason.. and then see past contests and how many signups etc" - so the
   module now holds any number of contests. One is CURRENT: exorgames.com/win
   (the QR address) serves it. The others are past ones (closed; their entries
   and draws stay 90 days, their counts for good) or upcoming ones (created
   closed, previewed with the admin key, made current when they should take
   over). Each contest has its own entries, draws, daily counts, settings and
   its own Mallow Games switch (the partner card, band and copy).

   Public, no sign-in: /win (landing page + entry form), /win/verify (the
   emailed confirmation link), /win/rules, /win/health. Admins only (9Pocket
   sign-in): /9pocket/win - the contests list and the new-contest form;
   /9pocket/win/c/<id> - one contest: open / close, settings, entries, Shopify
   status, the draw, CSV export.

   Flow: form -> pending record (48 h, random token) -> confirmation email
   (Resend) -> the link verifies the address -> the entry counts and, when
   the box was ticked, the person becomes a Shopify customer marked
   subscribed (confirmed opt-in) and tagged - Omnisend takes its list from
   Shopify's customers. Double opt-in: nothing is subscribed before the click.
   CLOSED by default: an admin opens it; while closed the public sees a holding
   page and an admin a preview (?preview=<key>; entries made that way are
   marked test and never drawn).

   Storage (the win-contest DO):
     win:cfg             shared: salt (for the connection hashes), previewKey
     win:cur             the id of the current contest
     win:c:<id>          a contest: settings, createdAt/By, summary once swept
     win:e:<id>:<email>  a confirmed entry
     win:p:<token>       a pending entry (c = its contest), 48 h
     win:d:<id>          the draws of a contest
     win:v:<id>:<day>    visits / sign-ups / confirmations per Atlantic day
     win:r:<hour>:<ip>   sign-up rate rows (two hours)
     win:migrated        set once the single-contest layout (before 2026-10-22)
                         was moved into the first contest record

   Kept small on purpose: names and addresses live only in the win-contest
   DO and reach the admin screen, Shopify and the emails - never a log.
   Sign-ups are rate-limited per connection (a salted hash of the address,
   kept two hours) and a honeypot field drops bots. */

import { sendEmail, emailConfigured } from "./stage-email.js";
import { validEmail, normEmail } from "./stage-auth.js";
import { RETENTION } from "./access-log.js";
import { INTERESTS, REPLY_TO, ENTERED_ART, renderLanding, renderHolding, renderCheckInbox, renderVerified, renderExpired, renderRules, renderNotFound, renderWinAdmin, renderContests, renderWinDenied, buildVerifyEmail, buildAlreadyEmail, buildWinnerEmail } from "./win-ui.js";

export const WIN_DO = "win-contest";
export const WIN_BASE = "/win";
export const WIN_ADMIN = "/9pocket/win";
// The links people see (the confirmation email's button and address, the sample's
// preview link) use the store's own domain: Shopify URL redirects /win, /win/verify
// and /win/rules point at the worker and pass the query string through (owner,
// 2026-10-16: "short url this in the email"; checked by the deploy smoke).
export const LINK_ORIGIN = "https://exorgames.com";
export const PENDING_MS = 48 * 3600e3;    // a confirmation link works this long
export const RATE_PER_HOUR = 8;           // sign-ups per connection per hour
export const PENDING_PER_EMAIL = 3;       // unconfirmed entries per address (re-sends)
export { INTERESTS, REPLY_TO };

/* The first contest, the one the module was built for. A store that holds no
   contest yet is seeded with it (that is how the Expo's data, kept under the
   old single-contest keys, became contest #1). */
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
  mallow: true,          // the Mallow Games partner card, band and copy on the pages and in the emails
  art: ENTERED_ART,      // the "you're entered" graphic on the confirmed page (the owner's Expo one; "" = none)
  salt: "",
  previewKey: "",
};
const CFG_KEYS = ["open", "event", "place", "dates", "prize", "closesAt", "drawText", "consentRequired", "tags", "mallow", "art"];
const FLAG_KEYS = ["open", "consentRequired", "mallow"];

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
/* A contest's id: the event's name as a slug plus the year it closes
   ("atlantic-entertainment-expo-2026"); it is in the admin address and the CSV name. */
export function slugOf(event, ms) {
  const s = String(event || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "contest";
  return s + "-" + atlanticDay(ms).slice(0, 4);
}

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
/* The owner's day for the visit tally (Atlantic time). */
export function atlanticDay(ms) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
export function utcToAtlanticInput(ms) {
  if (!ms) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${g("year")}-${g("month")}-${g("day")}T${String(g("hour")).padStart(2, "0")}:${g("minute")}`;
}

/* ---------- the win-contest Durable Object (paths /_win/*) ---------- */
/* Visits / sign-ups / confirmations per contest and Atlantic day (owner, 2026-10-17:
   "how many visits the contest had today"): three numbers, nothing else. */
async function bump(cx, id, day, field) {
  const k = `win:v:${id}:${day}`;
  const v = (await cx.storage.get(k)) || { visits: 0, signups: 0, confirmed: 0 };
  v[field] = (v[field] || 0) + 1;
  await cx.storage.put(k, v);
  return v;
}
async function daysOf(cx, id) {
  const prefix = `win:v:${id}:`;
  const all = await cx.storage.list({ prefix });
  return [...all].map(([k, v]) => ({ day: k.slice(prefix.length), visits: v.visits || 0, signups: v.signups || 0, confirmed: v.confirmed || 0 })).sort((a, b) => (a.day < b.day ? 1 : -1));
}
const eKey = (id, email) => `win:e:${id}:${email}`;
async function entries(cx, id) {
  const all = await cx.storage.list({ prefix: `win:e:${id}:` });
  return [...all.values()].sort((a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0));
}
async function pendings(cx, now) {
  const all = await cx.storage.list({ prefix: "win:p:" });
  const live = [], dead = [];
  for (const [k, v] of all) (v && v.exp >= now ? live : dead).push([k, v]);
  if (dead.length) await cx.storage.delete(dead.map(([k]) => k));
  return live;
}
const drawsOf = async (cx, id) => (await cx.storage.get("win:d:" + id)) || [];
const onList = (e) => !!(e.shopify && /^(subscribed|updated)$/.test(e.shopify.status));
async function contestOf(cx, c) {
  const id = c ? String(c) : await cx.storage.get("win:cur");
  if (!id) return null;
  const rec = await cx.storage.get("win:c:" + id);
  return rec ? { ...rec, id } : null;
}
async function freshId(cx, event, ms) {
  const base = slugOf(event, ms);
  let id = base;
  for (let i = 2; await cx.storage.get("win:c:" + id); i++) id = base + "-" + i;
  return id;
}
function applyCfg(rec, body) {
  for (const k of CFG_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (FLAG_KEYS.includes(k)) rec[k] = !!v;
    else if (k === "closesAt") rec[k] = Number(v) > 0 ? Number(v) : null;
    else rec[k] = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  }
}
/* What the list shows per contest; after the sweep the stored summary (counts only). */
async function statsOf(cx, rec, pend) {
  if (rec.summary) return { ...rec.summary, pending: 0 };
  const list = await entries(cx, rec.id), real = list.filter((e) => !e.test), draws = await drawsOf(cx, rec.id), days = await daysOf(cx, rec.id);
  return { confirmed: real.length, test: list.length - real.length, onList: real.filter(onList).length, excluded: real.filter((e) => e.excluded).length, draws: draws.length, winners: draws.filter((d) => !d.voided).length, pending: pend.filter(([, v]) => v.c === rec.id).length, visits: days.reduce((a, x) => a + x.visits, 0), signups: days.reduce((a, x) => a + x.signups, 0) };
}
/* The shared bits (never a contest's): the salt the connection hashes use and the admin preview key. */
async function sharedOf(cx) {
  const s = (await cx.storage.get("win:cfg")) || {};
  let changed = false;
  if (!s.salt) { s.salt = rnd(16); changed = true; }
  if (!s.previewKey) { s.previewKey = rnd(12); changed = true; }
  if (changed) await cx.storage.put("win:cfg", { salt: s.salt, previewKey: s.previewKey });
  return s;
}
/* Before 2026-10-22 there was one contest: its settings sat in win:cfg beside
   the salt and the key, entries at win:e:<email>, draws at win:draws, counts at
   win:v:<day>. Once, on the first call after the deploy, that becomes contest
   #1 (a fresh store gets the default one, closed). Idempotent: win:migrated. */
async function ensureContests(cx) {
  if (cx.mem.winReady) return;
  const st = cx.storage;
  if (await st.get("win:migrated")) { cx.mem.winReady = true; return; }
  const old = (await st.get("win:cfg")) || {};
  const now = cx.now();
  const rec = { ...DEFAULT_CFG };
  for (const k of CFG_KEYS) if (k in old) rec[k] = old[k];
  delete rec.salt; delete rec.previewKey;
  rec.id = await freshId(cx, rec.event, rec.closesAt || now);
  Object.assign(rec, { createdAt: now, createdBy: "", summary: null });
  const put = { ["win:c:" + rec.id]: rec, "win:cur": rec.id, "win:cfg": { salt: old.salt || rnd(16), previewKey: old.previewKey || rnd(12) }, "win:migrated": now }, gone = [];
  for (const [k, v] of await st.list({ prefix: "win:e:" })) { const rest = k.slice(6); if (!rest.includes(":")) { put[eKey(rec.id, rest)] = v; gone.push(k); } }
  for (const [k, v] of await st.list({ prefix: "win:v:" })) { const rest = k.slice(6); if (!rest.includes(":")) { put[`win:v:${rec.id}:${rest}`] = v; gone.push(k); } }
  for (const [k, v] of await st.list({ prefix: "win:p:" })) if (v && !v.c) put[k] = { ...v, c: rec.id };
  const draws = await st.get("win:draws");
  if (draws) { put["win:d:" + rec.id] = draws; gone.push("win:draws"); }
  const ks = Object.keys(put);
  for (let i = 0; i < ks.length; i += 128) { const o = {}; for (const k of ks.slice(i, i + 128)) o[k] = put[k]; await st.put(o); }
  for (let i = 0; i < gone.length; i += 128) await st.delete(gone.slice(i, i + 128));
  cx.mem.winReady = true;
}

export async function winDoFetch(cx, request, url) {
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const now = cx.now();
  await ensureContests(cx);
  const shared = await sharedOf(cx);
  let cur = (await cx.storage.get("win:cur")) || "";
  const pub = (rec) => ({ ...rec, previewKey: shared.previewKey, current: rec.id === cur });   // never the salt
  const pick = (c) => contestOf(cx, c || url.searchParams.get("c") || "");                    // a given contest, else the current one
  const save = (rec) => cx.storage.put("win:c:" + rec.id, rec);
  const noSuch = () => json({ ok: false, error: "no such contest" }, 404);

  if (p === "/_win/cfg") {
    const rec = await pick(body.c);
    if (!rec) return noSuch();
    if (request.method !== "POST") return json(pub(rec));
    applyCfg(rec, body);
    await save(rec);
    const keys = Object.keys(body).filter((k) => k !== "c");
    return json({ ok: true, message: keys.length === 1 && keys[0] === "open" ? (rec.open ? "The contest is OPEN." : "The contest is closed.") : "Settings saved.", cfg: pub(rec) });
  }

  if (p === "/_win/contests") {
    const pend = await pendings(cx, now);
    const out = [];
    for (const rec of (await cx.storage.list({ prefix: "win:c:" })).values()) out.push({ ...pub(rec), stats: await statsOf(cx, rec, pend) });
    out.sort((a, b) => (b.closesAt || b.createdAt || 0) - (a.closesAt || a.createdAt || 0));
    return json({ ok: true, current: cur, contests: out, now, today: atlanticDay(now) });
  }

  // A new contest starts CLOSED, with no words carried over from another one; it
  // becomes the current one when asked (or when there was none).
  if (p === "/_win/contests/new" && request.method === "POST") {
    const rec = { ...DEFAULT_CFG, open: false, consentRequired: true, mallow: true, art: "", closesAt: null };
    delete rec.salt; delete rec.previewKey;
    for (const k of ["event", "place", "dates", "prize", "drawText", "tags"]) rec[k] = "";
    applyCfg(rec, { ...body, open: false });
    if (!rec.event) return json({ ok: false, error: "The contest needs a name - the event it is for." });
    if (!rec.prize) return json({ ok: false, error: "The contest needs a prize." });
    rec.id = await freshId(cx, rec.event, rec.closesAt || now);
    Object.assign(rec, { createdAt: now, createdBy: String(body.by || "").slice(0, 120), summary: null });
    await save(rec);
    const makeCurrent = !!body.current || !cur;
    if (makeCurrent) { await cx.storage.put("win:cur", rec.id); cur = rec.id; }
    return json({ ok: true, contest: pub(rec), message: `${rec.event} is created, closed${makeCurrent ? ", and it is now the contest at exorgames.com/win" : ""}. Check its settings and open it when you are ready.` });
  }

  if (p === "/_win/current" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    await cx.storage.put("win:cur", rec.id); cur = rec.id;
    return json({ ok: true, message: `exorgames.com/win now shows ${rec.event}.`, cfg: pub(rec) });
  }

  // Removing a contest takes its entries, draws, pending tokens and counts with it;
  // the current one cannot go (the public page needs a contest).
  if (p === "/_win/contests/delete" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    if (rec.id === cur) return json({ ok: false, error: "That is the current contest - make another one current first." });
    const gone = ["win:c:" + rec.id, "win:d:" + rec.id];
    for (const prefix of [`win:e:${rec.id}:`, `win:v:${rec.id}:`]) for (const k of (await cx.storage.list({ prefix })).keys()) gone.push(k);
    for (const [k, v] of await pendings(cx, now)) if (v.c === rec.id) gone.push(k);
    const n = gone.filter((k) => k.startsWith(`win:e:${rec.id}:`)).length;
    for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
    return json({ ok: true, message: `${rec.event} is removed${n ? ` with its ${n} entries` : ""}.` });
  }

  if (p === "/_win/enter" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return json({ ok: false, error: "closed" });
    const email = normEmail(body.email);
    if (!validEmail(email)) return json({ ok: false, error: "email" });
    if (!isOpen(rec, now) && !body.preview) return json({ ok: false, error: "closed" });
    // The connection hash is made here, with the DO's salt (the worker sends the
    // address and keeps nothing); tests may send a ready hash.
    const ipHash = body.ipHash || (body.ip ? await hashIp(body.ip, shared.salt) : "");
    if (ipHash) {
      const hour = Math.floor(now / 3600e3);
      const rk = `win:r:${hour}:${ipHash}`;
      const n = Number((await cx.storage.get(rk)) || 0);
      if (n >= RATE_PER_HOUR) return json({ ok: false, error: "rate" });
      await cx.storage.put(rk, n + 1);
      const old = [...(await cx.storage.list({ prefix: "win:r:" })).keys()].filter((k) => Number(k.split(":")[2]) < hour - 1);
      if (old.length) await cx.storage.delete(old);
    }
    const existing = await cx.storage.get(eKey(rec.id, email));
    if (existing) return json({ ok: true, status: "already", first: existing.first, c: rec.id });
    const mine = (await pendings(cx, now)).filter(([, v]) => v.email === email && v.c === rec.id).length;
    if (mine >= PENDING_PER_EMAIL) return json({ ok: false, error: "pending" });
    const token = rnd(24);
    const pend = { c: rec.id, email, first: cleanName(body.first), last: cleanName(body.last), consent: !!body.consent, interests: cleanInterests(body.interests), at: now, exp: now + PENDING_MS, preview: !!body.preview && !isOpen(rec, now) };
    await cx.storage.put("win:p:" + token, pend);
    if (!pend.preview) await bump(cx, rec.id, atlanticDay(now), "signups");
    return json({ ok: true, status: "pending", token, first: pend.first, c: rec.id });
  }

  // The token says which contest the entry belongs to, so a link keeps working
  // after another contest became the current one.
  if (p === "/_win/verify" && request.method === "POST") {
    const token = String(body.token || "");
    const key = "win:p:" + token;
    const pend = token.length >= 16 ? await cx.storage.get(key) : null;
    if (!pend) return json({ ok: false, error: "invalid" });
    if (pend.exp < now) { await cx.storage.delete(key); return json({ ok: false, error: "expired" }); }
    const rec = await contestOf(cx, pend.c);
    if (!rec) { await cx.storage.delete(key); return json({ ok: false, error: "invalid" }); }
    const existing = await cx.storage.get(eKey(rec.id, pend.email));
    const others = (await pendings(cx, now)).filter(([, v]) => v.email === pend.email && v.c === rec.id).map(([k]) => k);
    if (others.length) await cx.storage.delete(others);
    if (existing) return json({ ok: true, status: "already", entry: existing, c: rec.id, cfg: pub(rec) });
    const entry = { email: pend.email, first: pend.first, last: pend.last, consent: pend.consent, interests: pend.interests || [], enteredAt: pend.at, verifiedAt: now, test: !!pend.preview, shopify: { status: pend.consent ? "pending" : "no-consent" } };
    await cx.storage.put(eKey(rec.id, entry.email), entry);
    if (!entry.test) await bump(cx, rec.id, atlanticDay(now), "confirmed");
    return json({ ok: true, status: "verified", entry, c: rec.id, cfg: pub(rec) });
  }

  if (p === "/_win/synced" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const email = normEmail(body.email);
    const e = await cx.storage.get(eKey(rec.id, email));
    if (!e) return json({ ok: false, error: "no such entry" });
    const r = body.result || {};
    e.shopify = { status: r.ok ? r.status || "subscribed" : r.status || "failed", id: r.id || "", error: r.ok ? "" : String(r.error || "").slice(0, 160), at: now };
    await cx.storage.put(eKey(rec.id, email), e);
    return json({ ok: true, entry: e, message: r.ok ? "Subscribed as a Shopify customer." : "Shopify: " + e.shopify.error });
  }

  if (p === "/_win/entry" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const e = await cx.storage.get(eKey(rec.id, normEmail(body.email)));
    if (!e) return json({ ok: false, error: "no such entry" });
    return json({ ok: true, entry: e, cfg: pub(rec) });
  }

  if (p === "/_win/delete" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const email = normEmail(body.email);
    const e = await cx.storage.get(eKey(rec.id, email));
    if (!e) return json({ ok: false, error: "no such entry" });
    await cx.storage.delete(eKey(rec.id, email));
    const draws = (await drawsOf(cx, rec.id)).filter((d) => d.email !== email);
    await cx.storage.put("win:d:" + rec.id, draws);
    return json({ ok: true, message: "Entry removed." });
  }

  if (p === "/_win/draw" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const draws = await drawsOf(cx, rec.id);
    const drawn = new Set(draws.map((d) => d.email));
    const all = (await entries(cx, rec.id)).filter((e) => !e.test);
    const excluded = all.filter((e) => e.excluded).length;
    const pool = all.filter((e) => !e.excluded && !drawn.has(e.email));
    if (!pool.length) return json({ ok: false, error: draws.length || excluded ? "Every eligible confirmed entry has been drawn or excluded already." : "No confirmed entries to draw from yet." });
    const w = pool[randInt(0, pool.length - 1)];
    const sq = skillQuestion();
    const d = { email: w.email, first: w.first, last: w.last, at: now, by: String(body.by || ""), q: sq.q, a: sq.a, emailed: null };
    draws.push(d);
    await cx.storage.put("win:d:" + rec.id, draws);
    return json({ ok: true, draw: d, message: `Drawn: ${w.first} ${w.last} (${w.email}) - nothing has been emailed. ${pool.length} entries were in the hat${excluded ? `, ${excluded} excluded` : ""}.` });
  }

  // Owner, 2026-10-18: staff may have signed up - an entry can be excluded from the
  // draw (and included again), and a draw that landed on staff can be voided, which
  // excludes that entry too. Nothing here sends an email.
  if (p === "/_win/exclude" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const email = normEmail(body.email);
    const e = await cx.storage.get(eKey(rec.id, email));
    if (!e) return json({ ok: false, error: "no such entry" });
    if (body.on) e.excluded = { at: now, by: String(body.by || "") }; else delete e.excluded;
    await cx.storage.put(eKey(rec.id, email), e);
    return json({ ok: true, entry: e, message: body.on ? `${e.first} ${e.last} is excluded from the draw.` : `${e.first} ${e.last} is back in the draw.` });
  }

  if (p === "/_win/void" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const email = normEmail(body.email);
    const draws = await drawsOf(cx, rec.id);
    const d = draws.find((x) => x.email === email && !x.voided);
    if (!d) return json({ ok: false, error: "no such draw" });
    d.voided = { at: now, by: String(body.by || "") };
    await cx.storage.put("win:d:" + rec.id, draws);
    const e = await cx.storage.get(eKey(rec.id, email));
    if (e) { e.excluded = { at: now, by: String(body.by || ""), reason: "voided draw" }; await cx.storage.put(eKey(rec.id, email), e); }
    return json({ ok: true, message: `${d.first} ${d.last}'s draw is voided and the entry excluded - draw again when ready.` });
  }

  if (p === "/_win/winner-emailed" && request.method === "POST") {
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    const draws = await drawsOf(cx, rec.id);
    const d = draws.find((x) => x.email === normEmail(body.email));
    if (!d) return json({ ok: false, error: "no such draw" });
    d.emailed = { at: now, ok: !!(body.result && body.result.ok), error: body.result && !body.result.ok ? String(body.result.error || "").slice(0, 160) : "" };
    await cx.storage.put("win:d:" + rec.id, draws);
    return json({ ok: true, message: d.emailed.ok ? "The winner has been emailed." : "Email failed: " + d.emailed.error });
  }

  if (p === "/_win/hit" && request.method === "POST") {
    if (body.kind !== "visit") return json({ ok: false, error: "kind" });
    const rec = await contestOf(cx, body.c);
    if (!rec) return noSuch();
    return json({ ok: true, day: await bump(cx, rec.id, atlanticDay(now), "visits") });
  }

  if (p === "/_win/list") {
    const rec = await pick(body.c);
    if (!rec) return noSuch();
    const pend = await pendings(cx, now);
    return json({ ok: true, cfg: pub(rec), entries: await entries(cx, rec.id), pending: pend.filter(([, v]) => v.c === rec.id).length, draws: await drawsOf(cx, rec.id), days: await daysOf(cx, rec.id), today: atlanticDay(now), now, contests: (await cx.storage.list({ prefix: "win:c:" })).size });
  }

  // Retention (src/retention.js, once a day): once a contest has been closed
  // for contestDaysAfterClose, its entries, pending tokens and draws go and the
  // record keeps a summary (counts, no names); the per-day counts stay. Stale
  // rate rows go every time.
  if (p === "/_win/sweep" && request.method === "POST") {
    const pend = await pendings(cx, now);   // drops expired pending tokens as it goes
    const hour = Math.floor(now / 3600e3);
    const stale = [...(await cx.storage.list({ prefix: "win:r:" })).keys()].filter((k) => Number(k.split(":")[2]) < hour - 1);
    if (stale.length) await cx.storage.delete(stale);
    const counts = { due: false, entries: 0, pending: 0, draws: 0 };
    for (const rec of (await cx.storage.list({ prefix: "win:c:" })).values()) {
      if (rec.summary || !(rec.closesAt && now > rec.closesAt + RETENTION.contestDaysAfterClose * 86400e3)) continue;
      counts.due = true;
      const stats = await statsOf(cx, rec, pend);
      const gone = [...(await cx.storage.list({ prefix: `win:e:${rec.id}:` })).keys()];
      counts.entries += gone.length;
      const mine = pend.filter(([, v]) => v.c === rec.id).map(([k]) => k);
      counts.pending += mine.length; gone.push(...mine);
      counts.draws += stats.draws;
      if (stats.draws) gone.push("win:d:" + rec.id);
      const { pending, ...summary } = stats;
      rec.summary = { ...summary, sweptAt: now };
      await save(rec);
      for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
    }
    return json({ ok: true, counts });
  }

  if (p === "/_win/health") {
    const rec = await pick();
    const contests = (await cx.storage.list({ prefix: "win:c:" })).size;
    if (!rec) return json({ ok: true, contests, current: "", open: false });
    const real = (await entries(cx, rec.id)).filter((e) => !e.test);
    const today = (await cx.storage.get(`win:v:${rec.id}:${atlanticDay(now)}`)) || {};
    return json({ ok: true, contests, current: rec.id, event: rec.event, open: isOpen(rec, now), closesAt: rec.closesAt, visitsToday: today.visits || 0, signupsToday: today.signups || 0, confirmed: real.length, onList: real.filter(onList).length, pending: (await pendings(cx, now)).filter(([, v]) => v.c === rec.id).length, drawn: (await drawsOf(cx, rec.id)).length });
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
const qc = (c) => (c ? "?c=" + encodeURIComponent(c) : "");
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
  const p = url.pathname, origin = url.origin, fetchFn = sopts && sopts.fetchFn, now = sopts && sopts.now ? sopts.now() : Date.now();   // sopts.now: a clock for tests
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", ...noStore } });
  if (p === WIN_BASE + "/health") {
    const h = await doCall(env, "/_win/health");
    const probe = url.searchParams.get("probe") === "1" ? await shopifyScopes(env, fetchFn) : null;
    return json({ ...h, email: emailConfigured(env), shopify: shopifyConfigured(env), ...(probe ? { customersWrite: probe.customersWrite, scopeError: probe.error || null } : {}) });
  }
  // The public page is the current contest's. With the admin preview key, ?c=<id>
  // shows another one (an upcoming contest, before it takes over).
  let cfg = await doCall(env, "/_win/cfg");
  const key = url.searchParams.get("preview") || "", want = url.searchParams.get("c") || "";
  if (cfg && cfg.id && key && cfg.previewKey === key && want && want !== cfg.id) { const other = await doCall(env, "/_win/cfg" + qc(want)); if (other && other.id) cfg = other; }
  if (!cfg || !cfg.id) return html(renderNotFound({ event: "Exor Games", place: "" }, { origin }), 404);
  const preview = !!cfg.previewKey && key === cfg.previewKey;
  const live = isOpen(cfg, now);
  const o = { origin, preview: preview && (!live || !cfg.current) ? cfg.previewKey : "", c: cfg.current ? "" : cfg.id, live, ended: !!cfg.open && !live };
  if (p === WIN_BASE + "/rules") return html(renderRules(cfg, o));
  if (p === WIN_BASE + "/verify") {
    const r = await doCall(env, "/_win/verify", { token: url.searchParams.get("t") || "" });
    if (!r.ok) return html(renderExpired(cfg, { ...o, reason: r.error }), r.error === "expired" ? 410 : 404);
    const vcfg = r.cfg || cfg;   // the contest the token belongs to - not always the current one
    if (r.status === "verified" && r.entry.consent) {
      const sub = await shopifySubscribe(env, r.entry, vcfg, fetchFn);
      await doCall(env, "/_win/synced", { c: r.c, email: r.entry.email, result: sub });
    }
    return html(renderVerified(vcfg, { ...o, first: r.entry.first, already: r.status === "already" }));
  }
  if (p === WIN_BASE || p === WIN_BASE + "/") {
    if (request.method === "POST") {
      if (!live && !preview) return html(renderHolding(cfg, o), 403);
      const f = await formOf(request);
      if (f.website) return html(renderCheckInbox(cfg, { ...o, first: cleanName(f.first), email: normEmail(f.email) }));   // honeypot: a bot filled the hidden field
      const v = validateEntry(f, cfg);
      if (v.error) return html(renderLanding(cfg, { ...o, err: v.error, f }), 400);
      const r = await doCall(env, "/_win/enter", { ...v.entry, c: cfg.id, ip: request.headers.get("cf-connecting-ip") || "", preview: preview && !live });
      if (!r.ok) {
        if (r.error === "closed") return html(renderHolding(cfg, o), 403);
        return html(renderLanding(cfg, { ...o, err: ENTER_ERRORS[r.error] || "That did not save. Please try again.", f }), r.error === "rate" ? 429 : 400);
      }
      const msg = r.status === "already" ? buildAlreadyEmail({ first: r.first || v.entry.first, cfg, origin }) : buildVerifyEmail({ first: v.entry.first, link: LINK_ORIGIN + WIN_BASE + "/verify?t=" + r.token, cfg, origin });
      const sent = await sendEmail(env, v.entry.email, msg, { replyTo: REPLY_TO, fetchFn });
      if (r.status === "pending" && !sent.ok) return html(renderLanding(cfg, { ...o, err: "We could not send the confirmation email just now. Please try again in a moment.", f }), 502);
      return html(renderCheckInbox(cfg, { ...o, first: v.entry.first, email: v.entry.email }));
    }
    if (!live && !preview) return html(renderHolding(cfg, o));
    if (request.method === "GET" && live && !preview) {   // one tick on the day's visit tally; never slows the page
      const hit = doCall(env, "/_win/hit", { kind: "visit", c: cfg.id }).catch(() => {});
      if (ctx && ctx.waitUntil) ctx.waitUntil(hit); else await hit;
    }
    return html(renderLanding(cfg, o));
  }
  return html(renderNotFound(cfg, o), 404);
}

/* /9pocket/win: admins only. The list (and the new-contest form) at /9pocket/win;
   one contest at /9pocket/win/c/<id>; every control form carries the contest id. */
function cfgFrom(f) {
  const out = {};
  for (const k of ["event", "place", "dates", "prize", "drawText", "tags"]) if (k in f) out[k] = String(f[k] || "");
  if ("closes" in f) out.closesAt = atlanticToUtc(f.closes) || null;
  // Each checkbox rides with a hidden "0" of the same name, so an unticked box still arrives (as "0").
  const flag = (v) => [].concat(v).some((x) => x === "1" || x === "on");
  if ("consentRequired" in f) out.consentRequired = flag(f.consentRequired);
  if ("mallow" in f) out.mallow = flag(f.mallow);
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
  const m = /^\/9pocket\/win\/c\/([a-z0-9-]{1,64})(\/export\.csv)?$/.exec(p);
  if (p === WIN_ADMIN + "/export.csv" || (m && m[2])) {
    const d = await doCall(env, "/_win/list" + qc(m ? m[1] : ""));
    if (!d.ok) return html(renderWinDenied(opts, "There is no contest with that address."), 404);
    return new Response(csvOf(d.entries || []), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${d.cfg.id}-entries.csv"`, ...noStore } });
  }
  if (p === WIN_ADMIN + "/control" && request.method === "POST") {
    const f = form || {};
    const action = String(f.action || ""), c = String(f.c || "").slice(0, 64);
    let result, back = c ? WIN_ADMIN + "/c/" + encodeURIComponent(c) : WIN_ADMIN;
    if (action === "new") {
      result = await doCall(env, "/_win/contests/new", { ...cfgFrom(f), current: f.current === "1", by: user.email });
      back = result.ok ? WIN_ADMIN + "/c/" + result.contest.id : WIN_ADMIN;
    } else if (action === "current") { result = await doCall(env, "/_win/current", { c }); back = WIN_ADMIN; }
    else if (action === "remove_contest") { result = await doCall(env, "/_win/contests/delete", { c }); back = WIN_ADMIN; }
    else if (action === "cfg") result = await doCall(env, "/_win/cfg", { c, ...cfgFrom(f) });
    else if (action === "open" || action === "close") result = await doCall(env, "/_win/cfg", { c, open: action === "open" });
    else if (action === "draw") result = await doCall(env, "/_win/draw", { c, by: user.email });
    else if (action === "delete") result = await doCall(env, "/_win/delete", { c, email: f.email });
    else if (action === "exclude" || action === "include") result = await doCall(env, "/_win/exclude", { c, email: f.email, on: action === "exclude", by: user.email });
    else if (action === "void") result = await doCall(env, "/_win/void", { c, email: f.email, by: user.email });
    else if (action === "retry") {
      const d = await doCall(env, "/_win/entry", { c, email: f.email });
      if (!d.ok) result = d;
      else if (!d.entry.consent) result = { ok: false, error: "That person did not tick the email box, so they are not subscribed." };
      else result = await doCall(env, "/_win/synced", { c, email: d.entry.email, result: await shopifySubscribe(env, d.entry, d.cfg, fetchFn) });
    } else if (action === "email_winner") {
      const d = await doCall(env, "/_win/list" + qc(c));
      const w = (d.draws || []).find((x) => x.email === normEmail(f.email) && !x.voided);
      if (!w) result = { ok: false, error: "No such draw (or it was voided)." };
      else result = await doCall(env, "/_win/winner-emailed", { c, email: w.email, result: await sendEmail(env, w.email, buildWinnerEmail({ first: w.first, question: w.q, cfg: d.cfg, origin }), { replyTo: REPLY_TO, fetchFn }) });
    } else if (action === "test_email") {
      const d = await doCall(env, "/_win/cfg" + qc(c));
      if (!d.id) result = d;
      else {
        const sent = await sendEmail(env, user.email, buildVerifyEmail({ first: (user.name || "").split(/\s+/)[0] || "there", link: LINK_ORIGIN + WIN_BASE + "?preview=" + d.previewKey + (d.current ? "" : "&c=" + encodeURIComponent(d.id)), cfg: d, origin, test: true }), { replyTo: REPLY_TO, fetchFn });
        result = sent.ok ? { ok: true, message: "A sample confirmation email is on its way to you." } : { ok: false, error: "Email: " + sent.error };
      }
    } else result = { ok: false, error: "Unknown action." };
    return redirect(back + q(result.ok ? { msg: result.message || "Saved." } : { err: result.error || "failed" }));
  }
  if (p === WIN_ADMIN || p === WIN_ADMIN + "/") {
    const d = await doCall(env, "/_win/contests");
    return html(renderContests(d, { ...opts, origin, keepDays: RETENTION.contestDaysAfterClose }));
  }
  if (m) {
    const d = await doCall(env, "/_win/list" + qc(m[1]));
    if (!d.ok) return html(renderWinDenied(opts, "There is no contest with that address."), 404);
    const scopes = await shopifyScopes(env, fetchFn);
    return html(renderWinAdmin(d, { ...opts, origin, emailOn: emailConfigured(env), shopifyOn: shopifyConfigured(env), customersWrite: scopes.customersWrite, scopeError: scopes.error || "", closesInput: utcToAtlanticInput(d.cfg && d.cfg.closesAt) }));
  }
  return html(renderWinDenied(opts), 404);
}
