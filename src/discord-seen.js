/* src/discord-seen.js - "last seen" for the Discord server (owner, 2026-10-20:
   "can you make a last-seen bot on our discord server?").

   What it answers: when a member last POSTED in the server, and who has gone
   quiet. Two slash commands, visible to moderators (Moderate Members) and
   admins by default, every answer private to the person who asked:
     /lastseen member:@X     "@X last posted 2 days ago (Oct 18, 2026 15:14 Atlantic) in #trades"
     /inactive days:30       members seen posting, but not in the last N days
   Online status (owner, later the same day: "I want online status") comes
   from src/discord-gateway.js: one Durable Object keeps the bot's gateway
   socket open with the Presence and Server Members intents and posts every
   presence change and the member list here (/_seen/presence, /_seen/members).
   So a row knows the last post AND the last time the member was online.

   How it watches: the worker's five-minute cron (src/index.js scheduled())
   asks Discord, with the same bot token the events sync uses, for the server's
   text channels and active public threads, then for the messages after each
   channel's cursor (GET /channels/{id}/messages?after=...). The newest message
   per author updates seen:<userId> in the "discord-seen" Durable Object. New
   channels are backfilled, two pages of 100 a tick, up to BACKFILL_PAGES, so
   the first days already know about recent history. Bots and webhooks are
   skipped. A channel the bot cannot read (403) is retried a day later.

   Interactions: Discord POSTs slash commands to /discord-seen/interactions,
   signed with the app's public key (Ed25519). DISCORD_PUBLIC_KEY (the "PUBLIC
   KEY" on the app's General Information page) verifies them; without it the
   endpoint answers 501 and Discord's URL check fails. The commands register
   themselves (PUT guild commands) the first time the cron runs after a
   deploy that changes COMMANDS_VERSION; the bot must have been invited with
   the applications.commands scope for that PUT to be allowed.

   Stored, per member: Discord user id, username at the time, time and
   channel of the last post, a count. No message text, ever. Rows older than
   RETENTION.discordSeenDays go in the nightly sweep (src/retention.js).

   Routes:
     POST /discord-seen/interactions      Discord -> us (signature-checked, public)
     GET  /discord-seen/health            counts only
     GET  /discord-seen/preview.json?k=   staff: state, setup checklist, the URL to paste
     POST /discord-seen/poll?k=           staff: poll now
     GET  /discord-seen/list.json?k=&days= staff: who was seen when (admins; logged) */

import { api, resolveGuild } from "./discord-events.js";
import { RETENTION } from "./access-log.js";
import { gatewayStatus, gatewayControl } from "./discord-gateway.js";

export const SEEN_DO = "discord-seen";
export const COMMANDS_VERSION = 1;
const POLL_GAP_MS = 4.5 * 60e3;        // the cron is every 5 min; poll on every tick that is at least this far from the last
const BACKFILL_PAGES = 10;             // up to 1000 older messages per channel, two pages a tick
const BACKFILL_PER_TICK = 2;
const FORWARD_PAGES = 5;               // new messages per channel per tick (500); more wait for the next tick
const DENIED_RETRY_MS = 24 * 3600e3;
const MAX_CHANNELS = 60;               // per tick; a bigger server rotates through them
const MAX_LIST = 25;                   // lines in an /inactive answer
const MODERATE_MEMBERS = 1n << 40n;
const TEXT_TYPES = new Set([0, 5]);    // text, announcement; forums (15, 16) hold posts in threads only
const THREAD_TYPES = new Set([10, 11]); // announcement thread, public thread (private threads need membership)
const noStore = { "cache-control": "no-store" };
const json = (o, status) => Response.json(o, { status: status || 200, headers: noStore });

export function seenConfigured(env) { return !!(env && env.DISCORD_BOT_TOKEN); }
export function publicKeySet(env) { return /^[0-9a-f]{64}$/i.test(String((env && env.DISCORD_PUBLIC_KEY) || "").trim()); }

export const COMMANDS = [
  { name: "lastseen", description: "When did a member last post in this server?", type: 1, default_member_permissions: String(MODERATE_MEMBERS),
    options: [{ type: 6, name: "member", description: "The member", required: true }] },
  { name: "inactive", description: "Members who have not posted for a while", type: 1, default_member_permissions: String(MODERATE_MEMBERS),
    options: [{ type: 4, name: "days", description: "Quiet for at least this many days (default 30)", required: false, min_value: 1, max_value: 3650 }] },
];

