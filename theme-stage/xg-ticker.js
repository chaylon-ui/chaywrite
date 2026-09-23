/* Fresh to the Shelf — two slim stock-ticker tapes PINNED TO THE BOTTOM of
   the homepage viewport, floating over the page like a broadcast ticker
   board: MTG on top, Pokémon below it running noticeably slower so the two
   tapes read as separate feeds rather than one wall of motion.

   Each tape has its OWN new-today feed, so both are honestly "just hit the
   shelf" rather than one mixed feed sliced by game: new-arrivals is MTG
   Singles only, and Pokémon comes from pokemon-singles-new-arrivals. Same
   worker endpoint for both, no new one.

   Each track holds two identical halves and slides -50% for a seamless CSS
   marquee; hovering or focusing pauses ONLY the tape under the cursor, and
   reduced-motion shoppers get plain scrollable rows. Foils wear a gold chip;
   $20+ cards get a flame. Colors ride the xg tokens, so dark mode restyles
   it free (the two red-as-text overrides live here because this <style>
   outranks the linked dark sheet).

   Both rows are built hidden and up front so MTG always sits above Pokémon
   whichever feed answers first; a row that comes back thin (or fails) stays
   hidden, and if neither fills, the whole strip removes itself.

   Pinned-to-viewport notes, all of them things that bite fixed elements:
   the board mounts on <body>, NOT inside #MainContent, because a CSS
   transform on any ancestor silently turns position:fixed into absolute.
   z-index 9990 clears page content but stays UNDER the mobile menu drawer
   (9998), the cart peek (100002) and the scanner overlay (100010) — and the
   peek gets lifted clear of the board so the two never stack. It publishes
   its height as --xg-tick-h, which pads the body so the footer stays
   reachable instead of living permanently under the board.

   AND the bottom of the viewport may already be SPOKEN FOR: this store runs
   an app that parks a full-width iframe (#PBarNextFrame — injected at
   runtime, nowhere in the theme) in a band along the bottom edge. It wins
   the hit test over anything under it, so a tape sitting in that band is
   completely unclickable — run 96 measured 3 of 6 sample points across the
   board dead, the whole lower tape. Raising z-index over it would mean
   covering another app's UI and clearing the menu drawer too, so instead
   place() ASKS the document who owns each point up from the bottom edge and
   sits the board directly on top of whatever is there. Measured, not
   hardcoded, so it re-settles if that app moves or goes away.

   HIDE FOR ME (owner, 2026-09-23: "if they click the pulsating circles it
   closes the NEW MTG CARDS AND NEW POKEMON CARDS for that user who is
   signed in only? if not signed in they cant close them"). For a signed-in
   shopper (customer id from __st.cid, as xg-store-credit.js reads it) the
   pulsing dot is a button: it closes the whole board and remembers that for
   THAT customer (localStorage key xg-ticker-off:<customer id>, so another
   account on the same computer still gets the tapes, and signing out
   brings them back). A small "New cards" pill in the corner re-opens them.
   Guests get the dot as before: decoration, no close. */
