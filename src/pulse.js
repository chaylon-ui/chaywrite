/* src/pulse.js - Market pulse (owner, 2026-10-20: "do ... seven" = a public
   "movers" page from the price history we already collect nightly).

   The nightly singles snapshot (src/price-history.js) now also keeps the
   biggest movers of the last 7 and 30 days: the Near Mint price of every
   tracked single against the price in effect 7 / 30 days earlier, ranked by
   percent, at least $2 on both ends so penny cards do not swamp it. The
   snapshot writes phs:movers once a night; this page reads it, with titles
   and pictures looked up once per run and cached (phs:movers:detail).

   Routes (public): GET /pulse (the page) and GET /pulse.json. The store
   address exorgames.com/pulse is a Shopify URL redirect to the worker's
   /pulse, like /win. Prices are the store's own shelf prices. */

import { PRICE_DO } from "./price-history.js";

const CACHE = "public, max-age=900";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (c) => "$" + (Math.round(c || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const nameOf = (m, d) => (d && d.title) || String(m.h || "").replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
const game = (t) => String(t || "").replace(/\s*singles?\s*$/i, "").trim();

export async function servePulse(request, env, url) {
  if (!env.ROOM) return Response.json({ ok: false, error: "no storage" }, { status: 503 });
  const stub = env.ROOM.get(env.ROOM.idFromName(PRICE_DO));
  let d = { ok: false, ready: false };
  try { d = await (await stub.fetch(new Request("https://" + PRICE_DO + ".internal/_ph/movers?enrich=1"))).json(); } catch (e) { d = { ok: false, ready: false, error: String((e && e.message) || e).slice(0, 120) }; }
  if (url.pathname === "/pulse.json") return Response.json(d, { headers: { "cache-control": CACHE, "access-control-allow-origin": "*" } });
  return new Response(renderPulse(d), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE } });
}

export function renderPulse(d) {
  const detail = (d && d.detail) || {};
  const row = (m) => {
    const x = detail[m.id] || {};
    const up = m.p > 0;
    return `<li class="m"><a class="m__a" href="${esc(x.url || ("https://exorgames.com/products/" + m.h))}">${x.image ? `<img class="m__img" src="${esc(x.image)}" alt="" loading="lazy">` : `<span class="m__img m__img--none"></span>`}<span class="m__body"><span class="m__t">${esc(nameOf(m, x))}</span><span class="m__meta">${esc(game(m.t))}${x.inStock === false ? " · sold out" : x.inStock ? " · in stock" : ""}</span><span class="m__p">${esc(money(m.f))} <span class="m__arr">&rarr;</span> <b>${esc(money(m.c))}</b></span></span><span class="m__pct ${up ? "is-up" : "is-down"}">${up ? "+" : ""}${esc(m.p)}%</span></a></li>`;
  };
  const block = (title, w) => {
    const list = (d && d[w]) || { risers: [], fallers: [], counted: 0 };
    return `<section class="win"><h2>${esc(title)}</h2><p class="muted">${list.counted || 0} singles moved by at least $2 on both ends in this window.</p>
<div class="cols"><div><h3 class="up">Rising</h3>${list.risers && list.risers.length ? `<ol class="list">${list.risers.map(row).join("")}</ol>` : `<p class="muted">Nothing rose.</p>`}</div>
<div><h3 class="down">Falling</h3>${list.fallers && list.fallers.length ? `<ol class="list">${list.fallers.map(row).join("")}</ol>` : `<p class="muted">Nothing fell.</p>`}</div></div></section>`;
  };
  const body = d && d.ready ? block("Last 7 days", "w7") + block("Last 30 days", "w30") : `<section class="win"><p class="muted">The first pulse is taken on the next nightly price snapshot (04:00 Atlantic). Check back tomorrow.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market pulse · Exor Games</title>
<meta name="description" content="Which Magic, Pokémon, Yu-Gi-Oh!, One Piece and Lorcana singles rose and fell on the Exor Games shelf this week.">
<style>
:root{--bg:#121417;--card:#1a1e23;--ink:#e8ecef;--muted:#9aa4ad;--line:#2a3138;--up:#4cc38a;--down:#f27d7d;--brand:#e5322d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.top a{color:var(--ink);text-decoration:none;font-weight:700}.top a:hover{color:var(--brand)}
h1{font-size:28px;margin:8px 0 4px}h2{font-size:20px;margin:28px 0 4px}h3{font-size:15px;margin:14px 0 8px;letter-spacing:.04em;text-transform:uppercase}
h3.up{color:var(--up)}h3.down{color:var(--down)}
.muted{color:var(--muted);margin:0 0 6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:760px){.cols{grid-template-columns:1fr}}
.list{list-style:none;margin:0;padding:0;counter-reset:n}
.m{counter-increment:n}.m__a{display:flex;align-items:center;gap:12px;padding:8px;border:1px solid var(--line);background:var(--card);border-radius:10px;margin:6px 0;color:inherit;text-decoration:none}
.m__a:hover{border-color:var(--brand)}
.m__img{width:48px;height:66px;object-fit:cover;border-radius:4px;flex:0 0 48px;background:#0d0f12}.m__img--none{display:block}
.m__body{flex:1;min-width:0;display:flex;flex-direction:column}
.m__t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.m__meta{color:var(--muted);font-size:13px}.m__p{font-size:14px}.m__arr{color:var(--muted)}
.m__pct{font-weight:800;font-size:15px;flex:0 0 auto;padding:4px 8px;border-radius:999px;background:#0d0f12}
.is-up{color:var(--up)}.is-down{color:var(--down)}
.foot{margin-top:28px;color:var(--muted);font-size:13px}
</style></head><body><div class="wrap">
<div class="top"><a href="https://exorgames.com/">&larr; exorgames.com</a><a href="https://exorgames.com/pages/sell-to-exor-games-bulk-or-create-a-list">Sell us your cards</a></div>
<h1>Market pulse</h1>
<p class="muted">Which singles rose and fell on our shelf, from the prices we snapshot every night. Near Mint price now against the price 7 and 30 days ago.${d && d.date ? " Taken " + esc(d.date) + "." : ""}</p>
${body}
<p class="foot">Our own shelf prices, updated nightly at 04:00 Atlantic. A card that moved is a card worth a look: rising ones to sell us, falling ones to pick up.</p>
</div></body></html>`;
}
