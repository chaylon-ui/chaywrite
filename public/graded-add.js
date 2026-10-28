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
  /* Pairing by the order the photos were shot: (front, back), (front, back)...
     or back first. A QR code found in either photo of a pair gives the
     certificate; if it sits in the "front" slot the pair is swapped. An odd
     last photo stands alone. The owner's natural flow (2026-10-28: fronts and
     backs shot in turn) - the QR is a bonus here, not the pairing key. */
  function pairByOrder(scans, backFirst) {
    var items = (scans || []).map(function (s, n) { return { i: s.i == null ? n : s.i, qr: String(s.qr || "") }; });
    var slabs = [];
    for (var n = 0; n < items.length; n += 2) {
      var a = items[n], b = items[n + 1] || null;
      var front = backFirst ? b : a, back = backFirst ? a : b;
      if (front && front.qr && !(back && back.qr)) { var t = front; front = back; back = t; }
      var qr = (back && back.qr) || (front && front.qr) || "";
      slabs.push({ front: front ? front.i : null, back: back ? back.i : null, extra: [], qr: qr, cert: certOfUrl(qr), grader: graderOfUrl(qr) });
    }
    return slabs;
  }
  /* A sideways photo of an upright slab: which way to turn it to portrait. The
     QR code, when read, sits in the label at the slab's top: on the right of a
     landscape frame the top is on the right (turn counter-clockwise), on the
     left it is on the left (turn clockwise). With no QR code the phone was most
     likely turned the usual way, top to the left, which puts the slab's top on
     the right (owner, 2026-10-28: "sometimes when you take the photo of the
     cards it is sideways and you dont notice"). */
  function rotationFor(width, height, qrSide) { if (!(width > height)) return 0; return qrSide === "left" ? 90 : -90; }
  if (typeof module !== "undefined" && module.exports) module.exports = { pairPhotos, pairByOrder, graderOfUrl, certOfUrl, rotationFor };
  if (typeof document === "undefined") return;

  /* ---------------- the page ---------------- */
  var cfg = root.xgGraded || { grades: ["10"], finishes: [""], graders: ["PSA"], games: { pokemon: "Pokémon" }, base: "/9pocket", psa: false };
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

  /* ---- photos: shrink, read the QR code, turn sideways shots upright ---- */
  function fit(bmp, max) { var s = Math.min(1, max / Math.max(bmp.width, bmp.height)); var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c; }
  function rotateCanvas(src, deg) { var c = document.createElement("canvas"), swap = Math.abs(deg) === 90; c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height; var ctx = c.getContext("2d"); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(src, -src.width / 2, -src.height / 2); return c; }
  function toJpeg(c) { return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.86); }); }
  function closeBmp(b) { try { if (b && b.close) b.close(); } catch (e) {} }
  // jsQR on a canvas: the text and where the code sits, as a fraction of the canvas width.
  function decodeCanvas(c) { if (!root.jsQR) return null; var d = c.getContext("2d").getImageData(0, 0, c.width, c.height); var r = root.jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" }); if (!r || !r.data) return null; var L = r.location || {}, xs = [L.topLeftCorner, L.topRightCorner, L.bottomLeftCorner, L.bottomRightCorner].filter(Boolean).map(function (p) { return p.x; }); return { value: r.data, cx: xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length / c.width : null }; }
  // The library (public/vendor/jsQR-1.4.0.js, served by the worker) loads deferred: give it a moment before the first decode.
  function ensureQr() { return new Promise(function (res) { var t = 0; (function tick() { if (root.jsQR || t > 40) return res(!!root.jsQR); t++; setTimeout(tick, 100); })(); }); }
  var readerNote = "";
  async function detect(bmp) {
    if ("BarcodeDetector" in root) { try { var det = new root.BarcodeDetector({ formats: ["qr_code"] }); var res = await det.detect(bmp); if (res && res[0] && res[0].rawValue) { var bb = res[0].boundingBox; return { value: res[0].rawValue, cx: bb ? (bb.x + bb.width / 2) / bmp.width : null }; } } catch (e) {} }
    if (!(await ensureQr())) { readerNote = "the QR reader did not load"; return null; }
    var sizes = [1200, 2000];
    for (var i = 0; i < sizes.length; i++) { try { var val = decodeCanvas(fit(bmp, sizes[i])); if (val) return val; } catch (e) {} }
    // A small QR code on a whole-slab photo: look at the big picture in tiles (2x2 with overlap, then the middle).
    try {
      var big = fit(bmp, 3200), W = big.width, H = big.height, tiles = [];
      for (var y = 0; y < 2; y++) for (var x = 0; x < 2; x++) tiles.push([x * W * 0.4, y * H * 0.4, W * 0.6, H * 0.6]);
      tiles.push([W * 0.2, H * 0.2, W * 0.6, H * 0.6]);
      for (var k = 0; k < tiles.length; k++) {
        var t = tiles[k], c = document.createElement("canvas"); c.width = Math.round(t[2]); c.height = Math.round(t[3]);
        c.getContext("2d").drawImage(big, t[0], t[1], t[2], t[3], 0, 0, c.width, c.height);
        var v2 = decodeCanvas(c); if (v2) { if (v2.cx != null) v2.cx = (t[0] + v2.cx * c.width) / W; return v2; }
      }
    } catch (e) {}
    return null;
  }
  // One photo -> {file (upright, shrunk JPEG), url (preview), qr (link or ""), raw, rot (degrees applied), basis ("qr" | "default" | "manual" | "none")}.
  async function prep(file) {
    var out = { file: file, url: "", qr: "", raw: "", rot: 0, basis: "none", name: (file.name || "photo").replace(/\.[A-Za-z0-9]+$/, "") + ".jpg" }, bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) {}
    if (bmp) {
      var found = null; try { found = await detect(bmp); } catch (e) {}
      if (found && found.value) { if (/^https?:\/\//i.test(found.value)) out.qr = found.value; else out.raw = found.value; }
      var side = found && found.cx != null ? (found.cx < 0.5 ? "left" : "right") : null;
      out.rot = rotationFor(bmp.width, bmp.height, side); out.basis = out.rot ? (side ? "qr" : "default") : "none";
      try { var c = fit(bmp, 2000); if (out.rot) c = rotateCanvas(c, out.rot); var blob = await toJpeg(c); if (blob && (out.rot || blob.size < file.size)) out.file = new File([blob], out.name, { type: "image/jpeg" }); } catch (e) {}
      closeBmp(bmp);
    }
    out.url = URL.createObjectURL(out.file);
    return out;
  }
  // Turn a prepared photo further (the Rotate buttons): a quarter turn clockwise each tap.
  async function turn(p, deg) {
    var bmp = null; try { bmp = await createImageBitmap(p.file); } catch (e) { return p; }
    var c = rotateCanvas(bmp, deg); closeBmp(bmp);
    var blob = await toJpeg(c); if (!blob) return p;
    p.file = new File([blob], p.name || "photo.jpg", { type: "image/jpeg" }); p.url = URL.createObjectURL(p.file); p.rot = (p.rot + deg) % 360; p.basis = "manual";
    return p;
  }
  function which(input) { return input.name === "photo1" ? "front" : input.name === "photo2" ? "back" : "extra"; }
  // PSA's record for a certificate (through 9Pocket, never from the browser to PSA) fills the empty fields of a form.
  async function lookupCert(grader, certNo) {
    if (!cfg.psa || String(grader).toUpperCase() !== "PSA" || !/^\d{6,12}$/.test(String(certNo || ""))) return null;
    try { var r = await fetch(cfg.base + "/graded/cert.json?grader=PSA&cert=" + encodeURIComponent(certNo), { credentials: "same-origin" }); return await r.json(); } catch (e) { return { ok: false, error: "No answer from 9Pocket." }; }
  }
  function setIfEmpty(f, name, val) { var e = f.elements[name]; if (e && val && !String(e.value || "").trim()) e.value = val; }
  function applyCert(f, d) {
    if (!d || !d.ok) return "";
    setIfEmpty(f, "name", d.name); setIfEmpty(f, "number", d.number); setIfEmpty(f, "set", d.set); setIfEmpty(f, "cert", d.cert);
    if (f.elements.grader) f.elements.grader.value = "PSA";
    if (d.grade && f.elements.grade) f.elements.grade.value = d.grade;
    if (d.game && f.elements.game && cfg.games[d.game]) f.elements.game.value = d.game;
    if (d.japanese && f.elements.japanese) f.elements.japanese.checked = true;
    return "PSA: " + d.name + (d.number ? " #" + d.number : "") + (d.set ? ", " + d.set : "") + (d.year ? " (" + d.year + ")" : "") + (d.variety ? ", " + d.variety : "") + ", " + (d.gradeText || d.grade) + (d.population != null ? ", pop " + d.population + (d.higher != null ? " (" + d.higher + " higher)" : "") : "");
  }
  var psaState = document.getElementById("psastate"), lastLooked = "";
  async function singleLookup() {
    var certNo = String(cert.value || "").trim(); if (!certNo || certNo === lastLooked || v("grader").toUpperCase() !== "PSA" || !cfg.psa) return;
    lastLooked = certNo; psaState.className = "muted"; psaState.textContent = "Asking PSA about certificate " + certNo + "…";
    var d = await lookupCert("PSA", certNo);
    if (d && d.ok) { psaState.className = "ok"; psaState.textContent = applyCert(form, d); preview(); } else { psaState.className = "muted"; psaState.textContent = (d && d.error) || ""; }
  }
  if (psaState) { cert.addEventListener("change", singleLookup); cert.addEventListener("blur", singleLookup); }

  /* ---- the single form's photo boxes ---- */
  var single = {};
  function setInputFile(input, p) { try { var dt = new DataTransfer(); dt.items.add(p.file); input.files = dt.files; } catch (e) {} }
  function showSingle(input, p) { var box = input.closest(".shot"), img = box.querySelector("img"), rot = box.querySelector(".rot"), note = box.querySelector(".turned"); if (img) { img.src = p.url; img.hidden = false; } if (rot) rot.hidden = false; if (note) note.textContent = p.basis === "qr" || p.basis === "default" ? "turned upright" : p.basis === "manual" ? "rotated" : ""; }
  async function onPhoto(input) {
    var file = input.files && input.files[0]; if (!file) return;
    var p = await prep(file); single[input.name] = p;
    if (p.file !== file) setInputFile(input, p);
    showSingle(input, p);
    if (qrAuto || !qrUrl.value) {
      if (p.qr) { qrUrl.value = p.qr; qrAuto = true; qrState.className = "ok"; qrState.textContent = "QR code read from the " + which(input) + " photo: " + p.qr; var m = certOfUrl(p.qr); if (m && !cert.value) cert.value = m; var g = graderOfUrl(p.qr); if (g && form.elements.grader) form.elements.grader.value = g; preview(); if (g === "PSA") singleLookup(); }
      else if (!qrAuto) { qrState.className = "muted"; qrState.textContent = p.raw ? "The QR code in the " + which(input) + " photo is not a link (" + p.raw.slice(0, 60) + "); type the certificate number instead." : "No QR code in the " + which(input) + " photo; it is usually on the back of the label. Add that photo, or type the certificate number."; }
    }
  }
  Array.prototype.forEach.call(form.querySelectorAll("input[type=file]"), function (i) { i.addEventListener("change", function () { onPhoto(i); }); });
  Array.prototype.forEach.call(form.querySelectorAll(".shot .rot"), function (b) { b.addEventListener("click", async function () { var input = b.closest(".shot").querySelector("input[type=file]"); var p = single[input.name]; if (!p) return; b.disabled = true; await turn(p, 90); setInputFile(input, p); showSingle(input, p); b.disabled = false; }); });
  form.addEventListener("submit", function () { btn.disabled = true; btn.textContent = "Adding… (uploading photos)"; });

  /* ---------------- batch ---------------- */
  var batch = document.getElementById("batch"), lines = document.getElementById("lines"), bstate = document.getElementById("batchstate"), addAll = document.getElementById("addall");
  if (!batch) return;
  var photos = [];
  function opts(list, cur, labels) { return list.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? " selected" : "") + ">" + esc(labels ? labels(o) : (o || "none")) + "</option>"; }).join(""); }
  function fig(i, cap) { var p = i != null ? photos[i] : null; return p ? '<figure data-i="' + i + '"><img src="' + esc(p.url) + '" alt=""><figcaption>' + cap + ' <button type="button" class="sm rot" data-i="' + i + '" title="Rotate a quarter turn">↻</button></figcaption></figure>' : '<figure class="none"><div class="ph-none">no ' + cap + "</div><figcaption>&nbsp;</figcaption></figure>"; }
  function figures(s) { return fig(s.front, "front") + fig(s.back, "back") + s.extra.map(function (i) { return fig(i, "extra"); }).join(""); }
  function lineEl(s, k) {
    var el = document.createElement("form"); el.className = "line"; el.setAttribute("data-k", k);
    var g = s.grader || v("grader"), game = v("game") || "pokemon";
    el.innerHTML = '<div class="ph"><div class="figs">' + figures(s) + "</div>" +
      '<div class="meta"><b>Slab ' + (k + 1) + "</b><br>" + (s.qr ? '<span class="ok">QR: ' + esc(s.cert || s.qr) + " (" + esc(s.grader || "link") + ")</span>" : '<span class="muted">no QR code read: add the certificate number</span>') +
      '<br><span class="psa muted"></span><br><button type="button" class="sm swap">Swap front/back</button> <button type="button" class="sm drop">Remove line</button></div></div>' +
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
    var lt = el.querySelector(".lt");
    var pv = function () { lt.textContent = titleOf(el) || "(type the card name)"; };
    el.addEventListener("input", pv); el.addEventListener("change", pv); pv();
    el.addEventListener("click", async function (ev) {
      var b = ev.target.closest("button"); if (!b || b.type === "submit") return;
      if (b.classList.contains("swap")) { var t = s.front; s.front = s.back; s.back = t; el.querySelector(".figs").innerHTML = figures(s); }
      else if (b.classList.contains("drop")) el.remove();
      else if (b.classList.contains("rot")) { var p = photos[Number(b.getAttribute("data-i"))]; if (!p) return; b.disabled = true; await turn(p, 90); el.querySelector(".figs").innerHTML = figures(s); }
    });
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
    var mode = (document.getElementById("pairmode") || {}).value || "fb";
    var slabs = mode === "qr" ? pairPhotos(photos) : pairByOrder(photos, mode === "bf");
    // A front turned upright by guesswork follows its back when the back's QR code settled the direction.
    for (var q = 0; q < slabs.length; q++) { var sb = slabs[q], fp = sb.front != null && photos[sb.front], bp = sb.back != null && photos[sb.back]; if (fp && bp && bp.basis === "qr" && fp.basis === "default" && fp.rot !== bp.rot) { await turn(fp, 180); fp.basis = "qr"; } }
    var withQr = photos.filter(function (p) { return p.qr; }).length, turned = photos.filter(function (p) { return p.rot; }).length;
    var reader = readerNote || (("BarcodeDetector" in root) ? "built-in reader" : (root.jsQR ? "jsQR" : "no reader"));
    bstate.textContent = slabs.length + " slab" + (slabs.length === 1 ? "" : "s") + " from " + files.length + " photo" + (files.length === 1 ? "" : "s") + (mode === "qr" ? ", paired by QR code" : ", paired in order (" + (mode === "bf" ? "back then front" : "front then back") + ")") + "; QR codes read in " + withQr + " of " + files.length + " (" + reader + ")" + (turned ? "; " + turned + " sideways photo" + (turned === 1 ? "" : "s") + " turned upright (tap ↻ on a thumbnail if one is wrong)" : "") + ". Check each line (swap if a pair is backwards), fill in the card, then add.";
    var els = slabs.map(function (s, k) { var el = lineEl(s, k); lines.appendChild(el); return el; });
    addAll.hidden = !slabs.length;
    // PSA's records, one slab at a time (the free allowance is about 100 a day).
    for (var k = 0; k < slabs.length; k++) {
      var s = slabs[k]; if (!cfg.psa || s.grader !== "PSA" || !s.cert) continue;
      var meta = els[k].querySelector(".meta .psa"); if (meta) meta.textContent = "Asking PSA…";
      var d = await lookupCert("PSA", s.cert);
      if (meta) { if (d && d.ok) { meta.className = "psa ok"; meta.textContent = applyCert(els[k], d); els[k].dispatchEvent(new Event("input")); } else { meta.className = "psa muted"; meta.textContent = (d && d.error) || ""; if (d && d.limited) break; } }
    }
  });
  addAll.addEventListener("click", async function () {
    addAll.disabled = true;
    var els = Array.prototype.slice.call(lines.querySelectorAll("form.line"));
    for (var i = 0; i < els.length; i++) if (!els[i].classList.contains("done") && v("name", els[i])) await addLine(els[i], els[i]._slab);
    addAll.disabled = false;
  });
})(typeof window !== "undefined" ? window : {});
