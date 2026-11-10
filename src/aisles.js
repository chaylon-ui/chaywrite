/* ---------------- The 3D shop's aisles and its graded-card cabinet ----------------
   Owner, 2026-11-10: "make the store much larger so we can display all our product on the
   shelves for gunpla, figures, board games, etc.. where you have headers above the aisles
   and ... scroll through all the products we have in stock", and a tall locked glass
   showcase "you can put graded cards in ... take it out of showcase and flip it over to see
   the back ... Fill it with all graded cards", where a card priced $999,999 "says to ask".

   GET /showcase/aisles.json            the aisles, each with its signed sections and how many
                                        products stand in each
   GET /showcase/aisle.json?cat=&sec=&after=  one page (100) of a section's products by title, with
                                        the cursor for the next page: the page walks along a shelf
                                        and asks for more as it goes
   GET /showcase/graded.json            every graded card in stock: front and back photo, grade,
                                        price, and ask:true where the price is the placeholder
   Read from Shopify's Admin API, each answer cached ten minutes. */

import { adminGql } from "./price-history.js";
import { gqlPatient, preorderDate, sealedName } from "./boxes.js";

// Each aisle is shelved the way a shop shelves it: in signed sections (owner, 2026-11-10: "What's a good way
// to organize the boxes? Sort of like how they would be in real life in a store" ... "Do it the best way").
// secs: [key, sign, Shopify search filter], in CLAIM order - a product stands in the first section whose
// filter it meets and in no other, and whatever meets none stands in the last one (rest). order: the keys in
// the order they stand along the shelf, where that differs. Filters checked against the live catalogue
// 2026-11-10 (live probe 42811306178: every aisle's sections add up to the aisle, Gunpla 111 + 19 + 51 + 28 + 35 = 244).
export const AISLES = [
  { key: "gunpla", label: "Gunpla", q: 'product_type:"Gunpla"', rest: "More Gunpla", secs: [
    ["hg", "High Grade", "title:HG*"], ["rg", "Real Grade", "title:RG"], ["mg", "Master Grade", "title:MG"], ["sd", "SD Gundam", "title:SD*"]] },
  { key: "models", label: "Model Kits", q: 'product_type:"Plastic Model Kit"', rest: "More model kits", secs: [
    ["tools", "Tools & supplies", '(title:"HOBBY DETAILS" OR title:"MASTER TOOLS" OR title:"AK INTERACTIVE" OR title:NIPPER* OR title:TWEEZER* OR title:SANDING OR title:"ACTION BASE" OR title:TAPE OR title:BRUSH* OR title:GLUE OR title:CEMENT OR title:"ARMY PAINTER" OR title:VALLEJO OR title:"MR. HOBBY" OR title:"PANEL LINE" OR title:MARKER* OR title:PRIMER OR title:SURFACER OR title:"TOOL KIT")'],
    ["pokemon", "Pokémon kits", "(title:POKEMON OR title:POKÉMON)"], ["rise", "Figure-rise", "title:FIGURE-RISE"], ["30mm", "30 Minutes Missions", "(title:30MM OR title:30MF OR title:30MS)"],
    ["cars", "Cars", '(title:AMT OR title:MPC OR title:"POLAR LIGHTS" OR title:"1/24" OR title:"1/25" OR title:AOSHIMA)'],
    ["planes", "Planes, ships & armour", '(title:"1/72" OR title:"1/48" OR title:"1/35" OR title:"1/32" OR title:"1/700" OR title:"1/350" OR title:"1/200" OR title:"1:72" OR title:"1:48" OR title:"1:200" OR title:"ARMA HOBBY" OR title:TAMIYA OR title:HASEGAWA OR title:ACADEMY OR title:AIRFIX OR title:REVELL)'],
    ["puzzles", "3D puzzles & book nooks", "(title:ROKR OR title:ROLIFE)"], ["blocks", "Building blocks", "(title:IM.MASTER OR title:KOCO)"]],
    order: ["pokemon", "rise", "30mm", "cars", "planes", "puzzles", "blocks", "rest", "tools"] },
  { key: "figures", label: "Figures & Funko", q: '(product_type:"Figures" OR product_type:"Funko")', rest: "More figures", secs: [
    ["funko", "Funko Pop!", '(product_type:"Funko" OR tag:"figline:Funko Pop!")'], ["nendo", "Nendoroid", 'tag:"figline:Nendoroid"'],
    ["shf", "S.H.Figuarts", 'tag:"figline:S.H.Figuarts"'], ["figma", "figma", 'tag:"figline:figma"'], ["pup", "Pop Up Parade", 'tag:"figline:Pop Up Parade"'],
    ["prize", "Prize figures", '(tag:"figline:Banpresto" OR tag:"figline:SEGA Prize")'], ["scale", "Statues & scale figures", '(tag:"figline:ARTFX" OR tag:"figline:MegaHouse" OR tag:"figline:FiguartsZERO")']] },
  { key: "blind", label: "Blind Boxes", q: 'product_type:"Blind Box"', rest: "More blind boxes", secs: [
    ["pokemon", "Pokémon", 'tag:"fig:Pokemon"'], ["mini", "Miniverse", "title:MINIVERSE"],
    ["sanrio", "Sanrio, Kirby & friends", '(title:SANRIO OR title:"HELLO KITTY" OR title:CINNAMOROLL OR title:HANGYODON OR title:KUROMI OR title:KIRBY* OR title:TAMAGOTCHI)'],
    ["anime", "Anime", '(title:GUNDAM OR title:"ONE PIECE" OR title:"DEMON SLAYER" OR title:JUJUTSU OR title:FRIEREN OR title:EVANGELION OR title:"CHAINSAW MAN" OR title:MIKU OR title:JOJO* OR title:GINTAMA OR title:"BLACK BUTLER" OR title:SAKAMOTO OR title:NARUTO OR title:"DRAGON BALL" OR title:"SPY X FAMILY" OR title:"MY HERO" OR title:GHIBLI OR title:"SPIRITED AWAY" OR title:KIKI* OR title:TOTORO)']] },
  { key: "board", label: "Board Games", q: 'product_type:"Board Games"', rest: "More board games", secs: [
    ["chess", "Chess & classics", 'tag:"bg:Chess & Classics"'], ["puzzles", "Puzzles & escape rooms", 'tag:"bg:Puzzles & Escape Rooms"'], ["exp", "Expansions", 'tag:"bg:Expansions"'],
    ["party", "Party games", 'tag:"bg:Party Games"'], ["family", "Family & kids", 'tag:"bg:Family & Kids"'], ["trivia", "Trivia & word", 'tag:"bg:Trivia & Word"'],
    ["bluff", "Deduction & bluffing", 'tag:"bg:Deduction & Bluffing"'], ["coop", "Co-op", 'tag:"bg:Co-op"'], ["two", "2-player", 'tag:"bg:2-Player"'],
    ["card", "Card games", 'tag:"bg:Card Games"'], ["strategy", "Strategy", 'tag:"bg:Strategy"']],
    order: ["family", "party", "strategy", "coop", "card", "two", "bluff", "trivia", "chess", "puzzles", "exp", "rest"] },
  { key: "wargames", label: "Warhammer", q: 'product_type:"Tabletop Wargames"', rest: "More miniatures games", secs: [
    ["paint", "Paint & hobby", '(title:COLOUR OR title:CITADEL OR title:"AK INTERACTIVE" OR title:WARPAINTS OR vendor:"LSG Hobby")'],
    ["hist", "Historical", '(vendor:"Warlord Games" OR vendor:"Fox Crest")'],
    ["terrain", "Terrain & mats", '(title:"BATTLEFIELD IN A BOX" OR title:"TERRAIN CRATE" OR title:BATTLEMAT OR title:MEGAMAT OR title:"BATTLE SYSTEMS" OR title:RAMPART OR title:TENFOLD OR title:TINKERTURF)'],
    ["btech", "BattleTech", "title:BATTLETECH"], ["me", "Middle-earth", '(title:MIDDLE-EARTH OR title:"LORD OF THE RINGS")'],
    ["kt", "Kill Team", 'title:"KILL TEAM"'], ["hh", "Horus Heresy", 'title:"HORUS HERESY"'], ["necro", "Necromunda", "title:NECROMUNDA"],
    ["40k", "Warhammer 40,000", '(title:"WARHAMMER 40,000" OR title:40000 OR title:40K)'], ["aos", "Age of Sigmar", 'title:"AGE OF SIGMAR"'], ["tow", "The Old World", 'title:"OLD WORLD"'],
    ["skirmish", "Underworlds, Warcry & Blood Bowl", '(title:UNDERWORLDS OR title:WARCRY OR title:"BLOOD BOWL" OR title:"WARHAMMER QUEST")'],
    ["books", "Books & magazines", '(title:HARDBACK OR title:PAPERBACK OR title:SOFTBACK OR title:"WHITE DWARF" OR title:CODEX)']],
    order: ["40k", "kt", "hh", "necro", "aos", "tow", "skirmish", "me", "btech", "rest", "hist", "terrain", "books", "paint"] },
];
export const NEW_DAYS = 30, NEW_MAX = 48;   // "New this month": the newest arrivals stand first in each aisle, as well as in their own section
const BASE = "status:active AND published_status:published AND inventory_total:>0 AND ";
export const AISLE_PAGE = 100;
export const ASK_PRICE = 999999;        // the till's placeholder for "not priced yet"

