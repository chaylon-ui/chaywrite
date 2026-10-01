// Store events -> Discord Scheduled Events (owner 2026-10-01, "Let's build it").
import test from "node:test";
import assert from "node:assert/strict";
import { eventTimes, feeLine, eventKey, toDiscord, plan, hashBody, syncEvents, resolveGuild, windowDays, canManageEvents } from "../src/discord-events.js";
import { mapEvent } from "../src/events.js";

const ev = (o) => ({ id: null, title: "Friday Night Magic", date: "2026-10-09", time: "18:30:00", endTime: null, game: "Magic: The Gathering", city: "Charlottetown", ticketPrice: 10, ticketed: true, handle: "fnm-oct-9", url: "https://exorgames.com/products/fnm-oct-9", calendarIcon: null, ...o });
const NOW = Date.UTC(2026, 9, 1, 15, 0, 0);   // 2026-10-01 15:00Z

test("eventTimes: Atlantic wall time becomes a UTC instant with the DST offset of that date; no end = +3h; no time = null", () => {
  const t = eventTimes(ev({}));
  assert.equal(t.start.toISOString(), "2026-10-09T21:30:00.000Z");        // ADT, -3
  assert.equal(t.end.toISOString(), "2026-10-10T00:30:00.000Z");
  assert.equal(eventTimes(ev({ date: "2026-12-05", time: "13:00:00" })).start.toISOString(), "2026-12-05T17:00:00.000Z");   // AST, -4
  assert.equal(eventTimes(ev({ endTime: "22:00:00" })).end.toISOString(), "2026-10-10T01:00:00.000Z");
  assert.equal(eventTimes(ev({ endTime: "17:00:00" })).end.toISOString(), "2026-10-10T00:30:00.000Z");   // an end before the start is ignored
  assert.equal(eventTimes(ev({ time: null })), null);
  assert.equal(eventTimes(ev({ time: "9:00" })).start.toISOString(), "2026-10-09T12:00:00.000Z");
});

test("feeLine: fee with tickets, fee in store, tickets only, free", () => {
  assert.equal(feeLine(ev({})), "Entry: $10 (tickets: https://exorgames.com/products/fnm-oct-9)");
  assert.equal(feeLine(ev({ ticketed: false, url: null, ticketPrice: 12.5 })), "Entry: $12.50 (pay in store)");
  assert.equal(feeLine(ev({ ticketPrice: null })), "Tickets: https://exorgames.com/products/fnm-oct-9");
  assert.equal(feeLine(ev({ ticketPrice: 0, ticketed: false, url: null })), "Entry: free, or pay in store");
});

test("eventKey follows the feed id when there is one, else date + time + title", () => {
  assert.equal(eventKey(ev({ id: "991" })), "id:991");
  assert.equal(eventKey(ev({})), "k:2026-10-09|18:30|friday night magic");
  assert.equal(eventKey(ev({ title: " Friday Night Magic" })), eventKey(ev({})));
});

test("toDiscord builds an external, guild-only event with the fee, calendar link and events page; skips past or timeless events", () => {
  const d = toDiscord(ev({ calendarIcon: "https://cdn.example/mtg.png" }), NOW);
  assert.equal(d.body.name, "Friday Night Magic");
  assert.equal(d.body.entity_type, 3);
  assert.equal(d.body.privacy_level, 2);
  assert.equal(d.body.scheduled_start_time, "2026-10-09T21:30:00.000Z");
  assert.equal(d.body.scheduled_end_time, "2026-10-10T00:30:00.000Z");
  assert.equal(d.body.entity_metadata.location, "Exor Games, 51 Allen Street, Charlottetown, PE");
  assert.match(d.body.description, /^Game: Magic: The Gathering\nEntry: \$10 \(tickets: https:\/\/exorgames\.com\/products\/fnm-oct-9\)\nAdd to your calendar: https:\/\/exor-binder\.nevski\.workers\.dev\/ics\?t=Friday\+Night\+Magic&s=2026-10-09T18%3A30&loc=Exor\+Games.*&u=https.*\nAll events: https:\/\/exorgames\.com\/pages\/events$/);
  assert.equal(d.image, "https://cdn.example/mtg.png");
  assert.equal(toDiscord(ev({ date: "2026-09-30" }), NOW).skip, "already started");
  assert.equal(toDiscord(ev({ time: null }), NOW).skip, "no start time");
  assert.equal(toDiscord(ev({ title: "x".repeat(140) }), NOW).body.name.length, 100);
});

