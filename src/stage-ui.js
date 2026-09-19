/* ---------------- 9Pocket by Exor: the staff pages ----------------
   Owner, 2026-09-19: "lists out the buylists similar to binderpos pending
   list where you have to go into the buylist, save changes, edit prices,
   etc.. it should list all the buylists and then go into a new page where
   it's like a worksheet. Then can go back to main menu. Please call it
   '9Pocket by Exor'".

   Two pages, both server-rendered by src/stage.js behind the staff PIN:
     /9pocket          the list - every buylist, newest first, tabs by status
     /9pocket/b/<id>   the worksheet - one buylist: customer, cards with
                       thumbnails, quantity and price inputs, save / approve /
                       reject, the customer email, the history
   Markup only here; every decision is made in stage.js. */

export const BASE = "/9pocket";
export const BRAND = "9Pocket by Exor";
const ADMIN_CUSTOMER = "https://admin.shopify.com/store/most-wanted-ca/customers/";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const qty = (c) => Math.max(0, parseInt(c && c.quantity, 10) || 0);
const STATUS_LABEL = { staged: "Waiting", approved: "Approved", rejected: "Rejected" };

// A card's picture: the imageUrl BinderPOS's search put on the card object
// (their TCGplayer scan), kept only when it is an https URL. Anything else
// draws no thumbnail rather than a broken or unsafe one.
export function safeImage(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 400 ? s : "";
}

const CSS = `*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2327;background:#f4f6f7}a{color:#0d7a5f}
.bar{background:#d52c28;color:#fff;padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}.bar .brand{font-weight:800;font-size:18px;letter-spacing:.01em;color:#fff;text-decoration:none}.bar .brand small{font-weight:500;opacity:.85;margin-left:6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.bar .back{color:#fff;text-decoration:none;font-weight:600;opacity:.95}.bar .back:hover{text-decoration:underline}.bar .sp{flex:1}.bar .links a{color:#fff;opacity:.9;margin-left:14px;font-size:13px}
.wrap{max-width:1140px;margin:0 auto;padding:18px 20px 40px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;color:#374151}.muted{color:#6b7780}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-weight:600;font-size:12px;vertical-align:middle}.tag-staged{background:#fde68a;color:#5b4300}.tag-approved{background:#d1fae5;color:#065f46}.tag-rejected{background:#fee2e2;color:#7f1d1d}.tag-off{background:#e5e7eb;color:#374151}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px}.tabs button{padding:7px 12px;border-radius:99px;border:1px solid #cbd3d9;background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#374151}.tabs button.on{background:#1d2327;border-color:#1d2327;color:#fff}.tabs b{margin-left:6px;opacity:.75}
.card{margin:12px 0;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:16px}.card h3{margin:0 0 6px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0;background:#fff}th{text-align:left;padding:8px 10px;background:#eef2f4;font-weight:600;color:#374151;white-space:nowrap}td{padding:7px 10px;border-top:1px solid #eef2f4;vertical-align:middle}td.n,th.n{text-align:right;white-space:nowrap}td.t{width:52px;padding:4px 6px}tr.row{cursor:pointer}tr.row:hover td{background:#f8fafb}tr.row td a{color:inherit;text-decoration:none}tr.row .ref{font-weight:700;color:#d52c28}
.list{border:1px solid #dde3e7;border-radius:12px;overflow:hidden;background:#fff}
.thumb{display:block;width:44px;height:auto;border-radius:4px;background:#eef2f4;transition:transform .12s ease}a.zoom{display:block;position:relative}a.zoom:hover .thumb,a.zoom:focus .thumb{transform:scale(4.4);transform-origin:left center;position:relative;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.4);border-radius:8px}
input.q,input.p{padding:5px 7px;border:1px solid #cbd3d9;border-radius:6px;text-align:right;font:inherit}input.q{width:62px}input.p{width:84px}input.p.staff,input.q.changed,input.p.changed{border-color:#d52c28;background:#fff5f5}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 18px;margin:8px 0}.kv div{font-size:13px}.kv div span{display:block;color:#6b7780;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.kv div b{font-size:15px}
.act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}button,.btn{padding:8px 14px;border-radius:8px;border:1px solid #cbd3d9;background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#1d2327;text-decoration:none;display:inline-block}button.ok{background:#0d7a5f;border-color:#0d7a5f;color:#fff}button.no{background:#fff;border-color:#b42318;color:#b42318}button.save{background:#1d2327;border-color:#1d2327;color:#fff}button:disabled{opacity:.5;cursor:default}
input.text{flex:1 1 240px;padding:8px 10px;border:1px solid #cbd3d9;border-radius:8px;font:inherit}textarea.text{width:100%;min-height:64px;padding:8px 10px;border:1px solid #cbd3d9;border-radius:8px;font:inherit}
.err{background:#fee2e2;color:#7f1d1d;padding:8px 12px;border-radius:8px;margin:10px 0}.okmsg{background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;margin:10px 0}.note{font-size:13px;color:#5b4300;background:#fff8dc;border-radius:8px;padding:8px 12px;margin:6px 0}
.tot{display:flex;gap:22px;justify-content:flex-end;padding:10px 10px 2px;font-size:14px}.tot b{font-size:16px}.dirty{display:none;color:#b42318;font-weight:600}.is-dirty .dirty{display:inline}
.ev{list-style:none;padding:0;margin:0}.ev li{padding:4px 0;border-top:1px solid #eef2f4;font-size:13px}.ev li:first-child{border-top:0}
form.login{max-width:380px;margin:60px auto;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:24px}form.login input{width:100%;padding:9px 10px;border:1px solid #cbd3d9;border-radius:8px;margin:8px 0 12px;font:inherit}
@media (max-width:720px){.wrap{padding:12px}td,th{padding:6px}input.p{width:72px}}`;

