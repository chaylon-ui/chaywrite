/* Card scanner (beta) — point the camera at a card, we read the title line
   in the browser (Tesseract.js, lazy-loaded; no photo ever leaves the
   device) and match it against live stock via the exor-binder worker's
   /instock.json, with one-tap add to cart.

   Entry: a small camera button injected beside the storefront search
   inputs (secure contexts only). Camera path crops the title band from a
   card-shaped guide box; the upload-a-photo fallback assumes the card
   fills the picture. MTG misreads get one Scryfall fuzzy rescue. Any
   failure ends at "search the store for <text>" so nobody dead-ends.

   v3.5: photo passes also harvest the COLLECTOR LINE — MTG set code +
   collector number ("263 U" / "C21 • EN"), Yu-Gi-Oh / One Piece printed
   codes ("DUPO-EN048", "OP01-025"), Pokémon fractions ("14/181") — and
   use it to surface the EXACT printing instead of the cheapest one, or
   to identify the card outright when the title is unreadable (MTG via
   Scryfall set/number lookup; YGO/OP codes hit BinderPOS SKUs through
   the worker's code mode). Everything stays shelf-gated: a misread
   number resolves to a real-but-wrong card, so nothing renders without
   a live stock match, and the read line names the collector-line basis. */
(function () {
  if (window.__xgScan) return;
  window.__xgScan = 1;
  if (!window.fetch || !window.isSecureContext) return;

  var W = 'https://exor-binder.nevski.workers.dev';
  var TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  // The theme's native results template (the app proxy /a/search is noindex)
  var SEARCH_URL = '/search?type=product&options%5Bprefix%5D=last&q=';
  var GAMES = [
    ['mtg', 'Magic'], ['pokemon', 'Pokémon'], ['yugioh', 'Yu-Gi-Oh!'],
    ['onepiece', 'One Piece'], ['starwars', 'Star Wars']
  ];
  /* Live search forms only; [selector, right-offset px]. The submit button
     sits at right:5px (~40px wide), so the camera tucks in at ~46px.
     #_mobile_search is filled by shop.js cloneToMobile as an innerHTML copy
     of the desktop form — listeners don't survive the copy, which is why
     every click below is delegated on document, and why a cloned button
     (copied markup + data-xg-scan already set) still works untouched. */
  var HOSTS = [
    ['#_desktop_search form.search-header', 46],
    ['#_mobile_search form.search-header', 46],
    ['.search-page-form .input-group', 52]
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  var css = '' +
    '.xg-scan-host{position:relative}' +
    '.xg-scan-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:30px;height:30px;' +
      'display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;' +
      'background:transparent;color:#6b747b;cursor:pointer}' +
    '.xg-scan-btn:hover{color:var(--xg-red,#d62c28)}' +
    'html[data-xg-theme="dark"] .xg-scan-btn{color:#98a3aa}' +
    'html[data-xg-theme="dark"] .xg-scan-btn:hover{color:#ff6a5e}' +
    // Text must clear both the submit and the camera. The header rule is
    // #header #_desktop_search .search-info .search__input (2,2,0) — only
    // !important reaches it from a class selector.
    '.xg-scan-host .search-header__input{padding-right:84px !important}' +
    '.search-page-form .input-group.xg-scan-host .search__input{padding-right:96px !important}' +
    '#xg-scan{position:fixed;inset:0;z-index:100010;background:#0b0e10;color:#e8edef;display:none;' +
      'flex-direction:column;font-family:var(--xg-font-body,"Inter",sans-serif)}' +
    '#xg-scan.is-open{display:flex}' +
    '#xg-scan .xg-scan__top{display:flex;align-items:center;gap:10px;padding:14px 16px;flex:0 0 auto}' +
    '#xg-scan .xg-scan__title{font-family:var(--xg-font-display,"Oswald","Arial Narrow",sans-serif);' +
      'font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}' +
    '#xg-scan .xg-scan__beta{font-size:10px;font-weight:800;letter-spacing:.14em;padding:3px 8px;border-radius:999px;' +
      'background:rgba(255,216,0,.14);color:#ffd84d;border:1px solid rgba(255,216,0,.4)}' +
    '#xg-scan .xg-scan__x{margin-left:auto;width:34px;height:34px;border:1px solid rgba(255,255,255,.2);border-radius:50%;' +
      'background:rgba(255,255,255,.06);color:#fff;font-size:19px;line-height:1;cursor:pointer;padding:0}' +
    '#xg-scan .xg-scan__games{display:flex;gap:8px;padding:0 16px 10px;flex:0 0 auto;overflow-x:auto;' +
      'scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 90%,transparent);mask-image:linear-gradient(90deg,#000 90%,transparent)}' +
    '#xg-scan .xg-scan__games::-webkit-scrollbar{display:none}' +
    '#xg-scan .xg-scan__game{flex:0 0 auto;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;' +
      'border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.05);color:#cfd8dd;cursor:pointer}' +
    '#xg-scan .xg-scan__game.is-on{background:var(--xg-red,#d62c28);border-color:var(--xg-red,#d62c28);color:#fff}' +
    '#xg-scan .xg-scan__stage{position:relative;flex:1 1 auto;min-height:0;background:#000;overflow:hidden}' +
    '#xg-scan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '#xg-scan .xg-scan__guide{position:absolute;border:2px solid rgba(255,255,255,.9);border-radius:10px;' +
      'box-shadow:0 0 0 4000px rgba(0,0,0,.45)}' +
    '#xg-scan .xg-scan__band{position:absolute;left:0;top:0;width:78%;height:13%;border:1.5px dashed rgba(255,216,77,.85);' +
      'border-radius:8px 0 6px 0}' +
    '#xg-scan .xg-scan__hint{position:absolute;left:0;right:0;bottom:128px;text-align:center;font-size:13px;color:#cfd8dd;' +
      'text-shadow:0 1px 6px rgba(0,0,0,.8);padding:0 20px;z-index:2}' +
    // Controls FLOAT over the camera stage (portrait phones lost the stage
    // to the control rows below it); a gradient keeps them readable.
    '#xg-scan .xg-scan__ctrl{position:absolute;left:0;right:0;bottom:0;z-index:3;' +
      'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;' +
      'padding:26px 16px calc(14px + env(safe-area-inset-bottom,0px));' +
      'background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,0))}' +
    '#xg-scan .xg-scan__shot{width:64px;height:64px;border-radius:50%;border:4px solid #fff;padding:0;cursor:pointer;' +
      'background:var(--xg-red,#d62c28);box-shadow:0 0 24px rgba(214,44,40,.5)}' +
    '#xg-scan .xg-scan__shot:disabled{opacity:.4}' +
    '#xg-scan .xg-scan__up{font-size:13px;color:#fff;text-decoration:underline;cursor:pointer;background:none;border:0;' +
      'padding:6px;justify-self:end;margin-right:18px;text-shadow:0 1px 5px rgba(0,0,0,.7)}' +
    '#xg-scan .xg-scan__status{position:absolute;left:0;right:0;bottom:100px;z-index:3;text-align:center;font-size:13.5px;' +
      'color:#ffd84d;min-height:20px;padding:0 16px;text-shadow:0 1px 6px rgba(0,0,0,.85)}' +
    '#xg-scan.has-results .xg-scan__status{position:static;text-shadow:none;padding:0 16px 8px}' +
    '#xg-scan .xg-scan__res{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 16px 20px;display:none}' +
    '#xg-scan.has-results .xg-scan__stage,#xg-scan.has-results .xg-scan__ctrl{display:none}' +
    '#xg-scan.has-results .xg-scan__res{display:block}' +
    '#xg-scan .xg-scan__read{font-size:13px;color:#8fa0a8;margin:4px 0 12px}' +
    '#xg-scan .xg-scan__read b{color:#fff}' +
    '#xg-scan .xg-scan__cluechip{display:inline-block;font-size:11px;color:#8fa0a8;border:1px solid rgba(255,255,255,.18);' +
      'border-radius:999px;padding:1px 8px;margin-left:6px;white-space:nowrap;vertical-align:1px}' +
    '#xg-scan .xg-scan__exact{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.06em;color:#7a5c00;' +
      'background:linear-gradient(135deg,#ffe9a3,#ffd84d);border-radius:4px;padding:1px 6px;margin-right:6px}' +
    '#xg-scan .xg-scan__row{display:flex;align-items:center;gap:12px;background:#15191c;border:1px solid rgba(255,255,255,.09);' +
      'border-radius:12px;padding:10px 12px;margin:0 0 10px}' +
    '#xg-scan .xg-scan__img{width:44px;height:62px;object-fit:cover;border-radius:6px;background:#0f1215;flex:0 0 44px}' +
    '#xg-scan .xg-scan__info{min-width:0;flex:1 1 auto}' +
    '#xg-scan .xg-scan__name{font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#xg-scan .xg-scan__name a{color:#fff;text-decoration:none}' +
    '#xg-scan .xg-scan__sub{font-size:12px;color:#8fa0a8;margin-top:2px}' +
    '#xg-scan .xg-scan__price{font-size:14px;font-weight:700;color:#ffd84d;white-space:nowrap}' +
    '#xg-scan .xg-scan__addbtn{flex:0 0 34px;width:34px;height:34px;border:0;border-radius:50%;padding:0;cursor:pointer;' +
      'display:inline-flex;align-items:center;justify-content:center;background:var(--xg-red,#d62c28);color:#fff}' +
    '#xg-scan .xg-scan__addbtn.is-added{background:var(--xg-success,#17784a)}' +
    '#xg-scan .xg-scan__foot{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px}' +
    '#xg-scan .xg-scan__link{font-size:13.5px;font-weight:600;color:#ffd84d;text-decoration:none;background:none;border:0;padding:0;cursor:pointer}' +
    '#xg-scan .xg-scan__link:hover{text-decoration:underline}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var IC_CAM = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h2.2l1.4-2.2A1.6 1.6 0 0 1 8.9 5h6.2a1.6 1.6 0 0 1 1.3.8L17.8 8H20a1.8 1.8 0 0 1 1.8 1.8v7.4A1.8 1.8 0 0 1 20 19H4a1.8 1.8 0 0 1-1.8-1.8V9.8A1.8 1.8 0 0 1 4 8z"/><circle cx="12" cy="13" r="3.4"/></svg>';
  var IC_CART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.2 11.2a1.7 1.7 0 0 0 1.7 1.4h7.9a1.7 1.7 0 0 0 1.7-1.4L20 8H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="16.5" cy="20" r="1.4"/><path d="M13 10v4"/><path d="M11 12h4"/></svg>';
  var IC_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';

  var overlay = null, video = null, stream = null, lastTitle = '';
  var game = 'mtg';
  try { game = localStorage.getItem('xgScanGame') || 'mtg'; } catch (e) {}

  /* Collector-line clues for the current scan (reset per capture/photo):
     code  — a printed YGO/One Piece code ("DUPO-EN048"), queried as-is
             (the worker matches BinderPOS SKU prefixes in code mode)
     set   — MTG set code, lowercased ("c21")
     num/den — collector number (+ printed total when the card shows one)
     exact — set once a match came FROM the collector line (read-line label)
     miss  — printing named by the clue but absent from the shelf (note) */
  var clue = {}, clueBuf = '';
  var setNames = {};   // Scryfall set code -> set name, cached per session

  var CLUE_CODE = /\b([A-Z]{2,5}\d{0,3}-[A-Z]{0,3}\d{1,4})\b/;
  var CLUE_FRAC = /\b0*(\d{1,4})\s*\/\s*0*(\d{1,4})\b/;
  var CLUE_MSET = /\b(?!THE\b)([A-Z][A-Z0-9]{2,3})[^A-Za-z0-9\n]{0,3}(EN|FR|DE|IT|ES|PT|JA|KO|RU|ZH|PH)\b/;
  var CLUE_NUMR = /\b0*(\d{1,4})\s{0,2}[CURMLPST]\b/;

  /* Pure parser (also the CI hook): what does this OCR text say about the
     printing? MTG wants the set code before it trusts a bare "263 U" line;
     fractions require a plausible printed total so "1/2" flavor text can't
     pass as a collector number. */
  function parseClues(text, g) {
    var t = String(text || '').replace(/[–—]/g, '-');
    var out = {}, m;
    if ((g === 'yugioh' || g === 'onepiece') && (m = t.match(CLUE_CODE))) out.code = m[1].toUpperCase();
    if ((m = t.match(CLUE_FRAC)) && +m[2] >= 10) { out.num = m[1]; out.den = m[2]; }
    if (g === 'mtg') {
      if ((m = t.match(CLUE_MSET))) out.set = m[1].toLowerCase();
      if (out.set && !out.num && (m = t.match(CLUE_NUMR))) out.num = m[1];
    }
    return out;
  }
  window.__xgScanClues = parseClues;

  // Clues accumulate across OCR passes (the number and the set code often
  // land in different reads), so harvesting re-parses the whole buffer.
  function harvestClues(text) {
    clueBuf += '\n' + String(text || '');
    var p = parseClues(clueBuf, game);
    if (p.code && !clue.code) clue.code = p.code;
    if (p.num && !clue.num) { clue.num = p.num; clue.den = p.den; }
    if (p.set && !clue.set) clue.set = p.set;
  }
  function resetClues() { clue = {}; clueBuf = ''; }

  /* ---------- entry buttons beside the search inputs ---------- */
  function injectButtons() {
    for (var i = 0; i < HOSTS.length; i++) {
      var nodes = document.querySelectorAll(HOSTS[i][0]);
      for (var n = 0; n < nodes.length; n++) {
        var f = nodes[n];
        if (f.getAttribute('data-xg-scan')) continue;
        var inp = f.querySelector('input[name="q"]') || f.querySelector('input[type="text"],input[type="search"]');
        if (!inp) continue;
        f.setAttribute('data-xg-scan', '1');
        f.classList.add('xg-scan-host');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'xg-scan-btn';
        b.style.right = HOSTS[i][1] + 'px';
        b.setAttribute('aria-label', 'Scan a card with your camera (beta)');
        b.setAttribute('title', 'Scan a card (beta)');
        b.innerHTML = IC_CAM;
        // Right after the input, NOT appended last: the theme's autocomplete
        // appends its <ul class="search-results"> as the form's last child
        // and does its offset math once against that position.
        inp.parentNode.insertBefore(b, inp.nextSibling);
      }
    }
  }

  // Clicks are delegated so buttons that arrive as markup copies
  // (cloneToMobile, app re-renders) work without their own listeners.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.xg-scan-btn') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  });

  /* ---------- overlay ---------- */
  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'xg-scan';
    overlay.innerHTML =
      '<div class="xg-scan__top">' +
        '<span class="xg-scan__title">Scan a card</span>' +
        '<span class="xg-scan__beta">BETA</span>' +
        '<button type="button" class="xg-scan__x" aria-label="Close scanner">&times;</button>' +
      '</div>' +
      '<div class="xg-scan__games">' + GAMES.map(function (g) {
        return '<button type="button" class="xg-scan__game' + (g[0] === game ? ' is-on' : '') + '" data-g="' + g[0] + '">' + g[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="xg-scan__stage">' +
        '<video playsinline autoplay muted></video>' +
        '<div class="xg-scan__guide"><div class="xg-scan__band"></div></div>' +
        '<div class="xg-scan__hint">Fill the frame with the card — the name inside the dashed strip. Your photo never leaves this device.</div>' +
      '</div>' +
      '<div class="xg-scan__status" aria-live="polite"></div>' +
      '<div class="xg-scan__ctrl">' +
        '<button type="button" class="xg-scan__up">Upload a photo</button>' +
        '<button type="button" class="xg-scan__shot" aria-label="Capture"></button>' +
        '<span class="xg-scan__spacer" aria-hidden="true"></span>' +
        // inline display:none, NOT the hidden attribute: bootstrap's
        // input[type=file]{display:block} overrides [hidden] (owner saw the
        // raw file control on the phone). No capture attr either — iOS then
        // offers Photo Library / Take Photo instead of forcing the camera.
        '<input type="file" accept="image/*" style="display:none">' +
      '</div>' +
      '<div class="xg-scan__res"></div>';
    document.body.appendChild(overlay);
    video = overlay.querySelector('video');
    overlay.querySelector('.xg-scan__x').addEventListener('click', close);
    overlay.querySelector('.xg-scan__shot').addEventListener('click', capture);
    overlay.querySelector('.xg-scan__res').addEventListener('click', onResultsClick);
    var file = overlay.querySelector('input[type=file]');
    overlay.querySelector('.xg-scan__up').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      if (file.files && file.files[0]) fromFile(file.files[0]);
      file.value = '';
    });
    overlay.querySelector('.xg-scan__games').addEventListener('click', function (e) {
      var g = e.target && e.target.closest ? e.target.closest('.xg-scan__game') : null;
      if (!g) return;
      game = g.getAttribute('data-g');
      try { localStorage.setItem('xgScanGame', game); } catch (err) {}
      var all = overlay.querySelectorAll('.xg-scan__game');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-on', all[i] === g);
      resetClues(); // collector-line semantics differ per game
      if (lastTitle) lookup(lastTitle, true); // re-match the last read in the new game
    });
    layoutGuide();
    window.addEventListener('resize', layoutGuide, { passive: true });
    return overlay;
  }

  function layoutGuide() {
    if (!overlay) return;
    var stage = overlay.querySelector('.xg-scan__stage');
    var guide = overlay.querySelector('.xg-scan__guide');
    var sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    var gh = sh * 0.62, gw = gh * 63 / 88;
    if (gw > sw * 0.86) { gw = sw * 0.86; gh = gw * 88 / 63; }
    guide.style.width = Math.round(gw) + 'px';
    guide.style.height = Math.round(gh) + 'px';
    guide.style.left = Math.round((sw - gw) / 2) + 'px';
    // sits a little high: the shutter + hint float over the stage bottom now
    guide.style.top = Math.round((sh - gh) / 2 - sh * 0.07) + 'px';
  }

  function status(t) { if (overlay) overlay.querySelector('.xg-scan__status').textContent = t || ''; }

  function open() {
    build();
    overlay.classList.add('is-open');
    overlay.classList.remove('has-results');
    document.documentElement.style.overflow = 'hidden';
    status('');
    layoutGuide();
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        .then(function (s) { stream = s; video.srcObject = s; })
        .catch(function () { status('Camera unavailable — use "Upload a photo" below.'); });
    } else {
      status('No camera on this device — use "Upload a photo" below.');
    }
  }

  function close() {
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
    if (video) video.srcObject = null;
    if (overlay) overlay.classList.remove('is-open');
    document.documentElement.style.overflow = '';
  }

  /* ---------- capture paths ---------- */
  function capture() {
    if (!video || !video.videoWidth) { status('Camera not ready yet — or use "Upload a photo".'); return; }
    var stage = overlay.querySelector('.xg-scan__stage');
    var guide = overlay.querySelector('.xg-scan__guide');
    var vw = video.videoWidth, vh = video.videoHeight;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    // object-fit: cover mapping from stage px to video px
    var scale = Math.max(sw / vw, sh / vh);
    var offX = (vw * scale - sw) / 2, offY = (vh * scale - sh) / 2;
    var gx = guide.offsetLeft, gy = guide.offsetTop, gw = guide.offsetWidth, gh = guide.offsetHeight;
    var rect = {
      x: (gx + offX) / scale, y: (gy + offY) / scale,
      w: gw / scale, h: gh / scale
    };
    var cv = document.createElement('canvas');
    cv.width = vw; cv.height = vh;
    cv.getContext('2d').drawImage(video, 0, 0);
    processCanvas(cv, rect);
  }

  function fromFile(f) {
    status('Reading the photo…');
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      // uploaded shots: the card can sit anywhere in the photo, so go
      // straight to the sparse whole-photo read
      sparseFlow(cv);
    };
    img.onerror = function () { status('Could not read that image.'); };
    img.src = URL.createObjectURL(f);
  }

  /* ---------- OCR ---------- */
  var tessReady = null;
  function loadTesseract() {
    if (tessReady) return tessReady;
    tessReady = new Promise(function (resolve, reject) {
      if (window.Tesseract) return resolve();
      var s = document.createElement('script');
      s.src = TESS_SRC;
      s.onload = function () { resolve(); };
      s.onerror = function () { tessReady = null; reject(new Error('tesseract load')); };
      document.head.appendChild(s);
    }).then(function () {
      return window.Tesseract.createWorker('eng').then(function (w) {
        return w.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',.:-&/!"
        }).then(function () { return w; });
      });
    });
    return tessReady;
  }

  // psm '7' = one text line (the aligned camera band); '11' = sparse text,
  // which finds the title wherever the card sits in an uploaded photo.
  function ocr(canvas, psm) {
    return loadTesseract().then(function (worker) {
      return worker.setParameters({ tessedit_pageseg_mode: psm }).then(function () {
        return worker.recognize(canvas);
      });
    }).then(function (r) { return (r && r.data && r.data.text) || ''; });
  }

  /* Sparse reads work at a FIXED width, up or down: the card usually fills
     only part of the photo, and a phone shot downscaled to 1600px left the
     title under Tesseract's legibility floor — it read the rules-text line
     ("e:Add") instead of the name. 2000px keeps a part-of-frame title at a
     readable size without making the OCR pass unbearably slow. */
  function resizeTo(cv, w) {
    if (cv.width === w) return cv;
    var d = document.createElement('canvas');
    d.width = w;
    d.height = Math.round(cv.height * w / cv.width);
    d.getContext('2d').drawImage(cv, 0, 0, d.width, d.height);
    return d;
  }

  /* Camera path: the shopper aligned the card to the guide, so read just the
     title band (top 13% x left 78% skips mana cost / HP / attribute). If the
     band read finds nothing on the shelf, the SAME frame gets the sparse
     full-photo pass before giving up — misalignment stops being fatal. */
  function processCanvas(cv, rect) {
    resetClues();
    var bx = rect.x, by = rect.y, bw = rect.w * 0.78, bh = rect.h * 0.13;
    var out = document.createElement('canvas');
    var targetW = 1000;
    var s = targetW / bw;
    out.width = targetW;
    out.height = Math.max(40, Math.round(bh * s));
    var ctx = out.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.35)';
    ctx.drawImage(cv, bx, by, bw, bh, 0, 0, out.width, out.height);
    status('Reading the card name…');
    ocr(out, '7').then(function (raw) {
      var title = cleanTitle(raw);
      if (!title) return sparseFlow(cv);
      return runMatch([title], cv);
    }).catch(function () {
      status('The reader failed to load — check your connection and try again.');
    });
  }

  /* Upload path: no framing to trust (owner's photos put the card anywhere
     in the shot), so OCR the WHOLE photo in sparse mode and treat every
     short, wordy line as a possible title — the stock match picks the
     real one. */
  function collectCands(text) {
    var lines = String(text).split('\n');
    var cands = [];
    for (var i = 0; i < lines.length && cands.length < 8; i++) {
      var L = cleanTitle(lines[i]);
      if (!L) continue;
      if (/^.{0,2}:/.test(L)) continue; // mana/tap-symbol junk ("e:Add")
      var letters = (L.match(/[A-Za-z]/g) || []).length;
      var words = L.split(' ').length;
      // title-shaped: short, mostly letters ("Expedition Diviner" yes,
      // rules text and foil glare noise no)
      if (words <= 5 && letters >= 4 && letters / L.length > 0.55 && L.length <= 40 && cands.indexOf(L) === -1) {
        cands.push(L);
      }
    }
    return rankCands(cands);
  }

  /* Ability keywords and type lines are real OCR reads but never the name
     worth leading with ("Flying" beat a glare-garbled title on an owner
     photo). Demote them — they still ride the batched stock call, so cards
     actually NAMED "Fear" or "Flash" still match; they just can't outrank
     anything name-shaped, seed the rescue, or head the "Read:" line. */
  var ABIL = ['flying', 'trample', 'haste', 'vigilance', 'deathtouch', 'lifelink',
    'menace', 'reach', 'defender', 'flash', 'hexproof', 'shroud', 'ward', 'prowess',
    'fear', 'intimidate', 'flanking', 'banding', 'first', 'double', 'strike',
    'protection', 'indestructible'];
  function isStop(s) {
    var words = s.toLowerCase().replace(/[,.]/g, '').split(/\s+/);
    var allAbil = words.length > 0;
    for (var i = 0; i < words.length; i++) if (ABIL.indexOf(words[i]) === -1) { allAbil = false; break; }
    if (allAbil) return true;
    // type line: starts with a card type AND carries the type-line dash
    return /^(legendary |basic |snow |token )?(creature|artifact|enchantment|instant|sorcery|planeswalker|land|battle)\b/i.test(s) && /(—|–|--| - )/.test(s);
  }

  // Names first (Title Case beats flavor text), keywords and type lines last.
  function rankCands(arr) {
    arr.sort(function (a, b) {
      var sa = isStop(a) ? 1 : 0, sb = isStop(b) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      return capScore(b) - capScore(a);
    });
    return arr;
  }

  function grayCanvas(cv) {
    var g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    var ctx = g.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.25)';
    ctx.drawImage(cv, 0, 0);
    return g;
  }

  function rotate90(cv, cw) {
    var g = document.createElement('canvas');
    g.width = cv.height; g.height = cv.width;
    var ctx = g.getContext('2d');
    ctx.translate(g.width / 2, g.height / 2);
    ctx.rotate((cw ? 1 : -1) * Math.PI / 2);
    ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return g;
  }

  /* PSM 3 (full auto layout) first: sparse mode (11) kept returning the
     flavor text and the artist credit while never even emitting the big
     bold TITLE line (runs 76-79 read "e:Add", "ring of purest gold",
     "EN Mine Birark" off Sol Ring photos). Auto layout treats the card
     like a page and finds display-size text; sparse stays as the backstop
     for photos auto-layout dismisses as one big picture.

     Cards photographed lying SIDEWAYS (owner report: table shot read only
     "Flying") get both 90° rotations tried. Only a LIVE STOCK MATCH stops
     the pass chain: a sideways image can OCR into name-shaped garbage
     ("MIMI INI - NT"), and run 83 proved fuzzy-rescuing that mid-chain
     lands on a real-but-wrong card (Dire Mimic). So every pass folds its
     candidates in and asks the shelf; no rows, next pass. Scryfall rescue
     waits until every angle has been tried. */
  function sparseFlow(cv) {
    status('Scanning the photo for a card name…');
    resetClues();
    var base = grayCanvas(resizeTo(cv, 2000));
    var seen = [];
    function fold(text) {
      harvestClues(text); // the collector line rides the same OCR passes
      collectCands(text).forEach(function (c) { if (seen.indexOf(c) === -1) seen.push(c); });
      // a printed YGO/OP code is the strongest read there is — it names the
      // exact printing by SKU, so it joins the very next batched query
      // (collectCands would drop it: "OP01-025" is only two letters)
      if (clue.code && seen.indexOf(clue.code) === -1) seen.unshift(clue.code);
      rankCands(seen);
    }
    // Rotations resample the ORIGINAL frame once (rotate full-res, then one
    // resize) — rotating the already-resized base added a second resample
    // that blurred the bold title below the layout detector's threshold
    // (run 84: the restored orientation read flavor text but not the name).
    var passes = [
      function () { return ocr(base, '3'); },
      function () { status('Trying a sideways read…'); return ocr(grayCanvas(resizeTo(rotate90(cv, true), 2000)), '3'); },
      function () { return ocr(grayCanvas(resizeTo(rotate90(cv, false), 2000)), '3'); },
      function () { return ocr(base, '11'); }
    ];
    function step(i) {
      if (i >= passes.length) {
        // rescue() also owns the no-candidates case: a blacked-out or
        // glare-ruined title can still leave a readable collector line
        return rescue(seen);
      }
      return passes[i]().then(function (text) {
        var before = seen.length;
        fold(text);
        if (!seen.length || seen.length === before) return step(i + 1);
        lastTitle = seen[0];
        status('Matching “' + seen[0] + '” against the shelf…');
        return fetchStock(seen).then(function (cards) {
          if (cards.length) {
            return withExact(cards).then(function (c2) {
              lastTitle = c2[0].name;
              return render(c2[0].name, c2);
            });
          }
          return step(i + 1);
        });
      });
    }
    return step(0).catch(function () {
      status('The reader failed to load — check your connection and try again.');
    });
  }

  function cleanTitle(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9!]+$/g, '');
    var letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) return '';
    return t.slice(0, 48);
  }

  // fraction of words starting with a capital ("Sol Ring" 1.0, "ring of
  // purest gold" 0.0)
  function capScore(s) {
    var w = s.split(' ');
    var caps = 0;
    for (var i = 0; i < w.length; i++) if (/^[A-Z]/.test(w[i])) caps++;
    return caps / w.length;
  }

  /* ---------- match + results ---------- */
  // OCR often reads art noise after the real title ("Sol Ring Nx IG ro
  // PE..."), so shrinking prefixes of a read ride along as candidates.
  function prefixes(title) {
    var words = title.split(' ');
    var out = [title];
    [5, 4, 3, 2].forEach(function (n) {
      if (words.length > n) {
        var t = words.slice(0, n).join(' ');
        if ((t.match(/[A-Za-z]/g) || []).length >= 3 && out.indexOf(t) === -1) out.push(t);
      }
    });
    return out;
  }

  /* /instock.json takes up to 16 |-separated names in one request, so every
     candidate line AND the first line's prefixes go out as a single call. */
  function fetchStock(cands) {
    var names = [];
    cands.forEach(function (c) { if (names.indexOf(c) === -1) names.push(c); });
    prefixes(cands[0]).forEach(function (c) { if (names.indexOf(c) === -1) names.push(c); });
    names = names.slice(0, 12);
    return fetch(W + '/instock.json?names=' + encodeURIComponent(names.join('|')) + '&max=6&game=' + encodeURIComponent(game))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.cards) || []; });
  }

  /* fallbackCv: the camera frame to re-read sparsely if the band read
     matched nothing; null once sparse already ran (no loops). */
  function runMatch(cands, fallbackCv) {
    lastTitle = cands[0];
    status('Matching “' + cands[0] + '” against the shelf…');
    return fetchStock(cands).then(function (cards) {
      if (cards.length) {
        return withExact(cards).then(function (c2) {
          lastTitle = c2[0].name; // canonical name for re-match + store link
          return render(c2[0].name, c2);
        });
      }
      if (fallbackCv) return sparseFlow(fallbackCv);
      return rescue(cands);
    }).catch(function () { status('Stock lookup failed — try again in a moment.'); });
  }

  /* ---------- collector-line matching ---------- */
  function setNameFor(code) {
    if (setNames[code]) return Promise.resolve(setNames[code]);
    return fetch('https://api.scryfall.com/sets/' + encodeURIComponent(code))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.name) setNames[code] = j.name; return setNames[code] || ''; })
      .catch(function () { return ''; });
  }

  // Move the clue-named printing to the top: badge the row in place when the
  // cheapest pick already IS that printing, otherwise synthesize a row from
  // the matching offer so the exact copy sits first with the cheaper
  // alternative still visible below it.
  function spliceExact(cards, offer, label) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].variantId === offer.variantId) {
        cards[i]._badge = label;
        cards.unshift(cards.splice(i, 1)[0]);
        return cards;
      }
    }
    cards.unshift({
      name: offer.name, set: offer.set, price: offer.price, condition: offer.condition,
      foil: offer.foil, image: offer.image, variantId: offer.variantId, url: offer.url, _badge: label
    });
    return cards;
  }

  function firstOffer(cards, test) {
    for (var i = 0; i < cards.length; i++) {
      var os = cards[i].offers || [];
      for (var k = 0; k < os.length; k++) if (test(os[k])) return os[k];
    }
    return null;
  }

  /* When the collector line named the printing, surface THAT printing —
     the top row is otherwise the cheapest across sets. Yu-Gi-Oh brackets
     ARE the code; One Piece codes live in SKUs, so an absent bracket match
     falls back to one code-mode stock query. MTG maps the set code to its
     name (Scryfall /sets, cached) and matches the [Set] bracket; Pokémon
     and Star Wars match the collector number in the product handle
     ("charizard-14-sm-team-up"). A clue that matches nothing leaves the
     rows alone and gets an honest "not on the shelf" note instead. */
  function withExact(cards) {
    if (!cards.length) return Promise.resolve(cards);
    if (clue.code) {
      var co = firstOffer(cards, function (o) {
        return (o.set || '').toUpperCase().indexOf(clue.code) > -1 || (o.url || '').toUpperCase().indexOf(clue.code) > -1;
      });
      if (co) return Promise.resolve(spliceExact(cards, co, 'Exact printing'));
      return fetchStock([clue.code]).then(function (cc) {
        if (cc.length) {
          cc[0]._badge = 'Exact printing';
          var seenV = { };
          cc.forEach(function (c) { seenV[c.variantId] = 1; });
          return cc.concat(cards.filter(function (c) { return !seenV[c.variantId]; }));
        }
        clue.miss = clue.code;
        return cards;
      }).catch(function () { return cards; });
    }
    if (game === 'mtg' && clue.set) {
      return setNameFor(clue.set).then(function (sn) {
        if (!sn) return cards;
        // brackets and Scryfall names drift a little ("Commander 2021" vs a
        // suffixed bracket) — containment either way counts, exact never lies
        var snl = sn.toLowerCase();
        var so = firstOffer(cards, function (o) {
          var os = (o.set || '').toLowerCase();
          return os && (os === snl || os.indexOf(snl) > -1 || (os.length >= 6 && snl.indexOf(os) > -1));
        });
        if (so) return spliceExact(cards, so, 'From your card’s set');
        clue.miss = sn;
        return cards;
      });
    }
    if ((game === 'pokemon' || game === 'starwars') && clue.num) {
      var re = new RegExp('-' + clue.num + '(-|$)');
      var no = firstOffer(cards, function (o) {
        var path = String(o.url || '').split('?')[0];
        return re.test(path) || String(o.set || '').indexOf(clue.num + '/' + (clue.den || '')) > -1;
      });
      if (no) return Promise.resolve(spliceExact(cards, no, 'Exact printing'));
      clue.miss = '#' + clue.num + (clue.den ? '/' + clue.den : '');
      return Promise.resolve(cards);
    }
    return Promise.resolve(cards);
  }

  /* The collector line identifies the card even when no title read matched:
     YGO/OP codes go straight to stock (SKU-prefix match = the exact
     printing); MTG set+number resolve through Scryfall first. Shelf-gated
     like every other read — resolves null so rescue can fall through to
     the fuzzy pass. */
  function clueLookup() {
    if (clue.code) {
      status('Trying the printed code ' + clue.code + '…');
      return fetchStock([clue.code]).then(function (cards) {
        if (!cards.length) return null;
        clue.exact = 1;
        cards.forEach(function (c) { c._badge = 'Exact printing'; });
        lastTitle = cards[0].name;
        render(cards[0].name, cards);
        return 1;
      }).catch(function () { return null; });
    }
    if (game === 'mtg' && clue.set && clue.num) {
      status('Trying the collector line ' + clue.set.toUpperCase() + ' #' + clue.num + '…');
      return fetch('https://api.scryfall.com/cards/' + encodeURIComponent(clue.set) + '/' + encodeURIComponent(String(+clue.num)))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (sc) {
          if (!sc || !sc.name) return null;
          if (sc.set_name) setNames[clue.set] = sc.set_name;
          var nm = sc.name.split(' // ')[0];
          return fetchStock([nm]).then(function (cards) {
            if (!cards.length) return null;
            clue.exact = 1;
            return withExact(cards).then(function (c2) {
              lastTitle = c2[0].name;
              render(c2[0].name, c2);
              return 1;
            });
          });
        }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function rescue(cands) {
    return clueLookup().then(function (hit) {
      if (hit) return;
      if (!cands.length) {
        status('Couldn’t read a name — fill the frame, avoid glare, and try again.');
        return;
      }
      return rescueFuzzy(cands);
    });
  }

  function rescueFuzzy(cands) {
    if (game === 'mtg') {
      // Scryfall fuzzy rescue for Magic names, seeded with the trimmed
      // reads (fuzzy fixes typos, not trailing junk words). Up to three
      // name-shaped candidates get a turn — a glare-garbled title often
      // sits second or third behind cleaner-but-wrong reads.
      var seeds = [];
      cands.forEach(function (c) {
        if (isStop(c) || seeds.length >= 3) return;
        var p = prefixes(c)[1] || c;
        if (seeds.indexOf(p) === -1) seeds.push(p);
      });
      if (!seeds.length) seeds.push(prefixes(cands[0])[1] || cands[0]);
      var i = 0;
      var tryNext = function () {
        if (i >= seeds.length) { render(cands[0], []); return; }
        var seed = seeds[i++];
        return fetch('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(seed))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (sc) {
            if (sc && sc.name) {
              lastTitle = sc.name;
              return fetch(W + '/instock.json?names=' + encodeURIComponent(sc.name) + '&max=6&game=mtg')
                .then(function (r2) { return r2.ok ? r2.json() : null; })
                .then(function (j2) {
                  var cards = (j2 && j2.cards) || [];
                  if (!cards.length) return render(sc.name, cards);
                  return withExact(cards).then(function (c2) { render(sc.name, c2); });
                });
            }
            return tryNext();
          }).catch(function () { return tryNext(); });
      };
      return tryNext();
    }
    render(cands[0], []);
  }

  function lookup(title, isRematch) {
    if (isRematch) status('Re-matching “' + title + '” against the shelf…');
    runMatch([title], null);
  }

  function render(title, cards) {
    status('');
    var res = overlay.querySelector('.xg-scan__res');
    var rows = cards.map(function (c, i) {
      var sub = [c.set, c.condition, c.foil ? 'Foil' : ''].filter(Boolean).join(' · ');
      var badge = c._badge ? '<span class="xg-scan__exact">' + esc(c._badge) + '</span>' : '';
      return '<div class="xg-scan__row">' +
        (c.image ? '<img class="xg-scan__img" src="' + esc(c.image) + '" alt="" loading="lazy">' : '<span class="xg-scan__img"></span>') +
        '<div class="xg-scan__info">' +
          '<div class="xg-scan__name"><a href="' + esc(c.url) + '">' + esc(c.name) + '</a></div>' +
          (badge || sub ? '<div class="xg-scan__sub">' + badge + esc(sub) + '</div>' : '') +
        '</div>' +
        '<span class="xg-scan__price">$' + esc(c.price) + '</span>' +
        (c.variantId ? '<button type="button" class="xg-scan__addbtn" data-vid="' + esc(c.variantId) + '" data-name="' + esc(c.name) + '" data-img="' + esc(c.image || '') + '" aria-label="Add ' + esc(c.name) + ' to cart">' + IC_CART + '</button>' : '') +
      '</div>';
    }).join('');
    // What the collector line said, so the shopper can see the basis of the
    // match ("collector line" prefix = the line, not the title, found it).
    var chipTxt = '';
    if (clue.code) chipTxt = clue.code;
    else if (clue.set) chipTxt = clue.set.toUpperCase() + (clue.num ? ' · #' + clue.num : '');
    else if (clue.num && clue.den) chipTxt = '#' + clue.num + '/' + clue.den;
    var chip = chipTxt ? ' <span class="xg-scan__cluechip">' + (clue.exact ? 'collector line · ' : '') + esc(chipTxt) + '</span>' : '';
    var missNote = (clue.miss && cards.length)
      ? '<p class="xg-scan__read">Your exact printing (' + esc(clue.miss) + ') isn’t on the shelf — other printings below.</p>'
      : '';
    res.innerHTML =
      '<p class="xg-scan__read">Read: <b>“' + esc(title) + '”</b>' + chip + (cards.length ? '' : ' — nothing on the shelf under that name.') + '</p>' +
      missNote +
      rows +
      '<div class="xg-scan__foot">' +
        '<button type="button" class="xg-scan__link" data-act="again">‹ Scan again</button>' +
        '<a class="xg-scan__link" href="' + esc(SEARCH_URL + encodeURIComponent(title)) + '">Search the store for “' + esc(title) + '” ›</a>' +
      '</div>';
    overlay.classList.add('has-results');
    res.querySelector('[data-act=again]').addEventListener('click', function () {
      overlay.classList.remove('has-results');
      status('');
      layoutGuide();
    });
  }

  // Bound once (build() calls this); .xg-scan__res persists across renders,
  // so binding inside render() would stack a listener per scan.
  function onResultsClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('.xg-scan__addbtn') : null;
    if (!b || b.getAttribute('data-busy')) return;
    b.setAttribute('data-busy', '1');
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: +b.getAttribute('data-vid'), quantity: 1 }] })
    }).then(function (r) {
      if (!r.ok) throw new Error('add ' + r.status);
      b.classList.add('is-added');
      b.innerHTML = IC_CHECK;
      try {
        var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown;
        if (typeof sync === 'function') sync();
      } catch (err) {}
      if (window.xgCartPeek) window.xgCartPeek({ title: b.getAttribute('data-name'), image: b.getAttribute('data-img') || null });
      setTimeout(function () { b.classList.remove('is-added'); b.innerHTML = IC_CART; b.removeAttribute('data-busy'); }, 1800);
    }).catch(function () {
      b.innerHTML = '&times;';
      b.setAttribute('title', 'Just sold — open the card for other printings');
      setTimeout(function () { b.innerHTML = IC_CART; b.removeAttribute('data-busy'); }, 2200);
    });
  }

  function init() {
    injectButtons();
    // Searchanise re-renders parts of the search page after load
    setTimeout(injectButtons, 1500);
    setTimeout(injectButtons, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
