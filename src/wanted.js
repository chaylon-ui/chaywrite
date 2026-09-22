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
export const TTL_MS = 12 * 3600 * 1000;
const KV_KEY = "wanted:mtg:standard:v1";
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
export function matchHit(entry, hits) {
  const want = letters(entry.name);
  const exact = (hits || []).filter((h) => letters(h.cardName) === want);
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

// Build the list: movers page -> candidates -> BinderPOS hits, until N are
// found. opts.search(name) returns BinderPOS hits for a name (injected by
// src/buylist.js, and by tests). The store's buylist does not carry every
// riser (2026-09-22: all ten weekly winners were Reality Fracture cards the
// buylist had none of), so after the front page's weekly and daily winners
// the walk continues down the 50-row View More lists, weekly then daily,
// and stops at N hits or MAX_TRIED names.
export async function buildWanted(opts) {
  const n = opts.n || WANTED_N;
  const html = await fetchMovers(opts.fetchFn);
  const parsed = parseMovers(html);
  const front = pickWanted(parsed, 1000);
  if (!front.length) throw new Error("no movers rows parsed (" + html.length + " bytes)");
  const seen = new Set(front.map((c) => letters(c.name)));
  const queue = front.slice();
  const more = [MORE_URLS.weekly, MORE_URLS.daily];
  const hits = [], missed = [], pages = [MOVERS_URL];
  let tried = 0;
  while (hits.length < n && tried < MAX_TRIED) {
    if (!queue.length) {
      const url = more.shift();
      if (!url) break;
      let rows = [];
      try { rows = parseRows(await fetchMovers(opts.fetchFn, url)); pages.push(url); } catch { rows = []; }
      for (const c of rows) { const k = letters(c.name); if (k && !seen.has(k)) { seen.add(k); queue.push(c); } }
      if (!queue.length) continue;
    }
    const batch = queue.splice(0, Math.min(5, n - hits.length, MAX_TRIED - tried));
    tried += batch.length;
    const found = await Promise.all(batch.map((c) => opts.search(c.name).catch(() => [])));
    batch.forEach((c, k) => {
      if (hits.length >= n) return;
      const hit = matchHit(c, found[k]);
      if (hit) hits.push({ ...hit, wanted: { price: c.price, change: c.change, pct: c.pct, setCode: c.setCode, rank: hits.length + 1 } });
      else missed.push(c.name);
    });
  }
  return { source: MOVERS_URL, pages, asOf: new Date().toISOString(), tried, picked: front.slice(0, n).map((c) => ({ name: c.name, setCode: c.setCode, price: c.price, change: c.change, pct: c.pct })), missed: missed.slice(0, 60), count: hits.length, hits };
}

// Cached wrapper for the route: memo (this isolate) -> Durable Object KV ->
// build. A build failure answers with the last good list when there is one.
export async function wantedCards(env, opts) {
  if (memo.value && Date.now() - memo.at < 3600 * 1000) return memo.value;
  const cached = await kvGet(env, KV_KEY);
  if (cached) {
    try { const v = JSON.parse(cached); if (v && v.count > 0) { memo.at = Date.now(); memo.value = v; return v; } } catch { /* rebuild */ }
  }
  try {
    const v = await buildWanted(opts);
    // An empty list is never remembered (2026-09-22: the first live build
    // parsed ten movers and matched none, and a 12 h cache of that would
    // have hidden the fix): only a list with cards is cached.
    if (v.count > 0) {
      await kvPut(env, KV_KEY, JSON.stringify(v), TTL_MS);
      memo.at = Date.now(); memo.value = v;
    }
    return v;
  } catch (e) {
    return { source: MOVERS_URL, asOf: null, error: String((e && e.message) || e).slice(0, 200), count: 0, hits: [] };
  }
}
