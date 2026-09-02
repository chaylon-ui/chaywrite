/* ---------------- /price-history.json — nightly price snapshots for singles ----
   What: every day at 08:00 UTC (04:00 Atlantic) a Durable Object alarm walks
   the whole singles catalogue through the Admin GraphQL API — every ACTIVE
   product whose type contains "Single" (MTG Single, Pokemon Single, Yugioh
   Single, One Piece Single, Lorcana Single, Pokemon Japan Singles, ...;
   matched by the search filter product_type:*Single*, never by a hard-coded
   list; the types the run actually saw are recorded in its summary) — and
   records, per product, the FIRST variant's price (the NM / default
   condition on this store) plus the cheapest variant's price. A product's
   record only grows when a price actually moves, so ~60k products cost a
   few megabytes once, not a few megabytes a day. The card page sparkline
   (assets/xg-price-history.js in the theme) reads it back through
   GET /price-history.json?id=<numeric product id>.

   Why a DO alarm and not a cron: the account's worker cron was never
   delivered (see binder-search.js); alarms are delivered by the runtime.
   Why paginated across ticks and not one long invocation: a DO invocation
   has a 30s CPU cap and a deploy kills whatever is in flight, so each alarm
   tick fetches pages for ~TICK_BUDGET_MS, persists the cursor after EVERY
   page, and re-arms itself; a killed tick resumes from the last cursor (a
   safety alarm set at the start of each tick guarantees a retry), and a
   page processed twice is harmless (same day, same prices: nothing is
   appended). Shopify's cost throttle is honoured from the response's own
   throttleStatus: the tick sleeps or re-arms for exactly the time the
   bucket needs (250 products/page probed 2026-09-02 under the 1000-point
   single-query cap; ~60k products = ~240 pages).

   Storage (the DO named PRICE_DO, class BinderRoom in room.js, its own
   instance — never a screen, never the search cache):
     ph:<productId>  { s: firstDay, d: lastSeenDay, p: [[day, cents, minCents], ...] }
                     p gets a point only when cents or minCents differ from
                     the last point (at most one point per day: a same-day
                     re-snapshot corrects that day's point instead of adding
                     one), capped at MAX_POINTS oldest-first; s survives the
                     cap so "since" stays honest. day = UTC days since epoch.
                     d (the day the record was last written) is refreshed at
                     most every SEEN_REFRESH_DAYS for an unchanged price: the
                     first live run found 228k singles, and rewriting every
                     record daily would be 228k storage writes a day for no
                     information. asOf/days on the JSON surface follow d.
     phs:run         the run in progress (cursor, counters, tickAt)
     phs:last        the last run's summary (per UTC day; error when it failed)

   Public surface (routed from index.js):
     GET  /price-history.json?id=<numeric product id>   (or ?handle=<handle>)
          { ok, id, since:"YYYY-MM-DD", asOf, days, current:{price,min}, raw:false,
            points:[["YYYY-MM-DD", price], ...]  <- a daily STEP series over the
                 last SERIES_DAYS days (one entry per day from max(since,
                 today-89) to today, the price in effect that day) - NOT the
                 raw change points; those are in
            changes:[["YYYY-MM-DD", price, min], ...],
            change7d:{abs,pct}|null, change30d:{abs,pct}|null }
          Unknown id -> { ok:true, id, since:null, days:0, current:null,
          points:[] } with HTTP 200 so the theme hides quietly.
          CORS *, cache-control public max-age 3600 (+ caches.default).
     GET  /price-history/status   read-only: last run, run in progress, next
          alarm, whether SHOPIFY_ADMIN_TOKEN is configured. No secrets.
     POST /price-history/run      kick today's run now; a second kick the
          same day is a no-op that says so (idempotent per UTC day).
   Internal (DO only; the router never forwards them): /_ph/get, /_ph/status,
   /_ph/run. The DO calls priceDoFetch / priceDoAlarm with a small context
   { storage, env, fetch, now, sleep, log, mem } so the offline harness
   (test/price-history.harness.mjs) can drive the same code with fakes. */

