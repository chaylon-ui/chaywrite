/* ---------------- "Cards we need most" for the sell page's first view ----------------
   Owner (2026-09-22): "can you make the first page highlight with 10 cards
   we are in most need of" - and, a minute later, the source: MTGGoldfish's
   paper Standard movers (https://www.mtggoldfish.com/movers/paper/standard),
   the cards whose price rose most this week: what players are chasing, so
   what the store most wants to buy.

   The worker fetches that page (the sandbox cannot; the worker can), reads
   the Weekly Change "Top Winners" table (Daily winners fill any gap), looks
   each name up in BinderPOS's buylist search (the same call the page's own
   search makes, src/buylist.js bpCardSearch) and hands the page the matching
   search hits - image, set, conditions, today's cash and credit offers - so
   the page draws them with its ordinary result cards and Add buttons.
   Cached in the portal-cache Durable Object (kvGet/kvPut, src/portal.js) for
   TTL_MS; a fetch failure keeps the last good list. No key, no login. */
import { kvGet, kvPut } from "./portal.js";

export const MOVERS_URL = "https://www.mtggoldfish.com/movers/paper/standard";
// The "View More" pages behind the movers tables: 50 rows each, same markup.
export const MORE_URLS = { weekly: "https://www.mtggoldfish.com/movers-details/paper/standard/winners/wow", daily: "https://www.mtggoldfish.com/movers-details/paper/standard/winners/dod" };
export const MAX_TRIED = 60;
export const WANTED_N = 10;
export const TTL_MS = 48 * 3600 * 1000;        // a good list is kept two days (a failed refresh keeps yesterday's)
export const REFRESH_MS = 23 * 3600 * 1000;    // the cron rebuilds after this: once a day (owner, 2026-09-22)
export const RETRY_MS = 3600 * 1000;           // and retries an hour after a build that found nothing
const KV_KEY = "wanted:mtg:standard:v2";
const ATTEMPT_KEY = "wanted:mtg:standard:attempt";
const LAST_TRY_KEY = "wanted:mtg:standard:lasttry";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const memo = { at: 0, value: null };

