/* ---------------- Sealed product auto-pricing ----------------
   Owner (2026-09-15): "a system where we could auto-price the sealed product
   we list using price charting, tcgplayer and ebay sold items as a price
   point instead of calling to check ... a floor price it doesn't go below,
   a percentage markup on top, pricing to the nearest normal looking number
   ($223.76 should show $229.95), a setting per item, and only the items we
   add to it - the others don't auto price."

   Opt-in: the product tag `auto-price` (bulk-editable in Shopify). Nothing
   without the tag is ever read, suggested or written. Per-item settings are
   `exor.*` product metafields (definitions created 2026-09-15, pinned on
   the product page):
     ap_floor    CAD; the price never goes below it. Blank = cost + minimum margin.
     ap_markup   percent on top of the CAD market price. Blank = global default.
     ap_round    auto | 1 | 5 | 10 | 25 | none - the "normal looking number"
                 grid; every result ends in .95 and is rounded UP.
     ap_suggest  JSON the job writes back: sources, FX, target, what it did.
     ap_tcg_id / ap_pc_id  matched source ids; set by hand to fix a match.

   Sources (all read from the worker, nothing scraped):
     TCGplayer   via tcgcsv.com, the public daily mirror of TCGplayer's own
                 catalogue and prices (refreshes ~20:00 UTC): per group,
                 products carry a UPC in extendedData, prices carry
                 marketPrice / lowPrice / midPrice. The store's sealed
                 variants carry the same UPC as their barcode, so matching is
                 exact. Free.
     PriceCharting  /api/product?upc= (then ?id=) with the subscription
                 token PRICECHARTING_TOKEN: "new-price" in USD cents. Their
                 numbers are built from eBay sold listings, which is the
                 eBay leg the owner asked for. Optional: without the token
                 the job runs on TCGplayer alone. 1 request per second.
     FX          Bank of Canada Valet FXUSDCAD, the daily noon rate.

   Price rule, per product:
     market   = TCGplayer market and PriceCharting new price, averaged when
                both answer (USD)
     target   = market x FX x (1 + markup%)
     floor    = max(ap_floor, cost x (1 + minimum margin%))
     nice     = round UP to the grid ending .95 (auto: $1 under $50, $5 to
                $200, $10 to $1000, $50 to $5000, $100 above)
     guard    = at most maxMove% away from today's price per run (a bad
                source day cannot halve a price), never below floor
   Modes: SHADOW (default) writes only ap_suggest and the report; APPLY also
   sets the variant price (productVariantsBulkUpdate). Both are switches on
   the /autoprice page. Multi-variant products are reported but never
   written in v1 (one price per product only).

   Own Durable Object instance (AUTOPRICE_DO), nightly alarm at 22:30 UTC
   (19:30 Atlantic, after the TCGCSV refresh), the enrich/hold shape: a run
   is a state machine persisted every tick so a slow source never holds a
   DO event past its budget. Storage:
     ap:config     mode + global numbers
     ap:fx         {date, rate}
     ap:run        the current/last run
     ap:report     rows of the last run; ap:runs the last 30 summaries */

import { adminGql, throttleWait } from "./price-history.js";

export const AUTOPRICE_DO = "autoprice";
export const TAG = "auto-price";
export const RUN_HOUR_UTC = 22;
export const RUN_MIN_UTC = 30;
export const TICK_MS = 18000;
export const PC_GAP_MS = 1100;
/* tcgcsv.com answers 401 to Cloudflare Workers (measured 2026-09-15, run 1:
   "tcgcsv groups 3: HTTP 401" while a GitHub runner gets 200), the same
   egress block AniList applies. So, as with the AniList series file, a
   nightly Action (.github/workflows/autoprice-tcg.yml, 21:10 UTC after the
   20:00 tcgcsv refresh) reads every group of every category the store sells,
   keeps the sealed-looking products with their UPC and prices, and commits
   data/autoprice/tcg-<category>.json to main; the worker reads those back. */
export const TCG_DATA = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/autoprice/";
export const BOC = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1";
export const PC = "https://www.pricecharting.com/api/product";

// Owner 2026-09-15: the markup is ON TOP of the source price ($2,404.38 CAD
// market + 15% = $2,765.04 -> $2,799.95); the per-run cap is a separate,
// optional brake and is OFF unless set (it read as the markup on the page).
export const DEFAULT_CONFIG = { mode: "shadow", markupPct: 15, minMarginPct: 10, maxMovePct: 0, compMode: "cap", compPct: 0, alertPct: 10 };
export const PAGE_URL = "https://exor-binder.nevski.workers.dev/autoprice";
/* Canadian reference price (owner 2026-09-15: "401 sells for $199.99 and has
   lots in stock, possible to check against 401 to also help price"). 401
   Games is a Shopify store (401games.myshopify.com, served at
   store.401games.ca; 401games.ca itself redirects every path to the home
   page), so its public predictive search and product JSON answer like the
   sister Exor stores do: /search/suggest.json for candidates, then
   /products/<handle>.js for price, availability and barcode. A candidate
   counts only when its title tokens equal ours (their "MTG - EDGE OF
   ETERNITIES - PLAY BOOSTER BOX" = our "MTG EDGE OF ETERNITIES PLAY BOOSTER
   BOX"), barcode agreement preferred. With compMode "cap" the target is held
   to at most compPct% above their IN-STOCK price; out of stock, it is shown
   but not used. With "follow" their in-stock price (+compPct%) IS the price
   and TCGplayer is bypassed; out of stock or not carried, the product goes
   back to TCGplayer pricing and the row (and the page top) carry an alert.
   Page-level or per product (ap_comp). */
export const COMP = { key: "401", name: "401 Games", base: "https://store.401games.ca" };

// Store product type -> TCGplayer category (tcgcsv.com/tcgplayer/categories, 2026-09-15).
export const CATEGORIES = [
  [/pok[eé]mon/i, 3], [/magic|\bmtg\b/i, 1], [/yu-?gi-?oh/i, 2], [/lorcana/i, 71],
  [/one piece/i, 68], [/star wars/i, 79], [/flesh and blood|flesh & blood/i, 62],
  [/digimon/i, 63], [/fusion world/i, 80], [/\bdbs\b|dragon ball/i, 27], [/final fantasy/i, 24],
  [/grand archive/i, 74], [/gundam/i, 86], [/union arena/i, 81], [/riftbound/i, 89],
  [/battle spirits/i, 72], [/metazoo/i, 66], [/neopets/i, 84], [/rush of ikorr/i, 94],
  [/cyberpunk/i, 92], [/kayou|naruto/i, 93], [/weiss/i, 20], [/cardfight/i, 16],
  [/sorcery/i, 77], [/shadowverse/i, 73], [/hololive/i, 87],
];
export function categoryOf(productType) {
  const t = String(productType || "");
  for (const [re, id] of CATEGORIES) if (re.test(t)) return id;
  return null;
}

// "Pokemon Sealed Product" -> "Pokemon": the group the report sorts and filters by.
export function gameOf(productType) {
  const t = String(productType || "").replace(/\s*(sealed product|sealed|singles?|single graded)\s*$/i, "").trim();
  return t || "Other";
}

// Only sealed-looking TCGplayer products are indexed (singles are 95% of a group).
export const SEALED_RE = /booster|\bbox\b|\bpack\b|bundle|\btin\b|collection|display|\bcase\b|\bkit\b|\bdeck\b|blister|elite trainer|starter|pre-?release|premium|\bset\b|lot\b|league|battle/i;

export const round2 = (n) => Math.round(n * 100) / 100;
const money2 = (n) => "$" + Number(n).toFixed(2);

// Our margin at a selling price: profit in dollars and as a share of the
// price (the retail convention), from the variant's unit cost. Null when
// either number is missing, so the page can say "no cost" instead of 100%.
export function margin(price, cost) {
  if (!(price > 0) || !(cost > 0)) return null;
  const amount = round2(price - cost);
  return { amount, pct: Math.round((amount / price) * 1000) / 10 };
}

// The grid the owner described: everything ends in .95, rounded UP.
export function autoStep(x) { return x < 50 ? 1 : x < 200 ? 5 : x < 1000 ? 10 : x < 5000 ? 50 : 100; }
export function niceUp(x, mode) {
  if (!(x > 0)) return null;
  const m = String(mode == null ? "auto" : mode).trim().toLowerCase();
  if (m === "none" || m === "0") return round2(x);
  const step = m === "auto" || m === "" ? autoStep(x) : Number(m);
  if (!(step > 0)) return round2(x);
  let k = Math.ceil((x + 0.05 - 1e-9) / step);
  let p = k * step - 0.05;
  if (p < x - 1e-9) p += step;
  return round2(p);
}

export function normUpc(s) {
  const d = String(s || "").replace(/\D/g, "");
  if (!d) return "";
  // TCGplayer stores 12/13-digit codes with and without a leading zero; keep the 12-digit core
  return d.length === 13 && d[0] === "0" ? d.slice(1) : d.length === 14 ? d.slice(2) : d;
}

/* Fallback match by NAME (owner 2026-09-15: "the ones with no pricing
   sources, is it possible to find a fallback"). TCGplayer's rows carry the
   group (set) name and a product name shaped "Set - Kind" (Magic) or "Set
   Kind" (Pokemon); "Display" is their word for a box. The store's title is
   "MTG WILDS OF ELDRAINE COLLECTOR BOOSTER BOX". A row matches when every
   set token is in the title and the KIND tokens are exactly the title's
   remaining tokens (so "Sleeved Play Booster Pack" never stands in for
   "Play Booster Pack", nor "Collector Booster Display (Japanese)" for the
   English box, nor a "... Case" for a box). Used when the UPC finds nothing,
   when it finds a Case for a non-case title (TCGplayer lists the Wilds of
   Eldraine box UPC on the Master Case row), or when the UPC row has no
   price and the name row has one. */
