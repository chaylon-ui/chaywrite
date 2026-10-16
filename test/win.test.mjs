import { test } from "node:test";
import assert from "node:assert/strict";
import { winDoFetch, serveWin, serveWinStaff, shopifySubscribe, shopifyScopes, shopifyUrl, validateEntry, atlanticToUtc, utcToAtlanticInput, skillQuestion, csvOf, isOpen, hashIp, cleanName, DEFAULT_CFG, WIN_DO, INTERESTS, PENDING_MS, RATE_PER_HOUR, PENDING_PER_EMAIL } from "../src/win.js";
import { renderLanding, renderHolding, renderVerified, renderRules, renderWinAdmin, buildVerifyEmail, buildWinnerEmail, closesText, prizeShort } from "../src/win-ui.js";

class MemStorage {
  constructor() { this.m = new Map(); }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, structuredClone(this.m.get(x))); return out; } return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, structuredClone(b)); return; } this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, structuredClone(this.m.get(k))); return out; }
}
const T0 = Date.UTC(2026, 9, 17, 15, 0, 0);   // Saturday 2026-10-17 15:00Z, during the show
function cx(clock) { return { storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {}, mem: {} }; }
async function call(c, path, body) {
  const url = new URL("https://win.internal" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  return (await winDoFetch(c, req, url)).json();
}
function envWith(c, extra) {
  return { RESEND_API_KEY: "re_k", SHOPIFY_ADMIN_TOKEN: "t", ...(extra || {}), ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { assert.equal(n, WIN_DO); return winDoFetch(c, req, new URL(req.url)); } }) } };
}
function fakeNet(opts) {
  const o = opts || {}, calls = [];
  const f = async (url, init) => {
    const u = String(url); calls.push({ url: u, init: init || {}, body: init && init.body ? JSON.parse(init.body) : null });
    if (u.startsWith("https://api.resend.com/")) return o.resendFail ? new Response(JSON.stringify({ message: "nope" }), { status: 500 }) : Response.json({ id: "re_1" });
    if (u === "https://most-wanted-ca.myshopify.com/admin/api/2025-01/graphql.json") {
      const q = String((init && init.body && JSON.parse(init.body).query) || "");
      if (o.shopDown) return new Response("x", { status: 503 });
      if (q.includes("currentAppInstallation")) return Response.json({ data: { currentAppInstallation: { accessScopes: (o.noWrite ? ["read_customers"] : ["read_customers", "write_customers"]).map((h) => ({ handle: h })) } } });
      if (q.includes("customers(first")) return Response.json({ data: { customers: { nodes: o.exists ? [{ id: "gid://shopify/Customer/777", email: o.exists, firstName: "", lastName: "Old" }] : [] } } });
      if (q.includes("customerCreate")) return Response.json({ data: { customerCreate: o.createErr ? { customer: null, userErrors: [{ field: ["email"], message: o.createErr }] } : { customer: { id: "gid://shopify/Customer/123" }, userErrors: [] } } });
      if (q.includes("tagsAdd")) return Response.json({ data: { tagsAdd: { userErrors: [] } } });
      if (q.includes("customerUpdate")) return Response.json({ data: { customerUpdate: { customer: { id: "gid://shopify/Customer/777" }, userErrors: [] } } });
      if (q.includes("customerEmailMarketingConsentUpdate")) return Response.json({ data: { customerEmailMarketingConsentUpdate: { customer: { id: "gid://shopify/Customer/777" }, userErrors: [] } } });
    }
    throw new Error("unexpected fetch " + u);
  };
  return { f, calls, resend: () => calls.filter((c) => c.url.startsWith("https://api.resend.com/")), shop: () => calls.filter((c) => c.url.includes("myshopify.com")) };
}
const formReq = (path, fields, ip) => {
  const url = new URL("https://w.example" + path);
  const body = new URLSearchParams(); for (const [k, v] of fields) body.append(k, v);
  return [new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(ip ? { "cf-connecting-ip": ip } : {}) }, body: body.toString() }), url];
};
const getReq = (path) => { const url = new URL("https://w.example" + path); return [new Request(url), url]; };
const linkIn = (resendCall) => { const m = /https:\/\/w\.example\/win\/verify\?t=([A-Za-z0-9_-]+)/.exec(resendCall.body.html); return m ? m[0] : ""; };

