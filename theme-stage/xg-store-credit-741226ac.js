/* Exor Games — our own store-credit tab and panel, drawn from BinderPOS's
   own data (owner, 2026-09-19: "is there no way ... once the plugin sends
   the data we change its look on our side?" - yes).

   WHAT BINDERPOS DOES. Its ScriptTag (credit.js) appends a black rotated
   "My Store Credit" tab to every page a signed-in shopper sees and, on
   click, opens an iframe onto portal.binderpos.com. That iframe's inside is
   another origin, so no CSS of ours can reach it (2026-09-18: only its tab,
   scrim and frame could be restyled). The DATA, though, is on two JSON
   endpoints the shopper's own browser may call (CORS *, 401 without a
   valid customer id - checked 2026-09-19):

     GET /external/shopify/<store>/storeCredit/forMe?shopifyCustomerId=<id>
         -> {credit: 0.58, storeCreditHistory: null}
     GET /external/shopify/<store>/storeCredit/history/forMe?shopifyCustomerId=<id>
         -> {credit, storeCreditHistory: [{readableUpdatedDate:
            "2024-03-29T22:20:16Z[GMT]", amountChanged, readableAmountChanged,
            amountBeforeChange, amountAfterChange, invoiceNumber, actionedBy,
            ...}]}

   So this draws the tab and the panel itself, in the theme's own type and
   colours, and asks those endpoints FROM THE SHOPPER'S BROWSER when the
   panel opens - never through the worker (same rule as strictlybetter.eu:
   the shopper fetches their own data; nothing of theirs passes through us).

   FAIL-SAFE. BinderPOS's tab is hidden by CSS keyed on html.xg-credit-on,
   which this script sets only once its own tab is on the page. If the
   fetch fails, the shape changes, or anything throws, the class comes off
   again and their widget is exactly as it was; the panel also offers their
   view as a button. Nothing here can take a page down.

   Only for a signed-in shopper: the customer id is read from the same
   place their script reads it (__st.cid), and the store id, portal and
   currency symbol from the attributes their loader puts on its own script
   tag, with the known values as fallbacks. */
