import worker from '../src/index.js';
import * as Q from '../src/queue.js';
const store = new Map(), meta = new Map();
let hideNew = false; const newKeys = new Set();
const KV = {
  async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); if (hideNew) newKeys.add(k); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix) && !(hideNew && newKeys.has(k))).map(name => ({ name, metadata: meta.get(name) })) }; },
};
const SECRET = 'shpss_test';
const env = { JOBS: KV, API_TOKEN: 'tok', SHOP: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'a', SHOPIFY_CLIENT_SECRET: SECRET };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// ---- fake Shopify store ----
const li = (name, sku, qty, unf, pt, cond = 'Near Mint', variant = 1) => ({ node: { name, sku, quantity: qty, unfulfilledQuantity: unf, variantTitle: cond, variant: { id: 'gid://shopify/ProductVariant/' + variant }, discountedUnitPriceSet: { shopMoney: { amount: '1.50', currencyCode: 'CAD' } }, image: { url: 'https://img/' + variant + '_96x134.png' }, product: { productType: pt } } });
const ORDERS = {
  101: { id: 'gid://shopify/Order/101', name: '#101', createdAt: '2026-09-20T10:00:00Z', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', customer: { displayName: 'Ann A' }, currentTotalPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CAD' } }, shippingLine: { title: 'Lettermail - no tracking - bubble mailer' }, shippingAddress: { name: 'Ann A', city: 'Halifax', provinceCode: 'NS' },
    fulfillmentOrders: { edges: [{ node: { status: 'OPEN', assignedLocation: { name: 'Charlottetown', location: { id: 'gid://shopify/Location/1' } } } }] },
    lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Charizard [Base Set] (4/102)', 'BS-4-EN-NF-1', 2, 1, 'Pokemon Single', 'Near Mint Holo', 11), li('Lightning Bolt [Magic 2010]', 'M10-146-EN-NF-1', 1, 1, 'Magic the Gathering Singles', 'Near Mint', 12), li('Booster Box', 'BOX-1', 1, 1, 'Sealed Product', '', 13)] } },
  102: { id: 'gid://shopify/Order/102', name: '#102', createdAt: '2026-09-21T10:00:00Z', cancelledAt: null, displayFulfillmentStatus: 'PARTIALLY_FULFILLED', tags: ['PULLSHEET'], sourceName: 'web', customer: { displayName: 'Bob B' }, currentTotalPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'CAD' } }, shippingLine: { title: 'In-store pickup' }, shippingAddress: null, fulfillmentOrders: { edges: [] },
    lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Lightning Bolt [Magic 2010]', 'M10-146-EN-NF-1', 3, 2, 'Magic the Gathering Singles', 'Near Mint', 12), li('Blue-Eyes White Dragon', 'MAGO-EN017-EN-NF-1', 1, 0, 'Yu-Gi-Oh Singles', 'Near Mint', 14), li('Dark Magician', 'MAGO-EN001-EN-NF-1', 1, 1, 'Yu-Gi-Oh Singles', 'Near Mint', 15)] } },
  103: { id: 'gid://shopify/Order/103', name: '#103', createdAt: '2026-09-21T11:00:00Z', cancelledAt: '2026-09-21T12:00:00Z', displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', customer: null, currentTotalPriceSet: null, shippingLine: null, shippingAddress: null, fulfillmentOrders: { edges: [] }, lineItems: { pageInfo: { hasNextPage: false }, edges: [li('X', 'X-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
  104: { id: 'gid://shopify/Order/104', name: '#104', createdAt: '2026-09-21T12:00:00Z', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'pos', customer: null, currentTotalPriceSet: null, shippingLine: null, shippingAddress: null, fulfillmentOrders: { edges: [] }, lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Y', 'Y-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
};
ORDERS[105] = { id: 'gid://shopify/Order/105', name: '#105', createdAt: '2026-09-21T13:00:00Z', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', customer: null, currentTotalPriceSet: null, shippingLine: { title: 'In-store pickup' }, shippingAddress: null, fulfillmentOrders: { edges: [] }, fulfillments: [{ status: 'SUCCESS', displayStatus: 'READY_FOR_PICKUP' }], lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Z', 'Z-1-EN-NF-1', 1, 1, 'Pokemon Single')] } };
let rejectFulfillments = false;
const webhooks = []; const tagCalls = []; const ext = [];
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('/oauth/')) return Response.json({ access_token: 't', expires_in: 86400 });
  if (url.includes('/graphql.json')) {
    const { query, variables } = JSON.parse(init.body);
    if (/tagsAdd|tagsRemove/.test(query)) { tagCalls.push({ add: /tagsAdd/.test(query), id: variables.id, tags: variables.tags }); return Response.json({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] } } }); }
    if (/webhookSubscriptionCreate/.test(query)) { webhooks.push({ topic: /topic:(\w+)/.exec(query)[1], cb: variables.cb }); return Response.json({ data: { webhookSubscriptionCreate: { userErrors: [] } } }); }
    if (/webhookSubscriptions/.test(query)) return Response.json({ data: { webhookSubscriptions: { edges: webhooks.map(w => ({ node: { id: 'x', topic: w.topic, endpoint: { callbackUrl: w.cb } } })) } } });
    if (rejectFulfillments && /fulfillments\(/.test(query)) return Response.json({ errors: [{ message: 'Access denied for fulfillments field.' }], data: null });
    if (/order\(id:\$id\)/.test(query)) { const o = ORDERS[Q.orderNum(variables.id)]; return Response.json({ data: { order: o ? JSON.parse(JSON.stringify(o)) : null } }); }
    if (/orders\(first:25/.test(query)) {
      ext.push('search:' + variables.q);
      const list = Object.values(ORDERS).filter(o => !(/-source_name:pos/.test(variables.q) && o.sourceName === 'pos')).filter(o => o.createdAt >= (/created_at:>=(\S+)/.exec(variables.q) || [])[1] + 'T00:00:00Z');
      return Response.json({ errors: list.map(() => ({ message: 'Access denied for customer field. Required access: `read_customers` access scope.' })), data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, edges: list.map(o => { const c = JSON.parse(JSON.stringify(o)); c.customer = null; c.billingAddress = { name: 'Bill ' + o.name }; return { node: c }; }) } } });
    }
    return Response.json({ data: {} });
  }
  ext.push(url.split('?')[0]);
  if (url.includes('cardsets.php')) return Response.json([{ set_code: 'MAGO', set_name: 'Maximum Gold' }]);
  if (url.includes('cardsetsinfo.php')) return Response.json({ set_rarity: 'Premium Gold Rare', id: 46986414 });
  if (url.includes('cardinfo.php')) return Response.json({ data: [{ frameType: 'normal' }] });
  if (url.includes('scryfall.com/cards/collection')) { const ids = JSON.parse(init.body).identifiers; return Response.json({ data: ids.map(i => ({ set: i.set, collector_number: i.collector_number, rarity: 'common', mana_cost: '{R}' })) }); }
  if (url.includes('pokemontcg.io')) return Response.json({ data: [{ rarity: 'Rare Holo', name: 'Charizard', number: '4' }] });
  return new Response('nope', { status: 404 });
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const call = (path, method = 'GET', body, headers = {}) => worker.fetch(new Request('https://w.test' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env, ctx);
const j = async (r) => ({ status: r.status, body: await r.json() });
const H = { Authorization: 'Bearer tok' };
const cookieOf = (sc) => sc.split(';')[0];
const admin = cookieOf((await call('/auth', 'POST', { name: 'Chaylon', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));
const staff = cookieOf((await call('/auth', 'POST', { name: 'Gage', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));

// ---- webhook signature ----
async function sign(body) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body))); return btoa(String.fromCharCode(...s)); }
let body = JSON.stringify({ id: 101, admin_graphql_api_id: 'gid://shopify/Order/101' });
let r = await j(await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': 'AAAA' }));
ok(r.status === 401, 'hook with a bad signature is rejected');
r = await j(await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }));
await Promise.all(waits.splice(0));
ok(r.status === 200 && store.has('queue:101'), 'signed hook for #101 queues it');
let rec = await KV.get('queue:101', 'json');
ok(rec.lines.length === 3 && rec.lines[0].qty === 1 && rec.itemQty === 3, 'record uses unfulfilled qty (Charizard 2 ordered, 1 left)');
body = JSON.stringify({ id: 103 }); await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }); await Promise.all(waits.splice(0));
ok(!store.has('queue:103'), 'cancelled order is not queued');
body = JSON.stringify({ id: 104 }); await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }); await Promise.all(waits.splice(0));
ok(!store.has('queue:104'), 'POS order is not queued');
// order later fulfilled -> dropped
ORDERS[101].displayFulfillmentStatus = 'FULFILLED';
body = JSON.stringify({ id: 101 }); await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }); await Promise.all(waits.splice(0));
ok(!store.has('queue:101'), 'fulfilled order leaves the queue');
ORDERS[101].displayFulfillmentStatus = 'UNFULFILLED';

