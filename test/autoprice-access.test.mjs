import { test } from "node:test";
import assert from "node:assert/strict";
import { stageDoFetch } from "../src/stage.js";
import { autopriceDoFetch, serveAutoprice, AUTOPRICE_DO } from "../src/autoprice.js";
import { STAGE_DO } from "../src/stage.js";
import { hashPassword } from "../src/stage-auth.js";
import { serveStage } from "../src/stage.js";

// The worker with both rooms in memory: env.ROOM hands back a stub whose
// fetch runs the right DO handler, so serveAutoprice is exercised end to
// end - 9Pocket session cookie in, page or refusal out.
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const now = { t: 1_760_000_000_000 };
function world() {
  const rooms = {};
  const env = { ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => {
    const url = new URL(req.url);
    const cx = rooms[n] || (rooms[n] = { storage: new MemStorage(), env, now: () => now.t, log: () => {}, mem: {} });
    return n === STAGE_DO ? stageDoFetch(cx, req, url) : autopriceDoFetch(cx, req, url);
  } }) } };
  return { env, rooms };
}
const TOKEN = "a".repeat(64), TOKEN2 = "b".repeat(64), TOKEN3 = "c".repeat(64);
async function seed(w) {
  const stage = w.env.ROOM.get(STAGE_DO);
  const put = (path, body) => stage.fetch(new Request("https://w.example" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.json());
  const h = await hashPassword("password-1");
  await put("/_stage/user/put", { create: true, user: { email: "admin@x.test", name: "Ada", role: "admin", perms: {}, ...h } });
  await put("/_stage/user/put", { create: true, user: { email: "sam@x.test", name: "Sam", role: "staff", perms: { ap_publish: true }, limits: { apMaxDropPct: 10, apMaxRaisePct: null }, ...h } });
  await put("/_stage/user/put", { create: true, user: { email: "vee@x.test", name: "Vee", role: "staff", perms: { edit: true }, ...h } });
  await put("/_stage/session/put", { token: TOKEN, email: "admin@x.test" });
  await put("/_stage/session/put", { token: TOKEN2, email: "sam@x.test" });
  await put("/_stage/session/put", { token: TOKEN3, email: "vee@x.test" });
  // one staged row in the auto-pricer's report: $100 today, $80 suggested
  const ap = w.rooms[AUTOPRICE_DO] || (await w.env.ROOM.get(AUTOPRICE_DO).fetch(new Request("https://w.example/_ap/status")), w.rooms[AUTOPRICE_DO]);
  await ap.storage.put("ap:report", { at: now.t, rows: [{ id: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/11", title: "Box A", handle: "box-a", type: "Sealed", game: "Magic", current: 100, suggested: 80, awaiting: true, action: "lower", reason: "market", stock: 2, variants: 1 }] });
}
const staffOk = async () => false;
async function hit(w, path, o) {
  const init = { method: o && o.form !== undefined ? "POST" : "GET", headers: {} };
  if (o && o.cookie) init.headers.cookie = o.cookie;
  if (o && o.form !== undefined) { init.headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(o.form).toString(); }
  if (o && o.json !== undefined) { init.method = "POST"; init.headers["content-type"] = "application/json"; init.body = JSON.stringify(o.json); }
  const url = new URL("https://w.example" + path);
  const r = await serveAutoprice(new Request(url, init), w.env, url, staffOk);
  return { status: r.status, location: r.headers.get("location"), text: await r.text() };
}

test("the auto-pricer opens for 9Pocket accounts by their permissions: admin everything, staff inside their limits, a buylist-only account not at all", async () => {
  const w = world();
  await seed(w);
  // nobody: to the login page, which offers the 9Pocket sign-in
  const anon = await hit(w, "/autoprice");
  assert.equal(anon.status, 303); assert.equal(anon.location, "/autoprice/login");
  assert.ok((await hit(w, "/autoprice/login")).text.includes('href="/9pocket/login?next=%2Fautoprice"'));
  // a buylist-only account: a clear refusal, never the page
  const vee = await hit(w, "/autoprice", { cookie: "np_s=" + TOKEN3 });
  assert.equal(vee.status, 403); assert.ok(vee.text.includes("vee@x.test") && vee.text.includes("no auto-pricing permission"));
  assert.equal((await hit(w, "/autoprice/control", { cookie: "np_s=" + TOKEN3, json: { action: "mode", mode: "apply" } })).status, 403);
  // admin: the whole page, and a mode change goes through and is recorded
  const ada = await hit(w, "/autoprice", { cookie: "np_s=" + TOKEN });
  assert.equal(ada.status, 200); assert.ok(ada.text.includes("Signed in as <b>Ada</b>") && ada.text.includes("Run now") && ada.text.includes('value="publish-all"'));
  const mode = await hit(w, "/autoprice/control", { cookie: "np_s=" + TOKEN, form: { action: "mode", mode: "shadow" } });
  assert.equal(mode.status, 303); assert.ok(!/flash=/.test(mode.location));
  // staff who may publish, capped at a 10% drop: the page says so and the room refuses the $80
  const sam = await hit(w, "/autoprice", { cookie: "np_s=" + TOKEN2 });
  assert.equal(sam.status, 200);
  assert.ok(sam.text.includes("Signed in as <b>Sam</b>") && sam.text.includes("drop at most 10%") && !sam.text.includes("Run now") && !sam.text.includes('value="remove"'));
  assert.ok(sam.text.includes("over your 10% limit"));
  const pub = await hit(w, "/autoprice/control", { cookie: "np_s=" + TOKEN2, json: { action: "publish", id: "gid://shopify/Product/1", price: "80" } });
  const j = JSON.parse(pub.text);
  assert.equal(j.ok, false); assert.ok(/20% drop; your account may drop a price by at most 10%/.test(j.error));
  const all = JSON.parse((await hit(w, "/autoprice/control", { cookie: "np_s=" + TOKEN2, json: { action: "publish-all" } })).text);
  assert.deepEqual({ published: all.published, overLimit: all.overLimit, failed: all.failed }, { published: 0, overLimit: 1, failed: 0 });
  const denied = await hit(w, "/autoprice/control", { cookie: "np_s=" + TOKEN2, form: { action: "run" } });
  assert.equal(denied.status, 303); assert.ok(/flash=Your\+account\+may\+not\+do\+that/.test(denied.location.replace(/%20/g, "+")) || /may%20not%20do%20that/.test(denied.location));
  // the activity table shows the admin's mode change under her name
  const after = await hit(w, "/autoprice", { cookie: "np_s=" + TOKEN });
  assert.ok(after.text.includes("<h2>Activity</h2>") && after.text.includes("<td>Ada</td><td>mode → shadow</td>"));
  // the row is still waiting: nothing was written
  const rep = await w.env.ROOM.get(AUTOPRICE_DO).fetch(new Request("https://w.example/_ap/report")).then((r) => r.json());
  assert.equal(rep.rows[0].awaiting, true); assert.equal(rep.rows[0].current, 100);
});

test("9Pocket sign-in still works and can land on the auto-pricer (the helpers a refactor once dropped)", async () => {
  const w = world();
  await seed(w);
  const url = new URL("https://w.example/9pocket/login");
  const r = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "sam@x.test", password: "password-1", next: "/autoprice" }).toString() }), w.env, url, staffOk);
  assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/autoprice");
  const cookie = String(r.headers.get("set-cookie") || "");
  const m = cookie.match(/np_s=([0-9a-f]{64})/);
  assert.ok(m, "a session cookie");
  const page = await hit(w, "/autoprice", { cookie: "np_s=" + m[1] });
  assert.equal(page.status, 200); assert.ok(page.text.includes("Signed in as <b>Sam</b>"));
  const bad = await serveStage(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "sam@x.test", password: "wrong" }).toString() }), w.env, url, staffOk);
  assert.equal(bad.status, 403);
  const list = new URL("https://w.example/9pocket");
  const lr = await serveStage(new Request(list, { headers: { cookie: "np_s=" + m[1] } }), w.env, list, staffOk);
  assert.equal(lr.status, 200); assert.ok((await lr.text()).includes('href="/autoprice"'));
});
