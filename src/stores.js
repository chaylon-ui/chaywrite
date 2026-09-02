/* GET /stores.json — every Exor Games store's live opening hours, straight
   from Google Business Profile via the Places API, so the storefront's
   store-hours band reads the same hours the owner maintains on Google
   Maps (a holiday closure entered there shows on the site within a cache
   cycle, with no theme edit).

   Proxies Google server-side (the key never reaches the browser), tries
   the Places API (New) first and falls back to the legacy web service —
   the same key handling and store discovery as /reviews.json — and
   normalises BOTH flavours to one contract the theme is built against:

     { ok, count, stores: [ { id, name, address, phone, mapsUrl,
         utcOffsetMin, hours: { periods: [ { open: { day, time },
         close: { day, time } | null } ], weekdayText: [ 7 strings ] } } ] }

   day 0 = Sunday .. 6 = Saturday (Google's convention); time = "HHMM",
   24-hour. A period with no close is open 24 hours (close: null). Any
   field Google omits is null — hours included, when the business profile
   carries none. The response is edge-cached for six hours, so it carries
   NO open_now on purpose: a cached "open" would lie for most of the day.
   The storefront decides open/closed at render time from periods plus
   utcOffsetMin. Fails open to an empty list (no key, quota, outage) so
   the theme falls back to its static hours. */

import { discoverPlaceIds, MAX_PLACES, probe, scrubKey } from "./reviews.js";

const STORES_TTL_S = 21600; // 6h per edge; hours change rarely, holiday edits still land same day

/* Fixed edge-cache key (a caller cannot bust it with a query string), so a
   payload-shape change stays invisible for up to STORES_TTL_S unless this
   is bumped. BUMP IT whenever the contract above changes. */
const STORES_CACHE_V = "1";

const GHEADERS = { accept: "application/json", "user-agent": "ExorStores/1.0 (+workers.dev)" };

const NEW_FIELDS = "id,displayName,formattedAddress,nationalPhoneNumber,regularOpeningHours,utcOffsetMinutes,googleMapsUri";
const LEGACY_FIELDS = "place_id,name,formatted_address,formatted_phone_number,opening_hours,utc_offset,url";

/* ---- normalisation ---------------------------------------------------
   Everything below turns "whatever Google sent" into the contract: strings
   trimmed or null, integers or null, never an undefined and never the
   string "undefined". */

function str(v) {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

function int(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function dayOf(v) {
  const d = int(v);
  return d !== null && d >= 0 && d <= 6 ? d : null;
}

function hhmm(hour, minute) {
  const h = int(hour), m = int(minute);
  if (h === null || m === null || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, "0") + String(m).padStart(2, "0");
}

// New API: { day, hour, minute } (hour/minute omitted when zero).
function pointNew(pt) {
  const day = dayOf(pt && pt.day);
  if (day === null) return null;
  const time = hhmm(pt.hour || 0, pt.minute || 0);
  return time === null ? null : { day, time };
}

// Legacy: { day, time: "HHMM" }.
function pointLegacy(pt) {
  const day = dayOf(pt && pt.day);
  if (day === null) return null;
  const time = String(pt.time || "");
  return /^\d{4}$/.test(time) ? { day, time } : null;
}

function normPeriods(raw, point) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const open = point(p && p.open);
    if (!open) continue; // a period without an open is not a period
    out.push({ open, close: point(p && p.close) }); // no close = open 24h
  }
  return out;
}

/* Google's day strings use a thin/narrow no-break space and an en dash
   ("10:00 AM – 9:00 PM"); the two API flavours differ in which. Fold them
   to plain spaces and a hyphen so the theme gets one predictable form. */
function cleanText(s) {
  return String(s)
    .replace(/[\u2009\u202f\u00a0]/g, " ")
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function normWeekdayText(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => typeof s === "string" && s.trim())
    .map(cleanText);
}

