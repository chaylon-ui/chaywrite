// Discord "last seen" (owner 2026-10-20, "can you make a last-seen bot on our discord server?").
import { test } from "node:test";
import assert from "node:assert/strict";
import { seenDoFetch, discordSeenTick, serveInteraction, serveDiscordSeen, pauseSeen, resumeSeen, rowOf, ago, newerId, olderId, COMMANDS, COMMANDS_VERSION, SEEN_DO } from "../src/discord-seen.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);
const ORIGIN = "https://w.example";

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) { if (o && o.prefix && !k.startsWith(o.prefix)) continue; out.set(k, this.m.get(k)); if (o && o.limit && out.size >= o.limit) break; } return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
}
const cx = (clock) => ({ storage: new MemStorage(), env: {}, now: () => clock.t, log: () => {} });
async function call(c, path, body) {
  const url = new URL(ORIGIN + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  return (await seenDoFetch(c, req, url)).json();
}
// env whose ROOM is the one discord-seen DO
function envWith(c, extra) {
  return { DISCORD_BOT_TOKEN: "bot-token", DISCORD_GUILD_ID: "g1", ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n !== SEEN_DO) return new Response("wrong store", { status: 404 }); return seenDoFetch(c, req, url); } }) }, ...(extra || {}) };
}

// A pretend Discord: messages per channel, ids are snowflake-like numbers.
const iso = (ms) => new Date(ms).toISOString();
const msg = (id, author, at, extra) => ({ id: String(id), channel_id: "c", author: { id: author, username: author + "-name", global_name: author === "u1" ? "Ada" : null }, timestamp: iso(at), ...(extra || {}) });
function fakeDiscord(world) {
  const calls = [];
  const f = async (u, init) => {
    const url = new URL(u); const m = (init && init.method) || "GET"; const p = url.pathname.replace(/^\/api\/v10/, "");
    calls.push(m + " " + p + (url.search || ""));
    const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (p === "/guilds/g1/channels") return ok(world.channels);
    if (p === "/guilds/g1/threads/active") return ok({ threads: world.threads });
    if (p === "/oauth2/applications/@me") return ok({ id: "app1" });
    if (m === "PUT" && p === "/applications/app1/guilds/g1/commands") { world.registered = JSON.parse(init.body); return ok(world.registered); }
    const mm = /^\/channels\/([^/]+)\/messages$/.exec(p);
    if (mm) {
      const ch = world.messages[mm[1]];
      if (!ch) return new Response(JSON.stringify({ message: "Missing Access", code: 50001 }), { status: 403 });
      const after = url.searchParams.get("after"), before = url.searchParams.get("before");
      let list = ch.slice().sort((a, b) => Number(b.id) - Number(a.id));   // Discord: newest first
      if (after) list = list.filter((x) => Number(x.id) > Number(after));
      if (before) list = list.filter((x) => Number(x.id) < Number(before));
      return ok(list.slice(0, 100));
    }
    return new Response(JSON.stringify({ message: "no such route " + p }), { status: 404 });
  };
  return { f, calls };
}

test("helpers: rows skip bots, webhooks and timeless messages; snowflakes compare as numbers; ago reads naturally", () => {
  const ch = { id: "c1", name: "general" };
  assert.deepEqual(rowOf(msg(5, "u1", T0), ch), { id: "u1", name: "Ada", at: T0, ch: "c1", chName: "general" });
  assert.equal(rowOf(msg(5, "u1", T0, { author: { id: "b1", username: "bot", bot: true } }), ch), null);
  assert.equal(rowOf(msg(5, "u1", T0, { webhook_id: "w" }), ch), null);
  assert.equal(rowOf({ id: "5", author: { id: "u1" }, timestamp: "garbage" }, ch), null);
  assert.equal(newerId("9", "10"), "10"); assert.equal(olderId("9", "10"), "9"); assert.equal(newerId(undefined, "3"), "3"); assert.equal(olderId("3", null), "3");
  assert.equal(ago(T0 - 20e3, T0), "just now"); assert.equal(ago(T0 - 60e3, T0), "1 minute ago"); assert.equal(ago(T0 - 5 * 60e3, T0), "5 minutes ago");
  assert.equal(ago(T0 - 3 * 3600e3, T0), "3 hours ago"); assert.equal(ago(T0 - 47 * 3600e3, T0), "47 hours ago"); assert.equal(ago(T0 - 3 * DAY, T0), "3 days ago");
  assert.deepEqual(COMMANDS.map((c) => c.name), ["lastseen", "inactive"]);
  for (const c of COMMANDS) assert.equal(c.default_member_permissions, String(1n << 40n), "moderators and admins see the commands by default");
});

