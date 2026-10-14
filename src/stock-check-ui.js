/* ---------------- 9Pocket: the Stock check screen ----------------
   Markup only; every decision is made in src/stock-check.js. One page,
   /9pocket/stock, four tabs: Go look (in stock, stopped selling), Reorder
   (sold out, was a steady seller), Missing (marked fewer / damaged / not
   found, for the admins) and Dismissed (can't reorder / not restocking).
   Built for a tablet carried around the floor: one card per item, large
   buttons, a "Where to look" box, and an "Are you sure?" dialog before Not
   found and before the permanent dismissals. Shares the 9Pocket shell and
   styles (src/stage-ui.js). */

import { BASE, shell, esc, when } from "./stage-ui.js";
import { STATE_LABEL, PLACES, MISSING_STATES, PERMANENT_STATES, dayIso } from "./stock-check.js";

const R = BASE + "/stock";
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const centsMoney = (c) => money((Number(c) || 0) / 100);
const fmtDay = (day) => { if (!day) return ""; const d = new Date(day * 86400e3); return d.toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" }); };
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const pct = (p) => (p * 100 < 0.1 ? "<0.1" : (p * 100).toFixed(p * 100 < 1 ? 1 : 0)) + "%";
const vt = (r) => r.vtitle && r.vtitle !== "Default Title" ? ` <span class="muted">${esc(r.vtitle)}</span>` : "";
const who = (s) => s ? esc(s.byName || s.by || "") : "";

const CSS = `
.sc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.sc-tabs a{padding:10px 16px;border-radius:99px;border:1px solid #cbd3d9;background:#fff;font-weight:700;color:#374151;text-decoration:none;font-size:15px}.sc-tabs a.on{background:#1d2327;border-color:#1d2327;color:#fff}.sc-tabs a b{margin-left:6px;opacity:.75}
.sc-status{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center;font-size:13px;color:#374151;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:10px 14px;margin:8px 0}.sc-status form{display:inline}
.sc-group{margin:18px 0 6px;display:flex;align-items:center;gap:10px}.sc-group h2{margin:0;font-size:17px}.sc-group .n{font-size:12px;color:#6b7780}
.sc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.sc-card{background:#fff;border:1px solid #dde3e7;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}.sc-card.due{border-color:#f0b429;box-shadow:inset 0 0 0 1px #f0b429}
.sc-head{display:flex;gap:12px}.sc-head img{width:84px;height:84px;object-fit:contain;border-radius:8px;background:#eef2f4;flex:none}.sc-head .noimg{width:84px;height:84px;border-radius:8px;background:#eef2f4;flex:none}.sc-head .t{flex:1;min-width:0}.sc-head .t b{font-size:15px;line-height:1.3;display:block}.sc-head .t small{display:block;color:#6b7780;margin-top:2px}
.sc-chips{display:flex;flex-wrap:wrap;gap:6px}.sc-chip{font-size:12px;padding:4px 9px;border-radius:999px;background:#eef2f4;color:#374151;white-space:nowrap}.sc-chip.big{font-size:14px;font-weight:800;background:#1d2327;color:#fff}.sc-chip.warn{background:#fef3c7;color:#78350f}.sc-chip.bad{background:#fee2e2;color:#7f1d1d}.sc-chip.ok{background:#d1fae5;color:#065f46}.sc-chip.info{background:#dbeafe;color:#1e3a8a}
.sc-look{background:#f8fafb;border:1px dashed #cbd3d9;border-radius:10px;padding:10px 12px;font-size:13px}.sc-look b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#374151;margin-bottom:4px}.sc-look ul{margin:4px 0 0;padding:0 0 0 18px}.sc-look li.fact{color:#1e3a8a;font-weight:600;list-style:"→ "}.sc-look li.place{color:#5f6b76;list-style:"☐ "}
.sc-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sc-acts form{display:contents}.sc-acts button{padding:12px 10px;border-radius:10px;border:1px solid #cbd3d9;background:#fff;font:inherit;font-weight:700;font-size:14px;color:#1d2327;cursor:pointer;min-height:46px}.sc-acts button.ok{background:#0d7a5f;border-color:#0d7a5f;color:#fff}.sc-acts button.no{border-color:#b42318;color:#b42318}.sc-acts button.dim{color:#374151}.sc-acts .wide{grid-column:1/-1}
.sc-inline{display:flex;gap:6px;align-items:center}.sc-inline input{width:72px;padding:10px 8px;border:1px solid #cbd3d9;border-radius:10px;font:inherit;font-size:15px;text-align:center}.sc-inline input[type=date]{width:auto;text-align:left}.sc-inline button{flex:1}
details.sc-note{font-size:13px}details.sc-note summary{cursor:pointer;color:#0d7a5f;font-weight:600;padding:6px 0}details.sc-note textarea{width:100%;min-height:56px;padding:8px;border:1px solid #cbd3d9;border-radius:8px;font:inherit;margin:4px 0}details.sc-note button{padding:8px 12px}
.sc-hist{font-size:12px;color:#6b7780;border-top:1px solid #eef2f4;padding-top:6px}
.sc-find{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.sc-find select,.sc-find input{padding:10px;border:1px solid #cbd3d9;border-radius:10px;font:inherit;font-size:15px;background:#fff}.sc-find input{flex:1 1 200px}.sc-find button{padding:10px 16px}
table.sc-tab td,table.sc-tab th{font-size:14px}table.sc-tab td form{display:inline}table.sc-tab img{width:40px;height:40px;object-fit:contain;border-radius:6px;background:#eef2f4;vertical-align:middle;margin-right:8px}
dialog#scd{border:0;border-radius:16px;padding:0;max-width:440px;width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.35)}dialog#scd::backdrop{background:rgba(0,0,0,.45)}#scd .in{padding:20px}#scd h3{margin:0 0 6px;font-size:18px}#scd p{margin:6px 0;font-size:14px}#scd ul{margin:8px 0;padding:0;list-style:none}#scd li{padding:6px 0;font-size:14px}#scd li label{display:flex;gap:10px;align-items:center}#scd li input{width:22px;height:22px}#scd .btns{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}#scd .btns button{min-height:44px;padding:10px 18px;font-size:15px}
@media (max-width:720px){.sc-cards{grid-template-columns:1fr}.sc-acts{grid-template-columns:1fr 1fr}}`;

const js = () => `(function(){var dlg=document.getElementById('scd');if(!dlg)return;var pending=null;
function openFor(f){var t=f.getAttribute('data-confirm')||'Are you sure?';var title=f.getAttribute('data-title')||'';var places=f.getAttribute('data-places')==='1';
dlg.querySelector('h3').textContent='Are you sure?';dlg.querySelector('.msg').textContent=t;dlg.querySelector('.item').textContent=title;
var ul=dlg.querySelector('ul');ul.innerHTML='';if(places){ul.innerHTML='<li class="muted" style="font-size:13px">Did you check:</li>'+${JSON.stringify(PLACES)}.map(function(p){return '<li><label><input type="checkbox"> <span>'+p+'</span></label></li>';}).join('');}
pending=f;if(typeof dlg.showModal==='function'){dlg.showModal();}else if(confirm(t)){f.setAttribute('data-ok','1');f.submit();}}
document.addEventListener('submit',function(e){var f=e.target;if(f&&f.getAttribute&&f.getAttribute('data-confirm')&&f.getAttribute('data-ok')!=='1'){e.preventDefault();openFor(f);}},true);
dlg.querySelector('.yes').addEventListener('click',function(){if(pending){pending.setAttribute('data-ok','1');dlg.close();pending.submit();}});
dlg.querySelector('.cancel').addEventListener('click',function(){pending=null;dlg.close();});})();`;

const DIALOG = `<dialog id="scd"><div class="in"><h3>Are you sure?</h3><p class="item" style="font-weight:700"></p><p class="msg"></p><ul></ul><div class="btns"><button type="button" class="cancel">Cancel</button><button type="button" class="yes no">Yes, I'm sure</button></div></div></dialog>`;

const hidden = (o, extra) => `<input type="hidden" name="action" value="mark"><input type="hidden" name="tab" value="${esc(o.tab || "")}"><input type="hidden" name="type" value="${esc(o.type || "")}"><input type="hidden" name="q" value="${esc(o.q || "")}">${extra || ""}`;
const act = (o, r, state, label, cls, extra, confirmText, places) => `<form method="post" action="${R}/control"${confirmText ? ` data-confirm="${esc(confirmText)}" data-title="${esc(r.title + (r.vtitle && r.vtitle !== "Default Title" ? " · " + r.vtitle : ""))}"${places ? ' data-places="1"' : ""}` : ""}>${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="${state}"><input type="hidden" name="title" value="${esc(r.title)}">${extra || ""}`)}<button type="submit" class="${cls || ""}">${label}</button></form>`;
const noteForm = (o, r) => `<details class="sc-note"><summary>${r.state && r.state.note ? "Note: " + esc(r.state.note.slice(0, 60)) + (r.state.note.length > 60 ? "…" : "") : "Add a note"}</summary><form method="post" action="${R}/control">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="note"><input type="hidden" name="title" value="${esc(r.title)}">`)}<textarea name="note" placeholder="asked the rep, back in November…">${esc((r.state && r.state.note) || "")}</textarea><button type="submit" class="sm">Save note</button></form></details>`;
const lastMark = (r) => { const s = r.state; if (!s || !s.state) return ""; return `<div class="sc-hist">${r.due ? "<b>Due again.</b> " : ""}Last: ${esc(STATE_LABEL[s.state] || s.state)}${s.count != null && s.state === "fewer" ? " (found " + esc(s.count) + ")" : ""} by ${who(s)}, ${esc(when(s.at))}${s.closed ? " · closed: " + esc(STATE_LABEL[s.closed.state] || s.closed.state) + (s.closed.note ? " (" + esc(s.closed.note) + ")" : "") : ""}</div>`; };
const head = (r) => `<div class="sc-head">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}<div class="t"><b>${esc(r.title)}</b>${vt(r)}<small>${esc(r.type || "")}${r.vendor ? " · " + esc(r.vendor) : ""}${r.sku ? " · SKU " + esc(r.sku) : ""}${r.barcode && r.barcode !== r.sku ? " · UPC " + esc(r.barcode) : ""}</small>${r.handle ? `<small><a href="https://exorgames.com/products/${esc(r.handle)}" target="_blank" rel="noopener">product page ↗</a> · <a href="https://admin.shopify.com/store/most-wanted-ca/products/${esc(r.pid)}" target="_blank" rel="noopener">Shopify admin ↗</a></small>` : ""}</div></div>`;
const catHint = (r) => r.catDrop != null && r.catDrop >= 0.6 ? `<span class="sc-chip info">whole category slowed ${Math.round(r.catDrop * 100)}%</span>` : "";

