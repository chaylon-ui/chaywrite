import { enrichTick, statusOf, kickRun, ENRICH_VERSION } from '../src/enrich.js';

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
    books: opts.books || [], games: opts.games || [], gunpla: opts.gunpla || [], w40k: opts.w40k || [],
    written: [], deleted: [], mediaAdds: [], plCalls: 0, adminCalls: 0, bggCalls: 0, olCalls: 0, alCalls: 0, kitCalls: 0,
    now: Date.UTC(2026, 8, 4, 6, 0, 0),
  };
  const page = (list, after, n) => {
    n = n || 25;                     // the PLAMOD page query has a fixed page size
    const start = after ? Number(after) : 0;
    const slice = list.slice(start, start + n);
    return {
      products: {
        pageInfo: { hasNextPage: start + n < list.length, endCursor: String(start + n) },
        nodes: slice.map((p) => ({
          id: p.id, title: p.title,
          enriched: p.enriched ? { value: p.enriched } : null,
          ver: p.version ? { value: String(p.version) } : null,
          bgg: p.bggId ? { value: String(p.bggId) } : null,
          gsig: p.gpSig ? { value: p.gpSig } : null,
          variants: { nodes: [{ barcode: p.barcode || '' }] },
          productType: p.type || '',
          media: { nodes: (p.media || []).map((u) => ({ image: { url: u } })) },
          added: p.plAdded ? { value: p.plAdded } : null,
          psig: p.plSig ? { value: p.plSig } : null,
          wsig: p.whSig ? { value: p.whSig } : null,
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
        } else if (/productUpdate/.test(body.query)) {
          w.mediaAdds.push({ id: body.variables.product.id, media: body.variables.media });
          data = { productUpdate: { product: { id: body.variables.product.id }, userErrors: w.mediaError ? [{ field: ['media'], message: 'bad image' }] : [] } };
        } else if (/metafieldsDelete/.test(body.query)) {
          w.deleted.push(...body.variables.m);
          data = { metafieldsDelete: { userErrors: [] } };
        } else {
          const q = body.variables.q;
          data = page(q.includes('Books') ? w.books : q.includes('Tabletop Wargames') ? w.w40k : q.includes('Gunpla') ? w.gunpla : w.games, body.variables.after, body.variables.n || (q.includes('Tabletop Wargames') ? 50 : undefined));
        }
        return new Response(JSON.stringify({ data, extensions: { cost: { actualQueryCost: 10, throttleStatus: { currentlyAvailable: 2000, restoreRate: 100 } } } }), { status: 200 });
      }
      if (u.includes("openlibrary.org")) {
        w.olCalls++;
        const body = {};
        for (const k of (u.split('bibkeys=')[1] || '').split('%2C')) {
          const isbn = decodeURIComponent(k).replace('ISBN:', '');
          if (w.ol[isbn]) body['ISBN:' + isbn] = w.ol[isbn];
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }
      /* AniList is no longer called from the worker at all - it blocks
         Cloudflare's egress. The lookup happens on a GitHub runner and lands
         as a committed file, which the worker fetches back. */
      if (u.includes("raw.githubusercontent.com") && u.includes("plamod.json")) {
        w.plCalls++;
        if (!w.plamod) return new Response("404: Not Found", { status: 404 });
        return new Response(JSON.stringify(w.plamod), { status: 200 });
      }
      if (u.includes("raw.githubusercontent.com") && u.includes("w40k.json")) {
        w.whCalls = (w.whCalls || 0) + 1;
        if (!w.w40kFile) return new Response("404: Not Found", { status: 404 });
        return new Response(JSON.stringify(w.w40kFile), { status: 200 });
      }
      if (u.includes("raw.githubusercontent.com") && u.includes("bandai-kits")) {
        w.kitCalls++;
        return new Response(JSON.stringify({ generated: '2026-09-23T05:40:00Z', kits: w.kits }), { status: 200 });
      }
      if (u.includes("raw.githubusercontent.com")) {
        w.alCalls++;
        if (w.seriesFileStatus && w.seriesFileStatus !== 200) return new Response("not found", { status: w.seriesFileStatus });
        return new Response(JSON.stringify({ generated: '2026-09-03T22:00:00Z', series: w.al }), { status: 200 });
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
  w.ol = opts.ol || {};
  w.al = opts.al || {};              // series name -> { demographic, status, volumes, author }
  w.seriesFileStatus = opts.seriesFileStatus || 200;
  w.bggStatus = opts.bggStatus || 200;
  w.thing = opts.thing || {};
  w.kits = opts.kits || {};
  w.plamod = opts.plamod || null;
  w.w40kFile = opts.w40kFile || null;
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
      { id: 'gid://p/2', title: 'AKAME GA KILL GN VOL. 3', barcode: '9781421587264' },
      // stamped at the CURRENT version: must be skipped
      { id: 'gid://p/3', title: 'Already Done 1', barcode: '', enriched: '2026-09-01', version: ENRICH_VERSION },
      // stamped at v1: must be RE-enriched so the new fields backfill
      { id: 'gid://p/4', title: 'One Piece 5', barcode: '', enriched: '2026-09-01', version: 1 },
    ],
    games: [],
    ol: {
      '9781632365354': { authors: [{ name: '\u677e\u4e95 \u512a\u5f81' }], publishers: [{ name: 'VIZ Media LLC' }] },
      '9781421587264': { authors: [{ name: 'Takahiro' }], publishers: [{ name: 'Yen Press, LLC' }] },
    },
    al: {
      'Attack on Titan': { demographic: 'Shonen', status: 'Completed', volumes: 34, author: 'Hajime Isayama' },
      'Akame Ga Kill': { demographic: 'Shonen', status: 'Completed', volumes: 15, author: 'Takahiro' },
    },
  });
  const ticks = await drain(w);
  ok('books run finishes', ticks > 0, 'ticks=' + ticks);
  const last = await w.cx.storage.get('en:last');
  eq('current-version product skipped, v1 product re-done', [last.seen, last.skipped, last.ok], [4, 1, 3]);
  const byKey = (id, k) => (w.written.find((m) => m.ownerId === id && m.key === k) || {}).value;
  eq('series written', byKey('gid://p/1', 'series'), 'Attack on Titan');
  eq('series_key written', byKey('gid://p/1', 'series_key'), 'attackontitan');
  eq('volume written', byKey('gid://p/2', 'volume'), '3');
  eq('trade shorthand stripped from series', byKey('gid://p/2', 'series'), 'Akame Ga Kill');
  eq('isbn written', byKey('gid://p/1', 'isbn'), '9781632365354');
  eq('publisher normalised', byKey('gid://p/1', 'publisher'), 'VIZ Media');
  eq('second publisher normalised', byKey('gid://p/2', 'publisher'), 'Yen Press');
  eq('non-latin OL author replaced by the AniList one', byKey('gid://p/1', 'author'), 'Hajime Isayama');
  eq('latin OL author kept', byKey('gid://p/2', 'author'), 'Takahiro');
  eq('demographic from AniList', byKey('gid://p/1', 'demographic'), 'Shonen');
  eq('series status mapped', byKey('gid://p/1', 'series_status'), 'Completed');
  eq('volumes_total from AniList', byKey('gid://p/1', 'volumes_total'), '34');
  eq('version stamped', byKey('gid://p/1', 'enrich_version'), String(ENRICH_VERSION));
  ok('current-version product not rewritten', !w.written.some((m) => m.ownerId === 'gid://p/3'));
  ok('v1 product WAS rewritten', w.written.some((m) => m.ownerId === 'gid://p/4'));
  eq('no bgg calls for books', w.bggCalls, 0);
  ok('open library and the series file were both used', w.olCalls > 0 && w.alCalls > 0, 'ol=' + w.olCalls + ' file=' + w.alCalls);
  eq('series file fetched once for the whole run, not per page', w.alCalls, 1);
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

// ---------- 5b. a missing series file costs the AniList fields, nothing else ----
// The file is produced by a GitHub runner and committed. If it is absent, or
// GitHub is down, the books must still get series/volume/isbn/author/publisher.
{
  const w = world({
    books: [{ id: 'gid://p/1', title: 'Attack on Titan 24', barcode: '9781632365354' }],
    games: [],
    ol: { '9781632365354': { authors: [{ name: 'Hajime Isayama' }], publishers: [{ name: 'Kodansha Comics' }] } },
    al: {}, seriesFileStatus: 404,
  });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('run still succeeds', last.error, undefined);
  const byKey = (id, k) => (w.written.find((m) => m.ownerId === id && m.key === k) || {}).value;
  eq('series still written', byKey('gid://p/1', 'series'), 'Attack on Titan');
  eq('publisher still written', byKey('gid://p/1', 'publisher'), 'Kodansha');
  ok('no demographic invented', !byKey('gid://p/1', 'demographic'));
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
  eq('it gave up after one gated BGG call, not 1500', w.bggCalls, 1);
  ok('next alarm is a day out, not an hourly retry', w.cx.storage.alarmAt() - w.now > 3600000, 'delta=' + (w.cx.storage.alarmAt() - w.now));
}

// ---------- 5b. Gunpla (owner, 2026-09-23): title facts for every kit, Bandai
// facts for a unique name match, and a second night writes nothing unchanged.
// It also runs when BoardGameGeek is gated.
{
  const kits = {
    "01_1043": { name: "HG 1/144 GM SNIPER", launch: "2017-07", age: 8, price_yen: 1700, url: "https://global.bandai-hobby.net/en-us/item/01_1043/" },
    "01_5000": { name: "MG 1/100 JUSTICE GUNDAM", launch: "2017-06-10", age: 15, price_yen: 5200, url: "https://global.bandai-hobby.net/en-us/item/01_5000/" },
    "01_6000": { name: "RG 1/144 NU GUNDAM", launch: "2019-08-10", age: 15, url: "u1" },
    "01_6001": { name: "RG 1/144 Nu GUNDAM", launch: "2023-01-01", age: 15, url: "u2" },
  };
  const gunpla = [
    { id: 'gid://k/1', title: 'HGUC 1/144 GM Sniper' },
    { id: 'gid://k/2', title: 'MG 1/100 Justice Gundam' },
    { id: 'gid://k/3', title: 'RG 1/144 Nu GUNDAM' },
    { id: 'gid://k/4', title: 'HGUC 1/144 #116 Sinanju' },
    { id: 'gid://k/5', title: '1/1 GUNPLA-KUN DX SET' },
  ];
  const w = world({ books: [], games: [{ id: 'gid://g/1', title: 'WINGSPAN' }], gunpla, kits, bggStatus: 401 });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  const val = (id, key) => (w.written.find((m) => m.ownerId === id && m.key === key) || {}).value;
  eq('gunpla ran although BGG was gated', last.gunpla && last.gunpla.seen, 5);
  eq('HGUC kit matched to Bandai\'s HG page: release date', val('gid://k/1', 'gp_release'), '2017-07');
  eq('... grade from the title', val('gid://k/1', 'gp_grade'), 'High Grade');
  eq('... line from the title', val('gid://k/1', 'gp_line'), 'Universal Century');
  eq('... Bandai page', val('gid://k/1', 'gp_bandai_url'), 'https://global.bandai-hobby.net/en-us/item/01_1043/');
  eq('MG kit: age and Japanese price', [val('gid://k/2', 'gp_age'), val('gid://k/2', 'gp_price_jpy'), val('gid://k/2', 'gp_year')].join(','), '15,5200,2017');
  eq('two Bandai kits with the same name: no release date guessed', val('gid://k/3', 'gp_release'), undefined);
  eq('... but the title facts are still written', val('gid://k/3', 'gp_grade'), 'Real Grade');
  eq('kit not on Bandai\'s site: title facts, status title', [val('gid://k/4', 'gp_number'), val('gid://k/4', 'enrich_status')].join(','), '116,title');
  eq('no grade in the title: nothing written', w.written.filter((m) => m.ownerId === 'gid://k/5').length, 0);
  eq('kits file fetched once', w.kitCalls, 1);
  eq('counts', JSON.stringify(last.gunpla), JSON.stringify({ seen: 5, changed: 4, bandai: 2, titleOnly: 2, unknown: 1 }));
  // the next night: each product now carries the signature it was written with
  for (const g of gunpla) g.gpSig = val(g.id, 'gp_sig');
  const before = w.written.length;
  w.now += 86400000;
  w.cx.mem = {};
  await drain(w);
  eq('second night writes nothing for unchanged kits', w.written.filter((m, i) => i >= before && m.ownerId.startsWith('gid://k/')).length, 0);
  eq('... and deletes nothing', w.deleted.length, 0);
  // third night: Bandai's MG Justice page is gone - its Bandai facts must go too
  for (const g of gunpla) g.gpSig = val(g.id, 'gp_sig');
  delete w.kits['01_5000'];
  w.now += 86400000;
  w.cx.mem = {};
  await drain(w);
  const gone = w.deleted.filter((d) => d.ownerId === 'gid://k/2').map((d) => d.key).sort().join(',');
  ok('a kit that lost its Bandai match has its Bandai facts deleted', ['gp_age', 'gp_bandai_name', 'gp_bandai_url', 'gp_price_jpy', 'gp_release', 'gp_year'].every((k) => gone.split(',').includes(k)), 'deleted=' + gone);
  ok('... and keeps its title facts', !gone.split(',').includes('gp_scale'), 'deleted=' + gone);
  eq('no other product touched', w.deleted.filter((d) => d.ownerId !== 'gid://k/2').length, 0);
}

// ---------- 5c. BoardGameGeek DOWN (not gated) still lets Gunpla run ----------
// 2026-09-23: "bgg HTTP 502" eight games running ended the whole run before
// the Gunpla phase. Now the games stand down, Gunpla runs, and the run still
// ends with the BGG error so the failed-run retry brings the games back.
{
  const games = [];
  for (let i = 1; i <= 9; i++) games.push({ id: 'gid://g/' + i, title: 'GAME NUMBER ' + i });
  const w = world({ books: [], games, gunpla: [{ id: 'gid://k/1', title: 'HGUC 1/144 GM Sniper' }],
    kits: { "01_1043": { name: "HG 1/144 GM SNIPER", launch: "2017-07", url: "u" } }, bggStatus: 502 });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('gunpla ran although BGG was down', last.gunpla && last.gunpla.seen, 1);
  ok('the run still reports the BGG failure', /502/.test(last.error || ''), 'error=' + last.error);
  eq('games flagged as still owed', last.gamesPending, true);
  ok('no game was stamped enriched', !w.written.some((m) => m.ownerId.startsWith('gid://g/')), '');
}

// ---------- 5d. PLAMOD photos + facts (owner, 2026-09-23: "add all photos if
// you can", "make sure any case language isn't included") ----------
{
  const P = (k) => 'https://images.plamod.com/44E64DF7-DB48-11ED-82C1-0E3221E31575/' + k + '.png';
  const K = ['2264B66A-4AE5-11EF-9B30-262E661BFA1B', '56E3EAA2-8CE1-11E6-8588-1A8B06F1886E', '21B92A0C-4AE5-11EF-A400-222E661BFA1B', '22549CEE-4AE5-11EF-B8E9-272E661BFA1B'];
  const gunpla = [
    // already has PLAMOD photo K[1] (Shopify kept the name) + a box-art shot the runner found to be the same picture as K[3]
    { id: 'gid://k/1', title: 'RG 1/144 #23 Build Strike Gundam Full Package', barcode: '4573102630841', type: 'Gunpla', media: ['https://cdn.shopify.com/s/files/1/x/products/56E3EAA2-8CE1-11E6-8588-1A8B06F1886E-L.png?v=1', 'https://cdn.shopify.com/s/files/1/x/products/1_abc.jpg'] },
    { id: 'gid://k/2', title: 'HGUC 1/144 GM Sniper', barcode: '4573102999999', type: 'Gunpla' },   // not on PLAMOD
  ];
  const plamod = { count: 2, items: {
    '4573102630841': { found: true, sku: '5063084', photos: K.map((k) => ({ key: k, url: P(k) })), dup: [K[3]], release: '2016-12', series: 'Mobile Suit Gundam SEED', brand: 'RG', maker: 'Case of 12' },
    '4573102999999': { found: false },
  } };
  const w = world({ books: [], games: [], gunpla, plamod, bggStatus: 401 });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('plamod phase ran', last.plamod && last.plamod.seen, 2);
  eq('one product matched', last.plamod.matched, 1);
  eq('only the photos it lacks are added (not the same file, not the same picture)', JSON.stringify(w.mediaAdds.map((a) => a.media.map((m) => m.originalSource))), JSON.stringify([[P(K[0]), P(K[2])]]));
  eq('added as images, alt = our title', w.mediaAdds[0].media[0].mediaContentType + '|' + w.mediaAdds[0].media[0].alt, 'IMAGE|RG 1/144 #23 Build Strike Gundam Full Package');
  const val = (id, key) => (w.written.filter((m) => m.ownerId === id && m.key === key).pop() || {}).value;
  eq('facts written', [val('gid://k/1', 'pl_release'), val('gid://k/1', 'pl_series'), val('gid://k/1', 'pl_brand'), val('gid://k/1', 'pl_sku')].join('|'), '2016-12|Mobile Suit Gundam SEED|RG|5063084');
  eq('case wording never written', val('gid://k/1', 'pl_maker'), undefined);
  eq('what was offered is remembered', val('gid://k/1', 'pl_added'), JSON.stringify([K[0], K[2]]));
  eq('nothing for the product PLAMOD lacks', w.mediaAdds.filter((a) => a.id === 'gid://k/2').length + w.written.filter((m) => m.ownerId === 'gid://k/2' && /^pl_/.test(m.key)).length, 0);
  // next night: the product carries pl_added + pl_sig; the owner deleted K[0] - it must not come back
  gunpla[0].plAdded = val('gid://k/1', 'pl_added');
  gunpla[0].plSig = val('gid://k/1', 'pl_sig');
  const before = w.written.length, adds = w.mediaAdds.length;
  w.now += 86400000; w.cx.mem = {};
  await drain(w);
  eq('second night: no photo re-added (even one the owner deleted)', w.mediaAdds.length - adds, 0);
  eq('second night: no PLAMOD facts rewritten', w.written.filter((m, i) => i >= before && m.ownerId === 'gid://k/1' && /^pl_/.test(m.key)).length, 0);
}
{
  // a photo add Shopify rejects is NOT remembered, so it is tried again
  const K = '2264B66A-4AE5-11EF-9B30-262E661BFA1B';
  const w = world({ books: [], games: [], bggStatus: 401,
    gunpla: [{ id: 'gid://k/9', title: 'X', barcode: '4573102630841', type: 'Gunpla' }],
    plamod: { items: { '4573102630841': { found: true, photos: [{ key: K, url: 'https://images.plamod.com/f/' + K + '.png' }] } } } });
  w.mediaError = true;
  await drain(w);
  eq('rejected photo add: pl_added not written', w.written.filter((m) => m.key === 'pl_added').length, 0);
  eq('... and counted as an error', (await w.cx.storage.get('en:last')).plamod.errors, 1);
}
{
  // no data/plamod.json yet: the phase is skipped quietly
  const w = world({ books: [], games: [], bggStatus: 401, gunpla: [{ id: 'gid://k/1', title: 'HGUC 1/144 GM Sniper', barcode: '1' }] });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('no plamod file: run still finishes cleanly', last.error, undefined);
  eq('... and adds nothing', w.mediaAdds.length, 0);
}


// ---------- 5e. Warhammer 40,000 unit specs from BSData (owner, 2026-09-24:
// "warhammer, lets do it") ----------
{
  const unit = (name, sig) => ({ faction: 'Space Marines', name, legends: false, keywords: ['Infantry'], factionKeywords: ['Adeptus Astartes'],
    models: [5, 10], sizes: [{ m: '5', p: 75 }, { m: '10', p: 150 }], stats: [{ name, M: '6"', T: '4', SV: '3+', W: '2', LD: '6+', OC: '2' }],
    weapons: { ranged: [], melee: [] }, source: 'BSData wh40k-10e', sig });
  const products = {};
  for (let i = 1; i <= 25; i++) products[String(i)] = unit('Unit ' + i, 'v1:' + i);
  const w40k = [
    { id: 'gid://shopify/Product/1', title: 'WARHAMMER 40,000 SPACE MARINES: UNIT 1' },                 // new
    { id: 'gid://shopify/Product/2', title: 'WARHAMMER 40,000 SPACE MARINES: UNIT 2', whSig: 'v1:2' },  // unchanged
    { id: 'gid://shopify/Product/3', title: 'WARHAMMER 40,000 SPACE MARINES: UNIT 3', whSig: 'v1:old' },// points changed
    { id: 'gid://shopify/Product/99', title: 'WARHAMMER 40,000 CODEX', whSig: 'v1:x' },                 // no longer matched
    { id: 'gid://shopify/Product/98', title: 'WARHAMMER 40,000 DICE' },                                 // never matched
  ];
  const w = world({ books: [], games: [], bggStatus: 401, w40k, w40kFile: { count: 25, products } });
  await drain(w);
  const last = await w.cx.storage.get('en:last');
  eq('w40k phase ran after the others', last.w40k && last.w40k.seen, 5);
  eq('matched products counted', last.w40k.matched, 3);
  const keys = (id) => w.written.filter((m) => m.ownerId === id).map((m) => m.key).sort().join(',');
  eq('new unit: specs + signature written', keys('gid://shopify/Product/1'), 'wh_sig,wh_unit');
  eq('unchanged unit: nothing written', keys('gid://shopify/Product/2'), '');
  eq('changed unit: rewritten', keys('gid://shopify/Product/3'), 'wh_sig,wh_unit');
  const v = JSON.parse(w.written.find((m) => m.ownerId === 'gid://shopify/Product/1' && m.key === 'wh_unit').value);
  eq('specs are the file facts, signature kept out', [v.name, v.sizes[1].p, v.sig], ['Unit 1', 150, undefined]);
  eq('json type', w.written.find((m) => m.key === 'wh_unit').type, 'json');
  eq('a product no longer matched loses its specs', w.deleted.filter((m) => m.ownerId === 'gid://shopify/Product/99').map((m) => m.key).sort().join(','), 'wh_sig,wh_unit');
  eq('a never-matched product is left alone', w.written.concat(w.deleted).filter((m) => m.ownerId === 'gid://shopify/Product/98').length, 0);
}
{
  // a broken weekly file (almost no matches) must not wipe everybody's specs
  const w = world({ books: [], games: [], bggStatus: 401,
    w40k: [{ id: 'gid://shopify/Product/7', title: 'WARHAMMER 40,000 ORKS: BOYZ', whSig: 'v1:7' }],
    w40kFile: { count: 0, products: {} } });
  await drain(w);
  eq('tiny file: nothing deleted', w.deleted.length, 0);
  eq('tiny file: run finishes cleanly', (await w.cx.storage.get('en:last')).error, undefined);
}
{
  // no data/w40k.json at all
  const w = world({ books: [], games: [], bggStatus: 401, w40k: [{ id: 'gid://shopify/Product/7', title: 'X', whSig: 'v1:7' }] });
  await drain(w);
  eq('no file: nothing deleted', w.deleted.length, 0);
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
