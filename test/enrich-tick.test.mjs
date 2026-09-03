import { enrichTick, statusOf, kickRun } from '../src/enrich.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w));

function storage() {
  const m = new Map(); let alarm = null;
  return {
    m,
    async get(k) { return m.get(k); },
    async put(a, b) { if (typeof a === 'object') { for (const k in a) m.set(k, a[k]); } else m.set(a, b); },
    async delete(k) { m.delete(k); },
    async setAlarm(t) { alarm = t; },
    async getAlarm() { return alarm; },
    alarmAt: () => alarm,
  };
}

// A world: books pages, game pages, and canned BGG answers.
function world(opts) {
  const w = {
    books: opts.books || [], games: opts.games || [],
    written: [], adminCalls: 0, bggCalls: 0, now: Date.UTC(2026, 8, 4, 6, 0, 0),
  };
  const page = (list, after, n) => {
    const start = after ? Number(after) : 0;
    const slice = list.slice(start, start + n);
    return {
      products: {
        pageInfo: { hasNextPage: start + n < list.length, endCursor: String(start + n) },
        nodes: slice.map((p) => ({
          id: p.id, title: p.title,
          enriched: p.enriched ? { value: p.enriched } : null,
          bgg: p.bggId ? { value: String(p.bggId) } : null,
          variants: { nodes: [{ barcode: p.barcode || '' }] },
        })),
      },
    };
  };
  w.cx = {
    storage: storage(), env: { SHOPIFY_ADMIN_TOKEN: 'x' }, mem: {},
    now: () => w.now,
    sleep: async (ms) => { w.now += ms; },
    log: () => {},
    fetch: async (url, init) => {
      const u = String(url);
      if (u.includes('/admin/api/')) {
        w.adminCalls++;
        const body = JSON.parse(init.body);
        let data;
        if (/metafieldsSet/.test(body.query)) {
          w.written.push(...body.variables.mf);
          data = { metafieldsSet: { userErrors: [] } };
        } else {
          const isBooks = body.variables.q.includes('Books');
          data = page(isBooks ? w.books : w.games, body.variables.after, body.variables.n);
        }
        return new Response(JSON.stringify({ data, extensions: { cost: { actualQueryCost: 10, throttleStatus: { currentlyAvailable: 2000, restoreRate: 100 } } } }), { status: 200 });
      }
      w.bggCalls++;
      if (w.bggStatus && w.bggStatus !== 200) {
        return new Response('Unauthorized. See https://boardgamegeek.com/using_the_xml_api', { status: w.bggStatus });
      }
      if (u.includes('/search?')) {
        const q = decodeURIComponent(u.split('query=')[1] || '');
        return new Response(w.search[q] || '<items></items>', { status: 200 });
      }
      const id = (u.match(/id=(\d+)/) || [])[1];
      return new Response(w.thing[id] || '<items></items>', { status: 200 });
    },
  };
  w.search = opts.search || {};
  w.bggStatus = opts.bggStatus || 200;
  w.thing = opts.thing || {};
  return w;
}

const THING_WINGSPAN = `<items><item type="boardgame" id="266192"><minplayers value="1"/><maxplayers value="5"/>
<minplaytime value="40"/><maxplaytime value="70"/><minage value="10"/>
<link type="boardgamemechanic" value="Card Drafting"/><link type="boardgamedesigner" value="Elizabeth Hargrave"/>
<statistics><ratings><averageweight value="2.44"/></ratings></statistics></item></items>`;

async function drain(w, maxTicks = 60) {
  let n = 0;
  while (n++ < maxTicks) {
    await enrichTick(w.cx);
    const run = await w.cx.storage.get('en:run');
    if (run && run.done) return n;
    w.now += 1000;
  }
  return -1;
}