function normHours(periods, weekdayText, point) {
  return { periods: normPeriods(periods, point), weekdayText: normWeekdayText(weekdayText) };
}

function normNewStore(p, requestedId) {
  if (!p || !p.displayName) return null;
  const h = p.regularOpeningHours;
  return {
    id: str(p.id) || requestedId,
    name: str(p.displayName && p.displayName.text),
    address: str(p.formattedAddress),
    phone: str(p.nationalPhoneNumber),
    mapsUrl: str(p.googleMapsUri),
    utcOffsetMin: int(p.utcOffsetMinutes),
    hours: h ? normHours(h.periods, h.weekdayDescriptions, pointNew) : null,
  };
}

function normLegacyStore(r, requestedId) {
  if (!r || !r.name) return null;
  const h = r.opening_hours;
  return {
    id: str(r.place_id) || requestedId,
    name: str(r.name),
    address: str(r.formatted_address),
    phone: str(r.formatted_phone_number),
    mapsUrl: str(r.url),
    utcOffsetMin: int(r.utc_offset),
    hours: h ? normHours(h.periods, h.weekday_text, pointLegacy) : null,
  };
}

/* ---- fetchers: New first, legacy fallback (see reviews.js) ---------- */

function newDetailsRequest(id, key) {
  return fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(id), {
    headers: { ...GHEADERS, "x-goog-api-key": key, "x-goog-fieldmask": NEW_FIELDS },
    signal: AbortSignal.timeout(8000),
  });
}

function legacyDetailsRequest(id, key) {
  return fetch(
    "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
      encodeURIComponent(id) + "&fields=" + LEGACY_FIELDS + "&key=" + encodeURIComponent(key),
    { headers: GHEADERS, signal: AbortSignal.timeout(8000) }
  );
}

async function fetchStoreNew(id, key) {
  const r = await newDetailsRequest(id, key);
  if (!r.ok) return null;
  return normNewStore(await r.json(), id);
}

async function fetchStoreLegacy(id, key) {
  const r = await legacyDetailsRequest(id, key);
  if (!r.ok) return null;
  const j = await r.json();
  return j && j.status === "OK" && j.result ? normLegacyStore(j.result, id) : null;
}

async function fetchStore(id, key) {
  const s = await fetchStoreNew(id, key).catch(() => null);
  return s || fetchStoreLegacy(id, key);
}