test("plan: new events are created, changed ones updated, unchanged kept, vanished future ones removed, human-deleted ones left alone until they change", async () => {
  const a = ev({}), b = ev({ title: "Pokémon League", time: "13:00:00", date: "2026-10-10", ticketPrice: null, ticketed: false, url: null });
  const empty = await plan([a, b], {}, NOW);
  assert.equal(empty.create.length, 2);
  assert.deepEqual([empty.update.length, empty.remove.length, empty.keep.length], [0, 0, 0]);
  const map = {};
  for (const c of empty.create) map[c.key] = { id: "d" + c.key.length, hash: c.hash, startMs: c.startMs, name: c.body.name };
  const same = await plan([a, b], map, NOW);
  assert.deepEqual([same.create.length, same.update.length, same.remove.length, same.keep.length], [0, 0, 0, 2]);
  const moved = await plan([ev({ time: "19:00:00" }), b], map, NOW);   // same key? no: the time is part of the key when there is no id
  assert.equal(moved.create.length, 1);
  assert.equal(moved.remove.length, 1);
  assert.equal(moved.remove[0].name, "Friday Night Magic");
  const withId = ev({ id: "7" }), withIdMap = {};
  for (const c of (await plan([withId], {}, NOW)).create) withIdMap[c.key] = { id: "x7", hash: c.hash, startMs: c.startMs };
  const renamed = await plan([ev({ id: "7", title: "FNM: Modern" })], withIdMap, NOW);
  assert.equal(renamed.update.length, 1);
  assert.equal(renamed.update[0].id, "x7");
  assert.equal(renamed.update[0].body.name, "FNM: Modern");
  const humanDeleted = { ...withIdMap };
  for (const k of Object.keys(humanDeleted)) humanDeleted[k] = { ...humanDeleted[k], removed: true };
  const stay = await plan([withId], humanDeleted, NOW);
  assert.deepEqual([stay.create.length, stay.keep.length], [0, 1]);
  const again = await plan([ev({ id: "7", title: "FNM: Modern" })], humanDeleted, NOW);
  assert.equal(again.create.length, 1);   // the BinderPOS side changed: it comes back
  const past = await plan([], { old: { id: "o", hash: "h", startMs: NOW - 3600e3, name: "Old" } }, NOW);
  assert.equal(past.remove.length, 0);    // already started: Discord cleans it up, we do not delete history
  const dup = await plan([a, ev({})], {}, NOW);
  assert.equal(dup.create.length, 1);
  assert.equal(dup.skipped[0].why, "duplicate in feed");
});

test("hashBody changes with what Discord shows and ignores the rest", async () => {
  const d = toDiscord(ev({}), NOW);
  const h1 = await hashBody(d.body);
  assert.equal(await hashBody({ ...d.body, image: "zzz" }), h1);
  assert.notEqual(await hashBody({ ...d.body, description: d.body.description + "." }), h1);
  assert.equal(h1.length, 24);
});

test("windowDays: 14 by default, 1..60 accepted", () => {
  assert.equal(windowDays({}), 14);
  assert.equal(windowDays({ DISCORD_EVENTS_DAYS: "30" }), 30);
  assert.equal(windowDays({ DISCORD_EVENTS_DAYS: "0" }), 14);
  assert.equal(windowDays({ DISCORD_EVENTS_DAYS: "999" }), 14);
});

test("mapEvent keeps the feed id and end time for the sync, the pages' fields unchanged", () => {
  const m = mapEvent({ id: 55, title: "T", date: "2026-10-09", time: "18:00:00", endTime: "21:00:00", game: "Magic", ticketPrice: 5, isTicketed: true, handle: "h", calendarIcon: "https://x/y.png" }, "https://exorgames.com");
  assert.equal(m.id, "55");
  assert.equal(m.endTime, "21:00:00");
  assert.equal(m.url, "https://exorgames.com/products/h");
  assert.equal(m.ticketed, true);
});

/* The full sync against a fake Discord + fake feed + the module's KV (portal.js's kvGet/kvPut
   need the DO; here the env has no stub, so they answer null/false and the state starts empty
   each run - enough to see the calls that go out). */
const MANAGE = String(1n << 33n);
function fakeWorld({ feed, guilds = [{ id: "g1", name: "Exor Games", permissions: MANAGE }], live = [], headers = {}, createStatus = 200 }) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
    if (u.includes("binderpos.com")) return json(feed);
    if (u.endsWith("/users/@me/guilds")) return json(guilds);
    if (/scheduled-events$/.test(u) && method === "GET") return json(live);
    if (/scheduled-events$/.test(u) && method === "POST") return createStatus === 200 ? json({ id: "new" + calls.length }) : json({ message: createStatus === 403 ? "Missing Permissions" : "nope" }, createStatus);
    if (method === "PATCH") return json({ id: u.split("/").pop() });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return json({ message: "unknown" }, 404);
  };
  return { calls, fetchFn };
}

test("syncEvents does nothing without a token; with one it finds the guild, reads the feed and creates each upcoming event, without any channel message", async () => {
  assert.deepEqual(await syncEvents({}, { now: NOW }), { skipped: "not configured" });
  const w = fakeWorld({ feed: [
    { id: 1, title: "Friday Night Magic", date: "2026-10-09", time: "18:30:00", game: "Magic", ticketPrice: 10, isTicketed: true, handle: "fnm" },
    { id: 2, title: "Pokémon League", date: "2026-10-10", time: "13:00:00", game: "Pokémon" },
    { id: 3, title: "Disabled", date: "2026-10-10", time: "13:00:00", isDisabled: true },
    { id: 4, title: "Too far", date: "2026-10-30", time: "13:00:00" },
    { id: 5, title: "No time", date: "2026-10-12" },
  ] });
  const r = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn: w.fetchFn });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.guild, { id: "g1", name: "Exor Games" });
  assert.equal(w.calls.filter((c) => c.url.endsWith("/users/@me/guilds")).length, 2);   // discovery, then the permission check
  assert.equal(r.created, 2);
  assert.equal(r.skipped, 1);
  const feedCall = w.calls.find((c) => c.url.includes("binderpos"));
  assert.match(feedCall.url, /startDate=2026-09-30&endDate=2026-10-15$/);
  const posts = w.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].url, "https://discord.com/api/v10/guilds/g1/scheduled-events");
  assert.equal(posts[0].body.name, "Friday Night Magic");
  assert.equal(posts[0].body.entity_type, 3);
  assert.ok(!w.calls.some((c) => /channels|webhooks|messages/.test(c.url)));
});

