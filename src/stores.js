/* GET /stores.json — every Exor Games store's live opening hours, straight
   from Google Business Profile via the Places API, so the storefront's
   store-hours band reads the same hours the owner maintains on Google
   Maps (a holiday closure entered there shows on the site within a cache
   cycle, with no theme edit).

   Proxies Google server-side (the key never reaches the browser), tries
   the Places API (New) first and falls back to the legacy web service —
   the same key handling and store discovery as /reviews.json — and
   normalises BOTH flavours to one contract the theme is built against:

     { ok, count, stores: [ { id, name, address, city, province, phone,
         mapsUrl, utcOffsetMin, hours: { periods: [ { open: { day, time },
         close: { day, time } | null } ], weekdayText: [ 7 strings ] },
         source: "exor" | "hours-partner" } ] }

   day 0 = Sunday .. 6 = Saturday (Google's convention); time = "HHMM",
   24-hour. A period with no close is open 24 hours (close: null). Any
   field Google omits is null — hours included, when the business profile
   carries none. city / province (additive, v3) come off the address
   components: the locality's long name and the province's short code
   ("NS"). The response is edge-cached for six hours, so it carries NO
   open_now on purpose: a cached "open" would lie for most of the day.
   The storefront decides open/closed at render time from periods plus
   utcOffsetMin. Fails open to an empty list (no key, quota, outage) so
   the theme falls back to its static hours.

   Google lists only Charlottetown and Truro under the Exor name. The other
   four counters — Summerside, Bridgewater, Dartmouth, New Glasgow — sit
   inside the owner's Most Wanted Pawn shops and keep those shops' hours,
   so their records come off the Most Wanted Pawn listings in the same
   cities (source "hours-partner", additive, v4): a second, hours-only
   discovery below finds them, and the merge keeps the Exor listing
   wherever a city has both. That discovery is private to this file on
   purpose — a pawn shop's reviews are not the game store's, so nothing it
   finds can reach /reviews.json. */

import {
  BROWSER_TTL_S, discoverPlaceIds, MAX_PLACES, newFlavourBlocked, newFlavourSkipped,
  newFlavourState, noteNewFlavour, probe, scrubKey,
} from "./reviews.js";

const STORES_TTL_S = 21600; // 6h at the edge; hours change rarely, holiday edits still land same day

// Edge keeps it STORES_TTL_S (s-maxage); a browser re-asks the edge every
// BROWSER_TTL_S, so an edge refresh reaches visitors within minutes.
const STORES_CACHE_CONTROL = `public, max-age=${BROWSER_TTL_S}, s-maxage=${STORES_TTL_S}`;

/* Fixed edge-cache key (a caller cannot bust it with a query string), so a
   payload-shape change stays invisible for up to STORES_TTL_S unless this
   is bumped. BUMP IT whenever the contract above changes.
   v2: per-city discovery (deploy 197 cached a two-store answer).
   v3: city + province fields; browser max-age 5 min.
   v4: hours-partner records for the four cities with no Exor listing;
       source field. */
const STORES_CACHE_V = "4";

const GHEADERS = { accept: "application/json", "user-agent": "ExorStores/1.0 (+workers.dev)" };

/* addressComponents / address_component sit in the cheapest SKU of each
   flavour, so asking for them adds nothing to a request already paying
   for phone and hours. */
const NEW_FIELDS = "id,displayName,formattedAddress,addressComponents,nationalPhoneNumber,regularOpeningHours,utcOffsetMinutes,googleMapsUri";
const LEGACY_FIELDS = "place_id,name,formatted_address,address_component,formatted_phone_number,opening_hours,utc_offset,url";

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

/* One address component by type, in either flavour's spelling: New is
   { types, longText, shortText }, legacy { types, long_name, short_name }.
   null when the profile carries no such component. */
function component(comps, type, field) {
  for (const c of Array.isArray(comps) ? comps : []) {
    if (c && Array.isArray(c.types) && c.types.includes(type)) return str(c[field]);
  }
  return null;
}

