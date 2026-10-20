// The bot's gateway connection for online status (owner 2026-10-20, "I want online status").
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayClient, INTENTS, GATEWAY_URL, gwDoFetch, gwDoAlarm, presenceRow, memberRow, GW_VERSION } from "../src/discord-gateway.js";

const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);
const DAY = 864e5;

// A socket Discord would hand us: records what we send, lets the test speak.
class FakeWs {
  constructor() { this.sent = []; this.ls = {}; this.closed = null; }
  addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
  emit(t, ev) { for (const f of this.ls[t] || []) f(ev); }
  msg(o) { this.emit("message", { data: JSON.stringify(o) }); }
}
// Deterministic clock + timers.
function harness() {
  const clock = { t: T0 }, timers = [], sockets = [], opened = [], events = [], statuses = [];
  const setTimer = (fn, ms) => { const id = { fn, at: clock.t + ms }; timers.push(id); return id; };
  const clearTimer = (id) => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); };
  const run = async (toT) => { for (;;) { const due = timers.filter((x) => x.at <= toT).sort((a, b) => a.at - b.at)[0]; if (!due) break; clearTimer(due); clock.t = due.at; await due.fn(); } clock.t = toT; };
  const open = async (url) => { opened.push(url); const ws = new FakeWs(); sockets.push(ws); return ws; };
  const client = (extra) => new GatewayClient({ token: "T", open, now: () => clock.t, setTimer, clearTimer, jitter: () => 0.5, onEvent: (t, d) => events.push([t, d]), onStatus: (p) => statuses.push(p), log: () => {}, ...(extra || {}) });
  return { clock, timers, sockets, opened, events, statuses, run, open, client, setTimer, clearTimer };
}
const HELLO = { op: 10, d: { heartbeat_interval: 1000 } };
const READY = (s) => ({ op: 0, t: "READY", s: s || 1, d: { session_id: "S1", resume_gateway_url: "wss://resume.example", user: { username: "exor-bot" } } });

test("identify on HELLO with the three intents, READY makes it connected, heartbeats carry the sequence, a missed ACK reconnects and RESUMEs", async () => {
  const h = harness(); const c = h.client();
  assert.equal(await c.start(), true);
  assert.equal(h.opened[0], GATEWAY_URL); assert.equal(c.state, "connecting");
  const ws = h.sockets[0];
  ws.msg(HELLO);
  assert.deepEqual(ws.sent[0], { op: 2, d: { token: "T", intents: INTENTS, properties: { os: "cloudflare", browser: "exor-binder", device: "exor-binder" }, large_threshold: 250 } });
  assert.equal(INTENTS, 1 + 2 + 256, "GUILDS + GUILD_MEMBERS + GUILD_PRESENCES, nothing about messages");
  ws.msg(READY(1));
  assert.equal(c.connected, true); assert.deepEqual(c.session, { id: "S1", seq: 1, resumeUrl: "wss://resume.example" });
  assert.equal(h.statuses[0].ready, T0); assert.equal(h.statuses[0].user, "exor-bot");
  assert.deepEqual(h.events[0][0], "READY");
  await h.run(T0 + 500);                                   // first beat after jitter x interval
  assert.deepEqual(ws.sent[1], { op: 1, d: 1 });
  ws.msg({ op: 11 });                                      // ACK
  ws.msg({ op: 0, t: "PRESENCE_UPDATE", s: 2, d: { user: { id: "9" }, status: "online" } });
  await h.run(T0 + 1500);
  assert.deepEqual(ws.sent[2], { op: 1, d: 2 }, "the next beat carries the newest sequence");
  ws.msg({ op: 1 });                                       // Discord asks for a beat right now
  assert.deepEqual(ws.sent[3], { op: 1, d: 2 });
  // no ACK for the beat at 1500 -> at 2500 the client closes with a resumable code and schedules a restart
  await h.run(T0 + 2500);
  assert.deepEqual(ws.closed, { code: 4000, reason: "heartbeat not acknowledged" });
  assert.equal(c.state, "closed"); assert.equal(c.attempts, 1);
  assert.equal(h.statuses.at(-1).retryInMs, 2000);
  ws.emit("close", { code: 4000, reason: "" });            // the close event for our own close changes nothing
  assert.equal(h.timers.length, 1, "one restart timer");
  await h.run(T0 + 4500);
  assert.equal(h.opened[1], "https://resume.example/?v=10&encoding=json", "resume goes to the resume URL, as https for fetch");
  const ws2 = h.sockets[1];
  ws2.msg(HELLO);
  assert.deepEqual(ws2.sent[0], { op: 6, d: { token: "T", session_id: "S1", seq: 2 } });
  ws2.msg({ op: 0, t: "RESUMED", s: 3, d: {} });
  assert.equal(c.connected, true); assert.equal(c.attempts, 0); assert.equal(h.statuses.at(-1).resumed, true);
});