const shell = (title, body, k, back) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${BRAND}</title><style>${CSS}</style></head><body>
<div class="bar">${back ? `<a class="back" href="${BASE}?k=${encodeURIComponent(k)}">← Back to 9Pocket</a>` : ""}<a class="brand" href="${BASE}?k=${encodeURIComponent(k)}">${BRAND}<small>buylists</small></a><span class="sp"></span><span class="links"><a href="/portal/buylists?k=${encodeURIComponent(k)}">BinderPOS's list</a><a href="/hold?k=${encodeURIComponent(k)}">Hold report</a></span></div>
<div class="wrap">${body}</div></body></html>`;

export function renderLogin(err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${BRAND}</title><style>${CSS}</style></head><body>
<form class="login" method="get" action="${BASE}"><h1>${BRAND}</h1><p class="muted">Staff key.</p>${err ? `<div class="err">${esc(err)}</div>` : ""}<input type="password" name="k" autofocus autocomplete="current-password"><button class="ok" type="submit">Open</button></form></body></html>`;
}

/* ---------------- the list ---------------- */

export function renderList(d, o) {
  const records = (d && d.records) || [];
  const counts = (d && d.counts) || {};
  const waiting = counts.staged || 0;
  const row = (r) => {
    const href = `${BASE}/b/${encodeURIComponent(r.id)}?k=${encodeURIComponent(o.k)}`;
    return `<tr class="row" data-status="${esc(r.status)}" onclick="location.href=this.dataset.href" data-href="${esc(href)}">
<td class="ref"><a href="${esc(href)}">${esc(r.number || r.id)}</a></td><td>${esc(when(r.ts))}</td><td>${r.customerName ? esc(r.customerName) : `<span class="muted">customer ${esc(r.customer)}</span>`}${r.customerEmail ? `<br><span class="muted">${esc(r.customerEmail)}</span>` : ""}</td>
<td>${esc(r.paymentType)}</td><td class="n">${r.totals.units}</td><td class="n">${money(r.totals.cash)}</td><td class="n">${money(r.totals.credit)}</td>
<td><span class="tag tag-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>${r.bp && r.bp.number ? `<br><span class="muted">BinderPOS ${esc(r.bp.number)}</span>` : ""}${r.email && r.email.status && r.email.status !== "sent" ? `<br><span class="muted" title="${esc(r.email.error || "")}">email ${esc(r.email.status)}</span>` : ""}</td>
<td class="n"><a class="btn" href="${esc(href)}">Open →</a></td></tr>`;
  };
  const body = `<h1>Buylists <span class="tag ${o.on ? "tag-staged" : "tag-off"}">${o.on ? waiting + " waiting" : "9Pocket OFF - submissions go straight to BinderPOS"}</span></h1>
<p class="muted">Every buylist sent from the sell page, newest first. Open one to check the cards, change quantities or prices, and approve it (sends it to BinderPOS under that customer, at the prices on the worksheet) or reject it. Atlantic time. <a href="${BASE}?k=${encodeURIComponent(o.k)}">Refresh</a></p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="tabs" id="tabs"><button data-f="staged" class="${waiting ? "on" : ""}">Waiting<b>${waiting}</b></button><button data-f="approved">Approved<b>${counts.approved || 0}</b></button><button data-f="rejected">Rejected<b>${counts.rejected || 0}</b></button><button data-f="" class="${waiting ? "" : "on"}">All<b>${records.length}</b></button></div>
<div class="list"><table id="list"><thead><tr><th>Ref</th><th>Submitted</th><th>Customer</th><th>Payment</th><th class="n">Cards</th><th class="n">Cash</th><th class="n">Credit</th><th>Status</th><th></th></tr></thead>
<tbody>${records.length ? records.map(row).join("") : `<tr><td colspan="9" class="muted" style="padding:18px">No buylists yet.</td></tr>`}</tbody></table>
<p id="none" class="muted" hidden style="padding:14px 12px;margin:0">Nothing in this tab.</p></div>
<p class="muted" style="margin-top:14px">Decided buylists stay listed for 90 days; waiting ones stay until decided. ${o.emailOn ? "Customers are emailed their list when they submit." : "Customer emails are not configured yet (RESEND_API_KEY), so nothing is sent on submit; each worksheet says so."}</p>
<script>
(function(){var tabs=document.querySelectorAll('#tabs button'),rows=document.querySelectorAll('#list tbody tr.row');function show(f){var n=0;rows.forEach(function(tr){var on=!f||tr.dataset.status===f;tr.hidden=!on;if(on)n++;});document.getElementById('none').hidden=n>0||!rows.length;tabs.forEach(function(b){b.classList.toggle('on',b.dataset.f===f);});}
tabs.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.f);});});var first=document.querySelector('#tabs button.on');show(first?first.dataset.f:'');})();
</script>`;
  return shell("Buylists", body, o.k, false);
}

