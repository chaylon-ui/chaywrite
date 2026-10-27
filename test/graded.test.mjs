// 9Pocket > Graded cards (owner, 2026-10-27): the title shape, the certificate link, the product input, the add itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleOf, cleanForm, certUrlOf, cleanUrl, productInput, createGraded, setupCheck, recentGraded, PLACEHOLDER_PRICE, LOCATION, ONLINE_STORE_PUBLICATION, ADD_TAG } from "../src/graded.js";
import { parseGraded } from "../src/autoprice.js";
import { STAFF_PERMS, can } from "../src/stage-auth.js";
import { renderGraded, renderGradedDenied } from "../src/graded-ui.js";

test("titles follow the store's graded naming and the auto-pricer reads them back", () => {
  const t1 = titleOf({ name: "Dark Muk", number: "41/82", set: "Team Rocket 1st Edition", grader: "psa", grade: "9" });
  assert.equal(t1, "Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9");
  const p1 = parseGraded(t1);
  assert.equal(p1.grader, "PSA"); assert.equal(p1.grade, 9); assert.match(p1.name, /dark muk/i); assert.match(String(p1.set || ""), /team rocket/i); assert.equal(!!p1.japanese, false);
  const t2 = titleOf({ name: "Kadabra", number: "064/165", finish: "Reverse Holo", japanese: "1", grader: "PSA", grade: "9" });
  assert.equal(t2, "Kadabra (064/165) Reverse Holo Japanese Graded PSA 9");
  assert.equal(!!parseGraded(t2).japanese, true);
  const t3 = titleOf({ name: "Raichu & Alolan Raichu GX", number: "221/236", set: "Sun & Moon: Unified Minds", grader: "CGC", grade: "10", label: "Pristine" });
  assert.equal(t3, "Raichu & Alolan Raichu GX (221/236) [Sun & Moon: Unified Minds] Graded CGC 10 Pristine");
  const p3 = parseGraded(t3); assert.equal(p3.grader, "CGC"); assert.equal(p3.grade, 10);
  assert.equal(titleOf({ name: "  Pikachu ", grader: "bgs", grade: "9.5" }), "Pikachu Graded BGS 9.5");
});

test("cleanForm: what is essential, the price rules, the certificate number and link", () => {
  assert.equal(cleanForm({ grader: "PSA", grade: "9" }).error, "Type the card's name.");
  assert.equal(cleanForm({ name: "Pikachu", grader: "XYZ", grade: "9" }).error, "Pick the grading company.");
  assert.equal(cleanForm({ name: "Pikachu", grader: "PSA", grade: "11" }).error, "Pick the grade.");
  assert.match(cleanForm({ name: "Pikachu", grader: "PSA", grade: "9" }).error, /Enter a price, or tick auto-pricing/);
  const ph = cleanForm({ name: "Pikachu", grader: "PSA", grade: "9", auto_price: "1" });
  assert.equal(ph.price, PLACEHOLDER_PRICE); assert.equal(ph.placeholder, true); assert.equal(ph.autoPrice, true); assert.equal(ph.qty, 1);
  const f = cleanForm({ name: "Dark Muk", number: "41/82", set: "Team Rocket 1st Edition", grader: "psa", grade: "9", price: "$1,234.5", cost: "600", qty: "2", cert: " 8765 4321 ", qr_url: "https://www.psacard.com/cert/87654321", notes: "<b>nice</b>" });
  assert.equal(f.price, "1234.50"); assert.equal(f.cost, "600.00"); assert.equal(f.qty, 2); assert.equal(f.cert, "87654321"); assert.equal(f.placeholder, false); assert.equal(f.autoPrice, false);
  assert.equal(f.title, "Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9"); assert.equal(f.certUrl, "https://www.psacard.com/cert/87654321");
  assert.equal(cleanUrl("javascript:alert(1)"), ""); assert.equal(cleanUrl("http://x.example/a b"), ""); assert.equal(cleanUrl(" https://www.cgccards.com/certlookup/4312345001/ "), "https://www.cgccards.com/certlookup/4312345001/");
  assert.equal(certUrlOf("PSA", "12345678", ""), "https://www.psacard.com/cert/12345678");
  assert.equal(certUrlOf("CGC", "4312345001", ""), "https://www.cgccards.com/certlookup/4312345001/");
  assert.equal(certUrlOf("BGS", "0012345678", ""), "", "no public cert page known for BGS without the QR");
  assert.equal(certUrlOf("BGS", "0012345678", "https://www.beckett.com/grading/card-lookup?item_id=1"), "https://www.beckett.com/grading/card-lookup?item_id=1", "the QR link wins");
  assert.equal(cleanForm({ name: "Pikachu", grader: "PSA", grade: "9", price: "abc" }).error, "The price does not look right.");
});

