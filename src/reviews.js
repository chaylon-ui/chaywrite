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

/* The edge cache survives worker deploys, and its key is fixed - a caller
   cannot bust it with a query string - so a logic change stays invisible
   for up to REVIEWS_TTL_S unless this is bumped. BUMP IT whenever the set
   of places, the filter, or the payload shape changes.
   v2: six stores across both provinces (was three, PEI-only).
   v3: per-city discovery (the province queries surfaced two of six). */
const REVIEWS_CACHE_V = "3";

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

/* ONE source of truth for the publish filter. The debug view below reports
   why each review was dropped, and a second copy of these rules would be
   free to drift from the ones that actually run - a diagnostic that
   measures something adjacent to the thing it claims to measure. Returns
   null when the review is publishable, else a human-readable reason. */
function rejectReason(rv) {
  if (!rv) return "empty";
  if (rv.rating !== 5) return "rating " + rv.rating;
  const text = String(rv.text || "").trim();
  if (text.length < 40) return "too short (" + text.length + " chars)";
  if (rv.language && !/^en/i.test(rv.language)) return "language " + rv.language;
  const m = NEGATIVE_RE.exec(text);
  if (m) return 'negative word "' + m[0] + '"';
  return null;
}

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

/* Six stores across TWO provinces, every one listed on Google as plainly
   "Exor Games". A province-worded Text Search ranks only its strongest
   listing or two: "Exor Games Nova Scotia" returned Charlottetown and
   Truro, and Bridgewater, Dartmouth and New Glasgow never surfaced
   (deploy 197), so the band was quoting a fraction of the chain off a
   fraction of its reviews. Ask per city and merge, deduped by place id -
   six cheap searches per edge per 6h. GOOGLE_PLACE_IDS still overrides
   discovery outright when the owner wants specific stores. */
const DISCOVER_QUERIES = [
  "Exor Games Charlottetown PE",
  "Exor Games Summerside PE",
  "Exor Games Bridgewater NS",
  "Exor Games Dartmouth NS",
  "Exor Games New Glasgow NS",
  "Exor Games Truro NS",
];
export const MAX_PLACES = 6; // one per store; each costs one Place Details call per edge per 6h

async function discoverNew(key) {
  const ids = [];
  for (const q of DISCOVER_QUERIES) {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        ...GHEADERS,
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": "places.id,places.displayName",
      },
      body: JSON.stringify({ textQuery: q }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!r || !r.ok) continue;
    const j = await r.json().catch(() => null);
    for (const p of Array.isArray(j && j.places) ? j.places : []) {
      const nm = (p && p.displayName && p.displayName.text) || "";
      if (p && p.id && /exor/i.test(nm) && !ids.includes(p.id)) ids.push(p.id);
    }
  }
  return ids.slice(0, MAX_PLACES);
}

async function discoverLegacy(key) {
  const ids = [];
  for (const q of DISCOVER_QUERIES) {
    const r = await fetch(
      "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
        encodeURIComponent(q) + "&key=" + encodeURIComponent(key),
      { headers: GHEADERS, signal: AbortSignal.timeout(8000) }
    ).catch(() => null);
    if (!r || !r.ok) continue;
    const j = await r.json().catch(() => null);
    if (!j || j.status !== "OK" || !Array.isArray(j.results)) continue;
    for (const p of j.results) {
      if (p && p.place_id && /exor/i.test(p.name || "") && !ids.includes(p.place_id)) ids.push(p.place_id);
    }
  }
  return ids.slice(0, MAX_PLACES);
}

// Shared with /stores.json (stores.js): one discovery routine, one set of stores.
export async function discoverPlaceIds(key) {
  const ids = await discoverNew(key).catch(() => []);
  return ids.length ? ids : discoverLegacy(key);
}

/* ---- GET /reviews.json?debug=1 ---------------------------------------
   The public response cannot tell "no key set" apart from "key set but
   Google refused it": both return the same empty ok:false body, which
   makes the owner-side setup undebuggable from outside. This view names
   the cause - whether the secret is present, the HTTP + Google status of
   every call in BOTH API flavors, the discovered place IDs (what
   GOOGLE_PLACE_IDS wants), and the per-review filter verdicts.

   It never emits the key: the payload is scrubbed of it on the way out,
   and only its length is reported (a Google key is 39 chars, so a short
   one means a truncated paste). Bypasses the edge cache entirely. */

export function scrubKey(obj, key) {
  const s = JSON.stringify(obj);
  return JSON.parse(key ? s.split(key).join("<redacted>") : s);
}

export async function probe(label, run) {
  try {
    const r = await run();
    let j = null;
    try { j = JSON.parse(await r.text()); } catch (e) {}
    return {
      call: label,
      http: r.status,
      status: (j && (j.status || (j.error && j.error.status))) || (r.ok ? "OK" : "(none)"),
      error: (j && (j.error_message || (j.error && j.error.message))) || "",
      json: j,
    };
  } catch (e) {
    return { call: label, http: 0, status: "FETCH_FAILED", error: String((e && e.message) || e), json: null };
  }
}

