/* ---------------- The Showcase: browse singles like the store's glass cases ----
   Owner, 2026-10-29: "mimics the basic appearance of being in the store and
   browsing cards in the glass showcases ... walking down or crouching down to
   view the shelf below ... by swiping", then "auto sorting is fine but I want it
   to be organic in placement and looking like it was put there by a 1990s card
   store owner with the same rustic elements (handwritten sticker prices etc)".
   Built 2026-10-29 as a worker page (/showcase, public/showcase.html) so the
   owner can try it without touching the live theme; wiring it into
   exorgames.com is a later step.

   This file is the data side: GET /showcase.json?game=<key> answers one case.
   The top shelf is the physical showcase (the esl-showcase collection, the
   kiosk's "Showcase" tab) filtered to that game; the shelves below are the
   game's own singles feed (the kiosk's tab collection) in price bands, the
   priciest highest, so the case reads the way a real one is arranged. Every
   card comes from src/cards.js (serveCards) with its live price and stock. */

import { serveCards } from "./cards.js";

export const CASES = [
  { key: "mtg", label: "Magic", collection: "new-arrivals" },
  { key: "pokemon", label: "Pokémon", collection: "pokemon-singles-new-arrivals" },
  { key: "yugioh", label: "Yu-Gi-Oh!", collection: "yu-gi-oh-singles-new-arrivals" },
  { key: "onepiece", label: "One Piece", collection: "one-piece-in-stock" },
  { key: "starwars", label: "Star Wars", collection: "star-wars-unlimited-singles-in-stock" },
  { key: "riftbound", label: "Riftbound", collection: "riftbound-singles" },
];
export const SHOWCASE_COLLECTION = "esl-showcase";
export const SHELF_MAX = 60;           // cards a shelf holds (the page lays them out organically)
const BANDS = [
  { key: "high", label: "The good stuff", tape: "$100 and up", min: 100 },
  { key: "mid", label: "Middle shelf", tape: "$25 to $100", min: 25 },
  { key: "low", label: "Bargain row", tape: "under $25", min: 0 },
];

const slim = (c) => ({
  name: String(c.name || ""), set: String(c.set || ""), price: String(c.price || ""), image: c.image || null, url: String(c.url || ""),
  variantId: c.variantId || null, foil: !!c.foil, condition: String(c.condition || ""), game: c.game || null, color: c.color || null,
});
const keyOf = (c) => (c.name + "|" + c.set).toLowerCase();

// picks: the physical showcase's cards for this game; cards: the game's own
// feed. Pure, so the layout rules are testable without any feed.
export function shelvesFor(picks, cards) {
  const seen = new Set();
  const take = (list) => { const out = []; for (const c of list) { const k = keyOf(c); if (seen.has(k) || !(+c.price > 0)) continue; seen.add(k); out.push(slim(c)); } return out; };
  const byPrice = (a, b) => +b.price - +a.price;
  const shelves = [];
  const top = take([...(picks || [])].sort(byPrice)).slice(0, SHELF_MAX);
  if (top.length) shelves.push({ key: "picks", label: "Showcase picks", tape: "the case up front", cards: top });
  const rest = take([...(cards || [])].sort(byPrice));
  for (const b of BANDS) {
    const band = rest.filter((c) => +c.price >= b.min && (b.key === "high" || +c.price < (b.key === "mid" ? 100 : 25))).slice(0, SHELF_MAX);
    if (band.length) shelves.push({ key: b.key, label: b.label, tape: b.tape, cards: band });
  }
  return shelves;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", vary: "origin" };

export async function serveShowcase(request, env, ctx, opts) {
  const o = opts || {};
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = String(url.searchParams.get("game") || "").toLowerCase();
  const which = CASES.find((c) => c.key === key) || CASES[0];
  const cardsFn = o.cardsFn || (async (collection, showcase) => {
    const r = await serveCards(request, env, ctx, collection, false, showcase, false);
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j.cards) ? j.cards : [];
  });
  let picks = [], cards = [], trouble = [];
  const [p, c] = await Promise.allSettled([cardsFn(SHOWCASE_COLLECTION, true), cardsFn(which.collection, false)]);
  if (p.status === "fulfilled") picks = p.value.filter((x) => x.game === which.key); else trouble.push("showcase: " + String(p.reason && p.reason.message || p.reason).slice(0, 120));
  if (c.status === "fulfilled") cards = c.value; else trouble.push("feed: " + String(c.reason && c.reason.message || c.reason).slice(0, 120));
  const shelves = shelvesFor(picks, cards);
  const ok = shelves.length > 0;
  return Response.json(
    { ok, game: which.key, label: which.label, cases: CASES.map((x) => ({ key: x.key, label: x.label })), shelves, count: shelves.reduce((n, s) => n + s.cards.length, 0), updated: new Date().toISOString(), ...(trouble.length ? { trouble } : {}) },
    { status: ok ? 200 : 503, headers: { ...CORS, "cache-control": ok ? "public, max-age=300" : "no-store" } },
  );
}