const unescapeHtml = (s) => String(s || "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const letters = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

// One movers row -> {name, setCode, setSlug, number, price, change, pct, image}
// or null when it is not a card row. Markup as served 2026-09-22 (probe
// 35782007459): the name sits in <span class='card_id card_name'><a
// data-card-id="Name <uuid> [FRA]" data-full-image=... href="/price/<set-slug>/
// <num>/<card-slug>#paper">Name</a> <span class='card-num'>#220</span>, the
// dollar change in the first <span class='increase|decrease'>, the price in a
// <td class='text-end'> $ 49.98 </td>, the percent in a second increase|decrease span.
export function parseRow(tr) {
  const link = tr.match(/<span class=['"]card_id card_name['"]>\s*<a ([^>]*)>([\s\S]*?)<\/a>(?:\s*<span class=['"]card-num['"]>#?([^<]*)<\/span>)?/);
  if (!link) return null;
  const attrs = link[1];
  const name = unescapeHtml(link[2].replace(/<[^>]+>/g, ""));
  if (!name) return null;
  const href = (attrs.match(/href="([^"]*)"/) || [])[1] || "";
  const slug = href.match(/\/price\/([^/]+)\/([^/#]+)\/([^/#]+)/);
  const cardId = unescapeHtml((attrs.match(/data-card-id="([^"]*)"/) || [])[1] || "");
  const setCode = (cardId.match(/\[([A-Za-z0-9]+)\]\s*$/) || [])[1] || "";
  const image = (attrs.match(/data-full-image="([^"]*)"/) || [])[1] || "";
  const moves = [...tr.matchAll(/class=['"](increase|decrease)['"]>\s*([+-]?[\d.,]+)(%?)\s*</g)];
  const dollars = moves.find((m) => !m[3]);
  const pct = moves.find((m) => m[3]);
  const price = (tr.match(/<td class=['"]text-end['"]>\s*\$\s*([\d.,]+)\s*<\/td>/) || [])[1];
  return {
    name, setCode, setSlug: slug ? slug[1] : "", number: unescapeHtml(link[3] || (slug ? slug[2] : "")), image,
    price: price ? Number(price.replace(/,/g, "")) : null,
    change: dollars ? Number(dollars[2].replace(/,/g, "")) : null,
    pct: pct ? Number(pct[2].replace(/,/g, "")) : null,
  };
}

// The whole page -> {daily: {winners, losers}, weekly: {winners, losers}}.
export function parseMovers(html) {
  const out = { daily: { winners: [], losers: [] }, weekly: { winners: [], losers: [] } };
  const h = String(html || "");
  const sections = [["daily", h.search(/<h2[^>]*>\s*Daily Change\s*<\/h2>/i)], ["weekly", h.search(/<h2[^>]*>\s*Weekly Change\s*<\/h2>/i)]]
    .filter((s) => s[1] >= 0).sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < sections.length; i++) {
    const [key, start] = sections[i];
    const end = i + 1 < sections.length ? sections[i + 1][1] : h.length;
    const part = h.slice(start, end);
    for (const t of part.matchAll(/<table[^>]*table-movers[^>]*>([\s\S]*?)<\/table>/g)) {
      const which = /Top Losers/i.test(t[1]) ? "losers" : /Top Winners/i.test(t[1]) ? "winners" : null;
      if (!which) continue;
      for (const r of t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const row = parseRow(r[1]);
        if (row) out[key][which].push(row);
      }
    }
  }
  return out;
}

// Every card row of every movers table on a page, in order (the View More
// pages hold one table of 50: probe 35782918711).
export function parseRows(html) {
  const out = [];
  for (const t of String(html || "").matchAll(/<table[^>]*table-movers[^>]*>([\s\S]*?)<\/table>/g)) {
    for (const r of t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) { const row = parseRow(r[1]); if (row) out.push(row); }
  }
  return out;
}

// The N cards to feature: weekly winners in order, then daily winners for
// any gap, one line per card name.
export function pickWanted(parsed, n) {
  const want = n || WANTED_N, seen = new Set(), out = [];
  for (const list of [parsed?.weekly?.winners || [], parsed?.daily?.winners || []]) {
    for (const c of list) {
      const k = letters(c.name);
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(c);
      if (out.length >= want) return out;
    }
  }
  return out;
}

const bestCash = (hit) => {
  let best = 0;
  for (const v of hit.variants || []) for (const p of v.cardBuylistTypes || []) best = Math.max(best, Number(p.buyPrice) || 0);
  return best;
};
// Which of BinderPOS's search hits IS this mover: the exact name, from the
// same set when the movers' set slug words all appear in the hit's set name
// ("reality-fracture" / "Reality Fracture"; "lost-caverns-of-ixalan" / "The
// Lost Caverns of Ixalan"), else the exact-name hit the store pays most for.
// Only a printing the store is BUYING counts (an offer with a price and
// room for more copies): a hit with no such offer draws "Not currently
// buying this printing" on the page (owner's phone, 2026-09-22: Lyra).
const buyable = (hit) => (hit.variants || []).some((v) => (v.cardBuylistTypes || []).some((p) => (Number(p.buyPrice) > 0 || Number(p.creditBuyPrice) > 0) && (p.maxPurchaseQuantity == null || Number(p.maxPurchaseQuantity) > 0)));
export function matchHit(entry, hits) {
  const want = letters(entry.name);
  const exact = (hits || []).filter((h) => letters(h.cardName) === want && buyable(h));
  if (!exact.length) return null;
  const words = String(entry.setSlug || "").split("-").map(letters).filter((w) => w.length > 2);
  const sameSet = words.length ? exact.filter((h) => { const s = letters(h.setName); return words.every((w) => s.includes(w)); }) : [];
  const pool = sameSet.length ? sameSet : exact;
  return pool.slice().sort((a, b) => bestCash(b) - bestCash(a))[0];
}

export async function fetchMovers(fetchFn, url) {
  const r = await (fetchFn || fetch)(url || MOVERS_URL, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-CA,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("movers page HTTP " + r.status);
  return await r.text();
}

// One lookup's answer in a common shape: a plain array of hits (tests, the
// old bpCardSearch) or {status, hits, bodyType} (bpCardSearchRaw).
const normalise = (r) => Array.isArray(r) ? { hits: r, status: null, bodyType: "array", error: null }
  : r && Array.isArray(r.hits) ? { hits: r.hits, status: r.status == null ? null : r.status, bodyType: r.bodyType || null, error: r.error || null }
  : { hits: [], status: null, bodyType: typeof r, error: null };

/* The build is a small state machine so it can run a few lookups per cron
   tick: BinderPOS's portal sits behind Cloudflare rate limiting and answered
   HTTP 429 "error code: 1015" from the ninth lookup of a run even at 350 ms
   apart (2026-09-22, lastTry probe), so a list needs several ticks' worth of
   polite calls. State: {startedAt, n, queue, more, seen, hits, missed, probe,
   tried, pages, front, backoffUntil}. */
export const BUDGET = 5;          // lookups per tick
export const STEP_DELAY_MS = 2000;
export const BACKOFF_MS = 10 * 60 * 1000;

export async function startWanted(opts) {
  const n = opts.n || WANTED_N;
  const html = await fetchMovers(opts.fetchFn);
  const parsed = parseMovers(html);
  const front = pickWanted(parsed, 1000);
  if (!front.length) throw new Error("no movers rows parsed (" + html.length + " bytes)");
  return { startedAt: new Date().toISOString(), n, queue: front.slice(), more: [MORE_URLS.weekly, MORE_URLS.daily], seen: front.map((c) => letters(c.name)),
    hits: [], missed: [], probe: [], tried: 0, pages: [MOVERS_URL], front: front.slice(0, n).map((c) => ({ name: c.name, setCode: c.setCode, price: c.price, change: c.change, pct: c.pct })), backoffUntil: 0 };
}

// Up to `budget` lookups; returns {state, done}. A 429 puts the name back,
// sets backoffUntil and ends the step.
export async function stepWanted(state, opts) {
  const budget = opts.budget || BUDGET, delayMs = opts.delayMs == null ? STEP_DELAY_MS : opts.delayMs;
  const seen = new Set(state.seen);
  let did = 0;
  while (state.hits.length < state.n && state.tried < MAX_TRIED && did < budget) {
    if (!state.queue.length) {
      const url = state.more.shift();
      if (!url) break;
      let rows = [];
      try { rows = parseRows(await fetchMovers(opts.fetchFn, url)); state.pages.push(url); } catch { rows = []; }
      for (const c of rows) { const k = letters(c.name); if (k && !seen.has(k)) { seen.add(k); state.seen.push(k); state.queue.push(c); } }
      if (!state.queue.length) continue;
    }
    const c = state.queue.shift();
    if (did > 0 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    did++;
    const got = await opts.search(c.name).then(normalise).catch((e) => ({ hits: [], status: null, bodyType: "error", error: String((e && e.message) || e).slice(0, 160) }));
    if (got.status === 429) {
      state.queue.unshift(c);
      state.backoffUntil = Date.now() + BACKOFF_MS;
      state.probe.push({ name: c.name, status: 429, got: 0, bodyType: got.bodyType, first: null, error: "rate limited; backing off", matched: null });
      break;
    }
    state.tried++;
    const hit = matchHit(c, got.hits);
    state.probe.push({ name: c.name, status: got.status, got: got.hits.length, bodyType: got.bodyType, first: got.hits[0] ? String(got.hits[0].cardName) : null, error: got.error, matched: hit ? hit.setName : null });
    if (hit) state.hits.push({ ...hit, wanted: { price: c.price, change: c.change, pct: c.pct, setCode: c.setCode, rank: state.hits.length + 1 } });
    else state.missed.push(c.name);
  }
  const exhausted = !state.queue.length && !state.more.length;
  const done = state.hits.length >= state.n || state.tried >= MAX_TRIED || exhausted;
  return { state, done };
}

export const resultOf = (state) => ({ source: MOVERS_URL, pages: state.pages, asOf: new Date().toISOString(), startedAt: state.startedAt, tried: state.tried, picked: state.front, missed: state.missed.slice(0, 60), probe: state.probe.slice(-60), count: state.hits.length, hits: state.hits });

// The whole build in one go (tests, and anything with time to spare).
export async function buildWanted(opts) {
  let state = await startWanted(opts);
  for (let i = 0; i < 100; i++) {
    const r = await stepWanted(state, { ...opts, budget: opts.budget || 1000 });
    state = r.state;
    if (r.done || state.backoffUntil > Date.now()) break;
  }
  return resultOf(state);
}

async function readCached(env) {
  if (memo.value && Date.now() - memo.at < 3600 * 1000) return memo.value;
  const cached = await kvGet(env, KV_KEY);
  if (!cached) return null;
  try { const v = JSON.parse(cached); if (v && v.count > 0) { memo.at = Date.now(); memo.value = v; return v; } } catch { /* rebuild */ }
  return null;
}
const STATE_KEY = "wanted:mtg:standard:state";
const STATE_TTL = 6 * 3600 * 1000;
const readJson = async (env, key) => { try { const t = await kvGet(env, key); return t ? JSON.parse(t) : null; } catch { return null; } };

// The cron's job (src/index.js scheduled, every 5 min): once a day (when the
// cached list is older than REFRESH_MS, or missing) start a build, then
// advance it BUDGET lookups per tick until it is done; at most one start per
// RETRY_MS. A build that finds nothing is recorded (LAST_TRY_KEY, shown to
// /wanted readers) but never replaces a good list.
export async function refreshWanted(env, opts) {
  let state = await readJson(env, STATE_KEY);
  if (!state) {
    const have = await readCached(env);
    if (have && Date.now() - Date.parse(have.asOf) < REFRESH_MS) return { skipped: "fresh", asOf: have.asOf, count: have.count };
    if (await kvGet(env, ATTEMPT_KEY)) return { skipped: "tried within the hour" };
    await kvPut(env, ATTEMPT_KEY, new Date().toISOString(), RETRY_MS);
    try { state = await startWanted(opts); }
    catch (e) {
      const v = { source: MOVERS_URL, asOf: new Date().toISOString(), error: String((e && e.message) || e).slice(0, 200), tried: 0, probe: [], count: 0, hits: [] };
      await kvPut(env, LAST_TRY_KEY, JSON.stringify(v), TTL_MS);
      return v;
    }
  }
  if (state.backoffUntil > Date.now()) return { skipped: "backing off until " + new Date(state.backoffUntil).toISOString(), tried: state.tried, count: state.hits.length };
  const r = await stepWanted(state, opts);
  state = r.state;
  if (!r.done) {
    await kvPut(env, STATE_KEY, JSON.stringify(state), STATE_TTL);
    return { progress: true, tried: state.tried, count: state.hits.length, queued: state.queue.length, backoff: state.backoffUntil > Date.now() };
  }
  await kvPut(env, STATE_KEY, "", 1);   // done: the state expires at once
  const v = resultOf(state);
  if (v.count > 0) {
    await kvPut(env, KV_KEY, JSON.stringify(v), TTL_MS);
    memo.at = Date.now(); memo.value = v;
  } else {
    await kvPut(env, LAST_TRY_KEY, JSON.stringify({ asOf: v.asOf, error: v.error || null, tried: v.tried, missed: (v.missed || []).slice(0, 12), probe: (v.probe || []).slice(0, 12) }), TTL_MS);
  }
  return v;
}

// What the route serves: the cached list, or an empty answer that says the
// cron has yet to build one (with the build's progress and the last
// attempt's notes when there are any).
export async function wantedCards(env) {
  const have = await readCached(env);
  if (have) return have;
  const state = await readJson(env, STATE_KEY);
  const lastTry = await readJson(env, LAST_TRY_KEY);
  return { source: MOVERS_URL, asOf: null, building: true, progress: state ? { startedAt: state.startedAt, tried: state.tried, found: state.hits.length, queued: state.queue.length, backoffUntil: state.backoffUntil || 0, probe: state.probe.slice(-8) } : null, lastTry, count: 0, hits: [] };
}
