/* Offline harness for src/price-history.js: fake DO storage, fake Admin
   GraphQL fetch and a fake clock drive the real tick/kick/status/payload
   code. Run: node test/price-history.harness.mjs  (exit 1 on any failure).
   Proves: only changed prices append; per-day idempotence (a second run or
   a re-processed page the same day adds nothing); the 90-day step
   expansion; change7d/30d math; resumability from the saved cursor after a
   page error and after a hard kill mid-tick; throttle waits; the missing
   token path; the point cap; the public payload shapes. */
import {
  applySnapshot, expandSeries, changeOver, buildPayload, dayOf, dateOf, nextRunAt,
  throttleWait, parsePage, priceTick, priceDoAlarm, priceDoFetch, kickRun, statusOf,
  PAGE, MAX_POINTS, SERIES_DAYS,
} from "../src/price-history.js";

let fails = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log("  ok   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); }
}
const DAY = 864e5;
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

class FakeStorage {
  constructor() { this.m = new Map(); this.alarm = null; this.puts = 0; this.putKeys = 0; this.failPutOnce = null; }
  async get(k) {
    if (Array.isArray(k)) {
      if (k.length > 128) throw new Error("get batch > 128");
      const out = new Map();
      for (const kk of k) if (this.m.has(kk)) out.set(kk, clone(this.m.get(kk)));
      return out;
    }
    return this.m.has(k) ? clone(this.m.get(k)) : undefined;
  }
  async put(k, v) {
    if (typeof k === "object") {
      const keys = Object.keys(k);
      if (keys.length > 128) throw new Error("put batch > 128");
      if (this.failPutOnce && keys.includes(this.failPutOnce)) { this.failPutOnce = null; throw new Error("simulated kill during put"); }
      for (const kk of keys) this.m.set(kk, clone(k[kk]));
      this.puts++; this.putKeys += keys.length;
    } else {
      if (this.failPutOnce === k) { this.failPutOnce = null; throw new Error("simulated kill during put"); }
      this.m.set(k, clone(v)); this.puts++; this.putKeys++;
    }
  }
  async delete(k) { return this.m.delete(k); }
  async list({ prefix = "" } = {}) { const out = new Map(); for (const [k, v] of this.m) if (k.startsWith(prefix)) out.set(k, clone(v)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  records() { const out = {}; for (const [k, v] of this.m) if (k.startsWith("ph:")) out[k.slice(3)] = v; return out; }
}

// A fake Admin GraphQL endpoint over an in-memory catalogue, sorted by id,
// with opaque cursors ("c<index>") like Shopify's, cost extensions, and
// hooks to fail a call, throttle a call, or advance the fake clock.
function fakeShopify(catalogue, opts = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, query: body.query, variables: body.variables, token: init.headers["X-Shopify-Access-Token"] });
    if (opts.clock && opts.advanceMs) opts.clock.t += opts.advanceMs;
    const n = calls.length;
    if (opts.failOnCall && opts.failOnCall.includes(n)) throw new Error("simulated network failure on call " + n);
    if (opts.http500OnCall && opts.http500OnCall.includes(n)) return { status: 500, ok: false, text: async () => "Internal Server Error" };
    if (opts.throttleOnCall && opts.throttleOnCall.includes(n)) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: { requestedQueryCost: 902, actualQueryCost: null, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 102, restoreRate: 100 } } } }) };
    }
    if (body.query.startsWith("{shop{productTypes")) {
      const types = [...new Set(catalogue.map((p) => p.type))].concat(["Accessories", "Pokemon Sealed Product"]);
      return { status: 200, ok: true, text: async () => JSON.stringify({ data: { shop: { productTypes: { edges: types.map((t) => ({ node: t })) } } } }) };
    }
    const v = body.variables;
    if (v.q !== "product_type:*Single* AND status:active") throw new Error("unexpected query " + v.q);
    const start = v.after ? parseInt(v.after.slice(1), 10) + 1 : 0;
    const slice = catalogue.slice(start, start + v.n);
    const endIdx = start + slice.length - 1;
    const hasNext = start + slice.length < catalogue.length;
    const nodes = slice.map((p) => ({
      id: "gid://shopify/Product/" + p.id, handle: p.handle, productType: p.type,
      priceRangeV2: { minVariantPrice: { amount: String(p.min) } },
      variants: { nodes: p.price == null ? [] : [{ price: String(p.price) }] },
    }));
    const avail = opts.available != null ? opts.available : 2000;
    return { status: 200, ok: true, text: async () => JSON.stringify({ data: { products: { nodes, pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? "c" + endIdx : null } } }, extensions: { cost: { requestedQueryCost: 902, actualQueryCost: 602, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: avail, restoreRate: 100 } } } }) };
  };
  return { fetchFn, calls };
}

