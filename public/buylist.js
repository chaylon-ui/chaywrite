/* Exor Games buylist on top of BinderPOS: search (game, card name, a typed
   set), a cart that is BinderPOS's own saved draft for the account, and
   submit. Mounts on the first .xg-buylist element:
     data-api       /buylist/api (signed-in customer) or /buylist/poc (owner)
     data-worker    base URL of the worker, empty when same-origin
     data-customer  the signed-in customer's id (the theme writes it)
     data-game      starting game id, mtg by default
   The worker (src/buylist.js in chaywrite) talks to BinderPOS. Set symbols
   for Magic come with the set list. */
(function () {
  "use strict";
  var root = document.querySelector(".xg-buylist");
  if (!root || root.getAttribute("data-mounted")) return;
  var CUSTOMER = root.getAttribute("data-customer") || "";
  // The game tiles above the section are ours from the first moment, signed
  // in or not: a capture-phase listener on the document takes the click
  // before BinderPOS's own buylist script (bound to the same #buylist links)
  // can open its "Select Game" overlay (owner, 2026-09-22: "these buttons
  // are still triggering the BinderPOS popup"). preventDefault keeps the
  // hash unchanged too. Signed in, wireTiles() below adds the game pick.
  function fixedBottom() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--xg-fixed-bottom")) || 0;
    if (!v) {
      var hdr = document.querySelector(".fixed-header, #header .site-header, #header");
      if (hdr && /fixed|sticky/.test(getComputedStyle(hdr).position)) v = hdr.getBoundingClientRect().bottom;
    }
    return Math.max(0, v);
  }
  function landOn(el) {
    var GAP = 16, html = document.documentElement;
    var hdr = document.querySelector("#header .site-header, #header");
    var guess = fixedBottom() || (hdr ? hdr.getBoundingClientRect().height : 0);
    var prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    el.style.scrollMarginTop = (guess + GAP) + "px";
    try { el.scrollIntoView({ block: "start" }); } catch (err) { el.scrollIntoView(true); }
    var tries = 0;
    (function settle() {
      if (++tries > 6) { html.style.scrollBehavior = prev; return; }
      setTimeout(function () {
        var want = fixedBottom() + GAP, have = el.getBoundingClientRect().top;
        if (Math.abs(have - want) > 6 && (window.pageYOffset > 0 || have > want)) window.scrollBy(0, have - want);
        settle();
      }, 120);
    })();
  }
  (function guardTiles() {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('a[href="#buylist"]'));
    if (!tiles.length) return;
    var diag = window.__xgTileGuard = { armed: tiles.length, fired: 0, from: null, to: null };
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href="#buylist"]') : null;
      if (!a || tiles.indexOf(a) < 0) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      diag.fired++; diag.from = window.pageYOffset;
      // Land with the section's top just under the fixed header, not behind
      // it (owner, 2026-09-22: "it scrolls down too low"). The theme's
      // header only becomes fixed AFTER the page scrolls (.fixed-header),
      // and xg-header-offset.js publishes its bottom edge as
      // --xg-fixed-bottom on <html> once it has, so: jump first with the
      // best guess, then re-measure a few times and nudge into place.
      // Instant scrolling on purpose - the live page cut a smooth scrollTo
      // short at 39px (probe 2026-09-22), and nudges need settled positions.
      landOn(root);
      diag.to = window.pageYOffset;
      var cart = root.querySelector(".bl__cart"); if (cart) cart.scrollTop = 0;
      if (typeof window.__xgTilePick === "function") window.__xgTilePick(a);
    }, true);
  })();
  if (!CUSTOMER) return;                       // logged out: the page shows its own prompt
  root.setAttribute("data-mounted", "1");
  var W = (root.getAttribute("data-worker") || "").replace(/\/+$/, "");
  var API = root.getAttribute("data-api") || "/buylist/api";
  var game = root.getAttribute("data-game") || "mtg";
  var PAGE = 20;

  root.innerHTML =
    '<div class="bl">' +
      '<div class="bl__main">' +
        '<form id="bl-form" class="bl__bar" autocomplete="off">' +
          '<select id="bl-game" class="bl__select" aria-label="Game"></select>' +
          '<input id="bl-q" class="bl__input" type="search" placeholder="Card name" aria-label="Card name">' +
          '<span class="bl__setwrap"><img id="bl-setpick" class="bl__seticon bl__seticon--pick" alt="" hidden>' +
            '<input id="bl-set" class="bl__input bl__input--set" list="bl-sets" placeholder="Any set – type to filter" aria-label="Set"><datalist id="bl-sets"></datalist></span>' +
          '<button type="submit" class="bl__btn bl__btn--primary">Search</button>' +
        '</form>' +
        '<p id="bl-status" class="bl__status bl__muted"></p>' +
        '<div id="bl-hits"></div>' +
        '<button id="bl-more" type="button" class="bl__btn bl__more" hidden>Show more</button>' +
      '</div>' +
      '<aside class="bl__cart">' +
        // Phones: the panel is a bottom sheet and this bar is all that shows
        // until it is tapped (buylist.css, max-width 860px). Hidden on desktop.
        // Owner, 2026-09-20 (phone screenshot, the bar's right end circled):
        // "This should have Submit buylist and view your buylist details
        // button". View opens the sheet (the chevron lives in it now);
        // Submit opens the sheet and runs the same submit as the button
        // inside it, so the confirm names the payment type chosen there.
        '<div id="bl-sheetbar" class="bl__sheetbar" role="button" tabindex="0" aria-expanded="false" aria-controls="bl-lines"><span class="bl__sheettext"><b>Your buylist</b><span id="bl-sheetsum" class="bl__sheetsum bl__muted">Empty</span></span>' +
          '<span class="bl__sheetbtns"><button id="bl-sheetview" type="button" class="bl__btn bl__btn--sm"><span id="bl-sheetviewtxt">View</span> <span class="bl__chev" aria-hidden="true">&#9650;</span></button><button id="bl-sheetsubmit" type="button" class="bl__btn bl__btn--primary bl__btn--sm" disabled>Submit</button></span></div>' +
        '<h2 class="bl__h2"><span class="bl__tray" aria-hidden="true"></span>Your buylist <span id="bl-count" class="bl__muted"></span><small>The cards you are sending to Exor Games</small></h2>' +
        '<div id="bl-lines"><p class="bl__muted">Loading your saved list…</p></div>' +
        '<div class="bl__pay"><label><input type="radio" name="bl-pay" value="Cash" checked> Cash</label><label><input type="radio" name="bl-pay" value="Store Credit"> Store credit</label></div>' +
        '<div class="bl__totals"><span>Cash <b id="bl-tcash">$0.00</b></span><span>Store credit <b id="bl-tcredit">$0.00</b></span></div>' +
        '<div class="bl__actions"><button id="bl-clear" type="button" class="bl__btn" disabled>Clear list</button><button id="bl-submit" type="button" class="bl__btn bl__btn--primary" disabled>Submit buylist</button></div>' +
        '<p id="bl-msg" class="bl__msg bl__muted"></p>' +
        '<div id="bl-mine" class="bl__mine" hidden></div>' +
      '</aside>' +
      '<div id="bl-toast" class="bl__toast" role="status" aria-live="polite"></div>' +
      '<dialog id="bl-guide" class="bl__guide" aria-labelledby="bl-guide-title"></dialog>' +
      '<dialog id="bl-done" class="bl__guide bl__done" aria-labelledby="bl-done-title"></dialog>' +
      '<dialog id="bl-confirm" class="bl__guide bl__confirm" aria-labelledby="bl-confirm-title"></dialog>' +
    '</div>';

  var $ = function (s) { return root.querySelector(s); };
  var cart = [];            // the draft list, mirrored to BinderPOS after every change (their app does the same)
  var maxByKey = {};        // how many the store buys, per offer, from the search hit (this session only)
  var games = [], sets = [], iconBySet = {};
  // The Riftbound buylist lives in SortSwift. #riftTrigger is the page's own
  // Riftbound tile, so clicking it gives exactly the tile's behaviour (the
  // modal); the URL is the fallback when this app is used on a page without it.
  var RIFT = { id: "rift-sortswift", name: "Riftbound: League of Legends", url: "https://buylist.sortswift.com/?s=61dfa8766c5f9fa6" };
  var lastHits = [], lastQuery = null;
  var saveTimer = null, saveChain = Promise.resolve(), toastTimer = null;

  function money(n) { return "$" + (Number(n) || 0).toFixed(2); }
  function qty(c) { return Math.max(1, parseInt(c.quantity, 10) || 1); }
  function keyOf(c) { return [c.cardId, c.condition, c.type].join("|"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function setStatus(t) { $("#bl-status").textContent = t; }
  function setMsg(t) { $("#bl-msg").textContent = t; }
  function toast(text) {
    var t = $("#bl-toast");
    t.textContent = text;
    t.classList.add("bl__toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("bl__toast--show"); }, 2600);
  }
  function seticon(name) {
    var u = iconBySet[name];
    return u ? '<img class="bl__seticon" src="' + esc(u) + '" alt="" loading="lazy">' : "";
  }

  function api(path, body) {
    var url = W + API + path + (path.indexOf("?") >= 0 ? "&" : "?") + "customer=" + encodeURIComponent(CUSTOMER);
    var init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined;
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      });
    });
  }

  /* ---- games and sets ---- */
  function loadGames() {
    var fallback = [{ id: "mtg", name: "Magic: The Gathering" }];
    return api("/games").then(function (j) {
      games = Array.isArray(j.games) && j.games.length ? j.games : fallback;
    }).catch(function () { games = fallback; }).then(function () {
      // Riftbound is bought through SortSwift, not BinderPOS (owner,
      // 2026-09-16), so any BinderPOS entry for it is dropped and the option
      // below takes its place: choosing it opens the same portal the
      // Riftbound tile opens instead of searching a buylist we do not run.
      games = games.filter(function (g) { return !/riftbound/i.test(g.id + " " + g.name); });
      games.push({ id: RIFT.id, name: RIFT.name });
      if (!games.some(function (g) { return g.id === game; })) game = games[0].id;
      $("#bl-game").innerHTML = games.map(function (g) {
        return '<option value="' + esc(g.id) + '"' + (g.id === game ? " selected" : "") + ">" + esc(g.name) + "</option>";
      }).join("");
    });
  }
  function loadSets() {
    sets = []; iconBySet = {};
    $("#bl-sets").innerHTML = "";
    return api("/sets?game=" + encodeURIComponent(game)).then(function (j) {
      sets = Array.isArray(j.sets) ? j.sets : [];
      $("#bl-sets").innerHTML = sets.map(function (s) { return '<option value="' + esc(s.name) + '"></option>'; }).join("");
      sets.forEach(function (s) { if (s.icon) iconBySet[s.name] = s.icon; });
    }).catch(function () {});
  }
  // What was typed in the set box: {name} when it is clearly one of the
  // store's sets (exact, or the only set starting with or containing it),
  // {candidates} when several fit, neither when nothing does.
  function resolveSet(typed) {
    var t = typed.trim();
    if (!t) return { name: "" };
    var lower = t.toLowerCase();
    var exact = sets.filter(function (s) { return s.name.toLowerCase() === lower; })[0];
    if (exact) return { name: exact.name };
    var starts = sets.filter(function (s) { return s.name.toLowerCase().indexOf(lower) === 0; });
    if (starts.length === 1) return { name: starts[0].name };
    var within = sets.filter(function (s) { return s.name.toLowerCase().indexOf(lower) >= 0; });
    if (within.length === 1) return { name: within[0].name };
    var pool = starts.length ? starts : within;
    return { name: "", candidates: pool.slice(0, 12).map(function (s) { return s.name; }), total: pool.length };
  }
  function showChoices(res) {
    var box = $("#bl-status");
    box.innerHTML = "Which set? " + res.candidates.map(function (n) {
      return '<button type="button" class="bl__chip" data-set="' + esc(n) + '">' + esc(n) + "</button>";
    }).join("") + (res.total > res.candidates.length ? ' <span class="bl__muted">and ' + (res.total - res.candidates.length) + " more, keep typing</span>" : "");
  }
  $("#bl-status").addEventListener("click", function (e) {
    var b = e.target.closest("button.bl__chip");
    if (!b) return;
    $("#bl-set").value = b.getAttribute("data-set");
    search(false);
  });
  function showPick(name) {
    var img = $("#bl-setpick"), u = iconBySet[name];
    if (u) { img.src = u; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }
  }

  /* ---- search ---- */
  $("#bl-form").addEventListener("submit", function (e) { e.preventDefault(); search(false); });
  $("#bl-more").addEventListener("click", function () { search(true); });
  $("#bl-game").addEventListener("change", function () {
    if ($("#bl-game").value === RIFT.id) {
      var trigger = document.getElementById("riftTrigger");
      if (trigger) trigger.click(); else window.open(RIFT.url, "_blank", "noopener");
      $("#bl-game").value = game;                       // back to the game that was showing
      $("#bl-status").innerHTML = 'Riftbound is bought through our partner portal: ' +
        '<a class="bl__link" href="' + RIFT.url + '" target="_blank" rel="noopener">open the Riftbound buylist</a>.';
      return;
    }
    game = $("#bl-game").value;
    $("#bl-set").value = "";
    showPick("");
    $("#bl-hits").innerHTML = "";
    $("#bl-more").hidden = true;
    lastHits = []; lastQuery = null;
    setStatus("");
    loadSets().then(function () { if ($("#bl-q").value.trim().length >= 2) search(false); });
  });
  $("#bl-set").addEventListener("change", function () {
    if ($("#bl-q").value.trim().length >= 2 || $("#bl-set").value.trim()) search(false);
  });

  function search(more) {
    var q = $("#bl-q").value.trim();
    var typed = $("#bl-set").value.trim();
    var res = resolveSet(typed);
    if (typed && !res.name && res.candidates && res.candidates.length) { showChoices(res); return; }
    var set = res.name || typed;             // unknown text goes to BinderPOS as typed
    if (set !== $("#bl-set").value) $("#bl-set").value = set;
    showPick(set);
    if (q.length < 2 && !set) { setStatus("Type a card name, or pick a set."); return; }
    var same = lastQuery && lastQuery.q === q && lastQuery.set === set && lastQuery.game === game;
    var offset = more && same ? lastQuery.offset + PAGE : 0;
    if (!offset) { $("#bl-hits").innerHTML = ""; lastHits = []; }
    $("#bl-more").hidden = true;
    setStatus(offset ? "Loading more…" : "Searching…");
    var what = (q ? "“" + q + "”" : "") + (set ? (q ? " in " : "") + set : "");
    var mine = lastQuery = { q: q, set: set, game: game, offset: offset };
    api("/search?q=" + encodeURIComponent(q) + "&game=" + encodeURIComponent(game) + "&offset=" + offset + (set ? "&set=" + encodeURIComponent(set) : "")).then(function (j) {
      if (mine !== lastQuery) return;            // a newer search took over
      var hits = Array.isArray(j.hits) ? j.hits : [];
      var start = lastHits.length;
      lastHits = lastHits.concat(hits);
      renderHits(hits, start);
      $("#bl-more").hidden = !j.more;
      setStatus(lastHits.length ? lastHits.length + " result" + (lastHits.length === 1 ? "" : "s") + " for " + what + (j.more ? " so far" : "") : "Nothing on the buylist matches " + what + ".");
    }).catch(function (err) { if (mine === lastQuery) setStatus("Search failed: " + err.message); });
  }

  // One row per condition x finish the store is buying.
  // Offers come from BinderPOS interleaved (Near Mint Foil, Near Mint,
  // Lightly Played Foil, ...). Shown non-foil first, then foil, then any
  // other finish, each in NM, LP, MP, HP, DMG order (owner, 2026-09-11).
  var COND_RANK = ["near mint", "lightly played", "moderately played", "heavily played", "damaged"];
  function condRank(name) {
    var s = String(name || "").toLowerCase();
    for (var i = 0; i < COND_RANK.length; i++) if (s.indexOf(COND_RANK[i]) === 0) return i;
    return COND_RANK.length;
  }
  function finishRank(type) {
    var t = String(type || "").toLowerCase();
    return !t || t === "normal" ? 0 : t === "foil" ? 1 : 2;
  }
  function offersOf(h) {
    var out = [];
    (h.variants || []).forEach(function (v) {
      (v.cardBuylistTypes || []).forEach(function (p) {
        var cash = Number(p.buyPrice) || 0, credit = Number(p.creditBuyPrice) || 0;
        if (cash <= 0 && credit <= 0) return;
        out.push({ v: v, p: p, cash: cash, credit: credit, max: Number(p.maxPurchaseQuantity) || 0 });
      });
    });
    out.sort(function (a, b) {
      return finishRank(a.p.type) - finishRank(b.p.type) ||
        condRank(a.v.variantName) - condRank(b.v.variantName) ||
        String(a.p.type || "").localeCompare(String(b.p.type || ""));
    });
    return out;
  }
  // A foil (or other finish) row wears its finish loudly: the pill is a
  // holographic badge and the whole row is tinted, and a band separates the
  // foil block from the plain rows (owner, 2026-09-15: "make foil stand out
  // better while they are looking here to make sure they pick the right one").
  function finish(type) { return type && type !== "Normal" ? ' <span class="bl__pill bl__pill--finish">✦ ' + esc(type) + "</span>" : ""; }
  function finishClass(type) { return type && type !== "Normal" ? " bl__orow--finish" : ""; }
  function finishBand(type) { return '<div class="bl__orow bl__orow--band" role="row"><span class="bl__band" role="cell">✦ ' + esc(type) + ' versions below</span></div>'; }

  /* Tap a condition in the offers table to see the store's own grading
     examples — the words and photos from /pages/grading-guide — so fewer
     cards arrive graded wrong (owner, 2026-09-10). */
  var GUIDE = [
    { k: "nm", m: /^near mint/i, name: "Near Mint (NM)", img: "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/image2.png?v=1712685664", pts: [
      ["Appearance", "Minor superficial imperfections at most. Near Mint is not Mint, and not guaranteed to be suitable for grading."],
      ["Surface", "Free from noticeable scratches and scuffs."],
      ["Edges", "Sharp and clean, with little noticeable whitening or wear."],
      ["Corners", "Crisp, with no bends, fraying or whitening beyond the manufacturing process."],
      ["Other", "No clouding, staining or other imperfections. Foils have little to no scuffing or clouding."]] },
    { k: "lp", m: /^lightly played/i, name: "Lightly Played (LP)", img: "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/image4.png?v=1712685664", pts: [
      ["Appearance", "Minor imperfections that are visible on close inspection."],
      ["Surface", "Minor surface wear or a few very light scratches."],
      ["Edges", "Slight edge wear or a bit of whitening."],
      ["Corners", "Lightly worn corners or a minor bend."],
      ["Other", "No major creases. Foils may have light scuffing or minor clouding."]] },
    { k: "mp", m: /^moderately played/i, name: "Moderately Played (MP)", img: "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/image1_b9974032-87c5-45a0-928a-5b06e5085956.png?v=1712685664", pts: [
      ["Appearance", "Moderate wear, but fine for sleeved play."],
      ["Surface", "Noticeable scuffing or light scratches."],
      ["Edges", "Moderate edge wear or whitening."],
      ["Corners", "Moderate wear or minor creases."]] },
    { k: "hp", m: /^heavily played/i, name: "Heavily Played (HP)", img: "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/hp.png?v=1712686010", pts: [
      ["Appearance", "Significant wear, but the card is intact and lies flat."],
      ["Surface", "Scuffing, scratches or minor staining."],
      ["Edges", "Significant edge wear, whitening or minor tears."],
      ["Corners", "Worn, possibly with minor tears or heavy creases."],
      ["Other", "Major creases, fading or minor water damage may be present. Foils show significant clouding or wear."]] },
    { k: "dmg", m: /^damaged/i, name: "Damaged (DMG)", img: "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/image3.png?v=1712685664", pts: [
      ["Appearance", "Major flaws that affect the card's structure or looks."],
      ["Surface", "Heavy scratches, staining, indents, holes or inking."],
      ["Edges", "Frayed edges or significant tears."],
      ["Corners", "Heavy wear, major creases or significant bends."],
      ["Other", "Torn, water-damaged or written on. Foils in this condition are usually not tournament-legal."]] }
  ];
  // Sharper example photos, when the theme editor has them (page.liquid,
  // sell page: "Condition photo" pickers -> data-guide-nm/lp/mp/hp/dmg).
  GUIDE.forEach(function (g) { var u = root.getAttribute("data-guide-" + g.k); if (u) g.img = u; });
  var GUIDE_NOTE = "Grading is a scale and we grade fairly. Minor manufacturing defects such as print lines, cut lines, edge wear and centering are not counted against a card.";
  function guideFor(name) { for (var i = 0; i < GUIDE.length; i++) if (GUIDE[i].m.test(String(name || ""))) return GUIDE[i]; return null; }
  function condBtn(name) {
    var g = guideFor(name);
    return g ? '<button type="button" class="bl__condbtn" data-cond="' + g.k + '" aria-label="What does ' + esc(name) + ' mean?">' + esc(name) + '</button>' : esc(name);
  }
  function openGuide(k) {
    var g = null, d = $("#bl-guide");
    for (var i = 0; i < GUIDE.length; i++) if (GUIDE[i].k === k) g = GUIDE[i];
    if (!g || !d) return;
    d.innerHTML = '<img class="bl__guide-img" src="' + esc(g.img) + '" alt="Example of a ' + esc(g.name) + ' card" decoding="async">' +
      '<div class="bl__guide-body"><h3 id="bl-guide-title">' + esc(g.name) + '</h3><ul>' +
      g.pts.map(function (p) { return "<li><b>" + esc(p[0]) + ":</b> " + esc(p[1]) + "</li>"; }).join("") + "</ul>" +
      '<p class="bl__muted bl__guide-note">' + esc(GUIDE_NOTE) + "</p>" +
      '<div class="bl__guide-actions"><a class="bl__link" href="/pages/grading-guide" target="_blank" rel="noopener">Full grading guide</a>' +
      '<button type="button" class="bl__btn bl__btn--primary bl__guide-close">Got it</button></div></div>';
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    var b = t.closest ? t.closest(".bl__condbtn") : null;
    if (b) { e.preventDefault(); openGuide(b.getAttribute("data-cond")); return; }
    var d = $("#bl-guide");
    if (d && d.open && (t === d || (t.closest && t.closest(".bl__guide-close")))) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  });

  function renderHits(hits, start) {
    var html = hits.map(function (h, k) {
      var i = start + k;
      var offers = offersOf(h), lastFinish = null;
      var rows = offers.map(function (o, j) {
        // BinderPOS sends, per condition, how many more copies the store will
        // take (its rule's cap minus stock). Zero used to be a grey Add with a
        // tooltip nobody on a phone could see; now it says so (owner, 2026-09-10).
        var fin = o.p.type && o.p.type !== "Normal" ? String(o.p.type) : "";
        var band = fin && fin !== lastFinish && j > 0 ? finishBand(fin) : "";
        lastFinish = fin;
        return band + '<div class="bl__orow' + finishClass(o.p.type) + '" role="row"><span class="bl__ocond" role="cell">' + condBtn(o.v.variantName) + finish(o.p.type) + '</span>' +
          '<span class="bl__oprice" role="cell">' + money(o.cash) + '</span><span class="bl__oprice bl__oprice--credit" role="cell">' + money(o.credit) + '</span><span role="cell">' +
          (o.max > 0
            ? '<button type="button" class="bl__btn bl__add" data-h="' + i + '" data-o="' + j + '">Add</button>'
            : '<span class="bl__nobuy" title="BinderPOS reports the store has all it wants of this condition right now">At limit</span>') + "</span></div>";
      }).join("");
      // Photo, heading and offers are three grid areas (buylist.css): on a
      // desktop the offers sit beside the photo, on a phone they take the
      // card's full width so the condition column is not squeezed
      // (2026-09-11 probe at 390px: 42px for "Lightly Played Foil").
      // The thumbnail is the zoom control. Attributes on the <img> rather than
      // a wrapping <button>: .bl__card is the grid item ("img" area) at three
      // breakpoint widths, and wrapping it would mean moving grid-area and
      // those widths onto a new element for no semantic gain the label does
      // not already give. Real alt text too - it was alt="" (decorative), which
      // is wrong once it does something.
      var zlabel = h.cardName + (h.setName ? " (" + h.setName + ")" : "");
      // The image sits in a wrapper because the SLOW FLOAT animates the
      // wrapper, never the image - transforming the img itself is what made
      // the hover blur it. A negative, staggered delay starts each card
      // partway through the 5.5s cycle so a page of results is out of phase
      // instead of bobbing in unison.
      var delay = "-" + ((i % 7) * 0.79).toFixed(2) + "s";
      return '<article class="bl__hit" data-set="' + esc(h.setName) + '"><span class="bl__cardwrap" style="--bl-float-delay:' + delay + '"><img class="bl__card" src="' + esc(h.imageUrl) + '" alt="' + esc(zlabel) + '" role="button" tabindex="0" aria-label="Enlarge ' + esc(zlabel) + '" loading="lazy"></span><div class="bl__head">' +
        '<h3 class="bl__name">' + esc(h.cardName) + '</h3><p class="bl__set bl__muted">' + seticon(h.setName) + "<span>" + esc(h.setName) + (h.rarity ? " · " + esc(h.rarity) : "") + "</span></p>" +
        (h.wanted && h.wanted.why ? '<p class="bl__why">' + esc(h.wanted.why) + "</p>" : "") + "</div>" +
        (rows ? '<div class="bl__offers" role="table"><div class="bl__orow bl__orow--head" role="row"><span role="columnheader">Condition</span><span role="columnheader">Cash</span><span role="columnheader">Credit</span><span role="columnheader"><span class="bl__sr">Add</span></span></div>' + rows + "</div>" : '<p class="bl__muted bl__none">Not currently buying this printing.</p>') +
        "</article>";
    }).join("");
    $("#bl-hits").insertAdjacentHTML("beforeend", html);
    floatWatch();
  }

  /* ---- the slow float, only while a card is on screen -----------------
     The animation is CSS (blCardFloat in buylist.css); this only decides
     which cards are allowed to run it. A result list can reach sixty rows and
     every animating element is its own compositor layer the GPU keeps working
     on, so cards that have scrolled away are switched off. Phones are where
     this page is used, and that is where the saving matters.
     Anyone who has asked their system for less motion gets none: the CSS has
     a prefers-reduced-motion rule, and this does not even observe them. */
  var floatObs = null;
  function floatWatch() {
    var reduce = false;
    try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) return;
    var wraps = $("#bl-hits").querySelectorAll(".bl__cardwrap:not([data-floatwatch])");
    if (!wraps.length) return;
    if (!window.IntersectionObserver) {                 // no observer: just float them all
      for (var j = 0; j < wraps.length; j++) { wraps[j].setAttribute("data-floatwatch", "1"); wraps[j].classList.add("is-floating"); }
      return;
    }
    if (!floatObs) {
      floatObs = new IntersectionObserver(function (entries) {
        for (var n = 0; n < entries.length; n++) {
          entries[n].target.classList.toggle("is-floating", entries[n].isIntersecting);
        }
      }, { rootMargin: "120px 0px" });                  // start just before it scrolls in
    }
    for (var k2 = 0; k2 < wraps.length; k2++) {
      wraps[k2].setAttribute("data-floatwatch", "1");
      floatObs.observe(wraps[k2]);
    }
  }

  $("#bl-hits").addEventListener("click", function (e) {
    var card = e.target.closest("img.bl__card");
    if (card) { openZoom(card); return; }
    var b = e.target.closest("button.bl__add");
    if (!b) return;
    var h = lastHits[+b.dataset.h];
    var o = h && offersOf(h)[+b.dataset.o];
    if (o) add(h, o, b);
  });
  // Enter/Space on a focused thumbnail, so the zoom is reachable without a
  // mouse. Space would otherwise scroll the page.
  $("#bl-hits").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var card = e.target.closest && e.target.closest("img.bl__card");
    if (!card) return;
    e.preventDefault();
    openZoom(card);
  });

  /* ---- zoom: show the full-size card the page already has --------------
     BinderPOS serves 672x936 and the list paints it at 104px, so the rules
     text is about a pixel a line - unreadable by arithmetic. The bytes are
     already spent, so this opens instantly with no new request. Focus goes to
     the overlay and comes back to the thumbnail on close. */
  function openZoom(card) {
    var src = card.currentSrc || card.getAttribute("src");
    if (!src) return;
    var label = card.getAttribute("alt") || "";
    var prev = document.activeElement;
    var ov = document.createElement("div");
    ov.className = "bl__zoom";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", label ? "Enlarged card: " + label : "Enlarged card");
    ov.tabIndex = -1;
    var big = document.createElement("img");
    big.src = src;
    big.alt = label;
    ov.appendChild(big);
    if (label) {
      var cap = document.createElement("p");
      cap.className = "bl__zoom-cap";
      cap.textContent = label + " — tap anywhere or press Escape to close";
      ov.appendChild(cap);
    }
    function close() {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      try { if (prev && prev.focus) prev.focus(); } catch (err) {}
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      // a one-element dialog: keep Tab inside it
      if (ev.key === "Tab") { ev.preventDefault(); ov.focus(); }
    }
    var prevOverflow = document.documentElement.style.overflow;
    ov.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(ov);
    ov.focus();
  }

  /* ---- cart ---- */
  // The card object BinderPOS's app saves, field for field.
  function add(h, o, button) {
    var card = {
      cardId: h.id, cardName: h.cardName, setName: h.setName, game: h.game, type: o.p.type, imageUrl: h.imageUrl,
      quantity: "1", cashBuyPrice: o.cash, storeCreditBuyPrice: o.credit,
      condition: o.v.id, conditionName: o.v.variantName, shopifyVariantId: o.p.productVariantId
    };
    var k = keyOf(card);
    maxByKey[k] = o.max;
    var existing = cart.filter(function (c) { return keyOf(c) === k; })[0];
    if (existing) existing.quantity = String(Math.min(qty(existing) + 1, maxOf(existing)));
    else cart.push(card);
    renderCart();
    persist();
    var what = card.cardName + " · " + card.conditionName + (card.type && card.type !== "Normal" ? " · " + card.type : "");
    setMsg(what + " added.");
    toast("Added to your buylist: " + what);
    if (button) {
      button.textContent = "Added ✓";
      setTimeout(function () { button.textContent = "Add"; }, 1400);
    }
  }
  function maxOf(c) { return maxByKey[keyOf(c)] || 99; }
  function totalQty() { return cart.reduce(function (s, c) { return s + qty(c); }, 0); }

  function renderCart() {
    var box = $("#bl-lines");
    if (!cart.length) {
      box.innerHTML = '<p class="bl__muted">Nothing yet. Search for a card and press Add.</p>';
    } else {
      // One heading per card (name + set), its conditions as short rows
      // beneath it: seven Sol Rings used to be seven four-line entries
      // (owner, 2026-09-10). data-i still indexes into `cart`.
      var groups = [], byKey = {};
      cart.forEach(function (c, i) {
        var key = JSON.stringify([c.cardName || "", c.setName || ""]);
        var g = byKey[key];
        if (!g) { g = byKey[key] = { c: c, rows: [] }; groups.push(g); }
        g.rows.push(i);
      });
      box.innerHTML = groups.map(function (g) {
        var c0 = g.c;
        return '<div class="bl__group"><div class="bl__group-head"><img class="bl__thumb" src="' + esc(c0.imageUrl) + '" alt=""><div><b>' + esc(c0.cardName) + '</b>' +
          '<span class="bl__muted">' + seticon(c0.setName) + esc(c0.setName) + '</span></div></div>' +
          g.rows.map(function (i) {
            var c = cart[i];
            return '<div class="bl__line bl__line--in"><span class="bl__cond">' + esc(c.conditionName) +
              (c.type && c.type !== "Normal" ? '<span class="bl__pill">' + esc(c.type) + '</span>' : '') +
              '<small>' + money(c.cashBuyPrice) + ' cash · ' + money(c.storeCreditBuyPrice) + ' credit</small></span>' +
              '<div class="bl__qtywrap"><button type="button" class="bl__btn bl__dec" data-i="' + i + '" aria-label="Fewer">&minus;</button>' +
              '<input class="bl__qty" data-i="' + i + '" type="number" min="1" max="' + maxOf(c) + '" value="' + qty(c) + '">' +
              '<button type="button" class="bl__btn bl__inc" data-i="' + i + '" aria-label="More">+</button></div>' +
              '<button type="button" class="bl__remove" data-i="' + i + '" aria-label="Remove">×</button></div>';
          }).join("") + '</div>';
      }).join("");
    }
    var n = totalQty();
    $("#bl-count").textContent = n ? n + (n === 1 ? " card" : " cards") : "";
    var tcash = cart.reduce(function (s, c) { return s + qty(c) * (Number(c.cashBuyPrice) || 0); }, 0);
    var tcredit = cart.reduce(function (s, c) { return s + qty(c) * (Number(c.storeCreditBuyPrice) || 0); }, 0);
    $("#bl-tcash").textContent = money(tcash);
    $("#bl-tcredit").textContent = money(tcredit);
    $("#bl-sheetsum").textContent = n ? n + (n === 1 ? " card" : " cards") + " · " + money(tcash) + " cash · " + money(tcredit) + " credit" : "Empty — add cards from the results";
    $("#bl-submit").disabled = !cart.length;
    $("#bl-sheetsubmit").disabled = !cart.length;
    $("#bl-clear").disabled = !cart.length;
  }

  // The phone bottom sheet: the bar toggles the rest of the panel.
  function toggleSheet(open) {
    var aside = $(".bl__cart"), bar = $("#bl-sheetbar");
    var now = typeof open === "boolean" ? open : !aside.classList.contains("bl__cart--open");
    aside.classList.toggle("bl__cart--open", now);
    bar.setAttribute("aria-expanded", now ? "true" : "false");
    $("#bl-sheetviewtxt").textContent = now ? "Close" : "View";
  }
  $("#bl-sheetbar").addEventListener("click", function () { toggleSheet(); });
  // The bar's own buttons: the click must not also toggle the bar.
  $("#bl-sheetview").addEventListener("click", function (e) { e.stopPropagation(); toggleSheet(); });
  $("#bl-sheetsubmit").addEventListener("click", function (e) {
    e.stopPropagation();
    if (!cart.length) return;
    toggleSheet(true);                          // the payment choice and the lines are in view behind the confirm
    $("#bl-submit").click();
  });
  $("#bl-sheetbar").addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSheet(); }
  });
  // The sheet sits above whatever else owns the bottom edge: the theme's
  // ticker, Shopify's preview bar on an unpublished theme (which covered the
  // whole bar, 2026-09-10), an app's bottom bar. Measured, not assumed:
  // every fixed, wide, short element in the lower part of the screen, as a
  // contiguous stack up from the bottom edge. buylist.css reads
  // --bl-sheet-off for the sheet, the toast and the page's bottom padding.
  function bottomStack() {
    var vh = window.innerHeight, vw = window.innerWidth, own = $(".bl__cart"), bars = [];
    var all = document.querySelectorAll("body > *, body > * > *, body > * > * > *");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === own || (own && own.contains(el)) || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;
      var cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.05) continue;
      var r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < vh * 0.4 && r.width > vw * 0.5 && r.bottom > vh * 0.6 && r.top < vh) bars.push(r);
    }
    bars.sort(function (a, b) { return b.bottom - a.bottom; });
    var max = 0;
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      if (vh - b.bottom <= max + 2 && vh - b.top > max) max = vh - b.top;
    }
    return Math.round(Math.min(max, vh * 0.4));
  }
  var placeT = null;
  function placeSheet() {
    var tick = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--xg-tick-h")) || 0;
    root.style.setProperty("--bl-sheet-off", Math.max(bottomStack(), tick) + "px");
  }
  function placeSoon() { clearTimeout(placeT); placeT = setTimeout(placeSheet, 150); }
  placeSheet();
  setTimeout(placeSheet, 1200);
  setTimeout(placeSheet, 4000);
  window.addEventListener("resize", placeSoon);
  window.addEventListener("orientationchange", placeSoon);
  window.addEventListener("scroll", placeSoon, { passive: true });

  $("#bl-lines").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.dataset.i == null) return;
    var i = +b.dataset.i, c = cart[i];
    if (!c) return;
    if (b.classList.contains("bl__remove")) cart.splice(i, 1);
    else if (b.classList.contains("bl__inc")) c.quantity = String(Math.min(qty(c) + 1, maxOf(c)));
    else if (b.classList.contains("bl__dec")) { if (qty(c) > 1) c.quantity = String(qty(c) - 1); else cart.splice(i, 1); }
    else return;
    renderCart();
    persist();
  });
  $("#bl-lines").addEventListener("change", function (e) {
    var inp = e.target.closest("input.bl__qty");
    if (!inp) return;
    var c = cart[+inp.dataset.i];
    if (!c) return;
    c.quantity = String(Math.max(1, Math.min(parseInt(inp.value, 10) || 1, maxOf(c))));
    renderCart();
    persist();
  });

  // Save the whole list, like their saveBuylist(): debounced, one at a time.
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveChain = saveChain.then(saveNow, saveNow); }, 300);
  }
  function saveNow() {
    return api("/save", { cards: cart }).then(function (j) {
      if (j.reply && j.reply.actionPass === false) setMsg("BinderPOS did not save the list: " + (j.reply.message || "unknown reason"));
    }).catch(function (err) { setMsg("Could not save the list: " + err.message); });
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveChain = saveChain.then(saveNow, saveNow);
    return saveChain;
  }

  $("#bl-clear").addEventListener("click", function () {
    if (!cart.length || !confirm("Clear your buylist?")) return;
    cart = [];
    renderCart();
    persist();
    setMsg("List cleared.");
  });

  /* ---- submit ---- */
  // One last check before anything is sent (owner, 2026-09-22: "it should
  // ask them one more time to confirm that they want to submit it as store
  // credit/cash again just to be clear"): an in-page dialog that names the
  // payment type and the total in so many words, with a one-tap switch to
  // the other type. The browser's own confirm() used to do this, and a
  // browser that suppresses those dialogs would have sent nothing - or, on
  // some phones, shown a box nobody reads.
  function payChosen() { return (root.querySelector('input[name="bl-pay"]:checked') || {}).value || "Cash"; }
  function askToConfirm(onYes) {
    var d = $("#bl-confirm");
    if (!d || typeof d.showModal !== "function") {
      var p = payChosen(), n = totalQty();
      if (confirm("Submit " + n + " card" + (n === 1 ? "" : "s") + " for " + p.toLowerCase() + "? This sends your buylist to the store.")) onYes(p);
      return;
    }
    function draw() {
      var pay = payChosen(), credit = pay === "Store Credit", n = totalQty(), t = totalsOfCart();
      // The upsell (owner, 2026-09-22: "a quick upsell to try to convert
      // from cash to store credit by earning more on that reminder popup").
      var more = t.credit - t.cash, pct = t.cash > 0 ? Math.round(more / t.cash * 100) : 0;
      var gain = more > 0.005 ? money(more) + (pct > 0 ? " (+" + pct + "%)" : "") : "";
      d.innerHTML = '<div class="bl__done-head bl__confirm-head' + (credit ? " bl__confirm-head--credit" : "") + '"><span class="bl__done-kicker">One last check</span><h3 id="bl-confirm-title">Submit for <b>' + (credit ? "store credit" : "cash") + "</b>?</h3>" +
        '<p class="bl__done-sum">' + esc(n) + " card" + (n === 1 ? "" : "s") + " · estimated <b>" + money(credit ? t.credit : t.cash) + "</b> in " + (credit ? "Exor Games store credit" : "cash") + "</p></div>" +
        '<div class="bl__guide-body">' +
        (credit
          ? '<p class="bl__confirm-note">You are asking to be paid in <b>store credit</b>, added to your Exor Games account once we have checked your cards.' + (gain ? ' Good call: that is <b class="bl__confirm-gain">' + gain + " more</b> than cash (" + money(t.cash) + ")." : "") + "</p>"
          : '<p class="bl__confirm-note">You are asking to be paid in <b>cash</b>, paid once we have checked your cards.</p>' +
            (gain ? '<div class="bl__upsell"><span class="bl__upsell-kicker">Earn more</span><p class="bl__upsell-text">Take <b>store credit</b> instead and get <b class="bl__confirm-gain">' + money(t.credit) + "</b> for the same cards: <b>" + gain + " more</b>, spendable on anything at Exor Games.</p>" +
              '<button type="button" class="bl__btn bl__btn--upsell" data-act="switch">Switch to store credit and earn ' + money(more) + " more</button></div>" : "")) +
        '<div class="bl__guide-actions bl__confirm-actions"><button type="button" class="bl__btn" data-act="back">Go back</button>' +
        (credit || !gain ? '<button type="button" class="bl__btn" data-act="switch">Switch to ' + (credit ? "cash" : "store credit") + "</button>" : "") +
        '<button type="button" class="bl__btn bl__btn--primary" data-act="yes">Yes, submit for ' + (credit ? "store credit" : "cash") + "</button></div></div>";
    }
    d.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b) { if (e.target === d) d.close(); return; }
      var act = b.getAttribute("data-act");
      if (act === "back") { d.close(); return; }
      if (act === "switch") {
        var other = payChosen() === "Store Credit" ? "Cash" : "Store Credit";
        var radio = root.querySelector('input[name="bl-pay"][value="' + other + '"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        draw(); return;
      }
      if (act === "yes") { var p = payChosen(); d.close(); onYes(p); }
    };
    draw();
    d.showModal();
    var yes = d.querySelector('[data-act="yes"]'); if (yes) { try { yes.focus({ preventScroll: true }); } catch (err) { yes.focus(); } }
  }
  function totalsOfCart() {
    var cash = 0, credit = 0;
    cart.forEach(function (c) { var q = qty(c); cash += q * (Number(c.cashBuyPrice) || 0); credit += q * (Number(c.storeCreditBuyPrice) || 0); });
    return { cash: cash, credit: credit };
  }
  $("#bl-submit").addEventListener("click", function () {
    if (!cart.length) return;
    askToConfirm(doSubmit);
  });
  // Store credit picked in the panel (owner, 2026-09-22: "make it seem super
  // charged because of it with a temporary pop"): the toggle and the credit
  // total flash, and a "+$x more" burst rises off the total and fades.
  function chargeUp() {
    var pay = $(".bl__pay"), tot = $("#bl-tcredit");
    if (!pay || !tot) return;
    var t = totalsOfCart(), more = t.credit - t.cash;
    [pay, tot].forEach(function (el, i) { var c = i ? "bl__tot--charged" : "bl__pay--charged"; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); setTimeout(function () { el.classList.remove(c); }, 1250); });
    var old = root.querySelector(".bl__burst"); if (old) old.remove();
    if (more > 0.005) {
      var b = document.createElement("span"); b.className = "bl__burst"; b.textContent = "+" + money(more) + " more";
      tot.parentNode.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1800);
    }
    // Ultra (owner, 2026-09-22: "rainbow effects and fireworks minimalized to
    // that area ... come from behind the number and then a little text that
    // says maximizing payout with store credit"): a rainbow ring and two
    // rounds of sparks burst from behind the credit total, and a caption
    // shows for a moment. All inside the totals row; nothing moves.
    var totals = $(".bl__totals");
    ["bl__fx", "bl__fx-text"].forEach(function (c) { var x = root.querySelector("." + c); if (x && x.parentNode) x.parentNode.removeChild(x); });
    var fx = document.createElement("span"); fx.className = "bl__fx"; fx.setAttribute("aria-hidden", "true");
    var COLORS = ["#ffd166", "#ff6a5e", "#2fbf95", "#6ec6ff", "#c77dff", "#ffffff"], html = '<span class="bl__fx-rainbow"></span>';
    for (var i = 0; i < 28; i++) {
      var ang = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.5, dist = 38 + Math.random() * 60, delay = i % 2 ? 0.45 : 0;
      html += '<i class="bl__spark" style="--dx:' + (Math.cos(ang) * dist).toFixed(1) + "px;--dy:" + (Math.sin(ang) * dist).toFixed(1) + "px;--c:" + COLORS[i % COLORS.length] + ";--d:" + delay + 's"></i>';
    }
    fx.innerHTML = html;
    tot.insertBefore(fx, tot.firstChild);        // inside the number, painted behind its digits
    var cap = document.createElement("span"); cap.className = "bl__fx-text"; cap.innerHTML = "<b>Maximizing payout with store credit</b>";
    if (totals) totals.appendChild(cap);
    setTimeout(function () { [fx, cap].forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); }, 2800);
  }
  root.addEventListener("change", function (e) {
    if (e.target && e.target.name === "bl-pay" && e.target.value === "Store Credit") chargeUp();
  });
  function doSubmit(pay) {
    if (!cart.length) return;
    $("#bl-submit").disabled = true;
    setMsg("Submitting…");
    flushSave().then(function () {
      return api("/submit", { paymentType: pay, cards: cart });
    }).then(function (j) {
      if (!j.accepted) {
        setMsg("BinderPOS did not accept the submission: " + ((j.reply && j.reply.message) || ("HTTP " + j.upstream)));
        $("#bl-submit").disabled = false;
        return;
      }
      cart = [];
      renderCart();
      // Staged (owner, 2026-09-19): the list waits for a staff member before
      // it reaches BinderPOS. The worker's confirmation says so, and the
      // status block under the list shows where each sent list stands.
      if (j.staged) loadMine();
      var done = (j.confirmation || "Thank you, your buylist was submitted.") + (!j.staged && j.reply && j.reply.data != null ? " Reference " + j.reply.data + "." : "");
      // The worker re-prices every line from BinderPOS's current buylist at
      // submit; say so when that changed anything.
      var rp = j.repriced || {}, notes = [];
      if (rp.changed && rp.changed.length) notes.push("Prices were refreshed to today's buylist: " + rp.changed.join("; ") + ".");
      if (rp.capped && rp.capped.length) notes.push("Quantities were capped at what we can take: " + rp.capped.join("; ") + ".");
      if (rp.dropped && rp.dropped.length) notes.push("Left out: " + rp.dropped.join("; ") + ".");
      setMsg(done + (notes.length ? " " + notes.join(" ") : ""));
      toast("Buylist submitted");
      if (j.instructions) showDone(j, notes);
    }).catch(function (err) {
      setMsg("Submit failed: " + err.message);
      $("#bl-submit").disabled = false;
    });
  }

  /* ---- what happens next: the store's instructions in a popup at submission
     (owner, 2026-09-22: "the instructions should show in a popup on the
     website at submission like BinderPOS does"). The worker sends the same
     text the confirmation email carries; links come from named tokens so
     nothing from the network is written as HTML. ---- */
  function showDone(j, notes) {
    var ins = j.instructions || {}, d = $("#bl-done");
    if (!d) return;
    var links = ins.links || {};
    function para(p) {
      return esc(p)
        .replace("{SELL_POLICY}", '<a href="' + esc(links.SELL_POLICY || "#") + '" target="_blank" rel="noopener">Exor Games Selling Policy</a>')
        .replace("{HOW_TO_SELL}", '<a href="' + esc(links.HOW_TO_SELL || "#") + '" target="_blank" rel="noopener">How to Sell Cards</a>');
    }
    var sections = (ins.sections || []).map(function (s) {
      return "<h4>" + esc(s.h) + "</h4>" + (s.p || []).map(function (p) { return "<p>" + para(p) + "</p>"; }).join("") +
        (s.address && ins.address ? '<address class="bl__done-addr"><b>' + esc(ins.address[0]) + "</b><br>" + ins.address.slice(1).map(esc).join("<br>") + "</address>" : "");
    }).join("");
    var t = j.totals || {}, credit = j.paymentType === "Store Credit";
    d.innerHTML = '<div class="bl__done-head"><span class="bl__done-kicker">Buylist received</span><h3 id="bl-done-title">' + (j.number ? "Buylist Number " + esc(j.number) : "Thank you") + "</h3>" +
      (t.units != null ? '<p class="bl__done-sum">' + esc(t.units) + " card" + (t.units === 1 ? "" : "s") + " · " + esc(j.paymentType || "") + " · estimated " + money(credit ? t.credit : t.cash) + "</p>" : "") + "</div>" +
      '<div class="bl__guide-body">' + (ins.nextStep ? '<p class="bl__done-next">' + esc(ins.nextStep) + "</p>" : "") +
      (notes && notes.length ? '<p class="bl__done-notes">' + notes.map(esc).join(" ") + "</p>" : "") +
      sections +
      (j.email && j.email.status && j.email.status !== "sent" ? "" : '<p class="bl__guide-note bl__muted">A copy of these instructions has been emailed to the address on your account.</p>') +
      '<div class="bl__guide-actions"><span></span><button type="button" class="bl__btn bl__btn--primary" data-close-done>Got it</button></div></div>';
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    // Focus lands on the button for the keyboard, but the text must open at
    // its top, not scrolled down to where the button sits.
    d.querySelector("[data-close-done]").focus({ preventScroll: true });
    var body = d.querySelector(".bl__guide-body"); if (body) body.scrollTop = 0; d.scrollTop = 0;
  }
  $("#bl-done").addEventListener("click", function (e) {
    var d = $("#bl-done");
    if (e.target.closest("[data-close-done]") || e.target === d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  });

  /* ---- the sell page's game tiles link to #buylist; one that names a game picks it ---- */
  // image file name fragment -> BinderPOS game ids to try, then words to look for
  // Which game a tile means. Matched on the tile's own words (title, alt,
  // aria-label, text) first - the picture's FILE NAME is not trusted: the
  // Magic tile's art is stored in Shopify Files as "Pokemon_2.png" (owner,
  // 2026-09-22: "when I click Magic it does pokemon"). The file name is only
  // a fallback for a tile with no words at all.
  var TILE_TEXT = [["magic", ["mtg"]], ["mtg", ["mtg"]], ["pokemon", ["pokemon"]], ["lorcana", ["lor", "lorcana"]], ["onepiece", ["one", "onepiece"]], ["starwars", ["swu", "starwars"]], ["yugioh", ["yugioh", "ygo"]]];
  var TILE_SRC = [["pokemon", ["pokemon"]], ["lorcana", ["lor", "lorcana"]], ["one_piece", ["one", "onepiece"]], ["star_wars", ["swu", "starwars"]], ["ygo", ["yugioh", "ygo"]], ["mtg", ["mtg"]], ["magic", ["mtg"]]];
  function tileWords(a) {
    var img = a.querySelector("img");
    var raw = [a.getAttribute("title"), a.getAttribute("aria-label"), img && img.getAttribute("alt"), a.textContent].filter(Boolean).join(" ");
    try { raw = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (err) { /* old browsers: accents stay */ }
    return raw.toLowerCase().replace(/[^a-z]/g, "");
  }
  function tileKeys(a) {
    var words = tileWords(a);
    var hit = TILE_TEXT.filter(function (p) { return words.indexOf(p[0]) >= 0; })[0];
    if (hit) return hit[1];
    var img = a.querySelector("img");
    var src = ((img && img.getAttribute("src")) || "").toLowerCase();
    hit = TILE_SRC.filter(function (p) { return src.indexOf(p[0]) >= 0; })[0];
    return hit ? hit[1] : null;
  }
  function gameFor(keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var byId = games.filter(function (g) { return g.id === k; })[0];
      if (byId) return byId.id;
      var byName = games.filter(function (g) { return (g.id + " " + g.name).toLowerCase().replace(/[^a-z]/g, "").indexOf(k) >= 0; })[0];
      if (byName) return byName.id;
    }
    return null;
  }
  function wireTiles() {
    // The click itself is taken by guardTiles() at the top; this adds the
    // game pick once the game list is known.
    window.__xgTilePick = function (a) {
      var keys = tileKeys(a);
      var id = keys ? gameFor(keys) : null;
      if (id && id !== game) { $("#bl-game").value = id; $("#bl-game").dispatchEvent(new Event("change")); }
      setTimeout(function () { var q = $("#bl-q"); if (q) { try { q.focus({ preventScroll: true }); } catch (err) { q.focus(); } } }, 350);
    };
  }

  /* ---- staged buylists (owner, 2026-09-19): where each sent list stands ----
     The worker keeps a sent list until a staff member approves it; only
     then does it go to BinderPOS. /mine is that record, for this shopper. */
  // Off (owner, 2026-09-22: "disable 'your recent buylists', I dont want
  // them to have that"): the box is never filled or shown. Flip SHOW_MINE
  // to bring it back - the /mine endpoint still answers.
  var SHOW_MINE = false;
  function loadMine() {
    if (!SHOW_MINE) { var off = $("#bl-mine"); if (off) { off.hidden = true; off.innerHTML = ""; } return; }
    api("/mine").then(function (j) {
      var box = $("#bl-mine");
      var recs = (j && j.records) || [];
      if (!recs.length) { box.hidden = true; box.innerHTML = ""; return; }
      var label = { staged: "Waiting for a staff check", approved: "Approved and sent through", rejected: "Declined" };
      box.innerHTML = '<h3 class="bl__h3">Your recent buylists</h3>' + recs.slice(0, 5).map(function (r) {
        var when = new Date(r.ts).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
        var t = r.totals || {};
        var credit = r.paymentType === "Store Credit";
        return '<div class="bl__mine-row bl__mine-row--' + esc(r.status) + '"><span class="bl__mine-when">' + esc(when) + '</span>' +
          '<span class="bl__mine-what">' + esc(t.units || 0) + ' card' + (t.units === 1 ? '' : 's') + ' · ' + esc(money(credit ? t.credit : t.cash)) + ' ' + (credit ? 'store credit' : 'cash') + '</span>' +
          '<span class="bl__mine-status">' + (r.number ? esc(r.number) + ' · ' : '') + esc(label[r.status] || r.status) + (r.reference ? ' · BinderPOS ref ' + esc(r.reference) : '') + (r.customerNote ? ' · ' + esc(r.customerNote) : '') + '</span></div>';
      }).join("");
      box.hidden = false;
    }).catch(function () {});
  }

  /* ---- first view: the cards we need most (owner, 2026-09-22) ------------
     Before any search the results area shows the ten cards the store most
     wants right now - this week's biggest paper Standard price risers on
     MTGGoldfish, each resolved by the worker to its BinderPOS buylist entry
     (src/wanted.js) - drawn as ordinary result cards with the usual
     condition rows and Add buttons. The first real search replaces them. */
  function loadWanted() {
    if (lastQuery || lastHits.length) return;           // the shopper searched already
    api("/wanted").then(function (j) {
      var hits = Array.isArray(j.hits) ? j.hits : [];
      if (!hits.length || lastQuery || lastHits.length) return;
      lastHits = hits;
      var internal = Number(j.internal) || 0;
      $("#bl-hits").innerHTML = '<div class="bl__wanted"><h3 class="bl__wantedtitle"><span class="bl__flame" aria-hidden="true"></span>Cards we need most right now</h3>' +
        '<p class="bl__muted">' + (internal ? "What our customers are buying and asking for that we are short of, with what we pay today." : "This week\'s biggest movers in Standard, with what we pay today.") + " Search above for anything else you are selling.</p></div>";
      renderHits(hits, 0);
      setStatus("");
    }).catch(function () {});
  }

  /* ---- start: the saved draft is the cart, like their app ---- */
  loadGames().then(loadSets).then(wireTiles).then(loadWanted);
  loadMine();
  api("/list").then(function (j) {
    cart = Array.isArray(j.list) ? j.list : [];
  }).catch(function (err) {
    setMsg("Could not load your saved list: " + err.message);
  }).then(renderCart);
})();