test("entry validation, names, interests, times, the skill question", () => {
  const cfg = { ...DEFAULT_CFG };
  assert.equal(validateEntry({ first: "", email: "a@b.co", rules: "1", consent: "1" }, cfg).error, "Please tell us your first name.");
  assert.match(validateEntry({ first: "Ann", email: "nope", rules: "1", consent: "1" }, cfg).error, /email address/);
  assert.match(validateEntry({ first: "Ann", email: "a@b.co", consent: "1" }, cfg).error, /contest rules/);
  assert.match(validateEntry({ first: "Ann", email: "a@b.co", rules: "1" }, cfg).error, /email box/);
  const ok = validateEntry({ first: "  Ann <b>  ", last: "Lee", email: "Ann@B.co ", rules: "1", consent: "1", interests: ["Pokémon", "Nope", "Pokémon"] }, cfg);
  assert.deepEqual(ok.entry, { first: "Ann b", last: "Lee", email: "ann@b.co", consent: true, interests: ["Pokémon"] });
  const opt = validateEntry({ first: "Ann", email: "a@b.co", rules: "1" }, { ...cfg, consentRequired: false });
  assert.equal(opt.entry.consent, false);
  assert.equal(cleanName("x".repeat(80)).length, 60);
  assert.equal(INTERESTS.length, 8);
  // Atlantic time: ADT during the show, AST in December
  assert.equal(atlanticToUtc("2026-10-18T23:59"), Date.UTC(2026, 9, 19, 2, 59));
  assert.equal(atlanticToUtc("2026-12-01T12:00"), Date.UTC(2026, 11, 1, 16, 0));
  assert.equal(atlanticToUtc("garbage"), null);
  assert.equal(utcToAtlanticInput(DEFAULT_CFG.closesAt), "2026-10-18T23:59");
  assert.equal(closesText(DEFAULT_CFG), "Sunday, October 18 at 11:59 pm (Atlantic)");
  assert.equal(prizeShort(DEFAULT_CFG), "$100");
  assert.equal(isOpen({ open: true, closesAt: T0 + 1 }, T0), true); assert.equal(isOpen({ open: true, closesAt: T0 - 1 }, T0), false); assert.equal(isOpen({ open: false }, T0), false);
  for (let i = 0; i < 20; i++) { const s = skillQuestion(); const m = /^\((\d+) × (\d+)\) \+ (\d+) − (\d+)$/.exec(s.q); assert.ok(m, s.q); assert.equal(s.a, +m[1] * +m[2] + +m[3] - +m[4]); }
});

test("ip hash: short, salted, never the address", async () => {
  const a = await hashIp("203.0.113.9", "s1"), b = await hashIp("203.0.113.9", "s2");
  assert.match(a, /^[0-9a-f]{16}$/); assert.notEqual(a, b); assert.equal(a, await hashIp("203.0.113.9", "s1"));
});

