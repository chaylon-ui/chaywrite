import { test } from "node:test";
import assert from "node:assert/strict";
import { spliceSpan, editPage } from "../src/page-edit.js";

test("spliceSpan replaces exactly one literal span and refuses anything else", () => {
  const body = '<p>a</p>\n<a class="x" href="u">old <span>1</span></a>\n<p>b</p>';
  const r = spliceSpan(body, '<a class="x"', "</a>", "<img>");
  assert.equal(r.ok, true); assert.equal(r.removed, '<a class="x" href="u">old <span>1</span></a>'); assert.equal(r.next, "<p>a</p>\n<img>\n<p>b</p>");
  assert.deepEqual([r.before, r.after], [9, 9]);
  assert.equal(spliceSpan(body, "<p>", "</p>", "").error, "find_start occurs 2 times; need exactly 1");
  assert.match(spliceSpan(body, '<a class="x"', "</table>", "").error, /find_end not found/);
  assert.equal(spliceSpan(body, "old", "", "new").next, body.replace("old", "new"));
  assert.match(spliceSpan(body, "", "", "").error, /required/);
});

test("editPage: dry run reads and reports, a real run saves and re-reads", async () => {
  const saved = globalThis.fetch;
  let body = "<p>hello</p><a class=\"xgbl-vg\">x</a><p>end</p>";
  const calls = [];
  globalThis.fetch = async (u, init) => {
    const q = JSON.parse(init.body);
    calls.push(q.query.slice(0, 30));
    if (q.query.startsWith("mutation")) { body = q.variables.body; return new Response(JSON.stringify({ data: { pageUpdate: { page: { id: q.variables.id, updatedAt: "t2" }, userErrors: [] } } }), { status: 200 }); }
    return new Response(JSON.stringify({ data: { page: { id: q.variables.id, title: "T", handle: "h", updatedAt: "t1", body } } }), { status: 200 });
  };
  try {
    const env = { SHOPIFY_ADMIN_TOKEN: "t" };
    const dry = await editPage(env, { pageId: "99314368685", findStart: '<a class="xgbl-vg">', findEnd: "</a>", replaceB64: Buffer.from("<img>").toString("base64"), dry: true });
    assert.equal(dry.ok, true); assert.equal(dry.dry, true); assert.equal(dry.removed, '<a class="xgbl-vg">x</a>'); assert.equal(dry.inserted, "<img>"); assert.equal(dry.next.length, "<p>hello</p><img><p>end</p>".length);
    assert.equal(calls.length, 1); assert.equal(body.includes("<img>"), false);
    const real = await editPage(env, { pageId: "99314368685", findStart: '<a class="xgbl-vg">', findEnd: "</a>", replacement: "<img>", dry: false });
    assert.equal(real.ok, true); assert.equal(real.saved, true); assert.equal(real.verified, true); assert.equal(body, "<p>hello</p><img><p>end</p>");
    assert.equal((await editPage({}, { pageId: "1", findStart: "x" })).error, "no SHOPIFY_ADMIN_TOKEN on the worker");
  } finally { globalThis.fetch = saved; }
});
