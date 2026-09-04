/* Buylist proof of concept: search, a cart that is BinderPOS's own saved
   draft for the account, and submit. Talks only to this worker's
   /buylist/poc/* routes (src/buylist-poc.js); the worker talks to BinderPOS
   for the owner's account. */
(function () {
  "use strict";
  var API = "/buylist/poc";
  var $ = function (s) { return document.querySelector(s); };
  var cart = [];            // the draft list, mirrored to BinderPOS after every change (their app does the same)
  var maxByKey = {};        // how many the store buys, per offer, from the search hit (this session only)
  var lastHits = [];
  var saveTimer = null;
  var saveChain = Promise.resolve();

  function money(n) { return "$" + (Number(n) || 0).toFixed(2); }
  function qty(c) { return Math.max(1, parseInt(c.quantity, 10) || 1); }
  function keyOf(c) { return [c.cardId, c.condition, c.type].join("|"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function setStatus(t) { $("#status").textContent = t; }
  function setMsg(t) { $("#msg").textContent = t; }

  var toastTimer = null;
  function toast(text) {
    var t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function api(path, body) {
    var init = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined;
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
        return j;
      });
    });
  }

  /* ---- search ---- */
  $("#f").addEventListener("submit", function (e) { e.preventDefault(); search(); });

  function search() {
    var q = $("#q").value.trim();
    var set = $("#set").value;
    if (q.length < 2 && !set) { setStatus("Type at least two letters, or pick a set."); return; }
    setStatus("Searching…");
    $("#hits").innerHTML = "";
    var what = q ? "“" + q + "”" + (set ? " in " + set : "") : set;
    api("/search?q=" + encodeURIComponent(q) + "&game=mtg&limit=20" + (set ? "&set=" + encodeURIComponent(set) : "")).then(function (j) {
      lastHits = Array.isArray(j.hits) ? j.hits : [];
      renderHits(lastHits);
      setStatus(lastHits.length ? lastHits.length + " result" + (lastHits.length === 1 ? "" : "s") + " for " + what + (lastHits.length >= 20 ? " (first 20)" : "") : "Nothing on the buylist matches " + what + ".");
    }).catch(function (err) { setStatus("Search failed: " + err.message); });
  }
  $("#set").addEventListener("change", function () {
    if ($("#q").value.trim().length >= 2 || $("#set").value) search();
  });

  // The set list their own search page uses.
  api("/sets?game=mtg").then(function (j) {
    var sel = $("#set");
    (Array.isArray(j.sets) ? j.sets : []).forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }).catch(function () {});

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

  function finish(type) { return type && type !== "Normal" ? ' <span class="pill">' + esc(type) + "</span>" : ""; }

  function renderHits(hits) {
    $("#hits").innerHTML = hits.map(function (h, i) {
      var rows = offersOf(h).map(function (o, k) {
        return "<tr><td>" + esc(o.v.variantName) + finish(o.p.type) + "</td><td>" + money(o.cash) + "</td><td>" + money(o.credit) + "</td><td>" +
          '<button type="button" class="add" data-h="' + i + '" data-o="' + k + '"' + (o.max > 0 ? "" : ' disabled title="Not buying more right now"') + ">Add</button></td></tr>";
      }).join("");
      return '<article class="hit" data-set="' + esc(h.setName) + '"><img src="' + esc(h.imageUrl) + '" alt="" loading="lazy"><div><h3>' + esc(h.cardName) + '</h3><p class="muted">' + esc(h.setName) + (h.rarity ? " · " + esc(h.rarity) : "") + "</p>" +
        (rows ? "<table><thead><tr><th>Condition</th><th>Cash</th><th>Credit</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="muted">Not currently buying this printing.</p>') + "</div></article>";
    }).join("");
  }

  $("#hits").addEventListener("click", function (e) {
    var b = e.target.closest("button.add");
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
    var box = $("#lines");
    if (!cart.length) {
      box.innerHTML = '<p class="muted">Nothing yet. Search for a card and press Add.</p>';
    } else {
      box.innerHTML = cart.map(function (c, i) {
        return '<div class="line"><img src="' + esc(c.imageUrl) + '" alt=""><div class="line__body"><b>' + esc(c.cardName) + '</b><span class="muted">' + esc(c.setName) + " · " + esc(c.conditionName) + (c.type && c.type !== "Normal" ? " · " + esc(c.type) : "") + '</span><span class="muted">' + money(c.cashBuyPrice) + " cash · " + money(c.storeCreditBuyPrice) + ' credit each</span></div><div class="line__qty"><button type="button" class="dec" data-i="' + i + '" aria-label="Fewer">&minus;</button><input class="qty" data-i="' + i + '" type="number" min="1" max="' + maxOf(c) + '" value="' + qty(c) + '"><button type="button" class="inc" data-i="' + i + '" aria-label="More">+</button></div><button type="button" class="remove" data-i="' + i + '" aria-label="Remove">×</button></div>';
      }).join("");
    }
    var n = totalQty();
    $("#count").textContent = n ? n + (n === 1 ? " card" : " cards") : "";
    $("#tCash").textContent = money(cart.reduce(function (s, c) { return s + qty(c) * (Number(c.cashBuyPrice) || 0); }, 0));
    $("#tCredit").textContent = money(cart.reduce(function (s, c) { return s + qty(c) * (Number(c.storeCreditBuyPrice) || 0); }, 0));
    $("#submit").disabled = !cart.length;
    $("#clear").disabled = !cart.length;
  }

  $("#lines").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || b.dataset.i == null) return;
    var i = +b.dataset.i, c = cart[i];
    if (!c) return;
    if (b.classList.contains("remove")) cart.splice(i, 1);
    else if (b.classList.contains("inc")) c.quantity = String(Math.min(qty(c) + 1, maxOf(c)));
    else if (b.classList.contains("dec")) { if (qty(c) > 1) c.quantity = String(qty(c) - 1); else cart.splice(i, 1); }
    else return;
    renderCart();
    persist();
  });
  $("#lines").addEventListener("change", function (e) {
    var inp = e.target.closest("input.qty");
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

  $("#clear").addEventListener("click", function () {
    if (!cart.length || !confirm("Clear your buylist?")) return;
    cart = [];
    renderCart();
    persist();
    setMsg("List cleared.");
  });

  /* ---- submit ---- */
  $("#submit").addEventListener("click", function () {
    if (!cart.length) return;
    var pay = (document.querySelector('input[name="pay"]:checked') || {}).value || "Cash";
    var n = totalQty();
    if (!confirm("Submit " + n + " card" + (n === 1 ? "" : "s") + " for " + pay.toLowerCase() + "? This sends a real buylist to the store.")) return;
    $("#submit").disabled = true;
    setMsg("Submitting…");
    flushSave().then(function () {
      return api("/submit", { paymentType: pay, cards: cart });
    }).then(function (j) {
      if (!j.accepted) {
        setMsg("BinderPOS did not accept the submission: " + ((j.reply && j.reply.message) || ("HTTP " + j.upstream)));
        $("#submit").disabled = false;
        return;
      }
      cart = [];
      renderCart();
      setMsg((j.confirmation || "Thank you, your buylist was submitted.") + (j.reply && j.reply.data != null ? " Reference " + j.reply.data + "." : ""));
    }).catch(function (err) {
      setMsg("Submit failed: " + err.message);
      $("#submit").disabled = false;
    });
  });

  /* ---- start: the saved draft is the cart, like their app ---- */
  api("/list").then(function (j) {
    cart = Array.isArray(j.list) ? j.list : [];
  }).catch(function (err) {
    setMsg("Could not load your saved list: " + err.message);
  }).then(renderCart);
})();
