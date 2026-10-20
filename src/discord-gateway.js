/* src/discord-gateway.js - the bot's live connection to Discord (owner,
   2026-10-20: "I want online status").

   Online / idle / do-not-disturb / offline is only told over Discord's
   gateway, a WebSocket the bot keeps open around the clock with the
   privileged Presence intent. One Durable Object ("discord-gateway") holds
   that socket: it identifies with GUILDS + GUILD_MEMBERS + GUILD_PRESENCES,
   heartbeats, resumes after a drop, backs off on repeated failures, and
   forwards what matters to the "discord-seen" store (src/discord-seen.js):
     GUILD_CREATE          who is online right now + the first members page
     PRESENCE_UPDATE       a member went online / idle / dnd / offline
     GUILD_MEMBERS_CHUNK   the full member list (op 8 request after connect)
     GUILD_MEMBER_ADD/REMOVE   joins and departures
   No message content: the GUILD_MESSAGES intent is not requested at all.

   Keeping one object awake costs Durable Object duration: about 128 MB x
   86,400 s = 11,000 GB-s a day, ~330,000 GB-s a month against the 400,000
   the Workers Paid plan includes (the October bill came from every room
   object ticking; this is one). The worker's five-minute cron and the
   object's own one-minute alarm both call /_gw/tick, so an evicted object
   reconnects within a minute and RESUMEs its session when Discord allows.

   Fatal close codes stop the client and are shown on
   /discord-seen/preview.json: 4004 bad token, 4014 the Presence / Server
   Members intents are off in the Developer Portal (Bot > Privileged Gateway
   Intents). A halt is retried an hour later, so flipping the toggles is
   enough; staff can also POST /discord-seen/gateway/start.

   GatewayClient is the protocol, written against injected open()/timers so
   test/discord-gateway.test.mjs drives it with a fake socket. */

export const GW_DO = "discord-gateway";
export const GW_VERSION = 1;
export const GATEWAY_URL = "https://gateway.discord.gg/?v=10&encoding=json";
export const INTENT_GUILDS = 1 << 0, INTENT_GUILD_MEMBERS = 1 << 1, INTENT_GUILD_PRESENCES = 1 << 8;
export const INTENTS = INTENT_GUILDS | INTENT_GUILD_MEMBERS | INTENT_GUILD_PRESENCES;   // 259
const ALARM_MS = 60e3;
const HALT_RETRY_MS = 3600e3;
const CONNECT_TIMEOUT_MS = 90e3;
const FATAL = {
  4004: "authentication failed: the bot token is wrong",
  4010: "invalid shard", 4011: "sharding required (the server list is too big for one connection)", 4012: "invalid gateway API version",
  4013: "invalid intents",
  4014: "disallowed intents: in the Discord Developer Portal open the app > Bot > Privileged Gateway Intents and turn on Presence Intent and Server Members Intent, then save",
};
const NO_RESUME = new Set([1000, 1001, 4007, 4009]);   // normal close, invalid seq, session timed out: identify afresh

export const gatewayConfigured = (env) => !!(env && env.DISCORD_BOT_TOKEN);
const withParams = (u) => { const url = new URL(u); url.searchParams.set("v", "10"); url.searchParams.set("encoding", "json"); return url.toString().replace(/^wss:/, "https:"); };

