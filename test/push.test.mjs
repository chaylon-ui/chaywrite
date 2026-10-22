// Web push alerts (owner 2026-10-20, "do ... three"): the crypto, the store, the digests, the routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, decryptPayload, makeVapid, vapidAuth, sendPush, pushDoFetch, servePush, pushTick, digestsOf, pulseDigest, shapeSubscription, b64u, unb64u, TOPICS, PUSH_DO } from "../src/push.js";

const T0 = Date.UTC(2026, 9, 26, 13, 5, 0);   // Monday 2026-10-26 10:05 Atlantic (ADT)
const ORIGIN = "https://w.example";
class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
}
const cx = (clock) => ({ storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {} });
async function call(c, path, body) { const url = new URL(ORIGIN + path); const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url); return (await pushDoFetch(c, req, url)).json(); }

// A pretend browser: its own P-256 key pair and auth secret, as pushManager.subscribe() would make.
async function browser(endpoint) {
  const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys: k, pub, auth, subscription: { endpoint, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
const envWith = (c, extra) => ({ ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n !== PUSH_DO) return new Response("wrong store", { status: 404 }); return pushDoFetch(c, req, url); } }) }, ASSETS: { fetch: async () => new Response("<!doctype html><title>Alerts</title>", { headers: { "content-type": "text/html" } }) }, ...(extra || {}) });

test("base64url round-trips; a subscription is shaped only when it looks like one", async () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(unb64u(b64u(bytes)), bytes);
  assert.equal(b64u(new Uint8Array([251, 255])), "-_8");
  const b = await browser("https://fcm.googleapis.com/fcm/send/abcdefghij");
  assert.deepEqual(shapeSubscription({ subscription: b.subscription }), { endpoint: b.subscription.endpoint, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth });
  assert.equal(shapeSubscription({ subscription: { endpoint: "http://x", keys: b.subscription.keys } }), null, "https only");
  assert.equal(shapeSubscription({ endpoint: b.subscription.endpoint, keys: { p256dh: "short", auth: b.subscription.keys.auth } }), null);
  assert.equal(shapeSubscription({}), null);
});

test("encryptPayload: aes128gcm the browser can open; the header carries the salt, the record size and our ephemeral key", async () => {
  const b = await browser("https://updates.push.services.mozilla.com/wpush/v2/abcdefghijklmnop");
  const { body, salt, localPub } = await encryptPayload(b.subscription.keys.p256dh, b.subscription.keys.auth, JSON.stringify({ title: "Hi", body: "there" }));
  assert.equal(body.length, 16 + 4 + 1 + 65 + (JSON.stringify({ title: "Hi", body: "there" }).length + 1 + 16));
  assert.deepEqual(body.slice(0, 16), salt);
  assert.equal(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), 4096);
  assert.equal(body[20], 65); assert.deepEqual(body.slice(21, 86), localPub); assert.equal(localPub[0], 4, "uncompressed point");
  const plain = await decryptPayload(b.keys.privateKey, b.pub, b.subscription.keys.auth, body);
  assert.deepEqual(JSON.parse(plain), { title: "Hi", body: "there" });
  const other = await browser("https://x.example/y");
  await assert.rejects(decryptPayload(other.keys.privateKey, other.pub, other.subscription.keys.auth, body), "another browser cannot read it");
});

test("VAPID: an ES256 JWT for the push service's origin, verifiable with the public key; the k= is the raw public key", async () => {
  const v = await makeVapid();
  assert.match(v.publicKey, /^[A-Za-z0-9_-]{87}$/, "65 raw bytes");
  const auth = await vapidAuth(v, "https://fcm.googleapis.com/fcm/send/abc", T0);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
  assert.ok(m); assert.equal(m[2], v.publicKey);
  const [h, c, sig] = m[1].split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, "mailto:charlottetown@exorgames.com"); assert.equal(claims.exp, Math.floor(T0 / 1000) + 12 * 3600);
  const pub = await crypto.subtle.importKey("jwk", v.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(sig), new TextEncoder().encode(h + "." + c)), true);
  assert.equal(unb64u(sig).length, 64, "raw r||s, not DER");
});

test("sendPush: the request a push service expects; 404 / 410 mean the subscription is gone", async () => {
  const v = await makeVapid();
  const b = await browser("https://web.push.apple.com/QAbcdefghijklmnopqrstuvwxyz");
  const seen = [];
  const f = async (u, init) => { seen.push({ u, init }); return new Response(null, { status: 201 }); };
  const r = await sendPush({ ...b.subscription, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth }, { title: "New Pokémon arrivals: 3 today", body: "x", url: "https://exorgames.com/", tag: "new-pokemon" }, v, f, T0);
  assert.deepEqual(r, { status: 201, gone: false });
  assert.equal(seen[0].u, b.subscription.endpoint);
  const h = seen[0].init.headers;
  assert.equal(h["content-encoding"], "aes128gcm"); assert.equal(h["content-type"], "application/octet-stream"); assert.equal(h.ttl, "86400"); assert.equal(h.topic, "new-pokemon"); assert.match(h.authorization, /^vapid t=.+, k=/);
  assert.deepEqual(JSON.parse(await decryptPayload(b.keys.privateKey, b.pub, b.subscription.keys.auth, seen[0].init.body)), { title: "New Pokémon arrivals: 3 today", body: "x", url: "https://exorgames.com/", tag: "new-pokemon" });
  assert.deepEqual(await sendPush({ ...b.subscription, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth }, { title: "x" }, v, async () => new Response(null, { status: 410 })), { status: 410, gone: true });
});

