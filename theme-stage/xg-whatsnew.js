/* Exor Games — "what's new" strip (owner, 2026-09-17: a one-time-per-user
   intro to the new site, as a destination rather than an ambush).

   A thin bar under the header, shown until the shopper dismisses it or
   follows it, then never again in this browser. Deliberately NOT a
   full-screen interstitial on arrival: Google treats those as intrusive on
   mobile, and Privy's newsletter modal already interrupts the first visit.
   The takeover lives at /pages/whats-new, which people reach by choice.

   "One time per user" is really one time per BROWSER - localStorage is per
   device, and a private window or a cleared cache starts over. Same honest
   limit as xg-personal.js's xgGame, and nothing is sent anywhere.

   KEY IS VERSIONED. Bump SEEN to re-announce the next time something big
   ships; the old value stops matching and everyone sees the new strip once.

   Fail-silent throughout: a throw here must never take a page down. */
(function () {
  'use strict';
  try {
    var SEEN = 'xgWhatsNew:v1';     // bump to re-show
    var HREF = '/pages/whats-new';
    var ID = 'xg-whatsnew';

    if (!document.documentElement || !document.addEventListener) return;
    if (document.getElementById(ID)) return;

    // Already on the page it advertises? Nothing to invite.
    var here = (location.pathname || '').replace(/\/+$/, '');
    if (here === HREF || here.indexOf('/pages/whats-new') === 0) return;

    function seen() { try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return false; } }
    function remember() { try { localStorage.setItem(SEEN, '1'); } catch (e) {} }

    // Exposed BEFORE the early returns on purpose. It used to sit at the
    // bottom, which meant that once the strip had been dismissed the script
    // returned early and window.xgWhatsNew never existed - so reset() was
    // unavailable at exactly the moment anyone would reach for it.
    window.xgWhatsNew = {
      key: SEEN,
      seen: seen,
      reset: function () { try { localStorage.removeItem(SEEN); } catch (e) {} }
    };

    if (seen()) return;

    var CSS = '' +
      '#' + ID + '{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;' +
        'gap:4px 10px;padding:8px 44px 8px 16px;position:relative;' +
        'background:var(--xg-surface,#fff);border-bottom:1px solid var(--xg-border,#e3e7ea);' +
        'font-size:13.5px;line-height:1.3;color:var(--xg-ink,#171b1d);text-align:center}' +
      '#' + ID + ' .xgwnb__tag{flex:0 0 auto;padding:3px 9px;border-radius:999px;background:#d9448f;' +
        'color:#fff;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}' +
      '#' + ID + ' .xgwnb__go{color:var(--xg-red,#d62c28);font-weight:800;white-space:nowrap;' +
        'text-decoration:underline;text-underline-offset:2px;border:0!important;padding:0!important}' +
      '#' + ID + ' .xgwnb__go:hover,#' + ID + ' .xgwnb__go:focus-visible{text-decoration:none}' +
      '#' + ID + ' .xgwnb__x{position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
        'width:28px;height:28px;display:flex;align-items:center;justify-content:center;' +
        'margin:0;padding:0;border:0;border-radius:50%;background:none;cursor:pointer;' +
        'color:var(--xg-muted,#707a83);font:inherit;font-size:19px;line-height:1}' +
      '#' + ID + ' .xgwnb__x:hover{color:var(--xg-ink,#171b1d);background:rgba(127,127,127,.14)}' +
      'html[data-xg-theme="dark"] #' + ID + '{background:#181d20;border-bottom-color:#2a3236;color:#eef2f4}' +
      'html[data-xg-theme="dark"] #' + ID + ' .xgwnb__go{color:#ff6a5e}' +
      '@media (max-width:600px){#' + ID + '{font-size:12.5px;padding:8px 40px 8px 12px}}';

    function injectCss() {
      if (document.getElementById(ID + '-css')) return;
      var s = document.createElement('style');
      s.id = ID + '-css';
      s.appendChild(document.createTextNode(CSS));
      (document.head || document.documentElement).appendChild(s);
    }

    function build() {
      if (document.getElementById(ID)) return;
      // Under the header, above the page's own content.
      var host = document.getElementById('PageContainer') ||
                 document.getElementById('MainContent') ||
                 document.body;
      if (!host) return;
      injectCss();

      var bar = document.createElement('div');
      bar.id = ID;
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'What is new at Exor Games');

      var tag = document.createElement('span');
      tag.className = 'xgwnb__tag';
      tag.textContent = 'New';

      var txt = document.createElement('span');
      txt.textContent = 'You can now sell video games the same way you sell cards.';

      var go = document.createElement('a');
      go.className = 'xgwnb__go';
      go.href = HREF;
      go.textContent = 'See what else is new ›';
      go.addEventListener('click', remember);   // followed it: do not nag again

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'xgwnb__x';
      x.setAttribute('aria-label', 'Dismiss');
      x.innerHTML = '&times;';
      x.addEventListener('click', function () {
        remember();
        if (bar.parentNode) bar.parentNode.removeChild(bar);
      });

      bar.appendChild(tag);
      bar.appendChild(txt);
      bar.appendChild(go);
      bar.appendChild(x);

      if (host === document.body) host.insertBefore(bar, host.firstChild);
      else host.insertBefore(bar, host.firstChild);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { try { build(); } catch (e) {} });
    } else {
      build();
    }
  } catch (e) { /* never break a page over a banner */ }
})();