test("DO: record keeps the newest post per member and counts the rest; list, user, cursors, sweep, health", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  let r = await call(c, "/_seen/record", { rows: [
    { id: "u1", name: "Ada", at: T0 - 2 * DAY, ch: "c1", chName: "general" },
    { id: "u1", name: "Ada", at: T0 - DAY, ch: "c2", chName: "trades" },
    { id: "u2", name: "Bob", at: T0 - 40 * DAY, ch: "c1", chName: "general" },
  ], cursors: { c1: { newest: "100", name: "general" } } });
  assert.deepEqual(r, { ok: true, updated: 2 });
  let u = (await call(c, "/_seen/user?id=u1")).row;
  assert.equal(u.at, T0 - DAY); assert.equal(u.ch, "c2"); assert.equal(u.n, 2); assert.equal(u.first, T0 - 2 * DAY);
  await call(c, "/_seen/record", { rows: [{ id: "u1", name: "Ada", at: T0 - 3 * DAY, ch: "c1", chName: "general" }] });
  u = (await call(c, "/_seen/user?id=u1")).row;
  assert.equal(u.at, T0 - DAY, "an older post never moves last-seen back"); assert.equal(u.n, 3, "but it is counted");
  assert.deepEqual((await call(c, "/_seen/cursors")).cursors, { c1: { newest: "100", name: "general" } });
  let l = await call(c, "/_seen/list");
  assert.equal(l.total, 2); assert.deepEqual(l.rows.map((x) => x.id), ["u2", "u1"], "quietest first");
  l = await call(c, "/_seen/list?days=30");
  assert.deepEqual(l.rows.map((x) => x.id), ["u2"]);
  assert.equal((await call(c, "/_seen/user?id=nobody")).row, null);
  clock.t = T0 + 700 * DAY;
  assert.deepEqual((await call(c, "/_seen/sweep", {})).counts, { members: 1, departed: 0 }, "u2's last post is now past 730 days");
  assert.equal((await call(c, "/_seen/list")).total, 1);
  const h = await call(c, "/_seen/health");
  assert.equal(h.tracked, 1); assert.equal(h.startedAt, null, "no poll yet");
  await call(c, "/_seen/meta", { lastPollAt: clock.t });
  assert.equal((await call(c, "/_seen/health")).startedAt, clock.t, "the first meta write stamps the start");
});