export const PRICE_DO = "price-history";
const DO_ORIGIN = "https://" + PRICE_DO + ".internal"; // the DO only reads the path
const API_VERSION = "2025-01";                          // same as cards.js / room.js
const DEFAULT_SHOP = "most-wanted-ca.myshopify.com";
export const PAGE = 250;          // products per Admin page (cost-probed: fits the 1000-point cap)
export const MAX_POINTS = 400;    // change points kept per product
export const SERIES_DAYS = 90;    // length of the expanded step series
export const RUN_HOUR_UTC = 8;    // 08:00 UTC = 04:00 Atlantic standard time
export const SEEN_REFRESH_DAYS = 7; // unchanged records are rewritten (d bumped) at most this often
const TICK_BUDGET_MS = 20e3;      // wall time one alarm tick spends on pages
const SAFETY_ALARM_MS = 90e3;     // set first thing in a tick: a killed tick resumes from here
const STALL_MS = 3 * 60e3;        // a run with no page for this long and no alarm is stalled
const MAX_ERROR_STREAK = 12;      // consecutive page failures before a run gives up
const RETRY_FAILED_MS = 3600e3;   // a failed run is retried after an hour
const EDGE_S = 3600;              // public cache-control + caches.default
const NO_PRICE_CENTS = 99999900;  // the theme's "email us for pricing" sentinel (999999.00)
const DAY_MS = 864e5;
export const SINGLES_QUERY = "product_type:*Single* AND status:active";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const msg = (e) => String((e && e.message) || e || "error").slice(0, 200);

/* ---- days ------------------------------------------------------------- */

// UTC day number of a timestamp (days since the epoch): the unit every
// stored point uses, so a snapshot's day never depends on a timezone.
export const dayOf = (ms) => Math.floor(ms / DAY_MS);

// "YYYY-MM-DD" of a UTC day number (what the JSON surface shows).
export function dateOf(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// The next RUN_HOUR_UTC strictly after `now`: today's if it is still ahead,
// else tomorrow's. The nightly alarm is always armed to this.
export function nextRunAt(now) {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0);
  return t > now ? t : t + DAY_MS;
}

/* ---- one product's record ----------------------------------------------- */

// Fold one day's snapshot into a product record. Appends a change point
// only when the price (or the cheapest variant's price) differs from the
// last point; a second snapshot of the SAME day corrects that day's point
// instead of adding another, so the series has at most one point per day
// and re-processing a page after a killed tick is harmless. Returns the
// record plus whether a point changed and whether the record needs
// writing at all: an unchanged price is rewritten (last-seen day bumped)
// only once every SEEN_REFRESH_DAYS, so a quiet catalogue costs almost no
// writes.
export function applySnapshot(rec, day, cents, minCents) {
  const r = rec && Array.isArray(rec.p) ? rec : { s: day, d: 0, p: [] };
  if (!r.s || r.s > day) r.s = day;
  const last = r.p[r.p.length - 1];
  let changed = false;
  if (!last || last[1] !== cents || last[2] !== minCents) {
    if (last && last[0] === day) { last[1] = cents; last[2] = minCents; }
    else if (!last || last[0] < day) r.p.push([day, cents, minCents]);
    // (a point older than the last one - a late tick of an earlier run
    //  day - is ignored: the newer snapshot already speaks for that product)
    else return { rec: r, changed: false, write: false };
    if (r.p.length > MAX_POINTS) r.p.splice(0, r.p.length - MAX_POINTS);
    changed = true;
  }
  const write = changed || day - (r.d || 0) >= SEEN_REFRESH_DAYS;
  if (write) r.d = Math.max(r.d || 0, day);
  return { rec: r, changed, write };
}

// The change point in effect on `day` (the last point dated on or before
// it), or null when the product was not tracked yet.
export function pointAt(points, day) {
  let v = null;
  for (const p of points) { if (p[0] <= day) v = p; else break; }
  return v;
}

// The step series the JSON surface serves: one [date, price] per day from
// max(first point, today - days + 1) to today, each day carrying the price
// in effect that day (a price holds until the next change point).
export function expandSeries(rec, today, days = SERIES_DAYS) {
  const pts = (rec && rec.p) || [];
  if (!pts.length) return [];
  const start = Math.max(pts[0][0], today - days + 1);
  const out = [];
  let i = 0, cur = null;
  for (let d = start; d <= today; d++) {
    while (i < pts.length && pts[i][0] <= d) cur = pts[i++];
    if (cur) out.push([dateOf(d), cur[1] / 100]);
  }
  return out;
}

