/* Placeholder price mask (owner 2026-10-01: "the 999,999 should not show in the
   search ... should not show in you may also like"). Custom and not-yet-priced
   listings carry $999,999.00 as their price in Shopify. The theme's own price
   snippet already prints "Please Contact For $$ Pricing" for it, but the
   search app's instant results, its result grid, the theme's autocomplete and
   the "You may also like" strip print the raw figure. This swaps that figure
   for "Contact us for price" wherever it appears as text, now and whenever the
   page adds nodes (the search dropdown, lazy rows, carousels). Inputs,
   scripts and styles are never touched. */
(function () {
  'use strict';
  if (window.xgPriceMask) return;
  window.xgPriceMask = true;
  var LABEL = 'Contact us for price';
  // "$999,999.00", "From $999,999.00", "CA$999,999.00 CAD", and a
  // "$999,999.00 - $999,999.00" range, as one match
  var RE = /(?:from\s+)?(?:[A-Z]{1,3}\s?)?\$\s?999,999(?:\.00)?(?:\s?CAD)?(?:\s*[-–]\s*(?:[A-Z]{1,3}\s?)?\$\s?999,999(?:\.00)?(?:\s?CAD)?)?/gi;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };

  function fixText(node) {
    var s = node.nodeValue;
    if (!s || s.indexOf('999,999') < 0) return;
    var p = node.parentNode;
    if (p && SKIP[p.nodeName]) return;
    var out = s.replace(RE, LABEL);
    if (out !== s) node.nodeValue = out;
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && SKIP[root.nodeName]) return;
    var it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, list = [];
    while ((n = it.nextNode())) if (n.nodeValue && n.nodeValue.indexOf('999,999') >= 0) list.push(n);
    for (var i = 0; i < list.length; i++) fixText(list[i]);
  }

  var pending = null, queue = [];
  function flush() {
    pending = null;
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) walk(q[i]);
  }
  function schedule(n) {
    queue.push(n);
    if (!pending) pending = (window.requestAnimationFrame || setTimeout)(flush);
  }

  function start() {
    walk(document.body);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') schedule(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) schedule(m.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
