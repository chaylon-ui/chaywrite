/* Zero-results fallback on the Cloud Search page (owner, 2026-09-30: "0 results
   chess boards ... but we have chess boards ... fix the 0 results on our side").

   The search app matches whole words exactly, so "chess boards" finds nothing while
   "chess board" finds 15. Shopify's own search handles plurals and word forms, so
   when the app's page settles on "0 results" this asks the store's predictive
   search (/search/suggest.json) for the same words and shows what it found under
   the app's search box, with a link to the full store search page (/search?q=).
   Single cards (owner, 2026-09-30: "Liliana dread horse" 0 results, the card is Liliana,
   Dreadhorde General): the store search finds the card (it forgives typos), and when
   most of its hits are one card the strip opens with "Did you mean <card>?" linking
   to the app's search for the exact name, where every printing and condition shows.
   Loaded from layout/theme.liquid on every page but runs only on /a/search (the
   app's page is built on the live theme, where a Liquid path test did not fire).
   Nothing runs when the app found anything. */
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
    // product links from the app itself: our own blocks inside the box (the "Also at our
    // other Exor locations" strip, this strip) do not count
    var links = r.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < links.length; i++) if (!links[i].closest('[class*="xg-"]')) return false;
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

  function suggest(words) {
    var url = '/search/suggest.json?q=' + encodeURIComponent(words) +
      '&resources[type]=product&resources[limit]=10' +
      '&resources[options][unavailable_products]=hide' +
      '&resources[options][fields]=title,product_type,variants.title,vendor,tag';
    return fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.resources && j.resources.results && j.resources.results.products) || []; })
      .catch(function () { return []; });
  }
  function fold(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // the card most of the hits are: single titles read "<card> [<set>]" or "<card> (Foil) [<set>]",
  // so the part before the first bracket names the card; null unless one name covers at
  // least two hits and half the list, or when it is just what was typed
  function cardName(list) {
    var n = {}, best = '', bestN = 0;
    for (var i = 0; i < list.length; i++) {
      var t = String(list[i].title || '').split(/\s+[\[(]/)[0].trim();
      if (!t || !/[\[(]/.test(String(list[i].title || ''))) continue;
      n[t] = (n[t] || 0) + 1;
      if (n[t] > bestN) { bestN = n[t]; best = t; }
    }
    if (bestN < 2 || bestN * 2 < list.length || fold(best) === fold(q)) return null;
    return best;
  }

  function run(root) {
    suggest(q).then(function (list) { render(root, list, cardName(list)); });
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

  function cards(list) {
    var h = '<ul class="xg-sf__grid">';
    for (var i = 0; i < list.length; i++) {
      var p = list[i], im = img(p), pr = money(p);
      h += '<li class="xg-sf__item"><a class="xg-sf__card" href="' + esc(p.url || ('/products/' + p.handle)) + '">' +
        '<span class="xg-sf__pic">' + (im ? '<img src="' + esc(im) + '" alt="" loading="lazy">' : '') + '</span>' +
        '<span class="xg-sf__title">' + esc(p.title) + '</span>' +
        (pr ? '<span class="xg-sf__price">' + esc(pr) + '</span>' : '') +
        '</a></li>';
    }
    return h + '</ul>';
  }

  function render(root, list, name) {
    if (document.querySelector('.xg-sf')) return;
    var all = '/search?q=' + encodeURIComponent(q) + '&type=product';
    var h = '<section class="xg-sf" aria-label="Results from the store search">';
    if (name) {
      var appq = '/a/search?type=product&q=' + encodeURIComponent(name);
      h += '<h2 class="xg-sf__h xg-sf__h--card">Did you mean <a class="xg-sf__mean" href="' + esc(appq) + '">' + esc(name) + '</a>?</h2>';
      h += cards(list);
      h += '<a class="xg-sf__all" href="' + esc(appq) + '">See every listing of &ldquo;' + esc(name) + '&rdquo; &rsaquo;</a> ' +
        '<a class="xg-sf__all xg-sf__all--2" href="' + esc(all) + '">All results for &ldquo;' + esc(q) + '&rdquo; &rsaquo;</a>';
    } else if (list.length) {
      h += '<h2 class="xg-sf__h">Nothing matched &ldquo;' + esc(q) + '&rdquo; word for word. Our store search found these:</h2>';
      h += cards(list);
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
      '.xg-sf__h--card{font-size:20px}.xg-sf__mean{text-decoration:underline;color:inherit}' +
      '.xg-sf__all--2{margin-left:18px;font-weight:600;opacity:.85}' +
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
