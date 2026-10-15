/* ---------------- Stock check: items to go look for, items to reorder ----
   Owner, 2026-10-14: "looks in our Shopify for items that was selling quickly
   but then stopped (but we still have quantity) ... to show maybe stolen, or
   not on floor for sale (on a overstock shelf perhaps) and alert us to go look
   ... with a front end showing products and ... a check box for 14 days before
   it alerts again"; "top sellers that were out of stock ... dismiss some
   because there's some products that come out that are only for a limited
   time ... staples like sleeves ... we can order most of the time"; "a
   completely standalone screen in 9pocket"; "when you dismiss something ...
   it should say, are you sure?"; "say an item was not found (with another are
   you sure) ... pointers to where to look (overstock, customer hold, online
   sales etc)"; no Discord, no email: "an admin screen showing these details".
   Scope: no singles, no graded slabs (product types naming Single/Singles/
   Graded are skipped), no event tickets.

   HOW IT RUNS. The worker cron (index.js scheduled(), every 5 minutes) calls
   stockCheckTick(env): it asks this module's Durable Object what to do next
   (/_sc/plan), does that one unit of Shopify Admin work in the worker (where
   waiting on Shopify's rate limit costs nothing), and posts the answer back
   (/_sc/ingest). A run has these phases, one unit at a time:
     orders   every order since the last run (first run: 60 days, the most a
              token without read_all_orders can see), 20 orders a page, each
              line's variant, quantity and product type -> a per-day ledger
              of units sold per in-scope variant (sc:l:<day>)
     types    the store's product types -> the in-scope list for this run
     scan     every in-scope variant with stock > 0 (per type, 120 a page)
              -> sc:v:<variantId> {title, type, vendor, qty, price, image...}
     compute  (inside the DO) the rules below -> candidates
     lookup   current stock states (available / committed / quality control /
              damaged) and status for every candidate, 100 a page
     open     for candidates with committed units and a SKU: the open orders
              holding them (order numbers only, never a customer)
     finalize (inside the DO) sc:res:look / sc:res:reorder / sc:res:meta
   A new run starts once a day after 09:00Z (05:00 Atlantic), on the first
   tick after a deploy when none ever ran, or when an admin presses Scan now.

   THE RULES (pure functions, tested offline):
     stalled():  the item is in stock, sold at a steady rate in the 30 (or
                 60, 90) days before its last sale, and has now gone this many
                 days without one that, at that rate, it should have sold 3+
                 units: the odds of that happening naturally are under 5%.
                 Preorders (title says PRE ORDER) and items restocked since
                 their last sale are left out. Ranked by expected sales x stock
                 x price (dollars at risk, weighted by evidence).
     reorder():  the item is at zero stock and sold 3+ units in the 60 days
                 before it ran out. Shows the sales missed so far at that
                 rate. Ranked by missed revenue, grouped by vendor.
   Both get a "whole category slowed" hint when the product type's own sales
   fell by 60%+ over the same gap (a release wave cooling, not a theft).

   STAFF STATES (sc:s:<variantId>, every one records who): go look: found_floor,
   found_overstock, reserved (hidden 14 days, then due again), fewer (a count;
   the difference is missing), damaged, not_found (-> Missing, admins close as
   adjusted / turned_up); reorder: ordered (hidden until stock arrives or 14
   days), snooze (until a date), cant_reorder and not_restocking (permanent,
   Dismissed tab, admins restore). Notes on anything. The screen never writes
   inventory; BinderPOS stays the only thing that does.

   Permissions (src/stage-auth.js SC_PERMS): sc_view opens the screen, sc_act
   marks items; admins do everything and alone close Missing and restore
   Dismissed. Pages: src/stock-check-ui.js. */

import { adminGql, throttleWait } from "./price-history.js";
import { can } from "./stage-auth.js";
import { BASE } from "./stage-ui.js";
import { STAGE_DO } from "./stage.js";
import { sendEmail, emailConfigured } from "./stage-email.js";
import { renderStock, renderStockDenied } from "./stock-check-ui.js";

export const STOCK_DO = "stock-check";
export const DAY_MS = 86400e3;
export const KEEP_DAYS = 180;            // ledger days kept
export const BACKFILL_DAYS = 60;         // first run: how far back orders go (read_orders sees 60 days)
export const WINDOW_DAYS = 90;           // sales looked at for candidates
export const MIN_SALES = 3;              // "was selling": at least this many units in the rate window
export const EXPECTED_MIN = 3;           // flag when this many sales should have happened (p0 = e^-3 ~ 5%)
export const SNOOZE_DAYS = 14;
export const RUN_HOUR_UTC = 9;           // 05:00 Atlantic
export const ORDERS_PAGE = 20, LINES_PER_ORDER = 15, SCAN_PAGE = 120, LOOKUP_PAGE = 100, OPEN_PER_PAGE = 20;
export const MAX_ROWS = 200;             // per result list
export const HOT_MIN = 6;                // Order now: at least this many sold in the 30 days before it ran out (admins change it)
export const HOT_FLOOR = 3;              // the stored Order now list keeps everything down to this, so a lower threshold applies at once
export const MAX_PHASE_ERRORS = 3;
export const LEASE_MS = 150e3;            // a unit of work handed to a worker tick is held this long
export const LOOK_STATES = ["found_floor", "found_overstock", "reserved", "fewer", "damaged", "not_found"];
export const REORDER_STATES = ["ordered", "snooze", "cant_reorder", "not_restocking"];
export const MISSING_STATES = ["fewer", "damaged", "not_found"];
export const PERMANENT_STATES = ["cant_reorder", "not_restocking"];
export const STATE_LABEL = {
  found_floor: "Found on the floor", found_overstock: "Found in overstock, moved to the floor", reserved: "Reserved (hold, pickup order or prize support)",
  fewer: "Found fewer than listed", damaged: "Damaged or unsellable", not_found: "Not found",
  ordered: "Ordered", snooze: "Snoozed", cant_reorder: "Can't reorder", not_restocking: "Not restocking (our choice)",
  adjusted: "Adjusted in BinderPOS", turned_up: "Turned up", restored: "Restored", note: "Note",
};
export const PLACES = ["Overstock shelf / back room", "Pickup shelf (online orders)", "Customer holds behind the counter", "Display case", "Event prize support", "Returns / damaged bin"];
export const ADMIN_PRODUCT = "https://admin.shopify.com/store/most-wanted-ca/products/";
export const STORE_PRODUCT = "https://exorgames.com/products/";
// Owner, 2026-10-15: "distributor reorder page where it opens on the
// distributor's website with that search term" - one search-address template
// per vendor ({q} = the product title), admins add the rest on the page.
// PLAMOD's retailer search is known (src/plamod.js); a vendor without a
// template gets a web search for the vendor and the title.
export const DEFAULT_DISTRIBUTORS = { plamod: { name: "PLAMOD", url: "https://www.plamod.com/retailer/search?q={q}" } };
export function distributorUrl(vendor, title, map) {
  const v = String(vendor || "").trim(), t = String(title || "").trim();
  const d = (map && map[v.toLowerCase()]) || DEFAULT_DISTRIBUTORS[v.toLowerCase()];
  if (d && d.url) return d.url.includes("{q}") ? d.url.replace("{q}", encodeURIComponent(t)) : d.url;
  return "https://www.google.com/search?q=" + encodeURIComponent((v ? v + " " : "") + t);
}
// "Universal Distribution = https://.../search?q={q}" per line -> the map
export function parseDistributors(text) {
  const out = {};
  let n = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*([^=]{1,80}?)\s*=\s*(https:\/\/[^\s"'<>]{1,300})\s*$/.exec(line);
    if (!m) continue;
    out[m[1].toLowerCase()] = { name: m[1], url: m[2] };
    if (++n >= 100) break;
  }
  return out;
}
export const distributorsText = (map) => Object.values(map || {}).map((d) => d.name + " = " + d.url).join("\n");
// Owner, 2026-10-15: "it needs to open in say universals actual page", e.g.
// https://ca.universaldist.com/item/detail/<uuid>. A saved link per product
// (sc:dl:<productId>) wins over the vendor's search template; staff paste it
// once on the card and it is remembered for good.
export const validLink = (u) => /^https:\/\/[^\s"'<>]{1,400}$/i.test(String(u || "").trim());
export function reorderLink(r, o) {
  const saved = o && o.links && r && r.pid && o.links[r.pid];
  if (saved && saved.url) return { url: saved.url, label: (r.vendor ? r.vendor : "distributor") + " item page", saved: true };
  return { url: distributorUrl(r && r.vendor, r && r.title, o && o.distributors), label: (r && r.vendor ? r.vendor + " reorder page" : "search the web"), saved: false };
}
export const mergedDistributors = (cfg) => ({ ...DEFAULT_DISTRIBUTORS, ...((cfg && cfg.distributors) || {}) });

export const dayOf = (ms) => Math.floor(ms / DAY_MS);
export const dayIso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const text = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const cents = (s) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0; };
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const safeImage = (u) => { const s = String(u == null ? "" : u).trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 400 ? s : ""; };

/* ---- scope ---- */

// Product types the check looks at. Owner: no singles, no slabs; event
// tickets and the internal bulk-evaluation items never sit on a shelf; the
// console types hold test placeholders only ("Retro video games is not on
// exor"). Everything else (sealed, board games, hobby, accessories,
// collectibles, untyped) is in.
export function inScopeType(t) {
  const s = String(t == null ? "" : t).trim();
  if (!s) return true;
  return !/single|graded|event ticket|bulkcardevaluation|internal used|^used$|xbox|playstation|nintendo|sega|gameboy/i.test(s);
}
export const isPreorder = (title) => /\bpre[\s-]?orders?\b/i.test(String(title || ""));

/* ---- the rules ---- */

// Units sold per day for one variant over the last `days` days, oldest
// first; ledgers = { "<day>": { "<vid>": units } }.
export function seriesOf(ledgers, vid, today, days) {
  const out = new Array(days).fill(0);
  for (let i = 0; i < days; i++) { const l = ledgers[String(today - days + 1 + i)]; if (l && l[vid]) out[i] = l[vid]; }
  return out;
}
const sum = (a, from, to) => { let s = 0; for (let i = Math.max(0, from); i <= to && i < a.length; i++) s += a[i]; return s; };

// The rate window ending on the last sale: 30 days, widened to 60 then 90
// when fewer than MIN_SALES units sold in it. Returns {days, sold} or null
// when it never reaches MIN_SALES (the item was not "selling").
export function rateWindow(series, lastIdx) {
  for (const w of [30, 60, 90]) {
    const sold = sum(series, lastIdx - w + 1, lastIdx);
    if (sold >= MIN_SALES) return { days: w, sold };
  }
  return null;
}

// Was selling, then stopped while stock remains. series = seriesOf(...),
// today = the series' last day. Null when not flagged.
export function stalled(item, series, today) {
  if (!item || !(item.qty > 0)) return null;
  if (isPreorder(item.title)) return null;
  let lastIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) if (series[i] > 0) { lastIdx = i; break; }
  if (lastIdx < 0) return null;
  const lastDay = today - (series.length - 1 - lastIdx);
  const daysSince = today - lastDay;
  if (daysSince < 3) return null;
  if (item.restockDay && item.restockDay > lastDay) return null;   // new stock since the last sale: the clock restarted
  const w = rateWindow(series, lastIdx);
  if (!w) return null;
  const rate = w.sold / w.days;
  const expected = rate * daysSince;
  if (expected < EXPECTED_MIN) return null;
  const p0 = Math.exp(-expected);
  const price = (item.cents || 0) / 100;
  return { lastDay, daysSince, window: w.days, soldWindow: w.sold, rate: +rate.toFixed(3), expected: +expected.toFixed(1), p0: +p0.toFixed(4), atRisk: +(item.qty * price).toFixed(2), score: +(expected * Math.max(1, item.qty) * Math.max(1, price)).toFixed(1) };
}

