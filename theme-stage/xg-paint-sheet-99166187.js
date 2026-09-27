/* Paint sheet: the colour picker's bottle sheet, for any page (owner 2026-09-27: "when paints are
   clicked on it opens in the way the colour picker, showing the alternatives/similar colours").
   Used by the "Paint it like the box" card (snippets/xg-eavy.liquid).

   window.xgPaintSheet.open({ handle, name })  - opens the bottle whose product handle is given:
   photo, range and code, other bottles of that colour, price, stock, quantity, Add to cart, the
   product page, and the closest colours from the other brands (the picker's own rules: CIEDE2000
   under 10, like-for-like kind, hue within 25 degrees, in stock preferred). A sold-out bottle also
   gets the nearest in-stock colour of its own brand. Tapping a match opens that paint here.

   window.xgPaintSheet.strip(el, handle)  - on a paint's own product page (owner 2026-09-27: "the
   similar colors to show on the individual paint product screens ... sort of like the cards with
   similar effects"): fills el with a side-scrolling row of the nearest in-stock colours, every
   brand including this one (same rules, at most 3 per brand, 8 in all); a tile opens the sheet.
   Nothing shows when the handle is not a paint we list or nothing close is in stock.
   Data: the worker's /paints.json (loaded once, on the first open). Colour maths copied from
   sections/xg-paint-picker.liquid - keep the two in step. */
