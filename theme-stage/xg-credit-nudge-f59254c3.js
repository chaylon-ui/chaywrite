/* Exor Games - store credit and trade-in nudges (owner, 2026-09-29: "do number 3": show the
   shopper's store credit where they are about to spend, and offer trading cards in toward
   what they are looking at).

   Product page ([data-xg-cn], under the buy buttons):
     signed in with credit  -> "You have $12.40 in store credit" (+ "that covers this one")
     otherwise, from $40    -> "Pay with your cards": trade in for credit, link to the buylist
   Cart page ([data-xg-cn-cart], above the subtotal):
     signed in with credit  -> the balance and roughly what the order comes to after it
     signed out             -> sign in to use store credit
     signed in, no credit   -> trade in your cards next time
   Cart dropdown (.cart__store-credit-info): the balance joins the existing "go to Cart" line.

   The balance comes from window.xgCredit (assets/xg-store-credit.js: the shopper's own browser
   asks BinderPOS; signed-in shoppers only). No balance, no credit line - never a wrong one. */
(function () {
  'use strict';
  var SELL = '/pages/sell-to-exor-games-bulk-or-create-a-list', BUY = '/pages/selling-to-exor-games-buylist';
  function money(v) { return '$' + (Math.round(Number(v) * 100) / 100).toFixed(2); }
  var CSS = '.xg-cn{display:flex;gap:10px;align-items:flex-start;margin:12px 0 6px;padding:10px 12px;border-radius:10px;font-size:13.5px;line-height:1.45;' +
    'background:rgba(26,158,111,.08);border:1px solid rgba(26,158,111,.3);color:var(--xg-ink,#171b1d)}.xg-cn[hidden]{display:none}' +
    '.xg-cn__i{flex:0 0 auto;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#1a9e6f;color:#fff;font-weight:800;font-size:14px}' +
    '.xg-cn strong{color:inherit}.xg-cn a{color:#137a55!important;font-weight:700;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}' +
    '.xg-cn--trade{background:rgba(214,44,40,.06);border-color:rgba(214,44,40,.25)}.xg-cn--trade .xg-cn__i{background:var(--xg-red,#d62c28)}.xg-cn--trade a{color:var(--xg-red,#d62c28)!important}' +
    '.xg-cn--cart{margin:0 0 12px;text-align:left}' +
    'html[data-xg-theme="dark"] .xg-cn{color:#e6ebee;background:rgba(79,209,165,.1);border-color:rgba(79,209,165,.35)}html[data-xg-theme="dark"] .xg-cn a{color:#4fd1a5!important}' +
    'html[data-xg-theme="dark"] .xg-cn--trade{background:rgba(255,106,94,.08);border-color:rgba(255,106,94,.3)}html[data-xg-theme="dark"] .xg-cn--trade a{color:#ff6a5e!important}' +
    '.cart__store-credit-info b.xg-cn-bal{color:#1a9e6f}html[data-xg-theme="dark"] .cart__store-credit-info b.xg-cn-bal{color:#4fd1a5}';
  function style() { if (document.getElementById('xg-cn-css')) return; var st = document.createElement('style'); st.id = 'xg-cn-css'; st.textContent = CSS; document.head.appendChild(st); }
  function fill(el, cls, icon, html) { style(); el.className = 'xg-cn ' + cls; el.innerHTML = '<span class="xg-cn__i" aria-hidden="true">' + icon + '</span><span>' + html + '</span>'; el.hidden = false; }
  function bal() { return window.xgCredit && typeof window.xgCredit.balance === 'function' ? window.xgCredit.balance() : Promise.resolve(null); }
  var signedIn = !!(window.__st && window.__st.cid);

  function product() {
    var el = document.querySelector('[data-xg-cn]');
    if (!el) return;
    var cents = +el.getAttribute('data-price') || 0;
    bal().then(function (v) {
      if (typeof v === 'number' && v > 0.009) {
        fill(el, 'xg-cn--credit', '$', '<strong>You have ' + money(v) + ' in store credit.</strong> ' +
          (v * 100 >= cents && cents > 0 ? 'That covers this one - ' : 'Put it toward this - ') + 'apply it in your cart before you check out.');
      } else if (cents >= 4000) {
        fill(el, 'xg-cn--trade', '&#8644;', '<strong>Pay with your cards.</strong> Trade in cards for store credit toward this - credit pays more than cash. <a href="' + BUY + '">Build a buylist &rsaquo;</a>');
      }
    });
  }
  function cart() {
    var el = document.querySelector('[data-xg-cn-cart]');
    if (!el) return;
    var cents = +el.getAttribute('data-total') || 0;
    if (!signedIn) {
      fill(el, 'xg-cn--cart xg-cn--credit', '$', '<strong>Have store credit?</strong> <a href="/account/login?return_url=%2Fcart">Sign in</a> to use it on this order.');
      return;
    }
    bal().then(function (v) {
      if (typeof v === 'number' && v > 0.009) {
        var after = Math.max(0, cents / 100 - v);
        fill(el, 'xg-cn--cart xg-cn--credit', '$', '<strong>You have ' + money(v) + ' in store credit.</strong> Apply it here in your cart' +
          (cents ? ' and this order comes to about ' + money(after) + ' before tax and shipping.' : '.'));
      } else {
        fill(el, 'xg-cn--cart xg-cn--trade', '&#8644;', '<strong>Got cards you don’t play?</strong> Trade them in for store credit next time - it pays more than cash. <a href="' + SELL + '">How to sell &rsaquo;</a>');
      }
    });
  }
  function dropdown() {
    if (!signedIn) return;
    bal().then(function (v) {
      if (!(typeof v === 'number' && v > 0.009)) return;
      style();
      [].forEach.call(document.querySelectorAll('.cart__store-credit-info'), function (el) {
        if (el.getAttribute('data-xg-cn')) return;
        el.setAttribute('data-xg-cn', '1');
        el.innerHTML = 'You have <b class="xg-cn-bal">' + money(v) + '</b> in store credit - <a href="/cart">use it in your cart</a>';
      });
    });
  }
  function run() { try { product(); cart(); dropdown(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
