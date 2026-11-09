/* ---------------- Set logos for the 3D shop's set boxes ----------------
   Owner, 2026-11-09: "Set logos on the set boxes too". GET
   /showcase/setlogos.json?game= answers { ok, game, logos: { <set name,
   normalised>: <image url> } } from a public source per game, cached a day:
     mtg      Scryfall's set list (the set symbol, an SVG)
     pokemon  the Pokémon TCG API's set list, from its data file on GitHub (the set logo, a PNG)
     yugioh   YGOPRODeck's set list (the set's pack picture)
   Other games have no such source and answer an empty list. The page looks
   a BinderPOS set name up with setLogoKeys() (the same rule lives in
   public/showcase3d.js): the name itself, then without the words BinderPOS
   adds for a set's tokens and promos, then without a "SV09: " or "Scarlet & Violet: " prefix. */

const UA = "ExorShowcase/1.0 (+https://exorgames.com)";
export const normSet = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const EXTRA = /\s+(tokens?|prerelease promos|promos?|extras|art series|minigames|front cards|substitute cards|commander tokens|jumpstart front cards|base set)$/;
export function setLogoKeys(name) {
  const n = normSet(name), out = [n];
  const add = (k) => { if (k && out.indexOf(k) < 0) out.push(k); };
  add(n.replace(EXTRA, ""));
  // "SV09: Journey Together" and "Scarlet & Violet: Journey Together" are both Journey Together;
  // "Scarlet & Violet: Base Set" is the series' own first set
  const colon = String(name || "").indexOf(":");
  if (colon > 0) { const rest = normSet(String(name).slice(colon + 1)); add(rest); add(rest.replace(EXTRA, "")); if (rest === "base set" || !rest) add(normSet(String(name).slice(0, colon))); }
  return out;
}
const https = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
// each source's answer -> { normalised name: url }; pure, so the shapes are testable
export function logosOf(game, body) {
  const out = {};
  const put = (name, url) => { const k = normSet(name), u = https(url); if (k && u && !out[k]) out[k] = u; };
  if (game === "mtg") for (const s of (body && body.data) || []) put(s && s.name, s && s.icon_svg_uri);
  else if (game === "pokemon") for (const s of (Array.isArray(body) ? body : body && body.data) || []) put(s && s.name, s && s.images && s.images.logo);
  else if (game === "yugioh") for (const s of Array.isArray(body) ? body : []) put(s && s.set_name, s && s.set_image);
  return out;
}
export const LOGO_SOURCES = {
  mtg: "https://api.scryfall.com/sets",
  // the Pokémon TCG API's own data file on GitHub: the API itself answers 429 to a worker without a key (live probe 42704135732)
  pokemon: "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json",
  yugioh: "https://db.ygoprodeck.com/api/v7/cardsets.php",
};
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };
export async function serveSetLogos(request, env, ctx, url, opts) {
  const o = opts || {};
  const game = String(url.searchParams.get("game") || "mtg").toLowerCase();
  const src = LOGO_SOURCES[game];
  if (!src) return new Response(JSON.stringify({ ok: true, game, logos: {} }), { headers: { ...CORS, "cache-control": "public, max-age=86400" } });
  const cache = o.fetchFn ? null : caches.default;
  const key = new Request(new URL("/showcase/setlogos.json?game=" + game, url).toString());
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  let out;
  try {
    const r = await (o.fetchFn || fetch)(src, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("http " + r.status);
    const logos = logosOf(game, await r.json());
    out = { ok: true, game, count: Object.keys(logos).length, logos };
  } catch (e) { out = { ok: false, game, logos: {}, error: String((e && e.message) || e).slice(0, 160) }; }
  const good = out.ok && out.count > 0;
  const res = new Response(JSON.stringify(out), { headers: { ...CORS, "cache-control": good ? "public, max-age=86400" : "no-store" } });
  if (good && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
