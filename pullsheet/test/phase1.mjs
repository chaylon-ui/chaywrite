import worker from '../src/index.js';
const store = new Map(), meta = new Map();
const KV = {
  async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
  async put(k, v, o) { store.set(k, v); if (o && o.metadata) meta.set(k, o.metadata); if (o && o.expirationTtl != null && o.expirationTtl < 60) throw new Error('ttl<60'); },
  async delete(k) { store.delete(k); meta.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: meta.get(name) })) }; },
};
const env = { JOBS: KV, API_TOKEN: 'tok', SHOP: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'a', SHOPIFY_CLIENT_SECRET: 'b' };
const tagCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/oauth/')) return new Response(JSON.stringify({ access_token: 't', expires_in: 86400 }));
  const body = JSON.parse(init.body || '{}');
  if (/tagsAdd|tagsRemove/.test(body.query || '')) { tagCalls.push({ add: /tagsAdd/.test(body.query), id: body.variables.id, tags: body.variables.tags }); return new Response(JSON.stringify({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] } } })); }
  return new Response(JSON.stringify({ data: {} }));
};
const call = (path, method = 'GET', body, headers = {}) => worker.fetch(new Request('https://w.test' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
const j = async (r) => ({ status: r.status, body: await r.json(), setCookie: r.headers.get('Set-Cookie') });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// --- auth lockout ---
for (let i = 0; i < 5; i++) { const r = await j(await call('/auth', 'POST', { name: 'Gage', pin: '0000' }, { 'CF-Connecting-IP': '1.1.1.1' })); ok(r.status === 401, 'wrong pin #' + (i + 1) + ' -> 401'); }
let r = await j(await call('/auth', 'POST', { name: 'Gage', pin: '1234' }, { 'CF-Connecting-IP': '1.1.1.1' }));
ok(r.status === 429 && /15 minutes/.test(r.body.error), 'sixth attempt locked out even with the right PIN (429)');
r = await j(await call('/auth', 'POST', { name: 'Gage', pin: '1234' }, { 'CF-Connecting-IP': '2.2.2.2' }));
ok(r.status === 200 && r.setCookie && r.setCookie.startsWith('xgps='), 'same name from another IP still signs in');
r = await j(await call('/auth', 'POST', { name: 'Sydney', pin: '0000' }, { 'CF-Connecting-IP': '3.3.3.3' }));
r = await j(await call('/auth', 'POST', { name: 'Sydney', pin: '1234' }, { 'CF-Connecting-IP': '3.3.3.3' }));
ok(r.status === 200 && !store.has('sys:authfail:sydney|3.3.3.3'), 'a good login clears the failure counter');
const cookieOf = (sc) => sc.split(';')[0];
const gage = cookieOf((await call('/auth', 'POST', { name: 'Gage', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));
const beth = cookieOf((await call('/auth', 'POST', { name: 'Beth', pin: '1234' }, { 'CF-Connecting-IP': '9.9.9.9' })).headers.get('Set-Cookie'));

// --- create a job: card A in orders #1 (qty 2) and #2 (qty 1); card B in #2 ---
const payload = { orders: [{ name: '#1', gid: 'gid://shopify/Order/1' }, { name: '#2', gid: 'gid://shopify/Order/2' }],
  games: [{ game: 'Pokemon', sets: [{ setName: 'S', cards: [{ card: 'A', qty: 3, orders: [{ name: '#1', qty: 2 }, { name: '#2', qty: 1 }] }, { card: 'B', qty: 1, orders: [{ name: '#2', qty: 1 }] }] }] }], sealed: [] };
const H = { Authorization: 'Bearer tok' };
const { id } = (await j(await call('/api/jobs', 'POST', payload, H))).body;
ok(/^\d{12}$/.test(id), 'job created ' + id);

// --- per-order picking lifts the sheet-level count ---
await call('/api/jobs/' + id + '/opatch', 'POST', { order: '#1', op: 'found', cid: 'c0', value: 2 }, { Cookie: gage });
let job = await KV.get('job:' + id, 'json');
ok(job.state.found.c0 === 2, 'sheet found for A = 2 after order #1 placed 2');
await call('/api/jobs/' + id + '/ofill', 'POST', { order: '#2' }, { Cookie: gage });
job = await KV.get('job:' + id, 'json');
ok(job.state.found.c0 === 3 && job.state.found.c1 === 1, 'ofill on #2 -> A=3 (capped at qty), B=1');
ok(meta.get('job:' + id).pulled === 2, 'metadata pulled=2 (both cards fully found at sheet level)');
ok(JSON.stringify(meta.get('job:' + id).games) === '["pokemon"]', 'metadata carries games');
await call('/api/jobs/' + id + '/opatch', 'POST', { order: '#2', op: 'found', cid: 'c0', value: 0 }, { Cookie: gage });
job = await KV.get('job:' + id, 'json');
ok(job.state.found.c0 === 3, 'un-finding on an order never lowers the sheet count');

// --- four-eye + pack tags only that order ---
await call('/api/jobs/' + id + '/opatch', 'POST', { order: '#2', op: 'found', cid: 'c0', value: 1 }, { Cookie: gage });
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true }, { Cookie: gage }));
ok(r.status === 409 && r.body.fourEye, 'picker (Gage) cannot pack #1');
tagCalls.length = 0;
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: true }, { Cookie: beth }));
ok(r.status === 200 && r.body.ok, 'Beth packs #1');
ok(tagCalls.length === 1 && tagCalls[0].id === 'gid://shopify/Order/1' && tagCalls[0].add && tagCalls[0].tags.join() === 'PACKED,PRINTED', 'only order #1 tagged PACKED,PRINTED: ' + JSON.stringify(tagCalls));
job = await KV.get('job:' + id, 'json');
ok(job.state.orders['#1'].status === 'packed' && !(job.state.orders['#2'] && job.state.orders['#2'].status === 'packed'), '#2 remains unpacked');
tagCalls.length = 0;
r = await j(await call('/api/jobs/' + id + '/pack', 'POST', { order: '#1', packed: false }, { Cookie: beth }));
ok(tagCalls.length === 1 && !tagCalls[0].add && tagCalls[0].tags.join() === 'PACKED', 'unpack removes only PACKED from #1');

// --- list: archived from metadata, active from body ---
const { id: id2 } = (await j(await call('/api/jobs', 'POST', payload, H))).body;
await call('/api/jobs/' + id2 + '/archive', 'POST', { archived: true }, { Cookie: gage });
let reads = 0; const origGet = KV.get; KV.get = async (k, t) => { if (k.startsWith('job:')) reads++; return origGet(k, t); };
r = await j(await call('/api/jobs', 'GET', null, H));
KV.get = origGet;
const arch = r.body.jobs.find(x => x.id === id2), act = r.body.jobs.find(x => x.id === id);
ok(reads === 1, 'list read 1 body (the active job), not 2');
ok(arch && arch.archived && arch.orders === 2 && arch.orderNames.join() === '#1,#2' && arch.games.join() === 'pokemon', 'archived summary from metadata');
ok(act && !act.archived && act.orderStats.length === 2 && act.pulled === 2, 'active summary from body');

// --- login page shows lockout text path exists ---
const loginHtml = await (await call('/')).text();
ok(/r\.status===429/.test(loginHtml), 'login page reads the 429 message');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
