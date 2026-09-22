/**
 * Pull sheet v2, phase 2: the live order queue.
 *
 * Shopify order webhooks (paid / updated / cancelled / fulfilled) hit
 * POST /hook/order. The payload is only a hint: after checking its HMAC the
 * worker re-reads the order with its own token and keeps a compact record
 * under `queue:<order number>` while the order still has unfulfilled lines.
 * A dated backfill fills the queue for orders placed before the hooks
 * existed. "Make pull sheet" builds the same job the userscript builds,
 * server-side, from those records; rarity / mana / set-name enrichment is
 * cached in KV and topped up by POST /api/jobs/:id/enrich in small batches.
 */

export const HOOK_TOPICS = ['ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'ORDERS_FULFILLED'];
export const SKIP_SOURCES = ['pos'];          // sourceName values that never go on a pull sheet
const QUEUE_PREFIX = 'queue:';
const PULL_TAG = 'PULLSHEET';
const ENRICH_BUDGET = 12;                     // external lookups per /enrich call (free-plan subrequest cap is 50)

/* ───────────────────── webhook signature ───────────────────── */
export async function verifyHmac(rawBody, header, secret) {
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  let b64 = '';
  { let s = ''; for (const b of sig) s += String.fromCharCode(b); b64 = btoa(s); }
  if (b64.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < b64.length; i++) diff |= b64.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export function orderNum(idOrGid) {
  const m = /(\d+)\s*$/.exec(String(idOrGid || ''));
  return m ? m[1] : '';
}
export const orderGid = (num) => 'gid://shopify/Order/' + num;

/* ───────────────────── Shopify reads ───────────────────── */
const LI_FIELDS = `name sku quantity unfulfilledQuantity variantTitle variant { id }
  discountedUnitPriceSet { shopMoney { amount currencyCode } }
  image { url(transform: { maxWidth: 96, maxHeight: 134 }) }
  product { productType }`;
// No customer{} here: the app has no read_customers scope and Shopify errors
// on the field (seen 2026-09-22). Names come from the addresses instead.
const ORDER_FIELDS_BASE = `id name createdAt cancelledAt displayFulfillmentStatus tags sourceName
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  shippingLine { title }
  shippingAddress { name city provinceCode }
  billingAddress { name }
  lineItems(first: 250) { pageInfo { hasNextPage endCursor } edges { node { ${LI_FIELDS} } } }`;
// "Ready for pickup" is a fulfillment in READY_FOR_PICKUP display state: those
// orders are already pulled and must not be queued (owner, 2026-09-22). If the
// app's scope rejects the fulfillments field, the query is retried without it.
const FULFILLMENT_FIELDS = `fulfillments(first: 10) { status displayStatus }`;
let withFulfillments = true;
const orderFields = () => ORDER_FIELDS_BASE + (withFulfillments ? '\n  ' + FULFILLMENT_FIELDS : '');
const fulfillmentsRejected = (r) => withFulfillments && ((r && r.errors) || []).some((e) => /fulfillments/i.test(e.message || ''));
export function readyForPickup(o) {
  return ((o && o.fulfillments) || []).some((f) => f && String(f.displayStatus || '').toUpperCase() === 'READY_FOR_PICKUP' && String(f.status || '').toUpperCase() !== 'CANCELLED');
}

// shopQuery(env, query, variables) -> raw GraphQL JSON ({data, errors}); provided by index.js
export async function fetchOrder(env, shopQuery, gid) {
  let r = await shopQuery(env, `query($id:ID!){ order(id:$id){ ${orderFields()} } }`, { id: gid });
  if (!(r && r.data && r.data.order) && fulfillmentsRejected(r)) { withFulfillments = false; r = await shopQuery(env, `query($id:ID!){ order(id:$id){ ${orderFields()} } }`, { id: gid }); }
  const o = r && r.data && r.data.order;
  if (!o) return null;
  let pi = o.lineItems && o.lineItems.pageInfo, guard = 0;
  while (pi && pi.hasNextPage && guard++ < 40) {
    const more = await shopQuery(env, `query($id:ID!,$c:String!){ order(id:$id){ lineItems(first:250, after:$c){ pageInfo { hasNextPage endCursor } edges { node { ${LI_FIELDS} } } } } }`, { id: gid, c: pi.endCursor });
    const li = more && more.data && more.data.order && more.data.order.lineItems;
    if (!li || !li.edges || !li.edges.length) break;
    o.lineItems.edges.push(...li.edges);
    pi = li.pageInfo;
  }
  return o;
}

// Orders placed since a date that still have something to ship. Cursor-paged.
export async function searchUnfulfilled(env, shopQuery, { since, excludePos = true, cursor = null }) {
  const parts = ['fulfillment_status:unfulfilled', 'financial_status:paid'];
  if (since) parts.push('created_at:>=' + since);
  if (excludePos) parts.push('-source_name:pos');
  const q = () => `query($q:String!,$c:String){ orders(first:25, query:$q, after:$c, sortKey:CREATED_AT){ pageInfo { hasNextPage endCursor } edges { node { ${orderFields()} } } } }`;
  let r = await shopQuery(env, q(), { q: parts.join(' AND '), c: cursor });
  if (!(r && r.data && r.data.orders) && fulfillmentsRejected(r)) { withFulfillments = false; r = await shopQuery(env, q(), { q: parts.join(' AND '), c: cursor }); }
  const conn = r && r.data && r.data.orders;
  const errors = [...new Set(((r && r.errors) || []).map((e) => e.message))];
  if (!conn) return { orders: [], cursor: null, errors: errors.length ? errors : ['Shopify returned no orders data'] };
  const orders = conn.edges.map((e) => e.node);
  return { orders, cursor: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null, errors };
}

/* ───────────────────── queue records ───────────────────── */
function priceOf(li) { const m = li.discountedUnitPriceSet && li.discountedUnitPriceSet.shopMoney; return (m && m.amount) || ''; }
function currencyOf(li) { const m = li.discountedUnitPriceSet && li.discountedUnitPriceSet.shopMoney; return (m && m.currencyCode) || ''; }
const lineQty = (li) => (li.unfulfilledQuantity != null ? +li.unfulfilledQuantity : +li.quantity) || 0;

// A Shopify order -> the compact record the queue keeps, or null if it does not belong.
export function toRecord(o) {
  if (!o || !o.id) return null;
  if (o.cancelledAt) return null;
  if (String(o.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED') return null;
  if (SKIP_SOURCES.includes(String(o.sourceName || '').toLowerCase())) return null;
  if (readyForPickup(o)) return null;          // already pulled, waiting for the customer
  const lines = [];
  for (const e of (o.lineItems && o.lineItems.edges) || []) {
    const li = e.node; const qty = lineQty(li);
    if (!(qty > 0)) continue;
    lines.push({
      name: li.name || '', sku: li.sku || '', qty, cond: li.variantTitle || '',
      variantId: String((li.variant && li.variant.id) || '').replace(/\D+/g, ''),
      price: priceOf(li), currency: currencyOf(li),
      img: (li.image && li.image.url) || '',
      pt: (li.product && li.product.productType) || '',
    });
  }
  if (!lines.length) return null;
  const ship = (o.shippingLine && o.shippingLine.title) || '';
  const money = o.currentTotalPriceSet && o.currentTotalPriceSet.shopMoney;
  // fulfillmentOrders (assigned location) is deliberately not requested: it needs a
  // fulfillment-orders scope the app may lack, and a scope error there blanks the
  // whole query. One store ships everything (owner, 2026-09-22), so it is not needed.
  const fo = null;
  return {
    num: orderNum(o.id), gid: o.id, name: o.name, createdAt: o.createdAt || '',
    customer: (o.shippingAddress && o.shippingAddress.name) || (o.billingAddress && o.billingAddress.name) || (o.customer && o.customer.displayName) || '',
    total: money ? money.amount : null, currency: money ? money.currencyCode : '',
    shipping: ship, local: /pickup|in[\s-]?store/i.test(ship),
    city: [o.shippingAddress && o.shippingAddress.city, o.shippingAddress && o.shippingAddress.provinceCode].filter(Boolean).join(' '),
    source: o.sourceName || '', tags: o.tags || [],
    location: fo ? (fo.assignedLocation.name || '') : '',
    itemQty: lines.reduce((s, l) => s + l.qty, 0),
    lines, updatedAt: new Date().toISOString(),
  };
}

export async function putRecord(env, rec) {
  await env.JOBS.put(QUEUE_PREFIX + rec.num, JSON.stringify(rec), {
    metadata: { name: rec.name, createdAt: rec.createdAt, customer: String(rec.customer || '').slice(0, 40), itemQty: rec.itemQty, local: rec.local, pulled: (rec.tags || []).some((t) => String(t).toLowerCase() === PULL_TAG.toLowerCase()), source: rec.source, updatedAt: rec.updatedAt },
  });
}
export const dropRecord = (env, num) => env.JOBS.delete(QUEUE_PREFIX + num);
export const getRecord = (env, num) => env.JOBS.get(QUEUE_PREFIX + num, 'json');

// Webhook / backfill entry point: re-read one order and keep or drop its record.
export async function refreshOrder(env, shopQuery, gid) {
  const o = await fetchOrder(env, shopQuery, gid);
  const num = orderNum(gid);
  if (!o) return { num, kept: false, reason: 'not found' };
  const rec = toRecord(o);
  if (!rec) { await dropRecord(env, num); return { num, kept: false, reason: 'nothing to ship' }; }
  await putRecord(env, rec);
  return { num, kept: true, name: rec.name };
}

export async function backfill(env, shopQuery, opts) {
  const { orders, cursor, errors } = await searchUnfulfilled(env, shopQuery, opts);
  let kept = 0, skipped = 0; const records = [];
  for (const o of orders) {
    // the search already returned the full order; walk extra line-item pages only when needed
    const full = (o.lineItems && o.lineItems.pageInfo && o.lineItems.pageInfo.hasNextPage) ? await fetchOrder(env, shopQuery, o.id) : o;
    const rec = toRecord(full);
    if (rec) { await putRecord(env, rec); kept++; records.push(rec); } else skipped++;
  }
  return { kept, skipped, seen: orders.length, cursor, errors: errors || [], records };
}

// Self-filling queue: called by the cron trigger and by the first read of an
// empty queue. Walks unfulfilled online orders from the last SYNC_DAYS in
// pages (continuing a stored cursor across runs), then re-reads the stalest
// records so orders fulfilled while a webhook was missed still drop out.
export const SYNC_DAYS = 14;
export async function syncQueue(env, shopQuery, { maxPages = 6, refreshStale = 20, inline = false } = {}) {
  const now = Date.now();
  let st = {}; try { st = (await env.JOBS.get('sys:queueSync', 'json')) || {}; } catch (_) {}
  if (st.running && now - Date.parse(st.running) < 120e3 && !inline) return { skipped: 'running' };
  const since = new Date(now - SYNC_DAYS * 86400e3).toISOString().slice(0, 10);
  let cursor = (st.since === since && st.cursor) ? st.cursor : null;
  await env.JOBS.put('sys:queueSync', JSON.stringify({ ...st, running: new Date(now).toISOString() }));
  let kept = 0, seen = 0, pages = 0, errors = []; const records = [];
  try {
    do {
      const r = await backfill(env, shopQuery, { since, excludePos: true, cursor });
      kept += r.kept; seen += r.seen; cursor = r.cursor; pages++;
      records.push(...(r.records || []));
      for (const m of r.errors || []) if (!errors.includes(m)) errors.push(m);
      if (!r.seen && r.errors && r.errors.length) break;   // a page with no data at all: stop, report
    } while (cursor && pages < (inline ? 1 : maxPages));
  } catch (e) { errors.push(String(e && e.message || e)); }
  let refreshed = 0, dropped = 0;
  if (!cursor && !inline) {
    // sweep: stalest records first, only those not touched for 2h
    const list = await env.JOBS.list({ prefix: QUEUE_PREFIX });
    const stale = list.keys.map((k) => ({ num: k.name.slice(QUEUE_PREFIX.length), at: Date.parse((k.metadata || {}).updatedAt || '') || 0 }))
      .filter((x) => now - x.at > 2 * 3600e3).sort((a, b) => a.at - b.at).slice(0, refreshStale);
    for (const x of stale) { try { const r = await refreshOrder(env, shopQuery, orderGid(x.num)); refreshed++; if (!r.kept) dropped++; } catch (_) {} }
  }
  const rec = { since, cursor: cursor || '', at: new Date().toISOString(), kept, seen, refreshed, dropped, errors, running: '' };
  await env.JOBS.put('sys:queueSync', JSON.stringify(rec));
  return { ...rec, records };
}

// The queue as the screen shows it: metadata only (one list op), plus which
// orders already sit on an ACTIVE sheet (from job metadata, no body reads).
export async function listQueue(env, extra) {
  const [q, jobs] = await Promise.all([env.JOBS.list({ prefix: QUEUE_PREFIX }), env.JOBS.list({ prefix: 'job:' })]);
  const seen = new Set(q.keys.map((k) => k.name));
  for (const rec of extra || []) {
    const name = QUEUE_PREFIX + rec.num;
    if (seen.has(name)) continue;
    seen.add(name);
    q.keys.push({ name, metadata: { name: rec.name, createdAt: rec.createdAt, customer: String(rec.customer || '').slice(0, 40), itemQty: rec.itemQty, local: rec.local, pulled: (rec.tags || []).some((t) => String(t).toLowerCase() === PULL_TAG.toLowerCase()), source: rec.source, updatedAt: rec.updatedAt } });
  }
  const onSheet = {};
  for (const k of jobs.keys) {
    const m = k.metadata || {};
    if (m.archived) continue;
    for (const n of m.orderNames || []) onSheet[String(n)] = k.name.slice(4);
  }
  const rows = q.keys.map((k) => { const m = k.metadata || {}; return { num: k.name.slice(QUEUE_PREFIX.length), ...m, sheet: onSheet[String(m.name)] || '' }; });
  rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return rows;
}

/* ───────────────────── sheet building (port of the userscript) ───────────────────── */
export function parseSku(sku) {
  if (!sku) return null;
  const p = String(sku).split('-');
  if (p.length < 4) return null;
  if (!/[0-9]/.test(p[1])) return null;
  return { setCode: p[0], collector: p[1] };
}
const setLabelFromName = (name) => { const m = /\[([^\]]+)\]/.exec(name || ''); return m ? m[1] : ''; };
const cardNameFromLine = (name) => (name || '').replace(/\s*\[[^\]]+\].*$/, '').trim();
const collectorFromTitle = (name) => { const m = /\((\d+)\s*[/)]/.exec(name || ''); return m ? m[1] : ''; };
const gameFromType = (pt) => (pt ? (pt.replace(/\s*singles?\s*$/i, '').trim() || pt) : '');
export const isYgoType = (pt) => /yu-?gi-?oh|ygo/i.test(pt || '');
export const isMtgType = (pt) => /magic|mtg/i.test(pt || '');
export const isPokType = (pt) => /pok[eé]mon|pkm/i.test(pt || '');
function collKey(c) { const m = /(\d+)/.exec(c || ''); return [m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER, c || '']; }
const YGO_ORDER = ['Normal Monster', 'Effect Monster', 'Ritual Monster', 'Fusion Monster', 'Synchro Monster', 'Xyz Monster', 'Pendulum Monster', 'Link Monster', 'Spell', 'Trap', 'Token', 'Skill'];
const ygoTypeRank = (label) => { const i = YGO_ORDER.indexOf(label); return i < 0 ? 98 : i; };

// Flat card rows from queue records. Each row keeps the raw bits regroup() needs
// (pt, setLabel, setCode) so enrichment can re-sort the sheet later.
export function flatten(records) {
  const singles = new Map(), sealed = new Map();
  for (const o of records) {
    for (const li of o.lines || []) {
      const parsed = parseSku(li.sku);
      const pt = li.pt || '';
      const isSingle = pt ? /single/i.test(pt) : !!parsed;
      const key = (isSingle ? 's|' : 'x|') + (li.sku || li.name);
      const map = isSingle ? singles : sealed;
      let row = map.get(key);
      if (!row) {
        row = isSingle
          ? { single: true, game: gameFromType(pt), pt, setLabel: setLabelFromName(li.name), setCode: parsed ? parsed.setCode : '', code: parsed ? `${parsed.setCode}-${parsed.collector}` : '',
              collector: (parsed && parsed.collector) || collectorFromTitle(li.name) || '', cond: li.cond || '', card: cardNameFromLine(li.name),
              rarity: '', mana: '', sku: li.sku || '', img: li.img || '', price: li.price || '', currency: li.currency || '', variantId: li.variantId || '', qty: 0, orders: [] }
          : { single: false, game: gameFromType(pt), pt, card: li.name, sku: li.sku || '', img: li.img || '', price: li.price || '', currency: li.currency || '', variantId: li.variantId || '', qty: 0, orders: [] };
        map.set(key, row);
      }
      row.qty += li.qty;
      const oo = row.orders.find((x) => x.name === o.name);
      if (oo) oo.qty += li.qty; else row.orders.push({ name: o.name, qty: li.qty });
    }
  }
  return [...singles.values(), ...sealed.values()];
}

// Apply cached enrichment to flat rows (pure; enr is a plain object of KV entries).
export function applyEnrichment(rows, enr) {
  for (const r of rows) {
    if (!r.single || !r.code) continue;
    if (isYgoType(r.pt)) {
      const e = enr['ygo:' + r.code] || {};
      r.rarity = e.rarity || ''; r.ygoFrame = e.frame || '';
      const sets = enr['ygo:sets'] || {};
      r.ygoSetName = sets[String(r.setCode).toUpperCase()] || '';
    } else if (isMtgType(r.pt)) {
      const e = enr['mtg:' + r.code] || {};
      r.rarity = e.rarity || ''; r.mana = e.mana || '';
    } else if (isPokType(r.pt)) {
      const e = enr['pok:' + r.code] || {};
      r.rarity = e.rarity || '';
    }
  }
  return rows;
}

// Flat rows -> { games: [{game, sets: [{setName, cards}]}], sealed: [...] } in sheet order.
export function regroup(rows) {
  const grouped = new Map();
  const sealed = [];
  for (const r of rows) {
    if (!r.single) { sealed.push(r); continue; }
    r.setName = r.ygoFrame || r.ygoSetName || r.setLabel || r.setCode || 'Unknown Set';
    const g = r.game || '';
    if (!grouped.has(g)) grouped.set(g, new Map());
    const sets = grouped.get(g);
    if (!sets.has(r.setName)) sets.set(r.setName, []);
    sets.get(r.setName).push(r);
  }
  const games = [];
  for (const [game, sets] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const names = [...sets.keys()].sort((a, b) => (isYgoType(game) ? (ygoTypeRank(a) - ygoTypeRank(b)) || a.localeCompare(b) : a.localeCompare(b)));
    games.push({ game, sets: names.map((setName) => {
      const cards = sets.get(setName).sort((a, b) => {
        if (isYgoType(game) || isPokType(game)) return a.card.localeCompare(b.card);
        const [ai, as] = collKey(a.collector), [bi, bs] = collKey(b.collector);
        return ai - bi || as.localeCompare(bs);
      });
      return { setName, cards };
    }) });
  }
  return { games, sealed };
}

export function orderOut(rec) {
  return { name: rec.name, gid: rec.gid, customer: rec.customer || '', date: rec.createdAt || '', total: rec.total, currency: rec.currency || '', itemQty: rec.itemQty, shipping: rec.shipping || '', local: !!rec.local };
}

// Enrichment keys a set of rows wants, and the cache reads for them.
export function enrichKeys(rows) {
  const keys = new Set();
  for (const r of rows) {
    if (!r.single || !r.code) continue;
    if (isYgoType(r.pt)) { keys.add('ygo:sets'); keys.add('ygo:' + r.code); }
    else if (isMtgType(r.pt)) keys.add('mtg:' + r.code);
    else if (isPokType(r.pt)) keys.add('pok:' + r.code);
  }
  return [...keys];
}
export async function readEnrichment(env, keys) {
  const out = {};
  await Promise.all(keys.map(async (k) => { try { const v = await env.JOBS.get('enr:' + k, 'json'); if (v) out[k] = v; } catch (_) {} }));
  return out;
}

// Build a job (without id/state) from queue records, using whatever enrichment is cached.
export async function buildJob(env, records) {
  const rows = flatten(records);
  const enr = await readEnrichment(env, enrichKeys(rows));
  applyEnrichment(rows, enr);
  const model = regroup(rows);
  let n = 0;
  for (const g of model.games) for (const s of g.sets) for (const c of s.cards) c.cid = 'c' + (n++);
  for (const c of model.sealed) c.cid = 'c' + (n++);
  return { orders: records.map(orderOut), games: model.games, sealed: model.sealed, total: n, enrichPending: Object.keys(enr).length < enrichKeys(rows).length };
}

/* ───────────────────── enrichment lookups (cached in KV under enr:*) ───────────────────── */
async function getJson(url, init) {
  try { const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'ExorPullSheet/2.0' }, ...(init || {}) }); if (!r.ok) return { status: r.status }; return { status: r.status, json: await r.json() }; }
  catch (_) { return { status: 0 }; }
}
const YGO_FRAME = (ft) => {
  ft = String(ft || '').toLowerCase(); if (!ft) return '';
  if (ft.includes('pendulum')) return ft.includes('ritual') ? 'Ritual Monster' : ft.includes('fusion') ? 'Fusion Monster' : ft.includes('synchro') ? 'Synchro Monster' : ft.includes('xyz') ? 'Xyz Monster' : 'Pendulum Monster';
  return { normal: 'Normal Monster', effect: 'Effect Monster', ritual: 'Ritual Monster', fusion: 'Fusion Monster', synchro: 'Synchro Monster', xyz: 'Xyz Monster', link: 'Link Monster', spell: 'Spell', trap: 'Trap', token: 'Token', skill: 'Skill' }[ft] || 'Other';
};
const MTG_RARITY = (r) => ({ common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus' }[String(r || '').toLowerCase()] || '');

// Fill up to `budget` missing enrichment entries for these rows. Returns how many
// keys are still missing after this pass (0 = done). Each pass is small so a
// single worker invocation stays well under the subrequest cap.
export async function enrichPass(env, rows, budget = ENRICH_BUDGET) {
  const keys = enrichKeys(rows);
  const have = await readEnrichment(env, keys);
  const missing = keys.filter((k) => !have[k]);
  let spent = 0;
  const puts = [];
  const save = (k, v) => { have[k] = v; puts.push(env.JOBS.put('enr:' + k, JSON.stringify(v), { expirationTtl: 60 * 86400 * (k === 'ygo:sets' ? 0.5 : 6) })); };

  if (missing.includes('ygo:sets') && spent < budget) {
    spent++;
    const r = await getJson('https://db.ygoprodeck.com/api/v7/cardsets.php');
    if (r.json && Array.isArray(r.json)) { const m = {}; for (const s of r.json) if (s.set_code && s.set_name) m[String(s.set_code).toUpperCase()] = s.set_name; save('ygo:sets', m); }
  }
  // MTG: one Scryfall collection request covers up to 75 cards
  const mtg = missing.filter((k) => k.startsWith('mtg:'));
  for (let i = 0; i < mtg.length && spent < budget; i += 75) {
    spent++;
    const chunk = mtg.slice(i, i + 75);
    const idents = chunk.map((k) => { const code = k.slice(4); const p = parseSku(code + '-EN-NF-1'); return { set: String(p.setCode).toLowerCase(), collector_number: String(p.collector) }; });
    const r = await getJson('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'ExorPullSheet/2.0' }, body: JSON.stringify({ identifiers: idents }) });
    const found = {};
    for (const c of (r.json && r.json.data) || []) found[String(c.set || '').toLowerCase() + '|' + String(c.collector_number || '').toLowerCase()] = { rarity: MTG_RARITY(c.rarity), mana: c.mana_cost || '' };
    if (r.status === 200) for (const k of chunk) { const p = parseSku(k.slice(4) + '-EN-NF-1'); save(k, found[String(p.setCode).toLowerCase() + '|' + String(p.collector).toLowerCase()] || { rarity: '', mana: '' }); }
  }
  // YGO: rarity + id from cardsetsinfo, frame from cardinfo (2 lookups per code)
  for (const k of missing.filter((x) => x.startsWith('ygo:') && x !== 'ygo:sets')) {
    if (spent + 2 > budget) break;
    spent += 2;
    const code = k.slice(4);
    const r = await getJson('https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=' + encodeURIComponent(code));
    if (r.status >= 500 || r.status === 0) continue;                 // leave uncached, retry next pass
    const o = Array.isArray(r.json) ? r.json[0] : r.json;
    const rarity = (o && o.set_rarity) || '', id = (o && o.id) || '';
    let frame = '';
    if (id) { const c = await getJson('https://db.ygoprodeck.com/api/v7/cardinfo.php?id=' + encodeURIComponent(id)); const card = c.json && c.json.data && c.json.data[0]; frame = card ? YGO_FRAME(card.frameType) : ''; }
    save(k, { rarity, frame });
  }
  // Pokémon: name + number (+ printed total) lookup per code
  for (const k of missing.filter((x) => x.startsWith('pok:'))) {
    if (spent >= budget) break;
    spent++;
    const code = k.slice(4);
    const row = rows.find((r) => r.single && r.code === code && isPokType(r.pt));
    if (!row) { save(k, { rarity: '' }); continue; }
    const parts = ['name:"' + String(row.card || '').replace(/"/g, '') + '"'];
    if (row.collector) parts.push('number:' + String(row.collector).replace(/[^0-9A-Za-z]/g, ''));
    const r = await getJson('https://api.pokemontcg.io/v2/cards?q=' + encodeURIComponent(parts.join(' ')) + '&select=rarity,name,number&pageSize=3');
    if (r.status !== 200) continue;
    const a = (r.json && r.json.data) || [];
    save(k, { rarity: (a[0] && a[0].rarity) || '' });
  }
  await Promise.all(puts);
  applyEnrichment(rows, have);
  return keys.filter((k) => !have[k]).length;
}

// Rows of an existing job (flat, cids kept) so a later enrich pass can regroup it.
export function jobRows(job) {
  const out = [];
  for (const g of job.games || []) for (const s of g.sets || []) for (const c of s.cards || []) out.push(c);
  for (const c of job.sealed || []) out.push(c);
  return out;
}
