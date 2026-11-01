import { test } from "node:test";
import assert from "node:assert/strict";
import { listCarts, cartsTtl, MAX_CART_DAYS, kvGet } from "../src/portal.js";

/* In-store buys beyond 31 days (owner, 2026-11-01: "I want it to always keep
   the list after 31 days but without refreshing it each time after it has
   been refreshed once when it was older than 31 days"). A day older than 31
   days is read from BinderPOS once and kept for good; days not yet cached
   are read a few per request, newest first, the rest reported as pending. */

const DAY = 86400e3;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// an in-memory stand-in for the portal-cache DO's /_kv/ paths (gz bytes in, gz bytes out)
function fakeRoom() {
  const store = new Map();
  const puts = [];
  const fetch = async (req) => {
    const url = new URL(req.url);
    const k = url.searchParams.get("k");
    if (url.pathname === "/_kv/get") { const r = store.get(k); return r ? new Response(r.gz, { status: 200 }) : new Response(null, { status: 404 }); }
    if (url.pathname === "/_kv/put") { const gz = await req.arrayBuffer(); const ttl = parseInt(url.searchParams.get("ttl"), 10); store.set(k, { gz, ttl }); puts.push({ k, ttl }); return Response.json({ ok: true }); }
    return new Response(null, { status: 404 });
  };
  return { store, puts, env: { BINDERPOS_LOGIN_EMAIL: "x@y.test", BINDERPOS_LOGIN_PASSWORD: "p", ROOM: { idFromName: (n) => n, get: () => ({ fetch }) } } };
}

// BinderPOS: the sign-in and the carts endpoint, one buy cart per listed day at 10:30Z
function fakeBinder(cartDays) {
  const calls = [];
  const cart = (day) => ({ id: "c" + day.replace(/-/g, ""), dateSubmitted: day + "T10:30:00.000Z", submittedBy: "KT", cartType: "buy", customer: { id: "9", firstName: "A", lastName: "B", email: "", phone: "" },
    cartItems: [{ id: "i1", productTitle: "Lightning Bolt", variantTitle: "NM", quantity: 2, buying: true, actualPrice: -1.5, price: -3, shopifyPrice: 4 }],
    tenders: [{ type: "Cash", amount: -3 }] });
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push(u);
    if (/identitytoolkit/.test(u)) return Response.json({ idToken: "tok", refreshToken: "ref", expiresIn: "3600" });
    if (/\/api\/pos\/carts\/all/.test(u)) {
      const q = new URL(u).searchParams;
      const start = Date.parse(q.get("startDate")), end = Date.parse(q.get("endDate"));
      const rows = cartDays.map(cart).filter((c) => { const t = Date.parse(c.dateSubmitted); return t >= start && t <= end; });
      return Response.json(rows);
    }
    throw new Error("unexpected fetch " + u);
  };
  return { calls, windows: () => calls.filter((u) => /carts\/all/.test(u)).length };
}

test("cartsTtl: today minutes, a fresh day a week, a day past 31 days for good", () => {
  const now = Date.UTC(2026, 10, 1, 15, 0);
  assert.equal(cartsTtl("2026-11-01", false, now), 3 * 60e3);
  assert.equal(cartsTtl("2026-10-31", false, Date.UTC(2026, 10, 1, 1, 0)), 10 * 60e3, "ended within two hours: late syncs");
  assert.equal(cartsTtl("2026-10-31", false, now), 7 * DAY);
  assert.equal(cartsTtl("2026-10-20", false, now), 7 * DAY);
  assert.equal(cartsTtl("2026-09-20", false, now), 100 * 365 * DAY, "older than 31 days: kept");
  assert.equal(cartsTtl("2026-09-20", true, now), 2 * 60e3, "missing windows are retried whatever the age");
  assert.equal(MAX_CART_DAYS, 365);
});

