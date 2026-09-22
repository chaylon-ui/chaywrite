/* ---------------- 9Pocket by Exor: the staff pages ----------------
   Owner, 2026-09-19: "lists out the buylists similar to binderpos pending
   list where you have to go into the buylist, save changes, edit prices,
   etc.. it should list all the buylists and then go into a new page where
   it's like a worksheet. Then can go back to main menu. Please call it
   '9Pocket by Exor'". 2026-09-20: add cards on the worksheet, sign in with
   email + password, an admin section with permissions.

   Pages, all server-rendered by src/stage.js:
     /9pocket/login    email + password
     /9pocket/setup    the first admin account (staff PIN, once)
     /9pocket          the list - every buylist, newest first, tabs by status
     /9pocket/b/<id>   the worksheet - one buylist: customer, cards with
                       thumbnails, quantity and price inputs, add a card,
                       save / approve / reject, the customer email, history
     /9pocket/admin    accounts and permissions (admins)
   Markup only here; every decision is made in stage.js. What a page shows
   follows the signed-in account's permissions (src/stage-auth.js can()). */

import { PERMS, AP_PERMS, LIMITS, can, apPerms } from "./stage-auth.js";

export const BASE = "/9pocket";
export const BRAND = "9Pocket by Exor";
// The store's mark (the theme header's own file), drawn after "9Pocket by" in
// the bar and on the sign-in pages (owner, 2026-09-22: "instead of text
// exor, add this logo").
export const LOGO = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/logo2.png?v=1789388474";
const brandMark = () => `9Pocket <span class="by">by</span> <img class="logo" src="${LOGO}" alt="Exor Games" width="47" height="34">`;
const ADMIN_CUSTOMER = "https://admin.shopify.com/store/most-wanted-ca/customers/";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const when = (ms) => ms ? new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const qty = (c) => Math.max(0, parseInt(c && c.quantity, 10) || 0);
const STATUS_LABEL = { staged: "Waiting", approved: "Approved", rejected: "Rejected" };
const jsStr = (s) => String(s == null ? "" : s).replace(/['\\]/g, "");   // for text inside a confirm('...')

// A card's picture: the imageUrl BinderPOS's search put on the card object
// (their TCGplayer scan), kept only when it is an https URL. Anything else
// draws no thumbnail rather than a broken or unsafe one.
export function safeImage(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 400 ? s : "";
}

const CSS = `*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2327;background:#f4f6f7}a{color:#0d7a5f}
.bar{background:#d52c28;color:#fff;padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}.bar .brand{font-weight:800;font-size:18px;letter-spacing:.01em;color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px}.bar .brand .by{font-weight:500;opacity:.85}.bar .brand .logo{height:34px;width:auto;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}form.login h1 .logo{height:30px;width:auto;vertical-align:middle;margin-left:4px}form.login h1 .by{font-weight:500;color:#6b7780}.bar .brand small{font-weight:500;opacity:.85;margin-left:6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.bar .back{color:#fff;text-decoration:none;font-weight:600;opacity:.95}.bar .back:hover{text-decoration:underline}.bar .sp{flex:1}.bar .links{display:flex;align-items:center;gap:14px;font-size:13px}.bar .links a{color:#fff;opacity:.9}.bar .who{opacity:.9}.bar form{display:inline}.bar button{padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;font:inherit;font-size:13px;cursor:pointer}
.wrap{max-width:1140px;margin:0 auto;padding:18px 20px 40px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;color:#374151}.muted{color:#6b7780}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-weight:600;font-size:12px;vertical-align:middle}.tag-staged{background:#fde68a;color:#5b4300}.tag-approved{background:#d1fae5;color:#065f46}.tag-rejected{background:#fee2e2;color:#7f1d1d}.tag-off{background:#e5e7eb;color:#374151}.tag-admin{background:#1d2327;color:#fff}.tag-staff{background:#e5e7eb;color:#374151}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px}.tabs button{padding:7px 12px;border-radius:99px;border:1px solid #cbd3d9;background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#374151}.tabs button.on{background:#1d2327;border-color:#1d2327;color:#fff}.tabs b{margin-left:6px;opacity:.75}
.card{margin:12px 0;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:16px}.card h3{margin:0 0 6px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0;background:#fff}th{text-align:left;padding:8px 10px;background:#eef2f4;font-weight:600;color:#374151;white-space:nowrap}td{padding:7px 10px;border-top:1px solid #eef2f4;vertical-align:middle}td.n,th.n{text-align:right;white-space:nowrap}td.t{width:52px;padding:4px 6px}tr.row{cursor:pointer}tr.row:hover td{background:#f8fafb}tr.row td a{color:inherit;text-decoration:none}tr.row .ref{font-weight:700;color:#d52c28}
.list{border:1px solid #dde3e7;border-radius:12px;overflow:hidden;background:#fff}
.thumb{display:block;width:44px;height:auto;border-radius:4px;background:#eef2f4;transition:transform .12s ease}a.zoom{display:block;position:relative}a.zoom:hover .thumb,a.zoom:focus .thumb{transform:scale(4.4);transform-origin:left center;position:relative;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.4);border-radius:8px}
input.q,input.p{padding:5px 7px;border:1px solid #cbd3d9;border-radius:6px;text-align:right;font:inherit}input.q{width:62px}input.p{width:84px}input.p.staff,input.q.changed,input.p.changed{border-color:#d52c28;background:#fff5f5}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 18px;margin:8px 0}.kv div{font-size:13px}.kv div span{display:block;color:#6b7780;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.kv div b{font-size:15px}
.act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}button,.btn{padding:8px 14px;border-radius:8px;border:1px solid #cbd3d9;background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#1d2327;text-decoration:none;display:inline-block}button.ok{background:#0d7a5f;border-color:#0d7a5f;color:#fff}button.no{background:#fff;border-color:#b42318;color:#b42318}button.save{background:#1d2327;border-color:#1d2327;color:#fff}button.sm{padding:4px 10px;font-size:12px}button:disabled{opacity:.5;cursor:default}
input.text,select.text{flex:1 1 240px;padding:8px 10px;border:1px solid #cbd3d9;border-radius:8px;font:inherit;background:#fff}textarea.text{width:100%;min-height:64px;padding:8px 10px;border:1px solid #cbd3d9;border-radius:8px;font:inherit}label.chk{display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px}
.err{background:#fee2e2;color:#7f1d1d;padding:8px 12px;border-radius:8px;margin:10px 0}.okmsg{background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;margin:10px 0}.note{font-size:13px;color:#5b4300;background:#fff8dc;border-radius:8px;padding:8px 12px;margin:6px 0}
.tot{display:flex;gap:22px;justify-content:flex-end;padding:10px 10px 2px;font-size:14px}.tot b{font-size:16px}.dirty{display:none;color:#b42318;font-weight:600}.is-dirty .dirty{display:inline}
.ev{list-style:none;padding:0;margin:0}.ev li{padding:4px 0;border-top:1px solid #eef2f4;font-size:13px}.ev li:first-child{border-top:0}
.hits{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:10px;margin-top:10px;max-height:660px;overflow-y:auto;overscroll-behavior:contain;padding:2px 6px 2px 2px;align-content:start}.hits:empty{max-height:0;padding:0;margin:0}.tile{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid #dde3e7;border-radius:10px;background:#fff}.tile>img{width:100%;max-width:120px;align-self:center;border-radius:6px;background:#eef2f4}.rg{margin-top:4px;font-size:12px}.rg a{color:#0d7a5f}.rg-box{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap;margin:4px 0 0 6px}th.pay{background:#d1fae5;color:#065f46}th.pay small{display:block;font-weight:500;font-size:10px;letter-spacing:.04em;text-transform:uppercase}th.dim,td.dim{color:#8a949c}td.dim input.p{color:#6b7780;border-style:dashed}.rg-box input.rg-n{width:46px;padding:2px 4px;border:1px solid #cbd3d9;border-radius:6px;font:inherit}.rg-box select{padding:2px 4px;border:1px solid #cbd3d9;border-radius:6px;font:inherit;font-size:12px}.tile.foil{border-color:#e6b422;box-shadow:inset 0 4px 0 0 #f0b429,0 0 0 1px rgba(240,180,41,.35)}.tile.foil>img{box-shadow:0 0 0 2px #fff,0 0 0 4px #f0b429}.fin{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1d2327;background:linear-gradient(115deg,#ffe9a8 0%,#ffc6e0 30%,#bfe3ff 60%,#d2ffd8 85%,#ffe9a8 100%);border:1px solid rgba(0,0,0,.14);box-shadow:0 1px 2px rgba(0,0,0,.12);vertical-align:middle;white-space:nowrap}.tile .tn{font-size:13px;line-height:1.3}.tile table.mini{margin:0;font-size:12.5px;table-layout:fixed}.tile table.mini th{padding:4px 4px;font-size:11px}.tile table.mini th.n{width:64px}.tile table.mini th.n:last-child{width:96px}.tile table.mini td{padding:4px 4px;vertical-align:middle}.tile table.mini td.n{white-space:nowrap}.tile table.mini tr.off td{color:#6b7780}.tile input.q{width:44px;padding:3px 4px}.tile .add{padding:3px 8px}.payf{display:inline-flex;gap:6px;align-items:center;margin-left:10px;vertical-align:middle}.payf select.text{flex:0 1 150px;padding:4px 8px;font-size:13px}label.chk.notify{margin-left:auto}
.hit{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid #eef2f4}.hit img{width:56px;border-radius:4px;background:#eef2f4}.hit .offers{flex:1}.offer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:3px 0;font-size:13px}.offer .pr{font-weight:600;min-width:130px}.offer .max{color:#6b7780}.offer.off{opacity:.55}
form.login{max-width:400px;margin:60px auto;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:24px}form.login input{width:100%;padding:9px 10px;border:1px solid #cbd3d9;border-radius:8px;margin:6px 0 12px;font:inherit}form.login label{font-size:13px;color:#374151;font-weight:600}
.users td small{display:block;color:#6b7780}.users form{display:inline}.perm{display:inline-block;padding:1px 7px;border-radius:99px;background:#eef2f4;font-size:11px;margin:1px 3px 1px 0}.perm.ap{background:#dbeafe;color:#1e3a8a}.perm.lim{background:#fef3c7;color:#78350f}.pg{margin:6px 0;padding:8px 10px;background:#f8fafb;border-radius:8px}.pg b{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#374151}.pg input.p{width:70px;text-align:right}
@media (max-width:720px){.wrap{padding:12px}td,th{padding:6px}input.p{width:72px}}`;

const shell = (title, body, o, back) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${BRAND}</title><style>${CSS}</style></head><body>
<div class="bar">${back ? `<a class="back" href="${BASE}">← Back to 9Pocket</a>` : ""}<a class="brand" href="${BASE}" aria-label="${BRAND}">${brandMark()}<small>buylists</small></a><span class="sp"></span><span class="links">${o && o.user ? `<span class="who">${esc(o.user.name || o.user.email)}${o.user.role === "admin" ? " · admin" : ""}</span>${o.user.role === "admin" ? `<a href="${BASE}/admin">Admin</a>` : ""}${apPerms(o.user) ? `<a href="/autoprice">Auto-pricing</a>` : ""}` : ""}<a href="/portal/buylists">BinderPOS's list</a>${o && o.user ? `<form method="post" action="${BASE}/logout"><button type="submit">Sign out</button></form>` : ""}</span></div>
<div class="wrap">${body}</div></body></html>`;

const plain = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${BRAND}</title><style>${CSS}</style></head><body>${inner}</body></html>`;

/* ---------------- sign in, first account ---------------- */

export function renderLoginForm(o) {
  return plain("Sign in", `<form class="login" method="post" action="${BASE}/login"><h1>${brandMark()}</h1><p class="muted">Sign in with your staff account.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<input type="hidden" name="next" value="${esc(o.next || BASE)}">
<label>Email</label><input type="email" name="email" value="${esc(o.email || "")}" autocomplete="username" autofocus required>
<label>Password</label><input type="password" name="password" autocomplete="current-password" required>
<button class="ok" type="submit">Sign in</button></form>`);
}

export function renderSetup(o) {
  return plain("First account", `<form class="login" method="post" action="${BASE}/setup"><h1>${brandMark()}</h1><p class="muted">No account exists yet. Create the admin account - it can then add everyone else on the Admin page.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}
${o.noPin ? "" : `<input type="hidden" name="k" value="${esc(o.k || "")}">
<label>Email (your sign-in name)</label><input type="email" name="email" value="${esc(o.email || "")}" autocomplete="username" required>
<label>Name</label><input type="text" name="name" autocomplete="name" placeholder="shown on the buylists you work on">
<label>Password (8+ characters)</label><input type="password" name="password" autocomplete="new-password" minlength="8" required>
<label>Password again</label><input type="password" name="password2" autocomplete="new-password" minlength="8" required>
<button class="ok" type="submit">Create the admin account</button>`}</form>`);
}

export function renderDenied(o) {
  return shell("Admins only", `<h1>Admins only</h1><p class="muted">The Admin page is for admin accounts. You are signed in as ${esc(o.user ? o.user.email : "")}. <a href="${BASE}">Back to the buylists</a>.</p>`, o, true);
}

/* ---------------- the list ---------------- */

export function renderList(d, o) {
  const records = (d && d.records) || [];
  const counts = (d && d.counts) || {};
  const waiting = counts.staged || 0;
  const row = (r) => {
    const href = `${BASE}/b/${encodeURIComponent(r.id)}`;
    return `<tr class="row" data-status="${esc(r.status)}" onclick="location.href=this.dataset.href" data-href="${esc(href)}">
<td class="ref"><a href="${esc(href)}">${esc(r.number || r.id)}</a></td><td>${esc(when(r.ts))}</td><td>${r.customerName ? esc(r.customerName) : `<span class="muted">customer ${esc(r.customer)}</span>`}${r.customerEmail ? `<br><span class="muted">${esc(r.customerEmail)}</span>` : ""}</td>
<td>${esc(r.paymentType)}</td><td class="n">${r.totals.units}</td><td class="n">${money(r.totals.cash)}</td><td class="n">${money(r.totals.credit)}</td>
<td><span class="tag tag-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>${r.bp && r.bp.number ? `<br><span class="muted">BinderPOS ${esc(r.bp.number)}</span>` : ""}${r.email && r.email.status && r.email.status !== "sent" ? `<br><span class="muted" title="${esc(r.email.error || "")}">email ${esc(r.email.status)}</span>` : ""}</td>
<td class="n"><a class="btn" href="${esc(href)}">Open →</a></td></tr>`;
  };
  const body = `<h1>Buylists <span class="tag ${o.on ? "tag-staged" : "tag-off"}">${o.on ? waiting + " waiting" : "9Pocket OFF - submissions go straight to BinderPOS"}</span></h1>
<p class="muted">Every buylist sent from the sell page, newest first. Open one to check the cards, change quantities or prices, add cards, and approve it (sends it to BinderPOS under that customer, at the prices on the worksheet) or reject it. Atlantic time. <a href="${BASE}">Refresh</a></p>
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
  return shell("Buylists", body, o, false);
}

/* ---------------- the worksheet ---------------- */

export function renderSheet(r, o) {
  const u = o.user;
  const waiting = r.status === "staged";
  // Paid as Store Credit: BinderPOS shows and pays the CREDIT price (its one
  // "Buy Price" column is the paid-as one). 2026-09-22: $1.00 typed into Cash
  // on a Store Credit list "did not update" - it did, BinderPOS just never
  // shows the cash column of a credit buylist. So the paid column is marked.
  const credit = String(r.paymentType || "").toLowerCase().includes("credit");
  const canEdit = waiting && can(u, "edit"), canPrices = waiting && can(u, "prices"), canAdd = waiting && can(u, "add"), canApprove = waiting && can(u, "approve"), canEmail = can(u, "email");
  const ref = r.number || r.id;
  const notes = (rp, label) => rp && ((rp.changed || []).length || (rp.capped || []).length || (rp.dropped || []).length || (rp.kept || []).length)
    ? `<div class="note"><b>${esc(label)}:</b> ${(rp.changed || []).length ? "prices changed - " + esc(rp.changed.join("; ")) + ". " : ""}${(rp.capped || []).length ? "quantities capped - " + esc(rp.capped.join("; ")) + ". " : ""}${(rp.dropped || []).length ? "left out - " + esc(rp.dropped.join("; ")) + ". " : ""}${(rp.kept || []).length ? "staff prices kept - " + esc(rp.kept.join("; ")) + "." : ""}</div>` : "";
  const thumb = (c) => { const im = safeImage(c.imageUrl); return `<td class="t">${im ? `<a class="zoom" href="${esc(im)}" target="_blank" rel="noopener" title="Open the full image"><img class="thumb" src="${esc(im)}" alt="" loading="lazy"></a>` : ""}</td>`; };
  const key = (c) => String(c.cardId) + "|" + String(c.condition) + "|" + String(c.type || "").toLowerCase();
  const p2 = (n) => (Number(n) || 0).toFixed(2);
  // Regrade (owner, 2026-09-22: "I must be able to edit the condition ...
  // if there is more than one qty per card, I need to be able to edit each
  // qty condition"): a link under the condition opens a small control -
  // how many copies, to which condition, Move. The worker prices the moved
  // copies at BinderPOS's offer for that condition and finish.
  const CONDS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
  const condNames = [...new Set(CONDS.concat((r.cards || []).map((c) => String(c.conditionName || "")).filter(Boolean)))];
  const regrade = (c) => {
    if (!canEdit) return "";
    const q = qty(c), cur = String(c.conditionName || "").trim().toLowerCase();
    return `<div class="rg"><a href="#" class="rg-open">regrade${q > 1 ? " some" : ""}</a><span class="rg-box" hidden>${q > 1 ? `<input class="rg-n" type="number" min="1" max="${q}" value="1" title="how many of the ${q}"> of ${q} to ` : "to "}<select class="rg-cond">${condNames.filter((n) => n.toLowerCase() !== cur).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select> <button type="button" class="sm rg-go">Move</button></span></div>`;
  };
  const line = (c) => `<tr data-key="${esc(key(c))}" data-qty="${esc(c.quantity)}" data-cash="${p2(c.cashBuyPrice)}" data-credit="${p2(c.storeCreditBuyPrice)}">${thumb(c)}<td><b>${esc(c.cardName)}</b><br><span class="muted">${esc(c.setName)}</span></td><td>${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? "<br><span class=\"fin\">✦ " + esc(c.type) + "</span>" : ""}${regrade(c)}</td>
<td class="n">${canEdit ? `<input class="q" type="number" min="0" max="999" step="1" value="${esc(c.quantity)}" data-orig="${esc(c.quantity)}">` : esc(c.quantity)}</td>
<td class="n${credit ? " dim" : ""}">${canPrices ? `<input class="p cash${c.staffPriced ? " staff" : ""}" type="number" min="0" step="0.01" value="${p2(c.cashBuyPrice)}" data-orig="${p2(c.cashBuyPrice)}">` : money(c.cashBuyPrice) + (c.staffPriced ? ' <span class="muted" title="staff price">*</span>' : "")}</td>
<td class="n${credit ? "" : " dim"}">${canPrices ? `<input class="p credit${c.staffPriced ? " staff" : ""}" type="number" min="0" step="0.01" value="${p2(c.storeCreditBuyPrice)}" data-orig="${p2(c.storeCreditBuyPrice)}">` : money(c.storeCreditBuyPrice)}</td>
<td class="n line">${money(qty(c) * (Number(c.cashBuyPrice) || 0))} / ${money(qty(c) * (Number(c.storeCreditBuyPrice) || 0))}</td></tr>`;
  const em = r.email || null;
  const emailLine = !em ? `<span class="muted">No email has been sent for this buylist.</span>`
    : em.status === "sent" ? `Sent to <b>${esc(em.to)}</b> at ${esc(when(em.at))}.`
    : em.status === "unconfigured" ? `<span class="muted">Not sent: customer emails are not configured on the worker yet (RESEND_API_KEY).</span>`
    : em.status === "no-address" ? `<span class="muted">Not sent: Shopify has no email address for this customer.</span>`
    : `<span style="color:#b42318">Failed at ${esc(when(em.at))}: ${esc(em.error || "")}</span>`;
  const hidden = (a) => `<input type="hidden" name="__form" value="1"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="action" value="${a}">`;
  const decided = (r.events || []).filter((e) => e.action === "approved" || e.action === "rejected").pop();
  const body = `<h1>${esc(ref)} <span class="tag tag-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span> ${r.bp && r.bp.number ? `<span class="muted" style="font-size:14px;font-weight:500">· BinderPOS buylist ${esc(r.bp.number)}</span>` : ""}</h1>
<p class="muted">Submitted ${esc(when(r.ts))} from the sell page${decided ? " · " + esc(decided.action) + " " + esc(when(decided.ts)) + (decided.by ? " by " + esc(decided.by) : "") : ""}.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="card"><h3>Customer</h3><div class="kv">
<div><span>Name</span><b>${r.customerName ? esc(r.customerName) : `<span class="muted">not on file</span>`}</b></div>
<div><span>Email</span><b>${r.customerEmail ? `<a href="mailto:${esc(r.customerEmail)}">${esc(r.customerEmail)}</a>` : `<span class="muted">none</span>`}</b></div>
<div><span>Shopify</span><b><a href="${ADMIN_CUSTOMER}${esc(r.customer)}" target="_blank" rel="noopener">customer ${esc(r.customer)}</a></b></div>
<div><span>Paid as</span><b>${esc(r.paymentType)}</b>${canEdit ? `<form method="post" action="${BASE}/control" class="payf">${hidden("payment")}<select class="text" name="paymentType">${["Cash", "Store Credit"].map((t) => `<option value="${t}"${t === r.paymentType ? " selected" : ""}>${t}</option>`).join("")}</select><button class="sm" type="submit" title="Changes how this customer is paid before the list goes to BinderPOS">Change</button></form>` : ""}</div>
<div><span>Cards</span><b id="t-units">${r.totals.units}</b> <span style="display:inline;text-transform:none;letter-spacing:0">(${r.totals.lines} line${r.totals.lines === 1 ? "" : "s"})</span></div>
<div><span>Cash total</span><b id="t-cash">${money(r.totals.cash)}</b></div>
<div><span>Store credit total</span><b id="t-credit">${money(r.totals.credit)}</b></div>
</div></div>
${notes(r.repriced, "At submit")}${notes(r.repricedAtApproval, "At approval")}
${r.bpSync ? `<div class="${r.bpSync.ok && (r.bpSync.verified !== false) ? "okmsg" : "err"}"><b>BinderPOS prices:</b> ${esc(r.bpSync.message || r.bpSync.error || "")} <span class="muted">(${esc(when(r.bpSync.at))}${r.bpSync.by ? " · " + esc(r.bpSync.by) : ""})</span></div>` : ""}
<div class="card" id="sheet"><h3>Cards <span class="dirty">· unsaved changes</span></h3>
${canEdit || canPrices ? `<p class="muted" style="margin:0 0 8px">${canEdit ? "Change a quantity" + (canPrices ? " or a price" : "") : "Change a price"} and <b>Save changes</b>.${canEdit ? " A quantity of 0 removes the line." : ""}${canPrices ? " A price you type is kept at approval (BinderPOS's price of the day is used for the rest); a red field is a staff price." : ""} This list is paid as <b>${credit ? "Store Credit" : "Cash"}</b>: the <b>${credit ? "Credit" : "Cash"}</b> column is what BinderPOS shows as its Buy Price and pays; the other column goes along but is not paid.</p>` : (waiting ? `<p class="muted" style="margin:0 0 8px">Your account can view this buylist; changing it needs a permission an admin can give you.</p>` : "")}
<table><thead><tr><th class="t"></th><th>Card</th><th>Condition</th><th class="n">Qty</th><th class="n${credit ? " dim" : " pay"}">Cash${credit ? "" : "<small>paid</small>"}</th><th class="n${credit ? " pay" : " dim"}">Credit${credit ? "<small>paid</small>" : ""}</th><th class="n">Line cash / credit</th></tr></thead><tbody>${(r.cards || []).map(line).join("")}</tbody></table>
${canEdit ? `<p class="muted" style="margin:6px 0 0">Re-graded a copy? Use <b>regrade</b> under its condition: the copies you move get BinderPOS's price for the new condition (change it above afterwards if you want).</p>` : ""}
${canEdit ? `<div class="act"><label style="flex:1 1 100%"><span class="muted">Staff note (stays here, never shown to the customer)</span><textarea class="text" id="note" placeholder="e.g. check the foil on the Sol Ring">${esc(r.note || "")}</textarea></label></div>` : (r.note ? `<div class="note"><b>Staff note:</b> ${esc(r.note)}</div>` : "")}
${canEdit || canPrices ? `<div class="act"><button class="save" type="button" id="save">Save changes</button><span class="muted" id="savemsg"></span></div>` : ""}
</div>
${canAdd ? `<div class="card" id="addcard"><h3>Add a card</h3><p class="muted" style="margin:0 0 8px">Search BinderPOS's buylist, pick the condition and finish, and add it at today's price (you can change the price above afterwards).</p>
<div class="act"><select class="text" id="ad-game" style="flex:0 1 220px"><option value="mtg">Magic: The Gathering</option></select><input class="text" id="ad-q" placeholder="card name" autocomplete="off"><input class="text" id="ad-set" list="ad-sets" placeholder="Any set - type to filter" autocomplete="off" style="flex:0 1 240px"><datalist id="ad-sets"></datalist><button type="button" id="ad-go">Search</button><span class="muted" id="ad-msg"></span></div>
<div id="ad-res" class="hits"></div><div class="act"><button type="button" id="ad-more" class="sm" hidden>Load more</button><span class="muted" id="ad-count"></span></div></div>` : ""}
${canApprove ? `<div class="card"><h3>Decide</h3><p class="muted" style="margin:0 0 8px">The customer is <b>not</b> emailed about a decision unless you tick the box beside it.</p>
<form method="post" action="${BASE}/control" class="act" onsubmit="if(document.body.classList.contains('is-dirty')){alert('Save your changes first.');return false;}return confirm('Send ${esc(jsStr(ref))} to BinderPOS now? It will appear there as a new online buylist under ${esc(jsStr(r.customerName || "this customer"))} at the prices on this worksheet.')">${hidden("approve")}<button class="ok" type="submit">Approve → send to BinderPOS</button><span class="muted">Then complete it in the BinderPOS portal as usual - that is when the customer is paid and the stock rises.</span><label class="chk notify" title="${o.emailOn ? "Sends the approval email: the list, the total and where to bring or mail the cards" : "Emails are off until the worker has a RESEND_API_KEY"}"><input type="checkbox" name="notify" value="1"${o.emailOn ? "" : " disabled"}> Email the customer</label></form>
<form method="post" action="${BASE}/control" class="act" onsubmit="return confirm('Reject ${esc(jsStr(ref))}? Nothing is sent to BinderPOS; the customer sees it as declined with your reason.')">${hidden("reject")}<input class="text" name="note" placeholder="reason the customer will see"><button class="no" type="submit">Reject</button><label class="chk notify" title="${o.emailOn ? "Sends the customer the reason" : "Emails are off until the worker has a RESEND_API_KEY"}"><input type="checkbox" name="notify" value="1"${o.emailOn ? "" : " disabled"}> Email the customer</label></form>
</div>` : ""}
<div class="card"><h3>Customer email</h3><p style="margin:0 0 8px">${emailLine}</p>${r.decisionEmail ? `<p style="margin:0 0 8px">${r.decisionEmail.status === "sent" ? `Decision email (${esc(r.decisionEmail.kind)}) sent to <b>${esc(r.decisionEmail.to)}</b> at ${esc(when(r.decisionEmail.at))}.` : `<span style="color:#b42318">Decision email (${esc(r.decisionEmail.kind)}) not sent at ${esc(when(r.decisionEmail.at))}: ${esc(r.decisionEmail.error || r.decisionEmail.status)}</span>`}</p>` : ""}
<div class="act"><a class="btn" href="${BASE}/email/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">Preview the email</a>
${canEmail ? `<form method="post" action="${BASE}/control" style="display:inline" onsubmit="return confirm('${em && em.status === "sent" ? "Send the confirmation email again" : "Send the confirmation email"} to ${esc(jsStr(r.customerEmail || "the customer"))}?')">${hidden("email")}<button type="submit" ${o.emailOn ? "" : "disabled title=\"RESEND_API_KEY is not set on the worker\""}>${em && em.status === "sent" ? "Send again" : "Send now"}</button></form>
${o.emailOn ? "" : `<span class="muted">Sending is off until the worker has a RESEND_API_KEY.</span>`}` : ""}</div></div>
<div class="card"><h3>History</h3><ul class="ev">${(r.events || []).map((e) => `<li>${esc(when(e.ts))} · ${esc(e.action)}${e.by ? " · " + esc(e.by) : ""}</li>`).join("") || `<li class="muted">-</li>`}</ul></div>
${canEdit || canPrices || canAdd ? `<script>
(function(){var ID=${JSON.stringify(r.id)},CTL=${JSON.stringify(BASE + "/control")},SHEET=${JSON.stringify(BASE + "/b/" + r.id)};
function num(v){var n=parseFloat(v);return isFinite(n)?n:0;}function money(n){return '$'+n.toFixed(2);}function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function post(body,cb){fetch(CTL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(cb).catch(function(e){alert(String(e));});}
var sheet=document.getElementById('sheet');var rows=sheet.querySelectorAll('tbody tr[data-key]');
function val(tr,cls,attr){var i=tr.querySelector('input.'+cls);return i?i.value:tr.getAttribute('data-'+attr);}
function recalc(){var units=0,cash=0,credit=0,dirty=false;rows.forEach(function(tr){var n=Math.max(0,parseInt(val(tr,'q','qty'),10)||0),c=num(val(tr,'cash','cash')),s=num(val(tr,'credit','credit'));tr.querySelectorAll('input[data-orig]').forEach(function(i){var ch=num(i.value)!==num(i.getAttribute('data-orig'));i.classList.toggle('changed',ch);if(ch)dirty=true;});units+=n;cash+=n*c;credit+=n*s;tr.querySelector('.line').textContent=money(n*c)+' / '+money(n*s);tr.style.opacity=n?'':'.45';});
document.getElementById('t-units').textContent=units;document.getElementById('t-cash').textContent=money(cash);document.getElementById('t-credit').textContent=money(credit);document.body.classList.toggle('is-dirty',dirty);}
sheet.addEventListener('input',recalc);recalc();
sheet.addEventListener('click',function(e){var o=e.target.closest('a.rg-open');if(o){e.preventDefault();var box=o.parentNode.querySelector('.rg-box');box.hidden=!box.hidden;return;}
var g=e.target.closest('button.rg-go');if(!g)return;if(document.body.classList.contains('is-dirty')){alert('Save your changes first.');return;}var tr=g.closest('tr'),box=g.closest('.rg-box'),n=box.querySelector('.rg-n'),c=box.querySelector('.rg-cond');g.disabled=true;g.textContent='Moving…';
post({id:ID,action:'regrade',key:tr.getAttribute('data-key'),take:n?n.value:1,conditionName:c.value},function(j){if(!j.ok){g.disabled=false;g.textContent='Move';alert(j.error||'failed');return;}location.href=SHEET+'?msg='+encodeURIComponent(j.message||'Regraded.');});});
var save=document.getElementById('save');if(save)save.addEventListener('click',function(){var edit=[];rows.forEach(function(tr){var p=tr.getAttribute('data-key').split('|');var e={cardId:p[0],condition:p[1],type:p[2]};var q=tr.querySelector('input.q');if(q)e.quantity=q.value;var c=tr.querySelector('input.cash');if(c)e.cashBuyPrice=c.value;var s=tr.querySelector('input.credit');if(s)e.storeCreditBuyPrice=s.value;edit.push(e);});
var body={id:ID,action:'edit',edit:edit};var note=document.getElementById('note');if(note)body.note=note.value;var msg=document.getElementById('savemsg');msg.textContent='Saving…';
post(body,function(j){if(!j.ok){msg.textContent='';alert(j.error||'failed');return;}location.href=SHEET+'?msg='+encodeURIComponent('Saved.');});});
var add=document.getElementById('addcard');if(add){var sel=document.getElementById('ad-game'),q=document.getElementById('ad-q'),res=document.getElementById('ad-res'),am=document.getElementById('ad-msg');
var setIn=document.getElementById('ad-set'),setList=document.getElementById('ad-sets');
function loadSets(){setList.innerHTML='';fetch('/buylist/api/sets?game='+encodeURIComponent(sel.value)).then(function(r){return r.json()}).then(function(j){setList.innerHTML=((j&&j.sets)||[]).map(function(x){return '<option value="'+esc(x.name)+'"></option>';}).join('');}).catch(function(){});}
fetch('/buylist/api/games').then(function(r){return r.json()}).then(function(j){if(j&&j.games&&j.games.length){sel.innerHTML=j.games.map(function(g){return '<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>';}).join('');}loadSets();}).catch(function(){loadSets();});
sel.addEventListener('change',function(){setIn.value='';loadSets();});
var more=document.getElementById('ad-more'),cnt=document.getElementById('ad-count'),PAGE=20,last=null,shown=0;
function search(isMore){var s=q.value.trim(),st=setIn.value.trim();if(s.length<2&&!st){am.textContent='Type at least 2 letters, or pick a set.';return;}
var same=last&&last.q===s&&last.set===st&&last.game===sel.value;var offset=isMore&&same?last.offset+PAGE:0;if(!offset){res.innerHTML='';shown=0;}more.hidden=true;am.textContent=offset?'Loading more…':'Searching…';var mine=last={q:s,set:st,game:sel.value,offset:offset};
fetch('/buylist/api/search?q='+encodeURIComponent(s)+'&game='+encodeURIComponent(sel.value)+'&offset='+offset+(st?'&set='+encodeURIComponent(st):'')).then(function(r){return r.json()}).then(function(j){if(mine!==last)return;var hits=(j&&j.hits)||[];shown+=hits.length;am.textContent=shown?'':'Nothing found on the buylist for that.';more.hidden=!(j&&j.more);cnt.textContent=shown?shown+' card'+(shown===1?'':'s')+(j&&j.more?' so far':''):'';
res.insertAdjacentHTML('beforeend',hits.map(function(h){var byFin={},order=[];(h.variants||[]).forEach(function(v){(v.cardBuylistTypes||[]).forEach(function(p){var f=p.type&&p.type!=='Normal'?String(p.type):'';if(!byFin[f]){byFin[f]=[];order.push(f);}byFin[f].push({v:v,p:p});});});
return order.map(function(f){var rows=byFin[f].map(function(o){var v=o.v,p=o.p,buying=Number(p.maxPurchaseQuantity)>0&&Number(p.buyPrice)>0;var card={cardId:h.id,cardName:h.cardName,setName:h.setName,game:h.game,type:p.type,imageUrl:h.imageUrl,condition:v.condition!=null?v.condition:v.id,conditionName:v.variantName,cashBuyPrice:p.buyPrice,storeCreditBuyPrice:p.creditBuyPrice,shopifyVariantId:v.shopifyVariantId||v.variantId||p.shopifyVariantId||null,maxPurchaseQuantity:p.maxPurchaseQuantity};return '<tr class="'+(buying?'':'off')+'"><td>'+esc(v.variantName)+'</td><td class="n">'+(buying?'$'+num(p.buyPrice).toFixed(2)+'<br><span class="muted">$'+num(p.creditBuyPrice).toFixed(2)+'</span>':'<span class="muted">not buying</span>')+'</td><td class="n">'+(buying?'<input class="q" type="number" min="1" max="'+esc(p.maxPurchaseQuantity)+'" value="1" title="max '+esc(p.maxPurchaseQuantity)+'"> <button type="button" class="sm add" data-card=\\''+esc(JSON.stringify(card)).replace(/'/g,'&#39;')+'\\'>Add</button>':'')+'</td></tr>';}).join('');
return '<div class="tile'+(f?' foil':'')+'">'+(h.imageUrl?'<img src="'+esc(h.imageUrl)+'" alt="" loading="lazy">':'')+'<div class="tn"><b>'+esc(h.cardName)+'</b>'+(f?' <span class="fin">✦ '+esc(f)+'</span>':'')+'<br><span class="muted">'+esc(h.setName)+'</span></div><table class="mini"><thead><tr><th>Condition</th><th class="n">Cash<br><span class="muted">credit</span></th><th class="n">Qty</th></tr></thead><tbody>'+rows+'</tbody></table></div>';}).join('');}).join(''));
}).catch(function(e){am.textContent='Search failed: '+e;});}
document.getElementById('ad-go').addEventListener('click',function(){search(false);});more.addEventListener('click',function(){search(true);});q.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();search(false);}});setIn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();search(false);}});
res.addEventListener('click',function(e){var b=e.target.closest('button.add');if(!b)return;var card=JSON.parse(b.getAttribute('data-card'));card.quantity=b.closest('td').querySelector('input.q').value;b.disabled=true;b.textContent='Adding…';
post({id:ID,action:'add',card:card},function(j){if(!j.ok){b.disabled=false;b.textContent='Add';alert(j.error||'failed');return;}location.href=SHEET+'?msg='+encodeURIComponent(j.message||'Added.');});});}
})();
</script>` : ""}`;
  return shell(ref, body, o, true);
}

/* ---------------- admin: accounts ---------------- */

export function renderAdmin(o) {
  const users = o.users || [];
  const me = o.user;
  const checks = (list, u) => list.map((p) => `<label class="chk"><input type="checkbox" name="perm_${p.key}" ${u && u.perms && u.perms[p.key] ? "checked" : ""}> ${esc(p.label)}</label>`).join("");
  const limitFields = (u) => LIMITS.map((l) => { const val = u && u.limits && u.limits[l.key] != null ? u.limits[l.key] : ""; return `<label class="chk">${esc(l.label)} <input type="number" class="p" name="${l.key}" min="0" max="${l.max}" step="0.5" value="${esc(val)}" placeholder="no limit"> %</label>`; }).join("");
  // Two groups: the buylist worksheet, then the auto-pricer with its brakes.
  const permChecks = (u) => `<div class="pg"><b>9Pocket buylists</b><br>${checks(PERMS, u)}</div><div class="pg"><b>Auto-pricing</b> <span class="muted">(any of these opens /autoprice)</span><br>${checks(AP_PERMS, u)}<br>${limitFields(u)}<span class="muted">Limits are in percent of today's price; blank = no limit. Admins are never limited.</span></div>`;
  const limitChips = (u) => LIMITS.filter((l) => u.limits && u.limits[l.key] != null).map((l) => `<span class="perm lim">${l.key === "apMaxDropPct" ? "drop" : "raise"} ≤ ${esc(u.limits[l.key])}%</span>`).join("");
  const userRow = (u) => {
    const self = me && u.email === me.email;
    return `<tr><td><b>${esc(u.email)}</b><small>${esc(u.name || "")}${u.createdAt ? " · added " + esc(when(u.createdAt)) + (u.createdBy ? " by " + esc(u.createdBy) : "") : ""}</small></td>
<td><span class="tag tag-${u.role === "admin" ? "admin" : "staff"}">${u.role === "admin" ? "admin" : "staff"}</span>${u.disabled ? ' <span class="tag tag-rejected">disabled</span>' : ""}</td>
<td>${u.role === "admin" ? '<span class="muted">everything</span>' : (PERMS.filter((p) => u.perms && u.perms[p.key]).map((p) => `<span class="perm">${esc(p.label)}</span>`).join("") || '<span class="muted">buylists: view only</span>') + (AP_PERMS.some((p) => u.perms && u.perms[p.key]) ? "<br>" + AP_PERMS.filter((p) => u.perms && u.perms[p.key]).map((p) => `<span class="perm ap">${esc(p.label)}</span>`).join("") + limitChips(u) : "")}</td>
<td class="n"><details><summary class="btn" style="cursor:pointer">Edit</summary>
<form method="post" action="${BASE}/admin/control" style="text-align:left;margin:10px 0;display:block"><input type="hidden" name="action" value="update"><input type="hidden" name="email" value="${esc(u.email)}">
<div class="act"><input class="text" name="name" value="${esc(u.name || "")}" placeholder="name"><select class="text" name="role" style="flex:0 1 140px" ${self ? "disabled" : ""}><option value="staff" ${u.role !== "admin" ? "selected" : ""}>staff</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option></select>${self ? '<input type="hidden" name="role" value="admin">' : ""}</div>
<div style="margin:6px 0">${permChecks(u)}</div><div class="act"><button class="save" type="submit">Save</button></div></form>
<form method="post" action="${BASE}/admin/control" style="text-align:left;margin:10px 0;display:block"><input type="hidden" name="action" value="password"><input type="hidden" name="email" value="${esc(u.email)}"><div class="act"><input class="text" type="password" name="password" placeholder="new password (8+)" minlength="8" autocomplete="new-password" required><button type="submit">Change password</button></div></form>
${self ? "" : `<div class="act"><form method="post" action="${BASE}/admin/control"><input type="hidden" name="action" value="${u.disabled ? "enable" : "disable"}"><input type="hidden" name="email" value="${esc(u.email)}"><button type="submit">${u.disabled ? "Enable" : "Disable"}</button></form>
<form method="post" action="${BASE}/admin/control" onsubmit="return confirm('Delete ${esc(jsStr(u.email))}? They will be signed out and cannot sign in again.')"><input type="hidden" name="action" value="delete"><input type="hidden" name="email" value="${esc(u.email)}"><button class="no" type="submit">Delete</button></form></div>`}
</details></td></tr>`;
  };
  const body = `<h1>Accounts</h1><p class="muted">Who can sign in to 9Pocket and the <a href="/autoprice">auto-pricer</a>, and what each account may do. Admins can do everything and manage accounts here; staff get the permissions ticked below, and on the auto-pricer they may only publish price moves inside their limits.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="list"><table class="users"><thead><tr><th>Account</th><th>Role</th><th>Can</th><th></th></tr></thead><tbody>${users.map(userRow).join("")}</tbody></table></div>
<div class="card"><h3>Add an account</h3>
<form method="post" action="${BASE}/admin/control" autocomplete="off"><input type="hidden" name="action" value="add">
<div class="act"><input class="text" type="email" name="email" placeholder="email (their sign-in name)" required autocomplete="off"><input class="text" name="name" placeholder="name" autocomplete="off"><input class="text" type="password" name="password" placeholder="password (8+)" minlength="8" required autocomplete="new-password"><select class="text" name="role" style="flex:0 1 140px"><option value="staff">staff</option><option value="admin">admin</option></select></div>
<div style="margin:8px 0"><span class="muted">Permissions (staff only; admins have all):</span>${permChecks(null)}</div>
<div class="act"><button class="ok" type="submit">Add account</button><span class="muted">Tell them their password yourself; 9Pocket does not email it.</span></div></form></div>`;
  return shell("Accounts", body, o, true);
}