// Sold steadily, now at zero. qtyNow comes from the lookup. Null when not flagged.
export function reorder(meta, series, today, qtyNow) {
  if (qtyNow > 0) return null;
  if (isPreorder(meta && meta.title)) return null;
  let lastIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) if (series[i] > 0) { lastIdx = i; break; }
  if (lastIdx < 0) return null;
  const lastDay = today - (series.length - 1 - lastIdx);
  const soldBefore = sum(series, lastIdx - 59, lastIdx);
  if (soldBefore < MIN_SALES) return null;
  const rate = soldBefore / 60;
  const daysOut = today - lastDay;
  const missed = rate * daysOut;
  const price = ((meta && meta.cents) || 0) / 100;
  const sold30 = sum(series, lastIdx - 29, lastIdx);
  return { lastDay, daysOut, sold60: soldBefore, sold30, perWeek: +(sold30 / 30 * 7).toFixed(1), rate: +rate.toFixed(3), missed: +missed.toFixed(1), missedRevenue: +(missed * price).toFixed(2), score: +(missed * Math.max(1, price)).toFixed(1) };
}

// Did the whole product type cool off over the same gap? Compares the type's
// OTHER items' units/day in the item's rate window with their units/day since
// the item's last sale (the item's own series is taken out, so a type with
// one seller never "slows" because of that seller). Needs CAT_MIN units from
// the others to say anything. Returns the drop as a fraction (0.7 = fell
// 70%), or null.
export const CAT_MIN = 10;
export function categoryDrop(typeSeries, lastDay, today, windowDays, ownSeries) {
  if (!typeSeries || !typeSeries.length) return null;
  const lastIdx = typeSeries.length - 1 - (today - lastDay);
  if (lastIdx < 0) return null;
  const others = typeSeries.map((n, i) => n - ((ownSeries && ownSeries[i]) || 0));
  const beforeUnits = sum(others, lastIdx - windowDays + 1, lastIdx);
  const since = today - lastDay;
  if (!since || beforeUnits < CAT_MIN) return null;
  const before = beforeUnits / windowDays;
  const after = sum(others, lastIdx + 1, others.length - 1) / since;
  return +Math.max(0, 1 - after / before).toFixed(2);
}

/* ---- staff state ---- */

export function visibleLook(state, now, soldSinceMark) {
  if (!state || !state.state) return { show: true, due: false };
  if (state.closed) return { show: true, due: false };
  if (MISSING_STATES.includes(state.state)) return { show: false, missing: true };
  if (["found_floor", "found_overstock", "reserved"].includes(state.state)) {
    if (state.until && now < state.until && !soldSinceMark) return { show: false, snoozed: true };
    return { show: true, due: true };
  }
  return { show: true, due: false };
}
export function visibleReorder(state, now, qtyNow) {
  if (!state || !state.state) return { show: true };
  if (PERMANENT_STATES.includes(state.state) && !state.closed) return { show: false, dismissed: true };
  if (state.state === "ordered" || state.state === "snooze") {
    if (qtyNow > 0) return { show: false, arrived: true };
    if (state.until && now < state.until) return { show: false, snoozed: true };
    return { show: true, due: true };
  }
  return { show: true };
}

/* ---- Shopify queries, run by the worker ---- */

export const ORDERS_Q = `query($q:String!,$after:String){orders(first:${ORDERS_PAGE},query:$q,sortKey:CREATED_AT,after:$after){pageInfo{hasNextPage endCursor}nodes{id name createdAt lineItems(first:${LINES_PER_ORDER}){nodes{quantity variant{id}product{id title productType vendor}}}}}}`;
export const TYPES_Q = `query($after:String){productTypes(first:250,after:$after){pageInfo{hasNextPage endCursor}edges{node}}}`;
export const SCAN_Q = `query($q:String!,$after:String){productVariants(first:${SCAN_PAGE},query:$q,after:$after){pageInfo{hasNextPage endCursor}nodes{id title sku barcode price inventoryQuantity product{id title productType vendor handle featuredMedia{preview{image{url}}}}}}}`;
export const LOOKUP_Q = `query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id title sku barcode price inventoryQuantity product{id title productType vendor handle status featuredMedia{preview{image{url}}}}inventoryItem{inventoryLevels(first:1){nodes{quantities(names:["available","committed","on_hand","quality_control","damaged","reserved","incoming"]){name quantity}}}}}}}`;
export const openQuery = (items) => `query{${items.map((it, i) => `o${i}:orders(first:5,query:${JSON.stringify("sku:" + it.sku + " fulfillment_status:unfulfilled status:open")}){nodes{name createdAt displayFulfillmentStatus shippingLine{title}}}`).join(" ")}}`;

