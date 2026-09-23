/* Exor Games — sister-store search band ("Also at our other Exor locations").
   The six Exor shops are separate Shopify stores, so their stock can't join
   this cart. On search pages this asks the exor-binder worker once per page
   view for the other five stores' in-stock matches (their public predictive
   search, edge-cached per query) and renders a horizontal strip of link-out
   cards — each opens that store's own product page, with that store's own
   cart, checkout and shipping.
   Placement: a full-width tinted strip after the SECOND ROW of result
   cards (owner, 2026-09-23: at the bottom it read as an afterthought -
   "still shows our top results but then puts in the middle of the results
   but not too low"); results of two rows or fewer keep it under the grid,
   above the app's "Showing X of Y" footer - EXCEPT when the shopper searched a card this
   store knows but has sold out (the "Top matches" strip in
   snippets/xg-decknote.liquid reports stock 0 / sold-out printings > 0 via
   window.xgExact + the xg:exact event): then the sister cards whose NAME is
   the search sit right under that strip as "In stock in other stores",
   above the app's loosely-matched results (owner, 2026-09-14). The search app re-renders that area on
   filter/sort/page changes, so a MutationObserver re-attaches the band from
   the already-fetched data — still one worker fetch per page view. No
   matches, endpoint missing, or fetch error → the band never renders. */
(function () {
  'use strict';

  var WORKER = 'https://exor-binder.nevski.workers.dev';
  var MAX_CARDS = 12;
  var fetchedQ = '';
  var fetchedCards = null;

  function query() {
    if (!/^\/(a\/)?search(\/|$)/.test(location.pathname)) return '';
    try {
      return (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 80);
    } catch (err) {
      return '';
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  function imgSrc(u) {
    return u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=200';
  }

  /* The results grid is wherever the product cards are (the app clones the
     theme's .grid-view-item card markup): climb from the last card to the
     smallest container that also holds the first card, and sit right after
     it. No cards / unknown layout → end of the content column. */
  var ROWS_ABOVE = 2;
  function anchor() {
    var cards = document.querySelectorAll('.grid-view-item');
    if (cards.length) {
      var first = cards[0];
      var node = cards[cards.length - 1].parentElement;
      while (node && node !== document.body && !node.contains(first)) {
        node = node.parentElement;
      }
      if (node && node !== document.body) {
        /* The grid's own children, one per card; cards sharing the first
           one's top edge make a row (5 on desktop, 2 on phones). After
           ROWS_ABOVE rows the band goes in as a full-width grid item. */
        var items = [];
        for (var i = 0; i < node.children.length; i++) {
          var ch = node.children[i];
          if (!ch.classList.contains('xg-sisters') && ch.querySelector && ch.querySelector('.grid-view-item')) items.push(ch);
        }
        if (items.length) {
          var top0 = items[0].getBoundingClientRect().top, perRow = 0;
          for (var j = 0; j < items.length && Math.abs(items[j].getBoundingClientRect().top - top0) < 4; j++) perRow++;
          var at = perRow * ROWS_ABOVE;
          if (perRow > 0 && items.length > at) return { el: items[at - 1], after: true, inGrid: true };
        }
        return { el: node, after: true };
      }
    }
    var host = document.querySelector('.normal_main_content') ||
      document.getElementById('MainContent') ||
      document.body;
    return { el: host, after: false };
  }

  function fold(s) {
    return String(s || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').split('[')[0].replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* Sold out here but known: the exact-name sister cards go up top. */
  function topMode() {
    var x = window.xgExact;
    if (!x || x.q !== fetchedQ || x.stock > 0 || !x.gone || !fetchedCards) return null;
    var want = fold(x.q);
    var exact = fetchedCards.filter(function (c) { return fold(c.name) === want; });
    return exact.length ? exact : null;
  }

  function buildBox(cards, top) {
    var box = document.createElement('aside');
    box.className = 'xg-sisters' + (top ? ' xg-sisters--top' : '');
    if (top) box.style.margin = '0 0 14px';
    box.innerHTML =
      '<div class="xg-sisters__head">' +
        '<span class="xg-sisters__title">' + (top ? 'In stock in other stores' : 'Also at our other Exor locations') + '</span>' +
        '<span class="xg-sisters__note">Sold and shipped separately by that store with its own cart, checkout, store credit and shipping.</span>' +
      '</div>' +
      '<div class="xg-sisters__row">' + cards.map(function (c) {
        return '<a class="xg-sisters__card" href="' + esc(c.url) + '" target="_blank" rel="noopener">' +
          '<span class="xg-sisters__badge">' + esc(c.store) + '</span>' +
          (c.image ? '<img src="' + esc(imgSrc(c.image)) + '" alt="' + esc(c.name) + '" loading="lazy">' : '') +
          '<span class="xg-sisters__name">' + esc(c.name) + '</span>' +
          (c.price ? '<span class="xg-sisters__price">$' + esc(c.price) + '</span>' : '') +
          '<span class="xg-sisters__go">View at ' + esc(c.store) + ' ↗</span>' +
        '</a>';
      }).join('') + '</div>';
    return box;
  }

  function place() {
    if (!fetchedCards || !fetchedCards.length) return;
    var exact = topMode();
    var have = document.querySelector('.xg-sisters');
    if (have) {
      if (!!exact === have.classList.contains('xg-sisters--top')) return;
      unplace(); /* the exact strip answered after the band was placed: move it */
    }
    var strip = exact && document.getElementById('xg-exact');
    if (exact && strip) {
      strip.insertAdjacentElement('afterend', buildBox(exact, true));
      return;
    }
    var a = anchor();
    var box = buildBox(fetchedCards, false);
    if (a.inGrid) {
      /* spans the whole row whether the grid is CSS grid, flex-wrap or floats */
      box.classList.add('xg-sisters--mid');
      box.style.gridColumn = '1 / -1';
      box.style.flex = '0 0 100%';
      box.style.width = '100%';
      box.style.boxSizing = 'border-box';
      box.style.clear = 'both';
    }
    if (a.after) {
      a.el.insertAdjacentElement('afterend', box);
    } else {
      a.el.appendChild(box);
    }
  }

  function unplace() {
    var b = document.querySelector('.xg-sisters');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function watch() {
    if (!window.MutationObserver || !document.body) return;
    var t = null;
    new MutationObserver(function () {
      if (t) return;
      t = setTimeout(function () {
        t = null;
        if (query() !== fetchedQ) {
          unplace(); /* app swapped the query in place — stale data, step aside */
          return;
        }
        place(); /* app re-rendered the results and took the band with it */
      }, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    var q = query();
    if (q.length < 2 || !window.fetch) return;
    fetchedQ = q;
    fetch(WORKER + '/sisters.json?q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var cards = d && Array.isArray(d.cards) ? d.cards : [];
        if (!cards.length) return;
        fetchedCards = cards.slice(0, MAX_CARDS);
        place();
        watch();
        document.addEventListener('xg:exact', place);
      })
      .catch(function () { /* quiet — the band simply doesn't appear */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
