/* Logo knockout - the header logo PNG carries its ground inside the file
   (no transparent pixels): the 2026-02 mark sat on white (200x200, measured
   2026-09-02); the 2026-09-11 mark sits on black (1341x1173, 626k black
   pixels all connected to the border, no enclosed black). Owner, dark mode:
   "it should lose its white background"; light mode, 2026-09-11:
   "background of the logo is black it should be white".

   The ground colour is read off the image border (white or black; anything
   else, or an already transparent file, is left alone). The ORIGINAL asset
   is redrawn on a canvas, the connected ground is flood-filled inward from
   the border to transparent (ground colour INSIDE the mark that does not
   touch the border survives), the one-pixel anti-aliased rim is un-blended
   so it leaves no halo, and - white ground in dark mode only - the
   low-saturation near-black strokes are lifted to #e9edf0 so they do not
   vanish on the dark header. A black ground in light mode keeps a black
   stroke around the mark (about 1/64 of the width) so the letters read on
   white the way they did on black - owner, 2026-09-11: "bg of logo should
   have black outline". The result replaces the <img> src as a data URL
   whenever the pass changed anything: a black ground in either mode, a
   white ground in dark mode. A white ground in light mode is left exactly
   as served, so the Organization microdata's itemprop="logo" stays a real
   url there. The served url is kept in data-xg-logo-src (srcset/sizes in
   data-xg-logo-srcset / -sizes) and put back whenever a mode needs the
   original. Renditions are cached per mode; a MutationObserver on
   data-xg-theme re-runs on every flip. The canvas work runs off the
   critical path, and any failure at any step leaves the image as served. */