// Change over the last n days: current price vs the price in effect n days
// ago. null when the product was not being tracked n days ago (a card
// first seen yesterday has no honest "this week" number) or the old price
// is unknown after the point cap. abs in dollars, pct to one decimal.
export function changeOver(rec, today, n) {
  const pts = (rec && rec.p) || [];
  if (!pts.length) return null;
  const since = rec.s || pts[0][0];
  if (today - n < since) return null;
  const old = pointAt(pts, today - n);
  const cur = pointAt(pts, today) || pts[pts.length - 1];
  if (!old) return null;
  const abs = Math.round(cur[1] - old[1]) / 100;
  return { abs, pct: old[1] ? Math.round(((cur[1] - old[1]) / old[1]) * 1000) / 10 : null };
}

// The public JSON for one product (see the header for the contract). asOf
// is the day the record was last written (a week old at most while the
// price holds still); the step series always runs through today.
export function buildPayload(id, rec, now) {
  const today = dayOf(now);
  const pts = (rec && rec.p) || [];
  if (!pts.length) return { ok: true, id, since: null, days: 0, current: null, raw: false, points: [], change7d: null, change30d: null };
  const since = rec.s || pts[0][0];
  const last = pts[pts.length - 1];
  return {
    ok: true,
    id,
    since: dateOf(since),
    asOf: dateOf(rec.d || last[0]),
    days: (rec.d || last[0]) - since + 1,
    current: { price: last[1] / 100, min: last[2] / 100 },
    raw: false,
    points: expandSeries(rec, today),
    changes: pts.map((p) => [dateOf(p[0]), p[1] / 100, p[2] / 100]),
    change7d: changeOver(rec, today, 7),
    change30d: changeOver(rec, today, 30),
  };
}

/* ---- Shopify Admin GraphQL --------------------------------------------- */

const PRODUCTS_GQL = `query($q:String!,$n:Int!,$after:String){products(first:$n,query:$q,after:$after,sortKey:ID){nodes{id handle productType priceRangeV2{minVariantPrice{amount}} variants(first:1){nodes{price}}} pageInfo{hasNextPage endCursor}}}`;
const TYPES_GQL = `{shop{productTypes(first:250){edges{node}}}}`;