/* ---------------- the worksheet ---------------- */

export function renderSheet(r, o) {
  const editable = r.status === "staged";
  const k = o.k;
  const ref = r.number || r.id;
  const notes = (rp, label) => rp && ((rp.changed || []).length || (rp.capped || []).length || (rp.dropped || []).length || (rp.kept || []).length)
    ? `<div class="note"><b>${esc(label)}:</b> ${(rp.changed || []).length ? "prices changed - " + esc(rp.changed.join("; ")) + ". " : ""}${(rp.capped || []).length ? "quantities capped - " + esc(rp.capped.join("; ")) + ". " : ""}${(rp.dropped || []).length ? "left out - " + esc(rp.dropped.join("; ")) + ". " : ""}${(rp.kept || []).length ? "staff prices kept - " + esc(rp.kept.join("; ")) + "." : ""}</div>` : "";
  const thumb = (c) => { const u = safeImage(c.imageUrl); return `<td class="t">${u ? `<a class="zoom" href="${esc(u)}" target="_blank" rel="noopener" title="Open the full image"><img class="thumb" src="${esc(u)}" alt="" loading="lazy"></a>` : ""}</td>`; };
  const key = (c) => String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase();
  const line = (c) => `<tr data-key="${esc(key(c))}">${thumb(c)}<td><b>${esc(c.cardName)}</b><br><span class="muted">${esc(c.setName)}</span></td><td>${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? "<br><span class=\"muted\">" + esc(c.type) + "</span>" : ""}</td>
<td class="n">${editable ? `<input class="q" type="number" min="0" max="999" step="1" value="${esc(c.quantity)}" data-orig="${esc(c.quantity)}">` : esc(c.quantity)}</td>
<td class="n">${editable ? `<input class="p cash${c.staffPriced ? " staff" : ""}" type="number" min="0" step="0.01" value="${(Number(c.cashBuyPrice) || 0).toFixed(2)}" data-orig="${(Number(c.cashBuyPrice) || 0).toFixed(2)}">` : money(c.cashBuyPrice)}</td>
<td class="n">${editable ? `<input class="p credit${c.staffPriced ? " staff" : ""}" type="number" min="0" step="0.01" value="${(Number(c.storeCreditBuyPrice) || 0).toFixed(2)}" data-orig="${(Number(c.storeCreditBuyPrice) || 0).toFixed(2)}">` : money(c.storeCreditBuyPrice)}</td>
<td class="n line">${money(qty(c) * (Number(c.cashBuyPrice) || 0))} / ${money(qty(c) * (Number(c.storeCreditBuyPrice) || 0))}</td></tr>`;
  const em = r.email || null;
  const emailLine = !em ? `<span class="muted">No email has been sent for this buylist.</span>`
    : em.status === "sent" ? `Sent to <b>${esc(em.to)}</b> at ${esc(when(em.at))}.`
    : em.status === "unconfigured" ? `<span class="muted">Not sent: customer emails are not configured on the worker yet (RESEND_API_KEY).</span>`
    : em.status === "no-address" ? `<span class="muted">Not sent: Shopify has no email address for this customer.</span>`
    : `<span style="color:#b42318">Failed at ${esc(when(em.at))}: ${esc(em.error || "")}</span>`;
  const hidden = (a) => `<input type="hidden" name="__form" value="1"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="action" value="${a}">`;
  const body = `<h1>${esc(ref)} <span class="tag tag-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span> ${r.bp && r.bp.number ? `<span class="muted" style="font-size:14px;font-weight:500">· BinderPOS buylist ${esc(r.bp.number)}</span>` : ""}</h1>
<p class="muted">Submitted ${esc(when(r.ts))} from the sell page${r.status !== "staged" ? " · decided " + esc(when(((r.events || []).filter((e) => e.action === "approved" || e.action === "rejected").pop() || {}).ts)) : ""}.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="card"><h3>Customer</h3><div class="kv">
<div><span>Name</span><b>${r.customerName ? esc(r.customerName) : `<span class="muted">not on file</span>`}</b></div>
<div><span>Email</span><b>${r.customerEmail ? `<a href="mailto:${esc(r.customerEmail)}">${esc(r.customerEmail)}</a>` : `<span class="muted">none</span>`}</b></div>
<div><span>Shopify</span><b><a href="${ADMIN_CUSTOMER}${esc(r.customer)}" target="_blank" rel="noopener">customer ${esc(r.customer)}</a></b></div>
<div><span>Paid as</span><b>${esc(r.paymentType)}</b></div>
<div><span>Cards</span><b id="t-units">${r.totals.units}</b> <span style="display:inline;text-transform:none;letter-spacing:0">(${r.totals.lines} line${r.totals.lines === 1 ? "" : "s"})</span></div>
<div><span>Cash total</span><b id="t-cash">${money(r.totals.cash)}</b></div>
<div><span>Store credit total</span><b id="t-credit">${money(r.totals.credit)}</b></div>
</div></div>
${notes(r.repriced, "At submit")}${notes(r.repricedAtApproval, "At approval")}
<div class="card" id="sheet"><h3>Cards <span class="dirty">· unsaved changes</span></h3>
${editable ? `<p class="muted" style="margin:0 0 8px">Change a quantity or a price and <b>Save changes</b>. A quantity of 0 removes the line. A price you type is kept at approval (BinderPOS's price of the day is used for the rest); a red field is a staff price.</p>` : ""}
<table><thead><tr><th class="t"></th><th>Card</th><th>Condition</th><th class="n">Qty</th><th class="n">Cash</th><th class="n">Credit</th><th class="n">Line cash / credit</th></tr></thead><tbody>${(r.cards || []).map(line).join("")}</tbody></table>
${editable ? `<div class="act"><label style="flex:1 1 100%"><span class="muted">Staff note (stays here, never shown to the customer)</span><textarea class="text" id="note" placeholder="e.g. check the foil on the Sol Ring">${esc(r.note || "")}</textarea></label></div>
<div class="act"><button class="save" type="button" id="save">Save changes</button><span class="muted" id="savemsg"></span></div>` : (r.note ? `<div class="note"><b>Staff note:</b> ${esc(r.note)}</div>` : "")}
</div>
${editable ? `<div class="card"><h3>Decide</h3>
<form method="post" action="${BASE}/control" class="act" onsubmit="if(document.body.classList.contains('is-dirty')){alert('Save your changes first.');return false;}return confirm('Send ${esc(ref)} to BinderPOS now? It will appear there as a new online buylist under ${esc((r.customerName || "this customer").replace(/['\\\\]/g, ""))} at the prices on this worksheet.')">${hidden("approve")}<button class="ok" type="submit">Approve → send to BinderPOS</button><span class="muted">Then complete it in the BinderPOS portal as usual - that is when the customer is paid and the stock rises.</span></form>
<form method="post" action="${BASE}/control" class="act" onsubmit="return confirm('Reject ${esc(ref)}? Nothing is sent to BinderPOS; the customer sees it as declined with your reason.')">${hidden("reject")}<input class="text" name="note" placeholder="reason the customer will see"><button class="no" type="submit">Reject</button></form>
</div>` : ""}
<div class="card"><h3>Customer email</h3><p style="margin:0 0 8px">${emailLine}</p>
<div class="act"><a class="btn" href="${BASE}/email/${encodeURIComponent(r.id)}?k=${encodeURIComponent(k)}" target="_blank" rel="noopener">Preview the email</a>
<form method="post" action="${BASE}/control" style="display:inline" onsubmit="return confirm('${em && em.status === "sent" ? "Send the confirmation email again" : "Send the confirmation email"} to ${esc((r.customerEmail || "the customer").replace(/['\\\\]/g, ""))}?')">${hidden("email")}<button type="submit" ${o.emailOn ? "" : "disabled title=\"RESEND_API_KEY is not set on the worker\""}>${em && em.status === "sent" ? "Send again" : "Send now"}</button></form>
${o.emailOn ? "" : `<span class="muted">Sending is off until the worker has a RESEND_API_KEY.</span>`}</div></div>
<div class="card"><h3>History</h3><ul class="ev">${(r.events || []).map((e) => `<li>${esc(when(e.ts))} · ${esc(e.action)}${e.by ? " · " + esc(e.by) : ""}</li>`).join("") || `<li class="muted">-</li>`}</ul></div>
${editable ? `<script>
(function(){var K=${JSON.stringify(k)},ID=${JSON.stringify(r.id)};var sheet=document.getElementById('sheet');var rows=sheet.querySelectorAll('tbody tr[data-key]');
function num(v){var n=parseFloat(v);return isFinite(n)?n:0;}function money(n){return '$'+n.toFixed(2);}
function recalc(){var units=0,cash=0,credit=0,dirty=false;rows.forEach(function(tr){var q=tr.querySelector('input.q'),c=tr.querySelector('input.cash'),s=tr.querySelector('input.credit');var n=Math.max(0,parseInt(q.value,10)||0);[q,c,s].forEach(function(i){var ch=i.value!==i.getAttribute('data-orig')&&num(i.value)!==num(i.getAttribute('data-orig'));i.classList.toggle('changed',ch);if(ch)dirty=true;});units+=n;cash+=n*num(c.value);credit+=n*num(s.value);tr.querySelector('.line').textContent=money(n*num(c.value))+' / '+money(n*num(s.value));tr.style.opacity=n?'':'.45';});
document.getElementById('t-units').textContent=units;document.getElementById('t-cash').textContent=money(cash);document.getElementById('t-credit').textContent=money(credit);document.body.classList.toggle('is-dirty',dirty);}
sheet.addEventListener('input',recalc);recalc();
document.getElementById('save').addEventListener('click',function(){var edit=[];rows.forEach(function(tr){var p=tr.getAttribute('data-key').split('|');edit.push({cardId:p[0],condition:p[1],type:p[2],quantity:tr.querySelector('input.q').value,cashBuyPrice:tr.querySelector('input.cash').value,storeCreditBuyPrice:tr.querySelector('input.credit').value});});
var msg=document.getElementById('savemsg');msg.textContent='Saving…';
fetch('${BASE}/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:K,id:ID,action:'edit',edit:edit,note:document.getElementById('note').value})}).then(function(r){return r.json()}).then(function(j){if(!j.ok){msg.textContent='';alert(j.error||'failed');return;}location.href='${BASE}/b/'+encodeURIComponent(ID)+'?k='+encodeURIComponent(K)+'&msg='+encodeURIComponent('Saved.');}).catch(function(e){msg.textContent='';alert(String(e));});});
})();
</script>` : ""}`;
  return shell(ref, body, k, true);
}
