/* ---------------- GET /ics — one-link "add to calendar" for store events -------
   The theme's event cards (sections/events-strip.liquid) and the calendar
   popover (snippets/basic-Calendar.liquid) link here with the event's own
   fields in the query string; the worker answers a one-event RFC 5545 .ics
   that a phone hands straight to its calendar app. No upstream calls:
   everything the file needs arrives in the URL.

     GET /ics?t=<title>&s=<YYYY-MM-DDTHH:MM>[&e=<YYYY-MM-DDTHH:MM>]
             [&loc=<location>][&d=<description>][&u=<url>][&format=google]

   s/e are Atlantic wall-clock times (America/Halifax: ADT -03:00 in summer,
   AST -04:00 in winter). They are converted to UTC through Intl.DateTimeFormat
   so the DST switch is right for any date, and emitted as DTSTART/DTEND with
   Z. A missing end is start + 3 hours. Any field over 300 characters, an
   empty title, or a date that does not parse answers 400 JSON.
   format=google 302s to a calendar.google.com TEMPLATE URL carrying the same
   data (dates in the same UTC Z form). */

const TZ = "America/Halifax";
const MAX_FIELD = 300;
const DEFAULT_HOURS = 3;
const PRODID = "-//Exor Games//Events//EN";
const UID_DOMAIN = "exorgames.com";
const CORS = { "access-control-allow-origin": "*" };

function bad(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

/* Wall clock of a UTC instant in TZ, re-read as if it were UTC: the
   difference to the instant itself is the zone's offset at that moment
   (-3h in July, -4h in January), which is what Intl knows and Date does not. */
let fmt = null;
function wallClockMs(instantMs) {
  fmt = fmt || new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(instantMs))) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
}
export function offsetMs(instantMs) { return wallClockMs(instantMs) - instantMs; }

/* "YYYY-MM-DDTHH:MM" (seconds optional) read as TZ wall time -> Date (a UTC
   instant), or null when malformed. First guess: the wall time as if UTC
   minus the offset in force at that guess; one more pass settles a guess
   that landed on the wrong side of a DST switch. */
export function localToUtc(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const chk = new Date(wall);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null; // Feb 30 etc.
  let guess = wall - offsetMs(wall);
  guess = wall - offsetMs(guess);
  return new Date(guess);
}

const p2 = (n) => (n < 10 ? "0" : "") + n;
export function utcStamp(d) {
  return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "T" +
    p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z";
}

/* RFC 5545 3.3.11 TEXT: backslash, semicolon and comma are escaped with a
   backslash; a newline becomes the two characters "\n". */
export function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/* RFC 5545 3.1 folding: no content line longer than 75 octets; each
   continuation line starts with one space, which counts toward its 75.
   Splits between code points so a multi-byte character never straddles a
   fold (the reader unfolds by deleting CRLF + space, restoring the bytes). */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = " " + ch; bytes = 1 + b; }
    else { cur += ch; bytes += b; }
  }
  out.push(cur);
  return out.join("\r\n");
}

export function slugify(s) {
  const slug = String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "event";
}

/* UID: the same event (same title, same start) always gets the same id, so a
   phone that imports the link twice updates one entry instead of adding two. */
export async function uidFor(title, dtstart) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(title + dtstart));
  const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 24) + "@" + UID_DOMAIN;
}

/* Query string -> { title, start, end, location, description, url } or { error }. */
export function readEvent(searchParams) {
  const get = (k) => (searchParams.get(k) || "").trim();
  const f = { t: get("t"), s: get("s"), e: get("e"), loc: get("loc"), d: get("d"), u: get("u") };
  for (const k of Object.keys(f)) {
    if (f[k].length > MAX_FIELD) return { error: "field " + k + " is longer than " + MAX_FIELD + " characters" };
  }
  if (!f.t) return { error: "t (title) is required" };
  const start = localToUtc(f.s);
  if (!start) return { error: "s must be a local date-time like 2026-07-10T18:30" };
  let end;
  if (f.e) {
    end = localToUtc(f.e);
    if (!end) return { error: "e must be a local date-time like 2026-07-10T21:30" };
    if (end.getTime() <= start.getTime()) return { error: "e must be after s" };
  } else {
    end = new Date(start.getTime() + DEFAULT_HOURS * 3600e3);
  }
  let url = "";
  if (f.u) {
    if (!/^https?:\/\/\S+$/i.test(f.u)) return { error: "u must be an http(s) URL" };
    url = f.u;
  }
  return { title: f.t, start, end, location: f.loc, description: f.d, url };
}

function details(ev) {
  return ev.description && ev.url ? ev.description + "\n" + ev.url : (ev.description || ev.url || "");
}

export async function buildIcs(ev, now) {
  const dtstart = utcStamp(ev.start), dtend = utcStamp(ev.end);
  const desc = details(ev);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:" + PRODID,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + await uidFor(ev.title, dtstart),
    "DTSTAMP:" + utcStamp(now || new Date()),
    "DTSTART:" + dtstart,
    "DTEND:" + dtend,
    "SUMMARY:" + icsEscape(ev.title),
  ];
  if (ev.location) lines.push("LOCATION:" + icsEscape(ev.location));
  if (desc) lines.push("DESCRIPTION:" + icsEscape(desc));
  if (ev.url) lines.push("URL:" + ev.url);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/* Google Calendar's TEMPLATE link with the same event; dates are the UTC Z
   stamps (the slash between them stays literal - Google reads it either
   way, but the literal form is what every generator emits). */
export function googleUrl(ev) {
  const q = [
    "action=TEMPLATE",
    "text=" + encodeURIComponent(ev.title),
    "dates=" + utcStamp(ev.start) + "/" + utcStamp(ev.end),
    "ctz=" + encodeURIComponent(TZ),
  ];
  const desc = details(ev);
  if (desc) q.push("details=" + encodeURIComponent(desc));
  if (ev.location) q.push("location=" + encodeURIComponent(ev.location));
  return "https://calendar.google.com/calendar/render?" + q.join("&");
}

export async function serveIcs(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return bad(405, "GET only");
  const url = new URL(request.url);
  const ev = readEvent(url.searchParams);
  if (ev.error) return bad(400, ev.error);
  if ((url.searchParams.get("format") || "").toLowerCase() === "google") {
    return new Response(null, {
      status: 302,
      headers: { location: googleUrl(ev), "cache-control": "public, max-age=3600", ...CORS },
    });
  }
  const body = await buildIcs(ev);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "attachment; filename=\"" + slugify(ev.title) + ".ics\"",
      "cache-control": "public, max-age=3600",
      ...CORS,
    },
  });
}
