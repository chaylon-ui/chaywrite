/**
 * Pull sheet v2: the order queue, read live from Shopify.
 *
 * The queue is one Shopify search (unfulfilled, paid, online, last QUEUE_DAYS
 * days) cached for CACHE_MS in KV. Nothing is mirrored: a webhook or "Refresh"
 * drops the cache and the next read asks Shopify again. A pull sheet is a
 * snapshot taken at build time, which is what a sheet is meant to be.
 *
 * Also here: the userscript's SKU parse and game -> set -> collector grouping
 * ported server-side, and the rarity / mana / set-name enrichment cached in
 * KV under enr:* and topped up by POST /api/jobs/:id/enrich in small passes.
 */

export const HOOK_TOPICS = ['ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'ORDERS_FULFILLED'];
export const SKIP_SOURCES = ['pos'];          // sourceName values that never go on a pull sheet
export const QUEUE_DAYS = 14;                 // how far back the queue looks
export const CACHE_MS = 60e3;                 // how long one Shopify read is reused
const MAX_PAGES = 8;                          // 25 orders a page: 200 orders in view at most
const CACHE_KEY = 'sys:queueCache';
const PULL_TAG = 'PULLSHEET';
const ENRICH_BUDGET = 12;                     // external lookups per /enrich call (free-plan subrequest cap is 50)

/* ───────────────────── webhook signature ───────────────────── */
export async function verifyHmac(rawBody, header, secret) {
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  let s = ''; for (const b of sig) s += String.fromCharCode(b);
  const b64 = btoa(s);
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
// customer{} needs read_customers (the app lacked it on 2026-09-22): names come
// from the addresses instead.
const ORDER_FIELDS_BASE = `id name createdAt cancelledAt displayFulfillmentStatus tags sourceName
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  shippingLine { title }
  shippingAddress { name city provinceCode }
  billingAddress { name }
  lineItems(first: 250) { pageInfo { hasNextPage endCursor } edges { node { ${LI_FIELDS} } } }`;
// "Ready for pickup" is a fulfillment in READY_FOR_PICKUP display state: those
// orders are already pulled and must not be queued. If the app's scope rejects
// the fulfillments field, the query is retried without it.
const FULFILLMENT_FIELDS = `fulfillments(first: 10) { status displayStatus }`;
let withFulfillments = true;
const orderFields = () => ORDER_FIELDS_BASE + (withFulfillments ? '\n  ' + FULFILLMENT_FIELDS : '');
const fulfillmentsRejected = (r) => withFulfillments && ((r && r.errors) || []).some((e) => /fulfillments/i.test(e.message || ''));
export function readyForPickup(o) {
  return ((o && o.fulfillments) || []).some((f) => f && String(f.displayStatus || '').toUpperCase() === 'READY_FOR_PICKUP' && String(f.status || '').toUpperCase() !== 'CANCELLED');
}

// shopQuery(env, query, variables) -> raw GraphQL JSON ({data, errors}); provided by index.js
export async function fetchOrder(env, shopQuery, gid) {
  const q = () => `query($id:ID!){ order(id:$id){ ${orderFields()} } }`;
  let r = await shopQuery(env, q(), { id: gid });
  if (!(r && r.data && r.data.order) && fulfillmentsRejected(r)) { withFulfillments = false; r = await shopQuery(env, q(), { id: gid }); }
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

// One page of orders placed since `since` that still have something to ship.
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

/* ───────────────────── order records ───────────────────── */
function priceOf(li) { const m = li.discountedUnitPriceSet && li.discountedUnitPriceSet.shopMoney; return (m && m.amount) || ''; }
function currencyOf(li) { const m = li.discountedUnitPriceSet && li.discountedUnitPriceSet.shopMoney; return (m && m.currencyCode) || ''; }
const lineQty = (li) => (li.unfulfilledQuantity != null ? +li.unfulfilledQuantity : +li.quantity) || 0;

// A Shopify order -> the compact record the queue shows and sheets are built from, or null if it does not belong.
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
  return {
    num: orderNum(o.id), gid: o.id, name: o.name, createdAt: o.createdAt || '',
    customer: (o.shippingAddress && o.shippingAddress.name) || (o.billingAddress && o.billingAddress.name) || (o.customer && o.customer.displayName) || '',
    total: money ? money.amount : null, currency: money ? money.currencyCode : '',
    shipping: ship, local: /pickup|in[\s-]?store/i.test(ship),
    city: [o.shippingAddress && o.shippingAddress.city, o.shippingAddress && o.shippingAddress.provinceCode].filter(Boolean).join(' '),
    source: o.sourceName || '', tags: o.tags || [],
    pulled: (o.tags || []).some((t) => String(t).toLowerCase() === PULL_TAG.toLowerCase()),
    itemQty: lines.reduce((s, l) => s + l.qty, 0),
    lines,
  };
}

/* ───────────────────── the live queue (cached search) ───────────────────── */
export const sinceDate = (now = Date.now()) => new Date(now - QUEUE_DAYS * 86400e3).toISOString().slice(0, 10);

// Everything the queue screen needs: records in view, when Shopify was last asked, any errors.
export async function loadQueue(env, shopQuery, { fresh = false, now = Date.now() } = {}) {
  if (!fresh) {
    let c = null; try { c = await env.JOBS.get(CACHE_KEY, 'json'); } catch (_) {}
    if (c && c.at && now - Date.parse(c.at) < CACHE_MS && Array.isArray(c.records)) return { ...c, cached: true };
  }
  const since = sinceDate(now);
  const records = []; const errors = []; let cursor = null, pages = 0, seen = 0;
  do {
    const r = await searchUnfulfilled(env, shopQuery, { since, excludePos: true, cursor });
    for (const m of r.errors || []) if (!errors.includes(m)) errors.push(m);
    seen += r.orders.length;
    for (const o of r.orders) {
      const full = (o.lineItems && o.lineItems.pageInfo && o.lineItems.pageInfo.hasNextPage) ? await fetchOrder(env, shopQuery, o.id) : o;
      const rec = toRecord(full);
      if (rec) records.push(rec);
    }
    cursor = r.cursor; pages++;
    if (!r.orders.length && r.errors.length) break;
  } while (cursor && pages < MAX_PAGES);
  records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const out = { records, at: new Date(now).toISOString(), since, seen, errors, partial: !!cursor };
  try { await env.JOBS.put(CACHE_KEY, JSON.stringify(out), { expirationTtl: 3600 }); } catch (_) {}
  return { ...out, cached: false };
}
export const invalidateQueue = (env) => env.JOBS.delete(CACHE_KEY).catch(() => {});

// Which orders already sit on an ACTIVE sheet (job metadata only, no body reads).
export async function activeSheets(env) {
  const jobs = await env.JOBS.list({ prefix: 'job:' });
  const onSheet = {};
  for (const k of jobs.keys) {
    const m = k.metadata || {};
    if (m.archived) continue;
    for (const n of m.orderNames || []) onSheet[String(n)] = k.name.slice(4);
  }
  return onSheet;
}
export function queueRows(records, onSheet) {
  return records.map((r) => ({ num: r.num, name: r.name, createdAt: r.createdAt, customer: r.customer, city: r.city, itemQty: r.itemQty, local: r.local, pulled: r.pulled, source: r.source, sheet: onSheet[String(r.name)] || '' }));
}

// One order's record: from the cache when it is there, else read live.
export async function recordFor(env, shopQuery, num) {
  let c = null; try { c = await env.JOBS.get(CACHE_KEY, 'json'); } catch (_) {}
  const hit = c && Array.isArray(c.records) ? c.records.find((r) => r.num === String(num)) : null;
  if (hit) return hit;
  const o = await fetchOrder(env, shopQuery, orderGid(num));
  return o ? toRecord(o) : null;
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

// Flat card rows from order records. Each row keeps the raw bits regroup() needs
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

// Build a job (without id/state) from order records, using whatever enrichment is cached.
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
  const save = (k, v) => { have[k] = v; puts.push(env.JOBS.put('enr:' + k, JSON.stringify(v), { expirationTtl: k === 'ygo:sets' ? 30 * 86400 : 360 * 86400 })); };

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
    const idents = chunk.map((k) => { const p = parseSku(k.slice(4) + '-EN-NF-1'); return { set: String(p.setCode).toLowerCase(), collector_number: String(p.collector) }; });
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
  // Pokémon: name + number lookup per code
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