test("poll: first look + backfill, bots skipped, a channel the bot cannot read is retried a day later, commands registered once", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const world = {
    channels: [{ id: "c1", type: 0, name: "general" }, { id: "c2", type: 0, name: "staff-only" }, { id: "v1", type: 2, name: "voice" }, { id: "f1", type: 15, name: "forum" }],
    threads: [{ id: "t1", type: 11, name: "deck-help" }, { id: "t2", type: 12, name: "private" }],
    messages: { c1: [], t1: [msg(5001, "u5", T0 - 3 * DAY), msg(5002, "u5", T0 - 2 * DAY), msg(5003, "u1", T0 - 2 * DAY + 3600e3)] },
  };
  // general: 250 messages, ids 1001..1250, one every 10 minutes ending an hour ago; u1/u2 alternate, every 10th is a bot
  for (let i = 0; i < 250; i++) world.messages.c1.push(msg(1001 + i, i % 2 ? "u2" : "u1", T0 - 3600e3 - (249 - i) * 600e3, i % 10 === 9 ? { author: { id: "bot1", username: "ReStock", bot: true } } : {}));
  const d = fakeDiscord(world);
  const env = envWith(c);
  const out = await discordSeenTick(env, { now: T0, fetchFn: d.f });
  assert.equal(out.polled, 3, "general, staff-only, the public thread; voice, forum and the private thread are not channels to read");
  assert.equal(out.denied, 1);
  assert.equal(out.rows, 90 + 3, "the latest page of general minus its bots, plus the thread");
  assert.equal(out.registered, true); assert.equal(out.error, null);
  assert.deepEqual(world.registered.map((x) => x.name), ["lastseen", "inactive"]);
  let meta = (await call(c, "/_seen/meta")).meta;
  assert.equal(meta.commandsVersion, COMMANDS_VERSION); assert.equal(meta.appId, "app1"); assert.equal(meta.polls, 1); assert.equal(meta.channels, 3); assert.equal(meta.startedAt, T0);
  let cur = (await call(c, "/_seen/cursors")).cursors;
  assert.equal(cur.c1.newest, "1250"); assert.equal(cur.c1.oldest, "1151"); assert.equal(cur.c1.backDone, false); assert.equal(cur.c1.backPages, 1);
  assert.equal(cur.c2.deniedAt, T0); assert.equal(cur.t1.backDone, true, "a channel with fewer than 100 messages is fully read at once");
  let u1 = (await call(c, "/_seen/user?id=u1")).row;
  assert.equal(u1.at, T0 - 3600e3 - 600e3, "u1's newest post in general is id 1249 (1250 is a bot's slot)"); assert.equal(u1.ch, "c1"); assert.equal(u1.name, "Ada");
  // too soon: nothing happens
  assert.deepEqual(await discordSeenTick(env, { now: T0 + 60e3, fetchFn: d.f }), { skipped: "not due" });
  // five minutes on: two new posts in general, two older pages backfilled, the denied channel left alone, no second registration
  world.messages.c1.push(msg(1251, "u3", T0 + 4 * 60e3), msg(1252, "u3", T0 + 4.5 * 60e3));
  const n1 = d.calls.length;
  const out2 = await discordSeenTick(env, { now: T0 + 5 * 60e3, fetchFn: d.f });
  assert.equal(out2.polled, 2); assert.equal(out2.denied, 1); assert.equal(out2.registered, false);
  const since = d.calls.slice(n1);
  assert.ok(since.some((x) => x.includes("/channels/c1/messages?limit=100&after=1250")), "new posts after the cursor");
  assert.ok(since.some((x) => x.includes("/channels/c1/messages?limit=100&before=1151")) && since.some((x) => x.includes("before=1051")), "two backfill pages");
  assert.ok(!since.some((x) => x.includes("/channels/c2/")), "the denied channel waits a day");
  assert.ok(!since.some((x) => x.startsWith("PUT")), "commands are registered once per version");
  cur = (await call(c, "/_seen/cursors")).cursors;
  assert.equal(cur.c1.newest, "1252"); assert.equal(cur.c1.oldest, "1001"); assert.equal(cur.c1.backDone, true, "the oldest page came back short");
  assert.equal((await call(c, "/_seen/user?id=u3")).row.at, T0 + 4.5 * 60e3);
  assert.equal((await call(c, "/_seen/user?id=u1")).row.n, 126, "all 250 of general are read now: u1 holds the even slots (125; bot slots are odd) plus one thread post");
  assert.equal((await call(c, "/_seen/user?id=u1")).row.first, T0 - 2 * DAY + 3600e3, "the oldest post known: the thread one, older than general's first page");
  // a day later the denied channel is tried again; a Discord outage is recorded, not thrown
  world.messages.c2 = [msg(9001, "u7", T0 + DAY - 60e3)];
  const out3 = await discordSeenTick(env, { now: T0 + DAY + 60e3, fetchFn: d.f });
  assert.equal(out3.denied, 0); assert.equal((await call(c, "/_seen/user?id=u7")).row.ch, "c2");
  const out4 = await discordSeenTick(env, { now: T0 + 2 * DAY, fetchFn: async () => new Response("{\"message\":\"down\"}", { status: 500 }) });
  assert.match(out4.error, /discord 500/);
  meta = (await call(c, "/_seen/meta")).meta;
  assert.match(meta.lastError, /discord 500/); assert.equal(meta.lastPollAt, T0 + 2 * DAY);
  assert.equal(await discordSeenTick({ ROOM: env.ROOM }), null, "no bot token: nothing runs");
  // pause (owner: "just cancel the bot for now"): commands removed, polls skipped; resume polls at once and registers again
  world.registered = null;
  const n2 = d.calls.length;
  const paused = await pauseSeen(env, d.f);
  assert.equal(paused.paused, true); assert.equal(paused.commandsRemoved, true); assert.deepEqual(world.registered, [], "the guild's command list is emptied");
  assert.ok(paused.gateway && paused.gateway.error, "no gateway store in this test: reported, not fatal");
  assert.deepEqual(await discordSeenTick(env, { now: T0 + 3 * DAY, fetchFn: d.f }), { skipped: "paused" });
  assert.equal(d.calls.length, n2 + 1, "only the PUT; nothing was read while paused");
  let h = await call(c, "/_seen/health"); assert.equal(h.paused, true); assert.ok(h.pausedAt > 0);
  const resumed = await resumeSeen(env, d.f);
  assert.equal(resumed.paused, false); assert.equal(resumed.tick.registered, true); assert.deepEqual(world.registered.map((x) => x.name), ["lastseen", "inactive"]);
  h = await call(c, "/_seen/health"); assert.equal(h.paused, false);
});