test("DO: the key pair is made once; subscribe / update / unsubscribe; list by topic; digests remembered; health counts only", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const k1 = await call(c, "/_push/vapid"); const k2 = await call(c, "/_push/vapid");
  assert.equal(k1.vapid.publicKey, k2.vapid.publicKey); assert.equal(k1.vapid.privateJwk, undefined, "the private half stays inside unless asked");
  assert.ok((await call(c, "/_push/vapid?private=1")).vapid.privateJwk.d);
  const a = await browser("https://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa"), b = await browser("https://fcm.googleapis.com/fcm/send/bbbbbbbbbbbb");
  let r = await call(c, "/_push/subscribe", { subscription: a.subscription, topics: ["new-mtg", "pulse", "bogus"] });
  assert.equal(r.ok, true); assert.deepEqual(r.topics, ["new-mtg", "pulse"]); assert.equal(r.id.length, 32);
  await call(c, "/_push/subscribe", { subscription: b.subscription, topics: ["new-mtg"] });
  assert.equal((await call(c, "/_push/subscribe", { subscription: { endpoint: "nope" }, topics: [] })).ok, false);
  r = await call(c, "/_push/subscribe", { subscription: a.subscription, topics: ["new-pokemon"] });
  assert.deepEqual(r.topics, ["new-pokemon"], "the same endpoint updates its topics");
  assert.equal((await call(c, "/_push/list?topic=new-mtg")).subs.length, 1);
  assert.equal((await call(c, "/_push/list?topic=new-pokemon")).subs[0].endpoint, a.subscription.endpoint);
  assert.equal((await call(c, "/_push/list")).subs.length, 2);
  const g = await call(c, "/_push/get?endpoint=" + encodeURIComponent(b.subscription.endpoint));
  assert.equal(g.sub.p256dh, b.subscription.keys.p256dh);
  await call(c, "/_push/unsubscribe", { subscription: b.subscription });
  assert.equal((await call(c, "/_push/list")).subs.length, 1);
  await call(c, "/_push/drop", { ids: [r.id] });
  assert.equal((await call(c, "/_push/list")).subs.length, 0);
  await call(c, "/_push/sent", { key: "new-mtg:2026-10-26", n: 3 });
  assert.equal((await call(c, "/_push/sent?key=new-mtg:2026-10-26")).sent.n, 3);
  assert.equal((await call(c, "/_push/sent?key=other")).sent, null);
  const h = await call(c, "/_push/health");
  assert.equal(h.subscriptions, 0); assert.equal(h.vapid, true); assert.equal(h.lastSent[0].key, "new-mtg:2026-10-26");
  clock.t = T0 + 20 * 864e5;
  assert.deepEqual((await call(c, "/_push/sweep", {})).counts, { digests: 1 });
});

test("digests: one per game topic from the day's arrivals, dearest cards named; the Monday pulse from the movers", () => {
  const card = (title, key, price, sealed) => ({ title, price, game: { key, sealed: !!sealed }, image: "https://cdn.example/" + title + ".png", url: "https://exorgames.com/products/x" });
  const d = digestsOf([card("Charizard ex [Obsidian Flames]", "pokemon", 40), card("Pikachu", "pokemon", 5), card("Gengar", "pokemon", 12), card("Mew", "pokemon", 6), card("Sol Ring", "mtg", 3), card("Booster Box", "mtg", 150, true), card("Hockey card", "sports", 9)]);
  assert.deepEqual(d.map((x) => x.topic).sort(), ["new-mtg", "new-pokemon", "new-sealed"]);
  const pk = d.find((x) => x.topic === "new-pokemon");
  assert.equal(pk.title, "New Pokémon arrivals: 4 today"); assert.equal(pk.body, "Charizard ex, Gengar, Mew and 1 more · tap to see"); assert.equal(pk.count, 4); assert.equal(pk.icon, "https://cdn.example/Charizard ex [Obsidian Flames].png"); assert.equal(pk.url, "https://exorgames.com/#xg-newtoday");
  assert.deepEqual(digestsOf([]), []);
  const pulse = pulseDigest({ ready: true, w7: { risers: [{ id: "1", h: "charizard-ex", p: 44 }], fallers: [{ id: "2", h: "sol-ring", p: -70 }], counted: 12 }, detail: { 1: { title: "Charizard ex (199/165)" } } });
  assert.equal(pulse.title, "Market pulse: this week's movers"); assert.equal(pulse.body, "Charizard ex (199/165) +44% · sol ring -70% · 12 singles moved"); assert.equal(pulse.url, "https://exorgames.com/pulse");
  assert.equal(pulseDigest({ ready: false }), null); assert.equal(pulseDigest({ ready: true, w7: { risers: [], fallers: [] } }), null);
});

