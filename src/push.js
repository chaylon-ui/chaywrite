/* src/push.js - web push alerts, no app and no email (owner, 2026-10-20:
   "do ... three").

   A shopper opens /alerts (exorgames.com/alerts redirects here), picks what
   they want - new arrivals per game, sealed product, the Monday market
   pulse - and taps "Turn on alerts". The browser registers /alerts-sw.js,
   asks permission, subscribes with our VAPID public key and posts the
   subscription here. We store the push endpoint, its two keys and the
   topics: no name, no email, no address, nothing else.

   Sending (RFC 8030 / 8291 / 8292, all WebCrypto, no library): the payload
   is encrypted aes128gcm to the subscription's P-256 key (ECDH + HKDF +
   AES-GCM, one record), the request is signed with our VAPID key (ES256
   JWT, aud = the push service's origin). The keys are made once in the
   "push" Durable Object and kept there. A 404 / 410 answer deletes the
   subscription (the browser revoked it).

   What is sent, from the cron: between 10:00 and 10:29 Atlantic a digest
   per game topic when the day has arrivals (the same webhook-confirmed
   arrivals the New Today strip and the Discord shelf drops use,
   src/discord.js pendingDrops), once a day; Mondays in that window the
   market pulse (src/price-history.js phs:movers). A test notification is
   available from the page to one's own subscription.

   iPhone / iPad: Safari only delivers web push to a page added to the Home
   Screen (iOS 16.4+); the page says so. */

import { pendingDrops } from "./discord.js";
import { PRICE_DO } from "./price-history.js";

export const PUSH_DO = "push";
export const TOPICS = {
  "new-mtg": "New Magic arrivals", "new-pokemon": "New Pokémon arrivals", "new-yugioh": "New Yu-Gi-Oh! arrivals",
  "new-lorcana": "New Lorcana arrivals", "new-onepiece": "New One Piece arrivals", "new-sealed": "New sealed product",
  "pulse": "Monday market pulse",
};
const SUBJECT = "mailto:charlottetown@exorgames.com";
const SHOP = "https://exorgames.com";
const ATL = "America/Halifax";
const SEND_HOUR = 10;                 // digests go out between 10:00 and 10:29 Atlantic
const TTL = 86400;
const MAX_PER_TICK = 300;             // subscriptions pushed per cron tick per topic
const noStore = { "cache-control": "no-store" };
const json = (o, status, extra) => Response.json(o, { status: status || 200, headers: { ...noStore, ...(extra || {}) } });

/* ---- bytes --------------------------------------------------------------- */
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function unb64u(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
const utf8 = (s) => new TextEncoder().encode(s);
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}
export async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

/* ---- the content encryption (RFC 8291 + 8188, aes128gcm) ---------------- */
export async function encryptPayload(p256dh, auth, plaintext, opts) {
  const o = opts || {};
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  const local = o.localKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(utf8("WebPush: info\0"), uaPub, localPub), 32);
  const salt = o.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const record = cat(utf8(plaintext), new Uint8Array([2]));   // the last-record delimiter, no padding
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return { body: cat(salt, rs, new Uint8Array([localPub.length]), localPub, ct), salt, localPub };
}
/* The other side, for the tests: what a browser does with the message. */
export async function decryptPayload(uaPrivateKey, uaPublicRaw, auth, body) {
  const salt = body.slice(0, 16), idlen = body[20], localPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const localKey = await crypto.subtle.importKey("raw", localPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: localKey }, uaPrivateKey, 256));
  const ikm = await hkdf(unb64u(auth), shared, cat(utf8("WebPush: info\0"), uaPublicRaw, localPub), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const rec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  let end = rec.length - 1; while (end > 0 && rec[end] === 0) end--;
  if (rec[end] !== 2) throw new Error("bad delimiter");
  return new TextDecoder().decode(rec.slice(0, end));
}

/* ---- VAPID (RFC 8292) ------------------------------------------------------ */
export async function makeVapid() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicJwk: await crypto.subtle.exportKey("jwk", k.publicKey), privateJwk: await crypto.subtle.exportKey("jwk", k.privateKey), publicKey: b64u(await crypto.subtle.exportKey("raw", k.publicKey)), created: Date.now() };
}
export async function vapidAuth(vapid, endpoint, now) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(utf8(JSON.stringify(o)));
  const input = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp: Math.floor((now || Date.now()) / 1000) + 12 * 3600, sub: SUBJECT });
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input));   // raw r||s, as JWS wants
  return "vapid t=" + input + "." + b64u(sig) + ", k=" + vapid.publicKey;
}