function normNewStore(p, requestedId) {
  if (!p || !p.displayName) return null;
  const h = p.regularOpeningHours;
  return {
    id: str(p.id) || requestedId,
    name: str(p.displayName && p.displayName.text),
    address: str(p.formattedAddress),
    city: component(p.addressComponents, "locality", "longText"),
    province: component(p.addressComponents, "administrative_area_level_1", "shortText"),
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
    city: component(r.address_components, "locality", "long_name"),
    province: component(r.address_components, "administrative_area_level_1", "short_name"),
    phone: str(r.formatted_phone_number),
    mapsUrl: str(r.url),
    utcOffsetMin: int(r.utc_offset),
    hours: h ? normHours(h.periods, h.weekday_text, pointLegacy) : null,
  };
}

/* ---- fetchers: New first, legacy fallback (see reviews.js) ----------
   The New flavour is skipped outright while its circuit breaker is
   tripped (a 403 within the hour, reviews.js); every New response is
   reported to it. */

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
  if (newFlavourBlocked()) return null;
  const r = await newDetailsRequest(id, key);
  const j = await r.json().catch(() => null);
  noteNewFlavour(r.status, j && j.error && j.error.status);
  return r.ok ? normNewStore(j, id) : null;
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

// Every record says which listing it came from (additive field, v4).
function tag(store, source) {
  return store ? { ...store, source } : null;
}

// Details for a list of ids, in parallel; one failure drops one record.
async function fetchStores(ids, key, source) {
  const list = await Promise.all(ids.map((id) => fetchStore(id, key).then((s) => tag(s, source)).catch(() => null)));
  return list.filter((s) => s && s.name);
}

function splitIds(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// GOOGLE_PLACE_IDS: the Exor listings (the same override /reviews.json reads).
function configuredIds(env) {
  return splitIds(env && env.GOOGLE_PLACE_IDS);
}

// GOOGLE_HOURS_PLACE_IDS: the hours-partner listings (this feed only).
function configuredHoursIds(env) {
  return splitIds(env && env.GOOGLE_HOURS_PLACE_IDS);
}

/* ---- hours-partner discovery (Most Wanted Pawn) -----------------------
   One Text Search per city, all six in parallel, deduped by place id -
   the same shape as the Exor discovery in reviews.js, with its own accept
   rule (a listing named Most Wanted ...) and its OWN 24h edge cache key,
   so the two lists can never mix: nothing here is exported, and
   reviews.js has no way to read this cache. Only a non-empty list is
   cached (an outage must not pin "no partners" for a day). The New
   flavour is skipped while the shared breaker holds it, and every New
   response is reported to it. GOOGLE_HOURS_PLACE_IDS overrides the
   search outright, exactly as GOOGLE_PLACE_IDS does for the Exor list. */
const HOURS_CITIES = [
  ["Charlottetown", "PE"],
  ["Summerside", "PE"],
  ["Bridgewater", "NS"],
  ["Dartmouth", "NS"],
  ["New Glasgow", "NS"],
  ["Truro", "NS"],
];
const HOURS_QUERIES = HOURS_CITIES.map(([city, prov]) => "Most Wanted Pawn " + city + " " + prov);
const HOURS_ACCEPT_RE = /most\s*wanted/i;
/* Six cities, plus two spare slots so a city whose own shop Google ranks
   second (behind another location of the chain) still gets in; each id
   costs one details call per edge per 6h, and the merge drops any shop
   outside the six cities. */
const MAX_HOURS_PLACES = HOURS_CITIES.length + 2;

const HOURS_PLACE_IDS_TTL_S = 86400; // a place id never changes; a new shop waits at most a day
const HOURS_PLACE_IDS_CACHE_V = "1"; // bump when HOURS_QUERIES or the accept rule changes

// City names compared case-insensitively with whitespace folded.
function normCity(s) {
  const c = str(s);
  return c ? c.toLowerCase().replace(/\s+/g, " ") : null;
}
const HOURS_CITY_KEYS = new Set(HOURS_CITIES.map(([city]) => normCity(city)));

/* ONE accept rule for the feed and the debug view: each Text Search hit
   as { id, name, accepted }, in either flavour's spelling. */
function hoursHit(id, name) {
  const pid = str(id);
  const n = str(name) || "";
  return { id: pid, name: n, accepted: !!pid && HOURS_ACCEPT_RE.test(n) };
}

function hoursHitsNew(j) {
  return (Array.isArray(j && j.places) ? j.places : [])
    .map((p) => hoursHit(p && p.id, p && p.displayName && p.displayName.text));
}

function hoursHitsLegacy(j) {
  return (j && j.status === "OK" && Array.isArray(j.results) ? j.results : [])
    .map((p) => hoursHit(p && p.place_id, p && p.name));
}

function acceptedIds(hits) {
  return hits.filter((h) => h.accepted).map((h) => h.id);
}

function hoursSearchNewRequest(q, key) {
  return fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      ...GHEADERS,
      "content-type": "application/json",
      "x-goog-api-key": key,
      "x-goog-fieldmask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: q }),
    signal: AbortSignal.timeout(8000),
  });
}