// ---- backfill (admin only) ----
r = await j(await call('/api/queue/backfill', 'POST', { since: '2026-09-21' }, { Cookie: staff }));
ok(r.status === 403, 'backfill is admin-only');
r = await j(await call('/api/queue/backfill', 'POST', { since: '2026-09-21', excludePos: true }, { Cookie: admin }));
ok(r.status === 200 && r.body.seen === 3 && r.body.kept === 1 && r.body.skipped === 2, 'backfill since 21st: #102 kept, cancelled #103 and ready-for-pickup #105 skipped, POS excluded by the search: ' + JSON.stringify(r.body));
r = await j(await call('/api/queue/backfill', 'POST', { since: '2026-09-01' }, { Cookie: admin }));
ok(store.has('queue:101') && store.has('queue:102'), 'backfill since 1st adds #101');

// ---- queue list + hook self-registration ----
r = await j(await call('/api/queue', 'GET', null, H));
await Promise.all(waits.splice(0));
ok(r.body.rows.length === 2 && r.body.rows[0].name === '#101' && r.body.rows[1].pulled === true && r.body.rows[1].local === true, 'queue lists #101 then #102 (oldest first), #102 flagged pulled-before and pickup');
ok(webhooks.length === 4 && webhooks.every(w => w.cb === 'https://w.test/hook/order'), 'first queue read registered the 4 order hooks at /hook/order');
r = await j(await call('/api/hooks', 'GET', null, { Cookie: admin }));
ok(r.body.registered.length === 4 && r.body.missing.length === 0, 'hook status: all registered');