/* One notification to one subscription. Returns { status, gone } where gone
   means the push service says the subscription no longer exists. */
export async function sendPush(sub, payload, vapid, fetchFn, now) {
  const f = fetchFn || ((a, b) => fetch(a, b));
  const { body } = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payload));
  const r = await f(sub.endpoint, { method: "POST", headers: { authorization: await vapidAuth(vapid, sub.endpoint, now), "content-type": "application/octet-stream", "content-encoding": "aes128gcm", ttl: String(TTL), urgency: "normal", ...(payload.tag ? { topic: String(payload.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}) }, body });
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}

/* ---- the DO side ------------------------------------------------------------ */
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const validTopics = (t) => (Array.isArray(t) ? t : []).map(String).filter((x) => TOPICS[x]).slice(0, 12);
export function shapeSubscription(b) {
  const s = (b && b.subscription) || b || {};
  const endpoint = String(s.endpoint || "");
  const keys = s.keys || {};
  if (!/^https:\/\/[^\s]{10,1800}$/.test(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(String(keys.p256dh || "")) || !/^[A-Za-z0-9_-]{16,32}$/.test(String(keys.auth || ""))) return null;
  return { endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth) };
}

export async function pushDoFetch(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/_push/vapid") {
    let v = await cx.storage.get("push:vapid");
    if (!v) { v = await makeVapid(); await cx.storage.put("push:vapid", v); }
    return json({ ok: true, vapid: url.searchParams.get("private") === "1" ? v : { publicKey: v.publicKey, created: v.created } });
  }
  if (p === "/_push/subscribe" && post) {
    const b = await bodyOf(request);
    const s = shapeSubscription(b);
    if (!s) return json({ ok: false, error: "that does not look like a push subscription" }, 400);
    const topics = validTopics(b.topics);
    const id = (await sha256hex(s.endpoint)).slice(0, 32);
    const cur = (await cx.storage.get("sub:" + id)) || {};
    await cx.storage.put("sub:" + id, { ...s, topics, at: cur.at || cx.now(), updatedAt: cx.now() });
    return json({ ok: true, id, topics });
  }
  if (p === "/_push/unsubscribe" && post) {
    const b = await bodyOf(request);
    const endpoint = String((b.subscription && b.subscription.endpoint) || b.endpoint || "");
    if (!endpoint) return json({ ok: false, error: "endpoint required" }, 400);
    const id = (await sha256hex(endpoint)).slice(0, 32);
    await cx.storage.delete("sub:" + id);
    return json({ ok: true, id });
  }
  if (p === "/_push/get") {
    const endpoint = String(url.searchParams.get("endpoint") || "");
    const id = endpoint ? (await sha256hex(endpoint)).slice(0, 32) : "";
    const s = id ? await cx.storage.get("sub:" + id) : null;
    return json({ ok: true, id, sub: s || null });
  }
  if (p === "/_push/list") {
    const topic = String(url.searchParams.get("topic") || "");
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || MAX_PER_TICK));
    const m = await cx.storage.list({ prefix: "sub:" });
    const subs = [];
    for (const [k, v] of m) { if (!v) continue; if (!topic || (v.topics || []).includes(topic)) subs.push({ id: k.slice(4), ...v }); if (subs.length >= limit) break; }
    return json({ ok: true, subs });
  }
  if (p === "/_push/drop" && post) {
    const b = await bodyOf(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => "sub:" + String(x).replace(/[^0-9a-f]/g, "").slice(0, 32)).filter((k) => k.length > 4);
    for (let i = 0; i < ids.length; i += 128) await cx.storage.delete(ids.slice(i, i + 128));
    return json({ ok: true, dropped: ids.length });
  }
  if (p === "/_push/sent" && post) { const b = await bodyOf(request); const key = String(b.key || "").slice(0, 80); if (key) await cx.storage.put("sent:" + key, { at: cx.now(), n: Number(b.n) || 0 }); return json({ ok: true }); }
  if (p === "/_push/sent") { const key = String(url.searchParams.get("key") || "").slice(0, 80); return json({ ok: true, sent: key ? (await cx.storage.get("sent:" + key)) || null : null }); }
  if (p === "/_push/sweep" && post) {
    const cut = cx.now() - 14 * 864e5, gone = [];
    for (const [k, v] of await cx.storage.list({ prefix: "sent:" })) if (!v || (v.at || 0) < cut) gone.push(k);
    for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
    return json({ ok: true, counts: { digests: gone.length } });
  }
  if (p === "/_push/health") {
    const m = await cx.storage.list({ prefix: "sub:" });
    const byTopic = {}; for (const v of m.values()) for (const t of (v && v.topics) || []) byTopic[t] = (byTopic[t] || 0) + 1;
    const sent = [...(await cx.storage.list({ prefix: "sent:" }))].map(([k, v]) => ({ key: k.slice(5), at: v && v.at, n: v && v.n })).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 10);
    return json({ ok: true, subscriptions: m.size, byTopic, vapid: !!(await cx.storage.get("push:vapid")), lastSent: sent });
  }
  return json({ ok: false, error: "no such path" }, 404);
}