(function () {
  'use strict';
  try {
    // The pinned phone bar's small logo copy (.xg-bar-logo, header-top.liquid,
    // 2026-09-21) is the raw asset with its baked white ground: it showed as
    // a white box once the bar stuck in dark mode (owner, 2026-09-22: "The
    // logo turns white after scrolling"). Same knockout, same data URL.
    var SEL = '#header .header__logo img, #header .xg-bar-logo img';
    var ATTR = 'data-xg-logo-src';
    var ATTR_SRCSET = 'data-xg-logo-srcset';   // parked srcset while swapped
    var ATTR_SIZES = 'data-xg-logo-sizes';     // parked sizes while swapped
    var WHITE = 235;              // r, g and b all >= WHITE = white ground
    var BLACK = 48;               // r, g and b all <= BLACK = black ground
    var DARK_MAX = 90;            // max(r,g,b) below this ...
    var DARK_SPREAD = 30;         // ... with max-min below this = dark ink
    var LIGHT = [233, 237, 240];  // #e9edf0
    var RIM_MIN = 128;            // rim pixels this light are treated as a white blend
    var MAX_PIXELS = 4000000;

    var root = document.documentElement;
    var source = null, sourceSrc = '';
    var cache = {};               // src + mode -> data url ('' = leave as served)
    var busy = false, again = false;

    function isDark() { return root.getAttribute('data-xg-theme') === 'dark'; }

    function idle(fn) {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1500 });
      else setTimeout(fn, 80);
    }

    function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

    function isWhite(d, k) { return d[k] >= WHITE && d[k + 1] >= WHITE && d[k + 2] >= WHITE; }
    function isBlack(d, k) { return d[k] <= BLACK && d[k + 1] <= BLACK && d[k + 2] <= BLACK; }

    /* Which ground the file carries, read off its border: 'white', 'black'
       or '' (mixed, coloured or transparent - nothing to knock out). */
    function groundOf(d, w, h) {
      var n = 0, wh = 0, bl = 0, x, y;
      function tally(q) {
        var k = q * 4; n++;
        if (d[k + 3] < 8) return;
        if (isWhite(d, k)) wh++; else if (isBlack(d, k)) bl++;
      }
      for (x = 0; x < w; x++) { tally(x); tally((h - 1) * w + x); }
      for (y = 1; y < h - 1; y++) { tally(y * w); tally(y * w + w - 1); }
      if (!n) return '';
      return wh / n >= 0.6 ? 'white' : bl / n >= 0.6 ? 'black' : '';
    }

    /* Pure pixel pass over an RGBA buffer. Returns the number of pixels
       changed (0 = nothing to do, leave the original alone). */
    function knockout(d, w, h, dark) {
      var ground = groundOf(d, w, h);
      if (!ground || (ground === 'white' && !dark)) return 0;
      var onWhite = ground === 'white';
      var stroke = (!onWhite && !dark) ? Math.max(2, Math.round(w / 64)) : 0;
      var n = w * h, changed = 0, p, o, x, y, a;
      var filled = new Uint8Array(n);
      var stack = new Int32Array(n);
      var sp = 0;
      function seed(q) {
        if (filled[q]) return;
        if (onWhite ? isWhite(d, q * 4) : isBlack(d, q * 4)) { filled[q] = 1; stack[sp++] = q; }
      }
      // Seeds: every border pixel. A ground-coloured region that touches
      // the border is ground by definition.
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
      // Light mode on a black ground: the ground pixels within `stroke` of
      // the mark stay opaque black (8-neighbour layers from the mark's edge
      // outward), the rest of the ground goes transparent.
      var ring = null;
      if (stroke) {
        ring = new Uint8Array(n);
        var fr = [], nx, q, dx, dy, xx, yy, pp, layer;
        for (p = 0; p < n; p++) {
          if (!filled[p]) continue;
          x = p % w; y = (p - x) / w;
          if ((x > 0 && !filled[p - 1]) || (x < w - 1 && !filled[p + 1]) ||
              (y > 0 && !filled[p - w]) || (y < h - 1 && !filled[p + w])) { ring[p] = 1; fr.push(p); }
        }
        for (layer = 1; layer < stroke && fr.length; layer++) {
          nx = [];
          for (q = 0; q < fr.length; q++) {
            p = fr[q]; x = p % w; y = (p - x) / w;
            for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
              xx = x + dx; yy = y + dy;
              if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              pp = yy * w + xx;
              if (filled[pp] && !ring[pp]) { ring[pp] = 1; nx.push(pp); }
            }
          }
          fr = nx;
        }
      }
      for (p = 0; p < n; p++) {
        o = p * 4;
        if (filled[p]) {
          if (ring && ring[p]) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 255; changed++; }
          else if (d[o + 3]) { d[o + 3] = 0; changed++; }
          continue;
        }
        var r = d[o], g = d[o + 1], b = d[o + 2];
        x = p % w; y = (p - x) / w;
        var rim = (x > 0 && filled[p - 1]) || (x < w - 1 && filled[p + 1]) ||
                  (y > 0 && filled[p - w]) || (y < h - 1 && filled[p + w]);
        if (rim && onWhite) {
          // Ink blended with white: coverage a = 1 - min/255, ink = (c - (1-a)*255) / a.
          var mn = Math.min(r, g, b);
          if (mn >= RIM_MIN) {
            a = 1 - mn / 255;
            if (a < 0.02) { d[o + 3] = 0; changed++; continue; }
            r = clamp((r - (1 - a) * 255) / a);
            g = clamp((g - (1 - a) * 255) / a);
            b = clamp((b - (1 - a) * 255) / a);
            d[o] = r; d[o + 1] = g; d[o + 2] = b;
            d[o + 3] = clamp(a * d[o + 3]);
            changed++;
          }
        } else if (rim && !stroke) {
          // Ink blended with black (no stroke to sit on): c = a * ink, so
          // a = max/255 and ink = c / a.
          a = Math.max(r, g, b) / 255;
          if (a < 0.02) { d[o + 3] = 0; changed++; continue; }
          if (a < 0.98) {
            d[o] = clamp(r / a); d[o + 1] = clamp(g / a); d[o + 2] = clamp(b / a);
            d[o + 3] = clamp(a * d[o + 3]);
            changed++;
          }
        }
        if (dark && onWhite) {
          var mx = Math.max(r, g, b), mn2 = Math.min(r, g, b);
          if (mx < DARK_MAX && mx - mn2 < DARK_SPREAD) {
            d[o] = LIGHT[0]; d[o + 1] = LIGHT[1]; d[o + 2] = LIGHT[2];
            changed++;
          }
        }
      }
      return changed;
    }

    function render(im, dark) {
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h || w * h > MAX_PIXELS) return '';
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(im, 0, 0);
      var id = ctx.getImageData(0, 0, w, h);   // throws on a tainted canvas
      if (!knockout(id.data, w, h, dark)) return '';
      ctx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    }

    function readable(im) {
      try {
        var c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        var ctx = c.getContext('2d');
        ctx.drawImage(im, 0, 0);
        ctx.getImageData(0, 0, 1, 1);
        return true;
      } catch (e) { return false; }
    }

    function fetchImage(src, bust, cb) {
      try {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { cb(im); };
        im.onerror = function () { cb(null); };
        im.src = bust ? src + (src.indexOf('?') > -1 ? '&' : '?') + 'xgk=1' : src;
      } catch (e) { cb(null); }
    }

    function getSource(src, cb) {
      if (source && sourceSrc === src) { cb(source); return; }
      fetchImage(src, false, function (im) {
        if (im && readable(im)) { source = im; sourceSrc = src; cb(im); return; }
        // A response cached earlier without CORS headers taints the canvas:
        // one more fetch past the cache, then give up.
        fetchImage(src, true, function (im2) {
          if (im2 && readable(im2)) { source = im2; sourceSrc = src; cb(im2); return; }
          cb(null);
        });
      });
    }

    function originalSrc(el) {
      var s = el.getAttribute(ATTR);
      if (!s) {
        s = el.currentSrc || el.getAttribute('src') || '';
        if (!s || /^data:/i.test(s)) return '';
        el.setAttribute(ATTR, s);
      }
      return s;
    }

    /* Show a rendition. srcset/sizes would override a plain src, so they
       are parked in data attributes for restore(). */
    function swap(el, url) {
      if (!el || !url || el.getAttribute('src') === url) return;
      if (el.hasAttribute('srcset')) { el.setAttribute(ATTR_SRCSET, el.getAttribute('srcset')); el.removeAttribute('srcset'); }
      if (el.hasAttribute('sizes')) { el.setAttribute(ATTR_SIZES, el.getAttribute('sizes')); el.removeAttribute('sizes'); }
      el.src = url;
    }

    /* Put the served image back exactly - src from data-xg-logo-src,
       srcset/sizes from their parked copies. A no-op on an image that was
       never swapped (its src is not a data url). */
    function restore(el) {
      var orig = el.getAttribute(ATTR);
      if (!orig) return;
      if (el.hasAttribute(ATTR_SRCSET)) { el.setAttribute('srcset', el.getAttribute(ATTR_SRCSET)); el.removeAttribute(ATTR_SRCSET); }
      if (el.hasAttribute(ATTR_SIZES)) { el.setAttribute('sizes', el.getAttribute(ATTR_SIZES)); el.removeAttribute(ATTR_SIZES); }
      if (/^data:/i.test(el.getAttribute('src') || '')) el.src = orig;
    }

    function apply(els, url) {
      for (var i = 0; i < els.length; i++) { if (url) swap(els[i], url); else restore(els[i]); }
    }

    function targets() {
      var out = [], list = document.querySelectorAll(SEL), i;
      for (i = 0; i < list.length; i++) if (originalSrc(list[i])) out.push(list[i]);
      return out;
    }

    function run() {
      try {
        var els = targets();
        if (!els.length) return;
        if (busy) { again = true; return; }
        var dark = isDark();
        var src = originalSrc(els[0]);
        var key = src + (dark ? '\ndark' : '\nlight');
        if (Object.prototype.hasOwnProperty.call(cache, key)) { apply(els, cache[key]); return; }
        busy = true;
        getSource(src, function (im) {
          idle(function () {
            var out = '';
            try { if (im) out = render(im, dark); } catch (e) { out = ''; }
            if (im) cache[key] = out;   // a failed fetch is tried again on the next flip
            // The theme may have flipped while the canvas ran; the observer re-runs then.
            if (isDark() === dark) apply(els, out);
            busy = false;
            if (again) { again = false; run(); }
          });
        });
      } catch (e) { busy = false; }
    }

    function start() {
      try {
        var el = document.querySelector(SEL);
        if (!el) return;
        originalSrc(el);   // record the served url before anything else can touch it
        if (el.complete) {
          if (el.naturalWidth) idle(run);
        } else {
          el.addEventListener('load', function onLoad() {
            el.removeEventListener('load', onLoad);
            idle(run);
          });
        }
        if (window.MutationObserver) {
          new MutationObserver(function () { run(); })
            .observe(root, { attributes: true, attributeFilter: ['data-xg-theme'] });
        }
        // Theme editor re-renders the header section: pick up the new <img>.
        document.addEventListener('shopify:section:load', function () { idle(run); });
      } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.xgLogoKnockout = { run: run, knockout: knockout, groundOf: groundOf, selector: SEL };
  } catch (e) {}
})();
