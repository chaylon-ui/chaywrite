/* src/impact.js - do the upsell tools sell anything? (owner, 2026-10-20:
   "are you able to track if it has helped increase our sales? For example
   people adding paints using our tool" -> "do ... the upsell build").

   Three things, no personal data in any of them:

   1. Every add-to-cart a storefront tool makes carries a hidden line
      property _xg = <tool> (theme assets, see TOOLS; the Deck Builder's
      older _deck=1 counts as "deck"). Shopify keeps line properties on the
      order, so the order scan below can say which lines a tool put there.
   2. The tools send a counts-only beacon, POST /impact {tool, ev} with ev
      "open" or "add" (window.xgImpact in layout/theme.liquid). One row per
      Atlantic day per tool: opens, adds.
   3. The cron scans new orders (Admin GraphQL, read_orders) every ten
      minutes, a few pages at a time, backfilling BACKFILL_DAYS on the first
      run: per day per tool the orders, units and dollars of the lines that
      tool added; per week the paint lines (PAINT_RE on the product type)
      against all orders, so the paint tools' launch can be read before and
      after. Each order is counted once (imp:o:<name> markers).

   Staff: /9pocket/impact (admins) with 7 / 30 / 90-day tables and the
   paint weeks; /9pocket/impact.json; POST /9pocket/impact/control
   action=scan to scan now. Retention: day and week rows RETENTION.impactDays,
   order markers 150 days (src/retention.js sweeps). Attribution starts the
   day the tagged theme is live: until then the beacons count and the scan
   finds only Deck Builder lines. */

import { adminGql } from "./price-history.js";
import { RETENTION } from "./access-log.js";
import { BASE, shell, esc, when } from "./stage-ui.js";

export const IMPACT_DO = "impact";
export const TOOLS = {
  "paint-sheet": "Paint sheet (bottle sheet)",
  "paint-picker": "Paint picker (colour picker page)",
  "eavy": "'Eavy paint lists (Paint it like the box)",
  "quick-add": "Quick add button on product cards",
  "card-finder": "Card finder",
  "card-scan": "Card scanner (camera)",
  "ticker": "Fresh to the shelf ticker",
  "new-today": "New Today strip",
  "gunpla-guide": "Gunpla guide",
  "sleeves": "Sleeves guide",
  "games-like": "Games like this (product tab)",
  "learn": "Learn to play",
  "deck": "Deck Builder",
};
export const EVENTS = ["open", "add"];
export const PAINT_RE = /paint|primer|wash|shade|contrast|speedpaint|xpress|varnish|medium|\bink\b/i;
const DAY = 864e5;
const BACKFILL_DAYS = 120;
const PAGES_PER_TICK = 8;
const TICK_GAP_MS = 10 * 60e3;
const MARKER_DAYS = 150;
const ATL = "America/Halifax";
const noStore = { "cache-control": "no-store" };
const json = (o, status) => Response.json(o, { status: status || 200, headers: noStore });

