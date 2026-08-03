// ==UserScript==
// @name         Exor Kiosk Pickups — BinderPOS auto-loader
// @namespace    https://exor-binder.nevski.workers.dev/
// @version      1.2.0
// @description  Shows open kiosk pickup orders inside the BinderPOS till and auto-"scans" each line into the cart (card + condition exact, via BinderPOS's own variant barcodes), so staff can apply store credit and finish the sale in BinderPOS.
// @match        https://portal.binderpos.com/*
// @grant        none
// @updateURL    https://exor-binder.nevski.workers.dev/binderpos-pickups.user.js
// @downloadURL  https://exor-binder.nevski.workers.dev/binderpos-pickups.user.js
// ==/UserScript==

/* HOW IT WORKS
   - A small "📦 Pickups" button floats bottom-right of the BinderPOS portal.
   - It reads the kiosk's open draft orders from the showcase worker (same
     staff PIN as the /staff and /pickups pages; asked once, kept locally).
   - LOAD INTO CART "types" each line's barcode + Enter, paced like a fast
     scanner, so the till adds the exact card/variant/condition itself. If
     the till ignores synthetic typing, flip Mode to "wedge" in the panel —
     and if all else fails SHOW BARCODES renders scannable Code 39 bars to
     zap off the screen with the real scanner.
   - MARK DONE clears the pickup (deletes the draft) once it's rung through.
*/
(() => {
  "use strict";
  const BASE = "https://exor-binder.nevski.workers.dev";
  const LS = (k, v) => (v === undefined ? localStorage.getItem("exor_" + k) : localStorage.setItem("exor_" + k, v));
  const H = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- styles ----
  const css = document.createElement("style");
  css.textContent = `
  #exorPk{position:fixed;z-index:2147483000;font-family:Inter,system-ui,sans-serif}
  #exorPk .epBtn{background:#17171d;color:#f2e9d8;border:2px solid #d9822b;border-radius:24px;padding:10px 16px;font-weight:700;font-size:14px;cursor:grab;box-shadow:0 8px 22px rgba(0,0,0,.45);touch-action:none;user-select:none}
  #exorPk .epPanel{display:none;position:absolute;top:calc(100% + 8px);right:0;width:360px;max-height:72vh;overflow-y:auto;background:#14141a;color:#efe9dd;border:1px solid #33333d;border-radius:14px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.55)}
  #exorPk.low .epPanel{top:auto;bottom:calc(100% + 8px)} /* parked near the bottom: open upward instead */
  #exorPk.leftAnchor .epPanel{right:auto;left:0} /* parked near the left edge: panel grows rightward */
  #exorPk.open .epPanel{display:block}
  #exorPk h4{margin:0 0 6px;font-size:14px;color:#d9822b}
  #exorPk .epRow{border:1px solid #2a2a33;border-radius:10px;padding:8px 10px;margin-top:8px}
  #exorPk .epName{font-weight:700}
  #exorPk .epMeta{font-size:11px;color:#9a9aa6}
  #exorPk .epItems{font-size:12px;margin:6px 0;color:#cfc9bc}
  #exorPk .epItems div{padding:1px 0}
  #exorPk button.ep{border:0;border-radius:8px;padding:7px 10px;font-weight:700;font-size:12px;cursor:pointer;margin:2px 4px 2px 0}
  #exorPk .epLoad{background:#d9822b;color:#fff}
  #exorPk .epBars{background:#2e2e38;color:#efe9dd}
  #exorPk .epDone{background:#3f9d5a;color:#fff}
  #exorPk .epGhost{background:transparent;color:#9a9aa6;border:1px solid #33333d!important}
  #exorPk input.ep{width:100%;box-sizing:border-box;background:#0e0e12;border:1px solid #33333d;border-radius:8px;color:#efe9dd;padding:8px;font-size:13px;margin:4px 0}
  #exorPk .epStat{font-size:12px;color:#9a9aa6;margin-top:6px;min-height:1.2em}
  #exorPk .epBarBox{background:#fff;border-radius:8px;padding:8px;margin-top:6px;text-align:center}
  #exorPk .epBarBox .lbl{color:#111;font-size:11px;font-weight:600;margin-top:2px}
  #exorPk .epTiny{font-size:11px;color:#9a9aa6;margin-top:8px}
  #exorPk select.ep{background:#0e0e12;color:#efe9dd;border:1px solid #33333d;border-radius:8px;padding:4px 6px;font-size:12px}`;
  document.head.appendChild(css);

  // ---- panel shell ----
  const root = document.createElement("div");
  root.id = "exorPk";
  root.innerHTML = `<div class="epPanel"><h4>📦 Exor kiosk pickups</h4><div class="epBody">Loading…</div>
    <div class="epTiny">Mode <select class="ep" id="epMode"><option value="input">search box</option><option value="wedge">wedge (keystrokes)</option></select>
    · pace <select class="ep" id="epPace"><option>400</option><option selected>700</option><option>1100</option></select>ms
    <button class="ep epGhost" id="epForget">forget PIN</button></div></div>
    <button class="epBtn" id="epToggle">📦 Pickups</button>`;
  document.body.appendChild(root);
  // The till listens for scanner keystrokes globally and steals keyboard
  // input (that's why typing the PIN did nothing) — keep every key event
  // that starts inside our panel to ourselves. Default text insertion still
  // happens; only the till's grabby listeners are cut out.
  for (const ev of ["keydown", "keypress", "keyup", "paste"]) root.addEventListener(ev, (e) => e.stopPropagation(), true);
  // And if the till re-steals focus from our PIN box, take it back.
  root.addEventListener("focusin", (e) => { const el = e.target; if (el && el.id === "epPin") setTimeout(() => { if (document.activeElement !== el && root.contains(el)) el.focus(); }, 60); });
  const body = () => root.querySelector(".epBody");
  // Default spot: TOP-right, clear of the till's pay controls. The button is
  // draggable — park it anywhere; the spot sticks per computer.
  const btn = root.querySelector("#epToggle");
  const savedPos = (() => { try { return JSON.parse(LS("pos") || ""); } catch { return null; } })();
  const place = (x, y) => {
    x = Math.max(4, Math.min(window.innerWidth - 150, x));
    y = Math.max(4, Math.min(window.innerHeight - 52, y));
    root.style.left = x + "px"; root.style.top = y + "px";
    root.classList.toggle("low", y > window.innerHeight * 0.55);
    root.classList.toggle("leftAnchor", x < 380);
  };
  place(savedPos ? savedPos.x : window.innerWidth - 175, savedPos ? savedPos.y : 12);
  window.addEventListener("resize", () => { const r2 = root.getBoundingClientRect(); place(r2.left, r2.top); });
  let drag = null, moved = false;
  btn.addEventListener("pointerdown", (e) => { const r2 = root.getBoundingClientRect(); drag = { dx: e.clientX - r2.left, dy: e.clientY - r2.top }; moved = false; try { btn.setPointerCapture(e.pointerId); } catch {} });
  btn.addEventListener("pointermove", (e) => { if (!drag) return; const nx = e.clientX - drag.dx, ny = e.clientY - drag.dy; const r2 = root.getBoundingClientRect(); if (moved || Math.abs(nx - r2.left) + Math.abs(ny - r2.top) > 5) { moved = true; place(nx, ny); } });
  btn.addEventListener("pointerup", () => { if (moved) { const r2 = root.getBoundingClientRect(); LS("pos", JSON.stringify({ x: Math.round(r2.left), y: Math.round(r2.top) })); } drag = null; });
  btn.onclick = () => { if (moved) { moved = false; return; } root.classList.toggle("open"); if (root.classList.contains("open")) refresh(); };
  root.querySelector("#epMode").value = LS("mode") || "input";
  root.querySelector("#epMode").onchange = (e) => LS("mode", e.target.value);
  root.querySelector("#epPace").onchange = (e) => LS("pace", e.target.value);
  if (LS("pace")) root.querySelector("#epPace").value = LS("pace");
  root.querySelector("#epForget").onclick = () => { localStorage.removeItem("exor_pin"); refresh(); };

  // ---- data ----
  let ORDERS = [];
  async function refresh() {
    const pin = LS("pin");
    if (!pin) {
      // Tap-pad alongside the input: the till's global key-grabbing can't
      // interfere with clicks, so the PIN always goes in one way or another.
      body().innerHTML = `<div>Enter the kiosk staff PIN (same as the /staff page):</div>
        <input class="ep" id="epPin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        <div id="epPad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:4px 0">${[1,2,3,4,5,6,7,8,9,"⌫",0,"OK"].map((k) => `<button class="ep ${k === "OK" ? "epLoad" : "epBars"}" data-k="${k}" style="margin:0;padding:10px 0;font-size:15px">${k}</button>`).join("")}</div>
        <div class="epStat"></div>`;
      const inp = body().querySelector("#epPin");
      const go = () => { const v = inp.value.trim(); if (v) { LS("pin", v); refresh(); } };
      body().querySelectorAll("#epPad button").forEach((b) => { b.onclick = () => {
        const k = b.dataset.k;
        if (k === "OK") return go();
        if (k === "⌫") inp.value = inp.value.slice(0, -1);
        else if (inp.value.length < 8) inp.value += k;
      }; });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      setTimeout(() => inp.focus(), 100);
      return;
    }
    body().innerHTML = "Loading pickups…";
    try {
      const r = await fetch(`${BASE}/pickups.json?k=${encodeURIComponent(pin)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      ORDERS = (j.orders || []).filter((o) => o.kiosk);
      render();
    } catch (e) {
      body().innerHTML = `<div class="epStat">⚠ ${H(e.message || e)}${/staff key/i.test(String(e.message)) ? ' — <a href="#" id="epRePin" style="color:#d9822b">re-enter PIN</a>' : ""}</div>`;
      const a = body().querySelector("#epRePin");
      if (a) a.onclick = (ev) => { ev.preventDefault(); localStorage.removeItem("exor_pin"); refresh(); };
    }
  }
  function render() {
    root.querySelector("#epToggle").textContent = `📦 Pickups (${ORDERS.length})`;
    if (!ORDERS.length) { body().innerHTML = '<div class="epStat">No kiosk pickups waiting. 🎉</div>'; return; }
    body().innerHTML = ORDERS.map((o, i) => `<div class="epRow" data-i="${i}">
      <div class="epName">${H(o.name)} <span class="epMeta">· ${o.items.length} line${o.items.length === 1 ? "" : "s"} · $${H(o.total)}</span></div>
      ${o.note ? `<div class="epMeta">${H(o.note)}</div>` : ""}
      <div class="epItems">${o.items.map((it) => `<div>${it.q}× ${H(it.t)}${it.b ? "" : " ⚠ no barcode"}</div>`).join("")}</div>
      <button class="ep epLoad">▶ Load into cart</button><button class="ep epBars">Show barcodes</button><button class="ep epDone">✓ Mark done</button>
      <div class="epStat"></div><div class="epBarsOut"></div></div>`).join("");
    body().querySelectorAll(".epRow").forEach((row) => {
      const o = ORDERS[+row.dataset.i];
      row.querySelector(".epLoad").onclick = () => loadOrder(o, row);
      row.querySelector(".epBars").onclick = () => showBars(o, row);
      row.querySelector(".epDone").onclick = () => markDone(o, row);
    });
  }

  // ---- auto-typing ("software scanner") ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function findScanInput() {
    // Prefer whatever the till currently focuses; else the most likely
    // search field on screen (BinderPOS till keeps a product search box).
    const a = document.activeElement;
    if (a && a.tagName === "INPUT" && a.type !== "password" && a.closest("body")) return a;
    const cands = [...document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])')].filter((el) => {
      const r2 = el.getBoundingClientRect();
      const ph = ((el.placeholder || "") + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
      return r2.width > 80 && r2.height > 10 && !el.disabled && !el.closest("#exorPk") && /search|scan|product|barcode|sku|item/.test(ph);
    });
    return cands[0] || [...document.querySelectorAll('input[type="text"],input[type="search"]')].find((el) => {
      const r2 = el.getBoundingClientRect(); return r2.width > 80 && !el.closest("#exorPk");
    }) || null;
  }
  const setNative = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(el, v);
  };
  function fireKey(el, type, key) {
    const code = key === "Enter" ? "Enter" : "Digit" + key;
    el.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode: key === "Enter" ? 13 : key.charCodeAt(0), which: key === "Enter" ? 13 : key.charCodeAt(0), bubbles: true, cancelable: true }));
  }
  async function typeCode(code) {
    const mode = LS("mode") || "input";
    const el = findScanInput();
    if (mode === "input" && el) {
      el.focus();
      setNative(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(40);
      setNative(el, code);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(120);
      fireKey(el, "keydown", "Enter"); fireKey(el, "keypress", "Enter"); fireKey(el, "keyup", "Enter");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // wedge mode: raw keystrokes at whatever has focus, like a scanner
      const t = el || document.activeElement || document.body;
      if (el) el.focus();
      for (const ch of String(code)) { fireKey(t, "keydown", ch); fireKey(t, "keypress", ch); if (t.tagName === "INPUT") { setNative(t, (t.value || "") + ch); t.dispatchEvent(new Event("input", { bubbles: true })); } fireKey(t, "keyup", ch); await sleep(18); }
      fireKey(t, "keydown", "Enter"); fireKey(t, "keypress", "Enter"); fireKey(t, "keyup", "Enter");
    }
  }
  async function loadOrder(o, row) {
    const stat = row.querySelector(".epStat");
    const pace = +(LS("pace") || 700);
    const missing = o.items.filter((it) => !it.b);
    let n = 0, total = o.items.reduce((a, it) => a + (it.b ? it.q : 0), 0);
    for (const it of o.items) {
      if (!it.b) continue;
      for (let q = 0; q < it.q; q++) {
        n++;
        stat.textContent = `Scanning ${n}/${total} — ${it.t.slice(0, 40)}…`;
        await typeCode(it.b);
        await sleep(pace);
      }
    }
    stat.textContent = `Done — ${n} scan${n === 1 ? "" : "s"} sent.` + (missing.length ? ` ⚠ ${missing.length} line(s) had no barcode — add manually.` : "") + " Check the till cart matches, then apply credit & pay.";
  }

  // ---- Code 39 barcodes (fallback: zap them off the screen) ----
  // Numeric-only codes; Code 39 is dead simple and every retail scanner
  // reads it. n=narrow w=wide, 9 elements per char, bar/space alternating.
  const C39 = { "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
    "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn", "*": "nwnnwnwnn" };
  function code39svg(code) {
    const seq = ("*" + code + "*").split("");
    let x = 0; const parts = []; const NW = 2, WW = 5, HGT = 46;
    for (const ch of seq) {
      const pat = C39[ch]; if (!pat) continue;
      for (let i = 0; i < 9; i++) {
        const w = pat[i] === "w" ? WW : NW;
        if (i % 2 === 0) parts.push(`<rect x="${x}" y="0" width="${w}" height="${HGT}" fill="#111"/>`);
        x += w;
      }
      x += NW; // inter-character gap
    }
    return `<svg viewBox="0 0 ${x} ${HGT}" style="height:46px;max-width:100%" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
  }
  function showBars(o, row) {
    const out = row.querySelector(".epBarsOut");
    if (out.innerHTML) { out.innerHTML = ""; return; }
    out.innerHTML = o.items.map((it) => it.b
      ? `<div class="epBarBox">${code39svg(it.b)}<div class="lbl">${it.q}× ${H(it.t.slice(0, 44))}</div></div>`
      : `<div class="epBarBox"><div class="lbl">⚠ no barcode — search: ${H(it.s || it.t.slice(0, 44))}</div></div>`).join("");
  }

  async function markDone(o, row) {
    const b = row.querySelector(".epDone");
    if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "Really clear it?"; setTimeout(() => { b.dataset.arm = ""; b.textContent = "✓ Mark done"; }, 4000); return; }
    try {
      const r = await fetch(`${BASE}/pickups/done?k=${encodeURIComponent(LS("pin"))}&did=${o.did}`, { method: "POST" });
      const j = await r.json();
      if (r.ok && j.ok) { ORDERS = ORDERS.filter((x) => x.did !== o.did); render(); }
      else row.querySelector(".epStat").textContent = "⚠ " + (j.error || "couldn't clear");
    } catch { row.querySelector(".epStat").textContent = "⚠ network problem"; }
  }

  // Refresh the badge count quietly every 90s while the till is open.
  setInterval(() => { if (LS("pin")) fetch(`${BASE}/pickups.json?k=${encodeURIComponent(LS("pin"))}`).then((r) => r.json()).then((j) => {
    if (j && Array.isArray(j.orders)) { ORDERS = j.orders.filter((o) => o.kiosk); root.querySelector("#epToggle").textContent = `📦 Pickups (${ORDERS.length})`; if (root.classList.contains("open")) render(); }
  }).catch(() => {}); }, 90000);
})();
