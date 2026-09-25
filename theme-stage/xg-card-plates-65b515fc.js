/* Card plates - dark mode only (owner, 2026-09-25, Blood Bowl collection in
   dark mode: "backgrounds, can they be more of a blur, so there is less
   white?"). Product photos carry a white ground baked into the JPG, so every
   card showed a white square on the dark page.

   For each product-card photo: redraw it small on a canvas, flood-fill the
   near-white ground inward from the border (white INSIDE the product - box
   art lettering, a white miniature - does not touch the border and
   survives), and hand the result to CSS twice:
   - as a mask on the <img> itself (--xg-plate-mask), so the ground turns
     transparent and the product sits straight on the card;
   - as a tiny canvas of the cut-out product placed behind the photo
     (.xg-plate-halo), which CSS blurs into a soft glow of the product's own
     colours.
   Nothing about the <img> src changes, and every rule lives under
   html[data-xg-theme="dark"], so light mode is exactly as served.

   Skipped: trading-card singles (.card - white-bordered scans would lose
   their border), photos whose border is not mostly white (scene shots), a
   ground under 4% or over 90% of the frame (nothing to cut / the product is
   itself white), and any image the canvas cannot read (CORS). */
(function () {
  'use strict';
  try {
    var SEL = '.grid-view-item__image-wrapper .image-inner img';
    var WHITE = 242;          // min(r,g,b) at or above this ...
    var SPREAD = 14;          // ... with max-min at or below this = ground
    var RIM_MIN = 150;        // rim pixels this light are a blend with the ground
    var WORK = 520;           // working size (long side, px) - the card photos are 370x480, so full size
    var HALO = 56;            // halo canvas size (long side, px)
    var MIN_GROUND = 0.04, MAX_GROUND = 0.9;

    var root = document.documentElement;
    var queue = [], busy = false;

    function isDark() { return root.getAttribute('data-xg-theme') === 'dark'; }

    function idle(fn) {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 800 });
      else setTimeout(fn, 30);
    }

    function eligible(img) {
      if (!img || img.tagName !== 'IMG' || !img.matches || !img.matches(SEL)) return false;
      if (img.closest('.card')) return false;
      return true;
    }

    function srcOf(img) { return img.currentSrc || img.src || ''; }

    function fetchImage(src, bust, cb) {
      try {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { cb(im); };
        im.onerror = function () { cb(null); };
        im.src = bust ? src + (src.indexOf('?') > -1 ? '&' : '?') + 'xgp=1' : src;
      } catch (e) { cb(null); }
    }

    function draw(im) {
      var nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) return null;
      var s = Math.min(1, WORK / Math.max(nw, nh));
      var w = Math.max(1, Math.round(nw * s)), h = Math.max(1, Math.round(nh * s));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0, w, h);
      try { return { c: c, ctx: ctx, w: w, h: h, data: ctx.getImageData(0, 0, w, h) }; }
      catch (e) { return null; }   // tainted
    }

    function load(src, cb) {
      fetchImage(src, false, function (im) {
        var r = im && draw(im);
        if (r) { cb(r); return; }
        // A copy cached earlier without CORS headers taints the canvas: one
        // more fetch past the cache, then give up.
        fetchImage(src, true, function (im2) { cb(im2 && draw(im2)); });
      });
    }

    function isGround(d, k) {
      var r = d[k], g = d[k + 1], b = d[k + 2];
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      return d[k + 3] < 16 || (mn >= WHITE && mx - mn <= SPREAD);
    }

    /* Alpha per pixel (Uint8ClampedArray), or null when there is nothing
       sensible to cut. */
    function cut(d, w, h) {
      var n = w * h, x, y, p, border = 0, white = 0;
      for (x = 0; x < w; x++) { border += 2; white += isGround(d, x * 4) + isGround(d, ((h - 1) * w + x) * 4); }
      for (y = 1; y < h - 1; y++) { border += 2; white += isGround(d, y * w * 4) + isGround(d, (y * w + w - 1) * 4); }
      if (!border || white / border < 0.6) return null;

      var filled = new Uint8Array(n), stack = new Int32Array(n), sp = 0, count = 0;
      function seed(q) {
        if (filled[q] || !isGround(d, q * 4)) return;
        filled[q] = 1; stack[sp++] = q; count++;
      }
      for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (sp) {
        p = stack[--sp];
        x = p % w; y = (p - x) / w;
        if (x > 0) seed(p - 1);
        if (x < w - 1) seed(p + 1);
        if (y > 0) seed(p - w);
        if (y < h - 1) seed(p + w);
      }
      var frac = count / n;
      if (frac < MIN_GROUND || frac > MAX_GROUND) return null;

      // Eat into the anti-aliased / JPEG-smeared edge: two rings of light
      // pixels next to the ground join it (they are mostly white blend).
      function grow(min) {
        var add = [], q, k;
        for (q = 0; q < n; q++) {
          if (filled[q]) continue;
          x = q % w; y = (q - x) / w;
          if (!((x > 0 && filled[q - 1]) || (x < w - 1 && filled[q + 1]) ||
                (y > 0 && filled[q - w]) || (y < h - 1 && filled[q + w]))) continue;
          k = q * 4;
          if (Math.min(d[k], d[k + 1], d[k + 2]) >= min) add.push(q);
        }
        for (q = 0; q < add.length; q++) filled[add[q]] = 1;
      }
      grow(170);
      grow(205);

      var alpha = new Uint8ClampedArray(n);
      for (p = 0; p < n; p++) {
        if (filled[p]) continue;
        x = p % w; y = (p - x) / w;
        var rim = (x > 0 && filled[p - 1]) || (x < w - 1 && filled[p + 1]) ||
                  (y > 0 && filled[p - w]) || (y < h - 1 && filled[p + w]);
        if (rim) {
          var k = p * 4, mn = Math.min(d[k], d[k + 1], d[k + 2]);
          // Anti-aliased edge blended with white: coverage = 1 - min/255.
          alpha[p] = mn >= RIM_MIN ? Math.round((1 - mn / 255) * 255 * 2.2) : 255;
        } else alpha[p] = 255;
      }
      return alpha;
    }

    function fitOf(img) {
      var f = '';
      try { f = getComputedStyle(img).objectFit; } catch (e) {}
      return f === 'cover' ? 'cover' : (f === 'contain' || f === 'scale-down') ? 'contain' : '100% 100%';
    }

    function plateOf(img) { return img.closest('.image-inner') || img.parentElement; }

    function apply(img, src, r, alpha) {
      var w = r.w, h = r.h, n = w * h, p;
      // Mask: black with the cut alpha.
      var m = document.createElement('canvas');
      m.width = w; m.height = h;
      var mctx = m.getContext('2d'), md = mctx.createImageData(w, h);
      for (p = 0; p < n; p++) md.data[p * 4 + 3] = alpha[p];
      mctx.putImageData(md, 0, 0);
      // Cut-out colours for the halo.
      var cd = r.data.data;
      for (p = 0; p < n; p++) cd[p * 4 + 3] = alpha[p];
      r.ctx.putImageData(r.data, 0, 0);
      var s = HALO / Math.max(w, h);
      var halo = document.createElement('canvas');
      halo.width = Math.max(1, Math.round(w * s)); halo.height = Math.max(1, Math.round(h * s));
      halo.getContext('2d').drawImage(r.c, 0, 0, halo.width, halo.height);
      halo.className = 'xg-plate-halo';
      halo.setAttribute('aria-hidden', 'true');

      m.toBlob(function (blob) {
        if (!blob || srcOf(img) !== src) return;
        var url = URL.createObjectURL(blob);
        var fit = fitOf(img);
        img.style.setProperty('--xg-plate-mask', 'url("' + url + '")');
        img.style.setProperty('--xg-plate-fit', fit);
        img.classList.add('xg-plate-img');
        var plate = plateOf(img);
        if (plate && !img.classList.contains('extra-img')) {
          var old = plate.querySelector(':scope > .xg-plate-halo');
          if (old) old.parentNode.removeChild(old);
          halo.style.objectFit = fit === '100% 100%' ? 'fill' : fit;
          plate.insertBefore(halo, plate.firstChild);
          plate.classList.add('xg-plate');
        }
      }, 'image/png');
    }

    function next() {
      if (!queue.length) { busy = false; return; }
      busy = true;
      var img = queue.shift();
      var src = srcOf(img);
      if (!isDark() || !src || img.getAttribute('data-xg-plate') === src || !img.isConnected) { next(); return; }
      img.setAttribute('data-xg-plate', src);
      load(src, function (r) {
        idle(function () {
          try {
            var alpha = r && cut(r.data.data, r.w, r.h);
            if (alpha) apply(img, src, r, alpha);
          } catch (e) {}
          next();
        });
      });
    }

    function consider(img) {
      if (!eligible(img)) return;
      if (!img.complete || !img.naturalWidth) return;   // the load listener picks it up
      if (img.getAttribute('data-xg-plate') === srcOf(img)) return;
      queue.push(img);
      if (!busy) next();
    }

    function scan() {
      if (!isDark()) return;
      var list = document.querySelectorAll(SEL);
      for (var i = 0; i < list.length; i++) consider(list[i]);
    }

    // Every image load on the page (capture: load does not bubble) - covers
    // lazy images and the search app's re-rendered cards.
    document.addEventListener('load', function (e) {
      if (isDark() && e.target && e.target.tagName === 'IMG') consider(e.target);
    }, true);

    var t = 0;
    function soon() { clearTimeout(t); t = setTimeout(scan, 200); }
    if (window.MutationObserver) {
      new MutationObserver(soon).observe(document.body || root, { childList: true, subtree: true });
      new MutationObserver(soon).observe(root, { attributes: true, attributeFilter: ['data-xg-theme'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();
    window.addEventListener('load', scan);
  } catch (e) {}
})();