function makeCx(storage, fetchFn, clock, env) {
  return {
    storage, env: env === undefined ? { SHOPIFY_ADMIN_TOKEN: "shpat_fake", SHOPIFY_SHOP: "most-wanted-ca.myshopify.com" } : env,
    fetch: fetchFn, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, log: () => {}, mem: {},
  };
}

function catalogueOf(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 5555305513113 + i * 32768, handle: "card-" + i, type: i % 3 === 0 ? "Pokemon Single" : i % 3 === 1 ? "MTG Single" : "Yugioh Single", price: (0.25 + (i % 7) * 0.5).toFixed(2), min: (0.10 + (i % 7) * 0.2).toFixed(2) });
  return out;
}

const D0 = dayOf(Date.UTC(2026, 8, 2)); // 2026-09-02
const at = (day, h = 9) => day * DAY + h * 3600e3;

// ---------------------------------------------------------------- pure functions
console.log("applySnapshot / cap / same-day correction");
{
  let r = applySnapshot(undefined, D0, 25, 10);
  check("first snapshot creates one point", r.changed && r.write && r.rec.p.length === 1 && r.rec.s === D0 && r.rec.d === D0, r.rec);
  r = applySnapshot(r.rec, D0 + 1, 25, 10);
  check("unchanged price next day: no point, write only for d", !r.changed && r.write && r.rec.p.length === 1 && r.rec.d === D0 + 1, r.rec);
  r = applySnapshot(r.rec, D0 + 1, 25, 10);
  check("same day again, unchanged: nothing to write", !r.changed && !r.write, r);
  r = applySnapshot(r.rec, D0 + 2, 30, 10);
  check("price change appends", r.changed && r.rec.p.length === 2 && r.rec.p[1][0] === D0 + 2 && r.rec.p[1][1] === 30, r.rec);
  r = applySnapshot(r.rec, D0 + 2, 35, 12);
  check("same-day change corrects the day's point (one point per day)", r.changed && r.rec.p.length === 2 && r.rec.p[1][1] === 35 && r.rec.p[1][2] === 12, r.rec);
  r = applySnapshot(r.rec, D0 + 3, 35, 11);
  check("min-price-only change appends", r.changed && r.rec.p.length === 3 && r.rec.p[2][2] === 11, r.rec);
  r = applySnapshot(r.rec, D0 + 1, 99, 99);
  check("a late point older than the last is ignored", !r.changed && !r.write && r.rec.p.length === 3, r);
  let rec;
  for (let i = 0; i < MAX_POINTS + 50; i++) rec = applySnapshot(rec, D0 + i, 100 + i, 50 + i).rec;
  check("point cap keeps the newest " + MAX_POINTS + " and the original since", rec.p.length === MAX_POINTS && rec.s === D0 && rec.p[0][0] === D0 + 50 && rec.p[MAX_POINTS - 1][0] === D0 + MAX_POINTS + 49, [rec.p.length, rec.s]);
}

