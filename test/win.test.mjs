import { test } from "node:test";
import assert from "node:assert/strict";
import { winDoFetch, serveWin, serveWinStaff, shopifySubscribe, shopifyScopes, shopifyUrl, validateEntry, atlanticToUtc, atlanticDay, utcToAtlanticInput, skillQuestion, csvOf, isOpen, hashIp, cleanName, slugOf, DEFAULT_CFG, WIN_DO, INTERESTS, PENDING_MS, RATE_PER_HOUR, PENDING_PER_EMAIL } from "../src/win.js";
import { renderLanding, renderHolding, renderVerified, renderRules, renderWinAdmin, renderContests, buildVerifyEmail, buildWinnerEmail, closesText, prizeShort, isCredit } from "../src/win-ui.js";
const EXPO = "atlantic-entertainment-expo-2026";   // the id of the first (seeded) contest

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
const linkIn = (resendCall) => { const m = /https:\/\/exorgames\.com\/win\/verify\?t=([A-Za-z0-9_-]+)/.exec(resendCall.body.html); return m ? m[0] : ""; };   // the store domain redirects to the worker

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
  assert.equal(atlanticDay(T0), "2026-10-17"); assert.equal(atlanticDay(Date.UTC(2026, 9, 18, 2, 30)), "2026-10-17", "11:30 pm Atlantic is still the 17th"); assert.equal(atlanticDay(Date.UTC(2026, 9, 18, 3, 1)), "2026-10-18");
  assert.equal(closesText(DEFAULT_CFG), "Sunday, October 18 at 11:59 pm (Atlantic)"); assert.equal(closesText({}), "just before the draw");
  assert.equal(prizeShort(DEFAULT_CFG), "$100"); assert.equal(isCredit(DEFAULT_CFG), true); assert.equal(isCredit({ prize: "A Prismatic Evolutions booster box" }), false); assert.equal(prizeShort({ prize: "A booster box" }), "A booster box");
  assert.equal(slugOf("Atlantic Entertainment Expo", DEFAULT_CFG.closesAt), EXPO); assert.equal(slugOf("Pokémon: Prismatic Evolutions launch!!", Date.UTC(2026, 10, 7)), "pokemon-prismatic-evolutions-launch-2026"); assert.equal(slugOf("", T0), "contest-2026");
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
  assert.equal(cfg.id, EXPO); assert.equal(cfg.current, true); assert.equal(cfg.mallow, true); assert.equal(cfg.art, "/win-entered.jpg");
  assert.equal((await call(c, "/_win/cfg?c=nope")).error, "no such contest");
  assert.equal((await call(c, "/_win/enter", { email: "a@x.test", first: "Ann" })).error, "closed");
  const pv = await call(c, "/_win/enter", { email: "a@x.test", first: "Ann", preview: true, consent: true });
  assert.equal(pv.status, "pending");
  const v1 = await call(c, "/_win/verify", { token: pv.token });
  assert.equal(v1.status, "verified"); assert.equal(v1.entry.test, true, "made from the preview while closed"); assert.equal(v1.c, EXPO); assert.equal(v1.cfg.id, EXPO, "the link says which contest it confirms");
  assert.deepEqual((await call(c, "/_win/list")).days, [], "test entries are not in the tally");
  // open it
  const op = await call(c, "/_win/cfg", { open: true });
  assert.equal(op.cfg.open, true); assert.match(op.message, /OPEN/);
  assert.equal((await call(c, "/_win/enter", { email: "bad", first: "x" })).error, "email");
  const e1 = await call(c, "/_win/enter", { email: "Bo@x.test", first: "Bo", last: "Li", consent: true, interests: ["Lorcana", "x"], ipHash: "h1" });
  assert.equal(e1.status, "pending"); assert.ok(e1.token.length >= 24); assert.equal(e1.c, EXPO);
  assert.equal((await c.storage.get("win:p:" + e1.token)).c, EXPO, "a pending record names its contest");
  assert.equal((await call(c, "/_win/verify", { token: "nope" })).error, "invalid");
  const v2 = await call(c, "/_win/verify", { token: e1.token });
  assert.equal(v2.status, "verified"); assert.deepEqual([v2.entry.email, v2.entry.first, v2.entry.last, v2.entry.consent, v2.entry.interests, v2.entry.test, v2.entry.shopify.status], ["bo@x.test", "Bo", "Li", true, ["Lorcana"], false, "pending"]);
  assert.equal((await call(c, "/_win/verify", { token: e1.token })).error, "invalid", "one use");
  assert.deepEqual((await call(c, "/_win/list")).days, [{ day: "2026-10-17", visits: 0, signups: 1, confirmed: 1 }]);
  assert.ok(await c.storage.get(`win:e:${EXPO}:bo@x.test`), "entries are keyed by contest"); assert.ok(await c.storage.get(`win:v:${EXPO}:2026-10-17`));
  assert.equal((await call(c, "/_win/hit", { kind: "visit" })).ok, true); assert.equal((await call(c, "/_win/hit", { kind: "nope" })).ok, false);
  assert.equal((await call(c, "/_win/list")).days[0].visits, 1); assert.equal((await call(c, "/_win/health")).visitsToday, 1);
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
  for (let i = 0; i < RATE_PER_HOUR; i++) assert.equal((await call(c, "/_win/enter", { email: `ip${i}@x.test`, first: "R", ip: "203.0.113.77" })).status, "pending");
  assert.equal((await call(c, "/_win/enter", { email: "ip9@x.test", first: "R", ip: "203.0.113.77" })).error, "rate", "an address is hashed in the DO with its salt");
  assert.equal([...(await c.storage.list({ prefix: "win:r:" })).keys()].some((k) => k.includes("203.0.113.77")), false, "never the address itself");
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
  assert.deepEqual([h.open, h.confirmed, h.onList, h.drawn, h.current, h.contests], [false, 2, 1, 0, EXPO, 1], "past the closing time now; test entries do not count");
  // the draw: never a test entry, never twice
  const d1 = await call(c, "/_win/draw", { by: "boss@x.test" });
  assert.ok(d1.ok && ["bo@x.test", "cy@x.test"].includes(d1.draw.email) && d1.draw.q && Number.isInteger(d1.draw.a), JSON.stringify(d1));
  assert.match(d1.message, /nothing has been emailed/);
  // staff: a draw can be voided (entry excluded), entries excluded / included by hand; the draw skips them
  const vd = await call(c, "/_win/void", { email: d1.draw.email, by: "boss@x.test" });
  assert.equal(vd.ok, true); assert.equal((await call(c, "/_win/list")).draws[0].voided.by, "boss@x.test");
  assert.equal((await call(c, "/_win/list")).entries.find((e) => e.email === d1.draw.email).excluded.reason, "voided draw");
  assert.equal((await call(c, "/_win/void", { email: d1.draw.email })).ok, false, "voided once");
  const other = d1.draw.email === "bo@x.test" ? "cy@x.test" : "bo@x.test";
  assert.equal((await call(c, "/_win/exclude", { email: other, on: true, by: "boss@x.test" })).ok, true);
  assert.match((await call(c, "/_win/draw", { by: "boss@x.test" })).error, /drawn or excluded already/);
  assert.match((await call(c, "/_win/exclude", { email: other, on: false })).message, /back in the draw/);
  const d2 = await call(c, "/_win/draw", { by: "boss@x.test" });
  assert.ok(d2.ok && d2.draw.email === other, JSON.stringify(d2)); assert.match(d2.message, /1 entries were in the hat, 1 excluded/);
  assert.match((await call(c, "/_win/draw", { by: "boss@x.test" })).error, /drawn or excluded already/);
  const we = await call(c, "/_win/winner-emailed", { email: d1.draw.email, result: { ok: true } });
  assert.equal(we.ok, true);
  assert.equal((await call(c, "/_win/list")).draws[0].emailed.ok, true);
  assert.equal((await call(c, "/_win/delete", { email: "bo@x.test" })).ok, true);
  assert.equal((await call(c, "/_win/list")).entries.length, 2);
  assert.equal((await call(c, "/_win/delete", { email: "bo@x.test" })).ok, false);
});