test("productInput: type, vendor, tags, the new-window certificate link, one in stock at the store, SKU and barcode from the cert", () => {
  const f = cleanForm({ game: "pokemon", name: "Dark Muk", number: "41/82", set: "Team Rocket 1st Edition", grader: "PSA", grade: "9", price: "99.95", cert: "87654321", auto_price: "1", notes: "light scuff" });
  const i = productInput(f, ["https://bucket.example/tmp/1.jpg", "https://bucket.example/tmp/2.jpg"]);
  assert.equal(i.productType, "Pokemon Single Graded"); assert.equal(i.vendor, "Pokémon"); assert.equal(i.status, "ACTIVE");
  assert.deepEqual(i.tags, ["Graded", "PSA", ADD_TAG, "Team Rocket 1st Edition", "auto-price"]);
  assert.match(i.descriptionHtml, /<a href="https:\/\/www\.psacard\.com\/cert\/87654321" target="_blank" rel="noopener noreferrer">View the PSA certificate<\/a>/);
  assert.match(i.descriptionHtml, /certificate 87654321/); assert.match(i.descriptionHtml, /<p>light scuff<\/p>/);
  assert.deepEqual(i.productOptions, [{ name: "Title", values: [{ name: "Default Title" }] }]);
  const v = i.variants[0];
  assert.equal(v.price, "99.95"); assert.equal(v.sku, "PSA-87654321"); assert.equal(v.barcode, "87654321");
  assert.deepEqual(v.inventoryQuantities, [{ locationId: LOCATION, name: "available", quantity: 1 }]); assert.deepEqual(v.inventoryItem, { tracked: true });
  assert.deepEqual(v.optionValues, [{ optionName: "Title", name: "Default Title" }]);
  assert.equal(i.files.length, 2); assert.equal(i.files[0].originalSource, "https://bucket.example/tmp/1.jpg"); assert.equal(i.files[0].contentType, "IMAGE"); assert.equal(i.files[1].alt, f.title + " (2)");
  assert.deepEqual(i.metafields.map((m) => m.key), ["grader", "grade", "cert_number", "cert_url"]); assert.equal(i.metafields[3].type, "url");
  const g = productInput(cleanForm({ game: "mtg", name: "Black Lotus", grader: "BGS", grade: "9.5", label: "Gem Mint", price: "25000", cost: "18000" }), []);
  assert.equal(g.productType, "MTG Single Graded"); assert.deepEqual(g.tags, ["Graded", "BGS", ADD_TAG]); assert.equal(g.variants[0].sku, undefined); assert.deepEqual(g.variants[0].inventoryItem, { tracked: true, cost: "18000.00" }); assert.equal(g.files.length, 0);
  assert.equal(g.title, "Black Lotus Graded BGS 9.5 Gem Mint"); assert.equal(g.metafields.length, 2);
});

