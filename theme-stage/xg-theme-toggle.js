/* Dark mode toggle — the sun/moon button in the header (desktop icon
   cluster + mobile bar). The boot script in layout/theme.liquid already
   applied the right theme before paint; this file owns the button and the
   stored choice (localStorage.xgTheme). Dark is the default, so the only
   stored value that changes anything is 'light'. xg-dark.css keys every
   rule on html[data-xg-theme="dark"], so flipping the attribute is the
   whole job. */
(function () {
  if (window.__xgThemeToggle) return;
  window.__xgThemeToggle = 1;

  var root = document.documentElement;
  var IC_MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var IC_SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></svg>';

  var css = '' +
    '.xg-theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;' +
      'border:1px solid var(--xg-border,#d7dbdf);border-radius:50%;padding:0;cursor:pointer;' +
      'background:transparent;color:var(--xg-ink,#171b1d);vertical-align:middle;' +
      'transition:border-color 150ms ease,color 150ms ease}' +
    '.xg-theme-toggle:hover{border-color:var(--xg-red,#d62c28);color:var(--xg-red,#d62c28)}' +
    '.header-user-selection .xg-theme-toggle{align-self:center;margin-right:10px}' +
    '.mobile-width-right .xg-theme-toggle{border:0;width:30px;height:30px;margin-right:2px}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function isDark() { return root.getAttribute('data-xg-theme') === 'dark'; }

  function paint() {
    var dark = isDark();
    var btns = document.querySelectorAll('.xg-theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = dark ? IC_SUN : IC_MOON;
      btns[i].setAttribute('aria-pressed', dark ? 'true' : 'false');
      btns[i].setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function apply(dark) {
    if (dark) root.setAttribute('data-xg-theme', 'dark');
    else root.removeAttribute('data-xg-theme');
    paint();
  }

  window.xgSetTheme = function (mode) {
    try { localStorage.setItem('xgTheme', mode === 'dark' ? 'dark' : 'light'); } catch (e) {}
    apply(mode === 'dark');
  };

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.xg-theme-toggle') : null;
    if (!b) return;
    e.preventDefault();
    window.xgSetTheme(isDark() ? 'light' : 'dark');
  });

  /* The device's preference is no longer followed (owner, 2026-09-16: dark is
     the default). This used to listen for prefers-color-scheme changes and
     flip an undecided shopper with it, which would now drag them out of dark
     the moment their phone switched to a light appearance. */

  function makeBtn() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'xg-theme-toggle';
    b.setAttribute('aria-label', 'Toggle dark mode');
    return b;
  }

  function mount() {
    var desk = document.querySelector('#header .header-user-selection');
    if (desk && !desk.querySelector('.xg-theme-toggle')) desk.insertBefore(makeBtn(), desk.firstChild);
    var mob = document.querySelector('#header .mobile-width-right');
    if (mob && !mob.querySelector('.xg-theme-toggle')) mob.insertBefore(makeBtn(), mob.firstChild);
    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
