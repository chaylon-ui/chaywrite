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
        '<h2 class="bl__h2">Your buylist <span id="bl-count" class="bl__muted"></span></h2>' +
        '<div id="bl-lines"><p class="bl__muted">Loading your saved list…</p></div>' +
        '<div class="bl__pay"><label><input type="radio" name="bl-pay" value="Cash" checked> Cash</label><label><input type="radio" name="bl-pay" value="Store Credit"> Store credit</label></div>' +
        '<div class="bl__totals"><span>Cash <b id="bl-tcash">$0.00</b></span><span>Store credit <b id="bl-tcredit">$0.00</b></span></div>' +
        '<div class="bl__actions"><button id="bl-clear" type="button" class="bl__btn" disabled>Clear list</button><button id="bl-submit" type="button" class="bl__btn bl__btn--primary" disabled>Submit buylist</button></div>' +
        '<p id="bl-msg" class="bl__msg bl__muted"></p>' +
      '</aside>' +
      '<div id="bl-toast" class="bl__toast" role="status" aria-live="polite"></div>' +
    '</div>';

  var $ = function (s) { return root.querySelector(s); };
  var cart = [];            // the draft list, mirrored to BinderPOS after every change (their app does the same)
  var maxByKey = {};        // how many the store buys, per offer, from the search hit (this session only)
  var games = [], sets = [], iconBySet = {};
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
    return { name: "", candidates: pool.slice(0, 8).map(function (s) { return s.name; }), total: pool.length };
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
  function offersOf(h) {
    var out = [];
    (h.variants || []).forEach(function (v) {
      (v.cardBuylistTypes || []).forEach(function (p) {
        var cash = Number(p.buyPrice) || 0, credit = Number(p.creditBuyPrice) || 0;
        if (cash <= 0 && credit <= 0) return;
        out.push({ v: v, p: p, cash: cash, credit: credit, max: Number(p.maxPurchaseQuantity) || 0 });
      });
    });
    return out;
  }
  function finish(type) { return type && type !== "Normal" ? ' <span class="bl__pill">' + esc(type) + "</span>" : ""; }

  function renderHits(hits, start) {
    var html = hits.map(function (h, k) {
      var i = start + k;
      var rows = offersOf(h).map(function (o, j) {
        return "<tr><td>" + esc(o.v.variantName) + finish(o.p.type) + "</td><td>" + money(o.cash) + "</td><td>" + money(o.credit) + "</td><td>" +
          '<button type="button" class="bl__btn bl__add" data-h="' + i + '" data-o="' + j + '"' + (o.max > 0 ? "" : ' disabled title="Not buying more right now"') + ">Add</button></td></tr>";
      }).join("");
      return '<article class="bl__hit" data-set="' + esc(h.setName) + '"><img class="bl__card" src="' + esc(h.imageUrl) + '" alt="" loading="lazy"><div>' +
        '<h3 class="bl__name">' + esc(h.cardName) + '</h3><p class="bl__set bl__muted">' + seticon(h.setName) + "<span>" + esc(h.setName) + (h.rarity ? " · " + esc(h.rarity) : "") + "</span></p>" +
        (rows ? '<table class="bl__offers"><thead><tr><th>Condition</th><th>Cash</th><th>Credit</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" : '<p class="bl__muted">Not currently buying this printing.</p>') +
        "</div></article>";
    }).join("");
    $("#bl-hits").insertAdjacentHTML("beforeend", html);
  }

  $("#bl-hits").addEventListener("click", function (e) {
    var b = e.target.closest("button.bl__add");
    if (!b) return;
    var h = lastHits[+b.dataset.h];
    var o = h && offersOf(h)[+b.dataset.o];
    if (o) add(h, o, b);
  });

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
      box.innerHTML = cart.map(function (c, i) {
        return '<div class="bl__line"><img class="bl__thumb" src="' + esc(c.imageUrl) + '" alt=""><div class="bl__line-body"><b>' + esc(c.cardName) + '</b>' +
          '<span class="bl__muted">' + seticon(c.setName) + esc(c.setName) + " · " + esc(c.conditionName) + (c.type && c.type !== "Normal" ? " · " + esc(c.type) : "") + "</span>" +
          '<span class="bl__muted">' + money(c.cashBuyPrice) + " cash · " + money(c.storeCreditBuyPrice) + " credit each</span></div>" +
          '<div class="bl__qtywrap"><button type="button" class="bl__btn bl__dec" data-i="' + i + '" aria-label="Fewer">&minus;</button>' +
          '<input class="bl__qty" data-i="' + i + '" type="number" min="1" max="' + maxOf(c) + '" value="' + qty(c) + '">' +
          '<button type="button" class="bl__btn bl__inc" data-i="' + i + '" aria-label="More">+</button></div>' +
          '<button type="button" class="bl__remove" data-i="' + i + '" aria-label="Remove">×</button></div>';
      }).join("");
    }
    var n = totalQty();
    $("#bl-count").textContent = n ? n + (n === 1 ? " card" : " cards") : "";
    $("#bl-tcash").textContent = money(cart.reduce(function (s, c) { return s + qty(c) * (Number(c.cashBuyPrice) || 0); }, 0));
    $("#bl-tcredit").textContent = money(cart.reduce(function (s, c) { return s + qty(c) * (Number(c.storeCreditBuyPrice) || 0); }, 0));
    $("#bl-submit").disabled = !cart.length;
    $("#bl-clear").disabled = !cart.length;
  }

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
  $("#bl-submit").addEventListener("click", function () {
    if (!cart.length) return;
    var pay = (root.querySelector('input[name="bl-pay"]:checked') || {}).value || "Cash";
    var n = totalQty();
    if (!confirm("Submit " + n + " card" + (n === 1 ? "" : "s") + " for " + pay.toLowerCase() + "? This sends your buylist to the store.")) return;
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
      var done = (j.confirmation || "Thank you, your buylist was submitted.") + (j.reply && j.reply.data != null ? " Reference " + j.reply.data + "." : "");
      setMsg(done);
      toast("Buylist submitted");
    }).catch(function (err) {
      setMsg("Submit failed: " + err.message);
      $("#bl-submit").disabled = false;
    });
  });

  /* ---- the sell page's game tiles link to #buylist; one that names a game picks it ---- */
  // image file name fragment -> BinderPOS game ids to try, then words to look for
  var TILE_KEYS = [["pokemon", ["pokemon"]], ["lorcana", ["lor", "lorcana"]], ["one_piece", ["one", "onepiece"]], ["star_wars", ["swu", "starwars"]], ["ygo", ["yugioh", "ygo"]], ["mtg", ["mtg"]], ["magic", ["mtg"]]];
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
    Array.prototype.forEach.call(document.querySelectorAll('a[href="#buylist"]'), function (a) {
      var img = a.querySelector("img");
      var src = ((img && img.getAttribute("src")) || "").toLowerCase();
      var hit = TILE_KEYS.filter(function (p) { return src.indexOf(p[0]) >= 0; })[0];
      if (!hit) return;
      a.addEventListener("click", function () {
        var id = gameFor(hit[1]);
        if (id && id !== game) { $("#bl-game").value = id; $("#bl-game").dispatchEvent(new Event("change")); }
        setTimeout(function () { $("#bl-q").focus(); }, 300);
      });
    });
  }

  /* ---- start: the saved draft is the cart, like their app ---- */
  loadGames().then(loadSets).then(wireTiles);
  api("/list").then(function (j) {
    cart = Array.isArray(j.list) ? j.list : [];
  }).catch(function (err) {
    setMsg("Could not load your saved list: " + err.message);
  }).then(renderCart);
})();