test("DO: closed by default, preview entries are tests, pending -> verify -> entry, limits, draw, delete", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const cfg = await call(c, "/_win/cfg");
  assert.equal(cfg.open, false); assert.ok(cfg.previewKey.length >= 12); assert.equal(cfg.salt, undefined, "the salt never leaves the DO");
  assert.equal((await call(c, "/_win/enter", { email: "a@x.test", first: "Ann" })).error, "closed");
  const pv = await call(c, "/_win/enter", { email: "a@x.test", first: "Ann", preview: true, consent: true });
  assert.equal(pv.status, "pending");
  const v1 = await call(c, "/_win/verify", { token: pv.token });
  assert.equal(v1.status, "verified"); assert.equal(v1.entry.test, true, "made from the preview while closed");
  // open it
  const op = await call(c, "/_win/cfg", { open: true });
  assert.equal(op.cfg.open, true); assert.match(op.message, /OPEN/);
  assert.equal((await call(c, "/_win/enter", { email: "bad", first: "x" })).error, "email");
  const e1 = await call(c, "/_win/enter", { email: "Bo@x.test", first: "Bo", last: "Li", consent: true, interests: ["Lorcana", "x"], ipHash: "h1" });
  assert.equal(e1.status, "pending"); assert.ok(e1.token.length >= 24);
  assert.equal((await call(c, "/_win/verify", { token: "nope" })).error, "invalid");
  const v2 = await call(c, "/_win/verify", { token: e1.token });
  assert.equal(v2.status, "verified"); assert.deepEqual([v2.entry.email, v2.entry.first, v2.entry.last, v2.entry.consent, v2.entry.interests, v2.entry.test, v2.entry.shopify.status], ["bo@x.test", "Bo", "Li", true, ["Lorcana"], false, "pending"]);
  assert.equal((await call(c, "/_win/verify", { token: e1.token })).error, "invalid", "one use");
  assert.equal((await call(c, "/_win/enter", { email: "bo@x.test", first: "Bo" })).status, "already");
  // no consent -> never subscribed
  const e2 = await call(c, "/_win/enter", { email: "cy@x.test", first: "Cy", consent: false });
  assert.equal((await call(c, "/_win/verify", { token: e2.token })).entry.shopify.status, "no-consent");
  // pending cap per address, rate cap per connection
  for (let i = 0; i < PENDING_PER_EMAIL; i++) assert.equal((await call(c, "/_win/enter", { email: "dee@x.test", first: "Dee" })).status, "pending");
  assert.equal((await call(c, "/_win/enter", { email: "dee@x.test", first: "Dee" })).error, "pending");
  for (let i = 0; i < RATE_PER_HOUR - 1; i++) assert.equal((await call(c, "/_win/enter", { email: `r${i}@x.test`, first: "R", ipHash: "h1" })).status, "pending");   // h1 already used once
  assert.equal((await call(c, "/_win/enter", { email: "r9@x.test", first: "R", ipHash: "h1" })).error, "rate");
  assert.equal((await call(c, "/_win/enter", { email: "r9@x.test", first: "R", ipHash: "h2" })).status, "pending", "another connection is fine");
  clock.t += 3600e3 + 1;
  assert.equal((await call(c, "/_win/enter", { email: "r10@x.test", first: "R", ipHash: "h1" })).status, "pending", "the hour has passed");
  // expiry
  const e3 = await call(c, "/_win/enter", { email: "ed@x.test", first: "Ed" });
  clock.t += PENDING_MS + 1;
  assert.equal((await call(c, "/_win/verify", { token: e3.token })).error, "expired");
  // the Shopify result recorded
  const om = await call(c, "/_win/synced", { email: "bo@x.test", result: { ok: true, status: "subscribed", id: "123" } });
  assert.equal(om.entry.shopify.status, "subscribed"); assert.equal(om.entry.shopify.id, "123");
  const list = await call(c, "/_win/list");
  assert.deepEqual(list.entries.map((e) => e.email).sort(), ["a@x.test", "bo@x.test", "cy@x.test"]);
  assert.equal(list.pending, 0, "the expired ones are pruned");
  const h = await call(c, "/_win/health");
  assert.deepEqual([h.open, h.confirmed, h.onList, h.drawn], [false, 2, 1, 0], "past the closing time now; test entries do not count");
  // the draw: never a test entry, never twice
  const d1 = await call(c, "/_win/draw", { by: "boss@x.test" });
  assert.ok(d1.ok && ["bo@x.test", "cy@x.test"].includes(d1.draw.email) && d1.draw.q && Number.isInteger(d1.draw.a), JSON.stringify(d1));
  const d2 = await call(c, "/_win/draw", { by: "boss@x.test" });
  assert.ok(d2.ok && d2.draw.email !== d1.draw.email);
  assert.match((await call(c, "/_win/draw", { by: "boss@x.test" })).error, /drawn already/);
  const we = await call(c, "/_win/winner-emailed", { email: d1.draw.email, result: { ok: true } });
  assert.equal(we.ok, true);
  assert.equal((await call(c, "/_win/list")).draws[0].emailed.ok, true);
  assert.equal((await call(c, "/_win/delete", { email: "bo@x.test" })).ok, true);
  assert.equal((await call(c, "/_win/list")).entries.length, 2);
  assert.equal((await call(c, "/_win/delete", { email: "bo@x.test" })).ok, false);
});

