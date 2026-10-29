/* Exor Games - "Ask Exor", the shop assistant widget (owner, 2026-10-20: "do one").

   A small round button bottom-left opens a panel; the shopper's question goes
   to the exor-binder worker's POST /ask.json (src/ask.js there), which answers
   only from live stock, events, buy prices and the market pulse. Products the
   answer names come back as cards with add to cart (tagged _xg: 'ask' so the
   sales-impact report can see what the assistant sold). The last six turns
   stay in sessionStorage for follow-up questions; nothing is sent anywhere
   but the worker. The button stays hidden until the worker says the
   assistant is switched on (GET /ask/health configured:true = an API key AND
   the admin switch on 9Pocket > Admin), so the page is unchanged otherwise.
   "Not right?" under an answer (owner, 2026-10-29) flags it in the staff log
   through POST /ask/flag.json and shows the shopper the email and staff
   fallback. */
(function () {
  'use strict';
  if (window.xgAsk || !window.fetch || !document.querySelector) return;
  var W = 'https://exor-binder.nevski.workers.dev';
  if (/\/checkouts?\//.test(location.pathname)) return;
  var state = { open: false, history: [], busy: false, ready: false };
  try { state.history = JSON.parse(sessionStorage.getItem('xgAsk') || '[]').slice(-6); } catch (e) { state.history = []; }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var linkify = function (s) { return esc(s).replace(/https?:\/\/[^\s)]+/g, function (u) { return '<a href="' + u + '">' + u.replace(/^https?:\/\/(www\.)?exorgames\.com/, '').replace(/^https?:\/\//, '') + '</a>'; }); };
  var css = '.xg-ask-btn{position:fixed;left:16px;bottom:16px;z-index:9000;display:flex;align-items:center;gap:8px;background:#e5322d;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:700 14px/1 Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer}.xg-ask-btn:hover{background:#c42823}.xg-ask-btn svg{width:18px;height:18px}body.xg-has-ticker .xg-ask-btn{bottom:86px}'
    + '.xg-ask{position:fixed;left:16px;bottom:72px;z-index:9001;width:min(380px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 100px));display:none;flex-direction:column;background:#1a1e23;color:#e8ecef;border:1px solid #2a3138;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.45 Inter,system-ui,sans-serif;overflow:hidden}body.xg-has-ticker .xg-ask{bottom:142px}.xg-ask.is-open{display:flex}'
    + '.xg-ask__h{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #2a3138;font-weight:700}.xg-ask__h button{background:none;border:0;color:#9aa4ad;font-size:20px;cursor:pointer}'
    + '.xg-ask__log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}.xg-ask__m{max-width:92%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}.xg-ask__m--u{align-self:flex-end;background:#2a3138}.xg-ask__m--a{align-self:flex-start;background:#121417;border:1px solid #2a3138}.xg-ask__m a{color:#8ab4f8}'
    + '.xg-ask__cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}.xg-ask__c{background:#1a1e23;border:1px solid #2a3138;border-radius:8px;padding:6px;font-size:12px}.xg-ask__c img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#0d0f12;border-radius:4px}.xg-ask__c a{display:block;font-weight:600;color:#e8ecef;text-decoration:none;margin-top:4px}.xg-ask__c .p{color:#9aa4ad}.xg-ask__c .p b{color:#e8ecef}.xg-ask__c button{margin-top:4px;width:100%;border:0;border-radius:999px;background:#e5322d;color:#fff;padding:5px;font-weight:700;cursor:pointer}.xg-ask__c button[disabled]{opacity:.5}'
    + '.xg-ask__f{display:flex;gap:6px;padding:10px;border-top:1px solid #2a3138}.xg-ask__f input{flex:1;min-width:0;padding:10px 12px;border-radius:999px;border:1px solid #2a3138;background:#0d0f12;color:#e8ecef;font-size:16px}.xg-ask__f button{border:0;border-radius:999px;background:#e5322d;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer}.xg-ask__f button[disabled]{opacity:.5}.xg-ask__note{padding:0 12px 8px;color:#9aa4ad;font-size:11px}'
    + '.xg-ask__fb{margin-top:6px;font-size:12px;color:#9aa4ad}.xg-ask__fb button{background:none;border:1px solid #2a3138;color:#9aa4ad;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}.xg-ask__fb button:hover{color:#e8ecef;border-color:#9aa4ad}'
    + 'html[data-xg-theme="light"] .xg-ask{background:#fff;color:#1a1e23;border-color:#e3e6ea}html[data-xg-theme="light"] .xg-ask__m--a{background:#f5f6f8;border-color:#e3e6ea}html[data-xg-theme="light"] .xg-ask__m--u{background:#e9ebef}html[data-xg-theme="light"] .xg-ask__f input{background:#fff;color:#1a1e23;border-color:#d8dce2}html[data-xg-theme="light"] .xg-ask__c{background:#fff;border-color:#e3e6ea}html[data-xg-theme="light"] .xg-ask__c a{color:#1a1e23}html[data-xg-theme="light"] .xg-ask__c .p b{color:#1a1e23}';
  var panel, log, input, send;
  function mount() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'xg-ask-btn'; btn.setAttribute('aria-label', 'Ask Exor');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 13 4h0a8 8 0 0 1 8 8z"/></svg>Ask Exor';
    panel = document.createElement('div'); panel.className = 'xg-ask'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask Exor');
    panel.innerHTML = '<div class="xg-ask__h"><span>Ask Exor</span><button type="button" aria-label="Close">&times;</button></div><div class="xg-ask__log"></div><div class="xg-ask__note">Answers come from our live stock and events. Prices in CAD.</div><form class="xg-ask__f"><input maxlength="500" placeholder="Ask about cards, games, events…" autocomplete="off"><button type="submit">Ask</button></form>';
    document.body.appendChild(btn); document.body.appendChild(panel);
    if (document.querySelector('.xg-tick')) document.body.classList.add('xg-has-ticker');
    log = panel.querySelector('.xg-ask__log'); input = panel.querySelector('input'); send = panel.querySelector('.xg-ask__f button');
    btn.addEventListener('click', function () { toggle(!state.open); });
    panel.querySelector('.xg-ask__h button').addEventListener('click', function () { toggle(false); });
    panel.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    log.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-xg-ask-add]'); if (b) addToCart(b); var f = e.target.closest && e.target.closest('[data-xg-ask-flag]'); if (f) flag(f); });
    state.history.forEach(function (m) { bubble(m.role, m.role === 'user' ? esc(m.content) : linkify(m.content)); });
    if (!state.history.length) bubble('assistant', 'Hi! Ask me whether we have a card or product, what it costs, what we pay for your cards, or what events are coming up.');
  }
  function toggle(open) { state.open = open; panel.classList.toggle('is-open', open); if (open) setTimeout(function () { input.focus(); }, 50); }
  function bubble(role, html) { var d = document.createElement('div'); d.className = 'xg-ask__m xg-ask__m--' + (role === 'user' ? 'u' : 'a'); d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function cards(list) {
    if (!list || !list.length) return '';
    return '<div class="xg-ask__cards">' + list.slice(0, 6).map(function (p) {
      var m = /\/products\/([a-z0-9-]+)/.exec(p.url || '');
      return '<div class="xg-ask__c">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '<a href="' + esc(p.url) + '">' + esc(p.title) + '</a><div class="p"><b>$' + esc(p.price) + '</b> · ' + (p.available ? 'in stock' : 'sold out') + '</div>' + (p.available && m ? '<button type="button" data-xg-ask-add="' + esc(m[1]) + '" data-title="' + esc(p.title) + '" data-image="' + esc(p.image || '') + '" data-url="' + esc(p.url) + '">Add to cart</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function addToCart(b) {
    if (b.disabled) return; b.disabled = true; var was = b.textContent; b.textContent = 'Adding…';
    // the handle -> its first available variant, from the store's own product JSON
    fetch('/products/' + b.getAttribute('data-xg-ask-add') + '.js', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var v = (p.variants || []).filter(function (x) { return x.available; })[0];
        if (!v) throw new Error('sold out');
        if (window.xgImpact) { try { window.xgImpact('ask', 'add'); } catch (e) {} }
        return fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: v.id, quantity: 1, properties: { _xg: 'ask' } }] }) })
          .then(function (r) { if (!r.ok) throw new Error('cart ' + r.status); return r.json(); })
          .then(function (it) {
            b.textContent = 'Added ✓';
            try { var sync = (window.Shopify && window.Shopify.adjustCartDropDown) || window.adjustCartDropDown; if (typeof sync === 'function') sync(); } catch (e) {}
            if (window.xgCartPeek) window.xgCartPeek({ title: b.getAttribute('data-title'), image: b.getAttribute('data-image'), url: b.getAttribute('data-url'), qty: 1, cents: Number((it && it.final_price) || 0) });
          });
      })
      .catch(function () { b.textContent = 'Could not add'; setTimeout(function () { b.textContent = was; b.disabled = false; }, 2000); });
  }
  function flag(b) {
    if (b.disabled) return; b.disabled = true;
    var box = b.parentNode;
    fetch(W + '/ask/flag.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.getAttribute('data-xg-ask-flag') }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { box.textContent = 'Thanks, flagged for the team. ' + (j && j.note ? j.note : 'For a sure answer, email charlottetown@exorgames.com or ask staff in store.'); })
      .catch(function () { box.textContent = 'Could not send that. For a sure answer, email charlottetown@exorgames.com or ask staff in store.'; });
  }
  function submit() {
    var text = input.value.trim(); if (!text || state.busy) return;
    state.busy = true; send.disabled = true; input.value = '';
    bubble('user', esc(text));
    var think = bubble('assistant', '<span style="color:#9aa4ad">Looking…</span>');
    if (window.xgImpact) { try { window.xgImpact('ask', 'open'); } catch (e) {} }
    fetch(W + '/ask.json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text, history: state.history }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { think.innerHTML = '<span style="color:#9aa4ad">' + esc(j.error || 'Something went wrong.') + '</span>'; return; }
        think.innerHTML = linkify(j.answer) + cards(j.products) + (j.id ? '<div class="xg-ask__fb"><button type="button" data-xg-ask-flag="' + esc(j.id) + '">Not right?</button></div>' : '');
        state.history.push({ role: 'user', content: text }, { role: 'assistant', content: j.answer }); state.history = state.history.slice(-6);
        try { sessionStorage.setItem('xgAsk', JSON.stringify(state.history)); } catch (e) {}
      })
      .catch(function () { think.innerHTML = '<span style="color:#9aa4ad">Could not reach the assistant.</span>'; })
      .then(function () { state.busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; input.focus(); });
  }
  // only when the worker says the assistant is switched on
  fetch(W + '/ask/health', { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (h) { if (h && h.configured) { state.ready = true; mount(); } }).catch(function () {});
  window.xgAsk = { open: function () { if (state.ready) toggle(true); } };
})();