(function () {
  if (window.__xgTicker) return;
  window.__xgTicker = 1;
  if (!window.fetch) return;
  if (!document.body || (' ' + document.body.className + ' ').indexOf(' template-index ') === -1) return;

  var W = 'https://exor-binder.nevski.workers.dev';
  var CID = (window.__st && window.__st.cid != null) ? String(window.__st.cid).replace(/\D/g, '') : '';
  var OFF_KEY = 'xg-ticker-off:' + CID;
  function isOff() { try { return !!CID && localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; } }
  function setOff(v) { try { if (v) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (e) {} }

  /* speed = multiplier on the base seconds-per-card. Duration scales with the
     item count, so px/sec stays put and this multiplier is a true relative
     speed: Pokémon crawls at 1.8x the MTG tape's travel time. */
  /* The collection param is `collection=` — NOT `c=`, which is only how the
     worker names its CACHE KEY. With it missing the worker falls back to the
     TV room's saved settings AND overwrites nt from them, so `?c=...` served
     both tapes the same MTG feed while still answering 46 cards apiece
     (owner: "Seems both are mtg cards"). Naming the collection skips that
     branch outright. MTG's is pinned too: the tape is labelled by game now,
     so it must not follow the TV if that gets switched to another
     collection. Both still share the New Today row's cache entry, which the
     worker keys off the RESOLVED collection. */
  var ROWS = [
    { game: 'mtg', label: 'MTG', feed: '/cards.json?collection=new-arrivals&nt=1', speed: 1 },
    { game: 'pokemon', label: 'Pokémon', feed: '/cards.json?collection=pokemon-singles-new-arrivals&nt=1', speed: 1.8 }
  ];

  var css = '' +
    '#xg-ticker{position:fixed;left:0;right:0;bottom:0;z-index:9990;' +
      'background:var(--xg-surface,#ffffff);border-top:1px solid var(--xg-border,#e3e6e8);' +
      'box-shadow:0 -6px 22px rgba(0,0,0,.13);padding-bottom:env(safe-area-inset-bottom,0px);' +
      'font-family:var(--xg-font-body,"Inter",sans-serif)}' +
    '#xg-ticker:not(.is-live){display:none}' +
    // the board floats OVER the page, so the page needs somewhere to end
    'body{padding-bottom:var(--xg-tick-h,0px)}' +
    // ...and the cart peek has to clear the board instead of landing on it
    '#xg-peek{bottom:calc(16px + var(--xg-tick-h,env(safe-area-inset-bottom,0px))) !important}' +
    '#xg-ticker .xg-tick__row{display:flex;align-items:stretch}' +
    '#xg-ticker .xg-tick__row + .xg-tick__row{border-top:1px solid var(--xg-border,#e3e6e8)}' +
    '#xg-ticker .xg-tick__label{flex:0 0 auto;display:flex;align-items:center;gap:7px;padding:0 14px;min-width:104px;' +
      'background:linear-gradient(135deg,var(--xg-red,#d62c28),#e8542c);color:#fff;' +
      'font-family:var(--xg-font-display,"Oswald","Arial Narrow",sans-serif);font-size:11.5px;font-weight:600;' +
      'letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;z-index:1}' +
    // second tape gets its own colour so the board reads as two feeds
    '#xg-ticker .xg-tick__row[data-game="pokemon"] .xg-tick__label{background:linear-gradient(135deg,#1f4faf,#2f7ad6)}' +
    '#xg-ticker .xg-tick__dot{width:7px;height:7px;border-radius:50%;background:#fff;' +
      'box-shadow:0 0 8px rgba(255,255,255,.9);animation:xgTickPulse 1.6s ease-in-out infinite}' +
    '#xg-ticker .xg-tick__viewport{flex:1 1 auto;min-width:0;overflow:hidden;position:relative}' +
    '#xg-ticker .xg-tick__track{display:inline-flex;width:max-content;animation:xgTickMove 60s linear infinite}' +
    // pause only the hovered tape, not the whole board
    '#xg-ticker .xg-tick__row:hover .xg-tick__track,#xg-ticker .xg-tick__row:focus-within .xg-tick__track{animation-play-state:paused}' +
    '#xg-ticker .xg-tick__half{display:inline-flex;align-items:center}' +
    '#xg-ticker .xg-tick__item{display:inline-flex;align-items:center;gap:8px;padding:7px 18px 7px 12px;' +
      'border-right:1px solid var(--xg-border,#edf0f2);white-space:nowrap}' +
    '#xg-ticker .xg-tick__thumb{width:24px;height:34px;object-fit:cover;border-radius:3px;' +
      'background:var(--xg-bg,#eef0f2);flex:0 0 24px}' +
    '#xg-ticker .xg-tick__foil{font-size:9px;font-weight:800;letter-spacing:.08em;padding:2px 5px;' +
      'border-radius:4px;color:#7a5c00;background:linear-gradient(135deg,#ffe9a3,#ffd84d)}' +
    '#xg-ticker .xg-tick__hot{font-size:12px}' +
    '#xg-ticker .xg-tick__name{font-size:13px;font-weight:700;color:var(--xg-ink,#171b1d);text-decoration:none;' +
      'max-width:220px;overflow:hidden;text-overflow:ellipsis}' +
    '#xg-ticker .xg-tick__name:hover{color:var(--xg-red,#d62c28)}' +
    '#xg-ticker .xg-tick__set{font-size:11.5px;color:var(--xg-muted,#707a83);max-width:150px;overflow:hidden;text-overflow:ellipsis}' +
    '#xg-ticker .xg-tick__price{font-size:13px;font-weight:800;color:var(--xg-red,#d62c28)}' +
    '#xg-ticker .xg-tick__add{flex:0 0 24px;width:24px;height:24px;border:0;border-radius:50%;padding:0;cursor:pointer;' +
      'display:inline-flex;align-items:center;justify-content:center;background:var(--xg-red,#d62c28);color:#fff;' +
      'font-size:15px;font-weight:700;line-height:1}' +
    '#xg-ticker .xg-tick__add.is-added{background:var(--xg-success,#17784a)}' +
    'html[data-xg-theme="dark"] #xg-ticker .xg-tick__price{color:#ff6a5e}' +
    'html[data-xg-theme="dark"] #xg-ticker .xg-tick__name:hover{color:#ff6a5e}' +
    // signed-in only: the dot is a button (bigger invisible hit area round the 7px dot)
    '#xg-ticker button.xg-tick__dot{border:0;padding:0;margin:0;cursor:pointer;position:relative;flex:0 0 7px}' +
    '#xg-ticker button.xg-tick__dot::before{content:"";position:absolute;inset:-9px}' +
    '#xg-ticker button.xg-tick__dot:focus-visible{outline:2px solid #fff;outline-offset:3px}' +
    '#xg-ticker-open{position:fixed;left:12px;bottom:12px;z-index:9990;display:inline-flex;align-items:center;gap:7px;' +
      'padding:6px 12px;border:0;border-radius:999px;cursor:pointer;color:#fff;' +
      'background:linear-gradient(135deg,var(--xg-red,#d62c28),#e8542c);box-shadow:0 4px 14px rgba(0,0,0,.22);' +
      'font-family:var(--xg-font-display,"Oswald","Arial Narrow",sans-serif);font-size:11px;font-weight:600;' +
      'letter-spacing:.1em;text-transform:uppercase}' +
    '#xg-ticker-open .xg-tick__dot{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.9)}' +
    '@keyframes xgTickMove{to{transform:translateX(-50%)}}' +
    '@keyframes xgTickPulse{50%{opacity:.4}}' +
    '@media (max-width:600px){#xg-ticker .xg-tick__label{padding:0 9px;min-width:0;font-size:10px;letter-spacing:.08em}' +
      '#xg-ticker .xg-tick__cards{display:none}' +
      '#xg-ticker .xg-tick__item{padding:4px 12px 4px 9px;gap:6px}' +
      '#xg-ticker .xg-tick__thumb{width:20px;height:28px;flex:0 0 20px}' +
      '#xg-ticker .xg-tick__name{font-size:12px;max-width:150px}' +
      '#xg-ticker .xg-tick__set{display:none}}' +
    '@media (prefers-reduced-motion:reduce){' +
      '#xg-ticker .xg-tick__track{animation:none}' +
      '#xg-ticker .xg-tick__viewport{overflow-x:auto}' +
      '#xg-ticker .xg-tick__dot{animation:none}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function chip(c) {
    return '<span class="xg-tick__item">' +
      (c.image ? '<img class="xg-tick__thumb" src="' + esc(c.image) + '" alt="" loading="lazy">' : '') +
      (c.foil ? '<span class="xg-tick__foil">FOIL</span>' : '') +
      (+c.price >= 20 ? '<span class="xg-tick__hot" aria-hidden="true">🔥</span>' : '') +
      '<a class="xg-tick__name" href="' + esc(c.url) + '">' + esc(c.name) + '</a>' +
      (c.set ? '<span class="xg-tick__set">' + esc(c.set) + '</span>' : '') +
      '<span class="xg-tick__price">$' + esc(c.price) + '</span>' +
      (c.variantId ? '<button type="button" class="xg-tick__add" data-vid="' + esc(c.variantId) + '" data-name="' + esc(c.name) + '" data-img="' + esc(c.image || '') + '" aria-label="Add ' + esc(c.name) + ' to cart">+</button>' : '') +
    '</span>';
  }

  // Both rows exist (hidden) before either feed answers, so the board's order
  // is fixed by markup, not by which request wins the race.
  function build() {
    // <body>, NOT #MainContent: a transform on any ancestor would turn this
    // element's position:fixed back into position:absolute.
    if (!document.body || document.getElementById('xg-ticker')) return null;
    var host = document.createElement('div');
    host.id = 'xg-ticker';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'New cards in stock today');
    host.innerHTML = ROWS.map(function (r) {
      return '<div class="xg-tick__row" data-game="' + r.game + '" aria-label="New ' + esc(r.label) + ' cards in stock today" hidden>' +
        // the pill says what the tape is in words: NEW MTG CARDS; phones drop "cards" to keep the tape's room
        '<span class="xg-tick__label" title="New cards in stock today">' +
          (CID
            ? '<button type="button" class="xg-tick__dot" data-xg-tick-close aria-label="Hide the new cards tapes" title="Hide these for me"></button>'
            : '<span class="xg-tick__dot" aria-hidden="true"></span>') +
          'New ' + esc(r.label) + '<span class="xg-tick__cards"> cards</span>' +
        '</span>' +
        '<div class="xg-tick__viewport"><div class="xg-tick__track"></div></div>' +
      '</div>';
      }).join('');
    document.body.appendChild(host);
    window.addEventListener('resize', function () { place(host); }, { passive: true });
    // mobile browser chrome collapsing on the first scroll changes innerHeight
    var st = 0;
    window.addEventListener('scroll', function () {
      clearTimeout(st);
      st = setTimeout(function () { place(host); }, 150);
    }, { passive: true });
    return host;
  }

  /* Publish the board's FULL footprint (its own height plus however far it
     had to sit above the bottom edge) so the page can end above it, instead
     of the footer's last strip living under the board forever. */
  function measure(host) {
    var off = parseInt(host.style.bottom, 10) || 0;
    document.documentElement.style.setProperty('--xg-tick-h', (host.offsetHeight + off) + 'px');
  }

  /* Sit on top of whatever already owns the bottom edge. Reset to flush
     first so the scan is always measured from the same place (and never
     against our own previous offset), then walk UP the board's own height
     asking who owns each point: the highest one we do not own marks the top
     of the contested band. Stops at the board's height, because past that
     the answer is just page content and would run away upward.

     Only a REAL element counts as a blocker. null (nothing hit-testable
     there yet) and html/body (nothing on top of us) are not overlays, and
     counting them is what parked the board a whole board-height up the
     screen on first paint until a scroll re-measured it and it snapped down
     (owner report). A blockage spanning essentially the WHOLE board is
     likewise not something to dodge - it means the reading is bad, usually
     because layout has not settled - so that yields zero. */
  function place(host) {
    if (!host.isConnected || !host.classList.contains('is-live')) return;   // a hidden (removed) board's listeners stay quiet
    host.style.bottom = '0px';
    var h = host.offsetHeight, x = Math.round(window.innerWidth / 2), blocked = 0;
    for (var k = 3; k < h; k += 6) {
      var el = document.elementFromPoint(x, window.innerHeight - k);
      if (!el || el === document.body || el === document.documentElement) continue;
      if (!host.contains(el)) blocked = k;
    }
    if (blocked >= h - 12) blocked = 0;          // covered end to end: bad read
    host.style.bottom = Math.min(blocked ? blocked + 6 : 0, 80) + 'px';
    measure(host);
  }

  function fill(host, r, cards) {
    var row = host.querySelector('.xg-tick__row[data-game="' + r.game + '"]');
    if (!row) return;
    var half = '<span class="xg-tick__half">' + cards.map(chip).join('') + '</span>';
    var track = row.querySelector('.xg-tick__track');
    track.innerHTML = half + half;
    // speed scales with content so short feeds don't whip past; the row's
    // multiplier then sets its tape apart from the one above it
    // owner, 2026-09-23: "slow down the new mtg and pokemon tickers by 50% each" -
    // half the speed = twice the time per card (was 3.5s, floor 30s)
    track.style.animationDuration = Math.round(Math.max(60, cards.length * 7) * r.speed) + 's';
    row.setAttribute('data-count', cards.length);
    row.hidden = false;
    host.classList.add('is-live');   // must precede measure(): display:none has no height
    measure(host);                   // reserve the page's space immediately
    // ...but only hit-test once layout has settled, and again later because
    // the app that owns the bottom band arrives on its own schedule
    requestAnimationFrame(function () { requestAnimationFrame(function () { place(host); }); });
    setTimeout(function () { place(host); }, 1500);
    setTimeout(function () { place(host); }, 4000);
  }

  /* The "New cards" pill that brings the tapes back for a customer who hid
     them. See lift() for how it keeps clear of other corner widgets. */
  function showOpener() {
    if (document.getElementById('xg-ticker-open')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'xg-ticker-open';
    b.title = 'Show the new cards tapes again';
    b.innerHTML = '<span class="xg-tick__dot" aria-hidden="true"></span>New cards';
    b.addEventListener('click', function () {
      setOff(false);
      b.remove();
      start();
    });
    document.body.appendChild(b);
    /* Keep clear of anything else parked in that corner: Shopify's own
       preview bar (an iframe that the store admin sees on preview themes;
       minimised it is a small dark box bottom-left - owner, 2026-09-23:
       "does this weird black square around the button when minimized"),
       chat or rewards launchers, the app band along the bottom edge. Any
       iframe or fixed/sticky box found under OR over the pill's corners and
       centre pushes it up to sit just above that box. */
    function fixedHost(el) {
      for (var n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        if (n === b) return null;
        if (n.tagName === 'IFRAME') return n;
        var pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return n;
      }
      return null;
    }
    function lift() {
      if (!b.isConnected) return;
      var bottom = 12;
      for (var i = 0; i < 6; i++) {
        b.style.bottom = bottom + 'px';
        var r = b.getBoundingClientRect(), top = null;
        var pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
        for (var k = 0; k < pts.length; k++) {
          var stack = document.elementsFromPoint ? document.elementsFromPoint(pts[k][0], pts[k][1]) : [];
          for (var j = 0; j < stack.length; j++) {
            var h = fixedHost(stack[j]);
            if (h && h !== b) {
              var hr = h.getBoundingClientRect();
              if (hr.height < window.innerHeight * 0.5 && (top === null || hr.top < top)) top = hr.top;
            }
          }
        }
        if (top === null) break;
        var want = Math.round(window.innerHeight - top + 8);
        if (want <= bottom) break;
        bottom = want;
      }
    }
    requestAnimationFrame(lift);
    setTimeout(lift, 1500);
    setTimeout(lift, 4000);
  }

  function hide(host) {
    setOff(true);
    host.remove();
    document.documentElement.style.setProperty('--xg-tick-h', '0px');
    showOpener();
  }

  function start() {
    if (isOff()) { showOpener(); return; }
    var host = build();
    if (host) {
      host.addEventListener('click', function (e) {
        var d = e.target && e.target.closest ? e.target.closest('[data-xg-tick-close]') : null;
        if (d && CID) { e.preventDefault(); hide(host); }
      });
      var pending = ROWS.length;
      ROWS.forEach(function (r) {
        fetch(W + r.feed)
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (j) {
            // Every card must belong to THIS tape's game. If a feed URL is
            // ever wrong again the tape comes back EMPTY — visibly absent —
            // instead of quietly filling with the other game's cards.
            var cards = ((j && j.cards) || []).filter(function (c) {
              return c && c.name && c.price && (!c.game || c.game === r.game);
            }).slice(0, 18);
            if (cards.length >= 4) fill(host, r, cards);
          })
          .catch(function () {})
          .then(function () {
            // a quiet day on both games leaves nothing worth a strip
            if (--pending === 0 && !host.querySelector('.xg-tick__row:not([hidden])')) {
              host.remove();
              document.documentElement.style.setProperty('--xg-tick-h', '0px');
            }
          });
      });
    }
  }
  start();

  // One delegated add handler for both tapes; same wiring as the scanner rows —
  // /cart/add.js, header badge sync, cart peek. data-busy stops double-taps.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.xg-tick__add') : null;
    if (!b || b.getAttribute('data-busy')) return;
    e.preventDefault();
    b.setAttribute('data-busy', '1');
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: +b.getAttribute('data-vid'), quantity: 1 }] })
    }).then(function (r) {
      if (!r.ok) throw new Error('add ' + r.status);
      b.classList.add('is-added');
      b.textContent = '✓';
      try {
        var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown;
        if (typeof sync === 'function') sync();
      } catch (err) {}
      if (window.xgCartPeek) window.xgCartPeek({ title: b.getAttribute('data-name'), image: b.getAttribute('data-img') || null });
      setTimeout(function () { b.classList.remove('is-added'); b.textContent = '+'; b.removeAttribute('data-busy'); }, 1800);
    }).catch(function () {
      b.textContent = '×';
      b.setAttribute('title', 'Just sold — open the card for other printings');
      setTimeout(function () { b.textContent = '+'; b.removeAttribute('data-busy'); }, 2200);
    });
  });
})();