const HEAD = (s) => ({ "content-type": "application/json", "cache-control": s ? "public, max-age=" + s : "no-store", "access-control-allow-origin": "*" });
const json = (o, status, s) => new Response(JSON.stringify(o), { status: status || 200, headers: HEAD(s) });
const run = (env, o, q, v) => gqlPatient(() => (o.gqlFn ? o.gqlFn(q, v) : adminGql({ env, fetch: (u, i) => fetch(u, i) }, q, v)), o.waitMs);
async function cached(o, ctx, keyUrl, build) {
  const cache = o.gqlFn ? null : caches.default, key = new Request(keyUrl);
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out; try { out = await build(); } catch (e) { out = { ok: false, error: String((e && e.message) || e).slice(0, 160) }; }
  const res = json(out, 200, out.ok ? 600 : 0);
  if (out.ok && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const since = (now) => new Date(now - NEW_DAYS * 864e5).toISOString().slice(0, 10);
// the search for one section of an aisle: "new", a section key, or "rest"
export function secQuery(a, key, now) {
  if (key === "new") return BASE + a.q + " AND created_at:>=" + since(now);
  const i = a.secs.findIndex((s) => s[0] === key); if (i < 0 && key !== "rest") return null;
  return BASE + a.q + (i < 0 ? "" : " AND " + a.secs[i][2]) + (i < 0 ? a.secs : a.secs.slice(0, i)).map((s) => " AND NOT " + s[2]).join("");
}
const secKeys = (a) => ["new"].concat(a.order || a.secs.map((s) => s[0]).concat(["rest"]));
const secLabel = (a, k) => (k === "new" ? "New this month" : k === "rest" ? a.rest : (a.secs.find((s) => s[0] === k) || [])[1]);
export function countsQuery(a, now) { return "query{" + secKeys(a).map((k, j) => "s" + j + ":productsCount(query:" + JSON.stringify(secQuery(a, k, now)) + "){count}").join(" ") + "}"; }
export async function serveAisles(request, env, ctx, url, opts) {
  const o = opts || {}, now = o.now || Date.now();
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/aisles.json?v=2", url).toString(), async () => {
    const aisles = [];
    for (const a of AISLES) {   // one aisle at a time: Shopify throttles a burst
      const r = await run(env, o, countsQuery(a, now), {}), d = r.data || {};
      const secs = secKeys(a).map((k, j) => ({ key: k, label: secLabel(a, k), count: Number((d["s" + j] && d["s" + j].count) || 0) })).filter((s) => s.count > 0);
      const count = secs.reduce((n, s) => n + (s.key === "new" ? 0 : s.count), 0);
      secs.forEach((s) => { if (s.key === "new") s.count = Math.min(s.count, NEW_MAX); });
      if (count > 0) aisles.push({ key: a.key, label: a.label, count, secs });
    }
    return { ok: true, aisles };
  });
}

