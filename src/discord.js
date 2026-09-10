/* src/discord.js — "shelf drops" to Discord (owner, 2026-09-10).

   Every five minutes the worker's cron asks the default room for today's
   webhook-confirmed arrivals — the same signal the New Today strip and the
   in-store TVs run on (an inventory webhook names the product, src/room.js
   keeps the day's handles under ntarr:<day>) — hydrates the ones not yet
   announced from the storefront's public product JSON (no token, no Admin
   call), and posts them to a Discord webhook: up to ten cards per message,
   at most one message every fifteen minutes, only between 8:00 and 22:00
   Halifax time, cheap bulk and sold-out-again cards left out. What was
   posted is remembered per day in the portal-cache DO, so a card is
   announced once.

   Configuration (worker secrets; deploy.yml syncs each from the GitHub
   secret of the same name when it exists):
     DISCORD_WEBHOOK_URL       the channel that gets everything
     DISCORD_WEBHOOK_<GAME>    optional per-game channels: MTG, POKEMON,
                               YUGIOH, LORCANA, ONEPIECE, FAB, SWU,
                               RIFTBOUND, SPORTS, and SEALED for sealed
                               product. A game with its own channel is not
                               also sent to the default channel.
     DISCORD_MIN_PRICE         cheapest card worth a post (default 5)
   Staff, PIN-gated like /portal:
     GET  /discord/preview.json?k=PIN   configured?, today's state, what is pending
     POST /discord/test?k=PIN           a one-line test message to the default channel
     POST /discord/post?k=PIN           post the pending cards now (ignores the timers) */

import { kvGet, kvPut } from "./portal.js";

const STATE_KEY = "discord:state";
const STATE_TTL_MS = 3 * 864e5;
const MAX_EMBEDS = 10;              // Discord's ceiling per message
const MIN_GAP_MS = 15 * 60e3;       // a burst of restocks becomes one message, not ten
const OPEN_HOUR = 8, CLOSE_HOUR = 22;
const SHOP = "https://exorgames.com";

const GAMES = [
  ["mtg", /^mtg|magic/i, "Magic: The Gathering", 0xf4a300],
  ["pokemon", /pok[eé]mon/i, "Pokémon", 0xffcb05],
  ["yugioh", /yu-?gi-?oh/i, "Yu-Gi-Oh!", 0x6b3fa0],
  ["lorcana", /lorcana/i, "Disney Lorcana", 0x1f6fb2],
  ["onepiece", /one piece/i, "One Piece", 0xd62c28],
  ["fab", /flesh and blood/i, "Flesh and Blood", 0x8b1e1e],
  ["swu", /star wars/i, "Star Wars: Unlimited", 0x2b2b2b],
  ["riftbound", /riftbound/i, "Riftbound", 0x0f9d8a],
  ["sports", /hockey|basketball|baseball|football|ufc|sport/i, "Sports cards", 0x1d4ed8],
];

function gameOf(productType) {
  const t = String(productType || "");
  for (const [key, re, name, color] of GAMES) if (re.test(t)) return { key, name, color, sealed: /sealed/i.test(t) };
  return { key: "other", name: t || "Cards", color: 0x0d7a5f, sealed: /sealed/i.test(t) };
}
function webhookFor(env, g) {
  if (g.sealed && env.DISCORD_WEBHOOK_SEALED) return env.DISCORD_WEBHOOK_SEALED;
  return env["DISCORD_WEBHOOK_" + g.key.toUpperCase()] || env.DISCORD_WEBHOOK_URL || null;
}
export function discordConfigured(env) {
  return !!env.DISCORD_WEBHOOK_URL || !!env.DISCORD_WEBHOOK_SEALED || GAMES.some(([k]) => !!env["DISCORD_WEBHOOK_" + k.toUpperCase()]);
}
function channels(env) {
  const out = { default: !!env.DISCORD_WEBHOOK_URL, sealed: !!env.DISCORD_WEBHOOK_SEALED };
  for (const [k] of GAMES) out[k] = !!env["DISCORD_WEBHOOK_" + k.toUpperCase()];
  return out;
}