function configuredIds(env) {
  return String((env && env.GOOGLE_PLACE_IDS) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---- GET /stores.json?debug=1 ----------------------------------------
   Same idea as /reviews.json?debug=1: the public body cannot tell "no
   key" from "key refused" from "no hours on the profile". This names the
   cause — key presence (length only, never the value), the HTTP + Google
   status of every details call in BOTH flavours, and what each resolved
   store carries. Store discovery is the shared routine; when it comes up
   empty the reviews debug view is the one that probes the Text Search
   calls individually. Bypasses the edge cache. */
async function serveStoresDebug(env) {
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  const raw = String((env && env.GOOGLE_PLACES_KEY) || "");
  const key = raw.trim();
  const d = {
    keyPresent: !!key,
    keyLength: key.length,
    keyHadSurroundingWhitespace: raw !== key,
    placeIdsConfigured: configuredIds(env),
    discovery: null,
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
  if (ids.length) {
    d.discovery = { source: "GOOGLE_PLACE_IDS", found: ids.length, ms: 0, error: "" };
  } else {
    const t0 = Date.now();
    try {
      ids = await discoverPlaceIds(key);
      d.discovery = { source: "discoverPlaceIds (shared with /reviews.json)", found: ids.length, ms: Date.now() - t0, error: "" };
    } catch (e) {
      ids = [];
      d.discovery = { source: "discoverPlaceIds (shared with /reviews.json)", found: 0, ms: Date.now() - t0, error: String((e && e.message) || e) };
    }
  }
  d.placeIdsUsed = ids.slice(0, MAX_PLACES);

  for (const id of d.placeIdsUsed) {
    let s = null;
    let flavor = "";
    const nw = await probe("details New " + id, () => newDetailsRequest(id, key));
    if (nw.http === 200) { s = normNewStore(nw.json, id); flavor = "new"; }
    delete nw.json;
    d.calls.push(nw);

    if (!s || !s.name) {
      s = null;
      const lg = await probe("details legacy " + id, () => legacyDetailsRequest(id, key));
      if (lg.status === "OK" && lg.json && lg.json.result) { s = normLegacyStore(lg.json.result, id); flavor = "legacy"; }
      delete lg.json;
      d.calls.push(lg);
    }

    if (!s || !s.name) { d.places.push({ id, resolved: false }); continue; }
    d.places.push({
      id,
      resolved: true,
      flavor,
      name: s.name,
      address: s.address,
      phone: s.phone,
      mapsUrl: s.mapsUrl,
      utcOffsetMin: s.utcOffsetMin,
      hasHours: !!s.hours,
      periods: s.hours ? s.hours.periods.length : 0,
      weekdayText: s.hours ? s.hours.weekdayText : [],
    });
  }

  const resolved = d.places.filter((p) => p.resolved);
  const withHours = resolved.filter((p) => p.hasHours);
  if (!d.placeIdsUsed.length) {
    d.next =
      "No place IDs resolved. Discovery is the routine /reviews.json shares - open /reviews.json?debug=1, " +
      "which probes both Text Search flavours and names the failing call. Or set GOOGLE_PLACE_IDS " +
      "explicitly to the store place IDs.";
  } else if (!resolved.length) {
    d.next =
      "Place IDs known but no details call succeeded - read the status and error on the details calls " +
      "above. A 403 / REQUEST_DENIED / PERMISSION_DENIED means the key cannot call that API - check the " +
      "key's API restriction in Google Cloud and that billing is enabled on the project.";
  } else if (!withHours.length) {
    d.next =
      resolved.length + " store(s) resolved but Google returned no opening hours for any of them - " +
      "hours are set per store on its Google Business Profile.";
  } else {
    d.next =
      resolved.length + " store(s) would publish, " + withHours.length + " with hours. If /stores.json " +
      "still reads empty, its 6h per-edge cache is holding an older answer - bump STORES_CACHE_V in " +
      "src/stores.js and redeploy to clear it.";
  }
  return Response.json(scrubKey(d, key), { headers: cors });
}

export async function serveStores(request, env, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  if (new URL(request.url).searchParams.get("debug") === "1") return serveStoresDebug(env);
  const out = { ok: false, count: 0, stores: [] };
  // Trimmed: a dashboard paste can carry a trailing newline or space, which
  // Google rejects with a status the public response could never show.
  const key = String((env && env.GOOGLE_PLACES_KEY) || "").trim();
  if (!key) return Response.json(out, { headers: { ...cors, "cache-control": "no-store" } });

  const cache = caches.default;
  const cacheKey = new Request(new URL("/stores.json?v=" + STORES_CACHE_V, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    let ids = configuredIds(env);
    if (!ids.length) ids = await discoverPlaceIds(key);
    const stores = (
      await Promise.all(ids.slice(0, MAX_PLACES).map((id) => fetchStore(id, key).catch(() => null)))
    ).filter((s) => s && s.name);
    // Discovery order is Google's relevance ranking and drifts between
    // calls; sort by name so the band renders in one stable order.
    stores.sort((a, b) => a.name.localeCompare(b.name));
    out.stores = stores;
    out.count = stores.length;
    out.ok = stores.length > 0;
  } catch (e) {
    // fall through with the empty body; ok stays false on total failure
  }

  const res = Response.json(out, {
    headers: { ...cors, "cache-control": out.ok ? `public, max-age=${STORES_TTL_S}` : "no-store" },
  });
  if (out.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
