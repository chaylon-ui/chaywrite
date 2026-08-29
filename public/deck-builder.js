/* Deck Builder — storefront behaviour, served by the worker and loaded onto
   the Exor product/page from a tiny theme shell (<div id="xg-deck">). Runs in
   the exorgames.com page context, so /cart/add.js is same-origin.

   Flow:
     1. Parse the pasted list into {qty, name}. Handles "4 Bolt", "4x Bolt",
        "Bolt x4", Arena/MTGO export tails "(2X2) 117 *F*", "SB:" markers,
        "//" double-faced names, comments and section headers.
     2. POST the de-duplicated names to the worker /deck.json (batched 30 at a
        time). The worker resolves each to an in-stock Exor MTG single (cheapest
        available printing) and returns its variantId. Running the lookup in the
        Worker keeps it off the shopper's IP, so a big list never trips the
        exorgames.com /search rate-limit rule.
     3. Render per-line stock + price, a running total and the missing cards.
        "Add in-stock to cart" fires one /cart/add.js (falling back to per-item
        adds if a card sold out between lookup and click), then goes to /cart. */
(function () {
  var W = 'https://exor-binder.nevski.workers.dev';
  var root = document.getElementById('xg-deck');
  if (!root || root.getAttribute('data-xg-ready')) return;
  root.setAttribute('data-xg-ready', '1');
  if (root.className.indexOf('xg-deck') === -1) root.className = ('xg-deck ' + root.className).trim();

  function attr(name, dflt) { var v = root.getAttribute(name); return (v == null || v === '') ? dflt : v; }
  var HEADING = attr('data-heading', 'Deck Builder');
  // The store's own header logo (the live theme's header-top logo file) —
  // rendered letter-height beside the title. data-logo="none" on the shell
  // hides it; any other value swaps the image.
  var LOGO = attr('data-logo', 'https://cdn.shopify.com/s/files/1/0467/3083/8169/files/WE_BUY_CARDS_951e0f40-efac-4b8a-97b3-8ee6330881bd.png?v=1706987808');
  if (LOGO === 'none') LOGO = '';
  var INTRO = attr('data-intro', 'Pick your game, paste your decklist, and we’ll check it against everything in stock at Exor. Deck Builder will attempt to find the cheapest available printing, condition and price for each card. If we can’t find it at our Charlottetown location, we will look at inventory in other Exor Games locations.');
  var GOLABEL = attr('data-golabel', 'Find my deck');
  var ADDALL = attr('data-addall', 'Add selected to cart');
  var FOOTNOTE = attr('data-footnote', 'We match the cheapest in-stock printing.');
  var PLACEHOLDER = attr('data-placeholder', '4 Lightning Bolt\n4 Counterspell\n2 Wrath of God\n1 Sol Ring\n9 Island\n...paste your whole list — quantities and set tags are fine');
  var GAMES = [
    { key: 'mtg', label: 'Magic: The Gathering' },
    { key: 'pokemon', label: 'Pokémon' },
    { key: 'yugioh', label: 'Yu-Gi-Oh!' },
    { key: 'starwars', label: 'Star Wars: Unlimited' },
    { key: 'onepiece', label: 'One Piece' },
    { key: 'riftbound', label: 'Riftbound' }
  ];
  var DEFAULT_GAME = attr('data-game', 'mtg');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  // "Same card?" comparison: crossover printings carry flavor titles
  // (FINAL FANTASY sells Lightning Bolt as "Thrum of the Vestige -
  // Lightning Bolt"), which shoppers don't recognize as their card.
  function normName(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function imgSrc(u) { return u ? (u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=96') : ''; }
  function zoomSrc(u) { return u ? (u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=640') : ''; }
  // overlay cards render ~200px wide on retina; 96px thumbs look mushy there
  function midSrc(u) { return u ? (u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=480') : ''; }

  root.innerHTML =
    '<div class="xg-deck__head">' +
      '<h1 class="xg-deck__title">' +
        (LOGO ? '<img class="xg-deck__logo" src="' + esc(LOGO) + '" alt="Exor Games">' : '') +
        '<span>' + esc(HEADING) + '</span>' +
      '</h1>' +
      '<p class="xg-deck__intro">' + esc(INTRO) + '</p>' +
    '</div>' +
    '<form class="xg-deck__form" id="xg-deck-form">' +
      '<div class="xg-deck__gamerow">' +
        '<label class="xg-deck__label" for="xg-deck-game">Game</label>' +
        '<select id="xg-deck-game" class="xg-deck__select">' +
          GAMES.map(function (g) { return '<option value="' + esc(g.key) + '"' + (g.key === DEFAULT_GAME ? ' selected' : '') + '>' + esc(g.label) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<label class="xg-deck__label" for="xg-deck-input">Your decklist</label>' +
      '<textarea id="xg-deck-input" class="xg-deck__input" rows="10" maxlength="12000" spellcheck="false"></textarea>' +
      '<div class="xg-deck__actions">' +
        '<button type="submit" class="xg-deck__btn xg-deck__btn--go" id="xg-deck-go">' + esc(GOLABEL) + '</button>' +
        '<button type="button" class="xg-deck__btn xg-deck__btn--ghost" id="xg-deck-clear" hidden>Clear</button>' +
        '<label class="xg-deck__toggle" for="xg-deck-nextcheap"><input type="checkbox" id="xg-deck-nextcheap" checked> Find next-cheapest versions to fill quantities</label>' +
        '<span class="xg-deck__hint">Card singles. ' + esc(FOOTNOTE) + '</span>' +
      '</div>' +
    '</form>' +
    '<div class="xg-deck__results" id="xg-deck-results" aria-live="polite"></div>';

  var form = document.getElementById('xg-deck-form');
  var input = document.getElementById('xg-deck-input');
  var go = document.getElementById('xg-deck-go');
  var clearBtn = document.getElementById('xg-deck-clear');
  var out = document.getElementById('xg-deck-results');
  var gameSel = document.getElementById('xg-deck-game');
  input.setAttribute('placeholder', PLACEHOLDER);

  var SKIP = /^(deck|sideboard|side board|commander|companion|maybeboard|maybe board|tokens?|lands?|creatures?|spells?|artifacts?|enchantments?|planeswalkers?|instants?|sorceries)\s*:?\s*(\(\d+\))?\s*$/i;

  function parseDeck(text) {
    // Pasted text is treated as card NAMES only: control characters are
    // dropped, lists cap at 200 lines, and every string that reaches the
    // page again goes through esc() — nothing pasted is ever executed or
    // rendered raw.
    var lines = String(text || '')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
      .split(/\r?\n/)
      .slice(0, 200);
    var order = [], index = Object.create(null);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#' || line.slice(0, 2) === '//') continue;
      if (SKIP.test(line)) continue;
      line = line.replace(/^sb:\s*/i, '');
      var qty = 1, name = line, m;
      // "3xOP16-003" — One Piece sim exports glue the qty straight onto the
      // collector code with no space; the code then matches by SKU prefix.
      if ((m = /^(\d{1,3})[xX](\S.*)$/.exec(line))) { qty = parseInt(m[1], 10) || 1; name = m[2]; }
      else if ((m = /^(\d{1,3})\s*[xX]?\s+(.+)$/.exec(line))) { qty = parseInt(m[1], 10) || 1; name = m[2]; }
      else if ((m = /^(.+?)\s+[xX](\d{1,3})$/.exec(line))) { name = m[1]; qty = parseInt(m[2], 10) || 1; }
      name = name
        .replace(/\s*\([^)]*\)\s*[0-9A-Za-z\-]*\s*$/, '')
        .replace(/\s*\*[^*]*\*\s*$/, '')
        .replace(/\s*\[[^\]]*\]\s*$/, '')
        .replace(/\s*<[^>]*>\s*$/, '')
        .replace(/\s+#.*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (name.indexOf('//') > -1) name = name.split('//')[0].trim();
      if (name.length < 2) continue;
      if (qty < 1) qty = 1; if (qty > 99) qty = 99;
      var key = name.toLowerCase();
      if (index[key]) { index[key].qty += qty; }
      else { var e = { qty: qty, name: name }; index[key] = e; order.push(e); }
    }
    return order.slice(0, 200);
  }

  /* Anti-scrape gate: /deck.json only answers when the request carries a
     small proof-of-work — a nonce whose SHA-256 over (per-IP seed : exact
     names string : nonce) starts with `bits` zero bits. A shopper's browser
     solves it in a fraction of a second per batch; a bot mapping the
     catalogue pays that CPU for every distinct probe, and seeds expire
     every 10 minutes. */
  function gateHash(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  }
  function gateLeadZeros(bytes, bits) {
    var full = bits >> 3, rem = bits & 7;
    for (var i = 0; i < full; i++) if (bytes[i] !== 0) return false;
    return rem === 0 || (bytes[full] >> (8 - rem)) === 0;
  }
  function fetchGate() {
    return fetch(W + '/deck-gate').then(function (r) { return r.ok ? r.json() : null; });
  }
  function solveGate(gate, namesStr) {
    var prefix = gate.seed + ':' + namesStr.toLowerCase() + ':';
    var n = 0;
    function round() {
      var xs = [];
      for (var i = 0; i < 64; i++) xs.push(n + i);
      n += 64;
      return Promise.all(xs.map(function (x) {
        return gateHash(prefix + x).then(function (buf) {
          return gateLeadZeros(new Uint8Array(buf), gate.bits) ? x : null;
        });
      })).then(function (rs) {
        for (var i = 0; i < rs.length; i++) if (rs[i] !== null) return rs[i];
        if (n > 4000000) throw new Error('gate exhausted');
        return round();
      });
    }
    return round();
  }

  function runLimited(items, limit, fn) {
    return new Promise(function (resolve) {
      var i = 0, active = 0, done = 0, n = items.length;
      if (!n) return resolve();
      function next() {
        while (active < limit && i < n) {
          var idx = i++; active++;
          Promise.resolve(fn(items[idx], idx)).catch(function () {}).then(function () {
            active--; done++;
            if (done === n) resolve(); else next();
          });
        }
      }
      next();
    });
  }

  function chunk(arr, n) { var o = []; for (var i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }

  function resolveNames(names, game) {
    var map = Object.create(null);
    var batches = chunk(names, 30);
    // One gate seed per submit (it's bound to IP + 10-min window), one
    // solved nonce per batch (each is bound to that batch's exact names).
    return fetchGate().then(function (gate) {
      if (!gate || !gate.seed) throw new Error('gate unavailable');
      return runLimited(batches, 2, function (b) {
        var namesStr = b.join('|');
        return solveGate(gate, namesStr).then(function (nonce) {
          return fetch(W + '/deck.json?game=' + encodeURIComponent(game || 'mtg') +
            '&names=' + encodeURIComponent(namesStr) + '&sid=' + SID +
            '&pb=' + encodeURIComponent(gate.bucket) + '&pn=' + encodeURIComponent(nonce));
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && d.results) d.results.forEach(function (x) { if (x && x.q) map[String(x.q).toLowerCase()] = x; });
          });
      });
    }).then(function () { return map; });
  }

  // Results state: which lines are ticked for the cart and which version
  // leads each line's fill. Fresh per search; every control repaints from it.
  var state = null;
  var lastPick = null;   // game + ticked copies/dollars at last paint, for cart tracking
  var SID = Math.random().toString(16).slice(2, 8);   // anonymous per-load session id for the owner's live view

  /* Write-only activity beacon to the worker (rate-limited server-side).
     Carries control interactions and cart adds so the owner's PIN-gated
     stats page can show live usage; no shopper identity is sent, and the
     server attaches the IP itself. */
  function beacon(a, d, extraParams, bodyObj) {
    try {
      var q = W + '/deck-track?ev=' + (a === 'cart' ? 'cart' : 'act') + '&sid=' + SID +
        '&game=' + encodeURIComponent((state && state.game) || (gameSel ? gameSel.value : 'mtg')) +
        (a === 'cart' ? '' : '&a=' + encodeURIComponent(a) + '&d=' + encodeURIComponent(String(d || '').slice(0, 90))) +
        (extraParams || '');
      if (navigator.sendBeacon && bodyObj) navigator.sendBeacon(q, new Blob([JSON.stringify(bodyObj)], { type: 'text/plain' }));
      else if (navigator.sendBeacon) navigator.sendBeacon(q);
      else fetch(q, { method: 'POST', keepalive: true, body: bodyObj ? JSON.stringify(bodyObj) : undefined }).catch(function () {});
    } catch (e) {}
  }

  function nextCheapOn() {
    var ncEl = document.getElementById('xg-deck-nextcheap');
    return !ncEl || ncEl.checked;
  }

  // Fill one decklist line from the card's in-stock versions. The chosen
  // version (cheapest by default; the row's picker can promote a pricier
  // printing) leads; with the next-cheapest toggle on, the rest stay in the
  // running, cheapest first, to cover whatever it can't.
  function allocate(ln, r, selIdx, nextCheap) {
    var offers = (r.offers && r.offers.length) ? r.offers : [{ variantId: r.variantId, qty: 99, price: r.price, condition: r.condition, foil: r.foil, set: r.set, name: r.name, image: r.image, url: r.url }];
    var sel = Math.min(Math.max(selIdx || 0, 0), offers.length - 1);
    var order = nextCheap ? [offers[sel]].concat(offers.filter(function (_, i) { return i !== sel; })) : [offers[sel]];
    var remaining = ln.qty, chunks = [];
    for (var oi = 0; oi < order.length && remaining > 0; oi++) {
      var o = order[oi];
      var avail = (typeof o.qty === 'number') ? o.qty : 99;
      var take = Math.min(remaining, avail);
      if (take > 0) { chunks.push({ o: o, take: take, stock: avail }); remaining -= take; }
    }
    return { offers: offers, sel: sel, chunks: chunks, filledQ: ln.qty - remaining, remaining: remaining };
  }

  // Cart payload from the CURRENT ticks and version picks. Ticks are per
  // ROW (line + variant), so the NM and LP copies of one card can be taken
  // or left independently.
  function chunkKey(li, c) { return li + ':' + c.o.variantId; }
  function collectItems() {
    var items = [];
    if (!state) return items;
    state.lines.forEach(function (ln, li) {
      var r = effR(ln, li);
      if (!(r && r.found)) return;
      var a = allocate(ln, r, state.sel[li], nextCheapOn());
      a.chunks.forEach(function (c) {
        if (state.checked[chunkKey(li, c)] === false) return;
        items.push({ id: c.o.variantId, quantity: c.take, stock: c.stock });
      });
      var ps = state.subs[li];
      if (ps && ps.partial && a.remaining > 0 && state.checked['sub:' + li] !== false) {
        var sq = (ps.r.offers && ps.r.offers[0] && typeof ps.r.offers[0].qty === 'number') ? ps.r.offers[0].qty : 99;
        var vid = (ps.r.offers && ps.r.offers[0] && ps.r.offers[0].variantId) || ps.r.variantId;
        if (vid) items.push({ id: vid, quantity: Math.min(a.remaining, Math.max(1, sq)), stock: sq });
      }
    });
    return items;
  }

  function render(lines, map) {
    state = { lines: lines, map: map, sel: {}, checked: {}, sisterExtra: {}, sisterPending: {}, subs: {}, sims: {}, game: (gameSel && gameSel.value) || 'mtg' };
    paint();
    maybeFetchSims();
    reportMisses();
  }

  /* A line whose card we don't stock can be filled by a SUBSTITUTE the
     shopper picks from in-stock cards with similar effects (EDHREC's
     similar list mapped onto live stock — Magic only). The pick becomes a
     synthetic found-result so ticks, version pickers, totals and the cart
     all treat it like any stocked card, with green Substituted markings. */
  function effR(ln, li) {
    var sub = state.subs[li];
    if (sub && !sub.partial) return sub.r;
    return state.map[ln.name.toLowerCase()];
  }

  function maybeFetchSims() {
    if (!state || state.game !== 'mtg') return;
    var mine = state;
    var missing = [];
    state.lines.forEach(function (ln, li) {
      var r = mine.map[ln.name.toLowerCase()];
      if (r && r.found) {
        // found-but-short lines also earn similar-effect options: the
        // shopper fills just the copies the shelf is missing.
        if (allocate(ln, r, mine.sel[li], nextCheapOn()).remaining <= 0) return;
      }
      var k = ln.name.toLowerCase();
      if (!(k in mine.sims) && missing.length < 6) { mine.sims[k] = null; missing.push(ln.name); }
    });
    missing.forEach(function (name) {
      var k = name.toLowerCase();
      fetch(W + '/similar.json?name=' + encodeURIComponent(name))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var names = ((j && j.names) || []).filter(function (n) { return n.toLowerCase() !== k; }).slice(0, 12);
          if (!names.length) return null;
          return fetch(W + '/instock.json?names=' + encodeURIComponent(names.join('|')) + '&max=6')
            .then(function (r) { return r.ok ? r.json() : null; });
        })
        .then(function (j) {
          mine.sims[k] = ((j && j.cards) || []).filter(function (c) { return c && c.variantId && c.name.toLowerCase() !== k; });
          if (state === mine && mine.sims[k].length) paint();
        })
        .catch(function () { mine.sims[k] = []; });
    });
  }

  /* One beacon per search listing the cards we could not fill, with the
     quantities asked for and any sister-store price — feeds the owner's
     missed-cards export. */
  function reportMisses() {
    if (!state || state.missSent) return;
    state.missSent = true;
    var missing = [];
    state.lines.forEach(function (ln, li) {
      var r = state.map[ln.name.toLowerCase()];
      if (missing.length >= 25) return;
      if (r && r.found) {
        var srem = allocate(ln, r, state.sel[li], nextCheapOn()).remaining;
        if (srem > 0) missing.push(srem + 'x ' + ln.name);
        return;
      }
      var tail = '';
      if (r && r.sister) tail = ' @ ' + (r.sister.store || 'sister store') + ' $' + (parseFloat(r.sister.price) || 0).toFixed(2);
      missing.push(ln.qty + 'x ' + ln.name + tail);
    });
    if (missing.length) beacon('miss', '', '&n=' + missing.length, { names: missing });
  }

  var subsEl = null;
  function simBtnHtml(li, key) {
    if (state.game !== 'mtg') return '';
    var sims = state.sims[key];
    if (!sims || !sims.length) return '';
    var n = sims.length;
    return ' <button type="button" class="xg-deck__simbtn" data-li="' + li + '" title="Cards with a similar effect, in stock now &mdash; pick one to fill this spot">' +
      'See ' + n + ' similar card' + (n === 1 ? '' : 's') + ' we have in stock &rsaquo;</button>';
  }

  function subsKey(e) { if (e.key === 'Escape' && !zoomEl) closeSubs(); }
  function closeSubs() {
    if (!subsEl) return;
    subsEl.parentNode && subsEl.parentNode.removeChild(subsEl);
    subsEl = null;
    document.removeEventListener('keydown', subsKey);
  }
  function openSubs(li) {
    var ln = state.lines[li];
    var cards = state.sims[ln.name.toLowerCase()] || [];
    if (!cards.length) return;
    var base = state.map[ln.name.toLowerCase()];
    var srem = (base && base.found) ? allocate(ln, base, state.sel[li], nextCheapOn()).remaining : 0;
    closeSubs();
    var d = document.createElement('div');
    d.className = 'xg-deck-subs';
    d.innerHTML =
      '<div class="xg-deck-subs__panel" role="dialog" aria-label="In-stock cards with similar effects">' +
        '<button type="button" class="xg-deck-subs__close" aria-label="Close">&times;</button>' +
        '<div class="xg-deck-subs__orig">' +
          '<span class="xg-deck-subs__missp">' + (srem > 0 ? 'Short ' + srem + ' of ' + ln.qty : 'Not in stock') + '</span>' +
          '<img src="https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(ln.name) + '&format=image&version=normal" data-zoom="https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(ln.name) + '&format=image&version=large" alt="' + esc(ln.name) + '" onerror="this.style.display=\'none\'">' +
          '<strong>' + esc(ln.name) + '</strong>' +
          '<span class="xg-deck-subs__dim">' + (srem > 0 ? 'You have ' + (ln.qty - srem) + ' in the list above. Pick a stand-in for the missing ' + srem + '.' : 'The card your list asked for. Pick a stand-in from the right.') + '</span>' +
        '</div>' +
        '<div class="xg-deck-subs__side">' +
          '<h4>In-stock cards with similar effects</h4>' +
          '<div class="xg-deck-subs__cards">' +
            cards.map(function (c, i) {
              var meta = [c.set, c.foil ? 'Foil' : '', c.condition].filter(Boolean).join(' · ');
              var q = (c.offers && c.offers[0] && typeof c.offers[0].qty === 'number' && c.offers[0].qty < 99) ? c.offers[0].qty : null;
              return '<div class="xg-deck-subs__card">' +
                (c.image ? '<img src="' + esc(midSrc(c.image)) + '" data-zoom="' + esc(zoomSrc(c.image)) + '" alt="' + esc(c.name) + '" loading="lazy">' : '<span class="xg-deck-subs__noimg"></span>') +
                '<strong>' + esc(c.name) + '</strong>' +
                (meta ? '<span class="xg-deck-subs__dim">' + esc(meta) + '</span>' : '') +
                '<span class="xg-deck-subs__price">' + money(parseFloat(c.price) || 0) + (q ? ' · ' + q + ' in stock' : '') + '</span>' +
                '<button type="button" class="xg-deck-subs__add" data-i="' + i + '">Add Substitute</button>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    subsEl = d;
    document.addEventListener('keydown', subsKey);
    d.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG' && e.target.getAttribute('data-zoom')) {
        openZoom(e.target.getAttribute('data-zoom'));
        return;
      }
      if (e.target === d || (e.target.classList && e.target.classList.contains('xg-deck-subs__close'))) { closeSubs(); return; }
      var b = e.target.closest ? e.target.closest('.xg-deck-subs__add') : null;
      if (b) {
        var c = cards[+b.getAttribute('data-i')];
        if (c) pickSub(li, c);
      }
    });
  }
  function pickSub(li, card) {
    var ln = state.lines[li];
    var base = state.map[ln.name.toLowerCase()];
    var r = {};
    for (var k in card) r[k] = card[k];
    r.__sub = true; r.__for = ln.name;
    if (base && base.found && allocate(ln, base, state.sel[li], nextCheapOn()).filledQ > 0) {
      // partial: the real rows above stay; this card fills the shortfall
      state.subs[li] = { r: r, partial: true };
      beacon('sub', ln.name + ' > ' + card.name + ' (fills shortfall)');
    } else {
      r.found = true;
      state.subs[li] = { r: r };
      beacon('sub', ln.name + ' > ' + card.name);
    }
    closeSubs();
    paint();
  }

  // A short line quietly asks the sister stores whether they hold the rest
  // of its quantity; answers upgrade the info strip in place ("2 more at
  // Exor Summerside ›"). One batched request, cached at the edge.
  function maybeFetchSisterExtra(shorts) {
    if (!state) return;
    var mine = state;
    var need = shorts.filter(function (s) { return !(s.key in mine.sisterExtra) && !mine.sisterPending[s.key]; }).slice(0, 6);
    if (!need.length) return;
    need.forEach(function (s) { mine.sisterPending[s.key] = 1; });
    fetch(W + '/sisterstock.json?game=' + encodeURIComponent(mine.game || 'mtg') + '&names=' + encodeURIComponent(need.map(function (s) { return s.name; }).join('|')))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        ((j && j.results) || []).forEach(function (row) { mine.sisterExtra[String(row.q || '').toLowerCase()] = row.sister || null; });
        need.forEach(function (s) { if (!(s.key in mine.sisterExtra)) mine.sisterExtra[s.key] = null; });
        if (state === mine) paint();
      })
      .catch(function () { need.forEach(function (s) { mine.sisterExtra[s.key] = null; }); });
  }

  function paint() {
    var lines = state.lines, map = state.map;
    var nextCheap = nextCheapOn();
    var inStock = 0, partialLines = 0, atSisters = 0, totalCards = 0, filledCards = 0, shortQ = 0, subtotal = 0, addQty = 0, fillable = 0, ticked = 0, missNames = [], shorts = [];
    var rows = lines.map(function (ln, li) {
      totalCards += ln.qty;
      var r = effR(ln, li);
      var subFor = (r && r.__sub) ? r.__for : null;
      if (r && r.found) {
        // Fill the requested quantity across the card's in-stock variants
        // (worker sends per-condition/printing stock counts). 3 NM + 1 LP
        // fills a 4; owning 2 of a wanted 4 adds the 2 and says 2 of 4 —
        // the cart never gets more copies than the shelf has.
        var a = allocate(ln, r, state.sel[li], nextCheap);
        var chunks = a.chunks, remaining = a.remaining, filledQ = a.filledQ;
        if (filledQ > 0) {
          filledCards += filledQ;
          if (remaining === 0) { inStock++; } else { partialLines++; shortQ += remaining; }
          // The version picker only earns its place when some version is
          // left OUT of the fill (a real alternative to swap to). When the
          // fill already uses every copy of every version — 4 wanted, 3 in
          // stock total — each option is already a row below, so a dropdown
          // would offer nothing (owner feedback on a 4x Polluted Delta).
          var lastC = chunks[chunks.length - 1];
          var pickerUseful = a.offers.length > 1 &&
            !(remaining > 0 || (chunks.length === a.offers.length && lastC.take === lastC.stock));
          // One card split across several rows (versions + its info strip)
          // reads as a single block: an inset bar spans the group and the
          // separators inside it soften (owner: show they're the same card).
          var grouped = (chunks.length + (remaining > 0 ? 1 : 0)) > 1;
          var html = chunks.map(function (c, ci) {
            var o = c.o;
            var unit = parseFloat(o.price) || 0;
            var lineTotal = unit * c.take;
            // Every stock row has its own tick (keyed line+variant), so the
            // NM and LP copies of one card can be taken or left separately.
            var key = chunkKey(li, c);
            var chOn = state.checked[key] !== false;
            fillable++; if (chOn) ticked++;
            if (chOn) { subtotal += lineTotal; addQty += c.take; }
            var offClass = chOn ? '' : ' xg-deck__row--off';
            var meta = [o.set, o.foil ? 'Foil' : '', o.condition].filter(Boolean).join(' · ');
            var lead = '<span class="xg-deck__pick" role="cell"><input type="checkbox" class="xg-deck__pickbox" data-k="' + key + '"' + (chOn ? ' checked' : '') + ' aria-label="Include ' + c.take + ' ' + esc(o.name || r.name) + '"></span>';
            // The line's first row also carries the version picker when the
            // card comes in several versions — cheapest pre-selected,
            // pricier printings selectable; picking one re-fills led by it.
            var picker = '';
            if (ci === 0 && pickerUseful) {
              picker = '<select class="xg-deck__ver" data-i="' + li + '" aria-label="Version of ' + esc(o.name || r.name) + '">' +
                a.offers.map(function (v, vi) {
                  var vlabel = [v.set, v.foil ? 'Foil' : '', v.condition].filter(Boolean).join(' · ') || 'Standard';
                  var vqty = (typeof v.qty === 'number' && v.qty < 99) ? ' · ' + v.qty + ' in stock' : '';
                  return '<option value="' + vi + '"' + (vi === a.sel ? ' selected' : '') + '>' + esc(vlabel + ' — $' + (parseFloat(v.price) || 0).toFixed(2) + vqty) + '</option>';
                }).join('') + '</select>';
            }
            var grpClass = grouped
              ? ' xg-deck__row--grp' + ((ci === chunks.length - 1 && remaining === 0) ? ' xg-deck__row--gend' : '')
              : '';
            return '<div class="xg-deck__row' + offClass + grpClass + (subFor ? ' xg-deck__row--sub' : '') + '" role="row">' +
              lead +
              '<span class="xg-deck__qty" role="cell">' + c.take + '&times;</span>' +
              '<span class="xg-deck__card" role="cell">' +
                '<a class="xg-deck__cardlink" href="' + esc(o.url) + '" target="_blank" rel="noopener">' +
                  (o.image ? '<img class="xg-deck__thumb" src="' + esc(imgSrc(o.image)) + '" data-zoom="' + esc(zoomSrc(o.image)) + '" alt="" loading="lazy">' : '<span class="xg-deck__thumb xg-deck__thumb--none"></span>') +
                  (subFor ? '<span class="xg-deck__subtag">Substituted</span>' : '') +
                  '<span class="xg-deck__names"><span class="xg-deck__name">' + esc(o.name || r.name) + '</span>' +
                  (subFor ? '<span class="xg-deck__subnote">substitute for ' + esc(subFor) + '</span>' : '') +
                  ((!subFor && normName(o.name || r.name) !== normName(ln.name)) ? '<span class="xg-deck__matchnote">this is the &ldquo;' + esc(ln.name) + '&rdquo; from your list</span>' : '') +
                  ((meta && !picker) ? '<span class="xg-deck__meta">' + esc(meta) + '</span>' : '') + '</span>' +
                '</a>' + picker +
              '</span>' +
              '<span class="xg-deck__unit" role="cell">' + money(unit) + '</span>' +
              '<span class="xg-deck__line" role="cell">' + money(lineTotal) + '</span>' +
              (subFor
                ? '<span class="xg-deck__stat xg-deck__stat--sub" role="cell"><span class="xg-deck__statmiss">Not in stock</span> <span class="xg-deck__substat">Substituted</span><button type="button" class="xg-deck__subundo" data-li="' + li + '">undo</button></span>'
                : '<span class="xg-deck__stat xg-deck__stat--ok" role="cell"><span class="xg-deck__pill">In stock</span></span>') +
            '</div>';
          }).join('');
          if (remaining > 0) {
            var skey = ln.name.toLowerCase();
            var psub = state.subs[li];
            if (psub && psub.partial) {
              // The picked stand-in fills just the shortfall; the real
              // copies above stay exactly as they were.
              var sc = psub.r;
              var sq = (sc.offers && sc.offers[0] && typeof sc.offers[0].qty === 'number') ? sc.offers[0].qty : 99;
              var sTake = Math.min(remaining, Math.max(1, sq));
              var sUnit = parseFloat(sc.price) || 0;
              var sKey = 'sub:' + li;
              var sOn = state.checked[sKey] !== false;
              fillable++; if (sOn) ticked++;
              if (sOn) { subtotal += sUnit * sTake; addQty += sTake; }
              filledCards += sTake;
              shortQ -= sTake;
              var sMeta = [sc.set, sc.foil ? 'Foil' : '', sc.condition].filter(Boolean).join(' · ');
              html += '<div class="xg-deck__row xg-deck__row--grp xg-deck__row--gend xg-deck__row--sub" role="row">' +
                '<span class="xg-deck__pick" role="cell"><input type="checkbox" class="xg-deck__pickbox" data-k="' + sKey + '"' + (sOn ? ' checked' : '') + ' aria-label="Include ' + sTake + ' ' + esc(sc.name) + '"></span>' +
                '<span class="xg-deck__qty" role="cell">' + sTake + '&times;</span>' +
                '<span class="xg-deck__card" role="cell">' +
                  '<a class="xg-deck__cardlink" href="' + esc(sc.url) + '" target="_blank" rel="noopener">' +
                    (sc.image ? '<img class="xg-deck__thumb" src="' + esc(imgSrc(sc.image)) + '" data-zoom="' + esc(zoomSrc(sc.image)) + '" alt="" loading="lazy">' : '<span class="xg-deck__thumb xg-deck__thumb--none"></span>') +
                    '<span class="xg-deck__subtag">Substituted</span>' +
                    '<span class="xg-deck__names"><span class="xg-deck__name">' + esc(sc.name) + '</span>' +
                    '<span class="xg-deck__subnote">substitute for ' + remaining + ' missing ' + esc(ln.name) + '</span>' +
                    (sMeta ? '<span class="xg-deck__meta">' + esc(sMeta) + '</span>' : '') + '</span>' +
                  '</a>' +
                '</span>' +
                '<span class="xg-deck__unit" role="cell">' + money(sUnit) + '</span>' +
                '<span class="xg-deck__line" role="cell">' + money(sUnit * sTake) + '</span>' +
                '<span class="xg-deck__stat xg-deck__stat--sub" role="cell"><span class="xg-deck__statmiss">' + remaining + ' not in stock</span> <span class="xg-deck__substat">Substituted</span><button type="button" class="xg-deck__subundo" data-li="' + li + '">undo</button></span>' +
              '</div>';
              return html;
            }
            var simBtn = simBtnHtml(li, skey);
            // Information strip, not a product row (owner feedback): it only
            // annotates the rows above — the copies we DO have are up there
            // and ride along with Add to cart. When a sister store holds the
            // rest, the strip says so and links out.
            shorts.push({ name: ln.name, key: ln.name.toLowerCase() });
            var sx = state.sisterExtra[ln.name.toLowerCase()];
            var tail;
            if (sx) {
              // Name every store that has it, each its own link; count only
              // when every store's number is known (never an undercount).
              var sxs = (sx.stores && sx.stores.length) ? sx.stores : [sx];
              var knownQ = 0, allKnown = true;
              sxs.forEach(function (st) {
                if (typeof st.qty === 'number' && st.qty > 0) knownQ += st.qty; else allKnown = false;
              });
              var moreN = (allKnown && knownQ > 0) ? Math.min(knownQ, remaining) + ' more' : 'more';
              tail = moreN + ' in stock at: ' + sxs.map(function (st) {
                return '<a class="xg-deck__shortsister" href="' + esc(st.url) + '" target="_blank" rel="noopener">' + esc(st.store) + ' &rsaquo;</a>';
              }).join(' &middot; ');
            } else {
              tail = remaining + ' more ' + (remaining === 1 ? 'copy isn&rsquo;t' : 'copies aren&rsquo;t') + ' in stock right now';
            }
            html += '<div class="xg-deck__row xg-deck__row--short xg-deck__row--grp xg-deck__row--gend" role="row">' +
              '<span class="xg-deck__shortinfo" role="cell">' + esc(chunks[0].o.name || r.name || ln.name) + ': ' + filledQ + ' of your ' + ln.qty + ' are in stock above &mdash; ' + tail + simBtn + '</span>' +
              '<span class="xg-deck__stat xg-deck__stat--short" role="cell"><span class="xg-deck__pill">' + filledQ + ' of ' + ln.qty + ' available</span></span>' +
            '</div>';
          }
          return html;
        }
        // found but nothing allocatable right now — fall through to the
        // miss/sister rendering below.
      }
      var s = r && r.sister;
      if (s) {
        // In stock at another Exor Games location — separate store, separate
        // cart, so this row links out and never joins the add-to-cart batch.
        atSisters++;
        var smeta = [s.set, s.foil ? 'Foil' : '', s.condition].filter(Boolean).join(' · ');
        return '<div class="xg-deck__row xg-deck__row--sister" role="row">' +
          '<span class="xg-deck__pick" role="cell"></span>' +
          '<span class="xg-deck__qty" role="cell">' + ln.qty + '&times;</span>' +
          '<span class="xg-deck__card" role="cell">' +
            '<a class="xg-deck__cardlink" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
              (s.image ? '<img class="xg-deck__thumb" src="' + esc(imgSrc(s.image)) + '" data-zoom="' + esc(zoomSrc(s.image)) + '" alt="" loading="lazy">' : '<span class="xg-deck__thumb xg-deck__thumb--none"></span>') +
              '<span class="xg-deck__names"><span class="xg-deck__name">' + esc(s.name) + '</span>' +
              (smeta ? '<span class="xg-deck__meta">' + esc(smeta) + '</span>' : '') + '</span>' +
            '</a>' +
            simBtnHtml(li, ln.name.toLowerCase()) +
          '</span>' +
          '<span class="xg-deck__unit" role="cell">' + money(parseFloat(s.price) || 0) + '</span>' +
          '<span class="xg-deck__line" role="cell">&mdash;</span>' +
          // Uniform store list (owner): a quiet label, then every store as an
          // identical pill link — no prices here; the Unit column already
          // carries the cheapest one, and stores are ordered cheapest-first.
          '<span class="xg-deck__stat xg-deck__stat--sister" role="cell">' +
            '<span class="xg-deck__sisterlabel">Copies in stock at:</span>' +
            '<span class="xg-deck__sisterstores">' +
              ((s.stores && s.stores.length) ? s.stores : [{ store: s.store, url: s.url }]).map(function (st) {
                return '<a href="' + esc(st.url) + '" target="_blank" rel="noopener">' + esc(st.store) + ' ›</a>';
              }).join('') +
            '</span>' +
          '</span>' +
        '</div>';
      }
      missNames.push(ln.name);
      return '<div class="xg-deck__row xg-deck__row--miss" role="row">' +
        '<span class="xg-deck__pick" role="cell"></span>' +
        '<span class="xg-deck__qty" role="cell">' + ln.qty + '&times;</span>' +
        '<span class="xg-deck__card" role="cell"><span class="xg-deck__names"><span class="xg-deck__name">' + esc(ln.name) + '</span></span>' +
          simBtnHtml(li, ln.name.toLowerCase()) +
        '</span>' +
        '<span class="xg-deck__unit" role="cell">&mdash;</span>' +
        '<span class="xg-deck__line" role="cell">&mdash;</span>' +
        '<span class="xg-deck__stat xg-deck__stat--no" role="cell"><a href="/search?q=' + encodeURIComponent(ln.name) + '" target="_blank" rel="noopener">Not in stock ›</a></span>' +
      '</div>';
    }).join('');

    // Card-count basis (real copies, not lines): the fill knows exactly how
    // many copies the shelf covers, so the headline says that number.
    var pct = totalCards ? Math.round((filledCards / totalCards) * 100) : 0;

    // Snapshot for cart tracking: which game and how many copies/dollars are
    // ticked right now. addToCartSend reads this as the shopper leaves.
    (function () {
      var gm = null;
      for (var gi = 0; gi < GAMES.length; gi++) if (GAMES[gi].key === state.game) gm = GAMES[gi];
      var picks = [];
      state.lines.forEach(function (ln, li) {
        var r = effR(ln, li);
        if (!(r && r.found)) return;
        var a = allocate(ln, r, state.sel[li], nextCheap);
        a.chunks.forEach(function (c) {
          if (state.checked[chunkKey(li, c)] === false) return;
          if (picks.length < 40) picks.push(c.take + 'x ' + (r.__sub ? r.name + ' (sub for ' + ln.name + ')' : ln.name));
        });
        var ps = state.subs[li];
        if (ps && ps.partial && a.remaining > 0 && state.checked['sub:' + li] !== false && picks.length < 40) {
          var psq = (ps.r.offers && ps.r.offers[0] && typeof ps.r.offers[0].qty === 'number') ? ps.r.offers[0].qty : 99;
          picks.push(Math.min(a.remaining, Math.max(1, psq)) + 'x ' + ps.r.name + ' (sub for ' + ln.name + ')');
        }
      });
      lastPick = { game: state.game || 'mtg', label: gm ? gm.label : (state.game || 'mtg'), qty: addQty, subtotal: subtotal, picks: picks };
    })();

    var summary =
      '<div class="xg-deck__summary">' +
        '<div class="xg-deck__sumhead"><strong>' + filledCards + '</strong> of ' + totalCards + ' cards in stock <span class="xg-deck__dim">(' + pct + '%)</span></div>' +
        '<div class="xg-deck__sumbar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="xg-deck__sumnums">' +
          '<span>' + lines.length + ' different cards</span>' +
          (shortQ ? '<span class="xg-deck__shortnote">' + shortQ + (shortQ === 1 ? ' copy' : ' copies') + ' not in stock</span>' : '') +
          (atSisters ? '<span class="xg-deck__sisternote">' + atSisters + ' more at other Exor Games stores</span>' : '') +
          '<span class="xg-deck__subtotal">Selected subtotal <strong>' + money(subtotal) + '</strong></span>' +
        '</div>' +
      '</div>';

    function addButton(id) {
      if (!fillable) return '<p class="xg-deck__none">None of these are in stock right now.</p>';
      return '<button type="button" class="xg-deck__btn xg-deck__btn--add" id="' + id + '"' + (addQty ? '' : ' disabled') + '>' + esc(ADDALL) + ' <span class="xg-deck__dim">(' + addQty + ')</span></button>';
    }

    var missBlock = missNames.length
      ? '<details class="xg-deck__missing"><summary>' + missNames.length + ' not in stock</summary><ul class="xg-deck__misslist">' +
          missNames.map(function (n) { return '<li><a href="/search?q=' + encodeURIComponent(n) + '" target="_blank" rel="noopener">' + esc(n) + '</a></li>'; }).join('') +
        '</ul></details>'
      : '';

    var sisterHelp = atSisters
      ? '<p class="xg-deck__sisterhelp">Cards marked &ldquo;Copies in stock at:&rdquo; are at another Exor Games location &mdash; each store link opens that store&rsquo;s site, with its own cart and checkout.</p>'
      : '';

    out.innerHTML =
      summary +
      '<div class="xg-deck__addrow">' + addButton('xg-deck-add') + '</div>' +
      // Rendered as a flex list, not a <table>: on the live site the page
      // body sits inside the theme's .rte styling, whose table rules (full
      // cell borders, table-layout, small text) would crush the markup.
      '<div class="xg-deck__listwrap" role="table" aria-label="Deck availability">' +
        '<div class="xg-deck__hrow" role="row">' +
          '<span class="xg-deck__h xg-deck__h--pick" role="columnheader"><input type="checkbox" id="xg-deck-checkall"' + (fillable && ticked === fillable ? ' checked' : '') + (fillable ? '' : ' disabled') + ' aria-label="Select all cards"></span>' +
          '<span class="xg-deck__h xg-deck__h--qty" role="columnheader">Qty</span>' +
          '<span class="xg-deck__h xg-deck__h--card" role="columnheader">Card</span>' +
          '<span class="xg-deck__h xg-deck__h--unit" role="columnheader">Unit</span>' +
          '<span class="xg-deck__h xg-deck__h--line" role="columnheader">Line</span>' +
          '<span class="xg-deck__h xg-deck__h--stat" role="columnheader">Availability</span>' +
        '</div>' + rows + '</div>' +
      sisterHelp +
      missBlock +
      '<div class="xg-deck__addrow xg-deck__addrow--bottom">' + addButton('xg-deck-add2') + '</div>';

    ['xg-deck-add', 'xg-deck-add2'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { addToCart(collectItems()); });
    });
    clearBtn.hidden = false;
    maybeFetchSisterExtra(shorts);
  }

  // Floating card preview: clicking a thumbnail enlarges the card in a
  // centered overlay (like the card pages); clicking the enlarged card —
  // or anywhere else, or Escape — closes it. The thumb click never follows
  // the product link; the card NAME still does.
  var zoomEl = null;
  function closeZoom() {
    if (zoomEl && zoomEl.parentNode) zoomEl.parentNode.removeChild(zoomEl);
    zoomEl = null;
    document.removeEventListener('keydown', zoomKey);
  }
  function zoomKey(e) { if (e.key === 'Escape') closeZoom(); }
  function openZoom(src) {
    closeZoom();
    var d = document.createElement('div');
    d.className = 'xg-deck-zoom';
    d.innerHTML = '<img src="' + esc(src) + '" alt="Card preview">';
    d.addEventListener('click', closeZoom);
    document.addEventListener('keydown', zoomKey);
    document.body.appendChild(d);
    zoomEl = d;
  }
  out.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('xg-deck__thumb') && t.getAttribute('data-zoom')) {
      e.preventDefault();
      e.stopPropagation();
      openZoom(t.getAttribute('data-zoom'));
      return;
    }
    if (t && t.classList && t.classList.contains('xg-deck__simbtn')) {
      e.preventDefault();
      openSubs(+t.getAttribute('data-li'));
      return;
    }
    if (t && t.classList && t.classList.contains('xg-deck__subundo')) {
      e.preventDefault();
      var li = +t.getAttribute('data-li');
      if (state && state.subs[li]) {
        beacon('sub', '- ' + state.subs[li].r.name + ' (was for ' + state.lines[li].name + ')');
        delete state.subs[li];
        paint();
      }
    }
  });

  // One delegated listener drives the per-line ticks, the select-all box and
  // the version pickers across repaints; flipping the next-cheapest toggle
  // re-fills the current results instantly too.
  out.addEventListener('change', function (e) {
    if (!state) return;
    var t = e.target;
    if (t.classList && t.classList.contains('xg-deck__pickbox')) {
      var pk = t.getAttribute('data-k');
      state.checked[pk] = t.checked;
      var pl = state.lines[parseInt(pk, 10)];
      beacon('tick', (t.checked ? '+' : '-') + (pl ? pl.name : ''));
      paint();
    }
    else if (t.classList && t.classList.contains('xg-deck__ver')) {
      state.sel[t.getAttribute('data-i')] = +t.value || 0;
      var vl = state.lines[+t.getAttribute('data-i')];
      var vo = t.options && t.options[t.selectedIndex] ? t.options[t.selectedIndex].text : '';
      beacon('ver', (vl ? vl.name : '') + ' > ' + vo);
      paint();
      maybeFetchSims();
    }
    else if (t.id === 'xg-deck-checkall') {
      var v = t.checked;
      state.lines.forEach(function (ln, i) {
        var r = effR(ln, i);
        if (!(r && r.found)) return;
        allocate(ln, r, state.sel[i], nextCheapOn()).chunks.forEach(function (c) {
          state.checked[chunkKey(i, c)] = v;
        });
        if (state.subs[i] && state.subs[i].partial) state.checked['sub:' + i] = v;
      });
      beacon('all', v ? 'on' : 'off');
      paint();
    }
  });
  (function () {
    var nc = document.getElementById('xg-deck-nextcheap');
    if (nc) nc.addEventListener('change', function () { beacon('ncheap', nc.checked ? 'on' : 'off'); if (state) { paint(); maybeFetchSims(); } });
  })();

  function postCart(body) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  /* Runs as the shopper leaves for /cart, so both calls must survive the
     navigation: the cart attribute rides a keepalive fetch, the tally a
     sendBeacon. The attribute ("Deck Builder: Magic: The Gathering, 7
     cards, $35.35") persists through checkout onto the order's Additional
     details in Shopify admin — that's how a sale traces back here. The
     beacon carries aggregate numbers only, never the list itself. */
  function trackCart() {
    try {
      var p = lastPick || {};
      var tag = (p.label ? p.label + ', ' : '') + (p.qty || 0) + (p.qty === 1 ? ' card, ' : ' cards, ') + money(p.subtotal || 0);
      fetch('/cart/update.js', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ attributes: { 'Deck Builder': tag } })
      }).catch(function () {});
      beacon('cart', '', '&n=' + (p.qty || 0) + '&v=' + Math.round((p.subtotal || 0) * 100),
        p.picks && p.picks.length ? { names: p.picks } : null);
    } catch (e) {}
  }

  function addToCart(items) {
    if (!items || !items.length) return;
    var buttons = [document.getElementById('xg-deck-add'), document.getElementById('xg-deck-add2')].filter(Boolean);
    buttons.forEach(function (b) { b.disabled = true; b.textContent = 'Adding…'; });
    /* The cart may already hold copies of these variants (a prior run, or
       the product page) — cart + add must never exceed the shelf count, so
       read the live cart and cap each add at stock minus what's in there.
       That's how "2 owned" once became a 6-copy cart line. */
    fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (cart) {
        var have = {};
        if (cart && cart.items) cart.items.forEach(function (it) { have[it.variant_id] = (have[it.variant_id] || 0) + it.quantity; });
        var send = [];
        items.forEach(function (it) {
          var cap = typeof it.stock === 'number' ? Math.max(0, it.stock - (have[it.id] || 0)) : it.quantity;
          var q = Math.min(it.quantity, cap);
          if (q > 0) send.push({ id: it.id, quantity: q });
        });
        if (!send.length) { window.location.href = '/cart'; return; }   // all copies already in the cart
        addToCartSend(send, buttons);
      });
  }

  function addToCartSend(items, buttons) {
    postCart({ items: items }).then(function (r) {
      if (r.ok) { trackCart(); window.location.href = '/cart'; return null; }
      /* One item sold out since lookup -> Shopify rejects the whole batch.
         Add each on its own so the rest still land. */
      var added = 0;
      return runLimited(items, 3, function (it) {
        return postCart({ id: it.id, quantity: it.quantity }).then(function (rr) { if (rr.ok) added++; });
      }).then(function () {
        if (added > 0) { trackCart(); window.location.href = '/cart'; }
        else {
          buttons.forEach(function (b) { b.disabled = false; b.textContent = ADDALL; });
          var note = document.createElement('p');
          note.className = 'xg-deck__none';
          note.textContent = 'Sorry — those cards just went out of stock. Try again.';
          out.insertBefore(note, out.firstChild);
        }
      });
    }).catch(function () {
      buttons.forEach(function (b) { b.disabled = false; b.textContent = ADDALL; });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var lines = parseDeck(input.value);
    if (!lines.length) {
      out.innerHTML = '<p class="xg-deck__none">Paste a decklist above — one card per line, quantities optional.</p>';
      return;
    }
    go.disabled = true; go.textContent = 'Verifying…';
    out.innerHTML = '<div class="xg-deck__loading">Checking ' + lines.length + ' cards against live stock…</div>';
    var game = gameSel ? gameSel.value : DEFAULT_GAME;
    resolveNames(lines.map(function (l) { return l.name; }), game).then(function (map) {
      render(lines, map);
    }).catch(function () {
      out.innerHTML = '<p class="xg-deck__none">Something went wrong checking stock. Please try again in a moment.</p>';
    }).then(function () {
      go.disabled = false; go.textContent = GOLABEL;
    });
  });

  clearBtn.addEventListener('click', function () {
    input.value = ''; out.innerHTML = ''; clearBtn.hidden = true; input.focus();
  });

  // Homepage handoff: the front-page callout stores the pasted list under
  // xgDeckHand (real decklists don't fit in a URL) and navigates here.
  // One-shot — the key is removed before the search runs.
  try {
    var hand = sessionStorage.getItem('xgDeckHand');
    if (hand) {
      sessionStorage.removeItem('xgDeckHand');
      var h = JSON.parse(hand);
      if (h && h.list) {
        if (h.game && gameSel && GAMES.some(function (g) { return g.key === h.game; })) gameSel.value = h.game;
        input.value = String(h.list).slice(0, 12000);
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  } catch (err) {}
})();
