/* ---------------- 9Pocket: the Ask Exor log ----------------
   Owner, 2026-10-29: every question the shop assistant answered, newest
   first, 200 a page, kept until an admin deletes a row, with who asked
   (the signed-in customer's email, else a visitor tag for that browser
   session). Search covers the question, the answer and who asked; "Marked
   wrong only" narrows to flagged rows (by the shopper's "Not right?" or by
   staff here). "Wrong" marks one, "OK after all" clears it; the admin
   switch lives on 9Pocket > Admin. */
import { BASE, shell, esc, when } from "./stage-ui.js";

const R = BASE + "/ask";
const CSS = `.al-find{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.al-find input[type=search]{flex:1 1 240px;padding:10px;border:1px solid #cbd3d9;border-radius:10px;font:inherit;font-size:15px}.al-find .chk{font-size:13px}
.al-sum{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:10px 14px;margin:8px 0;font-size:13px}
.al-row{background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:12px 14px;margin:8px 0}.al-row.flag{border-left:4px solid #b42318}.al-q{font-weight:700;margin:0 0 6px}.al-a{white-space:pre-wrap;word-wrap:break-word;margin:0 0 8px;font-size:14px}.al-a a{word-break:break-all}
.al-m{display:flex;gap:8px 16px;flex-wrap:wrap;align-items:center;font-size:12px;color:#5f6b76}.al-m form{display:inline}.al-m button{padding:5px 10px}.al-bad{color:#b42318;font-weight:700}`;

const linkify = (s) => esc(s).replace(/https?:\/\/[^\s)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?exorgames\.com/, "")}</a>`);

export function renderAskLog(d, o) {
  const rows = (d && d.rows) || [];
  const flagged = rows.filter((r) => r.flag), rest = rows.filter((r) => !r.flag);
  const qs = (extra) => { const s = new URLSearchParams(); if (d && d.q) s.set("q", d.q); if (d && d.onlyFlagged) s.set("flagged", "1"); for (const [k, v] of Object.entries(extra || {})) if (v) s.set(k, v); const t = s.toString(); return t ? "?" + t : ""; };
  const form = (action, fields, label, cls) => o.act ? `<form method="post" action="${R}/control"><input type="hidden" name="action" value="${action}">${fields}<input type="hidden" name="back" value="${esc(qs())}"><button type="submit" class="sm${cls ? " " + cls : ""}">${label}</button></form>` : "";
  const btn = (r, wrong, label) => form("flag", `<input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="wrong" value="${wrong ? "1" : "0"}">`, label, wrong ? "" : "dim");
  const who = (r) => r.who && r.who.email
    ? `<span>asked by <a href="mailto:${esc(r.who.email)}">${esc(r.who.email)}</a> · <a href="https://admin.shopify.com/store/most-wanted-ca/customers?query=${encodeURIComponent(r.who.email)}" target="_blank" rel="noopener">customer ↗</a></span>`
    : `<span title="Not signed in; the tag is the same for every question from that browser session">a visitor${r.who && r.who.visitor ? " #" + esc(r.who.visitor) : ""}</span>`;
  const row = (r) => `<div class="al-row${r.flag ? " flag" : ""}"><p class="al-q">${esc(r.q)}</p><p class="al-a">${r.ok ? linkify(r.a) : `<span class="muted">(no answer: ${esc(r.a)})</span>`}</p><div class="al-m"><span>${esc(when(r.at))}</span>${who(r)}<span>${r.tools && r.tools.length ? "used " + esc(r.tools.join(", ")) : "no tool used"}</span><span>${esc(Math.round((r.ms || 0) / 100) / 10)} s</span>${r.products ? `<span>${esc(r.products)} product card${r.products === 1 ? "" : "s"}</span>` : ""}${r.flag ? `<span class="al-bad">⚠ marked wrong by ${esc(r.flag.by === "shopper" ? "the shopper" : r.flag.by)}, ${esc(when(r.flag.at))}</span>${btn(r, false, "OK after all")}` : btn(r, true, "Wrong")}${o.admin ? form("delete", `<input type="hidden" name="id" value="${esc(r.id)}">`, "Delete", "dim") : ""}</div></div>`;
  const search = `<form method="get" action="${R}" class="al-find"><input type="search" name="q" value="${esc((d && d.q) || "")}" placeholder="Search questions, answers, an email or a visitor tag"><label class="chk"><input type="checkbox" name="flagged" value="1"${d && d.onlyFlagged ? " checked" : ""}> Marked wrong only</label><button type="submit" class="save">Search</button>${d && (d.q || d.onlyFlagged) ? `<a class="btn" href="${R}">Clear</a>` : ""}</form>`;
  const page = `<style>${CSS}</style><div class="hz"><h1>Ask Exor</h1></div>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="al-sum"><span>The assistant is <b>${d && d.on ? "on" : "off"}</b>${o.admin ? ` · <a href="${BASE}/admin">switch it on 9Pocket › Admin</a>` : ""}</span><span>${esc(d && d.total != null ? d.total : rows.length)} answer${(d && d.total) === 1 ? "" : "s"} kept</span><span>${d && d.flagged ? `<b class="al-bad">${esc(d.flagged)} marked wrong</b>` : "none marked wrong"}</span></div>
<p class="muted">What shoppers asked and what it answered, newest first, with who asked (the signed-in customer, or a visitor tag for that browser session). Rows are kept until an admin deletes them. Mark an answer <b>Wrong</b> when it is: the marks tell us what to fix.</p>
${search}
${flagged.length ? `<h2>Marked wrong</h2>${flagged.map(row).join("")}` : ""}
${rest.length ? `<h2>${flagged.length ? "Everything else" : "Answers"}</h2>${rest.map(row).join("")}` : flagged.length ? "" : `<div class="card"><h3>${d && (d.q || d.onlyFlagged) ? "Nothing matches" : "No questions yet"}</h3><p class="muted" style="margin:0">${d && (d.q || d.onlyFlagged) ? "Try another word, or clear the search." : d && d.on ? "Answers will show here as shoppers ask." : "The assistant is off, so nothing is being asked."}</p></div>`}
${d && d.next ? `<p><a class="btn" href="${R}${qs({ before: d.next })}">Older answers</a></p>` : ""}`;
  return shell("Ask Exor", page, o, true);
}

export function renderAskDenied(o) {
  return shell("Ask Exor", `<h1>Ask Exor</h1><div class="err">Your account cannot open the Ask Exor log. Ask an admin for the "Ask Exor" permission on 9Pocket › Admin.</div>`, o, true);
}
