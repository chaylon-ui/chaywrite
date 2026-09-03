/* Exor Games - catalogue enrichment (books/manga + board games).
 *
 * Why: /collections/manga and the board-game collections had nothing to
 * filter by. Measured 2026-09-03: 1,869 products of type "Books" and every
 * board game carry ZERO tags, vendor = the distributor, and the only option
 * is "Title / Default Title". Shopify's filters read tags, options and
 * metafields, so there was literally nothing for a filter UI to stand on.
 *
 * What this does, nightly and idempotently: fills the `exor.*` metafield
 * definitions (created 2026-09-03) so filters have real data, and stamps
 * `exor.enriched_at` so a product is never re-done.
 *
 *   Books   - series, volume and format come from OUR OWN title, which is
 *             the reliable source: "Attack on Titan 24" -> Attack on Titan
 *             / 24, "BLUE LOCK OMNIBUS 4" -> Blue Lock / 4 / Omnibus. The
 *             variant barcode is an ISBN-13 (978/979 Bookland prefix), kept
 *             in exor.isbn so a later pass can add author and publisher.
 *             No external API, so this phase runs at Admin-API speed.
 *
 *   Games   - the barcode is a plain UPC, which no free game database
 *             indexes, so these match on title against BoardGameGeek's
 *             XML API2. A single exact name match is accepted; several
 *             exact matches (reprints, reimplementations) are recorded as
 *             `ambiguous` and NO game data is written - a wrong player
 *             count is worse than none. Setting exor.bgg_id by hand
 *             resolves one permanently: the next sweep sees the id and
 *             fetches it directly, never searching again.
 *
 * Going forward: new products arrive from BinderPOS with barcode + title as
 * usual, have no exor.enriched_at, and the next nightly sweep picks them up.
 * Nothing writes to title, price, inventory or tags, so BinderPOS's sync is
 * never fought over - only the exor.* namespace is touched.
 *
 * Runs in the Durable Object named ENRICH_DO, on its own alarm, the same
 * shape as src/price-history.js (cursor persisted every page, wall-clock
 * budget per tick, throttle pacing read off Shopify's own throttleStatus).
 */

import { adminGql, throttleWait, dayOf, dateOf } from "./price-history.js";

export const ENRICH_DO = "enrich";

export const RUN_HOUR_UTC = 6;         // 02:00 Atlantic, ahead of the 08:00 price run
export const PAGE = 100;               // products per Admin page
export const TICK_MS = 20000;          // wall budget for one alarm tick
export const RETRY_FAILED_MS = 3600000;
export const BGG_GAP_MS = 2200;        // BoardGameGeek asks for ~1 request / 2s
export const BGG_TRIES_202 = 4;        // it answers 202 while it builds a response
export const MAX_MECHANICS = 12;

export const BOOKS_QUERY = "product_type:Books AND status:active";
export const GAMES_QUERY = "product_type:'Board Games' AND status:active";

const DAY_MS = 86400000;
const msg = (e) => String((e && e.message) || e || "error");

export function nextRunAt(now) {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0);
  return at > now ? at : at + DAY_MS;
}

/* ---- pure parsing: books ----------------------------------------------------- */

/* Our own titles are ALL CAPS about half the time ("HAIKYU!! VOL. 36") and
   mixed case the rest ("Attack on Titan 24"). Only re-case the shouting
   ones; a title that already has a lowercase letter is left exactly alone. */
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with"]);

export function titleCase(s) {
  const t = String(s || "");
  if (!t || /[a-z]/.test(t)) return t;
  return t.toLowerCase().split(" ").map((w, i) => {
    const bare = w.replace(/[^a-z0-9]/g, "");
    if (i > 0 && SMALL_WORDS.has(bare)) return w;
    return w.replace(/[a-z]/, (c) => c.toUpperCase());
  }).join(" ");
}

/* Most specific first: "DELUXE EDITION HARDCOVER" is a Deluxe, not a
   Hardcover. Every match is stripped from the working title either way, so
   the series never keeps a format word. */
const FORMATS = [
  ["Deluxe", /\bdeluxe(?:\s+edition)?\b/i],
  ["Box set", /\bbox(?:ed)?\s*set\b/i],
  ["Omnibus", /\bomnibus\b/i],
  ["Hardcover", /\bhard\s?cover\b|\bhc\b/i],
  ["Paperback", /\b(?:soft\s?cover|paperback|tpb?)\b/i],
];

