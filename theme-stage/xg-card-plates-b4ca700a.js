/* Card plates - dark mode only (owner, 2026-09-25, Blood Bowl collection in
   dark mode: "backgrounds, can they be more of a blur, so there is less
   white?"). Product photos carry a white ground baked into the JPG, so every
   card showed a white square on the dark page.

   For each product-card photo, in dark mode: redraw it on a canvas, find the
   white ground, and swap the <img> to a transparent PNG of the product
   (a blob: URL; the original src/srcset are parked in data attributes and
   put back the moment the page goes light). Behind it sits a tiny canvas
   of the cut-out product that CSS blurs into a soft glow of its own
   colours (.xg-plate-halo).

   Finding the ground (round 2, after the owner's Vallejo screenshot showed a
   ragged light fringe, a white paint swatch eaten and grey caption text
   lost on the dark card):
   - near-white pixels are candidates; the candidate area is eroded twice
     before the flood from the border and grown back afterwards, so a white
     swatch or label behind an outline with small gaps does not leak away;
   - the two pixel rings round the product are un-blended from white
     (coverage a = 1 - min/255, colour = (c - (1-a)*255) / a), so JPEG edges
     neither glow nor go jagged;
   - thin, low-saturation dark marks standing alone on the ground (captions,
     product codes) are redrawn in light grey, their darkness becoming their
     opacity, so they stay readable on the dark card.

   Skipped: trading-card singles (.card) and anything whose cut-out is a solid
   card-shaped rectangle (sports card scans), photos whose border is not mostly
   white (scene shots), a ground under 4% or over 90% of the frame, and any
   image the canvas cannot read (CORS). */
