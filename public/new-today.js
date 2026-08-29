/* New Today strip — storefront homepage. A theme section drops
   <div id="xg-newtoday"> and loads this file from the worker, so the theme
   side stays a shell and updates ship via git push.

   Data: the same webhook-verified daily-arrivals feed the in-store TVs run
   on (/cards.json?nt=1 — genuine restocks and set drops, topped up with a
   rotating sample on slow days). If the feed is empty or unreachable the
   section removes itself entirely — the homepage never shows a bare
   heading.

   Each tile carries a quick-add button (cart-with-plus over the art) that
   posts the card's feed variantId to /cart/add.js and hands header/mini-
   cart refresh to the theme's own adjustCartDropDown(). */
(function () {
  var W = 'https://exor-binder.nevski.workers.dev';
  var root = document.getElementById('xg-newtoday');
  if (!root || root.getAttribute('data-xg-ready')) return;
  root.setAttribute('data-xg-ready', '1');

  function attr(n, d) { var v = root.getAttribute(n); return (v == null || v === '') ? d : v; }
  var TITLE = attr('data-title', 'New today');
  var SUB = attr('data-sub', 'Fresh singles on the shelf.');
  var COLLECTION = attr('data-collection', 'new-arrivals');
  var MAX = Math.max(4, Math.min(24, +attr('data-max', '16') || 16));

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function imgSrc(u) { return u ? (u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=320') : ''; }

  /* Quick add: cart-with-plus on the tile, check on success. Every feed card
     carries variantId (the in-stock variant matching the displayed price). */
  var IC_CART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.2 11.2a1.7 1.7 0 0 0 1.7 1.4h7.9a1.7 1.7 0 0 0 1.7-1.4L20 8H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="16.5" cy="20" r="1.4"/><path d="M13 10v4"/><path d="M11 12h4"/></svg>';
  var IC_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';

  function quickAdd(btn) {
    if (btn.getAttribute('data-busy')) return;
    var vid = +btn.getAttribute('data-vid');
    if (!vid) return;
    btn.setAttribute('data-busy', '1');
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: vid, quantity: 1 }] })
    }).then(function (r) {
      if (!r.ok) throw new Error('add ' + r.status);
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      // The theme's own sync (exported on purpose in shop.js) refreshes both
      // header badges AND the mini-cart dropdown from a fresh /cart.js read.
      try {
        var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown;
        if (typeof sync === 'function') sync();
        else fetch('/cart.js').then(function (cr) { return cr.ok ? cr.json() : null; }).then(function (cart) {
          if (!cart) return;
          var q = document.querySelectorAll('.cart-qty');
          for (var i = 0; i < q.length; i++) q[i].textContent = cart.item_count;
        });
      } catch (err) {}
      // Site-wide cart peek (theme's xg-cart-peek.js), when it's loaded.
      try {
        var it = j && j.items && j.items[0];
        if (it && window.xgCartPeek) {
          window.xgCartPeek({ title: it.title, image: it.image, url: it.url, qty: it.quantity, cents: it.discounted_price });
        }
      } catch (err) {}
      btn.classList.add('is-added');
      btn.innerHTML = IC_CHECK;
      setTimeout(function () {
        btn.classList.remove('is-added');
        btn.innerHTML = IC_CART;
        btn.removeAttribute('data-busy');
      }, 1600);
    }).catch(function () {
      // Usually 422: the feed is edge-cached ~10 min, so a single can sell
      // out between render and click. The tile link stays the way in.
      btn.classList.add('is-out');
      btn.innerHTML = '&times;';
      btn.setAttribute('title', 'Just sold - tap the card for other options');
      setTimeout(function () {
        btn.classList.remove('is-out');
        btn.innerHTML = IC_CART;
        btn.removeAttribute('data-busy');
      }, 2200);
    });
  }

  fetch(W + '/cards.json?collection=' + encodeURIComponent(COLLECTION) + '&nt=1')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var cards = (j && j.cards) || [];
      if (!cards.length) { if (root.parentNode) root.parentNode.removeChild(root); return; }
      cards = cards.slice(0, MAX);

      var css = '' +
        '#xg-newtoday{max-width:1280px;margin:0 auto;padding:34px 16px 10px;font-family:var(--xg-font-body,"Inter",sans-serif)}' +
        '#xg-newtoday a{text-decoration:none}' +
        '#xg-newtoday .xg-nt__head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 14px}' +
        '#xg-newtoday .xg-nt__title{font-family:var(--xg-font-display,"Oswald","Arial Narrow",sans-serif);font-size:clamp(22px,3vw,30px);font-weight:700;text-transform:uppercase;letter-spacing:.01em;color:var(--xg-ink,#171b1d);margin:0}' +
        '#xg-newtoday .xg-nt__sub{margin:3px 0 0;font-size:13.5px;color:#8a9299}' +
        '#xg-newtoday .xg-nt__nav{display:flex;gap:8px}' +
        '#xg-newtoday .xg-nt__btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--xg-border,#d7dbdf);background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);font-size:20px;line-height:1;cursor:pointer}' +
        '#xg-newtoday .xg-nt__btn:hover{border-color:var(--xg-red,#d62c28);color:var(--xg-red,#d62c28)}' +
        '#xg-newtoday .xg-nt__strip{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 14px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}' +
        // overflow:hidden zeroes the flex min-size so long names/sets ellipsize
        // instead of widening the tile and tearing a gap in the strip
        '#xg-newtoday .xg-nt__card{flex:0 0 148px;width:148px;min-width:0;overflow:hidden;scroll-snap-align:start;display:flex;flex-direction:column}' +
        // The thumb wrapper owns the hover lift now, so the quick-add button
        // pinned to its corner rides along with the artwork.
        '#xg-newtoday .xg-nt__thumb{position:relative;display:block;width:148px;height:207px;margin:0 0 8px;transition:transform 140ms ease}' +
        '#xg-newtoday .xg-nt__img{display:block;width:148px;height:207px;object-fit:cover;border-radius:7px;background:#eef0f2;margin:0;border:0;box-shadow:0 4px 14px rgba(23,27,29,.10)}' +
        '#xg-newtoday .xg-nt__card:hover .xg-nt__thumb{transform:translateY(-3px)}' +
        '#xg-newtoday .xg-nt__add{position:absolute;right:7px;bottom:7px;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;background:var(--xg-red,#d62c28);color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(23,27,29,.4);transition:transform 120ms ease,background 120ms ease,opacity 120ms ease}' +
        '#xg-newtoday .xg-nt__add:hover{background:var(--xg-red-hover,#b3211e);transform:scale(1.06)}' +
        '#xg-newtoday .xg-nt__add.is-added{background:var(--xg-success,#17784a)}' +
        '#xg-newtoday .xg-nt__add.is-out{background:#8a9299;font-size:18px;line-height:1}' +
        // Desktop: the button fades in on hover/focus; touch keeps it visible.
        '@media (hover:hover){#xg-newtoday .xg-nt__add{opacity:0}#xg-newtoday .xg-nt__card:hover .xg-nt__add,#xg-newtoday .xg-nt__add:focus-visible,#xg-newtoday .xg-nt__add[data-busy]{opacity:1}}' +
        '#xg-newtoday .xg-nt__add[data-busy]{pointer-events:none}' +
        '#xg-newtoday .xg-nt__add[data-busy]:not(.is-added):not(.is-out){opacity:.55}' +
        '#xg-newtoday .xg-nt__name{font-size:13.5px;font-weight:600;color:var(--xg-ink,#171b1d);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
        '#xg-newtoday .xg-nt__meta{font-size:11.5px;color:#8a9299;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '#xg-newtoday .xg-nt__price{font-size:14px;font-weight:700;color:var(--xg-red,#d62c28);margin-top:3px}' +
        '@media (prefers-reduced-motion:reduce){#xg-newtoday .xg-nt__thumb,#xg-newtoday .xg-nt__add{transition:none}#xg-newtoday .xg-nt__card:hover .xg-nt__thumb{transform:none}#xg-newtoday .xg-nt__add:hover{transform:none}}' +
        '@media (max-width:640px){#xg-newtoday .xg-nt__nav{display:none}}';
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

      root.className = (root.className + ' xg-nt').trim();
      root.innerHTML =
        '<div class="xg-nt__head"><div>' +
          '<h2 class="xg-nt__title">' + esc(TITLE) + '</h2>' +
          '<p class="xg-nt__sub">' + esc(SUB) + '</p>' +
        '</div>' +
        '<div class="xg-nt__nav">' +
          '<button type="button" class="xg-nt__btn" data-d="-1" aria-label="Scroll back">&lsaquo;</button>' +
          '<button type="button" class="xg-nt__btn" data-d="1" aria-label="Scroll forward">&rsaquo;</button>' +
        '</div></div>' +
        '<div class="xg-nt__strip" id="xg-nt-strip">' + cards.map(function (c) {
          var meta = [c.set, c.foil ? 'Foil' : '', c.condition].filter(Boolean).join(' · ');
          return '<a class="xg-nt__card" href="' + esc(c.url) + '">' +
            '<span class="xg-nt__thumb">' +
              (c.image ? '<img class="xg-nt__img" src="' + esc(imgSrc(c.image)) + '" alt="' + esc(c.name) + '" loading="lazy">' : '<span class="xg-nt__img"></span>') +
              (c.variantId ? '<button type="button" class="xg-nt__add" data-vid="' + esc(c.variantId) + '" aria-label="Add ' + esc(c.name) + ' to cart" title="Add to cart">' + IC_CART + '</button>' : '') +
            '</span>' +
            '<span class="xg-nt__name">' + esc(c.name) + '</span>' +
            (meta ? '<span class="xg-nt__meta">' + esc(meta) + '</span>' : '') +
            '<span class="xg-nt__price">$' + esc(c.price) + '</span>' +
          '</a>';
        }).join('') + '</div>';

      var strip = document.getElementById('xg-nt-strip');
      root.addEventListener('click', function (e) {
        var add = e.target && e.target.closest ? e.target.closest('.xg-nt__add') : null;
        if (add) {
          // The whole tile is an <a> - keep the tap on the button.
          e.preventDefault();
          e.stopPropagation();
          quickAdd(add);
          return;
        }
        var b = e.target && e.target.closest ? e.target.closest('.xg-nt__btn') : null;
        if (!b || !strip) return;
        strip.scrollBy({ left: (+b.getAttribute('data-d')) * Math.max(260, strip.clientWidth * 0.8), behavior: 'smooth' });
      });
    })
    .catch(function () { if (root.parentNode) root.parentNode.removeChild(root); });
})();
