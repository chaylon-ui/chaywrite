/* src/discord-events.js — store events as Discord Scheduled Events (owner, 2026-10-01:
   "Could there be some way to auto post our events to discord" ... "Can it be set
   up as a discord event" ... "Let's build it").

   The worker's cron reads Charlottetown's BinderPOS events feed (the same
   public feed the storefront's event cards use, src/events.js) and keeps the
   Discord server's Events tab in step with it: every event starting within
   the next DAYS days (14) exists in Discord once, is updated when its title,
   time, fee or ticket link change in BinderPOS, and is removed when it
   disappears from the feed before it starts. Scheduled Events live in the
   server's Events tab and in the "N events" line above the channel list; the
   bot never posts a message to a channel and never pings anyone, so a
   fourteen-day window of ~20 events sits quietly where people look for them.

   Discord API: POST/PATCH/DELETE /guilds/{guild}/scheduled-events with the
   bot token, entity_type 3 (EXTERNAL: start AND end time, a location
   string), privacy_level 2 (guild only). An external event that nobody
   starts is cleaned up by Discord itself after its end time passes.

   Configuration (worker secrets; deploy.yml syncs each from the GitHub
   Actions secret of the same name when it exists):
     DISCORD_BOT_TOKEN       the bot's token (Bot needs "Manage Events" in the server)
     DISCORD_GUILD_ID        optional: the server id. Absent, the bot asks
                             GET /users/@me/guilds and uses the one server it
                             is in; two or more and it stops and names them.
     DISCORD_EVENTS_DAYS     optional window in days (default 14, 1..60)
   Nothing happens until DISCORD_BOT_TOKEN is set. A sync runs at most every
   SYNC_GAP_MS (30 min) from the five-minute cron; the staff routes run it now.

   Staff, PIN-gated like /portal:
     GET  /discord-events/preview.json?k=PIN  configured?, server, what the next sync would create / update / delete / keep
     POST /discord-events/sync?k=PIN          run the sync now
     POST /discord-events/test?k=PIN          create one "test" event an hour from now (POST again with ?delete=1 removes it)

   Memory (portal-cache DO via kvGet/kvPut): BinderPOS event -> Discord event
   id + a hash of what was sent, so a changed event is PATCHed, an unchanged
   one costs nothing, and a vanished one is DELETEd. An event a human deletes
   in Discord stays deleted: the map remembers it as removed until the
   BinderPOS side changes, then it is created again. */

import { kvGet, kvPut } from "./portal.js";
import { fetchEvents, HOME_ORIGIN } from "./events.js";
import { localToUtc } from "./ics.js";

const API = "https://discord.com/api/v10";
const STATE_KEY = "discord-events:state";
const STATE_TTL_MS = 90 * 864e5;
const SYNC_GAP_MS = 30 * 60e3;
const DEFAULT_DAYS = 14;
const DEFAULT_HOURS = 3;            // an event with no end time lasts this long (matches /ics)
const MAX_WRITES = 12;              // creates + edits per sync: gentle on Discord's limits; the rest wait for the next sync
const MAX_NAME = 100, MAX_DESC = 1000, MAX_LOCATION = 100;   // Discord's field limits
const LOCATION = "Exor Games, 51 Allen Street, Charlottetown, PE";
const ICS = "https://exor-binder.nevski.workers.dev/ics";
const EVENTS_PAGE = "https://exorgames.com/pages/events";
const UA = "ExorEvents/1.0 (+https://exorgames.com)";

export function eventsConfigured(env) { return !!(env && env.DISCORD_BOT_TOKEN); }
export function windowDays(env) {
  const n = Number(env && env.DISCORD_EVENTS_DAYS);
  return n >= 1 && n <= 60 ? Math.floor(n) : DEFAULT_DAYS;
}

/* ---- BinderPOS event -> what Discord should hold ----------------------- */

const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
const hhmm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? (m[1].length < 2 ? "0" : "") + m[1] + ":" + m[2] : null; };

/* The feed's date + time are Atlantic wall-clock values; ics.js turns them
   into instants with the right DST offset for that date. Null when the event
   has no usable time (Discord needs an instant). */
export function eventTimes(e) {
  const start = localToUtc(e.date + "T" + (hhmm(e.time) || ""));
  if (!start) return null;
  let end = e.endTime ? localToUtc(e.date + "T" + (hhmm(e.endTime) || "")) : null;
  if (!end || end.getTime() <= start.getTime()) end = new Date(start.getTime() + DEFAULT_HOURS * 3600e3);
  return { start, end };
}