// ---- make a sheet from the queue ----
tagCalls.length = 0;
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101', '102'] }, { Cookie: staff }));
ok(r.status === 200 && r.body.orders === 2 && r.body.enrichPending === true, 'sheet built from 2 orders, enrichment pending: ' + JSON.stringify(r.body));
const id = r.body.id;
ok(tagCalls.length === 2 && tagCalls.every(t => t.add && t.tags.join() === 'PULLSHEET'), 'both orders tagged PULLSHEET');
let job = await KV.get('job:' + id, 'json');
const games = job.games.map(g => g.game);
ok(JSON.stringify(games) === JSON.stringify(['Magic the Gathering', 'Pokemon', 'Yu-Gi-Oh']), 'games sorted: ' + games.join(' | '));
const bolt = job.games[0].sets[0].cards[0];
ok(bolt.card === 'Lightning Bolt' && bolt.qty === 3 && bolt.orders.length === 2 && job.games[0].sets[0].setName === 'Magic 2010', 'Lightning Bolt consolidated across #101 (1) + #102 (2) under set "Magic 2010"');
const ygo = job.games[2];
ok(ygo.sets.length === 1 && ygo.sets[0].cards.length === 1 && ygo.sets[0].cards[0].card === 'Dark Magician' && ygo.sets[0].setName === 'MAGO', 'YGO: Blue-Eyes (0 unfulfilled) excluded; Dark Magician under set code before enrichment');
ok(job.sealed.length === 1 && job.sealed[0].card === 'Booster Box', 'sealed section has the booster box');
ok(job.orders.length === 2 && job.orders[1].local === true && job.total === 4, 'orders carried with pickup flag; 4 card rows');
r = await j(await call('/api/queue', 'GET', null, H));
ok(r.body.rows.every(x => x.sheet === id), 'queue now shows both orders on sheet ' + id);
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101'] }, { Cookie: staff }));
ok(r.status === 409, 'cannot put #101 on a second active sheet');

