import { test } from "node:test";
import assert from "node:assert/strict";
import { stageDoFetch, serveStage, currentUser, STAGE_DO } from "../src/stage.js";
import { hashPassword, newCode, maskEmail, deviceTokens } from "../src/stage-auth.js";
import { buildCodeEmail } from "../src/stage-email.js";

// Staff sign-in, second step (owner, 2026-09-29: username and password with 2FA, one login per
// person, the code by email): password -> a 6-digit code to the account's own address -> session.

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const clock = { t: 1_760_000_000_000 };
async function world() {
  const cx = { storage: new MemStorage(), now: () => clock.t, log: () => {}, mem: {} };
  const env = { RESEND_API_KEY: "test-key", ROOM: { idFromName: (n) => n, get: () => ({ fetch: (req) => stageDoFetch(cx, req, new URL(req.url)) }) } };
  cx.env = env;
  const mail = [];
  let mailFails = false;
  const fetchFn = async (u, init) => {
    if (mailFails) return new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 });
    mail.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "m" + mail.length }), { status: 200 });
  };
  const put = (path, body) => env.ROOM.get().fetch(new Request("https://w.example" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.json());
  const h = await hashPassword("password-1");
  await put("/_stage/user/put", { create: true, user: { email: "sam@x.test", name: "Sam Smith", role: "staff", perms: { edit: true }, ...h } });
  await put("/_stage/user/put", { create: true, user: { email: "ada@x.test", name: "Ada", role: "admin", perms: {}, ...h } });
  return { cx, env, mail, fetchFn, put, failMail: (v) => { mailFails = v; } };
}
const staffOk = async () => false;
const lastCode = (w) => w.mail[w.mail.length - 1].subject.match(/^(\d{6}) /)[1];
function cookiesOf(r) {
  const out = {};
  const all = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
  for (const c of all) { const m = String(c).match(/^([^=]+)=([^;]*)/); if (m) out[m[1]] = m[2]; }
  return out;
}
async function post(w, path, form, cookie) {
  const url = new URL("https://w.example" + path);
  const headers = { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1" };
  if (cookie) headers.cookie = cookie;
  const r = await serveStage(new Request(url, { method: "POST", headers, body: new URLSearchParams(form).toString() }), w.env, url, staffOk, { fetchFn: w.fetchFn });
  return { status: r.status, location: r.headers.get("location"), cookies: cookiesOf(r), text: await r.text() };
}
const password = (w, email, cookie, next) => post(w, "/9pocket/login", { email, password: "password-1", ...(next ? { next } : {}) }, cookie);
const code = (w, cid, c, extra, cookie) => post(w, "/9pocket/login/code", { code: c, ...(extra || {}) }, "np_c=" + cid + (cookie ? "; " + cookie : ""));

test("the password alone no longer signs in: it emails a code to the account's own address", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  assert.equal(r.status, 200);
  assert.ok(!r.cookies.np_s, "no session yet");
  assert.match(r.cookies.np_c, /^[0-9a-f]{64}$/);
  assert.ok(r.text.includes("sa•••@x.test") && r.text.includes('autocomplete="one-time-code"'));
  assert.equal(w.mail.length, 1);
  const m = w.mail[0];
  assert.deepEqual(m.to, ["sam@x.test"]);
  assert.equal(m.reply_to, undefined, "internal mail: no reply-to");
  assert.match(m.subject, /^\d{6} is your Exor Games staff sign-in code$/);
  assert.ok(m.text.includes("Hi Sam,") && m.text.includes("iPhone · Safari") && m.text.includes("Not you?"));
  // the code is only in the email, never in the page or the cookie
  assert.ok(!r.text.includes(lastCode(w)) && !r.cookies.np_c.includes(lastCode(w)));
  // a wrong password emails nothing
  const bad = await post(w, "/9pocket/login", { email: "sam@x.test", password: "nope" });
  assert.equal(bad.status, 403); assert.equal(w.mail.length, 1);
});

