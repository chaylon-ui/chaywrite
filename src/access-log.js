/* Who looked at customer data (owner, 2026-10-20, privacy review).

   Every staff view of a screen that shows a customer's or an order's
   details is written to the 9Pocket DO as acc:<time>-<rand> = { t, who,
   via, what, id }: the account (or "staff key" when the shared PIN or a
   device key opened it), how, which screen, and the record's own number.
   No address, no IP, no customer data. Kept RETENTION.accessLogDays and
   listed on 9Pocket > Admin with a CSV. Writes ride ctx.waitUntil where a
   ctx exists so pages are not slowed.

   RETENTION is also the single place the nightly sweep (src/retention.js)
   reads its periods from; the admin page prints them. */

export const RETENTION = {
  accessLogDays: 730,          // this log
  buylistDays: 90,             // approved / rejected 9Pocket buylists (BinderPOS keeps the payout record; src/stage.js KEEP_MS)
  stagedDays: 365,             // a staged buylist nobody ever decided
  requestDays: 180,            // item requests once decided (src/requests.js KEEP_MS)
  openRequestDays: 365,        // an item request still open
  contestDaysAfterClose: 90,   // contest entries, pending tokens and draws, counted from the contest's closing time
  heldDays: 30,                // hold-on-arrival rows (src/hold.js prunes these itself)
  deckStatDays: 90,            // deck-builder usage stats by day (src/room.js)
  discordSeenDays: 730,        // Discord "last seen" rows: a member whose last post / last time online is older than this (src/discord-seen.js)
  discordLeftDays: 90,         // the roster row of a Discord member who left the server
  impactDays: 400,             // sales-impact day and week rows (counts only; src/impact.js); order markers go after 150 days
};

const STAGE = "buylist-stage";   // the 9Pocket DO (src/stage.js STAGE_DO; not imported to keep this module cycle-free)

export function logAccess(env, ctx, origin, rec) {
  if (!env || !env.ROOM) return Promise.resolve();
  const body = JSON.stringify({ who: String(rec.who || "").slice(0, 160), via: String(rec.via || "").slice(0, 24), what: String(rec.what || "").slice(0, 60), id: String(rec.id || "").slice(0, 80) });
  const p = env.ROOM.get(env.ROOM.idFromName(STAGE)).fetch(new Request(origin + "/_stage/access", { method: "POST", headers: { "content-type": "application/json" }, body })).then(() => {}).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  return p;
}

/* Which 9Pocket paths show customer or order details, and the record they show. */
export function accessWhat(p) {
  const B = "/9pocket";
  if (p === B || p === B + "/") return { what: "buylists list" };
  if (p === B + ".json") return { what: "buylists list (json)" };
  let m = /^\/9pocket\/b\/([A-Za-z0-9-]{1,40})$/.exec(p); if (m) return { what: "buylist", id: m[1] };
  if (p === B + "/held" || p === B + "/held.json") return { what: "held stock" };
  if (p === B + "/requests" || p === B + "/requests.json") return { what: "requests" };
  m = /^\/9pocket\/requests\/([A-Za-z0-9-]{1,40})$/.exec(p); if (m) return { what: "request", id: m[1] };
  if (p === B + "/win") return { what: "contest entries" };
  if (p === B + "/win/export.csv") return { what: "contest export" };
  if (p === B + "/admin") return { what: "accounts" };
  if (p === B + "/admin/access.csv") return { what: "access log export" };
  return null;
}