// A fake Shopify: staged upload target, the bucket, productSet, publish, scopes.
function fakeShopify(o) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const u = String(url);
    if (u.includes("/admin/api/")) {
      const body = JSON.parse(init.body);
      const op = /stagedUploadsCreate/.test(body.query) ? "staged" : /productSet/.test(body.query) ? "set" : /publishablePublish/.test(body.query) ? "publish" : /currentAppInstallation/.test(body.query) ? "setup" : /tag:9pocket-graded/.test(body.query) ? "recent" : "?";
      calls.push({ op, vars: body.variables });
      if (op === "staged") return Response.json({ data: { stagedUploadsCreate: { stagedTargets: [{ url: "https://bucket.example/up", resourceUrl: "https://bucket.example/tmp/" + calls.length + ".jpg", parameters: [{ name: "key", value: "tmp/" + calls.length }, { name: "policy", value: "p" }] }], userErrors: [] } } });
      if (op === "set") return Response.json({ data: { productSet: o.setErrors ? { product: null, userErrors: o.setErrors } : { product: { id: "gid://shopify/Product/123", handle: "dark-muk-41-82-team-rocket-1st-edition-graded-psa-9", title: body.variables.input.title }, userErrors: [] } } });
      if (op === "publish") return Response.json({ data: { publishablePublish: { userErrors: o.publishErrors || [] } } });
      if (op === "setup") return Response.json({ data: { currentAppInstallation: { accessScopes: (o.scopes || []).map((h) => ({ handle: h })) }, location: { name: "51 Allen Street", isActive: true } } });
      if (op === "recent") return Response.json({ data: { products: { nodes: [{ id: "gid://shopify/Product/123", title: "Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9", handle: "dark-muk", status: "ACTIVE", createdAt: "2026-10-27T18:00:00Z", totalInventory: 1, tags: ["auto-price"], variants: { nodes: [{ price: "99.95" }] }, media: { nodes: [{ image: { url: "https://cdn.example/a.jpg" } }] } }] } } });
      return Response.json({ errors: [{ message: "unexpected" }] });
    }
    calls.push({ op: "upload", url: u, body: init.body });
    return new Response(null, { status: 201 });
  };
  return { calls, cx: { env: { SHOPIFY_ADMIN_TOKEN: "t" }, fetch: fetchFn, now: () => 1, log: () => {} } };
}
const photo = (n) => ({ name: "p" + n + ".jpg", type: "image/jpeg", size: 3, arrayBuffer: async () => new Uint8Array([1, 2, n]).buffer });