function whereToLook(r) {
  const q = r.q || {};
  const facts = [];
  if (q.committed > 0) facts.push(`${plural(q.committed, "unit")} in open online order${q.committed === 1 ? "" : "s"}${r.open && r.open.length ? ": " + r.open.map((o) => esc(o.name) + " (" + esc(o.ship) + ")").join(", ") : ""} - look on the pickup / packing shelf`);
  if (q.quality_control > 0) facts.push(`${plural(q.quality_control, "unit")} held (hold on arrival / quality control) - behind the counter`);
  if (q.reserved > 0) facts.push(`${plural(q.reserved, "unit")} reserved`);
  if (q.damaged > 0) facts.push(`${plural(q.damaged, "unit")} marked damaged`);
  if (q.incoming > 0) facts.push(`${plural(q.incoming, "unit")} incoming on a purchase order (not here yet)`);
  if (r.restockDay) facts.push(`stock went up on ${esc(fmtDay(r.restockDay))} - a recent delivery may still be in boxes`);
  return `<div class="sc-look"><b>Where to look</b>${facts.length ? `<ul>${facts.map((f) => `<li class="fact">${f}</li>`).join("")}</ul>` : ""}<ul>${PLACES.map((p) => `<li class="place">${esc(p)}</li>`).join("")}</ul></div>`;
}

