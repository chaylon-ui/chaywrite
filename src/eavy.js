/* "Paint it like the box" (owner, 2026-09-25: "Can you use this website to help
   suggest paints on Warhammer products with direct links to the paints on our
   site for sale https://eavy-archive.com/40k/adeptus-mechanicus/").

   GET /eavy/for.json?title=<product title>&faction=<40K faction, optional>
     -> { ok, page: {url, title}, schemes: [{ name, url, areas: [{ name, url,
          paints: [{ name, handle, title, price, a (in stock), v (variant id),
                     i (image), h (#hex) } | { name }] }] }], credit }

   data/eavy-archive.json (tools/eavy-archive.py, weekly) holds, for every
   'Eavy Archive page, each scheme's areas and ONLY the names of the paints
   they use - never the steps, ratios or photos (the page links back to
   'Eavy Archive for the method). This module picks the page for a product and
   resolves each paint name to our own Citadel listing through /paints.json.

   Which page: a character / chapter / sub-army page whose name the title
   carries ("Ghazghkull Thraka", "Blood Angels") beats the army page; the army
   comes from the 40K unit facts (exor.wh_unit faction) when the theme passes
   it, otherwise from an army name in the title ("STORMCAST ETERNALS:
   VINDICTORS"). No page -> schemes [] and the card stays hidden. */

export const EAVY_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/eavy-archive.json";

