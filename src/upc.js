/* Products by barcode, across the whole store, for the Asmodee stock-check
   userscript (snoot-tracker tools/asmodee-stock-check.user.js). Asmodee's
   product pages print each item's UPC; this finds the Exor product with that
   barcode (or SKU, which on distributor stock is the UPC), whatever its type
   or collection, so matching doesn't depend on names.

   GET /upc.json?upcs=5706569150617,029877030712
   -> { found: { "5706569150617": [{ id, h, t, published, vs: [{ id, s, a, p }] }], "029877030712": [...] } }

   Public: it says only what the storefront shows (title, price, whether it can
   be bought); copy counts stay with /qty.json. Active products only. One
   aliased query per call (24 UPCs at most), each UPC tried with and without
   its leading zeros; answers are cached an hour. */

export const UPC_MAX = 24;
const TTL_S = 3600;

export function parseUpcs(raw) {
  return [...new Set(String(raw || "").split(",").map((s) => s.replace(/\D/g, "")).filter((s) => s.length >= 8 && s.length <= 14))].slice(0, UPC_MAX);
}

// The same code as stored with or without leading zeros (UPC-A 12, EAN-13 13).
export function upcForms(u) {
  const bare = u.replace(/^0+/, "");
  return [...new Set([u, bare, bare.padStart(12, "0"), bare.padStart(13, "0")].filter((f) => f.length >= 8))];
}

export function upcQuery(upcs) {
  const one = (u, i) => {
    const q = upcForms(u).flatMap((f) => [`barcode:${f}`, `sku:${f}`]).join(" OR ");
    return `u${i}:productVariants(first:5,query:${JSON.stringify(q)}){edges{node{id sku barcode price availableForSale product{id handle title status onlineStoreUrl}}}}`;
  };
  return `query{${upcs.map(one).join(" ")}}`;
}

export function readUpcs(upcs, data) {
  const found = {};
  const num = (gid) => Number(String(gid || "").replace(/\D/g, "")) || null;
  upcs.forEach((u, i) => {
    const byProduct = new Map();
    for (const edge of (data && data["u" + i] && data["u" + i].edges) || []) {
      const v = edge && edge.node;
      const p = v && v.product;
      if (!p || p.status !== "ACTIVE") continue;
      if (!byProduct.has(p.id)) byProduct.set(p.id, { id: num(p.id), h: p.handle, t: p.title, published: !!p.onlineStoreUrl, vs: [] });
      byProduct.get(p.id).vs.push({ id: num(v.id), s: String(v.sku || v.barcode || ""), a: !!v.availableForSale, p: String(v.price || "") });
    }
    found[u] = [...byProduct.values()];
  });
  return { found };
}

// gql(query) -> data (throws on failure).
export async function serveUpc(request, env, ctx, gql) {
  const url = new URL(request.url);
  const upcs = parseUpcs(url.searchParams.get("upcs"));
  if (!upcs.length) return Response.json({ found: {} }, { headers: { "cache-control": "no-store" } });
  if (!(env && env.SHOPIFY_ADMIN_TOKEN)) return Response.json({ error: "no Admin token on the worker" }, { status: 503, headers: { "cache-control": "no-store" } });
  const cache = caches.default;
  const key = new Request(new URL("/upc.json?upcs=" + encodeURIComponent([...upcs].sort().join(",")), request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let out;
  try { out = readUpcs(upcs, await gql(upcQuery(upcs))); } catch (e) {
    return Response.json({ error: String((e && e.message) || e).slice(0, 200) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  const res = Response.json(out, { headers: { "cache-control": `public, max-age=${TTL_S}` } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