// 401 Games writes "MTG - Universes Beyond: Marvel's Spider-Man - English
// Collector Booster Box": the brand words and "English" are noise, "Japanese"
// is not (it names a different product).
// Pokemon series prefixes ("SV: Prismatic Evolutions", "XY: Evolutions",
// our "POKEMON XY EVOLUTIONS ...") name nothing on their own.
const FILLER = new Set(["mtg", "magic", "the", "gathering", "pokemon", "tcg", "ccg", "yugioh", "yu", "gi", "oh", "of", "and", "a", "an", "edition", "english", "en", "limit", "1", "per", "customer", "sealed", "product", "new", "universes", "beyond", "marvel", "marvels", "s", "sv", "swsh", "sm", "xy", "bw", "dp", "hgss"]);
const SYN = { display: "box", displays: "box", boxes: "box", packs: "pack", decks: "deck", bundles: "bundle", kit: "pack", kits: "pack", "pre": "prerelease", "release": "" };
export function tok(sx) {
  // "SV8.5" is one set code, not "sv8" and a stray "5" (2026-09-15: that
  // stray token broke both the TCGplayer name match and the 401 match).
  const out = String(sx || "").toLowerCase().replace(/\((?:limit|pre-?order|in ?stock|coming soon)[^)]*\)/g, " ").replace(/(\d)\.(\d)/g, "$1$2").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean)
    .flatMap((t) => (t === "etb" ? ["elite", "trainer"] : [t])).map((t) => (t in SYN ? SYN[t] : t)).filter((t) => t && !FILLER.has(t));
  // "Elite Trainer" is the box (our titles), TCGplayer and 401 say "Elite
  // Trainer Box", others "ETB": one spelling for all three (2026-09-15).
  for (let i = 2; i < out.length; i++) if (out[i] === "box" && out[i - 1] === "trainer" && out[i - 2] === "elite") { out.splice(i, 1); i--; }
  return out;
}
const isCode = (t) => /^[a-z]{1,4}\d{1,3}[a-z]?$/.test(t);   // ME04, SV10, OP09 ...
export function setTokens(setName) { return tok(setName).filter((t) => !isCode(t)); }
export function kindTokens(name, setName) {
  const st = new Set(setTokens(setName));
  return tok(name).filter((t) => !st.has(t));
}
const sameSet = (a, b) => a.length === b.length && a.every((t) => b.includes(t));
export function nameMatch(title, rows) {
  const tt = tok(title).filter((t) => !isCode(t));   // "POKEMON ME04 CHAOS RISING ..." - the set code is not a kind word
  if (!tt.length) return null;
  let best = null;
  for (const row of rows) {
    const st = setTokens(row.set);
    if (!st.length || !st.every((t) => tt.includes(t))) continue;
    const titleKind = [...new Set(tt.filter((t) => !st.includes(t)))];
    const kind = [...new Set(kindTokens(row.name, row.set))];
    if (!kind.length || !sameSet(kind, titleKind)) continue;
    const score = (row.market > 0 ? 2 : (row.mid > 0 || row.low > 0) ? 1 : 0) + st.length / 100;
    if (!best || score > best.score) best = { row, score };
  }
  return best ? best.row : null;
}
export const isCaseRow = (row) => /\bcase\b/i.test(row && row.name || "");
// Lookups for one category's rows. TCGplayer puts a product's UPC on its
// Case row too (165 shared UPCs in the Pokemon file, 2026-09-15: the
// Prismatic Evolutions Super-Premium Collection and its Case), so a
// non-case row always wins the UPC slot.
export function indexRows(rows) {
  const byUpc = {}, byId = {};
  for (const row of rows) {
    byId[row.id] = row;
    const u = normUpc(row.upc);
    if (u && (!byUpc[u] || (isCaseRow(byUpc[u]) && !isCaseRow(row)))) byUpc[u] = row;
  }
  return { byUpc, byId };
}
// A row's usable USD price: market first, then TCGplayer's mid, then low.
export function rowPrice(row) {
  if (!row) return null;
  if (row.market > 0) return { usd: row.market, kind: "market" };
  if (row.mid > 0) return { usd: row.mid, kind: "mid" };
  if (row.low > 0) return { usd: row.low, kind: "low" };
  return null;
}

// One product's decision. Pure, so it is unit-tested; every number in CAD
// unless named USD. Returns {action, reason, target, suggested, ...}.
export function decide(p, cfg, fx) {
  const cost = p.cost > 0 ? p.cost : null;
  const current = p.price > 0 ? p.price : null;
  const markup = Number.isFinite(p.markupPct) ? p.markupPct : cfg.markupPct;
  const srcs = [];
  if (p.tcgMarket > 0) srcs.push({ name: "tcgplayer", usd: p.tcgMarket, kind: p.tcgKind || "market" });
  if (p.pcNew > 0) srcs.push({ name: "pricecharting", usd: p.pcNew });
  const mode = p.compMode || cfg.compMode;
  const compPct = Number(cfg.compPct) || 0;
  const comp = p.comp && p.comp.price > 0 ? { price: p.comp.price, available: !!p.comp.available, handle: p.comp.handle || null, title: p.comp.title || null, used: false } : null;
  // "follow": 401 Games' in-stock price (+compPct%) IS the price and
  // TCGplayer is bypassed. Out of stock or not carried there, the product
  // falls back to the market path below and the row carries an alert
  // (owner, 2026-09-15: "if it is out of stock at 401, it should alert us
  // and default back to tcgplayer pricing").
  const follow = mode === "follow";
  const followOk = follow && !!comp && comp.available;
  const alert = follow && !followOk ? (comp ? COMP.name + " is out of stock: priced from TCGplayer instead" : COMP.name + " does not list it: priced from TCGplayer instead") : null;
  const out = { current, cost, fx, markupPct: markup, sources: srcs, round: p.round || "auto", marginNow: margin(current, cost), comp, alert, priceFrom: followOk ? COMP.key : "market" };
  let floor = p.floor > 0 ? p.floor : 0;
  const costFloor = cost ? round2(cost * (1 + cfg.minMarginPct / 100)) : 0;
  const floorSrc = floor > 0 && floor >= costFloor ? "ap_floor" : costFloor > 0 ? "cost+margin" : floor > 0 ? "ap_floor" : "none";
  floor = Math.max(floor, costFloor);
  let marketUsd = null, marketCad = null, raw, target;
  if (followOk) {
    raw = comp.price * (1 + compPct / 100);
    comp.used = true;
    target = Math.max(raw, floor);
    if (fx && srcs.length) { marketUsd = srcs.reduce((a, s) => a + s.usd, 0) / srcs.length; marketCad = marketUsd * fx; }   // shown, not used
  } else {
    const skip = (reason) => ({ ...out, action: "skip", reason: alert ? alert.replace(/: priced from TCGplayer instead$/, "") + ", and " + reason : reason });
    if (!fx) return skip("no FX rate");
    if (!srcs.length) return skip(p.tcgId || p.pcId ? "no price from the sources today" : "no match: set exor.ap_tcg_id (or ap_pc_id) on the product");
    marketUsd = srcs.reduce((a, s) => a + s.usd, 0) / srcs.length;
    marketCad = marketUsd * fx;
    raw = marketCad * (1 + markup / 100);
    target = Math.max(raw, floor);
    if (mode === "cap" && comp && comp.available) {
      const cap = comp.price * (1 + compPct / 100);
      if (target > cap) { target = Math.max(cap, floor); comp.used = target < raw || Math.abs(target - cap) < 0.005; }
    }
  }
  let capped = null;
  if (current && cfg.maxMovePct > 0) {
    const lo = current * (1 - cfg.maxMovePct / 100), hi = current * (1 + cfg.maxMovePct / 100);
    if (target > hi) { capped = "up"; target = hi; }
    else if (target < lo) { capped = "down"; target = Math.max(lo, floor); }
  }
  let suggested = niceUp(target, p.round);
  if (floor > 0 && suggested < floor) suggested = niceUp(floor, p.round);
  const action = !current ? "set" : suggested > current ? "raise" : suggested < current ? "lower" : "hold";
  const compNote = comp ? COMP.name + (followOk ? " at " : " has it at ") + money2(comp.price) + " in stock" + (compPct ? " (+" + compPct + "%)" : "") : "";
  return {
    ...out, marketUsd: marketUsd == null ? null : round2(marketUsd), marketCad: marketCad == null ? null : round2(marketCad), raw: round2(raw), compPct,
    floor: round2(floor), floorSrc, capped, target: round2(target), suggested, action, marginSuggested: margin(suggested, cost),
    reason: action === "hold" ? "already at the suggested price" : capped ? "capped at " + cfg.maxMovePct + "% per run" : target === floor && raw < floor ? "floor" + (followOk ? " (" + COMP.name + " is lower)" : "") : followOk ? "following " + compNote : comp && comp.used ? compNote : "market",
  };
}

/* ---- run state machine ---- */

const msg = (e) => (e && e.message) || String(e);
const doJson = (obj, status) => Response.json(obj, { status: status || 200, headers: { "cache-control": "no-store" } });
async function bodyOf(request) { try { return await request.json(); } catch { return {}; } }

export function nextRunAt(now) {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC, RUN_MIN_UTC, 0);
  return t > now + 60e3 ? t : t + 86400e3;
}

export async function configOf(cx) {
  const c = (await cx.storage.get("ap:config")) || {};
  return { ...DEFAULT_CONFIG, ...c };
}

async function arm(cx, at, why) {
  try { await cx.storage.setAlarm(at); } catch (e) { cx.log("autoprice: arm failed (" + why + "): " + msg(e)); }
}

export async function armAlarm(cx) {
  try { if ((await cx.storage.getAlarm()) == null) await cx.storage.setAlarm(nextRunAt(cx.now())); }
  catch (e) { cx.log("autoprice: armAlarm failed: " + msg(e)); }
}

export async function autopriceDoAlarm(cx) {
  try { await tick(cx); }
  catch (e) {
    cx.log("autoprice: tick threw: " + msg(e));
    const run = await cx.storage.get("ap:run");
    if (run && !run.done) { run.error = msg(e); run.done = true; run.finishedAt = cx.now(); try { await notifyRun(cx, run, await configOf(cx)); } catch {} await cx.storage.put("ap:run", run); await noteRun(cx, run); }
    await arm(cx, nextRunAt(cx.now()), "tick threw");
  }
}

export async function kickRun(cx, opts) {
  const run = await cx.storage.get("ap:run");
  if (run && !run.done && cx.now() - (run.tickAt || 0) < 120e3) {
    // A run is going: queue one more right after it (a product added mid-run
    // is past the products phase, 2026-09-15: the Celebrations Pokemon Center
    // ETB was tagged one second into a run and never priced). Its own key -
    // the running tick holds a copy of ap:run and writes it back.
    await cx.storage.put("ap:again", { apply: !!(opts && opts.apply), at: cx.now() });
    return { ok: true, started: false, running: true, queued: true };
  }
  await cx.storage.put("ap:run", newRun(cx.now(), opts));
  await arm(cx, cx.now() + ((opts && opts.delayMs) || 100), "kick");
  return { ok: true, started: true };
}

function newRun(now, opts) {
  return { startedAt: now, tickAt: now, phase: "fx", done: false, ticks: 0, apply: !!(opts && opts.apply),
    products: [], cursor: null, pcCalls: 0, errors: [], written: 0, priced: 0, skipped: 0, index: null, tcgMeta: {} };
}

async function noteRun(cx, run) {
  const runs = (await cx.storage.get("ap:runs")) || [];
  runs.unshift({ startedAt: run.startedAt, finishedAt: run.finishedAt, apply: run.apply, nightly: !!run.nightly, products: run.products.length, priced: run.priced, written: run.written, skipped: run.skipped, errors: run.errors.slice(0, 5), error: run.error || null, fx: run.fx || null, notify: run.notify || null });
  await cx.storage.put("ap:runs", runs.slice(0, 30));
}

/* ---- ntfy digest (owner, 2026-09-15: "send a ntfy update each day showing
   the price changes and alerting if any are drastic changes of 10% or more")
   The worker secret AUTOPRICE_NTFY is a topic name (on ntfy.sh) or a full
   topic URL on any ntfy server; AUTOPRICE_NTFY_TOKEN (optional) is sent as
   a Bearer token. Every finished run sends one push: the nightly always,
   a manual or add-triggered run only when it changed or flagged something.
   Moves of alertPct% or more (page setting, default 10) go first, marked,
   and lift the push to high priority. */