/* A bare trailing number is a volume only up to this. Without the cap,
   "SOME ARTBOOK 2024" would be filed as volume 2024. An explicit marker
   ("VOL. 250") is trusted at any size. */
export const BARE_VOLUME_MAX = 200;

export function parseBookTitle(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return { series: "", volume: null, format: "" };

  let format = "";
  for (let i = 0; i < FORMATS.length; i++) {
    if (FORMATS[i][1].test(t)) {
      if (!format) format = FORMATS[i][0];
      t = t.replace(FORMATS[i][1], " ");
    }
  }
  t = t.replace(/\s+/g, " ").trim();

  let volume = null;
  let m = t.match(/\b(?:vol\.?|volume|v\.|#|no\.?|book|part)\s*(\d{1,4})\s*$/i);
  if (m) {
    volume = Number(m[1]);
    t = t.slice(0, m.index);
  } else {
    m = t.match(/\s(\d{1,4})\s*$/);
    if (m && Number(m[1]) <= BARE_VOLUME_MAX) {
      volume = Number(m[1]);
      t = t.slice(0, m.index);
    }
  }

  t = t.replace(/[\s,:;\-–—]+$/, "").replace(/\s+/g, " ").trim();
  return {
    series: titleCase(t),
    volume: volume,
    format: format || (volume != null ? "Single volume" : ""),
  };
}

/* 978/979 Bookland prefix = a real ISBN-13. Anything else in the barcode
   field (a plain UPC, an internal SKU) is not one and is not stored. */
export function isbnOf(barcode) {
  const b = String(barcode || "").replace(/[^0-9Xx]/g, "");
  return (b.length === 13 && /^97[89]/.test(b)) ? b : "";
}

/* ---- pure parsing: BoardGameGeek XML ---------------------------------------- */

export function decodeXml(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function attr(attrs, name) {
  const m = String(attrs || "").match(new RegExp("\\b" + name + '="([^"]*)"'));
  return m ? decodeXml(m[1]) : "";
}

/* <item type="boardgame" id="266192"><name type="primary" value="Wingspan"/>
   <yearpublished value="2019"/></item> -> [{id, name, year}] */
export function parseBggSearch(xml) {
  const out = [];
  const re = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(String(xml || "")))) {
    if (attr(m[1], "type") !== "boardgame") continue;
    const id = Number(attr(m[1], "id"));
    if (!Number.isFinite(id) || id <= 0) continue;
    const inner = m[2];
    let nm = inner.match(/<name\b([^>]*\btype="primary"[^>]*)\/?>/);
    if (!nm) nm = inner.match(/<name\b([^>]*)\/?>/);
    if (!nm) continue;
    const name = attr(nm[1], "value");
    if (!name) continue;
    const yr = inner.match(/<yearpublished\b([^>]*)\/?>/);
    out.push({ id: id, name: name, year: yr ? Number(attr(yr[1], "value")) || null : null });
  }
  return out;
}

export function parseBggThing(xml) {
  const s = String(xml || "");
  const one = (tag) => {
    const m = s.match(new RegExp("<" + tag + "\\b([^>]*)\\/?>"));
    if (!m) return null;
    const v = Number(attr(m[1], "value"));
    return Number.isFinite(v) ? v : null;
  };
  const links = [];
  const lre = /<link\b([^>]*)\/?>/g;
  let m;
  while ((m = lre.exec(s))) links.push({ type: attr(m[1], "type"), value: attr(m[1], "value") });

  const mechanics = [];
  for (let i = 0; i < links.length; i++) {
    if (links[i].type === "boardgamemechanic" && links[i].value && mechanics.length < MAX_MECHANICS) {
      mechanics.push(links[i].value);
    }
  }
  const designer = (links.find((l) => l.type === "boardgamedesigner") || {}).value || "";

  const wm = s.match(/<averageweight\b([^>]*)\/?>/);
  const weightRaw = wm ? Number(attr(wm[1], "value")) : NaN;
  const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? Math.round(weightRaw * 100) / 100 : null;

  const playing = one("playingtime");
  return {
    playersMin: one("minplayers"),
    playersMax: one("maxplayers"),
    playtimeMin: one("minplaytime") || playing,
    playtimeMax: one("maxplaytime") || playing,
    ageMin: one("minage"),
    weight: weight,
    mechanics: mechanics,
    designer: designer,
  };
}

/* Retail titles carry things BGG never has in its name. Strip those before
   comparing, then reduce both sides to lowercase alphanumerics. */
const TITLE_NOISE = /\b(board\s*game|card\s*game|the\s+game|base\s*set|core\s*set|english|edition|ed\.?|2nd|second|retail|standard)\b/gi;

export function normTitle(s) {
  return String(s || "")
    .replace(/&amp;/gi, "&")
    .replace(/[‘’ʼ]/g, "'")
    .replace(TITLE_NOISE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* One exact name match is taken. Several exact matches means reprints or
   reimplementations sharing a name - writing one of them at random would
   put a wrong player count on the page, so nothing is written and the
   product is flagged for a single human pick instead. */
export function chooseBggMatch(candidates, ourTitle) {
  const want = normTitle(ourTitle);
  const list = Array.isArray(candidates) ? candidates : [];
  if (!want) return { status: "notfound", candidates: [] };
  const exact = list.filter((c) => c && normTitle(c.name) === want);
  if (exact.length === 1) return { status: "ok", id: exact[0].id, name: exact[0].name };
  if (exact.length > 1) {
    const sorted = exact.slice().sort((a, b) => (a.year || 9999) - (b.year || 9999));
    return { status: "ambiguous", candidates: sorted.slice(0, 5).map((c) => c.id) };
  }
  return { status: "notfound", candidates: list.slice(0, 5).map((c) => c.id) };
}

/* ---- pure: metafield payloads ------------------------------------------------ */

const MF = (ownerId, key, type, value) => ({ ownerId, namespace: "exor", key, type, value: String(value) });

export function bookMetafields(ownerId, title, barcode, today) {
  const p = parseBookTitle(title);
  const out = [];
  if (p.series) out.push(MF(ownerId, "series", "single_line_text_field", p.series));
  if (p.volume != null) out.push(MF(ownerId, "volume", "number_integer", p.volume));
  if (p.format) out.push(MF(ownerId, "book_format", "single_line_text_field", p.format));
  const isbn = isbnOf(barcode);
  if (isbn) out.push(MF(ownerId, "isbn", "single_line_text_field", isbn));
  out.push(MF(ownerId, "enrich_status", "single_line_text_field", p.series ? "ok" : "notfound"));
  out.push(MF(ownerId, "enriched_at", "single_line_text_field", today));
  return out;
}

export function gameMetafields(ownerId, bggId, thing, today) {
  const out = [];
  if (Number.isFinite(bggId)) out.push(MF(ownerId, "bgg_id", "number_integer", bggId));
  if (thing) {
    if (thing.playersMin != null) out.push(MF(ownerId, "players_min", "number_integer", thing.playersMin));
    if (thing.playersMax != null) out.push(MF(ownerId, "players_max", "number_integer", thing.playersMax));
    if (thing.playtimeMin != null) out.push(MF(ownerId, "playtime_min", "number_integer", thing.playtimeMin));
    if (thing.playtimeMax != null) out.push(MF(ownerId, "playtime_max", "number_integer", thing.playtimeMax));
    if (thing.ageMin != null) out.push(MF(ownerId, "age_min", "number_integer", thing.ageMin));
    if (thing.weight != null) out.push(MF(ownerId, "weight", "number_decimal", thing.weight));
    if (thing.mechanics && thing.mechanics.length) out.push(MF(ownerId, "mechanics", "list.single_line_text_field", JSON.stringify(thing.mechanics)));
    if (thing.designer) out.push(MF(ownerId, "designer", "single_line_text_field", thing.designer));
  }
  out.push(MF(ownerId, "enrich_status", "single_line_text_field", thing ? "ok" : "notfound"));
  out.push(MF(ownerId, "enriched_at", "single_line_text_field", today));
  return out;
}

/* A product flagged for a human pick gets the flag and the date, nothing
   else: no half-right game data reaches the storefront. */
export function flagMetafields(ownerId, status, today) {
  return [
    MF(ownerId, "enrich_status", "single_line_text_field", status),
    MF(ownerId, "enriched_at", "single_line_text_field", today),
  ];
}

export function parseProductPage(data) {
  const pr = data && data.products;
  const nodes = (pr && pr.nodes) || [];
  const items = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || !n.id) continue;
    const v = (n.variants && n.variants.nodes && n.variants.nodes[0]) || null;
    items.push({
      id: n.id,
      title: String(n.title || ""),
      barcode: v ? String(v.barcode || "") : "",
      enriched: n.enriched ? String(n.enriched.value || "") : "",
      bggId: n.bgg && n.bgg.value ? Number(n.bgg.value) : null,
    });
  }
  return {
    items,
    cursor: (pr && pr.pageInfo && pr.pageInfo.endCursor) || null,
    hasNext: !!(pr && pr.pageInfo && pr.pageInfo.hasNextPage),
  };
}

/* ---- Shopify + BoardGameGeek I/O -------------------------------------------- */

const PRODUCT_PAGE = `query($q:String!,$n:Int!,$after:String){
  products(first:$n, query:$q, sortKey:ID, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      id title
      enriched: metafield(namespace:"exor", key:"enriched_at"){ value }
      bgg: metafield(namespace:"exor", key:"bgg_id"){ value }
      variants(first:1){ nodes{ barcode } }
    }
  }
}`;

const SET_METAFIELDS = `mutation($mf:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$mf){ userErrors{ field message } }
}`;

export const SET_CHUNK = 25;   // metafieldsSet accepts 25 per call

/* Our retail title is not what BGG calls the game; strip the retail noise
   before searching or the query returns nothing at all. */
export function searchTermFor(title) {
  return String(title || "").replace(TITLE_NOISE, " ").replace(/\s+/g, " ").trim();
}

async function fetchPage(cx, query, cursor, n) {
  const r = await adminGql(cx, PRODUCT_PAGE, { q: query, n: n, after: cursor });
  const page = parseProductPage(r.data);
  page.wait = throttleWait(r.cost, 30);
  return page;
}

async function writeMetafields(cx, list) {
  let wrote = 0;
  for (let i = 0; i < list.length; i += SET_CHUNK) {
    const chunk = list.slice(i, i + SET_CHUNK);
    const r = await adminGql(cx, SET_METAFIELDS, { mf: chunk });
    const errs = (r.data && r.data.metafieldsSet && r.data.metafieldsSet.userErrors) || [];
    if (errs.length) throw new Error("metafieldsSet: " + JSON.stringify(errs).slice(0, 200));
    wrote += chunk.length;
  }
  return wrote;
}

/* BoardGameGeek answers 202 while it builds a response and 429 when pushed.
   One request every BGG_GAP_MS, tracked on the DO's in-memory scratch so the
   pace survives across items inside a tick. */
async function bggGet(cx, url) {
  for (let i = 0; i < BGG_TRIES_202; i++) {
    const last = (cx.mem && cx.mem.lastBgg) || 0;
    const wait = BGG_GAP_MS - (cx.now() - last);
    if (wait > 0) await cx.sleep(wait);
    if (cx.mem) cx.mem.lastBgg = cx.now();
    const r = await cx.fetch(url, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(20000) });
    if (r.status === 202) { await cx.sleep(1500); continue; }
    if (r.status === 429) { await cx.sleep(5000); continue; }
    if (!r.ok) throw new Error("bgg HTTP " + r.status);
    return await r.text();
  }
  throw new Error("bgg still queueing after " + BGG_TRIES_202 + " tries");
}