// One orders page -> what the DO stores. Lines without a variant or a product
// (deleted since) are dropped; the type filter happens in the DO.
export function parseOrdersPage(data) {
  const o = data && data.orders;
  if (!o || !Array.isArray(o.nodes)) throw new Error("orders shape");
  const orders = [];
  let newest = "";
  for (const n of o.nodes) {
    if (!n || !n.createdAt) continue;
    if (n.createdAt > newest) newest = n.createdAt;
    const lines = [];
    for (const l of (n.lineItems && n.lineItems.nodes) || []) {
      const vid = digits(l && l.variant && l.variant.id), p = l && l.product;
      if (!vid || !p) continue;
      lines.push({ vid, pid: digits(p.id), qty: Math.max(0, parseInt(l.quantity, 10) || 0), type: text(p.productType, 80), vendor: text(p.vendor, 80), title: text(p.title, 200) });
    }
    orders.push({ id: digits(n.id), name: text(n.name, 20), createdAt: n.createdAt, lines });
  }
  return { orders, newest, cursor: o.pageInfo && o.pageInfo.endCursor || null, hasNext: !!(o.pageInfo && o.pageInfo.hasNextPage) };
}
export function parseTypesPage(data) {
  const t = data && data.productTypes;
  if (!t || !Array.isArray(t.edges)) throw new Error("types shape");
  return { types: t.edges.map((e) => e && e.node).filter((x) => typeof x === "string"), cursor: t.pageInfo && t.pageInfo.endCursor || null, hasNext: !!(t.pageInfo && t.pageInfo.hasNextPage) };
}
const shapeVariant = (v) => {
  const p = v.product || {};
  const img = p.featuredMedia && p.featuredMedia.preview && p.featuredMedia.preview.image && p.featuredMedia.preview.image.url;
  return { vid: digits(v.id), pid: digits(p.id), title: text(p.title, 200), vtitle: text(v.title, 120), sku: text(v.sku, 60), barcode: text(v.barcode, 40), cents: cents(v.price), qty: Number.isFinite(Number(v.inventoryQuantity)) ? Number(v.inventoryQuantity) : 0, type: text(p.productType, 80), vendor: text(p.vendor, 80), handle: text(p.handle, 200), image: safeImage(img), status: text(p.status, 20) };
};
export function parseScanPage(data) {
  const pv = data && data.productVariants;
  if (!pv || !Array.isArray(pv.nodes)) throw new Error("variants shape");
  return { variants: pv.nodes.filter((v) => v && v.id).map(shapeVariant), cursor: pv.pageInfo && pv.pageInfo.endCursor || null, hasNext: !!(pv.pageInfo && pv.pageInfo.hasNextPage) };
}
export function parseLookup(data) {
  const nodes = data && Array.isArray(data.nodes) ? data.nodes : null;
  if (!nodes) throw new Error("lookup shape");
  const items = [];
  for (const v of nodes) {
    if (!v || !v.id) continue;
    const it = shapeVariant(v);
    const lvl = v.inventoryItem && v.inventoryItem.inventoryLevels && v.inventoryItem.inventoryLevels.nodes && v.inventoryItem.inventoryLevels.nodes[0];
    const q = {};
    for (const x of (lvl && lvl.quantities) || []) if (x && x.name) q[x.name] = Number(x.quantity) || 0;
    it.q = q;
    items.push(it);
  }
  return items;
}
export function parseOpen(items, data) {
  const out = {};
  items.forEach((it, i) => {
    const o = data && data["o" + i];
    const rows = ((o && o.nodes) || []).map((n) => ({ name: text(n.name, 20), at: n.createdAt || "", ship: text(n.shippingLine && n.shippingLine.title, 60) || "pickup" }));
    if (rows.length) out[it.vid] = rows;
  });
  return out;
}

// The worker side of one plan: fetch what the plan asks for and shape the
// ingest body. gql(query, variables) -> { data, cost } (price-history.js
// adminGql); pacing is the caller's.
export async function doWork(plan, gql) {
  if (plan.kind === "orders") {
    const q = `created_at:>${plan.since} -status:cancelled`;
    const r = await gql(ORDERS_Q, { q, after: plan.cursor || null });
    return { kind: "orders", ...parseOrdersPage(r.data), cost: r.cost };
  }
  if (plan.kind === "types") {
    let after = null, types = [], guard = 0;
    let cost = null;
    do {
      const r = await gql(TYPES_Q, { after });
      const p = parseTypesPage(r.data);
      types = types.concat(p.types); after = p.hasNext ? p.cursor : null; cost = r.cost;
    } while (after && ++guard < 10);
    return { kind: "types", types, cost };
  }
  if (plan.kind === "scan") {
    const q = `product_type:${JSON.stringify(plan.type)} inventory_quantity:>0 product_status:active`;
    const r = await gql(SCAN_Q, { q, after: plan.cursor || null });
    return { kind: "scan", type: plan.type, ...parseScanPage(r.data), cost: r.cost };
  }
  if (plan.kind === "lookup") {
    const r = await gql(LOOKUP_Q, { ids: plan.ids.map((v) => "gid://shopify/ProductVariant/" + v) });
    return { kind: "lookup", ids: plan.ids, items: parseLookup(r.data), cost: r.cost };
  }
  if (plan.kind === "open") {
    const r = await gql(openQuery(plan.items));
    return { kind: "open", vids: plan.items.map((it) => it.vid), orders: parseOpen(plan.items, r.data), cost: r.cost };
  }
  throw new Error("unknown plan " + plan.kind);
}

// The cron entry. Does units of work until the DO says idle or the budget is
// spent; each Shopify answer's cost paces the next call.
export async function stockCheckTick(env, o) {
  o = o || {};
  if (!(env && env.SHOPIFY_ADMIN_TOKEN) && !o.gql) return { skipped: "no token" };
  const now = o.now || (() => Date.now());
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gql = o.gql || ((q, v) => adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v));
  const stub = env.ROOM.get(env.ROOM.idFromName(STOCK_DO));
  const call = async (path, body) => { const r = await stub.fetch(new Request("https://" + STOCK_DO + ".internal" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })); try { return await r.json(); } catch { return { ok: false, error: "DO HTTP " + r.status }; } };
  const budget = o.budgetMs || 150e3, t0 = now(), maxSteps = o.maxSteps || 60;
  const out = { steps: 0, kinds: {}, errors: 0 };
  let plan = null;
  while (now() - t0 < budget && out.steps < maxSteps) {
    plan = await call("/_sc/plan", { now: now() });
    if (!plan.ok) { out.error = plan.error || "plan failed"; break; }
    if (plan.kind === "idle") { out.idle = true; out.phase = plan.phase; break; }
    if (plan.kind === "busy") { out.busy = true; out.phase = plan.phase; break; }
    let payload;
    try { payload = await doWork(plan, gql); }
    catch (e) {
      out.errors++;
      await call("/_sc/ingest", { token: plan.token, kind: plan.kind, error: String((e && e.message) || e).slice(0, 200), type: plan.type, ids: plan.ids, vids: plan.items && plan.items.map((it) => it.vid) });
      if (e && e.throttled) await sleep(5000);
      continue;
    }
    payload.token = plan.token;
    const ing = await call("/_sc/ingest", payload);
    out.steps++; out.kinds[plan.kind] = (out.kinds[plan.kind] || 0) + 1;
    if (!ing.ok) { out.error = ing.error || "ingest failed"; break; }
    const wait = throttleWait(payload.cost, 1000);
    if (wait) await sleep(Math.min(wait, 15000));
  }
  if (!out.idle && plan && plan.kind) out.phase = plan.kind;
  out.ms = now() - t0;
  return out;
}

/* ---- the Durable Object side ---- */

