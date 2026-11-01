/* Exor Games — personalised homepage (owner, 2026-09-10: "remember which
   game someone browses and lead with that game's arrivals and events").

   Learning: every product and collection page names its game in a
   <meta name="xg-game"> (layout/theme.liquid writes product.type or the
   collection's handle and title); the last game browsed is kept in
   localStorage as xgGame, in this browser only, nothing sent anywhere.

   Applying, homepage only: the In-Stock Singles tabs open on that game's
   tab, that game's sealed tile moves first, and the events strip leads
   with that game (sections/events-strip.liquid reads the same key). It
   says nothing about it (the "Because you browse X" line and its "Show
   everything" button went on 2026-11-01 at the owner's ask).
   Nothing here touches the editor's settings; it reorders in the browser. */
(function () {
  'use strict';
  var KEY = 'xgGame';
  var GAMES = [
    { k: 'pokemon', re: /pok[eé]mon/i, name: 'Pokémon' },
    { k: 'mtg', re: /\bmtg\b|magic/i, name: 'Magic: The Gathering' },
    { k: 'yugioh', re: /yu-?gi-?oh/i, name: 'Yu-Gi-Oh!' },
    { k: 'lorcana', re: /lorcana/i, name: 'Lorcana' },
    { k: 'onepiece', re: /one[- ]?piece/i, name: 'One Piece' },
    { k: 'fab', re: /flesh[- ]and[- ]blood/i, name: 'Flesh and Blood' },
    { k: 'swu', re: /star[- ]?wars/i, name: 'Star Wars: Unlimited' },
    { k: 'riftbound', re: /riftbound/i, name: 'Riftbound' },
    { k: 'hockey', re: /hockey/i, name: 'Hockey' },
    { k: 'basketball', re: /basketball/i, name: 'Basketball' }
  ];
  function gameOf(text) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].re.test(text)) return GAMES[i]; return null; }
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.k ? v : null; } catch (e) { return null; } }
  function write(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }

  // 1. Learn from the page being looked at.
  var meta = document.querySelector('meta[name="xg-game"]');
  var hint = meta ? (meta.getAttribute('content') || '').trim() : '';
  var seen = hint ? gameOf(hint) : null;
  if (seen) {
    var cur = read();
    write({ k: seen.k, name: seen.name, at: Date.now(), n: (cur && cur.k === seen.k ? (cur.n || 0) : 0) + 1 });
  }

  // 2. Apply on the homepage.
  if (location.pathname.replace(/\/+$/, '') !== '') return;
  var pref = read();
  if (!pref || Date.now() - pref.at > 90 * 864e5) return;
  var G = null;
  for (var gi = 0; gi < GAMES.length; gi++) if (GAMES[gi].k === pref.k) G = GAMES[gi];
  if (!G) return;

  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    var moved = 0;

    // In-Stock Singles: that game's tab first, and open.
    var tabs = document.querySelectorAll('ul.products-tab');
    Array.prototype.forEach.call(tabs, function (ul) {
      var items = Array.prototype.slice.call(ul.children);
      var hit = null;
      for (var i = 0; i < items.length; i++) if (G.re.test(items[i].textContent || '')) { hit = items[i]; break; }
      if (!hit) return;
      var link = hit.querySelector('a[data-toggle="tab"]');
      var target = link && link.getAttribute('href');
      var pane = target && /^#/.test(target) ? document.getElementById(target.slice(1)) : null;
      if (hit !== items[0]) ul.insertBefore(hit, items[0]);
      if (pane) {
        items.forEach(function (li) { li.classList.remove('active'); });
        hit.classList.add('active');
        var panes = pane.parentNode ? pane.parentNode.querySelectorAll('.tab-pane') : [];
        Array.prototype.forEach.call(panes, function (p) { p.classList.remove('active'); p.classList.remove('in'); });
        pane.classList.add('active'); pane.classList.add('in');
      }
      moved++;
    });

    // Sealed tiles: that game's collection first.
    var grids = document.querySelectorAll('.collection-grid .grid--uniform');
    Array.prototype.forEach.call(grids, function (grid) {
      var tiles = Array.prototype.slice.call(grid.children);
      var hit = null;
      for (var i = 0; i < tiles.length; i++) {
        var a = tiles[i].querySelector('a[href]');
        if (a && (G.re.test(a.getAttribute('href') || '') || G.re.test(tiles[i].textContent || ''))) { hit = tiles[i]; break; }
      }
      if (hit && hit !== tiles[0]) { grid.insertBefore(hit, tiles[0]); moved++; }
    });

    // No note about it (owner, 2026-11-01: "Get rid of the because you browse
    // magic wordage and just lead with it"): the game simply leads. The
    // preference still ages out after 90 days of not browsing that game.
    void moved;
  });
})();