test("close codes: fatal ones halt with a plain-English reason; unresumable ones identify afresh; backoff grows and caps", async () => {
  const h = harness(); const c = h.client();
  await c.start(); h.sockets[0].msg(HELLO); h.sockets[0].msg(READY(1));
  h.sockets[0].emit("close", { code: 4014, reason: "Disallowed intent(s)." });
  assert.match(c.halted, /Presence Intent and Server Members Intent/);
  assert.equal(h.statuses.at(-1).code, 4014); assert.equal(h.timers.length, 0, "no restart after a fatal close");
  assert.equal(await c.start(), false, "a halted client stays down");
  const c2 = h.client();
  await c2.start(); const w = h.sockets[1]; w.msg(HELLO); w.msg(READY(5));
  w.emit("close", { code: 4009, reason: "Session timed out" });
  assert.deepEqual(c2.session, {}, "4009 cannot be resumed");
  await h.run(h.clock.t + 2000);
  const w2 = h.sockets[2]; w2.msg(HELLO);
  assert.equal(w2.sent[0].op, 2, "identify, not resume");
  w2.msg({ op: 9, d: false });                             // invalid session, not resumable
  assert.deepEqual(w2.closed, { code: 1000, reason: "invalid session: identifying afresh" });
  assert.equal(h.statuses.at(-1).retryInMs, 5000, "second attempt: 5 s");
  await h.run(h.clock.t + 5000);
  const w3 = h.sockets[3]; w3.msg(HELLO); w3.msg(READY(1));
  w3.msg({ op: 7 });                                       // reconnect request
  assert.equal(w3.closed.code, 4000); assert.equal(c2.attempts, 1, "attempts reset after READY; op 7 is attempt one again");
  assert.equal(h.statuses.at(-1).retryInMs, 2000);
  // open() failing repeatedly: 2 s, 5 s, 10 s, 20 s ... capped at 5 min
  const h2 = harness(); let fails = 0;
  const c3 = h2.client({ open: async () => { fails++; throw new Error("ECONNRESET"); } });
  const delays = [];
  for (let i = 0; i < 9; i++) { await c3.start(); delays.push(h2.statuses.at(-1).retryInMs); h2.timers.length = 0; c3.restart = null; }
  assert.deepEqual(delays, [2000, 5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
  assert.equal(fails, 9);
  c3.stop("stopped by staff");
  assert.equal(c3.state, "stopped"); assert.equal(c3.halted, "stopped by staff");
});

test("presenceRow / memberRow shape what the gateway sends", () => {
  assert.deepEqual(presenceRow({ user: { id: "1", username: "ada" }, status: "idle", client_status: { desktop: "idle", mobile: "online" } }, T0), { id: "1", status: "idle", at: T0, client: "desktop+mobile", name: "ada" });
  assert.deepEqual(presenceRow({ user: { id: "2" }, status: "invisible" }, T0), { id: "2", status: "offline", at: T0, client: "", name: undefined });
  assert.deepEqual(presenceRow({ user: { id: "3" }, status: "weird" }, T0).status, "offline");
  assert.equal(presenceRow({ status: "online" }, T0), null);
  assert.deepEqual(memberRow({ user: { id: "4", username: "bob", global_name: "Bob B" }, nick: "Bobby", joined_at: "2025-01-09T10:00:00.000Z" }), { id: "4", name: "Bob B", nick: "Bobby", joinedAt: Date.UTC(2025, 0, 9, 10), bot: false });
  assert.equal(memberRow({ user: { id: "5", username: "ReStock", bot: true } }).bot, true);
  assert.equal(memberRow({}), null);
});

// The Durable Object glue: a fake storage + a recorder standing in for the discord-seen object.
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; } async setAlarm(t) { this.alarm = t; } async deleteAlarm() { this.alarm = null; }
}
function doHarness(env) {
  const h = harness(); const seenCalls = [];
  const cx = { storage: new MemStorage(), env: { DISCORD_BOT_TOKEN: "T", DISCORD_GUILD_ID: "g1", ...(env || {}) }, now: () => h.clock.t, log: () => {}, mem: {}, open: h.open, seen: async (path, body) => { seenCalls.push([path, body]); return { ok: true }; } };
  const call = async (path, body) => { const url = new URL("https://w.example" + path); const req = body !== undefined ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url); return (await gwDoFetch(cx, req, url)).json(); };
  return { ...h, cx, seenCalls, call };
}