const CFG0 = () => ({ ordersSince: null, lastRunDay: null, lastRunAt: 0, lastError: "", ordersDenied: false, kick: false, runs: 0, hotMin: HOT_MIN, distributors: {} });
async function loadCfg(cx) { return { ...CFG0(), ...((await cx.storage.get("sc:cfg")) || {}) }; }
async function saveCfg(cx, cfg) { await cx.storage.put("sc:cfg", cfg); }

function newRun(cfg, now) {
  const since = cfg.ordersSince || new Date(now - BACKFILL_DAYS * DAY_MS).toISOString();
  // The run record stays small (a Durable Object value holds 128 KiB): the
  // candidate lists, the lookup ids and the open-order items live in their
  // own keys (sc:cand, sc:lookup, sc:open), written by compute() and plan().
  return { id: now, day: dayOf(now), phase: cfg.ordersDenied ? "types" : "orders", since, newest: cfg.ordersSince || "", cursor: null, types: null, typeIdx: 0, pages: 0, orders: 0, lines: 0, seen: 0, scanned: 0, lookupDone: 0, lookupTotal: 0, openDone: 0, openTotal: 0, errors: [], phaseErrors: 0, startedAt: now };
}

// Should a run start now? The first ever run starts at once; later runs once
// a day after RUN_HOUR_UTC; an admin's Scan now (cfg.kick) starts one anyway.
export function shouldStart(cfg, now) {
  if (cfg.kick) return true;
  if (!cfg.lastRunDay) return true;
  const today = dayOf(now);
  if (cfg.lastRunDay >= today) return false;
  return new Date(now).getUTCHours() >= RUN_HOUR_UTC;
}

async function ledgersFor(cx, today, days) {
  const keys = [];
  for (let d = today - days + 1; d <= today; d++) keys.push("sc:l:" + d);
  const out = {};
  for (let i = 0; i < keys.length; i += 128) {
    const m = await cx.storage.get(keys.slice(i, i + 128));
    for (const [k, v] of m) out[k.slice(5)] = v || {};
  }
  return out;
}

// After the scan: the candidates for both lists, from the ledger and the
// in-stock records. Writes sc:cand, sc:lookup (the variant ids the lookup phase fetches) and sc:types.
async function compute(cx, run) {
  const today = run.day;
  const ledgers = await ledgersFor(cx, today, WINDOW_DAYS);
  const inStock = await cx.storage.list({ prefix: "sc:v:" });
  const typeSeries = {};
  const addType = (t, series) => { const a = typeSeries[t] || (typeSeries[t] = new Array(WINDOW_DAYS).fill(0)); for (let i = 0; i < series.length; i++) a[i] += series[i]; };
  const soldVids = new Set();
  for (const l of Object.values(ledgers)) for (const vid of Object.keys(l)) soldVids.add(vid);
  const metas = new Map();
  const soldList = [...soldVids];
  for (let i = 0; i < soldList.length; i += 128) {
    const m = await cx.storage.get(soldList.slice(i, i + 128).map((v) => "sc:m:" + v));
    for (const [k, v] of m) metas.set(k.slice(5), v);
  }
  const series = {};
  for (const vid of soldList) { const s = seriesOf(ledgers, vid, today, WINDOW_DAYS); series[vid] = s; const meta = metas.get(vid); if (meta && meta.type != null) addType(meta.type, s); }
  const look = [], reorderIds = [];
  for (const [k, item] of inStock) {
    if (!item || item.run !== run.id) continue;   // not seen in this scan: it is out of stock now
    const s = series[item.vid] || seriesOf(ledgers, item.vid, today, WINDOW_DAYS);
    const f = stalled(item, s, today);
    if (!f) continue;
    f.catDrop = categoryDrop(typeSeries[item.type], f.lastDay, today, f.window, s);
    if (f.catDrop != null && f.catDrop >= 0.6) f.score = +(f.score * 0.5).toFixed(1);
    look.push({ vid: item.vid, f });
  }
  for (const vid of soldList) {
    const rec = inStock.get("sc:v:" + vid);
    if (rec && rec.run === run.id) continue;   // in stock: not a reorder
    const s = series[vid];
    if (sum(s, 0, s.length - 1) < MIN_SALES) continue;
    reorderIds.push(vid);
  }
  look.sort((a, b) => b.f.score - a.f.score);
  const cand = { look: look.slice(0, MAX_ROWS * 2), reorderIds: reorderIds.slice(0, 2000) };
  const ids = new Set(cand.look.map((x) => x.vid));
  for (const v of cand.reorderIds) ids.add(v);
  const lookup = [...ids];
  // the type series only for the types the candidates are in (a few KiB)
  const need = new Set(cand.look.map((x) => inStock.get("sc:v:" + x.vid)).filter(Boolean).map((it) => it.type));
  for (const v of cand.reorderIds) { const m = metas.get(v); if (m && m.type != null) need.add(m.type); }
  const ts = {};
  for (const t of need) if (typeSeries[t]) ts[t] = typeSeries[t];
  await cx.storage.put({ "sc:cand": cand, "sc:lookup": lookup, "sc:types": ts });
  run.lookupDone = 0; run.lookupTotal = lookup.length;
  run.phase = lookup.length ? "lookup" : "finalize";
}

// After lookup + open: the two result lists, auto-closes, prunes.
async function finalize(cx, run, cfg, now) {
  const today = run.day;
  const ledgers = await ledgersFor(cx, today, WINDOW_DAYS);
  const lk = new Map();
  const ids = (await cx.storage.get("sc:lookup")) || [];
  const cand = (await cx.storage.get("sc:cand")) || { look: [], reorderIds: [] };
  const typeSeries = (await cx.storage.get("sc:types")) || {};
  for (let i = 0; i < ids.length; i += 128) {
    const m = await cx.storage.get(ids.slice(i, i + 128).map((v) => "sc:lk:" + v));
    for (const [k, v] of m) lk.set(k.slice(6), v);
  }
  const look = [];
  for (const c of cand.look || []) {
    const item = await cx.storage.get("sc:v:" + c.vid);
    if (!item) continue;
    const l = lk.get(c.vid);
    const q = (l && l.q) || {};
    if (l && Number.isFinite(l.qty) && l.qty <= 0) continue;   // sold out between scan and lookup
    look.push({ vid: c.vid, pid: item.pid, title: item.title, vtitle: item.vtitle, sku: item.sku, barcode: item.barcode, cents: item.cents, type: item.type, vendor: item.vendor, handle: item.handle, image: item.image || (l && l.image) || "",
      qty: l && Number.isFinite(l.qty) ? l.qty : item.qty, q, open: (l && l.open) || [], restockDay: item.restockDay || null, ...c.f });
  }
  look.sort((a, b) => b.score - a.score);
  const reorderRows = [];
  for (const vid of cand.reorderIds || []) {
    const l = lk.get(vid);
    if (!l) continue;
    if (l.status && l.status !== "ACTIVE") continue;
    if (!inScopeType(l.type)) continue;
    const s = seriesOf(ledgers, vid, today, WINDOW_DAYS);
    const f = reorder(l, s, today, l.qty);
    if (!f) continue;
    f.catDrop = categoryDrop(typeSeries[l.type], f.lastDay, today, 60, s);
    reorderRows.push({ vid, pid: l.pid, title: l.title, vtitle: l.vtitle, sku: l.sku, barcode: l.barcode, cents: l.cents, type: l.type, vendor: l.vendor, handle: l.handle, image: l.image, qty: l.qty, q: l.q || {}, ...f });
  }
  reorderRows.sort((a, b) => b.score - a.score);
  // Order now: the fastest sellers among them, by the 30-day rate before the stockout
  const hot = reorderRows.filter((r) => r.sold30 >= HOT_FLOOR).sort((a, b) => b.sold30 - a.sold30 || b.score - a.score).slice(0, MAX_ROWS);
  // auto-close: a missing item that sold again turned up; one BinderPOS took to 0 was adjusted;
  // an ordered item back in stock arrived.
  const states = await cx.storage.list({ prefix: "sc:s:" });
  const puts = {}, dels = [];
  for (const [k, st] of states) {
    if (!st || st.closed) continue;
    const vid = k.slice(5);
    const l = lk.get(vid);
    const item = await cx.storage.get("sc:v:" + vid);
    const qtyNow = l && Number.isFinite(l.qty) ? l.qty : item && item.run === run.id ? item.qty : null;
    const s = seriesOf(ledgers, vid, today, WINDOW_DAYS);
    // sales on the day it was marked or later: it turned up (day granularity)
    const soldSince = sum(s, s.length - 1 - Math.max(0, today - dayOf(st.at || 0)), s.length - 1);
    if (MISSING_STATES.includes(st.state)) {
      if (soldSince > 0) { st.closed = { at: now, by: "stock check", state: "turned_up", note: "sold again after it was marked" }; puts[k] = st; }
      else if (qtyNow === 0) { st.closed = { at: now, by: "stock check", state: "adjusted", note: "stock is now 0 in Shopify" }; puts[k] = st; }
    } else if ((st.state === "ordered" || st.state === "snooze") && qtyNow > 0) { st.closed = { at: now, by: "stock check", state: "arrived", note: "back in stock (" + qtyNow + ")" }; puts[k] = st; }
  }
  if (Object.keys(puts).length) await cx.storage.put(puts);
  const hotMin = Number(cfg.hotMin) >= 1 ? Number(cfg.hotMin) : HOT_MIN;
  const meta = { at: now, day: today, runId: run.id, counts: { look: look.length, reorder: reorderRows.length, hot: hot.filter((r) => r.sold30 >= hotMin).length, scanned: run.scanned, orders: run.orders, lines: run.lines, lookedUp: run.lookupDone }, errors: (run.errors || []).slice(-10), ordersSince: run.newest || run.since, ordersDenied: !!cfg.ordersDenied, ledgerDays: Object.keys(ledgers).length };
  await cx.storage.put({ "sc:res:look": look.slice(0, MAX_ROWS), "sc:res:reorder": reorderRows.slice(0, MAX_ROWS), "sc:res:hot": hot, "sc:res:meta": meta });
  // prune: ledgers older than KEEP_DAYS, in-stock records not seen for 30 days, lookups outside this run
  try {
    const old = await cx.storage.list({ prefix: "sc:l:" });
    for (const [k] of old) if (parseInt(k.slice(5), 10) < today - KEEP_DAYS) dels.push(k);
    const v = await cx.storage.list({ prefix: "sc:v:" });
    for (const [k, rec] of v) if (rec && rec.seenDay && rec.seenDay < today - 30) dels.push(k);
    const keep = new Set(ids);
    const lks = await cx.storage.list({ prefix: "sc:lk:" });
    for (const [k] of lks) if (!keep.has(k.slice(6))) dels.push(k);
    for (let i = 0; i < dels.length; i += 128) await cx.storage.delete(dels.slice(i, i + 128));
  } catch (e) { cx.log("stock-check: prune: " + ((e && e.message) || e)); }
  cfg.lastRunDay = today; cfg.lastRunAt = now; cfg.kick = false; cfg.runs = (cfg.runs || 0) + 1; cfg.lastError = (run.errors || []).length ? run.errors[run.errors.length - 1] : "";
  if (run.newest) cfg.ordersSince = run.newest;
  await saveCfg(cx, cfg);
  await cx.storage.delete(["sc:run", "sc:cand", "sc:lookup", "sc:types", "sc:open"]);
}

