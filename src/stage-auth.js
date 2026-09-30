/* ---------------- 9Pocket: accounts, passwords, sessions ----------------
   Owner, 2026-09-20: "a username and password login that the username is
   an email address ... an admin section where I can add other users with
   permissions like editing (adjusting prices for example). Only accessible
   by admin account".

   Passwords are never stored: PBKDF2-SHA256 (100k rounds, 16-byte salt)
   through WebCrypto, which Workers and Node both have. The first account is
   created ONCE through /9pocket/setup, a page only the staff PIN opens and
   only while no account exists - this repo is public, so no password or
   hash of one is ever committed. Sessions are random 256-bit tokens in an
   HttpOnly cookie; ten failed logins on an address lock it for 15 minutes.

   Pure helpers here (test/stage-auth.test.mjs); the records live in the
   stage Durable Object (src/stage.js, /_stage/user*, /_stage/session*). */

const ITER = 100000;
export const SESSION_DAYS = 30;
export const LOCK_AFTER = 10;
export const LOCK_MS = 15 * 60e3;
export const COOKIE = "np_s";
export const MIN_PASSWORD = 8;

// What a staff account may do on a worksheet. An admin may do all of it
// and manage accounts.
export const PERMS = [
  { key: "edit", label: "Change quantities and notes" },
  { key: "prices", label: "Change prices" },
  { key: "add", label: "Add cards to a buylist" },
  { key: "approve", label: "Approve and reject" },
  { key: "email", label: "Send the customer email" },
  { key: "release", label: "Release held stock (hold on arrival)" },
  { key: "requests", label: "Item requests: see them, reply, mark, switch a product off" },
];

// The sealed auto-pricer (/autoprice) is opened by the same accounts.
// Owner, 2026-09-21: "create users with permissions like being able to
// approve auto changes and limiting the percentage they can drop a price".
// Any auto-pricing permission opens the page read-only; each one below
// unlocks a set of actions. Admins have all of them and no limits.
export const AP_PERMS = [
  { key: "ap_view", label: "Open the auto-pricing page (read only)" },
  { key: "ap_publish", label: "Publish staged prices (approve auto changes) and keep" },
  { key: "ap_settings", label: "Per-product settings; add and remove products" },
  { key: "ap_config", label: "Page rules, mode, run now, test push" },
];
// The store's staff screens, once behind the one staff PIN (src/staff-access.js).
// Owner, 2026-09-29: accounts with 2FA instead of the PIN. Page edits, BinderPOS
// price saves, Discord, holds and last-sold stay admin-only.
export const STAFF_PERMS = [
  { key: "pickups", label: "Kiosk pickups: see and finish them (customer names)" },
  { key: "alerts", label: "Order alerts (/staff)" },
  { key: "tv", label: "TV and kiosk settings, usage, comments" },
  { key: "portal", label: "BinderPOS buylists screen (customer contact details)" },
  { key: "decks", label: "Deck Builder stats and bans" },
];
export const ALL_PERMS = [...PERMS, ...AP_PERMS, ...STAFF_PERMS];

// Per-account brakes on what a publish may do to a price, in percent of
// today's price. Blank means no limit. Admins are never limited.
export const LIMITS = [
  { key: "apMaxDropPct", label: "Biggest price drop they may publish", max: 100 },
  { key: "apMaxRaisePct", label: "Biggest price raise they may publish", max: 1000 },
];

export const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 160);
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, ITER);
  return { hash: b64(bits), salt: b64(salt), iter: ITER };
}

export async function verifyPassword(password, user) {
  if (!user || !user.hash || !user.salt) return false;
  const bits = new Uint8Array(await pbkdf2(password, unb64(user.salt), Number(user.iter) || ITER));
  const want = unb64(user.hash);
  if (bits.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];   // constant time
  return diff === 0;
}

