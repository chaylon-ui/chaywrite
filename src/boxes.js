/* ---------------- The four-row boxes behind the case ----------------
   Owner, 2026-11-04: "in the back of the showcase you can see white four
   laners on a shelf that they can click on and then pick the card game, set,
   and then cycle through the four laners like if they were in an actual card
   store where they are alphabetical, sort of a top down view".

   The glass case (src/showcase.js) shows a few hundred picks per game; the
   boxes hold EVERY in-stock single of a game, by set, alphabetical inside a
   set, 3,200 cards to a box (a real 4-row box). Nightly, after the stock
   check's hour, the worker walks Shopify's in-stock singles of each game a
   page at a time (index.js scheduled() -> boxesTick, a few pages every five
   minutes, paced by the API's own cost bucket), parks each page in the stage
   room (Durable Object, strong consistency between ticks), and when a game is
   done the room sorts it into sets and boxes:
     bxs                       the build's state {day, queue, game, cursor, page, done}
     bxp:<game>:<page>         one page of rows, until the game is finalized
     bxi:<game>                {built, count, sets:[{name, n, parts}], boxes:[{n, label, from, to, count}]}
     bx:<game>:<set>:<part>    the set's rows, 400 a part (a DO value is 128 KB at most)
   A row is compact: [name, handle, price, image, variantId, condition, foil, copies];
   the page expands it. The card shown is the best non-foil copy in stock,
   the foil only when that is all there is.

   Routes (index.js): GET /showcase/boxes.json?game=  the shelf: the game's boxes and sets
                      GET /showcase/box.json?game=&n= one box: its sets with their rows
                      the first with &build=1 (staff key) starts a build of that game now
                      and walks pages in the background of the request. */

import { adminGql, throttleWait } from "./price-history.js";

export const BOX_CAP = 3200;             // cards per box, like the real ones
export const PAGE = 80;                  // products per Shopify page (cost ~650 of the 1,000-point bucket)
export const PAGES_PER_TICK = 4;         // per five-minute cron tick
export const PAGES_PER_KICK = 30;        // per staff "build now" request
export const PART = 400;                 // rows per stored part
export const BUILD_HOUR_UTC = 10;        // after the stock check's 09:00Z run
export const STAGE_DO_NAME = "buylist-stage";
export const ORIGIN = "https://exor-binder.nevski.workers.dev";

export const BOX_GAMES = {
  mtg: { label: "Magic", types: ["MTG Single", "Magic: The Gathering Singles"] },
  pokemon: { label: "Pokémon", types: ["Pokemon Single", "Pokemon Japan Singles"] },
  yugioh: { label: "Yu-Gi-Oh!", types: ["Yugioh Single"] },
  onepiece: { label: "One Piece", types: ["One Piece Single"] },
  starwars: { label: "Star Wars", types: ["Star Wars: Unlimited Single"] },
  riftbound: { label: "Riftbound", types: ["Riftbound TCG Singles", "Riftbound: League of Legends Trading Card Game Singles"] },
};
export const GAME_ORDER = Object.keys(BOX_GAMES);

export const PRODUCTS_Q = `query($q:String!,$after:String){products(first:${PAGE},query:$q,after:$after,sortKey:TITLE){pageInfo{hasNextPage endCursor}nodes{title handle featuredImage{url}variants(first:6){nodes{id title price inventoryQuantity availableForSale}}}}}`;

