/* Page numbers for the advanced search page (/pages/advanced-search).
   Owner, 2026-09-23: "this page from the menu doesnt show page numbers".
   BinderPOS's widget (assets/advancedSearch.js, minified vendor code, not
   edited) asks portal.binderpos.com .../products/forStore for 18 cards at a
   time and only draws Previous / Next arrows - but every answer carries the
   total ("count": 11267 for in-stock Pokemon on 2026-09-23, probe
   35866512666). This script reads that total off the widget's own request
   and draws the same numbered pages the collection pages use
   (snippets/pagination.liquid: .pagination_collection > .parts > .item),
   between the arrows, plus "of N items" in the "Showing" line.
   A number is a link to ?page=N (so a new tab or a shared link works), but a
   plain click stays on the page, like the widget's own arrows.
   Owner, 2026-09-23: "when I click on the page number it simply just goes
   back to page 1". The widget does read ?page on load, but once it has
   built its filters it runs debounceSearch(), which sets offset = 0 - so
   every load starts at page 1 whatever the address says, and it rewrites
   the address to page=1. Fix, without touching the vendor file: the page
   we want is held in `want`, and the fetch wrapper puts that offset into
   the widget's next forStore request (its body is plain JSON with
   limit 18 / offset). The answer echoes the offset, and the widget's
   arrows and "Showing" line work from the answer, so they follow along.
   A click on a number sets `want` and fires the widget's own Next (or
   Previous) handler, which clears the grid, shows the loader and asks
   again - with our offset. On load, `want` comes from ?page.
   Loaded before advancedSearch.js so the fetch wrapper is in place first. */