async function serveReviewsDebug(env) {
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  const raw = String((env && env.GOOGLE_PLACES_KEY) || "");
  const key = raw.trim();
  const d = {
    keyPresent: !!key,
    keyLength: key.length,
    keyHadSurroundingWhitespace: raw !== key,
    placeIdsConfigured: String((env && env.GOOGLE_PLACE_IDS) || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    calls: [],
    placeIdsUsed: [],
    places: [],
    next: "",
  };

  if (!key) {
    d.next =
      "GOOGLE_PLACES_KEY is not set on this worker. Cloudflare dashboard > Workers & Pages > " +
      "exor-binder > Settings > Variables and Secrets > Add > type Secret > name GOOGLE_PLACES_KEY " +
      "> paste the key > Save and deploy. The Save and deploy button is required: adding the row " +
      "alone changes nothing.";
    return Response.json(d, { headers: cors });
  }

  let ids = d.placeIdsConfigured.slice();
  if (!ids.length) {
    for (const q of DISCOVER_QUERIES) {
      const nw = await probe("searchText New: " + q, () =>
        fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            ...GHEADERS,
            "content-type": "application/json",
            "x-goog-api-key": key,
            "x-goog-fieldmask": "places.id,places.displayName",
          },
          body: JSON.stringify({ textQuery: q }),
          signal: AbortSignal.timeout(8000),
        }));
      nw.found = (((nw.json || {}).places) || [])
        .map((p) => ({ name: (p.displayName && p.displayName.text) || "", id: p.id }));
      delete nw.json;
      d.calls.push(nw);
      for (const p of nw.found) {
        if (p.id && /exor/i.test(p.name) && !ids.includes(p.id)) ids.push(p.id);
      }
    }

    if (!ids.length) {
      for (const q of DISCOVER_QUERIES) {
        const lg = await probe("textsearch legacy: " + q, () =>
          fetch("https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
            encodeURIComponent(q) + "&key=" + encodeURIComponent(key),
            { headers: GHEADERS, signal: AbortSignal.timeout(8000) }));
        lg.found = (((lg.json || {}).results) || [])
          .map((p) => ({ name: p.name || "", id: p.place_id }));
        delete lg.json;
        d.calls.push(lg);
        for (const p of lg.found) {
          if (p.id && /exor/i.test(p.name) && !ids.includes(p.id)) ids.push(p.id);
        }
      }
    }
  }
  d.placeIdsUsed = ids.slice(0, MAX_PLACES);

  for (const id of d.placeIdsUsed) {
    let p = null;
    const nw = await probe("details New " + id, () =>
      fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(id), {
        headers: {
          ...GHEADERS,
          "x-goog-api-key": key,
          "x-goog-fieldmask": "displayName,rating,userRatingCount,reviews",
        },
        signal: AbortSignal.timeout(8000),
      }));
    if (nw.http === 200) p = normNewPlace(nw.json);
    delete nw.json;
    d.calls.push(nw);

    if (!p) {
      const lg = await probe("details legacy " + id, () =>
        fetch("https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
          encodeURIComponent(id) + "&fields=name,rating,user_ratings_total,reviews&key=" +
          encodeURIComponent(key), { headers: GHEADERS, signal: AbortSignal.timeout(8000) }));
      if (lg.status === "OK" && lg.json && lg.json.result) p = lg.json.result;
      delete lg.json;
      d.calls.push(lg);
    }

    if (!p) { d.places.push({ id, resolved: false }); continue; }
    const verdicts = (p.reviews || []).map((rv) => ({
      author: String(rv.author_name || "").slice(0, 40),
      rating: rv.rating,
      chars: String(rv.text || "").trim().length,
      verdict: rejectReason(rv) || "KEPT",
    }));
    d.places.push({
      id,
      resolved: true,
      name: p.name,
      rating: p.rating,
      ratingsTotal: p.user_ratings_total,
      reviewsReturned: verdicts.length,
      kept: verdicts.filter((v) => v.verdict === "KEPT").length,
      verdicts,
    });
  }

  const kept = d.places.reduce((n, p) => n + (p.kept || 0), 0);
  if (!d.placeIdsUsed.length) {
    d.next =
      "No place IDs resolved. Read calls[] above. A 403 / REQUEST_DENIED / PERMISSION_DENIED means " +
      "the key cannot call that API - check the key's API restriction in Google Cloud and that " +
      "billing is enabled on the project. If a call succeeded but matched nothing named Exor, set " +
      "GOOGLE_PLACE_IDS explicitly to the store place IDs.";
  } else if (!d.places.some((p) => p.resolved)) {
    d.next = "Place IDs known but no details call succeeded - read the status and error on the details calls above.";
  } else if (!kept) {
    d.next =
      "Google returned reviews but the filter dropped every one; each verdict above names the rule " +
      "that dropped it. Note Google returns at most 5 reviews per place.";
  } else {
    d.next =
      kept + " review(s) would publish. If /reviews.json still reads empty, its 6h per-edge cache " +
      "is holding an older answer - bump the ?v=1 cache key in src/reviews.js and redeploy to clear it.";
  }
  return Response.json(scrubKey(d, key), { headers: cors });
}

export async function serveReviews(request, env, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  if (new URL(request.url).searchParams.get("debug") === "1") return serveReviewsDebug(env);
  const out = { ok: false, rating: 0, total: 0, count: 0, reviews: [] };
  // Trimmed: a dashboard paste can carry a trailing newline or space, which
  // Google rejects with a status the public response could never show.
  const key = String((env && env.GOOGLE_PLACES_KEY) || "").trim();
  if (!key) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });

  const cache = caches.default;
  const cacheKey = new Request(new URL("/reviews.json?v=" + REVIEWS_CACHE_V, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    let ids = String((env && env.GOOGLE_PLACE_IDS) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) ids = await discoverPlaceIds(key);
    const places = (
      await Promise.all(ids.slice(0, MAX_PLACES).map((id) => fetchPlace(id, key).catch(() => null)))
    ).filter(Boolean);
    let ratingSum = 0;
    for (const p of places) {
      if (typeof p.rating === "number" && p.user_ratings_total) {
        ratingSum += p.rating * p.user_ratings_total;
        out.total += p.user_ratings_total;
      }
      for (const rv of p.reviews || []) {
        if (rejectReason(rv)) continue;
        const text = String(rv.text || "").trim();
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