function lookCard(r, o) {
  const q = r.q || {};
  const breakdown = Object.keys(q).length ? ` <span class="muted">(available ${q.available ?? r.qty}${q.committed ? ", " + q.committed + " in orders" : ""}${q.quality_control ? ", " + q.quality_control + " held" : ""}${q.damaged ? ", " + q.damaged + " damaged" : ""})</span>` : "";
  const chips = `<div class="sc-chips"><span class="sc-chip big">${plural(r.qty, "unit")} on the system</span><span class="sc-chip bad">last sold ${plural(r.daysSince, "day")} ago (${esc(fmtDay(r.lastDay))})</span><span class="sc-chip">sold ${r.soldWindow} in the ${r.window} days before</span><span class="sc-chip warn">should have sold ~${Math.round(r.expected)} since</span><span class="sc-chip">odds ${pct(r.p0)}</span><span class="sc-chip">${money(r.atRisk)} at risk</span>${catHint(r)}</div>`;
  const acts = o.act ? `<div class="sc-acts">${act(o, r, "found_floor", "Found on the floor", "ok")}${act(o, r, "found_overstock", "Found in overstock → floor", "ok")}${act(o, r, "reserved", "Reserved (hold / pickup / prizes)", "dim")}<form method="post" action="${R}/control" class="sc-inline">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="fewer"><input type="hidden" name="title" value="${esc(r.title)}">`)}<input type="number" name="count" min="0" max="${Math.max(0, r.qty - 1)}" placeholder="found" inputmode="numeric" required><button type="submit" class="dim">Found fewer</button></form>${act(o, r, "damaged", "Damaged / unsellable", "dim")}${act(o, r, "not_found", "Not found", "no", "", "This marks " + r.title + " as missing (" + plural(r.qty, "unit") + ", " + money(r.atRisk) + ") and puts it on the admins' Missing list.", true)}</div>` : `<p class="muted" style="margin:0">Your account can look but not mark items.</p>`;
  return `<div class="sc-card${r.due ? " due" : ""}">${head(r)}${chips}${whereToLook(r)}${acts}${o.act ? noteForm(o, r) : ""}${lastMark(r)}</div>`;
}

function reorderCard(r, o) {
  const chips = `<div class="sc-chips"><span class="sc-chip big">out ${plural(r.daysOut, "day")}</span><span class="sc-chip bad">last sold ${esc(fmtDay(r.lastDay))}</span><span class="sc-chip">sold ${r.sold60} in the 60 days before${r.sold30 ? " (" + r.sold30 + " in the last 30)" : ""}</span><span class="sc-chip warn">~${Math.round(r.missed)} sales missed ≈ ${money(r.missedRevenue)}</span><span class="sc-chip">${centsMoney(r.cents)} each</span>${r.q && r.q.incoming > 0 ? `<span class="sc-chip ok">${r.q.incoming} incoming</span>` : ""}${catHint(r)}</div>`;
  const acts = o.act ? `<div class="sc-acts">${act(o, r, "ordered", "Ordered / on the way", "ok")}<form method="post" action="${R}/control" class="sc-inline">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="snooze"><input type="hidden" name="title" value="${esc(r.title)}">`)}<input type="date" name="until" required><button type="submit" class="dim">Snooze until</button></form>${act(o, r, "cant_reorder", "Can't reorder", "no", "", r.title + " will never be listed for reorder again (an admin can restore it from the Dismissed tab).")}${act(o, r, "not_restocking", "Not restocking (our choice)", "no", "", r.title + " will never be listed for reorder again (an admin can restore it from the Dismissed tab).")}</div>` : `<p class="muted" style="margin:0">Your account can look but not mark items.</p>`;
  return `<div class="sc-card${r.due ? " due" : ""}">${head(r)}${chips}${acts}${o.act ? noteForm(o, r) : ""}${lastMark(r)}</div>`;
}