// What the worker should do next. Runs the in-DO phases itself first.
async function plan(cx, now) {
  const cfg = await loadCfg(cx);
  let run = await cx.storage.get("sc:run");
  if (!run) {
    if (!shouldStart(cfg, now)) return { ok: true, kind: "idle", phase: "idle", lastRunDay: cfg.lastRunDay || null };
    run = newRun(cfg, now);
    await cx.storage.put("sc:run", run);
  }
  if (run.phase === "compute") { await compute(cx, run); await cx.storage.put("sc:run", run); }
  if (run.phase === "lookup" && run.lookupDone >= run.lookupTotal) {
    // which candidates have committed units and a SKU -> the open-orders phase
    const items = [];
    for (const vid of (await cx.storage.get("sc:lookup")) || []) { const l = await cx.storage.get("sc:lk:" + vid); if (l && l.q && l.q.committed > 0 && l.sku) items.push({ vid, sku: l.sku }); }
    await cx.storage.put("sc:open", items);
    run.openDone = 0; run.openTotal = items.length; run.phase = items.length ? "open" : "finalize";
    await cx.storage.put("sc:run", run);
  }
  if (run.phase === "open" && run.openDone >= run.openTotal) { run.phase = "finalize"; await cx.storage.put("sc:run", run); }
  if (run.phase === "finalize") { await finalize(cx, run, cfg, now); return { ok: true, kind: "idle", phase: "done", finished: true }; }
  if (run.phase === "scan" && (!run.types || run.typeIdx >= run.types.length)) { run.phase = "compute"; await cx.storage.put("sc:run", run); return plan(cx, now); }
  // One worker at a time: a unit handed out is leased for LEASE_MS; a second
  // cron tick overlapping the first is told to wait, so no page is counted twice.
  if (run.lease && now - run.leaseAt < LEASE_MS) return { ok: true, kind: "busy", phase: run.phase, since: run.leaseAt };
  const token = String(now) + "-" + Math.random().toString(36).slice(2, 10);
  run.lease = token; run.leaseAt = now;
  await cx.storage.put("sc:run", run);
  const unit = { ok: true, token };
  if (run.phase === "orders") return { ...unit, kind: "orders", since: run.since, cursor: run.cursor, pages: run.pages };
  if (run.phase === "types") return { ...unit, kind: "types" };
  if (run.phase === "scan") return { ...unit, kind: "scan", type: run.types[run.typeIdx], cursor: run.cursor, typeIdx: run.typeIdx, types: run.types.length };
  if (run.phase === "lookup") { const ids = (await cx.storage.get("sc:lookup")) || []; return { ...unit, kind: "lookup", ids: ids.slice(run.lookupDone, run.lookupDone + LOOKUP_PAGE), done: run.lookupDone, total: run.lookupTotal }; }
  if (run.phase === "open") { const items = (await cx.storage.get("sc:open")) || []; return { ...unit, kind: "open", items: items.slice(run.openDone, run.openDone + OPEN_PER_PAGE), done: run.openDone, total: run.openTotal }; }
  run.lease = null; await cx.storage.put("sc:run", run);
  return { ok: false, error: "bad phase " + run.phase };
}

