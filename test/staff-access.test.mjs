import { test } from "node:test";
import assert from "node:assert/strict";
import { stageDoFetch, serveStage, servePair, STAGE_DO } from "../src/stage.js";
import { hashPassword } from "../src/stage-auth.js";
import { staffAccess, staffGate, serveStaffMe, stripInternal, allows, INTERNAL_HEADER, _resetStaffCache } from "../src/staff-access.js";

// Owner, 2026-09-29: staff screens open with an account (2FA) instead of the PIN from the public
// repo. The PIN keeps working until an admin switches it off; the automation key is for runners.

class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return null; }
  async setAlarm() {}
  async deleteAlarm() {}
}
const PIN = "4321";
async function world() {
  _resetStaffCache();
  const clock = { skew: 0 };
  const cx = { storage: new MemStorage(), now: () => Date.now() + clock.skew, log: () => {}, mem: {} };
  const checks = [];
  const room = { fetch: async (req) => { const u = new URL(req.url); checks.push(u.pathname); return Response.json({ ok: u.searchParams.get("k") === PIN }); } };
  const env = { ROOM: { idFromName: (n) => n, get: (n) => (n === STAGE_DO ? { fetch: (req) => stageDoFetch(cx, req, new URL(req.url)) } : room) } };
  cx.env = env;
  const put = (path, body) => env.ROOM.get(STAGE_DO).fetch(new Request("https://w.example" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.json());
  const h = await hashPassword("password-1");
  await put("/_stage/user/put", { create: true, user: { email: "ada@x.test", name: "Ada", role: "admin", perms: {}, ...h } });
  await put("/_stage/user/put", { create: true, user: { email: "pat@x.test", name: "Pat", role: "staff", perms: { pickups: true }, ...h } });
  await put("/_stage/user/put", { create: true, user: { email: "vee@x.test", name: "Vee", role: "staff", perms: { edit: true }, ...h } });
  const tok = { ada: "a".repeat(64), pat: "b".repeat(64), vee: "c".repeat(64), old: "d".repeat(64) };
  await put("/_stage/session/put", { token: tok.ada, email: "ada@x.test", mfa: true });
  await put("/_stage/session/put", { token: tok.pat, email: "pat@x.test", mfa: true });
  await put("/_stage/session/put", { token: tok.vee, email: "vee@x.test", mfa: true });
  await put("/_stage/session/put", { token: tok.old, email: "ada@x.test" });   // before the emailed code: does not count
  return { env, cx, put, tok, checks, clock };
}
const req = (path, o) => {
  const headers = {};
  if (o && o.session) headers.cookie = "np_s=" + o.session;
  if (o && o.bearer) headers.authorization = "Bearer " + o.bearer;
  return new Request("https://w.example" + path, { headers });
};
const access = (w, path, perm, k, o) => { const r = req(path, o); return staffAccess(r, w.env, new URL(r.url), perm, k); };

test("an account opens the screens its permissions name, and nothing else", async () => {
  const w = await world();
  const pat = await access(w, "/pickups.json", "pickups", "", { session: w.tok.pat });
  assert.equal(pat.ok, true); assert.equal(pat.via, "account"); assert.equal(pat.who, "Pat");
  assert.equal((await access(w, "/portal/buylists.json", "portal", "", { session: w.tok.pat })).ok, false);
  assert.equal((await access(w, "/admin/page-edit.json", "admin", "", { session: w.tok.pat })).ok, false);
  assert.equal((await access(w, "/pickups.json", "pickups", "", { session: w.tok.vee })).ok, false, "a buylist-only account");
  for (const perm of ["pickups", "alerts", "tv", "portal", "decks", "admin"]) assert.equal((await access(w, "/x", perm, "", { session: w.tok.ada })).ok, true, "admin: " + perm);
  assert.equal((await access(w, "/x", "admin", "", { session: w.tok.old })).ok, false, "a session from before the emailed code");
  assert.equal((await access(w, "/x", ["alerts", "pickups"], "", { session: w.tok.pat })).ok, true, "any of a list");
  assert.equal(allows({ role: "admin", disabled: true }, "pickups"), false);
  assert.equal(w.checks.length, 0, "an account never touches the PIN");
});

test("the automation key: a long secret in the Authorization header, never a short one", async () => {
  const w = await world();
  w.env.STAFF_AUTOMATION_KEY = "k".repeat(40);
  const a = await access(w, "/9pocket.json", "admin", "", { bearer: "k".repeat(40) });
  assert.equal(a.ok, true); assert.equal(a.via, "automation");
  assert.equal((await access(w, "/9pocket.json", "admin", "", { bearer: "k".repeat(39) })).ok, false);
  assert.equal((await access(w, "/9pocket.json", "admin", "k".repeat(40))).ok, false, "not as ?k=");
  w.env.STAFF_AUTOMATION_KEY = "short-key";
  assert.equal((await access(w, "/9pocket.json", "admin", "", { bearer: "short-key" })).ok, false);
});

test("the old PIN works while it is on, is noted where it was used, and stops when an admin switches it off", async () => {
  const w = await world();
  const a = await access(w, "/pickups.json", "pickups", PIN);
  assert.equal(a.ok, true); assert.equal(a.via, "pin");
  assert.equal((await access(w, "/pickups.json", "pickups", "0000")).ok, false);
  await new Promise((r) => setTimeout(r, 5));
  const cfg = await w.env.ROOM.get(STAGE_DO).fetch(new Request("https://w.example/_stage/cfg")).then((r) => r.json());
  assert.ok(cfg.pinUse["/pickups.json"] > 0, "noted");
  assert.equal(cfg.pinOff, false);
  // switched off from the admin page (an admin account)
  const url = new URL("https://w.example/9pocket/admin/control");
  const r = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "np_s=" + w.tok.ada }, body: "action=pin-off" }), w.env, url, async () => false);
  assert.equal(r.status, 303); assert.match(decodeURIComponent(r.headers.get("location").replace(/\+/g, " ")), /PIN is off/);
  _resetStaffCache();
  const before = w.checks.length;
  assert.equal((await access(w, "/pickups.json", "pickups", PIN)).ok, false, "the right PIN, switched off");
  assert.equal(w.checks.length, before, "not even asked");
  assert.equal((await access(w, "/pickups.json", "pickups", "", { session: w.tok.pat })).ok, true, "accounts carry on");
  // a staff account cannot flip it
  const r2 = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "np_s=" + w.tok.pat }, body: "action=pin-on" }), w.env, url, async () => false);
  assert.equal(r2.status, 403);
  // and it comes back on
  await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "np_s=" + w.tok.ada }, body: "action=pin-on" }), w.env, url, async () => false);
  _resetStaffCache();
  assert.equal((await access(w, "/pickups.json", "pickups", PIN)).ok, true);
});