function grouped(rows, keyOf, render, o) {
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r) || "Other"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups.entries()].map(([k, list]) => `<div class="sc-group"><h2>${esc(k)}</h2><span class="n">${plural(list.length, "item")} · ${money(list.reduce((a, r) => a + (o.tab === "reorder" ? r.missedRevenue : r.atRisk), 0))}</span></div><div class="sc-cards">${list.map((r) => render(r, o)).join("")}</div>`).join("");
}

function statusBar(d, o) {
  const s = (d && d.status) || {};
  const m = (d && d.meta) || null;
  const run = s.running;
  const parts = [];
  if (m) parts.push(`<span>Last scan <b>${esc(when(m.at))}</b> · ${m.counts.scanned} items in stock checked · sales since ${esc(String(m.ordersSince || "").slice(0, 10))}</span>`);
  else parts.push(`<span>No scan has finished yet.</span>`);
  if (run) parts.push(`<span class="sc-chip info">running: ${esc(run.phase)}${run.phase === "orders" ? " · " + run.orders + " orders read" : run.phase === "scan" ? " · type " + (run.typeIdx + 1) + " of " + (run.types || "?") + " · " + run.scanned + " items" : run.phase === "lookup" ? " · " + run.lookupDone + " of " + run.lookupTotal : ""}</span>`);
  else if (s.kick) parts.push(`<span class="sc-chip info">scan queued</span>`);
  if (s.ordersDenied) parts.push(`<span class="sc-chip bad">the worker's Shopify token cannot read orders - nothing can be flagged until it gets read_orders</span>`);
  if (s.lastError) parts.push(`<span class="sc-chip warn" title="${esc(s.lastError)}">last run had errors</span>`);
  if (o.admin) parts.push(`<form method="post" action="${R}/control"><input type="hidden" name="action" value="scan"><input type="hidden" name="tab" value="${esc(o.tab || "")}"><button type="submit" class="sm"${run || s.kick ? " disabled" : ""}>Scan now</button></form>`);
  return `<div class="sc-status">${parts.join("")}</div>`;
}