console.log("expandSeries / changeOver / buildPayload");
{
  const rec = { s: D0, d: D0 + 100, p: [[D0, 100, 90], [D0 + 10, 120, 100], [D0 + 50, 80, 70]] };
  let s = expandSeries(rec, D0 + 100);
  check("90-day window has 90 entries ending today", s.length === SERIES_DAYS && s[0][0] === dateOf(D0 + 11) && s[89][0] === dateOf(D0 + 100), [s.length, s[0], s[89]]);
  check("step values: 1.20 held until day 49, 0.80 from day 50", s[0][1] === 1.2 && s[38][1] === 1.2 && s[39][1] === 0.8 && s[89][1] === 0.8, [s[38], s[39]]);
  s = expandSeries(rec, D0 + 5);
  check("short history: from the first point to today (6 entries of 1.00)", s.length === 6 && s.every((p) => p[1] === 1) && s[0][0] === dateOf(D0), s);
  s = expandSeries(rec, D0);
  check("first day: a single entry", s.length === 1 && s[0][0] === dateOf(D0) && s[0][1] === 1, s);
  check("no points: empty series", expandSeries({ p: [] }, D0).length === 0 && expandSeries(undefined, D0).length === 0);
  let c = changeOver(rec, D0 + 100, 7);
  check("change7d flat: abs 0 pct 0", c && c.abs === 0 && c.pct === 0, c);
  c = changeOver(rec, D0 + 55, 7);
  check("change7d across the drop: -0.40 / -33.3%", c && c.abs === -0.4 && c.pct === -33.3, c);
  c = changeOver(rec, D0 + 55, 30);
  check("change30d across the drop: -0.40 / -33.3%", c && c.abs === -0.4 && c.pct === -33.3, c);
  c = changeOver(rec, D0 + 12, 7);
  check("change7d across the rise: +0.20 / +20%", c && c.abs === 0.2 && c.pct === 20, c);
  check("change7d null when not tracked 7 days", changeOver(rec, D0 + 5, 7) === null);
  check("change30d null when not tracked 30 days", changeOver(rec, D0 + 20, 30) === null);
  check("change on a zero old price: pct null", changeOver({ s: D0, d: D0 + 9, p: [[D0, 0, 0], [D0 + 9, 50, 50]] }, D0 + 9, 7).pct === null);
  const pl = buildPayload("42", rec, at(D0 + 100));
  check("payload: since/asOf/days/current/raw:false", pl.ok && pl.id === "42" && pl.since === dateOf(D0) && pl.asOf === dateOf(D0 + 100) && pl.days === 101 && pl.current.price === 0.8 && pl.current.min === 0.7 && pl.raw === false, pl);
  check("payload: points is the step series, changes the raw points", pl.points.length === 90 && pl.changes.length === 3 && pl.changes[1][0] === dateOf(D0 + 10) && pl.changes[1][1] === 1.2 && pl.changes[1][2] === 1, [pl.points.length, pl.changes]);
  const none = buildPayload("7", undefined, at(D0));
  check("payload for an unknown id: ok:true, since null, empty points", none.ok === true && none.id === "7" && none.since === null && none.points.length === 0 && none.days === 0 && none.current === null && none.change7d === null, none);
  check("nextRunAt: before 08:00 -> today 08:00; after -> tomorrow", nextRunAt(at(D0, 7)) === at(D0, 8) && nextRunAt(at(D0, 8)) === at(D0 + 1, 8) && nextRunAt(at(D0, 9)) === at(D0 + 1, 8));
  check("throttleWait: enough in the bucket -> 0", throttleWait({ actualQueryCost: 602, throttleStatus: { currentlyAvailable: 1000, restoreRate: 100 } }) === 0);
  check("throttleWait: short by 500 at 100/s -> 5.1s", throttleWait({ actualQueryCost: 602, throttleStatus: { currentlyAvailable: 102, restoreRate: 100 } }) === 5100);
  check("throttleWait: no status -> 0", throttleWait(null) === 0);
  const pg = parsePage({ products: { nodes: [
    { id: "gid://shopify/Product/1", handle: "a", priceRangeV2: { minVariantPrice: { amount: "0.1" } }, variants: { nodes: [{ price: "0.25" }] } },
    { id: "gid://shopify/Product/2", handle: "b", priceRangeV2: { minVariantPrice: { amount: "9.99" } }, variants: { nodes: [{ price: "5.00" }] } },
    { id: "gid://shopify/Product/3", handle: "c", priceRangeV2: null, variants: { nodes: [] } },
  ], pageInfo: { hasNextPage: true, endCursor: "xyz" } } });
  check("parsePage: cents, min never above the first variant, unpriced dropped, cursor kept", pg.items.length === 2 && pg.items[0].cents === 25 && pg.items[0].min === 10 && pg.items[1].min === 500 && pg.cursor === "xyz" && pg.hasNext, pg);
}