(function () {
  if (!/\/pages\/advanced-search/.test(location.pathname) || !window.fetch) return;
  var PER = 18;
  var last = null;                               // {count, offset, n} of the newest answer
  var startPage = parseInt(new URLSearchParams(location.search).get('page'), 10) || 1;
  var want = startPage > 1 ? PER * (startPage - 1) : null;  // offset to put in the next request
  var scrollAfter = false;

  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var args = arguments, forced = false;
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/products/forStore') !== -1 && want !== null && init && typeof init.body === 'string') {
        var body = JSON.parse(init.body);
        if (body && typeof body.offset === 'number') {
          body.offset = want;
          args = [input, Object.assign({}, init, { body: JSON.stringify(body) })];
          forced = true;
        }
      }
    } catch (e) { args = arguments; forced = false; }
    var p = realFetch.apply(this, args);
    try {
      if (url && url.indexOf('/products/forStore') !== -1) {
        p.then(function (res) {
          res.clone().json().then(function (j) {
            if (!j || typeof j.count !== 'number') return;
            if (forced) want = null;             // landed; later requests are the widget's own
            last = { count: j.count, offset: Number(j.offset) || 0, n: (j.products || []).length };
            setTimeout(function () { render(); syncAddress(); jump(); }, 0);  // after the widget's updatePagination
          }).catch(function () {});
        }).catch(function () {});
      }
    } catch (e) { /* never break the widget's request */ }
    return p;
  };

  // The widget writes page = (its own offset) into the address before it
  // asks; put the page actually shown back, so refresh / back stay put.
  function syncAddress() {
    if (!last || !window.history || !history.replaceState) return;
    var cur = Math.floor(last.offset / PER) + 1;
    var q = new URLSearchParams(location.search);
    if (q.get('page') === String(cur)) return;
    q.set('page', String(cur));
    history.replaceState(history.state, '', location.pathname + '?' + q.toString());
  }

  function jump() {
    if (!scrollAfter) return;
    scrollAfter = false;
    var top = document.querySelector('#shopify-section-advanced_search .filters-toolbar-wrapper') ||
              document.getElementById('Collection');
    if (top) window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.pageYOffset - 120), behavior: 'smooth' });
  }

  function go(n) {
    var view = document.querySelector('#shopify-section-advanced_search .page-view');
    if (!view) return false;
    var nx = view.querySelector('.pag_next'), pv = view.querySelector('.pag_previous');
    var fire = (nx && nx.onclick) || (pv && pv.onclick);
    if (!fire) return false;
    want = PER * (n - 1);
    scrollAfter = true;
    fire.call(nx && nx.onclick ? nx : pv);
    return true;
  }

  function pageHref(n) {
    var q = new URLSearchParams(location.search);
    q.set('page', String(n));
    return location.pathname + '?' + q.toString();
  }

  // 1 2 3 ... 470 at the start, 1 ... 4 5 6 ... 470 in the middle,
  // 1 ... 468 469 470 at the end - the shape Shopify's paginate gives.
  function pageList(cur, pages) {
    var list = [];
    function add(p) { if (p >= 1 && p <= pages && list.indexOf(p) < 0) list.push(p); }
    add(1);
    for (var p = cur - 1; p <= cur + 1; p++) add(p);
    if (cur <= 3) { add(2); add(3); }
    if (cur >= pages - 2) { add(pages - 1); add(pages - 2); }
    add(pages);
    return list.sort(function (a, b) { return a - b; });
  }

  function render() {
    if (!last) return;
    var root = document.getElementById('shopify-section-advanced_search') || document;
    var view = root.querySelector('.page-view');
    var next = view && view.querySelector('.pag_next');
    if (!view || !next) return;
    var cur = Math.floor(last.offset / PER) + 1;
    var pages = Math.max(1, Math.ceil(last.count / PER));
    var key = cur + '/' + pages;

    var text = root.querySelector('.pagination__text');
    if (text && last.n) {
      var line = 'Showing ' + (last.offset + 1) + ' - ' + (last.offset + last.n) + ' of ' + last.count.toLocaleString('en-CA') + ' items';
      if (text.textContent !== line) text.textContent = line;
    }

    var box = view.querySelector('.pagination_collection');
    if (box && box.getAttribute('data-xg-key') === key && box.nextElementSibling === next) return;
    if (box) box.parentNode.removeChild(box);
    if (pages < 2) return;

    var html = '<div class="parts">', prev = 0;
    pageList(cur, pages).forEach(function (p) {
      if (prev && p - prev > 1) html += '<span class="item dots">&hellip;</span>';
      html += p === cur
        ? '<span class="item current" aria-current="page"><b>' + p + '</b></span>'
        : '<a href="' + pageHref(p) + '" class="item link" aria-label="Page ' + p + '">' + p + '</a>';
      prev = p;
    });
    html += '</div>';
    box = document.createElement('div');
    box.className = 'pagination_collection clearfix';
    box.setAttribute('data-xg-key', key);
    box.innerHTML = html;
    view.insertBefore(box, next);
  }

  // The widget rewrites the arrows on every page it loads; put the numbers
  // back each time (render() is a no-op when they are already right).
  function watch() {
    var view = document.querySelector('#shopify-section-advanced_search .page-view');
    if (!view) return;
    // Plain click on a number: change page in place (new tab etc. keep the link)
    view.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.pagination_collection a.item');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var n = parseInt(new URL(a.href, location.href).searchParams.get('page'), 10);
      if (n >= 1 && go(n)) e.preventDefault();
    });
    if (window.MutationObserver) new MutationObserver(function () { render(); }).observe(view, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();

/* Wishlist heart on the advanced search cards (owner, 2026-09-30: "Advanced search is
   missing the Wishlist button, but the regular search has the wishlist button").
   The widget draws its own cards without the theme's wishlist-icon snippet, and the
   theme's heart handler (theme.js) binds only to the hearts on the page at load, so
   this draws the same heart into each card's button row and does the same work: the
   theme keeps the wishlist in the "wishlistList" cookie (product handles joined by "__",
   14 days, path /; assets/wishlist.js reads it on /pages/wishlist) - a click appends
   the handle and the heart turns into the "View Wishlist" link, as on every other card.
   A card whose handle is already in the cookie opens in that state. */
(function () {
  'use strict';
  var COOKIE = 'wishlistList';
  var OUTLINE = 'M511.825,170.191c-0.14-1.786-0.298-3.155-0.44-4.095C504.22,84.955,444.691,20.73,367.434,20.73c-44.758,0-85.66,21.18-112.442,55.516C228.835,41.679,189.491,20.73,144.97,20.73C67.976,20.73,8.584,84.52,0.937,166.557c-0.147,0.956-0.295,2.12-0.43,3.489C-0.8,183.3,0.287,200.862,5.338,222.26c10.732,45.463,35.828,86.871,71.224,118.958l164.828,144.92c8.028,7.059,20.042,7.085,28.101,0.062l166.037-144.683c39.134-40.728,62.393-77.366,71.616-119.584C511.771,200.731,512.848,183.284,511.825,170.191z M465.46,212.833c-7.254,33.204-26.552,63.603-59.352,97.843L255.545,441.771l-150.569-132.38c-28.881-26.184-49.406-60.051-58.113-96.933c-3.953-16.747-4.747-29.585-3.895-38.225c0.075-0.764,0.393-3.072,0.393-3.072C48.849,109.384,91.478,63.397,144.97,63.397c39.823,0,73.704,24.287,90.17,63.294c7.338,17.382,31.97,17.382,39.308,0c16.136-38.225,52.419-63.294,92.986-63.294c53.494,0,96.121,45.99,101.609,107.786c0.147,1.242,0.187,1.586,0.245,2.333C469.993,182.541,469.174,195.811,465.46,212.833z';
  var FULL = 'M511.489,167.372c-7.573-84.992-68.16-146.667-144.107-146.667c-44.395,0-85.483,20.928-112.427,55.488c-26.475-34.923-66.155-55.488-110.037-55.488c-75.691,0-136.171,61.312-144.043,145.856c-0.811,5.483-2.795,25.045,4.395,55.68C15.98,267.532,40.62,308.663,76.759,341.41l164.608,144.704c4.011,3.541,9.067,5.312,14.08,5.312c4.992,0,10.005-1.749,14.016-5.248L436.865,340.13c24.704-25.771,58.859-66.048,70.251-118.251C514.391,188.514,511.66,168.268,511.489,167.372z';

  function read() {
    var m = document.cookie.match(/(?:^|;\s*)wishlistList=([^;]*)/);
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
  }
  function has(h) { return read().split('__').indexOf(h) !== -1; }
  function add(h) {
    if (has(h)) return;
    var v = read();
    v = (v && v !== '__' ? v : '') + '__' + h;
    document.cookie = COOKIE + '=' + encodeURIComponent(v) + '; expires=' + new Date(Date.now() + 14 * 864e5).toUTCString() + '; path=/';
  }
  // the theme's own <symbol>s, once, when no card on the page brought them
  function symbols() {
    if (document.getElementById('wishlist-outline') && document.getElementById('wishlist')) return;
    var box = document.createElement('div');
    box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' +
      (document.getElementById('wishlist-outline') ? '' : '<symbol id="wishlist-outline" viewBox="0 0 1200 1200"><path d="' + OUTLINE + '"/></symbol>') +
      (document.getElementById('wishlist') ? '' : '<symbol id="wishlist" viewBox="0 0 1200 1200"><path d="' + FULL + '"/></symbol>') + '</svg>';
    document.body.appendChild(box.firstChild);
  }
  function icon(id) { return '<svg class="icon" viewBox="0 0 30 30" aria-label="wishlist"><use xlink:href="#' + id + '" x="30%" y="30%"></use></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function markup(h) {
    var on = has(h);
    return '<div class="add-to-wishlist xg-adv-wish"><div class="show">' +
      '<div class="default-wishbutton-' + esc(h) + ' loading"' + (on ? ' style="display:none"' : '') + '><a class="add-in-wishlist-js btn" href="#" data-href="' + esc(h) + '">' + icon('wishlist-outline') + '<i class="fa fa-heart-o"></i><span class="tooltip-label">Add to wishlist</span></a></div>' +
      '<div class="added-wishbutton-' + esc(h) + ' loading"' + (on ? '' : ' style="display:none"') + '><a class="added-wishlist btn add_to_wishlist" href="/pages/wishlist">' + icon('wishlist') + '<i class="fa fa-heart"></i><span class="tooltip-label">View Wishlist</span></a></div>' +
      '</div></div>';
  }
  function handleOf(card) {
    var a = card.querySelector('a[href*="/products/"]');
    if (!a) return '';
    var m = String(a.getAttribute('href') || '').match(/\/products\/([^/?#]+)/);
    return m ? m[1] : '';
  }
  function apply() {
    var cards = document.querySelectorAll('#shopify-section-advanced_search .products-display .grid-view-item');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.querySelector('.add-to-wishlist')) continue;
      var row = card.querySelector('.thumbnail-buttons');
      var h = handleOf(card);
      if (!row || !h) continue;
      symbols();
      var box = document.createElement('div');
      box.innerHTML = markup(h);
      var el = box.firstChild;
      var cart = row.querySelector('.product-block-hover');
      if (cart) row.insertBefore(el, cart); else row.appendChild(el);
    }
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.xg-adv-wish .add-in-wishlist-js');
    if (!a) return;
    e.preventDefault();
    var h = a.getAttribute('data-href') || '';
    if (!h) return;
    add(h);
    var wrap = a.closest('.xg-adv-wish');
    var d = wrap.querySelector('[class*="default-wishbutton-"]'), ad = wrap.querySelector('[class*="added-wishbutton-"]');
    if (d) d.style.display = 'none';
    if (ad) ad.style.display = '';
  });
  function start() {
    var sec = document.getElementById('shopify-section-advanced_search');
    if (!sec) return;
    apply();
    if (window.MutationObserver) {
      var t = 0;
      new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = 0; apply(); }, 40); }).observe(sec, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
