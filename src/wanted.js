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
const KV_KEY = "wanted:mtg:standard:v4";        // v4: internal demand first (2026-09-22)
const ATTEMPT_KEY = "wanted:mtg:standard:attempt4";
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

/* INTERNAL DEMAND (owner, 2026-09-22: "Is there an internal way to see what
   cards we need most? Either by what we sell the most of or need the most
   that people search for on our site but we are out of stock" - "Let's do
   it"). Two signals the worker already has:
     1. The Deck Builder's miss tally (src/room.js dmiss:<day>, 60 days;
        /deck-admin?op=overview -> miss.mtg = top 30 names with counts):
        cards shoppers pasted into a decklist that we could not supply.
     2. Shopify orders of the last SALES_DAYS days (Admin GraphQL, needs
        read_orders on SHOPIFY_ADMIN_TOKEN): units sold per Magic single
        (productType "MTG ..."), with the product's stock NOW - a seller
        that is out or nearly out is a card we need again.
   Ranked by misses x 3 + units; a sold card counts only when its stock is
   at LOW_STOCK or below. These go ahead of the MTGGoldfish movers, which
   remain the fallback when the internal list is thin. */
export const SALES_DAYS = 30;
export const LOW_STOCK = 2;
export const MIN_MISSES = 2;
const ORDERS_Q = `query($q:String!,$after:String){orders(first:50,query:$q,after:$after,sortKey:CREATED_AT,reverse:true){nodes{lineItems(first:40){nodes{title quantity product{productType totalInventory}}}}pageInfo{hasNextPage endCursor}}}`;
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function adminGql(env, query, variables) {
  const token = env && env.SHOPIFY_ADMIN_TOKEN;
  if (!token) throw new Error("no SHOPIFY_ADMIN_TOKEN");
  const shop = (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";
  const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, { method: "POST", headers: { "content-type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("admin HTTP " + r.status);
  if (j && j.errors && j.errors.length) throw new Error(String(j.errors[0].message || "graphql error").slice(0, 160));
  return j && j.data;
}
const defaultIo = (env) => ({
  overview: async () => {
    const r = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request("https://default.internal/deck-admin?op=overview&me="));
    return r.ok ? r.json() : null;
  },
  orders: (vars) => adminGql(env, ORDERS_Q, vars),
});

// Orders -> per-name sales of Magic singles: {name -> {units, sets:{set:units}, inv}}
export function tallySales(orders) {
  const out = {};
  for (const o of orders || []) for (const li of ((o.lineItems && o.lineItems.nodes) || [])) {
    const pt = String((li.product && li.product.productType) || "");
    if (!/^mtg\b/i.test(pt)) continue;
    const m = String(li.title || "").match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    if (!m) continue;
    const name = m[1].replace(/\s*\((?:Borderless|Showcase|Extended Art|Foil Etched|Retro Frame|Promo Pack|Prerelease)[^)]*\)\s*$/i, "").trim(), set = m[2].trim();
    const q = Math.max(0, li.quantity | 0);
    const inv = li.product && li.product.totalInventory != null ? Number(li.product.totalInventory) : null;
    const t = (out[name] = out[name] || { units: 0, sets: {}, inv: null });
    t.units += q;
    t.sets[set] = (t.sets[set] || 0) + q;
    if (inv != null) t.inv = t.inv == null ? inv : Math.min(t.inv, inv);
  }
  return out;
}

// The ranked internal candidate list plus notes on what each source gave.
export async function internalCandidates(env, io) {
  io = io || defaultIo(env);
  const notes = { misses: 0, orders: 0, sold: 0, ordersError: null, missesError: null };
  const misses = {};
  try {
    const ov = await io.overview();
    for (const x of ((ov && ov.miss && ov.miss.mtg) || [])) if (x && x.name && Number(x.c) >= MIN_MISSES) misses[x.name] = Number(x.c);
    notes.misses = Object.keys(misses).length;
  } catch (e) { notes.missesError = String((e && e.message) || e).slice(0, 120); }
  let sales = {};
  try {
    const since = new Date(Date.now() - SALES_DAYS * 864e5).toISOString();
    const orders = [];
    let after = null;
    for (let page = 0; page < 10; page++) {
      const d = await io.orders({ q: "created_at:>='" + since + "'", after });
      const o = d && d.orders;
      if (!o) { if (page === 0) throw new Error("orders not readable (token scope?)"); break; }
      orders.push(...(o.nodes || []));
      if (!o.pageInfo || !o.pageInfo.hasNextPage) break;
      after = o.pageInfo.endCursor;
    }
    notes.orders = orders.length;
    sales = tallySales(orders);
    notes.sold = Object.keys(sales).length;
  } catch (e) { notes.ordersError = String((e && e.message) || e).slice(0, 120); }
  const names = new Set([...Object.keys(misses), ...Object.keys(sales)]);
  const out = [];
  for (const name of names) {
    const m = misses[name] || 0, t = sales[name];
    const units = t ? t.units : 0, inv = t ? t.inv : null;
    const low = inv != null && inv <= LOW_STOCK;
    if (!m && !(units >= 2 && low)) continue;      // a seller we still have plenty of is not a need
    const topSet = t ? Object.keys(t.sets).sort((a, b) => t.sets[b] - t.sets[a])[0] : "";
    const why = [];
    if (m) why.push("asked for " + m + " time" + (m === 1 ? "" : "s") + " by deck builders");
    if (units) why.push("sold " + units + " in the last " + SALES_DAYS + " days");
    if (inv != null) why.push(inv <= 0 ? "out of stock" : inv + " left");
    out.push({ name, setSlug: slugify(topSet), setCode: "", price: null, change: null, pct: null, source: "internal", misses: m, units, inv, why: why.join(" · ").replace(/^./, (c) => c.toUpperCase()) });
  }
  out.sort((a, b) => (b.misses * 3 + b.units) - (a.misses * 3 + a.units));
  return { candidates: out.slice(0, 40), notes };
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
  let internal = { candidates: [], notes: null };
  if (opts.candidates) { try { internal = await opts.candidates(); } catch (e) { internal = { candidates: [], notes: { error: String((e && e.message) || e).slice(0, 120) } }; } }
  let front = [], moversError = null;
  try { const html = await fetchMovers(opts.fetchFn); front = pickWanted(parseMovers(html), 1000); if (!front.length) moversError = "no movers rows parsed (" + html.length + " bytes)"; }
  catch (e) { moversError = String((e && e.message) || e).slice(0, 120); }
  const seen = new Set(), queue = [];
  for (const c of [...internal.candidates, ...front]) { const k = letters(c.name); if (k && !seen.has(k)) { seen.add(k); queue.push(c); } }
  if (!queue.length) throw new Error(moversError || "no candidates");
  const pages = [];
  if (internal.candidates.length) pages.push("internal");
  if (front.length) pages.push(MOVERS_URL);
  return { startedAt: new Date().toISOString(), n, queue, more: [MORE_URLS.weekly, MORE_URLS.daily], seen: [...seen],
    hits: [], missed: [], probe: [], tried: 0, pages, sources: { internal: internal.candidates.length, movers: front.length, notes: internal.notes, moversError },
    front: queue.slice(0, n).map((c) => ({ name: c.name, source: c.source || "movers", setCode: c.setCode, price: c.price, change: c.change, pct: c.pct, why: c.why || null })), backoffUntil: 0 };
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
    if (hit) state.hits.push({ ...hit, wanted: { source: c.source || "movers", why: c.why || null, misses: c.misses || 0, units: c.units || 0, inv: c.inv == null ? null : c.inv, price: c.price, change: c.change, pct: c.pct, setCode: c.setCode, rank: state.hits.length + 1 } });
    else state.missed.push(c.name);
  }
  const exhausted = !state.queue.length && !state.more.length;
  const done = state.hits.length >= state.n || state.tried >= MAX_TRIED || exhausted;
  return { state, done };
}

export const resultOf = (state) => ({ source: MOVERS_URL, pages: state.pages, sources: state.sources || null, asOf: new Date().toISOString(), startedAt: state.startedAt, tried: state.tried, picked: state.front, missed: state.missed.slice(0, 60), probe: state.probe.slice(-60), count: state.hits.length, internal: state.hits.filter((h) => h.wanted && h.wanted.source === "internal").length, hits: state.hits });

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
const STATE_KEY = "wanted:mtg:standard:state4";
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
  return { source: MOVERS_URL, asOf: null, building: true, progress: state ? { startedAt: state.startedAt, tried: state.tried, found: state.hits.length, queued: state.queue.length, backoffUntil: state.backoffUntil || 0, sources: state.sources || null, probe: state.probe.slice(-8) } : null, lastTry, count: 0, hits: [] };
}