test("DO: several contests - new, current, each with its own entries, counts and draws; removing one; the sweep per contest", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const first = await call(c, "/_win/cfg");
  assert.equal(first.id, EXPO);
  // a new one starts closed, with nothing carried over from the Expo
  assert.match((await call(c, "/_win/contests/new", { place: "x" })).error, /needs a name/);
  assert.match((await call(c, "/_win/contests/new", { event: "Launch" })).error, /needs a prize/);
  const n1 = await call(c, "/_win/contests/new", { event: "Pokémon launch weekend", place: "Exor Games, Charlottetown", dates: "Nov 7–8", prize: "A booster box", closesAt: Date.UTC(2026, 10, 9, 3, 59), drawText: "Monday, November 9", tags: "Launch 2026", consentRequired: false, mallow: false, by: "boss@x.test" });
  assert.equal(n1.ok, true); assert.match(n1.message, /created, closed\. Check/); assert.doesNotMatch(n1.message, /now the contest at/);
  const L = n1.contest;
  assert.deepEqual([L.id, L.open, L.current, L.event, L.prize, L.mallow, L.consentRequired, L.art, L.tags, L.createdBy], ["pokemon-launch-weekend-2026", false, false, "Pokémon launch weekend", "A booster box", false, false, "", "Launch 2026", "boss@x.test"]);
  assert.equal((await call(c, "/_win/contests/new", { event: "Pokémon launch weekend", prize: "x", closesAt: L.closesAt })).contest.id, "pokemon-launch-weekend-2026-2", "ids stay unique");
  await call(c, "/_win/contests/delete", { c: "pokemon-launch-weekend-2026-2" });
  // the Expo stays current: its page, its entries
  assert.equal((await call(c, "/_win/cfg")).id, EXPO);
  await call(c, "/_win/cfg", { open: true });
  const e1 = await call(c, "/_win/enter", { email: "ann@x.test", first: "Ann", consent: true });
  await call(c, "/_win/verify", { token: e1.token });
  await call(c, "/_win/hit", { kind: "visit" });
  // the launch contest: closed, so only preview entries; open it (not current) and enter by id
  assert.equal((await call(c, "/_win/enter", { c: L.id, email: "ann@x.test", first: "Ann" })).error, "closed");
  assert.equal((await call(c, "/_win/cfg", { c: L.id, open: true })).cfg.open, true);
  assert.equal((await call(c, "/_win/cfg")).open, true, "the Expo is untouched");
  const e2 = await call(c, "/_win/enter", { c: L.id, email: "ann@x.test", first: "Ann", consent: false });
  assert.equal(e2.status, "pending", "the same person may enter another contest");
  const v2 = await call(c, "/_win/verify", { token: e2.token });
  assert.equal(v2.c, L.id); assert.equal(v2.cfg.event, "Pokémon launch weekend"); assert.equal(v2.entry.shopify.status, "no-consent");
  const e3 = await call(c, "/_win/enter", { c: L.id, email: "bo@x.test", first: "Bo", consent: true });
  await call(c, "/_win/verify", { token: e3.token });
  await call(c, "/_win/enter", { c: L.id, email: "cy@x.test", first: "Cy" });   // pending only
  await call(c, "/_win/hit", { kind: "visit", c: L.id }); await call(c, "/_win/hit", { kind: "visit", c: L.id }); await call(c, "/_win/hit", { kind: "visit", c: L.id });
  assert.equal((await call(c, "/_win/draw", { c: L.id, by: "boss@x.test" })).ok, true);
  const expo = await call(c, "/_win/list"), launch = await call(c, "/_win/list?c=" + L.id);
  assert.deepEqual(expo.entries.map((e) => e.email), ["ann@x.test"]); assert.equal(expo.pending, 0); assert.equal(expo.draws.length, 0); assert.deepEqual(expo.days, [{ day: "2026-10-17", visits: 1, signups: 1, confirmed: 1 }]); assert.equal(expo.contests, 2);
  assert.deepEqual(launch.entries.map((e) => e.email).sort(), ["ann@x.test", "bo@x.test"]); assert.equal(launch.pending, 1); assert.equal(launch.draws.length, 1); assert.deepEqual(launch.days, [{ day: "2026-10-17", visits: 3, signups: 3, confirmed: 2 }]);
  assert.equal((await call(c, "/_win/synced", { c: L.id, email: "bo@x.test", result: { ok: true, status: "subscribed", id: "9" } })).ok, true);
  assert.equal((await call(c, "/_win/synced", { email: "bo@x.test", result: { ok: true } })).error, "no such entry", "the Expo has no Bo");
  // the list with its counts, newest closing first
  const all = await call(c, "/_win/contests");
  assert.equal(all.current, EXPO); assert.deepEqual(all.contests.map((x) => x.id), [L.id, EXPO]);
  assert.deepEqual(all.contests[0].stats, { confirmed: 2, test: 0, onList: 1, excluded: 0, draws: 1, winners: 1, pending: 1, visits: 3, signups: 3 });
  assert.deepEqual(all.contests[1].stats, { confirmed: 1, test: 0, onList: 0, excluded: 0, draws: 0, winners: 0, pending: 0, visits: 1, signups: 1 });
  assert.equal(all.contests[0].salt, undefined); assert.equal(all.contests[0].previewKey, first.previewKey, "one preview key for all");
  // make the launch current: the public page is its; the Expo's data stays
  assert.equal((await call(c, "/_win/current", { c: "nope" })).error, "no such contest");
  assert.match((await call(c, "/_win/current", { c: L.id })).message, /now shows Pokémon launch weekend/);
  assert.equal((await call(c, "/_win/cfg")).id, L.id); assert.equal((await call(c, "/_win/cfg?c=" + EXPO)).current, false);
  assert.equal((await call(c, "/_win/list?c=" + EXPO)).entries.length, 1);
  assert.equal((await call(c, "/_win/health")).current, L.id);
  // the Expo cannot be removed while current; otherwise it goes with everything of its own
  assert.match((await call(c, "/_win/contests/delete", { c: L.id })).error, /current contest/);
  const before = (await c.storage.list({ prefix: "win:" })).size;
  assert.match((await call(c, "/_win/contests/delete", { c: EXPO })).message, /removed with its 1 entries/);
  assert.equal((await call(c, "/_win/cfg?c=" + EXPO)).error, "no such contest");
  assert.equal((await c.storage.list({ prefix: "win:" })).size, before - 3, "the record, the entry and the day row");
  assert.equal((await call(c, "/_win/list?c=" + L.id)).entries.length, 2, "the other contest keeps its entries");
  // the sweep: each contest on its own clock
  await call(c, "/_win/contests/new", { event: "Spring", prize: "$20 in store credit", closesAt: T0 + 400 * 86400e3 });
  clock.t = L.closesAt + 91 * 86400e3;
  const sw = await call(c, "/_win/sweep", {});
  assert.deepEqual(sw.counts, { due: true, entries: 2, pending: 0, draws: 1 }, "the launch is 91 days past closing; its pending token expired long ago");
  const after = (await call(c, "/_win/contests")).contests;
  const swept = after.find((x) => x.id === L.id), spring = after.find((x) => x.id === "spring-2027");
  assert.deepEqual({ ...swept.stats, sweptAt: 0 }, { confirmed: 2, test: 0, onList: 1, excluded: 0, draws: 1, winners: 1, pending: 0, visits: 3, signups: 3, sweptAt: 0 }, "the counts survive as the summary");
  assert.equal(swept.summary.sweptAt, clock.t); assert.deepEqual(spring.stats.confirmed, 0); assert.equal(spring.summary, null);
  assert.equal((await call(c, "/_win/list?c=" + L.id)).entries.length, 0); assert.equal((await call(c, "/_win/health")).confirmed, 0);
  assert.deepEqual((await call(c, "/_win/sweep", {})).counts, { due: false, entries: 0, pending: 0, draws: 0 });
});