/* ---- small helpers ------------------------------------------------------ */

const big = (s) => { try { return BigInt(String(s)); } catch { return 0n; } };
export const newerId = (a, b) => (!a ? b : !b ? a : big(a) > big(b) ? a : b);
export const olderId = (a, b) => (!a ? b : !b ? a : big(a) < big(b) ? a : b);
const hex = (s) => { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, "").slice(0, n || 100);
const idOf = (s) => String(s == null ? "" : s).replace(/[^\w-]/g, "").slice(0, 24);   // Discord ids are digits; keep keys plain either way
export const whenAtlantic = (ms) => new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export function ago(ms, now) {
  const d = Math.max(0, now - ms), m = Math.round(d / 60e3), h = Math.round(d / 3600e3), days = Math.round(d / 864e5);
  if (m < 1) return "just now";
  if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
  if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
  return days + " days ago";
}

/* A message -> the row it contributes (null for bots, webhooks, system messages). */
export function rowOf(m, channel) {
  const a = m && m.author;
  if (!a || !a.id || a.bot || m.webhook_id) return null;
  const at = Date.parse(m.timestamp);
  if (!at) return null;
  return { id: String(a.id), name: clean(a.global_name || a.username, 80), at, ch: String(channel.id), chName: clean(channel.name, 100) };
}

/* ---- the DO side ---------------------------------------------------------- */

async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const metaOf = async (cx) => (await cx.storage.get("meta")) || { startedAt: null, lastPollAt: 0, polls: 0, messages: 0, channels: 0, lastError: null, guildId: null, guildName: null, appId: null, commandsVersion: 0 };