const aisleQ = (sort) => `query($q:String!,$after:String){products(first:${AISLE_PAGE},after:$after,sortKey:${sort},query:$q){pageInfo{hasNextPage endCursor}nodes{title handle media(first:1){nodes{preview{image{url width height}}}} variants(first:1){nodes{id price inventoryQuantity availableForSale}}}}}`;
export const AISLE_Q = aisleQ("TITLE"), AISLE_NEW_Q = aisleQ("CREATED_AT,reverse:true");
// rows [name, handle, price, image | null, picture width / height, variant id, in stock]
export function aisleRows(products, now) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || ""); if (!title) continue;
    const pre = preorderDate(title); if (pre !== null && !(pre <= now)) continue;
    const v = ((p.variants && p.variants.nodes) || [])[0];
    if (!v || !(+v.inventoryQuantity > 0) || !(+v.price > 0) || v.availableForSale === false) continue;
    const pic = ((((p.media && p.media.nodes) || [])[0] || {}).preview || {}).image;
    out.push([sealedName(title), String(p.handle || ""), String(v.price), (pic && pic.url) || null,
      pic && pic.width > 0 && pic.height > 0 ? Math.round((pic.width / pic.height) * 100) / 100 : 1, String(v.id || "").replace(/^.*\//, ""), +v.inventoryQuantity]);
  }
  return out;
}
export async function serveAisle(request, env, ctx, url, opts) {
  const o = opts || {}, now = o.now || Date.now();
  const a = AISLES.find((x) => x.key === String(url.searchParams.get("cat") || "").toLowerCase());
  if (!a) return json({ ok: false, error: "cat must be one of " + AISLES.map((x) => x.key).join(", ") }, 400);
  const sec = String(url.searchParams.get("sec") || "").toLowerCase(), q = sec ? secQuery(a, sec, now) : BASE + a.q;
  if (!q) return json({ ok: false, error: "no such section" }, 400);
  const after = String(url.searchParams.get("after") || "");
  if (after && !/^[A-Za-z0-9+/=_-]{1,600}$/.test(after)) return json({ ok: false, error: "bad cursor" }, 400);
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/aisle.json?cat=" + a.key + "&sec=" + sec + "&after=" + encodeURIComponent(after), url).toString(), async () => {
    const r = await run(env, o, sec === "new" ? AISLE_NEW_Q : AISLE_Q, { q, after: after || null });
    const c = (r.data && r.data.products) || {};
    return { ok: true, cat: a.key, sec, rows: aisleRows(c.nodes, now), next: sec !== "new" && c.pageInfo && c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null };
  });
}