// ---------- 1. books: parse, write, skip already-enriched ----------
{
  const w = world({
    books: [
      { id: 'gid://p/1', title: 'Attack on Titan 24', barcode: '9781632365354' },
      { id: 'gid://p/2', title: 'HAIKYU!! VOL. 36', barcode: '9781421587264' },
      { id: 'gid://p/3', title: 'Already Done 1', barcode: '', enriched: '2026-09-01' },
    ],
    games: [],
  });
  const ticks = await drain(w);
  ok('books run finishes', ticks > 0, 'ticks=' + ticks);
  const last = await w.cx.storage.get('en:last');
  eq('books seen/skipped', [last.seen, last.skipped, last.ok], [3, 1, 2]);
  const byKey = (id, k) => (w.written.find((m) => m.ownerId === id && m.key === k) || {}).value;
  eq('series written', byKey('gid://p/1', 'series'), 'Attack on Titan');
  eq('volume written', byKey('gid://p/2', 'volume'), '36');
  eq('isbn written', byKey('gid://p/1', 'isbn'), '9781632365354');
  ok('enriched product not rewritten', !w.written.some((m) => m.ownerId === 'gid://p/3'));
  eq('no bgg calls for books', w.bggCalls, 0);
}

// ---------- 2. games: exact match enriches, ambiguous writes only a flag ----------
{
  const w = world({
    books: [],
    games: [
      { id: 'gid://g/1', title: 'WINGSPAN BOARD GAME', barcode: '729220071347' },
      { id: 'gid://g/2', title: 'SMASH UP', barcode: '729220055019' },
      { id: 'gid://g/3', title: 'NOTHING LIKE THIS', barcode: '729220000000' },
    ],
    search: {
      'WINGSPAN': '<items><item type="boardgame" id="266192"><name type="primary" value="Wingspan"/><yearpublished value="2019"/></item></items>',
      'SMASH UP': '<items><item type="boardgame" id="9"><name type="primary" value="Smash Up"/><yearpublished value="2018"/></item><item type="boardgame" id="4"><name type="primary" value="Smash Up"/><yearpublished value="2012"/></item></items>',
      'NOTHING LIKE THIS': '<items></items>',
    },
    thing: { 266192: THING_WINGSPAN },
  });
  const ticks = await drain(w);
  ok('games run finishes', ticks > 0, 'ticks=' + ticks);
  const last = await w.cx.storage.get('en:last');
  eq('one ok, one ambiguous, one notfound', [last.ok, last.ambiguous, last.notfound], [1, 1, 1]);
  const byKey = (id, k) => (w.written.find((m) => m.ownerId === id && m.key === k) || {}).value;
  eq('players written', [byKey('gid://g/1', 'players_min'), byKey('gid://g/1', 'players_max')], ['1', '5']);
  eq('weight written', byKey('gid://g/1', 'weight'), '2.44');
  eq('mechanics as json list', byKey('gid://g/1', 'mechanics'), '["Card Drafting"]');
  eq('bgg_id remembered', byKey('gid://g/1', 'bgg_id'), '266192');
  ok('ambiguous gets NO game data', !byKey('gid://g/2', 'players_min'), 'players_min=' + byKey('gid://g/2', 'players_min'));
  eq('ambiguous flagged', byKey('gid://g/2', 'enrich_status'), 'ambiguous');
  eq('notfound flagged', byKey('gid://g/3', 'enrich_status'), 'notfound');
}

// ---------- 3. a known bgg_id skips the search entirely ----------
{
  const w = world({
    books: [], games: [{ id: 'gid://g/9', title: 'ANYTHING AT ALL', bggId: 266192 }],
    search: {}, thing: { 266192: THING_WINGSPAN },
  });
  await drain(w);
  eq('one bgg call only (thing, no search)', w.bggCalls, 1);
  eq('resolved by stored id', (w.written.find((m) => m.key === 'players_max') || {}).value, '5');
}