test("DO: a tick starts the client and arms the alarm; GUILD_CREATE, member chunks, presence and joins/leaves reach the seen store; status reports it", async () => {
  const d = doHarness();
  // the live client uses real timers inside the object; the test swaps them for the harness ones after creation
  const patchTimers = () => { const c = d.cx.mem.client; c.setTimer = d.setTimer; c.clearTimer = d.clearTimer; c.jitter = () => 0.5; };
  let r = await d.call("/_gw/tick", {});
  assert.equal(r.running, true); assert.equal(r.state, "connecting"); assert.equal(d.cx.storage.alarm, T0 + 60e3, "the one-minute alarm is armed");
  patchTimers();
  const ws = d.sockets[0];
  ws.msg(HELLO); ws.msg(READY(1));
  ws.msg({ op: 0, t: "GUILD_CREATE", s: 2, d: { id: "g1", name: "Exor Games", member_count: 3, presences: [{ user: { id: "1" }, status: "online", client_status: { mobile: "online" } }, { user: { id: "2" }, status: "dnd" }], members: [{ user: { id: "1", username: "ada" }, joined_at: "2024-03-03T00:00:00Z" }] } });
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(d.seenCalls[0], ["/_seen/presence", { rows: [{ id: "1", status: "online", at: T0, client: "mobile", name: undefined }, { id: "2", status: "dnd", at: T0, client: "", name: undefined }], since: T0 }]);
  assert.deepEqual(d.seenCalls[1], ["/_seen/members", { members: [{ id: "1", name: "ada", nick: "", joinedAt: Date.UTC(2024, 2, 3), bot: false }] }]);
  assert.deepEqual(ws.sent.at(-1), { op: 8, d: { guild_id: "g1", query: "", limit: 0 } }, "then the full member list is requested");
  ws.msg({ op: 0, t: "GUILD_MEMBERS_CHUNK", s: 3, d: { guild_id: "g1", chunk_index: 0, chunk_count: 2, members: [{ user: { id: "1", username: "ada" } }, { user: { id: "2", username: "bob" } }] } });
  ws.msg({ op: 0, t: "GUILD_MEMBERS_CHUNK", s: 4, d: { guild_id: "g1", chunk_index: 1, chunk_count: 2, members: [{ user: { id: "3", username: "cy" } }] } });
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(d.seenCalls[2][1].complete, undefined, "not the last chunk");
  assert.deepEqual(d.seenCalls[3][1].complete, ["1", "2", "3"], "the last chunk carries every id so the store can mark who left");
  ws.msg({ op: 0, t: "PRESENCE_UPDATE", s: 5, d: { guild_id: "g1", user: { id: "2" }, status: "offline" } });
  ws.msg({ op: 0, t: "PRESENCE_UPDATE", s: 6, d: { guild_id: "other", user: { id: "7" }, status: "online" } });   // another server: ignored
  ws.msg({ op: 0, t: "GUILD_MEMBER_ADD", s: 7, d: { guild_id: "g1", user: { id: "4", username: "dee" }, joined_at: "2026-10-20T15:00:00Z" } });
  ws.msg({ op: 0, t: "GUILD_MEMBER_REMOVE", s: 8, d: { guild_id: "g1", user: { id: "3" } } });
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(d.seenCalls[4], ["/_seen/presence", { rows: [{ id: "2", status: "offline", at: T0, client: "", name: undefined }] }]);
  assert.deepEqual(d.seenCalls[5][1].members[0].id, "4");
  assert.deepEqual(d.seenCalls[6], ["/_seen/members", { left: ["3"] }]);
  assert.equal(d.seenCalls.length, 7);
  r = await d.call("/_gw/status");
  assert.equal(r.connected, true); assert.equal(r.state, "ready"); assert.equal(r.events, 8); assert.equal(r.intents, INTENTS); assert.equal(r.version, GW_VERSION);
  d.clock.t += 60e3;
  await gwDoAlarm(d.cx);
  assert.equal(d.cx.storage.alarm, T0 + 120e3, "the alarm re-arms itself");
  assert.deepEqual(await d.cx.storage.get("gw:session"), { id: "S1", seq: 8, resumeUrl: "wss://resume.example" }, "the session is saved for a resume after an eviction");
  r = await d.call("/_gw/status");
  assert.equal(r.guildName, "Exor Games"); assert.equal(r.memberCount, 3); assert.equal(r.presences, 3); assert.equal(r.membersSeen, 5); assert.equal(r.lastReadyAt, T0);
  // stop / start from staff
  r = await d.call("/_gw/stop", {});
  assert.equal(r.enabled, false); assert.equal(ws.closed.code, 1000); assert.equal(d.cx.storage.alarm, null);
  r = await d.call("/_gw/tick", {});
  assert.deepEqual(r, { ok: true, running: false, reason: "stopped by staff", status: r.status });
  r = await d.call("/_gw/start", {});
  assert.equal(r.running, true); assert.equal(d.opened.length, 2);
  assert.equal(d.opened[1], "https://resume.example/?v=10&encoding=json", "a start resumes the saved session");
  r = await d.call("/_gw/start", { fresh: true });
  assert.equal(d.opened[2], GATEWAY_URL, "reset forgets the session");
});

