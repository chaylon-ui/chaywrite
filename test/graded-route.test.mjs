// The Graded screen through the real 9Pocket handler with a signed-in account
// (owner, 2026-10-28: Error 1101 on every signed-in visit - a ReferenceError
// the signed-out smoke test could not see, since it redirects first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveStage } from "../src/stage.js";
import { COOKIE } from "../src/stage-auth.js";

const ORIGIN = "https://w.example";
const TOKEN = "a".repeat(64);
const room = (user) => ({
  idFromName: (n) => n,
  get: () => ({ fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/_stage/session") return Response.json(u.searchParams.get("token") === TOKEN ? { ok: true, mfa: true, email: user.email } : { ok: false });
    if (u.pathname === "/_stage/user") return Response.json({ ok: true, user });
    return Response.json({ ok: true, users: 1 });
  } }),
});
const get = (env, path, cookie) => serveStage(new Request(ORIGIN + path, { headers: cookie ? { cookie: COOKIE + "=" + cookie } : {} }), env, new URL(ORIGIN + path), async () => false, { ctx: { waitUntil() {} } });

test("9Pocket > Graded renders for an admin, refuses a staff account without the permission, redirects a visitor", async () => {
  const admin = { email: "owner@example.com", name: "Owner", role: "admin", perms: {}, createdAt: 1, mfa: true };
  const r = await get({ ROOM: room(admin) }, "/9pocket/graded", TOKEN);
  const body = await r.text();
  assert.equal(r.status, 200, body.slice(0, 300));
  for (const needle of ["Graded cards", 'id="gform"', 'id="batch"', "/graded-add.js", "PSA lookups are off", "no SHOPIFY_ADMIN_TOKEN"]) assert.ok(body.includes(needle), needle);
  const staff = { email: "staff@example.com", name: "S", role: "staff", perms: { pickups: true }, createdAt: 1, mfa: true };
  const d = await get({ ROOM: room(staff) }, "/9pocket/graded", TOKEN);
  assert.equal(d.status, 403); assert.match(await d.text(), /cannot add graded cards/);
  const ok = await get({ ROOM: room({ ...staff, perms: { graded: true } }) }, "/9pocket/graded", TOKEN);
  assert.equal(ok.status, 200);
  const out = await get({ ROOM: room(admin) }, "/9pocket/graded");
  assert.equal(out.status, 303); assert.match(out.headers.get("location"), /^\/9pocket\/login\?next=/);
  const cert = await get({ ROOM: room(admin) }, "/9pocket/graded/cert.json?grader=PSA&cert=12345678", TOKEN);
  assert.equal(cert.status, 200); const cj = await cert.json(); assert.equal(cj.ok, false); assert.equal(cj.configured, false);
});
