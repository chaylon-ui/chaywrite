import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkus, lastSoldQuery, readLastSold, serveLastSold, LASTSOLD_MAX } from "../src/lastsold.js";

// caches.default for the handler, in memory.
const store = new Map();
globalThis.caches = { default: { match: async (r) => { const b = store.get(r.url); return b ? new Response(b) : undefined; }, put: async (r, res) => { store.set(r.url, await res.text()); } } };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const staffOk = async (env, origin, k) => k === "1234";
const env = { SHOPIFY_ADMIN_TOKEN: "shpat_test" };

test("SKUs: trimmed, de-duplicated, junk dropped, capped", () => {
  assert.deepEqual(parseSkus(" 824968200612,824968200612, ,a,<x>,USAPA025-846 "), ["824968200612", "USAPA025-846"]);
  assert.equal(parseSkus(Array.from({ length: 40 }, (_, i) => "10000000000" + i).join(",")).length, LASTSOLD_MAX);
});

test("one aliased query, cancelled orders left out, SKUs quoted", () => {
  const q = lastSoldQuery(["824968200612", 'x"y']);
  assert.match(q, /s0:orders\(first:1,sortKey:CREATED_AT,reverse:true,query:"sku:824968200612 -status:cancelled"\)/);
  assert.match(q, /s1:orders\(first:1,sortKey:CREATED_AT,reverse:true,query:"sku:x\\"y -status:cancelled"\)/);
  assert.match(q, /app:currentAppInstallation\{accessScopes\{handle\}\}/);
});

test("answers map back to SKUs; the window follows read_all_orders", () => {
  const data = { app: { accessScopes: [{ handle: "read_orders" }, { handle: "read_all_orders" }] }, s0: { edges: [{ node: { createdAt: "2025-06-11T18:21:21Z" } }] }, s1: { edges: [] } };
  assert.deepEqual(readLastSold(["824968200612", "4260402316154"], data), { window: "all", sold: { "824968200612": "2025-06-11T18:21:21Z", "4260402316154": null } });
  assert.equal(readLastSold(["1"], { app: { accessScopes: [{ handle: "read_orders" }] }, s0: { edges: [] } }).window, "60d");
});

test("the handler: PIN first, then one Admin call, then the cache", async () => {
  let calls = 0;
  const gql = async (q) => { calls++; return { app: { accessScopes: [{ handle: "read_orders" }] }, s0: { edges: [{ node: { createdAt: "2026-06-04T21:34:46Z" } }] } }; };
  const url = (k) => `https://exor-binder.nevski.workers.dev/lastsold.json?skus=824968072011${k ? "&k=" + k : ""}`;
  assert.equal((await serveLastSold(new Request(url()), env, ctx, gql, staffOk)).status, 403);
  assert.equal((await serveLastSold(new Request(url("0000")), env, ctx, gql, staffOk)).status, 403);
  assert.equal(calls, 0, "no Admin call without the PIN");
  const r = await serveLastSold(new Request(url("1234")), env, ctx, gql, staffOk);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { window: "60d", sold: { "824968072011": "2026-06-04T21:34:46Z" } });
  await Promise.all(ctx.waits);
  const again = await serveLastSold(new Request(url("1234")), env, ctx, gql, staffOk);
  assert.deepEqual(await again.json(), { window: "60d", sold: { "824968072011": "2026-06-04T21:34:46Z" } });
  assert.equal(calls, 1, "the second ask comes from the cache");
  assert.equal((await serveLastSold(new Request(url("1234")), {}, ctx, gql, staffOk)).status, 503, "no token, no answer");
  const bad = await serveLastSold(new Request(url("1234").replace("824968072011", "999999999999")), env, ctx, async () => { throw new Error("admin HTTP 500"); }, staffOk);
  assert.equal(bad.status, 502);
});
