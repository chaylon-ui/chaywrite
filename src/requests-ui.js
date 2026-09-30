/* ---------------- 9Pocket: the item-requests pages ----------------
   Markup only; every decision is made in src/requests.js. Two pages:
     /9pocket/requests          the list - tabs by status, product type, days
                                back, search; the store-wide switch (admins);
                                products switched off, with a way back on
     /9pocket/requests/r/<id>   one request - the item, the customer, the
                                thread, reply by email, mark ordered / arrived
                                / closed / declined, requests off for the item
   Shares the 9Pocket shell and styles (src/stage-ui.js). */

import { BASE, shell, esc, when } from "./stage-ui.js";
import { STATUSES } from "./requests.js";

const R = BASE + "/requests";
const LABEL = { open: "Open", ordered: "Ordered", arrived: "Arrived", closed: "Closed", declined: "Declined" };
const TAG = { open: "tag-staged", ordered: "tag-admin", arrived: "tag-approved", closed: "tag-off", declined: "tag-rejected" };
const item = (r) => esc(r.title) + (r.variantTitle && r.variantTitle !== "Default Title" ? ` <span class="muted">${esc(r.variantTitle)}</span>` : "");
const kindTag = (r) => r.kind === "special" ? `<span class="tag tag-admin" style="background:#4c1d95">special order</span>` : "";
const stockTag = (r) => r.stock && r.stock.available === true && r.status === "open" ? `<span class="tag tag-approved">back in stock${r.stock.qty != null ? " · " + esc(r.stock.qty) : ""}</span>` : "";
const custLine = (r) => `${r.name ? esc(r.name) : `<span class="muted">no name</span>`}<br><span class="muted">${esc(r.email)}</span>`;

