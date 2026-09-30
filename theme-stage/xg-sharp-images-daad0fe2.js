/* Sharp product pictures (owner, 2026-09-30: "do you know why the popup is clearer than
   the search result image?" -> "still blurry": the search app's grid asked Shopify's CDN
   for the "_small" rendition of CLUE HOME ALONE - 100x100 pixels - and drew it in a
   207x300 box; other cards get a 370px rendition that a 125-200% Windows display still
   has to stretch. Our card-peek popup asks for 640px and is crisp).

   Every <img> from the Shopify CDN whose address names a rendition (a numeric _370x480,
   _300x, _x200, ?width=320, or a named _small / _medium / _large ...) and that carries
   no srcset of its own is checked against the box it is drawn in: when the rendition is
   narrower than the box times the screen's device pixel ratio, the address is rewritten
   to the next step up (370, 480, 600, 740, 960, 1200, 1480 pixels wide; height and crop
   dropped so the ratio stays natural) and set as the src. A picture that is already big
   enough is left alone, so a 1x screen keeps its 370px files. A MutationObserver covers
   pictures added later (the search app's cards, the card finder). */
(function () {
  'use strict';
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var STEPS = [370, 480, 600, 740, 960, 1200, 1480];
  var NAMED = { pico: 16, icon: 32, thumb: 50, small: 100, compact: 160, medium: 240, large: 480, grande: 600 };

  function isCdn(u) { return /^(https?:)?\/\/[^/]*\/cdn\/shop\/(products|files)\//i.test(u) || /^https?:\/\/cdn\.shopify\.com\//i.test(u); }

  // {width, make(targetWidth)} for an address naming a rendition, null otherwise
  function rendition(src) {
    try {
      if (!src || !isCdn(src)) return null;
      var path = src, q = '', i = src.indexOf('?');
      if (i > -1) { path = src.slice(0, i); q = src.slice(i); }
      var wm = q.match(/[?&]width=(\d+)/i);
      if (wm) {
        var w = parseInt(wm[1], 10);
        if (!(w > 0)) return null;
        return { width: w, make: function (t) {
          return path + q.replace(/([?&])width=\d+/i, '$1width=' + t).replace(/&(height|crop)=[^&]*/gi, '').replace(/\?(height|crop)=[^&]*&?/i, '?').replace(/[?&]$/, '');
        } };
      }
      var m = path.match(/^(.*?)_(\d+)x(\d*)(?:_crop_(?:top|center|bottom|left|right))?(@[23]x)?(\.[a-z0-9]{2,5})$/i);
      if (m) {
        var pw = parseInt(m[2], 10), ph = m[3] ? parseInt(m[3], 10) : 0, scale = m[4] ? parseInt(m[4].charAt(1), 10) : 1;
        if (!(pw > 0)) return null;
        return { width: pw * scale, make: function (t) { return m[1] + '_' + t + 'x' + (ph ? Math.round(ph * t / pw) : '') + m[5] + q; } };
      }
      var m2 = path.match(/^(.*?)_x(\d+)(\.[a-z0-9]{2,5})$/i);
      if (m2) {
        var hh = parseInt(m2[2], 10);
        if (!(hh > 0)) return null;
        return { width: hh, make: function (t) { return m2[1] + '_' + t + 'x' + m2[3] + q; } };
      }
      var m3 = path.match(/^(.*?)_(pico|icon|thumb|small|compact|medium|large|grande)(?:_crop_(?:top|center|bottom|left|right))?(@[23]x)?(\.[a-z0-9]{2,5})$/i);
      if (m3) {
        var nw = NAMED[m3[2].toLowerCase()] * (m3[3] ? parseInt(m3[3].charAt(1), 10) : 1);
        return { width: nw, make: function (t) { return m3[1] + '_' + t + 'x' + m3[4] + q; } };
      }
      return null;
    } catch (e) { return null; }
  }

  function boxWidth(img) {
    var w = img.getBoundingClientRect().width;
    if (!w && img.parentElement) w = img.parentElement.getBoundingClientRect().width;
    return w || 0;
  }

  function sharpen(img) {
    if (img.getAttribute('srcset') || img.getAttribute('data-srcset')) return;
    var attr = img.getAttribute('src') ? 'src' : (img.getAttribute('data-src') ? 'data-src' : '');
    if (!attr) return;
    var src = img.getAttribute(attr);
    if (src === img.__xgSet) return;
    var r = rendition(src);
    if (!r) return;
    var box = boxWidth(img);
    if (!box) return;                       // not laid out yet: the observer sees it again when it changes
    var need = Math.ceil(box * dpr);
    if (r.width >= need) return;
    var target = 0;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= need) { target = STEPS[i]; break; }
    if (!target) target = STEPS[STEPS.length - 1];
    if (target <= r.width) return;
    var next = r.make(target);
    if (!next || next === src) return;
    img.__xgSet = next;
    img.setAttribute(attr, next);
    if (attr === 'data-src' && img.getAttribute('src') === src) img.setAttribute('src', next);
  }

  function sweep(root) {
    var list = (root && root.querySelectorAll) ? root.querySelectorAll('img') : [];
    for (var i = 0; i < list.length; i++) sharpen(list[i]);
    if (root && root.tagName === 'IMG') sharpen(root);
  }

  function start() {
    sweep(document);
    if (!('MutationObserver' in window)) return;
    var pending = false, queue = [];
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) queue.push(muts[i]);
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        var q = queue; queue = [];
        for (var k = 0; k < q.length; k++) {
          var m = q[k];
          if (m.type === 'attributes') { if (m.target.tagName === 'IMG') sharpen(m.target); continue; }
          for (var n = 0; n < m.addedNodes.length; n++) if (m.addedNodes[n].nodeType === 1) sweep(m.addedNodes[n]);
        }
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
    // lazy pictures get their size once they are laid out
    window.addEventListener('load', function () { sweep(document); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
