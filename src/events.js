/* Store pages: this week's events at a sister store.

   BinderPOS's public events feed answers for the store whose origin asks.
   Deploy 264 measured it: asked as exorgames.com it lists Charlottetown's
   84 events; asked as exor-games-truro.myshopify.com it lists Truro's 6,
   as New Glasgow's 9; Dartmouth, Summerside and Bridgewater list none. A
   shopper's browser on exorgames.com can only ask as exorgames.com, so the
   worker asks as the sister store and hands the answer back, trimmed to
   the fields the page uses, cached at the edge for ten minutes per store.
   The feed is public and unauthenticated; nothing here touches the portal.
   Ticketed events link to the sister store's own product, not ours. */
const STORES = {
  summerside: "https://exor-games-summserside.myshopify.com",
  bridgewater: "https://exor-games-bridgewater.myshopify.com",
  dartmouth: "https://exor-games-dartmouth.myshopify.com",
  "new-glasgow": "https://exor-games-new-glasgow.myshopify.com",
  truro: "https://exor-games-truro.myshopify.com",
};
const TTL_S = 600;

export async function serveEvents(request, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  const url = new URL(request.url);
  const key = String(url.searchParams.get("store") || "").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 20);
  const origin = STORES[key];
  if (!origin) return Response.json({ ok: false, error: "unknown store" }, { status: 404, headers: { ...cors, "cache-control": "no-store" } });
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 60));
  const iso = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const end = new Date(now.getTime() + days * 864e5);
  const cache = caches.default;
  const cacheKey = new Request(new URL("/events.json?v=1&s=" + key + "&from=" + iso(now) + "&days=" + days, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let events = [], error = null;
  try {
    const r = await fetch(`https://portal.binderpos.com/api/events/forStore?startDate=${iso(now)}&endDate=${iso(end)}`, {
      headers: { accept: "application/json", "content-type": "application/json", origin, referer: origin + "/", "user-agent": "ExorStorePages/1.0 (+workers.dev)" },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("events " + r.status);
    const arr = await r.json();
    if (!Array.isArray(arr)) throw new Error("events: not a list");
    events = arr.filter((e) => e && e.title && e.date && !e.isDisabled && !e.disabled).map((e) => ({
      title: String(e.title).slice(0, 200),
      date: String(e.date).slice(0, 10),
      time: e.time == null ? null : String(e.time).slice(0, 8),
      game: e.game == null ? null : String(e.game).slice(0, 60),
      city: e.city == null ? null : String(e.city).slice(0, 60),
      ticketPrice: typeof e.ticketPrice === "number" ? e.ticketPrice : null,
      ticketed: !!(e.ticketed || e.isTicketed),
      handle: e.handle ? String(e.handle).slice(0, 120) : null,
      url: (e.ticketed || e.isTicketed) && e.handle ? origin + "/products/" + encodeURIComponent(String(e.handle).slice(0, 120)) : null,
      calendarIcon: e.calendarIcon ? String(e.calendarIcon).slice(0, 300) : null,
    }));
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 120);
  } finally {
    clearTimeout(t);
  }
  const out = { ok: !error, store: key, count: events.length, events, error };
  const res = Response.json(out, { headers: { ...cors, "cache-control": "public, max-age=" + (error ? 60 : TTL_S) } });
  if (!error) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