test("public pages: holding while closed, preview, the form, the confirmation email, the link, the Shopify customer", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const net = fakeNet(); const env = envWith(c);
  const shopCalls = () => net.shop().filter((c) => !/currentAppInstallation/.test(c.body.query));   // the health probe's scope check aside
  const serve = (req, url) => serveWin(req, env, url, null, { fetchFn: net.f });
  const key = (await call(c, "/_win/cfg")).previewKey;
  let r = await serve(...getReq("/win"));
  assert.equal(r.status, 200); let page = await r.text();
  assert.match(page, /Our Expo draw opens at the show/); assert.doesNotMatch(page, /<form/); assert.match(page, /Mallow Games/);
  assert.equal(r.headers.get("x-robots-tag"), "noindex");
  r = await serve(...getReq("/win?preview=" + key)); page = await r.text();
  assert.match(page, /<form method="post" action="\/win\?preview=/); assert.match(page, /Preview - not open to the public yet/);
  assert.equal((await serve(...getReq("/win?preview=wrong"))).status, 200); assert.doesNotMatch(await (await serve(...getReq("/win?preview=wrong"))).text(), /<form/);
  assert.equal((await serve(...formReq("/win", [["first", "A"], ["email", "a@x.test"], ["rules", "1"], ["consent", "1"]]))).status, 403, "closed: no entries");
  assert.equal((await serve(...getReq("/win/health"))).status, 200);
  const hp = await (await serve(...getReq("/win/health?probe=1"))).json(); assert.equal(hp.shopify, true); assert.equal(hp.customersWrite, true); assert.equal(hp.email, true);
  await call(c, "/_win/cfg", { open: true });
  r = await serve(...getReq("/win")); page = await r.text();
  assert.match(page, /Win <b>\$100<\/b> in store credit/); assert.match(page, /Atlantic Entertainment Expo · Moncton, NB · October 17–18, 2026/);
  assert.match(page, /name="first" value="" required/); assert.match(page, /type="email" name="email"/); assert.match(page, /name="consent" value="1" required/); assert.match(page, /name="rules" value="1" required/);
  assert.match(page, /name="website" tabindex="-1"/); assert.match(page, /buy and sell used video games/); assert.match(page, /mallowgames\.com\/sell-your-games\//); assert.match(page, /href="\/win\/rules"/);
  for (const i of INTERESTS) assert.match(page, new RegExp(`value="${i.replace(/[&]/g, "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  // a bad form comes back with the error and the typed values
  r = await serve(...formReq("/win", [["first", "Ann"], ["last", "Lee"], ["email", "ann@x.test"], ["consent", "1"], ["interests", "Pokémon"]]));
  assert.equal(r.status, 400); page = await r.text();
  assert.match(page, /role="alert">Please tick the box to accept the contest rules/); assert.match(page, /name="last" value="Lee"/); assert.match(page, /value="Pokémon" checked/); assert.equal(net.resend().length, 0);
  // the honeypot: a bot gets the same page and nothing is kept or sent
  r = await serve(...formReq("/win", [["first", "Bot"], ["email", "bot@x.test"], ["rules", "1"], ["consent", "1"], ["website", "http://spam"]]));
  assert.equal(r.status, 200); assert.match(await r.text(), /Check your email/); assert.equal(net.resend().length, 0); assert.equal((await call(c, "/_win/list")).pending, 0);
  // a real entry
  r = await serve(...formReq("/win", [["first", "Ann"], ["last", "Lee"], ["email", "Ann@x.test"], ["rules", "1"], ["consent", "1"], ["interests", "Pokémon"], ["interests", "Video games"]], "203.0.113.9"));
  assert.equal(r.status, 200); page = await r.text();
  assert.match(page, /Check your email, Ann!/); assert.match(page, /<b>ann@x\.test<\/b>/);
  assert.equal(net.resend().length, 1);
  const mail = net.resend()[0];
  assert.deepEqual(mail.body.to, ["ann@x.test"]); assert.equal(mail.body.reply_to, "customerservice@exorgames.com"); assert.match(mail.body.subject, /^Confirm your entry - win \$100 at Exor Games$/);
  const link = linkIn(mail); assert.ok(link, "the email carries the link"); assert.match(mail.body.text, /\/win\/verify\?t=/);
  assert.match(mail.body.html, /51 Allen Street/); assert.match(mail.body.html, /Confirm my entry/);
  assert.equal((await call(c, "/_win/list")).pending, 1); assert.equal(shopCalls().length, 0, "nothing reaches Shopify before the click");
  // the same address again: an "already" mail only after it is confirmed; before that, a second confirmation goes out
  r = await serve(...formReq("/win", [["first", "Ann"], ["email", "ann@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.9"));
  assert.equal(net.resend().length, 2); assert.match(net.resend()[1].body.subject, /^Confirm your entry/);
  // the click
  r = await serve(...getReq(link.replace("https://w.example", "")));
  assert.equal(r.status, 200); page = await r.text();
  assert.match(page, /You're in, Ann! /); assert.match(page, /Sell your video games/);
  assert.equal(shopCalls().length, 2, "a lookup by address, then the create");
  const cr = shopCalls()[1];
  assert.equal(cr.init.method, "POST"); assert.equal(cr.init.headers["X-Shopify-Access-Token"], "t"); assert.match(cr.body.query, /customerCreate/);
  const inp = cr.body.variables.in;
  assert.equal(inp.email, "ann@x.test"); assert.equal(inp.firstName, "Ann"); assert.equal(inp.lastName, "Lee"); assert.deepEqual(inp.tags, ["AEE 2026", "Moncton", "Contest"]);
  assert.equal(inp.emailMarketingConsent.marketingState, "SUBSCRIBED"); assert.equal(inp.emailMarketingConsent.marketingOptInLevel, "CONFIRMED_OPT_IN"); assert.ok(inp.emailMarketingConsent.consentUpdatedAt); assert.match(inp.note, /Atlantic Entertainment Expo/);
  let list = await call(c, "/_win/list");
  assert.equal(list.entries.length, 1); assert.equal(list.entries[0].shopify.status, "subscribed"); assert.equal(list.entries[0].shopify.id, "123"); assert.equal(list.pending, 0, "the other pending for the same address went too");
  // the link a second time
  r = await serve(...getReq(link.replace("https://w.example", "")));
  assert.equal(r.status, 404); assert.match(await r.text(), /That link isn't valid/);
  // entering again once confirmed: the "already" email, no new pending
  r = await serve(...formReq("/win", [["first", "Ann"], ["email", "ann@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.9"));
  assert.equal(r.status, 200); assert.match(net.resend()[2].body.subject, /already in the draw/); assert.equal((await call(c, "/_win/list")).pending, 0);
  // the connection limit (3 used so far from .9)
  for (let i = 0; i < RATE_PER_HOUR - 3; i++) assert.equal((await serve(...formReq("/win", [["first", "R"], ["email", `r${i}@x.test`], ["rules", "1"], ["consent", "1"]], "203.0.113.9"))).status, 200);
  r = await serve(...formReq("/win", [["first", "R"], ["email", "r99@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.9"));
  assert.equal(r.status, 429); assert.match(await r.text(), /Too many entries from this connection/);
  // resend down: told to retry, nothing half-done
  const down = fakeNet({ resendFail: true });
  const serveWith = (e, n, [req, url]) => serveWin(req, e, url, null, { fetchFn: n.f });
  r = await serveWith(env, down, formReq("/win", [["first", "Zed"], ["email", "zed@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.10"));
  assert.equal(r.status, 502); assert.match(await r.text(), /could not send the confirmation email/);
  // rules page, unknown path, expired wording
  assert.match(await (await serve(...getReq("/win/rules"))).text(), /skill-testing question/);
  assert.equal((await serve(...getReq("/win/nothing"))).status, 404);
  // no Shopify token: the entry is kept and marked
  const env2 = envWith(c, { SHOPIFY_ADMIN_TOKEN: "" }); const net2 = fakeNet();
  r = await serveWith(env2, net2, formReq("/win", [["first", "Kay"], ["email", "kay@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.11"));
  r = await serveWith(env2, net2, getReq(linkIn(net2.resend()[0]).replace("https://w.example", "")));
  assert.equal(r.status, 200); list = await call(c, "/_win/list");
  assert.equal(list.entries.find((e) => e.email === "kay@x.test").shopify.status, "unconfigured"); assert.equal(net2.shop().length, 0);
  // after the closing time the public sees "entries have closed" and the form is gone
  clock.t = DEFAULT_CFG.closesAt + 1;
  const realNow = Date.now; Date.now = () => clock.t;
  try { r = await serve(...getReq("/win")); page = await r.text(); assert.match(page, /Entries have closed/); assert.doesNotMatch(page, /<form/); assert.equal((await serve(...formReq("/win", [["first", "L"], ["email", "l@x.test"], ["rules", "1"], ["consent", "1"]]))).status, 403); }
  finally { Date.now = realNow; }
});

test("shopify: new customer, existing customer is tagged and re-consented, outage, user errors, no token", async () => {
  const cfg = { ...DEFAULT_CFG }, entry = { email: "a@x.test", first: "A", last: "", consent: true, interests: [], verifiedAt: T0 };
  const env = { SHOPIFY_ADMIN_TOKEN: "t" };
  const n1 = fakeNet(); const r1 = await shopifySubscribe(env, entry, cfg, n1.f);
  assert.deepEqual([r1.ok, r1.status, r1.id], [true, "subscribed", "123"]);
  const inp = n1.shop()[1].body.variables.in; assert.equal(inp.lastName, undefined); assert.equal(inp.firstName, "A"); assert.equal(n1.shop()[0].body.variables.q, "email:a@x.test");
  const n2 = fakeNet({ exists: "a@x.test" }); const r2 = await shopifySubscribe(env, { ...entry, last: "Lee" }, cfg, n2.f);
  assert.deepEqual([r2.ok, r2.status, r2.id], [true, "updated", "777"]);
  assert.deepEqual(n2.shop().map((c) => /(customers\(|customerCreate|tagsAdd|customerUpdate|customerEmailMarketingConsentUpdate)/.exec(c.body.query)[1]), ["customers(", "tagsAdd", "customerUpdate", "customerEmailMarketingConsentUpdate"]);
  assert.deepEqual(n2.shop()[1].body.variables, { id: "gid://shopify/Customer/777", t: ["AEE 2026", "Moncton", "Contest"] });
  assert.deepEqual(n2.shop()[2].body.variables.in, { id: "gid://shopify/Customer/777", firstName: "A" }, "only the blank name is filled; their last name stays");
  assert.equal(n2.shop()[3].body.variables.in.emailMarketingConsent.marketingOptInLevel, "CONFIRMED_OPT_IN"); assert.equal(n2.shop()[3].body.variables.in.customerId, "gid://shopify/Customer/777");
  const n3 = fakeNet({ shopDown: true }); const r3 = await shopifySubscribe(env, entry, cfg, n3.f); assert.equal(r3.ok, false); assert.match(r3.error, /HTTP 503/);
  const n4 = fakeNet({ createErr: "Email has already been taken" }); const r4 = await shopifySubscribe(env, entry, cfg, n4.f); assert.equal(r4.ok, false); assert.match(r4.error, /already been taken/);
  assert.equal((await shopifySubscribe({}, entry, cfg, n3.f)).status, "unconfigured");
  assert.equal((await shopifyScopes(env, fakeNet().f)).customersWrite, true); assert.equal((await shopifyScopes(env, fakeNet({ noWrite: true }).f)).customersWrite, false); assert.equal((await shopifyScopes({}, fakeNet().f)).customersWrite, false);
  assert.equal(shopifyUrl({}), "https://most-wanted-ca.myshopify.com/admin/api/2025-01/graphql.json"); assert.equal(shopifyUrl({ SHOPIFY_SHOP: "x.myshopify.com" }), "https://x.myshopify.com/admin/api/2025-01/graphql.json");
});

test("admin screen: admins only; open/close, settings, the draw, winner email, retry, remove, CSV", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const net = fakeNet(); const env = envWith(c, { SHOPIFY_ADMIN_TOKEN: "" });   // no Shopify token at first
  const admin = { email: "boss@x.test", name: "Boss Person", role: "admin", perms: [] }, staff = { email: "s@x.test", name: "Sam", role: "staff", perms: [] };
  const html = (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html" } });
  const redirect = (to) => new Response(null, { status: 303, headers: { location: to } });
  const q = (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; };
  const toLogin = () => redirect("/9pocket/login");
  const serve = (path, user, form, e) => { const url = new URL("https://w.example" + path); const req = new Request(url, form ? { method: "POST" } : {}); return serveWinStaff(req, e || env, url, user, form, { html, redirect, q, toLogin, opts: { user }, fetchFn: net.f }); };
  const loc = (r) => decodeURIComponent(r.headers.get("location")).replace(/\+/g, " ");
  assert.equal((await (await serve("/9pocket/win/health")).json()).ok, true);
  assert.equal((await serve("/9pocket/win", null)).status, 303);
  assert.equal((await serve("/9pocket/win", staff)).status, 403);
  assert.equal((await serve("/9pocket/win/export.csv", staff)).status, 403);
  assert.equal((await serve("/9pocket/win/control", staff, { action: "open" })).status, 403);
  let r = await serve("/9pocket/win", admin); assert.equal(r.status, 200); let page = await r.text();
  assert.match(page, /<h1>Expo contest<\/h1>/); assert.match(page, /CLOSED/); assert.match(page, /Open the contest/); assert.match(page, /Shopify customers: no token on the worker/); assert.match(page, /Omnisend takes its list from Shopify/);
  assert.match(page, /https:\/\/exorgames\.com\/win<\/code>/, "the short address the QR carries"); assert.match(page, /\/win-qr\.png/); assert.match(page, /\/win-qr\.svg/); assert.match(page, /\/win-sign\.html/); assert.match(page, /href="\/9pocket\/win\/export\.csv"/); assert.match(page, /\?preview=/); assert.match(page, /No confirmed entries yet/);
  assert.match(page, /value="2026-10-18T23:59"/); assert.match(page, /name="consentRequired" value="1" checked/);
  // open
  r = await serve("/9pocket/win/control", admin, { action: "open" }); assert.equal(r.status, 303); assert.match(loc(r), /msg=The contest is OPEN/);
  assert.equal((await call(c, "/_win/cfg")).open, true);
  // settings (Atlantic time in, consent box off)
  r = await serve("/9pocket/win/control", admin, { action: "cfg", event: "AEE", place: "Moncton", dates: "Oct 17-18", prize: "$100 in store credit", closes: "2026-10-18T22:00", drawText: "Monday", tags: "a, b" });
  const cfg = await call(c, "/_win/cfg");
  assert.deepEqual([cfg.event, cfg.closesAt, cfg.consentRequired, cfg.tags], ["AEE", Date.UTC(2026, 9, 19, 1, 0), false, "a, b"]);
  await serve("/9pocket/win/control", admin, { action: "cfg", consentRequired: "1" });
  assert.equal((await call(c, "/_win/cfg")).consentRequired, true);
  // sample email to the admin
  r = await serve("/9pocket/win/control", admin, { action: "test_email" }); assert.match(loc(r), /sample confirmation email/);
  assert.deepEqual(net.resend()[0].body.to, ["boss@x.test"]); assert.match(net.resend()[0].body.html, /sample sent from the 9Pocket admin screen/); assert.match(net.resend()[0].body.html, /Boss/);
  // nothing to draw yet
  r = await serve("/9pocket/win/control", admin, { action: "draw" }); assert.match(loc(r), /err=No confirmed entries/);
  // two confirmed entries (one without consent), one test entry
  const mk = async (email, first, consent, preview) => { const e = await call(c, "/_win/enter", { email, first, last: "=SUM(1)", consent, preview }); await call(c, "/_win/verify", { token: e.token }); };
  await call(c, "/_win/cfg", { open: false }); await mk("t@x.test", "Tess", true, true); await call(c, "/_win/cfg", { open: true });
  await mk("a@x.test", "Ann", true); await mk("b@x.test", "Bo", false);
  r = await serve("/9pocket/win", admin); page = await r.text();
  assert.match(page, /<b>2<\/b><br><span class="muted">confirmed entries/); assert.match(page, /<b>1<\/b><br><span class="muted">test entries/);
  assert.match(page, /waiting/, "made straight in the DO: Shopify never ran"); assert.match(page, /Retry<\/button>/); assert.match(page, /no consent/);
  // retry once the token is there
  const env2 = envWith(c);
  r = await serve("/9pocket/win/control", admin, { action: "retry", email: "a@x.test" }, env2); assert.match(loc(r), /msg=Subscribed as a Shopify customer/);
  assert.equal(net.shop().length, 2); assert.equal((await call(c, "/_win/list")).entries.find((e) => e.email === "a@x.test").shopify.status, "subscribed");
  r = await serve("/9pocket/win", admin, null, env2); page = await r.text(); assert.match(page, /the token can create and subscribe customers/); assert.match(page, /customers\/123" target="_blank"/);
  r = await serve("/9pocket/win/control", admin, { action: "retry", email: "b@x.test" }, env2); assert.match(loc(r), /did not tick the email box/);
  // the draw never picks the test entry; the winner email carries the question
  r = await serve("/9pocket/win/control", admin, { action: "draw" }); assert.match(loc(r), /msg=Drawn: (Ann|Bo) /);
  const draws = (await call(c, "/_win/list")).draws; assert.equal(draws.length, 1); assert.notEqual(draws[0].email, "t@x.test");
  r = await serve("/9pocket/win/control", admin, { action: "email_winner", email: draws[0].email }); assert.match(loc(r), /winner has been emailed/);
  const wm = net.resend().at(-1); assert.deepEqual(wm.body.to, [draws[0].email]); assert.match(wm.body.subject, /You won our AEE draw!/); assert.ok(wm.body.html.includes(draws[0].q + " = ?"));
  r = await serve("/9pocket/win", admin); page = await r.text();
  assert.match(page, /winner emailed/); assert.match(page, /Skill-testing question: <b>/); assert.match(page, new RegExp("answer <b>" + draws[0].a + "</b>"));
  // CSV: text/csv, formulas defused
  r = await serve("/9pocket/win/export.csv", admin); assert.match(r.headers.get("content-type"), /text\/csv/);
  const csv = await r.text(); assert.match(csv, /^email,first_name,last_name,email_consent,interests,entered_at,confirmed_at,shopify_customer,test\r\n/); assert.match(csv, /a@x\.test,Ann,'=SUM\(1\),yes,,2026-10-17T15:00:00\.000Z,2026-10-17T15:00:00\.000Z,subscribed,\r\n/); assert.match(csv, /t@x\.test,.*,test\r\n/);
  assert.equal(csvOf([{ email: "x@y", first: 'He said "hi"', last: "", interests: [], enteredAt: T0, verifiedAt: T0 }]).split("\r\n")[1], 'x@y,"He said ""hi""",,no,,2026-10-17T15:00:00.000Z,2026-10-17T15:00:00.000Z,,');
  // remove
  r = await serve("/9pocket/win/control", admin, { action: "delete", email: "b@x.test" }); assert.match(loc(r), /msg=Entry removed/);
  assert.equal((await call(c, "/_win/list")).entries.length, 2);
  // close
  r = await serve("/9pocket/win/control", admin, { action: "close" }); assert.match(loc(r), /msg=The contest is closed/);
  assert.equal((await call(c, "/_win/cfg")).open, false);
});

test("markup: landing, holding, verified, rules and the emails say what they must", () => {
  const cfg = { ...DEFAULT_CFG, open: true };
  const landing = renderLanding(cfg, { origin: "https://w", preview: "" });
  assert.match(landing, /Enter to win/); assert.match(landing, /What do you play or collect\?/); assert.match(landing, /Yes - email me Exor Games and Mallow Games news/); assert.match(landing, /No purchase necessary/); assert.match(landing, /Entries close Sunday, October 18 at 11:59 pm \(Atlantic\)/);
  assert.match(landing, /Shop ExorGames\.com/); assert.match(landing, /See the video game buylist/); assert.match(landing, /\$100 credit<\/b> works on cards <i>or<\/i> video games/);
  const landingOpt = renderLanding({ ...cfg, consentRequired: false }, {}); assert.match(landingOpt, /name="consent" value="1">/); assert.match(landingOpt, /\(optional\) Unsubscribe/);
  const hold = renderHolding(cfg, {}); assert.match(hold, /opens at the show/); assert.doesNotMatch(hold, /<form/);
  assert.match(renderHolding(cfg, { ended: true }), /Entries have closed/);
  assert.match(renderVerified(cfg, { first: "Ann", already: true }), /already confirmed/);
  const rules = renderRules(cfg, {}); assert.match(rules, /excluding Quebec/); assert.match(rules, /51 Allen Street/); assert.match(rules, /subscribed customer/); assert.match(rules, /seven \(7\) days/);
  const ve = buildVerifyEmail({ first: "Ann", link: "https://w/win/verify?t=abc", cfg, origin: "https://w" });
  assert.match(ve.html, /href="https:\/\/w\/win\/verify\?t=abc"/); assert.match(ve.text, /https:\/\/w\/win\/verify\?t=abc/); assert.match(ve.html, /Didn't enter\? Ignore this email/);
  // the owner's Mallow Games graphic (2026-10-16) rides in both emails, on the confirmed page and on the landing card
  assert.match(ve.html, /src="https:\/\/exor-binder\.nevski\.workers\.dev\/win-mallow\.jpg"/); assert.match(ve.text, /mallowgames\.com\/sell-your-games\//);
  assert.match(renderVerified(cfg, { first: "Ann" }), /<img class="entered" src="\/win-entered\.jpg"/); assert.match(landing, /src="\/win-mallow\.jpg"/);
  const we = buildWinnerEmail({ first: "Ann", question: "(2 × 3) + 10 − 1", cfg }); assert.match(we.html, /\(2 × 3\) \+ 10 − 1 = \?/); assert.match(we.text, /Reply within 7 days/); assert.match(we.html, /win-mallow\.jpg/);
  const adm = renderWinAdmin({ cfg: { ...cfg, previewKey: "pk" }, entries: [], draws: [], pending: 0, now: T0 }, { user: { email: "b@x", role: "admin" }, origin: "https://w", emailOn: true, shopifyOn: true, customersWrite: true, closesInput: "2026-10-18T23:59" });
  assert.match(adm, /OPEN/); assert.match(adm, /https:\/\/w\/win\?preview=pk/); assert.match(adm, /the token can create and subscribe customers/); assert.match(adm, /Close the contest/);
});