export const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: ATL });
/* The Monday that starts the Atlantic week holding ms, as YYYY-MM-DD. */
export function weekOf(ms) {
  const [y, m, d] = dayOf(ms).split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d));
  u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7));
  return u.toISOString().slice(0, 10);
}
const money = (c) => "$" + (Math.round(c || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const cents = (set) => Math.round(parseFloat((set && set.shopMoney && set.shopMoney.amount) || "0") * 100);

/* Which tool put a line in the cart: _xg = <tool>, or the Deck Builder's older _deck. */
export function toolOf(line) {
  const attrs = (line && line.customAttributes) || [];
  const xg = attrs.find((a) => a && a.key === "_xg");
  if (xg && TOOLS[String(xg.value)]) return String(xg.value);
  if (attrs.some((a) => a && a.key === "_deck")) return "deck";
  return null;
}

/* One order -> what it contributes (cancelled orders contribute nothing). */
export function attribute(order) {
  const out = { name: String(order.name || ""), at: Date.parse(order.createdAt) || 0, cancelled: !!order.cancelledAt, allCents: cents(order.totalPriceSet), tools: {}, paint: { units: 0, cents: 0 } };
  if (out.cancelled) return out;
  for (const li of (order.lineItems && order.lineItems.nodes) || []) {
    const t = toolOf(li), c = cents(li.discountedTotalSet || li.originalTotalSet), q = li.quantity | 0;
    if (t) { const x = out.tools[t] = out.tools[t] || { units: 0, cents: 0 }; x.units += q; x.cents += c; }
    if (PAINT_RE.test(String((li.product && li.product.productType) || ""))) { out.paint.units += q; out.paint.cents += c; }
  }
  return out;
}

/* ---- the DO side ---------------------------------------------------------- */

async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const scanOf = async (cx) => (await cx.storage.get("imp:scan")) || { startAt: 0, since: null, scanAt: 0, pages: 0, orders: 0, tagged: 0, done: false, lastError: null };
const fresh = () => ({ open: 0, add: 0, orders: 0, units: 0, cents: 0 });

export async function impactDoFetch(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  if (p === "/_imp/hit" && post) {
    const b = await bodyOf(request);
    const tool = String(b.tool || ""), ev = String(b.ev || "");
    if (!TOOLS[tool] || !EVENTS.includes(ev)) return json({ ok: false, error: "unknown tool or event" }, 400);
    const key = "imp:d:" + dayOf(cx.now());
    const row = (await cx.storage.get(key)) || { tools: {} };
    const t = row.tools[tool] = row.tools[tool] || fresh();
    t[ev]++;
    await cx.storage.put(key, row);
    return json({ ok: true });
  }
  // The scan's harvest: orders already attributed by the worker, each counted once.
  if (p === "/_imp/orders" && post) {
    const b = await bodyOf(request);
    const now = cx.now();
    let added = 0, tagged = 0;
    for (const o of Array.isArray(b.orders) ? b.orders : []) {
      if (!o || !o.name || !(o.at > 0)) continue;
      const mk = "imp:o:" + o.name;
      if (await cx.storage.get(mk)) continue;
      await cx.storage.put(mk, o.at);
      added++;
      if (o.cancelled) continue;
      const tools = Object.keys(o.tools || {});
      if (tools.length) {
        tagged++;
        const dk = "imp:d:" + dayOf(o.at);
        const row = (await cx.storage.get(dk)) || { tools: {} };
        for (const t of tools) { const x = row.tools[t] = row.tools[t] || fresh(); x.orders++; x.units += o.tools[t].units | 0; x.cents += o.tools[t].cents | 0; }
        await cx.storage.put(dk, row);
      }
      const wk = "imp:w:" + weekOf(o.at);
      const w = (await cx.storage.get(wk)) || { orders: 0, cents: 0, paintOrders: 0, paintUnits: 0, paintCents: 0 };
      w.orders++; w.cents += o.allCents | 0;
      if (o.paint && o.paint.units > 0) { w.paintOrders++; w.paintUnits += o.paint.units | 0; w.paintCents += o.paint.cents | 0; }
      await cx.storage.put(wk, w);
    }
    const scan = { ...(await scanOf(cx)), ...(b.scan || {}), orders: (await scanOf(cx)).orders + added, tagged: (await scanOf(cx)).tagged + tagged, scanAt: now };
    await cx.storage.put("imp:scan", scan);
    return json({ ok: true, added, tagged, scan });
  }
  if (p === "/_imp/scan" && post) { const scan = { ...(await scanOf(cx)), ...(await bodyOf(request)) }; await cx.storage.put("imp:scan", scan); return json({ ok: true, scan }); }
  if (p === "/_imp/scan") return json({ ok: true, scan: await scanOf(cx) });
  if (p === "/_imp/report") {
    const now = cx.now();
    const days = await cx.storage.list({ prefix: "imp:d:" });
    const windows = { 7: {}, 30: {}, 90: {} };
    for (const [k, v] of days) {
      const day = k.slice(6), age = (now - Date.parse(day + "T12:00:00Z")) / DAY;
      for (const n of [7, 30, 90]) {
        if (age > n) continue;
        for (const [t, x] of Object.entries((v && v.tools) || {})) { const a = windows[n][t] = windows[n][t] || fresh(); for (const f of Object.keys(a)) a[f] += x[f] | 0; }
      }
    }
    const weeks = [...(await cx.storage.list({ prefix: "imp:w:" }))].map(([k, v]) => ({ week: k.slice(6), ...v })).sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, 20);
    const daily = [...days].map(([k, v]) => ({ day: k.slice(6), tools: v.tools })).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 14);
    return json({ ok: true, windows, weeks, daily, scan: await scanOf(cx), tools: TOOLS, now });
  }
  if (p === "/_imp/sweep" && post) {
    const now = cx.now(), gone = [];
    for (const [prefix, keep] of [["imp:d:", RETENTION.impactDays], ["imp:w:", RETENTION.impactDays]]) {
      for (const k of (await cx.storage.list({ prefix })).keys()) if (now - Date.parse(k.slice(6) + "T12:00:00Z") > keep * DAY) gone.push(k);
    }
    for (const [k, v] of await cx.storage.list({ prefix: "imp:o:" })) if (!v || now - v > MARKER_DAYS * DAY) gone.push(k);
    for (let i = 0; i < gone.length; i += 128) await cx.storage.delete(gone.slice(i, i + 128));
    return json({ ok: true, counts: { rows: gone.filter((k) => !k.startsWith("imp:o:")).length, markers: gone.filter((k) => k.startsWith("imp:o:")).length } });
  }
  if (p === "/_imp/health") {
    const scan = await scanOf(cx);
    return json({ ok: true, days: (await cx.storage.list({ prefix: "imp:d:" })).size, weeks: (await cx.storage.list({ prefix: "imp:w:" })).size, orders: scan.orders, tagged: scan.tagged, since: scan.since, scanAt: scan.scanAt, done: scan.done, lastError: scan.lastError });
  }
  return json({ ok: false, error: "no such path" }, 404);
}