async function ingest(cx, b, now) {
  const run = await cx.storage.get("sc:run");
  if (!run) return { ok: false, error: "no run" };
  if (run.lease && b.token !== run.lease) return { ok: false, error: "stale unit (another tick holds the lease)" };
  run.lease = null;
  const cfg = await loadCfg(cx);
  if (b.error) {
    run.errors = (run.errors || []).concat([b.kind + ": " + String(b.error).slice(0, 160)]).slice(-20);
    run.phaseErrors = (run.phaseErrors || 0) + 1;
    if (run.phaseErrors >= MAX_PHASE_ERRORS) {
      run.phaseErrors = 0;
      if (b.kind === "orders") { if (/access denied|ACCESS_DENIED|read_orders/i.test(String(b.error))) { cfg.ordersDenied = true; await saveCfg(cx, cfg); } run.phase = "types"; }
      else if (b.kind === "types") { run.types = []; run.phase = "scan"; }
      else if (b.kind === "scan") { run.typeIdx++; run.cursor = null; }
      else if (b.kind === "lookup") { run.lookupDone += (b.ids || []).length || LOOKUP_PAGE; }
      else if (b.kind === "open") { run.openDone += (b.vids || []).length || OPEN_PER_PAGE; }
    }
    await cx.storage.put("sc:run", run);
    return { ok: true, errors: run.errors.length };
  }
  if (b.kind !== run.phase) return { ok: false, error: "phase is " + run.phase + ", got " + b.kind };
  run.phaseErrors = 0;
  if (b.kind === "orders") {
    const puts = {};
    const metas = {};
    for (const o of b.orders || []) {
      run.orders++;
      const day = dayOf(Date.parse(o.createdAt));
      if (!Number.isFinite(day)) continue;
      for (const l of o.lines || []) {
        if (!l.vid || !l.qty || !inScopeType(l.type)) continue;
        const k = "sc:l:" + day;
        if (!puts[k]) puts[k] = (await cx.storage.get(k)) || {};
        puts[k][l.vid] = (puts[k][l.vid] || 0) + l.qty;
        run.lines++;
        if (!metas[l.vid]) metas[l.vid] = { vid: l.vid, pid: l.pid, title: l.title, type: l.type, vendor: l.vendor, lastOrder: o.createdAt };
      }
    }
    const mk = Object.keys(metas);
    if (mk.length) {
      const have = await cx.storage.get(mk.map((v) => "sc:m:" + v));
      for (const v of mk) { const old = have.get("sc:m:" + v); const m = metas[v]; if (!old || old.title !== m.title || old.type !== m.type || old.vendor !== m.vendor || (old.lastOrder || "") < m.lastOrder) puts["sc:m:" + v] = { ...(old || {}), ...m }; }
    }
    if (Object.keys(puts).length) await cx.storage.put(puts);
    if (b.newest && b.newest > (run.newest || "")) run.newest = b.newest;
    run.pages++;
    if (b.hasNext && b.cursor && run.pages < 2000) run.cursor = b.cursor;
    else { run.cursor = null; run.phase = "types"; cfg.ordersDenied = false; await saveCfg(cx, cfg); }
  } else if (b.kind === "types") {
    run.types = (b.types || []).filter((t) => t && inScopeType(t));   // untyped products (158, unsearchable by type) are left out
    run.typeIdx = 0; run.cursor = null; run.phase = "scan";
  } else if (b.kind === "scan") {
    const puts = {};
    const vids = (b.variants || []).map((v) => v.vid).filter(Boolean);
    const have = vids.length ? await cx.storage.get(vids.map((v) => "sc:v:" + v)) : new Map();
    for (const v of b.variants || []) {
      if (!v.vid || !inScopeType(v.type)) continue;
      const old = have.get("sc:v:" + v.vid);
      const rec = { ...v, run: run.id, seenDay: run.day, firstDay: (old && old.firstDay) || run.day, restockDay: (old && old.restockDay) || null, prevQty: old ? old.qty : null };
      if (old && Number.isFinite(old.qty) && v.qty > old.qty) rec.restockDay = run.day;
      puts["sc:v:" + v.vid] = rec;
      run.scanned++;
    }
    if (Object.keys(puts).length) await cx.storage.put(puts);
    if (b.hasNext && b.cursor) run.cursor = b.cursor;
    else { run.cursor = null; run.typeIdx++; }
    if (run.typeIdx >= (run.types || []).length) run.phase = "compute";
  } else if (b.kind === "lookup") {
    const puts = {};
    for (const it of b.items || []) if (it.vid) puts["sc:lk:" + it.vid] = { ...it, run: run.id };
    if (Object.keys(puts).length) await cx.storage.put(puts);
    run.lookupDone += (b.ids || []).length || (b.items || []).length;
  } else if (b.kind === "open") {
    const puts = {};
    for (const vid of b.vids || []) { const l = await cx.storage.get("sc:lk:" + vid); if (l) { l.open = (b.orders && b.orders[vid]) || []; puts["sc:lk:" + vid] = l; } }
    if (Object.keys(puts).length) await cx.storage.put(puts);
    run.openDone += (b.vids || []).length;
  }
  await cx.storage.put("sc:run", run);
  return { ok: true, phase: run.phase };
}

// A staff action on one variant.
async function mark(cx, b, now) {
  const vid = digits(b.vid);
  if (!vid) return { ok: false, error: "which item?" };
  const state = String(b.state || "");
  const by = text(b.by, 160), byName = text(b.byName, 80);
  const note = text(b.note, 500);
  const cur = (await cx.storage.get("sc:s:" + vid)) || { vid, hist: [] };
  const push = (ev) => { cur.hist = (cur.hist || []).concat([ev]).slice(-30); };
  if (state === "note") {
    if (!note) return { ok: false, error: "Write the note first." };
    cur.note = note; push({ at: now, by, byName, state: "note", note });
  } else if (LOOK_STATES.includes(state) || REORDER_STATES.includes(state)) {
    const ev = { at: now, by, byName, state, note };
    let until = null;
    if (["found_floor", "found_overstock", "reserved", "ordered"].includes(state)) until = now + SNOOZE_DAYS * DAY_MS;
    if (state === "snooze") { const d = Date.parse(String(b.until || "")); if (!Number.isFinite(d) || d <= now) return { ok: false, error: "Pick a date after today." }; until = d; }
    if (state === "fewer") { const n = parseInt(b.count, 10); if (!(n >= 0)) return { ok: false, error: "How many did you find?" }; ev.count = n; cur.count = n; }
    Object.assign(cur, { state, at: now, by, byName, until, closed: null, title: text(b.title, 200) || cur.title });
    if (note) cur.note = note;
    push(ev);
  } else if (state === "emailed") {
    cur.emailedAt = now; push({ at: now, by, byName, state: "emailed", note });
  } else if (state === "adjusted" || state === "turned_up") {
    if (!cur.state) return { ok: false, error: "Nothing to close." };
    cur.closed = { at: now, by, byName, state, note }; push({ at: now, by, byName, state, note });
  } else if (state === "restore") {
    if (!PERMANENT_STATES.includes(cur.state)) return { ok: false, error: "That item is not dismissed." };
    cur.closed = { at: now, by, byName, state: "restored", note }; push({ at: now, by, byName, state: "restored", note });
  } else return { ok: false, error: "unknown state" };
  await cx.storage.put("sc:s:" + vid, cur);
  return { ok: true, state: cur };
}

// Everything the page needs: the two result lists with each item's state,
// the missing and dismissed lists, the run status.
async function view(cx, now) {
  const [look, reorderRows, hotRows, meta, cfg, run] = await Promise.all([cx.storage.get("sc:res:look"), cx.storage.get("sc:res:reorder"), cx.storage.get("sc:res:hot"), cx.storage.get("sc:res:meta"), loadCfg(cx), cx.storage.get("sc:run")]);
  const states = await cx.storage.list({ prefix: "sc:s:" });
  const st = {};
  for (const [k, v] of states) st[k.slice(5)] = v;
  const linkRows = await cx.storage.list({ prefix: "sc:dl:" });
  const links = {};
  for (const [k, v] of linkRows) if (v && v.url) links[k.slice(6)] = v;
  const today = dayOf(now);
  const outLook = [], outReorder = [], outHot = [], missing = [], dismissed = [];
  const hotMin = Number(cfg.hotMin) >= 1 ? Number(cfg.hotMin) : HOT_MIN;
  for (const r of hotRows || []) {
    if (!(r.sold30 >= hotMin)) continue;
    const s = st[r.vid];
    const v = visibleReorder(s, now, r.qty);
    if (v.show) outHot.push({ ...r, state: s || null, due: !!v.due });
  }
  for (const r of look || []) {
    const s = st[r.vid];
    const v = visibleLook(s, now, s && s.at ? r.lastDay > dayOf(s.at) : false);
    if (v.show) outLook.push({ ...r, state: s || null, due: !!v.due });
  }
  for (const r of reorderRows || []) {
    const s = st[r.vid];
    const v = visibleReorder(s, now, r.qty);
    if (v.show) outReorder.push({ ...r, state: s || null, due: !!v.due });
  }
  for (const s of Object.values(st)) {
    if (!s || !s.state) continue;
    if (MISSING_STATES.includes(s.state)) missing.push(s);
    else if (PERMANENT_STATES.includes(s.state) && !s.closed) dismissed.push(s);
  }
  missing.sort((a, b) => (b.at || 0) - (a.at || 0)); dismissed.sort((a, b) => (b.at || 0) - (a.at || 0));
  // name missing/dismissed items from whatever we know
  const name = async (s) => { const v = (await cx.storage.get("sc:v:" + s.vid)) || (await cx.storage.get("sc:lk:" + s.vid)) || (await cx.storage.get("sc:m:" + s.vid)); if (v) { if (!s.title) s.title = v.title; s.vtitle = v.vtitle; s.type = v.type; s.vendor = v.vendor; s.image = v.image || ""; s.cents = v.cents || 0; } return s; };
  for (const s of missing) await name(s);
  for (const s of dismissed) await name(s);
  return { ok: true, look: outLook, hot: outHot, reorder: outReorder, missing, dismissed, links, meta: meta || null, status: { hotMin, distributors: mergedDistributors(cfg), ownDistributors: cfg.distributors || {}, lastRunAt: cfg.lastRunAt || 0, lastRunDay: cfg.lastRunDay || null, ordersSince: cfg.ordersSince || null, ordersDenied: !!cfg.ordersDenied, kick: !!cfg.kick, runs: cfg.runs || 0, lastError: cfg.lastError || "", running: run ? { phase: run.phase, pages: run.pages, scanned: run.scanned, orders: run.orders, typeIdx: run.typeIdx, types: run.types ? run.types.length : null, lookupDone: run.lookupDone, lookupTotal: run.lookupTotal || 0, startedAt: run.startedAt, errors: (run.errors || []).slice(-3) } : null, today } };
}

