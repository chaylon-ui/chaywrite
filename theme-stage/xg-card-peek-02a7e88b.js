/* Card peek - hover a card image (New Today strip, special-product rows, any
   product grid) and a larger rendition follows the cursor, tooltip style.
   Owner, 2026-09-02: "when hovering over a picture of a card, could you have
   a tool-tip style popup showing the card larger?"

   Desktop only: bails without a hover-capable fine pointer. The panel is
   decorative - aria-hidden, pointer-events none, never focused - and rides
   the xg tokens, so the dark-mode token flip restyles it for free. One
   passive document-level mousemove listener, registered once, keeps the
   pointer position current, so the panel opens where the pointer IS after
   the hover delay and follows it from there. Shopify CDN thumbnails are
   re-requested at 640px wide (width= query or size-suffix forms); anything
   else is shown as served. Every step is guarded: a failure here must stay
   silent and never touch the page. */
(function () {
  'use strict';
  try {
    if (window.xgCardPeek) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (!document.documentElement || !document.addEventListener) return;
    if (!Element.prototype.matches) return;

    var SEL = '.xg-nt__card img, .xg-sp .grid-view-item img, .products-display .grid-view-item img';
    var ID = 'xg-card-peek';
    var DELAY = 180;      // ms of settled hover before the peek appears
    var OFFSET = 18;      // px from the cursor
    var MIN_W = 60;       // ignore icons and tiny thumbs
    var BIG = 640;        // requested width of the large rendition
    var MAX_W = 340;      // panel max-width (px), matches the CSS
    var VH = 0.82;        // panel max-height as a share of the viewport
    var PAD = 6;          // panel padding (px), matches the CSS
    var UPSCALE = 2.5;    // cap on blowing up a small non-CDN source

    var panel = null, pimg = null;
    var cur = null;       // the <img> currently hovered
    var curHov = null;    // the element the pointer is on (the img itself, or a ticker card's name)
    // The new-cards ticker (owner, 2026-09-28: "when they hover over the card
    // name or image ... a preview of the card so they can read it"): its thumbs
    // are tiny, so the size floor does not apply, and the NAME opens the same
    // peek from its card's thumb. The tape pauses under the pointer already.
    var TICK = '#xg-ticker .xg-tick__thumb, #xg-ticker .xg-tick__name';
    var timer = 0;
    var token = 0;        // hover generation - late loads for an old hover are dropped
    var lastX = 0, lastY = 0;   // pointer, kept current by onMove
    var showing = false;  // panel is on: mousemove repositions it
    var raf = 0;
    var resolved = {};    // thumb src -> the url that actually loaded

    var CSS = '' +
      '#' + ID + '{position:fixed;left:0;top:0;z-index:9999;box-sizing:border-box;max-width:' + MAX_W + 'px;' +
        'max-height:' + (VH * 100) + 'vh;padding:' + PAD + 'px;border-radius:12px;' +
        'border:1px solid var(--xg-border,#e3e6e8);background:var(--xg-surface,#fff);' +
        'box-shadow:var(--xg-shadow-2,0 10px 28px rgba(16,24,40,.12));' +
        'pointer-events:none;opacity:0;overflow:hidden;will-change:transform;' +
        'transition:opacity 120ms ease}' +
      '#' + ID + '.is-on{opacity:1}' +
      '#' + ID + ' img{display:block;max-width:100%;border-radius:8px;background:var(--xg-bg,#f3f4f6)}' +
      '#' + ID + '.is-card img{border-radius:5% / 3.6%;background:transparent}' +
      '@media (prefers-reduced-motion:reduce){#' + ID + '{transition:none}}';

    function injectCss() {
      if (document.getElementById(ID + '-css')) return;
      var s = document.createElement('style');
      s.id = ID + '-css';
      s.appendChild(document.createTextNode(CSS));
      (document.head || document.documentElement).appendChild(s);
    }

    function ensurePanel() {
      if (panel) return;
      injectCss();
      panel = document.createElement('div');
      panel.id = ID;
      panel.className = 'xg-peek';
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('role', 'presentation');
      pimg = document.createElement('img');
      pimg.addEventListener('load', function () {
        // Card scans are 63x88 (0.716); sealed boxes and accessories are not.
        var r = pimg.naturalWidth / (pimg.naturalHeight || 1);
        panel.classList.toggle('is-card', r > 0.66 && r < 0.78);
      });
      pimg.alt = '';
      pimg.setAttribute('aria-hidden', 'true');
      pimg.setAttribute('draggable', 'false');
      panel.appendChild(pimg);
      document.body.appendChild(panel);
    }

    function isShopifyCdn(u) {
      return /^(https?:)?\/\/cdn\.shopify\.com\//i.test(u) || /\/(s\/files|cdn\/shop)\//i.test(u);
    }

    /* Shopify CDN: bump the rendition to 640px wide, keeping the extension
       and the query string. The width= query form (?width=320) is handled
       FIRST and becomes width=640 with any height/crop dropped so the ratio
       stays natural - the path is left alone, so a stem that legitimately
       ends in _<n>x<m> (card_2x3.jpg?width=300) survives. Only a path with
       no width query gets the suffix rewrite: _300x300, _148x, _x200,
       _large, _crop_center, @2x become _640x. A CDN url with neither gets
       width=640 appended. Anything not on the CDN is returned untouched. */
    function bigUrl(src) {
      try {
        if (!src || /^data:/i.test(src) || !isShopifyCdn(src)) return src;
        var path = src, q = '', i = src.indexOf('?');
        if (i > -1) { path = src.slice(0, i); q = src.slice(i); }
        if (/[?&]width=\d+/i.test(q)) {
          q = q.replace(/([?&])width=\d+/i, '$1width=' + BIG)
               .replace(/&(height|crop)=[^&]*/gi, '')
               .replace(/\?(height|crop)=[^&]*&?/i, '?')
               .replace(/[?&]$/, '');
          return path + q;
        }
        var m = path.match(/^(.*?)_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_(?:top|center|bottom|left|right))?(?:@[23]x)?(\.[a-z0-9]{2,5})$/i);
        if (m) return m[1] + '_' + BIG + 'x' + m[2] + q;
        return path + (q ? q + '&' : '?') + 'width=' + BIG;
      } catch (e) { return src; }
    }

    function place() {
      raf = 0;
      if (!panel) return;
      var w = panel.offsetWidth, h = panel.offsetHeight;
      var vw = window.innerWidth, vh = window.innerHeight;
      var x = lastX + OFFSET, y = lastY + OFFSET;
      if (x + w > vw - 8) x = lastX - OFFSET - w;   // flip left
      if (y + h > vh - 8) y = lastY - OFFSET - h;   // flip up
      if (x < 8) x = 8;
      if (y < 8) y = 8;
      panel.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    }

    /* Registered once at load, passive: two assignments per move while
       idle. place() reads lastX/lastY, so a peek never opens at the stale
       mouseover entry point. */
    function onMove(e) {
      lastX = e.clientX; lastY = e.clientY;
      if (showing && !raf) raf = requestAnimationFrame(place);
    }

    function hide() {
      if (timer) { clearTimeout(timer); timer = 0; }
      token++;
      cur = null;
      curHov = null;
      showing = false;
      if (panel) panel.classList.remove('is-on');
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    function show(pre, url) {
      ensurePanel();
      var nw = pre.naturalWidth || 1, nh = pre.naturalHeight || 1;
      var maxW = MAX_W - PAD * 2 - 2;
      var maxH = Math.max(120, window.innerHeight * VH - PAD * 2 - 2);
      var scale = Math.min(maxW / nw, maxH / nh, UPSCALE);
      pimg.style.width = Math.max(1, Math.round(nw * scale)) + 'px';
      pimg.style.height = Math.max(1, Math.round(nh * scale)) + 'px';
      if (pimg.getAttribute('src') !== url) pimg.src = url;
      showing = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      place();
      panel.classList.add('is-on');
    }

    function load(img, my) {
      var src = img.currentSrc || img.src || img.getAttribute('src');
      if (!src) return;
      var want = resolved[src] || bigUrl(src);
      var pre = new Image();
      pre.onload = function () {
        if (my !== token) return;
        resolved[src] = want;
        show(pre, want);
      };
      pre.onerror = function () {
        if (my !== token || want === src) return;
        var fb = new Image();     // the large rendition is missing: show the thumb as is
        fb.onload = function () {
          if (my !== token) return;
          resolved[src] = src;
          show(fb, src);
        };
        fb.src = src;
      };
      pre.src = want;
    }

    function onOver(e) {
      try {
        var t = e.target, hov = t, tick = null;
        if (t && t.closest) tick = t.closest(TICK);
        if (tick) {
          var item = tick.closest('.xg-tick__item');
          t = item && item.querySelector('img.xg-tick__thumb');
          hov = tick;
          if (!t || hov === curHov) return;
        } else {
          if (!t || t.nodeName !== 'IMG' || t === cur || !t.matches(SEL)) return;
          var r = t.getBoundingClientRect();
          if (r.width < MIN_W) return;
        }
        hide();
        cur = t;
        curHov = hov;
        lastX = e.clientX; lastY = e.clientY;
        var my = token;
        timer = setTimeout(function () {
          timer = 0;
          try { if (my === token && cur === t) load(t, my); } catch (err) {}
        }, DELAY);
      } catch (err) {}
    }

    function onOut(e) {
      try {
        if (!curHov) return;
        // leaving for a child of the hovered element (a name's text) is not leaving
        if (e.target === curHov && !(e.relatedTarget && curHov.contains(e.relatedTarget))) hide();
      } catch (err) {}
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) hide();
    }

    var passiveCapture = { passive: true, capture: true };
    document.addEventListener('mousemove', onMove, passiveCapture);
    document.addEventListener('mouseover', onOver, passiveCapture);
    document.addEventListener('mouseout', onOut, passiveCapture);
    window.addEventListener('scroll', hide, passiveCapture);
    window.addEventListener('wheel', hide, passiveCapture);
    window.addEventListener('resize', hide, passiveCapture);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('visibilitychange', hide, true);

    window.xgCardPeek = { hide: hide, bigUrl: bigUrl, selector: SEL };
  } catch (e) {}
})();

