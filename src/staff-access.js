/* ---------------- who may open a staff screen ----------------
   Owner, 2026-09-29: "can we instead change it to a user name and password
   with 2fa?" (one login per person, the code by email). The staff PIN sat in
   the public repo and opened everything; this puts every staff screen behind
   the 9Pocket accounts instead.

   staffAccess(request, env, url, perm, k) says yes to, in order:
     1. a signed-in account (a session made through the emailed code, see
        src/stage-auth.js) with the screen's permission - PERM "admin" means
        admin accounts only;
     2. a device or service key (?dk= or `x-exor-device`): a till tablet or the
        BinderPOS add-on paired on 9Pocket > Admin, or a service key made
        there (Shopify Flow). Store screens only, never admin; revocable one by
        one (a revoke reaches every isolate within DEVICE_TTL_MS);
     3. the automation key: `Authorization: Bearer <STAFF_AUTOMATION_KEY>`, a
        worker + GitHub secret for the deploy smoke and the runner workflows;
     4. the old staff PIN (?k= / pin), ONLY while an admin has not switched it
        off on 9Pocket > Admin. Each use is noted (route + time) so the admin
        page can show what still leans on it before the switch goes off.

   The worker strips INTERNAL_HEADER from every request it receives; it adds
   it only to a request it forwards to a room after an account passed, so the
   room can take it in place of the PIN. */

import { currentUser, stageCfg, notePinUse, deviceByHash, noteDeviceUse, sha256Hex } from "./stage.js";
import { can, sameHex } from "./stage-auth.js";

export const INTERNAL_HEADER = "x-exor-staff";
const CFG_TTL_MS = 20e3;
const PIN_NOTE_MS = 10 * 60e3;
const DEVICE_TTL_MS = 60e3;

// What each staff screen needs. Admin accounts pass every one.
export const SCREEN_PERM = {
  pickups: "pickups",      // /pickups, /pickups.json, /pickups/done (customer names on the orders)
  alerts: "alerts",        // /staff (order alerts), /alert, ws role=staff
  tv: "tv",                // /admin (TV and kiosk settings), usage log, comments, ws role=remote
  portal: "portal",        // /portal/buylists (BinderPOS buylists: customer contact details)
  decks: "decks",          // /deckstats, /deck-admin (shopper IPs, bans)
  admin: "admin",          // page edits, BinderPOS price saves, Discord, holds, last-sold
};

export function stripInternal(request) {
  if (!request.headers.has(INTERNAL_HEADER)) return request;
  const h = new Headers(request.headers);
  h.delete(INTERNAL_HEADER);
  return new Request(request, { headers: h });
}

let cfgCache = { at: 0, cfg: null };
export function _resetStaffCache() { cfgCache = { at: 0, cfg: null }; pinNoted.clear(); devCache.clear(); }
async function cfgOf(env, origin) {
  if (cfgCache.cfg && Date.now() - cfgCache.at < CFG_TTL_MS) return cfgCache.cfg;
  let c = null;
  try { c = await stageCfg(env, origin); } catch {}
  // unreadable: keep the last answer; never seen one: the PIN stays as it was (on)
  if (c && c.ok) cfgCache = { at: Date.now(), cfg: c };
  return cfgCache.cfg || { ok: false, pinOff: false };
}
export async function pinAllowed(env, origin) { return !(await cfgOf(env, origin)).pinOff; }

// perm: one screen's permission, or a list (any of them will do)
export function allows(user, perm) {
  if (!user || user.disabled) return false;
  if (Array.isArray(perm)) return perm.some((p) => allows(user, p));
  return perm === "admin" ? user.role === "admin" : can(user, perm);
}

function bearerOf(request) {
  return String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

const devCache = new Map();   // sha256(key) -> { at, d }
async function deviceOf(env, url, key, ctx) {
  const hash = await sha256Hex(key);
  let c = devCache.get(hash);
  if (!c || Date.now() - c.at > DEVICE_TTL_MS) {
    let d = null;
    try { d = await deviceByHash(env, url.origin, hash); } catch { d = c ? c.d : null; }
    c = { at: Date.now(), d, noted: c ? c.noted : 0 };
    devCache.set(hash, c);
  }
  if (c.d && Date.now() - (c.noted || 0) > PIN_NOTE_MS) {
    c.noted = Date.now();
    const p = noteDeviceUse(env, url.origin, hash).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  }
  return c.d;
}
function devicePasses(d, perm) {
  if (!d || perm === "admin") return false;
  if (Array.isArray(perm)) return perm.some((p) => devicePasses(d, p));
  return !!(d.perms && d.perms[perm]);
}

const pinNoted = new Map();
function notePin(env, url, route, ctx) {
  const last = pinNoted.get(route) || 0;
  if (Date.now() - last < PIN_NOTE_MS) return;
  pinNoted.set(route, Date.now());
  const p = notePinUse(env, url.origin, route).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// opts: { pinRoom: room name whose PIN counts (TV remotes use their own screen's), ctx, route }
export async function staffAccess(request, env, url, perm, k, opts) {
  const o = opts || {};
  let user = null;
  try { user = await currentUser(request, env, url.origin); } catch {}
  if (allows(user, perm)) return { ok: true, via: "account", user, who: user.name || user.email };
  const dk = String(request.headers.get("x-exor-device") || url.searchParams.get("dk") || "").trim();
  if (/^[0-9a-f]{64}$/.test(dk) && env && env.ROOM) {
    const d = await deviceOf(env, url, dk, o.ctx);
    if (devicePasses(d, perm)) return { ok: true, via: "device", user: null, who: d.name, device: d };
  }
  const auto = String((env && env.STAFF_AUTOMATION_KEY) || "").trim();
  const bearer = bearerOf(request);
  if (auto.length >= 24 && bearer && sameHex(bearer, auto)) return { ok: true, via: "automation", user: null, who: "automation" };
  k = String(k || "");
  if (k && env && env.ROOM && (await pinAllowed(env, url.origin))) {
    let ok = false;
    try {
      const room = env.ROOM.get(env.ROOM.idFromName(o.pinRoom || "default"));
      ok = !!(await (await room.fetch(new Request(url.origin + "/staff-check?k=" + encodeURIComponent(k)))).json()).ok;
    } catch {}
    if (ok) { notePin(env, url, o.route || url.pathname, o.ctx); return { ok: true, via: "pin", user, who: "staff PIN" }; }
  }
  return { ok: false, user };
}

// The shape every module already takes: staffOk(env, origin, k) -> bool, for one request and screen.
export function staffGate(request, env, url, perm, opts) {
  return async (_env, _origin, k) => (await staffAccess(request, env, url, perm, k, opts)).ok;
}

// GET /staff/me.json?perm=pickups - what a staff page shows before it asks for anything.
export async function serveStaffMe(request, env, url) {
  const perm = SCREEN_PERM[url.searchParams.get("perm")] || "admin";
  let user = null;
  try { user = await currentUser(request, env, url.origin); } catch {}
  const pinOn = await pinAllowed(env, url.origin);
  const next = String(url.searchParams.get("next") || "");
  return Response.json({
    signedIn: !!user, name: user ? user.name || user.email : "", email: user ? user.email : "",
    allowed: allows(user, perm), perm, pinOn,
    login: "/9pocket/login" + (next ? "?next=" + encodeURIComponent(next) : ""),
  }, { headers: { "cache-control": "no-store" } });
}
