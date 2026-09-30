/* Sharp product pictures on high-density screens (owner, 2026-09-30: "do you know why
   the popup is clearer than the search result image?" - the grid asks Shopify's CDN for
   a 370px rendition and a 125-200% Windows display stretches it; our card-peek popup
   asks for 640px and is crisp).

   On a screen with a device pixel ratio above 1, every <img> from the Shopify CDN whose
   address names a small rendition (_370x480, _300x300, _148x, ?width=320 ...) and that
   has no srcset of its own gets a 2x rendition in a srcset (same address, twice the
   width; height and crop dropped so the ratio stays natural). The browser then picks
   the sharp one. Covers the search app's own cards (drawn after load: a MutationObserver
   catches them) and any theme snippet that still sends one size. Nothing changes on 1x
   screens or for images already carrying a srcset. Renditions up to 600px wide are
   treated as "small"; larger ones are left alone. */
(function () {
  'use strict';
  var dpr = window.devicePixelRatio || 1;
  if (dpr <= 1.05) return;
  var MAX_SMALL = 600;

  function isCdn(u) { return /^(https?:)?\/\/[^/]*\/cdn\/shop\/(products|files)\//i.test(u) || /^https?:\/\/cdn\.shopify\.com\//i.test(u); }

  // {src2x} for a small rendition, null when the address names none or a large one
  function twice(src) {
    try {
      if (!src || !isCdn(src)) return null;
      var path = src, q = '', i = src.indexOf('?');
      if (i > -1) { path = src.slice(0, i); q = src.slice(i); }
      var wm = q.match(/[?&]width=(\d+)/i);
      if (wm) {
        var w = parseInt(wm[1], 10);
        if (!(w > 0 && w <= MAX_SMALL)) return null;
        q = q.replace(/([?&])width=\d+/i, '$1width=' + (w * 2)).replace(/&(height|crop)=[^&]*/gi, '').replace(/\?(height|crop)=[^&]*&?/i, '?').replace(/[?&]$/, '');
        return path + q;
      }
      var m = path.match(/^(.*?)_(\d+)x(\d*)(?:_crop_(?:top|center|bottom|left|right))?(\.[a-z0-9]{2,5})$/i);
      if (m) {
        var pw = parseInt(m[2], 10), ph = m[3] ? parseInt(m[3], 10) : 0;
        if (!(pw > 0 && pw <= MAX_SMALL)) return null;
        return m[1] + '_' + (pw * 2) + 'x' + (ph ? ph * 2 : '') + m[4] + q;
      }
      var m2 = path.match(/^(.*?)_x(\d+)(\.[a-z0-9]{2,5})$/i);
      if (m2) {
        var hh = parseInt(m2[2], 10);
        if (!(hh > 0 && hh <= MAX_SMALL)) return null;
        return m2[1] + '_x' + (hh * 2) + m2[3] + q;
      }
      return null;
    } catch (e) { return null; }
  }

  function sharpen(img) {
    if (img.__xgSharp) return;
    if (img.getAttribute('srcset') || img.getAttribute('data-srcset')) { img.__xgSharp = 1; return; }
    var src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    var big = twice(src);
    if (!big) return;
    img.__xgSharp = 1;
    img.setAttribute('srcset', src + ' 1x, ' + big + ' 2x');
    if (!img.getAttribute('sizes')) img.setAttribute('sizes', 'auto');
  }

  function sweep(root) {
    var list = (root && root.querySelectorAll) ? root.querySelectorAll('img') : [];
    for (var i = 0; i < list.length; i++) sharpen(list[i]);
    if (root && root.tagName === 'IMG') sharpen(root);
  }

  function start() {
    sweep(document);
    if (!('MutationObserver' in window)) return;
    var pending = false;
    new MutationObserver(function (muts) {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes') { if (m.target.tagName === 'IMG') { m.target.__xgSharp = 0; sharpen(m.target); } continue; }
          for (var k = 0; k < m.addedNodes.length; k++) if (m.addedNodes[k].nodeType === 1) sweep(m.addedNodes[k]);
        }
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