/* Card corners everywhere (owner, 2026-09-11: "some cards have white
   triangles in the corners"). Card scans are rectangular JPGs with the
   scan's white ground baked into the corners; xg-features.css §12 clips
   .xg-single photos to real card geometry. Rather than editing every
   product-card snippet and the product template, this marks the elements
   from the photo itself: a 63×88 card scan has a 0.716 aspect ratio, a
   sealed box or a playmat does not. Runs on load and again for tiles the
   theme draws later (search app, sliders, quick-add). */
(function () {
  'use strict';
  // Every image on the page: the search app, the mega menu and the zoom
  // overlay draw cards with markup of their own, so the mark is put on the
  // <img> itself (data-xg-corner="card") and xg-features.css §12 clips by
  // that attribute; the host class is only for the foil overlay and the
  // product photo's thumbnails.
  var SEL = 'img';
  function isCard(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    if (w < 60 || h < 84) return false;   // icons, set symbols, avatars
    var r = w / h;
    return r > 0.66 && r < 0.78;
  }
  function mark(img) {
    if (img.getAttribute('data-xg-corner')) return;
    var c = isCard(img);
    if (c === null) { img.addEventListener('load', function () { mark(img); }, { once: true }); return; }
    img.setAttribute('data-xg-corner', c ? 'card' : 'box');
    if (!c) return;
    var host = img.closest('.product-single-left') || img.closest('.grid-view-item') || img.closest('.xg-nt__card') || img.parentElement;
    if (host) host.classList.add('xg-single');
  }
  function sweep(root) {
    var list = (root || document).querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) mark(list[i]);
  }
  function start() {
    sweep();
    if (typeof MutationObserver !== 'function') return;
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { sweep(); }, 200); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
