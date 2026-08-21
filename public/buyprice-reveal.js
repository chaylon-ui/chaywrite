/* "What we pay" reveal — card product pages. A theme shell drops
   <div id="xg-buyprice" data-name="{product.title}" data-type="{product.type}">
   on singles pages and loads this file from the worker. Clicking the reveal
   button fetches /buyprice.json (BinderPOS buylist prices via the worker's
   BINDERPOS_API_KEY) and shows what Exor pays in cash and store credit.

   Quiet by design: if the backend says available:false (no key yet, outage)
   the button never renders — the page looks exactly as before. If the store
   isn't buying the card, the reveal says so honestly. */
(function () {
  var W = 'https://exor-binder.nevski.workers.dev';
  var root = document.getElementById('xg-buyprice');
  if (!root || root.getAttribute('data-xg-ready')) return;
  root.setAttribute('data-xg-ready', '1');

  var NAME = root.getAttribute('data-name') || '';
  var TYPE = root.getAttribute('data-type') || '';
  if (!NAME || !/single/i.test(TYPE)) return;   // singles only

  var css = '' +
    '.xg-buy{margin:14px 0;font-family:var(--xg-font-body,"Inter",sans-serif)}' +
    '.xg-buy__btn{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--xg-ink,#171b1d);border:1.5px dashed var(--xg-accent,#d62c28);border-radius:var(--xg-radius,10px);padding:10px 18px;font-weight:700;font-size:14.5px;cursor:pointer;transition:background-color 120ms ease,color 120ms ease}' +
    '.xg-buy__btn:hover{background:var(--xg-accent,#d62c28);color:#fff}' +
    '.xg-buy__btn[disabled]{opacity:.6;cursor:default}' +
    '.xg-buy__panel{margin-top:10px;border:1px solid var(--xg-border,#e3e6e8);border-radius:var(--xg-radius,12px);background:var(--xg-surface,#fff);padding:14px 16px;max-width:520px}' +
    '.xg-buy__head{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#8a9299;font-weight:600;margin:0 0 10px}' +
    '.xg-buy__row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f4;font-size:14.5px;align-items:baseline}' +
    '.xg-buy__row:last-child{border-bottom:0}' +
    '.xg-buy__what{color:var(--xg-text,#3d454b)}' +
    '.xg-buy__what small{color:#8a9299}' +
    '.xg-buy__nums{white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.xg-buy__cash{font-weight:700;color:var(--xg-ink,#171b1d)}' +
    '.xg-buy__credit{color:#1a9e57;font-weight:700;margin-left:10px}' +
    '.xg-buy__note{font-size:12px;color:#8a9299;margin:10px 0 0}' +
    '.xg-buy__none{font-size:14.5px;color:var(--xg-text,#3d454b);margin:0}' +
    '.xg-buy__sell{display:inline-block;margin-top:10px;font-size:13.5px;color:var(--xg-accent,#d62c28);font-weight:600;text-decoration:none}' +
    '.xg-buy__sell:hover{text-decoration:underline}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  root.className = (root.className + ' xg-buy').trim();
  root.innerHTML = '<button type="button" class="xg-buy__btn" id="xg-buy-go" hidden>&#128176; Reveal what we pay for this card</button>' +
                   '<div id="xg-buy-out"></div>';
  var btn = document.getElementById('xg-buy-go');
  var out = document.getElementById('xg-buy-out');

  var urlFor = function () {
    return W + '/buyprice.json?name=' + encodeURIComponent(NAME) + '&type=' + encodeURIComponent(TYPE);
  };

  // Probe once, cheaply: only show the button if the backend is live.
  fetch(urlFor()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.available) {
      btn.hidden = false;
      btn.__data = d;   // reuse the answer on click — no second fetch
    }
  }).catch(function () {});

  btn.addEventListener('click', function () {
    var d = btn.__data;
    btn.disabled = true;
    render(d);
  });

  function render(d) {
    btn.hidden = true;
    if (!d || !d.offers || !d.offers.length) {
      out.innerHTML = '<div class="xg-buy__panel"><p class="xg-buy__none">We’re not actively buying this card right now — but bring it in anyway: bulk and collection offers happen in store every day.</p>' +
        '<a class="xg-buy__sell" href="/pages/sell-to-exor-games-bulk-or-create-a-list">Ways to sell us cards ›</a></div>';
      return;
    }
    var rows = d.offers.map(function (o) {
      var what = [o.set, o.foil ? 'Foil' : '', o.condition].filter(Boolean).join(' · ');
      return '<div class="xg-buy__row">' +
        '<span class="xg-buy__what">' + esc(what || d.name) + '</span>' +
        '<span class="xg-buy__nums">' +
          (o.cash ? '<span class="xg-buy__cash">$' + esc(o.cash) + ' cash</span>' : '') +
          (o.credit ? '<span class="xg-buy__credit">$' + esc(o.credit) + ' credit</span>' : '') +
        '</span>' +
      '</div>';
    }).join('');
    out.innerHTML = '<div class="xg-buy__panel">' +
      '<p class="xg-buy__head">What we pay — ' + esc(d.name) + '</p>' + rows +
      '<p class="xg-buy__note">Prices assume the listed condition on arrival and can change daily. Store credit goes further — and there’s more where this came from.</p>' +
      '<a class="xg-buy__sell" href="/pages/sell-to-exor-games-bulk-or-create-a-list">Sell us your cards ›</a>' +
      '</div>';
  }
})();