// ---------------------------------------------------------------- the run
console.log("run day 1: kick, ticks within budget, every product gets one point");
const cat = catalogueOf(1200);
cat[5].price = "999999.00"; cat[5].min = "999999.00";   // the theme's "email us" sentinel
const st = new FakeStorage();
const clock = { t: at(D0, 9) };
let shop = fakeShopify(cat, { clock, advanceMs: 8000 });
let cx = makeCx(st, shop.fetchFn, clock);
{
  const k = await kickRun(cx);
  check("kick starts today's run and arms the alarm now", k.ok && k.started === true && k.day === dateOf(D0) && st.alarm === clock.t, k);
  await priceDoAlarm(cx);
  let run = await st.get("phs:run");
  check("tick 1 stops after the 20s budget with the cursor saved (types call + 2 pages of " + PAGE + " at 8s each)", run && !run.done && run.pages === 2 && run.cursor === "c499" && run.ticks === 1, run);
  check("tick 1 re-armed the alarm for the next page (not the nightly slot)", st.alarm > clock.t - 1 && st.alarm < clock.t + 5000, [st.alarm, clock.t]);
  await priceDoAlarm(cx);
  run = await st.get("phs:run");
  const last = await st.get("phs:last");
  check("tick 2 finishes the run", run.done && last && last.day === D0 && last.pages === 5 && last.seen === 1200 && last.ticks === 2 && !last.error, last);
  check("summary: 1199 changed (first points), 1 skipped sentinel, errors 0, firstId/lastId set", last.changed === 1199 && last.skipped === 1 && last.errors === 0 && last.firstId === String(cat[0].id) && last.lastId === String(cat[1199].id), last);
  check("summary carries the discovered single types", Array.isArray(last.types) && last.types.length === 3 && last.types.every((t) => /single/i.test(t)), last.types);
  check("after the run the alarm is the next 08:00 UTC", st.alarm === at(D0 + 1, 8), [st.alarm, at(D0 + 1, 8)]);
  const recs = st.records();
  check("1199 records, each with exactly one point dated today", Object.keys(recs).length === 1199 && Object.values(recs).every((r) => r.p.length === 1 && r.p[0][0] === D0 && r.d === D0 && r.s === D0), Object.keys(recs).length);
  check("sentinel-priced product has no record", !recs[String(cat[5].id)]);
  check("cents and min stored from the first variant / price range", recs[String(cat[1].id)].p[0][1] === 75 && recs[String(cat[1].id)].p[0][2] === 30, recs[String(cat[1].id)]);
  check("every page request carried the token and the singles query", shop.calls.slice(1).every((c) => c.token === "shpat_fake" && c.variables.q === "product_type:*Single* AND status:active" && c.variables.n === PAGE));
  check("cursors chained: page 2 asked after c249, page 5 after c999", shop.calls[2].variables.after === "c249" && shop.calls[5].variables.after === "c999", shop.calls.map((c) => c.variables.after));
}

console.log("same day again: idempotent");
{
  const putsBefore = st.puts;
  const k = await kickRun(cx);
  check("second kick the same day is a no-op that says so", k.ok && k.started === false && k.reason === "already ran today" && k.last && k.last.dayDate === dateOf(D0), k);
  clock.t += 3600e3;
  await priceDoAlarm(cx);
  check("an alarm the same day fetches nothing and writes nothing", shop.calls.length === 6 && st.puts === putsBefore && st.alarm === at(D0 + 1, 8), [shop.calls.length, st.puts]);
  const s = await statusOf(cx);
  check("status: no run in progress, last is today's, alarm shown, token configured", s.ok && s.run === null && s.last.dayDate === dateOf(D0) && s.tokenConfigured === true && s.alarmAt === new Date(at(D0 + 1, 8)).toISOString() && s.note === undefined, s);
}