test("the admin page shows the switch and what still used the PIN", async () => {
  const w = await world();
  await access(w, "/pickups.json", "pickups", PIN);
  await access(w, "/ws", "alerts", PIN, {});
  await new Promise((r) => setTimeout(r, 5));
  const url = new URL("https://w.example/9pocket/admin");
  const html = await (await serveStage(new Request(url, { headers: { cookie: "np_s=" + w.tok.ada } }), w.env, url, async () => false)).text();
  assert.ok(html.includes("Old staff PIN") && html.includes(">ON<") && html.includes("Switch the PIN off"));
  assert.ok(html.includes("the /pickups page, the POS tile or the BinderPOS add-on"));
  assert.ok(html.includes("Store screens") && html.includes('name="perm_pickups"'));
});

test("staffGate keeps the old staffOk(env, origin, k) shape", async () => {
  const w = await world();
  const r = req("/portal/buylists.json", { session: w.tok.ada });
  assert.equal(await staffGate(r, w.env, new URL(r.url), "portal")(w.env, "https://w.example", ""), true);
  const r2 = req("/portal/buylists.json");
  assert.equal(await staffGate(r2, w.env, new URL(r2.url), "portal")(w.env, "https://w.example", PIN), true);
  assert.equal(await staffGate(r2, w.env, new URL(r2.url), "portal")(w.env, "https://w.example", ""), false);
});

test("/staff/me.json: what a page shows before asking for anything", async () => {
  const w = await world();
  const me = async (o, perm) => { const r = req("/staff/me.json?perm=" + perm + "&next=%2Fpickups", o); return (await serveStaffMe(r, w.env, new URL(r.url))).json(); };
  assert.deepEqual(await me({ session: w.tok.pat }, "pickups"), { signedIn: true, name: "Pat", email: "pat@x.test", allowed: true, perm: "pickups", pinOn: true, login: "/9pocket/login?next=%2Fpickups" });
  const no = await me({ session: w.tok.pat }, "tv");
  assert.equal(no.allowed, false); assert.equal(no.signedIn, true);
  const anon = await me({}, "pickups");
  assert.equal(anon.signedIn, false); assert.equal(anon.allowed, false); assert.equal(anon.pinOn, true);
  assert.equal((await me({ session: w.tok.pat }, "nonsense")).perm, "admin", "unknown screens ask for admin");
});