export async function seenDoFetch(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/_seen/meta" && post) {
    const meta = { ...(await metaOf(cx)), ...(await bodyOf(request)) };
    if (!meta.startedAt) meta.startedAt = cx.now();
    await cx.storage.put("meta", meta);
    return json({ ok: true, meta });
  }
  if (p === "/_seen/meta") return json({ ok: true, meta: await metaOf(cx) });
  if (p === "/_seen/cursors") {
    const m = await cx.storage.list({ prefix: "cur:" });
    const cursors = {}; for (const [k, v] of m) cursors[k.slice(4)] = v;
    return json({ ok: true, cursors });
  }
  // One poll's harvest: rows (newest per author wins) and the channel cursors.
  if (p === "/_seen/record" && post) {
    const b = await bodyOf(request);
    let updated = 0;
    const byUser = new Map();
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      if (!r || !r.id || !(r.at > 0)) continue;
      const id = idOf(r.id), prev = byUser.get(id);
      if (!prev || r.at > prev.at) byUser.set(id, { ...r, id, n: (prev ? prev.n : 0) + 1, firstAt: Math.min(r.at, prev ? prev.firstAt : r.at) });
      else { prev.n++; prev.firstAt = Math.min(prev.firstAt, r.at); }
    }
    for (const [id, r] of byUser) {
      const key = "seen:" + id;
      const cur = (await cx.storage.get(key)) || null;
      const first = Math.min(cur && cur.first ? cur.first : r.firstAt, r.firstAt);   // the oldest post known, for "watching since"
      const next = cur && cur.at >= r.at ? { ...cur, n: (cur.n || 0) + r.n, first } : { id, name: clean(r.name, 80), at: r.at, ch: clean(r.ch, 24), chName: clean(r.chName, 100), n: (cur ? cur.n || 0 : 0) + r.n, first };
      await cx.storage.put(key, next);
      updated++;
    }
    for (const [ch, c] of Object.entries(b.cursors || {})) if (idOf(ch)) await cx.storage.put("cur:" + idOf(ch), c);
    return json({ ok: true, updated });
  }
  // Presence from the gateway (src/discord-gateway.js): online / idle / dnd /
  // offline per member. onlineAt = the last moment the member was known to be
  // online (kept when they go offline); offlineAt = when they went offline.
  if (p === "/_seen/presence" && post) {
    const b = await bodyOf(request);
    const meta = await metaOf(cx);
    if (!meta.presenceSince) { meta.presenceSince = cx.now(); if (!meta.startedAt) meta.startedAt = cx.now(); await cx.storage.put("meta", meta); }
    let updated = 0;
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      const id = idOf(r && r.id); if (!id || !(r.at > 0)) continue;
      const key = "seen:" + id;
      const cur = (await cx.storage.get(key)) || { id, n: 0 };
      const online = r.status === "online" || r.status === "idle" || r.status === "dnd";
      const next = { ...cur, id, status: online ? r.status : "offline", statusAt: r.at, online };
      if (r.name) next.name = clean(r.name, 80);
      if (online) { next.onlineAt = Math.max(cur.onlineAt || 0, r.at); if (r.client) next.client = clean(r.client, 24); }
      else { next.offlineAt = r.at; if (cur.online) next.onlineAt = Math.max(cur.onlineAt || 0, r.at); }
      await cx.storage.put(key, next); updated++;
    }
    return json({ ok: true, updated });
  }
  // The member list from the gateway: mem:<id>. `left` marks departures;
  // `complete` (every id in a full roster) marks anyone missing as left.
  if (p === "/_seen/members" && post) {
    const b = await bodyOf(request); const now = cx.now(); let upserted = 0, left = 0;
    for (const m of Array.isArray(b.members) ? b.members : []) {
      const id = idOf(m && m.id); if (!id) continue;
      const cur = (await cx.storage.get("mem:" + id)) || {};
      await cx.storage.put("mem:" + id, { id, name: clean(m.name, 80), nick: clean(m.nick, 80), joinedAt: Number(m.joinedAt) || cur.joinedAt || 0, bot: !!m.bot, seenAt: now, left: 0 }); upserted++;
    }
    for (const x of Array.isArray(b.left) ? b.left : []) { const id = idOf(x); const cur = id ? await cx.storage.get("mem:" + id) : null; if (cur && !cur.left) { cur.left = now; await cx.storage.put("mem:" + id, cur); left++; } }
    if (Array.isArray(b.complete)) {
      const keep = new Set(b.complete.map(idOf));
      const all = await cx.storage.list({ prefix: "mem:" });
      for (const [k, v] of all) if (v && !v.left && !keep.has(v.id)) { v.left = now; await cx.storage.put(k, v); left++; }
    }
    return json({ ok: true, upserted, left });
  }
  if (p === "/_seen/user") {
    const id = idOf(url.searchParams.get("id"));
    const row = id ? await cx.storage.get("seen:" + id) : null;
    const member = id ? await cx.storage.get("mem:" + id) : null;
    return json({ ok: true, row: row || null, member: member || null, meta: await metaOf(cx) });
  }
  // Everyone with any activity (a post or being online), quietest first;
  // ?days=N keeps those quiet for at least N days. `never`: members on the
  // roster with no activity at all, oldest join first.
  if (p === "/_seen/list") {
    const now = cx.now();
    const days = Math.max(0, Number(url.searchParams.get("days")) || 0);
    const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit")) || 500));
    const m = await cx.storage.list({ prefix: "seen:" });
    const act = (r) => Math.max(r.at || 0, r.onlineAt || 0);
    const seen = [...m.values()].filter((r) => r && act(r) > 0);
    const rows = seen.filter((r) => !days || now - act(r) >= days * 864e5).map((r) => ({ ...r, last: act(r) })).sort((a, b) => a.last - b.last);
    const roster = [...(await cx.storage.list({ prefix: "mem:" })).values()].filter((x) => x && !x.bot && !x.left);
    const seenIds = new Set(seen.map((r) => r.id));
    const never = roster.filter((x) => !seenIds.has(x.id) && (!days || now - (x.joinedAt || 0) >= days * 864e5)).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    return json({ ok: true, total: seen.length, members: roster.length, rows: rows.slice(0, limit), never: never.slice(0, limit), now });
  }
  // Retention (src/retention.js): rows whose last activity is past
  // discordSeenDays; roster rows of members gone for discordLeftDays.
  if (p === "/_seen/sweep" && post) {
    const now = cx.now(), cut = now - RETENTION.discordSeenDays * 864e5, cutLeft = now - RETENTION.discordLeftDays * 864e5;
    const m = await cx.storage.list({ prefix: "seen:" });
    const gone = []; for (const [k, v] of m) if (!v || Math.max(v.at || 0, v.onlineAt || 0, v.statusAt || 0) < cut) gone.push(k);
    const members = gone.length;
    const r = await cx.storage.list({ prefix: "mem:" });
    for (const [k, v] of r) if (!v || (v.left && v.left < cutLeft)) gone.push(k);
    for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
    return json({ ok: true, counts: { members, departed: gone.length - members } });
  }
  if (p === "/_seen/health") {
    const meta = await metaOf(cx);
    const m = await cx.storage.list({ prefix: "seen:" });
    const rows = [...m.values()].filter(Boolean);
    const roster = [...(await cx.storage.list({ prefix: "mem:" })).values()].filter((x) => x && !x.bot && !x.left);
    return json({ ok: true, tracked: m.size, posters: rows.filter((r) => r.at).length, withPresence: rows.filter((r) => r.onlineAt || r.statusAt).length, onlineNow: rows.filter((r) => r.online).length, roster: roster.length, presenceSince: meta.presenceSince || null, startedAt: meta.startedAt, lastPollAt: meta.lastPollAt, polls: meta.polls, messages: meta.messages, channels: meta.channels, lastError: meta.lastError, commandsVersion: meta.commandsVersion, guild: meta.guildName || meta.guildId || null });
  }
  return json({ ok: false, error: "no such path" }, 404);
}