export function renderStock(d, o) {
  const tab = ["look", "reorder", "missing", "dismissed"].includes(o.tab) ? o.tab : "look";
  const look = (d && d.look) || [], reorderRows = (d && d.reorder) || [], missing = (d && d.missing) || [], dismissed = (d && d.dismissed) || [];
  const types = [...new Set((tab === "reorder" ? reorderRows : look).map((r) => r.type || "Other"))].sort();
  const words = String(o.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r) => [r.title, r.vtitle, r.sku, r.barcode, r.vendor, r.type].join(" ").toLowerCase();
  const filt = (rows) => rows.filter((r) => (!o.type || (r.type || "Other") === o.type) && (!words.length || words.every((w) => hay(r).includes(w))));
  const link = (t) => R + "?tab=" + t;
  const tabs = `<div class="sc-tabs"><a class="${tab === "look" ? "on" : ""}" href="${link("look")}">Go look<b>${look.length}</b></a><a class="${tab === "reorder" ? "on" : ""}" href="${link("reorder")}">Reorder<b>${reorderRows.length}</b></a><a class="${tab === "missing" ? "on" : ""}" href="${link("missing")}">Missing<b>${missing.length}</b></a><a class="${tab === "dismissed" ? "on" : ""}" href="${link("dismissed")}">Dismissed<b>${dismissed.length}</b></a></div>`;
  const find = tab === "look" || tab === "reorder" ? `<form method="get" action="${R}" class="sc-find"><input type="hidden" name="tab" value="${tab}"><select name="type"><option value="">Every product type</option>${types.map((t) => `<option value="${esc(t)}"${o.type === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select><input type="search" name="q" value="${esc(o.q || "")}" placeholder="Name, SKU, UPC, vendor…"><button type="submit" class="save">Filter</button>${o.type || o.q ? `<a class="btn" href="${link(tab)}">Clear</a>` : ""}</form>` : "";
  let body;
  if (tab === "look") {
    const rows = filt(look);
    body = rows.length ? `<p class="muted">In stock on the system, sold steadily, then nothing. Walk the floor one section at a time; the card says where the system thinks units are. Found hides the item for 14 days; Not found tells the admins.</p>` + grouped(rows, (r) => r.type, lookCard, { ...o, tab }) : `<div class="card"><h3>Nothing to look for</h3><p class="muted" style="margin:0">${look.length ? "Nothing matches the filter." : d && d.meta ? "Every in-stock item is selling as it should, or has been checked recently." : "The first scan has not finished yet. It reads the last 60 days of sales first (a few hours after the deploy), then the stock."}</p></div>`;
  } else if (tab === "reorder") {
    const rows = filt(reorderRows);
    body = rows.length ? `<p class="muted">Sold out, and a steady seller before it ran out. Grouped by vendor so each group is one order. Ordered hides an item until stock arrives (or 14 days); Can't reorder and Not restocking are permanent and ask first.</p>` + grouped(rows, (r) => r.vendor || "No vendor", reorderCard, { ...o, tab }) : `<div class="card"><h3>Nothing to reorder</h3><p class="muted" style="margin:0">${reorderRows.length ? "Nothing matches the filter." : "No steady seller is out of stock, or they are all ordered or dismissed."}</p></div>`;
  } else if (tab === "missing") {
    const open = missing.filter((s) => !s.closed), closed = missing.filter((s) => s.closed).slice(0, 50);
    const row = (s) => `<tr><td>${s.image ? `<img src="${esc(s.image)}" alt="">` : ""}<b>${esc(s.title || s.vid)}</b>${vt(s)}<br><span class="muted">${esc(s.type || "")}${s.vendor ? " · " + esc(s.vendor) : ""}</span></td><td><span class="tag ${s.state === "not_found" ? "tag-rejected" : "tag-staged"}">${esc(STATE_LABEL[s.state] || s.state)}</span>${s.state === "fewer" ? `<br><span class="muted">found ${esc(s.count)}</span>` : ""}${s.note ? `<br><span class="muted">${esc(s.note)}</span>` : ""}</td><td>${who(s)}<br><span class="muted">${esc(when(s.at))}</span></td><td class="n">${s.cents ? centsMoney(s.cents) : ""}</td><td class="n">${s.closed ? `<span class="muted">${esc(STATE_LABEL[s.closed.state] || s.closed.state)} · ${who(s.closed)} ${esc(when(s.closed.at))}${s.closed.note ? "<br>" + esc(s.closed.note) : ""}</span>` : o.admin ? `<form method="post" action="${R}/control">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="adjusted">`)}<button type="submit" class="sm">Adjusted in BinderPOS</button></form> <form method="post" action="${R}/control">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="turned_up">`)}<button type="submit" class="sm">Turned up</button></form>` : `<span class="muted">waiting for an admin</span>`}</td></tr>`;
    body = `<p class="muted">Items staff could not find (or found fewer of, or damaged). The screen never changes inventory: adjust in BinderPOS, then close the line here. A line closes itself when the item sells again or Shopify's stock reaches 0.</p>
<div class="list"><table class="sc-tab"><thead><tr><th>Item</th><th>What</th><th>Who</th><th class="n">Price</th><th class="n">Close</th></tr></thead><tbody>${open.length ? open.map(row).join("") : `<tr><td colspan="5" class="muted" style="padding:18px">Nothing missing.</td></tr>`}</tbody></table></div>
${closed.length ? `<h2>Closed recently</h2><div class="list"><table class="sc-tab"><tbody>${closed.map(row).join("")}</tbody></table></div>` : ""}`;
  } else {
    const row = (s) => `<tr><td>${s.image ? `<img src="${esc(s.image)}" alt="">` : ""}<b>${esc(s.title || s.vid)}</b>${vt(s)}<br><span class="muted">${esc(s.type || "")}${s.vendor ? " · " + esc(s.vendor) : ""}</span></td><td><span class="tag tag-off">${esc(STATE_LABEL[s.state] || s.state)}</span>${s.note ? `<br><span class="muted">${esc(s.note)}</span>` : ""}</td><td>${who(s)}<br><span class="muted">${esc(when(s.at))}</span></td><td class="n">${o.admin ? `<form method="post" action="${R}/control" data-confirm="Put ${esc(s.title || "this item")} back on the Reorder list?" data-title="${esc(s.title || "")}">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="restore">`)}<button type="submit" class="sm">Restore</button></form>` : ""}</td></tr>`;
    body = `<p class="muted">Items that will not be listed for reorder again: limited releases we cannot get any more, and items we chose to drop. Admins can restore one.</p>
<div class="list"><table class="sc-tab"><thead><tr><th>Item</th><th>Why</th><th>Who</th><th></th></tr></thead><tbody>${dismissed.length ? dismissed.map(row).join("") : `<tr><td colspan="4" class="muted" style="padding:18px">Nothing dismissed.</td></tr>`}</tbody></table></div>`;
  }
  const page = `<style>${CSS}</style><div class="hz"><h1>Stock check</h1></div>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
${statusBar(d, { ...o, tab })}${tabs}${find}${body}${DIALOG}<script>${js()}</script>`;
  return shell("Stock check", page, o, true);
}

export function renderStockDenied(o) {
  return shell("Stock check", `<h1>Stock check</h1><div class="err">Your account cannot open the stock check. Ask an admin for the "Stock check" permission on 9Pocket › Admin.</div>`, o, true);
}