test("the internal header never comes in from outside", () => {
  const r = stripInternal(new Request("https://w.example/admin/api", { method: "POST", headers: { [INTERNAL_HEADER]: "1", "content-type": "application/json" }, body: "{}" }));
  assert.equal(r.headers.get(INTERNAL_HEADER), null);
  assert.equal(r.headers.get("content-type"), "application/json");
  const plain = new Request("https://w.example/x");
  assert.equal(stripInternal(plain), plain);
});

test("sign-in may return to a staff screen, never off the site", async () => {
  const w = await world();
  const url = new URL("https://w.example/9pocket/login?next=%2Fpickups");
  const page = await (await serveStage(new Request(url), w.env, url, async () => false)).text();
  assert.ok(page.includes('name="next" value="/pickups"'));
  for (const bad of ["//evil.example/", "/pickupsX", "/staff\"><script>", "https://evil.example/staff"]) {
    const u = new URL("https://w.example/9pocket/login?next=" + encodeURIComponent(bad));
    const t = await (await serveStage(new Request(u), w.env, u, async () => false)).text();
    assert.ok(t.includes('name="next" value="/9pocket"'), bad);
  }
  const tv = new URL("https://w.example/9pocket/login?next=" + encodeURIComponent("/tv?room=sports&remote=1"));
  assert.ok((await (await serveStage(new Request(tv), w.env, tv, async () => false)).text()).includes('value="/tv?room=sports&amp;remote=1"'));
});

// ---------- till devices and services ----------
const adminPost = async (w, body) => {
  const url = new URL("https://w.example/9pocket/admin/control");
  const r = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "np_s=" + w.tok.ada }, body: new URLSearchParams(body).toString() }), w.env, url, async () => false);
  return { status: r.status, location: decodeURIComponent(String(r.headers.get("location") || "").replace(/\+/g, " ")), text: await r.text() };
};
const pair = async (w, path, body, method) => {
  const url = new URL("https://w.example" + path);
  const init = method === "OPTIONS" ? { method } : body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
  const r = await servePair(new Request(url, init), w.env, url);
  return { status: r.status, cors: r.headers.get("access-control-allow-origin"), j: r.status === 204 ? null : await r.json().catch(() => null) };
};