export function feeLine(e) {
  if (typeof e.ticketPrice === "number" && e.ticketPrice > 0.009) return "Entry: " + money(e.ticketPrice) + (e.ticketed && e.url ? " (tickets: " + e.url + ")" : " (pay in store)");
  if (e.ticketed && e.url) return "Tickets: " + e.url;
  return "Entry: free, or pay in store";
}

function icsLink(e, t) {
  const q = new URLSearchParams();
  q.set("t", e.title.slice(0, 300));
  q.set("s", e.date + "T" + hhmm(e.time));
  const endLocal = e.endTime ? hhmm(e.endTime) : null;
  if (endLocal && t.end.getTime() > t.start.getTime() && localToUtc(e.date + "T" + endLocal)) q.set("e", e.date + "T" + endLocal);
  q.set("loc", LOCATION);
  if (e.url) q.set("u", e.url.slice(0, 300));
  return ICS + "?" + q.toString();
}

/* The stable key one BinderPOS event keeps across syncs: its id when the
   feed sends one, else its date + start time + title. */
export function eventKey(e) { return e.id ? "id:" + e.id : "k:" + e.date + "|" + (hhmm(e.time) || "") + "|" + e.title.toLowerCase().trim(); }

/* The Discord payload for one event (null when it cannot be scheduled). */
export function toDiscord(e, now = Date.now()) {
  const t = eventTimes(e);
  if (!t) return { skip: "no start time" };
  if (t.start.getTime() <= now + 60e3) return { skip: "already started" };
  const lines = [];
  if (e.game) lines.push("Game: " + e.game);
  lines.push(feeLine(e));
  lines.push("Add to your calendar: " + icsLink(e, t));
  lines.push("All events: " + EVENTS_PAGE);
  const description = lines.join("\n").slice(0, MAX_DESC);
  return {
    key: eventKey(e),
    body: {
      name: e.title.trim().slice(0, MAX_NAME) || "Event",
      privacy_level: 2,
      scheduled_start_time: t.start.toISOString(),
      scheduled_end_time: t.end.toISOString(),
      description,
      entity_type: 3,
      entity_metadata: { location: LOCATION.slice(0, MAX_LOCATION) },
    },
    image: e.calendarIcon || null,
    startMs: t.start.getTime(),
  };
}