// ---- enrichment passes ----
ext.length = 0;
r = await j(await call('/api/jobs/' + id + '/enrich', 'POST', {}, { Cookie: staff }));
ok(r.status === 200 && r.body.remaining === 0, 'one enrich pass fills everything (remaining 0): ' + JSON.stringify(r.body));
job = await KV.get('job:' + id, 'json');
const ygo2 = job.games.find(g => g.game === 'Yu-Gi-Oh');
ok(ygo2.sets[0].setName === 'Normal Monster' && ygo2.sets[0].cards[0].rarity === 'Premium Gold Rare', 'YGO regrouped by frame type with rarity');
const bolt2 = job.games[0].sets[0].cards[0];
ok(bolt2.rarity === 'Common' && bolt2.mana === '{R}', 'MTG rarity + mana from Scryfall collection');
const char = job.games[1].sets[0].cards[0];
ok(char.rarity === 'Rare Holo' && char.cid, 'Pokémon rarity; cids preserved');
const before = ext.length;
r = await j(await call('/api/jobs/' + id + '/enrich', 'POST', {}, { Cookie: staff }));
ok(ext.length === before, 'second pass is cache-only (no external calls)');
// a second sheet with the same cards builds fully enriched from cache
tagCalls.length = 0;
await call('/api/jobs/' + id + '/archive', 'POST', { archived: true }, { Cookie: staff });
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101'] }, { Cookie: staff }));
ok(r.status === 200 && r.body.enrichPending === false, 'after archive, #101 can go on a new sheet, enriched from cache');
const job2 = await KV.get('job:' + r.body.id, 'json');
ok(job2.games.find(g => g.game === 'Magic the Gathering').sets[0].cards[0].rarity === 'Common', 'cached rarity applied at build time');

// ---- legacy jobs untouched ----
r = await j(await call('/api/jobs', 'POST', { orders: [{ name: '#9', gid: 'gid://shopify/Order/9' }], games: [], sealed: [{ card: 'Old', qty: 1, orders: [{ name: '#9', qty: 1 }] }] }, H));
const legacy = r.body.id;
r = await j(await call('/api/jobs/' + legacy + '/enrich', 'POST', {}, { Cookie: staff }));
ok(r.body.remaining === 0 && (await KV.get('job:' + legacy, 'json')).sealed[0].card === 'Old', 'enrich on a userscript-built sheet is a no-op');