// ---------- 4. idempotence: a second run the same day does nothing ----------
{
  const w = world({ books: [{ id: 'gid://p/1', title: 'One Piece 5', barcode: '' }], games: [] });
  await drain(w);
  const callsAfterFirst = w.adminCalls;
  await enrichTick(w.cx);
  eq('same-day re-tick makes no admin calls', w.adminCalls, callsAfterFirst);
  ok('alarm armed for a future run', w.cx.storage.alarmAt() > w.now);
}

// ---------- 5. resume: a tick boundary mid-games loses no BGG work ----------
// Each game costs two BGG calls at a 2.2s pace, so 8 games (~35s) cannot fit
// in one 20s tick - the run MUST cross a tick boundary and pick up where it
// stopped. The assertion that matters is the call count: exactly two per
// game means nothing was re-searched after the resume.
{
  const games = [];
  for (let i = 1; i <= 8; i++) games.push({ id: 'gid://g/' + i, title: 'WINGSPAN', barcode: '' });
  const w = world({
    books: [], games,
    search: { 'WINGSPAN': '<items><item type="boardgame" id="266192"><name type="primary" value="Wingspan"/><yearpublished value="2019"/></item></items>' },
    thing: { 266192: THING_WINGSPAN },
  });
  await enrichTick(w.cx);
  const mid = await w.cx.storage.get('en:run');
  ok('run still open after the first tick', mid && !mid.done, 'done=' + (mid && mid.done));
  ok('pending carried across the boundary', mid.pending.length > 0, 'pending=' + mid.pending.length);
  const callsAtBoundary = w.bggCalls;
  ok('first tick did real work', callsAtBoundary > 0 && callsAtBoundary < 16, 'calls=' + callsAtBoundary);
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('all eight enriched', last.ok, 8);
  eq('exactly two BGG calls per game, none repeated', w.bggCalls, 16);
  const ids = w.written.filter((m) => m.key === 'bgg_id').map((m) => m.ownerId);
  eq('no duplicate writes', ids.length, new Set(ids).size);
}

// ---------- 6. a gated BoardGameGeek stands down, it does not thrash ----------
// 2026-09-03: BGG began answering 401 to every anonymous call. The books
// already written must survive, no game may be stamped enriched (or it would
// be skipped forever), and the run must close CLEANLY - a failed run retries
// in an hour, which would mean 1500 games against a closed door every hour.
{
  const w = world({
    books: [{ id: 'gid://p/1', title: 'One Piece 5', barcode: '9781234567897' }],
    games: [{ id: 'gid://g/1', title: 'WINGSPAN' }, { id: 'gid://g/2', title: 'CALICO' }],
    bggStatus: 401,
  });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('run closed without error', last.error, undefined);
  eq('the gate is recorded', last.bggBlocked, 'HTTP 401');
  eq('games flagged as still owed', last.gamesPending, true);
  eq('books still written', (w.written.find((m) => m.ownerId === 'gid://p/1' && m.key === 'series') || {}).value, 'One Piece');
  ok('no game was stamped enriched', !w.written.some((m) => m.ownerId.startsWith('gid://g/') ), 'game writes=' + w.written.filter((m) => m.ownerId.startsWith('gid://g/')).length);
  eq('it gave up after one gated call, not 1500', w.bggCalls, 1);
  ok('next alarm is a day out, not an hourly retry', w.cx.storage.alarmAt() - w.now > 3600000, 'delta=' + (w.cx.storage.alarmAt() - w.now));
}

// ---------- 6. no token: fails loudly instead of silently ----------
{
  const w = world({ books: [], games: [] });
  w.cx.env = {};
  await enrichTick(w.cx);
  const last = await w.cx.storage.get('en:last');
  eq('missing token reported', last.error, 'SHOPIFY_ADMIN_TOKEN not configured');
  const st = await statusOf(w.cx);
  eq('status says token missing', st.tokenConfigured, false);
}

console.log((fail ? 'TICK-FAILS ' + fail : 'TICK OK') + ' :: ' + pass + '/' + (pass + fail) + ' checks passed');
