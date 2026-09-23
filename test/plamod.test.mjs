import { test } from "node:test";
import assert from "node:assert/strict";
import { imageKey, plamodTargets } from "../src/plamod.js";

test("imageKey: PLAMOD's GUID file names, on PLAMOD and on our Shopify copies", () => {
  assert.equal(imageKey("https://cdn.shopify.com/s/files/1/0467/3083/8169/products/56E3EAA2-8CE1-11E6-8588-1A8B06F1886E-L.png?v=1737284190"), "56E3EAA2-8CE1-11E6-8588-1A8B06F1886E");
  assert.equal(imageKey("https://images.plamod.com/44E64DF7-DB48-11ED-82C1-0E3221E31575/2264B66A-4AE5-11EF-9B30-262E661BFA1B.png"), "2264B66A-4AE5-11EF-9B30-262E661BFA1B"); // the image, not the folder
  assert.equal(imageKey("https://cdn.shopify.com/s/files/1/x/files/5F4560D0-11EC-11EE-9DD1-D4D270DC2DAF-L_0a1b2c3d-1111-2222-3333-444455556666.png"), "5F4560D0-11EC-11EE-9DD1-D4D270DC2DAF");
  assert.equal(imageKey("https://cdn.shopify.com/s/files/1/0467/3083/8169/products/1_1f0115b9-0dcf-4ea5-a6c6-f14c32428612.jpg"), null); // Shopify's own rename
});

test("plamodTargets: pages, reads the barcode (or a numeric SKU), waits out a throttle", async () => {
  let calls = 0;
  const pages = [
    { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ id: "g1", title: "A", productType: "Gunpla", variants: { nodes: [{ barcode: "4573102630841", sku: "x" }] }, media: { nodes: [{ image: { url: "https://x/products/56E3EAA2-8CE1-11E6-8588-1A8B06F1886E-L.png" } }, {}] } }] } },
    { products: { pageInfo: { hasNextPage: false }, nodes: [{ id: "g2", title: "B", productType: "Figures", variants: { nodes: [{ barcode: "", sku: "4573102601735" }] }, media: { nodes: [] } }] } },
  ];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const items = await plamodTargets(async () => {
      calls++;
      if (calls === 2) { const e = new Error("throttled"); e.throttled = true; throw e; }
      return pages[calls === 1 ? 0 : 1];
    });
    assert.deepEqual(items.map((i) => [i.id, i.barcode, i.images, i.keys.length]), [["g1", "4573102630841", 1, 1], ["g2", "4573102601735", 0, 0]]);
    assert.equal(calls, 3);
  } finally { globalThis.setTimeout = realSetTimeout; }
});