// One Admin GraphQL round trip (same endpoint/headers as cards.js). Returns
// { data, cost } or throws; a throttle answer (HTTP 429 or a THROTTLED
// error) throws an error flagged .throttled with the cost block attached so
// the caller can wait exactly as long as the bucket needs.
export async function adminGql(cx, query, variables) {
  const env = cx.env || {};
  const shop = env.SHOPIFY_SHOP || DEFAULT_SHOP;
  const r = await cx.fetch("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN || "" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(25000),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const cost = (j && j.extensions && j.extensions.cost) || null;
  const errs = j && Array.isArray(j.errors) ? j.errors : [];
  const throttled = r.status === 429 || errs.some((e) => e && ((e.extensions && e.extensions.code === "THROTTLED") || /throttled/i.test(String(e.message || ""))));
  if (throttled) { const e = new Error("throttled"); e.throttled = true; e.cost = cost; throw e; }
  if (!r.ok) throw new Error("admin HTTP " + r.status + ": " + text.slice(0, 160));
  if (!j) throw new Error("admin non-JSON: " + text.slice(0, 120));
  if (!j.data) throw new Error("admin errors: " + JSON.stringify(errs).slice(0, 240));
  return { data: j.data, cost };
}

// ms to wait before the next page can be paid for, read off the response's
// own throttleStatus (the bucket AFTER this query was charged). Waits until
// the bucket holds TWO pages' worth: the first live run (2026-09-02) drained
// a 2000-point bucket at ~2 pages/s (57 points a page, 100/s restore) and
// then bounced off THROTTLED every few pages; a one-page headroom paces the
// loop at the restore rate instead. 0 when the bucket is already there.
export function throttleWait(cost, fallbackCost) {
  const ts = cost && cost.throttleStatus;
  if (!ts) return 0;
  const need = Number(cost.actualQueryCost || cost.requestedQueryCost || fallbackCost || 0);
  const avail = Number(ts.currentlyAvailable || 0);
  const rate = Number(ts.restoreRate || 0);
  const want = need * 2;
  if (avail >= want || rate <= 0) return 0;
  return Math.ceil(((want - avail) / rate) * 1000) + 50;
}

const toCents = (s) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

// One products page -> { items:[{id, handle, cents, min}], cursor, hasNext }.
// cents = the first variant's price; min = the cheapest variant's price
// (never above cents). Products without a priced variant are dropped.
export function parsePage(data) {
  const pr = data && data.products;
  if (!pr || !Array.isArray(pr.nodes)) throw new Error("admin products shape");
  const items = [];
  for (const p of pr.nodes) {
    const id = String((p && p.id) || "").replace(/\D/g, "");
    if (!id) continue;
    const v = p.variants && Array.isArray(p.variants.nodes) ? p.variants.nodes[0] : null;
    const cents = toCents(v && v.price);
    if (cents == null) continue;
    const minC = toCents(p.priceRangeV2 && p.priceRangeV2.minVariantPrice && p.priceRangeV2.minVariantPrice.amount);
    items.push({ id, handle: String(p.handle || ""), cents, min: minC == null ? cents : Math.min(minC, cents) });
  }
  const pi = pr.pageInfo || {};
  return { items, cursor: pi.endCursor || null, hasNext: !!pi.hasNextPage };
}

// The store's product types that contain "single" (for the run summary and
// the status page; the products query itself matches by search filter).
async function discoverTypes(cx) {
  const { data } = await adminGql(cx, TYPES_GQL, {});
  const edges = (data && data.shop && data.shop.productTypes && data.shop.productTypes.edges) || [];
  return edges.map((e) => e && e.node).filter((t) => typeof t === "string" && /single/i.test(t));
}

/* ---- the snapshot run ---------------------------------------------------- */

// Fold one page's items into storage, 128 keys per get/put (the DO batch
// limit). Unchanged records on an already-seen day are not rewritten.
export async function storePage(storage, items, day) {
  let changed = 0, writes = 0;
  for (let i = 0; i < items.length; i += 128) {
    const chunk = items.slice(i, i + 128);
    const cur = await storage.get(chunk.map((it) => "ph:" + it.id));
    const puts = {};
    let n = 0;
    for (const it of chunk) {
      const k = "ph:" + it.id;
      const r = applySnapshot(cur instanceof Map ? cur.get(k) : (cur || {})[k], day, it.cents, it.min);
      if (r.changed) changed++;
      if (r.write) { puts[k] = r.rec; n++; }
    }
    if (n) { await storage.put(puts); writes += n; }
  }
  return { changed, writes };
}

const newRun = (day, now) => ({ day, started: now, cursor: null, pages: 0, seen: 0, changed: 0, writes: 0, skipped: 0, errors: 0, errStreak: 0, throttled: 0, ticks: 0, tickAt: now, done: false });

// Arm the DO alarm for `at`. Every tick ends here, so the clock never stops.
async function arm(cx, at, why) {
  try { await cx.storage.setAlarm(at); }
  catch (e) { cx.log("price-history: setAlarm failed: " + msg(e)); }
  return { at, why };
}

// Close a run (done or failed): its summary becomes phs:last, and the alarm
// is set for the next nightly slot - or right away when the run spilled
// past midnight and today's snapshot is still owed, or an hour ahead when
// it failed (a failed day is retried; already-snapshotted products are
// idempotent, so a retry never doubles a point).
async function finish(cx, run, error) {
  const now = cx.now();
  run.done = true;
  run.finished = now;
  run.ms = now - run.started;
  if (error) run.error = error; else delete run.error;
  const summary = { ...run };
  delete summary.cursor;
  await cx.storage.put({ "phs:run": run, "phs:last": summary });
  cx.log("price-history: run " + dateOf(run.day) + (error ? " FAILED: " + error : " finished") + " seen=" + run.seen + " changed=" + run.changed + " pages=" + run.pages + " " + run.ms + "ms");
  if (error) return arm(cx, now + RETRY_FAILED_MS, "run failed");
  return arm(cx, dayOf(now) > run.day ? now + 1000 : nextRunAt(now), "run finished");
}

// One alarm tick: start today's run if none is owed-and-open, then fetch
// pages until the tick's wall budget is spent or the throttle asks for a
// wait, persisting the cursor and counters after every page. Returns
// { at, why } - when and why the next alarm was armed.
export async function priceTick(cx) {
  const st = cx.storage;
  const t0 = cx.now();
  const today = dayOf(t0);
  let run = await st.get("phs:run");
  if (!run || run.done) {
    const last = await st.get("phs:last");
    if (last && last.day === today && !last.error) return arm(cx, nextRunAt(t0), "already ran today");
    run = newRun(today, t0);
    if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return finish(cx, run, "SHOPIFY_ADMIN_TOKEN not configured");
    try { run.types = await discoverTypes(cx); }
    catch (e) { run.typesError = msg(e); }
    await st.put("phs:run", run);
    cx.log("price-history: run " + dateOf(today) + " started; single types: " + JSON.stringify(run.types || run.typesError));
  }
  run.ticks = (run.ticks || 0) + 1;
  for (;;) {
    let page;
    try {
      const r = await adminGql(cx, PRODUCTS_GQL, { q: SINGLES_QUERY, n: PAGE, after: run.cursor || null });
      page = parsePage(r.data);
      page.cost = r.cost;
    } catch (e) {
      run.tickAt = cx.now();
      if (e && e.throttled) {
        // Pacing, not a failure: Shopify said the bucket is empty. Counted
        // apart from errors so the status page reads honestly.
        run.throttled = (run.throttled || 0) + 1;
        await st.put("phs:run", run);
        return arm(cx, cx.now() + Math.max(2000, throttleWait(e.cost, run.pageCost || 1000)), "throttled");
      }
      run.errors = (run.errors || 0) + 1;
      run.lastError = msg(e);
      run.errStreak = (run.errStreak || 0) + 1;
      if (run.errStreak >= MAX_ERROR_STREAK) return finish(cx, run, "gave up after " + run.errStreak + " consecutive errors; last: " + run.lastError);
      await st.put("phs:run", run);
      return arm(cx, cx.now() + Math.min(300e3, 15e3 * run.errStreak), "error backoff");
    }
    const kept = [];
    for (const it of page.items) { if (it.cents >= NO_PRICE_CENTS) run.skipped = (run.skipped || 0) + 1; else kept.push(it); }
    const w = await storePage(st, kept, run.day);
    run.pages++;
    run.seen += page.items.length;
    run.changed += w.changed;
    run.writes += w.writes;
    run.errStreak = 0;
    if (!run.firstId && kept.length) run.firstId = kept[0].id;
    if (kept.length) run.lastId = kept[kept.length - 1].id;
    if (page.cost && page.cost.actualQueryCost) run.pageCost = page.cost.actualQueryCost;
    if (page.cost && page.cost.throttleStatus) {
      const ts = page.cost.throttleStatus;
      run.throttle = { available: ts.currentlyAvailable, max: ts.maximumAvailable, restore: ts.restoreRate };
    }
    run.cursor = page.cursor;
    run.tickAt = cx.now();
    if (!page.hasNext || !page.cursor) return finish(cx, run, null);
    await st.put("phs:run", run);
    const wait = throttleWait(page.cost, run.pageCost);
    if (cx.now() - t0 > TICK_BUDGET_MS || wait > 1500) return arm(cx, cx.now() + Math.max(wait, 200), "next page");
    if (wait > 0) await cx.sleep(wait);
  }
}

/* ---- DO entry points (room.js calls these) --------------------------------- */

// The alarm handler body. A safety alarm goes in FIRST so a tick the
// platform kills (CPU cap, deploy) is retried from its saved cursor; the
// tick itself re-arms the real next time when it ends.
export async function priceDoAlarm(cx) {
  try { await cx.storage.setAlarm(cx.now() + SAFETY_ALARM_MS); } catch {}
  try {
    const r = await priceTick(cx);
    cx.log("price-history: tick -> " + r.why + "; next alarm in " + Math.round((r.at - cx.now()) / 1000) + "s");
  } catch (e) {
    cx.log("price-history: tick failed: " + msg(e));
    try { await cx.storage.setAlarm(cx.now() + 60e3); } catch {}
  }
}

// First request after a deploy (once per DO lifetime): make sure an alarm
// exists - resume an open run right away, else the next nightly slot. Any
// later re-arming is done by the ticks themselves.
export async function armPriceAlarm(cx) {
  if (cx.mem.armed) return;
  cx.mem.armed = true;
  try {
    if ((await cx.storage.getAlarm()) != null) return;
    const run = await cx.storage.get("phs:run");
    const now = cx.now();
    await cx.storage.setAlarm(run && !run.done ? now + 1000 : nextRunAt(now));
  } catch (e) { cx.log("price-history: arm failed: " + msg(e)); }
}

// A run/summary as the status page shows it: the counters plus ISO times,
// minus the opaque cursor.
function publicRun(run, now) {
  if (!run || typeof run !== "object") return null;
  const o = { ...run };
  delete o.cursor;
  o.hasCursor = !!run.cursor;
  o.dayDate = dateOf(run.day);
  o.startedAt = run.started ? new Date(run.started).toISOString() : null;
  o.finishedAt = run.finished ? new Date(run.finished).toISOString() : null;
  o.lastPageAgoS = run.tickAt ? Math.round((now - run.tickAt) / 1000) : null;
  return o;
}

// POST /_ph/run: start today's run now. No-op (that says so) while a run is
// open or when today's run already completed; a run that stalled (no page
// for STALL_MS and no alarm pending) is resumed instead.
export async function kickRun(cx) {
  const now = cx.now();
  const today = dayOf(now);
  const run = await cx.storage.get("phs:run");
  if (run && !run.done) {
    let alarm = null;
    try { alarm = await cx.storage.getAlarm(); } catch {}
    if (alarm == null && now - (run.tickAt || run.started || 0) > STALL_MS) {
      await cx.storage.setAlarm(now);
      return { ok: true, started: false, resumed: true, reason: "a stalled run was resumed", run: publicRun(run, now) };
    }
    return { ok: true, started: false, reason: "already running", run: publicRun(run, now) };
  }
  const last = await cx.storage.get("phs:last");
  if (last && last.day === today && !last.error) {
    return { ok: true, started: false, reason: "already ran today", day: dateOf(today), last: publicRun(last, now) };
  }
  await cx.storage.setAlarm(now);
  return { ok: true, started: true, day: dateOf(today), tokenConfigured: !!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN) };
}