export class GatewayClient {
  constructor(o) {
    this.token = o.token; this.intents = o.intents == null ? INTENTS : o.intents;
    this.open = o.open; this.now = o.now || (() => Date.now());
    this.setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms)); this.clearTimer = o.clearTimer || ((id) => clearTimeout(id));
    this.jitter = o.jitter || Math.random;
    this.onEvent = o.onEvent || (() => {}); this.onStatus = o.onStatus || (() => {}); this.log = o.log || (() => {});
    this.session = { ...(o.session || {}) };   // { id, seq, resumeUrl }
    this.ws = null; this.hb = null; this.restart = null; this.acked = true; this.closing = false;
    this.state = "idle"; this.halted = null; this.attempts = 0; this.connectedAt = 0; this.connectingAt = 0; this.lastEventAt = 0; this.events = 0;
  }
  get connected() { return this.state === "ready"; }
  canResume() { return !!(this.session.id && this.session.seq != null && this.session.resumeUrl); }

  async start() {
    if (this.halted || this.ws) return false;
    if (this.restart) { this.clearTimer(this.restart); this.restart = null; }
    const resume = this.canResume();
    const url = withParams(resume ? this.session.resumeUrl : GATEWAY_URL);
    this.state = "connecting"; this.connectingAt = this.now(); this.resuming = resume; this.closing = false;
    let ws;
    try { ws = await this.open(url); } catch (e) { this.ws = null; this.scheduleRestart("open failed: " + String((e && e.message) || e).slice(0, 120)); return false; }
    this.ws = ws;
    ws.addEventListener("message", (ev) => this.onMessage(typeof ev.data === "string" ? ev.data : ""));
    ws.addEventListener("close", (ev) => this.onClose((ev && ev.code) || 1006, (ev && ev.reason) || ""));
    ws.addEventListener("error", () => this.onClose(1006, "socket error"));
    return true;
  }

  send(o) { try { if (this.ws) this.ws.send(JSON.stringify(o)); } catch (e) { this.log("gateway send: " + ((e && e.message) || e)); } }

  onMessage(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.op !== "number") return;
    if (m.s != null) this.session.seq = m.s;
    if (m.op === 10) {                                   // HELLO
      this.startHeartbeat(Number((m.d && m.d.heartbeat_interval) || 41250));
      if (this.resuming) this.send({ op: 6, d: { token: this.token, session_id: this.session.id, seq: this.session.seq } });
      else this.send({ op: 2, d: { token: this.token, intents: this.intents, properties: { os: "cloudflare", browser: "exor-binder", device: "exor-binder" }, large_threshold: 250 } });
    } else if (m.op === 11) this.acked = true;         // HEARTBEAT_ACK
    else if (m.op === 1) this.send({ op: 1, d: this.session.seq == null ? null : this.session.seq });
    else if (m.op === 7) this.reconnect("Discord asked us to reconnect");
    else if (m.op === 9) {                               // INVALID_SESSION: d true = resumable
      if (!m.d) this.session = {};
      this.reconnect(m.d ? "invalid session (resumable)" : "invalid session: identifying afresh", !m.d);
    } else if (m.op === 0) this.dispatch(m.t, m.d);
  }

  dispatch(t, d) {
    this.lastEventAt = this.now(); this.events++;
    if (t === "READY") {
      this.session.id = d.session_id; this.session.resumeUrl = d.resume_gateway_url || GATEWAY_URL;
      this.state = "ready"; this.connectedAt = this.now(); this.attempts = 0;
      this.onStatus({ ready: this.now(), user: d.user ? String(d.user.username || "") : "", resumed: false });
    } else if (t === "RESUMED") {
      this.state = "ready"; this.connectedAt = this.now(); this.attempts = 0;
      this.onStatus({ ready: this.now(), resumed: true });
    }
    try { this.onEvent(t, d, this); } catch (e) { this.log("gateway event " + t + ": " + ((e && e.message) || e)); }
  }

  startHeartbeat(ms) {
    this.stopHeartbeat(); this.acked = true;
    const beat = () => {
      this.hb = null;
      if (!this.acked) { this.reconnect("heartbeat not acknowledged"); return; }
      this.acked = false; this.send({ op: 1, d: this.session.seq == null ? null : this.session.seq });
      this.hb = this.setTimer(beat, ms);
    };
    this.hb = this.setTimer(beat, Math.floor(ms * this.jitter()));   // Discord asks for a random first delay
  }
  stopHeartbeat() { if (this.hb) { this.clearTimer(this.hb); this.hb = null; } }

  /* Close on our side and come back (resuming unless `fresh`). Non-1000 close
     codes leave the session resumable on Discord's side. */
  reconnect(reason, fresh) {
    this.stopHeartbeat();
    const ws = this.ws; this.ws = null; this.closing = true;
    try { if (ws) ws.close(fresh ? 1000 : 4000, String(reason).slice(0, 100)); } catch {}
    if (fresh) this.session = {};
    this.state = "closed";
    this.scheduleRestart(reason, fresh ? 3000 : 0);
  }

  onClose(code, reason) {
    if (this.closing) { this.closing = false; return; }   // we closed it; the restart is already scheduled
    this.stopHeartbeat(); this.ws = null; this.state = "closed";
    if (FATAL[code]) { this.halted = FATAL[code]; this.haltCode = code; this.onStatus({ halted: this.halted, code, at: this.now() }); return; }
    if (NO_RESUME.has(code)) this.session = {};
    this.scheduleRestart("closed " + code + (reason ? ": " + String(reason).slice(0, 80) : ""));
  }

  scheduleRestart(reason, minDelay) {
    if (this.restart) return;
    this.attempts++;
    const delay = Math.max(minDelay || 0, this.attempts <= 1 ? 2000 : Math.min(300e3, 5e3 * 2 ** Math.min(this.attempts - 2, 6)));
    this.onStatus({ closed: reason, retryInMs: delay, at: this.now() });
    this.restart = this.setTimer(() => { this.restart = null; this.start(); }, delay);
  }

  stop(reason) {
    this.halted = reason || "stopped";
    this.stopHeartbeat();
    if (this.restart) { this.clearTimer(this.restart); this.restart = null; }
    const ws = this.ws; this.ws = null; this.closing = true;
    try { if (ws) ws.close(1000, "stop"); } catch {}
    this.session = {}; this.state = "stopped";
  }

  requestMembers(guildId) { this.send({ op: 8, d: { guild_id: String(guildId), query: "", limit: 0 } }); }
}