test("DO: the single-contest layout from before 2026-10-22 becomes contest #1, once", async () => {
  const clock = { t: Date.UTC(2026, 9, 22, 12) }; const c = cx(clock);
  // what the live DO held: the owner's settings beside the salt and key, entries by address, win:draws, counts by day
  await c.storage.put("win:cfg", { open: true, event: "Atlantic Entertainment Expo", place: "Moncton, NB", dates: "October 17–18, 2026", prize: "$100 in store credit at ExorGames.com", closesAt: DEFAULT_CFG.closesAt, drawText: "Monday, October 19, 2026", consentRequired: true, tags: "AEE 2026, Moncton, Contest", salt: "oldsalt", previewKey: "oldkey12345x" });
  await c.storage.put("win:e:ann@x.test", { email: "ann@x.test", first: "Ann", verifiedAt: T0, consent: true, shopify: { status: "subscribed" } });
  await c.storage.put("win:e:bo@x.test", { email: "bo@x.test", first: "Bo", verifiedAt: T0 + 1, consent: false, test: false, shopify: { status: "no-consent" } });
  await c.storage.put("win:p:tokentokentokentoken1", { email: "cy@x.test", first: "Cy", at: clock.t - 1000, exp: clock.t + 3600e3 });
  await c.storage.put("win:draws", [{ email: "ann@x.test", first: "Ann", at: T0 + 86400e3, q: "(2 × 3) + 10 − 1", a: 15 }]);
  await c.storage.put("win:v:2026-10-17", { visits: 120, signups: 30, confirmed: 25 }); await c.storage.put("win:v:2026-10-18", { visits: 80, signups: 20, confirmed: 15 });
  await c.storage.put("win:r:1234:abcd", 3);
  const cfg = await call(c, "/_win/cfg");
  assert.deepEqual([cfg.id, cfg.current, cfg.open, cfg.event, cfg.closesAt, cfg.previewKey, cfg.salt, cfg.mallow, cfg.art], [EXPO, true, true, "Atlantic Entertainment Expo", DEFAULT_CFG.closesAt, "oldkey12345x", undefined, true, "/win-entered.jpg"]);
  assert.deepEqual(await c.storage.get("win:cfg"), { salt: "oldsalt", previewKey: "oldkey12345x" }, "the shared record keeps only the shared bits");
  const list = await call(c, "/_win/list");
  assert.deepEqual(list.entries.map((e) => e.email), ["bo@x.test", "ann@x.test"]); assert.equal(list.pending, 1); assert.equal(list.draws[0].a, 15);
  assert.deepEqual(list.days, [{ day: "2026-10-18", visits: 80, signups: 20, confirmed: 15 }, { day: "2026-10-17", visits: 120, signups: 30, confirmed: 25 }]);
  assert.equal(await c.storage.get("win:e:ann@x.test"), undefined); assert.equal(await c.storage.get("win:draws"), undefined); assert.equal(await c.storage.get("win:v:2026-10-17"), undefined);
  assert.equal((await c.storage.get("win:p:tokentokentokentoken1")).c, EXPO, "a pending link made before the deploy still confirms into the right contest");
  assert.equal((await call(c, "/_win/verify", { token: "tokentokentokentoken1" })).entry.email, "cy@x.test");
  assert.equal(await c.storage.get("win:migrated"), clock.t);
  const stats = (await call(c, "/_win/contests")).contests[0].stats;
  assert.deepEqual([stats.confirmed, stats.onList, stats.visits, stats.signups, stats.draws], [3, 1, 200, 50, 1]);
  // a second DO instance (fresh mem) sees the flag and does nothing
  const c2 = { ...c, mem: {} };
  await c2.storage.put("win:e:late@x.test", { email: "late@x.test" });   // a stray legacy key after the move is left alone
  assert.equal((await call(c2, "/_win/list")).entries.length, 3);
  assert.ok(await c2.storage.get("win:e:late@x.test"));
});