// GET /_ph/status: everything a smoke test or a browser needs to tell
// whether the nightly snapshot is doing its job. No secrets, no bodies.
export async function statusOf(cx) {
  const now = cx.now();
  const run = await cx.storage.get("phs:run");
  const last = await cx.storage.get("phs:last");
  let alarmAt = null;
  try { alarmAt = await cx.storage.getAlarm(); } catch {}
  const tokenConfigured = !!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN);
  return {
    ok: true,
    now,
    today: dateOf(dayOf(now)),
    tokenConfigured,
    shop: (cx.env && cx.env.SHOPIFY_SHOP) || DEFAULT_SHOP,
    runHourUtc: RUN_HOUR_UTC,
    page: PAGE,
    query: SINGLES_QUERY,
    run: run && !run.done ? publicRun(run, now) : null,
    last: publicRun(last, now),
    alarmAt: alarmAt != null ? new Date(alarmAt).toISOString() : null,
    alarmInS: alarmAt != null ? Math.round((alarmAt - now) / 1000) : null,
    note: tokenConfigured ? undefined : "SHOPIFY_ADMIN_TOKEN is not set on the worker: the nightly snapshot cannot read the catalogue",
  };
}

const doJson = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The DO's /_ph/* handler (room.js forwards every /_ph/ path here for the
// price DO only).
export async function priceDoFetch(cx, request, url) {
  await armPriceAlarm(cx);
  if (url.pathname === "/_ph/get") {
    const id = String(url.searchParams.get("id") || "").replace(/\D/g, "").slice(0, 24);
    if (!id) return doJson({ ok: false, error: "id required" }, 400);
    const rec = await cx.storage.get("ph:" + id);
    return doJson(buildPayload(id, rec, cx.now()));
  }
  if (url.pathname === "/_ph/status") return doJson(await statusOf(cx));
  if (url.pathname === "/_ph/run" && request.method === "POST") return doJson(await kickRun(cx));
  return doJson({ ok: false, error: "not found" }, 404);
}

