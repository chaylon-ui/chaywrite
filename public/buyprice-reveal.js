/* "What we pay" reveal — card product pages. A theme shell drops
   <div id="xg-buyprice" data-name data-type data-handle> on singles pages
   and loads this file from the worker.

   Two price sources, best first:
     1. REAL BinderPOS buylist prices via the worker /buyprice.json — only
        answers when the BINDERPOS_API_KEY worker secret is configured.
     2. RULES: /buy-rules.json holds the store's buy percentages (cash +
        store credit as a fraction of sell price, per game, per condition,
        per price band, with per-rarity overrides). Since 2026-09-15 the
        file is read straight out of the BinderPOS portal's Buylist Rules
        every morning with the staff login (binderpos-portal-sync.yml;
        rules._portal / rule.exact), so the ladder is the store's actual
        rule, not a derived estimate. The script reads the product's own
        variants (and its Rarity row) from /products/<handle>.js (same
        origin) and prices each condition from today's live sell price —
        so the numbers track the store's daily repricing.

   Quiet by design: if neither source is live, the button never renders. */
(function () {
  var W = 'https://exor-binder.nevski.workers.dev';
  var root = document.getElementById('xg-buyprice');
  if (!root || root.getAttribute('data-xg-ready')) return;
  root.setAttribute('data-xg-ready', '1');

  var NAME = root.getAttribute('data-name') || '';
  var TYPE = root.getAttribute('data-type') || '';
  var HANDLE = root.getAttribute('data-handle') || '';
  if (!NAME || !/single/i.test(TYPE)) return;   // singles only

  var css = '' +
    '.xg-buy{margin:14px 0;font-family:var(--xg-font-body,"Inter",sans-serif)}' +
    '.xg-buy__btn{display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--xg-ink,#171b1d);border:1.5px dashed var(--xg-accent,#d62c28);border-radius:var(--xg-radius,10px);padding:10px 18px;font-weight:700;font-size:14.5px;cursor:pointer;transition:background-color 120ms ease,color 120ms ease}' +
    /* author CSS outranks the UA's [hidden]{display:none} — restate it, or
       the button shows before (or without) any prices being ready */
    '.xg-buy__btn[hidden]{display:none !important}' +
    '.xg-buy__btn:hover{background:var(--xg-accent,#d62c28);color:#fff}' +
    '.xg-buy__btn[disabled]{opacity:.6;cursor:default}' +
    '.xg-buy__panel{margin-top:10px;border:1px solid var(--xg-border,#e3e6e8);border-radius:var(--xg-radius,12px);background:var(--xg-surface,#fff);padding:14px 16px;max-width:520px}' +
    '.xg-buy__head{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#8a9299;font-weight:600;margin:0 0 10px}' +
    '.xg-buy__row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f4;font-size:14.5px;align-items:baseline}' +
    '.xg-buy__row:last-child{border-bottom:0}' +
    '.xg-buy__what{color:var(--xg-text,#3d454b)}' +
    '.xg-buy__nums{white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.xg-buy__cash{font-weight:700;color:var(--xg-ink,#171b1d)}' +
    '.xg-buy__credit{color:#1a9e57;font-weight:700;margin-left:10px}' +
    '.xg-buy__note{font-size:12px;color:#8a9299;margin:10px 0 0;line-height:1.45}' +
    '.xg-buy__none{font-size:14.5px;color:var(--xg-text,#3d454b);margin:0}' +
    '.xg-buy__sell{display:inline-block;margin-top:10px;font-size:13.5px;color:var(--xg-accent,#d62c28);font-weight:600;text-decoration:none}' +
    '.xg-buy__sell:hover{text-decoration:underline}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function money(n) { return '$' + n.toFixed(2); }

  root.className = (root.className + ' xg-buy').trim();
  root.innerHTML = '<button type="button" class="xg-buy__btn" id="xg-buy-go" hidden>&#128176; Reveal what we pay for this card</button>' +
                   '<div id="xg-buy-out"></div>';
  var btn = document.getElementById('xg-buy-go');
  var out = document.getElementById('xg-buy-out');
  var payload = null;   // {mode:'real'|'estimate', ...}

  function jget(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  function gameRule(rules) {
    var t = TYPE.toLowerCase();
    var gs = rules.games || [];
    for (var i = 0; i < gs.length; i++) {
      if (gs[i] && gs[i].match && t.indexOf(String(gs[i].match).toLowerCase()) > -1) return gs[i];
    }
    return rules.defaults || null;
  }

  // Percentage for one variant: the first tier whose upTo covers the sell
  // price, else the open-ended base; a per-rarity override on that tier
  // (the portal's "per-rarity columns") wins when the card's rarity names it.
  function pct(rule, sell, kind, rarity) {
    var tiers = rule.tiers || [];
    var tier = null;
    for (var i = 0; i < tiers.length; i++) {
      if (sell <= (tiers[i].upTo || 0)) { tier = tiers[i]; break; }
    }
    var src = tier || rule;
    if (rarity && src.rarities && src.rarities[rarity] && typeof src.rarities[rarity][kind] === 'number') return src.rarities[rarity][kind];
    if (tier && typeof tier[kind] === 'number') return tier[kind];
    return typeof rule[kind] === 'number' ? rule[kind] : 0;
  }

  // The store's rules pay different percentages by condition (same card,
  // NM > LP > MP). buy-rules.json carries a per-condition ladder in
  // rule.conds; fall back to the all-condition rule otherwise.
  function condOf(title) {
    var t = String(title || '').toLowerCase();
    if (/near mint|\bnm\b/.test(t)) return 'NM';
    if (/light/.test(t)) return 'LP';
    if (/moderate/.test(t)) return 'MP';
    if (/heav/.test(t)) return 'HP';
    if (/damag|\bdmg\b/.test(t)) return 'DM';
    return '';
  }
  function condRule(rule, vtitle) {
    var c = condOf(vtitle);
    return (c && rule.conds && rule.conds[c]) || rule;
  }

  // The card's rarity, lower-cased to match the rule file's keys. The
  // storefront product JSON carries BinderPOS's rarity as a TAG ("Secret
  // Rare"; body_html is null on singles, 2026-09-15), so the tag that names
  // one of this game's rarities wins; the description table ("Rarity:
  // Secret Rare") is the fallback. Curly apostrophes fold to straight
  // ones, as the sync's norm_r does ("Trainer\u2019s Rare" -> "trainer's rare").
  function foldRarity(s) { return String(s || '').replace(/&rsquo;|&#8217;|\u2019/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(); }
  function rarityKeys(rule) {
    var keys = {};
    function take(o) { if (o && o.rarities) Object.keys(o.rarities).forEach(function (k) { keys[k] = 1; }); }
    take(rule); (rule.tiers || []).forEach(take);
    Object.keys(rule.conds || {}).forEach(function (c) { take(rule.conds[c]); (rule.conds[c].tiers || []).forEach(take); });
    return keys;
  }
  function rarityOf(product, rule) {
    var keys = rarityKeys(rule);
    var tags = product.tags;
    if (typeof tags === 'string') tags = tags.split(',');
    var hit = (tags || []).map(foldRarity).filter(function (t) { return keys[t]; })[0];
    if (hit) return hit;
    var text = foldRarity(String(product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
    var m = /rarity:\s*([a-z][a-z0-9 \-\/']*?)\s*(?:$|[a-z][a-z ]{1,20}:)/.exec(text);
    return m ? m[1].trim() : '';
  }

  function estimateOffers(rules, product) {
    var rule = gameRule(rules);
    if (!rule) return [];
    // A set-specific portal rule (art cards, prize packs, promos) replaces
    // the game's band ladder for that printing: the card's "[Set]" suffix
    // names it. Its conditions carry flat percentages (0 = not buying).
    var setName = (String(product.title || '').match(/\[([^\]]+)\]/) || [])[1];
    var setRule = setName && rule.sets && rule.sets[String(setName).trim().toLowerCase()];
    var base = setRule ? { conds: setRule.conds || {}, cash: 0, credit: 0, tiers: [] } : rule;
    var rarity = rule.exact ? rarityOf(product, rule) : '';
    var minSell = typeof rule.minSell === 'number' ? rule.minSell : 0;
    // Evidence ceiling (feed-derived rules only): above the highest observed
    // sell an estimate would be extrapolation. Portal rules set it to 1e6.
    var maxSell = typeof rule.maxSell === 'number' ? rule.maxSell : Infinity;
    var buyFoils = rule.buyFoils !== false;
    var RANK = { DM: 0, HP: 1, MP: 2, LP: 3, NM: 4 };
    var rows = [];
    // $999,999.00 is the store's "email us for pricing" sentinel: a product
    // carrying it on any variant is deliberately unpriced, so no buy estimate
    // at all (owner 2026-09-15), not just that variant skipped.
    var placeholder = (product.variants || []).some(function (v) { return (v.price || 0) / 100 >= 99999; });
    if (placeholder) return [];
    (product.variants || []).forEach(function (v) {
      var sell = (v.price || 0) / 100;
      if (!(sell > 0) || sell >= 99999) return;           // placeholder pricing
      if (sell < minSell || sell > maxSell) return;        // evidence bounds
      var foil = /foil/i.test(v.title || '');
      if (foil && !buyFoils) return;
      var r2 = condRule(base, v.title);
      var rank = RANK[condOf(v.title)];
      rows.push({
        title: v.title || '', foil: foil, sell: sell,
        rank: typeof rank === 'number' ? rank : -1,
        cashPct: pct(r2, sell, 'cash', rarity), creditPct: pct(r2, sell, 'credit', rarity)
      });
    });
    // Feed-DERIVED ladders can invert (a condition with sparse data falls
    // back to a blended rate), so a better condition is lifted to the best
    // rate of any equal-or-worse condition. Portal rules are the store's
    // exact numbers, so they are never adjusted (rule.exact).
    if (!rule.exact) {
      rows.forEach(function (r) {
        if (r.rank < 0) return;
        rows.forEach(function (o) {
          if (o.rank > -1 && o.rank <= r.rank) {
            if (o.cashPct > r.cashPct) r.cashPct = o.cashPct;
            if (o.creditPct > r.creditPct) r.creditPct = o.creditPct;
          }
        });
      });
    }
    var offers = [];
    rows.forEach(function (r) {
      var cash = r.cashPct * r.sell;
      var credit = r.creditPct * r.sell;
      if (!(cash > 0) && !(credit > 0)) return;
      offers.push({
        condition: r.title,
        foil: r.foil,
        cash: cash > 0 ? cash : null,
        credit: credit > 0 ? credit : null
      });
    });
    return offers;
  }

  // Source cascade: real BinderPOS prices when the key is live, else the
  // portal's rules (or feed-derived estimates) applied to today's sell prices.
  jget(W + '/buyprice.json?name=' + encodeURIComponent(NAME) + '&type=' + encodeURIComponent(TYPE)).then(function (real) {
    if (real && real.available) {
      // real.estimate marks rule-derived numbers (the card's own BinderPOS
      // rule stamps × today's sell prices) — shown with the disclaimer,
      // unlike keyed till quotes.
      payload = { mode: real.estimate ? 'estimate' : 'real', exact: !!(real.rules && real.rules._portal), name: real.name, offers: real.offers || [], disclaimer: (real.rules && real.rules.disclaimer) || '', updated: (real.rules && real.rules.updated) || '' };
      btn.hidden = false;
      return;
    }
    // The probe response carries the daily rules (the raw /buy-rules.json
    // asset has no CORS header, so fetching it directly is blocked in real
    // browsers — the direct fetch stays only as a fallback).
    var rulesSrc = (real && real.rules) ? Promise.resolve(real.rules) : jget(W + '/buy-rules.json');
    return rulesSrc.then(function (rules) {
      if (!rules || !rules.enabled) return;
      var p = HANDLE ? jget('/products/' + HANDLE + '.js') : Promise.resolve(null);
      return Promise.resolve(p).then(function (product) {
        if (!product) return;
        var offers = estimateOffers(rules, product);
        // A game with no rules gets NO button (never guess one game's offer
        // from another's).
        if (!offers.length) return;
        payload = { mode: 'estimate', exact: !!rules._portal, name: NAME, offers: offers, disclaimer: rules.disclaimer || '', updated: rules.updated || '' };
        btn.hidden = false;
      });
    });
  });

  btn.addEventListener('click', function () {
    btn.disabled = true;
    render(payload);
  });

  function render(d) {
    btn.hidden = true;
    if (!d || !d.offers || !d.offers.length) {
      out.innerHTML = '<div class="xg-buy__panel"><p class="xg-buy__none">We’re not actively buying this card right now — but bring it in anyway: bulk and collection offers happen in store every day.</p>' +
        '<a class="xg-buy__sell" href="/pages/sell-to-exor-games-bulk-or-create-a-list">Ways to sell us cards ›</a></div>';
      return;
    }
    var isEst = d.mode === 'estimate';
    var rows = d.offers.map(function (o) {
      var what = [o.set, !o.set && o.foil ? '' : null, o.condition].filter(Boolean).join(' · ') || o.condition || d.name;
      return '<div class="xg-buy__row">' +
        '<span class="xg-buy__what">' + esc(what) + '</span>' +
        '<span class="xg-buy__nums">' +
          (o.cash ? '<span class="xg-buy__cash">' + (typeof o.cash === 'number' ? money(o.cash) : '$' + esc(o.cash)) + ' cash</span>' : '') +
          (o.credit ? '<span class="xg-buy__credit">' + (typeof o.credit === 'number' ? money(o.credit) : '$' + esc(o.credit)) + ' credit</span>' : '') +
        '</span>' +
      '</div>';
    }).join('');
    var note = isEst
      ? esc(d.disclaimer || 'Estimate only — final offer confirmed when we check your cards.') + (d.updated ? ' <span>(rules read ' + esc(d.updated) + ')</span>' : '')
      : 'Prices assume the listed condition on arrival and can change daily. Store credit goes further — and there’s more where this came from.';
    out.innerHTML = '<div class="xg-buy__panel">' +
      '<p class="xg-buy__head">' + (isEst && !d.exact ? 'What we pay (estimate) — ' : 'What we pay — ') + esc(d.name) + '</p>' + rows +
      '<p class="xg-buy__note">' + note + '</p>' +
      '<a class="xg-buy__sell" href="/pages/sell-to-exor-games-bulk-or-create-a-list">Sell us your cards ›</a>' +
      '</div>';
  }
})();
