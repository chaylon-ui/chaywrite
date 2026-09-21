import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, newToken, parseCookies, sessionCookie, clearCookie, publicUser, can, permsFrom, limitsFrom, apPerms, normEmail, validEmail, COOKIE } from "../src/stage-auth.js";

test("a password verifies against its own hash and nothing else; the hash is never the password", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(h.hash && h.salt && h.iter === 100000);
  assert.ok(!h.hash.includes("horse"));
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("correct horse battery ", h), false);
  assert.equal(await verifyPassword("", h), false);
  assert.equal(await verifyPassword("x", null), false);
  const h2 = await hashPassword("correct horse battery");
  assert.notEqual(h.hash, h2.hash);   // fresh salt every time
});

test("tokens are 64 hex chars and cookies round-trip", () => {
  const t = newToken();
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.notEqual(t, newToken());
  const c = sessionCookie(t, 100);
  assert.ok(c.startsWith(COOKIE + "=" + t + ";") && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Max-Age=100/.test(c));
  assert.match(clearCookie(), /Max-Age=0/);
  const req = new Request("https://w.example/", { headers: { cookie: "a=1; " + COOKIE + "=" + t + "; b=x=y" } });
  const j = parseCookies(req);
  assert.equal(j[COOKIE], t);
  assert.equal(j.b, "x=y");
  assert.deepEqual(parseCookies(new Request("https://w.example/")), {});
});

test("public users carry no hash; admins can do everything, staff only what they were given, disabled nothing", () => {
  const u = { email: "a@b.co", name: "A", role: "staff", perms: { edit: true, prices: false }, hash: "h", salt: "s", iter: 1 };
  const p = publicUser(u);
  assert.ok(!("hash" in p) && !("salt" in p) && !("iter" in p));
  assert.equal(p.email, "a@b.co");
  assert.equal(can(u, "edit"), true);
  assert.equal(can(u, "prices"), false);
  assert.equal(can(u, "approve"), false);
  assert.equal(can({ role: "admin" }, "approve"), true);
  assert.equal(can({ role: "admin", disabled: true }, "approve"), false);
  assert.equal(can(null, "edit"), false);
});

test("permissions come from form checkboxes or a list", () => {
  const none = { edit: false, prices: false, add: false, approve: false, email: false, ap_view: false, ap_publish: false, ap_settings: false, ap_config: false };
  assert.deepEqual(permsFrom({ perm_edit: "on", perm_prices: "on" }), { ...none, edit: true, prices: true });
  assert.deepEqual(permsFrom({ perms: ["add", "email", "ap_publish"] }), { ...none, add: true, email: true, ap_publish: true });
  assert.deepEqual(permsFrom({}), none);
});

test("auto-pricing limits: percent fields, blank or nonsense means no limit, clamped", () => {
  assert.deepEqual(limitsFrom({ apMaxDropPct: "10", apMaxRaisePct: "" }), { apMaxDropPct: 10, apMaxRaisePct: null });
  assert.deepEqual(limitsFrom({ apMaxDropPct: "abc", apMaxRaisePct: "-5" }), { apMaxDropPct: null, apMaxRaisePct: null });
  assert.deepEqual(limitsFrom({ apMaxDropPct: "250", apMaxRaisePct: "12.34" }), { apMaxDropPct: 100, apMaxRaisePct: 12.3 });
  assert.deepEqual(limitsFrom({ limits: { apMaxDropPct: 7.5 } }), { apMaxDropPct: 7.5, apMaxRaisePct: null });
  assert.deepEqual(limitsFrom(null), { apMaxDropPct: null, apMaxRaisePct: null });
});

test("what an account may do on the auto-pricer: admins everything and unlimited; staff by permission, with their brakes; nothing means no entry", () => {
  const admin = apPerms({ email: "a@x.test", name: "Ada", role: "admin", limits: { apMaxDropPct: 5 } });
  assert.deepEqual(admin, { name: "Ada", email: "a@x.test", admin: true, view: true, publish: true, settings: true, config: true, maxDrop: null, maxRaise: null });
  const staff = apPerms({ email: "s@x.test", role: "staff", perms: { ap_publish: true }, limits: { apMaxDropPct: 10, apMaxRaisePct: null } });
  assert.deepEqual(staff, { name: "s@x.test", email: "s@x.test", admin: false, view: true, publish: true, settings: false, config: false, maxDrop: 10, maxRaise: null });
  assert.equal(apPerms({ email: "v@x.test", role: "staff", perms: { edit: true, prices: true } }), null);   // buylist-only account: no entry
  assert.equal(apPerms({ email: "d@x.test", role: "admin", disabled: true }), null);
  assert.equal(apPerms(null), null);
  assert.equal(apPerms({ email: "r@x.test", role: "staff", perms: { ap_view: true } }).publish, false);
});

test("emails are normalised and checked", () => {
  assert.equal(normEmail("  Chaylon@ExorGames.com "), "chaylon@exorgames.com");
  assert.equal(validEmail("chaylon@exorgames.com"), true);
  assert.equal(validEmail("chaylon"), false);
});
