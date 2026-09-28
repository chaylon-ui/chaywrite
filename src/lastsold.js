/* Last sale per SKU, for the Asmodee stock-check userscript (snoot-tracker
   tools/asmodee-stock-check.user.js): the newest Shopify order carrying each
   SKU, online or at the till (BinderPOS sales arrive as POS orders),
   cancelled orders left out. On our distributor products the SKU is the UPC.

   GET /lastsold.json?skus=824968200612,824968072011&k=<staff PIN>
   -> { window: "all" | "60d", sold: { "824968200612": "2025-06-11T18:21:21Z", "4260402316154": null } }

   Staff-PIN gated like /deckstats.json: how recently something sold is not
   for the public. `window` says how far back the token can see: Shopify
   serves orders older than 60 days only to tokens holding read_all_orders, so
   a null under "60d" means "no sale in 60 days", not "never sold". One
   aliased query per call (24 SKUs at most); answers are cached an hour. */

export const LASTSOLD_MAX = 24;
const TTL_S = 3600;

export function parseSkus(raw) {
  return [...new Set(String(raw || "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9._-]{3,40}$/.test(s)))].slice(0, LASTSOLD_MAX);
}

export function lastSoldQuery(skus) {
  const one = (s, i) => `s${i}:orders(first:1,sortKey:CREATED_AT,reverse:true,query:${JSON.stringify("sku:" + s + " -status:cancelled")}){edges{node{createdAt}}}`;
  return `query{app:currentAppInstallation{accessScopes{handle}} ${skus.map(one).join(" ")}}`;
}

export function readLastSold(skus, data) {
  const scopes = ((data && data.app && data.app.accessScopes) || []).map((a) => a && a.handle);
  const sold = {};
  skus.forEach((s, i) => {
    const edge = data && data["s" + i] && data["s" + i].edges && data["s" + i].edges[0];
    sold[s] = (edge && edge.node && edge.node.createdAt) || null;
  });
  return { window: scopes.includes("read_all_orders") ? "all" : "60d", sold };
}

// gql(query) -> data (throws on failure); staffOk(env, origin, k) -> bool.
export async function serveLastSold(request, env, ctx, gql, staffOk) {
  const url = new URL(request.url);
  if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) {
    return Response.json({ error: "staff PIN required" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const skus = parseSkus(url.searchParams.get("skus"));
  if (!skus.length) return Response.json({ window: null, sold: {} }, { headers: { "cache-control": "no-store" } });
  if (!(env && env.SHOPIFY_ADMIN_TOKEN)) return Response.json({ error: "no Admin token on the worker" }, { status: 503, headers: { "cache-control": "no-store" } });
  // The cache key holds the SKUs only: the PIN was checked above, never cached.
  const cache = caches.default;
  const key = new Request(new URL("/lastsold.internal?s=" + encodeURIComponent([...skus].sort().join(",")), request.url).toString());
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  let out;
  try { out = readLastSold(skus, await gql(lastSoldQuery(skus))); } catch (e) {
    return Response.json({ error: String((e && e.message) || e).slice(0, 200) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const body = JSON.stringify(out);
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL_S}` } })));
  return new Response(body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}