/* One board game -> { status, metafields }. A product that already carries
   exor.bgg_id skips the search entirely and is fetched directly, which is
   how a human's one-time pick becomes permanent. */
export async function enrichGame(cx, item, dateStr) {
  let id = Number.isFinite(item.bggId) && item.bggId > 0 ? item.bggId : null;
  if (!id) {
    const term = searchTermFor(item.title);
    if (!term) return { status: "notfound", metafields: flagMetafields(item.id, "notfound", dateStr) };
    const xml = await bggGet(cx, "https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=" + encodeURIComponent(term));
    const choice = chooseBggMatch(parseBggSearch(xml), item.title);
    if (choice.status !== "ok") return { status: choice.status, metafields: flagMetafields(item.id, choice.status, dateStr) };
    id = choice.id;
  }
  const thing = parseBggThing(await bggGet(cx, "https://boardgamegeek.com/xmlapi2/thing?stats=1&id=" + id));
  return { status: "ok", metafields: gameMetafields(item.id, id, thing, dateStr) };
}

/* ---- the nightly run --------------------------------------------------------- */

const newRun = (day, now) => ({
  day, phase: "books", cursor: null, pending: [], hasNext: true,
  pages: 0, seen: 0, written: 0, skipped: 0, ok: 0, ambiguous: 0, notfound: 0,
  errors: 0, errStreak: 0, throttled: 0, ticks: 0, tickAt: now, done: false,
});