test("the right code signs in (a session that counts) and lands on next; the code works once", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test", "", "/autoprice");
  const ok = await code(w, r.cookies.np_c, lastCode(w), { next: "/autoprice" });
  assert.equal(ok.status, 303); assert.equal(ok.location, "/autoprice");
  assert.match(ok.cookies.np_s, /^[0-9a-f]{64}$/);
  assert.equal(ok.cookies.np_c, "", "the challenge cookie is cleared");
  const me = await currentUser(new Request("https://w.example/9pocket", { headers: { cookie: "np_s=" + ok.cookies.np_s } }), w.env, "https://w.example");
  assert.equal(me.email, "sam@x.test");
  assert.equal(me.hash, undefined);
  const again = await code(w, r.cookies.np_c, lastCode(w));
  assert.equal(again.status, 303); assert.match(again.location, /^\/9pocket\/login\?err=/);
  // next cannot point off the site
  const r2 = await password(w, "sam@x.test", "", "https://evil.example/");
  const ok2 = await code(w, r2.cookies.np_c, lastCode(w), { next: "https://evil.example/" });
  assert.equal(ok2.location, "/9pocket");
});

test("five wrong codes end the sign-in; spaces in a typed code are fine", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  const right = lastCode(w), wrong = right === "000000" ? "111111" : "000000";
  for (let i = 1; i <= 4; i++) {
    const x = await code(w, r.cookies.np_c, wrong);
    assert.equal(x.status, 403); assert.ok(x.text.includes((5 - i) + " tr"), "tries left shown");
  }
  const fifth = await code(w, r.cookies.np_c, wrong);
  assert.equal(fifth.status, 303); assert.match(decodeURIComponent(fifth.location.replace(/\+/g, " ")), /Too many wrong codes/);
  const late = await code(w, r.cookies.np_c, right);
  assert.equal(late.status, 303); assert.ok(!late.cookies.np_s, "even the right code is refused now");
  const r2 = await password(w, "sam@x.test");
  const c = lastCode(w);
  const spaced = await code(w, r2.cookies.np_c, c.slice(0, 3) + " " + c.slice(3));
  assert.equal(spaced.status, 303); assert.ok(spaced.cookies.np_s);
});

test("a code expires after 10 minutes", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  const c = lastCode(w);
  clock.t += 10 * 60e3 + 1;
  const x = await code(w, r.cookies.np_c, c);
  assert.equal(x.status, 303); assert.match(decodeURIComponent(x.location), /expired/);
  assert.ok(!x.cookies.np_s);
});

test("a new code: not within 30 seconds, then it replaces the old one; five codes per sign-in", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  const first = lastCode(w);
  const soon = await code(w, r.cookies.np_c, "", { resend: "1" });
  assert.equal(soon.status, 429); assert.equal(w.mail.length, 1);
  clock.t += 31e3;
  const re = await code(w, r.cookies.np_c, "", { resend: "1" });
  assert.equal(re.status, 200); assert.ok(re.text.includes("A new code is on its way")); assert.equal(w.mail.length, 2);
  const second = lastCode(w);
  if (first !== second) assert.equal((await code(w, r.cookies.np_c, first)).status, 403, "the old code is dead");
  for (let i = 0; i < 3; i++) { clock.t += 31e3; await code(w, r.cookies.np_c, "", { resend: "1" }); }
  assert.equal(w.mail.length, 5);
  clock.t += 31e3;
  const sixth = await code(w, r.cookies.np_c, "", { resend: "1" });
  assert.equal(sixth.status, 429); assert.equal(w.mail.length, 5);
  assert.equal((await code(w, r.cookies.np_c, lastCode(w))).status, 303);
});

