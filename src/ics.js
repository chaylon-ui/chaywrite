/* ---------------- GET /ics — one-link "add to calendar" for store events -------
   Stub: the round-27 add-to-calendar build fills this in (an .ics built from
   query params, converted from America/Halifax to UTC). Until then the route
   answers 501 so the deploy stays green while the module is written. */
export async function serveIcs(request, env, ctx) {
  return new Response(JSON.stringify({ ok: false, error: "not built yet" }), { status: 501, headers: { "content-type": "application/json" } });
}
