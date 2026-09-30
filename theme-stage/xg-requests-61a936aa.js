/* Item requests (owner, 2026-09-30: "when something is sold out it would be nice to have
   a button that customers could use to ask for an order with an amount they would like
   to order ... anything that it hasn't carried they can still contact the store to
   special order it").

   Product page: the [data-xg-req] mount under the buy buttons (sections/product-template)
   shows "Request this item" while the chosen variant is sold out - quantity, name, email
   (filled in for a signed-in customer), a note - and posts it to the worker, which emails
   the store and confirms to the customer. The page first asks the worker whether requests
   are on for this product (staff can switch a product, or everything, off in 9Pocket), so
   a switched-off product shows nothing. Re-checked when the variant changes.
   Special orders: the [data-xg-req-special] mount on /pages/special-order takes a request
   for something the store does not list (what, details, quantity, name, email).
   Worker: src/requests.js in chaywrite. A hidden "website" field catches bots. */
(function () {
  'use strict';
  var W = 'https://exor-binder.nevski.workers.dev';
  var CSS = '.xg-req{margin:14px 0 8px;font-size:14px;line-height:1.45;color:var(--xg-ink,#171b1d)}.xg-req[hidden]{display:none}' +
    '.xg-req__btn{display:inline-block;padding:11px 18px;border-radius:8px;border:2px solid var(--xg-red,#d62c28);background:transparent;color:var(--xg-red,#d62c28);font:inherit;font-weight:800;letter-spacing:.02em;cursor:pointer;text-transform:uppercase}.xg-req__btn:hover{background:var(--xg-red,#d62c28);color:#fff}' +
    '.xg-req__lead{margin:0 0 8px;font-size:13px;opacity:.8}' +
    '.xg-req__form{margin-top:10px;padding:14px 16px;border:1px solid rgba(0,0,0,.14);border-radius:12px;background:rgba(0,0,0,.03)}.xg-req__form[hidden]{display:none}' +
    '.xg-req__row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.xg-req__row--1{grid-template-columns:1fr}@media(max-width:560px){.xg-req__row{grid-template-columns:1fr}}' +
    '.xg-req label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;opacity:.85}' +
    '.xg-req input,.xg-req textarea{width:100%;padding:9px 10px;border:1px solid rgba(0,0,0,.2);border-radius:8px;font:inherit;font-size:14px;background:#fff;color:#171b1d;box-sizing:border-box}.xg-req textarea{min-height:70px;resize:vertical}.xg-req input[readonly]{opacity:.75}' +
    '.xg-req__hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.xg-req__send{padding:11px 18px;border-radius:8px;border:0;background:var(--xg-red,#d62c28);color:#fff;font:inherit;font-weight:800;text-transform:uppercase;letter-spacing:.02em;cursor:pointer}.xg-req__send:disabled{opacity:.6;cursor:default}' +
    '.xg-req__cancel{margin-left:10px;background:none;border:0;font:inherit;text-decoration:underline;cursor:pointer;color:inherit;opacity:.8}' +
    '.xg-req__msg{margin-top:10px;font-size:13.5px}.xg-req__msg--err{color:#b42318;font-weight:600}.xg-req__done{padding:12px 14px;border-radius:10px;background:rgba(26,158,111,.1);border:1px solid rgba(26,158,111,.35)}' +
    '.xg-req__fine{margin:10px 0 0;font-size:12px;opacity:.7}' +
    'html[data-xg-theme="dark"] .xg-req{color:#e6ebee}html[data-xg-theme="dark"] .xg-req__form{background:#181d20;border-color:#2a3236}html[data-xg-theme="dark"] .xg-req input,html[data-xg-theme="dark"] .xg-req textarea{background:#1d2327;border-color:#2a3236;color:#e6ebee}html[data-xg-theme="dark"] .xg-req__btn{color:#ff6a5e;border-color:#ff6a5e}html[data-xg-theme="dark"] .xg-req__btn:hover{background:#ff6a5e;color:#101416}';
  function style() { if (document.getElementById('xg-req-css')) return; var st = document.createElement('style'); st.id = 'xg-req-css'; st.textContent = CSS; document.head.appendChild(st); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function customer(el) { return { email: el.getAttribute('data-email') || '', name: el.getAttribute('data-name') || '', id: el.getAttribute('data-cid') || '' }; }

  // the form's fields; `special` adds "what" and "details" in place of the item line
  function formHtml(c, special) {
    return '<div class="xg-req__form" hidden>' +
      (special ? '<div class="xg-req__row xg-req__row--1"><div><label>What are you looking for?</label><input name="title" maxlength="200" placeholder="Name of the game, kit, set, card…" required></div></div>' +
        '<div class="xg-req__row xg-req__row--1"><div><label>Details</label><textarea name="note" maxlength="1000" placeholder="Edition, publisher, a link, colour - anything that helps us find the right one"></textarea></div></div>' : '') +
      '<div class="xg-req__row"><div><label>Quantity</label><input name="qty" type="number" min="1" max="999" step="1" value="1" inputmode="numeric" required></div><div><label>Your name</label><input name="name" maxlength="80" value="' + esc(c.name) + '" autocomplete="name"></div></div>' +
      '<div class="xg-req__row xg-req__row--1"><div><label>Email</label><input name="email" type="email" maxlength="160" value="' + esc(c.email) + '" ' + (c.email ? 'readonly' : 'autocomplete="email" required') + '></div></div>' +
      (special ? '' : '<div class="xg-req__row xg-req__row--1"><div><label>Anything we should know? (optional)</label><textarea name="note" maxlength="1000" placeholder="A deadline, a version you need, or how to reach you"></textarea></div></div>') +
      '<div class="xg-req__hp" aria-hidden="true"><label>Website</label><input name="website" tabindex="-1" autocomplete="off"></div>' +
      '<button type="button" class="xg-req__send">Send request</button><button type="button" class="xg-req__cancel">Cancel</button>' +
      '<div class="xg-req__msg" hidden></div>' +
      '<p class="xg-req__fine">Nothing is charged or reserved. We email you at the address above when we know more.</p></div>';
  }

  function wire(el, base, c, special, onSent) {
    var btn = el.querySelector('.xg-req__btn'), form = el.querySelector('.xg-req__form'), send = el.querySelector('.xg-req__send'), cancel = el.querySelector('.xg-req__cancel'), msg = el.querySelector('.xg-req__msg');
    function say(t, err) { msg.hidden = !t; msg.textContent = t || ''; msg.className = 'xg-req__msg' + (err ? ' xg-req__msg--err' : ''); }
    if (btn) btn.addEventListener('click', function () { form.hidden = false; btn.hidden = true; var f = form.querySelector(special ? 'input[name="title"]' : 'input[name="qty"]'); if (f) f.focus(); });
    if (cancel) cancel.addEventListener('click', function () { form.hidden = true; if (btn) btn.hidden = false; say(''); });
    send.addEventListener('click', function () {
      var v = function (n) { var i = form.querySelector('[name="' + n + '"]'); return i ? i.value.trim() : ''; };
      var body = base();
      body.qty = parseInt(v('qty'), 10) || 1; body.name = v('name'); body.email = v('email'); body.note = v('note'); body.website = v('website');
      if (special) body.title = v('title');
      if (!body.title) { say('Tell us what you are looking for.', true); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { say('An email address is needed so we can get back to you.', true); return; }
      if (c.id) body.customerId = c.id;
      send.disabled = true; say('Sending…');
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      if (ctl) setTimeout(function () { ctl.abort(); }, 12000);
      fetch(W + '/requests/api/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || !x.j || !x.j.ok) { send.disabled = false; say((x.j && x.j.error) || 'That did not go through. Please try again, or email charlottetown@exorgames.com.', true); return; }
          el.innerHTML = '<div class="xg-req__done"><strong>Thanks - request ' + esc(x.j.number) + ' is in.</strong> We will email you at ' + esc(body.email) + ' when we know more.' + (special ? '' : ' If it comes back in stock, you will hear from us.') + '</div>';
          if (onSent) onSent();
        })
        .catch(function () { send.disabled = false; say('That did not go through. Please try again, or email charlottetown@exorgames.com.', true); });
    });
  }

  /* ---- the product page ---- */
  function product(el) {
    var json = document.querySelector('script[id^="ProductJson-"]');
    var prod = null;
    try { prod = JSON.parse(json.textContent); } catch (e) { return; }
    if (!prod || !prod.variants || !prod.variants.length) return;
    var c = customer(el), status = null, built = false, sent = false;
    function current() {
      var sel = document.querySelector('select[name="id"], input[name="id"]');
      var id = sel ? sel.value : '';
      for (var i = 0; i < prod.variants.length; i++) if (String(prod.variants[i].id) === String(id)) return prod.variants[i];
      return null;
    }
    function soldOut() { var v = current(); return v ? !v.available : !prod.available; }
    function build() {
      if (built) return;
      built = true;
      style();
      el.className = 'xg-req';
      el.innerHTML = '<p class="xg-req__lead">Sold out? Tell us how many you want and we will try to get it back in.</p>' +
        '<button type="button" class="xg-req__btn">Request this item</button>' + formHtml(c, false);
      wire(el, function () {
        var v = current() || prod.variants[0];
        return { kind: 'restock', productId: String(prod.id), variantId: v ? String(v.id) : '', variantTitle: v ? String(v.title || '') : '',
          handle: prod.handle || '', title: prod.title || '', type: prod.type || '', vendor: prod.vendor || '',
          image: el.getAttribute('data-image') || '', url: location.origin + location.pathname };
      }, c, false, function () { sent = true; });
    }
    function update() {
      if (sent) return;
      if (!soldOut()) { el.hidden = true; return; }
      if (status === null) {
        status = 'asking';
        fetch(W + '/requests/api/status?product=' + encodeURIComponent(prod.id), { credentials: 'omit' })
          .then(function (r) { return r.json(); }).then(function (j) { status = !!(j && j.on); update(); })
          .catch(function () { status = false; });
        return;
      }
      if (status !== true) { el.hidden = true; return; }
      build();
      el.hidden = false;
    }
    document.addEventListener('change', function (e) { if (e.target && e.target.name === 'id') setTimeout(update, 0); });
    var cart = document.querySelector('.product-addToCart');
    if (cart && 'MutationObserver' in window) new MutationObserver(function () { setTimeout(update, 0); }).observe(cart, { attributes: true, attributeFilter: ['disabled'] });
    update();
  }

  /* ---- the special-order page ---- */
  function special(el) {
    var c = customer(el);
    style();
    el.className = 'xg-req xg-req--special';
    el.innerHTML = formHtml(c, true);
    el.querySelector('.xg-req__form').hidden = false;
    el.querySelector('.xg-req__cancel').hidden = true;
    fetch(W + '/requests/api/status', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.on === false) el.innerHTML = '<div class="xg-req__done">We are not taking special orders right now. Email <a href="mailto:charlottetown@exorgames.com">charlottetown@exorgames.com</a> and we will help if we can.</div>';
    }).catch(function () {});
    wire(el, function () { return { kind: 'special', url: location.origin + location.pathname }; }, c, true, null);
    el.hidden = false;
  }

  function start() {
    var p = document.querySelector('[data-xg-req]');
    var s = document.querySelector('[data-xg-req-special]');
    if (p) product(p);
    if (s) special(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