test("createGraded: photos staged and uploaded, one productSet, published to the Online Store; errors come back plainly", async () => {
  const s = fakeShopify({});
  const form = { name: "Dark Muk", number: "41/82", set: "Team Rocket 1st Edition", grader: "PSA", grade: "9", price: "99.95", cert: "87654321", auto_price: "1" };
  const r = await createGraded(s.cx, form, [photo(1), photo(2)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(s.calls.map((c) => c.op), ["staged", "upload", "staged", "upload", "set", "publish"]);
  assert.equal(s.calls[0].vars.input[0].resource, "IMAGE"); assert.equal(s.calls[0].vars.input[0].fileSize, "3"); assert.equal(s.calls[0].vars.input[0].mimeType, "image/jpeg");
  const up = s.calls[1]; assert.equal(up.url, "https://bucket.example/up"); assert.ok(up.body instanceof FormData); assert.equal(up.body.get("key"), "tmp/1"); assert.ok(up.body.get("file") instanceof Blob, "the file is the last part");
  const input = s.calls[4].vars.input;
  assert.equal(input.title, "Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9"); assert.deepEqual(input.files.map((f) => f.originalSource), ["https://bucket.example/tmp/1.jpg", "https://bucket.example/tmp/3.jpg"]);
  assert.deepEqual(s.calls[5].vars, { id: "gid://shopify/Product/123", input: [{ publicationId: ONLINE_STORE_PUBLICATION }] });
  assert.equal(r.handle, "dark-muk-41-82-team-rocket-1st-edition-graded-psa-9"); assert.equal(r.url, "https://exorgames.com/products/dark-muk-41-82-team-rocket-1st-edition-graded-psa-9"); assert.equal(r.adminUrl, "https://admin.shopify.com/store/most-wanted-ca/products/123");
  assert.equal(r.photos, 2); assert.equal(r.published, true); assert.equal(r.placeholder, false); assert.equal(r.autoPrice, true); assert.equal(r.certUrl, "https://www.psacard.com/cert/87654321");
  // no photos is fine; the product still goes up
  const s2 = fakeShopify({ publishErrors: [{ field: null, message: "Access denied for publishablePublish" }] });
  const r2 = await createGraded(s2.cx, { ...form, price: "" }, []);
  assert.equal(r2.ok, true); assert.equal(r2.photos, 0); assert.equal(r2.placeholder, true); assert.equal(r2.published, false); assert.match(r2.publishError, /Access denied/);
  assert.equal(s2.calls[0].vars.input.variants[0].price, PLACEHOLDER_PRICE); assert.deepEqual(s2.calls[0].vars.input.files, []);
  // Shopify refusing the product
  const s3 = fakeShopify({ setErrors: [{ field: ["input", "title"], message: "Title can't be blank" }] });
  const r3 = await createGraded(s3.cx, form, []);
  assert.equal(r3.ok, false); assert.match(r3.error, /Shopify refused the product: input.title: Title can't be blank/); assert.deepEqual(s3.calls.map((c) => c.op), ["set"]);
  // a bad form never reaches Shopify; no token says so
  const s4 = fakeShopify({});
  assert.deepEqual(await createGraded(s4.cx, { grader: "PSA", grade: "9" }, []), { ok: false, error: "Type the card's name." }); assert.equal(s4.calls.length, 0);
  assert.match((await createGraded({ env: {}, fetch: s4.cx.fetch }, form, [])).error, /no Shopify admin token/);
});

test("setupCheck names the missing scopes; recentGraded shapes the list; the permission and the page", async () => {
  const s = fakeShopify({ scopes: ["write_products", "write_inventory", "read_orders"] });
  const c = await setupCheck(s.cx);
  assert.equal(c.ok, false); assert.deepEqual(c.missing, ["write_publications"]); assert.equal(c.location, "51 Allen Street");
  const ok = await setupCheck(fakeShopify({ scopes: ["write_products", "write_inventory", "write_publications"] }).cx);
  assert.equal(ok.ok, true); assert.deepEqual(ok.missing, []);
  const recent = await recentGraded(s.cx);
  assert.equal(recent.length, 1); assert.equal(recent[0].price, "99.95"); assert.equal(recent[0].autoPrice, true); assert.equal(recent[0].adminUrl, "https://admin.shopify.com/store/most-wanted-ca/products/123"); assert.equal(recent[0].image, "https://cdn.example/a.jpg");
  assert.ok(STAFF_PERMS.some((p) => p.key === "graded"));
  assert.equal(can({ role: "staff", perms: { graded: true } }, "graded"), true); assert.equal(can({ role: "staff", perms: {} }, "graded"), false); assert.equal(can({ role: "admin" }, "graded"), true);
  const page = renderGraded({ recent, setup: c, last: { handle: "dark-muk", title: "Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9", published: false, publishError: "Access denied", placeholder: true }, keep: { grader: "CGC", set: "Fossil", japanese: true } }, { user: { email: "s@x", role: "admin" } });
  for (const needle of ['name="photo1"', 'capture="environment"', "jsQR/1.4.0/jsQR.min.js", 'id="tprev"', 'id="qr_url"', 'name="auto_price" value="1" checked', "<b>write_publications</b>", "not published to the Online Store", "placeholder until auto-pricing", 'value="CGC" selected', 'value="Fossil"', 'name="japanese" value="1" checked', "Dark Muk (41/82)", "/9pocket/graded/add", 'enctype="multipart/form-data"', 'href="/9pocket/graded">Graded</a>']) assert.ok(page.includes(needle), needle);
  assert.match(renderGradedDenied({ user: { email: "s@x", role: "staff" } }), /cannot add graded cards/);
});