export function pctMove(from, to) { return from > 0 && to > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null; }
const fmtMoney = (n) => "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildDigest(run, cfg, opts) {
  const o = opts || {};
  const rows = run.rows || [];
  const apply = !!run.apply;
  const alertPct = Number(cfg && cfg.alertPct) || 0;
  const changes = [];
  for (const r of rows) {
    if (r.applied && r.current > 0 && r.suggested > 0) changes.push({ title: r.title, from: r.current, to: r.suggested, pct: pctMove(r.current, r.suggested), by: "auto" });
    else if (r.applied && r.suggested > 0) changes.push({ title: r.title, from: null, to: r.suggested, pct: null, by: "auto" });
    else if (!apply && (r.action === "raise" || r.action === "lower" || r.action === "set") && r.suggested > 0) changes.push({ title: r.title, from: r.current || null, to: r.suggested, pct: pctMove(r.current, r.suggested), by: "shadow" });
    // a price someone changed by hand (or BinderPOS) since the last run
    if (r.lastChange && r.lastChange.by === "hand" && r.lastChange.at >= (run.startedAt || 0)) changes.push({ title: r.title, from: r.lastChange.from, to: r.lastChange.to, pct: pctMove(r.lastChange.from, r.lastChange.to), by: "hand" });
  }
  const drastic = changes.filter((c) => alertPct > 0 && c.pct != null && Math.abs(c.pct) >= alertPct);
  const alerts = rows.filter((r) => r.alert).map((r) => ({ title: r.title, alert: r.alert, action: r.action, reason: r.reason }));
  const line = (c) => (drastic.includes(c) ? "⚠ " : "") + (c.from == null ? "set " : c.to > c.from ? "↑ " : "↓ ") + (c.pct != null ? (c.pct > 0 ? "+" : "") + c.pct + "%  " : "") + c.title + ": " + (c.from == null ? "" : fmtMoney(c.from) + " → ") + fmtMoney(c.to) + (c.by === "hand" ? " (by hand)" : c.by === "shadow" ? " (not written: shadow)" : "");
  const ordered = [...drastic, ...changes.filter((c) => !drastic.includes(c))];
  const lines = [];
  const MAX = 30;
  for (const c of ordered.slice(0, MAX)) lines.push(line(c));
  if (ordered.length > MAX) lines.push("…and " + (ordered.length - MAX) + " more on the page");
  for (const a of alerts) lines.push("⚠ " + a.title + ": " + a.alert + (a.action === "skip" ? " (skipped: " + a.reason + ")" : ""));
  if (run.error) lines.push("✖ run failed: " + run.error);
  else if ((run.errors || []).length) lines.push("✖ " + run.errors.length + " error" + (run.errors.length === 1 ? "" : "s") + ": " + run.errors.slice(0, 2).join("; ").slice(0, 200));
  const n = changes.length;
  const title = (apply ? "Auto-pricing" : "Auto-pricing (shadow)") + ": " + (run.error ? "run failed" : n === 0 ? "no price changes" : n + " price change" + (n === 1 ? "" : "s")) + (drastic.length ? ", " + drastic.length + " of " + alertPct + "% or more" : "") + (alerts.length ? ", " + alerts.length + " 401 alert" + (alerts.length === 1 ? "" : "s") : "");
  const counts = rows.length + " listed · " + (run.priced || 0) + " priced · " + (run.written || 0) + " written · " + (run.skipped || 0) + " skipped" + (run.fx ? " · FX " + run.fx : "");
  const body = (lines.length ? lines.join("\n") + "\n" : "") + counts;
  const worth = n > 0 || drastic.length > 0 || alerts.length > 0 || !!run.error || (run.errors || []).length > 0;
  return { title, body: body.length > 3900 ? body.slice(0, 3880) + "…" : body, priority: drastic.length || run.error ? 4 : n ? 3 : 2, tags: drastic.length || run.error ? ["rotating_light"] : n ? ["moneybag"] : ["zzz"], click: o.click || PAGE_URL, changes, drastic, alerts, worth };
}

// Where to publish: "topic" -> ntfy.sh, or a full https://server/topic URL.
export function ntfyTarget(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) { const u = new URL(v); const topic = u.pathname.replace(/\/+$/, "").split("/").pop(); return topic ? { server: u.origin, topic } : null; }
  return { server: "https://ntfy.sh", topic: v.replace(/^\/+/, "") };
}

