// Phase 2: the live-read order queue. Run: node phase2.mjs (mock KV, mock Shopify, mock card databases).
import worker from '../src/index.js';
import * as Q from '../src/queue.js';
const store = new Map(), meta = new Map();
const KV = {
  async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: meta.get(name) })) }; },
};
const SECRET = 'shpss_test';
const env = { JOBS: KV, API_TOKEN: 'tok', SHOP: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'a', SHOPIFY_CLIENT_SECRET: SECRET };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();

// ---- fake Shopify store (dates relative to today) ----
const li = (name, sku, qty, unf, pt, cond = 'Near Mint', variant = 1) => ({ node: { name, sku, quantity: qty, unfulfilledQuantity: unf, variantTitle: cond, variant: { id: 'gid://shopify/ProductVariant/' + variant }, discountedUnitPriceSet: { shopMoney: { amount: '1.50', currencyCode: 'CAD' } }, image: { url: 'https://img/' + variant + '_96x134.png' }, product: { productType: pt } } });
const ORDERS = {
  101: { id: 'gid://shopify/Order/101', name: '#101', createdAt: daysAgo(3), cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', customer: null, currentTotalPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CAD' } }, shippingLine: { title: 'Lettermail - no tracking - bubble mailer' }, shippingAddress: { name: 'Ann A', city: 'Halifax', provinceCode: 'NS' }, billingAddress: { name: 'Ann A' },
    lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Charizard [Base Set] (4/102)', 'BS-4-EN-NF-1', 2, 1, 'Pokemon Single', 'Near Mint Holo', 11), li('Lightning Bolt [Magic 2010]', 'M10-146-EN-NF-1', 1, 1, 'Magic the Gathering Singles', 'Near Mint', 12), li('Booster Box', 'BOX-1', 1, 1, 'Sealed Product', '', 13)] } },
  102: { id: 'gid://shopify/Order/102', name: '#102', createdAt: daysAgo(2), cancelledAt: null, displayFulfillmentStatus: 'PARTIALLY_FULFILLED', tags: ['PULLSHEET'], sourceName: 'web', customer: null, currentTotalPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'CAD' } }, shippingLine: { title: 'In-store pickup' }, shippingAddress: null, billingAddress: { name: 'Bob B' },
    lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Lightning Bolt [Magic 2010]', 'M10-146-EN-NF-1', 3, 2, 'Magic the Gathering Singles', 'Near Mint', 12), li('Blue-Eyes White Dragon', 'MAGO-EN017-EN-NF-1', 1, 0, 'Yu-Gi-Oh Singles', 'Near Mint', 14), li('Dark Magician', 'MAGO-EN001-EN-NF-1', 1, 1, 'Yu-Gi-Oh Singles', 'Near Mint', 15)] } },
  103: { id: 'gid://shopify/Order/103', name: '#103', createdAt: daysAgo(2), cancelledAt: daysAgo(1), displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', shippingLine: null, shippingAddress: null, billingAddress: null, lineItems: { pageInfo: { hasNextPage: false }, edges: [li('X', 'X-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
  104: { id: 'gid://shopify/Order/104', name: '#104', createdAt: daysAgo(1), cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'pos', shippingLine: null, shippingAddress: null, billingAddress: null, lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Y', 'Y-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
  105: { id: 'gid://shopify/Order/105', name: '#105', createdAt: daysAgo(1), cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', shippingLine: { title: 'In-store pickup' }, shippingAddress: null, billingAddress: null, fulfillments: [{ status: 'SUCCESS', displayStatus: 'READY_FOR_PICKUP' }], lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Z', 'Z-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
  106: { id: 'gid://shopify/Order/106', name: '#106', createdAt: daysAgo(30), cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', tags: [], sourceName: 'web', shippingLine: null, shippingAddress: null, billingAddress: null, lineItems: { pageInfo: { hasNextPage: false }, edges: [li('Old', 'O-1-EN-NF-1', 1, 1, 'Pokemon Single')] } },
};
let rejectFulfillments = false;
const webhooks = []; const tagCalls = []; const ext = []; let searches = 0;
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
      searches++;
      const since = (/created_at:>=(\S+)/.exec(variables.q) || [])[1];
      const list = Object.values(ORDERS).filter(o => !(/-source_name:pos/.test(variables.q) && o.sourceName === 'pos')).filter(o => !since || o.createdAt >= since + 'T00:00:00Z');
      return Response.json({ errors: list.map(() => ({ message: 'Access denied for customer field. Required access: `read_customers` access scope.' })), data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, edges: list.map(o => ({ node: JSON.parse(JSON.stringify(o)) })) } } });
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

// ---- live queue ----
let r = await j(await call('/api/queue', 'GET', null, { Cookie: staff }));
await Promise.all(waits.splice(0));
ok(r.status === 200 && r.body.rows.map(x => x.name).join() === '#101,#102', 'queue = live search, oldest first: #101, #102 (cancelled #103, POS #104, ready-for-pickup #105 and 30-day-old #106 left out)');
ok(r.body.rows[1].pulled === true && r.body.rows[1].local === true && r.body.rows[1].customer === 'Bob B', '#102 flagged pulled-before and pickup, name from the billing address');
ok(r.body.errors.length === 1 && /read_customers/.test(r.body.errors[0]) && r.body.cached === false, 'the read_customers field error is reported once and did not block the read');
ok(webhooks.length === 4 && webhooks.every(w => w.cb === 'https://w.test/hook/order'), 'first queue read registered the 4 order hooks');
const before = searches;
r = await j(await call('/api/queue', 'GET', null, { Cookie: staff }));
ok(searches === before && r.body.cached === true, 'second read within a minute comes from the cache (no Shopify call)');
r = await j(await call('/api/queue?fresh=1', 'GET', null, { Cookie: staff }));
ok(searches === before + 1 && r.body.cached === false, 'Refresh (fresh=1) asks Shopify again');

// ---- webhook drops the cache ----
async function sign(body) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body))); return btoa(String.fromCharCode(...s)); }
let body = JSON.stringify({ id: 101 });
r = await j(await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': 'AAAA' }));
ok(r.status === 401, 'hook with a bad signature is rejected');
ORDERS[101].displayFulfillmentStatus = 'FULFILLED';
r = await j(await call('/hook/order', 'POST', body, { 'X-Shopify-Hmac-SHA256': await sign(body) }));
await Promise.all(waits.splice(0));
const b2 = searches;
r = await j(await call('/api/queue', 'GET', null, { Cookie: staff }));
ok(r.status === 200 && searches === b2 + 1 && r.body.rows.map(x => x.name).join() === '#102', 'a signed hook drops the cache; the next read re-asks Shopify and #101 (now fulfilled) is gone');
ORDERS[101].displayFulfillmentStatus = 'UNFULFILLED';
await call('/api/queue?fresh=1', 'GET', null, { Cookie: staff });

// ---- hooks status ----
r = await j(await call('/api/hooks', 'GET', null, { Cookie: admin }));
ok(r.body.registered.length === 4 && r.body.missing.length === 0, 'hook status: all registered');

// ---- order preview ----
r = await j(await call('/api/queue/101', 'GET', null, { Cookie: staff }));
ok(r.status === 200 && r.body.name === '#101' && r.body.lines.length === 3 && r.body.sheet === '', 'order preview comes from the cache with its sheet flag');
r = await j(await call('/api/queue/999', 'GET', null, { Cookie: staff }));
ok(r.status === 404, 'preview of an unknown order is 404');

// ---- make a sheet from the queue ----
tagCalls.length = 0;
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101', '102'] }, { Cookie: staff }));
ok(r.status === 200 && r.body.orders === 2 && r.body.enrichPending === true, 'sheet built from 2 orders, enrichment pending: ' + JSON.stringify(r.body));
const id = r.body.id;
ok(/^\d{1,6}$/.test(id), 'short sheet number: #' + id);
ok(tagCalls.length === 2 && tagCalls.every(t => t.add && t.tags.join() === 'PULLSHEET'), 'both orders tagged PULLSHEET');
let job = await KV.get('job:' + id, 'json');
const games = job.games.map(g => g.game);
ok(JSON.stringify(games) === JSON.stringify(['Magic the Gathering', 'Pokemon', 'Yu-Gi-Oh']), 'games sorted: ' + games.join(' | '));
const bolt = job.games[0].sets[0].cards[0];
ok(bolt.card === 'Lightning Bolt' && bolt.qty === 3 && bolt.orders.length === 2 && job.games[0].sets[0].setName === 'Magic 2010', 'Lightning Bolt consolidated across #101 (1) + #102 (2) under set "Magic 2010"');
const ygo = job.games[2];
ok(ygo.sets.length === 1 && ygo.sets[0].cards[0].card === 'Dark Magician' && ygo.sets[0].setName === 'MAGO', 'YGO: Blue-Eyes (0 unfulfilled) excluded; Dark Magician under set code before enrichment');
ok(job.sealed.length === 1 && job.sealed[0].card === 'Booster Box' && job.orders.length === 2 && job.orders[1].local === true && job.total === 4, 'sealed section, orders with pickup flag, 4 card rows');
r = await j(await call('/api/queue', 'GET', null, { Cookie: staff }));
ok(r.body.rows.every(x => x.sheet === id), 'queue now shows both orders on sheet ' + id);
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101'] }, { Cookie: staff }));
ok(r.status === 409, 'cannot put #101 on a second active sheet');

// ---- enrichment passes ----
ext.length = 0;
r = await j(await call('/api/jobs/' + id + '/enrich', 'POST', {}, { Cookie: staff }));
ok(r.status === 200 && r.body.remaining === 0, 'one enrich pass fills everything');
job = await KV.get('job:' + id, 'json');
const ygo2 = job.games.find(g => g.game === 'Yu-Gi-Oh');
ok(ygo2.sets[0].setName === 'Normal Monster' && ygo2.sets[0].cards[0].rarity === 'Premium Gold Rare', 'YGO regrouped by frame type with rarity');
const bolt2 = job.games[0].sets[0].cards[0];
ok(bolt2.rarity === 'Common' && bolt2.mana === '{R}' && job.games[1].sets[0].cards[0].rarity === 'Rare Holo', 'MTG rarity + mana from Scryfall; Pokémon rarity');
const n = ext.length;
await call('/api/jobs/' + id + '/enrich', 'POST', {}, { Cookie: staff });
ok(ext.length === n, 'second pass is cache-only');
await call('/api/jobs/' + id + '/archive', 'POST', { archived: true }, { Cookie: staff });
r = await j(await call('/api/queue/sheet', 'POST', { nums: ['101'] }, { Cookie: staff }));
ok(r.status === 200 && r.body.enrichPending === false, 'after archive, #101 can go on a new sheet, enriched from cache');

// ---- scope fallback for the fulfillments field ----
rejectFulfillments = true;
r = await j(await call('/api/queue?fresh=1', 'GET', null, { Cookie: staff }));
ok(r.status === 200 && r.body.rows.length >= 2 && !r.body.errors.some(e => /fulfillments/.test(e)), 'if the fulfillments field is rejected, the search retries without it');
rejectFulfillments = false;

// ---- legacy sheets untouched by enrich ----
r = await j(await call('/api/jobs', 'POST', { orders: [{ name: '#9', gid: 'gid://shopify/Order/9' }], games: [], sealed: [{ card: 'Old', qty: 1, orders: [{ name: '#9', qty: 1 }] }] }, H));
r = await j(await call('/api/jobs/' + r.body.id + '/enrich', 'POST', {}, { Cookie: staff }));
ok(r.body.remaining === 0, 'enrich on a userscript-built sheet is a no-op');

// ---- cron warms the cache ----
await KV.delete('sys:queueCache');
await worker.scheduled({}, env, ctx); await Promise.all(waits.splice(0));
ok(store.has('sys:queueCache'), 'cron warms the queue cache');

// ---- app page ----
const page = await (await call('/', 'GET', null, { Cookie: staff })).text();
ok(/href="#\/queue"/.test(page) && /function showQueue/.test(page) && /id="qRefresh"/.test(page) && !/runBackfill/.test(page), 'app has the Queue screen with Refresh and no import panel');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