/* ---- worker side ---------------------------------------------------------- */

const ORIGIN = "https://exor-binder.internal";
async function doCall(env, path, body) {
  const r = await env.ROOM.get(env.ROOM.idFromName(IMPACT_DO)).fetch(new Request(ORIGIN + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}));
  return r.json();
}
export const impactConfigured = (env) => !!(env && env.SHOPIFY_ADMIN_TOKEN);

const ORDERS_Q = `query($q:String!,$after:String){orders(first:50,query:$q,after:$after,reverse:false){nodes{name createdAt cancelledAt totalPriceSet{shopMoney{amount}}lineItems(first:60){nodes{quantity customAttributes{key value}product{productType}originalTotalSet{shopMoney{amount}}discountedTotalSet{shopMoney{amount}}}}}pageInfo{hasNextPage endCursor}}}`;

/* The order scan: new orders since the last look (createdAt order, a few
   pages a tick), attributed here, counted once in the DO. */
export async function impactTick(env, opts) {
  const o = opts || {};
  if (!impactConfigured(env) || !env.ROOM) return null;
  const now = o.now || Date.now();
  const scan = (await doCall(env, "/_imp/scan")).scan;
  if (!o.force && now - (scan.scanAt || 0) < TICK_GAP_MS) return { skipped: "not due" };
  const startAt = scan.startAt || now - BACKFILL_DAYS * DAY;
  const since = scan.since || new Date(startAt).toISOString();
  const cx = { env, fetch: o.fetchFn || ((a, b) => fetch(a, b)) };
  const orders = []; let cursor = null, pages = 0, more = false, newest = since, error = null;
  try {
    for (;;) {
      const { data } = await adminGql(cx, ORDERS_Q, { q: "created_at:>='" + since + "'", after: cursor });
      const page = data && data.orders;
      if (!page) throw new Error("no orders in the answer");
      for (const nd of page.nodes || []) { const a = attribute(nd); orders.push(a); if (nd.createdAt > newest) newest = nd.createdAt; }
      pages++;
      more = !!(page.pageInfo && page.pageInfo.hasNextPage);
      if (!more || pages >= PAGES_PER_TICK) break;
      cursor = page.pageInfo.endCursor;
    }
  } catch (e) { error = String((e && e.message) || e).slice(0, 200); }
  const r = await doCall(env, "/_imp/orders", { orders, scan: { startAt, since: newest, pages: (scan.pages || 0) + pages, done: !error && !more, lastError: error, cost: null } });
  return { ran: true, pages, orders: orders.length, added: r.added, tagged: r.tagged, more, done: !error && !more, error };
}

/* POST /impact {tool, ev}: the counts-only beacon from the storefront. */
export async function serveImpact(request, env, url, ctx) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", ...noStore };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers: cors });
  let b = {}; try { b = JSON.parse((await request.text()) || "{}") || {}; } catch {}
  const tool = String(b.tool || "").slice(0, 24), ev = String(b.ev || "").slice(0, 8);
  if (!TOOLS[tool] || !EVENTS.includes(ev) || !env.ROOM) return new Response(null, { status: 204, headers: cors });
  const p = doCall(env, "/_imp/hit", { tool, ev }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  return new Response(null, { status: 204, headers: cors });
}

/* ---- staff page ----------------------------------------------------------- */

export async function serveImpactStaff(request, env, url, user, form, h) {
  const { html, redirect, q, toLogin, opts, fetchFn } = h;
  const p = url.pathname, R = BASE + "/impact";
  if (p === R + "/health") return json(await doCall(env, "/_imp/health"));
  if (!user) return toLogin();
  if (user.role !== "admin") return html(shell("Impact", `<h1>Admins only</h1><p class="muted">The sales impact page is for admin accounts.</p>`, opts, true), 403);
  if (p === R + "/control" && request.method === "POST") {
    const action = String((form && form.action) || "");
    if (action === "scan") { const t = await impactTick(env, { force: true, fetchFn }); return redirect(R + q(t && t.error ? { err: "Scan: " + t.error } : { msg: "Scanned " + ((t && t.orders) || 0) + " orders (" + ((t && t.tagged) || 0) + " with tool lines)" + (t && t.more ? "; more next tick" : "") })); }
    return redirect(R + q({ err: "unknown action" }));
  }
  const rep = await doCall(env, "/_imp/report");
  if (p === R + ".json") return json(rep);
  return html(renderImpact({ ...opts, rep }));
}

