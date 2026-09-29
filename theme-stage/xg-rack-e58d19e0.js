/* Exor Games - "My paint rack" (owner, 2026-09-29: "Do My paint rack").

   A shopper ticks the paints (and hobby tools) they already own; every paint list on
   the site then says "you have 3 of 8" and the add-everything buttons leave those
   out. Kept in this browser (localStorage), so it works signed in or not; nothing is
   sent anywhere.

   A paint is keyed by COLOUR (brand + name), not by pot: a Mephiston Red base pot and
   the 18 ml tub count as the same paint. Tools are keyed "tool:<kind>" (clippers,
   glue, primer ...).

   window.xgRack
     has(key)                  true when owned
     set(key, on, meta)        meta {n: name, b: brand, h: hex, u: product handle}
     key(brand, name)          the colour key used for paints
     paints()                  [{k, n, b, h, u}] newest first
     count()                   paints owned
     on(fn)                    fn() after any change, from any tab
     open()                    the "My paint rack" sheet: every owned paint, remove one,
                               clear all */
(function () {
  'use strict';
  if (window.xgRack) return;
  var LS = 'xg-rack-v1', subs = [];
  function read() {
    try { var j = JSON.parse(localStorage.getItem(LS) || '{}'); return j && typeof j === 'object' && j.items ? j : { items: {} }; }
    catch (e) { return { items: {} }; }
  }
  var data = read();
  function save() { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) {} fire(); }
  function fire() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  window.addEventListener('storage', function (e) { if (e.key === LS) { data = read(); fire(); } });
  function key(b, n) { return String(b || 'citadel').toLowerCase().replace(/[^a-z]/g, '') + '|' + String(n || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var CSS = '.xg-rk{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}.xg-rk[hidden]{display:none}' +
    '.xg-rk__bg{position:absolute;inset:0;background:rgba(10,13,15,.55)}' +
    '.xg-rk__card{position:relative;width:min(440px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:16px;background:var(--xg-surface,#fff);color:var(--xg-ink,#171b1d);box-shadow:0 24px 60px rgba(0,0,0,.4);font-size:14px}' +
    '.xg-rk__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 10px;border-bottom:1px solid var(--xg-border,#e3e7ea)}' +
    '.xg-rk__head h3{margin:0;font-size:18px;font-weight:800;color:inherit}.xg-rk__head p{margin:2px 0 0;font-size:12.5px;color:var(--xg-muted,#707a83)}' +
    '.xg-rk__x{width:34px;height:34px;border:0;border-radius:50%;background:rgba(127,127,127,.14);color:inherit;font-size:22px;line-height:1;cursor:pointer}' +
    '.xg-rk__list{list-style:none;margin:0;padding:6px 18px;overflow:auto}.xg-rk__list li{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--xg-border,#e3e7ea);margin:0}' +
    '.xg-rk__dot{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);background:#999}' +
    '.xg-rk__nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.xg-rk__nm small{margin-left:6px;font-weight:500;font-size:11.5px;color:var(--xg-muted,#707a83)}.xg-rk__nm a{color:inherit!important;text-decoration:none}' +
    '.xg-rk__rm{border:1px solid var(--xg-border,#e3e7ea);border-radius:999px;background:none;color:var(--xg-muted,#707a83);font:inherit;font-size:12px;padding:3px 10px;cursor:pointer}.xg-rk__rm:hover{border-color:var(--xg-red,#d62c28);color:var(--xg-red,#d62c28)}' +
    '.xg-rk__empty{padding:18px;color:var(--xg-muted,#707a83);font-size:13.5px;line-height:1.5}' +
    '.xg-rk__foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 18px 14px;font-size:12px;color:var(--xg-muted,#707a83)}' +
    'html[data-xg-theme="dark"] .xg-rk__card{background:var(--xg-surface,#171c1f);color:var(--xg-ink,#eef1f3)}html[data-xg-theme="dark"] .xg-rk__head,html[data-xg-theme="dark"] .xg-rk__list li,html[data-xg-theme="dark"] .xg-rk__rm{border-color:var(--xg-border,#2f373c)}' +
    '.xg-rk__clr{border:0;background:none;color:inherit;font:inherit;font-size:12px;text-decoration:underline;cursor:pointer;padding:0}';
  var root = null;
  function mount() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.className = 'xg-rk'; root.hidden = true;
    root.innerHTML = '<div class="xg-rk__bg" data-x></div><div class="xg-rk__card" role="dialog" aria-modal="true" aria-labelledby="xg-rk-t">' +
      '<div class="xg-rk__head"><div><h3 id="xg-rk-t">My paint rack</h3><p></p></div><button type="button" class="xg-rk__x" data-x aria-label="Close">&times;</button></div>' +
      '<ul class="xg-rk__list"></ul><div class="xg-rk__foot"><span>Saved on this device.</span><button type="button" class="xg-rk__clr">Clear my rack</button></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-x], .xg-rk__rm, .xg-rk__clr');
      if (!t) return;
      if (t.hasAttribute('data-x')) { root.hidden = true; return; }
      if (t.classList.contains('xg-rk__clr')) { if (window.confirm('Remove every paint from your rack?')) { data = { items: {} }; save(); } return; }
      api.set(t.getAttribute('data-k'), false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && !root.hidden) root.hidden = true; });
    subs.push(function () { if (root && !root.hidden) draw(); });
  }
  function draw() {
    var ps = api.paints(), tools = Object.keys(data.items).filter(function (k) { return k.indexOf('tool:') === 0; });
    root.querySelector('.xg-rk__head p').textContent = ps.length + ' paint' + (ps.length === 1 ? '' : 's') + (tools.length ? ' and ' + tools.length + ' tool' + (tools.length === 1 ? '' : 's') : '') + ' you already own';
    var ul = root.querySelector('.xg-rk__list');
    if (!ps.length && !tools.length) {
      ul.innerHTML = '<li class="xg-rk__empty" style="display:block;border:0">Nothing here yet. Tick the circle beside a paint you own - on any paint list or paint page - and it lands here. Paint lists then leave it out when you add everything to your cart.</li>';
      return;
    }
    ul.innerHTML = ps.map(function (p) {
      var nm = p.u ? '<a href="/products/' + encodeURIComponent(p.u) + '">' + esc(p.n) + '</a>' : esc(p.n);
      return '<li><span class="xg-rk__dot"' + (p.h ? ' style="background:' + esc(p.h) + '"' : '') + '></span><span class="xg-rk__nm">' + nm + '<small>' + esc(p.b || '') + '</small></span>' +
        '<button type="button" class="xg-rk__rm" data-k="' + esc(p.k) + '">Remove</button></li>';
    }).join('') + tools.map(function (k) {
      var m = data.items[k] || {};
      return '<li><span class="xg-rk__dot" style="background:transparent;box-shadow:inset 0 0 0 2px currentColor;opacity:.5"></span><span class="xg-rk__nm">' + esc(m.n || k.slice(5)) + '<small>Tool</small></span>' +
        '<button type="button" class="xg-rk__rm" data-k="' + esc(k) + '">Remove</button></li>';
    }).join('');
  }
  var api = {
    key: key,
    has: function (k) { return !!(k && data.items[k]); },
    set: function (k, on, meta) {
      if (!k) return;
      if (on) { var m = meta || {}; data.items[k] = { n: m.n || '', b: m.b || '', h: m.h || '', u: m.u || '', t: Date.now() }; }
      else delete data.items[k];
      save();
    },
    paints: function () {
      return Object.keys(data.items).filter(function (k) { return k.indexOf('tool:') !== 0; })
        .map(function (k) { var m = data.items[k]; return { k: k, n: m.n, b: m.b, h: m.h, u: m.u, t: m.t || 0 }; })
        .sort(function (a, b) { return b.t - a.t; });
    },
    count: function () { return api.paints().length; },
    on: function (f) { if (typeof f === 'function') subs.push(f); },
    open: function () { mount(); draw(); root.hidden = false; var x = root.querySelector('.xg-rk__x'); if (x) x.focus(); }
  };
  window.xgRack = api;
})();