export function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCookies(request) {
  const out = {};
  for (const part of String(request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// The user as pages and the admin list see it: never the hash or salt.
export function publicUser(u) {
  if (!u) return null;
  const { hash, salt, iter, ...rest } = u;
  return rest;
}

// Permission check: admins can do everything; staff only what they were given.
export function can(user, perm) {
  if (!user || user.disabled) return false;
  if (user.role === "admin") return true;
  return !!(user.perms && user.perms[perm]);
}

// The perms object from a form's checkbox names (perm_edit=on ...), or from
// a JSON list/object.
export function permsFrom(f) {
  const out = {};
  for (const p of ALL_PERMS) {
    const v = f && (f["perm_" + p.key] != null ? f["perm_" + p.key] : (Array.isArray(f.perms) ? f.perms.includes(p.key) : f.perms && f.perms[p.key]));
    out[p.key] = v === true || v === "on" || v === "1" || v === "true";
  }
  return out;
}

// The limits object from a form's number fields (apMaxDropPct=10 ...) or a
// JSON object; blank, missing or nonsense -> null (no limit).
export function limitsFrom(f) {
  const out = {};
  const src = f && f.limits && typeof f.limits === "object" ? f.limits : f || {};
  for (const l of LIMITS) {
    const raw = src[l.key];
    const n = raw === "" || raw == null ? NaN : Number(raw);
    out[l.key] = Number.isFinite(n) && n >= 0 ? Math.min(l.max, Math.round(n * 10) / 10) : null;
  }
  return out;
}

// What an account may do on the auto-pricer, for src/autoprice.js: null when
// it may not even open the page. Admins get everything and no limits.
export function apPerms(user) {
  if (!user || user.disabled) return null;
  const admin = user.role === "admin";
  const has = (k) => admin || !!(user.perms && user.perms[k]);
  const lim = admin ? {} : limitsFrom(user.limits || {});
  const publish = has("ap_publish"), settings = has("ap_settings"), config = has("ap_config");
  const view = has("ap_view") || publish || settings || config;
  if (!view) return null;
  return { name: user.name || user.email, email: user.email, admin, view, publish, settings, config,
    maxDrop: lim.apMaxDropPct == null ? null : lim.apMaxDropPct, maxRaise: lim.apMaxRaisePct == null ? null : lim.apMaxRaisePct };
}

/* ---------------- the second step: a code by email ----------------
   Owner, 2026-09-29: "can we instead change it to a user name and password
   with 2fa?" -> one login per person, the code by email. After the
   password, a 6-digit code goes to the account's own address; it works for
   CODE_TTL_MS and CODE_TRIES guesses. "Remember this device" keeps a random
   token in an HttpOnly cookie for DEVICE_DAYS, so the code is asked once per
   device and browser, not every shift. A shared till remembers up to
   DEVICE_KEEP accounts. A password reset, disable or delete forgets that
   account's devices and signs it out everywhere. Only sessions made through
   this step count (s:<token>.mfa); older ones sign in again. */
export const CODE_TTL_MS = 10 * 60e3;
export const CODE_TRIES = 5;
export const CODE_SENDS = 5;            // codes per sign-in (the first + 4 re-sends)
export const CODE_RESEND_MS = 30e3;
export const CODE_STARTS = 8;           // sign-ins that may ask for a code, per address per LOCK_MS
export const DEVICE_DAYS = 30;
export const DEVICE_KEEP = 5;
export const DEVICE_COOKIE = "np_d";
export const CHALLENGE_COOKIE = "np_c";

// 000000-999999 without modulo bias (4294000000 is a multiple of 10^6).
export function newCode() {
  const a = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(a); if (a[0] < 4294000000) return String(a[0] % 1000000).padStart(6, "0"); }
}
export const cleanCode = (c) => String(c == null ? "" : c).replace(/\D/g, "").slice(0, 6);
export async function codeHash(id, code) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(id) + ":" + cleanCode(code)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function sameHex(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
// "ch•••@exorgames.com": enough to know which inbox, not the whole address.
export function maskEmail(e) {
  const [u, d] = normEmail(e).split("@");
  if (!u || !d) return "";
  return (u.length <= 2 ? u[0] + "•" : u.slice(0, 2) + "•••") + "@" + d;
}
// The remembered-device cookie holds up to DEVICE_KEEP tokens (one per
// account that ticked "remember" on this browser), newest first.
export function deviceTokens(request) {
  return String(parseCookies(request)[DEVICE_COOKIE] || "").split(".").filter((t) => /^[0-9a-f]{64}$/.test(t)).slice(0, DEVICE_KEEP);
}
export const deviceCookie = (tokens, maxAgeSec) => `${DEVICE_COOKIE}=${tokens.join(".")}; Path=/9pocket; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
export const challengeCookie = (id, maxAgeSec) => `${CHALLENGE_COOKIE}=${id}; Path=/9pocket/login; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
// "iPhone · Safari" for the code email, so a stranger's sign-in stands out.
export function deviceLabel(ua) {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || "an unknown browser";
}
