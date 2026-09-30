/* Zero-results fallback on the Cloud Search page (owner, 2026-09-30: "0 results
   chess boards ... but we have chess boards ... fix the 0 results on our side").

   The search app matches whole words exactly, so "chess boards" finds nothing while
   "chess board" finds 15. Shopify's own search handles plurals and word forms, so
   when the app's page settles on "0 results" this asks the store's predictive
   search (/search/suggest.json) for the same words and shows what it found under
   the app's search box, with a link to the full store search page (/search?q=).
   Loaded only on /a/search (layout/theme.liquid). Nothing runs when the app found
   anything. */
(function () {
  'use strict';
  if (!/^\/a\/search(\/|$)/.test(location.pathname)) return;
  var q = '';
  try { q = (new URLSearchParams(location.search).get('q') || '').trim(); } catch (e) { return; }
  if (!q) return;

  var ROOT = '.normal_main_content';
  var seenZeroAt = 0, tries = 0, done = false;

  // null: not settled yet; false: the app found products; element: the app's results box saying 0
  function state() {
    var r = document.querySelector(ROOT);
    if (!r) return null;
    if (r.querySelector('a[href*="/products/"]')) return false;
    return /(^|\s)0\s+results?\b/i.test(r.textContent || '') ? r : null;
  }
  function poll() {
    if (done) return;
    var s = state();
    if (s === false) { done = true; return; }
    if (s) {
      // the app may print "0 results" while it is still loading: it has to hold for a second
      if (!seenZeroAt) seenZeroAt = Date.now();
      else if (Date.now() - seenZeroAt >= 1000) { done = true; run(s); return; }
    } else seenZeroAt = 0;
    if (++tries < 60) setTimeout(poll, 250);
  }

  function run(root) {
    var url = '/search/suggest.json?q=' + encodeURIComponent(q) +
      '&resources[type]=product&resources[limit]=10' +
      '&resources[options][unavailable_products]=hide' +
      '&resources[options][fields]=title,product_type,variants.title,vendor,tag';
    fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = (j && j.resources && j.resources.results && j.resources.results.products) || [];
        render(root, list);
      })
      .catch(function () { render(root, []); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function img(p) {
    var u = (p.featured_image && p.featured_image.url) || p.image || '';
    if (!u) return '';
    if (/cdn\.shopify\.com/.test(u) && !/[?&]width=/.test(u)) u += (u.indexOf('?') === -1 ? '?' : '&') + 'width=360';
    return u;
  }
  function money(p) {
    var v = parseFloat(p.price);
    if (!(v >= 0)) return '';
    return '$' + v.toFixed(2);
  }

  function render(root, list) {
    if (document.querySelector('.xg-sf')) return;
    var all = '/search?q=' + encodeURIComponent(q) + '&type=product';
    var h = '<section class="xg-sf" aria-label="Results from the store search">';
    if (list.length) {
      h += '<h2 class="xg-sf__h">Nothing matched &ldquo;' + esc(q) + '&rdquo; word for word. Our store search found these:</h2>';
      h += '<ul class="xg-sf__grid">';
      for (var i = 0; i < list.length; i++) {
        var p = list[i], im = img(p), pr = money(p);
        h += '<li class="xg-sf__item"><a class="xg-sf__card" href="' + esc(p.url || ('/products/' + p.handle)) + '">' +
          '<span class="xg-sf__pic">' + (im ? '<img src="' + esc(im) + '" alt="" loading="lazy">' : '') + '</span>' +
          '<span class="xg-sf__title">' + esc(p.title) + '</span>' +
          (pr ? '<span class="xg-sf__price">' + esc(pr) + '</span>' : '') +
          '</a></li>';
      }
      h += '</ul>';
      h += '<a class="xg-sf__all" href="' + esc(all) + '">See all results for &ldquo;' + esc(q) + '&rdquo; &rsaquo;</a>';
    } else {
      h += '<h2 class="xg-sf__h">Nothing matched &ldquo;' + esc(q) + '&rdquo; word for word.</h2>';
      h += '<a class="xg-sf__all" href="' + esc(all) + '">Try the store search for &ldquo;' + esc(q) + '&rdquo; &rsaquo;</a>';
    }
    h += '</section>';

    var style = document.createElement('style');
    style.textContent =
      '.xg-sf{margin:18px 0 26px;padding:18px 18px 16px;border:1px solid rgba(0,0,0,.12);border-radius:12px;background:#fafafa}' +
      '.xg-sf__h{margin:0 0 14px;font-size:17px;line-height:1.3;font-weight:700}' +
      '.xg-sf__grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}' +
      '.xg-sf__item{margin:0}' +
      '.xg-sf__card{display:block;text-decoration:none;color:inherit}' +
      '.xg-sf__pic{display:block;aspect-ratio:1/1;border-radius:8px;overflow:hidden;background:#fff;border:1px solid rgba(0,0,0,.08)}' +
      '.xg-sf__pic img{width:100%;height:100%;object-fit:contain;display:block}' +
      '.xg-sf__title{display:block;margin:8px 0 2px;font-size:13px;line-height:1.3;font-weight:600}' +
      '.xg-sf__price{display:block;font-size:13px;opacity:.8}' +
      '.xg-sf__all{display:inline-block;margin-top:14px;font-weight:700;text-decoration:underline}' +
      'html[data-xg-theme="dark"] .xg-sf{background:#181d20;border-color:#2a3236;color:#e6ebee}' +
      'html[data-xg-theme="dark"] .xg-sf__pic{background:#1d2327;border-color:#2a3236}' +
      'html[data-xg-theme="dark"] .xg-sf__card{color:#e6ebee}' +
      'html[data-xg-theme="dark"] .xg-sf__price{color:#b8c0c6;opacity:1}' +
      'html[data-xg-theme="dark"] .xg-sf__all{color:#e6ebee}';
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.innerHTML = h;
    var sec = box.firstChild;
    // right under the app's own "0 results" header block when it can be found, else at the end
    var head = null, els = root.querySelectorAll('h1,h2,h3,p,div,span');
    for (var k = 0; k < els.length; k++) {
      if (/(^|\s)0\s+results?\b/i.test(els[k].textContent || '') && els[k].children.length < 6) head = els[k];
    }
    var anchor = head;
    while (anchor && anchor.parentNode !== root) anchor = anchor.parentNode;
    if (anchor && anchor.nextSibling) root.insertBefore(sec, anchor.nextSibling);
    else root.appendChild(sec);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poll);
  else poll();
})();