export async function sendNtfy(cx, msg) {
  const t = ntfyTarget(cx.env && cx.env.AUTOPRICE_NTFY);
  if (!t) return { ok: false, skipped: true, error: "AUTOPRICE_NTFY secret not set" };
  const headers = { "content-type": "application/json" };
  if (cx.env.AUTOPRICE_NTFY_TOKEN) headers.authorization = "Bearer " + String(cx.env.AUTOPRICE_NTFY_TOKEN).trim();
  const payload = { topic: t.topic, title: msg.title, message: msg.body, priority: msg.priority || 3, tags: msg.tags || [], click: msg.click || PAGE_URL };
  const r = await cx.fetch(t.server + "/", { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { ok: false, error: "ntfy HTTP " + r.status + " " + (await r.text().catch(() => "")).slice(0, 120) };
  return { ok: true, server: t.server };
}

/* The relay (2026-09-15): ntfy.sh limits free accounts by source IP even
   with a token ("basis": "ip" on /v1/account), and the worker publishes
   from Cloudflare's shared egress, which other tenants have already used
   up (HTTP 429 "daily message quota reached"). So every digest is stored
   as ap:digest first; the worker still tries to publish directly, and when
   that fails the digest stays pending for .github/workflows/ntfy-relay.yml
   (main, nightly 22:50 UTC + manual), which reads /autoprice/digest.json
   with the same AUTOPRICE_NTFY_TOKEN as its bearer, publishes from a
   GitHub runner and acks. A paid ntfy.sh plan makes the direct path work
   again with no change here. */
export async function publishDigest(cx, d, meta) {
  const digest = { at: cx.now(), ...(meta || {}), title: d.title, body: d.body, priority: d.priority, tags: d.tags, click: d.click, sent: false, sentBy: null, sentAt: null, lastError: null };
  await cx.storage.put("ap:digest", digest);
  let r;
  try { r = await sendNtfy(cx, d); } catch (e) { r = { ok: false, error: msg(e) }; }
  if (r.ok) { digest.sent = true; digest.sentBy = "worker"; digest.sentAt = cx.now(); }
  else if (r.skipped) { digest.sent = true; digest.sentBy = "nobody (ntfy off)"; digest.sentAt = cx.now(); }
  else digest.lastError = r.error;
  await cx.storage.put("ap:digest", digest);
  return { ok: !!r.ok, skipped: !!r.skipped, relay: !r.ok && !r.skipped, error: r.error || null };
}

export async function digestOp(cx, b) {
  const digest = (await cx.storage.get("ap:digest")) || null;
  const op = String((b && b.op) || "get");
  if (op === "sent" && digest && !digest.sent) {
    digest.sent = true; digest.sentBy = String((b && b.by) || "relay").slice(0, 40); digest.sentAt = cx.now();
    await cx.storage.put("ap:digest", digest);
    const runs = (await cx.storage.get("ap:runs")) || [];
    const hit = runs.find((r) => r.startedAt === digest.runStartedAt);
    if (hit) { hit.notify = "sent by " + digest.sentBy; await cx.storage.put("ap:runs", runs); }
    return { ok: true, digest };
  }
  return { ok: true, digest };
}

async function notifyRun(cx, run, cfg) {
  if (run.notify) return;
  const d = buildDigest(run, cfg);
  if (!run.nightly && !d.worth) { run.notify = "skipped (nothing to report)"; return; }
  try {
    const r = await publishDigest(cx, d, { runStartedAt: run.startedAt, kind: run.nightly ? "nightly" : "manual" });
    run.notify = r.ok ? "sent" : r.skipped ? "off" : "queued for the relay (" + r.error + ")";
  } catch (e) { run.notify = "failed: " + msg(e); run.errors.push("ntfy: " + msg(e)); }
}

async function tick(cx) {
  await armAlarm(cx);
  let run = await cx.storage.get("ap:run");
  const now = cx.now();
  // the nightly alarm starts a fresh run; a manual kick wrote its own first
  if (!run || run.done) { run = newRun(now, { apply: (await configOf(cx)).mode === "apply" }); run.nightly = true; }
  run.ticks++; run.tickAt = now;
  if (run.ticks === 1) {
    try {
      const marks = await cx.storage.list({ prefix: "ap:removed:" });
      const old = [...marks].filter(([, at]) => now - Number(at) > 3600e3).map(([k]) => k);
      if (old.length) await cx.storage.delete(old);
    } catch {}
  }
  const cfg = await configOf(cx);
  const deadline = now + TICK_MS;
  try {
    while (cx.now() < deadline && !run.done) {
      if (run.phase === "fx") await phaseFx(cx, run);
      else if (run.phase === "products") await phaseProducts(cx, run);
      else if (run.phase === "index") await phaseIndex(cx, run);
      else if (run.phase === "prices") await phasePrices(cx, run, deadline);
      else if (run.phase === "comp") await phaseComp(cx, run, cfg, deadline);
      else if (run.phase === "decide") await phaseDecide(cx, run, cfg, deadline);
      else if (run.phase === "write") await phaseWrite(cx, run, cfg, deadline);
      else { run.done = true; run.finishedAt = cx.now(); }
    }
  } finally {
    if (run.done) await notifyRun(cx, run, cfg);
    await cx.storage.put("ap:run", run);
  }
  if (run.done) {
    await noteRun(cx, run);
    cx.log("autoprice: run done " + JSON.stringify({ products: run.products.length, priced: run.priced, written: run.written, skipped: run.skipped, errors: run.errors.length, ticks: run.ticks }));
    const again = await cx.storage.get("ap:again");
    if (again) {
      await cx.storage.delete("ap:again");
      await cx.storage.put("ap:run", newRun(cx.now(), { apply: !!again.apply && cfg.mode === "apply" }));
      await arm(cx, cx.now() + 1500, "again");
    } else await arm(cx, nextRunAt(cx.now()), "done");
  } else {
    await arm(cx, cx.now() + 1500, "next tick");
  }
}

async function phaseFx(cx, run) {
  const cached = await cx.storage.get("ap:fx");
  const today = new Date(cx.now()).toISOString().slice(0, 10);
  if (cached && cached.fetched === today && cached.rate > 0) { run.fx = cached.rate; run.fxDate = cached.date; run.phase = "products"; return; }
  try {
    const r = await cx.fetch(BOC, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const obs = (j.observations || [])[0];
    const rate = obs && obs.FXUSDCAD && Number(obs.FXUSDCAD.v);
    if (!(rate > 0)) throw new Error("no observation");
    run.fx = rate; run.fxDate = obs.d;
    await cx.storage.put("ap:fx", { rate, date: obs.d, fetched: today });
  } catch (e) {
    run.errors.push("FX: " + msg(e));
    if (cached && cached.rate > 0) { run.fx = cached.rate; run.fxDate = cached.date + " (stale)"; }
  }
  run.phase = "products";
}

const PRODUCTS_Q = `query($after: String) { products(first: 50, after: $after, query: "tag:${TAG} status:active") { edges { node { id title handle productType tags
  variants(first: 10) { edges { node { id title price barcode sku inventoryQuantity inventoryItem { unitCost { amount } } } } }
  mf: metafields(first: 30, namespace: "exor") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;

const PRODUCT_BY_ID_Q = `query($id: ID!) { product(id: $id) { id title handle productType tags
  variants(first: 10) { edges { node { id title price barcode sku inventoryQuantity inventoryItem { unitCost { amount } } } } }
  mf: metafields(first: 30, namespace: "exor") { edges { node { key value } } } } }`;

export function readProduct(node) {
  const vs = ((node.variants && node.variants.edges) || []).map((e) => e.node);
  const mf = {};
  for (const e of (node.mf && node.mf.edges) || []) mf[e.node.key] = e.node.value;
  const v = vs[0] || {};
  const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; };
  const cost = v.inventoryItem && v.inventoryItem.unitCost ? num(v.inventoryItem.unitCost.amount) : null;
  return {
    id: node.id, title: node.title, handle: node.handle, type: node.productType,
    category: categoryOf(node.productType), variants: vs.length, variantId: v.id || null, variantTitle: v.title || "",
    price: num(v.price), cost, upc: normUpc(v.barcode || v.sku), stock: vs.reduce((a, x) => a + (Number(x.inventoryQuantity) || 0), 0),
    floor: num(mf.ap_floor), markupPct: num(mf.ap_markup), round: mf.ap_round || "auto",
    tcgId: num(mf.ap_tcg_id), pcId: num(mf.ap_pc_id), tcgIdMeta: num(mf.ap_tcg_id),
    compMode: /^(cap|off|skip|follow)$/.test(String(mf.ap_comp || "")) ? String(mf.ap_comp) : null,
  };
}

async function phaseProducts(cx, run) {
  const r = await adminGql(cx, PRODUCTS_Q, { after: run.cursor });
  const conn = r.data.products;
  for (const e of conn.edges) {
    // The tag SEARCH index lags tagsRemove by seconds to minutes (2026-09-15:
    // a run right after four removals still listed them and, in apply mode,
    // repriced one). The node's own tags are current, so they decide; a
    // product removed from the page in the last hour is skipped as well.
    if (!((e.node.tags || []).includes(TAG))) continue;
    if (await cx.storage.get("ap:removed:" + e.node.id)) continue;
    run.products.push(readProduct(e.node));
  }
  if (conn.pageInfo.hasNextPage) { run.cursor = conn.pageInfo.endCursor; await cx.sleep(throttleWait(r.cost, 60)); return; }
  run.cursor = null;
  // Products added from the page moments ago may not be in the tag search
  // index yet: the last report's pending rows are fetched by id.
  const rep = await cx.storage.get("ap:report");
  const have = new Set(run.products.map((p) => p.id));
  for (const row of (rep && rep.rows) || []) {
    if (row.action !== "pending" || have.has(row.id)) continue;
    try {
      const r2 = await adminGql(cx, PRODUCT_BY_ID_Q, { id: row.id });
      const n = r2.data.product;
      if (n && (n.tags || []).includes(TAG)) { run.products.push(readProduct(n)); have.add(n.id); }
    } catch (e) { run.errors.push("added product " + row.id + ": " + msg(e)); }
  }
  const cats = {};
  for (const p of run.products) if (p.category) cats[p.category] = 1;
  run.index = { cats: Object.keys(cats).map(Number), ci: 0 };
  run.phase = "index";
}

// One TCGplayer category per tick: read the committed sealed-product file,
// match this run's products of that category (metafield id first, then the
// variant's UPC), take their prices, and drop the rows - a run's state is
// persisted every tick and must stay small.
async function phaseIndex(cx, run) {
  const ix = run.index;
  if (ix.ci >= ix.cats.length) { run.phase = "prices"; return; }
  const cat = ix.cats[ix.ci++];
  let data = null;
  try {
    const r = await cx.fetch(TCG_DATA + "tcg-" + cat + ".json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (r.ok) data = await r.json();
    else run.errors.push("tcg data " + cat + ": HTTP " + r.status + (r.status === 404 ? " (autoprice-tcg.yml has not built this category yet)" : ""));
  } catch (e) { run.errors.push("tcg data " + cat + ": " + msg(e)); }
  const rows = (data && data.rows) || [];
  run.tcgMeta = run.tcgMeta || {};
  run.tcgMeta[cat] = { rows: rows.length, builtAt: (data && data.builtAt) || null };
  const { byUpc, byId } = indexRows(rows);
  for (const p of run.products) {
    if (p.category !== cat) continue;
    let row = null;
    if (p.tcgId) { row = byId[p.tcgId] || null; p.match = row ? "metafield" : "ap_tcg_id " + p.tcgId + " is not a sealed product in TCGplayer category " + cat; }
    else if (p.upc && byUpc[p.upc]) { row = byUpc[p.upc]; p.match = "upc"; }
    // Fallbacks: a Case row for a non-case title, a UPC row with no price at
    // all, or no UPC row - try the set + kind name match.
    const titleIsCase = /\bcase\b/i.test(p.title || "");
    if (!row || (isCaseRow(row) && !titleIsCase) || !rowPrice(row)) {
      const byName = nameMatch(p.title, rows);
      if (byName && (!row || rowPrice(byName))) {
        p.match = row ? "name (upc row was " + (isCaseRow(row) && !titleIsCase ? "a case" : "unpriced") + ": " + row.name + ")" : "name";
        row = byName;
      }
    }
    // Never price a single item from its Case row (2026-09-15: a Super-Premium
    // Collection went to $1,999.95 that way). No match beats a wrong one.
    if (row && isCaseRow(row) && !titleIsCase) {
      p.match = "TCGplayer only matched the case (" + row.name + ", " + row.id + "): set exor.ap_tcg_id to the single item's id";
      row = null;
    }
    if (row) {
      p.tcgId = row.id; p.tcgName = row.name; p.tcgGroup = row.g; p.tcgLow = row.low ?? null; p.tcgMid = row.mid ?? null;
      const pr = rowPrice(row);
      if (pr) { p.tcgMarket = pr.usd; p.tcgKind = pr.kind; }
    } else if (!p.match || p.match === "upc") {
      p.match = !data ? "TCGplayer data for category " + cat + " not available" : p.upc ? "upc " + p.upc + " not among TCGplayer's " + rows.length + " sealed products and no name match (data " + (data.builtAt || "?") + ")" : "no barcode and no name match";
    }
  }
}

// PriceCharting, one product per second, only with a token.
async function phasePrices(cx, run, deadline) {
  if (!run.pcQueue) {
    for (const p of run.products) if (!p.category) p.match = "no TCGplayer category for type " + p.type;
    run.pcQueue = run.products.filter((p) => p.upc || p.pcId).map((p) => p.id);
  }
  const token = cx.env && cx.env.PRICECHARTING_TOKEN;
  if (token) {
    while (run.pcQueue.length && cx.now() < deadline - PC_GAP_MS - 1500) {
      const id = run.pcQueue.shift();
      const p = run.products.find((x) => x.id === id);
      if (!p) continue;
      const q = p.pcId ? "id=" + p.pcId : "upc=" + encodeURIComponent(p.upc);
      try {
        const r = await cx.fetch(PC + "?t=" + encodeURIComponent(token) + "&" + q, { signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        run.pcCalls++;
        if (j && j.status === "success") {
          if (!p.pcId && j.id) p.pcIdFound = Number(j.id);
          const cents = Number(j["new-price"]);
          if (cents > 0) p.pcNew = cents / 100;
          p.pcName = [j["console-name"], j["product-name"]].filter(Boolean).join(" / ");
        } else p.pcMiss = (j && j["error-message"]) || "no product";
      } catch (e) { run.errors.push("pricecharting " + p.handle + ": " + msg(e)); }
      await cx.sleep(PC_GAP_MS);
    }
    if (run.pcQueue.length) return;
  } else run.pcQueue = [];
  run.phase = "comp";
}

// 401 Games lookup, one product at a time (two small requests each), the
// index persisted so a long list spans ticks. Failures are per product.
export function compQuery(title) { return tok(title).filter((t) => !isCode(t)).join(" "); }
// 401 Games spells the Pokemon series out ("Pokemon - Scarlet and Violet -
// Destined Rivals - Elite Trainer Box") where our titles carry the set code
// (SV10); the series pair names nothing on its own, so it goes on both sides.
const SERIES_PAIRS = [["scarlet", "violet"], ["sword", "shield"], ["sun", "moon"], ["mega", "evolution"], ["black", "white"], ["diamond", "pearl"], ["heartgold", "soulsilver"]];
export function stripSeries(tokens) {
  const out = [...tokens];
  for (let i = 0; i < out.length - 1; i++) if (SERIES_PAIRS.some(([a, b]) => out[i] === a && out[i + 1] === b)) { out.splice(i, 2); i--; }
  return out;
}
export function pickComp(title, ourUpc, results) {
  const want = [...new Set(stripSeries(tok(title).filter((t) => !isCode(t))))];
  let best = null;
  for (const r of results || []) {
    const got = [...new Set(stripSeries(tok(r.title).filter((t) => !isCode(t))))];
    if (!sameSet(want, got)) continue;
    const score = (r.available ? 2 : 0) + (ourUpc && (r.variants || []).some((v) => normUpc(v.barcode) === ourUpc) ? 4 : 0);
    if (!best || score > best.score) best = { r, score };
  }
  return best ? best.r : null;
}
async function phaseComp(cx, run, cfg, deadline) {
  if (run.compI == null) run.compI = 0;
  // Page-level "skip" still looks up the products whose own setting needs 401.
  if (cfg.compMode === "skip" && !run.products.some((p) => p.compMode && p.compMode !== "skip")) { run.phase = "decide"; return; }
  while (run.compI < run.products.length && cx.now() < deadline - 2500) {
    const p = run.products[run.compI++];
    if (p.compMode === "skip" || (cfg.compMode === "skip" && !p.compMode)) { p.compMiss = "skipped for this product"; continue; }
    const q = compQuery(p.title);
    if (!q) continue;
    try {
      const u = COMP.base + "/search/suggest.json?q=" + encodeURIComponent(q) + "&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=last";
      const r = await cx.fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) { p.compMiss = "HTTP " + r.status; continue; }
      const j = await r.json();
      const results = (((j.resources || {}).results || {}).products) || [];
      const hit = pickComp(p.title, p.upc, results);
      if (!hit) { p.compMiss = results.length ? "no title match among " + results.length + " (first: " + String((results[0] || {}).title || "").slice(0, 60) + ")" : "nothing found"; continue; }
      // The predictive-search row carries price and availability (their
      // /products/<handle>.js answers 403 to Workers, 2026-09-15).
      const v = (hit.variants || [])[0] || {};
      const rawPrice = v.price != null ? v.price : hit.price;   // suggest: "199.95" (dollars); product JSON would be cents
      const price = typeof rawPrice === "string" ? Number(rawPrice) : Number(rawPrice) / 100;
      p.comp = { price, available: !!(hit.available || v.available), handle: hit.handle, title: hit.title, barcode: v.barcode || null, at: cx.now() };
    } catch (e) { p.compMiss = msg(e); }
  }
  if (run.compI < run.products.length) return;
  run.phase = "decide";
}

async function phaseDecide(cx, run, cfg, deadline) {
  const rows = [];
  for (const p of run.products) {
    const d = decide(p, cfg, run.fx);
    if (p.variants > 1 && d.action !== "skip") { d.action = "review"; d.reason = p.variants + " variants: one price per product only, set by hand"; }
    if (p.match && !p.tcgId && d.action === "skip") d.reason = p.match;
    rows.push({ id: p.id, handle: p.handle, title: p.title, type: p.type, game: gameOf(p.type), stock: p.stock, variantId: p.variantId,
      tcgId: p.tcgId || null, tcgName: p.tcgName || null, tcgLow: p.tcgLow ?? null, tcgMid: p.tcgMid ?? null,
      pcId: p.pcId || p.pcIdFound || null, pcName: p.pcName || null, pcMiss: p.pcMiss || null, pcIdFound: p.pcIdFound || null, match: p.match, compMiss: p.compMiss || null,
      settings: { floor: p.floor, markupPct: p.markupPct, round: p.round === "auto" ? "" : p.round, comp: p.compMode || "", tcgId: p.tcgIdMeta, pcId: p.pcId }, ...d });
    if (d.action === "skip") run.skipped++; else run.priced++;
  }
  run.rows = rows;
  run.wi = 0;
  run.phase = "write";
}

const MF_SET = `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;
const PRICE_SET = `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { field message } } }`;

async function phaseWrite(cx, run, cfg, deadline) {
  const apply = run.apply && cfg.mode === "apply";
  const date = new Date(cx.now()).toISOString().slice(0, 10);
  while (run.wi < run.rows.length && cx.now() < deadline - 3000) {
    const batch = run.rows.slice(run.wi, run.wi + 10);
    const m = [];
    for (const row of batch) {
      // Last price change, whoever made it: the price seen at the previous
      // run vs today's (a hand edit in Shopify, or BinderPOS), and the one
      // this run applies. ap:last:<id> is what the report shows.
      const seen = await cx.storage.get("ap:seen:" + row.id);
      if (seen && row.current != null && Math.abs(Number(seen.price) - row.current) > 0.004) await recordChange(cx, row.id, { at: cx.now(), from: Number(seen.price), to: row.current, by: "hand" });
      const note = { at: date, mode: apply ? "apply" : "shadow", action: row.action, reason: row.reason, current: row.current, suggested: row.suggested ?? null,
        target: row.target ?? null, floor: row.floor ?? null, floorSrc: row.floorSrc, fx: run.fx, marketUsd: row.marketUsd ?? null,
        tcg: row.tcgId ? { id: row.tcgId, name: row.tcgName, match: row.match, market: (row.sources.find((s) => s.name === "tcgplayer") || {}).usd ?? null, priceKind: (row.sources.find((s) => s.name === "tcgplayer") || {}).kind ?? null, low: row.tcgLow, mid: row.tcgMid } : null,
        pricecharting: row.pcId ? { id: row.pcId, name: row.pcName, new: (row.sources.find((s) => s.name === "pricecharting") || {}).usd ?? null } : (row.pcMiss ? { miss: row.pcMiss } : null),
        comp401: row.comp ? { price: row.comp.price, available: row.comp.available, handle: row.comp.handle, used: row.comp.used } : (row.compMiss ? { miss: row.compMiss } : null),
        priceFrom: row.priceFrom || "market", alert: row.alert || null,
        applied: false };
      if (apply && (row.action === "raise" || row.action === "lower" || row.action === "set") && row.variantId && row.suggested > 0) {
        try {
          const r = await adminGql(cx, PRICE_SET, { pid: row.id, v: [{ id: row.variantId, price: row.suggested.toFixed(2) }] });
          const errs = (r.data.productVariantsBulkUpdate || {}).userErrors || [];
          if (errs.length) { row.writeError = errs.map((e) => e.message).join("; "); run.errors.push("price " + row.handle + ": " + row.writeError); }
          else { note.applied = true; row.applied = true; run.written++; await recordChange(cx, row.id, { at: cx.now(), from: row.current, to: row.suggested, by: "auto" }); }
        } catch (e) { row.writeError = msg(e); run.errors.push("price " + row.handle + ": " + msg(e)); }
      }
      await cx.storage.put("ap:seen:" + row.id, { price: row.applied ? row.suggested : row.current, at: cx.now() });
      row.lastChange = (await cx.storage.get("ap:last:" + row.id)) || null;
      m.push({ ownerId: row.id, namespace: "exor", key: "ap_suggest", type: "json", value: JSON.stringify(note) });
      if (row.pcIdFound && !row.pcId) m.push({ ownerId: row.id, namespace: "exor", key: "ap_pc_id", type: "number_integer", value: String(row.pcIdFound) });
      if (row.tcgId && row.match && row.match !== "metafield") m.push({ ownerId: row.id, namespace: "exor", key: "ap_tcg_id", type: "number_integer", value: String(row.tcgId) });
    }
    try {
      const r = await adminGql(cx, MF_SET, { m });
      const errs = (r.data.metafieldsSet || {}).userErrors || [];
      if (errs.length) run.errors.push("metafields: " + errs.map((e) => e.message).join("; ").slice(0, 200));
      await cx.sleep(throttleWait(r.cost, 30));
    } catch (e) { run.errors.push("metafields: " + msg(e)); }
    run.wi += batch.length;
  }
  if (run.wi < run.rows.length) return;
  // Rows added while this run was past its products phase stay "pending" in
  // the report until the queued follow-up run prices them.
  const prev = (await cx.storage.get("ap:report")) || {};
  const pending = (prev.rows || []).filter((r) => r.action === "pending" && !run.rows.some((x) => x.id === r.id));
  await cx.storage.put("ap:report", { at: cx.now(), fx: run.fx, fxDate: run.fxDate, apply, rows: [...run.rows.map((r) => ({ ...r, sources: r.sources })), ...pending] });
  run.done = true; run.finishedAt = cx.now();
  run.phase = "done";
}

async function recordChange(cx, id, change) {
  await cx.storage.put("ap:last:" + id, change);
  const hist = (await cx.storage.get("ap:hist:" + id)) || [];
  hist.unshift(change);
  await cx.storage.put("ap:hist:" + id, hist.slice(0, 20));
}

// Add-to-list search: a UPC (digits) matches the variant barcode/SKU; anything
// else is a free-text search over the sealed product types. Marks which
// results already carry the tag.
const SEARCH_Q = `query($q: String!) { products(first: 25, query: $q, sortKey: TITLE) { edges { node { id title handle productType tags totalInventory variants(first: 1) { edges { node { price barcode } } } } } } }`;
export function searchQueryFor(q) {
  const raw = String(q || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length === raw.length) {
    const core = normUpc(digits);
    return "status:active (barcode:" + core + " OR barcode:0" + core + " OR sku:" + core + " OR sku:0" + core + ")";
  }
  const words = raw.replace(/["*():]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return "status:active product_type:*Sealed* " + words;
}
async function search(cx, q) {
  if (!String(q || "").trim()) return { ok: true, q: "", results: [] };
  const r = await adminGql(cx, SEARCH_Q, { q: searchQueryFor(q) });
  const results = ((r.data.products || {}).edges || []).map((e) => {
    const n = e.node, v = ((n.variants || {}).edges || [])[0];
    return { id: n.id, title: n.title, handle: n.handle, type: n.productType, game: gameOf(n.productType), stock: n.totalInventory, price: v ? v.node.price : null, barcode: v ? v.node.barcode : null, listed: (n.tags || []).includes(TAG) };
  });
  return { ok: true, q, results };
}

// Per-item settings from the row form (owner 2026-09-15: "alterations to the
// auto pricing settings on the per-item line"): blank = clear the metafield
// (back to the page default), then the product is repriced at once.
const MF_DELETE = `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { field message } } }`;
const SETTING_FIELDS = [
  ["floor", "ap_floor", "number_decimal", (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : null)],
  ["markupPct", "ap_markup", "number_decimal", (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? String(Number(v)) : null)],
  ["round", "ap_round", "single_line_text_field", (v) => (/^(1|5|10|25|50|100|none)$/.test(String(v).trim()) ? String(v).trim() : null)],
  ["comp", "ap_comp", "single_line_text_field", (v) => (/^(cap|off|skip|follow)$/.test(String(v).trim()) ? String(v).trim() : null)],
  ["tcgId", "ap_tcg_id", "number_integer", (v) => (/^\d{3,9}$/.test(String(v).trim()) ? String(v).trim() : null)],
  ["pcId", "ap_pc_id", "number_integer", (v) => (/^\d{3,12}$/.test(String(v).trim()) ? String(v).trim() : null)],
];
async function saveSettings(cx, b) {
  const pid = String((b && b.id) || "");
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(pid)) return { ok: false, error: "bad product id" };
  const sets = [], dels = [], saved = {};
  for (const [field, key, type, norm] of SETTING_FIELDS) {
    if (!(field in b)) continue;
    const raw = String(b[field] == null ? "" : b[field]).trim();
    if (raw === "") { dels.push({ ownerId: pid, namespace: "exor", key }); saved[field] = ""; continue; }
    const v = norm(raw);
    if (v == null) return { ok: false, error: "bad value for " + field + ": " + raw.slice(0, 40) };
    sets.push({ ownerId: pid, namespace: "exor", key, type, value: v }); saved[field] = v;
  }
  if (sets.length) {
    const r = await adminGql(cx, MF_SET, { m: sets });
    const errs = (r.data.metafieldsSet || {}).userErrors || [];
    if (errs.length) return { ok: false, error: errs.map((e) => e.message).join("; ") };
  }
  if (dels.length) {
    try { await adminGql(cx, MF_DELETE, { m: dels }); } catch (e) { /* a metafield that never existed */ }
  }
  const rep = await cx.storage.get("ap:report");
  if (rep && rep.rows) {
    for (const row of rep.rows) if (row.id === pid) { row.settings = { ...(row.settings || {}), ...saved }; row.action = "pending"; row.reason = "settings saved: repricing now"; }
    await cx.storage.put("ap:report", rep);
  }
  const cfg = await configOf(cx);
  const kicked = await kickRun(cx, { apply: cfg.mode === "apply", delayMs: 1500 });
  return { ok: true, id: pid, saved, kicked };
}

const TAG_ADD = `mutation($id: ID!, $t: [String!]!) { tagsAdd(id: $id, tags: $t) { userErrors { message } } }`;
const TAG_REMOVE = `mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: $t) { userErrors { message } } }`;
async function setListed(cx, id, on, b) {
  const pid = String(id || "");
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(pid)) return { ok: false, error: "bad product id" };
  const r = await adminGql(cx, on ? TAG_ADD : TAG_REMOVE, { id: pid, t: [TAG] });
  const errs = ((r.data.tagsAdd || r.data.tagsRemove || {}).userErrors) || [];
  if (errs.length) return { ok: false, error: errs.map((e) => e.message).join("; ") };
  const rep = (await cx.storage.get("ap:report")) || { at: null, rows: [] };
  rep.rows = (rep.rows || []).filter((x) => x.id !== pid);
  if (on) await cx.storage.delete("ap:removed:" + pid);
  else await cx.storage.put("ap:removed:" + pid, cx.now());
  if (on) {
    // Show it in the list at once (owner 2026-09-15: "when I refresh it is
    // not in the list"), then price it now with a shadow run - the nightly
    // apply run, if that mode is on, writes the price later as usual.
    const price = Number(b && b.price);
    rep.rows.push({ id: pid, title: String((b && b.title) || pid), handle: String((b && b.handle) || ""), type: String((b && b.type) || ""), game: gameOf(b && b.type),
      stock: Number(b && b.stock) || 0, current: price > 0 ? price : null, sources: [], action: "pending", reason: "just added: pricing now, refresh in a moment" });
  }
  await cx.storage.put("ap:report", rep);
  let kicked = null;
  if (on) { const cfg = await configOf(cx); kicked = await kickRun(cx, { apply: cfg.mode === "apply", delayMs: 3000 }); }
  return { ok: true, id: pid, listed: !!on, kicked };
}

/* ---- DO routes ---- */

export async function statusOf(cx) {
  const [run, cfg, report, runs, fx] = await Promise.all([cx.storage.get("ap:run"), configOf(cx), cx.storage.get("ap:report"), cx.storage.get("ap:runs"), cx.storage.get("ap:fx")]);
  let alarmAt = null; try { alarmAt = await cx.storage.getAlarm(); } catch {}
  return { ok: true, mode: cfg.mode, config: cfg, tokenConfigured: !!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN), pricecharting: !!(cx.env && cx.env.PRICECHARTING_TOKEN), ntfy: !!ntfyTarget(cx.env && cx.env.AUTOPRICE_NTFY),
    fx, alarmAt, run: run ? { startedAt: run.startedAt, finishedAt: run.finishedAt || null, phase: run.phase, done: !!run.done, ticks: run.ticks, products: run.products.length, priced: run.priced, written: run.written, skipped: run.skipped, errors: run.errors.slice(-8), error: run.error || null, apply: run.apply } : null,
    lastReportAt: report ? report.at : null, runs: runs || [] };
}

async function control(cx, b) {
  const cfg = await configOf(cx);
  const action = String((b && b.action) || "");
  if (action === "mode") {
    const mode = b.mode === "apply" ? "apply" : "shadow";
    await cx.storage.put("ap:config", { ...cfg, mode });
    return { ok: true, mode };
  }
  if (action === "config") {
    const next = { ...cfg };
    for (const k of ["markupPct", "minMarginPct", "maxMovePct", "compPct", "alertPct"]) if (b[k] != null && b[k] !== "" && Number.isFinite(Number(b[k]))) next[k] = Math.max(0, Number(b[k]));
    if (b.compMode === "cap" || b.compMode === "off" || b.compMode === "skip" || b.compMode === "follow") next.compMode = b.compMode;
    await cx.storage.put("ap:config", next);
    return { ok: true, config: next };
  }
  if (action === "run") return kickRun(cx, { apply: cfg.mode === "apply" && b.apply === "1" });
  if (action === "settings") return saveSettings(cx, b);
  if (action === "add") return setListed(cx, b.id, true, b);
  if (action === "remove") return setListed(cx, b.id, false, b);
  if (action === "ntfy-test") {
    // The last finished run's digest, so the owner sees the real format.
    const [run, report] = await Promise.all([cx.storage.get("ap:run"), cx.storage.get("ap:report")]);
    const src = run && run.done && run.rows ? run : { ...(run || {}), rows: (report && report.rows) || [], apply: !!(report && report.apply) };
    const d = buildDigest({ ...src, nightly: true }, cfg);
    const r = await publishDigest(cx, { ...d, title: "Test · " + d.title }, { runStartedAt: null, kind: "test" });
    return { ...r, digest: { title: d.title, body: d.body, priority: d.priority } };
  }
  return { ok: false, error: "unknown action" };
}

export async function autopriceDoFetch(cx, request, url) {
  await armAlarm(cx);
  if (url.pathname === "/_ap/status") return doJson(await statusOf(cx));
  if (url.pathname === "/_ap/report") return doJson((await cx.storage.get("ap:report")) || { rows: [] });
  if (url.pathname === "/_ap/search") { try { return doJson(await search(cx, url.searchParams.get("q"))); } catch (e) { return doJson({ ok: false, error: msg(e) }, 500); } }
  if (url.pathname === "/_ap/control" && request.method === "POST") return doJson(await control(cx, await bodyOf(request)));
  if (url.pathname === "/_ap/digest") return doJson(await digestOp(cx, request.method === "POST" ? await bodyOf(request) : null));
  if (url.pathname === "/_ap/auth" && request.method === "POST") return doJson(await authOp(cx, await bodyOf(request)));
  return doJson({ ok: false, error: "not found" }, 404);
}

/* ---- login: username + password, signed session cookie ----------------
   Owner 2026-09-15: "put this behind a better and more secure password and
   username". Credentials are worker secrets AUTOPRICE_USER and
   AUTOPRICE_PASSWORD (repo Actions secrets, synced by deploy.yml); until both
   exist the login accepts the showcase admin PIN as the password so the
   owner is never locked out (the page says so). A successful login sets an
   HttpOnly, Secure, SameSite=Lax cookie holding an HMAC-SHA256-signed
   {user, exp} good for 12 hours; the key is derived from the password and
   the Admin token, so changing the password ends every session. Eight
   failed attempts from one address lock it for 15 minutes (kept in the DO).
   Nothing about the credentials is logged or echoed. */
export const SESSION_COOKIE = "ap_s";
export const SESSION_TTL_S = 12 * 3600;
export const LOCK_AFTER = 8;
export const LOCK_MS = 15 * 60e3;
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (str) => { const t = String(str).replace(/-/g, "+").replace(/_/g, "/"); const pad = t + "=".repeat((4 - (t.length % 4)) % 4); return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0)); };
async function hmacKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("autoprice-session:" + String(secret || "")));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signSession(secret, payload) {
  const key = await hmacKey(secret);
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = b64u(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return body + "." + sig;
}
export async function verifySession(secret, token, now) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 < (now == null ? Date.now() : now)) return null;
    return payload;
  } catch { return null; }
}
// Constant-time string equality (both sides hashed first, so lengths never leak).
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(String(a))), crypto.subtle.digest("SHA-256", enc.encode(String(b)))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function sessionSecret(env) { return (env.AUTOPRICE_PASSWORD || "") + "|" + (env.SHOPIFY_ADMIN_TOKEN || "") + "|" + (env.AUTOPRICE_USER || ""); }
function cookieOf(request, name) {
  const m = ("; " + (request.headers.get("cookie") || "")).match(new RegExp("; " + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function ipOf(request) { return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown"; }
async function lockState(cx, ip) {
  const rec = (await cx.storage.get("ap:auth:" + ip)) || { fails: 0, at: 0 };
  if (rec.fails >= LOCK_AFTER && cx.now() - rec.at < LOCK_MS) return { locked: true, until: rec.at + LOCK_MS };
  if (cx.now() - rec.at > LOCK_MS) return { locked: false, fails: 0 };
  return { locked: false, fails: rec.fails };
}
async function authOp(cx, b) {
  const ip = String(b.ip || "unknown").slice(0, 64);
  const st = await lockState(cx, ip);
  if (b.op === "check") return st;
  if (b.op === "fail") { await cx.storage.put("ap:auth:" + ip, { fails: (st.fails || 0) + 1, at: cx.now() }); return { ok: true, fails: (st.fails || 0) + 1 }; }
  if (b.op === "clear") { await cx.storage.delete("ap:auth:" + ip); return { ok: true }; }
  return { ok: false };
}

/* ---- public routes (index.js) ---- */

export async function serveAutoprice(request, env, url, staffOk) {
  const stub = env.ROOM.get(env.ROOM.idFromName(AUTOPRICE_DO));
  const configured = !!(env.AUTOPRICE_USER && env.AUTOPRICE_PASSWORD);
  const secret = sessionSecret(env);
  const html = (body, status, extra) => new Response(body, { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(extra || {}) } });
  const cookie = (val, maxAge) => SESSION_COOKIE + "=" + encodeURIComponent(val) + "; Path=/autoprice; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Lax";

  if (url.pathname === "/autoprice/logout") return html("", 303, { location: "/autoprice/login", "set-cookie": cookie("", 0) });
  // The relay's door: bearer = AUTOPRICE_NTFY_TOKEN (a secret both the
  // worker and the GitHub workflow hold), never the login session.
  if (url.pathname === "/autoprice/digest.json") {
    const bearer = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const ok = !!env.AUTOPRICE_NTFY_TOKEN && !!bearer && (await safeEqual(bearer, String(env.AUTOPRICE_NTFY_TOKEN).trim()));
    if (!ok) return Response.json({ error: "relay token required" }, { status: 401, headers: { "cache-control": "no-store" } });
    const init = request.method === "POST" ? { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() } : {};
    const r = await stub.fetch(new Request(url.origin + "/_ap/digest", init));
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (url.pathname === "/autoprice/login") {
    if (request.method !== "POST") return html(renderLogin({ configured }));
    let fd; try { fd = await request.formData(); } catch { fd = null; }
    const user = String((fd && fd.get("u")) || "").trim().slice(0, 80), pass = String((fd && fd.get("p")) || "").slice(0, 200);
    const ip = ipOf(request);
    const auth = (op) => stub.fetch(new Request(url.origin + "/_ap/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ip }) })).then((r) => r.json()).catch(() => ({}));
    const st = await auth("check");
    if (st.locked) return html(renderLogin({ configured, error: "Too many attempts. Try again in " + Math.ceil((st.until - Date.now()) / 60000) + " minutes." }), 429);
    let ok = false;
    if (configured) ok = (await safeEqual(user, env.AUTOPRICE_USER)) && (await safeEqual(pass, env.AUTOPRICE_PASSWORD));
    else ok = !!pass && (await staffOk(env, url.origin, pass));   // fallback: the admin PIN, until the secrets exist
    if (!ok) { await auth("fail"); return html(renderLogin({ configured, error: "That did not open it." }), 403); }
    await auth("clear");
    const token = await signSession(secret, { u: configured ? user : "pin", exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S });
    return html("", 303, { location: "/autoprice", "set-cookie": cookie(token, SESSION_TTL_S) });
  }

  const session = await verifySession(secret, cookieOf(request, SESSION_COOKIE));
  if (!session) {
    if (url.pathname === "/autoprice" && request.method === "GET") return html("", 303, { location: "/autoprice/login" });
    return Response.json({ error: "login required" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (url.pathname === "/autoprice/status") {
    const r = await stub.fetch(new Request(url.origin + "/_ap/status"));
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  let body = null, form = false;
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (/json/i.test(ct)) body = await bodyOf(request);
    else { form = true; let fd; try { fd = await request.formData(); } catch { fd = null; } body = {}; if (fd) for (const [a, b] of fd.entries()) body[a] = String(b); }
  }
  if (url.pathname === "/autoprice/control" && request.method === "POST") {
    const r = await stub.fetch(new Request(url.origin + "/_ap/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const text = await r.text();
    const keepQ = body.q && body.action !== "add" && body.action !== "remove";
    let flash = "";
    if (body.action === "ntfy-test") { try { const j = JSON.parse(text); flash = j.ok ? "Test push sent: " + (j.digest && j.digest.title) : j.relay ? "Direct push refused (" + (j.error || "") + "). Queued for the relay: it goes out from GitHub on the nightly relay run, or now if you run the ntfy-relay workflow." : "Test push failed: " + (j.error || "unknown"); } catch { flash = "Test push: no answer"; } }
    const qs = [keepQ ? "q=" + encodeURIComponent(body.q) : "", body.game ? "game=" + encodeURIComponent(body.game) : "", flash ? "flash=" + encodeURIComponent(flash) : ""].filter(Boolean).join("&");
    if (form) return html("", 303, { location: "/autoprice" + (qs ? "?" + qs : "") });
    return new Response(text, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const q = (url.searchParams.get("q") || "").slice(0, 120), game = (url.searchParams.get("game") || "").slice(0, 60), flash = (url.searchParams.get("flash") || "").slice(0, 200);
  const [st, rep, sr] = await Promise.all([stub.fetch(new Request(url.origin + "/_ap/status")), stub.fetch(new Request(url.origin + "/_ap/report")), q ? stub.fetch(new Request(url.origin + "/_ap/search?q=" + encodeURIComponent(q))) : null]);
  const status = await st.json(), report = await rep.json(), found = sr ? await sr.json() : null;
  if (url.pathname.endsWith(".json")) return Response.json({ status, report }, { headers: { "cache-control": "no-store" } });
  return html(renderPage(status, report, { q, game, found, user: session.u, configured, flash }));
}

function renderLogin(o) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sealed auto-pricing</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.45 system-ui,sans-serif;color:#1d2327;background:#f4f6f7}form{background:#fff;border:1px solid #dde3e7;border-radius:14px;padding:26px 28px;width:min(380px,90vw);box-shadow:0 10px 30px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 6px}p{margin:0 0 14px;color:#6b7780;font-size:13.5px}label{display:block;font-size:12.5px;color:#6b7780;margin:10px 0 4px}input{width:100%;box-sizing:border-box;font-size:16px;padding:9px 12px;border:1.5px solid ${o.error ? "#d62c28" : "#c9d1d6"};border-radius:10px}button{margin-top:16px;width:100%;padding:11px;font-size:15px;font-weight:700;color:#fff;background:#d62c28;border:0;border-radius:10px;cursor:pointer}.err{color:#d62c28;font-weight:600}</style></head><body>
<form method="post" action="/autoprice/login" autocomplete="on"><h1>Sealed auto-pricing</h1><p>${o.error ? '<span class="err">' + esc(o.error) + "</span> " : ""}${o.configured ? "Sign in with the auto-pricing username and password." : "Username and password are not set up yet (add the AUTOPRICE_USER and AUTOPRICE_PASSWORD repo secrets). Until then: any username, and the showcase admin PIN as the password."}</p>
<label>Username</label><input name="u" type="text" autocomplete="username" autofocus>
<label>Password</label><input name="p" type="password" autocomplete="current-password">
<button>Sign in</button></form></body></html>`;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false }) : "";
const money = (n) => n == null ? "" : "$" + Number(n).toFixed(2);

export function renderPage(s, rep, view) {
  const cfg = s.config || DEFAULT_CONFIG;
  const v = view || {};
  const all = (rep.rows || []).map((r) => ({ ...r, game: r.game || gameOf(r.type) }));
  const games = [...new Set(all.map((r) => r.game))].sort((a, b) => a.localeCompare(b));
  const rows = all.filter((r) => !v.game || r.game === v.game).sort((a, b) => a.game.localeCompare(b.game) || (a.action === "skip") - (b.action === "skip") || String(a.title).localeCompare(String(b.title)));
  const counts = {};
  for (const r of rows) counts[r.action] = (counts[r.action] || 0) + 1;
  const alerted = rows.filter((r) => r.alert);
  const hidden = (n, val) => `<input type="hidden" name="${n}" value="${esc(val)}">`;
  const ctlForm = (action, extra, label, cls) => `<form method="post" action="/autoprice/control" class="inl">${hidden("action", action)}${v.game ? hidden("game", v.game) : ""}${v.q ? hidden("q", v.q) : ""}${extra}<button class="${cls || ""}">${label}</button></form>`;
  const change = (c) => c ? `<span title="${esc(when(c.at))}">${esc(when(c.at).slice(0, 16))}</span><div class="muted">${money(c.from)} → ${money(c.to)} · ${c.by === "auto" ? "auto" : "by hand"}</div>` : '<span class="muted">—</span>';
  const admin = (id) => "https://admin.shopify.com/store/most-wanted-ca/products/" + String(id || "").replace(/\D/g, "");
  // Owner: "add our margin to the line for each item based off its price and
  // suggested price" - profit and share of the price, under each of the two.
  const marginLine = (m, price) => m ? `<div class="muted mg${m.amount < 0 ? " neg" : ""}" title="price ${money(price)} − cost: ${money(m.amount)} profit, ${m.pct}% of the price">margin ${money(m.amount)} · ${m.pct}%</div>` : price != null ? '<div class="muted" title="No unit cost on the variant in Shopify">margin: no cost</div>' : "";
  const srcLine = (x) => x.name === "tcgplayer" ? "TCG " + (x.kind && x.kind !== "market" ? x.kind + " " : "") + money(x.usd) + " US" : "PriceCharting " + money(x.usd) + " US";
  // Settings, collapsed to one line that names only what differs from the
  // page default; click opens the form (owner: "a little hard to look at").
  const settingsBlock = (r) => {
    const st = r.settings || {};
    const sel = (name, cur, opts) => `<select name="${name}">${opts.map(([val, l]) => `<option value="${esc(val)}"${String(cur == null ? "" : cur) === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const custom = [];
    if (st.floor) custom.push("floor " + money(st.floor));
    if (st.markupPct != null && st.markupPct !== "") custom.push("markup " + st.markupPct + "%");
    if (st.round) custom.push("round " + (st.round === "none" ? "off" : "$" + st.round));
    if (st.comp) custom.push("401 " + ({ cap: "hold", off: "show only", skip: "skip", follow: "follow" }[st.comp] || st.comp));
    // the TCGplayer id is stored by every run, so it is not a "custom" setting here
    const summary = custom.length ? custom.join(" · ") : "page defaults";
    return `<details class="cfg"><summary title="Per-item settings: click to change">⚙ ${esc(summary)}</summary>
<form method="post" action="/autoprice/control" class="setf">${hidden("action", "settings")}${hidden("id", r.id)}${v.game ? hidden("game", v.game) : ""}
<label>Floor $<input type="number" step="0.01" min="0" name="floor" value="${esc(st.floor == null ? "" : st.floor)}" placeholder="cost+${esc(cfg.minMarginPct)}%"></label>
<label>Markup %<input type="number" step="0.5" min="0" name="markupPct" value="${esc(st.markupPct == null ? "" : st.markupPct)}" placeholder="${esc(cfg.markupPct)}"></label>
<label>Rounding ${sel("round", st.round, [["", "auto"], ["1", "$1 steps"], ["5", "$5 steps"], ["10", "$10 steps"], ["25", "$25 steps"], ["50", "$50 steps"], ["100", "$100 steps"], ["none", "none"]])}</label>
<label>401 Games ${sel("comp", st.comp, [["", "page setting"], ["follow", "follow their price" + (cfg.compPct ? " +" + cfg.compPct + "%" : "") + " (TCGplayer only if they are out)"], ["cap", "hold to at most " + (cfg.compPct || 0) + "% above"], ["off", "show only"], ["skip", "skip"]])}</label>
<label>TCGplayer id <input type="text" inputmode="numeric" name="tcgId" value="${esc(st.tcgId == null ? "" : st.tcgId)}" placeholder="auto" style="width:80px"></label>
${s.pricecharting ? `<label>PriceCharting id <input type="text" inputmode="numeric" name="pcId" value="${esc(st.pcId == null ? "" : st.pcId)}" placeholder="auto" style="width:90px"></label>` : ""}
<button class="sm">Save &amp; reprice</button><span class="muted">blank = page default</span></form></details>`;
  };
  const floorLine = (r) => `<div class="muted">${r.floor ? "floor " + money(r.floor) + " (" + esc(r.floorSrc) + ")" : ""}</div>`;
  const srcLines = (r) => (r.sources || []).map(srcLine).map(esc).join("<br>");
  // Following 401 Games: their price leads the cell and TCGplayer is shown
  // as not used; otherwise the market path as before.
  const mktCell = (r) => r.priceFrom === COMP.key && r.comp
    ? `<b>${esc(COMP.name)} ${money(r.comp.price)}</b>${r.compPct ? " +" + r.compPct + "% = " + money(r.raw) : ""}<div class="muted">followed · TCGplayer not used${(r.sources || []).length ? ": " + srcLines(r).replace(/<br>/g, ", ") + (r.marketCad != null ? " = " + money(r.marketCad) + " CAD" : "") : " (no match)"}</div>${floorLine(r)}`
    : (r.sources || []).length ? srcLines(r) + `<div class="muted">${r.marketCad != null ? "= " + money(r.marketCad) + " CAD" : ""}${r.markupPct && r.raw != null ? " · +" + r.markupPct + "% = " + money(r.raw) : ""}</div>${floorLine(r)}` : '<span class="muted">no source</span>';
  const row = (r) => `<tr class="a-${esc(r.action)}${r.alert ? " alerted" : ""}">
<td class="prod"><a class="ttl" href="${esc(admin(r.id))}" target="_blank" rel="noopener">${esc(r.title)}</a> <a class="muted" href="https://exorgames.com/products/${esc(r.handle)}" target="_blank" rel="noopener" title="storefront page">site ↗</a>
<div class="muted">stock ${r.stock}${r.tcgName ? " · matched: " + esc(r.tcgName) + (r.match && r.match !== "upc" && r.match !== "metafield" ? " (by " + esc(r.match.split(" (")[0]) + ")" : "") : ""}${r.pcName ? " · PC: " + esc(r.pcName) : ""}</div>${r.action === "pending" ? "" : settingsBlock(r)}</td>
<td class="num"><b>${money(r.current)}</b><div class="muted">cost ${r.cost != null ? money(r.cost) : "—"}</div>${marginLine(r.marginNow, r.current)}</td>
<td class="mkt">${mktCell(r)}</td>
<td class="num sug"><b>${money(r.suggested)}</b>${marginLine(r.marginSuggested, r.suggested)}</td>
<td><span class="pill">${esc(r.action)}${r.applied ? " ✓" : ""}</span>${r.alert ? `<div class="warn">⚠ ${esc(r.alert)}</div>` : ""}<div class="muted">${esc(r.reason)}${r.writeError ? " · write failed: " + esc(r.writeError) : ""}</div></td>
<td class="num">${r.comp ? `<a href="${esc(COMP.base + "/products/" + (r.comp.handle || ""))}" target="_blank" rel="noopener">${money(r.comp.price)}</a><div class="muted">${r.comp.available ? "in stock" : "out of stock"}${r.comp.used ? " · used" : ""}</div>` : `<span class="muted" title="${esc(r.compMiss || "")}">${r.compMiss ? (/^skipped/.test(r.compMiss) ? "skipped" : "not carried") : "—"}</span>`}</td>
<td>${change(r.lastChange)}</td>
<td>${ctlForm("remove", hidden("id", r.id), "×", "sm x")}</td></tr>`;
  let groupRows = "", lastGame = null;
  for (const r of rows) {
    if (r.game !== lastGame) { lastGame = r.game; groupRows += `<tr class="grp"><td colspan="8">${esc(r.game)} <span class="muted">· ${rows.filter((x) => x.game === r.game).length}</span></td></tr>`; }
    groupRows += row(r);
  }
  const run = s.run || {};
  const found = v.found;
  const foundRows = found && found.results ? found.results.map((f) => `<tr><td><a href="${esc(admin(f.id))}" target="_blank" rel="noopener">${esc(f.title)}</a><div class="muted">${esc(f.type)} · UPC ${esc(f.barcode || "none")} · stock ${f.stock}</div></td><td>${money(f.price)}</td><td>${f.listed ? '<span class="pill">in the list</span>' : ctlForm("add", hidden("id", f.id) + hidden("title", f.title) + hidden("handle", f.handle) + hidden("type", f.type) + hidden("price", f.price == null ? "" : f.price) + hidden("stock", f.stock == null ? "" : f.stock), "Add to auto-pricing", "add")}</td></tr>`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sealed auto-pricing</title>
<style>body{margin:0;padding:20px;font:14px/1.45 system-ui,sans-serif;color:#1d2327;background:#f4f6f7}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}.muted{color:#6b7780;font-size:12px}.tag{display:inline-block;padding:2px 8px;border-radius:99px;background:#fde68a;color:#5b4300;font-weight:600;font-size:12px;vertical-align:middle;margin-left:8px}.tag.apply{background:#fecaca;color:#7f1d1d}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde3e7;border-radius:10px;overflow:hidden;font-size:13px}th{text-align:left;padding:8px 10px;background:#eef2f4;font-weight:600}td{padding:7px 10px;border-top:1px solid #eef2f4;vertical-align:top}tr.grp td{background:#f8fafb;font-weight:700;font-size:13.5px;padding:9px 10px}.pill{display:inline-block;padding:1px 8px;border-radius:99px;background:#e5e7eb;font-weight:600;font-size:12px}tr.a-raise .pill{background:#dcfce7;color:#14532d}tr.a-lower .pill{background:#fee2e2;color:#7f1d1d}tr.a-skip .pill,tr.a-review .pill{background:#fef3c7;color:#78350f}tr.a-pending .pill{background:#dbeafe;color:#1e3a8a}table.rep{table-layout:fixed}table.rep th:nth-child(1){width:30%}table.rep th:nth-child(2),table.rep th:nth-child(4){width:8%}table.rep th:nth-child(3){width:16%}table.rep th:nth-child(5){width:14%}table.rep th:nth-child(6){width:9%}table.rep th:nth-child(7){width:11%}table.rep th:nth-child(8){width:4%}table.rep td{padding:9px 10px;line-height:1.35}table.rep tbody tr:nth-child(even):not(.grp) td{background:#fafbfc}td.num{white-space:nowrap}td.sug b{font-size:15px}.mg{margin-top:2px}.mg.neg{color:#b91c1c;font-weight:600}.warn{color:#b45309;font-weight:600;font-size:12px;margin-top:3px}tr.alerted td:first-child{box-shadow:inset 4px 0 #f59e0b}.alert{background:#fef3c7;border:1px solid #f59e0b;color:#78350f;border-radius:10px;padding:10px 14px;margin:8px 0 12px}.alert ul{margin:6px 0 0;padding-left:20px}.alert a{color:#78350f}.flash{background:#dcfce7;border:1px solid #16a34a;color:#14532d;border-radius:10px;padding:8px 12px;margin:8px 0;font-weight:600}td.prod .ttl{font-weight:600;color:#0d7a5f}td.prod .muted{margin-top:2px}details.cfg{margin-top:5px}details.cfg summary{cursor:pointer;font-size:12px;color:#6b7780;list-style:none}details.cfg summary::-webkit-details-marker{display:none}details.cfg summary:hover{color:#1d2327}details.cfg[open] summary{color:#1d2327;margin-bottom:6px}.setf{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12.5px;color:#4b5563;background:#f4f6f7;border-radius:8px;padding:8px 10px}.setf input[type=number]{width:80px}.setf select{font-size:12.5px}button.x{border:0;background:transparent;color:#9aa4ab;font-size:18px;line-height:1;cursor:pointer}button.x:hover{color:#d62c28}.mkt{font-size:12.5px}.ctl{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0 14px}.ctl form,.box{display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #dde3e7;border-radius:10px;padding:8px 10px}input[type=number]{width:70px}input[type=search]{flex:1;min-width:220px;padding:7px 10px;border:1px solid #c9d1d6;border-radius:8px;font-size:14px}a{color:#0d7a5f}.wrap{max-width:1360px;margin:0 auto}.inl{display:inline}button.sm{font-size:12px;padding:2px 8px}button.add{background:#0d7a5f;color:#fff;border:0;border-radius:8px;padding:5px 10px;font-weight:600;cursor:pointer}.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.chips a{display:inline-block;padding:3px 10px;border-radius:99px;background:#e5e7eb;color:#1d2327;text-decoration:none;font-size:12.5px;font-weight:600}.chips a.on{background:#1d2327;color:#fff}</style></head><body><div class="wrap">
<h1>Sealed auto-pricing <span class="tag${s.mode === "apply" ? " apply" : ""}">${s.mode === "apply" ? "APPLY · prices are written nightly" : "shadow · nothing is written to prices"}</span>${v.configured ? "" : '<span class="tag" style="background:#fee2e2;color:#7f1d1d">login not set up: add the AUTOPRICE_USER / AUTOPRICE_PASSWORD secrets</span>'}</h1>
<p class="muted">Only products in the list (the <b>auto-price</b> tag) are read. Per-product settings live on the product page under Metafields: Auto-price floor, markup %, rounding, and the matched TCGplayer / PriceCharting ids. Nightly at 19:30 Atlantic, after TCGplayer's data refreshes. FX ${s.fx ? esc(s.fx.rate) + " (Bank of Canada, " + esc(s.fx.date) + ")" : "not fetched yet"}. PriceCharting ${s.pricecharting ? "on" : "off (no PRICECHARTING_TOKEN secret; TCGplayer only)"}. ntfy digest ${s.ntfy ? "on: every nightly run pushes its price changes, moves of " + esc(cfg.alertPct) + "% or more first and at high priority; when ntfy.sh refuses the worker (free plan, shared IP) the GitHub relay sends it at 22:50 UTC" : "off (add the AUTOPRICE_NTFY repo secret: a topic name on ntfy.sh, or a full topic URL; AUTOPRICE_NTFY_TOKEN if the server needs one)"}.</p>
${v.flash ? `<p class="flash">${esc(v.flash)}</p>` : ""}
<h2>Add products</h2>
<form method="get" action="/autoprice" class="box">${v.game ? hidden("game", v.game) : ""}<input type="search" name="q" value="${esc(v.q || "")}" placeholder="UPC, or part of a product name (sealed products only)" autofocus><button>Search</button></form>
${found ? (found.ok ? `<table style="margin-top:8px"><thead><tr><th>Product</th><th>Price</th><th></th></tr></thead><tbody>${foundRows || '<tr><td colspan="3" class="muted">nothing matched "' + esc(found.q) + '"</td></tr>'}</tbody></table><p class="muted">Add starts a pricing run for the whole list straight away (in APPLY mode that writes the prices now, not at 7:30 pm); the new product shows in the report below within a few seconds.</p>` : `<p class="muted">search failed: ${esc(found.error)}</p>`) : ""}
<h2>Controls</h2>
<div class="ctl">
${ctlForm("run", s.mode === "apply" ? hidden("apply", "1") : "", "Run now (" + (s.mode === "apply" ? "writes prices" : "shadow") + ")")}
<form method="post" action="/autoprice/control" onsubmit="return this.mode.value!=='apply'||confirm('Switch to APPLY? Every nightly run will then change the price of every listed product within the guardrails.')">${hidden("action", "mode")}${hidden("mode", s.mode === "apply" ? "shadow" : "apply")}<button>${s.mode === "apply" ? "Back to shadow" : "Switch to APPLY"}</button></form>
<form method="post" action="/autoprice/control">${hidden("action", "config")}<label title="Added on top of the market price from TCGplayer / PriceCharting, after CAD conversion. A product's own Auto-price markup metafield overrides it.">Markup on top of market % <input type="number" step="0.5" name="markupPct" value="${esc(cfg.markupPct)}"></label><label title="The price never goes under cost plus this, unless the product's own floor is higher.">Min margin over cost % <input type="number" step="0.5" name="minMarginPct" value="${esc(cfg.minMarginPct)}"></label><label title="Optional brake: the most a price may move in one run. 0 = no limit.">Max move per run % (0 = off) <input type="number" step="1" name="maxMovePct" value="${esc(cfg.maxMovePct)}"></label><label title="Follow: 401 Games' in-stock price (plus this percent) is the price and TCGplayer is bypassed; when they are out of stock or do not list it, the product is priced from TCGplayer and flagged at the top of the report. Hold: the TCGplayer price is held to at most this percent above theirs (0 = match them). Off: shown but not used. Skip: not looked up.">401 Games <select name="compMode"><option value="follow"${cfg.compMode === "follow" ? " selected" : ""}>follow their price (TCGplayer only if they are out)</option><option value="cap"${cfg.compMode === "cap" ? " selected" : ""}>hold to at most</option><option value="off"${cfg.compMode === "off" ? " selected" : ""}>show only</option><option value="skip"${cfg.compMode === "skip" ? " selected" : ""}>skip</option></select> <input type="number" step="1" name="compPct" value="${esc(cfg.compPct == null ? 0 : cfg.compPct)}"> % above their in-stock price</label><label title="Price moves of at least this percent are flagged first in the ntfy digest and lift it to high priority. 0 = never flag.">Flag moves of <input type="number" step="1" name="alertPct" value="${esc(cfg.alertPct == null ? 10 : cfg.alertPct)}"> % or more</label><button>Save</button></form>
${s.ntfy ? ctlForm("ntfy-test", "", "Send test push") : ""}
<a href="/autoprice">refresh</a> · <a href="/autoprice/report.json">json</a> · <a href="/autoprice/logout">sign out${v.user && v.user !== "pin" ? " (" + esc(v.user) + ")" : ""}</a>
</div>
<p class="muted">Last run: ${run.startedAt ? esc(when(run.startedAt)) + " · " + (run.done ? "done" : "running, phase " + esc(run.phase)) + " · " + run.products + " listed, " + run.priced + " priced, " + run.written + " written, " + run.skipped + " skipped, " + (run.errors || []).length + " errors" : "never"}${run.error ? " · failed: " + esc(run.error) : ""}${(run.errors || []).length ? "<br>" + run.errors.map(esc).join("<br>") : ""}</p>
<h2>Report ${rep.at ? "· " + esc(when(rep.at)) : ""} <span class="muted">· ${Object.keys(counts).map((a) => a + " " + counts[a]).join(" · ") || "no rows yet: add products above and press Run now"}</span></h2>
${alerted.length ? `<div class="alert"><b>⚠ ${alerted.length} product${alerted.length === 1 ? "" : "s"} set to follow ${esc(COMP.name)} ${alerted.length === 1 ? "is" : "are"} priced from TCGplayer instead</b> (out of stock or not listed there):<ul>${alerted.map((r) => `<li><a href="${esc(admin(r.id))}" target="_blank" rel="noopener">${esc(r.title)}</a> · ${esc(r.alert)}${r.action === "skip" ? " · <b>skipped: " + esc(r.reason) + "</b>" : r.suggested != null ? " · now " + money(r.current) + " → " + money(r.suggested) : ""}</li>`).join("")}</ul></div>` : ""}
<div class="chips"><a href="/autoprice" class="${v.game ? "" : "on"}">All (${all.length})</a>${games.map((g) => `<a href="/autoprice?game=${encodeURIComponent(g)}" class="${v.game === g ? "on" : ""}">${esc(g)} (${all.filter((x) => x.game === g).length})</a>`).join("")}</div>
<table class="rep"><thead><tr><th>Product</th><th>Today</th><th>Market</th><th>Suggested</th><th>Action</th><th>401 Games</th><th>Last change</th><th></th></tr></thead><tbody>${groupRows || '<tr><td colspan="8" class="muted">nothing yet</td></tr>'}</tbody></table>
<h2>Runs</h2><table><thead><tr><th>Started</th><th>Mode</th><th>Listed</th><th>Priced</th><th>Written</th><th>Skipped</th><th>FX</th><th>ntfy</th><th>Errors</th></tr></thead><tbody>${(s.runs || []).map((r) => `<tr><td>${esc(when(r.startedAt))}${r.nightly ? "" : ' <span class="muted">manual</span>'}</td><td>${r.apply ? "apply" : "shadow"}</td><td>${r.products}</td><td>${r.priced}</td><td>${r.written}</td><td>${r.skipped}</td><td>${esc(r.fx || "")}</td><td class="muted">${esc(r.notify || "—")}</td><td class="muted">${esc((r.errors || []).join("; ") + (r.error ? " · " + r.error : ""))}</td></tr>`).join("") || '<tr><td colspan="9" class="muted">none</td></tr>'}</tbody></table>
</div></body></html>`;
}
