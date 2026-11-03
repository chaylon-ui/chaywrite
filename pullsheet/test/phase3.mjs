// Phase 3: pack-time PIN, Shopify on pack (ready for pickup / fulfil), holds on quarantine,
// settings, print view, short sheet numbers. Run: node phase3.mjs
import worker from '../src/index.js';
import * as F from '../src/fulfil.js';
const store = new Map(), meta = new Map();
const KV = {
  async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: meta.get(name) })) }; },
};
const env = { JOBS: KV, API_TOKEN: 'tok', SHOP: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'a', SHOPIFY_CLIENT_SECRET: 'b' };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// ---- fake Shopify: fulfillment orders per order, mutations recorded ----
let scopeOk = true;
const FOS = {
  1: [{ id: 'gid://shopify/FulfillmentOrder/11', status: 'OPEN', requestStatus: 'UNSUBMITTED', deliveryMethod: { methodType: 'SHIPPING' }, fulfillmentHolds: [], lineItems: { edges: [
        { node: { id: 'foli-a', remainingQuantity: 2, lineItem: { sku: 'A-1-EN-NF-1', variant: { id: 'gid://shopify/ProductVariant/1' } } } },
        { node: { id: 'foli-b', remainingQuantity: 1, lineItem: { sku: 'B-2-EN-NF-1', variant: { id: 'gid://shopify/ProductVariant/2' } } } } ] } }],
  2: [{ id: 'gid://shopify/FulfillmentOrder/22', status: 'OPEN', requestStatus: 'UNSUBMITTED', deliveryMethod: { methodType: 'PICK_UP' }, fulfillmentHolds: [], lineItems: { edges: [
        { node: { id: 'foli-c', remainingQuantity: 1, lineItem: { sku: 'A-1-EN-NF-1', variant: { id: 'gid://shopify/ProductVariant/1' } } } } ] } }],
};
const calls = { tags: [], ready: [], fulfil: [], hold: [], release: [] };
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('/oauth/')) return Response.json({ access_token: 't', expires_in: 86400 });
  if (!url.includes('/graphql.json')) return new Response('nope', { status: 404 });
  const { query, variables } = JSON.parse(init.body);
  if (/tagsAdd|tagsRemove/.test(query)) { calls.tags.push({ add: /tagsAdd/.test(query), id: variables.id, tags: variables.tags }); return Response.json({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] } } }); }
  if (/fulfillmentOrders\(first:10\)/.test(query)) {
    if (!scopeOk) return Response.json({ errors: [{ message: 'Access denied for fulfillmentOrders field. Required access: `read_merchant_managed_fulfillment_orders` access scope.' }], data: { order: null } });
    const num = /Order\/(\d+)/.exec(variables.id)[1];
    return Response.json({ data: { order: { fulfillmentOrders: { edges: (FOS[num] || []).map(n => ({ node: JSON.parse(JSON.stringify(n)) })) } } } });
  }
  if (/fulfillmentOrderLineItemsPreparedForPickup/.test(query)) { if (!scopeOk) return Response.json({ errors: [{ message: 'Access denied' }] }); calls.ready.push(variables.input); return Response.json({ data: { fulfillmentOrderLineItemsPreparedForPickup: { userErrors: [] } } }); }
  if (/fulfillmentCreate/.test(query)) { calls.fulfil.push(variables.f); return Response.json({ data: { fulfillmentCreate: { fulfillment: { id: 'gid://shopify/Fulfillment/9', status: 'SUCCESS' }, userErrors: [] } } }); }
  if (/fulfillmentOrderHold\(/.test(query)) { calls.hold.push(variables); return Response.json({ data: { fulfillmentOrderHold: { userErrors: [] } } }); }
  if (/fulfillmentOrderReleaseHold/.test(query)) { calls.release.push(variables); return Response.json({ data: { fulfillmentOrderReleaseHold: { userErrors: [] } } }); }
  return Response.json({ data: {} });
};
const ctx = { waitUntil: () => {} };
const call = (path, method = 'GET', body, headers = {}) => worker.fetch(new Request('https://w.test' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
const j = async (r) => ({ status: r.status, body: await r.json() });
const H = { Authorization: 'Bearer tok' };
const cookieOf = (sc) => sc.split(';')[0];
const gage = cookieOf((await call('/auth', 'POST', { name: 'Gage', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));
const admin = cookieOf((await call('/auth', 'POST', { name: 'Chaylon', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));

// a sheet with #1 (shipping: A x2, B x1) and #2 (pickup: A x1)
const payload = { orders: [{ name: '#1', gid: 'gid://shopify/Order/1', local: false }, { name: '#2', gid: 'gid://shopify/Order/2', local: true }],
  games: [{ game: 'Pokemon', sets: [{ setName: 'S', cards: [
    { card: 'A', sku: 'A-1-EN-NF-1', qty: 3, orders: [{ name: '#1', qty: 2 }, { name: '#2', qty: 1 }] },
    { card: 'B', sku: 'B-2-EN-NF-1', qty: 1, orders: [{ name: '#1', qty: 1 }] } ] }] }], sealed: [] };
let r = await j(await call('/api/jobs', 'POST', payload, H));
const id = r.body.id;
ok(/^\d{1,4}$/.test(id), 'new sheets get a short number: #' + id);

// ---- pack-time PIN ----
r = await j(await call('/api/verify-pin', 'POST', { name: 'Beth', pin: '0000' }, { Cookie: gage, 'CF-Connecting-IP': '1.1.1.1' }));
ok(r.status === 401, 'wrong PIN at the bench is refused');
r = await j(await call('/api/verify-pin', 'POST', { name: 'Beth', pin: '1234' }, { Cookie: gage, 'CF-Connecting-IP': '1.1.1.1' }));
ok(r.status === 200 && r.body.verify && r.body.verify.name === 'Beth' && r.body.verify.sig, 'right PIN returns a signed verify token for Beth');
const bethV = r.body.verify;
const gageV = (await j(await call('/api/verify-pin', 'POST', { name: 'Gage', pin: '1234' }, { Cookie: gage, 'CF-Connecting-IP': '1.1.1.1' }))).body.verify;

// Gage picks #1 on Gage's tablet session; packing with Gage's PIN is refused, Beth's PIN packs it
await call('/api/jobs/' + id + '/ofill', 'POST', { order: '#1' }, { Cookie: gage });
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true, verify: gageV }, { Cookie: gage }));
ok(r.status === 409 && r.body.fourEye, 'four-eye: the verify token names the picker, so packing is refused');
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true, verify: { ...bethV, sig: 'tampered' } }, { Cookie: gage }));
ok(r.status === 409 && r.body.fourEye, 'a tampered verify token is ignored (falls back to the session, Gage, still refused)');