test("interactions: signed by Discord's key or refused; ping, /lastseen, /inactive, unknown member, a bot", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const pub = [...new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const env = envWith(c, { DISCORD_PUBLIC_KEY: pub });
  await call(c, "/_seen/meta", { lastPollAt: T0 - 60e3 });
  await call(c, "/_seen/record", { rows: [{ id: "111", name: "Ada", at: T0 - 2 * DAY, ch: "c1", chName: "general" }, { id: "222", name: "Bob", at: T0 - 45 * DAY, ch: "c2", chName: "trades" }, { id: "333", name: "Cy", at: T0 - 100 * DAY, ch: "c1", chName: "general" }] });
  const signed = async (body, tamper) => {
    const text = JSON.stringify(body), ts = String(Math.floor(T0 / 1000));
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(ts + text)));
    const hexSig = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
    const url = new URL(ORIGIN + "/discord-seen/interactions");
    return serveInteraction(new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-signature-ed25519": tamper ? hexSig.replace(/^../, "00") : hexSig, "x-signature-timestamp": ts }, body: text }), env, url);
  };
  let r = await signed({ type: 1 });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { type: 1 });
  assert.equal((await signed({ type: 1 }, true)).status, 401, "a tampered signature");
  const bare = new URL(ORIGIN + "/discord-seen/interactions");
  assert.equal((await serveInteraction(new Request(bare, { method: "POST", body: "{}" }), env, bare)).status, 401, "no signature");
  assert.equal((await serveInteraction(new Request(bare, { method: "POST", body: "{}" }), envWith(c), bare)).status, 501, "no public key on the worker");
  assert.equal((await serveInteraction(new Request(bare), env, bare)).status, 405);
  const cmd = (name, options, resolved) => ({ type: 2, data: { name, options, resolved }, member: { user: { id: "999" } }, guild_id: "g1" });
  r = await signed(cmd("lastseen", [{ name: "member", type: 6, value: "111" }], { users: { 111: { id: "111", username: "ada" } } }));
  let j = await r.json();
  assert.equal(j.type, 4); assert.equal(j.data.flags, 64, "private to the asker"); assert.deepEqual(j.data.allowed_mentions, { parse: [] }, "nobody is pinged");
  assert.match(j.data.content, /^<@111>: Online status is not being tracked yet \(the gateway connection is not up\)\. Last posted \*\*2 days ago\*\* \(Oct 18, 2026, 12:00 Atlantic\) in <#c1>\.$/);
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "444" }], { users: { 444: { id: "444", username: "dee" } } }))).json();
  assert.match(j.data.content, /^I have not seen <@444> post or come online \(watching since /);
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "555" }], { users: { 555: { id: "555", username: "restock", bot: true } } }))).json();
  assert.match(j.data.content, /is a bot/);
  j = await (await signed(cmd("inactive", [{ name: "days", type: 4, value: 30 }]))).json();
  assert.match(j.data.content, /^\*\*2 quiet for 30 days\*\* \(of 3 members; quietest first\):\n<@333> - posted 100 days ago in <#c1>\n<@222> - posted 45 days ago in <#c2>\nOnline status is not being tracked yet/);
  j = await (await signed(cmd("inactive", []))).json();
  assert.match(j.data.content, /quiet for 30 days/, "30 days is the default");
  j = await (await signed(cmd("inactive", [{ name: "days", type: 4, value: 200 }]))).json();
  assert.match(j.data.content, /^Everyone I know of \(3 members\) has posted or been online within 200 days\./);
  // presence + roster from the gateway change the answers
  await call(c, "/_seen/presence", { rows: [{ id: "111", status: "online", at: T0 - 60e3, client: "desktop" }, { id: "222", status: "idle", at: T0 - 10 * DAY }, { id: "222", status: "offline", at: T0 - 9 * DAY }] });
  await call(c, "/_seen/members", { members: [{ id: "111", name: "Ada", joinedAt: Date.UTC(2024, 2, 3) }, { id: "222", name: "Bob", joinedAt: Date.UTC(2025, 0, 9) }, { id: "333", name: "Cy", joinedAt: Date.UTC(2023, 5, 1) }, { id: "777", name: "Newbie", joinedAt: Date.UTC(2025, 5, 1) }, { id: "900", name: "ReStock", bot: true, joinedAt: 1 }], complete: ["111", "222", "333", "777", "900"] });
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "111" }], { users: { 111: { id: "111", username: "ada" } } }))).json();
  assert.match(j.data.content, /^<@111>: \*\*Online now\*\* on desktop\. Last posted \*\*2 days ago\*\* .* in <#c1>\. Joined Mar 2, 2024\.$/);
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "222" }], { users: { 222: { id: "222", username: "bob" } } }))).json();
  assert.match(j.data.content, /^<@222>: Last online \*\*9 days ago\*\* \(Oct 11, 2026, 12:00 Atlantic\)\. Last posted \*\*45 days ago\*\* .* in <#c2>\. Joined Jan 8, 2025\.$/, "going offline keeps the last online moment");
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "777" }], { users: { 777: { id: "777", username: "newbie" } } }))).json();
  assert.match(j.data.content, /^<@777>: Not seen online since Oct 20, 2026, 12:00 Atlantic\. No posts seen \(watching since .*\)\. Joined May 31, 2025\.$/);
  j = await (await signed(cmd("inactive", [{ name: "days", type: 4, value: 30 }]))).json();
  assert.match(j.data.content, /^\*\*2 quiet for 30 days\*\* \(of 4 members; quietest first\):\n<@333> - posted 100 days ago in <#c1>\n<@777> - never seen, joined May 31, 2025\nOnline status counted since Oct 20, 2026, 12:00 Atlantic; posts/, "Bob was online 9 days ago so he is not quiet; the bot is not a member to list");
  await call(c, "/_seen/members", { left: ["777"] });
  j = await (await signed(cmd("lastseen", [{ name: "member", type: 6, value: "777" }], { users: { 777: { id: "777", username: "newbie" } } }))).json();
  assert.match(j.data.content, /Left the server .* ago\.$/, "the interaction clock is the real one; the DO's is T0");
  j = await (await signed(cmd("whatever", []))).json();
  assert.match(j.data.content, /do not know that command/);
  assert.equal((await signed({ type: 3 })).status, 400);
});