/* ---- worker side: the poll --------------------------------------------- */

const ORIGIN = "https://exor-binder.internal";
async function doCall(env, path, body) {
  const r = await env.ROOM.get(env.ROOM.idFromName(SEEN_DO)).fetch(new Request(ORIGIN + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}));
  return r.json();
}

/* Text channels and public threads the server has, as {id, name, parent}. */
export async function listChannels(env, guildId, fetchFn) {
  const chans = await api(env, "GET", "/guilds/" + guildId + "/channels", null, fetchFn);
  const out = [];
  for (const c of Array.isArray(chans) ? chans : []) if (TEXT_TYPES.has(c.type)) out.push({ id: String(c.id), name: clean(c.name, 100) });
  try {
    const th = await api(env, "GET", "/guilds/" + guildId + "/threads/active", null, fetchFn);
    for (const t of (th && th.threads) || []) if (THREAD_TYPES.has(t.type)) out.push({ id: String(t.id), name: clean(t.name, 100), thread: true });
  } catch (e) { if (!e.forbidden) throw e; }
  return out;
}

/* One channel for one tick: the messages after its cursor (up to FORWARD_PAGES
   pages), then up to BACKFILL_PER_TICK older pages while the backfill is not
   done. Returns the rows found and the cursor to store. */
export async function pollChannel(env, channel, cursor, now, fetchFn) {
  const cur = { ...(cursor || {}), name: channel.name };
  const rows = [];
  const take = (msgs) => { for (const m of Array.isArray(msgs) ? msgs : []) { const r = rowOf(m, channel); if (r) rows.push(r); cur.newest = newerId(cur.newest, m.id); cur.oldest = olderId(cur.oldest, m.id); } return Array.isArray(msgs) ? msgs.length : 0; };
  try {
    if (!cur.newest) {
      // first look: the latest page; older pages come with the backfill
      const n = take(await api(env, "GET", "/channels/" + channel.id + "/messages?limit=100", null, fetchFn));
      cur.backPages = 1; cur.backDone = n < 100;
    } else {
      for (let i = 0; i < FORWARD_PAGES; i++) {
        const n = take(await api(env, "GET", "/channels/" + channel.id + "/messages?limit=100&after=" + cur.newest, null, fetchFn));
        if (n < 100) break;
      }
      for (let i = 0; i < BACKFILL_PER_TICK && !cur.backDone && (cur.backPages || 0) < BACKFILL_PAGES && cur.oldest; i++) {
        const n = take(await api(env, "GET", "/channels/" + channel.id + "/messages?limit=100&before=" + cur.oldest, null, fetchFn));
        cur.backPages = (cur.backPages || 0) + 1;
        if (n < 100) cur.backDone = true;
      }
      if ((cur.backPages || 0) >= BACKFILL_PAGES) cur.backDone = true;
    }
    cur.polledAt = now; delete cur.deniedAt;
  } catch (e) {
    if (e.forbidden || e.notFound) { cur.deniedAt = now; cur.polledAt = now; }
    else throw e;
  }
  return { rows, cursor: cur };
}