test("a window past 31 days: old days are read once and kept; uncached days arrive a few per request, newest first", async () => {
  const now = Date.now();
  const d = (n) => dayKey(now - n * DAY);
  const room = fakeRoom();
  const binder = fakeBinder([d(1), d(40), d(41), d(42)]);
  // first request: at most 2 uncached days read (newest first), the rest pending
  let r = await listCarts(room.env, { days: 45, take: 50 }, { maxDays: 2 });
  assert.equal(r.ok, true); assert.equal(r.days, 45);
  assert.equal(r.pending.length, 47 - 2, "the window lists 47 days (today back to the day before the window starts); the other 45 wait for the next request");
  assert.equal(r.pending[0], d(2)); assert.equal(r.pending[r.pending.length - 1], d(46));
  assert.deepEqual(r.rows.map((c) => c.day), [d(1)], "only today and yesterday were read so far");
  assert.equal(r.keepAfterDays, 31);
  assert.ok(r.rows[0].flags, "rows are summaries with their flags"); assert.equal(r.rows[0].lines, undefined);
  const w1 = binder.windows();
  // a budget of zero reads nothing new: everything else stays pending
  r = await listCarts(room.env, { days: 45 }, { maxDays: 0 });
  assert.equal(r.pending.length, 45); assert.equal(binder.windows(), w1);
  // keep asking: every day gets read, each exactly once
  for (let i = 0; i < 30 && r.pending.length; i++) r = await listCarts(room.env, { days: 45 }, { maxDays: 10, budgetMs: 1e9 });
  assert.equal(r.pending.length, 0);
  assert.deepEqual(r.rows.map((c) => c.day), [d(1), d(40), d(41), d(42)]);
  assert.equal(r.total, 4); assert.equal(r.totals.carts, 4); assert.equal(r.totals.paid, 12); assert.equal(r.totals.cash, 12);
  const w2 = binder.windows();
  assert.equal(w2 - w1, 45 * 12, "every uncached day was read, twelve two-hour windows each");
  // the days past 31 were stored for good, the recent ones for a week
  const ttlOf = (day) => room.puts.find((p) => p.k.endsWith(":" + day)).ttl;
  assert.equal(ttlOf(d(40)), 100 * 365 * DAY); assert.equal(ttlOf(d(45)), 100 * 365 * DAY);
  assert.equal(ttlOf(d(10)), 7 * DAY);
  // asking again reads nothing from BinderPOS: the whole window comes from the cache
  r = await listCarts(room.env, { days: 45 }, { maxDays: 10 });
  assert.equal(binder.windows(), w2, "no BinderPOS call for a cached window");
  assert.equal(r.rows.length, 4); assert.equal(r.pending.length, 0);
  // the cache holds the trimmed day record
  assert.match(await kvGet(room.env, "carts:v4:" + d(40)), /Lightning Bolt/);
  // the window is capped at a year
  assert.equal((await listCarts(room.env, { days: 9999 }, { maxDays: 0 })).days, 365);
  // a BinderPOS failure: that day's remaining windows are skipped and come back
  // as partial (two-minute retry); the days after it wait as pending instead of
  // being stored as twelve missing windows
  const before = room.puts.length;
  const real = globalThis.fetch;
  let failed = false;
  globalThis.fetch = async (url, init) => { if (/carts\/all/.test(String(url)) && !failed) { failed = true; return new Response("gateway", { status: 502 }); } return real(url, init); };
  r = await listCarts(room.env, { days: 60 }, { maxDays: 10, budgetMs: 1e9 });
  assert.equal(r.partial.length, 1, "the day that hit the failure is partial"); assert.equal(r.partial[0].day, d(47), "the first day the 45-day window had not cached");
  assert.ok(r.partial[0].windows.length >= 1);
  assert.ok(r.pending.length === 14 && r.pending[0] === d(48), "the days behind it wait for the back-off: " + r.pending.length);
  assert.equal(room.puts.length - before, 1, "only the partial day was stored (for two minutes)");
  assert.equal(room.puts[room.puts.length - 1].ttl, 2 * 60e3);
  delete globalThis.fetch;
});