function hoursSearchLegacyRequest(q, key) {
  return fetch(
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
      encodeURIComponent(q) + "&key=" + encodeURIComponent(key),
    { headers: GHEADERS, signal: AbortSignal.timeout(8000) }
  );
}

async function hoursSearchNew(q, key) {
  const r = await hoursSearchNewRequest(q, key).catch(() => null);
  if (!r) return [];
  const j = await r.json().catch(() => null);
  noteNewFlavour(r.status, j && j.error && j.error.status);
  return r.ok ? acceptedIds(hoursHitsNew(j)) : [];
}

async function hoursSearchLegacy(q, key) {
  const r = await hoursSearchLegacyRequest(q, key).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  return acceptedIds(hoursHitsLegacy(j));
}

/* Round-robin across the six searches - every city's top hit first, then
   the second hits, and so on - deduped by id and capped. A chain-wide
   answer to one city's search (Google returns every Most Wanted Pawn for
   "Most Wanted Pawn Summerside PE") must not fill the cap before the
   other cities' best matches are seen. */
function dedupeIds(lists) {
  const ids = [];
  const depth = lists.reduce((n, list) => Math.max(n, list.length), 0);
  for (let i = 0; i < depth; i++) {
    for (const list of lists) {
      const id = list[i];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids.slice(0, MAX_HOURS_PLACES);
}

async function discoverHoursNew(key) {
  if (newFlavourBlocked()) return [];
  return dedupeIds(await Promise.all(HOURS_QUERIES.map((q) => hoursSearchNew(q, key))));
}

async function discoverHoursLegacy(key) {
  return dedupeIds(await Promise.all(HOURS_QUERIES.map((q) => hoursSearchLegacy(q, key))));
}

// Not exported: /stores.json is its only consumer, by construction.
async function discoverHoursPlaceIds(key, request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/hours-place-ids?v=" + HOURS_PLACE_IDS_CACHE_V, request.url).toString());
  const hit = await cache.match(cacheKey).catch(() => null);
  if (hit) {
    const cached = await hit.json().catch(() => null);
    const ids = Array.isArray(cached) ? cached.filter((id) => typeof id === "string" && id) : [];
    if (ids.length) return ids.slice(0, MAX_HOURS_PLACES);
  }
  let ids = await discoverHoursNew(key).catch(() => []);
  if (!ids.length) ids = await discoverHoursLegacy(key).catch(() => []);
  if (ids.length) {
    const put = cache
      .put(cacheKey, Response.json(ids, { headers: { "cache-control": "public, max-age=" + HOURS_PLACE_IDS_TTL_S } }))
      .catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return ids;
}

// The two id lists the feed works from: override, else discovery, capped.
async function exorPlaceIds(env, key, request, ctx) {
  const ids = configuredIds(env);
  return (ids.length ? ids : await discoverPlaceIds(key, request, ctx)).slice(0, MAX_PLACES);
}

async function hoursPlaceIds(env, key, request, ctx) {
  const ids = configuredHoursIds(env);
  return (ids.length ? ids : await discoverHoursPlaceIds(key, request, ctx)).slice(0, MAX_HOURS_PLACES);
}

/* ---- merge: one record per city --------------------------------------
   A partner listing is a store only when it sits in one of the six Exor
   cities (a Text Search for the chain returns the whole chain) and no
   Exor listing already covers that city; a second partner in the same
   city is dropped too. Cities are compared by Google's locality, falling
   back to the city segment of the address ("12 Main St, Truro, NS B2N
   1A1, Canada"). ONE routine serves the feed and the debug view, which
   reports its verdicts - a second copy of the rules would drift. */
const PROVINCE_RE = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;

function cityFromAddress(address) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    if (PROVINCE_RE.test(parts[i])) return parts[i - 1];
  }
  return null;
}

function cityKey(s) {
  return normCity(s.city) || normCity(cityFromAddress(s.address));
}

function mergeStores(exor, partners) {
  const stores = [];
  const verdicts = [];
  const covered = new Map(); // city key -> source that took it
  for (const s of exor) {
    const c = cityKey(s);
    if (c && !covered.has(c)) covered.set(c, "exor");
    stores.push(s);
    verdicts.push({ store: s, city: c, kept: true, reason: "" });
  }
  for (const s of partners) {
    const c = cityKey(s);
    let reason = "";
    if (!c) reason = "no city on the listing";
    else if (!HOURS_CITY_KEYS.has(c)) reason = "not an Exor city";
    else if (covered.get(c) === "exor") reason = "the Exor listing covers " + c;
    else if (covered.has(c)) reason = "another hours partner already covers " + c;
    if (!reason) { covered.set(c, s.source); stores.push(s); }
    verdicts.push({ store: s, city: c, kept: !reason, reason });
  }
  // Discovery order is Google's relevance ranking and drifts between
  // calls; sort by name, then city, so the band renders in one stable order.
  stores.sort((a, b) =>
    a.name.localeCompare(b.name) || String(a.city || a.address || "").localeCompare(String(b.city || b.address || "")));
  const missing = HOURS_CITIES.map(([city]) => city).filter((city) => !covered.has(normCity(city)));
  return { stores, verdicts, missing };
}

/* ---- GET /stores.json?debug=1 ----------------------------------------
   Same idea as /reviews.json?debug=1: the public body cannot tell "no
   key" from "key refused" from "no hours on the profile". This names the
   cause — key presence (length only, never the value), the HTTP + Google
   status of every call in BOTH flavours, and what each resolved store
   carries, plus the merge verdict on every record and which of the six
   cities ended up without one. Exor discovery is the shared routine (and
   its shared 24h edge cache, so a hit here normally bills no searches);
   when it comes up empty the reviews debug view is the one that probes
   those Text Search calls individually. The hours-partner searches have
   no other debug view, so they ARE probed here, one per city, each
   listing what Google returned and whether the name passed the accept
   rule. Bypasses the feed's own edge cache. */

// Same flavour order, accept rule and merge as the feed; every call kept.
async function probeHoursDiscovery(key, calls) {
  let ids = [];
  if (newFlavourBlocked()) {
    calls.push(newFlavourSkipped("searchText New (hours partner, every city)"));
  } else {
    const probes = await Promise.all(HOURS_QUERIES.map((q) =>
      probe("searchText New (hours partner): " + q, () => hoursSearchNewRequest(q, key))));
    for (const nw of probes) {
      noteNewFlavour(nw.http, nw.status);
      nw.found = nw.http === 200 ? hoursHitsNew(nw.json) : [];
      delete nw.json;
      calls.push(nw);
    }
    ids = dedupeIds(probes.map((nw) => acceptedIds(nw.found)));
  }
  if (!ids.length) {
    const probes = await Promise.all(HOURS_QUERIES.map((q) =>
      probe("textsearch legacy (hours partner): " + q, () => hoursSearchLegacyRequest(q, key))));
    for (const lg of probes) {
      lg.found = hoursHitsLegacy(lg.json);
      delete lg.json;
      calls.push(lg);
    }
    ids = dedupeIds(probes.map((lg) => acceptedIds(lg.found)));
  }
  return ids;
}

/* One place's details for the debug view: both flavours probed (New
   unless the breaker holds it), every call recorded. Returns the tagged
   record, or null after pushing an unresolved entry. */
async function probeDetails(id, key, source, d, flavorOf) {
  let s = null;
  let flavor = "";
  const label = " [" + source + "] " + id;
  if (newFlavourBlocked()) {
    d.calls.push(newFlavourSkipped("details New" + label));
  } else {
    const nw = await probe("details New" + label, () => newDetailsRequest(id, key));
    noteNewFlavour(nw.http, nw.status);
    if (nw.http === 200) { s = normNewStore(nw.json, id); flavor = "new"; }
    delete nw.json;
    d.calls.push(nw);
  }

  if (!s || !s.name) {
    s = null;
    const lg = await probe("details legacy" + label, () => legacyDetailsRequest(id, key));
    if (lg.status === "OK" && lg.json && lg.json.result) { s = normLegacyStore(lg.json.result, id); flavor = "legacy"; }
    delete lg.json;
    d.calls.push(lg);
  }

  if (!s || !s.name) { d.places.push({ id, source, resolved: false }); return null; }
  s = tag(s, source);
  flavorOf.set(s, flavor);
  return s;
}

async function serveStoresDebug(request, env, ctx) {
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  const raw = String((env && env.GOOGLE_PLACES_KEY) || "");
  const key = raw.trim();
  const d = {
    keyPresent: !!key,
    keyLength: key.length,
    keyHadSurroundingWhitespace: raw !== key,
    placeIdsConfigured: configuredIds(env),
    hoursPlaceIdsConfigured: configuredHoursIds(env),
    newFlavour: newFlavourState(),
    discovery: null,
    hoursDiscovery: null,
    calls: [],
    placeIdsUsed: [],
    hoursPlaceIdsUsed: [],
    places: [],
    cities: { covered: [], missing: [] },
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
    const source = "discoverPlaceIds (shared with /reviews.json; place-id list edge-cached 24h)";
    try {
      ids = await discoverPlaceIds(key, request, ctx);
      d.discovery = { source, found: ids.length, ms: Date.now() - t0, error: "" };
    } catch (e) {
      ids = [];
      d.discovery = { source, found: 0, ms: Date.now() - t0, error: String((e && e.message) || e) };
    }
  }
  d.placeIdsUsed = ids.slice(0, MAX_PLACES);

  let hoursIds = d.hoursPlaceIdsConfigured.slice();
  if (hoursIds.length) {
    d.hoursDiscovery = { source: "GOOGLE_HOURS_PLACE_IDS", found: hoursIds.length, ms: 0, error: "" };
  } else {
    const t0 = Date.now();
    const source = "Most Wanted Pawn Text Search per city, probed live (the feed caches its own answer 24h under /hours-place-ids)";
    try {
      hoursIds = await probeHoursDiscovery(key, d.calls);
      d.hoursDiscovery = { source, found: hoursIds.length, ms: Date.now() - t0, error: "" };
    } catch (e) {
      hoursIds = [];
      d.hoursDiscovery = { source, found: 0, ms: Date.now() - t0, error: String((e && e.message) || e) };
    }
  }
  d.hoursPlaceIdsUsed = hoursIds.slice(0, MAX_HOURS_PLACES);

  const flavorOf = new Map();
  const exor = [];
  const partners = [];
  for (const id of d.placeIdsUsed) {
    const s = await probeDetails(id, key, "exor", d, flavorOf);
    if (s) exor.push(s);
  }
  for (const id of d.hoursPlaceIdsUsed) {
    const s = await probeDetails(id, key, "hours-partner", d, flavorOf);
    if (s) partners.push(s);
  }

  const merged = mergeStores(exor, partners);
  for (const v of merged.verdicts) {
    const s = v.store;
    d.places.push({
      id: s.id,
      source: s.source,
      resolved: true,
      flavor: flavorOf.get(s) || "",
      kept: v.kept,
      reason: v.reason,
      name: s.name,
      address: s.address,
      city: s.city,
      province: s.province,
      cityKey: v.city,
      phone: s.phone,
      mapsUrl: s.mapsUrl,
      utcOffsetMin: s.utcOffsetMin,
      hasHours: !!s.hours,
      periods: s.hours ? s.hours.periods.length : 0,
      weekdayText: s.hours ? s.hours.weekdayText : [],
    });
  }
  d.cities = {
    covered: HOURS_CITIES.map(([city]) => city).filter((city) => !merged.missing.includes(city)),
    missing: merged.missing,
  };

  const resolved = d.places.filter((p) => p.resolved);
  const published = resolved.filter((p) => p.kept);
  const withHours = published.filter((p) => p.hasHours);
  const partnerNote = d.hoursPlaceIdsUsed.length
    ? ""
    : " The hours-partner searches matched nothing named Most Wanted in any city - read the " +
      "(hours partner) search calls above, each lists what Google returned; GOOGLE_HOURS_PLACE_IDS " +
      "can name the shops' place IDs directly.";
  if (!d.placeIdsUsed.length && !d.hoursPlaceIdsUsed.length) {
    d.next =
      "No place IDs resolved from either discovery. Exor discovery is the routine /reviews.json shares - " +
      "open /reviews.json?debug=1, which probes both Text Search flavours and names the failing call. " +
      "Or set GOOGLE_PLACE_IDS explicitly to the store place IDs." + partnerNote;
  } else if (!resolved.length) {
    d.next =
      "Place IDs known but no details call succeeded - read the status and error on the details calls " +
      "above. A 403 / REQUEST_DENIED / PERMISSION_DENIED means the key cannot call that API - check the " +
      "key's API restriction in Google Cloud and that billing is enabled on the project.";
  } else if (!withHours.length) {
    d.next =
      published.length + " store(s) resolved but Google returned no opening hours for any of them - " +
      "hours are set per store on its Google Business Profile." + partnerNote;
  } else {
    const nExor = published.filter((p) => p.source === "exor").length;
    d.next =
      published.length + " store(s) would publish (" + nExor + " from Exor listings, " +
      (published.length - nExor) + " from Most Wanted Pawn hours partners), " + withHours.length +
      " with hours." +
      (d.cities.missing.length
        ? " No record for " + d.cities.missing.join(", ") + " - neither discovery surfaced a listing " +
          "there (see the calls above), or the merge dropped it (see reason on each place)."
        : "") +
      partnerNote +
      " If /stores.json still reads empty or stale, its 6h per-edge cache is holding an older answer - " +
      "bump STORES_CACHE_V in src/stores.js and redeploy to clear it.";
  }
  return Response.json(scrubKey(d, key), { headers: cors });
}

export async function serveStores(request, env, ctx) {
  const cors = { "access-control-allow-origin": "*" };
  if (new URL(request.url).searchParams.get("debug") === "1") return serveStoresDebug(request, env, ctx);
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
    // Both discoveries at once (independent lists, independent caches); a
    // partner-side failure must never blank the Exor stores, or vice versa.
    const [exorIds, partnerIds] = await Promise.all([
      exorPlaceIds(env, key, request, ctx).catch(() => []),
      hoursPlaceIds(env, key, request, ctx).catch(() => []),
    ]);
    const [exor, partners] = await Promise.all([
      fetchStores(exorIds, key, "exor"),
      fetchStores(partnerIds, key, "hours-partner"),
    ]);
    const { stores } = mergeStores(exor, partners);
    out.stores = stores;
    out.count = stores.length;
    out.ok = stores.length > 0;
  } catch (e) {
    // fall through with the empty body; ok stays false on total failure
  }

  const res = Response.json(out, {
    headers: { ...cors, "cache-control": out.ok ? STORES_CACHE_CONTROL : "no-store" },
  });
  if (out.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
