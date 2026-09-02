/* ---------------- /price-history.json — nightly price snapshots for singles ----
   Stub: the round-27 price-history build fills this in (nightly snapshot of
   every "Single" product's price into a Durable Object, served per product
   for the card page sparkline). Until then the route answers 501 so the
   deploy stays green while the module is written. */
export async function servePriceHistory(request, env, ctx) {
  return new Response(JSON.stringify({ ok: false, error: "not built yet" }), { status: 501, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}