export async function stockDoFetch(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  const b = post ? await bodyOf(request) : {};
  const now = Number(b.now) || cx.now();
  try {
    if (p === "/_sc/plan" && post) return doJson(await plan(cx, now));
    if (p === "/_sc/ingest" && post) return doJson(await ingest(cx, b, now));
    if (p === "/_sc/mark" && post) return doJson(await mark(cx, b, now));
    if (p === "/_sc/kick" && post) { const cfg = await loadCfg(cx); cfg.kick = true; await saveCfg(cx, cfg); return doJson({ ok: true }); }
    if (p === "/_sc/link" && post) {
      const pid = digits(b.pid);
      if (!pid) return doJson({ ok: false, error: "which product?" }, 400);
      const u = String(b.url || "").trim();
      if (!u) { await cx.storage.delete("sc:dl:" + pid); return doJson({ ok: true, cleared: true }); }
      if (!validLink(u)) return doJson({ ok: false, error: "Paste a full https:// address." }, 400);
      const rec = { pid, url: u.slice(0, 400), by: text(b.by, 160), byName: text(b.byName, 80), at: now, title: text(b.title, 200) };
      await cx.storage.put("sc:dl:" + pid, rec);
      return doJson({ ok: true, link: rec });
    }
    if (p === "/_sc/cfg" && post) {
      const cfg = await loadCfg(cx);
      if (b.hotMin != null) { const n = parseInt(b.hotMin, 10); if (!(n >= 1 && n <= 1000)) return doJson({ ok: false, error: "Order now needs a whole number of sales, 1 or more." }, 400); cfg.hotMin = n; }
      if (b.distributors != null) cfg.distributors = parseDistributors(b.distributors);
      await saveCfg(cx, cfg);
      return doJson({ ok: true, hotMin: cfg.hotMin, distributors: cfg.distributors });
    }
    if (p === "/_sc/view") return doJson(await view(cx, now));
    if (p === "/_sc/health") {
      const cfg = await loadCfg(cx); const run = await cx.storage.get("sc:run"); const meta = await cx.storage.get("sc:res:meta");
      return doJson({ ok: true, hotMin: cfg.hotMin, lastRunAt: cfg.lastRunAt || 0, lastRunDay: cfg.lastRunDay || null, runs: cfg.runs || 0, ordersSince: cfg.ordersSince || null, ordersDenied: !!cfg.ordersDenied, kick: !!cfg.kick, lastError: cfg.lastError || "", running: run ? { phase: run.phase, pages: run.pages, orders: run.orders, lines: run.lines, scanned: run.scanned, typeIdx: run.typeIdx, types: run.types ? run.types.length : null, lookupDone: run.lookupDone, lookupTotal: run.lookupTotal || 0, startedAt: run.startedAt, errors: (run.errors || []).slice(-3) } : null, counts: meta ? meta.counts : null, resultsAt: meta ? meta.at : 0 });
    }
  } catch (e) { cx.log("stock-check: " + p + ": " + ((e && e.message) || e)); return doJson({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500); }
  return doJson({ ok: false, error: "not found" }, 404);
}

/* ---- the email to the admins ---- */

const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const whenH = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const LIST_LABEL = { look: "Go look", hot: "Order now", reorder: "Reorder", missing: "Missing" };

// Facts worth a line in the email, per list.
export function itemFacts(list, r) {
  const f = [];
  if (list === "look") { f.push(r.qty + " on the system"); if (r.daysSince != null) f.push("last sold " + r.daysSince + " days ago"); if (r.expected != null) f.push("should have sold ~" + Math.round(r.expected) + " since"); if (r.atRisk != null) f.push("$" + Number(r.atRisk).toFixed(2) + " at risk"); }
  else if (list === "hot" || list === "reorder") { if (r.daysOut != null) f.push("out " + r.daysOut + " days"); if (r.perWeek != null) f.push("sells ~" + r.perWeek + " a week"); if (r.sold60 != null) f.push(r.sold60 + " sold in the 60 days before"); if (r.missedRevenue != null) f.push("~$" + Number(r.missedRevenue).toFixed(2) + " missed so far"); }
  else if (list === "missing" && r.cents) f.push("$" + (r.cents / 100).toFixed(2) + " each");
  return f;
}

// items: [{ list, row }], row carries the item and its state. o: { byName, by, message, distributors }.
export function buildStockEmail(items, o) {
  const n = items.length;
  const who = (o && (o.byName || o.by)) || "9Pocket";
  const subject = "Stock check: " + n + " item" + (n === 1 ? "" : "s") + " from " + who;
  const INK = "#1d2327", MUTED = "#6b7780", RULE = "#e5e9ec", PAPER = "#f4f6f7", RED = "#d52c28";
  const block = (it) => {
    const r = it.row, s = r.state || {};
    const rl = reorderLink(r, o);
    const links = [[ADMIN_PRODUCT + (r.pid || ""), "Shopify admin"], r.handle ? [STORE_PRODUCT + r.handle, "product page"] : null, [rl.url, rl.label]].filter(Boolean);
    const marked = s.state ? "Marked: " + (STATE_LABEL[s.state] || s.state) + (s.state === "fewer" && s.count != null ? " (found " + s.count + ")" : "") + (s.byName || s.by ? " by " + (s.byName || s.by) : "") + (s.at ? ", " + whenH(s.at) : "") + (s.closed ? " · closed: " + (STATE_LABEL[s.closed.state] || s.closed.state) + (s.closed.note ? " (" + s.closed.note + ")" : "") : "") : "";
    return `<tr><td style="padding:12px 14px;border-bottom:1px solid ${RULE}">
<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${escH(LIST_LABEL[it.list] || it.list)}${r.type ? " · " + escH(r.type) : ""}</div>
<div style="font-size:16px;font-weight:700;margin:2px 0"><a href="${escH(links[0][0])}" style="color:${INK};text-decoration:none">${escH(r.title)}</a>${r.vtitle && r.vtitle !== "Default Title" ? ` <span style="font-weight:400;color:${MUTED}">${escH(r.vtitle)}</span>` : ""}</div>
${r.vendor || r.sku ? `<div style="font-size:13px;color:${MUTED}">${escH(r.vendor || "")}${r.sku ? (r.vendor ? " · " : "") + "SKU " + escH(r.sku) : ""}</div>` : ""}
${itemFacts(it.list, r).length ? `<div style="font-size:13px;margin-top:4px">${escH(itemFacts(it.list, r).join(" · "))}</div>` : ""}
${marked ? `<div style="font-size:13px;margin-top:4px;color:#7f1d1d;font-weight:600">${escH(marked)}</div>` : ""}
${s.note ? `<div style="font-size:13px;margin-top:4px;background:#fff8dc;border-radius:6px;padding:6px 8px">Note: ${escH(s.note)}</div>` : ""}
<div style="font-size:13px;margin-top:6px">${links.map((l) => `<a href="${escH(l[0])}" style="color:${RED};font-weight:600;text-decoration:none">${escH(l[1])}</a>`).join(" &nbsp;·&nbsp; ")}</div></td></tr>`;
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${RED};padding:14px 24px;color:#fff;font-weight:800;font-size:18px">9Pocket · Stock check</td></tr>
<tr><td style="padding:18px 24px 6px"><h1 style="margin:0;font-size:19px;line-height:1.3">${escH(n + " item" + (n === 1 ? "" : "s"))} from ${escH(who)}</h1>${o && o.message ? `<p style="margin:8px 0 0;white-space:pre-line">${escH(o.message)}</p>` : ""}</td></tr>
<tr><td style="padding:8px 10px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${RULE};border-radius:10px;overflow:hidden">${items.map(block).join("")}</table></td></tr>
<tr><td style="padding:14px 24px 22px;font-size:13px"><a href="https://exor-binder.nevski.workers.dev${BASE}/stock" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px">Open the Stock check</a></td></tr>
<tr><td style="background:${PAPER};padding:12px 24px;font-size:12px;color:${MUTED}">Sent from 9Pocket by ${escH(who)}. Staff notice - customers never see this.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [subject, o && o.message ? "\n" + o.message : "", ""].concat(items.map((it) => { const r = it.row, s = r.state || {}; return [(LIST_LABEL[it.list] || it.list) + ": " + r.title + (r.vtitle && r.vtitle !== "Default Title" ? " - " + r.vtitle : ""), r.vendor ? "  " + r.vendor : "", itemFacts(it.list, r).length ? "  " + itemFacts(it.list, r).join(" · ") : "", s.state ? "  Marked: " + (STATE_LABEL[s.state] || s.state) + (s.note ? " - " + s.note : "") : s.note ? "  Note: " + s.note : "", "  " + ADMIN_PRODUCT + (r.pid || ""), r.handle ? "  " + STORE_PRODUCT + r.handle : "", "  " + reorderLink(r, o).url, ""].filter((x) => x !== "").join("\n"); })).join("\n");
  return { subject, html, text };
}

// The admin accounts' addresses (9Pocket accounts, src/stage.js).
export async function adminEmails(env, origin) {
  try {
    const r = await env.ROOM.get(env.ROOM.idFromName(STAGE_DO)).fetch(new Request(origin + "/_stage/users"));
    const j = await r.json();
    return (j && j.users || []).filter((u) => u && u.email && u.role === "admin" && !u.disabled).map((u) => u.email);
  } catch { return []; }
}

/* ---- the 9Pocket routes ---- */

const stub = (env) => env.ROOM.get(env.ROOM.idFromName(STOCK_DO));
async function doCall(env, path, body) {
  const r = await stub(env).fetch(new Request("https://" + STOCK_DO + ".internal" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined));
  try { return await r.json(); } catch { return { ok: false, error: "stock DO: HTTP " + r.status }; }
}
export const canView = (u) => !!u && (u.role === "admin" || can(u, "sc_view") || can(u, "sc_act"));
export const canAct = (u) => !!u && (u.role === "admin" || can(u, "sc_act"));

export async function serveStockStaff(request, env, url, user, form, helpers) {
  const { html, redirect, q, toLogin, opts, pinOk, fetchFn } = helpers;
  const p = url.pathname;
  const noStore = { "cache-control": "no-store" };
  const R = BASE + "/stock";
  if (p === R + "/health") return Response.json(await doCall(env, "/_sc/health"), { headers: noStore });
  if (p === R + ".json") {
    if (!(user && canView(user)) && !pinOk) return Response.json({ error: "sign in (stock check permission) or staff key required" }, { status: 403, headers: noStore });
    return Response.json(await doCall(env, "/_sc/view"), { headers: noStore });
  }
  if (!user) return toLogin();
  if (!canView(user)) return html(renderStockDenied(opts), 403);
  const tab = String(url.searchParams.get("tab") || (form && form.tab) || "look");
  if (p === R + "/control" && request.method === "POST") {
    const f = form || {};
    const action = String(f.action || "");
    const by = user.email, byName = user.name || "";
    let result;
    if (action === "mark") {
      const state = String(f.state || "");
      if (!canAct(user)) result = { ok: false, error: "Your account can look but not mark items. Ask an admin for the stock check permission." };
      else if ((state === "adjusted" || state === "turned_up" || state === "restore") && user.role !== "admin") result = { ok: false, error: "Only an admin can close a missing item or restore a dismissed one." };
      else {
        const r = await doCall(env, "/_sc/mark", { vid: f.vid, state, note: f.note, count: f.count, until: f.until, title: f.title, by, byName });
        result = r.ok ? { ok: true, message: (STATE_LABEL[state] || state) + (f.title ? ": " + String(f.title).slice(0, 80) : "") + "." } : r;
      }
    } else if (action === "cfg") {
      if (user.role !== "admin") result = { ok: false, error: "Only an admin can change these settings." };
      else if (f.distributors != null) { const r = await doCall(env, "/_sc/cfg", { distributors: f.distributors }); result = r.ok ? { ok: true, message: "Distributor websites saved: " + Object.keys(r.distributors || {}).length + " vendor" + (Object.keys(r.distributors || {}).length === 1 ? "" : "s") + " with their own search address." } : r; }
      else { const r = await doCall(env, "/_sc/cfg", { hotMin: f.hotMin }); result = r.ok ? { ok: true, message: "Order now lists items that sold " + r.hotMin + " or more in the 30 days before running out." } : r; }
    } else if (action === "link") {
      if (!canAct(user)) result = { ok: false, error: "Your account can look but not save links." };
      else { const r = await doCall(env, "/_sc/link", { pid: f.pid, url: f.url, title: f.title, by, byName }); result = r.ok ? { ok: true, message: r.cleared ? "Reorder link removed." : "Reorder link saved for " + String(f.title || "").slice(0, 80) + "." } : r; }
    } else if (action === "email") {
      if (!canAct(user)) result = { ok: false, error: "Your account can look but not send items to the admins." };
      else if (!emailConfigured(env)) result = { ok: false, error: "Email is not set up on the worker (RESEND_API_KEY)." };
      else {
        const vids = [...new Set(String(Array.isArray(f.vids) ? f.vids.join(",") : f.vids || "").split(",").map(digits).filter(Boolean))].slice(0, 100);
        const d = await doCall(env, "/_sc/view");
        const items = [];
        for (const vid of vids) {
          let hit = null;
          for (const list of ["look", "hot", "reorder"]) { const r = (d[list] || []).find((x) => x.vid === vid); if (r) { hit = { list, row: r }; break; } }
          if (!hit) { const s = (d.missing || []).find((x) => x.vid === vid && !x.closed); if (s) hit = { list: "missing", row: { ...s, state: s } }; }
          if (hit) items.push(hit);
        }
        if (!items.length) result = { ok: false, error: "Tick at least one item first." };
        else {
          const to = await adminEmails(env, url.origin);
          if (!to.length) result = { ok: false, error: "No admin account to email." };
          else {
            const msg = buildStockEmail(items, { by: user.email, byName: user.name, message: String(f.message || "").slice(0, 1000), distributors: d.status && d.status.distributors, links: d.links || {} });
            const sent = await sendEmail(env, to, msg, { replyTo: user.email, fetchFn });
            if (!sent.ok) result = { ok: false, error: "The email failed: " + (sent.error || sent.status) };
            else {
              for (const it of items) await doCall(env, "/_sc/mark", { vid: it.row.vid, state: "emailed", note: "to " + to.join(", "), by, byName, title: it.row.title });
              result = { ok: true, message: "Emailed " + items.length + " item" + (items.length === 1 ? "" : "s") + " to " + to.join(", ") + "." };
            }
          }
        }
      }
    } else if (action === "scan") {
      if (user.role !== "admin") result = { ok: false, error: "Only an admin can start a scan." };
      else { const r = await doCall(env, "/_sc/kick", {}); result = r.ok ? { ok: true, message: "A scan starts within 5 minutes; this page shows its progress." } : r; }
    } else result = { ok: false, error: "unknown action" };
    if (f.json) return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
    return redirect(R + q({ tab, type: f.type, q: f.q, ...(result.ok ? { msg: result.message } : { err: result.error || "failed" }) }));
  }
  if (p === R) {
    const d = await doCall(env, "/_sc/view");
    return html(renderStock(d, { ...opts, tab, type: url.searchParams.get("type") || "", q: url.searchParams.get("q") || "", act: canAct(user), admin: user.role === "admin", emailOn: emailConfigured(env) }));
  }
  return html(renderStock(null, { ...opts, tab, err: "No such page." }), 404);
}