test("staff + health routes: health is counts only; preview lists the setup steps; the list carries words for humans", async () => {
  const clock = { t: T0 }; const c = cx(clock);
  const env = envWith(c);
  await call(c, "/_seen/record", { rows: [{ id: "111", name: "Ada", at: T0 - 2 * DAY, ch: "c1", chName: "general" }] });
  const get = (path, ok) => { const url = new URL(ORIGIN + path); return serveDiscordSeen(new Request(url), env, url, async () => ok !== false, {}); };
  let j = await (await get("/discord-seen/health", false)).json();
  assert.equal(j.tracked, 1); assert.equal(j.configured, true); assert.equal(j.publicKey, false); assert.deepEqual(j.commands, ["lastseen", "inactive"]);
  assert.equal(JSON.stringify(j).includes("Ada"), false, "no names in health");
  assert.equal((await get("/discord-seen/preview.json", false)).status, 403);
  j = await (await get("/discord-seen/preview.json")).json();
  assert.equal(j.interactionsUrl, ORIGIN + "/discord-seen/interactions");
  assert.ok(j.setup.some((s) => /DISCORD_PUBLIC_KEY/.test(s)) && j.setup.some((s) => /Interactions Endpoint URL/.test(s)) && j.setup.some((s) => /applications\.commands/.test(s)));
  assert.equal(j.commandsVersion.registered, 0); assert.equal(j.retentionDays, 730);
  j = await (await get("/discord-seen/list.json?days=1")).json();
  assert.equal(j.rows.length, 1); assert.equal(j.rows[0].ago, "2 days ago"); assert.equal(j.rows[0].when, "Oct 18, 2026, 12:00");
  assert.equal((await get("/discord-seen/nope")).status, 404);
});
