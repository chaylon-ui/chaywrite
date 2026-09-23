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
