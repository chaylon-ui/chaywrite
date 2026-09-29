/* Staff screens: an account first, the old staff PIN only while it is on
   (owner, 2026-09-29: username and password with 2FA instead of the PIN;
   the worker side is src/staff-access.js).

   XGStaff.me(perm) asks the worker who is looking and whether they may use
   this screen: { signedIn, name, allowed, pinOn, login }. The session cookie
   rides along by itself (same site), so a signed-in page sends no PIN at all.
   XGStaff.signin(me) is the "Sign in" link back to this very page. */
(function () {
  function here() { return location.pathname + location.search; }
  async function me(perm) {
    try {
      const r = await fetch('/staff/me.json?perm=' + encodeURIComponent(perm) + '&next=' + encodeURIComponent(here()), { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      // unreachable: offer both ways in, the worker decides
      return { signedIn: false, allowed: false, pinOn: true, login: '/9pocket/login?next=' + encodeURIComponent(here()), offline: true };
    }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function signin(m, label) {
    return '<a class="xg-signin" href="' + esc((m && m.login) || '/9pocket/login') + '">' + esc(label || 'Sign in with your staff account') + '</a>';
  }
  // One line for the top of a page: who is signed in, or why not.
  function line(m) {
    if (m.allowed) return 'Signed in as <b>' + esc(m.name) + '</b>';
    if (m.signedIn) return 'Signed in as <b>' + esc(m.name) + '</b>, but this account may not use this screen - ask an admin (9Pocket › Admin › Store screens).';
    return m.pinOn ? 'Sign in with your staff account (the old PIN still works for now).' : 'Sign in with your staff account.';
  }
  window.XGStaff = { me: me, signin: signin, line: line, esc: esc };
})();