test("pushTick: in the ten o'clock window each digest goes to its subscribers once a day, gone subscriptions are dropped, Monday adds the pulse", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const calls = [];
  const fakeFetch = async (u) => { calls.push(u); return new Response(null, { status: u.includes("gone") ? 410 : 201 }); };
  const a = await browser("https://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa"), gone = await browser("https://fcm.googleapis.com/fcm/send/gone-gone-gone");
  await call(c, "/_push/subscribe", { subscription: a.subscription, topics: ["new-pokemon", "pulse"] });
  await call(c, "/_push/subscribe", { subscription: gone.subscription, topics: ["new-pokemon"] });
  // the price store answers the pulse; the default room answers today's arrivals (empty: pendingDrops needs the live store, so the test injects digests through pendingDrops' own inputs)
  const rooms = { push: c };
  const env = { SHOPIFY_ADMIN_TOKEN: "", ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n === "push") return pushDoFetch(c, req, url); if (n === "price-history") return Response.json({ ok: true, ready: true, w7: { risers: [{ id: "1", h: "charizard-ex", p: 44 }], fallers: [], counted: 3 }, detail: {} }); if (n === "default") return Response.json({ handles: [] }); return new Response("no", { status: 404 }); } }) } };
  assert.deepEqual(await pushTick(env, { now: Date.UTC(2026, 9, 26, 12, 0, 0), fetchFn: fakeFetch }), { skipped: "not the hour" }, "09:00 Atlantic: too early");
  let r = await pushTick(env, { now: T0, fetchFn: fakeFetch });
  assert.equal(r.day, "2026-10-26");
  assert.deepEqual(r.sent, [{ topic: "pulse", subscribers: 1, sent: 1, gone: 0, failed: 0 }], "Monday: the pulse went to its one subscriber; no arrivals today");
  assert.equal(calls.length, 1);
  r = await pushTick(env, { now: T0 + 5 * 60e3, fetchFn: fakeFetch });
  assert.deepEqual(r.sent, [], "five minutes later: already sent today");
  // a forced run on another day with a gone subscription: dropped
  r = await pushTick(env, { now: T0 + 864e5, fetchFn: fakeFetch, force: true });
  assert.equal(r.sent[0].topic, "pulse");
  assert.equal((await call(c, "/_push/list?topic=new-pokemon")).subs.length, 2, "nobody pushed new-pokemon yet (no arrivals), the gone one is still there");
  const dig = await (await import("../src/push.js")).deliver(env, { topic: "new-pokemon", title: "t", body: "b", url: "u", tag: "new-pokemon" }, { fetchFn: fakeFetch });
  assert.deepEqual(dig, { topic: "new-pokemon", subscribers: 2, sent: 1, gone: 1, failed: 0 });
  assert.equal((await call(c, "/_push/list?topic=new-pokemon")).subs.length, 1, "the 410 subscription was dropped");
  assert.equal(await pushTick({}), null);
});

test("routes: the page, the key, subscribe / unsubscribe / test, CORS for the store, junk refused", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const env = envWith(c);
  const pushed = [];
  const go = (path, body) => { const url = new URL(ORIGIN + path); const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url); return servePush(req, env, url, null, { fetchFn: async (u) => { pushed.push(u); return new Response(null, { status: 201 }); } }); };
  let r = await go("/alerts");
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/html/); assert.match(await r.text(), /Alerts/);
  r = await go("/alerts/key.json"); const k = await r.json();
  assert.match(k.publicKey, /^[A-Za-z0-9_-]{87}$/); assert.deepEqual(Object.keys(k.topics), Object.keys(TOPICS)); assert.equal(r.headers.get("access-control-allow-origin"), "https://exorgames.com");
  const b = await browser("https://fcm.googleapis.com/fcm/send/cccccccccccc");
  r = await go("/alerts/subscribe", { subscription: b.subscription, topics: ["new-sealed"] });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).topics, ["new-sealed"]);
  assert.equal((await go("/alerts/subscribe", { subscription: { endpoint: "junk" } })).status, 400);
  const other = await browser("https://fcm.googleapis.com/fcm/send/dddddddddddd");
  assert.equal((await go("/alerts/test", { subscription: other.subscription })).status, 404, "a test goes only to a subscription on file");
  r = await go("/alerts/test", { subscription: b.subscription });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, status: 201 }); assert.deepEqual(pushed, [b.subscription.endpoint], "the test goes to that one endpoint");
  r = await go("/alerts/health"); const h = await r.json();
  assert.equal(h.subscriptions, 1); assert.deepEqual(h.byTopic, { "new-sealed": 1 });
  assert.equal((await go("/alerts/unsubscribe", { subscription: b.subscription })).status, 200);
  assert.equal((await (await go("/alerts/health")).json()).subscriptions, 0);
  const url = new URL(ORIGIN + "/alerts/subscribe");
  assert.equal((await servePush(new Request(url, { method: "OPTIONS" }), env, url, null)).status, 204);
  assert.equal((await go("/alerts/nope")).status, 404);
});