export const key = (s) => String(s || "").toLowerCase()
  .replace(/[‘’']s\b/g, "").replace(/&/g, " and ")
  .normalize("NFKD").replace(/[^a-z0-9]/g, "");
const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[‘’']s\b/g, "").replace(/[‘’']/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const slug = (s) => words(s).join("-");

/* 'Eavy Metal recipes say "Black" / "White" for the plain pots, and the older ones use the
   pre-2012 Citadel names: each maps to the pot GW itself named as its replacement. Spelling
   slips seen in the data map to the real name. */
const ALIASES = { black: "Abaddon Black", white: "White Scar", abaddonblack: "Abaddon Black", corax: "Corax White",
  bleachedbone: "Ushabti Bone", scorchedbrown: "Rhinox Hide", codexgrey: "Dawnstone", bestialbrown: "Mournfang Brown",
  mithrilsilver: "Runefang Steel", chainmail: "Ironbreaker", boltgunmetal: "Leadbelcher", fortressgrey: "Administratum Grey",
  regalblue: "Kantor Blue", shininggold: "Gehenna's Gold", goblingreen: "Warboss Green", elfflesh: "Kislev Flesh",
  scabred: "Khorne Red", tinbitz: "Warplock Bronze", redgore: "Wazdakka Red", burnishedgold: "Auric Armour Gold",
  devlanmud: "Agrax Earthshade", badabblack: "Nuln Oil", fleshwash: "Reikland Fleshshade", ogrynfleshwash: "Reikland Fleshshade",
  leviathanpurple: "Druchii Violet", bloodred: "Evil Sunz Scarlet", darkflesh: "Doombull Brown", bubonicbrown: "Zamesi Desert",
  verminbrown: "Skrag Brown", fieryorange: "Troll Slayer Orange", lichepurple: "Xereus Purple",
  abbadonblack: "Abaddon Black", gorgruntafur: "Gore-Grunta Fur", evilsunsscarlet: "Evil Sunz Scarlet",
  kreigkhaki: "Krieg Khaki", druchiviolet: "Druchii Violet", cadianflesh: "Cadian Fleshtone",
  ironwarrior: "Iron Warriors", gehennasgold: "Gehenna's Gold", dawnstonegrey: "Dawnstone", xeruspurple: "Xereus Purple",
  scragbrown: "Skrag Brown", evilsunzred: "Evil Sunz Scarlet", sepraphimsepia: "Seraphim Sepia",
  reiklandfleshadegloss: "Reikland Fleshshade Gloss", skullwhite: "White Scar", administratrumgrey: "Administratum Grey" };
// the pre-2012 names: the card says which old pot the recipe named
const RENAMED = new Set(["bleachedbone", "scorchedbrown", "codexgrey", "bestialbrown", "mithrilsilver", "chainmail", "boltgunmetal",
  "fortressgrey", "regalblue", "shininggold", "goblingreen", "elfflesh", "scabred", "tinbitz", "redgore", "burnishedgold", "devlanmud",
  "badabblack", "fleshwash", "ogrynfleshwash", "leviathanpurple", "bloodred", "darkflesh", "bubonicbrown", "verminbrown", "fieryorange", "lichepurple", "skullwhite"]);
// step words and mixes the crawler read as paint names ("Basecoat Mix", "Previous mix", "Water", "Add White")
export const NOT_A_PAINT = /\b(mix|mixes|basecoat|base coat|previous|water|thinned|medium)\b|^add\b|:/i;
/* A paint's name is in several Citadel ranges (Leadbelcher Base / Spray / Air): the pot a recipe means. */
const RANGE_PREF = ["Base", "Layer", "Shade", "Contrast", "Technical", "Dry", "Glaze", "Air", "Spray"];

/* /paints.json swatches -> Citadel paint name key -> the listing to link. */
export function citadelIndex(paints) {
  const best = new Map();
  // word-boundary prefixes of each name ("khorne" -> Khorne Red, "flashgitz" -> Flash Gitz Yellow):
  // recipes often shorten a paint to its first word(s)
  const pre = new Map();
  for (const s of (paints && paints.swatches) || []) {
    if (s.b !== "Citadel") continue;
    for (const it of s.items || []) {
      const cand = { handle: it.u, title: it.t, price: it.p, a: !!it.a, v: it.v, i: it.i || null, h: s.h || null, r: it.r, n: s.n };
      const k = key(s.n), prev = best.get(k);
      // in stock first, then the pot a recipe means (Base before Spray)
      if (!prev || (cand.a && !prev.a) || (cand.a === prev.a && rank(cand.r) < rank(prev.r))) best.set(k, cand);
      const ws = words(s.n);
      for (let i = 1; i < ws.length; i++) {
        const pk = ws.slice(0, i).join("");
        if (pk.length < 5) continue;
        if (!pre.has(pk)) pre.set(pk, new Set());
        pre.get(pk).add(k);
      }
    }
  }
  best.prefix = pre;
  return best;
}
const better = (x, y) => !y || (x.a && !y.a) || (x.a === y.a && rank(x.r) < rank(y.r));
function rank(r) { const i = RANGE_PREF.indexOf(r); return i < 0 ? 99 : i; }

export function resolvePaint(idx, name) {
  const k = key(name);
  if (idx.get(k)) return { name, ...idx.get(k) };
  const alias = ALIASES[k];
  if (alias && idx.get(key(alias))) return { name: alias, ...(RENAMED.has(k) ? { was: name } : {}), ...idx.get(key(alias)) };
  // "Doombull" -> Doombull Brown: the first word(s) of exactly one colour name
  const cands = idx.prefix && idx.prefix.get(k);
  if (cands) {
    const names = new Set([...cands].map((c) => c.replace(/gloss$/, "")));
    if (names.size === 1) {
      let bk = null;
      for (const c of cands) if (better(idx.get(c), bk && idx.get(bk))) bk = c;
      if (bk) return { name: idx.get(bk).n, ...idx.get(bk) };
    }
  }
  return { name };
}

/* data/eavy-archive.json -> lookup tables. Every page is an army page; its
   schemes include the characters and sub-factions ("Ghazghkull Thraka" on the
   Orks page, "Blood Angels" on the Space Marines page). */
export function indexEavy(data) {
  const armies = [], schemes = [], byFaction = new Map();
  for (const p of Object.values((data && data.pages) || {})) {
    if (!p.schemes || !p.schemes.length) continue;
    armies.push({ p, w: words(p.title) });
    byFaction.set(p.game + "|" + p.faction, p);
    p.schemes.forEach((s, i) => schemes.push({ p, i, w: words(s.name), slug: slug(s.name) }));
  }
  // longest names first: "Blood Angels Death Company" beats "Blood Angels"
  schemes.sort((a, b) => b.w.length - a.w.length);
  armies.sort((a, b) => b.w.length - a.w.length);
  return { armies, schemes, byFaction };
}

// "SPACE MARINE SCOUT SQUAD" names the Space Marines, "NECRON" the Necrons
const has = (hay, w) => hay.includes(w) || hay.includes(w.replace(/s$/, "")) || hay.includes(w + "s");
const hasAll = (hay, need) => need.length > 0 && need.every((w) => has(hay, w));
// words that name nothing on their own
const WEAK = new Set(["the", "of", "and", "a", "an", "warhammer", "40000", "40k", "age", "sigmar", "bases", "base", "weapons",
  "squad", "armour", "armor", "scheme", "classic", "new", "old", "red", "blue", "green", "black", "white", "gold", "silver"]);
const strongOf = (w) => w.filter((x) => !WEAK.has(x));

/* Product -> { page, first } (the scheme index to show first), or null. */
// Not model kits: nothing to paint (or a whole range of it)
export const NOT_MODELS = /\b(codex|codexes|rulebook|rule book|core book|battletome|cards?|datacards?|dice|annual|novel|book|killzone|terrain|scenery|tokens?|templates?|objective markers?|paint set|paints?|brush(es)?|tool|glue|case|mat|playmat)\b/i;

// BSData army names that 'Eavy Archive files under another page
const FACTION_ALIAS = { "adeptus-custodes": "talons-of-the-emperor", "imperial-agents": "agents-of-the-imperium" };

/* A tank wants the army's vehicle scheme, a squad never does (owner 2026-09-26, Baneblade opening on
   "Cadian Shock Troops" - the infantry uniform). The theme passes kind=vehicle from the 40K unit
   facts (keyword Vehicle); without them a few common hull names in the title count. */
const VEHICLE_SCHEME = /\bvehicles?\b|\btanks?\b|\barmou?red\b/i;
const VEHICLE_TITLE = /\b(tank|baneblade|shadowsword|stormlord|leman russ|rogal dorn|chimera|taurox|hellhound|basilisk|manticore|wyvern|hydra|valkyrie|sentinel|rhino|razorback|predator|land raider|repulsor|gladiator|impulsor|vindicator|whirlwind|dreadnought|battlewagon|trukk|land speeder|stormraven|knight)\b/i;
export function isVehicle(title, kind) { return kind === "vehicle" || VEHICLE_TITLE.test(String(title || "")); }

export function pickPage(ix, title, faction, kind) {
  if (NOT_MODELS.test(String(title || ""))) return null;
  const tw = words(title);
  const fslug = FACTION_ALIAS[slug(faction)] || slug(faction);
  const homes = new Set(fslug ? ix.schemes.filter((s) => s.p.faction === fslug || s.slug === fslug).map((s) => s.p) : []);
  // 1. a scheme the title names - a character, sub-faction or chapter ("GHAZGHKULL THRAKA")
  for (const s of ix.schemes) {
    const strong = strongOf(s.w);
    if (!strong.length || !hasAll(tw, strong)) continue;
    if (strong.length === 1 && strong[0].length < 5) continue;          // one short word is too loose
    // a 40K box whose unit facts name its army: only the page holding that army or chapter
    if (fslug && !homes.has(s.p)) continue;
    return { page: s.p, first: s.i };
  }
  // 2. the 40K faction from the unit facts: its army page, or a chapter scheme of that name
  if (fslug) {
    const a = ix.byFaction.get("40k|" + fslug);
    if (a) return { page: a, first: defaultScheme(a, tw, isVehicle(title, kind)) };
    const ch = ix.schemes.find((s) => s.slug === fslug && s.p.game === "40k");
    if (ch) return { page: ch.p, first: ch.i };
  }
  // 3. an army name in the title ("STORMCAST ETERNALS: VINDICTORS")
  for (const a of ix.armies) {
    const strong = strongOf(a.w);
    if (strong.length && hasAll(tw, strong)) return { page: a.p, first: defaultScheme(a.p, tw, isVehicle(title, kind)) };
  }
  return null;
}

/* The scheme to open on an army page matched by army, not by a named character:
   one sharing a word with the title ("KILL TEAM: CORSAIR VOIDSCARRED"), else the
   army's general scheme ("Orks (General)"), else its house colours, else the first
   scheme that is not a named character. */
const HOUSE = { "space-marines": "ultramarines", "tau-empire": "tausept", "tyranids": "hivefleetleviathan",
  "chaos-space-marines": "blacklegion", "astra-militarum": "cadianshocktroops", "stormcast-eternals": "stormcasteternals",
  "adepta-sororitas": "orderofourmartyredlady", "aeldari": "craftworldbieltan", "leagues-of-votann": "greaterthurianleague" };
const CHARACTER = /,|\bthe\b|\b(avatar|commander|lord|lady|captain|warboss|knight of|primaris|mortarch|son of|jain zar|maugan|guilliman|jonson|angron|fulgrim|mortarion|helbrecht|yndrasta|krondys|uthar|ghazghkull|wazdakka)\b/i;
export function defaultScheme(p, tw, vehicle) {
  const n = p.schemes.length;
  if (vehicle) {
    const v = p.schemes.findIndex((s) => VEHICLE_SCHEME.test(s.name));
    if (v >= 0) return v;
  }
  // a squad or character never opens on the army's vehicle scheme
  const skip = (s) => CHARACTER.test(s.name) || (!vehicle && VEHICLE_SCHEME.test(s.name));
  let best = -1, bestScore = 0;
  const pw = words(p.title);
  for (let i = 0; i < n; i++) {
    if (skip(p.schemes[i])) continue;                                 // a character is only shown when the title names it
    const sw = strongOf(words(p.schemes[i].name)).filter((w) => !has(pw, w));
    const score = sw.filter((w) => has(tw || [], w)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best >= 0) return best;
  const house = HOUSE[p.faction];
  // a vehicle of an army with no house colours (Orks: owner 2026-09-26, the Trukk showed only skin
  // greens): the scheme with the most vehicle parts - tyres, tracks, fuel tanks, bike metals count
  // double, armour / metal / weathering once - characters included (Wazdakka's bike is the best
  // Ork vehicle recipe); needs a real match (score 4+)
  if (vehicle && !house) {
    let vb = -1, vs = 3;
    p.schemes.forEach((s, j) => {
      const sc = s.areas.reduce((t, a) => t + (VEHICLE_PART.test(a.name) ? 2 : VEHICLE_ANY.test(a.name) ? 1 : 0), 0);
      if (sc > vs) { vb = j; vs = sc; }
    });
    if (vb >= 0) return vb;
  }
  // an army's "general" scheme, when it covers more than one part (Orks (General) is skin only)
  let i = p.schemes.findIndex((s) => /\bgeneral\b/i.test(s.name) && s.areas.length >= 3);
  if (i >= 0) return i;
  if (house) { i = p.schemes.findIndex((s) => key(s.name) === house); if (i >= 0) return i; }
  const tk = key(p.title);
  i = p.schemes.findIndex((s) => key(s.name) === tk);
  if (i >= 0) return i;
  // else the most complete scheme that is not a named character
  let rb = -1;
  p.schemes.forEach((s, j) => { if (!skip(s) && (rb < 0 || s.areas.length > p.schemes[rb].areas.length)) rb = j; });
  return rb < 0 ? 0 : rb;
}
const VEHICLE_PART = /\b(tyres?|tires?|tracks?|wheels?|fuel|exhaust|hull|bike|engine|vehicles?)\b/i;
const VEHICLE_ANY = /\b(armou?r|metals?|iron|plate|weathering|rust|chassis)\b/i;

export function forProduct(ix, paintIdx, title, faction, maxSchemes = 40, kind = "") {
  const hit = pickPage(ix, title, faction, kind);
  if (!hit) return { ok: true, page: null, schemes: [] };
  const p = hit.page;
  // the crawler sometimes read the NEXT scheme's name as a last paint ("Artillery", "Death Riders")
  const schemeWords = new Set(p.schemes.flatMap((s) => [key(s.name), key(s.name.split(":").pop())]));
  const order = [hit.first].concat(p.schemes.map((_, i) => i).filter((i) => i !== hit.first)).slice(0, maxSchemes);
  const schemes = order.map((i) => {
    const s = p.schemes[i];
    const surl = p.url + "?modal=" + encodeURIComponent(s.slug);
    return {
      name: s.name, url: surl,
      areas: s.areas.map((ar) => ({
        name: ar.name, url: surl + "&block=" + encodeURIComponent(ar.slug),
        paints: dedupe(ar.paints.flatMap(expand).filter((n) => n && !NOT_A_PAINT.test(n) && !schemeWords.has(key(n))).map((n) => resolveLoose(paintIdx, n)).filter(Boolean)),
      })).filter((ar) => ar.paints.length),
    };
  });
  return { ok: true, page: { url: p.url, title: p.title }, schemes };
}

// ratio tails the crawler left on a name: "Corax White :" (from "... & Corax White 1:1:1:3:3"),
// "Rhinox Hide1:1", "Mephiston Red*"
const tidy = (n) => String(n || "").replace(/\s*\d*\s*[:(][\s\d:.)]*$/, "").replace(/\d+\s*:\s*\d.*$/, "").replace(/\s*\*+$/, "").trim();
const SMALL = new Set(["of", "the", "and", "for", "a"]);
/* A recipe step read as a name -> the paint(s) in it:
   "Add White to previous mix" -> White; "Screaming Skull : White" -> both;
   "Bestial Brown (Mournfang Brown" -> Bestial Brown (the old name maps on). */
export function expand(raw) {
  let n = String(raw || "").replace(/[‘’]/g, "'").trim();
  const add = /^(?:gradually |progressively )?add (?:a touch of )?(.+?) (?:progressively |gradually |bit by bit )?to\b/i.exec(n);
  if (add) return [tidy(add[1])];
  n = n.split("(")[0];
  return n.split(/\s+:\s+/).map(tidy).filter(Boolean);
}
/* resolvePaint, plus: a step note ("Nuln Oil in the recesses", "Thin glazes of Screamer Pink")
   yields the stocked paint named inside it; a note naming none is dropped (null), while a
   proper paint name we do not stock stays as { name }. */
export function resolveLoose(idx, n) {
  const r = resolvePaint(idx, n);
  if (r.handle) return r;
  const ws = n.split(/\s+/);
  const note = ws.length > 4 || ws.some((w) => /^[a-z]/.test(w) && !SMALL.has(w));
  if (!note) return r;
  for (let len = Math.min(4, ws.length); len >= 1; len--) {
    for (let i = 0; i + len <= ws.length; i++) {
      const part = ws.slice(i, i + len).join(" ");
      if (len === 1 && part.length < 5) continue;
      const hit = resolvePaint(idx, part);
      if (hit.handle) return hit;
    }
  }
  return null;
}

// one chip per pot: "Black" and "Abaddon Black" in one area are the same paint; a shorthand
// we could not resolve ("Sons of Horus") goes when the same area names the full paint
function dedupe(list) {
  const seen = new Set();
  const out = list.filter((p) => { const k = p.handle || key(p.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const full = out.map((p) => words(p.name).join(" "));
  return out.filter((p, i) => p.handle || !full.some((f, j) => j !== i && f !== full[i] && f.startsWith(full[i] + " ")));
}

const CREDIT = "Box-art recipes from 'Eavy Archive, collected by The Infernal Brush Discord community (unofficial, not endorsed by Games Workshop)";

export async function serveEavy(request, env, ctx, getPaints) {
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") || "").slice(0, 200);
  const faction = (url.searchParams.get("faction") || "").slice(0, 80);
  const kind = url.searchParams.get("kind") === "vehicle" ? "vehicle" : "";
  const cache = caches.default;
  const ck = new Request("https://cache.internal/eavy/for.json?v=5&t=" + encodeURIComponent(key(title)) + "&f=" + encodeURIComponent(key(faction)) + "&k=" + kind);
  const hit = await cache.match(ck);
  if (hit) return hit;
  let body, status = 200;
  try {
    const [dr, paints] = await Promise.all([
      fetch(EAVY_URL, { cf: { cacheTtl: 3600, cacheEverything: true } }).then((r) => { if (!r.ok) throw new Error("eavy data HTTP " + r.status); return r.json(); }),
      getPaints(),
    ]);
    body = { ...forProduct(indexEavy(dr), citadelIndex(paints), title, faction, 40, kind), credit: CREDIT, source: "https://eavy-archive.com/" };
  } catch (e) {
    status = 502;
    body = { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*",
      "cache-control": status === 200 ? "public, max-age=900" : "no-store" },
  });
  if (status === 200) ctx.waitUntil(cache.put(ck, res.clone()));
  return res;
}
