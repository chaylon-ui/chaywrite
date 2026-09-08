/* ---------------- Hold on arrival, stage 1: SHADOW ----------------
   The problem (owner, 2026-09-08): when staff complete a buylist or a POS
   buy cart in BinderPOS, the customer is paid and the cards go straight
   into Shopify's available stock, so the website can sell them before the
   card room has filed or inspected them. The eventual mechanism moves the
   new units from "available" into Shopify's "quality_control" state until
   the card room releases them. Proved by hand on 2026-09-05 with one unit of
   a bulk common: BinderPOS follows Shopify's available number (it showed
   the held unit as gone), a BinderPOS stock write left the held unit alone,
   and the reverse move put everything back.

   This stage moves NOTHING. It listens to two Shopify webhooks and writes
   down what the live version would have done, so a week or two of real
   trading can be checked against BinderPOS's own cart pages first:

     orders/create            BinderPOS makes a Shopify order for every POS
                              cart. Its note names the cart number, the
                              tenders, and whether the customer sold cards
                              to the store ("--- Items sold to store ---",
                              with the bought total as a negative discount).
                              The bought cards themselves are not line items.
     inventory_levels/update  every stock change, per inventory item. The
                              payload is a hint; the real numbers and the
                              product come from the Admin token.

   The decision the live version would take, recorded per stock rise on a
   product whose type contains "Single" (BinderPOS's singles types):
     cart     a BinderPOS buy order within the window       -> would hold
     buylist  a buylist this worker submitted lists the card -> would hold
     none     no cart, no buylist (product-page edit, return) -> would not
   The two webhooks can arrive in either order, so rises with no cart are
   looked at again when a buy order arrives just after them.

   Own Durable Object instance (HOLD_DO), same arrangement as the price and
   enrichment jobs. Storage:
     hv:<item>          last seen available quantity per inventory item
     hi:<item>          product, variant, sku, type for the item (7 days)
     ho:<orderId>       BinderPOS orders (30 days)
     hb:<number>        buylists submitted through /buylist (30 days)
     hd:<ts>-<item>     the shadow log, one record per rise (30 days)
     hold:counters      running counts; hold:hooks the subscription check
   /hold/shadow (staff PIN) renders the log; /hold/shadow.json is the data;
   /hold/health is counts only. Nothing here changes inventory. */

export const HOLD_DO = "buylist-hold";
export const HOLD_MODE = "shadow";
// Measured on the first real cart (32640862, 2026-09-08): BinderPOS created
// the order, then pushed the bought cards' stock 175 to 205 seconds later,
// about one card every ten seconds. So the order may come well before its
// rises; a rise a little before the order is allowed for too.
export const ORDER_LEAD_MS = 600e3;   // a cart's order may come before its stock rises by this much
export const ORDER_LAG_MS = 240e3;    // or after them by this much
const KEEP_MS = 30 * 86400e3;
const INFO_TTL_MS = 7 * 86400e3;
const HOOKS_EVERY_MS = 6 * 3600e3;
const READS_PER_MIN = 60;             // Admin reads per minute; bulk syncs beyond that go unverified
const SINGLE_RE = /single/i;
const PORTAL_CART = "https://portal.binderpos.com/#/pointOfSale/carts/";

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "").slice(0, 24);
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }

/* ---------------- pure helpers (test/hold.test.mjs) ---------------- */

