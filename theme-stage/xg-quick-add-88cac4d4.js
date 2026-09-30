/* Quick add on product cards — the New Today circular button, rolled out to
   every theme card that already has an in-place add (.nm-addToCart): homepage
   singles tabs + preorder/sports rows, collection grids, search results,
   related products. Cards WITHOUT it — sold out, multi-variant specialblock
   ("Select"→PDP), event tickets, sidebar/menu minis — get no button, so the
   theme's own routing decisions stand.

   Buttons are injected (not Liquid-rendered) because the search app and
   collection filters re-render card HTML client-side; a debounced
   MutationObserver re-applies and one delegated click listener serves every
   button, original or cloned. Variant id is read at CLICK time from the
   card's condition dropdown, falling back to the theme's hidden
   input[name="prduct-variant"] (typo is the theme's), so condition changes
   are honored without trusting the legacy unscoped value-match sync. */
(function () {
  if (window.__xgQuickAdd) return;
  window.__xgQuickAdd = 1;
  if (!window.fetch) return;

  var IC_CART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.2 11.2a1.7 1.7 0 0 0 1.7 1.4h7.9a1.7 1.7 0 0 0 1.7-1.4L20 8H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="16.5" cy="20" r="1.4"/><path d="M13 10v4"/><path d="M11 12h4"/></svg>';
  var IC_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';

  var css = '' +
    /* .grid-view-item__image-wrapper is position:relative + overflow:hidden
       everywhere (theme.css), so the button must stay fully inset. Bottom-
       right is free on all card snippets: sale flag sits top-left, stock
       overlays top-right, .thumbnail-buttons at the card's own bottom edge. */
    '.xg-qa{position:absolute;right:8px;bottom:8px;z-index:3;width:34px;height:34px;display:inline-flex;' +
      'align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;cursor:pointer;' +
      'background:var(--xg-red,#d62c28);color:#fff;box-shadow:0 2px 10px rgba(23,27,29,.35);' +
      'transition:transform 120ms ease,background 120ms ease,opacity 120ms ease}' +
    '.xg-qa:hover{background:var(--xg-red-hover,#b3211e);transform:scale(1.06)}' +
    '.xg-qa.is-added{background:var(--xg-success,#17784a)}' +
    '.xg-qa.is-out{background:#8a9299;font-size:18px;line-height:1}' +
    '.xg-qa[data-busy]{pointer-events:none}' +
    '.xg-qa[data-busy]:not(.is-added):not(.is-out){opacity:.55}' +
    /* Desktop: fade in with the card hover, like the theme's own button row;
       touch keeps it visible. */
    '@media (hover:hover){.grid-view-item .xg-qa{opacity:0}' +
      '.grid-view-item:hover .xg-qa,.xg-qa:focus-visible,.xg-qa[data-busy]{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.xg-qa{transition:none}.xg-qa:hover{transform:none}}' +
    /* One add-to-cart per card (owner, 2026-09-30: "Two add to cart buttons on card
       viewing"): where this button is on the picture, the theme's own cart button in
       the row under the card (.product-block-hover) is hidden; the row keeps quick view
       and the wishlist heart. The hidden form is still what the variant id is read from
       (!important: the theme shows the row's blocks with its own !important rule). */
    '.grid-view-item.xg-has-qa .thumbnail-buttons .product-block-hover{display:none!important}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function cardOf(el) {
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('grid-view-item')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function variantIdOf(card) {
    var dd = card.querySelector('select[data-dropdown-id="productSelect-dropdown"]');
    if (dd && !dd.disabled && dd.value) return dd.value;
    var inp = card.querySelector('.nm-cartmain input[name="prduct-variant"]');
    return (inp && inp.value) || '';
  }

  function apply() {
    var wraps = document.querySelectorAll('.grid-view-item .grid-view-item__image-wrapper');
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i];
      if (w.querySelector('.xg-qa')) continue;
      var card = cardOf(w);
      if (!card) continue;
      // The theme's own in-place add is the eligibility signal.
      if (!card.querySelector('a.nm-addToCart')) continue;
      if (!variantIdOf(card)) continue;
      var name = '';
      var t = card.querySelector('.grid-view-item__title');
      if (t) name = (t.textContent || '').replace(/\s+/g, ' ').trim();
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xg-qa';
      b.setAttribute('aria-label', name ? 'Add ' + name + ' to cart' : 'Add to cart');
      b.setAttribute('title', 'Add to cart');
      b.innerHTML = IC_CART;
      w.appendChild(b);
      card.classList.add('xg-has-qa');
    }
  }

  function quickAdd(b) {
    if (b.getAttribute('data-busy')) return;
    var card = cardOf(b);
    var vid = card ? +variantIdOf(card) : 0;
    if (!vid) return;
    b.setAttribute('data-busy', '1');
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: vid, quantity: 1 }] })
    }).then(function (r) {
      if (!r.ok) throw new Error('add ' + r.status);
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      try {
        var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown;
        if (typeof sync === 'function') sync();
      } catch (err) {}
      try {
        var it = j && j.items && j.items[0];
        if (it && window.xgCartPeek) {
          window.xgCartPeek({ title: it.title, image: it.image, url: it.url, qty: it.quantity, cents: it.discounted_price });
        }
      } catch (err) {}
      b.classList.add('is-added');
      b.innerHTML = IC_CHECK;
      setTimeout(function () {
        b.classList.remove('is-added');
        b.innerHTML = IC_CART;
        b.removeAttribute('data-busy');
      }, 1600);
    }).catch(function () {
      // Usually 422 — the shown condition just sold out. The card link stays.
      b.classList.add('is-out');
      b.innerHTML = '&times;';
      b.setAttribute('title', 'Just sold - open the card for other options');
      setTimeout(function () {
        b.classList.remove('is-out');
        b.innerHTML = IC_CART;
        b.removeAttribute('data-busy');
      }, 2200);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.xg-qa') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    quickAdd(b);
  });

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; apply(); }, 250);
  }

  function init() {
    apply();
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    } else {
      setTimeout(apply, 1500);
      setTimeout(apply, 4000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
