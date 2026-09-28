import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpcs, upcForms, upcQuery, readUpcs, serveUpc, UPC_MAX } from "../src/upc.js";

// caches.default for the handler, in memory.
const store = new Map();
globalThis.caches = { default: { match: async (r) => { const b = store.get(r.url); return b ? new Response(b) : undefined; }, put: async (r, res) => { store.set(r.url, await res.text()); } } };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const env = { SHOPIFY_ADMIN_TOKEN: "shpat_test" };

test("UPCs: digits only, 8-14 long, de-duplicated, capped", () => {
  assert.deepEqual(parseUpcs(" 5706569150617,5706569150617,,12,abc,0298-7703-0712,123456789012345 "), ["5706569150617", "029877030712"]);
  assert.equal(parseUpcs(Array.from({ length: 40 }, (_, i) => "10000000000" + i).join(",")).length, UPC_MAX);
});

test("each UPC is tried with and without its leading zeros", () => {
  assert.deepEqual(upcForms("029877030712"), ["029877030712", "29877030712", "0029877030712"]);
  assert.deepEqual(upcForms("5706569150617"), ["5706569150617"], "an EAN-13 with no leading zero has one form");
  const q = upcQuery(["029877030712", "5706569150617"]);
  assert.match(q, /^query\{u0:productVariants\(first:5,query:"barcode:029877030712 OR sku:029877030712 OR barcode:29877030712 OR sku:29877030712 OR barcode:0029877030712 OR sku:0029877030712"\)/);
  assert.match(q, /u1:productVariants\(first:5,query:"barcode:5706569150617 OR sku:5706569150617"\)/);
  assert.match(q, /product\{id handle title status onlineStoreUrl\}/);
});

test("answers map back to UPCs, grouped by product, active products only", () => {
  const v = (id, sku, pid, extra = {}) => ({ node: { id: "gid://shopify/ProductVariant/" + id, sku, barcode: sku, price: "14.99", availableForSale: true, product: { id: "gid://shopify/Product/" + pid, handle: "h" + pid, title: "T" + pid, status: "ACTIVE", onlineStoreUrl: "https://exorgames.com/products/h" + pid, ...extra } } });
  const data = {
    u0: { edges: [v(42794836492461, "5706569150617", 1), v(42794836492462, "5706569150617", 1)] },
    u1: { edges: [v(9, "029877030712", 2, { status: "DRAFT" })] },
    u2: { edges: [v(10, "8032611691232", 3, { onlineStoreUrl: null })] },
  };
  const out = readUpcs(["5706569150617", "029877030712", "8032611691232", "111111111111"], data).found;
  assert.deepEqual(out["5706569150617"], [{ id: 1, h: "h1", t: "T1", published: true, vs: [{ id: 42794836492461, s: "5706569150617", a: true, p: "14.99" }, { id: 42794836492462, s: "5706569150617", a: true, p: "14.99" }] }]);
  assert.deepEqual(out["029877030712"], [], "a draft is not offered");
  assert.equal(out["8032611691232"][0].published, false, "active but not on the online store: found, marked unpublished");
  assert.deepEqual(out["111111111111"], [], "no answer is an empty list");
});

test("the handler: one Admin call, then the cache; no token 503; errors 502", async () => {
  let calls = 0;
  const gql = async () => { calls++; return { u0: { edges: [{ node: { id: "gid://shopify/ProductVariant/5", sku: "5706569150617", barcode: "", price: "14.99", availableForSale: true, product: { id: "gid://shopify/Product/7", handle: "justice", title: "DRAGON SHIELD MATTE DUAL JUSTICE 100CT", status: "ACTIVE", onlineStoreUrl: "x" } } }] } }; };
  const url = "https://exor-binder.nevski.workers.dev/upc.json?upcs=5706569150617";
  const r = await serveUpc(new Request(url), env, ctx, gql);
  assert.equal(r.status, 200);
  const want = { found: { "5706569150617": [{ id: 7, h: "justice", t: "DRAGON SHIELD MATTE DUAL JUSTICE 100CT", published: true, vs: [{ id: 5, s: "5706569150617", a: true, p: "14.99" }] }] } };
  assert.deepEqual(await r.json(), want);
  await Promise.all(ctx.waits);
  assert.deepEqual(await (await serveUpc(new Request(url), env, ctx, gql)).json(), want);
  assert.equal(calls, 1, "the second ask comes from the cache");
  assert.deepEqual(await (await serveUpc(new Request(url.replace(/\?.*/, "?upcs=12")), env, ctx, gql)).json(), { found: {} }, "nothing to ask, no call");
  assert.equal(calls, 1);
  assert.equal((await serveUpc(new Request(url.replace("5706569150617", "5706569150488")), {}, ctx, gql)).status, 503, "no token, no answer");
  const bad = await serveUpc(new Request(url.replace("5706569150617", "5706569151614")), env, ctx, async () => { throw new Error("admin HTTP 500"); });
  assert.equal(bad.status, 502);
});