export async function hashBody(body) {
  const text = JSON.stringify([body.name, body.scheduled_start_time, body.scheduled_end_time, body.description, body.entity_metadata.location]);
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---- the plan: feed + memory -> creates / updates / deletes ------------- */

/* map: key -> { id, hash, startMs, removed? }. Pure, so it is testable. */
export async function plan(feedEvents, map, now = Date.now()) {
  const out = { create: [], update: [], remove: [], keep: [], skipped: [] };
  const seen = new Set();
  for (const e of feedEvents) {
    const d = toDiscord(e, now);
    if (d.skip) { out.skipped.push({ title: e.title, date: e.date, why: d.skip }); continue; }
    if (seen.has(d.key)) { out.skipped.push({ title: e.title, date: e.date, why: "duplicate in feed" }); continue; }
    seen.add(d.key);
    d.hash = await hashBody(d.body);
    const m = map[d.key];
    if (!m) out.create.push(d);
    else if (m.removed) { if (m.hash !== d.hash) out.create.push(d); else out.keep.push({ ...d, id: null, removed: true }); }
    else if (m.hash !== d.hash) out.update.push({ ...d, id: m.id });
    else out.keep.push({ ...d, id: m.id });
  }
  for (const [key, m] of Object.entries(map)) {
    if (seen.has(key)) continue;
    // Gone from the feed before it started: take it down. Past events fall out of the map on their own.
    if (m.id && !m.removed && m.startMs > now) out.remove.push({ key, id: m.id, name: m.name || key });
  }
  return out;
}

/* ---- Discord calls ------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PAUSE_MS = 15e3;

/* One Discord call. Discord meters the scheduled-events routes tightly (the
   first live sync hit 429 after five creates in ~3 s): when the answer says the
   bucket is empty the call pauses for its reset (CPU-free, up to 15 s) before
   returning, and a 429 is slept off once and retried. A 403 is marked
   `forbidden` so the caller stops instead of failing every event the same way. */
async function api(env, method, path, body, fetchFn, retried) {
  const f = fetchFn || fetch;
  const r = await f(API + path, {
    method,
    headers: { authorization: "Bot " + env.DISCORD_BOT_TOKEN, "content-type": "application/json", "user-agent": UA },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 429) {
    const j = await r.json().catch(() => ({}));
    const wait = Number(j.retry_after) || Number(r.headers.get("retry-after")) || 2;
    if (!retried && wait * 1000 <= MAX_PAUSE_MS) { await sleep(wait * 1000 + 250); return api(env, method, path, body, fetchFn, true); }
    const err = new Error("rate limited (" + wait + "s)");
    err.rateLimited = true;
    throw err;
  }
  const remaining = Number(r.headers.get("x-ratelimit-remaining"));
  const resetAfter = Number(r.headers.get("x-ratelimit-reset-after"));
  const pause = remaining === 0 && resetAfter > 0 ? Math.min(resetAfter * 1000 + 250, MAX_PAUSE_MS) : 0;
  if (r.status === 204) { if (pause) await sleep(pause); return null; }
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = (j && (j.message || (j.errors && JSON.stringify(j.errors).slice(0, 160)))) || text.slice(0, 160) || ("http " + r.status);
    const err = new Error("discord " + r.status + ": " + msg);
    if (r.status === 403) err.forbidden = true;
    if (r.status === 404) err.notFound = true;
    throw err;
  }
  if (pause) await sleep(pause);
  return j;
}

/* Does the bot hold Manage Events in the server? GET /users/@me/guilds carries
   the bot's own permission bits per server (MANAGE_EVENTS = 1 << 33). null = unknown. */
export const MANAGE_EVENTS = 1n << 33n;
export function canManageEvents(guildRow) {
  try { return guildRow && guildRow.permissions != null ? (BigInt(guildRow.permissions) & MANAGE_EVENTS) === MANAGE_EVENTS : null; } catch { return null; }
}
export async function checkPermissions(env, guildId, fetchFn) {
  const guilds = await api(env, "GET", "/users/@me/guilds", null, fetchFn);
  const row = Array.isArray(guilds) ? guilds.find((g) => String(g.id) === String(guildId)) : null;
  if (!row) return { inGuild: false, manageEvents: false };
  return { inGuild: true, manageEvents: canManageEvents(row), name: row.name ? String(row.name) : null };
}
const PERMISSION_HELP = "the bot has no Manage Events permission in the server: Server Settings > Roles > the bot's role > enable Manage Events (or re-invite it with that permission)";

/* The server: DISCORD_GUILD_ID, else the one server the bot is in. */
export async function resolveGuild(env, state, fetchFn) {
  if (env.DISCORD_GUILD_ID) return { id: String(env.DISCORD_GUILD_ID), name: state.guildName || null };
  if (state.guildId) return { id: state.guildId, name: state.guildName || null };
  const guilds = await api(env, "GET", "/users/@me/guilds", null, fetchFn);
  if (!Array.isArray(guilds) || !guilds.length) throw new Error("the bot is not in any server yet: open its invite link and add it to the Exor Games server");
  if (guilds.length > 1) throw new Error("the bot is in " + guilds.length + " servers (" + guilds.map((g) => g.name + " " + g.id).join(", ") + "): set DISCORD_GUILD_ID to the Exor Games one");
  return { id: String(guilds[0].id), name: String(guilds[0].name || "") };
}

/* calendarIcon -> data URI for the event cover (optional; any failure = no image). */
async function coverImage(url, fetchFn) {
  try {
    if (!/^https:\/\//i.test(url || "")) return null;
    const f = fetchFn || fetch;
    const r = await f(url, { headers: { "user-agent": UA }, cf: { cacheTtl: 86400 } });
    if (!r.ok) return null;
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 1.5e6) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return "data:" + type + ";base64," + btoa(bin);
  } catch { return null; }
}

/* ---- state -------------------------------------------------------------- */

async function readState(env) {
  try {
    const t = await kvGet(env, STATE_KEY);
    const s = t ? JSON.parse(t) : null;
    if (s && s.map && typeof s.map === "object") return s;
  } catch {}
  return { map: {}, guildId: null, guildName: null, lastSyncAt: null, lastError: null, last: null, testId: null };
}
const writeState = (env, s) => kvPut(env, STATE_KEY, JSON.stringify(s), STATE_TTL_MS);

function pruneMap(map, now) {
  for (const [k, m] of Object.entries(map)) if (!(m.startMs > now - 864e5)) delete map[k];
}

async function feedWindow(env, now, fetchFn) {
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const days = windowDays(env);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const list = await fetchEvents(HOME_ORIGIN, iso(now - 864e5), iso(now + days * 864e5), { signal: ctrl.signal, fetchFn });
    // The feed answers by date; cut to the window by instant so the last day is whole and nothing beyond it slips in.
    return list.filter((e) => { const tt = eventTimes(e); return !tt || tt.start.getTime() <= now + days * 864e5; });
  } finally { clearTimeout(t); }
}