test("DO: a fatal close is remembered across evictions and retried an hour later; no token = nothing runs", async () => {
  const d = doHarness();
  await d.call("/_gw/tick", {});
  d.sockets[0].msg(HELLO);
  d.sockets[0].emit("close", { code: 4014, reason: "Disallowed intent(s)." });
  await new Promise((res) => setTimeout(res, 0));
  let r = await d.call("/_gw/tick", {});
  assert.equal(r.running, false); assert.match(r.reason, /Presence Intent/); assert.equal(r.retryAt, T0 + 3600e3);
  d.cx.mem = {};                                           // evicted: memory gone, storage stays
  r = await d.call("/_gw/tick", {});
  assert.equal(r.running, false); assert.match(r.reason, /Presence Intent/, "the halt is remembered"); assert.equal(d.opened.length, 1, "no reconnect storm");
  d.clock.t = T0 + 3600e3 + 1;
  r = await d.call("/_gw/tick", {});
  assert.equal(r.running, true); assert.equal(d.opened.length, 2, "an hour on it tries again (the owner may have flipped the intents)");
  const s = (await d.call("/_gw/status"));
  assert.equal(s.halted, null);
  const none = doHarness({ DISCORD_BOT_TOKEN: "" });
  assert.deepEqual((await none.call("/_gw/tick", {})).reason, "DISCORD_BOT_TOKEN is not set");
  assert.equal(none.opened.length, 0); assert.equal(none.cx.storage.alarm, null, "no alarm without a token");
});
