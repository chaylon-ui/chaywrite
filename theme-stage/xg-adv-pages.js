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
   A number is a plain link to this page with ?page=N: the widget already
   starts at that page on load (offset = 18 x (page - 1)) and keeps every
   other filter in the address, so nothing else changes.
   Loaded before advancedSearch.js so the fetch wrapper is in place first. */
(function () {
  if (!/\/pages\/advanced-search/.test(location.pathname) || !window.fetch) return;
  var PER = 18;
  var last = null;                               // {count, offset, n} of the newest answer

  var realFetch = window.fetch;
  window.fetch = function (input) {
    var p = realFetch.apply(this, arguments);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/products/forStore') !== -1) {
        p.then(function (res) {
          res.clone().json().then(function (j) {
            if (!j || typeof j.count !== 'number') return;
            last = { count: j.count, offset: Number(j.offset) || 0, n: (j.products || []).length };
            setTimeout(render, 0);               // after the widget's own updatePagination
          }).catch(function () {});
        }).catch(function () {});
      }
    } catch (e) { /* never break the widget's request */ }
    return p;
  };

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
      var want = 'Showing ' + (last.offset + 1) + ' - ' + (last.offset + last.n) + ' of ' + last.count.toLocaleString('en-CA') + ' items';
      if (text.textContent !== want) text.textContent = want;
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
    if (!view || !window.MutationObserver) return;
    new MutationObserver(function () { render(); }).observe(view, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