// ---- shipped order, fulfilment off by default: tags only ----
calls.tags.length = 0;
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true, verify: bethV }, { Cookie: gage }));
ok(r.status === 200 && r.body.verifier === 'Beth' && r.body.shop.action === 'tagged' && /off/.test(r.body.shop.note), 'Beth packs #1 on Gage\'s tablet; shipped order only tagged while fulfilment is off: ' + r.body.shop.note);
ok(calls.tags.length === 1 && calls.tags[0].tags.join() === 'PACKED,PRINTED' && calls.fulfil.length === 0, 'PACKED + PRINTED tagged, no fulfilment');
let job = await KV.get('job:' + id, 'json');
ok(job.state.orders['#1'].packedBy === 'Beth' && job.state.orders['#1'].shop.action === 'tagged', 'order state records Beth and the Shopify outcome');
await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: false }, { Cookie: gage });

// ---- settings (admin), then fulfil with tracking, refunded card left out ----
r = await j(await call('/api/settings', 'POST', { fulfilShipped: true }, { Cookie: gage }));
ok(r.status === 403, 'settings are admin-only');
r = await j(await call('/api/settings', 'POST', { fulfilShipped: true }, { Cookie: admin }));
ok(r.status === 200 && r.body.fulfilShipped === true && r.body.notifyCustomer === true, 'admin turns fulfilment on');
// refund card B on #1 (not in the box)
await call('/api/jobs/' + id + '/opatch', 'POST', { order: '#1', op: 'refund', cid: 'c1', value: true }, { Cookie: gage });
calls.tags.length = 0;
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true, verify: bethV, tracking: { number: 'CP123' } }, { Cookie: gage }));
ok(r.status === 200 && r.body.shop.action === 'fulfilled' && r.body.shop.tracking === 'CP123', 'shipped order fulfilled in Shopify with tracking: ' + r.body.shop.note);
const f = calls.fulfil[0];
ok(f && f.notifyCustomer === true && f.trackingInfo.number === 'CP123' && f.lineItemsByFulfillmentOrder.length === 1 && f.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems.length === 1 && f.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems[0].id === 'foli-a' && f.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems[0].quantity === 2, 'fulfilment covers A x2 only; refunded B left out');