export const GRADED_Q = `query($after:String){products(first:100,after:$after,sortKey:CREATED_AT,reverse:true,query:${JSON.stringify(BASE + "title:Graded")}){pageInfo{hasNextPage endCursor}nodes{title handle productType media(first:2){nodes{preview{image{url width height}}}} variants(first:1){nodes{id price inventoryQuantity availableForSale}}}}}`;
const GRADE_RE = /\bGraded\s+((?:PSA|BGS|CGC|TAG|SGC|ACE|AGS|HGA|GMA|MNT)\s*[0-9]+(?:\.[0-9])?)/i;
// The cabinet's cards: the ones to ask about first (the grails), then the dearest down to the cheapest.
export function gradedOf(products) {
  const out = [];
  for (const p of products || []) {
    const title = String((p && p.title) || "");
    // a graded card: its type says "Single Graded", or its title names the grade ("Graded PSA 10"). Slab cases,
    // graded-card sleeves and stands also carry the word (live probe 42737187751) and are not for this cabinet.
    const type = String((p && p.productType) || "");
    if (!(/graded/i.test(type) && /single/i.test(type)) && !GRADE_RE.test(title)) continue;
    const v = ((p.variants && p.variants.nodes) || [])[0];
    if (!v || !(+v.inventoryQuantity > 0) || !(+v.price > 0) || v.availableForSale === false) continue;
    const pics = ((p.media && p.media.nodes) || []).map((m) => m && m.preview && m.preview.image).filter((i) => i && i.url);
    if (!pics.length) continue;
    const g = GRADE_RE.exec(title);
    out.push({ name: title.replace(/\s+/g, " ").trim(), handle: String(p.handle || ""), price: String(v.price), ask: +v.price >= ASK_PRICE,
      front: pics[0].url, back: pics[1] ? pics[1].url : null, ar: pics[0].width > 0 && pics[0].height > 0 ? Math.round((pics[0].width / pics[0].height) * 100) / 100 : .75,
      variantId: String(v.id || "").replace(/^.*\//, ""), grade: g ? g[1].replace(/\s+/g, " ").toUpperCase() : "" });
  }
  return out.sort((a, b) => (b.ask - a.ask) || (+b.price - +a.price));
}
export async function serveGraded(request, env, ctx, url, opts) {
  const o = opts || {};
  if (!o.gqlFn && (!env || !env.SHOPIFY_ADMIN_TOKEN)) return json({ ok: false, error: "not configured" }, 503);
  return cached(o, ctx, new URL("/showcase/graded.json", url).toString(), async () => {
    let nodes = [], after = null;
    for (let i = 0; i < 4; i++) {
      const r = await run(env, o, GRADED_Q, { after });
      const c = (r.data && r.data.products) || {}; nodes = nodes.concat(c.nodes || []);
      if (!c.pageInfo || !c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
    }
    return { ok: true, rows: gradedOf(nodes) };
  });
}
