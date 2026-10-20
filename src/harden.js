/* Response hardening (owner, 2026-10-20, privacy review): every answer the
   worker gives carries the usual browser protections, and staff screens
   also refuse to be framed, send no referrer and are never cached.
   WebSocket upgrades pass through untouched. Existing headers win. */

export const STAFF_PREFIXES = ["/9pocket", "/staff", "/pickups", "/admin", "/autoprice", "/portal", "/deckstats", "/hold", "/buylist/staged", "/buylist/poc", "/discord", "/discord-events", "/discord-seen", "/enrich"];

export function isStaffPath(p) {
  return STAFF_PREFIXES.some((x) => p === x || p.startsWith(x + "/") || p.startsWith(x + "."));
}

export function harden(res, url) {
  if (!res || res.status === 101 || res.webSocket) return res;
  const out = new Response(res.body, res);
  const h = out.headers;
  const set = (k, v) => { if (!h.has(k)) h.set(k, v); };
  set("x-content-type-options", "nosniff");
  set("strict-transport-security", "max-age=31536000; includeSubDomains");
  set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (isStaffPath(url.pathname)) {
    h.set("x-frame-options", "DENY");
    h.set("referrer-policy", "no-referrer");
    set("cache-control", "no-store");
  } else {
    set("referrer-policy", "strict-origin-when-cross-origin");
  }
  return out;
}