async function arm(cx, at, why) {
  try { await cx.storage.setAlarm(at); }
  catch (e) { cx.log("enrich: setAlarm failed: " + msg(e)); }
  return { at, why };
}

async function finish(cx, run, error) {
  const now = cx.now();
  run.done = true;
  run.finished = now;
  run.ms = now - run.started;
  if (error) run.error = error; else delete run.error;
  const summary = { ...run };
  delete summary.cursor;
  delete summary.pending;
  await cx.storage.put({ "en:run": run, "en:last": summary });
  cx.log("enrich: run " + dateOf(run.day) + (error ? " FAILED: " + error : " finished") +
    " seen=" + run.seen + " written=" + run.written + " ok=" + run.ok +
    " ambiguous=" + run.ambiguous + " notfound=" + run.notfound + " " + run.ms + "ms");
  if (error) return arm(cx, now + RETRY_FAILED_MS, "run failed");
  return arm(cx, dayOf(now) > run.day ? now + 1000 : nextRunAt(now), "run finished");
}

export async function enrichTick(cx) {
  const st = cx.storage;
  const t0 = cx.now();
  const today = dayOf(t0);
  const dateStr = dateOf(today);

  let run = await st.get("en:run");
  if (!run || run.done) {
    const last = await st.get("en:last");
    if (last && last.day === today && !last.error) return arm(cx, nextRunAt(t0), "already ran today");
    run = newRun(today, t0);
    run.started = t0;
    await st.put("en:run", run);
  }
  if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return finish(cx, run, "SHOPIFY_ADMIN_TOKEN not configured");

  run.ticks++;
  run.tickAt = t0;

  while (cx.now() - t0 < TICK_MS) {
    /* Games are drained one at a time: each costs two throttled BGG calls,
       so the leftovers of a page are carried to the next tick rather than
       re-fetched (which would re-spend the BGG budget). */
    if (run.pending && run.pending.length) {
      const item = run.pending[0];
      let res = null;
      try { res = await enrichGame(cx, item, dateStr); }
      catch (e) {
        run.errors++;
        run.errStreak++;
        run.pending.shift();
        await st.put("en:run", run);
        if (run.errStreak >= 8) return finish(cx, run, msg(e));
        continue;
      }
      run.errStreak = 0;
      try { run.written += await writeMetafields(cx, res.metafields); }
      catch (e) { run.errors++; cx.log("enrich: write failed for " + item.id + ": " + msg(e)); }
      run[res.status === "ok" ? "ok" : res.status]++;
      run.pending.shift();
      await st.put("en:run", run);
      continue;
    }

    if (!run.hasNext) {
      if (run.phase === "books") {
        run.phase = "games";
        run.cursor = null;
        run.hasNext = true;
        await st.put("en:run", run);
        continue;
      }
      return finish(cx, run, null);
    }

    let page;
    try { page = await fetchPage(cx, run.phase === "books" ? BOOKS_QUERY : GAMES_QUERY, run.cursor, run.phase === "books" ? PAGE : 25); }
    catch (e) {
      if (e && e.throttled) {
        run.throttled++;
        await st.put("en:run", run);
        return arm(cx, cx.now() + 1500, "throttled");
      }
      run.errors++;
      run.errStreak++;
      await st.put("en:run", run);
      if (run.errStreak >= 5) return finish(cx, run, msg(e));
      return arm(cx, cx.now() + 5000, "page error");
    }

    run.errStreak = 0;
    run.pages++;
    run.cursor = page.cursor;
    run.hasNext = page.hasNext;
    run.seen += page.items.length;

    const fresh = page.items.filter((it) => !it.enriched);
    run.skipped += page.items.length - fresh.length;

    if (run.phase === "books") {
      const mf = [];
      for (let i = 0; i < fresh.length; i++) mf.push(...bookMetafields(fresh[i].id, fresh[i].title, fresh[i].barcode, dateStr));
      if (mf.length) {
        try {
          run.written += await writeMetafields(cx, mf);
          run.ok += fresh.length;
        } catch (e) {
          run.errors++;
          cx.log("enrich: book page write failed: " + msg(e));
        }
      }
    } else {
      run.pending = fresh.map((it) => ({ id: it.id, title: it.title, bggId: it.bggId }));
    }

    await st.put("en:run", run);
    if (page.wait > 0) return arm(cx, cx.now() + page.wait, "throttle pacing");
  }

  await st.put("en:run", run);
  return arm(cx, cx.now() + 1000, "tick budget spent");
}