/* ---- worker side ------------------------------------------------------------- */
const ORIGIN = "https://exor-binder.internal";
async function doCall(env, path, body) {
  const r = await env.ROOM.get(env.ROOM.idFromName(PUSH_DO)).fetch(new Request(ORIGIN + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}));
  return r.json();
}
const atl = (ms) => { const d = new Date(ms); const s = d.toLocaleString("en-CA", { timeZone: ATL, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); const m = /(\w+)\.?,? (\d{4})-(\d\d)-(\d\d),? (\d\d):(\d\d)/.exec(s) || []; return { day: m[2] + "-" + m[3] + "-" + m[4], hour: Number(m[5]), minute: Number(m[6]), weekday: m[1] }; };

const gameTopic = (c) => (c && c.game && c.game.sealed) ? "new-sealed" : ({ mtg: "new-mtg", pokemon: "new-pokemon", yugioh: "new-yugioh", lorcana: "new-lorcana", onepiece: "new-onepiece" })[(c && c.game && c.game.key) || ""] || null;

/* Today's arrivals -> one digest per topic that has any. */
export function digestsOf(cards) {
  const by = {};
  for (const c of cards || []) { const t = gameTopic(c); if (!t) continue; (by[t] = by[t] || []).push(c); }
  const out = [];
  for (const [topic, list] of Object.entries(by)) {
    list.sort((a, b) => b.price - a.price);
    const names = list.slice(0, 3).map((c) => c.title.replace(/\s*\[.*?\]\s*$/, "").slice(0, 40));
    out.push({ topic, title: TOPICS[topic].replace("New ", "New ") + ": " + list.length + " today", body: names.join(", ") + (list.length > 3 ? " and " + (list.length - 3) + " more" : "") + " · tap to see", url: SHOP + "/#xg-newtoday", icon: (list.find((c) => c.image) || {}).image || undefined, tag: topic, count: list.length });
  }
  return out;
}
export function pulseDigest(mv) {
  if (!mv || !mv.ready) return null;
  const w = mv.w7 || {}; const up = (w.risers || [])[0], down = (w.fallers || [])[0];
  if (!up && !down) return null;
  const name = (m) => ((mv.detail || {})[m.id] || {}).title || String(m.h || "").replace(/-/g, " ");
  const parts = [];
  if (up) parts.push(name(up) + " +" + up.p + "%");
  if (down) parts.push(name(down) + " " + down.p + "%");
  return { topic: "pulse", title: "Market pulse: this week's movers", body: parts.join(" · ") + " · " + ((w.counted || 0) + " singles moved"), url: SHOP + "/pulse", tag: "pulse" };
}

/* Deliver one digest to every subscription of its topic. */
export async function deliver(env, digest, opts) {
  const o = opts || {};
  const vapid = (await doCall(env, "/_push/vapid?private=1")).vapid;
  const subs = (await doCall(env, "/_push/list?topic=" + encodeURIComponent(digest.topic))).subs || [];
  let sent = 0, gone = [], failed = 0;
  const payload = { title: digest.title, body: digest.body, url: digest.url, icon: digest.icon, tag: digest.tag };
  for (const s of subs) {
    try { const r = await sendPush(s, payload, vapid, o.fetchFn, o.now); if (r.gone) gone.push(s.id); else if (r.status >= 200 && r.status < 300) sent++; else failed++; }
    catch { failed++; }
  }
  if (gone.length) await doCall(env, "/_push/drop", { ids: gone });
  return { topic: digest.topic, subscribers: subs.length, sent, gone: gone.length, failed };
}

export async function pushTick(env, opts) {
  const o = opts || {};
  if (!env || !env.ROOM) return null;
  const now = o.now || Date.now();
  const t = atl(now);
  if (!(t.hour === SEND_HOUR && t.minute < 30) && !o.force) return { skipped: "not the hour" };
  const out = { day: t.day, sent: [] };
  const once = async (key, make) => {
    if (!o.force && (await doCall(env, "/_push/sent?key=" + encodeURIComponent(key))).sent) return;
    const digest = await make(); if (!digest) return;
    const r = await deliver(env, digest, o);
    await doCall(env, "/_push/sent", { key, n: r.sent });
    out.sent.push(r);
  };
  let drops = null;
  try { drops = await pendingDrops(env, { posted: [], skipped: [] }); } catch (e) { out.error = String((e && e.message) || e).slice(0, 160); }
  for (const d of digestsOf((drops && drops.pending) || [])) await once(d.topic + ":" + t.day, async () => d);
  if (t.weekday.toLowerCase().startsWith("mon") || o.force) {
    await once("pulse:" + t.day, async () => {
      try { const mv = await (await env.ROOM.get(env.ROOM.idFromName(PRICE_DO)).fetch(new Request("https://" + PRICE_DO + ".internal/_ph/movers?enrich=1"))).json(); return pulseDigest(mv); } catch { return null; }
    });
  }
  return out;
}

/* ---- public routes ------------------------------------------------------------- */
export async function servePush(request, env, url, ctx, o) {   // o.fetchFn: the push service call, for tests
  const p = url.pathname;
  const cors = { "access-control-allow-origin": SHOP, "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", ...noStore };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!env.ROOM) return json({ ok: false, error: "no storage" }, 503);
  if (p === "/alerts/key.json") { const v = (await doCall(env, "/_push/vapid")).vapid; return json({ ok: true, publicKey: v.publicKey, topics: TOPICS }, 200, cors); }
  if (p === "/alerts/health") { const h = await doCall(env, "/_push/health"); return json({ ...h, topics: Object.keys(TOPICS) }, 200, cors); }
  if (p === "/alerts/subscribe" && request.method === "POST") { const r = await doCall(env, "/_push/subscribe", await bodyOf(request)); return json(r, r.ok ? 200 : 400, cors); }
  if (p === "/alerts/unsubscribe" && request.method === "POST") { const r = await doCall(env, "/_push/unsubscribe", await bodyOf(request)); return json(r, r.ok ? 200 : 400, cors); }
  if (p === "/alerts/test" && request.method === "POST") {
    // a test notification to the subscription that asks for it (and only that one)
    const b = await bodyOf(request);
    const s = shapeSubscription(b);
    if (!s) return json({ ok: false, error: "subscribe first" }, 400, cors);
    const known = (await doCall(env, "/_push/get?endpoint=" + encodeURIComponent(s.endpoint))).sub;
    if (!known) return json({ ok: false, error: "that subscription is not on file; turn alerts on first" }, 404, cors);
    const vapid = (await doCall(env, "/_push/vapid?private=1")).vapid;
    try {
      const r = await sendPush(known, { title: "Exor Games alerts are on", body: "You will hear about " + ((known.topics || []).map((t) => TOPICS[t]).join(", ") || "nothing yet") + ".", url: SHOP + "/", tag: "test" }, vapid, o && o.fetchFn);
      if (r.gone) await doCall(env, "/_push/drop", { ids: [(await sha256hex(known.endpoint)).slice(0, 32)] });
      return json({ ok: r.status >= 200 && r.status < 300, status: r.status }, 200, cors);
    } catch (e) { return json({ ok: false, error: String((e && e.message) || e).slice(0, 160) }, 502, cors); }
  }
  if (p === "/alerts" || p === "/alerts/") {
    const r = await env.ASSETS.fetch(new Request(new URL("/alerts.html", url).toString(), request));
    return new Response(r.body, { status: r.status, headers: { "content-type": "text/html; charset=utf-8", ...noStore } });
  }
  return json({ ok: false, error: "no such path" }, 404);
}
