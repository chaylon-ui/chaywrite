/* Nightly retention sweep (owner, 2026-10-20, privacy review): personal
   data past the periods in src/access-log.js RETENTION is deleted from
   every store that holds some. The 9Pocket DO decides whether a sweep is
   due (once a day; its /_stage/sweep records the last run) and the other
   stores follow; counts only ever reach the log, never a name. Driven by
   the worker cron (src/index.js scheduled()). */

import { STAGE_DO } from "./stage.js";
import { REQUESTS_DO } from "./requests.js";
import { WIN_DO } from "./win.js";
import { SEEN_DO } from "./discord-seen.js";
import { IMPACT_DO } from "./impact.js";

const ORIGIN = "https://exor-binder.internal";

async function call(env, name, path, body) {
  const r = await env.ROOM.get(env.ROOM.idFromName(name)).fetch(new Request(ORIGIN + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }));
  return r.json();
}

export async function retentionTick(env, opts) {
  const o = opts || {};
  if (!env || !env.ROOM) return { skipped: "no storage" };
  const st = await call(env, STAGE_DO, "/_stage/sweep", { force: !!o.force });
  if (st.skipped) return { skipped: "not due" };
  const others = {};
  try { others.requests = (await call(env, REQUESTS_DO, "/_req/sweep")).counts || "failed"; } catch { others.requests = "failed"; }
  try { others.contest = (await call(env, WIN_DO, "/_win/sweep")).counts || "failed"; } catch { others.contest = "failed"; }
  try { others.discord = (await call(env, SEEN_DO, "/_seen/sweep")).counts || "failed"; } catch { others.discord = "failed"; }
  try { others.impact = (await call(env, IMPACT_DO, "/_imp/sweep")).counts || "failed"; } catch { others.impact = "failed"; }
  await call(env, STAGE_DO, "/_stage/sweep-note", { others });
  return { ran: true, stage: st.last && st.last.counts, others };
}