/* ---- the sync ----------------------------------------------------------- */

export async function syncEvents(env, { force = false, now = Date.now(), fetchFn } = {}) {
  if (!eventsConfigured(env)) return { skipped: "not configured" };
  const state = await readState(env);
  if (!force && state.lastSyncAt && now - state.lastSyncAt < SYNC_GAP_MS) return { skipped: "synced " + Math.round((now - state.lastSyncAt) / 60e3) + " min ago" };
  const result = { created: 0, updated: 0, removed: 0, kept: 0, skipped: 0, errors: [], guild: null, writesLeft: MAX_WRITES };
  state.lastSyncAt = now;
  try {
    const guild = await resolveGuild(env, state, fetchFn);
    state.guildId = guild.id; state.guildName = guild.name || state.guildName;
    result.guild = guild;
    const perm = await checkPermissions(env, guild.id, fetchFn);
    if (perm.name && !guild.name) { guild.name = perm.name; state.guildName = perm.name; }
    if (!perm.inGuild) throw new Error("the bot is no longer in server " + guild.id + (env.DISCORD_GUILD_ID ? " (DISCORD_GUILD_ID)" : "") + ": invite it again");
    if (perm.manageEvents === false) throw new Error(PERMISSION_HELP);
    const feed = await feedWindow(env, now, fetchFn);
    pruneMap(state.map, now);
    // Discord's own list: an event a human deleted stays deleted; one we think exists but does not is forgotten.
    let live = null;
    try { live = await api(env, "GET", "/guilds/" + guild.id + "/scheduled-events", null, fetchFn); } catch (e) { result.errors.push("list: " + e.message); }
    if (Array.isArray(live)) {
      const ids = new Set(live.map((x) => String(x.id)));
      for (const m of Object.values(state.map)) if (m.id && !m.removed && !ids.has(String(m.id))) { m.removed = true; m.removedAt = now; }
      if (state.testId && !ids.has(String(state.testId))) state.testId = null;
    }
    const p = await plan(feed, state.map, now);
    result.kept = p.keep.length; result.skipped = p.skipped.length;
    const path = "/guilds/" + guild.id + "/scheduled-events";
    for (const r of p.remove) {
      try { await api(env, "DELETE", path + "/" + r.id, null, fetchFn); result.removed++; }
      catch (e) { if (!e.notFound) result.errors.push("remove " + r.name + ": " + e.message); if (e.rateLimited || e.forbidden) break; }
      delete state.map[r.key];
    }
    for (const u of p.update) {
      if (result.writesLeft <= 0) break;
      result.writesLeft--;
      try {
        await api(env, "PATCH", path + "/" + u.id, u.body, fetchFn);
        state.map[u.key] = { id: u.id, hash: u.hash, startMs: u.startMs, name: u.body.name };
        result.updated++;
      } catch (e) {
        if (e.notFound) { state.map[u.key] = { id: null, hash: "", startMs: u.startMs, removed: true, removedAt: now, name: u.body.name }; }
        else result.errors.push("update " + u.body.name + ": " + e.message);
        if (e.rateLimited || e.forbidden) break;
      }
    }
    for (const c of p.create) {
      if (result.writesLeft <= 0) break;
      result.writesLeft--;
      try {
        const img = c.image ? await coverImage(c.image, fetchFn) : null;
        const made = await api(env, "POST", path, img ? { ...c.body, image: img } : c.body, fetchFn);
        if (!made || !made.id) throw new Error("no id in the answer");
        state.map[c.key] = { id: String(made.id), hash: c.hash, startMs: c.startMs, name: c.body.name };
        result.created++;
      } catch (e) { result.errors.push("create " + c.body.name + ": " + e.message); if (e.rateLimited || e.forbidden) { if (e.forbidden) result.errors.push(PERMISSION_HELP); break; } }
    }
    if (p.create.length + p.update.length > MAX_WRITES) result.deferred = p.create.length + p.update.length - MAX_WRITES;
    state.lastError = result.errors.length ? result.errors[0].slice(0, 200) : null;
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    result.errors.push(msg);
    state.lastError = msg;
  }
  state.last = { at: now, created: result.created, updated: result.updated, removed: result.removed, kept: result.kept, errors: result.errors.length };
  await writeState(env, state);
  return result;
}