test("public pages: holding while closed, preview, the form, the confirmation email, the link, the Shopify customer", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const net = fakeNet(); const env = envWith(c);
  const shopCalls = () => net.shop().filter((c) => !/currentAppInstallation/.test(c.body.query));   // the health probe's scope check aside
  const serve = (req, url) => serveWin(req, env, url, null, { fetchFn: net.f, now: () => clock.t });   // the test's clock, not the real one (the contest closed 2026-10-19)
  const key = (await call(c, "/_win/cfg")).previewKey;
  let r = await serve(...getReq("/win"));
  assert.equal(r.status, 200); let page = await r.text();
  assert.match(page, /Entries open soon/); assert.match(page, /the draw for <b>\$100<\/b> in store credit opens here/); assert.doesNotMatch(page, /<form/); assert.match(page, /Mallow Games/);
  assert.equal(r.headers.get("x-robots-tag"), "noindex");
  r = await serve(...getReq("/win?preview=" + key)); page = await r.text();
  assert.match(page, /<form method="post" action="\/win\?preview=/); assert.match(page, /Preview - not open to the public yet/);
  assert.equal((await serve(...getReq("/win?preview=wrong"))).status, 200); assert.doesNotMatch(await (await serve(...getReq("/win?preview=wrong"))).text(), /<form/);
  assert.equal((await serve(...formReq("/win", [["first", "A"], ["email", "a@x.test"], ["rules", "1"], ["consent", "1"]]))).status, 403, "closed: no entries");
  // another contest, not current: only the preview key + its id reach it; its words, its Mallow switch
  const up = (await call(c, "/_win/contests/new", { event: "Launch weekend", place: "Exor Games", dates: "Nov 7–8", prize: "A booster box", drawText: "Monday", mallow: false })).contest;
  assert.equal((await serve(...getReq("/win?c=" + up.id))).status, 200); assert.match(await (await serve(...getReq("/win?c=" + up.id))).text(), /Atlantic Entertainment Expo/, "without the key the current contest shows");
  r = await serve(...getReq(`/win?preview=${key}&c=${up.id}`)); page = await r.text();
  assert.match(page, /Launch weekend/); assert.doesNotMatch(page, /Mallow/); assert.match(page, /Win <b>A booster box<\/b><\/h1>/); assert.doesNotMatch(page, /in store credit/); assert.match(page, new RegExp(`action="/win\\?preview=${key}&amp;c=${up.id}"`));
  assert.match(page, /Yes - email me Exor Games news/); assert.match(page, /href="\/win\/rules\?preview=/);
  assert.match(await (await serve(...getReq(`/win/rules?preview=${key}&c=${up.id}`))).text(), /Launch weekend draw · Exor Games<\/p>/);
  r = await serve(...formReq(`/win?preview=${key}&c=${up.id}`, [["first", "Pre"], ["email", "pre@x.test"], ["rules", "1"], ["consent", "1"]]));
  assert.equal(r.status, 200); assert.match(await r.text(), /Check your email, Pre/);
  const preMail = net.resend().at(-1); assert.doesNotMatch(preMail.body.html, /Mallow/); assert.match(preMail.body.subject, /win A booster box at Exor Games/);
  r = await serve(...getReq(linkIn(preMail).replace("https://exorgames.com", ""))); page = await r.text();
  assert.equal(r.status, 200); assert.match(page, /You're in, Pre/); assert.match(page, /Launch weekend/); assert.doesNotMatch(page, /win-entered\.jpg/); assert.doesNotMatch(page, /Sell your video games/);
  const upList = await call(c, "/_win/list?c=" + up.id); assert.equal(upList.entries[0].test, true, "made from the preview while closed"); assert.equal((await call(c, "/_win/list")).entries.length, 0, "nothing landed in the Expo");
  await call(c, "/_win/contests/delete", { c: up.id }); net.calls.length = 0;   // the rest of the test counts emails and Shopify calls from zero
  assert.equal((await serve(...getReq("/win/health"))).status, 200);
  const hp = await (await serve(...getReq("/win/health?probe=1"))).json(); assert.equal(hp.shopify, true); assert.equal(hp.customersWrite, true); assert.equal(hp.email, true);
  await call(c, "/_win/cfg", { open: true });
  assert.deepEqual((await call(c, "/_win/list")).days, [], "the holding page and the preview never count");
  r = await serve(...getReq("/win")); page = await r.text();
  assert.deepEqual((await call(c, "/_win/list")).days, [{ day: "2026-10-17", visits: 1, signups: 0, confirmed: 0 }], "a live load counts");
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
  r = await serve(...getReq(link.replace("https://exorgames.com", "")));
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
  r = await serve(...getReq(link.replace("https://exorgames.com", "")));
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
  const serveWith = (e, n, [req, url]) => serveWin(req, e, url, null, { fetchFn: n.f, now: () => clock.t });
  r = await serveWith(env, down, formReq("/win", [["first", "Zed"], ["email", "zed@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.10"));
  assert.equal(r.status, 502); assert.match(await r.text(), /could not send the confirmation email/);
  // rules page, unknown path, expired wording
  assert.match(await (await serve(...getReq("/win/rules"))).text(), /skill-testing question/);
  assert.equal((await serve(...getReq("/win/nothing"))).status, 404);
  // no Shopify token: the entry is kept and marked
  const env2 = envWith(c, { SHOPIFY_ADMIN_TOKEN: "" }); const net2 = fakeNet();
  r = await serveWith(env2, net2, formReq("/win", [["first", "Kay"], ["email", "kay@x.test"], ["rules", "1"], ["consent", "1"]], "203.0.113.11"));
  r = await serveWith(env2, net2, getReq(linkIn(net2.resend()[0]).replace("https://exorgames.com", "")));
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
  assert.equal((await serve("/9pocket/win/c/" + EXPO, staff)).status, 403);
  assert.equal((await serve("/9pocket/win/control", staff, { action: "open" })).status, 403);
  // the list: one contest, current, closed
  let r = await serve("/9pocket/win", admin); assert.equal(r.status, 200); let page = await r.text();
  assert.match(page, /<h1>Contests<\/h1>/); assert.match(page, new RegExp(`href="/9pocket/win/c/${EXPO}"><b>Atlantic Entertainment Expo</b></a> <span class="badge cur">current</span>`)); assert.match(page, /CLOSED/); assert.match(page, /New contest/); assert.match(page, /name="event" value="" maxlength="120" required/); assert.doesNotMatch(page, /Make current/, "the only contest is the current one");
  assert.match(page, /name="current" value="1" checked/, "nothing is open, so a new one may take the address at once");
  assert.equal((await serve("/9pocket/win/c/nope", admin)).status, 404); assert.equal((await serve("/9pocket/win/c/nope/export.csv", admin)).status, 404);
  // one contest
  const C = "/9pocket/win/c/" + EXPO;
  r = await serve(C, admin); assert.equal(r.status, 200); page = await r.text();
  assert.match(page, /<h1>Atlantic Entertainment Expo<\/h1>/); assert.match(page, /← All contests/); assert.match(page, /current - at exorgames\.com\/win/); assert.match(page, /No visits counted yet/); assert.match(page, /CLOSED/); assert.match(page, /Open the contest/); assert.match(page, /Shopify customers: no token on the worker/); assert.match(page, /Omnisend takes its list from Shopify/);
  assert.match(page, /https:\/\/exorgames\.com\/win<\/code>/, "the short address the QR carries"); assert.match(page, /\/win-qr\.png/); assert.match(page, /\/win-qr\.svg/); assert.match(page, /\/win-sign\.html/); assert.match(page, new RegExp(`href="/9pocket/win/c/${EXPO}/export\\.csv"`)); assert.match(page, /\?preview=/); assert.match(page, /No confirmed entries yet/);
  assert.match(page, /value="2026-10-18T23:59"/); assert.match(page, /name="consentRequired" value="1" checked/); assert.match(page, /name="mallow" value="1" checked/); assert.match(page, new RegExp(`<input type="hidden" name="action" value="open"><input type="hidden" name="c" value="${EXPO}">`), "every form says which contest");
  // open
  r = await serve("/9pocket/win/control", admin, { action: "open", c: EXPO }); assert.equal(r.status, 303); assert.match(loc(r), new RegExp(`^/9pocket/win/c/${EXPO}\\?msg=The contest is OPEN`));
  assert.equal((await call(c, "/_win/cfg")).open, true);
  // settings (Atlantic time in, consent box off: the hidden "0" arrives alone)
  r = await serve("/9pocket/win/control", admin, { action: "cfg", c: EXPO, event: "AEE", place: "Moncton", dates: "Oct 17-18", prize: "$100 in store credit", closes: "2026-10-18T22:00", drawText: "Monday", tags: "a, b", consentRequired: "0", mallow: ["0", "1"] });
  const cfg = await call(c, "/_win/cfg");
  assert.deepEqual([cfg.event, cfg.closesAt, cfg.consentRequired, cfg.tags, cfg.mallow], ["AEE", Date.UTC(2026, 9, 19, 1, 0), false, "a, b", true]);
  await serve("/9pocket/win/control", admin, { action: "cfg", c: EXPO, consentRequired: ["0", "1"] });
  assert.equal((await call(c, "/_win/cfg")).consentRequired, true);
  // a new contest from the form: created closed, not current while the Expo is open; its own page; the list shows both
  r = await serve("/9pocket/win/control", admin, { action: "new", event: "Launch weekend", place: "Exor Games", dates: "Nov 7–8", prize: "A booster box", closes: "2026-11-08T23:59", drawText: "Monday, November 9", tags: "Launch", consentRequired: ["0", "1"], mallow: "0" });
  assert.equal(r.status, 303); assert.match(loc(r), /^\/9pocket\/win\/c\/launch-weekend-2026\?msg=Launch weekend is created, closed\. Check/);
  r = await serve("/9pocket/win/control", admin, { action: "new", event: "", prize: "x" }); assert.match(loc(r), /^\/9pocket\/win\?err=The contest needs a name/);
  r = await serve("/9pocket/win/c/launch-weekend-2026", admin); page = await r.text();
  assert.match(page, /<h1>Launch weekend<\/h1>/); assert.match(page, /Make current<\/button>/); assert.match(page, /not the contest at <code>https:\/\/exorgames\.com\/win<\/code> yet/); assert.match(page, /\?preview=[A-Za-z0-9_-]+&amp;c=launch-weekend-2026/); assert.match(page, /Exor Games alone/); assert.match(page, /name="mallow" value="1"> Show/);
  r = await serve("/9pocket/win", admin); page = await r.text();
  assert.match(page, /<b>Launch weekend<\/b><\/a><br>/); assert.match(page, /<b>AEE<\/b><\/a> <span class="badge cur">current<\/span>/); assert.match(page, /exorgames\.com\/win → AEE: OPEN/); assert.match(page, /name="current" value="1"> Put it at exorgames\.com\/win right away \(<b>AEE is open there now<\/b>/);
  assert.equal((page.match(/Make current<\/button>/g) || []).length, 1, "only the one that is not current"); assert.match(page, /Remove<\/button>/);
  // the sample email for the upcoming one carries its id in the preview link
  r = await serve("/9pocket/win/control", admin, { action: "test_email", c: "launch-weekend-2026" }); assert.match(loc(r), /sample confirmation email/);
  assert.match(net.resend().at(-1).body.html, /href="https:\/\/exorgames\.com\/win\?preview=[A-Za-z0-9_-]+&amp;c=launch-weekend-2026"/); assert.doesNotMatch(net.resend().at(-1).body.html, /Mallow/);
  // the current one cannot be removed; the other can
  r = await serve("/9pocket/win/control", admin, { action: "remove_contest", c: EXPO }); assert.match(loc(r), /^\/9pocket\/win\?err=That is the current contest/);
  r = await serve("/9pocket/win/control", admin, { action: "remove_contest", c: "launch-weekend-2026" }); assert.match(loc(r), /^\/9pocket\/win\?msg=Launch weekend is removed\./);
  assert.equal((await call(c, "/_win/contests")).contests.length, 1);
  // sample email to the admin
  r = await serve("/9pocket/win/control", admin, { action: "test_email" }); assert.match(loc(r), /sample confirmation email/);
  assert.deepEqual(net.resend().at(-1).body.to, ["boss@x.test"]); net.calls.splice(0, net.calls.length - 1); assert.match(net.resend()[0].body.html, /sample sent from the 9Pocket admin screen/); assert.match(net.resend()[0].body.html, /Boss/); assert.match(net.resend()[0].body.html, /href="https:\/\/exorgames\.com\/win\?preview=/);
  // nothing to draw yet
  r = await serve("/9pocket/win/control", admin, { action: "draw" }); assert.match(loc(r), /err=No confirmed entries/);
  // two confirmed entries (one without consent), one test entry
  const mk = async (email, first, consent, preview) => { const e = await call(c, "/_win/enter", { email, first, last: "=SUM(1)", consent, preview }); await call(c, "/_win/verify", { token: e.token }); };
  await call(c, "/_win/cfg", { open: false }); await mk("t@x.test", "Tess", true, true); await call(c, "/_win/cfg", { open: true });
  await mk("a@x.test", "Ann", true); await mk("b@x.test", "Bo", false);
  await call(c, "/_win/hit", { kind: "visit" }); await call(c, "/_win/hit", { kind: "visit" });
  r = await serve(C, admin); page = await r.text();
  assert.match(page, /<b>2<\/b><br><span class="muted">visits today \(2026-10-17\)/); assert.match(page, /<tr><td>2026-10-17<\/td><td class="n">2<\/td><td class="n">2<\/td><td class="n">2<\/td><td class="n">100%<\/td><td class="n">100%<\/td><\/tr>/, "two real sign-ups confirmed, the test one not counted");
  assert.match(page, /<b>2<\/b><br><span class="muted">confirmed entries/); assert.match(page, /<b>1<\/b><br><span class="muted">test entries/);
  assert.match(page, /waiting/, "made straight in the DO: Shopify never ran"); assert.match(page, /Retry<\/button>/); assert.match(page, /no consent/);
  // retry once the token is there
  const env2 = envWith(c);
  r = await serve("/9pocket/win/control", admin, { action: "retry", email: "a@x.test" }, env2); assert.match(loc(r), /msg=Subscribed as a Shopify customer/);
  assert.equal(net.shop().length, 2); assert.equal((await call(c, "/_win/list")).entries.find((e) => e.email === "a@x.test").shopify.status, "subscribed");
  r = await serve(C, admin, null, env2); page = await r.text(); assert.match(page, /the token can create and subscribe customers/); assert.match(page, /customers\/123" target="_blank"/);
  r = await serve("/9pocket/win/control", admin, { action: "retry", email: "b@x.test" }, env2); assert.match(loc(r), /did not tick the email box/);
  // the draw never picks the test entry; the winner email carries the question
  // staff first: Bo is excluded, so the draw can only land on Ann; nothing is emailed by a draw
  r = await serve("/9pocket/win/control", admin, { action: "exclude", email: "b@x.test" }); assert.match(loc(r), /msg=Bo .* is excluded from the draw/);
  r = await serve(C, admin); page = await r.text(); assert.match(page, /<span class="badge off">excluded<\/span>/); assert.match(page, /Include<\/button>/); assert.match(page, /Drawing never emails anyone/); assert.match(page, /<b>1<\/b><br><span class="muted">excluded from the draw/);
  const sentBefore = net.resend().length;
  r = await serve("/9pocket/win/control", admin, { action: "draw" }); assert.match(loc(r), /msg=Drawn: Ann .*nothing has been emailed/);
  assert.equal(net.resend().length, sentBefore, "a draw sends no email");
  let draws = (await call(c, "/_win/list")).draws; assert.equal(draws.length, 1); assert.equal(draws[0].email, "a@x.test");
  // void it as staff: the card says so, the email button goes, the entry is excluded; include Bo again and draw him
  r = await serve("/9pocket/win/control", admin, { action: "void", email: "a@x.test" }); assert.match(loc(r), /msg=Ann .*draw is voided/);
  r = await serve(C, admin); page = await r.text(); assert.match(page, /voided .* by boss@x\.test - staff/); assert.doesNotMatch(page, /<button type="submit" class="primary">Email the winner<\/button>/, "no email button on a voided draw");
  r = await serve("/9pocket/win/control", admin, { action: "email_winner", email: "a@x.test" }); assert.match(loc(r), /err=No such draw/);
  r = await serve("/9pocket/win/control", admin, { action: "include", email: "b@x.test" }); assert.match(loc(r), /back in the draw/);
  r = await serve("/9pocket/win/control", admin, { action: "draw" }); assert.match(loc(r), /msg=Drawn: Bo /);
  draws = (await call(c, "/_win/list")).draws; assert.equal(draws.length, 2); assert.equal(draws[1].email, "b@x.test"); assert.notEqual(draws[1].email, "t@x.test");
  r = await serve("/9pocket/win/control", admin, { action: "email_winner", email: draws[1].email }); assert.match(loc(r), /winner has been emailed/);
  const wm = net.resend().at(-1); assert.deepEqual(wm.body.to, [draws[1].email]); assert.match(wm.body.subject, /You won our AEE draw!/); assert.ok(wm.body.html.includes(draws[1].q + " = ?"));
  r = await serve(C, admin); page = await r.text();
  assert.match(page, /winner emailed/); assert.match(page, /Skill-testing question: <b>/); assert.match(page, new RegExp("answer <b>" + draws[1].a + "</b>"));
  // CSV: text/csv, formulas defused
  r = await serve("/9pocket/win/export.csv", admin); assert.match(r.headers.get("content-type"), /text\/csv/); assert.match(r.headers.get("content-disposition"), new RegExp(`filename="${EXPO}-entries\\.csv"`));
  const csv = await r.text(); assert.equal(await (await serve(C + "/export.csv", admin)).text(), csv, "the same file by the contest's own address");
  assert.match(csv, /^email,first_name,last_name,email_consent,interests,entered_at,confirmed_at,shopify_customer,test\r\n/); assert.match(csv, /a@x\.test,Ann,'=SUM\(1\),yes,,2026-10-17T15:00:00\.000Z,2026-10-17T15:00:00\.000Z,subscribed,\r\n/); assert.match(csv, /t@x\.test,.*,test\r\n/);
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
  const hold = renderHolding(cfg, {}); assert.match(hold, /Entries open soon/); assert.match(hold, /Spend it at Exor Games or on video games from Mallow Games/); assert.doesNotMatch(hold, /<form/);
  assert.match(renderHolding(cfg, { ended: true }), /Entries have closed/);
  assert.match(renderVerified(cfg, { first: "Ann", already: true }), /already confirmed/);
  const rules = renderRules(cfg, {}); assert.match(rules, /excluding Quebec/); assert.match(rules, /51 Allen Street/); assert.match(rules, /subscribed customer/); assert.match(rules, /seven \(7\) days/);
  const ve = buildVerifyEmail({ first: "Ann", link: "https://w/win/verify?t=abc", cfg, origin: "https://w" });
  assert.match(ve.html, /href="https:\/\/w\/win\/verify\?t=abc"/); assert.match(ve.text, /https:\/\/w\/win\/verify\?t=abc/); assert.match(ve.html, /Didn't enter\? Ignore this email/);
  // the owner's Mallow Games graphic (2026-10-16) rides in both emails, on the confirmed page and on the landing card
  assert.match(ve.html, /src="https:\/\/exor-binder\.nevski\.workers\.dev\/win-mallow\.jpg"/); assert.match(ve.text, /mallowgames\.com\/sell-your-games\//);
  assert.match(renderVerified(cfg, { first: "Ann" }), /<img class="entered" src="\/win-entered\.jpg"/); assert.match(landing, /src="\/win-mallow\.jpg"/);
  const we = buildWinnerEmail({ first: "Ann", question: "(2 × 3) + 10 − 1", cfg }); assert.match(we.html, /\(2 × 3\) \+ 10 − 1 = \?/); assert.match(we.text, /Reply within 7 days/); assert.match(we.html, /win-mallow\.jpg/);
  const adm = renderWinAdmin({ cfg: { ...cfg, id: "expo", previewKey: "pk", current: true }, entries: [], draws: [], pending: 0, now: T0 }, { user: { email: "b@x", role: "admin" }, origin: "https://w", emailOn: true, shopifyOn: true, customersWrite: true, closesInput: "2026-10-18T23:59" });
  assert.match(adm, /OPEN/); assert.match(adm, /https:\/\/w\/win\?preview=pk"/); assert.match(adm, /the token can create and subscribe customers/); assert.match(adm, /Close the contest/); assert.match(adm, /with Mallow Games/);
  // Mallow Games off, a prize that is not store credit: no sister-shop copy anywhere, no credit wording, no Expo graphic
  const solo = { ...cfg, mallow: false, art: "", prize: "A Prismatic Evolutions booster box", event: "Launch weekend", place: "Exor Games" };
  for (const html of [renderLanding(solo, {}), renderHolding(solo, {}), renderVerified(solo, { first: "Ann" }), renderRules(solo, {}), buildVerifyEmail({ first: "Ann", link: "https://w/win/verify?t=abc", cfg: solo }).html, buildVerifyEmail({ first: "Ann", link: "x", cfg: solo }).text, buildWinnerEmail({ first: "Ann", question: "1 + 1", cfg: solo }).html, buildWinnerEmail({ first: "Ann", question: "1 + 1", cfg: solo }).text]) {
    const text = html.replace(/<style>[\s\S]*?<\/style>/, "");   // the stylesheet keeps its .mallow rule
    assert.doesNotMatch(text, /Mallow|mallowgames/); assert.doesNotMatch(text, /store credit|gift card/); assert.doesNotMatch(text, /win-entered/);
  }
  assert.match(renderLanding(solo, {}), /<h1>Win <b>A Prismatic Evolutions booster box<\/b><\/h1>/); assert.match(renderLanding(solo, {}), /<section class="split one">/); assert.match(renderRules(solo, {}), /One \(1\) prize: A Prismatic Evolutions booster box\. No cash value/);
  assert.match(buildWinnerEmail({ first: "Ann", question: "1 + 1", cfg: solo }).text, /arrange your prize with you by email/); assert.match(buildVerifyEmail({ first: "Ann", link: "x", cfg: solo }).subject, /win A Prismatic Evolutions booster box at Exor Games/);
  assert.match(renderRules(cfg, {}), /including video games from Mallow Games/); assert.match(renderRules({ ...cfg, mallow: false }, {}), /approximate retail value \$100 CAD\), redeemable at ExorGames\.com and in store on anything we sell\. No cash/);
  // a swept contest on its page: the summary, no entries table
  const swept = renderWinAdmin({ cfg: { ...cfg, id: "old", open: false, current: false, summary: { confirmed: 40, test: 2, onList: 30, excluded: 1, draws: 2, winners: 1, visits: 500, signups: 60, sweptAt: T0 } }, entries: [], draws: [], pending: 0, now: T0, days: [] }, { origin: "https://w" });
  assert.match(swept, /ENDED - entries removed after 90 days/); assert.match(swept, /<b>40<\/b><br><span class="muted">confirmed entries/); assert.match(swept, /1 winner had been drawn/); assert.match(swept, /The entries were removed after the retention period/); assert.match(swept, /Make current<\/button>/);
  // the list
  const lst = renderContests({ current: "a", now: T0, contests: [{ id: "a", event: "Expo", place: "Moncton", dates: "Oct", prize: "$100 in store credit", open: true, closesAt: T0 + 1e6, stats: { confirmed: 3, pending: 1, onList: 2, winners: 0, visits: 9, signups: 4 } }, { id: "b", event: "Old", place: "", dates: "", prize: "$50", open: false, closesAt: T0 - 1e9, summary: { confirmed: 7 }, stats: { confirmed: 7, pending: 0, onList: 5, winners: 1, visits: 90, signups: 10 } }] }, { origin: "https://w", keepDays: 90 });
  assert.match(lst, /href="\/9pocket\/win\/c\/a"><b>Expo<\/b><\/a> <span class="badge cur">current<\/span>/); assert.match(lst, /exorgames\.com\/win → Expo: OPEN/); assert.match(lst, /ENDED · entries removed/); assert.match(lst, /<td class="n">90<\/td><td class="n">10<\/td><td class="n">7<\/td><td class="n">0<\/td><td class="n">5<\/td><td class="n">1<\/td>/);
  assert.match(lst, /name="c" value="b"><button type="submit" class="dim">Make current/); assert.match(lst, /Remove Old and its 7 confirmed entries\?/); assert.doesNotMatch(lst, /name="c" value="a"><button type="submit" class="dim">Make current/); assert.match(lst, /removed 90 days after a contest closes/);
});