// What BinderPOS writes into the Shopify order's note for a POS cart.
export function parseCartNote(note) {
  const s = String(note || "");
  const cart = (s.match(/BinderPOS Cart #\s*(\d+)/i) || [])[1] || null;
  const bought = /Items sold to store/i.test(s);
  const boughtTotal = (s.match(/bought items\s*-*\s*\n+\s*\$?\s*(-?[\d,]+\.?\d*)/i) || [])[1] || null;
  const tenders = [];
  const m = s.match(/---\s*Tenders\s*---\s*\n([\s\S]*?)(?:\n\s*---|$)/i);
  if (m) for (const line of m[1].split("\n")) { const t = line.trim(); if (t) tenders.push(t.slice(0, 80)); }
  return { cart, bought, boughtTotal, tenders: tenders.slice(0, 6) };
}

// A submitted buylist's card against the product a rise landed on.
export function cardMatches(c, rec) {
  if (!c || !rec) return false;
  const title = norm(rec.title);
  if (!title || title !== norm((c.n || "") + " [" + (c.s || "") + "]")) return false;
  const cond = norm(c.c);
  if (!cond) return true;
  const vt = norm(rec.variantTitle);
  return vt.indexOf(cond) === 0 && /foil/.test(vt) === /foil/i.test(c.t || "");
}

// The decision for one rise, given the BinderPOS buy orders and the
// submitted buylists known at the time. Mutates and returns rec.
export function attribute(rec, orders, buylists) {
  const near = (orders || [])
    .filter((o) => o && o.bought && o.ts >= rec.ts - ORDER_LEAD_MS && o.ts <= rec.ts + ORDER_LAG_MS)
    .sort((a, b) => Math.abs(a.ts - rec.ts) - Math.abs(b.ts - rec.ts))[0];
  if (near) {
    rec.decision = "hold"; rec.reason = "cart"; rec.cart = near.cart; rec.order = near.name; rec.orderId = near.id;
    rec.offset = Math.round((rec.ts - near.ts) / 1000);
    return rec;
  }
  const bl = (buylists || []).find((b) => b && (b.cards || []).some((c) => cardMatches(c, rec)));
  if (bl) { rec.decision = "hold"; rec.reason = "buylist"; rec.buylist = bl.number; return rec; }
  rec.decision = "skip"; rec.reason = "none";
  return rec;
}

/* ---------------- the DO side ---------------- */

export async function holdDoFetch(cx, request, url) {
  if (url.pathname === "/_hold/control" && request.method === "POST") return doJson(await control(cx, await bodyOf(request), url.origin));
  const st = await stateOf(cx);
  if (url.pathname === "/_hold/status") return doJson(await statusOf(cx, url, st));
  if (url.pathname === "/_hold/health") return doJson(await healthOf(cx, st));
  if (st.removed || st.paused) return doJson({ ok: true, ignored: st.removed ? "removed" : "paused" });
  if (!cx.mem.origin) { cx.mem.origin = url.origin; try { await cx.storage.put("hold:origin", url.origin); } catch {} }
  await armAlarm(cx);
  if (url.pathname === "/_hold/inv" && request.method === "POST") return doJson(await onInventory(cx, await bodyOf(request)));
  if (url.pathname === "/_hold/order" && request.method === "POST") return doJson(await onOrder(cx, await bodyOf(request)));
  if (url.pathname === "/_hold/buylist" && request.method === "POST") return doJson(await onBuylist(cx, await bodyOf(request)));
  return doJson({ ok: false, error: "not found" }, 404);
}

// Paused: the webhooks still arrive and are ignored. Removed: the order
// webhook is unsubscribed, the storage wiped, and nothing is recorded
// until resumed. Both are staff buttons on the shadow page.
async function stateOf(cx) {
  if (cx.mem.state && cx.now() - cx.mem.state.at < 30e3) return cx.mem.state;
  const [paused, removed] = await Promise.all([cx.storage.get("hold:paused"), cx.storage.get("hold:removed")]);
  cx.mem.state = { at: cx.now(), paused: !!paused, removed: !!removed };
  return cx.mem.state;
}

async function control(cx, b, origin) {
  const action = String((b && b.action) || "");
  if (action === "pause") {
    await cx.storage.put("hold:paused", cx.now());
    cx.mem.state = null;
    return { ok: true, paused: true };
  }
  if (action === "resume") {
    await cx.storage.delete(["hold:paused", "hold:removed"]);
    cx.mem.state = null;
    if (origin) { cx.mem.origin = origin; await cx.storage.put("hold:origin", origin); }
    try { await cx.storage.setAlarm(cx.now() + 5e3); } catch {}
    return { ok: true, resumed: true };
  }
  if (action === "remove") {
    let orderHook = "not checked";
    try { orderHook = await dropOrderHook(cx); } catch (e) { orderHook = "failed: " + ((e && e.message) || e); }
    await cx.storage.deleteAll();
    try { await cx.storage.deleteAlarm(); } catch {}
    await cx.storage.put("hold:removed", cx.now());
    for (const k of Object.keys(cx.mem)) delete cx.mem[k];
    return { ok: true, removed: true, orderHook };
  }
  return { ok: false, error: "action must be pause, resume or remove" };
}

// The orders/create subscription is this stage's own; the inventory one
// predates it (the New Today strip) and stays.
async function dropOrderHook(cx) {
  const j = await cx.adminGql(`{webhookSubscriptions(first:50,topics:[ORDERS_CREATE]){edges{node{id endpoint{... on WebhookHttpEndpoint{callbackUrl}}}}}}`);
  const edges = (j && j.webhookSubscriptions && j.webhookSubscriptions.edges) || [];
  let n = 0;
  for (const e of edges) {
    const node = e && e.node;
    if (!node || !node.endpoint || !/\/hook\/order$/.test(node.endpoint.callbackUrl || "")) continue;
    const r = await cx.adminGql(`mutation($id:ID!){webhookSubscriptionDelete(id:$id){userErrors{message}}}`, { id: node.id });
    if (r && !((r.webhookSubscriptionDelete && r.webhookSubscriptionDelete.userErrors) || []).length) n++;
  }
  return n + " unsubscribed";
}

export async function holdDoAlarm(cx) {
  const st = await stateOf(cx);
  if (st.removed) return;
  try { await ensureHooks(cx); } catch (e) { cx.log("hold: hooks: " + ((e && e.message) || e)); }
  try { await prune(cx); } catch (e) { cx.log("hold: prune: " + ((e && e.message) || e)); }
  try { await cx.storage.setAlarm(cx.now() + HOOKS_EVERY_MS); } catch {}
}

async function armAlarm(cx) {
  try { if ((await cx.storage.getAlarm()) == null) await cx.storage.setAlarm(cx.now() + 60e3); } catch {}
}

async function bump(cx, name, n) {
  const c = (await cx.storage.get("hold:counters")) || {};
  c[name] = (c[name] || 0) + (n == null ? 1 : n);
  await cx.storage.put("hold:counters", c);
}

function budgetOk(cx) {
  const m = Math.floor(cx.now() / 60000);
  if (cx.mem.budgetMin !== m) { cx.mem.budgetMin = m; cx.mem.budgetUsed = 0; }
  if (cx.mem.budgetUsed >= READS_PER_MIN) return false;
  cx.mem.budgetUsed++;
  return true;
}

// One stock change. The payload's available quantity is enough to see a
// rise (the previous value is remembered per item); everything else about
// a rise is read back from Shopify.
async function onInventory(cx, b) {
  const item = digits(b.item);
  const available = Number(b.available);
  if (!item || !Number.isFinite(available)) return { ok: false };
  const now = cx.now();
  const prev = await cx.storage.get("hv:" + item);
  await cx.storage.put("hv:" + item, available);
  if (typeof prev !== "number") {
    // First sight of this item: no baseline, so a rise cannot be measured.
    // If a buy cart or a submitted buylist is in the window it is still
    // written down as a probable one, delta unknown, so the cart comparison
    // stays complete during the shadow weeks. (The live stage needs real
    // baselines loaded for every single first.)
    await bump(cx, "baselines");
    if (available > 0) {
      const info = await itemInfo(cx, item);
      if (info && SINGLE_RE.test(info.type || "")) {
        const rec = attribute({
          ts: now, item, delta: null, before: null, after: available, firstSight: true,
          v: info.variantId, sku: info.sku, title: info.title, variantTitle: info.variantTitle, type: info.type, handle: info.handle,
          single: true, verified: null, decision: "skip", reason: "none",
        }, await recentOrders(cx), await recentBuylists(cx));
        if (rec.decision === "hold") {
          rec.decision = "hold?";
          await cx.storage.put("hd:" + tsKey(now) + "-" + item, rec);
          await bump(cx, "firstSightInWindow");
        }
      }
    }
    return { ok: true, baseline: true };
  }
  const delta = available - prev;
  if (delta <= 0) { await bump(cx, delta < 0 ? "falls" : "unchanged"); return { ok: true, delta }; }
  await bump(cx, "rises");
  const info = await itemInfo(cx, item);
  const single = !!(info && SINGLE_RE.test(info.type || ""));
  const rec = {
    ts: now, item, delta, before: prev, after: available,
    v: info && info.variantId, sku: info && info.sku, title: info && info.title, variantTitle: info && info.variantTitle,
    type: info && info.type, handle: info && info.handle, single, verified: null,
    decision: "skip", reason: single ? "none" : "not-single",
  };
  if (single) {
    const lvl = budgetOk(cx) ? await readLevel(cx, item, b.location) : null;
    if (lvl) { rec.verified = lvl.available === available; rec.onHand = lvl.onHand; rec.qc = lvl.qc; rec.avail = lvl.available; }
    attribute(rec, await recentOrders(cx), await recentBuylists(cx));
  }
  await cx.storage.put("hd:" + tsKey(now) + "-" + item, rec);
  await bump(cx, rec.decision === "hold" ? "wouldHold" + (rec.reason === "cart" ? "Cart" : "Buylist") : (single ? "skipNoSource" : "skipNotSingle"));
  return { ok: true, rec };
}

// A new order. Only BinderPOS's cart orders matter; they are read back
// from Shopify (the webhook is a hint), and rises that came just before a
// buy order and found no cart are attributed to it now.
async function onOrder(cx, b) {
  const id = digits(b.id);
  if (!id) return { ok: false };
  if (await cx.storage.get("ho:" + id)) return { ok: true, dup: true };
  const j = await cx.adminGql(`query($id:ID!){order(id:$id){id name createdAt note sourceName app{name} customer{id displayName} customAttributes{key value} totalPriceSet{shopMoney{amount}} lineItems(first:30){nodes{title quantity}}}}`,
    { id: "gid://shopify/Order/" + id });
  const o = j && j.order;
  if (!o) return { ok: false, error: "order not readable" };
  const parsed = parseCartNote(o.note);
  const attr = (o.customAttributes || []).find((a) => a && a.key === "external_order_id");
  const cart = parsed.cart || (attr && digits(attr.value)) || null;
  if (!cart && !/binderpos/i.test((o.app && o.app.name) || "")) { await bump(cx, "ordersOther"); return { ok: true, ignored: "not a BinderPOS cart" }; }
  const rec = {
    id, name: o.name, ts: Date.parse(o.createdAt) || cx.now(), cart, bought: parsed.bought, boughtTotal: parsed.boughtTotal,
    tenders: parsed.tenders, customer: (o.customer && o.customer.displayName) || "", customerId: digits(o.customer && o.customer.id),
    total: o.totalPriceSet && o.totalPriceSet.shopMoney && o.totalPriceSet.shopMoney.amount,
    sold: ((o.lineItems && o.lineItems.nodes) || []).slice(0, 12).map((li) => li.title + " ×" + li.quantity),
  };
  await cx.storage.put("ho:" + id, rec);
  if (cx.mem.orders) cx.mem.orders.push(rec);
  await bump(cx, rec.bought ? "cartsWithBuys" : "cartsSalesOnly");
  let fixed = 0;
  if (rec.bought) {
    const l = await cx.storage.list({ prefix: "hd:", start: "hd:" + tsKey(rec.ts - ORDER_LAG_MS), end: "hd:" + tsKey(rec.ts + ORDER_LEAD_MS) + "~" });
    const puts = {};
    for (const [k, d] of l) {
      if (!d || !d.single || d.reason !== "none") continue;
      attribute(d, [rec], []);
      if (d.reason === "cart") { d.late = true; puts[k] = d; fixed++; }
    }
    if (fixed) { await cx.storage.put(puts); await bump(cx, "wouldHoldCart", fixed); await bump(cx, "skipNoSource", -fixed); }
  }
  return { ok: true, rec, reattributed: fixed };
}

// A buylist our page just submitted to BinderPOS: the cards it listed,
// so their arrival can be attributed when staff complete it.
async function onBuylist(cx, b) {
  const number = digits(b.number) || "t" + cx.now();
  const cards = Array.isArray(b.cards) ? b.cards.slice(0, 100).map((c) => ({
    n: String((c && c.n) || "").slice(0, 120), s: String((c && c.s) || "").slice(0, 120),
    c: String((c && c.c) || "").slice(0, 40), t: String((c && c.t) || "").slice(0, 40), q: parseInt(c && c.q, 10) || 1,
  })) : [];
  if (!cards.length) return { ok: false };
  const rec = { number, ts: cx.now(), customer: digits(b.customer), paymentType: String(b.paymentType || "").slice(0, 20), cards };
  await cx.storage.put("hb:" + number, rec);
  if (cx.mem.buylists) cx.mem.buylists.push(rec);
  await bump(cx, "buylistsSubmitted");
  return { ok: true, number, cards: cards.length };
}

async function itemInfo(cx, item) {
  const key = "hi:" + item;
  const c = await cx.storage.get(key);
  if (c && cx.now() - (c.at || 0) < INFO_TTL_MS) return c;
  if (!budgetOk(cx)) return c || null;
  const j = await cx.adminGql(`query($id:ID!){inventoryItem(id:$id){sku variant{id title product{title productType handle}}}}`,
    { id: "gid://shopify/InventoryItem/" + item });
  const v = j && j.inventoryItem && j.inventoryItem.variant;
  if (!v) return c || null;
  const info = {
    at: cx.now(), sku: j.inventoryItem.sku || "", variantId: v.id || "", variantTitle: v.title || "",
    title: (v.product && v.product.title) || "", type: (v.product && v.product.productType) || "", handle: (v.product && v.product.handle) || "",
  };
  await cx.storage.put(key, info);
  return info;
}

async function readLevel(cx, item, location) {
  const loc = digits(location);
  const q = loc
    ? `query($id:ID!,$loc:ID!){inventoryItem(id:$id){inventoryLevel(locationId:$loc){quantities(names:["available","on_hand","quality_control"]){name quantity}}}}`
    : `query($id:ID!){inventoryItem(id:$id){inventoryLevels(first:1){nodes{quantities(names:["available","on_hand","quality_control"]){name quantity}}}}}`;
  const vars = loc ? { id: "gid://shopify/InventoryItem/" + item, loc: "gid://shopify/Location/" + loc } : { id: "gid://shopify/InventoryItem/" + item };
  const j = await cx.adminGql(q, vars);
  const it = j && j.inventoryItem;
  const lvl = it && (it.inventoryLevel || (it.inventoryLevels && it.inventoryLevels.nodes && it.inventoryLevels.nodes[0]));
  if (!lvl) return null;
  const out = {};
  for (const x of lvl.quantities || []) out[x.name] = x.quantity;
  return { available: out.available, onHand: out.on_hand, qc: out.quality_control };
}

async function recentOrders(cx) {
  if (!cx.mem.orders) {
    const l = await cx.storage.list({ prefix: "ho:", limit: 1000 });
    cx.mem.orders = [...l.values()].filter(Boolean);
  }
  const cutoff = cx.now() - KEEP_MS;
  return cx.mem.orders.filter((o) => o.ts >= cutoff);
}

async function recentBuylists(cx) {
  if (!cx.mem.buylists) {
    const l = await cx.storage.list({ prefix: "hb:", limit: 1000 });
    cx.mem.buylists = [...l.values()].filter(Boolean);
  }
  const cutoff = cx.now() - KEEP_MS;
  return cx.mem.buylists.filter((b) => b.ts >= cutoff).sort((a, b) => b.ts - a.ts);
}

// The two webhooks this stage needs, created under the worker's own app
// if missing (the inventory one already exists from the New Today strip).
async function ensureHooks(cx) {
  const origin = cx.mem.origin || (await cx.storage.get("hold:origin"));
  if (!origin || !cx.env.SHOPIFY_ADMIN_TOKEN) return;
  const want = { ORDERS_CREATE: origin + "/hook/order", INVENTORY_LEVELS_UPDATE: origin + "/hook/inv" };
  const j = await cx.adminGql(`{webhookSubscriptions(first:50){edges{node{topic endpoint{... on WebhookHttpEndpoint{callbackUrl}}}}}}`);
  if (!j) { await cx.storage.put("hold:hooks", { at: cx.now(), error: "could not list subscriptions" }); return; }
  const have = {};
  for (const e of (j.webhookSubscriptions && j.webhookSubscriptions.edges) || []) {
    const n = e && e.node;
    if (n && n.endpoint && n.endpoint.callbackUrl) (have[n.topic] = have[n.topic] || []).push(n.endpoint.callbackUrl);
  }
  const created = [], errors = [];
  for (const [topic, cb] of Object.entries(want)) {
    if ((have[topic] || []).includes(cb)) continue;
    const r = await cx.adminGql(`mutation($cb:URL!){webhookSubscriptionCreate(topic:${topic},webhookSubscription:{callbackUrl:$cb,format:JSON}){userErrors{message}}}`, { cb });
    const errs = (r && r.webhookSubscriptionCreate && r.webhookSubscriptionCreate.userErrors) || [];
    if (r && !errs.length) { created.push(topic); (have[topic] = have[topic] || []).push(cb); }
    else errors.push(topic + ": " + (errs.map((e) => e.message).join("; ") || "no reply"));
  }
  await cx.storage.put("hold:hooks", {
    at: cx.now(), origin,
    orders: (have.ORDERS_CREATE || []).includes(want.ORDERS_CREATE),
    inventory: (have.INVENTORY_LEVELS_UPDATE || []).includes(want.INVENTORY_LEVELS_UPDATE),
    created, errors,
  });
}

async function prune(cx) {
  const cutoff = cx.now() - KEEP_MS;
  const dead = [];
  const old = await cx.storage.list({ prefix: "hd:", end: "hd:" + tsKey(cutoff), limit: 500 });
  dead.push(...old.keys());
  for (const prefix of ["ho:", "hb:"]) {
    const l = await cx.storage.list({ prefix, limit: 1000 });
    for (const [k, v] of l) if (!v || (v.ts || 0) < cutoff) dead.push(k);
  }
  for (let i = 0; i < dead.length; i += 100) await cx.storage.delete(dead.slice(i, i + 100));
  cx.mem.orders = null; cx.mem.buylists = null;
}

const modeOf = (st) => (st.removed ? "removed" : st.paused ? "paused" : HOLD_MODE);

async function healthOf(cx, st) {
  const hooks = (await cx.storage.get("hold:hooks")) || null;
  return { ok: true, mode: modeOf(st), counters: (await cx.storage.get("hold:counters")) || {}, hooks: hooks && { at: hooks.at, orders: !!hooks.orders, inventory: !!hooks.inventory, errors: hooks.errors || [] } };
}

async function statusOf(cx, url, st) {
  const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days"), 10) || 7));
  const since = cx.now() - days * 86400e3;
  const l = await cx.storage.list({ prefix: "hd:", start: "hd:" + tsKey(since), limit: 2000 });
  const decisions = [...l.values()].filter(Boolean).sort((a, b) => b.ts - a.ts);
  const orders = (await recentOrders(cx)).filter((o) => o.ts >= since).sort((a, b) => b.ts - a.ts);
  const buylists = (await recentBuylists(cx)).filter((b) => b.ts >= since);
  const byCart = {};
  for (const d of decisions) if (d.reason === "cart" && d.cart) (byCart[d.cart] = byCart[d.cart] || []).push(d);
  return {
    ok: true, mode: modeOf(st), days, generatedAt: cx.now(),
    windows: { orderLeadS: ORDER_LEAD_MS / 1000, orderLagS: ORDER_LAG_MS / 1000 },
    counters: (await cx.storage.get("hold:counters")) || {},
    hooks: (await cx.storage.get("hold:hooks")) || null,
    orders: orders.map((o) => ({ ...o, link: o.cart ? PORTAL_CART + o.cart : "", rises: byCart[o.cart] || [] })),
    buylists,
    decisions: decisions.slice(0, 600),
  };
}

/* ---------------- worker side: the staff page and its buttons ---------------- */

// POST /hold/control, from the page's buttons (form) or a client (JSON):
// { action: pause | resume | remove }. The worker checks the staff PIN
// (staffOk is passed in, it lives in index.js) before anything reaches the DO.
export async function serveHoldControl(request, env, url, staffOk) {
  let k = "", action = "", form = false;
  const ct = request.headers.get("content-type") || "";
  if (/json/i.test(ct)) {
    const b = await bodyOf(request);
    k = String(b.k || ""); action = String(b.action || "");
  } else {
    form = true;
    let fd; try { fd = await request.formData(); } catch { fd = null; }
    k = String((fd && fd.get("k")) || ""); action = String((fd && fd.get("action")) || "");
  }
  if (!(await staffOk(env, url.origin, k))) return Response.json({ error: "staff key required" }, { status: 403, headers: { "cache-control": "no-store" } });
  const r = await env.ROOM.get(env.ROOM.idFromName(HOLD_DO)).fetch(new Request(url.origin + "/_hold/control", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
  }));
  const text = await r.text();
  if (form) return new Response(null, { status: 303, headers: { location: "/hold/shadow?k=" + encodeURIComponent(k), "cache-control": "no-store" } });
  return new Response(text, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function serveHoldPage(request, env, url) {
  const stub = env.ROOM.get(env.ROOM.idFromName(HOLD_DO));
  if (url.pathname === "/hold/health") {
    const r = await stub.fetch(new Request(url.origin + "/_hold/health"));
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days"), 10) || 7));
  const r = await stub.fetch(new Request(url.origin + "/_hold/status?days=" + days));
  const text = await r.text();
  if (url.pathname.endsWith(".json")) return new Response(text, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  let d; try { d = JSON.parse(text); } catch { d = null; }
  const k = url.searchParams.get("k") || "";
  return new Response(renderPage(d || { ok: false }, days, k), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false }) : "";

function renderPage(d, days, k) {
  const link = (n) => `?days=${n}&k=${encodeURIComponent(k)}`;
  const c = d.counters || {};
  const rows = (list, f) => list.length ? list.map(f).join("") : '<tr><td colspan="9" class="muted">nothing yet</td></tr>';
  const riseRow = (r) => `<tr><td>${esc(when(r.ts))}</td><td>${esc(r.title)}<span class="muted"> · ${esc(r.variantTitle)}</span></td><td>${r.firstSight ? '<span class="muted">first sight, now ' + r.after + "</span>" : "+" + r.delta}</td><td>${r.firstSight ? "?" : r.before + " → " + r.after}</td><td>${esc(r.type)}</td><td>${r.offset != null ? r.offset + " s" + (r.late ? " (matched late)" : "") : ""}</td><td>${r.firstSight ? "probable" : r.verified === false ? "payload ≠ Shopify" : r.verified ? "ok" : "not re-read"}</td></tr>`;
  const orders = (d.orders || []).filter((o) => o.bought);
  const salesOnly = (d.orders || []).filter((o) => !o.bought).length;
  const none = (d.decisions || []).filter((x) => x.single && x.reason === "none");
  const notSingle = (d.decisions || []).filter((x) => !x.single).length;
  const bl = (d.decisions || []).filter((x) => x.reason === "buylist");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Hold on arrival · shadow</title>
<style>body{margin:0;padding:20px;font:14px/1.45 system-ui,sans-serif;color:#1d2327;background:#f4f6f7}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px}.muted{color:#6b7780}.tag{display:inline-block;padding:2px 8px;border-radius:99px;background:#fde68a;color:#5b4300;font-weight:600;font-size:12px;vertical-align:middle;margin-left:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde3e7;border-radius:10px;overflow:hidden;font-size:13px}th{text-align:left;padding:8px 10px;background:#eef2f4;font-weight:600}td{padding:7px 10px;border-top:1px solid #eef2f4;vertical-align:top}.cart{margin:10px 0;background:#fff;border:1px solid #dde3e7;border-radius:10px;padding:12px}.cart h3{margin:0 0 6px;font-size:15px}.kv{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0}.kv b{color:#1d2327}a{color:#0d7a5f}.wrap{max-width:1200px;margin:0 auto}</style></head><body><div class="wrap">
<h1>Hold on arrival <span class="tag">${esc(d.mode || "shadow")} · nothing is moved</span></h1>
<form method="post" action="/hold/control" class="ctl" style="margin:8px 0 12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="hidden" name="k" value="${esc(k)}">
${d.mode === "paused" || d.mode === "removed" ? '<button name="action" value="resume">Resume the shadow log</button>' : '<button name="action" value="pause">Pause the shadow log</button>'}
${d.mode === "removed" ? '<span class="muted">Removed: the order webhook is unsubscribed and the log is empty. Resume starts it again from nothing.</span>' : '<button name="action" value="remove" onclick="return confirm(\'Delete the whole shadow log and unsubscribe the order webhook? The inventory webhook stays (the New Today strip uses it).\')">Remove stage 1</button>'}
</form>
<p class="muted">Last ${days} days, Atlantic time. Every stock rise on a single is listed with the decision the live version would take. Compare each cart's rises with its BinderPOS page. <a href="${esc(link(days))}">refresh</a> · <a href="${esc(link(1))}">today</a> · <a href="${esc(link(30))}">30 days</a></p>
<div class="kv"><span>Rises seen <b>${c.rises || 0}</b></span><span>Would hold, cart <b>${c.wouldHoldCart || 0}</b></span><span>Would hold, buylist <b>${c.wouldHoldBuylist || 0}</b></span><span>Singles with no source <b>${c.skipNoSource || 0}</b></span><span>Not singles <b>${c.skipNotSingle || 0}</b></span><span>Baselines learned <b>${c.baselines || 0}</b></span><span>First sightings inside a cart window <b>${c.firstSightInWindow || 0}</b></span><span>Carts with buys <b>${c.cartsWithBuys || 0}</b></span><span>Sales-only carts <b>${c.cartsSalesOnly || 0}</b></span></div>
<p class="muted">Webhooks: ${d.hooks ? `orders ${d.hooks.orders ? "on" : "MISSING"}, inventory ${d.hooks.inventory ? "on" : "MISSING"}, checked ${esc(when(d.hooks.at))}${(d.hooks.errors || []).length ? " · errors: " + esc(d.hooks.errors.join("; ")) : ""}` : "not checked yet (first check a minute after deploy)"}. Window: a cart's order up to ${d.windows ? d.windows.orderLeadS : "?"} s before a rise or ${d.windows ? d.windows.orderLagS : "?"} s after it.</p>
<h2>Counter buys (BinderPOS carts with items sold to the store) · ${orders.length}<span class="muted"> · ${salesOnly} sales-only carts ignored</span></h2>
${orders.length ? orders.map((o) => `<div class="cart"><h3>Cart ${esc(o.cart)} <span class="muted">· ${esc(when(o.ts))} · order ${esc(o.name)} · ${esc(o.customer || "no customer")}</span> · <a href="${esc(o.link)}" target="_blank" rel="noopener">open in BinderPOS</a></h3><div class="kv"><span>Bought total <b>${esc(o.boughtTotal || "?")}</b></span><span>${esc((o.tenders || []).join(" · ") || "no tender line")}</span><span>Sold in the same cart: <b>${esc((o.sold || []).join(", ") || "nothing")}</b></span></div><table><thead><tr><th>Stock rose at</th><th>Card</th><th>Qty</th><th>Available</th><th>Type</th><th>After the order by</th><th>Re-read</th></tr></thead><tbody>${rows(o.rises || [], riseRow)}</tbody></table></div>`).join("") : '<p class="muted">No cart with buys in this period.</p>'}
<h2>Online buylists · ${bl.length} rises matched to ${(d.buylists || []).length} submitted</h2>
<table><thead><tr><th>Stock rose at</th><th>Card</th><th>Qty</th><th>Available</th><th>Type</th><th>Buylist</th><th>Re-read</th></tr></thead><tbody>${rows(bl, (r) => riseRow({ ...r, offset: null }).replace("<td></td><td>", `<td>${esc(r.buylist)}</td><td>`))}</tbody></table>
<h2>Singles that rose with no cart and no buylist · ${none.length} <span class="muted">· would NOT be held; a counter buy in here means the window is wrong</span></h2>
<table><thead><tr><th>Stock rose at</th><th>Card</th><th>Qty</th><th>Available</th><th>Type</th><th></th><th>Re-read</th></tr></thead><tbody>${rows(none.slice(0, 200), riseRow)}</tbody></table>
<p class="muted">${notSingle} rises on products that are not singles were ignored.</p>
</div></body></html>`;
}
