/**
 * Printable pull sheet: the same page the userscript used to open in a new tab,
 * now served by the worker at GET /print/:id from the stored job, so any sheet
 * can be printed again at any time. Page per game, images and page-breaks
 * switchable, toner-friendly print CSS.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (a, c) => { const n = Number(a); if (!isFinite(n) || !a) return ''; return (c === 'USD' ? 'US$' : '$') + n.toFixed(2); };
const splitCond = (cond) => {
  const c = cond || ''; let tag = '';
  if (/reverse\s*holo(foil)?/i.test(c)) tag = 'REV HOLO'; else if (/holo(foil)?/i.test(c)) tag = 'HOLO'; else if (/\bfoil\b/i.test(c)) tag = 'FOIL';
  return { base: c.replace(/reverse|holofoil|holo|foil/gi, '').replace(/\s{2,}/g, ' ').trim(), tag };
};
const ordersBadge = (orders) => (orders || []).map((o) => esc(o.name) + (o.qty > 1 ? `<span class="ox">×${o.qty}</span>` : '')).join('<span class="osep"> · </span>');
const qtyCell = (q) => (q > 1 ? `<span class="qb">${q}</span>` : `<span class="q1">${q}</span>`);
const imgCell = (url) => (url ? `<img class="thumb" src="${esc(url)}" alt="" loading="lazy">` : '<span class="noimg"></span>');
const subline = (r) => {
  const parts = [];
  if (r.rarity) parts.push(`<span class="rar">${esc(r.rarity)}</span>`);
  if (r.sku) parts.push(`<span class="sku">${esc(r.sku)}</span>`);
  if (r.price) parts.push(`<span class="prc">${esc(money(r.price, r.currency))}</span>`);
  return parts.length ? `<span class="sub">${parts.join('<span class="ssep"> · </span>')}</span>` : '';
};
const THEAD = `<thead><tr><th class="chk"></th><th class="im"></th><th class="cn">#</th><th>Card</th><th class="cond">Condition</th><th class="q">Qty</th><th>Order</th></tr></thead>`;
const cardRow = (r, alt) => {
  const { base, tag } = splitCond(r.cond);
  const tagHtml = tag ? `<span class="fin fin-${tag.split(' ')[0].toLowerCase()}">${tag}</span>` : '';
  return `<tr class="card${alt ? ' alt' : ''}"><td class="chk"><span class="box"></span></td><td class="im">${imgCell(r.img)}</td><td class="cn">${esc(r.collector || '')}</td><td class="nm"><span class="cardname">${esc(r.card)}</span>${subline(r)}</td><td class="cond">${esc(base)}${tagHtml}</td><td class="q">${qtyCell(r.qty)}</td><td class="ord">${ordersBadge(r.orders)}</td></tr>`;
};
const sealedRow = (r, alt) => `<tr class="card${alt ? ' alt' : ''}"><td class="chk"><span class="box"></span></td><td class="im">${imgCell(r.img)}</td><td class="cn"></td><td class="nm"><span class="cardname">${esc(r.card)}</span>${subline(r)}</td><td class="cond"></td><td class="q">${qtyCell(r.qty)}</td><td class="ord">${ordersBadge(r.orders)}</td></tr>`;

export function sheetHtml(job) {
  const orders = job.orders || [];
  const when = new Date(job.createdAt || Date.now()).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Halifax' });
  let totalCards = 0;
  const sections = [];
  if (job.sealed && job.sealed.length) {
    let i = 0, body = '';
    for (const r of job.sealed) { totalCards += r.qty; body += sealedRow(r, i++ % 2); }
    sections.push(`<section class="gsec"><h2 class="ghead">Sealed &amp; Accessories</h2><table>${THEAD}<tbody>${body}</tbody></table></section>`);
  }
  for (const g of job.games || []) {
    let body = '';
    for (const st of g.sets || []) {
      const list = st.cards || [];
      totalCards += list.reduce((s, r) => s + r.qty, 0);
      body += `<tr class="set"><td colspan="7">${esc(st.setName)}<span class="setn">${list.length} card${list.length > 1 ? 's' : ''}</span></td></tr>`;
      let i = 0;
      for (const r of list) body += cardRow(r, i++ % 2);
    }
    sections.push(`<section class="gsec"><h2 class="ghead">${esc(g.game || 'Singles')}</h2><table>${THEAD}<tbody>${body}</tbody></table></section>`);
  }
  const meta = `<b>${orders.length}</b> order${orders.length === 1 ? '' : 's'} &nbsp;·&nbsp; <b>${totalCards}</b> card${totalCards === 1 ? '' : 's'} &nbsp;·&nbsp; ${esc(when)} &nbsp;·&nbsp; ${orders.map((o) => esc(o.name)).join(', ')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pull Sheet #${esc(job.id)} · ${orders.length} orders</title>
<style>
  :root{ --ink:#1a1a1a; --mut:#7a7a7a; --line:#e7e7e7; --alt:#fafafa; --accent:#c2371b; --foil:#6a3bd0; --holo:#0a8aa6; }
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact; print-color-adjust:exact}
  body{margin:0; background:#f3f3f1; color:var(--ink); font:14px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .sheet{max-width:1000px; margin:0 auto; background:#fff; padding:28px 30px 40px; box-shadow:0 1px 4px rgba(0,0,0,.12)}
  header{display:flex; align-items:flex-end; justify-content:space-between; border-bottom:2px solid var(--accent); padding-bottom:10px; margin-bottom:6px}
  h1{margin:0; font-size:22px; font-weight:800; letter-spacing:-.02em} h1 .dot{color:var(--accent)}
  .meta{font-size:12px; color:var(--mut); margin:8px 0 4px; text-transform:uppercase; letter-spacing:.06em} .meta b{color:var(--ink); font-weight:700}
  .gsec{break-before:page; margin-top:22px} .gsec:first-of-type{break-before:auto; margin-top:14px}
  .ghead{margin:0 0 6px; padding:0 0 5px; font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--accent); border-bottom:2px solid var(--ink)}
  table{width:100%; border-collapse:collapse}
  thead th{font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--mut); font-weight:700; text-align:left; padding:0 10px 7px; border-bottom:1px solid var(--line)}
  thead th.chk,thead th.cn{width:30px} thead th.im{width:44px} thead th.q{width:46px; text-align:center} thead th.cond{width:190px}
  tr.set td{padding:11px 10px 5px; font-size:14px; font-weight:700; color:var(--ink)} tr.set .setn{float:right; font-size:11px; font-weight:600; color:var(--mut)}
  tr.card td{padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top} tr.card.alt td{background:var(--alt)}
  td.chk{width:30px} td.chk .box{display:inline-block; width:14px; height:14px; border:1.5px solid #b3b3b3; border-radius:3px; vertical-align:-1px}
  td.cn{width:30px; font-variant-numeric:tabular-nums; font-weight:700; color:#444}
  td.im{width:44px} td.im .thumb{width:36px; height:50px; object-fit:cover; border-radius:3px; border:1px solid var(--line); background:#f0f0f0; display:block}
  td.im .noimg{display:block; width:36px; height:50px; border-radius:3px; border:1px dashed #ddd; background:#fafafa}
  td.nm .cardname{font-weight:600} td.nm .sub{display:block; margin-top:1px; font-size:11px} td.nm .rar{color:#3a3a3a; font-weight:700} td.nm .prc{color:#1a7f43; font-weight:800} td.nm .ssep{color:#ccc}
  td.nm .sku{font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--mut)}
  td.cond{width:190px; color:#555}
  .fin{display:inline-block; margin-left:6px; padding:1px 6px; border-radius:10px; font-size:9.5px; font-weight:800; letter-spacing:.05em; vertical-align:1px}
  .fin-foil{background:#efe9fb; color:var(--foil)} .fin-holo,.fin-rev{background:#e3f4f8; color:var(--holo)}
  td.q{width:46px; text-align:center} .q1{color:#555} .qb{display:inline-block; min-width:20px; padding:1px 6px; border-radius:10px; background:var(--accent); color:#fff; font-weight:800; font-size:12px}
  td.ord{font-size:11px; color:var(--mut); white-space:nowrap} td.ord .ox{color:var(--ink); font-weight:700} td.ord .osep{color:#ccc}
  .ctrls{position:fixed; top:14px; right:14px; z-index:9; display:flex; gap:14px; align-items:center; background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px 12px; box-shadow:0 2px 10px rgba(0,0,0,.18); font-size:12px}
  .ctrls label{display:flex; gap:5px; align-items:center; cursor:pointer; color:#333; user-select:none}
  .printbtn{border:none; cursor:pointer; background:var(--ink); color:#fff; font:600 13px sans-serif; padding:8px 16px; border-radius:7px}
  body.no-img td.im, body.no-img th.im{display:none} body.no-break .gsec{break-before:auto}
  @media print{ body{background:#fff} .sheet{box-shadow:none; max-width:none; padding:0} .ctrls{display:none} thead{display:table-header-group}
    tr.card.alt td{background:#fff} tr.set,tr.card{break-inside:avoid} tr.set td{break-after:avoid}
    tr.card td{padding:3.5px 8px} tr.set td{padding:8px 8px 3px} .ghead{margin:0 0 4px} .gsec{margin-top:0}
    .qb{background:none; color:var(--accent); padding:0; min-width:0} .fin{background:none; padding:0 2px} .fin-foil{color:var(--foil)} .fin-holo,.fin-rev{color:var(--holo)}
    @page{margin:10mm} }
</style></head><body>
<div class="ctrls"><label><input type="checkbox" id="optImg" checked> Images</label><label><input type="checkbox" id="optBreak" checked> Page per game</label><button class="printbtn" id="printbtn">Print</button></div>
<div class="sheet"><header><h1>Pull Sheet #${esc(job.id)}<span class="dot">.</span></h1></header><div class="meta">${meta}</div>${sections.join('')}</div>
<script>
document.getElementById('printbtn').addEventListener('click',function(){window.print();});
document.getElementById('optImg').addEventListener('change',function(e){document.body.classList.toggle('no-img',!e.target.checked);});
document.getElementById('optBreak').addEventListener('change',function(e){document.body.classList.toggle('no-break',!e.target.checked);});
</script></body></html>`;
}
