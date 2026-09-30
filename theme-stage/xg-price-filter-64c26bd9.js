/* Price filter without prices (owner, 2026-09-30: "I would like to remove the prices in
   there, I dont want it to be prefilled with our highest price item just go from
   0-$100,000 if they type it in. I dont need the sliding bar").

   The Cloud Search sidebar's Price block prints the collection's cheapest and dearest
   item as the placeholders of its Min / Max fields (3.95 and 299.95 on Board Games) and
   again as the ends of a slider. This hides the slider with its two prices and makes
   the empty fields read 0 and 100,000 instead, on every page the app draws its sidebar
   (collections, /a/search, the mobile filter drawer). Whatever the shopper types stays
   theirs; the app still does the filtering. A MutationObserver covers blocks the app
   draws or redraws later (it rebuilds the sidebar after each filter change). */
(function () {
  'use strict';
  var MIN = '0', MAX = '100,000';
  var SEL = 'input[aria-label="Min price"], input[aria-label="Max price"], .cloud-search-num-field__input';

  function fix(input) {
    var label = (input.getAttribute('aria-label') || '').toLowerCase();
    var want = /max/.test(label) ? MAX : /min/.test(label) ? MIN : '';
    if (!want) return;
    if (input.getAttribute('placeholder') !== want) input.setAttribute('placeholder', want);
  }
  function sweep(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'INPUT') fix(root);
    var list = root.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) fix(list[i]);
  }

  function start() {
    var style = document.createElement('style');
    style.id = 'xg-price-filter-css';
    style.textContent = '.cloud-search-range-slider{display:none!important}' +
      '.cloud-search-range-inputs{margin-bottom:4px}';
    document.head.appendChild(style);
    sweep(document);
    if (!('MutationObserver' in window)) return;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') { if (m.target.tagName === 'INPUT') fix(m.target); continue; }
        for (var n = 0; n < m.addedNodes.length; n++) if (m.addedNodes[n].nodeType === 1) sweep(m.addedNodes[n]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['placeholder'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