/* ---- the public worker routes ------------------------------------------------ */

function reply(body, status, extra) {
  const h = new Headers(CORS);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  for (const k in extra || {}) h.set(k, extra[k]);
  return new Response(body, { status, headers: h });
}
const jsonErr = (status, obj) => reply(JSON.stringify(obj), status);

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

const HANDLE_GQL = `query($q:String!){products(first:1,query:$q){nodes{id handle}}}`;

// ?handle= support. With the Admin token: one cheap products query
// (handle:<handle>), which never redirects and is never challenged. Without
// it: the store's public /products/<handle>.js - which follows a redirect to
// the storefront domain and, in the live smokes of 2026-09-02, answered the
// worker only intermittently (Cloudflare challenges exorgames.com/products/*).
async function resolveHandle(env, handle) {
  if (env && env.SHOPIFY_ADMIN_TOKEN) {
    try {
      const { data } = await adminGql({ env, fetch: (u, i) => fetch(u, i) }, HANDLE_GQL, { q: "handle:" + handle });
      const n = data && data.products && Array.isArray(data.products.nodes) ? data.products.nodes[0] : null;
      if (n && String(n.handle || "").toLowerCase() === handle) return String(n.id || "").replace(/\D/g, "");
      return "";
    } catch (e) { console.log("price-history: admin handle lookup failed: " + msg(e)); }
  }
  const shop = (env && env.SHOPIFY_SHOP) || DEFAULT_SHOP;
  const r = await fetch("https://" + shop + "/products/" + handle + ".js", {
    headers: { accept: "application/json", "user-agent": "ExorPriceHistory/1.0 (+workers.dev)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return "";
  const p = await r.json();
  return String((p && p.id) || "").replace(/\D/g, "");
}

export async function servePriceHistory(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const stub = env.ROOM.get(env.ROOM.idFromName(PRICE_DO));
  const call = (path, init) => stub.fetch(new Request(DO_ORIGIN + path, init));

  if (url.pathname === "/price-history/status") {
    try { return reply(await (await call("/_ph/status")).text(), 200); }
    catch (e) { return jsonErr(503, { ok: false, error: "status unavailable: " + msg(e) }); }
  }
  if (url.pathname === "/price-history/run") {
    if (request.method !== "POST") return jsonErr(405, { ok: false, error: "POST only" });
    try {
      const r = await call("/_ph/run", { method: "POST" });
      return reply(await r.text(), r.status);
    } catch (e) { return jsonErr(503, { ok: false, error: "run unavailable: " + msg(e) }); }
  }
  if (url.pathname === "/price-history.json") {
    if (request.method !== "GET" && request.method !== "HEAD") return jsonErr(405, { ok: false, error: "GET only" });
    let id = String(url.searchParams.get("id") || "").replace(/\D/g, "").slice(0, 24);
    const handle = String(url.searchParams.get("handle") || "").trim().toLowerCase();
    if (!id && handle && !HANDLE_RE.test(handle)) return jsonErr(400, { ok: false, error: "bad handle" });
    if (!id && !handle) return jsonErr(400, { ok: false, error: "id (numeric product id) or handle required" });

    // Edge layer: the series changes once a day, so a colo may serve the
    // same answer for EDGE_S without asking the DO again.
    const cache = caches.default;
    const edgeKey = new Request(new URL("/price-history.json?" + (id ? "id=" + id : "handle=" + handle), url.origin).toString());
    try {
      const hit = await cache.match(edgeKey);
      if (hit) return reply(hit.body, 200, { "cache-control": "public, max-age=" + EDGE_S, "x-xg-cache": "hit" });
    } catch (e) { console.log("price-history: edge match failed: " + msg(e)); }

    if (!id) {
      try { id = await resolveHandle(env, handle); }
      catch (e) { console.log("price-history: handle lookup failed: " + msg(e)); }
      if (!id) return reply(JSON.stringify({ ok: true, id: null, handle, since: null, days: 0, current: null, raw: false, points: [], change7d: null, change30d: null }), 200, { "cache-control": "public, max-age=300" });
    }
    let text;
    try {
      const r = await call("/_ph/get?id=" + id);
      if (!r.ok) throw new Error("DO HTTP " + r.status);
      text = await r.text();
    } catch (e) { return jsonErr(503, { ok: false, error: "history unavailable: " + msg(e) }); }
    if (handle) { try { const o = JSON.parse(text); o.handle = handle; text = JSON.stringify(o); } catch {} }
    const h = { "cache-control": "public, max-age=" + EDGE_S, "x-xg-cache": "miss" };
    ctx.waitUntil(cache.put(edgeKey, new Response(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + EDGE_S } })).catch(() => {}));
    return reply(text, 200, h);
  }
  return jsonErr(404, { ok: false, error: "not found" });
}