/* ---- DO plumbing and public routes ------------------------------------------- */

export async function enrichDoAlarm(cx) {
  try { await enrichTick(cx); }
  catch (e) {
    cx.log("enrich: tick threw: " + msg(e));
    await arm(cx, cx.now() + RETRY_FAILED_MS, "tick threw");
  }
}

export async function armEnrichAlarm(cx) {
  try {
    const at = await cx.storage.getAlarm();
    if (at == null) await cx.storage.setAlarm(nextRunAt(cx.now()));
  } catch (e) { cx.log("enrich: armEnrichAlarm failed: " + msg(e)); }
}

function publicRun(run, now) {
  if (!run) return null;
  return {
    day: dateOf(run.day), phase: run.phase, done: !!run.done,
    pages: run.pages, seen: run.seen, written: run.written, skipped: run.skipped,
    ok: run.ok, ambiguous: run.ambiguous, notfound: run.notfound,
    errors: run.errors, throttled: run.throttled, ticks: run.ticks,
    pending: run.pending ? run.pending.length : 0,
    ageMs: run.tickAt ? now - run.tickAt : null,
    error: run.error,
  };
}

export async function statusOf(cx) {
  const now = cx.now();
  const run = await cx.storage.get("en:run");
  const last = await cx.storage.get("en:last");
  let alarm = null;
  try { alarm = await cx.storage.getAlarm(); } catch {}
  const tokenConfigured = !!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN);
  return {
    ok: true,
    tokenConfigured,
    running: !!(run && !run.done),
    current: publicRun(run, now),
    last: publicRun(last, now),
    nextAlarm: alarm ? new Date(alarm).toISOString() : null,
    note: tokenConfigured ? undefined : "SHOPIFY_ADMIN_TOKEN is not set on the worker: the nightly sweep cannot read the catalogue",
  };
}

export async function kickRun(cx) {
  const now = cx.now();
  const run = await cx.storage.get("en:run");
  if (run && !run.done) return { ok: true, started: false, reason: "a run is already open", current: publicRun(run, now) };
  await cx.storage.delete("en:last");
  await cx.storage.put("en:run", { ...newRun(dayOf(now), now), started: now });
  await cx.storage.setAlarm(now + 500);
  return { ok: true, started: true, day: dateOf(dayOf(now)), tokenConfigured: !!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN) };
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
const doJson = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "content-type": "application/json" } });

export async function enrichDoFetch(cx, request, url) {
  await armEnrichAlarm(cx);
  if (url.pathname === "/_en/status") return doJson(await statusOf(cx));
  if (url.pathname === "/_en/run" && request.method === "POST") return doJson(await kickRun(cx));
  return doJson({ ok: false, error: "not found" }, 404);
}

export async function serveEnrich(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const inner = url.pathname === "/enrich/run" ? "/_en/run" : "/_en/status";
  const stub = env.ROOM.get(env.ROOM.idFromName(ENRICH_DO));
  const r = await stub.fetch(new Request(url.origin + inner, { method: request.method }));
  const body = await r.text();
  const h = new Headers(CORS);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(body, { status: r.status, headers: h });
}
