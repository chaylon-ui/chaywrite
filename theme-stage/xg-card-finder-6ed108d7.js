/* Exor Games - card finder at the top of the singles pages.

   Owner, 2026-09-29, after a customer asked on Discord: "Can we somehow add advance search
   to the main card search area customers frequent more?" and "is there a way to sort by
   card number in a set? So we bring up all reality fracture and then there is a 'sort by
   collector number' for it?"

   The singles pages belong to the Cloud Search app (xCloud): its Set Name and Card Name
   boxes match EITHER box, and it cannot sort by card number. BinderPOS's product search
   (the one /pages/advanced-search uses) does both: a title AND a set, sorted by
   collector number. This bar sits at the top of the results column, outside the app's two
   mounts, and shows its own results there; while it does, the app's grid is hidden (never
   removed) until "Back to all cards", or until the shopper touches the app's filters.

   - Game: from the collection handle (GAMES); on any other page nothing runs.
   - Set: BinderPOS matches set names exactly (case aside: "reality" finds nothing), so the
     box offers the game's own set list (portal .../api/cards/<game>/sets, CORS open,
     loaded on first use).
   - Search: portal.binderpos.com products/forStore straight from the browser (CORS *,
     0.2-0.8 s for a set or a name, measured 2026-09-29), and the worker's cached copy of
     the same call (/binder/search) when that fails or stalls.
   - State lives in the address hash (#cf-<base64url of set=..&q=..&sort=..&p=..>), replaced
     rather than pushed, so Back from a card page lands on the same results and the app never
     sees our values; base64url keeps it a valid selector for scripts that jQuery the hash.
   - On /a/search/<handle> the app's boxes prefill ours. With BOTH filled the shopper
     meant "this card in this set", so that search runs at once; a set alone gets a
     one-tap "in card-number order" button.
   - Add to cart posts BinderPOS's variant id (a Shopify variant id) to /cart/add.js; the
     cart always charges Shopify's own price. */