// ---- pickup order: ready for pickup ----
await call('/api/jobs/' + id + '/ofill', 'POST', { order: '#2' }, { Cookie: gage });
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#2', packed: true, verify: bethV }, { Cookie: gage }));
ok(r.status === 200 && r.body.shop.action === 'ready_for_pickup' && calls.ready.length === 1 && calls.ready[0].lineItemsByFulfillmentOrder[0].fulfillmentOrderId === 'gid://shopify/FulfillmentOrder/22', 'pickup order marked ready for pickup in Shopify');

// ---- quarantine: hold and release ----
await call('/api/jobs/' + id + '/pack', 'POST', { order: '#2', packed: false }, { Cookie: gage });
r = await j(await call('/api/jobs/' + id + '/quarantine', 'POST', { cid: 'c0', on: true }, { Cookie: gage }));
ok(r.status === 200 && calls.hold.length === 2 && calls.hold.every(h => h.h.reason === 'OTHER' && /quarantine: A/.test(h.h.reasonNotes)), 'quarantining card A holds both orders that carry it in Shopify');
FOS[1][0].fulfillmentHolds = [{ id: 'h1', reason: 'OTHER' }]; FOS[2][0].fulfillmentHolds = [{ id: 'h2', reason: 'OTHER' }];
r = await j(await call('/api/jobs/' + id + '/quarantine', 'POST', { cid: 'c0', on: false }, { Cookie: gage }));
ok(r.status === 200 && calls.release.length === 2, 'clearing the quarantine releases both holds');

// ---- no scope: everything falls back to tags with a note ----
scopeOk = false; calls.tags.length = 0; calls.ready.length = 0;
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#2', packed: true, verify: bethV }, { Cookie: gage }));
ok(r.status === 200 && r.body.shop.action === 'tagged' && /scope/.test(r.body.shop.note) && calls.tags.length === 1 && calls.ready.length === 0, 'without the scope: tagged only, note explains: ' + r.body.shop.note);
r = await j(await call('/api/jobs/' + id + '/quarantine', 'POST', { cid: 'c0', on: true }, { Cookie: gage }));
ok(r.status === 200 && r.body.holds.length === 0, 'without the scope, quarantine still tags and stays quiet about holds');
scopeOk = true;

// ---- print view ----
let p = await call('/print/' + id, 'GET', null, {});
ok(p.status === 200 && /Sign in/.test(await p.text()), 'print view without a session shows the sign-in page');
p = await call('/print/' + id, 'GET', null, { Cookie: gage });
const html = await p.text();
ok(p.status === 200 && /Pull Sheet #/.test(html) && /Lightning|>A<|>B</.test(html) && /Page per game/.test(html) && html.includes('#1') && html.includes('#2'), 'print view renders the sheet with both orders');
p = await call('/print/nope', 'GET', null, { Cookie: gage });
ok(p.status === 404, 'print of an unknown sheet is 404');

// ---- app page has the new UI ----
const page = await (await call('/', 'GET', null, { Cookie: gage })).text();
ok(/function packWithPin/.test(page) && /verify-pin/.test(page) && /id="stFulfil"/.test(page) && /\/print\//.test(page) && !/Four-eye check: you picked this order\. A different person must sign in/.test(page), 'app: PIN at pack, settings toggles, Print button, no session-based four-eye block');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
