/* Smart Menu patch - the header mega menu is drawn by the qikify Smart Menu
   app from its own tree, which the app prints into the page as
   _SM.newEntries (an inline script at the end of the body) and then reads
   back in its deferred renderer (smartmenu-v2.js). Deferred scripts run in
   document order, so this one - deferred, in the head - runs after the tree
   is printed and before the renderer reads it, and reshapes the tree in
   place. Owner, 2026-09-11/12: "put sports cards under Trading cards menu
   item instead of being by itself", "ALL PRE ORDERS" -> "PRE-ORDERS", "add
   those new menu items you added for locations and learn to play where they
   make sense", "I want you to edit the smart menu now".

   The app's own editor is the proper home for these edits (its tree lives in
   app-owned metafields the Admin API cannot write). Every step below is
   idempotent and checks the tree first, so once the owner mirrors the changes
   in the app this file does nothing, and its line in layout/theme.liquid can
   be dropped. Each entry also carries data_file_url, a CDN copy of the same
   tree that the renderer prefers when present; it is blanked once the inline
   tree has been patched so the patched tree is the one rendered. Any failure
   leaves the tree exactly as served. */
(function () {
  'use strict';
  try {
    var HUB = 'https://exorgames.com/pages/learn-to-play';
    var GAMES = [
      ['Start here', [['Pokémon', 'pokemon'], ['Magic: The Gathering', 'magic'], ['Disney Lorcana', 'lorcana'], ['One Piece', 'one-piece']]],
      ['More games', [['Yu-Gi-Oh!', 'yu-gi-oh'], ['Star Wars: Unlimited', 'star-wars-unlimited'], ['Riftbound', 'riftbound'], ['Flesh and Blood', 'flesh-and-blood']]]
    ];
    var STORES = [['Charlottetown', 'charlottetown'], ['Summerside', 'summerside'], ['Bridgewater', 'bridgewater'],
                  ['Dartmouth', 'dartmouth'], ['New Glasgow', 'new-glasgow'], ['Truro', 'truro']];
    var seq = 1000000;   // the app's ids are six-digit; seven-digit ones cannot collide
    function id() { return 'tmenu-menu-' + (++seq); }
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function title(it) { return norm(it && it.setting && it.setting.title); }
    function url(href) { return { type: { id: 'link', icon: ['fas', 'external-link-square-alt'], name: 'Custom Link' }, link: href }; }
    // Shapes copied from the live tree: a plain text link (like "Pre Order
    // Policy") and a column with links under it (like "Policies").
    function link(t, href) { return { id: id(), setting: { item_layout: 'text', title: t, url: url(href) }, menus: [] }; }
    function column(t, kids, href) {
      var s = { item_layout: 'text', title: t, column_width: 'automatic', item_content_alignment: 'left' };
      if (href) s.url = url(href); else s.disable_link = true;
      return { id: id(), setting: s, menus: kids, hide_submenu: true };
    }
    // A block of our own markup in a panel. Shape copied from the app's own
    // "Custom contact content" node under Locations & FAQ (item_layout html,
    // custom_html, column_width automatic), read off the live tree by
    // tcg-menu-probe run 35226349921.
    function htmlBlock(t, markup) {
      return { id: id(), setting: { item_layout: 'html', title: t, custom_html: markup, column_width: 'automatic' }, menus: [] };
    }
    // Styled by .xgdbm in assets/xg-features.css (section 16). The screenshot
    // is a CSS background so its URL resolves relative to that stylesheet's
    // own /assets/ folder, with no theme-version number to go stale.
    var DECK_HTML = [
      '<div class="xgdbm">',
      '<p class="xgdbm__kicker">Free tool</p>',
      '<h4 class="xgdbm__title">Price a whole deck in one paste</h4>',
      '<p class="xgdbm__copy">Paste a decklist &mdash; from Moxfield, Archidekt, or a note on your phone &mdash; and we match every line against what is actually on our shelves right now.</p>',
      '<ul class="xgdbm__pts">',
      '<li>The cheapest in-stock printing of every card</li>',
      '<li>Real photos and live prices, six stores in one search</li>',
      '<li>Add the whole deck to your cart in one click</li>',
      '</ul>',
      '<a class="xgdbm__cta" href="https://exorgames.com/pages/deck-builder">Open the Deck Builder</a>',
      '<span class="xgdbm__shot" role="img" aria-label="The Deck Builder pricing a Magic decklist: eight of eight cards in stock, each with its photo, set and price, and a running subtotal."></span>',
      '</div>'
    ].join('');
    // The paint colour picker (sections/xg-paint-picker.liquid, a ?view=paints collection view).
    // Styled by .xgpcm in assets/xg-features.css; the buttons open the picker on one brand.
    var PICK = 'https://exorgames.com/collections/all-paint?view=paints';
    var PAINT_HTML = [
      '<div class="xgdbm xgpcm">',
      '<p class="xgdbm__kicker">New</p>',
      '<h4 class="xgdbm__title">Shop paints by colour</h4>',
      '<p class="xgdbm__copy">Tap a colour to see the bottle, with the closest match from the other brands.</p>',
      '<span class="xgpcm__dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>',
      '<span class="xgpcm__brands">',
      '<a href="' + PICK + '#brand=Citadel">Citadel</a>',
      '<a href="' + PICK + '#brand=The+Army+Painter">Army Painter</a>',
      '<a href="' + PICK + '#brand=Vallejo">Vallejo</a>',
      '</span>',
      '<a class="xgdbm__cta" href="' + PICK + '">Open the colour picker</a>',
      '</div>'
    ].join('');
    // Replaces the "Other Locations" paragraph of the owner's "Custom contact
    // content" block (see step 6). Same inline colour and sizing the rest of
    // that block uses, so the app draws it exactly like the Address and
    // Phone Number entries above it. Mallow Games opens in a new tab like
    // every other Mallow link on the site.
    var VIDEO_HTML = "<p style='color:#D52C28'><strong style='font-size: 1.2em;'>Video Games</strong><br>\n" +
      "<a href=\"https://mallowgames.com/\" target=\"_blank\" rel=\"noopener\" style='color:#D52C28'><strong>Shop at Mallow Games</strong></a>\n</p>";
    // The paragraph as the app stores it: a <p> whose first <strong> reads
    // "Other Locations", through its closing tag. Lazy so it stops at that
    // paragraph's own </p> and never eats the ones before it.
    var OTHER_RE = /<p[^>]*>\s*<strong[^>]*>\s*Other Locations\s*<\/strong>[\s\S]*?<\/p>/;
    function find(list, t) { for (var i = 0; i < list.length; i++) if (title(list[i]) === t) return i; return -1; }
    function has(list, t) {
      for (var i = 0; i < list.length; i++) {
        if (title(list[i]) === t) return true;
        if (list[i].menus && has(list[i].menus, t)) return true;
      }
      return false;
    }
    function walk(list, fn) { for (var i = 0; i < list.length; i++) { fn(list[i]); if (list[i].menus) walk(list[i].menus, fn); } }

    function patch(top) {
      var changed = 0, i;
      // 1. "All Pre Orders" reads "Pre-Orders".
      walk(top, function (it) { if (title(it) === 'all pre orders') { it.setting.title = 'Pre-Orders'; changed++; } });
      // 1b. Battle Systems opens its own collection (owner, 2026-09-25: "in the menu battle
      // systems is going to battle tech. It should be going here: .../collections/all-battle-systems").
      var BS = 'https://exorgames.com/collections/all-battle-systems';
      walk(top, function (it) {
        if (title(it) !== 'battle systems' || !it.setting) return;
        if (it.setting.url && it.setting.url.link === BS) return;
        it.setting.url = url(BS);
        delete it.setting.disable_link;
        changed++;
      });
      var ti = find(top, 'trading cards'), trading = ti > -1 ? top[ti] : null;
      if (trading && trading.menus) {
        // 2. Sports Cards becomes a tab of Trading Cards, in front of Deck Builder.
        var si = find(top, 'sports cards');
        if (si > -1 && find(trading.menus, 'sports cards') === -1) {
          var sports = top.splice(si, 1)[0];
          if (sports.setting) { delete sports.setting.submenu_type; delete sports.setting.submenu_mega_position; delete sports.setting.submenu_mega_width; }
          var di = find(trading.menus, 'deck builder');
          trading.menus.splice(di > -1 ? di : trading.menus.length, 0, sports);
          changed++;
        }
        // 3. Learn to Play: a tab after Deck Builder, two columns of guides.
        if (!has(top, 'learn to play')) {
          var cols = GAMES.map(function (g) {
            return column(g[0], g[1].map(function (x) { return link(x[0], HUB + '-' + x[1]); }), HUB);
          });
          var learn = { id: id(), setting: { item_layout: 'text', title: 'Learn to Play', url: url(HUB) }, menus: cols, hide_submenu: true };
          var dj = find(trading.menus, 'deck builder');
          trading.menus.splice(dj > -1 ? dj + 1 : trading.menus.length, 0, learn);
          changed++;
        }
        // 5. Deck Builder is a bare link, so hovering its tab opened a blank
        //    600x548 panel. Explain the tool there instead.
        var dbi = find(trading.menus, 'deck builder');
        if (dbi > -1 && !(trading.menus[dbi].menus || []).length) {
          trading.menus[dbi].menus = [htmlBlock('Deck Builder', DECK_HTML)];
          changed++;
        }
      }
      // 4. A Locations column, first inside "Locations & FAQ", one store page each.
      var li = -1;
      for (i = 0; i < top.length; i++) if (title(top[i]).indexOf('locations') === 0) { li = i; break; }
      if (li > -1 && top[li].menus && find(top[li].menus, 'locations') === -1) {
        var stores = column('Locations', STORES.map(function (s) { return link(s[0], 'https://exorgames.com/pages/exor-games-' + s[1]); }));
        stores.setting.icon = { id: 'map-marker-alt', name: 'map marker alt', code: '', type: 'fas' };
        top[li].menus.unshift(stores);
        changed++;
      }
      // 6. The contact block's "Other Locations" list repeats the Locations
      //    column step 4 puts beside it. Owner, 2026-09-18: "yellow is
      //    redundant... can you remove it and change it to 'Video Games?'
      //    and then put a link to Mallow Games". Only html nodes whose
      //    markup still carries that paragraph match, so a second pass
      //    finds nothing and changes nothing.
      walk(top, function (it) {
        var s = it && it.setting;
        if (!s || s.item_layout !== 'html' || typeof s.custom_html !== 'string') return;
        if (!OTHER_RE.test(s.custom_html)) return;
        s.custom_html = s.custom_html.replace(OTHER_RE, VIDEO_HTML);
        changed++;
      });
      // 7. Paints gets a "Shop by Colour" tab after Vallejo (owner, 2026-09-25, screenshot of
      //    the Paints menu: "put the color picker in this menu"). Like Deck Builder, the tab
      //    carries a small panel so hovering it does not open a blank one.
      var pi = find(top, 'paints'), paints = pi > -1 ? top[pi] : null;
      if (paints && paints.menus && !has(paints.menus, 'shop by colour')) {
        var tab = { id: id(), setting: { item_layout: 'text', title: 'Shop by Colour', url: url(PICK) }, menus: [htmlBlock('Shop by Colour', PAINT_HTML)], hide_submenu: true };
        var vi = find(paints.menus, 'vallejo');
        paints.menus.splice(vi > -1 ? vi + 1 : paints.menus.length, 0, tab);
        changed++;
      }
      return changed;
    }

    // The renderer's session cache (sessionStorage "qikify_tmenu_v1_<shop>" =
    // {entries: [{id, updated_at, data: {megamenu, ...}}], subscription}) is
    // drawn first when present and kept when its id and updated_at match the
    // inline entry's, so it gets the same patch before the renderer reads it.
    function patchStore() {
      var i, k, obj, changed;
      for (i = 0; i < sessionStorage.length; i++) {
        k = sessionStorage.key(i);
        if (!k || k.indexOf('qikify_tmenu_v1_') !== 0) continue;
        try { obj = JSON.parse(sessionStorage.getItem(k)); } catch (e) { continue; }
        if (!obj || !Array.isArray(obj.entries)) continue;
        changed = 0;
        obj.entries.forEach(function (en) {
          var d = en && en.data, top = d && (d.megamenu || (d.data && d.data.megamenu));
          if (Array.isArray(top)) changed += patch(top);
        });
        if (changed) sessionStorage.setItem(k, JSON.stringify(obj));
      }
    }
    var sm = window._SM, entries = sm && sm.newEntries;
    if (entries && typeof entries === 'object') {
      Object.keys(entries).forEach(function (k) {
        var s = entries[k], top = s && s.data && s.data.data && s.data.data.megamenu;
        if (!Array.isArray(top)) return;
        if (patch(top) && s.data_file_url) s.data_file_url = null;   // the inline tree must be the one rendered
      });
    }
    try { patchStore(); } catch (e) {}
    window.xgMenuPatch = { patch: patch };
  } catch (e) {}
})();
