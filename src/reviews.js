/* GET /reviews.json — curated Google reviews for the storefront band.
   Proxies Google Places server-side (the API key never reaches the
   browser), then filters hard: only 5-star reviews whose TEXT also reads
   positive survive — a five-star rating with a complaint in the body never
   makes the homepage. Fails open to an empty list (no key, quota, outage)
   so the theme section simply stays quiet.

   Setup: set the GOOGLE_PLACES_KEY secret in the Cloudflare dashboard.
   Either Google API flavor works on the key — "Places API (New)" (the
   only one a Google account created after March 2025 can enable) or the
   legacy "Places API"; every fetch tries New first and falls back to
   legacy. Optionally set GOOGLE_PLACE_IDS to a comma-separated list of
   place IDs (identical in both API flavors); without it the stores are
   discovered by name via Text Search and only businesses named Exor are
   accepted. */

const REVIEWS_TTL_S = 21600; // 6h per edge; Google reviews move slowly

// Words/phrases that mark a review as not-showcase material even at five
// stars. Deliberately trigger-happy: a false positive only hides one quote,
// while a miss puts a complaint on the homepage under five gold stars.
const NEGATIVE_RE = new RegExp(
  [
    "rude", "unhelpful", "unfriendly", "dirty", "messy", "cluttered",
    "overpriced", "too expensive", "pricey", "terrible", "awful",
    "horrible", "worst", "poorly", "\\bpoor\\b", "disappoint", "mediocre",
    "scam", "rip[ -]?off", "refund", "never (?:coming |going )?(?:back|again)",
    "won'?t be (?:back|returning)", "not worth", "long wait", "too long",
    "sadly", "unfortunately", "however", "complaint", "damaged", "broken",
    "sketchy", "dishonest", "overcharged", "stale",
  ].join("|"),
  "i"
);

const GHEADERS = { accept: "application/json", "user-agent": "ExorReviews/1.0 (+workers.dev)" };

/* Google runs two Places APIs with disjoint endpoints: "Places API (New)"
   (places.googleapis.com, header key + field mask) and the legacy web
   service (maps.googleapis.com, query-string key) that Google stopped
   offering to Google accounts created after March 2025. Which one a given
   key can call depends on what the console let the owner enable, so each
   fetch tries New first and falls back to legacy, and New responses are
   normalized here to the legacy field names the rest of this file reads.
   A key with the wrong flavor fails fast (non-200 / status!=OK), so the
   fallback costs nothing when the first try is right. */

function normNewPlace(p) {
  if (!p || !(p.displayName || p.reviews)) return null;
  return {
    name: (p.displayName && p.displayName.text) || "",
    rating: p.rating,
    user_ratings_total: p.userRatingCount || 0,
    reviews: (Array.isArray(p.reviews) ? p.reviews : []).map((rv) => ({
      rating: rv.rating,
      text: (rv.text && rv.text.text) || "",
      language: (rv.text && rv.text.languageCode) || "",
      author_name: (rv.authorAttribution && rv.authorAttribution.displayName) || "",
      relative_time_description: rv.relativePublishTimeDescription || "",
      time: rv.publishTime ? Math.floor(Date.parse(rv.publishTime) / 1000) || 0 : 0,
    })),
  };
}

async function fetchPlaceNew(id, key) {
  const r = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(id), {
    headers: {
      ...GHEADERS,
      "x-goog-api-key": key,
      "x-goog-fieldmask": "displayName,rating,userRatingCount,reviews",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  return normNewPlace(await r.json());
}

async function fetchPlaceLegacy(id, key) {
  const u =
    "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
    encodeURIComponent(id) +
    "&fields=name,rating,user_ratings_total,reviews&key=" +
    encodeURIComponent(key);
  const r = await fetch(u, { headers: GHEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.status === "OK" && j.result ? j.result : null;
}

async function fetchPlace(id, key) {
  const p = await fetchPlaceNew(id, key).catch(() => null);
  return p || fetchPlaceLegacy(id, key);
}

const DISCOVER_QUERY = "Exor Games Prince Edward Island";

async function discoverNew(key) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      ...GHEADERS,
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: DISCOVER_QUERY }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const j = await r.json();
  return (Array.isArray(j && j.places) ? j.places : [])
    .filter((p) => /exor/i.test((p.displayName && p.displayName.text) || ""))
    .slice(0, 3)
    .map((p) => p.id)
    .filter(Boolean);
}

async function discoverLegacy(key) {
  const u =
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
    encodeURIComponent(DISCOVER_QUERY) +
    "&key=" + encodeURIComponent(key);
  const r = await fetch(u, { headers: GHEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const j = await r.json();
  if (!j || j.status !== "OK" || !Array.isArray(j.results)) return [];
  return j.results
    .filter((p) => /exor/i.test(p.name || ""))
    .slice(0, 3)
    .map((p) => p.place_id)
    .filter(Boolean);
}

async function discoverPlaceIds(key) {
  const ids = await discoverNew(key).catch(() => []);
  return ids.length ? ids : discoverLegacy(key);
}

export async function serveReviews(request, env, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  const out = { ok: false, rating: 0, total: 0, count: 0, reviews: [] };
  const key = env && env.GOOGLE_PLACES_KEY;
  if (!key) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });

  const cache = caches.default;
  const cacheKey = new Request(new URL("/reviews.json?v=1", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    let ids = String((env && env.GOOGLE_PLACE_IDS) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) ids = await discoverPlaceIds(key);
    const places = (
      await Promise.all(ids.slice(0, 3).map((id) => fetchPlace(id, key).catch(() => null)))
    ).filter(Boolean);
    let ratingSum = 0;
    for (const p of places) {
      if (typeof p.rating === "number" && p.user_ratings_total) {
        ratingSum += p.rating * p.user_ratings_total;
        out.total += p.user_ratings_total;
      }
      for (const rv of p.reviews || []) {
        if (!rv || rv.rating !== 5) continue;
        const text = String(rv.text || "").trim();
        if (text.length < 40) continue; // too short to quote
        if (rv.language && !/^en/i.test(rv.language)) continue; // lexicon is English-only
        if (NEGATIVE_RE.test(text)) continue;
        out.reviews.push({
          author: String(rv.author_name || "A customer").slice(0, 60),
          rating: 5,
          text: text.slice(0, 600),
          when: String(rv.relative_time_description || "").slice(0, 40),
          time: rv.time || 0,
          location: String(p.name || "").slice(0, 60),
        });
      }
    }
    out.reviews.sort((a, b) => (b.time || 0) - (a.time || 0));
    out.reviews = out.reviews.slice(0, 10);
    out.count = out.reviews.length;
    if (out.total) out.rating = Math.round((ratingSum / out.total) * 10) / 10;
    out.ok = places.length > 0;
  } catch (e) {
    // fall through with whatever was gathered; ok stays false on total failure
  }

  const res = Response.json(out, {
    headers: { ...cors, "cache-control": out.ok ? `public, max-age=${REVIEWS_TTL_S}` : "no-store" },
  });
  if (out.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