export function renderRequests(d, o) {
  if (o.denied) return shell("Requests", `<h1>Requests</h1><div class="err">Your account cannot see item requests. Ask an admin for the "requests" permission.</div>`, o, true);
  const records = (d && d.records) || [];
  const counts = (d && d.counts) || {};
  const types = Object.keys((d && d.types) || {}).sort();
  const cfg = (d && d.cfg) || {};
  const f = o.filters || {};
  const offProducts = Object.entries(cfg.offProducts || {});
  const link = (patch) => { const s = new URLSearchParams(); for (const [k, v] of Object.entries({ ...f, ...patch })) if (v) s.set(k, v); const t = s.toString(); return R + (t ? "?" + t : ""); };
  const tab = (key, label, n) => `<a class="btn${(f.status || "") === key ? " on" : ""}" href="${esc(link({ status: key }))}" style="${(f.status || "") === key ? "background:#1d2327;border-color:#1d2327;color:#fff" : ""}">${label}<b style="margin-left:6px;opacity:.75">${n}</b></a>`;
  const row = (r) => {
    const href = `${R}/r/${encodeURIComponent(r.id)}`;
    return `<tr class="row" onclick="location.href=this.dataset.href" data-href="${esc(href)}">
<td class="ref"><a href="${esc(href)}">${esc(r.number || r.id)}</a></td><td>${esc(when(r.ts))}</td>
<td>${r.image ? `<img class="thumb" src="${esc(r.image)}" alt="" style="width:36px;float:left;margin-right:8px">` : ""}${item(r)} ${kindTag(r)}${r.vendor ? `<br><span class="muted">${esc(r.vendor)}</span>` : ""}</td>
<td class="n">${esc(r.qty)}</td><td>${esc(r.type || "")}</td><td>${custLine(r)}</td>
<td><span class="tag ${TAG[r.status] || "tag-off"}">${esc(LABEL[r.status] || r.status)}</span> ${stockTag(r)}${r.messages && r.messages.length ? `<br><span class="muted">${r.messages.length} message${r.messages.length === 1 ? "" : "s"}</span>` : ""}</td>
<td class="n"><a class="btn" href="${esc(href)}">Open →</a></td></tr>`;
  };
  const total = d ? d.total : 0;
  const body = `<div class="hz"><h1>Requests</h1><span class="sw ${cfg.off ? "" : "on"}">${cfg.off ? "OFF for the whole store" : "ON"}</span>${o.user && o.user.role === "admin" ? `<form method="post" action="${R}/control" style="display:inline"><input type="hidden" name="action" value="${cfg.off ? "on" : "off"}"><button type="submit" class="sm" onclick="return confirm('${cfg.off ? "Switch requests back on for every product?" : "Switch requests OFF for the whole store? No product page will show the request button until it is switched on again."}')">${cfg.off ? "Switch on" : "Switch off"}</button></form>` : ""}<form method="post" action="${R}/control" style="display:inline"><input type="hidden" name="action" value="check"><button type="submit" class="sm">Check stock now</button></form></div>
<p class="muted">What customers asked for while it was sold out (and special orders for things we do not list), newest first. New requests are emailed to ${esc((o.emailTo || []).join(", "))} with the customer as reply-to; the worker checks the stock of open requests every half hour and emails the store when one is back. Atlantic time.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
${offProducts.length ? `<div class="note"><b>Requests off for:</b> ${offProducts.map(([pid, v]) => `${esc(v.title || pid)} <span class="muted">(${esc(v.by || "")}, ${esc(when(v.at))})</span> <form method="post" action="${R}/control" style="display:inline"><input type="hidden" name="action" value="product-on"><input type="hidden" name="product" value="${esc(pid)}"><button type="submit" class="sm">back on</button></form>`).join(" · ")}</div>` : ""}
<div class="tabs">${tab("", "All", total)}${STATUSES.map((s) => tab(s, LABEL[s], counts[s] || 0)).join("")}</div>
<form method="get" action="${R}" class="find" style="border-color:#dde3e7"><input type="hidden" name="status" value="${esc(f.status || "")}">
<select class="text" name="type" style="flex:0 1 220px"><option value="">Every product type</option>${types.map((t) => `<option value="${esc(t)}" ${f.type === t ? "selected" : ""}>${esc(t)} (${(d.types || {})[t]})</option>`).join("")}</select>
<select class="text" name="days" style="flex:0 1 160px">${[["", "Any date"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"]].map(([v, l]) => `<option value="${v}" ${(f.days || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
<input class="text" type="search" name="q" value="${esc(f.q || "")}" placeholder="Customer name, email, item, reference…"><button type="submit" class="save">Filter</button>${f.type || f.days || f.q ? `<a class="btn" href="${esc(link({ type: "", days: "", q: "" }))}">Clear</a>` : ""}<span class="hint">Open requests always show, whatever the date.</span></form>
<div class="list"><table><thead><tr><th>Ref</th><th>Asked</th><th>Item</th><th class="n">Qty</th><th>Type</th><th>Customer</th><th>Status</th><th></th></tr></thead>
<tbody>${records.length ? records.map(row).join("") : `<tr><td colspan="8" class="muted" style="padding:18px">No requests${f.q || f.type || f.days || f.status ? " match" : " yet"}.</td></tr>`}</tbody></table></div>
<p class="muted" style="margin-top:14px">Decided requests (ordered, arrived, closed, declined) stay listed for 180 days; open ones stay until decided.</p>`;
  return shell("Requests", body, o, true);
}

export function renderRequest(r, o) {
  const cfg = o.cfg || {};
  const productOff = !!(r.productId && cfg.offProducts && cfg.offProducts[r.productId]);
  const msg = (m) => `<li style="padding:8px 0"><b>${m.from === "staff" ? esc(m.by || "staff") : esc(r.name || r.email)}</b> <span class="muted">${esc(when(m.ts))}${m.email ? " · " + (m.email.status === "sent" ? "emailed" : m.email.status === "kept" ? "not emailed" : "email " + esc(m.email.status) + (m.email.error ? " (" + esc(m.email.error) + ")" : "")) : ""}</span><div style="white-space:pre-line;margin-top:2px">${esc(m.text)}</div></li>`;
  const ev = (e) => `<li>${esc(when(e.ts))} · ${esc(e.action)}${e.by ? " · " + esc(e.by) : ""}${e.note ? " · " + esc(e.note) : ""}</li>`;
  const mail = r.mail || {};
  const mailLine = (k, label) => mail[k] ? `${label}: ${mail[k].status === "sent" ? "sent" : esc(mail[k].status) + (mail[k].error ? " (" + esc(mail[k].error) + ")" : "")}` : "";
  const body = `<div class="hz"><h1>${esc(r.number)} <span class="tag ${TAG[r.status] || "tag-off"}">${esc(LABEL[r.status] || r.status)}</span> ${kindTag(r)} ${stockTag(r)}</h1></div>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="card"><div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">${r.image ? `<img src="${esc(r.image)}" alt="" style="width:110px;border-radius:8px;background:#eef2f4">` : ""}<div style="flex:1 1 300px">
<h3>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${item(r)}</a>` : item(r)}</h3>
<div class="kv"><div><span>Quantity wanted</span><b>${esc(r.qty)}</b></div><div><span>Product type</span><b>${esc(r.type || "-")}</b></div><div><span>Vendor</span><b>${esc(r.vendor || "-")}</b></div><div><span>Asked</span><b>${esc(when(r.ts))}</b></div>
<div><span>Stock now</span><b>${r.stock && r.stock.checkedAt ? (r.stock.available ? "in stock" : "sold out") + (r.stock.qty != null ? " (" + esc(r.stock.qty) + ")" : "") + ` <span class="muted" style="font-size:11px">checked ${esc(when(r.stock.checkedAt))}</span>` : (r.kind === "special" ? "not a listed item" : "not checked yet")}</b></div>
${r.productId ? `<div><span>Product id</span><b>${esc(r.productId)}${r.variantId ? " / " + esc(r.variantId) : ""}</b></div>` : ""}</div>
${r.note ? `<div class="note"><b>Customer's note:</b> <span style="white-space:pre-line">${esc(r.note)}</span></div>` : ""}</div></div></div>
<div class="card"><h3>Customer</h3><div class="kv"><div><span>Name</span><b>${esc(r.name || "-")}</b></div><div><span>Email</span><b><a href="mailto:${esc(r.email)}?subject=${encodeURIComponent("Re: your request " + r.number)}">${esc(r.email)}</a></b></div><div><span>Account</span><b>${r.customerId ? `<a href="${esc(o.adminCustomer + r.customerId)}" target="_blank" rel="noopener">signed in · customer ${esc(r.customerId)}</a>` : "not signed in"}</b></div></div>
<p class="muted" style="margin:6px 0 0">${[mailLine("staff", "Store notice"), mailLine("confirm", "Customer confirmation")].filter(Boolean).join(" · ") || "No emails recorded yet."}</p></div>
<div class="card"><h3>Conversation</h3>${r.messages && r.messages.length ? `<ul class="ev">${r.messages.map(msg).join("")}</ul>` : `<p class="muted">Nothing said yet. A reply below goes to ${esc(r.email)} by email from ${esc((o.emailTo || [])[0] || "the store")}; replies they send come back to that inbox.</p>`}
<form method="post" action="${R}/control" style="margin-top:10px"><input type="hidden" name="action" value="reply"><input type="hidden" name="id" value="${esc(r.id)}">
<textarea class="text" name="text" placeholder="Write to ${esc(r.name || "the customer")}…" required></textarea>
<div class="act"><button type="submit" class="ok">Send by email</button><label class="chk"><input type="checkbox" name="send" value="0"> Just note it here, do not email</label></div></form></div>
<div class="card"><h3>Status</h3><form method="post" action="${R}/control"><input type="hidden" name="action" value="mark"><input type="hidden" name="id" value="${esc(r.id)}">
<div class="act">${STATUSES.map((s) => `<button type="submit" name="status" value="${s}" class="${s === "declined" ? "no" : s === "arrived" ? "ok" : ""}" ${r.status === s ? "disabled" : ""}>${LABEL[s]}</button>`).join("")}</div>
<p class="muted" style="margin:8px 0 0">Ordered: we have placed the order. Arrived: it is here for them (tell them above). Closed: done. Declined: not coming back (tell them above).</p>
<input class="text" name="note" value="${esc(r.staffNote || "")}" placeholder="Staff note (kept with the status)" style="margin-top:8px;width:100%"></form>
<h3 style="margin-top:16px">Requests for this product</h3>
${r.productId ? `<form method="post" action="${R}/control"><input type="hidden" name="action" value="${productOff ? "product-on" : "product-off"}"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="product" value="${esc(r.productId)}"><input type="hidden" name="title" value="${esc(r.title)}"><div class="act"><button type="submit" class="${productOff ? "" : "no"}">${productOff ? "Take requests for this product again" : "Stop taking requests for this product"}</button><span class="muted">${productOff ? "Off: its page shows no request button." : "For a hot product we know we are never getting back in: its page stops showing the button; open requests stay here."}</span></div></form>` : `<p class="muted">A special order names no listed product.</p>`}</div>
<div class="card"><h3>History</h3><ul class="ev">${(r.events || []).slice().reverse().map(ev).join("")}</ul></div>
<p><a href="${R}">← All requests</a></p>`;
  return shell(r.number + " · " + r.title, body, o, true);
}