(function () {
  'use strict';
  if (window.xgCardFinder || !window.fetch || !window.URLSearchParams || !window.AbortController || !document.querySelector) return;
  var pm = location.pathname.match(/^\/(?:collections|a\/search)\/([^\/]+)\/?$/);
  if (!pm) return;
  var HANDLE = '';
  try { HANDLE = decodeURIComponent(pm[1]).toLowerCase(); } catch (e) { return; }

  var GAME_NAMES = { mtg: 'Magic', pokemon: 'Pokémon', yugioh: 'Yu-Gi-Oh!', lor: 'Lorcana', one: 'One Piece', swu: 'Star Wars: Unlimited', fleshAndBlood: 'Flesh and Blood', scr: 'Sorcery' };
  // collection handle -> BinderPOS game, [game, the set that collection is about], or '*' (shopper picks)
  var GAMES = {
    'magic-the-gathering-canada': 'mtg', 'pokemon-canada': 'pokemon', 'disney-lorcana-canada': 'lor', 'yu-gi-oh-cards': 'yugioh',
    'magic-the-gathering-mtg-singles': 'mtg', 'magic-the-gathering-singles': 'mtg', 'mtg-singles': 'mtg',
    'mtg-singles-instock': 'mtg', 'magic-convention-singles': 'mtg',
    'bloomburrow-singles': ['mtg', 'Bloomburrow'], 'duskmourn-singles': ['mtg', 'Duskmourn'],
    'pokemon-singles': 'pokemon', 'pokemon-singles-new-arrivals': 'pokemon',
    'yu-gi-oh-singles': 'yugioh', 'yu-gi-oh-singles-new-arrivals': 'yugioh',
    'flesh-and-blood-singles': 'fleshAndBlood',
    'one-piece-cards': 'one', 'one-piece-in-stock': 'one', 'one-piece-card-game': 'one',
    'disney-lorcana-cards': 'lor',
    'star-wars-unlimited-singles-trading-cards': 'swu', 'star-wars-unlimited-singles-in-stock': 'swu',
    'all-singles': '*', 'convention-singles': '*'
  };
  var gm = GAMES[HANDLE];
  if (!gm) return;
  window.xgCardFinder = { v: 1 };

  var PICK = gm === '*';
  var GAME0 = PICK ? 'mtg' : (typeof gm === 'string' ? gm : gm[0]);
  var PRESET_SET = typeof gm === 'object' ? gm[1] : '';
  var STORE = 'most-wanted-ca.myshopify.com';
  var BP = 'https://portal.binderpos.com/external/shopify/products/forStore';
  var WORKER = 'https://exor-binder.nevski.workers.dev/binder/search';
  var SETS_URL = 'https://portal.binderpos.com/api/cards/';
  var PER = 24;
  var SORTS = {
    num: ['number', true, 'Card number', 'card-number order'],
    'num-desc': ['number', false, 'Card number, high to low', 'card number, high to low'],
    'price-desc': ['price', false, 'Price, high to low', 'price, high to low'],
    price: ['price', true, 'Price, low to high', 'price, low to high'],
    name: ['title', true, 'Name, A to Z', 'name']
  };
  /* Filters (owner, 2026-09-29: "in the find a card, is it possible to add color, rarity and type
     filters there?"): BinderPOS forStore takes colors / rarities / types / monsterTypes as lists
     of the ids its /api/cards/<game>/<list> endpoints give (case does not matter); the values in
     one list are OR, the lists AND each other (pyprobe 36628955795). Lorcana, One Piece and Star
     Wars: Unlimited ignore them (36629179767), so only Magic, Pokémon and Yu-Gi-Oh! get the panel.
     Magic's "types" are exact type lines ("Legendary Creature - Elf Rogue"), so a chip stands for
     every line carrying that word; "Creature" is 4,300 lines: fast inside a set (0.5 s), slow across
     every set (22 s, 36629383484). */
  var MTG_COLOURS = [['W', 'White', '#f3ecd2'], ['U', 'Blue', '#2f7bd2'], ['B', 'Black', '#2b2530'], ['R', 'Red', '#d3312d'], ['G', 'Green', '#2f8f4e'],
    ['Multicolor', 'Multicolour', 'linear-gradient(135deg,#d9a520,#2f7bd2 50%,#d3312d)'], ['Colorless', 'Colourless', '#b9bec2']];
  var FILTERS = {
    mtg: [
      { k: 'colors', label: 'Colour', fixed: MTG_COLOURS },
      { k: 'rarities', label: 'Rarity', api: 'rarities' },
      { k: 'types', label: 'Type', api: 'types', expand: true, fixed: [['Creature'], ['Instant'], ['Sorcery'], ['Enchantment'], ['Artifact'], ['Planeswalker'], ['Land'], ['Battle']] }
    ],
    pokemon: [
      { k: 'rarities', label: 'Rarity', api: 'rarities', prefer: ['Common', 'Uncommon', 'Rare', 'Double Rare', 'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Secret Rare', 'Holo Rare', 'Promo'] },
      { k: 'types', label: 'Type', api: 'types', prefer: ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless', 'Item', 'Supporter', 'Stadium', 'Pokémon Tool', 'Energy'] }
    ],
    yugioh: [
      { k: 'colors', label: 'Attribute', api: 'colors', keep: /^[A-Z]+$/ },
      { k: 'rarities', label: 'Rarity', api: 'rarities', prefer: ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare', 'Ultimate Rare', 'Quarter Century Secret Rare', 'Starlight Rare', "Collector's Rare", 'Gold Rare', 'Short Print', 'Promo'] },
      { k: 'types', label: 'Card type', api: 'types', prefer: [] },
      { k: 'monsterTypes', label: 'Monster type', api: 'monsterTypes', prefer: [] }
    ]
  };
  var FKEYS = ['colors', 'rarities', 'types', 'monsterTypes'];
  var FHASH = { colors: 'c', rarities: 'r', types: 't', monsterTypes: 'm' };
  var ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zm4.8-1.7L20 20"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  var CUR = (window.Shopify && window.Shopify.currency) || {};
  var CC = /^[A-Z]{3}$/.test(CUR.active || '') ? CUR.active : 'CAD';
  var RATE = CC === 'CAD' ? 1 : (parseFloat(CUR.rate) || 1);
  function money(x) {
    var v = (Number(x) || 0) * RATE;
    try { return (CC === 'CAD' ? '' : '≈ ') + new Intl.NumberFormat('en-CA', { style: 'currency', currency: CC }).format(v); }
    catch (e) { return '$' + v.toFixed(2); }
  }
  function ss(k, v) {
    try {
      if (arguments.length === 1) return JSON.parse(sessionStorage.getItem(k) || 'null');
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  var sr = null;      // the one live region for screen readers; never rebuilt
  function say(t) { if (!sr) return; sr.textContent = ''; setTimeout(function () { sr.textContent = t || ''; }, 60); }
  var intent = 0;     // bumped whenever the shopper's intent changes, so a late set lookup cannot act on a stale one
  var OFF = '';       // /a/search with both app boxes filled: this page's auto-run key, so "Back to all cards" is remembered

  /* ---------------- sets ---------------- */
  var setLists = {}, setLoads = {};
  function loadSets(g) {
    if (setLists[g]) return Promise.resolve(setLists[g]);
    if (setLoads[g]) return setLoads[g];
    var kept = ss('xg-cf-sets-' + g);
    if (kept && kept.at > Date.now() - 864e5 && Array.isArray(kept.l) && kept.l.length) return Promise.resolve(setLists[g] = index(kept.l));
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 15000);
    setLoads[g] = fetch(SETS_URL + encodeURIComponent(g) + '/sets', { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('sets ' + r.status); return r.json(); })
      .then(function (a) {
        clearTimeout(t);
        var l = (Array.isArray(a) ? a : []).map(function (x) { return typeof x === 'string' ? x : (x && (x.value || x.name || x.id)) || ''; }).filter(Boolean);
        if (!l.length) throw new Error('no sets');
        ss('xg-cf-sets-' + g, { at: Date.now(), l: l });
        return (setLists[g] = index(l));
      })
      .catch(function () { clearTimeout(t); delete setLoads[g]; return null; });
    return setLoads[g];
  }
  function index(l) { return l.map(function (name) { return { name: name, n: norm(name) }; }); }

  /* ---------------- filter value lists ---------------- */
  // each entry a string (id = label) or [id, label]; kept a day in sessionStorage per game + list
  var lists = {}, listLoads = {};
  function idOf(e) { return typeof e === 'string' ? e : e[0]; }
  function labelOf(e) { return typeof e === 'string' ? e : e[1]; }
  function loadList(g, api) {
    var key = g + '/' + api;
    if (lists[key]) return Promise.resolve(lists[key]);
    if (listLoads[key]) return listLoads[key];
    var kept = ss('xg-cf-l-' + key);
    if (kept && kept.at > Date.now() - 864e5 && Array.isArray(kept.l)) return Promise.resolve(lists[key] = kept.l);
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 15000);
    listLoads[key] = fetch(SETS_URL + encodeURIComponent(g) + '/' + api, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(api + ' ' + r.status); return r.json(); })
      .then(function (a) {
        clearTimeout(t);
        var l = (Array.isArray(a) ? a : []).map(function (x) {
          if (typeof x === 'string') return x;
          if (!x || x.id == null) return null;
          var id = String(x.id), lab = String(x.value || x.id);
          return id === lab ? id : [id, lab];
        }).filter(Boolean);
        ss('xg-cf-l-' + key, { at: Date.now(), l: l });
        return (lists[key] = l);
      })
      .catch(function () { clearTimeout(t); delete listLoads[key]; return null; });
    return listLoads[key];
  }
  function groupsOf(g) { return FILTERS[g] || []; }
  function copyF(o) { var r = {}; FKEYS.forEach(function (k) { if (o && o[k] && o[k].length) r[k] = o[k].slice(0, 40); }); return r; }
  function hasF(st) { return st.lo !== '' && st.lo !== undefined || st.hi !== '' && st.hi !== undefined || FKEYS.some(function (k) { return st.f && st.f[k] && st.f[k].length; }); }
  function nF(o) { var n = 0; FKEYS.forEach(function (k) { n += (o && o[k] ? o[k].length : 0); }); return n; }
  // "$5 to $20" / "from $5" / "up to $20"
  function priceText(st) {
    var lo = st.lo !== '' && st.lo !== undefined ? money(st.lo) : '', hi = st.hi !== '' && st.hi !== undefined ? money(st.hi) : '';
    return lo && hi ? lo + ' to ' + hi : lo ? 'from ' + lo : hi ? 'up to ' + hi : '';
  }
  // the label a value shows: a fixed chip's, the list's, or the id itself
  function labelFor(g, k, id) {
    var gr = (groupsOf(g) || []).filter(function (x) { return x.k === k; })[0];
    if (!gr) return id;
    var f = gr.fixed && gr.fixed.filter(function (x) { return x[0].toLowerCase() === id.toLowerCase(); })[0];
    if (f) return f[1] || f[0];
    var l = gr.api && lists[g + '/' + gr.api];
    var e = l && l.filter(function (x) { return idOf(x).toLowerCase() === id.toLowerCase(); })[0];
    return e ? labelOf(e) : id;
  }
  // Magic: a chip word -> every type line carrying that word ("Creature" -> "Legendary Creature - Elf", ...)
  function expandTypes(words, list) {
    var out = [], seen = {};
    words.forEach(function (w) {
      var re = new RegExp('(^|[^a-z])' + w.replace(/[^a-z]/gi, '') + '([^a-z]|$)', 'i');
      list.forEach(function (e) { var id = idOf(e); if (re.test(id) && !seen[id]) { seen[id] = 1; out.push(id); } });
    });
    return out.length ? out : words;
  }
  function isHeavy(st) { return st.g === 'mtg' && !st.set && !!(st.f && st.f.types && st.f.types.some(function (t) { return /^creature$/i.test(t); })); }
  // best first: exact, starts with, every word starts a word, contains anywhere
  function candidates(list, text) {
    var n = norm(text);
    if (!n || !list) return [];
    var toks = n.split(' '), out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i], sc = -1;
      if (s.n === n) sc = 0;
      else if (s.n.indexOf(n) === 0) sc = 1;
      else if (toks.every(function (t) { return (' ' + s.n).indexOf(' ' + t) !== -1; })) sc = 2;
      else if (s.n.indexOf(n) !== -1) sc = 3;
      if (sc >= 0) out.push({ name: s.name, sc: sc, len: s.n.length });
    }
    out.sort(function (a, b) { return a.sc - b.sc || a.len - b.len || (a.name < b.name ? -1 : 1); });
    return out;
  }
  // -> {set} when the text names exactly one set; {many} / {none} otherwise.
  // loose: take the best starts-with match too (a collection's own set, "Duskmourn").
  function resolveSet(g, text, loose) {
    var t = String(text || '').trim();
    if (!t) return Promise.resolve({ set: '' });
    return loadSets(g).then(function (list) {
      if (!list) return { set: t, unchecked: true };   // no list: BinderPOS ignores case, so send it as typed
      var c = candidates(list, t);
      if (c.length && c[0].sc === 0) return { set: c[0].name };
      if (c.length === 1) return { set: c[0].name };
      if (loose && c.length && c[0].sc === 1) return { set: c[0].name };
      return c.length ? { many: c } : { none: true };
    });
  }

  /* ---------------- state ---------------- */
  function fresh() { return { g: GAME0, set: '', q: '', sort: 'num', all: false, p: 1, f: {}, lo: '', hi: '' }; }
  // a price bound as typed: a number of dollars (CAD, what BinderPOS prices in) or ''
  function priceOf(v) { v = String(v == null ? '' : v).replace(/[^0-9.]/g, ''); var n = parseFloat(v); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : ''; }
  // The hash is "#cf-" + base64url of the query, so it is always a valid id selector: theme
  // and app scripts call jQuery on location.hash at load, and "#cards?set=..." made Sizzle throw.
  function b64e(t) { try { return btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (e) { return ''; } }
  function b64d(t) { try { return decodeURIComponent(escape(atob(String(t).replace(/-/g, '+').replace(/_/g, '/')))); } catch (e) { return ''; } }
  function fromHash() {
    var h = location.hash || '';
    if (h.indexOf('#cf-') !== 0) return null;
    var u = new URLSearchParams(b64d(h.slice(4))), st = fresh();
    var g = u.get('game');
    if (PICK && g && GAME_NAMES[g]) st.g = g;
    st.set = (u.get('set') || '').slice(0, 120);
    st.q = (u.get('q') || '').slice(0, 120);
    st.sort = SORTS[u.get('sort')] ? u.get('sort') : 'num';
    st.all = u.get('all') === '1';
    st.p = Math.max(1, Math.min(999, parseInt(u.get('p'), 10) || 1));
    var groups = groupsOf(st.g) || [];
    FKEYS.forEach(function (k) {
      var v = u.get(FHASH[k]);
      if (v && groups.some(function (gr) { return gr.k === k; })) st.f[k] = v.split('|').filter(Boolean).slice(0, 40);
    });
    st.lo = priceOf(u.get('lo')); st.hi = priceOf(u.get('hi'));
    return st.set || st.q || hasF(st) ? st : null;
  }
  function hashOf(st) {
    var u = new URLSearchParams();
    if (PICK) u.set('game', st.g);
    if (st.set) u.set('set', st.set);
    if (st.q) u.set('q', st.q);
    if (st.sort !== 'num') u.set('sort', st.sort);
    if (st.all) u.set('all', '1');
    if (st.p > 1) u.set('p', String(st.p));
    FKEYS.forEach(function (k) { if (st.f && st.f[k] && st.f[k].length) u.set(FHASH[k], st.f[k].join('|')); });
    if (st.lo !== '') u.set('lo', String(st.lo));
    if (st.hi !== '') u.set('hi', String(st.hi));
    return '#cf-' + b64e(u.toString());
  }
  function writeHash(st) {
    try { history.replaceState(history.state, '', location.pathname + location.search + (st ? hashOf(st) : '')); } catch (e) {}
  }
  function sortOf(st) {
    // card numbers only mean something inside one set; across sets, sort by name
    if (!st.set && (st.sort === 'num' || st.sort === 'num-desc')) return SORTS.name;
    return SORTS[st.sort] || SORTS.num;
  }
  function bodyOf(st, typeList) {
    var s = sortOf(st);
    var b = { storeUrl: STORE, game: st.g, strict: null, sortTypes: [{ type: s[0], asc: s[1], order: 1 }], variants: null,
      title: st.q || '', priceGreaterThan: st.lo !== '' ? st.lo : 0, priceLessThan: st.hi !== '' ? st.hi : null, instockOnly: !st.all, limit: PER, offset: (st.p - 1) * PER };
    if (st.set) b.setNames = [st.set];
    FKEYS.forEach(function (k) {
      var v = st.f && st.f[k];
      if (!v || !v.length) return;
      if (k === 'types' && st.g === 'mtg' && typeList) v = expandTypes(v, typeList);
      b[k] = v;
    });
    return b;
  }
  // the cache key: the state, not the body (a Magic creature search sends 4,300 type lines)
  function keyOf(st) { return JSON.stringify([st.g, st.set, st.q, st.sort, st.all, st.p, copyF(st.f), st.lo, st.hi]); }
  // the value lists a search needs: Magic's type lines to expand a chip, and every used list so the
  // summary can name the values (a hash restore knows only the ids)
  function prep(st) {
    var groups = groupsOf(st.g) || [], jobs = [];
    groups.forEach(function (gr) { if (gr.api && st.f && st.f[gr.k] && st.f[gr.k].length) jobs.push(loadList(st.g, gr.api)); });
    return Promise.all(jobs).then(function () { return bodyOf(st, st.g === 'mtg' ? lists['mtg/types'] : null); });
  }

  /* ---------------- search ---------------- */
  function post(url, body, ms, outer) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
    function stop() { ctl.abort(); }
    outer.addEventListener('abort', stop);
    function done() { clearTimeout(t); outer.removeEventListener('abort', stop); }
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { done(); if (!j || !Array.isArray(j.products)) throw new Error('bad answer'); return j; },
        function (e) { done(); throw e; });
  }
  // only what the cards draw, so a page fits in sessionStorage
  function slim(j) {
    return {
      count: Number(j.count) || 0,
      items: j.products.map(function (p) {
        return {
          h: p.handle, t: p.title || '', no: p.collectorNumber || p.cardNumber || '', s: p.setName || '', r: p.rarity || '', i: p.img || p.tcgImage || '',
          v: (p.variants || []).filter(function (v) { return v && v.shopifyId; }).map(function (v) { return { id: v.shopifyId, t: v.title || '', p: Number(v.price) || 0, q: Number(v.quantity) || 0 }; })
        };
      }).filter(function (x) { return x.h; })
    };
  }
  var mem = {};
  var CACHE_MS = 5 * 60e3;
  function cacheGet(k) {
    var e = mem[k];
    if (!e) { var all = ss('xg-cf-cache') || []; for (var i = 0; i < all.length; i++) if (all[i] && all[i].k === k) e = all[i]; }
    return e && e.at > Date.now() - CACHE_MS ? e.d : null;
  }
  function cachePut(k, d) {
    var e = { k: k, at: Date.now(), d: d };
    mem[k] = e;
    var all = (ss('xg-cf-cache') || []).filter(function (x) { return x && x.k !== k && x.at > Date.now() - CACHE_MS; });
    all.unshift(e);
    ss('xg-cf-cache', all.slice(0, 6));
  }

  var seq = 0, live = null, cur = null, ticker = null;
  function run(st, how) {
    how = how || {};
    intent++;
    if (live) live.abort();
    var my = ++seq, ctl = live = new AbortController();
    var key = keyOf(st);
    cur = st;
    writeHash(st);
    open(true);
    var hit = cacheGet(key);
    if (hit) { draw(st, hit, how); return; }
    busy(st, true);
    if (how.scroll) toBar();   // the wait, an error or an empty page all land in view
    var heavy = isHeavy(st);
    if (heavy) { var hs = res.querySelector('.xg-cf-res__sum'); if (hs) hs.innerHTML = 'Searching every set for creatures takes a while&hellip; pick a set for a quick answer.'; }
    prep(st).then(function (body) {
      if (my !== seq) return null;
      return post(BP, body, heavy ? 45000 : 15000, ctl.signal)
        .catch(function (e) {
          if (my !== seq) throw e;
          return post(WORKER, body, 50000, ctl.signal);
        });
    }).then(function (j) {
      if (my !== seq || !j) return;
      var d = slim(j);
      cachePut(key, d);
      draw(st, d, how);
    }, function () {
      if (my !== seq) return;
      failed(st, how);
    });
  }

  /* ---------------- DOM ---------------- */
  var col, bar, res, inSet, inQ, selSort, selGame, chkStock, list, msg, quick, fb, more;
  var sel = {};             // the filter values picked in the panel, by list
  var moreGen = 0;          // bumped on every panel render, so a late list load draws nothing stale
  var chosen = '';          // the set name picked from the list (exact)
  var active = -1;          // highlighted row in the list

  function mount() {
    var grid = document.getElementById('main-collection-product-grid');
    col = document.querySelector('.normal_main_content') || (grid && grid.closest('.shopify-section') && grid.closest('.shopify-section').parentElement);
    if (!col) return false;
    css();
    bar = document.createElement('form');
    bar.className = 'xg-cf';
    bar.setAttribute('novalidate', '');
    bar.setAttribute('role', 'search');
    bar.setAttribute('aria-label', 'Find a card');
    var games = PICK ? '<label class="xg-cf__f xg-cf__f--game"><span>Game</span><select class="xg-cf__in" data-f="g">' +
      Object.keys(GAME_NAMES).map(function (k) { return '<option value="' + k + '">' + esc(GAME_NAMES[k]) + '</option>'; }).join('') + '</select></label>' : '';
    bar.innerHTML =
      '<p class="xg-cf__sr" role="status" aria-live="polite" aria-atomic="true"></p>' +
      '<button type="button" class="xg-cf__top" aria-expanded="false" aria-controls="xg-cf-body">' +
        '<span class="xg-cf__ic">' + ICON + '</span>' +
        '<span class="xg-cf__tt"><strong>Find a card</strong> <span>by set and name together, or a whole set in card-number order</span></span>' +
        '<span class="xg-cf__chev" aria-hidden="true"></span></button>' +
      '<div class="xg-cf__quick" hidden></div>' +
      '<div class="xg-cf__body" id="xg-cf-body">' +
        '<div class="xg-cf__row">' + games +
          '<div class="xg-cf__f xg-cf__f--set"><label for="xg-cf-set">Set</label>' +
            '<input id="xg-cf-set" class="xg-cf__in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Any set - start typing" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="xg-cf-sets">' +
            '<ul id="xg-cf-sets" class="xg-cf__list" role="listbox" aria-label="Sets" hidden></ul></div>' +
          '<div class="xg-cf__f xg-cf__f--q"><label for="xg-cf-q">Card name</label>' +
            '<input id="xg-cf-q" class="xg-cf__in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Any card" maxlength="120"></div>' +
          '<div class="xg-cf__f xg-cf__f--sort"><label for="xg-cf-sort">Sort by</label><select id="xg-cf-sort" class="xg-cf__in">' +
            Object.keys(SORTS).map(function (k) { return '<option value="' + k + '">' + esc(SORTS[k][2]) + '</option>'; }).join('') + '</select></div>' +
          '<label class="xg-cf__chk"><input type="checkbox" checked> In stock only</label>' +
          '<button type="button" class="xg-cf__fb" aria-expanded="false" aria-controls="xg-cf-more" hidden>Filters</button>' +
          '<button type="submit" class="xg-cf__go">Search</button>' +
        '</div>' +
        '<div class="xg-cf__more" id="xg-cf-more" hidden></div>' +
        '<p class="xg-cf__msg" role="status" aria-live="polite"></p>' +
        '<p class="xg-cf__tip">Pick a set and leave the name empty to see the whole set in card-number order. Condition and printing filters: <a href="/pages/advanced-search?game=' + encodeURIComponent(GAME0) + '">Advanced Search &rsaquo;</a></p>' +
      '</div>';
    res = document.createElement('section');
    res.className = 'xg-cf-res';
    res.hidden = true;
    res.setAttribute('aria-label', 'Card finder results');
    col.insertBefore(bar, col.firstChild);
    bar.parentNode.insertBefore(res, bar.nextSibling);
    inSet = bar.querySelector('#xg-cf-set');
    inQ = bar.querySelector('#xg-cf-q');
    selSort = bar.querySelector('#xg-cf-sort');
    selGame = bar.querySelector('[data-f="g"]');
    chkStock = bar.querySelector('.xg-cf__chk input');
    list = bar.querySelector('.xg-cf__list');
    msg = bar.querySelector('.xg-cf__msg');
    quick = bar.querySelector('.xg-cf__quick');
    fb = bar.querySelector('.xg-cf__fb');
    more = bar.querySelector('.xg-cf__more');
    sr = bar.querySelector('.xg-cf__sr');
    fbUpdate();
    expand(window.matchMedia ? window.matchMedia('(min-width: 768px)').matches : true);
    wire();
    // the app and the theme re-render around us; put the bar back if it is ever dropped
    try {
      new MutationObserver(function () {
        if (!bar.isConnected && col.isConnected) col.insertBefore(bar, col.firstChild);
        if (!res.isConnected && bar.isConnected) bar.parentNode.insertBefore(res, bar.nextSibling);
      }).observe(col, { childList: true });
    } catch (e) {}
    return true;
  }

  function expand(on) {
    if (on) bar.setAttribute('data-open', ''); else bar.removeAttribute('data-open');
    bar.querySelector('.xg-cf__top').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function note(t, bad) { msg.textContent = t || ''; msg.classList.toggle('is-bad', !!bad); }
  function game() { return selGame ? selGame.value : GAME0; }

  function fill(st) {
    if (selGame) selGame.value = st.g;
    inSet.value = st.set || '';
    chosen = st.set || '';
    inQ.value = st.q || '';
    selSort.value = st.sort;
    chkStock.checked = !st.all;
    sel = copyF(st.f);
    pLo = st.lo === undefined ? '' : st.lo; pHi = st.hi === undefined ? '' : st.hi;
    fbUpdate();
    if (more && !more.hidden) renderMore();
  }
  var pLo = '', pHi = '';   // the price bounds, kept beside the chips (the panel may be closed or rebuilt)
  function readPrices() {
    var a = more && more.querySelector('[data-p="lo"]'), b = more && more.querySelector('[data-p="hi"]');
    if (a) pLo = priceOf(a.value);
    if (b) pHi = priceOf(b.value);
    if (pLo !== '' && pHi !== '' && pHi < pLo) { var t = pLo; pLo = pHi; pHi = t; }
  }
  function nPrice() { return (pLo !== '' ? 1 : 0) + (pHi !== '' ? 1 : 0) ? 1 : 0; }

  /* ---------------- filter panel ---------------- */
  function fbUpdate() {
    if (!fb) return;
    var n = nF(sel) + nPrice();
    fb.hidden = false;
    fb.innerHTML = 'Filters' + (n ? ' <b>' + n + '</b>' : '') + '<span class="xg-cf__chev" aria-hidden="true"></span>';
    fb.classList.toggle('is-on', n > 0);
    var clr = more && more.querySelector('[data-clear]');
    if (clr) clr.hidden = !n;
  }
  function chipHtml(k, id, label, on, swatch) {
    return '<button type="button" class="xg-cf__chip" data-k="' + esc(k) + '" data-v="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      (swatch ? '<i style="background:' + esc(swatch) + '"></i>' : '') + esc(label) + '</button>';
  }
  function picked(k, id) { return (sel[k] || []).some(function (c) { return c.toLowerCase() === String(id).toLowerCase(); }); }
  function renderMore() {
    if (!more) return;
    var g = game(), groups = groupsOf(g), gen = ++moreGen;
    fbUpdate();
    more.innerHTML = '<fieldset class="xg-cf__grp xg-cf__grp--price"><legend>Price (CAD)</legend><div class="xg-cf__price">' +
      '<input class="xg-cf__in xg-cf__pin" data-p="lo" type="text" inputmode="decimal" autocomplete="off" placeholder="Min" aria-label="Lowest price" value="' + (pLo === '' ? '' : pLo) + '">' +
      '<span class="xg-cf__pto">to</span>' +
      '<input class="xg-cf__in xg-cf__pin" data-p="hi" type="text" inputmode="decimal" autocomplete="off" placeholder="Max" aria-label="Highest price" value="' + (pHi === '' ? '' : pHi) + '">' +
      '</div></fieldset>' + groups.map(function (gr) {
      var html = '<fieldset class="xg-cf__grp" data-k="' + gr.k + '"><legend>' + esc(gr.label) + '</legend><div class="xg-cf__chips">';
      if (gr.fixed) html += gr.fixed.map(function (f) { return chipHtml(gr.k, f[0], f[1] || f[0], picked(gr.k, f[0]), f[2]); }).join('');
      else html += '<span class="xg-cf__chips-note">Loading&hellip;</span>';
      return html + '</div></fieldset>';
    }).join('') +
      '<div class="xg-cf__morefoot"><button type="button" class="xg-cf__clear" data-clear' + (nF(sel) + nPrice() ? '' : ' hidden') + '>Clear filters</button>' +
      '<span class="xg-cf__morehint">' + (groups.length ? 'Pick as many as you like: values in one row are &ldquo;or&rdquo;, the rows narrow each other. A price matches any condition or finish of the card.' : 'A price matches any condition or finish of the card, before tax.') + '</span></div>';
    groups.forEach(function (gr) {
      if (!gr.api || gr.fixed) return;
      loadList(g, gr.api).then(function (l) {
        if (gen !== moreGen) return;
        var box = more.querySelector('.xg-cf__grp[data-k="' + gr.k + '"] .xg-cf__chips');
        if (!box) return;
        if (!l) { box.innerHTML = '<span class="xg-cf__chips-note">The list did not load - try again in a moment.</span>'; return; }
        if (gr.keep) l = l.filter(function (e) { return gr.keep.test(idOf(e)); });
        var byN = {};
        l.forEach(function (e) { byN[norm(idOf(e))] = e; });
        var shown = gr.prefer ? gr.prefer.map(function (x) { return byN[norm(x)]; }).filter(Boolean) : (l.length <= 16 ? l.slice() : l.slice(0, 16));
        var ids = {};
        shown.forEach(function (e) { ids[idOf(e).toLowerCase()] = 1; });
        (sel[gr.k] || []).forEach(function (id) {
          if (ids[id.toLowerCase()]) return;
          var e = l.filter(function (x) { return idOf(x).toLowerCase() === id.toLowerCase(); })[0];
          shown.push(e || id); ids[id.toLowerCase()] = 1;
        });
        var rest = l.filter(function (e) { return !ids[idOf(e).toLowerCase()]; });
        box.innerHTML = shown.map(function (e) { return chipHtml(gr.k, idOf(e), labelOf(e), picked(gr.k, idOf(e))); }).join('') +
          (rest.length ? '<select class="xg-cf__in xg-cf__add" data-k="' + gr.k + '" aria-label="Add a ' + esc(gr.label.toLowerCase()) + '"><option value="">' + (shown.length ? 'More' : 'Choose') + '&hellip;</option>' +
            rest.map(function (e) { return '<option value="' + esc(idOf(e)) + '">' + esc(labelOf(e)) + '</option>'; }).join('') + '</select>' : '');
      });
    });
  }
  function toggleF(k, id, on) {
    var a = (sel[k] || []).filter(function (c) { return c.toLowerCase() !== String(id).toLowerCase(); });
    if (on) a.push(id);
    if (a.length) sel[k] = a; else delete sel[k];
  }
  // results already showing: a changed filter re-runs the search from page 1, with whatever the
  // name, sort and stock boxes say now; a retyped set goes through the normal submit (it must resolve)
  function refilter() {
    if (!cur) return;
    if (norm(inSet.value) !== norm(cur.set)) { submit(); return; }
    readPrices();
    run(Object.assign({}, cur, { q: inQ.value.trim().slice(0, 120), sort: selSort.value, all: !chkStock.checked, f: copyF(sel), lo: pLo, hi: pHi, p: 1 }), {});
  }

  /* set list (combobox) */
  function showList(items, head) {
    active = -1;
    var h = head ? '<li class="xg-cf__li xg-cf__li--note" role="presentation">' + esc(head) + '</li>' : '';
    list.innerHTML = h + items.slice(0, 60).map(function (c, i) {
      return '<li class="xg-cf__li" role="option" id="xg-cf-o' + i + '" data-set="' + esc(c.name) + '" aria-selected="false">' + esc(c.name) + '</li>';
    }).join('');
    list.hidden = !h && !items.length;
    inSet.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
    inSet.removeAttribute('aria-activedescendant');
  }
  function hideList() { list.hidden = true; inSet.setAttribute('aria-expanded', 'false'); inSet.removeAttribute('aria-activedescendant'); active = -1; }
  function refreshList() {
    var t = inSet.value, g = game();
    if (!norm(t)) { showList([], 'Type part of a set name'); return; }
    var hadList = !!setLists[g];
    if (!hadList) showList([], 'Loading sets…');
    loadSets(g).then(function (l) {
      if (inSet.value !== t || document.activeElement !== inSet) return;
      if (!l) { showList([], 'Set list unavailable - type the full set name'); return; }
      var c = candidates(l, t);
      showList(c, c.length ? '' : 'No ' + (GAME_NAMES[g] || '') + ' set by that name');
    });
  }
  function move(d) {
    var opts = list.querySelectorAll('[role="option"]');
    if (!opts.length) return;
    active = (active + d + opts.length) % opts.length;
    for (var i = 0; i < opts.length; i++) opts[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
    inSet.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  }
  function pickSet(name) {
    inSet.value = chosen = name;
    hideList();
    note('');
    submit();   // a set on its own is already a search: the whole set in card-number order
  }

  function readForm() {
    var st = fresh();
    st.g = game();
    st.q = inQ.value.trim().slice(0, 120);
    st.sort = selSort.value;
    st.all = !chkStock.checked;
    var groups = groupsOf(st.g) || [];
    st.f = {};
    groups.forEach(function (gr) { if (sel[gr.k] && sel[gr.k].length) st.f[gr.k] = sel[gr.k].slice(0, 40); });
    readPrices();
    st.lo = pLo; st.hi = pHi;
    return st;
  }
  function submit() {
    var st = readForm(), text = inSet.value.trim();
    hideQuick();
    if (!text && !st.q && !hasF(st)) { note('Type a card name, pick a set, or both.', true); inSet.focus(); return; }
    if (text && chosen && norm(chosen) === norm(text)) { st.set = chosen; go(st); return; }
    var my = ++intent;
    if (text && !setLists[st.g]) note('Checking the set name…');
    resolveSet(st.g, text).then(function (r) {
      if (my !== intent) return;   // the shopper has moved on
      if (r.set !== undefined) {
        st.set = r.set;
        if (r.set && !r.unchecked) inSet.value = chosen = r.set;
        go(st);
      } else if (r.many) {
        note('Which set? Pick one from the list.', true);
        inSet.focus();
        showList(r.many);
      } else {
        note('No ' + (GAME_NAMES[st.g] || '') + ' set is called "' + text + '". Check the spelling or pick from the list.', true);
        inSet.focus();
      }
    });
  }
  function go(st) {
    hideList();
    note('');
    // phones: fold the form away so the results start near the top of the screen
    if (window.matchMedia && !window.matchMedia('(min-width: 768px)').matches) { expand(false); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
    run(st, { scroll: true });
  }

  function hideQuick() { quick.hidden = true; quick.innerHTML = ''; }

  /* ---------------- results ---------------- */
  function open(on) {
    res.hidden = !on;
    col.classList.toggle('xg-cf-on', !!on);
  }
  function close() {
    if (live) live.abort();
    seq++;
    intent++;
    cur = null;
    clearInterval(ticker);
    res.innerHTML = '';
    open(false);
    writeHash(null);
    if (OFF) ss('xg-cf-off', OFF);   // this page's auto-run stays off until the app's boxes change
    note('');
  }
  function summary(st, d) {
    var s = sortOf(st);
    var n = d.count, pages = Math.max(1, Math.ceil(n / PER));
    var what = '<strong>' + n.toLocaleString('en-CA') + ' card' + (n === 1 ? '' : 's') + '</strong>' +
      (st.q ? ' named &ldquo;' + esc(st.q) + '&rdquo;' : '') +
      (st.set ? ' in <strong>' + esc(st.set) + '</strong>' : (PICK ? ' in ' + esc(GAME_NAMES[st.g]) : '')) +
      (st.all ? '' : ', in stock') + filterText(st) + (priceText(st) ? ', ' + esc(priceText(st)) : '');
    return what + ' <span class="xg-cf-res__by">&middot; ' + esc(s[3]) + (pages > 1 ? ' &middot; page ' + st.p + ' of ' + pages : '') + '</span>';
  }
  // ", red or green, rare or mythic" - the picked values, in the order the panel shows them
  function filterText(st) {
    if (!hasF(st)) return '';
    return (groupsOf(st.g) || []).map(function (gr) {
      var v = st.f[gr.k];
      return v && v.length ? v.map(function (id) { return esc(labelFor(st.g, gr.k, id)); }).join(' or ') : '';
    }).filter(Boolean).map(function (t) { return ', ' + t; }).join('');
  }
  function head(st, d, extra) {
    return '<div class="xg-cf-res__head"><p class="xg-cf-res__sum">' + (d ? summary(st, d) : 'Searching&hellip;') + '</p>' +
      '<button type="button" class="xg-cf-res__x" data-x>&times; Back to all cards</button>' +
      (extra ? '<p class="xg-cf-res__extra">' + extra + '</p>' : '') + '</div>';
  }
  function busy(st, on) {
    clearInterval(ticker);
    res.setAttribute('aria-busy', on ? 'true' : 'false');
    if (!on) return;
    if (!res.querySelector('.xg-cf-grid')) res.innerHTML = head(st, null) + '<div class="xg-cf-wait"><span class="xg-cf-spin"></span></div>';
    else {
      var sum = res.querySelector('.xg-cf-res__sum');
      if (sum) sum.innerHTML = 'Searching&hellip;';
    }
    var t0 = Date.now();
    ticker = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000), sum = res.querySelector('.xg-cf-res__sum');
      if (s >= 3 && sum) sum.innerHTML = 'Still searching&hellip; ' + s + ' s';
    }, 1000);
  }
  function failed(st, how) {
    busy(st, false);
    res.innerHTML = head(st, null).replace('Searching&hellip;', 'The card search did not answer.') +
      '<div class="xg-cf-empty"><p>It may be busy for a moment.</p><p><button type="button" class="xg-cf-btn" data-retry>Try again</button> ' +
      '<a class="xg-cf-link" href="/pages/advanced-search?game=' + encodeURIComponent(st.g) + '">Open Advanced Search</a></p></div>';
    after(how || {}, 'The card search did not answer. Try again.');
  }
  // scroll so the results (or the wait) start near the top of the screen
  function toBar() {
    var top = res.getBoundingClientRect().top;
    if (top < 60 || top > window.innerHeight * 0.6) window.scrollTo({ top: Math.max(0, window.pageYOffset + bar.getBoundingClientRect().top - 90), behavior: 'smooth' });
  }
  // after a draw: tell screen readers, scroll when asked, and keep keyboard focus inside the
  // results when the action came from a button that the redraw just removed
  function after(how, text) {
    say(text);
    if (how.scroll) toBar();
    if (how.focus) { var f = res.querySelector('.xg-cf-res__sum'); if (f) { f.setAttribute('tabindex', '-1'); try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }
  }
  function draw(st, d, how) {
    busy(st, false);
    var extra = how.both ? 'Showing only cards that match <em>both</em> the set and the name.' : '';
    if (!d.items.length) {
      var tips = [];
      if (!st.all) tips.push('<button type="button" class="xg-cf-btn" data-all>Include sold-out cards</button>');
      if (st.q && st.set) tips.push('<button type="button" class="xg-cf-btn" data-noq>All of ' + esc(st.set) + '</button>');
      if (st.p > 1) tips.push('<button type="button" class="xg-cf-btn" data-p="1">First page</button>');
      if (hasF(st)) tips.push('<button type="button" class="xg-cf-btn" data-clear>Clear filters</button>');
      res.innerHTML = head(st, d, extra) + '<div class="xg-cf-empty"><p>No ' + (st.all ? '' : 'in-stock ') + 'cards match' +
        (st.q ? ' &ldquo;' + esc(st.q) + '&rdquo;' : '') + (st.set ? ' in ' + esc(st.set) : '') + (filterText(st) + (priceText(st) ? ', ' + esc(priceText(st)) : '')).replace(/^, /, ' with ') + '.</p>' + (tips.length ? '<p>' + tips.join(' ') + '</p>' : '') + '</div>';
      after(how, res.querySelector('.xg-cf-empty p').textContent);
      return;
    }
    res.innerHTML = head(st, d, extra) + '<ul class="xg-cf-grid">' + d.items.map(card).join('') + '</ul>' + pager(st.p, Math.ceil(d.count / PER));
    checkListed();
    var back = ss('xg-cf-y');
    if (how.restore && back && back.h === location.hash) {
      // saved relative to the results, so the form being open or folded makes no difference
      ss('xg-cf-y', null);
      requestAnimationFrame(function () { window.scrollTo(0, Math.max(0, window.pageYOffset + res.getBoundingClientRect().top + back.y)); });
      after({}, res.querySelector('.xg-cf-res__sum').textContent);
    } else after(how, res.querySelector('.xg-cf-res__sum').textContent);
  }
  /* BinderPOS answers from its card catalogue, so a sold-out card can be one the store never
     listed: its /products/ page is a 404 (owner, 2026-09-29: Elspeth, Sun's Champion [Reality
     Fracture Commander], "I get a 404 when I click on See card"). Ask the storefront for each
     sold-out card on the page (a HEAD on /products/<handle>.js, remembered a day) and turn the
     links of the unlisted ones into "Not listed online". */
  var listed = ss('xg-cf-listed') || {};
  function checkListed() {
    var cards = res.querySelectorAll('.xg-cf-card[data-chk]');
    if (!cards.length) return;
    var now = Date.now(), pending = [];
    [].forEach.call(cards, function (li) {
      var h = li.getAttribute('data-chk'), k = listed[h];
      if (k && k.at > now - 864e5) { if (!k.ok) unlist(li); return; }
      pending.push(h);
    });
    if (!pending.length) return;
    Promise.all(pending.map(function (h) {
      return fetch('/products/' + encodeURIComponent(h) + '.js', { method: 'HEAD', credentials: 'same-origin' })
        .then(function (r) { return r.status === 404 ? false : true; }, function () { return null; })
        .then(function (ok) { if (ok !== null) listed[h] = { ok: ok, at: now }; });
    })).then(function () {
      var keep = {}, n = 0;
      Object.keys(listed).forEach(function (h) { if (listed[h].at > now - 864e5 && n++ < 400) keep[h] = listed[h]; });
      listed = keep;
      ss('xg-cf-listed', listed);
      [].forEach.call(res.querySelectorAll('.xg-cf-card[data-chk]'), function (li) {
        var k = listed[li.getAttribute('data-chk')];
        if (k && !k.ok) unlist(li);
      });
    });
  }
  function unlist(li) {
    if (li.hasAttribute('data-unlisted')) return;
    li.setAttribute('data-unlisted', '');
    [].forEach.call(li.querySelectorAll('a'), function (a) {
      var el = document.createElement(a.classList.contains('xg-cf-card__see') ? 'span' : 'span');
      el.className = a.className;
      if (a.classList.contains('xg-cf-card__see')) el.textContent = 'Not listed online';
      else el.innerHTML = a.innerHTML;
      a.parentNode.replaceChild(el, a);
    });
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function card(p) {
    var name = p.t.replace(/\s*\[[^\]]*\]\s*$/, '') || p.t;
    var url = '/products/' + encodeURIComponent(p.h);
    var vs = p.v.slice(), inStock = vs.filter(function (v) { return v.q > 0; });
    var first = inStock[0];
    var meta = [p.s, cap(p.r)].filter(Boolean).map(esc).join(' &middot; ');
    var no = p.no ? '<span class="xg-cf-card__no">#' + esc(p.no) + '</span>' : '';
    var buy;
    if (!first) {
      buy = '<div class="xg-cf-card__row"><span class="xg-cf-card__out">Sold out</span><a class="xg-cf-card__see" href="' + url + '">See card</a></div>';
    } else {
      var cond = inStock.length > 1
        ? '<select class="xg-cf-card__cond" aria-label="Condition for ' + esc(name) + '">' + inStock.map(function (v) {
            return '<option value="' + v.id + '" data-p="' + v.p + '">' + esc(v.t) + ' &middot; ' + money(v.p) + ' (' + v.q + ')</option>';
          }).join('') + '</select>'
        : '<span class="xg-cf-card__one">' + esc(first.t) + ' &middot; ' + first.q + ' in stock</span>';
      buy = cond + '<div class="xg-cf-card__row"><span class="xg-cf-card__price">' + money(first.p) + '</span>' +
        '<button type="button" class="xg-cf-card__add" data-id="' + first.id + '">Add to cart</button></div>';
    }
    return '<li class="xg-cf-card' + (first ? '' : ' xg-cf-card--out') + '"' + (first ? '' : ' data-chk="' + esc(p.h) + '"') + '>' +
      '<a class="xg-cf-card__img" href="' + url + '" tabindex="-1" aria-hidden="true">' +
        (p.i ? '<img src="' + esc(p.i) + '" alt="" loading="lazy" decoding="async" width="244" height="340" onerror="this.style.visibility=\'hidden\'">' : '') + no + '</a>' +
      '<a class="xg-cf-card__nm" href="' + url + '">' + esc(name) + '</a>' +
      '<span class="xg-cf-card__meta">' + meta + '</span>' +
      '<div class="xg-cf-card__buy">' + buy + '</div></li>';
  }
  function pager(p, n) {
    if (n <= 1) return '';
    var nums = [], i;
    for (i = 1; i <= n; i++) if (i === 1 || i === n || Math.abs(i - p) <= 2) nums.push(i);
    var out = [], last = 0;
    out.push('<button type="button" class="xg-cf-pg__b" data-p="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + ' aria-label="Previous page">&lsaquo;</button>');
    nums.forEach(function (k) {
      if (k - last > 1) out.push('<span class="xg-cf-pg__gap">&hellip;</span>');
      out.push('<button type="button" class="xg-cf-pg__b" data-p="' + k + '"' + (k === p ? ' aria-current="page"' : '') + '>' + k + '</button>');
      last = k;
    });
    out.push('<button type="button" class="xg-cf-pg__b" data-p="' + (p + 1) + '"' + (p >= n ? ' disabled' : '') + ' aria-label="Next page">&rsaquo;</button>');
    return '<nav class="xg-cf-pg" aria-label="Pages">' + out.join('') + '</nav>';
  }

  function addToCart(b) {
    var id = Number(b.getAttribute('data-id'));
    if (!id || b.getAttribute('data-busy')) return;
    b.setAttribute('data-busy', '1');
    var label = b.textContent;
    b.textContent = 'Adding…';
    function reset(ms) { setTimeout(function () { b.textContent = label; b.classList.remove('is-ok', 'is-bad'); b.removeAttribute('data-busy'); }, ms); }
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: id, quantity: 1 }] })
    }).then(function (r) {
      if (r.ok) return r.json().catch(function () { return null; });
      return r.json().catch(function () { return {}; }).then(function (e) { var err = new Error('add ' + r.status); err.st = r.status; err.d = String((e && (e.description || e.message)) || ''); throw err; });
    }).then(function (j) {
      try {
        var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown;
        if (typeof sync === 'function') sync();
      } catch (e) {}
      try {
        var it = j && j.items && j.items[0];
        if (it && window.xgCartPeek) window.xgCartPeek({ title: it.title, image: it.image, url: it.url, qty: it.quantity, cents: it.discounted_price });
      } catch (e) {}
      b.classList.add('is-ok');
      b.textContent = 'Added ✓';
      reset(1600);
    }).catch(function (e) {
      // 422 "sold out": that condition just sold (BinderPOS stock can trail the store by a moment);
      // any other 422 means every copy is already in the cart (we always add one); the rest is retryable
      var st = e && e.st, d = String((e && e.d) || '');
      b.classList.add('is-bad');
      b.textContent = st === 422 ? (/sold out/i.test(d) ? 'Just sold' : 'All in your cart') : 'Try again';
      if (d) b.title = d;
      reset(2400);
    });
  }

  /* ---------------- events ---------------- */
  function wire() {
    bar.addEventListener('submit', function (e) { e.preventDefault(); hideList(); submit(); });
    bar.querySelector('.xg-cf__top').addEventListener('click', function () { expand(!bar.hasAttribute('data-open')); });
    inSet.addEventListener('input', function () { chosen = ''; note(''); refreshList(); });
    inSet.addEventListener('focus', function () { refreshList(); });
    inSet.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== inSet) hideList(); }, 150); });
    inSet.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Down') { e.preventDefault(); if (list.hidden) refreshList(); else move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'Up') { e.preventDefault(); move(-1); }
      else if (e.key === 'Escape' || e.key === 'Esc') { if (!list.hidden) { e.preventDefault(); hideList(); } }
      else if (e.key === 'Enter' && !list.hidden && active >= 0) {
        e.preventDefault();
        var o = list.querySelectorAll('[role="option"]')[active];
        if (o) pickSet(o.getAttribute('data-set'));
      }
    });
    // mousedown, so the pick lands before the input's blur closes the list
    list.addEventListener('mousedown', function (e) {
      var o = e.target.closest('[role="option"]');
      e.preventDefault();
      if (o) pickSet(o.getAttribute('data-set'));
    });
    if (selGame) selGame.addEventListener('change', function () { intent++; inSet.value = chosen = ''; hideList(); loadSets(game()); sel = {}; renderMore(); });
    fb.addEventListener('click', function () {
      var show = more.hidden;
      more.hidden = !show;
      fb.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) renderMore();
    });
    more.addEventListener('click', function (e) {
      var c = e.target.closest('.xg-cf__chip');
      if (c) {
        var on = c.getAttribute('aria-pressed') !== 'true';
        toggleF(c.getAttribute('data-k'), c.getAttribute('data-v'), on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        fbUpdate();
        refilter();
        return;
      }
      if (e.target.closest('[data-clear]')) { sel = {}; pLo = pHi = ''; renderMore(); refilter(); }
    });
    more.addEventListener('change', function (e) {
      if (e.target.closest('.xg-cf__pin')) { readPrices(); fbUpdate(); refilter(); return; }
      var s = e.target.closest('.xg-cf__add');
      if (!s || !s.value) return;
      toggleF(s.getAttribute('data-k'), s.value, true);
      renderMore();
      refilter();
    });
    // Enter in a price box searches (the form's submit), never a stray newline
    more.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.closest('.xg-cf__pin')) { e.preventDefault(); readPrices(); fbUpdate(); if (cur) refilter(); else submit(); } });
    quick.addEventListener('click', function (e) {
      var b = e.target.closest('[data-quick]');
      if (!b) return;
      var st = readForm();
      st.set = b.getAttribute('data-quick');
      st.q = '';
      st.sort = 'num';
      inQ.value = '';
      selSort.value = 'num';
      hideQuick();
      go(st);
    });
    res.addEventListener('click', function (e) {
      var t = e.target.closest('button, a');
      if (!t || !cur) return;
      if (t.hasAttribute('data-x')) { close(); var tb = bar.querySelector('.xg-cf__top'); try { tb.focus({ preventScroll: true }); } catch (e) { tb.focus(); } return; }
      if (t.hasAttribute('data-retry')) { run(cur, { focus: true }); return; }
      if (t.hasAttribute('data-all')) { chkStock.checked = false; run(Object.assign({}, cur, { all: true, p: 1 }), { focus: true }); return; }
      if (t.hasAttribute('data-noq')) { inQ.value = ''; run(Object.assign({}, cur, { q: '', p: 1 }), { focus: true }); return; }
      if (t.hasAttribute('data-clear')) { sel = {}; pLo = pHi = ''; renderMore(); run(Object.assign({}, cur, { f: {}, lo: '', hi: '', p: 1 }), { focus: true }); return; }
      if (t.hasAttribute('data-p') && t.tagName === 'BUTTON') {
        if (res.getAttribute('aria-busy') === 'true') return;   // the old pager under a pending search
        var p = parseInt(t.getAttribute('data-p'), 10);
        if (p >= 1 && !t.disabled) run(Object.assign({}, cur, { p: p }), { scroll: true, focus: true });
        return;
      }
      if (t.classList.contains('xg-cf-card__add')) { addToCart(t); return; }
      if (t.tagName === 'A' && t.closest('.xg-cf-card')) ss('xg-cf-y', { h: location.hash, y: -res.getBoundingClientRect().top });
    });
    res.addEventListener('change', function (e) {
      var s = e.target.closest('.xg-cf-card__cond');
      if (!s) return;
      var o = s.options[s.selectedIndex], c = s.closest('.xg-cf-card');
      c.querySelector('.xg-cf-card__price').textContent = money(o.getAttribute('data-p'));
      c.querySelector('.xg-cf-card__add').setAttribute('data-id', o.value);
    });
    // the shopper went back to the app's own filters: give the page back to the app
    document.addEventListener('click', function (e) {
      if (!cur || !e.target || !e.target.closest) return;
      if (e.target.closest('#cloud_search_filters_sidebar, #cloud_search_filters_root')) close();
    }, true);
  }

  /* ---------------- start ---------------- */
  function start() {
    if (!mount()) return;
    var st = fromHash();
    if (st) { fill(st); run(st, { restore: true }); return; }   // mount() left the form open on desktop, folded on phones
    var qs = new URLSearchParams(location.search);
    var onApp = /^\/a\/search\//.test(location.pathname);
    var appSet = onApp ? (qs.get('filter_search_set_name') || '').trim() : '';
    var appName = onApp ? (qs.get('filter_search_card_name') || '').trim() : '';
    var wantSet = appSet || PRESET_SET;
    if (appName) inQ.value = appName.slice(0, 120);
    if (!wantSet) return;
    inSet.value = wantSet;
    OFF = appSet && appName ? HANDLE + '|' + norm(appSet) + '|' + norm(appName) : '';
    var my = ++intent;
    // a pick-a-game page: the game whose set list names the app's set exactly (Magic first)
    var pickGame = PICK && appSet
      ? Promise.all(Object.keys(GAME_NAMES).map(function (g) {
          return loadSets(g).then(function (l) { var c = candidates(l, appSet); return c.length && c[0].sc === 0 ? g : null; });
        })).then(function (a) { return a.filter(Boolean)[0] || GAME0; })
      : Promise.resolve(GAME0);
    pickGame.then(function (g) {
      if (my !== intent) return;
      if (selGame) selGame.value = g;
      return resolveSet(g, wantSet, !appSet).then(function (r) {
        if (my !== intent) return;
        if (!r.set || r.unchecked) { if (appSet && appName) expand(true); return; }
        if (inSet.value === wantSet) inSet.value = chosen = r.set;
        if (appSet && appName && ss('xg-cf-off') !== OFF) {
          // both app boxes filled: the shopper meant this card in this set
          var s2 = fresh();
          s2.g = g; s2.set = r.set; s2.q = appName.slice(0, 120);
          expand(true);
          run(s2, { both: true });
        } else {
          quick.innerHTML = '<button type="button" class="xg-cf__qb" data-quick="' + esc(r.set) + '">' + ICON +
            ' <span>See <strong>' + esc(r.set) + '</strong> in card-number order</span> &rsaquo;</button>';
          quick.hidden = false;
        }
      });
    });
  }

  function css() {
    if (document.getElementById('xg-cf-css')) return;
    var st = document.createElement('style');
    st.id = 'xg-cf-css';
    var ARR = 'background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 fill=%27none%27 stroke=%27%23888%27 stroke-width=%271.6%27/%3E%3C/svg%3E");background-repeat:no-repeat;';
    st.textContent =
      '.xg-cf__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
      '.xg-cf{position:relative;margin:0 0 16px;border:1px solid var(--xg-border,#e3e6e8);border-left:4px solid var(--xg-red,#d62c28);border-radius:12px;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);font-size:14px;line-height:1.4;text-align:left}' +
      '.xg-cf button.xg-cf__top{display:flex;align-items:center;gap:12px;width:100%;min-height:0;margin:0;padding:12px 16px;border:0;border-radius:12px;background:none;color:inherit;font:inherit;text-align:left;text-transform:none;letter-spacing:normal;box-shadow:none;cursor:pointer}' +
      '.xg-cf__ic{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--xg-red,#d62c28);color:#fff}' +
      '.xg-cf__tt{flex:1;min-width:0;color:var(--xg-text,#3d454b);font-size:13.5px}.xg-cf__tt strong{margin-right:4px;color:var(--xg-ink,#171b1d);font-size:15.5px;font-weight:800}' +
      '.xg-cf__chev{flex:none;width:9px;height:9px;margin:0 4px 4px;border:solid var(--xg-muted,#707a83);border-width:0 2px 2px 0;transform:rotate(45deg);transition:transform .15s}.xg-cf[data-open] .xg-cf__chev{transform:rotate(-135deg);margin-bottom:-4px}' +
      '.xg-cf__body{padding:0 16px 12px}.xg-cf:not([data-open]) .xg-cf__body{display:none}' +
      '.xg-cf__row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}' +
      '.xg-cf__f{position:relative;display:flex;flex-direction:column;gap:4px;min-width:0;margin:0}' +
      '.xg-cf__f>label,.xg-cf__f>span{display:block;margin:0;padding:0;color:var(--xg-muted,#707a83);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.2}' +
      '.xg-cf__f--set,.xg-cf__f--q{flex:2 1 190px}.xg-cf__f--sort{flex:1 1 150px}.xg-cf__f--game{flex:1 1 130px}' +
      '.xg-cf .xg-cf__in{box-sizing:border-box;width:100%;height:40px;min-height:0;margin:0;padding:0 12px;border:1px solid var(--xg-border,#e3e6e8);border-radius:8px;background-color:var(--xg-bg,#f5f6f7);color:var(--xg-ink,#171b1d);font:inherit;font-size:14px;line-height:normal;text-transform:none;letter-spacing:normal;box-shadow:none;outline:none}' +
      '.xg-cf select.xg-cf__in{padding-right:26px;cursor:pointer;' + ARR + 'background-position:right 10px center}' +
      '.xg-cf .xg-cf__in:focus{border-color:var(--xg-red,#d62c28);box-shadow:0 0 0 3px rgba(214,44,40,.2)}' +
      '.xg-cf .xg-cf__in::placeholder{color:var(--xg-muted,#707a83);opacity:1}' +
      '.xg-cf label.xg-cf__chk{display:flex;align-items:center;gap:7px;height:40px;margin:0;color:var(--xg-text,#3d454b);font-size:13.5px;font-weight:500;letter-spacing:normal;text-transform:none;white-space:nowrap;cursor:pointer}' +
      '.xg-cf__chk input{width:17px;height:17px;margin:0;accent-color:var(--xg-red,#d62c28)}' +
      '.xg-cf button.xg-cf__go{height:40px;min-height:0;margin:0;padding:0 24px;border:0;border-radius:8px;background:var(--xg-red,#d62c28);color:#fff;font:inherit;font-size:14px;font-weight:800;letter-spacing:normal;text-transform:none;box-shadow:none;cursor:pointer}' +
      '.xg-cf button.xg-cf__go:hover{filter:brightness(1.08)}' +
      '.xg-cf button.xg-cf__fb{display:inline-flex;align-items:center;gap:8px;height:40px;min-height:0;margin:0;padding:0 14px;border:1px solid var(--xg-border,#e3e6e8);border-radius:8px;background:var(--xg-bg,#f5f6f7);color:var(--xg-ink,#171b1d);font:inherit;font-size:13.5px;font-weight:700;letter-spacing:normal;text-transform:none;box-shadow:none;cursor:pointer}' +
      '.xg-cf button.xg-cf__fb[hidden]{display:none}.xg-cf button.xg-cf__fb.is-on,.xg-cf button.xg-cf__fb[aria-expanded="true"]{border-color:var(--xg-red,#d62c28)}' +
      '.xg-cf__fb b{display:inline-grid;place-items:center;min-width:19px;height:19px;padding:0 6px;border-radius:999px;background:var(--xg-red,#d62c28);color:#fff;font-size:11.5px;font-weight:800;line-height:1}' +
      '.xg-cf__fb .xg-cf__chev{margin:0 0 3px 2px}.xg-cf button.xg-cf__fb[aria-expanded="true"] .xg-cf__chev{transform:rotate(-135deg);margin:3px 0 0 2px}' +
      '.xg-cf__more{display:flex;flex-wrap:wrap;gap:12px 24px;margin:12px 0 0;padding:12px 14px 10px;border:1px solid var(--xg-border,#e3e6e8);border-radius:10px;background:rgba(127,127,127,.06)}.xg-cf__more[hidden]{display:none}' +
      '.xg-cf__grp{flex:1 1 230px;min-width:0;margin:0;padding:0;border:0}' +
      '.xg-cf__grp legend{display:block;margin:0 0 6px;padding:0;color:var(--xg-muted,#707a83);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.2}' +
      '.xg-cf__chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.xg-cf__chips-note{color:var(--xg-muted,#707a83);font-size:12.5px}' +
      '.xg-cf button.xg-cf__chip{display:inline-flex;align-items:center;gap:7px;min-height:0;margin:0;padding:6px 11px;border:1px solid var(--xg-border,#e3e6e8);border-radius:999px;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);font:inherit;font-size:13px;font-weight:600;line-height:1.2;letter-spacing:normal;text-transform:none;box-shadow:none;cursor:pointer}' +
      '.xg-cf button.xg-cf__chip:hover{border-color:var(--xg-red,#d62c28)}.xg-cf button.xg-cf__chip[aria-pressed="true"]{border-color:var(--xg-red,#d62c28);background:var(--xg-red,#d62c28);color:#fff}' +
      '.xg-cf__chip i{flex:none;width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}' +
      '.xg-cf select.xg-cf__add{width:auto;max-width:100%;height:34px;padding-right:26px;font-size:13px}' +
      '.xg-cf__grp--price{flex:0 1 230px}.xg-cf__price{display:flex;align-items:center;gap:8px}.xg-cf .xg-cf__in.xg-cf__pin{width:96px;height:34px;padding:0 10px;font-size:13.5px}.xg-cf__pto{color:var(--xg-muted,#707a83);font-size:13px}' +
      '.xg-cf__morefoot{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:2px}' +
      '.xg-cf button.xg-cf__clear{min-height:0;margin:0;padding:6px 14px;border:1px solid var(--xg-border,#e3e6e8);border-radius:999px;background:none;color:var(--xg-ink,#171b1d);font:inherit;font-size:13px;font-weight:700;text-transform:none;letter-spacing:normal;cursor:pointer}.xg-cf button.xg-cf__clear[hidden]{display:none}.xg-cf button.xg-cf__clear:hover{border-color:var(--xg-red,#d62c28);color:var(--xg-red,#d62c28)}' +
      '.xg-cf__morehint{color:var(--xg-muted,#707a83);font-size:12.5px}' +
      '.xg-cf__list{position:absolute;z-index:40;top:100%;left:0;right:0;max-height:300px;margin:4px 0 0;padding:4px 0;overflow:auto;list-style:none;border:1px solid var(--xg-border,#e3e6e8);border-radius:10px;background:var(--xg-surface,#fff);box-shadow:0 14px 34px rgba(0,0,0,.28)}' +
      '.xg-cf__list[hidden]{display:none}' +
      '.xg-cf__li{margin:0;padding:8px 12px;color:var(--xg-ink,#171b1d);font-size:14px;cursor:pointer}.xg-cf__li:hover,.xg-cf__li[aria-selected="true"]{background:rgba(214,44,40,.14)}' +
      '.xg-cf__li--note{color:var(--xg-muted,#707a83);font-size:13px;cursor:default}.xg-cf__li--note:hover{background:none}' +
      '.xg-cf__msg{margin:8px 0 0;font-size:13px;font-weight:600;color:var(--xg-text,#3d454b)}.xg-cf__msg:empty{display:none}.xg-cf__msg.is-bad{color:var(--xg-red,#d62c28)}' +
      '.xg-cf__tip{margin:8px 0 0;color:var(--xg-muted,#707a83);font-size:12.5px}.xg-cf__tip a{color:var(--xg-red,#d62c28)!important;font-weight:700;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}' +
      '.xg-cf__quick{padding:0 16px 12px}.xg-cf__quick[hidden]{display:none}' +
      '.xg-cf button.xg-cf__qb{display:inline-flex;align-items:center;gap:8px;min-height:0;margin:0;padding:9px 16px;border:0;border-radius:999px;background:var(--xg-red,#d62c28);color:#fff;font:inherit;font-size:14px;font-weight:600;text-align:left;text-transform:none;letter-spacing:normal;cursor:pointer}' +
      '.xg-cf-on>:not(.xg-cf):not(.xg-cf-res){display:none!important}' +
      '.xg-cf-res{margin:0 0 28px}.xg-cf-res[hidden]{display:none}' +
      '.xg-cf-res__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;margin:0 0 14px;padding:10px 14px;border:1px solid var(--xg-border,#e3e6e8);border-radius:10px;background:var(--xg-surface,#fff)}' +
      '.xg-cf-res__sum{margin:0;color:var(--xg-text,#3d454b);font-size:14px}.xg-cf-res__sum strong{color:var(--xg-ink,#171b1d)}.xg-cf-res__by{color:var(--xg-muted,#707a83)}' +
      '.xg-cf-res__extra{flex-basis:100%;margin:0;color:var(--xg-muted,#707a83);font-size:12.5px}' +
      '.xg-cf-res button.xg-cf-res__x,.xg-cf-res button.xg-cf-btn{min-height:0;margin:0;padding:6px 14px;border:1px solid var(--xg-border,#e3e6e8);border-radius:999px;background:none;color:var(--xg-ink,#171b1d);font:inherit;font-size:13px;font-weight:700;text-transform:none;letter-spacing:normal;cursor:pointer;white-space:nowrap}' +
      '.xg-cf-res button.xg-cf-res__x:hover,.xg-cf-res button.xg-cf-btn:hover{border-color:var(--xg-red,#d62c28);color:var(--xg-red,#d62c28)}' +
      '.xg-cf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(186px,1fr));gap:14px;margin:0;padding:0;list-style:none}' +
      '.xg-cf-card{display:flex;flex-direction:column;min-width:0;margin:0;padding:10px;border:1px solid var(--xg-border,#e3e6e8);border-radius:12px;background:var(--xg-surface,#fff)}' +
      '.xg-cf-card__img{position:relative;display:block;aspect-ratio:63/88;border-radius:8px;overflow:hidden;background:rgba(127,127,127,.1)}' +
      '.xg-cf-card__img img{display:block;width:100%;height:100%;object-fit:contain}.xg-cf-card--out .xg-cf-card__img img{opacity:.5;filter:grayscale(.7)}' +
      '.xg-cf-card__no{position:absolute;top:6px;left:6px;padding:2px 8px;border-radius:999px;background:rgba(10,13,15,.8);color:#fff;font-size:12px;font-weight:800;line-height:1.5}' +
      '.xg-cf a.xg-cf-card__nm,.xg-cf-res a.xg-cf-card__nm{display:-webkit-box;margin:9px 0 2px;overflow:hidden;color:var(--xg-ink,#171b1d)!important;font-size:14px;font-weight:700;line-height:1.3;text-decoration:none;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '.xg-cf-res a.xg-cf-card__nm:hover{text-decoration:underline}' +
      '.xg-cf-card__meta{display:block;margin:0 0 8px;overflow:hidden;color:var(--xg-muted,#707a83);font-size:12px;white-space:nowrap;text-overflow:ellipsis}' +
      '.xg-cf-card__buy{display:flex;flex-direction:column;gap:7px;margin-top:auto}' +
      '.xg-cf-res select.xg-cf-card__cond{box-sizing:border-box;width:100%;height:32px;min-height:0;margin:0;padding:0 24px 0 8px;border:1px solid var(--xg-border,#e3e6e8);border-radius:7px;background-color:var(--xg-bg,#f5f6f7);color:var(--xg-ink,#171b1d);font:inherit;font-size:12.5px;text-transform:none;' + ARR + 'background-position:right 8px center}' +
      '.xg-cf-card__one{color:var(--xg-muted,#707a83);font-size:12.5px}' +
      '.xg-cf-card__row{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.xg-cf-card__price{color:var(--xg-ink,#171b1d);font-size:15px;font-weight:800}' +
      '.xg-cf-res button.xg-cf-card__add{height:34px;min-height:0;margin:0;padding:0 12px;border:0;border-radius:8px;background:var(--xg-red,#d62c28);color:#fff;font:inherit;font-size:13px;font-weight:800;text-transform:none;letter-spacing:normal;white-space:nowrap;cursor:pointer}' +
      '.xg-cf-res button.xg-cf-card__add.is-ok{background:var(--xg-success,#17784a)}.xg-cf-res button.xg-cf-card__add.is-bad{background:#6b7378}' +
      '.xg-cf-card__out{color:var(--xg-muted,#707a83);font-size:13px;font-weight:700}.xg-cf-res a.xg-cf-card__see{color:var(--xg-red,#d62c28)!important;font-size:13px;font-weight:700}' +
      '.xg-cf-res span.xg-cf-card__see{color:var(--xg-muted,#707a83);font-size:13px;font-weight:700}.xg-cf-card[data-unlisted] span.xg-cf-card__nm{display:-webkit-box;margin:9px 0 2px;overflow:hidden;color:var(--xg-muted,#707a83);font-size:14px;font-weight:700;line-height:1.3;-webkit-line-clamp:2;-webkit-box-orient:vertical}.xg-cf-card[data-unlisted] span.xg-cf-card__img{position:relative;display:block;aspect-ratio:63/88;border-radius:8px;overflow:hidden;background:rgba(127,127,127,.1)}' +
      '.xg-cf-pg{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:20px 0 0}' +
      '.xg-cf-res button.xg-cf-pg__b{min-width:38px;height:38px;min-height:0;margin:0;padding:0 10px;border:1px solid var(--xg-border,#e3e6e8);border-radius:8px;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);font:inherit;font-size:14px;font-weight:700;cursor:pointer}' +
      '.xg-cf-res button.xg-cf-pg__b[aria-current]{border-color:var(--xg-red,#d62c28);background:var(--xg-red,#d62c28);color:#fff}.xg-cf-res button.xg-cf-pg__b[disabled]{opacity:.4;cursor:default}' +
      '.xg-cf-pg__gap{align-self:center;color:var(--xg-muted,#707a83)}' +
      '.xg-cf-res[aria-busy="true"] .xg-cf-grid,.xg-cf-res[aria-busy="true"] .xg-cf-pg{opacity:.45;pointer-events:none}' +
      '.xg-cf-wait{display:grid;place-items:center;min-height:180px}' +
      '.xg-cf-spin{width:34px;height:34px;border:3px solid var(--xg-border,#e3e6e8);border-top-color:var(--xg-red,#d62c28);border-radius:50%;animation:xg-cf-spin .8s linear infinite}' +
      '@keyframes xg-cf-spin{to{transform:rotate(360deg)}}' +
      '.xg-cf-empty{padding:26px 16px;border:1px dashed var(--xg-border,#e3e6e8);border-radius:12px;color:var(--xg-text,#3d454b);text-align:center}.xg-cf-empty p{margin:0 0 10px}.xg-cf-empty p:last-child{margin:0}' +
      '.xg-cf-res a.xg-cf-link{color:var(--xg-red,#d62c28)!important;font-weight:700}' +
      // red text on the dark surfaces needs the site's lighter red to reach AA
      'html[data-xg-theme="dark"] .xg-cf__msg.is-bad,html[data-xg-theme="dark"] .xg-cf__tip a,html[data-xg-theme="dark"] .xg-cf-res a.xg-cf-card__see,html[data-xg-theme="dark"] .xg-cf-res a.xg-cf-link{color:#ff6a5e!important}' +
      '@media (max-width:767px){' +
        '.xg-cf{margin:0 0 12px}.xg-cf button.xg-cf__top{padding:11px 12px;gap:10px}.xg-cf__tt{font-size:12.5px}.xg-cf__tt strong{display:block;font-size:15px}' +
        '.xg-cf__body{padding:0 12px 12px}.xg-cf__quick{padding:0 12px 12px}' +
        '.xg-cf__f--set,.xg-cf__f--q,.xg-cf__f--game{flex-basis:100%}.xg-cf__f--sort{flex:1 1 140px}' +
        '.xg-cf .xg-cf__in{font-size:16px}.xg-cf button.xg-cf__go{flex:1 1 100%}.xg-cf-res select.xg-cf-card__cond{font-size:16px}' +   // 16px keeps iOS from zooming on focus
        '.xg-cf button.xg-cf__fb{flex:1 1 auto;justify-content:center}.xg-cf__more{gap:10px 16px;padding:10px 12px 8px}.xg-cf__grp{flex-basis:100%}.xg-cf .xg-cf__in.xg-cf__pin{width:110px;font-size:16px}' +
        '.xg-cf-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.xg-cf-card{padding:8px}' +
        '.xg-cf-card__row{flex-wrap:wrap}.xg-cf-res button.xg-cf-card__add{flex:1 1 100%}' +
      '}';
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