// ---- app page ----
const page = await (await call('/', 'GET', null, { Cookie: staff })).text();
ok(/href="#\/queue"/.test(page) && /function showQueue/.test(page) && /runEnrich/.test(page), 'app has the Queue button, screen and enrich loop');
// ---- self-filling queue: first read of an empty queue syncs, cron sweeps ----
for (const k of [...store.keys()]) if (k.startsWith('queue:') || k === 'sys:queueSync') { store.delete(k); meta.delete(k); }
for (const k of [...store.keys()]) if (k.startsWith('job:')) { const jb = JSON.parse(store.get(k)); jb.state.archived = true; store.set(k, JSON.stringify(jb)); meta.set(k, { ...(meta.get(k) || {}), archived: true }); }
ORDERS[101].displayFulfillmentStatus = 'UNFULFILLED'; ORDERS[102].displayFulfillmentStatus = 'PARTIALLY_FULFILLED';
hideNew = true;
r = await j(await call('/api/queue', 'GET', null, { Cookie: staff }));
await Promise.all(waits.splice(0));
hideNew = false; newKeys.clear();
ok(r.body.rows.length === 2 && r.body.syncAt && r.body.syncDays === 14, 'empty queue fills itself on first read even while KV list lags: ' + r.body.rows.map(x => x.name).join(', '));
ok(r.body.syncErrors.length === 1 && /read_customers/.test(r.body.syncErrors[0]), 'the read_customers field error is reported once, not per order, and did not block the import');
ok(r.body.rows[1].customer === 'Bob B' || r.body.rows[1].customer === 'Bill #102', 'customer name falls back to an address name: ' + r.body.rows[1].customer);
const syncRec = await KV.get('sys:queueSync', 'json');
ok(syncRec && !syncRec.cursor && syncRec.running === '', 'background walk finished and recorded');
// #102 gets fulfilled while a webhook is missed; its record is stale -> the cron sweep drops it
ORDERS[102].displayFulfillmentStatus = 'FULFILLED';
meta.set('queue:102', { ...meta.get('queue:102'), updatedAt: '2026-01-01T00:00:00Z' });
await worker.scheduled({}, env, ctx); await Promise.all(waits.splice(0));
ok(!store.has('queue:102') && store.has('queue:101'), 'cron sweep re-reads stale records and drops the fulfilled one');
const s2 = await KV.get('sys:queueSync', 'json');
ok(s2.refreshed === 1 && s2.dropped === 1, 'sync record counts the sweep: ' + JSON.stringify({ refreshed: s2.refreshed, dropped: s2.dropped }));
r = await j(await call('/api/queue/sync', 'POST', {}, { Cookie: staff }));
ok(r.status === 200 && r.body.at, 'manual sync endpoint works');
const page2 = await (await call('/', 'GET', null, { Cookie: staff })).text();
ok(/Synced with Shopify/.test(page2) && !/Import older orders above, or wait/.test(page2), 'queue screen shows the sync line and the new empty-state copy');
r = await j(await call('/api/queue/101', 'GET', null, { Cookie: staff }));
ok(r.status === 200 && r.body.name === '#101' && r.body.lines.length === 3 && 'sheet' in r.body, 'order preview endpoint returns the record with its sheet flag');
r = await j(await call('/api/queue/999', 'GET', null, { Cookie: staff }));
ok(r.status === 404, 'preview of an unknown order is 404');
const page3 = await (await call('/', 'GET', null, { Cookie: staff })).text();
ok(/previewQueueOrder/.test(page3) && /class="qnum"/.test(page3), 'queue rows have a tappable order number that opens the preview');
// ---- ready for pickup ----
body = JSON.stringify({ id: 105 }); await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }); await Promise.all(waits.splice(0));
ok(!store.has('queue:105'), 'an order marked Ready for pickup is not queued (already pulled)');
// a ready-for-pickup order that was imported earlier (fresh record) is cleared by Sync now, not left for the 2h sweep
ORDERS[105].fulfillments = []; await Q.putRecord(env, Q.toRecord(ORDERS[105])); ORDERS[105].fulfillments = [{ status: 'SUCCESS', displayStatus: 'READY_FOR_PICKUP' }];
ok(store.has('queue:105'), 'setup: #105 sits in the queue from before it was marked ready');
r = await j(await call('/api/queue/sync', 'POST', {}, { Cookie: staff }));
ok(!store.has('queue:105') && store.has('queue:101') && r.body.dropped >= 1, 'Sync now re-reads fresh records too and drops the ready-for-pickup order');
// scope rejects fulfillments: query falls back without the field and still works
rejectFulfillments = true;
body = JSON.stringify({ id: 102 }); ORDERS[102].displayFulfillmentStatus = 'PARTIALLY_FULFILLED';
await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }); await Promise.all(waits.splice(0));
ok(store.has('queue:102'), 'if the fulfillments field is rejected, the order is still read via the fallback query');
r = await j(await call('/api/queue/sync', 'POST', {}, { Cookie: staff }));
ok(r.body.seen >= 2 && !r.body.errors.some(e => /fulfillments/.test(e)), 'sync falls back too and reports no fulfillments error');
rejectFulfillments = false;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
