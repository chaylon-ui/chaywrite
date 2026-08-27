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
  var ADDALL = attr('data-addall', 'Add in-stock cards to cart');
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
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function imgSrc(u) { return u ? (u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=96') : ''; }

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
            '&names=' + encodeURIComponent(namesStr) +
            '&pb=' + encodeURIComponent(gate.bucket) + '&pn=' + encodeURIComponent(nonce));
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && d.results) d.results.forEach(function (x) { if (x && x.q) map[String(x.q).toLowerCase()] = x; });
          });
      });
    }).then(function () { return map; });
  }

  function render(lines, map) {
    // "Find next-cheapest versions" toggle: ON fills a line across versions
    // and conditions, cheapest first; OFF sticks to the single cheapest
    // version (matching playsets), reporting whatever it can't cover.
    var ncEl = document.getElementById('xg-deck-nextcheap');
    var nextCheap = !ncEl || ncEl.checked;
    var inStock = 0, partialLines = 0, atSisters = 0, totalCards = 0, filledCards = 0, shortQ = 0, subtotal = 0, addItems = [], missNames = [];
    var rows = lines.map(function (ln) {
      totalCards += ln.qty;
      var r = map[ln.name.toLowerCase()];
      if (r && r.found) {
        // Fill the requested quantity across the card's in-stock variants,
        // cheapest first (worker sends per-condition/printing stock counts).
        // 3 NM + 1 LP fills a 4; owning 2 of a wanted 4 adds the 2 and SAYS
        // only 2 of 4 — the cart never gets more copies than the shelf has.
        var offers = (r.offers && r.offers.length) ? r.offers : [{ variantId: r.variantId, qty: 99, price: r.price, condition: r.condition, foil: r.foil, set: r.set, name: r.name, image: r.image, url: r.url }];
        if (!nextCheap) offers = offers.slice(0, 1);
        var remaining = ln.qty, chunks = [];
        for (var oi = 0; oi < offers.length && remaining > 0; oi++) {
          var o = offers[oi];
          var avail = (typeof o.qty === 'number') ? o.qty : 99;
          var take = Math.min(remaining, avail);
          if (take > 0) { chunks.push({ o: o, take: take, stock: avail }); remaining -= take; }
        }
        var filledQ = ln.qty - remaining;
        if (filledQ > 0) {
          filledCards += filledQ;
          if (remaining === 0) { inStock++; } else { partialLines++; shortQ += remaining; }
          var html = chunks.map(function (c) {
            var o = c.o;
            var unit = parseFloat(o.price) || 0;
            var lineTotal = unit * c.take;
            subtotal += lineTotal;
            addItems.push({ id: o.variantId, quantity: c.take, stock: c.stock });
            var meta = [o.set, o.foil ? 'Foil' : '', o.condition].filter(Boolean).join(' · ');
            return '<div class="xg-deck__row" role="row">' +
              '<span class="xg-deck__qty" role="cell">' + c.take + '&times;</span>' +
              '<span class="xg-deck__card" role="cell">' +
                '<a class="xg-deck__cardlink" href="' + esc(o.url) + '" target="_blank" rel="noopener">' +
                  (o.image ? '<img class="xg-deck__thumb" src="' + esc(imgSrc(o.image)) + '" alt="" loading="lazy">' : '<span class="xg-deck__thumb xg-deck__thumb--none"></span>') +
                  '<span class="xg-deck__names"><span class="xg-deck__name">' + esc(o.name || r.name) + '</span>' +
                  (meta ? '<span class="xg-deck__meta">' + esc(meta) + '</span>' : '') + '</span>' +
                '</a>' +
              '</span>' +
              '<span class="xg-deck__unit" role="cell">' + money(unit) + '</span>' +
              '<span class="xg-deck__line" role="cell">' + money(lineTotal) + '</span>' +
              '<span class="xg-deck__stat xg-deck__stat--ok" role="cell"><span class="xg-deck__pill">In stock</span></span>' +
            '</div>';
          }).join('');
          if (remaining > 0) {
            // Positive framing on purpose: the copies we DO have are in the
            // rows above and ride along with Add to cart — this row only
            // accounts for the remainder.
            html += '<div class="xg-deck__row xg-deck__row--short" role="row">' +
              '<span class="xg-deck__qty" role="cell">' + remaining + '&times;</span>' +
              '<span class="xg-deck__card" role="cell"><span class="xg-deck__names"><span class="xg-deck__name">' + esc(chunks[0].o.name || r.name || ln.name) + '</span>' +
                '<span class="xg-deck__meta">' + filledQ + ' of your ' + ln.qty + ' are in stock above and ready to add &mdash; ' + remaining + ' more ' + (remaining === 1 ? 'copy isn&rsquo;t' : 'copies aren&rsquo;t') + ' in stock right now</span></span></span>' +
              '<span class="xg-deck__unit" role="cell">&mdash;</span>' +
              '<span class="xg-deck__line" role="cell">&mdash;</span>' +
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
          '<span class="xg-deck__qty" role="cell">' + ln.qty + '&times;</span>' +
          '<span class="xg-deck__card" role="cell">' +
            '<a class="xg-deck__cardlink" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
              (s.image ? '<img class="xg-deck__thumb" src="' + esc(imgSrc(s.image)) + '" alt="" loading="lazy">' : '<span class="xg-deck__thumb xg-deck__thumb--none"></span>') +
              '<span class="xg-deck__names"><span class="xg-deck__name">' + esc(s.name) + '</span>' +
              (smeta ? '<span class="xg-deck__meta">' + esc(smeta) + '</span>' : '') + '</span>' +
            '</a>' +
          '</span>' +
          '<span class="xg-deck__unit" role="cell">' + money(parseFloat(s.price) || 0) + '</span>' +
          '<span class="xg-deck__line" role="cell">&mdash;</span>' +
          '<span class="xg-deck__stat xg-deck__stat--sister" role="cell"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">At Exor ' + esc(s.store) + ' ›</a></span>' +
        '</div>';
      }
      missNames.push(ln.name);
      return '<div class="xg-deck__row xg-deck__row--miss" role="row">' +
        '<span class="xg-deck__qty" role="cell">' + ln.qty + '&times;</span>' +
        '<span class="xg-deck__card" role="cell"><span class="xg-deck__names"><span class="xg-deck__name">' + esc(ln.name) + '</span></span></span>' +
        '<span class="xg-deck__unit" role="cell">&mdash;</span>' +
        '<span class="xg-deck__line" role="cell">&mdash;</span>' +
        '<span class="xg-deck__stat xg-deck__stat--no" role="cell"><a href="/search?q=' + encodeURIComponent(ln.name) + '" target="_blank" rel="noopener">Not in stock ›</a></span>' +
      '</div>';
    }).join('');

    // Card-count basis (real copies, not lines): the fill knows exactly how
    // many copies the shelf covers, so the headline says that number.
    var pct = totalCards ? Math.round((filledCards / totalCards) * 100) : 0;
    var summary =
      '<div class="xg-deck__summary">' +
        '<div class="xg-deck__sumhead"><strong>' + filledCards + '</strong> of ' + totalCards + ' cards in stock <span class="xg-deck__dim">(' + pct + '%)</span></div>' +
        '<div class="xg-deck__sumbar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="xg-deck__sumnums">' +
          '<span>' + lines.length + ' different cards</span>' +
          (shortQ ? '<span class="xg-deck__shortnote">' + shortQ + (shortQ === 1 ? ' copy' : ' copies') + ' not in stock</span>' : '') +
          (atSisters ? '<span class="xg-deck__sisternote">' + atSisters + ' more at other Exor Games stores</span>' : '') +
          '<span class="xg-deck__subtotal">In-stock subtotal <strong>' + money(subtotal) + '</strong></span>' +
        '</div>' +
      '</div>';

    var addQty = 0;
    addItems.forEach(function (it) { addQty += it.quantity; });
    function addButton(id) {
      return addItems.length
        ? '<button type="button" class="xg-deck__btn xg-deck__btn--add" id="' + id + '">' + esc(ADDALL) + ' <span class="xg-deck__dim">(' + addQty + ')</span></button>'
        : '<p class="xg-deck__none">None of these are in stock right now.</p>';
    }

    var missBlock = missNames.length
      ? '<details class="xg-deck__missing"><summary>' + missNames.length + ' not in stock</summary><ul class="xg-deck__misslist">' +
          missNames.map(function (n) { return '<li><a href="/search?q=' + encodeURIComponent(n) + '" target="_blank" rel="noopener">' + esc(n) + '</a></li>'; }).join('') +
        '</ul></details>'
      : '';

    var sisterHelp = atSisters
      ? '<p class="xg-deck__sisterhelp">Cards marked &ldquo;At Exor &hellip;&rdquo; are in stock at another Exor Games location &mdash; the link opens that store&rsquo;s site, with its own cart and checkout.</p>'
      : '';

    out.innerHTML =
      summary +
      '<div class="xg-deck__addrow">' + addButton('xg-deck-add') + '</div>' +
      // Rendered as a flex list, not a <table>: on the live site the page
      // body sits inside the theme's .rte styling, whose table rules (full
      // cell borders, table-layout, small text) would crush the markup.
      '<div class="xg-deck__listwrap" role="table" aria-label="Deck availability">' +
        '<div class="xg-deck__hrow" role="row">' +
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
      if (b) b.addEventListener('click', function () { addToCart(addItems); });
    });
    clearBtn.hidden = false;
  }

  function postCart(body) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
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
      if (r.ok) { window.location.href = '/cart'; return null; }
      /* One item sold out since lookup -> Shopify rejects the whole batch.
         Add each on its own so the rest still land. */
      var added = 0;
      return runLimited(items, 3, function (it) {
        return postCart({ id: it.id, quantity: it.quantity }).then(function (rr) { if (rr.ok) added++; });
      }).then(function () {
        if (added > 0) { window.location.href = '/cart'; }
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
})();