export function queryFor(game) {
  const g = BOX_GAMES[game];
  if (!g) return "";
  return "status:active AND inventory_total:>0 AND (" + g.types.map((t) => "product_type:'" + t.replace(/'/g, "\\'") + "'").join(" OR ") + ")";
}

const isFoil = (v) => /foil|holo/i.test(String((v && v.title) || ""));
export function condOf(title) {
  return String(title || "").replace(/\s*\/\s*(english|normal)\b/gi, "").replace(/\s*-?\s*(foil|holo(foil)?)\s*$/i, "").replace(/\s*\/\s*$/, "").trim();
}
const shortImage = (u) => { if (!u) return ""; u = String(u); return u.indexOf("https://cdn.shopify.com") === 0 ? u.slice("https://cdn.shopify.com".length) : u; };

// One Shopify product -> one compact row, or null when nothing is in stock at a price.
export function rowOf(p) {
  const title = String((p && p.title) || "").trim();
  const m = title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const name = (m ? m[1] : title).trim(), set = m ? m[2].trim() : "";
  if (!name) return null;
  const vs = (((p && p.variants) || {}).nodes || []).filter((v) => v && Number(v.price) > 0 && (Number(v.inventoryQuantity) > 0 || v.availableForSale === true));
  if (!vs.length) return null;
  vs.sort((a, b) => (isFoil(a) - isFoil(b)) || (Number(b.price) - Number(a.price)));
  const v = vs[0];
  const copies = vs.reduce((n, x) => n + Math.max(0, Number(x.inventoryQuantity) || 0), 0);
  return [name, String(p.handle || ""), Number(v.price).toFixed(2), shortImage(p.featuredImage && p.featuredImage.url), String(v.id || "").replace(/\D/g, ""), condOf(v.title), isFoil(v) ? 1 : 0, copies];
}

// Rows -> sets (alphabetical, cards alphabetical inside) -> boxes of BOX_CAP.
export function arrange(rows) {
  const sets = new Map();
  for (const r of rows) {
    const key = String(r.set || "").trim() || "Other";
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(r.row);
  }
  const names = [...sets.keys()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const list = names.map((name) => ({ name, rows: sets.get(name).sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base", numeric: true }) || Number(b[2]) - Number(a[2])) }));
  const boxes = [];
  let cur = null;
  list.forEach((s, i) => {
    if (!cur || (cur.count + s.rows.length > BOX_CAP && cur.count > 0)) { cur = { n: boxes.length + 1, from: i, to: i, count: 0 }; boxes.push(cur); }
    cur.to = i; cur.count += s.rows.length;
  });
  for (const b of boxes) {
    const a = initial(list[b.from].name), z = initial(list[b.to].name);
    b.label = boxes.length === 1 ? "A – Z" : a === z ? a : a + " – " + z;
  }
  return { sets: list, boxes };
}
const initial = (s) => { const m = String(s).match(/[A-Za-z0-9]/); return m ? m[0].toUpperCase() : "#"; };

/* ---------------- the DO side (called by stage.js for /_stage/bx/*) ---------------- */
export async function boxesRoom(cx, p, body, url) {
  const st = cx.storage;
  const b = body || {};
  if (p === "/_stage/bx/state") return { ok: true, state: (await st.get("bxs")) || null };
  if (p === "/_stage/bx/state/put") { await st.put("bxs", b.state || null); return { ok: true }; }
  if (p === "/_stage/bx/page/put") {
    const game = String(b.game || ""), n = Number(b.n) || 0;
    if (!BOX_GAMES[game] || !n || !Array.isArray(b.rows)) return { ok: false, error: "game, n, rows[] required", status: 400 };
    await st.put("bxp:" + game + ":" + n, b.rows);
    return { ok: true };
  }
  if (p === "/_stage/bx/finalize") {
    const game = String(b.game || ""), pages = Number(b.pages) || 0;
    if (!BOX_GAMES[game]) return { ok: false, error: "game required", status: 400 };
    const rows = [];
    for (let n = 1; n <= pages; n++) {
      const page = await st.get("bxp:" + game + ":" + n);
      if (Array.isArray(page)) for (const r of page) rows.push({ set: r.set, row: r.row });
    }
    const { sets, boxes } = arrange(rows);
    // the old index first, so stale parts can go
    const old = await st.get("bxi:" + game);
    const dels = [];
    if (old && Array.isArray(old.sets)) old.sets.forEach((s, i) => { for (let k = 0; k < (s.parts || 1); k++) dels.push("bx:" + game + ":" + i + ":" + k); });
    for (let n = 1; n <= pages; n++) dels.push("bxp:" + game + ":" + n);
    for (let i = 0; i < dels.length; i += 128) await st.delete(dels.slice(i, i + 128));
    const index = { built: cx.now(), count: rows.length, sets: [], boxes };
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i], parts = Math.max(1, Math.ceil(s.rows.length / PART));
      index.sets.push({ name: s.name, n: s.rows.length, parts });
      for (let k = 0; k < parts; k++) await st.put("bx:" + game + ":" + i + ":" + k, s.rows.slice(k * PART, (k + 1) * PART));
    }
    await st.put("bxi:" + game, index);
    return { ok: true, count: rows.length, sets: sets.length, boxes: boxes.length };
  }
  if (p === "/_stage/bx/index") {
    const game = String(url.searchParams.get("game") || "");
    const index = await st.get("bxi:" + game);
    return index ? { ok: true, game, index } : { ok: false, error: "no index for " + game, status: 404 };
  }
  if (p === "/_stage/bx/box") {
    const game = String(url.searchParams.get("game") || ""), n = Number(url.searchParams.get("n")) || 0;
    const index = await st.get("bxi:" + game);
    const box = index && (index.boxes || []).find((x) => x.n === n);
    if (!box) return { ok: false, error: "no such box", status: 404 };
    const sets = [];
    for (let i = box.from; i <= box.to; i++) {
      const s = index.sets[i]; let rows = [];
      for (let k = 0; k < (s.parts || 1); k++) rows = rows.concat((await st.get("bx:" + game + ":" + i + ":" + k)) || []);
      sets.push({ name: s.name, rows });
    }
    return { ok: true, game, built: index.built, box: { n: box.n, label: box.label, count: box.count }, sets };
  }
  return { ok: false, error: "not found", status: 404 };
}

/* ---------------- the worker side ---------------- */
const stub = (env) => env.ROOM.get(env.ROOM.idFromName(STAGE_DO_NAME));
async function call(env, path, body) {
  const r = await stub(env).fetch(new Request(ORIGIN + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined));
  let j; try { j = await r.json(); } catch { j = { ok: false, error: "bad reply" }; }
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Walk up to `pages` pages of the build's current game; finalize when the game ends; move on.
export async function walk(env, state, pages, fetcher) {
  // the global fetch needs its own `this` (a bare reference throws "Illegal invocation" on Workers)
  const cx = { env, fetch: fetcher || ((u, o) => fetch(u, o)) };
  let did = 0;
  while (state.game && did < pages) {
    const r = await adminGql(cx, PRODUCTS_Q, { q: queryFor(state.game), after: state.cursor || null });
    const pr = r.data && r.data.products;
    if (!pr || !Array.isArray(pr.nodes)) throw new Error("products shape");
    const rows = [];
    for (const p of pr.nodes) {
      const row = rowOf(p);
      if (!row) continue;
      const m = String(p.title || "").match(/\[([^\]]+)\]\s*$/);
      rows.push({ set: m ? m[1].trim() : "", row });
    }
    state.page = (state.page || 0) + 1;
    await call(env, "/_stage/bx/page/put", { game: state.game, n: state.page, rows });
    state.rows = (state.rows || 0) + rows.length;
    did++;
    if (pr.pageInfo && pr.pageInfo.hasNextPage && pr.pageInfo.endCursor) {
      state.cursor = pr.pageInfo.endCursor;
      const wait = throttleWait(r.cost, 650);
      if (wait) await sleep(Math.min(wait, 20000));
    } else {
      const f = await call(env, "/_stage/bx/finalize", { game: state.game, pages: state.page });
      state.done = Object.assign({}, state.done, { [state.game]: { at: Date.now(), count: f.count || 0, sets: f.sets || 0, boxes: f.boxes || 0 } });
      state.queue = (state.queue || []).filter((g) => g !== state.game);
      state.game = state.queue[0] || null; state.cursor = null; state.page = 0; state.rows = 0;
      await call(env, "/_stage/bx/state/put", { state });
      break;   // one game per walk: the next tick starts the next one
    }
    await call(env, "/_stage/bx/state/put", { state });
  }
  return { did, game: state.game, page: state.page };
}

// The cron's unit of work. A build starts once a day after BUILD_HOUR_UTC.
export async function boxesTick(env, now) {
  if (!env || !env.SHOPIFY_ADMIN_TOKEN || !env.ROOM) return { skipped: true };
  const t = now || Date.now();
  const j = await call(env, "/_stage/bx/state");
  let state = (j && j.state) || null;
  const today = dayKey(t), hour = new Date(t).getUTCHours();
  if (!state || (!state.game && state.day !== today && hour >= BUILD_HOUR_UTC)) {
    state = { day: today, startedAt: t, queue: GAME_ORDER.slice(), game: GAME_ORDER[0], cursor: null, page: 0, rows: 0, done: (state && state.done) || {} };
    await call(env, "/_stage/bx/state/put", { state });
  }
  if (!state.game) return { idle: true };
  try {
    const w = await walk(env, state, PAGES_PER_TICK);
    return { game: state.game, pages: w.did, page: state.page, rows: state.rows };
  } catch (e) {
    state.error = String((e && e.message) || e).slice(0, 200); state.errorAt = t;
    await call(env, "/_stage/bx/state/put", { state });
    return { game: state.game, error: state.error };
  }
}

// Staff: start a build of one game now and walk it in the background.
export async function kickBuild(env, ctx, game) {
  const j = await call(env, "/_stage/bx/state");
  const state = Object.assign({}, (j && j.state) || {}, { day: dayKey(Date.now()), startedAt: Date.now(), queue: [game], game, cursor: null, page: 0, rows: 0, error: "" });
  await call(env, "/_stage/bx/state/put", { state });
  const run = (async () => {
    try { await walk(env, state, PAGES_PER_KICK); }
    catch (e) { state.error = String((e && e.message) || e).slice(0, 200); state.errorAt = Date.now(); await call(env, "/_stage/bx/state/put", { state }); }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(run); else await run;
  return { ok: true, started: game };
}

const NO_STORE = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const CACHED = (s) => ({ "content-type": "application/json", "cache-control": "public, max-age=" + s, "access-control-allow-origin": "*" });

export async function serveBoxes(request, env, ctx, url, gate) {
  const game = String(url.searchParams.get("game") || "mtg").toLowerCase();
  if (!BOX_GAMES[game]) return new Response(JSON.stringify({ ok: false, error: "no such game" }), { status: 404, headers: NO_STORE });
  if (url.pathname === "/showcase/boxes.json" && url.searchParams.get("build") === "1") {
    if (!(await gate(env, url.origin, url.searchParams.get("k")))) return new Response(JSON.stringify({ ok: false, error: "staff key required" }), { status: 403, headers: NO_STORE });
    const k = await kickBuild(env, ctx, game);
    return new Response(JSON.stringify(k), { headers: NO_STORE });
  }
  if (url.pathname === "/showcase/boxes.json" && url.searchParams.get("state") === "1") {
    if (!(await gate(env, url.origin, url.searchParams.get("k")))) return new Response(JSON.stringify({ ok: false, error: "staff key required" }), { status: 403, headers: NO_STORE });
    return new Response(JSON.stringify(await call(env, "/_stage/bx/state")), { headers: NO_STORE });
  }
  const cache = caches.default;
  const key = new Request(new URL(url.pathname + "?game=" + game + (url.pathname === "/showcase/box.json" ? "&n=" + (Number(url.searchParams.get("n")) || 1) : ""), url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let out, ttl;
  if (url.pathname === "/showcase/box.json") {
    const n = Number(url.searchParams.get("n")) || 1;
    const j = await call(env, "/_stage/bx/box?game=" + game + "&n=" + n);
    if (!j.ok) return new Response(JSON.stringify(j), { status: j.status || 404, headers: NO_STORE });
    out = j; ttl = 3600;
  } else {
    const j = await call(env, "/_stage/bx/index?game=" + game);
    if (!j.ok) return new Response(JSON.stringify({ ok: false, game, label: BOX_GAMES[game].label, boxes: [], sets: [], count: 0, error: "no boxes yet" }), { headers: CACHED(120) });
    const ix = j.index;
    out = { ok: true, game, label: BOX_GAMES[game].label, built: ix.built, count: ix.count, boxes: ix.boxes, sets: ix.sets.map((s) => ({ name: s.name, n: s.n })) }; ttl = 600;
  }
  const res = new Response(JSON.stringify(out), { headers: CACHED(ttl) });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