test("pairing: the device shows a code, an admin types it, the device gets its own key once", async () => {
  const w = await world();
  const st = await pair(w, "/device/pair/start", { kind: "pos-tile" });
  assert.equal(st.status, 200); assert.equal(st.cors, "*");
  assert.match(st.j.code, /^[ACDEFGHJKMNPQRTUVWXY34679]{3}-[ACDEFGHJKMNPQRTUVWXY34679]{3}$/);
  assert.match(st.j.id, /^[0-9a-f]{64}$/);
  assert.equal((await pair(w, "/device/pair/poll?id=" + st.j.id)).j.status, "waiting");
  // a wrong code, a staff account: refused
  assert.match((await adminPost(w, { action: "device-pair", code: "AAA-AAA", name: "x", perm_pickups: "on" })).location, /No device is showing that code/);
  const url = new URL("https://w.example/9pocket/admin/control");
  const staff = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "np_s=" + w.tok.pat }, body: "action=device-pair&code=" + st.j.code }), w.env, url, async () => false);
  assert.equal(staff.status, 403);
  // no permission ticked: refused; then the admin pairs it (lower case, no dash is fine)
  assert.match((await adminPost(w, { action: "device-pair", code: st.j.code, name: "Front iPad" })).location, /Tick at least one/);
  const ok = await adminPost(w, { action: "device-pair", code: st.j.code.replace("-", "").toLowerCase(), name: "Front iPad", perm_pickups: "on" });
  assert.match(ok.location, /Paired Front iPad/);
  const got = await pair(w, "/device/pair/poll?id=" + st.j.id);
  assert.equal(got.j.status, "approved"); assert.match(got.j.key, /^[0-9a-f]{64}$/); assert.equal(got.j.name, "Front iPad");
  assert.equal((await pair(w, "/device/pair/poll?id=" + st.j.id)).j.status, "expired", "handed over once");
  // only the hash is kept
  const stored = [...(await w.cx.storage.list({ prefix: "dk:" })).entries()];
  assert.equal(stored.length, 1); assert.ok(!JSON.stringify(stored).includes(got.j.key));
  // the key opens pickups (as ?dk= or the header), nothing else, never admin; its use is noted
  const dev = (path, perm, how) => { const r = new Request("https://w.example" + path + (how === "header" ? "" : (path.includes("?") ? "&" : "?") + "dk=" + got.j.key), how === "header" ? { headers: { "x-exor-device": got.j.key } } : {}); return staffAccess(r, w.env, new URL(r.url), perm, ""); };
  const a = await dev("/pickups.json", "pickups");
  assert.equal(a.ok, true); assert.equal(a.via, "device"); assert.equal(a.who, "Front iPad");
  assert.equal((await dev("/pickups.json", "pickups", "header")).ok, true);
  assert.equal((await dev("/portal/buylists.json", "portal")).ok, false);
  assert.equal((await dev("/admin/page-edit.json", "admin")).ok, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(stored[0] && (await w.cx.storage.get(stored[0][0])).used > 0, "last used noted");
  // the admin page lists it; revoke it and it stops (after the isolate cache)
  const page = await serveStage(new Request("https://w.example/9pocket/admin", { headers: { cookie: "np_s=" + w.tok.ada } }), w.env, new URL("https://w.example/9pocket/admin"), async () => false);
  const html = await page.text();
  assert.ok(html.includes("Front iPad") && html.includes("POS tablet") && html.includes("Devices and services"));
  const id = html.match(/name="id" value="([0-9a-f]{16})"/)[1];
  assert.match((await adminPost(w, { action: "device-revoke", id })).location, /Revoked Front iPad/);
  _resetStaffCache();
  assert.equal((await dev("/pickups.json", "pickups")).ok, false);
});

test("pairing codes expire after 10 minutes, and at most 20 devices wait at once", async () => {
  const w = await world();
  const st = await pair(w, "/device/pair/start", { kind: "binderpos-addon" });
  w.clock.skew = 10 * 60e3 + 1;
  assert.match((await adminPost(w, { action: "device-pair", code: st.j.code, perm_pickups: "on" })).location, /No device is showing that code/);
  assert.equal((await pair(w, "/device/pair/poll?id=" + st.j.id)).j.status, "expired");
  w.clock.skew = 0;
  for (let i = 0; i < 20; i++) assert.equal((await pair(w, "/device/pair/start", { kind: "other" })).status, 200);
  const full = await pair(w, "/device/pair/start", {});
  assert.equal(full.status, 429); assert.equal(full.cors, "*");
  w.clock.skew = 10 * 60e3 + 1;
  assert.equal((await pair(w, "/device/pair/start", {})).status, 200, "expired ones make room");
  const pre = await pair(w, "/device/pair/start", null, "OPTIONS");
  assert.equal(pre.status, 200); assert.equal(pre.cors, "*");
});

test("a service key (Shopify Flow) is shown once, on the page, never in a URL, and opens only what was ticked", async () => {
  const w = await world();
  const r = await adminPost(w, { action: "device-create", name: "Shopify Flow order alerts", perm_alerts: "on" });
  assert.equal(r.status, 200, "rendered, not redirected");
  const key = r.text.match(/user-select:all;word-break:break-all;font-size:13px">([0-9a-f]{64})</)[1];
  assert.ok(r.text.includes("https://w.example/alert?dk=" + key));
  const req2 = new Request("https://w.example/alert?dk=" + key, { method: "POST" });
  const a = await staffAccess(req2, w.env, new URL(req2.url), "alerts", "");
  assert.equal(a.ok, true); assert.equal(a.who, "Shopify Flow order alerts");
  assert.equal((await staffAccess(req2, w.env, new URL(req2.url), "pickups", "")).ok, false);
  // the page afterwards no longer shows it
  const again = await (await serveStage(new Request("https://w.example/9pocket/admin", { headers: { cookie: "np_s=" + w.tok.ada } }), w.env, new URL("https://w.example/9pocket/admin"), async () => false)).text();
  assert.ok(!again.includes(key) && again.includes("Shopify Flow order alerts"));
});