export async function discordSeenTick(env, opts) {
  const o = opts || {};
  if (!seenConfigured(env) || !env.ROOM) return null;
  const now = o.now || Date.now();
  const meta = (await doCall(env, "/_seen/meta")).meta;
  if (!o.force && now - (meta.lastPollAt || 0) < POLL_GAP_MS) return { skipped: "not due" };
  const out = { polled: 0, rows: 0, denied: 0, registered: false };
  try {
    const guild = await resolveGuild(env, meta, o.fetchFn);
    const channels = await listChannels(env, guild.id, o.fetchFn);
    const cursors = (await doCall(env, "/_seen/cursors")).cursors;
    // least recently polled first, so a server with more than MAX_CHANNELS channels still rotates through all of them
    channels.sort((a, b) => ((cursors[a.id] && cursors[a.id].polledAt) || 0) - ((cursors[b.id] && cursors[b.id].polledAt) || 0));
    const rows = [], next = {};
    for (const c of channels.slice(0, MAX_CHANNELS)) {
      const cur = cursors[c.id];
      if (cur && cur.deniedAt && now - cur.deniedAt < DENIED_RETRY_MS) { out.denied++; continue; }
      const r = await pollChannel(env, c, cur, now, o.fetchFn);
      rows.push(...r.rows); next[c.id] = r.cursor; out.polled++;
      if (r.cursor.deniedAt) out.denied++;
    }
    for (let i = 0; i < rows.length || i === 0; i += 400) await doCall(env, "/_seen/record", { rows: rows.slice(i, i + 400), cursors: i === 0 ? next : {} });
    out.rows = rows.length;
    const patch = { lastPollAt: now, polls: (meta.polls || 0) + 1, messages: (meta.messages || 0) + rows.length, channels: channels.length, lastError: null, guildId: guild.id, guildName: guild.name || meta.guildName || null };
    // slash commands: registered once per COMMANDS_VERSION
    if ((meta.commandsVersion || 0) !== COMMANDS_VERSION) {
      try {
        const app = meta.appId ? { id: meta.appId } : await api(env, "GET", "/oauth2/applications/@me", null, o.fetchFn);
        patch.appId = String(app.id);
        await api(env, "PUT", "/applications/" + patch.appId + "/guilds/" + guild.id + "/commands", COMMANDS, o.fetchFn);
        patch.commandsVersion = COMMANDS_VERSION; out.registered = true;
      } catch (e) {
        patch.lastError = "commands: " + String(e.message).slice(0, 160) + (e.forbidden ? " - invite the bot again with the applications.commands scope (see /discord-seen/preview.json)" : "");
      }
    }
    await doCall(env, "/_seen/meta", patch);
    out.error = patch.lastError;
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 200);
    await doCall(env, "/_seen/meta", { lastPollAt: now, lastError: out.error });
  }
  return out;
}

/* ---- Discord -> us: slash commands -------------------------------------- */

export async function verifySignature(env, request, bodyText) {
  if (!publicKeySet(env)) return { ok: false, status: 501, error: "DISCORD_PUBLIC_KEY is not set on the worker" };
  const sig = String(request.headers.get("x-signature-ed25519") || ""), ts = String(request.headers.get("x-signature-timestamp") || "");
  if (!/^[0-9a-f]{128}$/i.test(sig) || !ts) return { ok: false, status: 401, error: "bad request signature" };
  try {
    const key = await crypto.subtle.importKey("raw", hex(String(env.DISCORD_PUBLIC_KEY).trim()), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, hex(sig), new TextEncoder().encode(ts + bodyText));
    return ok ? { ok: true } : { ok: false, status: 401, error: "bad request signature" };
  } catch (e) { return { ok: false, status: 401, error: "signature check failed: " + String(e.message).slice(0, 80) }; }
}

const reply = (content) => json({ type: 4, data: { content: content.slice(0, 1900), flags: 64, allowed_mentions: { parse: [] } } });