(function () {
  'use strict';
  try {
    var ID = 'xg-credit';
    var SHOW_HISTORY = true;    // the History list under the balance (owner: off 2026-09-22, back on 2026-09-28)
    var HISTORY_ROWS = 5;       // newest entries shown (owner, 2026-09-28: "the last 5")
    if (document.getElementById(ID + '-tab')) return;
    var cid = (window.__st && window.__st.cid != null) ? String(window.__st.cid).replace(/\D/g, '') : '';
    if (!cid) return;

    var STORE = 'a648e57a-678f-45eb-bae0-f8deb7940192', PORTAL = 'https://portal.binderpos.com', CUR = '$';
    function readConfig() {
      var s = document.getElementById('binderpos-store-credit-js');
      if (!s) return;
      STORE = s.getAttribute('store-id') || STORE;
      PORTAL = (s.getAttribute('portal-url') || PORTAL).replace(/\/+$/, '');
      CUR = s.getAttribute('currency-symbol') || CUR;
    }
    var base = function () { return PORTAL + '/external/shopify/' + STORE + '/storeCredit'; };
    var q = function () { return '?shopifyCustomerId=' + encodeURIComponent(cid); };

    /* window.xgCredit.balance() -> Promise<number|null>: the signed-in shopper's balance for the
       cart and product-page nudges (assets/xg-credit-nudge.js, owner 2026-09-29 "do number 3").
       Same balance-only endpoint, asked from the shopper's own browser, kept 5 minutes in this
       tab's sessionStorage so page views do not each ask BinderPOS again. */
    var balP = null;
    window.xgCredit = {
      balance: function () {
        if (balP) return balP;
        var SK = 'xg-credit-bal';
        try {
          var c = JSON.parse(sessionStorage.getItem(SK) || 'null');
          if (c && c.cid === cid && Date.now() - c.at < 300000 && typeof c.v === 'number') return (balP = Promise.resolve(c.v));
        } catch (e) {}
        readConfig();
        balP = fetch(base() + '/forMe' + q(), { headers: { accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            var v = j && typeof j.credit === 'number' ? j.credit : null;
            if (v != null) { try { sessionStorage.setItem(SK, JSON.stringify({ cid: cid, v: v, at: Date.now() })); } catch (e) {} }
            return v;
          }, function () { return null; });
        return balP;
      },
      symbol: function () { return CUR; }
    };

    var state = { data: null, at: 0, loading: false, error: '' };
    var tab, scrim, panel, lastFocus = null;

    function money(n) {
      var v = Number(n) || 0, neg = v < 0;
      return (neg ? '−' : '') + CUR + Math.abs(v).toFixed(2);
    }
    function niceDate(s) {
      var t = String(s || '').replace(/\[.*$/, '');
      var d = new Date(t);
      if (isNaN(d.getTime())) return String(s || '');
      try { return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d.toDateString(); }
    }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function on() { document.documentElement.classList.add('xg-credit-on'); }
    function off() { document.documentElement.classList.remove('xg-credit-on'); }

    // Their tab, when this panel cannot help: a click on it opens their view.
    function theirs() {
      var a = document.getElementById('binderpos-open-credit');
      if (a) { close(); off(); a.click(); return true; }
      return false;
    }

    function load(force) {
      if (state.loading) return;
      if (!force && state.data && Date.now() - state.at < 60e3) { render(); return; }
      state.loading = true; state.error = '';
      render();
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
      // Owner, 2026-09-22: "Turn off store credit history in the 'my store
      // credit' window" - the balance-only endpoint is asked and no History
      // block is drawn. Set SHOW_HISTORY to true (and the endpoint follows)
      // to bring it back.
      fetch(base() + (SHOW_HISTORY ? '/history/forMe' : '/forMe') + q(), { headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || typeof j.credit !== 'number') throw new Error('unexpected reply');
          state.data = { credit: j.credit, history: Array.isArray(j.storeCreditHistory) ? j.storeCreditHistory : [] };
          try { sessionStorage.setItem('xg-credit-bal', JSON.stringify({ cid: cid, v: j.credit, at: Date.now() })); } catch (e) {}
          state.at = Date.now();
        })
        .catch(function (e) { state.error = (e && e.message) || 'failed'; })
        .then(function () { if (timer) clearTimeout(timer); state.loading = false; render(); });
    }

    function render() {
      if (!panel) return;
      var body = panel.querySelector('.' + ID + '__body');
      body.innerHTML = '';
      if (state.loading && !state.data) { body.appendChild(el('p', ID + '__muted', 'Checking your balance…')); return; }
      if (state.error && !state.data) {
        body.appendChild(el('p', ID + '__muted', 'We could not reach your store credit right now.'));
        var b = el('button', ID + '__btn', 'Open the BinderPOS view instead');
        b.type = 'button';
        b.addEventListener('click', function () { if (!theirs()) load(true); });
        body.appendChild(b);
        return;
      }
      var d = state.data;
      var bal = el('div', ID + '__balance');
      bal.appendChild(el('span', ID + '__label', 'Available now'));
      bal.appendChild(el('strong', ID + '__amount', money(d.credit)));
      body.appendChild(bal);

      body.appendChild(el('p', ID + '__how', 'Store credit comes off your total at checkout, on anything we sell.'));

      if (!SHOW_HISTORY) { /* history off: balance only */ }
      else if (!d.history.length) { body.appendChild(el('h3', ID + '__h', 'History')); body.appendChild(el('p', ID + '__muted', 'No store-credit activity yet.')); }
      else {
        body.appendChild(el('h3', ID + '__h', 'History'));
        var list = el('ul', ID + '__list');
        var rows = d.history.slice().sort(function (x, y) {
          return String(y.readableUpdatedDate || '').localeCompare(String(x.readableUpdatedDate || ''));
        }).slice(0, HISTORY_ROWS);
        rows.forEach(function (r) {
          var li = el('li', ID + '__row');
          var delta = Number(r.amountChanged) || 0;
          var top = el('div', ID + '__rowtop');
          top.appendChild(el('span', ID + '__date', niceDate(r.readableUpdatedDate)));
          top.appendChild(el('span', ID + '__delta ' + (delta < 0 ? ID + '__delta--out' : ID + '__delta--in'), (delta < 0 ? '− ' : '+ ') + CUR + Math.abs(delta).toFixed(2)));
          li.appendChild(top);
          var note = r.notes || r.note || r.description || r.reason || '';
          var inv = r.invoiceNumber != null && r.invoiceNumber !== '' ? 'Invoice ' + r.invoiceNumber : '';
          var sub = [note, inv].filter(Boolean).join(' · ');
          if (sub) li.appendChild(el('div', ID + '__note', sub));
          if (r.amountAfterChange != null) li.appendChild(el('div', ID + '__after', 'Balance after: ' + money(r.amountAfterChange)));
          list.appendChild(li);
        });
        body.appendChild(list);
      }
      // A refresh that failed keeps the last good numbers on screen and says
      // so, rather than replacing them with an error.
      var at = state.at ? new Date(state.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace(/\.$/, '') : '';
      var foot = el('p', ID + '__muted ' + ID + '__foot', state.error ? 'Could not refresh just now; this is your balance as of ' + at + '.' : 'As of ' + at + '.');
      var rf = el('button', ID + '__refresh', 'Refresh');
      rf.type = 'button';
      rf.addEventListener('click', function () { load(true); });
      foot.appendChild(document.createTextNode(' '));
      foot.appendChild(rf);
      body.appendChild(foot);
    }

    /* How to get more (owner, 2026-09-28: "say how you can get more store
       credit and showing the banner for video games for Mallow"). The three
       card routes of the sell page, then the Mallow Games band in Mallow's
       colours as on that page. Links only; nothing is fetched.
       Owner, same day: "more eye popping but not tacky ... make the buttons a
       bit smaller and stay at the bottom of the store credit even when they
       scroll through their store credit history" - built once into the
       panel's footer (.xg-credit__more), which stays put while the balance and
       history scroll above it. */
    var ICONS = {
      list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
      store: '<path d="M3.5 9.5 5 4h14l1.5 5.5"/><path d="M4.5 9.5V20h15V9.5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.9 2.9 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0"/><path d="M10 20v-5h4v5"/>',
      box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="m3.5 7.5 8.5 4 8.5-4M12 11.5v9"/>'
    };
    var WAYS = [
      ['Build a buylist', 'Sell cards online. Credit pays more than cash.', '/pages/selling-to-exor-games-buylist', 'list'],
      ['Bring them in', 'Trade in at any of our six stores.', '/pages/selling-to-exor-games-in-store-selling', 'store'],
      ['Send in bulk', 'Unsorted boxes are welcome.', '/pages/bulk-selling', 'box']
    ];
    var MALLOW_IMG = 'https://cdn.shopify.com/s/files/1/0467/3083/8169/files/mallow_240x240.jpg?v=1787947354';
    function icon(name) {
      var i = el('span', ID + '__wayi');
      i.setAttribute('aria-hidden', 'true');
      i.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
      return i;
    }
    function earnMore(box) {
      var top = el('div', ID + '__morehead');
      var h = el('h3', ID + '__moreh');
      var badge = el('span', ID + '__plus', '+');
      badge.setAttribute('aria-hidden', 'true');
      h.appendChild(badge);
      h.appendChild(document.createTextNode('Get more store credit'));
      top.appendChild(h);
      var all = el('a', ID + '__link ' + ID + '__all', 'All the ways to sell');
      all.href = '/pages/sell-to-exor-games-bulk-or-create-a-list';
      top.appendChild(all);
      box.appendChild(top);

      var ways = el('ul', ID + '__ways');
      WAYS.forEach(function (w) {
        var li = el('li', ID + '__way');
        var a = el('a', ID + '__wayl');
        a.href = w[2];
        a.appendChild(icon(w[3]));
        a.appendChild(el('span', ID + '__wayt', w[0]));
        a.appendChild(el('span', ID + '__wayd', w[1]));
        li.appendChild(a);
        ways.appendChild(li);
      });
      box.appendChild(ways);

      var band = el('a', ID + '__mallow');
      band.href = 'https://mallowgames.com/sell-your-games/';
      band.target = '_blank';
      band.rel = 'noopener';
      var img = el('img', ID + '__mallow-art');
      img.src = MALLOW_IMG; img.alt = 'Mallow Games'; img.width = 52; img.height = 52; img.loading = 'lazy';
      band.appendChild(img);
      var txt = el('span', ID + '__mallow-body');
      var ht = el('span', ID + '__mallow-h');
      ht.appendChild(el('span', ID + '__mallow-tag', 'Video games'));
      ht.appendChild(document.createTextNode(' Sell them to Mallow Games'));
      txt.appendChild(ht);
      txt.appendChild(el('span', ID + '__mallow-p', 'Our sister shop buys games, consoles and accessories. Take store credit and spend it here.'));
      band.appendChild(txt);
      band.appendChild(el('span', ID + '__mallow-btn', 'Sell games'));
      box.appendChild(band);
    }

    function build() {
      readConfig();
      tab = el('button', ID + '__tab', 'My Store Credit');
      tab.id = ID + '-tab';
      tab.type = 'button';
      tab.setAttribute('aria-haspopup', 'dialog');
      tab.addEventListener('click', open);

      scrim = el('div', ID + '__scrim');
      scrim.id = ID + '-scrim';
      scrim.addEventListener('click', close);

      panel = el('aside', ID + '__panel');
      panel.id = ID;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', ID + '-title');
      panel.hidden = true;
      var head = el('div', ID + '__head');
      head.appendChild(el('h2', ID + '__title', 'Your store credit')).id = ID + '-title';
      var x = el('button', ID + '__close', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', close);
      head.appendChild(x);
      panel.appendChild(head);
      panel.appendChild(el('div', ID + '__body'));
      var more = el('div', ID + '__more');
      earnMore(more);
      panel.appendChild(more);

      document.body.appendChild(tab);
      document.body.appendChild(scrim);
      document.body.appendChild(panel);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });
      on();
    }

    function open() {
      lastFocus = document.activeElement;
      scrim.classList.add('is-open');
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('is-open'); });
      document.documentElement.classList.add('xg-credit-open');
      load(false);
      var c = panel.querySelector('.' + ID + '__close');
      if (c) c.focus();
    }
    function close() {
      if (!panel || panel.hidden) return;
      panel.classList.remove('is-open');
      scrim.classList.remove('is-open');
      document.documentElement.classList.remove('xg-credit-open');
      setTimeout(function () { panel.hidden = true; }, 220);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    window.xgCredit = { open: open, close: close, refresh: function () { load(true); }, theirs: theirs };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { try { build(); } catch (e) { off(); } });
    else build();
  } catch (e) { try { document.documentElement.classList.remove('xg-credit-on'); } catch (x) {} }
})();
