/* 9Pocket > Graded cards, the browser side (loaded by src/graded-ui.js).
   Single add: each photo box opens the camera OR the photo library (owner,
   2026-10-27: "It opens only the camera app. It should open photos too"),
   the photo is shrunk to <= 2000 px before upload, and every photo is read
   for the QR code on the label (usually the back) into the certificate link.
   Batch: pick a pile of photos; the ones with a QR code are backs, each takes
   the nearest front shot (the one just before it first), and every slab
   becomes a line to check, fill in and add - one at a time or all at once
   (owner: "upload multiple and it chooses the right front and back as a line
   item to approve"). The pure parts are tested in test/graded.test.mjs. */
(function (root) {
  "use strict";
  var HOSTS = [[/(^|\.)psacard\.com$/i, "PSA"], [/(^|\.)cgccards\.com$/i, "CGC"], [/(^|\.)beckett\.com$/i, "BGS"], [/(^|\.)gosgc\.com$/i, "SGC"], [/(^|\.)taggrading\.com$/i, "TAG"], [/(^|\.)acegrading\.com$/i, "ACE"]];
  function graderOfUrl(u) { try { var h = new URL(String(u || "")).hostname; for (var i = 0; i < HOSTS.length; i++) if (HOSTS[i][0].test(h)) return HOSTS[i][1]; } catch (e) {} return ""; }
  function certOfUrl(u) { var m = /(\d{6,12})/.exec(String(u || "")); return m ? m[1] : ""; }
  /* scans: [{i, qr}] in the order the photos were taken. A photo with a QR
     link is a back; it takes the nearest unpaired front (no QR) within three
     positions, the one just before it first. A second back with the same
     certificate joins that slab as an extra photo. Fronts left over become
     slabs of their own, so nothing is dropped; the line shows what it got. */
  function pairPhotos(scans) {
    var items = (scans || []).map(function (s, n) { return { i: s.i == null ? n : s.i, qr: String(s.qr || ""), used: false }; });
    var slabs = [], byCert = {};
    items.forEach(function (it) {
      if (!it.qr) return;
      var key = certOfUrl(it.qr) || it.qr.toLowerCase();
      if (byCert[key]) { byCert[key].extra.push(it.i); it.used = true; return; }
      var front = null, best = Infinity;
      items.forEach(function (c) { if (c.qr || c.used) return; var d = Math.abs(c.i - it.i) - (c.i < it.i ? 0.5 : 0); if (d < best) { best = d; front = c; } });
      if (front && best <= 3) front.used = true; else front = null;
      it.used = true;
      var slab = { front: front ? front.i : null, back: it.i, extra: [], qr: it.qr, cert: certOfUrl(it.qr), grader: graderOfUrl(it.qr) };
      byCert[key] = slab; slabs.push(slab);
    });
    items.forEach(function (it) { if (!it.used && !it.qr) { it.used = true; slabs.push({ front: it.i, back: null, extra: [], qr: "", cert: "", grader: "" }); } });
    var first = function (s) { return Math.min(s.front == null ? 1e9 : s.front, s.back == null ? 1e9 : s.back); };
    slabs.sort(function (a, b) { return first(a) - first(b); });
    return slabs;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { pairPhotos, graderOfUrl, certOfUrl };
  if (typeof document === "undefined") return;

  /* ---------------- the page ---------------- */
  var cfg = root.xgGraded || { grades: ["10"], finishes: [""], graders: ["PSA"], games: { pokemon: "Pokémon" }, base: "/9pocket" };
  var form = document.getElementById("gform"), qrState = document.getElementById("qrstate"), qrUrl = document.getElementById("qr_url"), cert = document.getElementById("cert"), prev = document.getElementById("tprev"), btn = document.getElementById("addbtn"), qrAuto = false;
  function v(n, f) { var e = (f || form).elements[n]; return e ? String(e.value || "").replace(/\s+/g, " ").trim() : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function titleOf(f) {
    var name = v("name", f); if (!name) return "";
    var gl = v("grade", f) + (v("label", f) ? " " + v("label", f) : "");
    return [name + (v("number", f) ? " (" + v("number", f) + ")" : ""), v("set", f) ? "[" + v("set", f) + "]" : "", v("finish", f), f.elements.japanese && f.elements.japanese.checked ? "Japanese" : "", "Graded " + v("grader", f).toUpperCase() + " " + gl].filter(Boolean).join(" ");
  }
  function preview() { prev.textContent = titleOf(form) || "(type the card name)"; }
  form.addEventListener("input", preview); form.addEventListener("change", preview); preview();

  function fit(bmp, max) { var s = Math.min(1, max / Math.max(bmp.width, bmp.height)); var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c; }
  function decodeCanvas(c) { if (!root.jsQR) return null; var d = c.getContext("2d").getImageData(0, 0, c.width, c.height); var r = root.jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" }); return (r && r.data) || null; }
  async function detect(bmp) {
    if ("BarcodeDetector" in root) { try { var det = new root.BarcodeDetector({ formats: ["qr_code"] }); var res = await det.detect(bmp); if (res && res[0] && res[0].rawValue) return res[0].rawValue; } catch (e) {} }
    var sizes = [1400, 2200, 3000];
    for (var i = 0; i < sizes.length; i++) { try { var val = decodeCanvas(fit(bmp, sizes[i])); if (val) return val; } catch (e) {} }
    return null;
  }
  // One photo -> {file (shrunk JPEG when smaller), url (preview), qr (link or "")}.
  async function prep(file) {
    var out = { file: file, url: "", qr: "" }, bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) {}
    if (bmp) {
      try { var c = fit(bmp, 2000); var blob = await new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.86); }); if (blob && blob.size < file.size) out.file = new File([blob], (file.name || "photo").replace(/\.[A-Za-z0-9]+$/, "") + ".jpg", { type: "image/jpeg" }); } catch (e) {}
      try { var val = await detect(bmp); if (val && /^https?:\/\//i.test(val)) out.qr = val; else if (val) out.raw = val; } catch (e) {}
    }
    out.url = URL.createObjectURL(out.file);
    return out;
  }
  function which(input) { return input.name === "photo1" ? "front" : input.name === "photo2" ? "back" : "extra"; }
  async function onPhoto(input) {
    var file = input.files && input.files[0]; if (!file) return;
    var img = input.parentNode.querySelector("img");
    var p = await prep(file);
    if (p.file !== file) { try { var dt = new DataTransfer(); dt.items.add(p.file); input.files = dt.files; } catch (e) {} }
    if (img) { img.src = p.url; img.hidden = false; }
    if (qrAuto || !qrUrl.value) {
      if (p.qr) { qrUrl.value = p.qr; qrAuto = true; qrState.className = "ok"; qrState.textContent = "QR code read from the " + which(input) + " photo: " + p.qr; var m = certOfUrl(p.qr); if (m && !cert.value) cert.value = m; var g = graderOfUrl(p.qr); if (g && form.elements.grader) form.elements.grader.value = g; preview(); }
      else if (!qrAuto) { qrState.className = "muted"; qrState.textContent = p.raw ? "The QR code in the " + which(input) + " photo is not a link (" + p.raw.slice(0, 60) + "); type the certificate number instead." : "No QR code in the " + which(input) + " photo; it is usually on the back of the label. Add that photo, or type the certificate number."; }
    }
  }
  Array.prototype.forEach.call(form.querySelectorAll("input[type=file]"), function (i) { i.addEventListener("change", function () { onPhoto(i); }); });
  form.addEventListener("submit", function () { btn.disabled = true; btn.textContent = "Adding… (uploading photos)"; });

  /* ---------------- batch ---------------- */
  var batch = document.getElementById("batch"), lines = document.getElementById("lines"), bstate = document.getElementById("batchstate"), addAll = document.getElementById("addall");
  if (!batch) return;
  var photos = [];
  function opts(list, cur, labels) { return list.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? " selected" : "") + ">" + esc(labels ? labels(o) : (o || "none")) + "</option>"; }).join(""); }
  function fig(i, cap) { var p = photos[i]; return p ? '<figure><img src="' + esc(p.url) + '" alt=""><figcaption>' + cap + "</figcaption></figure>" : '<figure class="none"><div class="ph-none">no ' + cap + "</div><figcaption>&nbsp;</figcaption></figure>"; }
  function lineEl(s, k) {
    var el = document.createElement("form"); el.className = "line"; el.setAttribute("data-k", k);
    var g = s.grader || v("grader"), game = v("game") || "pokemon";
    el.innerHTML = '<div class="ph">' + fig(s.front, "front") + fig(s.back, "back") + s.extra.map(function (i) { return fig(i, "extra"); }).join("") +
      '<div class="meta"><b>Slab ' + (k + 1) + "</b><br>" + (s.qr ? '<span class="ok">QR: ' + esc(s.cert || s.qr) + " (" + esc(s.grader || "link") + ")</span>" : '<span class="muted">no QR code read: add the certificate number</span>') +
      '<br><button type="button" class="sm swap">Swap front/back</button> <button type="button" class="sm drop">Remove line</button></div></div>' +
      '<div class="grid">' +
      "<label>Game <select name=\"game\">" + opts(Object.keys(cfg.games), game, function (x) { return cfg.games[x]; }) + "</select></label>" +
      "<label>Grader <select name=\"grader\">" + opts(cfg.graders, g) + "</select></label>" +
      "<label>Grade <select name=\"grade\">" + opts(cfg.grades, "10") + "</select></label>" +
      '<label>Grade label <input class="text" name="label" placeholder="Pristine, Gem Mint" autocomplete="off"></label>' +
      '<label class="wide">Card name * <input class="text" name="name" required placeholder="Dark Muk" autocomplete="off"></label>' +
      '<label>Number <input class="text" name="number" placeholder="41/82" autocomplete="off"></label>' +
      '<label>Set <input class="text" name="set" value="' + esc(v("set")) + '" autocomplete="off"></label>' +
      "<label>Finish <select name=\"finish\">" + opts(cfg.finishes, v("finish"), function (x) { return x || "none"; }) + "</select></label>" +
      '<label class="chk"><input type="checkbox" name="japanese" value="1"' + (form.elements.japanese && form.elements.japanese.checked ? " checked" : "") + "> Japanese</label>" +
      '<label>Certificate number <input class="text" name="cert" value="' + esc(s.cert) + '" inputmode="numeric" autocomplete="off"></label>' +
      '<label class="wide">Certificate link <input class="text" name="qr_url" value="' + esc(s.qr) + '" autocomplete="off"></label>' +
      '<label>Price (CAD) <input class="text" name="price" inputmode="decimal" placeholder="blank = placeholder" autocomplete="off"></label>' +
      '<label>Cost <input class="text" name="cost" inputmode="decimal" autocomplete="off"></label>' +
      '<label>Quantity <input class="text" name="qty" type="number" min="1" max="99" value="1"></label>' +
      '<label class="chk"><input type="checkbox" name="auto_price" value="1" checked> Auto-pricing</label>' +
      '<label class="wide">Notes <input class="text" name="notes" autocomplete="off"></label>' +
      "</div>" +
      '<div class="tp">Title: <b class="lt"></b></div>' +
      '<div class="act"><button type="submit" class="save">Add this slab</button> <span class="st muted"></span></div>';
    var lt = el.querySelector(".lt"), st = el.querySelector(".st");
    var pv = function () { lt.textContent = titleOf(el) || "(type the card name)"; };
    el.addEventListener("input", pv); el.addEventListener("change", pv); pv();
    el.querySelector(".swap").addEventListener("click", function () { var t = s.front; s.front = s.back; s.back = t; el.querySelector(".ph").innerHTML = fig(s.front, "front") + fig(s.back, "back") + s.extra.map(function (i) { return fig(i, "extra"); }).join("") + el.querySelector(".meta").outerHTML; wire(); });
    el.querySelector(".drop").addEventListener("click", function () { el.remove(); });
    function wire() { el.querySelector(".swap").addEventListener("click", function () { el.querySelector(".swap").dispatchEvent(new Event("click")); }); }
    el.addEventListener("submit", function (ev) { ev.preventDefault(); addLine(el, s); });
    el._slab = s;
    return el;
  }
  async function addLine(el, s) {
    if (el.classList.contains("done") || el.classList.contains("busy")) return;
    var st = el.querySelector(".st");
    if (!v("name", el)) { st.className = "st err"; st.textContent = "Type the card name first."; return; }
    el.classList.add("busy"); st.className = "st muted"; st.textContent = "Adding… (uploading photos)";
    var fd = new FormData();
    ["game", "grader", "grade", "label", "name", "number", "set", "finish", "cert", "qr_url", "price", "cost", "qty", "notes"].forEach(function (n) { fd.append(n, v(n, el)); });
    if (el.elements.japanese.checked) fd.append("japanese", "1");
    if (el.elements.auto_price.checked) fd.append("auto_price", "1");
    fd.append("json", "1");
    var n = 1;
    [s.front, s.back].concat(s.extra).forEach(function (i) { if (i != null && photos[i]) { fd.append("photo" + n, photos[i].file, photos[i].file.name || ("photo" + n + ".jpg")); n++; } });
    var j = null;
    try { var r = await fetch(cfg.base + "/graded/add", { method: "POST", body: fd, credentials: "same-origin" }); j = await r.json(); } catch (e) { j = { ok: false, error: "No answer from 9Pocket (signed out? reload the page)." }; }
    el.classList.remove("busy");
    if (j && j.ok) { el.classList.add("done"); st.className = "st ok"; st.innerHTML = "Added: " + esc(j.title) + ' &middot; <a href="' + esc(j.url) + '" target="_blank" rel="noopener">site</a> &middot; <a href="' + esc(j.adminUrl) + '" target="_blank" rel="noopener">Shopify</a>' + (j.placeholder ? " &middot; $999,999 placeholder until auto-pricing suggests a price" : "") + (j.published ? "" : " &middot; <b>not published to the Online Store</b>"); el.querySelector("button.save").disabled = true; }
    else { st.className = "st err"; st.textContent = (j && j.error) || "Failed."; }
  }
  batch.addEventListener("change", async function () {
    var files = Array.prototype.slice.call(batch.files || []);
    if (!files.length) return;
    files.sort(function (a, b) { return (a.lastModified || 0) - (b.lastModified || 0); });
    lines.innerHTML = ""; photos = []; addAll.hidden = true;
    for (var n = 0; n < files.length; n++) { bstate.textContent = "Reading photo " + (n + 1) + " of " + files.length + "…"; var p = await prep(files[n]); p.i = n; photos.push(p); }
    var slabs = pairPhotos(photos);
    bstate.textContent = slabs.length + " slab" + (slabs.length === 1 ? "" : "s") + " from " + files.length + " photo" + (files.length === 1 ? "" : "s") + ". Check each line (swap if a pair is backwards), fill in the card, then add.";
    slabs.forEach(function (s, k) { lines.appendChild(lineEl(s, k)); });
    addAll.hidden = !slabs.length;
  });
  addAll.addEventListener("click", async function () {
    addAll.disabled = true;
    var els = Array.prototype.slice.call(lines.querySelectorAll("form.line"));
    for (var i = 0; i < els.length; i++) if (!els[i].classList.contains("done") && v("name", els[i])) await addLine(els[i], els[i]._slab);
    addAll.disabled = false;
  });
})(typeof window !== "undefined" ? window : {});