export async function answerCommand(env, body, now) {
  const data = body.data || {};
  const opt = (n) => { const x = (data.options || []).find((q) => q && q.name === n); return x ? x.value : undefined; };
  const meta = (await doCall(env, "/_seen/meta")).meta;
  const since = meta.startedAt ? " (watching since " + whenAtlantic(meta.startedAt) + " Atlantic; posts from the last pages of each channel before that count too)" : "";
  const day = (ms) => whenAtlantic(ms).replace(/,? \d\d:\d\d$/, "");
  const presenceNote = meta.presenceSince ? "Online status counted since " + whenAtlantic(meta.presenceSince) + " Atlantic" : "Online status is not being tracked yet (the gateway connection is not up)";
  if (data.name === "lastseen") {
    const id = idOf(opt("member"));
    if (!id) return reply("Pick a member.");
    const u = data.resolved && data.resolved.users && data.resolved.users[id];
    if (u && u.bot) return reply("<@" + id + "> is a bot; I only track people.");
    const got = await doCall(env, "/_seen/user?id=" + id);
    const r = got.row, mb = got.member;
    if (!r && !mb) return reply("I have not seen <@" + id + "> post or come online" + since + ".");
    const parts = [];
    if (r && r.online) parts.push("**Online now**" + (r.client ? " on " + r.client : "") + (r.status && r.status !== "online" ? " (" + r.status + ")" : ""));
    else if (r && r.onlineAt) parts.push("Last online **" + ago(r.onlineAt, now) + "** (" + whenAtlantic(r.onlineAt) + " Atlantic)");
    else parts.push(meta.presenceSince ? "Not seen online since " + whenAtlantic(meta.presenceSince) + " Atlantic" : presenceNote);
    if (r && r.at) parts.push("Last posted **" + ago(r.at, now) + "** (" + whenAtlantic(r.at) + " Atlantic) in <#" + r.ch + ">" + (r.n > 1 ? ", " + r.n + " posts seen" : ""));
    else parts.push("No posts seen" + since);
    if (mb && mb.left) parts.push("Left the server " + ago(mb.left, now));
    else if (mb && mb.joinedAt) parts.push("Joined " + day(mb.joinedAt));
    return reply("<@" + id + ">: " + parts.join(". ") + ".");
  }
  if (data.name === "inactive") {
    const days = Math.min(3650, Math.max(1, Math.floor(Number(opt("days")) || 30)));
    const l = await doCall(env, "/_seen/list?days=" + days + "&limit=" + MAX_LIST);
    const lines = (l.rows || []).map((r) => "<@" + r.id + "> - " + ((r.onlineAt || 0) > (r.at || 0) ? "online " : "posted ") + ago(r.last, now) + ((r.at || 0) >= (r.onlineAt || 0) && r.ch ? " in <#" + r.ch + ">" : ""));
    const never = (l.never || []).slice(0, Math.max(0, MAX_LIST - lines.length)).map((x) => "<@" + x.id + "> - never seen" + (x.joinedAt ? ", joined " + day(x.joinedAt) : ""));
    const n = lines.length + never.length;
    const head = n ? "**" + n + ((l.rows || []).length >= MAX_LIST || (l.never || []).length > never.length ? "+" : "") + " quiet for " + days + " days** (of " + (l.members || l.total) + " members; quietest first):" : "Everyone I know of (" + l.total + " members) has posted or been online within " + days + " days.";
    return reply(head + (lines.length ? "\n" + lines.join("\n") : "") + (never.length ? "\n" + never.join("\n") : "") + "\n" + presenceNote + "; posts" + since + ".");
  }
  return reply("I do not know that command.");
}

export async function serveInteraction(request, env, url) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await request.text();
  const v = await verifySignature(env, request, text);
  if (!v.ok) return json({ error: v.error }, v.status);
  let body = {}; try { body = JSON.parse(text) || {}; } catch {}
  if (body.type === 1) return json({ type: 1 });
  if (body.type === 2) {
    try { return await answerCommand(env, body, Date.now()); }
    catch (e) { return reply("Something went wrong on my side: " + String((e && e.message) || e).slice(0, 120)); }
  }
  return json({ error: "unsupported interaction" }, 400);
}

/* ---- staff + health ------------------------------------------------------- */