test("remember this device: the next sign-in on this browser skips the code; another account still gets one", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  const ok = await code(w, r.cookies.np_c, lastCode(w), { remember: "1" });
  const dev = ok.cookies.np_d;
  assert.match(dev, /^[0-9a-f]{64}$/);
  const mailed = w.mail.length;
  const again = await password(w, "sam@x.test", "np_d=" + dev);
  assert.equal(again.status, 303); assert.ok(again.cookies.np_s); assert.equal(w.mail.length, mailed, "no code emailed");
  // the same browser, another account: a code, and afterwards the cookie remembers both
  const ada = await password(w, "ada@x.test", "np_d=" + dev);
  assert.equal(ada.status, 200); assert.equal(w.mail.length, mailed + 1);
  const ada2 = await code(w, ada.cookies.np_c, lastCode(w), { remember: "1" }, "np_d=" + dev);
  const both = ada2.cookies.np_d.split(".");
  assert.equal(both.length, 2); assert.equal(both[1], dev);
  assert.equal((await password(w, "sam@x.test", "np_d=" + ada2.cookies.np_d)).status, 303);
  assert.equal((await password(w, "ada@x.test", "np_d=" + ada2.cookies.np_d)).status, 303);
  // unticked: nothing remembered
  const r3 = await password(w, "sam@x.test");
  const no = await code(w, r3.cookies.np_c, lastCode(w));
  assert.equal(no.cookies.np_d, undefined);
  // a remembered device still needs the password
  assert.equal((await post(w, "/9pocket/login", { email: "sam@x.test", password: "nope" }, "np_d=" + dev)).status, 403);
  // and it lapses after 30 days
  clock.t += 30 * 86400e3 + 1;
  assert.equal((await password(w, "sam@x.test", "np_d=" + dev)).status, 200);
});

test("a new password or a disabled account: signed out everywhere, remembered devices forgotten", async () => {
  const w = await world();
  const r = await password(w, "sam@x.test");
  const ok = await code(w, r.cookies.np_c, lastCode(w), { remember: "1" });
  const who = () => currentUser(new Request("https://w.example/9pocket", { headers: { cookie: "np_s=" + ok.cookies.np_s } }), w.env, "https://w.example");
  assert.ok(await who());
  await w.put("/_stage/user/put", { user: { email: "sam@x.test", name: "Sam Smith" } });
  assert.ok(await who(), "a name change keeps the session");
  await w.put("/_stage/user/put", { user: { email: "sam@x.test", ...(await hashPassword("password-1")) } });
  assert.equal(await who(), null, "a new password ends the session");
  assert.equal((await password(w, "sam@x.test", "np_d=" + ok.cookies.np_d)).status, 200, "and the device must take a code again");
});

test("limits: eight sign-ins a quarter hour per address; a mail failure says so and signs nobody in", async () => {
  const w = await world();
  for (let i = 0; i < 8; i++) assert.equal((await password(w, "sam@x.test")).status, 200);
  const ninth = await password(w, "sam@x.test");
  assert.equal(ninth.status, 429); assert.ok(ninth.text.includes("Too many sign-in codes"));
  assert.equal((await password(w, "ada@x.test")).status, 200, "per address");
  clock.t += 15 * 60e3 + 1;
  assert.equal((await password(w, "sam@x.test")).status, 200);
  w.failMail(true);
  const f = await password(w, "ada@x.test");
  assert.equal(f.status, 502); assert.ok(f.text.includes("could not be emailed")); assert.ok(!f.cookies.np_s && !f.cookies.np_c);
  // no email set up on the worker at all: the same, never a way round the code
  w.failMail(false); delete w.env.RESEND_API_KEY;
  const n = await password(w, "ada@x.test");
  assert.equal(n.status, 502); assert.ok(!n.cookies.np_s);
});

test("helpers: codes are six digits, addresses masked, the device cookie parsed", () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^\d{6}$/);
  assert.equal(maskEmail("chaylon@exorgames.com"), "ch•••@exorgames.com");
  const t1 = "a".repeat(64), t2 = "b".repeat(64);
  assert.deepEqual(deviceTokens(new Request("https://w.example/", { headers: { cookie: "np_d=" + t1 + ".junk." + t2 } })), [t1, t2]);
  const e = buildCodeEmail({ code: "123456", name: "", device: "Mac · Chrome", when: new Date(Date.UTC(2026, 8, 29, 20, 5)) });
  assert.ok(e.subject.startsWith("123456 ") && e.text.includes("Hi,") && e.text.includes("5:05") && e.html.includes("123456"));
});
