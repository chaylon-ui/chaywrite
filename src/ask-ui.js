/* ---------------- 9Pocket: the Ask Exor log ----------------
   Owner, 2026-10-29: every question the shop assistant answered, newest
   first, kept 30 days (no addresses, no names - only what the shopper
   typed and what was answered). Flagged answers first: by the shopper
   ("Not right?" on the widget) or by staff here. "Wrong" marks one, "OK"
   clears it; the admin switch lives on 9Pocket > Admin. */
import { BASE, shell, esc, when } from "./stage-ui.js";

const R = BASE + "/ask";
const CSS = `.al-sum{display:flex;gap:8px 18px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:10px 14px;margin:8px 0;font-size:13px}
.al-row{background:#fff;border:1px solid #dde3e7;border-radius:12px;padding:12px 14px;margin:8px 0}.al-row.flag{border-left:4px solid #b42318}.al-q{font-weight:700;margin:0 0 6px}.al-a{white-space:pre-wrap;word-wrap:break-word;margin:0 0 8px;font-size:14px}.al-a a{word-break:break-all}
.al-m{display:flex;gap:8px 16px;flex-wrap:wrap;align-items:center;font-size:12px;color:#5f6b76}.al-m form{display:inline}.al-m button{padding:5px 10px}.al-bad{color:#b42318;font-weight:700}`;

const linkify = (s) => esc(s).replace(/https?:\/\/[^\s)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?exorgames\.com/, "")}</a>`);

export function renderAskLog(d, o) {
  const rows = (d && d.rows) || [];
  const flagged = rows.filter((r) => r.flag), rest = rows.filter((r) => !r.flag);
  const btn = (r, wrong, label) => o.act ? `<form method="post" action="${R}/control"><input type="hidden" name="action" value="flag"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="wrong" value="${wrong ? "1" : "0"}"><button type="submit" class="sm${wrong ? "" : " dim"}">${label}</button></form>` : "";
  const row = (r) => `<div class="al-row${r.flag ? " flag" : ""}"><p class="al-q">${esc(r.q)}</p><p class="al-a">${r.ok ? linkify(r.a) : `<span class="muted">(no answer: ${esc(r.a)})</span>`}</p><div class="al-m"><span>${esc(when(r.at))}</span><span>${r.tools && r.tools.length ? "used " + esc(r.tools.join(", ")) : "no tool used"}</span><span>${esc(Math.round((r.ms || 0) / 100) / 10)} s</span>${r.products ? `<span>${esc(r.products)} product card${r.products === 1 ? "" : "s"}</span>` : ""}${r.flag ? `<span class="al-bad">⚠ marked wrong by ${esc(r.flag.by === "shopper" ? "the shopper" : r.flag.by)}, ${esc(when(r.flag.at))}</span>${btn(r, false, "OK after all")}` : btn(r, true, "Wrong")}</div></div>`;
  const page = `<style>${CSS}</style><div class="hz"><h1>Ask Exor</h1></div>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
<div class="al-sum"><span>The assistant is <b>${d && d.on ? "on" : "off"}</b>${o.admin ? ` · <a href="${BASE}/admin">switch it on 9Pocket › Admin</a>` : ""}</span><span>${esc(d && d.total != null ? d.total : rows.length)} answer${(d && d.total) === 1 ? "" : "s"} in the last 30 days</span><span>${flagged.length ? `<b class="al-bad">${flagged.length} marked wrong</b>` : "none marked wrong"}</span></div>
<p class="muted">What shoppers asked and what it answered, newest first; nothing else about them is kept, and rows go after 30 days. Mark an answer <b>Wrong</b> when it is: the marks tell us what to fix.</p>
${flagged.length ? `<h2>Marked wrong</h2>${flagged.map(row).join("")}` : ""}
${rest.length ? `<h2>${flagged.length ? "Everything else" : "Answers"}</h2>${rest.map(row).join("")}` : flagged.length ? "" : `<div class="card"><h3>No questions yet</h3><p class="muted" style="margin:0">${d && d.on ? "Answers will show here as shoppers ask." : "The assistant is off, so nothing is being asked."}</p></div>`}`;
  return shell("Ask Exor", page, o, true);
}

export function renderAskDenied(o) {
  return shell("Ask Exor", `<h1>Ask Exor</h1><div class="err">Your account cannot open the Ask Exor log. Ask an admin for the "Ask Exor" permission on 9Pocket › Admin.</div>`, o, true);
}