/* ---- the Durable Object side ------------------------------------------- */

async function openSocket(url) {
  const r = await fetch(url, { headers: { Upgrade: "websocket" } });
  const ws = r.webSocket;
  if (!ws) throw new Error("gateway answered HTTP " + r.status + " without a WebSocket");
  ws.accept();
  return ws;
}
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const json = (o, status) => Response.json(o, { status: status || 200, headers: { "cache-control": "no-store" } });
const statusOf = async (cx) => (await cx.storage.get("gw:status")) || { enabled: true, presences: 0, members: 0, reconnects: 0, halted: null, haltedAt: 0, lastReadyAt: 0, lastEventAt: 0, guildName: null, memberCount: null };
/* Status writes queue up (one read-modify-write at a time): socket events,
   the alarm and staff calls all patch the same record from different turns. */
const freshCounts = () => ({ presences: 0, members: 0, reconnects: 0 });
function queueFlush(cx) {
  cx.mem.flushing = (cx.mem.flushing || Promise.resolve()).then(async () => {
    const patch = cx.mem.statusPatch || {}, counts = cx.mem.counts;
    cx.mem.statusPatch = {}; cx.mem.counts = null;
    if (!Object.keys(patch).length && !counts) return;
    const s = await statusOf(cx);
    const next = { ...s, ...patch };
    if (counts) { next.presences = (s.presences || 0) + counts.presences; next.members = (s.members || 0) + counts.members; next.reconnects = (s.reconnects || 0) + (counts.reconnects || 0); }
    await cx.storage.put("gw:status", next);
  }).catch((e) => cx.log("gateway status: " + ((e && e.message) || e)));
  return cx.mem.flushing;
}
function queuePatch(cx, patch) { cx.mem.statusPatch = { ...(cx.mem.statusPatch || {}), ...patch }; return queueFlush(cx); }
const bump = (cx, k, n) => { cx.mem.counts = cx.mem.counts || freshCounts(); cx.mem.counts[k] += n == null ? 1 : n; };