function halifax() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "0";
  return { day: get("year") + "-" + get("month") + "-" + get("day"), hour: parseInt(get("hour"), 10) % 24 };
}

async function readState(env) {
  try {
    const t = await kvGet(env, STATE_KEY);
    const s = t ? JSON.parse(t) : null;
    if (s && Array.isArray(s.posted)) return { skipped: [], posts: 0, ...s };
  } catch {}
  return { day: null, posted: [], skipped: [], lastPostAt: null, lastError: null, posts: 0 };
}
const writeState = (env, s) => kvPut(env, STATE_KEY, JSON.stringify(s), STATE_TTL_MS);

// Today's webhook-confirmed arrivals, as product handles, from the default room.
async function todaysHandles(env) {
  const r = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(SHOP + "/nt-arrivals"));
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.handles) ? j.handles.map(String).slice(0, 400) : [];
}

// One card from the storefront's public product JSON. Returns null when the
// card is not worth a post (gone, sold out again); throws on a transient
// failure so the caller leaves it for the next tick.
async function hydrate(handle) {
  const r = await fetch(SHOP + "/products/" + encodeURIComponent(handle) + ".js", { headers: { accept: "application/json" }, cf: { cacheTtl: 60 } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("product json " + r.status);
  const p = await r.json();
  const vs = (p.variants || []).filter((v) => v.available);
  if (!vs.length) return null;
  const cheapest = vs.reduce((a, v) => (Number(v.price) < Number(a.price) ? v : a), vs[0]);
  const raw = p.featured_image || (Array.isArray(p.images) && p.images[0]) || "";
  const image = raw ? (String(raw).startsWith("//") ? "https:" + raw : String(raw)) : null;
  return {
    handle, title: String(p.title || handle), type: String(p.type || ""), game: gameOf(p.type),
    price: Number(cheapest.price) / 100, conditions: vs.map((v) => String(v.title)).slice(0, 6),
    image, url: SHOP + "/products/" + handle,
  };
}

// What has not been posted today, hydrated; cheap bulk, tickets and internal
// listings are remembered as skipped so they are not fetched again.
export async function pendingDrops(env, state) {
  const minPrice = Number(env.DISCORD_MIN_PRICE) || 5;
  const handles = await todaysHandles(env);
  const done = new Set([...(state.posted || []), ...(state.skipped || [])]);
  const todo = handles.filter((h) => !done.has(h)).slice(0, 40);
  const pending = [], skipped = [], deferred = [];
  for (const h of todo) {
    let c;
    try { c = await hydrate(h); } catch { deferred.push(h); continue; }
    if (!c || c.price < minPrice || /event ticket|bulkcard|internal|tbd/i.test(c.type)) { skipped.push(h); continue; }
    pending.push(c);
  }
  pending.sort((a, b) => b.price - a.price);
  return { pending, skipped, deferred, today: handles.length };
}

const money = (n) => "$" + Number(n).toFixed(2);
function message(cards, note) {
  return {
    content: note,
    allowed_mentions: { parse: [] },
    embeds: cards.slice(0, MAX_EMBEDS).map((c) => ({
      title: c.title.slice(0, 250),
      url: c.url,
      color: c.game.color,
      description: money(c.price) + (c.conditions.length ? " · " + c.conditions.join(", ") : "") + " · " + c.game.name,
      thumbnail: c.image ? { url: c.image } : undefined,
    })),
  };
}
async function post(hook, body) {
  const r = await fetch(hook + (hook.includes("?") ? "&" : "?") + "wait=true", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Discord answered " + r.status + " " + (await r.text().catch(() => "")).slice(0, 160));
  return r.status;
}

export async function postPending(env, { force = false } = {}) {
  if (!discordConfigured(env)) return { ok: false, error: "not configured" };
  const now = halifax();
  const state = await readState(env);
  if (state.day !== now.day) Object.assign(state, { day: now.day, posted: [], skipped: [], posts: 0 });
  if (!force) {
    if (now.hour < OPEN_HOUR || now.hour >= CLOSE_HOUR) return { ok: true, held: "quiet hours", hour: now.hour };
    if (state.lastPostAt && Date.now() - Date.parse(state.lastPostAt) < MIN_GAP_MS) return { ok: true, held: "posted recently" };
  }
  const { pending, skipped } = await pendingDrops(env, state);
  state.skipped = [...(state.skipped || []), ...skipped].slice(-400);
  if (!pending.length) { await writeState(env, state); return { ok: true, posted: 0 }; }
  // One message per channel, the priciest cards first, ten at a time; the
  // rest wait for the next window.
  const byHook = new Map();
  for (const c of pending) {
    const hook = webhookFor(env, c.game);
    if (!hook) continue;
    if (!byHook.has(hook)) byHook.set(hook, []);
    byHook.get(hook).push(c);
  }
  let posted = 0;
  const errors = [];
  for (const [hook, cards] of byHook) {
    const batch = cards.slice(0, MAX_EMBEDS);
    const more = cards.length - batch.length;
    const note = "**New on the shelf** · " + batch.length + (batch.length === 1 ? " card" : " cards") + " just landed" + (more > 0 ? " (" + more + " more in the next post)" : "");
    try {
      await post(hook, message(batch, note));
      posted += batch.length;
      state.posted.push(...batch.map((c) => c.handle));
    } catch (e) { errors.push(String((e && e.message) || e).slice(0, 200)); }
  }
  state.posted = state.posted.slice(-600);
  if (posted) { state.lastPostAt = new Date().toISOString(); state.posts = (state.posts || 0) + 1; }
  state.lastError = errors[0] || null;
  await writeState(env, state);
  return { ok: !errors.length, posted, errors };
}

// The cron entry point: quiet unless configured.
export async function discordTick(env) {
  if (!discordConfigured(env)) return { skipped: "not configured" };
  return postPending(env);
}

export async function serveDiscord(request, env, url, staffOk) {
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) return Response.json({ error: "staff PIN required" }, { status: 403, headers: cors });
  if (url.pathname === "/discord/preview.json") {
    const now = halifax();
    const state = await readState(env);
    const todays = state.day === now.day ? state : { posted: [], skipped: [] };
    try {
      const p = await pendingDrops(env, todays);
      return Response.json({
        configured: discordConfigured(env), channels: channels(env), minPrice: Number(env.DISCORD_MIN_PRICE) || 5, now,
        state: { day: state.day, posted: (state.posted || []).length, skipped: (state.skipped || []).length, posts: state.posts || 0, lastPostAt: state.lastPostAt, lastError: state.lastError },
        todayArrivals: p.today, deferred: p.deferred, skippedNow: p.skipped,
        pending: p.pending.map((c) => ({ handle: c.handle, title: c.title, price: c.price, conditions: c.conditions, game: c.game.key, url: c.url, channel: webhookFor(env, c.game) ? (env["DISCORD_WEBHOOK_" + c.game.key.toUpperCase()] ? c.game.key : (c.game.sealed && env.DISCORD_WEBHOOK_SEALED ? "sealed" : "default")) : "none" })),
      }, { headers: cors });
    } catch (e) {
      return Response.json({ configured: discordConfigured(env), channels: channels(env), error: String((e && e.message) || e).slice(0, 200) }, { status: 502, headers: cors });
    }
  }
  if (url.pathname === "/discord/test" && request.method === "POST") {
    if (!env.DISCORD_WEBHOOK_URL) return Response.json({ ok: false, error: "DISCORD_WEBHOOK_URL is not set" }, { status: 503, headers: cors });
    try {
      const status = await post(env.DISCORD_WEBHOOK_URL, { content: "Exor Games shelf drops are connected to this channel. New arrivals will show up here, up to ten cards at a time.", allowed_mentions: { parse: [] } });
      return Response.json({ ok: true, status }, { headers: cors });
    } catch (e) { return Response.json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, { status: 502, headers: cors }); }
  }
  if (url.pathname === "/discord/post" && request.method === "POST") {
    return Response.json(await postPending(env, { force: true }), { headers: cors });
  }
  return Response.json({ error: "not found" }, { status: 404, headers: cors });
}