/* Cron entry: quiet unless the token is set; a failure never reaches the caller. */
export async function discordEventsTick(env) {
  if (!eventsConfigured(env)) return null;
  try { return await syncEvents(env); }
  catch (e) { return { errors: [String((e && e.message) || e).slice(0, 200)] }; }
}

/* ---- staff routes ------------------------------------------------------- */

export async function serveDiscordEvents(request, env, url, staffOk) {
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) return Response.json({ error: "staff PIN required" }, { status: 403, headers: cors });
  const configured = eventsConfigured(env);
  if (url.pathname === "/discord-events/preview.json") {
    const state = await readState(env);
    const now = Date.now();
    const out = {
      configured, guildIdSet: !!env.DISCORD_GUILD_ID, guild: state.guildId ? { id: state.guildId, name: state.guildName } : null,
      days: windowDays(env), syncEvery: SYNC_GAP_MS / 60e3 + " min", maxWritesPerSync: MAX_WRITES, location: LOCATION,
      state: { lastSyncAt: state.lastSyncAt, lastError: state.lastError, last: state.last, tracked: Object.keys(state.map).length, testEvent: state.testId },
    };
    try {
      const feed = await feedWindow(env, now);
      const p = await plan(feed, state.map, now);
      const brief = (d) => ({ title: d.body.name, start: d.body.scheduled_start_time, end: d.body.scheduled_end_time, description: d.body.description, image: !!d.image, id: d.id || null });
      out.feed = feed.length;
      out.wouldCreate = p.create.map(brief); out.wouldUpdate = p.update.map(brief); out.wouldRemove = p.remove; out.unchanged = p.keep.map(brief); out.skipped = p.skipped;
      if (configured) {
        try {
          const g = state.guildId ? { id: state.guildId, name: state.guildName } : await resolveGuild(env, state);
          const perm = await checkPermissions(env, g.id);
          out.guild = { id: g.id, name: g.name || perm.name || null };
          out.manageEvents = perm.manageEvents;
          if (!perm.inGuild) out.guildError = "the bot is not in server " + g.id;
          else if (perm.manageEvents === false) out.guildError = PERMISSION_HELP;
        } catch (e) { out.guildError = String(e.message).slice(0, 300); }
      }
      return Response.json(out, { headers: cors });
    } catch (e) {
      return Response.json({ ...out, error: String((e && e.message) || e).slice(0, 200) }, { status: 502, headers: cors });
    }
  }
  if (!configured) return Response.json({ ok: false, error: "DISCORD_BOT_TOKEN is not set" }, { status: 503, headers: cors });
  if (url.pathname === "/discord-events/sync" && request.method === "POST") {
    return Response.json(await syncEvents(env, { force: true }), { headers: cors });
  }
  if (url.pathname === "/discord-events/test" && request.method === "POST") {
    const state = await readState(env);
    try {
      const guild = await resolveGuild(env, state);
      state.guildId = guild.id; state.guildName = guild.name || state.guildName;
      const perm = await checkPermissions(env, guild.id);
      if (perm.manageEvents === false) throw new Error(PERMISSION_HELP);
      const path = "/guilds/" + guild.id + "/scheduled-events";
      if (state.testId) {
        try { await api(env, "DELETE", path + "/" + state.testId); } catch (e) { if (!e.notFound) throw e; }
        state.testId = null;
      }
      if (url.searchParams.get("delete")) { await writeState(env, state); return Response.json({ ok: true, deleted: true }, { headers: cors }); }
      const start = new Date(Date.now() + 3600e3), end = new Date(start.getTime() + 3600e3);
      const made = await api(env, "POST", path, {
        name: "Exor Games events test", privacy_level: 2, scheduled_start_time: start.toISOString(), scheduled_end_time: end.toISOString(),
        description: "A test from the store's event sync. Store events will appear here like this, " + windowDays(env) + " days ahead. This one can be deleted.",
        entity_type: 3, entity_metadata: { location: LOCATION },
      });
      state.testId = made && made.id ? String(made.id) : null;
      await writeState(env, state);
      return Response.json({ ok: true, id: state.testId, guild, start: start.toISOString() }, { headers: cors });
    } catch (e) {
      state.lastError = String((e && e.message) || e).slice(0, 200);
      await writeState(env, state);
      return Response.json({ ok: false, error: state.lastError }, { status: 502, headers: cors });
    }
  }
  return Response.json({ error: "not found" }, { status: 404, headers: cors });
}