(function () {
  'use strict';
  try {
    var SEL = '.grid-view-item__image-wrapper .image-inner img';
    var WHITE = 236;          // min(r,g,b) at or above this ...
    var SPREAD = 20;          // ... with max-min at or below this = ground candidate
    var RIM_MIN = 110;        // rim pixels lighter than this (min channel) are un-blended
    var MAXSIDE = 800;        // longest side processed (card photos are 370x480)
    var HALO = 56;            // halo canvas size (long side, px)
    var MIN_GROUND = 0.04, MAX_GROUND = 0.9;
    var INK = [214, 220, 224];

    var root = document.documentElement;
    var queue = [], busy = false;
    var done = {};            // original src -> { url, halo } (url '' = leave as served)

    function isDark() { return root.getAttribute('data-xg-theme') === 'dark'; }

    function idle(fn) {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 800 });
      else setTimeout(fn, 30);
    }

    function eligible(img) {
      return !!(img && img.tagName === 'IMG' && img.matches && img.matches(SEL) && !img.closest('.card'));
    }

    function origOf(img) { return img.getAttribute('data-xg-plate-src') || img.currentSrc || img.src || ''; }

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
      var s = Math.min(1, MAXSIDE / Math.max(nw, nh));
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

    /* Pixel pass. Rewrites r.data in place (alpha + un-blended rim + lifted
       ink) and returns true, or false when there is nothing sensible to cut. */
    function cut(r) {
      var d = r.data.data, w = r.w, h = r.h, n = w * h, x, y, p, k, q, i;
      var cand = new Uint8Array(n);
      for (p = 0, k = 0; p < n; p++, k += 4) {
        var mn = Math.min(d[k], d[k + 1], d[k + 2]), mx = Math.max(d[k], d[k + 1], d[k + 2]);
        cand[p] = d[k + 3] < 16 || (mn >= WHITE && mx - mn <= SPREAD) ? 1 : 0;
      }
      var border = 0, white = 0;
      for (x = 0; x < w; x++) { border += 2; white += cand[x] + cand[(h - 1) * w + x]; }
      for (y = 1; y < h - 1; y++) { border += 2; white += cand[y * w] + cand[y * w + w - 1]; }
      if (!border || white / border < 0.6) return false;

      // Erode twice (4-neighbour; the frame edge counts as ground).
      function erode(src) {
        var out = new Uint8Array(n);
        for (p = 0; p < n; p++) {
          if (!src[p]) continue;
          x = p % w; y = (p - x) / w;
          out[p] = ((x === 0 || src[p - 1]) && (x === w - 1 || src[p + 1]) &&
                    (y === 0 || src[p - w]) && (y === h - 1 || src[p + w])) ? 1 : 0;
        }
        return out;
      }
      var core = erode(erode(cand));

      // Flood the eroded ground from the border.
      var filled = new Uint8Array(n), stack = new Int32Array(n), sp = 0;
      function seed(s) { if (core[s] && !filled[s]) { filled[s] = 1; stack[sp++] = s; } }
      for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (sp) {
        p = stack[--sp]; x = p % w; y = (p - x) / w;
        if (x > 0) seed(p - 1);
        if (x < w - 1) seed(p + 1);
        if (y > 0) seed(p - w);
        if (y < h - 1) seed(p + w);
      }
      // Grow back over the candidates the erosion took (two rings).
      for (i = 0; i < 2; i++) {
        var add = [];
        for (p = 0; p < n; p++) {
          if (filled[p] || !cand[p]) continue;
          x = p % w; y = (p - x) / w;
          if ((x > 0 && filled[p - 1]) || (x < w - 1 && filled[p + 1]) ||
              (y > 0 && filled[p - w]) || (y < h - 1 && filled[p + w])) add.push(p);
        }
        for (q = 0; q < add.length; q++) filled[add[q]] = 1;
      }
      var count = 0, bx0 = w, bx1 = -1, by0 = h, by1 = -1;
      for (p = 0; p < n; p++) {
        if (filled[p]) { count++; continue; }
        x = p % w; y = (p - x) / w;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      var frac = count / n;
      if (frac < MIN_GROUND || frac > MAX_GROUND) return false;
      // A trading card scan (sports cards and the like - the .card singles are
      // skipped already): what is left is a solid rectangle in card proportions.
      // Leave it as served: a white card border would be eaten with the ground.
      var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, ar = bw / bh;
      if ((n - count) / (bw * bh) >= 0.92 && ((ar >= 0.66 && ar <= 0.78) || (ar >= 1.28 && ar <= 1.52))) return false;

      // Distance (0 = ground, 1, 2 = rim rings, 3 = inside) for the un-blend.
      var dist = new Uint8Array(n);
      for (p = 0; p < n; p++) dist[p] = filled[p] ? 0 : 3;
      for (i = 1; i <= 2; i++) {
        var ring = [];
        for (p = 0; p < n; p++) {
          if (dist[p] !== 3) continue;
          x = p % w; y = (p - x) / w;
          if ((x > 0 && dist[p - 1] === i - 1) || (x < w - 1 && dist[p + 1] === i - 1) ||
              (y > 0 && dist[p - w] === i - 1) || (y < h - 1 && dist[p + w] === i - 1)) ring.push(p);
        }
        for (q = 0; q < ring.length; q++) dist[ring[q]] = i;
      }

      // Ink standing alone on the ground: connected non-ground components
      // that are small, sparse (text strokes, not a solid logo block) and
      // grey get lifted to light grey.
      var comp = new Uint8Array(n), inkA = new Uint8Array(n);
      for (p = 0; p < n; p++) {
        if (filled[p] || comp[p]) continue;
        var list = [p], minx = w, maxx = 0, miny = h, maxy = 0, grey = 0, big = false;
        comp[p] = 1;
        for (q = 0; q < list.length; q++) {
          var s2 = list[q], sx = s2 % w, sy = (s2 - sx) / w, kk = s2 * 4;
          if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
          if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
          if (Math.max(d[kk], d[kk + 1], d[kk + 2]) - Math.min(d[kk], d[kk + 1], d[kk + 2]) < 40) grey++;
          if (sx > 0 && !filled[s2 - 1] && !comp[s2 - 1]) { comp[s2 - 1] = 1; list.push(s2 - 1); }
          if (sx < w - 1 && !filled[s2 + 1] && !comp[s2 + 1]) { comp[s2 + 1] = 1; list.push(s2 + 1); }
          if (sy > 0 && !filled[s2 - w] && !comp[s2 - w]) { comp[s2 - w] = 1; list.push(s2 - w); }
          if (sy < h - 1 && !filled[s2 + w] && !comp[s2 + w]) { comp[s2 + w] = 1; list.push(s2 + w); }
          if (list.length > n * 0.02) big = true;         // part of the product: keep walking, no lift
        }
        if (big) continue;
        var boxA = (maxx - minx + 1) * (maxy - miny + 1);
        if (list.length / boxA < 0.5 && grey / list.length > 0.85) {
          // ink on white: coverage = darkness; redrawn as light ink with that coverage
          for (q = 0; q < list.length; q++) {
            var pk = list[q] * 4;
            inkA[list[q]] = Math.max(1, Math.min(255, Math.round((1 - Math.min(d[pk], d[pk + 1], d[pk + 2]) / 255) * 1.6 * 255)));
          }
        }
      }

      for (p = 0, k = 0; p < n; p++, k += 4) {
        if (!dist[p]) { d[k + 3] = 0; continue; }
        if (inkA[p]) { d[k] = INK[0]; d[k + 1] = INK[1]; d[k + 2] = INK[2]; d[k + 3] = inkA[p]; continue; }
        if (dist[p] < 3) {
          var m2 = Math.min(d[k], d[k + 1], d[k + 2]);
          if (m2 >= RIM_MIN) {
            var a = 1 - m2 / 255;
            if (a < 0.03) { d[k + 3] = 0; continue; }
            d[k] = Math.max(0, Math.min(255, Math.round((d[k] - (1 - a) * 255) / a)));
            d[k + 1] = Math.max(0, Math.min(255, Math.round((d[k + 1] - (1 - a) * 255) / a)));
            d[k + 2] = Math.max(0, Math.min(255, Math.round((d[k + 2] - (1 - a) * 255) / a)));
            d[k + 3] = Math.round(a * d[k + 3]);
          }
        }
      }
      r.ctx.putImageData(r.data, 0, 0);
      return true;
    }

    function plateOf(img) { return img.closest('.image-inner') || img.parentElement; }

    function fitOf(img) {
      var f = '';
      try { f = getComputedStyle(img).objectFit; } catch (e) {}
      return f || 'fill';
    }

    function swap(img, entry) {
      if (!entry || !entry.url) return;
      if (!img.hasAttribute('data-xg-plate-src')) {
        img.setAttribute('data-xg-plate-src', img.currentSrc || img.src);
        if (img.hasAttribute('srcset')) { img.setAttribute('data-xg-plate-srcset', img.getAttribute('srcset')); img.removeAttribute('srcset'); }
      }
      if (img.src !== entry.url) img.src = entry.url;
      img.classList.add('xg-plate-img');
      var plate = plateOf(img);
      if (plate && !img.classList.contains('extra-img')) {
        if (!plate.querySelector(':scope > .xg-plate-halo')) {
          var halo = document.createElement('canvas');
          halo.width = entry.halo.width; halo.height = entry.halo.height;
          halo.getContext('2d').drawImage(entry.halo, 0, 0);
          halo.className = 'xg-plate-halo';
          halo.setAttribute('aria-hidden', 'true');
          halo.style.objectFit = fitOf(img);
          plate.insertBefore(halo, plate.firstChild);
        }
        plate.classList.add('xg-plate');
      }
    }

    function unswap(img) {
      var o = img.getAttribute('data-xg-plate-src');
      if (!o) return;
      var ss = img.getAttribute('data-xg-plate-srcset');
      if (ss) img.setAttribute('srcset', ss);
      img.src = o;
      img.removeAttribute('data-xg-plate-src');
      img.removeAttribute('data-xg-plate-srcset');
      img.classList.remove('xg-plate-img');
    }

    function build(src, cb) {
      load(src, function (r) {
        idle(function () {
          var entry = { url: '' };
          try {
            if (r && cut(r)) {
              var s = HALO / Math.max(r.w, r.h);
              var halo = document.createElement('canvas');
              halo.width = Math.max(1, Math.round(r.w * s)); halo.height = Math.max(1, Math.round(r.h * s));
              halo.getContext('2d').drawImage(r.c, 0, 0, halo.width, halo.height);
              r.c.toBlob(function (blob) {
                if (blob) { entry.url = URL.createObjectURL(blob); entry.halo = halo; }
                cb(entry);
              }, 'image/png');
              return;
            }
          } catch (e) {}
          cb(entry);
        });
      });
    }

    function next() {
      if (!queue.length) { busy = false; return; }
      busy = true;
      var img = queue.shift();
      var src = origOf(img);
      if (!isDark() || !src || !img.isConnected) { next(); return; }
      if (done[src]) { swap(img, done[src]); next(); return; }
      build(src, function (entry) {
        done[src] = entry;
        if (isDark() && img.isConnected && origOf(img) === src) swap(img, entry);
        next();
      });
    }

    function consider(img) {
      if (!eligible(img)) return;
      var cur = img.currentSrc || img.src || '';
      if (cur.indexOf('blob:') === 0) return;             // already ours
      if (img.hasAttribute('data-xg-plate-src')) {
        // the theme or the search app pointed it at a new photo: start over
        img.removeAttribute('data-xg-plate-src');
        img.removeAttribute('data-xg-plate-srcset');
        img.classList.remove('xg-plate-img');
      }
      if (!img.complete || !img.naturalWidth) return;    // the load listener picks it up
      queue.push(img);
      if (!busy) next();
    }

    function scan() {
      var list = document.querySelectorAll(SEL), i;
      if (!isDark()) { for (i = 0; i < list.length; i++) unswap(list[i]); return; }
      for (i = 0; i < list.length; i++) consider(list[i]);
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
      new MutationObserver(scan).observe(root, { attributes: true, attributeFilter: ['data-xg-theme'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();
    window.addEventListener('load', scan);
  } catch (e) {}
})();