console.log("day 2, same prices: no new points, last-seen day moves");
{
  clock.t = at(D0 + 1, 8);
  shop = fakeShopify(cat, { clock, advanceMs: 1000 });
  cx = makeCx(st, shop.fetchFn, clock);
  await priceDoAlarm(cx);
  const last = await st.get("phs:last");
  check("day-2 run finished in one tick with changed 0", last.day === D0 + 1 && last.changed === 0 && last.seen === 1200 && last.ticks === 1 && last.writes === 1199, last);
  const r = (await st.get("ph:" + cat[1].id));
  check("record: still one point, d advanced", r.p.length === 1 && r.d === D0 + 1 && r.s === D0, r);
  const pl = buildPayload(String(cat[1].id), r, clock.t);
  check("payload day 2: days 2, two step entries, change7d null", pl.days === 2 && pl.points.length === 2 && pl.points[1][0] === dateOf(D0 + 1) && pl.change7d === null, pl);
}

console.log("day 3, one product changes");
{
  clock.t = at(D0 + 2, 8);
  cat[1].price = "0.95"; cat[1].min = "0.40";
  shop = fakeShopify(cat, { clock, advanceMs: 1000 });
  cx = makeCx(st, shop.fetchFn, clock);
  await priceDoAlarm(cx);
  const last = await st.get("phs:last");
  const a = await st.get("ph:" + cat[1].id), b = await st.get("ph:" + cat[2].id);
  check("only the changed product appended", last.changed === 1 && a.p.length === 2 && a.p[1][0] === D0 + 2 && a.p[1][1] === 95 && a.p[1][2] === 40 && b.p.length === 1, [a, b]);
}

console.log("resumability: a page error, then a hard kill, both resume from the saved cursor");
{
  clock.t = at(D0 + 3, 8);
  shop = fakeShopify(cat, { clock, advanceMs: 1000, failOnCall: [3] });   // call 1 = types, 2 = page 1, 3 = page 2 fails
  cx = makeCx(st, shop.fetchFn, clock);
  await priceDoAlarm(cx);
  let run = await st.get("phs:run");
  check("page error: run stays open with page 1's cursor, errStreak 1, backoff alarm", run && !run.done && run.pages === 1 && run.cursor === "c249" && run.errStreak === 1 && run.errors === 1 && st.alarm === clock.t + 15000, run);
  const k = await kickRun(cx);
  check("kick while running: no-op 'already running'", k.started === false && k.reason === "already running", k);
  clock.t = st.alarm;
  st.failPutOnce = "phs:run";          // the next persist of the run dies mid-tick (as a deploy would)
  let killed = false;
  // priceDoAlarm swallows the throw; the run-state put for page 2 is what died
  await priceDoAlarm(cx);
  run = await st.get("phs:run");
  killed = run.pages === 1 && run.cursor === "c249";
  check("hard kill: page 2's cursor was NOT persisted, safety alarm set", killed && st.alarm === clock.t + 60e3, [run.pages, run.cursor, st.alarm - clock.t]);
  check("the resumed page asked after the saved cursor c249", shop.calls.length === 4 && shop.calls[3].variables.after === "c249", shop.calls.map((c) => c.variables.after));
  clock.t = st.alarm;
  await priceDoAlarm(cx);
  const last = await st.get("phs:last");
  check("resumed run finishes: 5 pages, 1200 seen, errors 1 recorded", last.day === D0 + 3 && !last.error && last.pages === 5 && last.seen === 1200 && last.errors === 1, last);
  check("after the kill, page 2 was asked again after c249 and the chain continued", shop.calls[4].variables.after === "c249" && shop.calls[5].variables.after === "c499" && shop.calls.length === 8, shop.calls.map((c) => c.variables.after));
  const a = await st.get("ph:" + cat[300].id);
  check("page 2 processed twice the same day: still one point per day", a.p.length === 1 && a.d === D0 + 3, a);
}