test("syncEvents with DISCORD_GUILD_ID uses that server (the guild list is read once, for the permission bits only); two servers and no id is a named error", async () => {
  const w = fakeWorld({ feed: [], guilds: [{ id: "g9", name: "Nine", permissions: MANAGE }, { id: "g1", name: "One", permissions: MANAGE }] });
  const r0 = await syncEvents({ DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "g9" }, { now: NOW, fetchFn: w.fetchFn });
  assert.deepEqual(r0.errors, []);
  assert.equal(w.calls.filter((c) => c.url.endsWith("/users/@me/guilds")).length, 1);
  assert.ok(w.calls.some((c) => c.url.endsWith("/guilds/g9/scheduled-events")));
  const gone = fakeWorld({ feed: [], guilds: [{ id: "g1", name: "One", permissions: MANAGE }] });
  const r1 = await syncEvents({ DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "g9" }, { now: NOW, fetchFn: gone.fetchFn });
  assert.match(r1.errors[0], /no longer in server g9 \(DISCORD_GUILD_ID\): invite it again/);
  const two = fakeWorld({ feed: [], guilds: [{ id: "a", name: "A", permissions: MANAGE }, { id: "b", name: "B", permissions: MANAGE }] });
  const r = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn: two.fetchFn });
  assert.match(r.errors[0], /2 servers \(A a, B b\): set DISCORD_GUILD_ID/);
  await assert.rejects(resolveGuild({ DISCORD_BOT_TOKEN: "t" }, {}, fakeWorld({ feed: [], guilds: [] }).fetchFn), /not in any server/);
});

test("permission check: no Manage Events = one clear error and no writes; a 403 on create stops the loop with the same help", async () => {
  assert.equal(canManageEvents({ permissions: MANAGE }), true);
  assert.equal(canManageEvents({ permissions: "8" }), false);
  assert.equal(canManageEvents({ permissions: String((1n << 33n) | 8n) }), true);
  assert.equal(canManageEvents({}), null);
  const feed = [{ id: 1, title: "FNM", date: "2026-10-09", time: "18:30:00" }, { id: 2, title: "League", date: "2026-10-10", time: "13:00:00" }];
  const noPerm = fakeWorld({ feed, guilds: [{ id: "g1", name: "Exor Games", permissions: "8" }] });
  const r = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn: noPerm.fetchFn });
  assert.equal(r.created, 0);
  assert.match(r.errors[0], /no Manage Events permission.*Server Settings > Roles/);
  assert.equal(noPerm.calls.filter((c) => c.method === "POST").length, 0);
  const forbidden = fakeWorld({ feed, guilds: [{ id: "g1", name: "Exor Games" }], createStatus: 403 });   // permissions unknown, Discord says no
  const r2 = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn: forbidden.fetchFn });
  assert.equal(forbidden.calls.filter((c) => c.method === "POST").length, 1);   // stopped after the first 403
  assert.match(r2.errors[0], /discord 403: Missing Permissions/);
  assert.match(r2.errors[1], /no Manage Events permission/);
});

test("rate limits: an empty bucket pauses for its reset before the next call; a 429 is slept off and retried once", async () => {
  const feed = [{ id: 1, title: "FNM", date: "2026-10-09", time: "18:30:00" }, { id: 2, title: "League", date: "2026-10-10", time: "13:00:00" }];
  const w = fakeWorld({ feed, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.05" } });
  const t0 = Date.now();
  const r = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn: w.fetchFn });
  assert.equal(r.created, 2);
  assert.ok(Date.now() - t0 >= 4 * 250, "paused after each metered answer");
  let first = true;
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push(method + " " + url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (String(url).includes("binderpos")) return json(feed.slice(0, 1));
    if (String(url).endsWith("/users/@me/guilds")) return json([{ id: "g1", name: "G", permissions: MANAGE }]);
    if (method === "GET") return json([]);
    if (method === "POST" && first) { first = false; return json({ retry_after: 0.05, message: "You are being rate limited." }, 429); }
    return json({ id: "ok1" });
  };
  const r2 = await syncEvents({ DISCORD_BOT_TOKEN: "t" }, { now: NOW, fetchFn });
  assert.equal(r2.created, 1);
  assert.deepEqual(r2.errors, []);
  assert.equal(calls.filter((c) => c.startsWith("POST")).length, 2);
});