export async function serveDiscordSeen(request, env, url, staffOk, sopts) {
  const cors = { "access-control-allow-origin": "*", ...noStore };
  const gw = async () => { try { const g = await gatewayStatus(env); return { state: g.state, connected: !!g.connected, halted: g.halted || null, lastEventAt: g.lastEventAt || 0, presences: g.presences || 0, reconnects: g.reconnects || 0, guildName: g.guildName || null, memberCount: g.memberCount || null }; } catch (e) { return { state: "unknown", error: String((e && e.message) || e).slice(0, 80) }; } };
  if (url.pathname === "/discord-seen/health") {
    const h = env.ROOM ? await doCall(env, "/_seen/health") : {};
    return Response.json({ ...h, configured: seenConfigured(env), publicKey: publicKeySet(env), commands: COMMANDS.map((c) => c.name), gateway: await gw() }, { headers: cors });
  }
  if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) return Response.json({ error: "staff PIN required" }, { status: 403, headers: cors });
  if (url.pathname === "/discord-seen/preview.json") {
    const h = await doCall(env, "/_seen/health");
    const meta = (await doCall(env, "/_seen/meta")).meta;
    const setup = [];
    if (!seenConfigured(env)) setup.push("set DISCORD_BOT_TOKEN (the events bot's token)");
    if (!publicKeySet(env)) setup.push("add the GitHub Actions secret DISCORD_PUBLIC_KEY = the PUBLIC KEY on the app's General Information page (Developer Portal), then redeploy");
    setup.push("Developer Portal > the app > General Information > Interactions Endpoint URL = " + url.origin + "/discord-seen/interactions (save; Discord checks it with a signed ping)");
    if ((meta.commandsVersion || 0) !== COMMANDS_VERSION) setup.push("the slash commands register on the next poll; if that fails with Missing Access, re-invite the bot with the applications.commands scope: https://discord.com/oauth2/authorize?client_id=" + (meta.appId || "APP_ID") + "&scope=bot%20applications.commands&permissions=66560");
    setup.push("in every channel that should count, the bot's role needs View Channel + Read Message History");
    const gateway = await gw();
    if (gateway.halted || !gateway.connected) setup.push("online status: Developer Portal > the app > Bot > Privileged Gateway Intents: turn on Presence Intent and Server Members Intent and save (the gateway connection closes with 4014 without them; it retries within the hour, or POST /discord-seen/gateway/start)");
    return Response.json({ ...h, configured: seenConfigured(env), publicKey: publicKeySet(env), appId: meta.appId, guild: { id: meta.guildId, name: meta.guildName }, pollEvery: "5 min", backfill: BACKFILL_PAGES * 100 + " messages per channel", commands: COMMANDS, commandsVersion: { registered: meta.commandsVersion || 0, current: COMMANDS_VERSION }, interactionsUrl: url.origin + "/discord-seen/interactions", gateway, setup, retentionDays: RETENTION.discordSeenDays }, { headers: cors });
  }
  // The gateway connection (src/discord-gateway.js): state, start / stop / reset (reset drops the saved session).
  if (url.pathname === "/discord-seen/gateway.json") return Response.json(await gatewayStatus(env), { headers: cors });
  if (url.pathname.startsWith("/discord-seen/gateway/") && request.method === "POST") {
    const action = url.pathname.slice("/discord-seen/gateway/".length);
    if (action === "start") return Response.json(await gatewayControl(env, "start"), { headers: cors });
    if (action === "reset") return Response.json(await gatewayControl(env, "start", { fresh: true }), { headers: cors });
    if (action === "stop") return Response.json(await gatewayControl(env, "stop"), { headers: cors });
  }
  if (url.pathname === "/discord-seen/poll" && request.method === "POST") {
    if (!seenConfigured(env)) return Response.json({ ok: false, error: "DISCORD_BOT_TOKEN is not set" }, { status: 503, headers: cors });
    return Response.json(await discordSeenTick(env, { force: true, fetchFn: sopts && sopts.fetchFn }), { headers: cors });
  }
  if (url.pathname === "/discord-seen/list.json") {
    const l = await doCall(env, "/_seen/list?days=" + encodeURIComponent(url.searchParams.get("days") || "0") + "&limit=" + encodeURIComponent(url.searchParams.get("limit") || "500"));
    return Response.json({ ...l, rows: (l.rows || []).map((r) => ({ ...r, ago: ago(r.at, l.now), when: whenAtlantic(r.at) })) }, { headers: cors });
  }
  return Response.json({ error: "no such path" }, { status: 404, headers: cors });
}