console.log("throttling");
{
  clock.t = at(D0 + 4, 8);
  shop = fakeShopify(cat, { clock, advanceMs: 1000, throttleOnCall: [3] });
  cx = makeCx(st, shop.fetchFn, clock);
  await priceDoAlarm(cx);
  const run = await st.get("phs:run");
  check("throttled page: run open at page 1, alarm 8.1s out, no error streak", run && !run.done && run.pages === 1 && run.errStreak === 0 && run.lastError === "throttled" && st.alarm === clock.t + 8100, [run, st.alarm - clock.t]);
  clock.t = st.alarm;
  await priceDoAlarm(cx);
  check("resumes and finishes after the wait", (await st.get("phs:last")).day === D0 + 4);
  // a low bucket after a successful page re-arms instead of hammering
  clock.t = at(D0 + 5, 8);
  shop = fakeShopify(cat, { clock, advanceMs: 1000, available: 200 });
  cx = makeCx(st, shop.fetchFn, clock);
  await priceDoAlarm(cx);
  const run2 = await st.get("phs:run");
  check("bucket short after page 1: next page armed for (602-200)/100 s", run2.pages === 1 && st.alarm === clock.t + 4120, [run2.pages, st.alarm - clock.t]);
}

console.log("no token");
{
  const st2 = new FakeStorage();
  const c2 = { t: at(D0, 8) };
  const shop2 = fakeShopify(cat, { clock: c2 });
  const cx2 = makeCx(st2, shop2.fetchFn, c2, { SHOPIFY_SHOP: "most-wanted-ca.myshopify.com" });
  await priceDoAlarm(cx2);
  const last = await st2.get("phs:last");
  const s = await statusOf(cx2);
  check("run finishes at once with the token error, nothing fetched, retry in an hour", last && last.error === "SHOPIFY_ADMIN_TOKEN not configured" && shop2.calls.length === 0 && st2.alarm === c2.t + 3600e3, last);
  check("status says the token is missing", s.tokenConfigured === false && /SHOPIFY_ADMIN_TOKEN/.test(s.note) && s.last.error === "SHOPIFY_ADMIN_TOKEN not configured", s);
  const k = await kickRun(cx2);
  check("a failed day may be kicked again", k.started === true, k);
}

console.log("stalled run resume + DO fetch surface");
{
  const st3 = new FakeStorage();
  const c3 = { t: at(D0, 9) };
  await st3.put("phs:run", { day: D0, started: c3.t - 600e3, tickAt: c3.t - 400e3, cursor: "c249", pages: 1, seen: 250, changed: 250, writes: 250, errors: 0, done: false });
  const cx3 = makeCx(st3, fakeShopify(cat, { clock: c3 }).fetchFn, c3);
  const k = await kickRun(cx3);
  check("stalled run (no alarm, no page for >3 min) is resumed by a kick", k.resumed === true && st3.alarm === c3.t, k);
  st3.alarm = null;
  const stat = await priceDoFetch(cx3, new Request("https://price-history.internal/_ph/status"), new URL("https://price-history.internal/_ph/status"));
  const sj = await stat.json();
  check("/_ph/status: 200, run in progress shown without its cursor, arming set the alarm for an open run", stat.status === 200 && sj.run && sj.run.hasCursor === true && sj.run.cursor === undefined && st3.alarm === c3.t + 1000, sj);
  await st3.put("ph:77", { s: D0 - 3, d: D0, p: [[D0 - 3, 1000, 800], [D0, 900, 700]] });
  const g = await priceDoFetch(cx3, new Request("https://price-history.internal/_ph/get?id=77"), new URL("https://price-history.internal/_ph/get?id=77"));
  const gj = await g.json();
  check("/_ph/get: payload with 4 step entries and current 9.00", g.status === 200 && gj.points.length === 4 && gj.current.price === 9 && gj.since === dateOf(D0 - 3), gj);
  const bad = await priceDoFetch(cx3, new Request("https://price-history.internal/_ph/get?id=abc"), new URL("https://price-history.internal/_ph/get?id=abc"));
  check("/_ph/get without a numeric id -> 400", bad.status === 400);
  const nf = await priceDoFetch(cx3, new Request("https://price-history.internal/_ph/nope"), new URL("https://price-history.internal/_ph/nope"));
  check("unknown /_ph path -> 404", nf.status === 404);
}

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