(function () {
  if (window.xgPaintSheet) return;
  var SRC = 'https://exor-binder.nevski.workers.dev/paints.json';
  var BRANDS = ['Citadel', 'The Army Painter', 'Vallejo'];
  var SHORT = { 'Citadel': 'Warhammer', 'The Army Painter': 'Army Painter', 'Vallejo': 'Vallejo' };
  var RANGES = {
    'Citadel': ['Base', 'Layer', 'Shade', 'Contrast', 'Dry', 'Technical', 'Air', 'Spray', 'Glaze'],
    'The Army Painter': ['Warpaints', 'Warpaints Fanatic', 'Warpaints Fanatic Wash', 'Speedpaint', 'Speedpaint Marker', 'Warpaints Air', 'Warpaints Primer', 'Quickshade Washes Set'],
    'Vallejo': ['Game Color', 'Game Air', 'Model Color', 'Model Air', 'Mecha Color', 'Xpress Color Intense', 'Xpress Color', 'Panzer Aces', 'Metal Color', 'Surface Primer', 'Wash FX', 'Weathering FX']
  };
  function thumb(src, w) { return src ? src.replace(/(\.[a-z]+)(\?|$)/i, '_' + w + 'x$1$2') : ''; }
  function rgb(hex) { hex = hex.replace('#', ''); return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255]; }
  function hsl(hex) {
    var c = rgb(hex), r = c[0], g = c[1], b = c[2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return [h, s, l];
  }
  // sRGB -> CIE Lab (D65)
  function lab(hex) {
    var c = rgb(hex).map(function (v) { return v > .04045 ? Math.pow((v + .055) / 1.055, 2.4) : v / 12.92; });
    var x = (c[0] * .4124 + c[1] * .3576 + c[2] * .1805) / .95047, y = c[0] * .2126 + c[1] * .7152 + c[2] * .0722, z = (c[0] * .0193 + c[1] * .1192 + c[2] * .9505) / 1.08883;
    var f = function (t) { return t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  // CIEDE2000 colour difference
  function de2000(a, b) {
    var rad = Math.PI / 180, L1 = a[0], a1 = a[1], b1 = a[2], L2 = b[0], a2 = b[1], b2 = b[2];
    var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cm = (C1 + C2) / 2;
    var G = .5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
    var a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = C1p ? (Math.atan2(b1, a1p) / rad + 360) % 360 : 0, h2p = C2p ? (Math.atan2(b2, a2p) / rad + 360) % 360 : 0;
    var dL = L2 - L1, dC = C2p - C1p, dh = 0;
    if (C1p * C2p) { dh = h2p - h1p; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
    var dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh / 2 * rad);
    var Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2, hm = h1p + h2p;
    if (C1p * C2p) { hm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2; }
    var T = 1 - .17 * Math.cos((hm - 30) * rad) + .24 * Math.cos(2 * hm * rad) + .32 * Math.cos((3 * hm + 6) * rad) - .2 * Math.cos((4 * hm - 63) * rad);
    var SL = 1 + .015 * (Lm - 50) * (Lm - 50) / Math.sqrt(20 + (Lm - 50) * (Lm - 50)), SC = 1 + .045 * Cmp, SH = 1 + .015 * Cmp * T;
    var RT = -2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7))) * Math.sin(60 * Math.exp(-Math.pow((hm - 275) / 25, 2)) * rad);
    return Math.sqrt(Math.pow(dL / SL, 2) + Math.pow(dC / SC, 2) + Math.pow(dH / SH, 2) + RT * (dC / SC) * (dH / SH));
  }
  var METAL = /gold|silver|bronze|copper|brass|steel|gunmetal|chainmail|metal|\btin\b|pewter|chrome|leadbelcher|ironbreaker|retributor|alloy|runefang|stormhost|auric|gehenna|sycorax|plate mail|\biron\b|aluminium|mithril/;
  var WASH = /\bwash|\bink\b|\bshade\b|\btone\b|quickshade/;
  function family(g) {
    var n = g.n.toLowerCase(), r = g.items.map(function (it) { return it.r; }).join(' ').toLowerCase();
    if (METAL.test(n) || /metal/.test(r)) return 'metal';
    if (WASH.test(n) || /shade|wash/.test(r)) return 'wash';
    if (!g.h) return 'other';
    if (/flesh|skin/.test(n)) return 'flesh';
    // a paint named as a brown is one ("Oak Brown", "Doombull Brown" are deep, saturated red-browns)
    if (/brown|umber|hide|bark|soil|leather|earth|mud|rust|wood/.test(n)) return 'brown';
    var t = hsl(g.h), h = t[0], s = t[1], l = t[2];
    if (s < .13 || l < .09 || l > .93) return 'grey';
    if (h >= 15 && h < 48 && l < .5 && s < .75) return 'brown';
    // muted, dark red hues read as brown, not red (owner 2026-09-26: Ruddy Umber, Tree Ancient,
    // Dryad Brown and Wasteland Soil sat at the start of the reds)
    if ((h < 15 || h >= 340) && s < .45 && l < .5 && !/red|crimson|scarlet|blood|burgundy|wine|maroon|gore/.test(n)) return 'brown';
    if (h < 12 || h >= 345) return 'red';
    if (h < 40) return 'orange';
    if (h < 68) return 'yellow';
    if (h < 170) return 'green';
    if (h < 255) return 'blue';
    if (h < 300) return 'purple';
    return 'pink';
  }
  // what a paint does, so a match is a like-for-like swap
  function kind(g) {
    var r = g.items.map(function (it) { return it.r; }).join(' ');
    if (g.fam === 'wash') return 'wash';
    if (g.fam === 'metal') return 'metal';
    if (/Contrast|Speedpaint|Xpress/.test(r)) return 'contrast';
    if (/Technical|Weathering/.test(r)) return 'fx';
    if (/Primer|Spray/.test(r)) return 'primer';
    return 'paint';
  }
  function chroma(g) { return g.sat > .15 && g.l > .08 && g.l < .95; }
  function hueGap(a, b) { var x = Math.abs(a.hue - b.hue) % 360; return x > 180 ? 360 - x : x; }
  function rangeIdx(b, r) { var i = (RANGES[b] || []).indexOf(r); return i < 0 ? 99 : i; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(c) { return '$' + (Number(c) || 0).toFixed(2); }

  var paints = null, byHandle = {}, loading = null;
  function load() {
    if (loading) return loading;
    loading = fetch(SRC).then(function (r) { return r.json(); }).then(function (j) {
      paints = (j && j.swatches || []).filter(function (g) { return BRANDS.indexOf(g.b) > -1 && g.items && g.items.length; });
      paints.forEach(function (g) {
        g.fam = family(g); g.kind = kind(g); g.dry = g.items.every(function (it) { return it.r === 'Dry'; });
        if (g.h) { g.lab = lab(g.h); var t = hsl(g.h); g.hue = t[0]; g.sat = t[1]; g.l = t[2]; }
        g.items.sort(function (x, y) { return rangeIdx(g.b, x.r) - rangeIdx(g.b, y.r) || (parseFloat(x.s) || 0) - (parseFloat(y.s) || 0); });
        g.items.forEach(function (it) { byHandle[it.u] = g; });
      });
      return paints;
    });
    loading.catch(function () { loading = null; });
    return loading;
  }
  // the picker's rules, plus: a sold-out colour also gets its own brand's nearest in-stock colour
  function matches(g) {
    if (!g.lab) return [];
    var out = [], soldOut = !g.items.some(function (it) { return it.a; });
    BRANDS.forEach(function (b) {
      if (b === g.b && !soldOut) return;
      var best = null;
      paints.forEach(function (o) {
        if (o === g || o.b !== b || !o.lab || o.kind !== g.kind) return;
        if (chroma(g) && chroma(o) && hueGap(g, o) > 25) return;
        var d = de2000(g.lab, o.lab), stock = o.items.some(function (it) { return it.a; });
        if (b === g.b && !stock) return;
        var score = d + (stock ? 0 : 2.5);
        if (o.dry && !g.dry) score += 3;
        if (d < 10 && (!best || score < best.score)) best = { g: o, d: d, score: score, stock: stock, same: b === g.b };
      });
      if (best) out.push(best); else if (b !== g.b) out.push({ none: b, d: 99 });
    });
    return out.sort(function (a, b) { return (b.same ? 1 : 0) - (a.same ? 1 : 0) || a.d - b.d; });
  }

  // the nearest in-stock colours of every brand, for the product-page strip
  function similar(g, max) {
    if (!g.lab) return [];
    var list = [];
    paints.forEach(function (o) {
      if (o === g || !o.lab || o.kind !== g.kind) return;
      if (!o.items.some(function (it) { return it.a; })) return;
      if (chroma(g) && chroma(o) && hueGap(g, o) > 25) return;
      var d = de2000(g.lab, o.lab);
      if (d < 12) list.push({ g: o, d: d + (o.dry && !g.dry ? 3 : 0) });
    });
    list.sort(function (a, b) { return a.d - b.d; });
    var per = {}, out = [];
    list.forEach(function (x) { if (out.length < max && (per[x.g.b] = (per[x.g.b] || 0) + 1) <= 3) out.push(x); });
    return out;
  }
  var STRIP_CSS = '.xg-pss{margin:16px 0 6px}.xg-pss__t{font-family:var(--xg-font-display,"Oswald","Arial Narrow",sans-serif);font-size:19px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;color:var(--xg-ink,#171b1d);margin:0 0 10px}' +
    '.xg-pss__row{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;scrollbar-width:thin}' +
    '.xg-pss__c{flex:0 0 116px;width:116px;scroll-snap-align:start;text-align:center;background:var(--xg-surface,#fff);border:1px solid var(--xg-border,#e3e6e8);border-radius:10px;padding:8px 8px 10px;cursor:pointer;color:inherit;font:inherit;transition:border-color .15s,transform .15s}' +
    '.xg-pss__c:hover,.xg-pss__c:focus-visible{border-color:var(--xg-ink,#171b1d);transform:translateY(-1px)}' +
    '.xg-pss__img{position:relative;display:block;height:96px;margin:0 0 6px;background:#fff;border-radius:6px}.xg-pss__img img{width:100%;height:100%;object-fit:contain}' +
    '.xg-pss__dot{position:absolute;left:4px;bottom:4px;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 -4px 7px rgba(0,0,0,.25),0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.3)}' +
    '.xg-pss__n{display:block;font-size:12.5px;font-weight:600;line-height:1.25;color:var(--xg-ink,#171b1d)}.xg-pss__b{display:block;font-size:11px;color:var(--xg-muted,#6b757c);margin-top:2px}' +
    '.xg-pss__p{display:block;font-size:12.5px;font-weight:700;color:var(--xg-ink,#171b1d);margin-top:3px}.xg-pss__m{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--xg-muted,#6b757c);margin-top:2px}';
  var stripCssDone = false;

  var CSS = '.xg-ps{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:16px}.xg-ps[hidden]{display:none}' +
    '.xg-ps__bg{position:absolute;inset:0;background:rgba(8,10,12,.62)}' +
    '.xg-ps__card{position:relative;background:var(--xg-surface,#fff);color:var(--xg-text,#3d454b);border-radius:16px;max-width:660px;width:100%;max-height:94vh;overflow-y:auto;display:grid;grid-template-columns:1fr 1.1fr;box-shadow:0 20px 60px rgba(0,0,0,.45);font-family:var(--xg-font-body,inherit)}' +
    '.xg-ps__photo{background:#fff;display:flex;align-items:center;justify-content:center;padding:18px;min-height:260px;border-radius:16px 0 0 0}.xg-ps__photo img{max-width:100%;max-height:300px;object-fit:contain}' +
    '.xg-ps__info{padding:22px 22px 18px}.xg-ps__chip{height:48px;border-radius:10px;margin-bottom:12px;box-shadow:inset 0 -10px 18px rgba(0,0,0,.2),0 0 0 1px rgba(0,0,0,.1)}' +
    '.xg-ps__range{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--xg-muted,#6b757c)}' +
    '.xg-ps .xg-ps__name{margin:2px 0 8px;font-family:var(--xg-font-display,inherit);color:var(--xg-ink,#171b1d)!important;font-size:24px;line-height:1.1;text-transform:uppercase}' +
    '.xg-ps__opts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.xg-ps__opts button{font:600 12px/1.2 inherit;border:1px solid var(--xg-border,#d5dbe0);background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);border-radius:8px;padding:7px 10px;cursor:pointer;text-align:left}' +
    '.xg-ps__opts button span{display:block;font-weight:500;color:var(--xg-muted,#6b757c);margin-top:2px}.xg-ps__opts button[aria-pressed="true"]{border-color:var(--xg-red,#d62c28);box-shadow:0 0 0 1px var(--xg-red,#d62c28)}.xg-ps__opts button.is-out{opacity:.55}' +
    '.xg-ps__price{margin:0;font-size:20px;font-weight:700;color:var(--xg-ink,#171b1d)}.xg-ps__avail{margin:2px 0 14px;font-size:13px}.xg-ps__avail.ok{color:var(--xg-success,#1f9d55)}.xg-ps__avail.no{color:var(--xg-danger,#d62c28)}' +
    '.xg-ps__buy{display:flex;gap:8px}.xg-ps__qty{display:flex;border:1px solid var(--xg-border,#d5dbe0);border-radius:8px;overflow:hidden}.xg-ps__qty button{width:34px;border:0;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);font-size:18px;cursor:pointer}' +
    '.xg-ps__qty input{width:42px;text-align:center;border:0;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);-moz-appearance:textfield}.xg-ps__qty input::-webkit-inner-spin-button{-webkit-appearance:none}' +
    '.xg-ps__add{flex:1;background:var(--xg-red,#d62c28);color:#fff!important;border:0;border-radius:8px;font-weight:700;padding:11px 14px;cursor:pointer;font-family:inherit}.xg-ps__add[disabled]{background:#8a969d;cursor:not-allowed}' +
    '.xg-ps__msg{min-height:18px;font-size:13px;margin:8px 0 4px}.xg-ps__msg a{color:var(--xg-red,#d62c28);font-weight:600}.xg-ps .xg-ps__link{font-size:13px;color:var(--xg-muted,#6b757c)!important}' +
    '.xg-ps__match{grid-column:1/-1;border-top:1px solid var(--xg-border,#e3e7ea);padding:14px 22px 18px}.xg-ps__match[hidden]{display:none}' +
    '.xg-ps__mh{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--xg-muted,#6b757c);font-weight:700}' +
    '.xg-ps__ml{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}.xg-ps__none{margin:4px 0 0;font-size:13px;opacity:.65}' +
    '.xg-ps__m{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid var(--xg-border,#d5dbe0);background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);border-radius:10px;padding:8px 10px;cursor:pointer;font:600 13px/1.25 inherit}' +
    '.xg-ps__m:hover,.xg-ps__m:focus-visible{border-color:var(--xg-ink,#171b1d)}.xg-ps__m i{flex:0 0 34px;height:34px;border-radius:50%;box-shadow:inset 0 -5px 9px rgba(0,0,0,.25),0 0 0 1px rgba(0,0,0,.12)}' +
    '.xg-ps__m span{display:block;font-weight:500;font-size:11px;color:var(--xg-muted,#6b757c);margin-top:2px}.xg-ps__m.is-out{opacity:.6}' +
    '.xg-ps__x{position:absolute;top:8px;right:10px;z-index:2;background:rgba(0,0,0,.35);color:#fff;border:0;width:32px;height:32px;border-radius:50%;font-size:22px;line-height:1;cursor:pointer}' +
    '@media (max-width:600px){.xg-ps__card{grid-template-columns:1fr;max-height:92vh}.xg-ps__photo{min-height:190px;border-radius:16px 16px 0 0}.xg-ps__photo img{max-height:210px}}';

  var root = null, curG = null, cur = null;
  function $(s) { return root.querySelector(s); }
  function mount() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.className = 'xg-ps'; root.hidden = true;
    root.innerHTML = '<div class="xg-ps__bg" data-close></div><div class="xg-ps__card" role="dialog" aria-modal="true" aria-labelledby="xg-ps-name">' +
      '<button class="xg-ps__x" type="button" data-close aria-label="Close">&times;</button>' +
      '<div class="xg-ps__photo"><img alt=""></div><div class="xg-ps__info"><div class="xg-ps__chip"></div><p class="xg-ps__range"></p>' +
      '<h3 id="xg-ps-name" class="xg-ps__name"></h3><div class="xg-ps__opts" role="group" aria-label="Bottle" hidden></div><p class="xg-ps__price"></p><p class="xg-ps__avail"></p>' +
      '<div class="xg-ps__buy"><div class="xg-ps__qty"><button type="button" data-q="-1" aria-label="Less">&minus;</button><input type="number" min="1" value="1" aria-label="Quantity"><button type="button" data-q="1" aria-label="More">+</button></div>' +
      '<button class="xg-ps__add" type="button">Add to cart</button></div><p class="xg-ps__msg" aria-live="polite"></p><a class="xg-ps__link" href="#">Full product page &rsaquo;</a></div>' +
      '<div class="xg-ps__match" hidden><p class="xg-ps__mh">Closest from other brands</p><div class="xg-ps__ml"></div></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      var t = e.target.closest('button, [data-close]');
      if (!t) return;
      if (t.hasAttribute('data-close')) return close();
      if (t.hasAttribute('data-o') && curG) return pick(curG.items[+t.getAttribute('data-o')]);
      if (t.hasAttribute('data-g')) return show(paints[+t.getAttribute('data-g')]);
      if (t.hasAttribute('data-q')) { var inp = $('.xg-ps__qty input'); inp.value = Math.max(1, (+inp.value || 1) + (+t.getAttribute('data-q'))); return; }
      if (t.classList.contains('xg-ps__add') && cur) add(t);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && !root.hidden) close(); });
  }
  function close() { root.hidden = true; }
  function pick(it) {
    cur = it;
    var im = $('.xg-ps__photo img');
    im.hidden = !it.i; if (it.i) { im.src = thumb(it.i, 480); im.alt = it.t; } else im.removeAttribute('src');
    $('.xg-ps__photo').style.background = it.i ? '#fff' : (curG.h || '#fff');
    $('.xg-ps__range').textContent = SHORT[curG.b] + ' ' + it.r + (it.c ? ' · ' + it.c : '');
    $('.xg-ps__price').textContent = money(it.p);
    var a = $('.xg-ps__avail'); a.textContent = it.a ? 'In stock' : 'Sold out'; a.className = 'xg-ps__avail ' + (it.a ? 'ok' : 'no');
    $('.xg-ps__add').disabled = !it.a; $('.xg-ps__msg').textContent = '';
    $('.xg-ps__link').href = '/products/' + encodeURIComponent(it.u);
    [].forEach.call(root.querySelectorAll('.xg-ps__opts button'), function (b) { b.setAttribute('aria-pressed', String(curG.items[+b.getAttribute('data-o')] === it)); });
  }
  function show(g, it) {
    curG = g;
    $('.xg-ps__chip').style.background = g.h || '#ccc';
    $('.xg-ps__name').textContent = g.n;
    var opts = $('.xg-ps__opts');
    opts.hidden = g.items.length < 2;
    opts.innerHTML = g.items.length > 1 ? g.items.map(function (x, i) {
      return '<button type="button" data-o="' + i + '" class="' + (x.a ? '' : 'is-out') + '">' + esc(x.r + (x.s ? ' ' + x.s : '')) + '<span>' + money(x.p) + (x.a ? '' : ' · sold out') + '</span></button>';
    }).join('') : '';
    $('.xg-ps__qty input').value = 1;
    pick(it || g.items.filter(function (x) { return x.a; })[0] || g.items[0]);
    var m = matches(g);
    $('.xg-ps__match').hidden = !m.length;
    $('.xg-ps__mh').textContent = m.some(function (x) { return x.same; }) ? 'Similar colours' : 'Closest from other brands';
    $('.xg-ps__ml').innerHTML = m.map(function (x) {
      if (x.none) return '<p class="xg-ps__none">No close ' + esc(SHORT[x.none]) + ' match</p>';
      var o = x.g, first = o.items.filter(function (y) { return y.a; })[0] || o.items[0];
      return '<button type="button" class="xg-ps__m' + (x.stock ? '' : ' is-out') + '" data-g="' + paints.indexOf(o) + '"><i style="background:' + esc(o.h) + '"></i><div>' + esc(o.n) +
        '<span>' + esc(SHORT[o.b] + ' ' + first.r + (first.c ? ' · ' + first.c : '')) + '</span><span>' + (x.same ? 'In stock instead' : x.d < 3 ? 'Very close match' : x.d < 6 ? 'Close match' : 'Similar') + (x.stock ? '' : ' · sold out') + '</span></div></button>';
    }).join('');
    root.hidden = false; $('.xg-ps__card').scrollTop = 0;
  }
  function add(t) {
    t.disabled = true; $('.xg-ps__msg').textContent = 'Adding…';
    fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: cur.v, quantity: Math.max(1, +$('.xg-ps__qty input').value || 1) }] }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        t.disabled = false;
        $('.xg-ps__msg').innerHTML = x.ok ? 'Added to your cart. <a href="/cart">View cart</a>' : esc((x.j && (x.j.description || x.j.message)) || 'Could not add - please try again.');
        if (x.ok) {
          document.dispatchEvent(new CustomEvent('cart:refresh'));
          try { var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown; if (typeof sync === 'function') sync(); } catch (e) {}
        }
      })
      .catch(function () { t.disabled = false; $('.xg-ps__msg').textContent = 'Could not add - please try again.'; });
  }
  window.xgPaintSheet = {
    // resolves true when it opened; false (data down, handle unknown) lets the caller follow the link
    open: function (o) {
      return load().then(function () {
        var g = byHandle[o.handle];
        if (!g) return false;
        mount();
        show(g, g.items.filter(function (x) { return x.u === o.handle; })[0]);
        return true;
      }, function () { return false; });
    },
    preload: load,
    strip: function (el, handle) {
      return load().then(function () {
        var g = byHandle[handle];
        var sims = g ? similar(g, 8) : [];
        if (!sims.length) return false;
        if (!stripCssDone) { var st = document.createElement('style'); st.textContent = STRIP_CSS; document.head.appendChild(st); stripCssDone = true; }
        el.classList.add('xg-pss');
        el.innerHTML = '<p class="xg-pss__t">Similar colours in stock</p><div class="xg-pss__row">' + sims.map(function (x) {
          var o = x.g, it = o.items.filter(function (y) { return y.a; })[0];
          return '<button type="button" class="xg-pss__c" data-h="' + esc(it.u) + '" title="' + esc(it.t) + '">' +
            '<span class="xg-pss__img"' + (it.i ? '' : ' style="background:' + esc(o.h) + '"') + '>' + (it.i ? '<img src="' + esc(thumb(it.i, 240)) + '" alt="" loading="lazy">' : '') + '<i class="xg-pss__dot" style="background:' + esc(o.h) + '"></i></span>' +
            '<span class="xg-pss__n">' + esc(o.n) + '</span><span class="xg-pss__b">' + esc(SHORT[o.b] + ' ' + it.r) + '</span>' +
            '<span class="xg-pss__p">' + money(it.p) + '</span><span class="xg-pss__m">' + (x.d < 3 ? 'Very close' : x.d < 6 ? 'Close' : 'Similar') + '</span></button>';
        }).join('') + '</div>';
        el.addEventListener('click', function (e) {
          var c = e.target.closest && e.target.closest('.xg-pss__c');
          if (!c) return;
          var h = c.getAttribute('data-h');
          window.xgPaintSheet.open({ handle: h }).then(function (ok) { if (!ok) location.href = '/products/' + encodeURIComponent(h); });
        });
        el.hidden = false;
        return true;
      }, function () { return false; });
    }
  };
})();