/* What the socket tells us -> the seen store. */
async function handleEvent(cx, t, d, client) {
  const now = cx.now();
  const mem = cx.mem;
  const want = cx.env.DISCORD_GUILD_ID ? String(cx.env.DISCORD_GUILD_ID) : null;
  const guildOf = (x) => String((x && (x.guild_id || x.id)) || "");
  if (t === "GUILD_CREATE") {
    if (want && guildOf(d) !== want) return;
    mem.guildId = guildOf(d);
    const rows = ((d && d.presences) || []).map((p) => presenceRow(p, now)).filter(Boolean);
    if (rows.length) await cx.seen("/_seen/presence", { rows, since: now });
    const members = ((d && d.members) || []).map(memberRow).filter(Boolean);
    if (members.length) await cx.seen("/_seen/members", { members });
    bump(cx, "presences", rows.length); bump(cx, "members", members.length);
    queuePatch(cx, { guildName: String((d && d.name) || ""), memberCount: Number(d && d.member_count) || null });
    mem.roster = new Set();
    client.requestMembers(mem.guildId);
  } else if (t === "GUILD_MEMBERS_CHUNK") {
    if (want && guildOf(d) !== want) return;
    const members = ((d && d.members) || []).map(memberRow).filter(Boolean);
    mem.roster = mem.roster || new Set();
    for (const m of members) mem.roster.add(m.id);
    const last = Number(d.chunk_index) >= Number(d.chunk_count) - 1;
    await cx.seen("/_seen/members", { members, ...(last ? { complete: [...mem.roster] } : {}) });
    bump(cx, "members", members.length);
  } else if (t === "PRESENCE_UPDATE") {
    if (want && guildOf(d) !== want) return;
    const row = presenceRow(d, now);
    if (row) { await cx.seen("/_seen/presence", { rows: [row] }); bump(cx, "presences"); }
  } else if (t === "GUILD_MEMBER_ADD") {
    if (want && guildOf(d) !== want) return;
    const m = memberRow(d); if (m) { await cx.seen("/_seen/members", { members: [m] }); bump(cx, "members"); }
  } else if (t === "GUILD_MEMBER_REMOVE") {
    if (want && guildOf(d) !== want) return;
    if (d && d.user && d.user.id) await cx.seen("/_seen/members", { left: [String(d.user.id)] });
  }
}
export function presenceRow(p, now) {
  const u = p && p.user; if (!u || !u.id) return null;
  const status = ["online", "idle", "dnd", "offline", "invisible"].includes(p.status) ? (p.status === "invisible" ? "offline" : p.status) : "offline";
  const cs = p.client_status || {};
  const client = ["desktop", "mobile", "web"].filter((k) => cs[k]).join("+") || "";
  return { id: String(u.id), status, at: now, client, name: u.username ? String(u.global_name || u.username).slice(0, 80) : undefined };
}
export function memberRow(m) {
  const u = m && m.user; if (!u || !u.id) return null;
  return { id: String(u.id), name: String(u.global_name || u.username || "").slice(0, 80), nick: m.nick ? String(m.nick).slice(0, 80) : "", joinedAt: Date.parse(m.joined_at) || 0, bot: !!u.bot };
}

/* Make sure a client is running (unless stopped, halted or unconfigured);
   persist its session and counters. Called by the alarm, the cron and staff. */
export async function ensureClient(cx) {
  const st = await statusOf(cx);
  const now = cx.now();
  if (!gatewayConfigured(cx.env)) return { running: false, reason: "DISCORD_BOT_TOKEN is not set" };
  if (!st.enabled) return { running: false, reason: "stopped by staff" };
  let c = cx.mem.client;
  if (!c && st.halted && now - (st.haltedAt || 0) < HALT_RETRY_MS) return { running: false, reason: st.halted, retryAt: (st.haltedAt || 0) + HALT_RETRY_MS };
  if (c && c.halted) {
    if (now - (st.haltedAt || 0) < HALT_RETRY_MS) return { running: false, reason: c.halted, retryAt: (st.haltedAt || 0) + HALT_RETRY_MS };
    cx.mem.client = c = null;   // an hour has passed: try again (the owner may have flipped the intents)
  }
  if (!c) {
    const session = (await cx.storage.get("gw:session")) || {};
    c = cx.mem.client = new GatewayClient({
      token: cx.env.DISCORD_BOT_TOKEN, open: cx.open || openSocket, now: cx.now, log: cx.log, session,
      onStatus: (p) => {
        const patch = {};
        if (p.ready) { patch.lastReadyAt = p.ready; patch.halted = null; patch.haltedAt = 0; if (p.resumed) bump(cx, "reconnects"); }
        if (p.halted) { patch.halted = p.halted; patch.haltedAt = p.at; }
        if (p.closed) patch.lastClose = { reason: p.closed, at: p.at, retryInMs: p.retryInMs };
        queuePatch(cx, patch);
      },
      onEvent: (t, d, client) => handleEvent(cx, t, d, client),
    });
    await queuePatch(cx, { halted: null });
    await c.start();
  } else if (c.state === "closed" && !c.restart) {
    await c.start();
  } else if (c.state === "connecting" && now - c.connectingAt > CONNECT_TIMEOUT_MS) {
    c.reconnect("no READY within 90 s");
  }
  return { running: c.state === "ready" || c.state === "connecting", state: c.state, halted: c.halted || null };
}

