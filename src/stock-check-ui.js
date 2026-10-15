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
import { STATE_LABEL, PLACES, MISSING_STATES, PERMANENT_STATES, dayIso, distributorUrl, distributorsText, reorderLink, ADMIN_PRODUCT, STORE_PRODUCT } from "./stock-check.js";

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
.sc-head{display:flex;gap:12px}.sc-head .t b a{color:inherit;text-decoration:none}.sc-head .t b a:hover{text-decoration:underline}.sc-pick{margin-left:auto;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:700;color:#374151;white-space:nowrap;cursor:pointer}.sc-pick input{width:26px;height:26px;margin:0}
#scbar{position:fixed;left:0;right:0;bottom:0;background:#1d2327;color:#fff;padding:10px 16px;display:none;gap:10px;align-items:center;flex-wrap:wrap;z-index:5;box-shadow:0 -6px 20px rgba(0,0,0,.25)}#scbar.on{display:flex}body.sc-picking{padding-bottom:110px}#scbar .n{font-weight:800}#scbar form{display:flex;gap:8px;align-items:center;flex:1 1 320px;flex-wrap:wrap}#scbar input.text{flex:1 1 200px;padding:9px 10px;border-radius:8px;border:1px solid #4b5563;background:#fff;font:inherit}#scbar button{padding:10px 14px;border-radius:8px;border:1px solid #6b7780;background:transparent;color:#fff;font:inherit;font-weight:700;cursor:pointer}#scbar button.go{background:#d52c28;border-color:#d52c28}
.sc-set textarea{width:100%;min-height:90px;padding:8px;border:1px solid #cbd3d9;border-radius:8px;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;margin:6px 0}
.sc-head .t a.saved{font-weight:700}.sc-link{display:flex;gap:6px;margin-top:6px}.sc-link input{flex:1;min-width:0;padding:8px;border:1px solid #cbd3d9;border-radius:8px;font:inherit;font-size:13px}.sc-link button{padding:6px 10px}
.sc-kw{display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 10px;align-items:center}.sc-kw button{padding:7px 12px;border-radius:99px;border:1px solid #cbd3d9;background:#fff;font:inherit;font-size:13px;font-weight:600;color:#374151;cursor:pointer}.sc-kw button.on{background:#d52c28;border-color:#d52c28;color:#fff}.sc-kw .shown{margin-left:auto;font-size:12px;color:#6b7780}
.sc-hide{display:none!important}
#sctop{position:fixed;right:16px;bottom:18px;width:52px;height:52px;border-radius:50%;border:0;background:#1d2327;color:#fff;font:700 12px/1.1 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.3);cursor:pointer;display:none;z-index:6;align-items:center;justify-content:center;flex-direction:column;gap:2px}#sctop.on{display:flex}#sctop span{font-size:16px;line-height:1}body.sc-picking #sctop{bottom:126px}.sc-head img{width:84px;height:84px;object-fit:contain;border-radius:8px;background:#eef2f4;flex:none}.sc-head .noimg{width:84px;height:84px;border-radius:8px;background:#eef2f4;flex:none}.sc-head .t{flex:1;min-width:0}.sc-head .t b{font-size:15px;line-height:1.3;display:block}.sc-head .t small{display:block;color:#6b7780;margin-top:2px}
.sc-chips{display:flex;flex-wrap:wrap;gap:6px}.sc-chip{font-size:12px;padding:4px 9px;border-radius:999px;background:#eef2f4;color:#374151;white-space:nowrap}.sc-chip.big{font-size:14px;font-weight:800;background:#1d2327;color:#fff}.sc-chip.warn{background:#fef3c7;color:#78350f}.sc-chip.bad{background:#fee2e2;color:#7f1d1d}.sc-chip.ok{background:#d1fae5;color:#065f46}.sc-chip.info{background:#dbeafe;color:#1e3a8a}
.sc-look{background:#f8fafb;border:1px dashed #cbd3d9;border-radius:10px;padding:10px 12px;font-size:13px}.sc-look b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#374151;margin-bottom:4px}.sc-look ul{margin:4px 0 0;padding:0 0 0 18px}.sc-look li.fact{color:#1e3a8a;font-weight:600;list-style:"→ "}.sc-look li.place{color:#5f6b76;list-style:"☐ "}
.sc-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sc-acts form{display:contents}.sc-acts form.sc-inline{display:flex}.sc-acts form.wide{display:block}.sc-acts form.wide button{width:100%}.sc-acts button{padding:12px 10px;border-radius:10px;border:1px solid #cbd3d9;background:#fff;font:inherit;font-weight:700;font-size:14px;color:#1d2327;cursor:pointer;min-height:46px}.sc-acts button.ok{background:#0d7a5f;border-color:#0d7a5f;color:#fff}.sc-acts button.no{border-color:#b42318;color:#b42318}.sc-acts button.dim{color:#374151}.sc-acts .wide{grid-column:1/-1}
.sc-inline{display:flex;gap:6px;align-items:center}.sc-inline input{width:72px;padding:10px 8px;border:1px solid #cbd3d9;border-radius:10px;font:inherit;font-size:15px;text-align:center}.sc-inline input[type=date]{width:auto;text-align:left}.sc-inline button{flex:1}
details.sc-note{font-size:13px}details.sc-note summary{cursor:pointer;color:#0d7a5f;font-weight:600;padding:6px 0}details.sc-note textarea{width:100%;min-height:56px;padding:8px;border:1px solid #cbd3d9;border-radius:8px;font:inherit;margin:4px 0}details.sc-note button{padding:8px 12px}
.sc-hist{font-size:12px;color:#6b7780;border-top:1px solid #eef2f4;padding-top:6px}
.sc-find{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.sc-find select,.sc-find input{padding:10px;border:1px solid #cbd3d9;border-radius:10px;font:inherit;font-size:15px;background:#fff}.sc-find input{flex:1 1 200px}.sc-find button{padding:10px 16px}
table.sc-tab td,table.sc-tab th{font-size:14px}table.sc-tab td form{display:inline}table.sc-tab img{width:40px;height:40px;object-fit:contain;border-radius:6px;background:#eef2f4;vertical-align:middle;margin-right:8px}
dialog#scd{border:0;border-radius:16px;padding:0;max-width:440px;width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.35)}dialog#scd::backdrop{background:rgba(0,0,0,.45)}#scd .in{padding:20px}#scd h3{margin:0 0 6px;font-size:18px}#scd p{margin:6px 0;font-size:14px}#scd ul{margin:8px 0;padding:0;list-style:none}#scd li{padding:6px 0;font-size:14px}#scd li label{display:flex;gap:10px;align-items:center}#scd li input{width:22px;height:22px}#scd .btns{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}#scd .btns button{min-height:44px;padding:10px 18px;font-size:15px}
.sc-card.busy{opacity:.6;pointer-events:none}.sc-card.done{transition:opacity .35s ease,max-height .4s ease,margin .4s ease,padding .4s ease;overflow:hidden}.sc-card.done.gone{opacity:0;max-height:0;margin:0;padding:0;border-width:0}.sc-done{background:#d1fae5;color:#065f46;border-radius:10px;padding:12px 14px;font-weight:700;font-size:15px}.sc-fail{background:#fee2e2;color:#7f1d1d;border-radius:10px;padding:10px 12px;font-size:13px}
#sctoast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(20px);background:#1d2327;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600;opacity:0;transition:opacity .25s,transform .25s;z-index:7;pointer-events:none;max-width:92vw}#sctoast.on{opacity:1;transform:translateX(-50%) translateY(0)}body.sc-picking #sctoast{bottom:150px}
@media (max-width:720px){.sc-cards{grid-template-columns:1fr}.sc-acts{grid-template-columns:1fr 1fr}}`;

const js = () => `(function(){var dlg=document.getElementById('scd');if(!dlg)return;var pending=null;
function openFor(f){var t=f.getAttribute('data-confirm')||'Are you sure?';var title=f.getAttribute('data-title')||'';var places=f.getAttribute('data-places')==='1';
dlg.querySelector('h3').textContent='Are you sure?';dlg.querySelector('.msg').textContent=t;dlg.querySelector('.item').textContent=title;
var ul=dlg.querySelector('ul');ul.innerHTML='';if(places){ul.innerHTML='<li class="muted" style="font-size:13px">Did you check:</li>'+${JSON.stringify(PLACES)}.map(function(p){return '<li><label><input type="checkbox"> <span>'+p+'</span></label></li>';}).join('');}
pending=f;if(typeof dlg.showModal==='function'){dlg.showModal();}else if(confirm(t)){f.setAttribute('data-ok','1');go(f);}}
var toastT=null;function toast(msg){var t=document.getElementById('sctoast');if(!t)return;t.textContent=msg;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('on');},2600);}
function bump(n){var b=document.querySelector('.sc-tabs a.on b');if(b){b.textContent=Math.max(0,(parseInt(b.textContent,10)||0)+n);}}
function retire(card,msg){card.classList.remove('busy');card.classList.add('done');card.innerHTML='<div class="sc-done">✓ '+msg.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</div>';bump(-1);setTimeout(function(){card.classList.add('gone');setTimeout(function(){var g=card.parentElement;card.remove();if(g&&g.classList.contains('sc-cards')&&!g.querySelector('.sc-card')){var h=g.previousElementSibling;if(h&&h.classList.contains('sc-group'))h.remove();g.remove();}},450);},1400);}
// Actions on a card are sent in place (owner, 2026-10-15: a reload lost the
// place in the list); the page itself only reloads for a scan, the
// settings and the email.
function go(f){var card=f.closest('.sc-card'),row=f.closest('tr');var state=(f.querySelector('input[name=state]')||{}).value||'';var act=(f.querySelector('input[name=action]')||{}).value||'';
if(act!=='mark'&&act!=='link'){try{sessionStorage.setItem('scY',String(window.scrollY||0));}catch(e){}f.submit();return;}
var fd=new FormData(f);fd.set('json','1');if(card)card.classList.add('busy');
fetch(f.action,{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){
if(!j||!j.ok){if(card)card.classList.remove('busy');var m=(j&&j.error)||'That did not save.';var box=f.closest('.sc-card')||f.closest('td')||f.parentElement;var old=box&&box.querySelector('.sc-fail');if(old)old.remove();var d=document.createElement('div');d.className='sc-fail';d.textContent=m;if(box)box.appendChild(d);toast(m);return;}
toast(j.message||'Saved.');
if(act==='link'){if(card)card.classList.remove('busy');var u=(fd.get('url')||'').toString();var a=f.closest('.t')&&f.closest('.t').querySelector('small a[target=_blank]:not([href*="exorgames.com"])');var al=f.closest('.t')&&f.closest('.t').querySelector('a.setlink');if(a&&u){a.href=u;a.className='saved';a.textContent=(a.textContent||'').replace(/ reorder page/,' item page');}if(al)al.textContent=u?'change link':'set link';f.hidden=true;return;}
if(state==='note'){if(card)card.classList.remove('busy');var det=f.closest('details');var n=(fd.get('note')||'').toString();if(det){var su=det.querySelector('summary');if(su)su.textContent=n?'Note: '+(n.length>60?n.slice(0,60)+'…':n):'Add a note';det.open=false;}return;}
if(card){retire(card,j.message||'Done.');return;}
if(row){row.style.transition='opacity .3s';row.style.opacity='0';setTimeout(function(){row.remove();},320);bump(-1);return;}
}).catch(function(){if(card)card.classList.remove('busy');try{sessionStorage.setItem('scY',String(window.scrollY||0));}catch(e){}f.submit();});}
document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.getAttribute)return;
if(f.getAttribute('data-confirm')&&f.getAttribute('data-ok')!=='1'){e.preventDefault();openFor(f);return;}
if(f.closest('.sc-card')||f.closest('table.sc-tab')){e.preventDefault();go(f);return;}
try{sessionStorage.setItem('scY',String(window.scrollY||0));}catch(x){}},true);
try{var y=parseInt(sessionStorage.getItem('scY')||'',10);sessionStorage.removeItem('scY');if(y>0)window.scrollTo(0,y);}catch(e){}
dlg.querySelector('.yes').addEventListener('click',function(){if(pending){pending.setAttribute('data-ok','1');dlg.close();var p=pending;pending=null;go(p);}});
dlg.querySelector('.cancel').addEventListener('click',function(){pending=null;dlg.close();});
var bar=document.getElementById('scbar');if(bar){var picks=function(){return [].slice.call(document.querySelectorAll('input.pick:checked')).map(function(i){return i.value;});};
var upd=function(){var n=picks().length;bar.classList.toggle('on',n>0);document.body.classList.toggle('sc-picking',n>0);bar.querySelector('.n').textContent=n+' selected';};
document.addEventListener('change',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('pick'))upd();});
bar.querySelector('form').addEventListener('submit',function(){bar.querySelector('input[name=vids]').value=picks().join(',');});
bar.querySelector('.all').addEventListener('click',function(){document.querySelectorAll('input.pick').forEach(function(i){i.checked=true;});upd();});
bar.querySelector('.none').addEventListener('click',function(){document.querySelectorAll('input.pick').forEach(function(i){i.checked=false;});upd();});}
var q=document.getElementById('scq');if(q){var items=function(){return [].slice.call(document.querySelectorAll('[data-hay]'));};
var live=function(){var words=q.value.toLowerCase().split(/\s+/).filter(Boolean);var n=0,total=0;items().forEach(function(el){var hay=el.getAttribute('data-hay')||'';var ok=words.every(function(w){return hay.indexOf(w)>=0;});el.classList.toggle('sc-hide',!ok);total++;if(ok)n++;});
document.querySelectorAll('.sc-cards').forEach(function(g){var any=g.querySelector('.sc-card:not(.sc-hide)');g.classList.toggle('sc-hide',!any);var h=g.previousElementSibling;if(h&&h.classList.contains('sc-group'))h.classList.toggle('sc-hide',!any);});
var s=document.querySelector('.sc-kw .shown');if(s)s.textContent=words.length?n+' of '+total+' shown':'';
document.querySelectorAll('.sc-kw button.kw').forEach(function(b){b.classList.toggle('on',words.indexOf(b.getAttribute('data-kw'))>=0);});};
q.addEventListener('input',live);document.querySelectorAll('.sc-kw button.kw').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-kw');var words=q.value.toLowerCase().split(/\s+/).filter(Boolean);var i=words.indexOf(k);if(i>=0)words.splice(i,1);else words.push(k);q.value=words.join(' ');live();});});live();}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a.setlink');if(!a)return;e.preventDefault();var f=a.closest('.t')&&a.closest('.t').querySelector('form.sc-link');if(f){f.hidden=!f.hidden;if(!f.hidden)f.querySelector('input[name=url]').focus();}});
var top=document.getElementById('sctop');if(top){var tick=function(){top.classList.toggle('on',(window.scrollY||document.documentElement.scrollTop)>400);};window.addEventListener('scroll',tick,{passive:true});tick();top.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});}})();`;

const DIALOG = `<dialog id="scd"><div class="in"><h3>Are you sure?</h3><p class="item" style="font-weight:700"></p><p class="msg"></p><ul></ul><div class="btns"><button type="button" class="cancel">Cancel</button><button type="button" class="yes no">Yes, I'm sure</button></div></div></dialog>`;

const hidden = (o, extra) => `<input type="hidden" name="action" value="mark"><input type="hidden" name="tab" value="${esc(o.tab || "")}"><input type="hidden" name="type" value="${esc(o.type || "")}"><input type="hidden" name="q" value="${esc(o.q || "")}">${extra || ""}`;
const act = (o, r, state, label, cls, extra, confirmText, places) => `<form method="post" action="${R}/control"${/\bwide\b/.test(cls || "") ? ' class="wide"' : ""}${confirmText ? ` data-confirm="${esc(confirmText)}" data-title="${esc(r.title + (r.vtitle && r.vtitle !== "Default Title" ? " · " + r.vtitle : ""))}"${places ? ' data-places="1"' : ""}` : ""}>${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="${state}"><input type="hidden" name="title" value="${esc(r.title)}">${extra || ""}`)}<button type="submit" class="${cls || ""}">${label}</button></form>`;
const noteForm = (o, r) => `<details class="sc-note"><summary>${r.state && r.state.note ? "Note: " + esc(r.state.note.slice(0, 60)) + (r.state.note.length > 60 ? "…" : "") : "Add a note"}</summary><form method="post" action="${R}/control">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="note"><input type="hidden" name="title" value="${esc(r.title)}">`)}<textarea name="note" placeholder="asked the rep, back in November…">${esc((r.state && r.state.note) || "")}</textarea><button type="submit" class="sm">Save note</button></form></details>`;
const lastMark = (r) => { const s = r.state; if (!s || !s.state) return ""; return `<div class="sc-hist">${r.due ? "<b>Due again.</b> " : ""}Last: ${esc(STATE_LABEL[s.state] || s.state)}${s.count != null && s.state === "fewer" ? " (found " + esc(s.count) + ")" : ""} by ${who(s)}, ${esc(when(s.at))}${s.closed ? " · closed: " + esc(STATE_LABEL[s.closed.state] || s.closed.state) + (s.closed.note ? " (" + esc(s.closed.note) + ")" : "") : ""}</div>`; };
const hayOf = (r) => [r.title, r.vtitle, r.sku, r.barcode, r.vendor, r.type].map((x) => String(x || "")).join(" ").toLowerCase();
const KEYWORDS = ["booster", "bundle", "blind", "collector", "deck", "box", "sleeves", "paint", "kit", "funko", "plush", "dice"];
const head = (r, o) => `<div class="sc-head">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}<div class="t"><b>${r.pid ? `<a href="${esc(ADMIN_PRODUCT + r.pid)}" target="_blank" rel="noopener" title="Open in Shopify">${esc(r.title)}</a>` : esc(r.title)}</b>${vt(r)}<small>${esc(r.type || "")}${r.vendor ? " · " + esc(r.vendor) : ""}${r.sku ? " · SKU " + esc(r.sku) : ""}${r.barcode && r.barcode !== r.sku ? " · UPC " + esc(r.barcode) : ""}</small><small>${r.handle ? `<a href="${esc(STORE_PRODUCT + r.handle)}" target="_blank" rel="noopener">product page ↗</a> · ` : ""}${(() => { const l = reorderLink(r, o); return `<a href="${esc(l.url)}" target="_blank" rel="noopener"${l.saved ? ' class="saved" title="saved link"' : ""}>${esc(l.label)} ↗</a>`; })()}${o && o.act ? ` · <a href="#" class="setlink" data-pid="${esc(r.pid)}">${o.links && o.links[r.pid] ? "change link" : "set link"}</a>` : ""}</small>${o && o.act ? `<form method="post" action="${R}/control" class="sc-link" hidden>${hidden(o, `<input type="hidden" name="pid" value="${esc(r.pid)}"><input type="hidden" name="title" value="${esc(r.title)}">`)}<input type="hidden" name="action" value="link"><input type="url" name="url" value="${esc(o.links && o.links[r.pid] ? o.links[r.pid].url : "")}" placeholder="https://ca.universaldist.com/item/detail/…" inputmode="url"><button type="submit" class="sm">Save</button></form>` : ""}</div>${o && o.act && o.emailOn ? `<label class="sc-pick"><input type="checkbox" class="pick" value="${esc(r.vid)}"><span>Email</span></label>` : ""}</div>`;
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
  const acts = o.act ? `<div class="sc-acts">${act(o, r, "found_floor", "Found on the floor", "ok")}${act(o, r, "found_overstock", "Found in overstock → floor", "ok")}${act(o, r, "reserved", "Reserved (hold / pickup / prizes)", "dim")}<form method="post" action="${R}/control" class="sc-inline">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="fewer"><input type="hidden" name="title" value="${esc(r.title)}">`)}<input type="number" name="count" min="0" max="${Math.max(0, r.qty - 1)}" placeholder="found" inputmode="numeric" required><button type="submit" class="dim">Found fewer</button></form>${act(o, r, "damaged", "Damaged / unsellable", "dim")}${act(o, r, "not_found", "Not found", "no wide", "", "This marks " + r.title + " as missing (" + plural(r.qty, "unit") + ", " + money(r.atRisk) + ") and puts it on the admins' Missing list.", true)}</div>` : `<p class="muted" style="margin:0">Your account can look but not mark items.</p>`;
  return `<div class="sc-card${r.due ? " due" : ""}" data-hay="${esc(hayOf(r))}">${head(r, o)}${chips}${whereToLook(r)}${acts}${o.act ? noteForm(o, r) : ""}${lastMark(r)}</div>`;
}

function reorderCard(r, o) {
  const chips = `<div class="sc-chips"><span class="sc-chip big">out ${plural(r.daysOut, "day")}</span>${o.tab === "hot" ? `<span class="sc-chip ok">sells ~${r.perWeek} a week</span>` : ""}<span class="sc-chip bad">last sold ${esc(fmtDay(r.lastDay))}</span><span class="sc-chip">sold ${r.sold60} in the 60 days before${r.sold30 ? " (" + r.sold30 + " in the last 30)" : ""}</span><span class="sc-chip warn">~${Math.round(r.missed)} sales missed ≈ ${money(r.missedRevenue)}</span><span class="sc-chip">${centsMoney(r.cents)} each</span>${r.q && r.q.incoming > 0 ? `<span class="sc-chip ok">${r.q.incoming} incoming</span>` : ""}${catHint(r)}</div>`;
  const acts = o.act ? `<div class="sc-acts">${act(o, r, "ordered", "Ordered / on the way", "ok")}<form method="post" action="${R}/control" class="sc-inline">${hidden(o, `<input type="hidden" name="vid" value="${esc(r.vid)}"><input type="hidden" name="state" value="snooze"><input type="hidden" name="title" value="${esc(r.title)}">`)}<input type="date" name="until" required><button type="submit" class="dim">Snooze until</button></form>${act(o, r, "cant_reorder", "Can't reorder", "no", "", r.title + " will never be listed for reorder again (an admin can restore it from the Dismissed tab).")}${act(o, r, "not_restocking", "Not restocking (our choice)", "no", "", r.title + " will never be listed for reorder again (an admin can restore it from the Dismissed tab).")}</div>` : `<p class="muted" style="margin:0">Your account can look but not mark items.</p>`;
  return `<div class="sc-card${r.due ? " due" : ""}" data-hay="${esc(hayOf(r))}">${head(r, o)}${chips}${acts}${o.act ? noteForm(o, r) : ""}${lastMark(r)}</div>`;
}

function grouped(rows, keyOf, render, o) {
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r) || "Other"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups.entries()].map(([k, list]) => `<div class="sc-group"><h2>${esc(k)}</h2><span class="n">${plural(list.length, "item")} · ${money(list.reduce((a, r) => a + (o.tab === "reorder" || o.tab === "hot" ? r.missedRevenue : r.atRisk), 0))}</span></div><div class="sc-cards">${list.map((r) => render(r, o)).join("")}</div>`).join("");
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
  const tab = ["look", "hot", "reorder", "missing", "dismissed"].includes(o.tab) ? o.tab : "look";
  o = { ...o, distributors: (d && d.status && d.status.distributors) || o.distributors || {}, ownDistributors: (d && d.status && d.status.ownDistributors) || {}, links: (d && d.links) || o.links || {} };
  const look = (d && d.look) || [], reorderRows = (d && d.reorder) || [], hot = (d && d.hot) || [], missing = (d && d.missing) || [], dismissed = (d && d.dismissed) || [];
  const types = [...new Set((tab === "reorder" ? reorderRows : tab === "hot" ? hot : look).map((r) => r.type || "Other"))].sort();
  const words = String(o.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r) => [r.title, r.vtitle, r.sku, r.barcode, r.vendor, r.type].join(" ").toLowerCase();
  const filt = (rows) => rows.filter((r) => (!o.type || (r.type || "Other") === o.type) && (!words.length || words.every((w) => hay(r).includes(w))));
  const link = (t) => R + "?tab=" + t;
  const tabs = `<div class="sc-tabs"><a class="${tab === "look" ? "on" : ""}" href="${link("look")}">Go look<b>${look.length}</b></a><a class="${tab === "hot" ? "on" : ""}" href="${link("hot")}">Order now<b>${hot.length}</b></a><a class="${tab === "reorder" ? "on" : ""}" href="${link("reorder")}">Reorder<b>${reorderRows.length}</b></a><a class="${tab === "missing" ? "on" : ""}" href="${link("missing")}">Missing<b>${missing.length}</b></a><a class="${tab === "dismissed" ? "on" : ""}" href="${link("dismissed")}">Dismissed<b>${dismissed.length}</b></a></div>`;
  const cardTabs = tab === "look" || tab === "reorder" || tab === "hot";
  const find = `<form method="get" action="${R}" class="sc-find"><input type="hidden" name="tab" value="${tab}">${cardTabs ? `<select name="type"><option value="">Every product type</option>${types.map((t) => `<option value="${esc(t)}"${o.type === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}<input type="search" id="scq" name="q" value="${esc(o.q || "")}" placeholder="Type to filter: booster, blind, a SKU, a vendor…" autocomplete="off"><button type="submit" class="save">Filter</button>${o.type || o.q ? `<a class="btn" href="${link(tab)}">Clear</a>` : ""}</form>
<div class="sc-kw">${KEYWORDS.map((k) => `<button type="button" class="kw" data-kw="${k}">${k}</button>`).join("")}<span class="shown"></span></div>`;
  let body;
  if (tab === "look") {
    const rows = filt(look);
    body = rows.length ? `<p class="muted">In stock on the system, sold steadily, then nothing. Walk the floor one section at a time; the card says where the system thinks units are. Found hides the item for 14 days; Not found tells the admins.</p>` + grouped(rows, (r) => r.type, lookCard, { ...o, tab }) : `<div class="card"><h3>Nothing to look for</h3><p class="muted" style="margin:0">${look.length ? "Nothing matches the filter." : d && d.meta ? "Every in-stock item is selling as it should, or has been checked recently." : "The first scan has not finished yet. It reads the last 60 days of sales first (a few hours after the deploy), then the stock."}</p></div>`;
  } else if (tab === "hot") {
    const rows = filt(hot);
    const hotMin = (d && d.status && d.status.hotMin) || 6;
    const cfgForm = o.admin ? `<form method="post" action="${R}/control" class="sc-status" style="margin:0 0 10px"><input type="hidden" name="action" value="cfg"><input type="hidden" name="tab" value="hot"><label>Order now = sold at least <input type="number" name="hotMin" min="1" max="1000" value="${esc(hotMin)}" style="width:64px;padding:6px;border:1px solid #cbd3d9;border-radius:8px;font:inherit;text-align:center"> in the 30 days before running out</label><button type="submit" class="sm">Save</button></form>` : `<p class="muted" style="margin:0 0 10px">Order now = sold at least ${esc(hotMin)} in the 30 days before running out (an admin can change that).</p>`;
    body = cfgForm + (rows.length ? `<p class="muted">Sold out, and among your fastest sellers: these are the ones to order today. Fastest first, grouped by vendor. The same buttons as Reorder; Ordered hides an item until stock arrives (or 14 days).</p>` + grouped(rows, (r) => r.vendor || "No vendor", reorderCard, { ...o, tab }) : `<div class="card"><h3>Nothing to order right away</h3><p class="muted" style="margin:0">${hot.length ? "Nothing matches the filter." : "No fast seller is out of stock, or they are all ordered or dismissed."}</p></div>`);
  } else if (tab === "reorder") {
    const rows = filt(reorderRows);
    body = rows.length ? `<p class="muted">Sold out, and a steady seller before it ran out. Grouped by vendor so each group is one order. Ordered hides an item until stock arrives (or 14 days); Can't reorder and Not restocking are permanent and ask first.</p>` + grouped(rows, (r) => r.vendor || "No vendor", reorderCard, { ...o, tab }) : `<div class="card"><h3>Nothing to reorder</h3><p class="muted" style="margin:0">${reorderRows.length ? "Nothing matches the filter." : "No steady seller is out of stock, or they are all ordered or dismissed."}</p></div>`;
  } else if (tab === "missing") {
    const open = missing.filter((s) => !s.closed), closed = missing.filter((s) => s.closed).slice(0, 50);
    const row = (s) => `<tr data-hay="${esc(hayOf(s))}">${o.act && o.emailOn ? `<td class="t" style="width:40px">${s.closed ? "" : `<input type="checkbox" class="pick" value="${esc(s.vid)}" title="Email to the admins" style="width:24px;height:24px">`}</td>` : ""}<td>${s.image ? `<img src="${esc(s.image)}" alt="">` : ""}<b>${s.pid ? `<a href="${esc(ADMIN_PRODUCT + s.pid)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(s.title || s.vid)}</a>` : esc(s.title || s.vid)}</b>${vt(s)}<br><span class="muted">${esc(s.type || "")}${s.vendor ? " · " + esc(s.vendor) : ""}</span> · ${(() => { const l = reorderLink(s, o); return `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`; })()}</td><td><span class="tag ${s.state === "not_found" ? "tag-rejected" : "tag-staged"}">${esc(STATE_LABEL[s.state] || s.state)}</span>${s.state === "fewer" ? `<br><span class="muted">found ${esc(s.count)}</span>` : ""}${s.note ? `<br><span class="muted">${esc(s.note)}</span>` : ""}</td><td>${who(s)}<br><span class="muted">${esc(when(s.at))}</span></td><td class="n">${s.cents ? centsMoney(s.cents) : ""}</td><td class="n">${s.closed ? `<span class="muted">${esc(STATE_LABEL[s.closed.state] || s.closed.state)} · ${who(s.closed)} ${esc(when(s.closed.at))}${s.closed.note ? "<br>" + esc(s.closed.note) : ""}</span>` : o.admin ? `<form method="post" action="${R}/control">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="adjusted">`)}<button type="submit" class="sm">Adjusted in BinderPOS</button></form> <form method="post" action="${R}/control">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="turned_up">`)}<button type="submit" class="sm">Turned up</button></form>` : `<span class="muted">waiting for an admin</span>`}</td></tr>`;
    body = `<p class="muted">Items staff could not find (or found fewer of, or damaged). The screen never changes inventory: adjust in BinderPOS, then close the line here. A line closes itself when the item sells again or Shopify's stock reaches 0.</p>
<div class="list"><table class="sc-tab"><thead><tr>${o.act && o.emailOn ? "<th></th>" : ""}<th>Item</th><th>What</th><th>Who</th><th class="n">Price</th><th class="n">Close</th></tr></thead><tbody>${open.length ? open.map(row).join("") : `<tr><td colspan="6" class="muted" style="padding:18px">Nothing missing.</td></tr>`}</tbody></table></div>
${closed.length ? `<h2>Closed recently</h2><div class="list"><table class="sc-tab"><tbody>${closed.map(row).join("")}</tbody></table></div>` : ""}`;
  } else {
    const row = (s) => `<tr data-hay="${esc(hayOf(s))}"><td>${s.image ? `<img src="${esc(s.image)}" alt="">` : ""}<b>${esc(s.title || s.vid)}</b>${vt(s)}<br><span class="muted">${esc(s.type || "")}${s.vendor ? " · " + esc(s.vendor) : ""}</span></td><td><span class="tag tag-off">${esc(STATE_LABEL[s.state] || s.state)}</span>${s.note ? `<br><span class="muted">${esc(s.note)}</span>` : ""}</td><td>${who(s)}<br><span class="muted">${esc(when(s.at))}</span></td><td class="n">${o.admin ? `<form method="post" action="${R}/control" data-confirm="Put ${esc(s.title || "this item")} back on the Reorder list?" data-title="${esc(s.title || "")}">${hidden({ ...o, tab }, `<input type="hidden" name="vid" value="${esc(s.vid)}"><input type="hidden" name="state" value="restore">`)}<button type="submit" class="sm">Restore</button></form>` : ""}</td></tr>`;
    body = `<p class="muted">Items that will not be listed for reorder again: limited releases we cannot get any more, and items we chose to drop. Admins can restore one.</p>
<div class="list"><table class="sc-tab"><thead><tr><th>Item</th><th>Why</th><th>Who</th><th></th></tr></thead><tbody>${dismissed.length ? dismissed.map(row).join("") : `<tr><td colspan="4" class="muted" style="padding:18px">Nothing dismissed.</td></tr>`}</tbody></table></div>`;
  }
  const settings = o.admin ? `<details class="sc-note sc-set"><summary>Distributor websites (admins)</summary><form method="post" action="${R}/control"><input type="hidden" name="action" value="cfg"><input type="hidden" name="tab" value="${tab}"><p class="muted" style="margin:6px 0">One vendor per line, exactly as Shopify names it, then the website's search address with <code>{q}</code> where the product title goes. <code>{upc}</code> puts the barcode there instead (Universal's search finds items by UPC). A vendor without a line gets a web search. Built in: ${esc(distributorsText(Object.fromEntries(Object.entries(o.distributors || {}).filter(([k]) => !(o.ownDistributors || {})[k]))) || "none")}</p><textarea name="distributors" placeholder="Universal Distribution = https://example.com/search?q={q}">${esc(distributorsText(o.ownDistributors || {}))}</textarea><button type="submit" class="sm">Save</button></form></details>` : "";
  const bar = o.act && o.emailOn ? `<div id="scbar"><span class="n">0 selected</span><button type="button" class="all">Select all</button><button type="button" class="none">Clear</button><form method="post" action="${R}/control"><input type="hidden" name="action" value="email"><input type="hidden" name="tab" value="${tab}"><input type="hidden" name="type" value="${esc(o.type || "")}"><input type="hidden" name="q" value="${esc(o.q || "")}"><input type="hidden" name="vids" value=""><input class="text" type="text" name="message" maxlength="1000" placeholder="Message to the admins (optional)"><button type="submit" class="go">Email to admins</button></form></div>` : "";
  const page = `<style>${CSS}</style><div class="hz"><h1>Stock check</h1></div>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
${statusBar(d, { ...o, tab })}${settings}${tabs}${find}${body}${DIALOG}${bar}<button type="button" id="sctop" title="Back to the top"><span>↑</span>Top</button><div id="sctoast" role="status"></div><script>${js()}</script>`;
  return shell("Stock check", page, o, true);
}

export function renderStockDenied(o) {
  return shell("Stock check", `<h1>Stock check</h1><div class="err">Your account cannot open the stock check. Ask an admin for the "Stock check" permission on 9Pocket › Admin.</div>`, o, true);
}
