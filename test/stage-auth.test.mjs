import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, newToken, parseCookies, sessionCookie, clearCookie, publicUser, can, permsFrom, normEmail, validEmail, COOKIE } from "../src/stage-auth.js";

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
  assert.deepEqual(permsFrom({ perm_edit: "on", perm_prices: "on" }), { edit: true, prices: true, add: false, approve: false, email: false });
  assert.deepEqual(permsFrom({ perms: ["add", "email"] }), { edit: false, prices: false, add: true, approve: false, email: true });
  assert.deepEqual(permsFrom({}), { edit: false, prices: false, add: false, approve: false, email: false });
});

test("emails are normalised and checked", () => {
  assert.equal(normEmail("  Chaylon@ExorGames.com "), "chaylon@exorgames.com");
  assert.equal(validEmail("chaylon@exorgames.com"), true);
  assert.equal(validEmail("chaylon"), false);
});