async function persist(cx) {
  const c = cx.mem.client;
  const patch = {};
  if (c) {
    if (c.canResume()) await cx.storage.put("gw:session", c.session);
    patch.lastEventAt = Math.max(0, c.lastEventAt || 0);
    patch.state = c.state;
    if (c.halted) patch.halted = c.halted;
  }
  await queuePatch(cx, patch);
  return statusOf(cx);
}

export async function gwDoFetch(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/_gw/tick" && post) {
    const r = await ensureClient(cx);
    const st = await persist(cx);
    if (st.enabled && gatewayConfigured(cx.env)) { try { await cx.storage.setAlarm(cx.now() + ALARM_MS); } catch {} }
    return json({ ok: true, ...r, status: st });
  }
  if (p === "/_gw/status") {
    const st = await statusOf(cx); const c = cx.mem.client;
    return json({ ok: true, enabled: st.enabled, configured: gatewayConfigured(cx.env), state: c ? c.state : (st.halted ? "halted" : "idle"), connected: !!(c && c.connected), connectedAt: c ? c.connectedAt : 0, lastEventAt: c && c.lastEventAt ? c.lastEventAt : st.lastEventAt || 0, events: c ? c.events : 0, attempts: c ? c.attempts : 0, halted: (c && c.halted) || st.halted || null, haltedAt: st.haltedAt || 0, lastClose: st.lastClose || null, lastReadyAt: st.lastReadyAt || 0, reconnects: st.reconnects || 0, presences: st.presences || 0, membersSeen: st.members || 0, guildName: st.guildName || null, memberCount: st.memberCount || null, intents: INTENTS, version: GW_VERSION });
  }
  if (p === "/_gw/stop" && post) {
    if (cx.mem.client) { cx.mem.client.stop("stopped by staff"); cx.mem.client = null; }
    await queuePatch(cx, { enabled: false, state: "stopped" });
    try { await cx.storage.deleteAlarm(); } catch {}
    return json({ ok: true, enabled: false });
  }
  if (p === "/_gw/start" && post) {
    const b = await bodyOf(request);
    if (cx.mem.client) { cx.mem.client.stop("restart"); cx.mem.client = null; }
    if (b.fresh) await cx.storage.delete("gw:session");
    await queuePatch(cx, { enabled: true, halted: null, haltedAt: 0 });
    const r = await ensureClient(cx);
    const st = await persist(cx);
    try { await cx.storage.setAlarm(cx.now() + ALARM_MS); } catch {}
    return json({ ok: true, ...r, status: st });
  }
  return json({ ok: false, error: "no such path" }, 404);
}

export async function gwDoAlarm(cx) {
  try {
    const st = await statusOf(cx);
    if (!st.enabled || !gatewayConfigured(cx.env)) return;
    await ensureClient(cx);
    await persist(cx);
    try { await cx.storage.setAlarm(cx.now() + ALARM_MS); } catch {}
  } catch (e) { cx.log("gateway alarm: " + ((e && e.message) || e)); try { await cx.storage.setAlarm(cx.now() + ALARM_MS); } catch {} }
}

/* Worker side: the cron's nudge (src/index.js scheduled()). */
export async function gatewayTick(env) {
  if (!gatewayConfigured(env) || !env.ROOM) return null;
  const r = await env.ROOM.get(env.ROOM.idFromName(GW_DO)).fetch(new Request("https://exor-binder.internal/_gw/tick", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  return r.json();
}
export async function gatewayStatus(env) {
  if (!env || !env.ROOM) return { configured: gatewayConfigured(env), state: "no storage" };
  const r = await env.ROOM.get(env.ROOM.idFromName(GW_DO)).fetch(new Request("https://exor-binder.internal/_gw/status"));
  return r.json();
}
export async function gatewayControl(env, action, body) {
  const r = await env.ROOM.get(env.ROOM.idFromName(GW_DO)).fetch(new Request("https://exor-binder.internal/_gw/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }));
  return r.json();
}