export function renderImpact(o) {
  const rep = o.rep || {}, W = rep.windows || {}, scan = rep.scan || {};
  const table = (n) => {
    const rows = Object.keys(TOOLS).map((k) => ({ k, label: TOOLS[k], ...(W[n] && W[n][k] ? W[n][k] : fresh()) })).filter((r) => r.open || r.add || r.orders);
    if (!rows.length) return `<p class="muted">Nothing yet in the last ${n} days.</p>`;
    rows.sort((a, b) => b.cents - a.cents || b.add - a.add);
    const tot = rows.reduce((a, r) => ({ open: a.open + r.open, add: a.add + r.add, orders: a.orders + r.orders, units: a.units + r.units, cents: a.cents + r.cents }), fresh());
    const line = (r) => `<tr><td>${esc(r.label)}<small>${esc(r.k)}</small></td><td class="n">${r.open}</td><td class="n">${r.add}</td><td class="n">${r.orders}</td><td class="n">${r.units}</td><td class="n">${esc(money(r.cents))}</td><td class="n">${r.add ? Math.round(100 * r.orders / r.add) + "%" : "-"}</td></tr>`;
    return `<table class="users"><thead><tr><th>Tool</th><th class="n">Opened</th><th class="n">Added to cart</th><th class="n">Orders</th><th class="n">Units</th><th class="n">Revenue</th><th class="n">Cart &rarr; order</th></tr></thead><tbody>${rows.map(line).join("")}<tr><td><b>All tools</b></td><td class="n"><b>${tot.open}</b></td><td class="n"><b>${tot.add}</b></td><td class="n"><b>${tot.orders}</b></td><td class="n"><b>${tot.units}</b></td><td class="n"><b>${esc(money(tot.cents))}</b></td><td class="n"></td></tr></tbody></table>`;
  };
  const weeks = (rep.weeks || []).map((w) => `<tr><td>${esc(w.week)}</td><td class="n">${w.paintUnits || 0}</td><td class="n">${esc(money(w.paintCents))}</td><td class="n">${w.paintOrders || 0}</td><td class="n">${w.orders || 0}</td><td class="n">${w.orders ? (100 * (w.paintOrders || 0) / w.orders).toFixed(1) + "%" : "-"}</td><td class="n">${esc(money(w.cents))}</td></tr>`).join("");
  const body = `<h1>Sales impact of the site tools</h1>
<p class="muted">What each storefront tool put in carts and what became orders. Lines a tool adds carry a hidden marker on the order; the counts of opens and adds come from the tools themselves. Nothing about the customer is recorded. Attribution starts the day the tagged theme is live; the Deck Builder has been tagged since September 22.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="card"><div class="hz"><h3 style="margin:0">Order scan</h3><form method="post" action="${BASE}/impact/control"><input type="hidden" name="action" value="scan"><button type="submit">Scan now</button></form></div>
<p class="muted">${scan.scanAt ? "Last scan " + esc(when(scan.scanAt)) + " Atlantic; " : "No scan yet; "}${scan.orders || 0} orders read since ${scan.startAt ? esc(when(scan.startAt).slice(0, 12)) : "the start"}, ${scan.tagged || 0} with tool lines${scan.done ? "; caught up (new orders every 10 minutes)" : "; still backfilling, a few hundred orders every 10 minutes"}.${scan.lastError ? " Last error: " + esc(scan.lastError) : ""}</p></div>
<div class="card"><h3>Last 7 days</h3>${table(7)}</div>
<div class="card"><h3>Last 30 days</h3>${table(30)}</div>
<div class="card"><h3>Last 90 days</h3>${table(90)}</div>
<div class="card"><h3>Paints by week</h3><p class="muted">Every order with a paint, primer, wash, contrast or varnish line (by product type), week by week from the Monday shown, against all orders. Read the weeks before and after a paint tool went live side by side; a lift that stays is the tool's.</p>
${weeks ? `<table class="users"><thead><tr><th>Week of</th><th class="n">Paint units</th><th class="n">Paint revenue</th><th class="n">Orders with paint</th><th class="n">All orders</th><th class="n">Share</th><th class="n">All revenue</th></tr></thead><tbody>${weeks}</tbody></table>` : `<p class="muted">No weeks yet; the scan fills these in.</p>`}</div>`;
  return shell("Impact", body, o, true);
}
