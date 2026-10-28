// 9Pocket > Graded cards (owner, 2026-10-27): the title shape, the certificate link, the product input, the add itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { titleOf, cleanForm, certUrlOf, cleanUrl, productInput, createGraded, setupCheck, recentGraded, PLACEHOLDER_PRICE, LOCATION, ONLINE_STORE_PUBLICATION, ADD_TAG } from "../src/graded.js";
import { parseGraded } from "../src/autoprice.js";
import { STAFF_PERMS, can } from "../src/stage-auth.js";
import { renderGraded, renderGradedDenied } from "../src/graded-ui.js";
import { readFileSync } from "node:fs";
// The browser script's pure parts, evaluated without a document.
const client = (() => { const m = { exports: {} }; new Function("module", "window", "document", readFileSync(new URL("../public/graded-add.js", import.meta.url), "utf8"))(m, undefined, undefined); return m.exports; })();

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
  for (const needle of ['name="photo1"', "/vendor/jsQR-1.4.0.js", 'id="tprev"', 'id="qr_url"', 'name="auto_price" value="1" checked', "<b>write_publications</b>", "not published to the Online Store", "placeholder until auto-pricing", 'value="CGC" selected', 'value="Fossil"', 'name="japanese" value="1" checked', "Dark Muk (41/82)", "/9pocket/graded/add", 'enctype="multipart/form-data"', 'href="/9pocket/graded">Graded</a>', "Back: the label with the QR code", "Every photo is checked for the QR code", 'src="/graded-add.js?v=', 'id="batch"', 'accept="image/*" multiple', 'id="addall"', "window.xgGraded=", 'id="pairmode"', 'value="fb"']) assert.ok(page.includes(needle), needle);
  assert.ok(!page.includes('capture='), "the photo boxes open the library too, not only the camera");
  assert.match(renderGradedDenied({ user: { email: "s@x", role: "staff" } }), /cannot add graded cards/);
});

test("batch pairing: backs are the photos with a QR code, each takes the front shot beside it; leftovers stay as lines", () => {
  const { pairPhotos, pairByOrder, graderOfUrl, certOfUrl, certOfText, codeOf, rotationFor } = client;
  // a Beckett-style code that is only a serial still marks the back and gives the certificate
  assert.equal(certOfText("BGS 0012345678"), "0012345678"); assert.equal(certOfText("12 34 56 78"), "12345678"); assert.equal(certOfText("hello"), "");
  assert.deepEqual(codeOf({ raw: "0012345678" }), { qr: "", raw: "0012345678", code: "0012345678", cert: "0012345678", grader: "" });
  const bgs = pairByOrder([{ qr: "" }, { raw: "0012345678" }]);
  assert.deepEqual(bgs.map((x) => [x.front, x.back, x.cert, x.grader, x.raw]), [[0, 1, "0012345678", "", "0012345678"]]);
  const bgsQ = pairPhotos([{ qr: "" }, { raw: "BGS 0012345678" }, { qr: "" }, { qr: "https://www.psacard.com/cert/11111111" }]);
  assert.deepEqual(bgsQ.map((x) => [x.front, x.back, x.cert]), [[0, 1, "0012345678"], [2, 3, "11111111"]]);
  // portrait stays; landscape turns counter-clockwise unless the QR code sits on the left
  assert.equal(rotationFor(3000, 4000, null), 0); assert.equal(rotationFor(4000, 3000, null), -90); assert.equal(rotationFor(4000, 3000, "right"), -90); assert.equal(rotationFor(4000, 3000, "left"), 90); assert.equal(rotationFor(4000, 4000, "left"), 0);
  assert.equal(graderOfUrl("https://www.psacard.com/cert/87654321"), "PSA"); assert.equal(graderOfUrl("https://www.cgccards.com/certlookup/4312345001/"), "CGC"); assert.equal(graderOfUrl("https://example.com/x"), ""); assert.equal(graderOfUrl("nope"), "");
  assert.equal(certOfUrl("https://www.psacard.com/cert/87654321"), "87654321"); assert.equal(certOfUrl(""), "");
  const psa = (n) => "https://www.psacard.com/cert/" + n, cgc = (n) => "https://www.cgccards.com/certlookup/" + n + "/";
  // front, back, front, back
  let s = pairPhotos([{ qr: "" }, { qr: psa("11111111") }, { qr: "" }, { qr: cgc("2222222001") }]);
  assert.deepEqual(s.map((x) => [x.front, x.back, x.cert, x.grader]), [[0, 1, "11111111", "PSA"], [2, 3, "2222222001", "CGC"]]);
  // back first, then its front
  s = pairPhotos([{ qr: psa("11111111") }, { qr: "" }]);
  assert.deepEqual(s.map((x) => [x.front, x.back]), [[1, 0]]);
  // two fronts then two backs still pairs them, the nearest first
  s = pairPhotos([{ qr: "" }, { qr: "" }, { qr: psa("10000001") }, { qr: psa("10000002") }]);
  assert.deepEqual(s.map((x) => [x.front, x.back]).sort(), [[0, 3], [1, 2]]);
  // a second photo of the same certificate joins the slab; a lone front and a far-off back stand alone
  s = pairPhotos([{ qr: "" }, { qr: psa("55555555") }, { qr: psa("55555555") }, { qr: "" }, { qr: "" }, { qr: "" }, { qr: "" }, { qr: "" }, { qr: psa("99999999") }]);
  assert.deepEqual(s[0], { front: 0, back: 1, extra: [2], qr: psa("55555555"), raw: "", cert: "55555555", grader: "PSA" });
  assert.equal(s.length, 6, "one slab with an extra, four lone fronts, one back with the nearest front within three");
  const far = s.find((x) => x.cert === "99999999"); assert.equal(far.front, 7);
  assert.deepEqual(pairPhotos([]), []);
  // by shooting order: (front, back) pairs, the QR a bonus; a QR in the front slot swaps the pair; an odd last photo stands alone
  const fb = pairByOrder([{ qr: "" }, { qr: psa("11111111") }, { qr: "" }, { qr: "" }, { qr: "" }]);
  assert.deepEqual(fb.map((x) => [x.front, x.back, x.cert, x.grader]), [[0, 1, "11111111", "PSA"], [2, 3, "", ""], [4, null, "", ""]]);
  const bf = pairByOrder([{ qr: psa("11111111") }, { qr: "" }], true);
  assert.deepEqual(bf.map((x) => [x.front, x.back, x.cert]), [[1, 0, "11111111"]]);
  const swapped = pairByOrder([{ qr: psa("22222222") }, { qr: "" }]);
  assert.deepEqual(swapped.map((x) => [x.front, x.back, x.cert]), [[1, 0, "22222222"]], "the QR photo is the back whichever slot it landed in");
  assert.deepEqual(pairByOrder([]), []);
  assert.deepEqual(pairPhotos([{ qr: "" }]), [{ front: 0, back: null, extra: [], qr: "", raw: "", cert: "", grader: "" }]);
});

import { psaToForm, titleCase, certLookup, psaConfigured } from "../src/graded.js";
test("PSA lookup: the record becomes the form in the store's title case; the token, the limit and unknown certs are reported plainly", async () => {
  assert.equal(titleCase("UMBREON VMAX"), "Umbreon VMAX"); assert.equal(titleCase("POKEMON SWSH EVOLVING SKIES"), "Pokemon SWSH Evolving Skies"); assert.equal(titleCase("MARSHADOW & MACHAMP GX"), "Marshadow & Machamp GX"); assert.equal(titleCase("1ST EDITION"), "1st Edition");
  const rec = { CertNumber: "87654321", YearIssued: "2021", Brand: "POKEMON SWSH EVOLVING SKIES", Category: "TCG CARDS", CardNumber: "215", Subject: "UMBREON VMAX", Variety: "ALT ART", CardGrade: "GEM MT 10", TotalPopulation: 4321, PopulationHigher: 0 };
  const f = psaToForm(rec);
  assert.deepEqual(f, { grader: "PSA", cert: "87654321", grade: "10", gradeText: "GEM MT 10", name: "Umbreon VMAX", number: "215", set: "SWSH Evolving Skies", variety: "Alt Art", year: "2021", category: "TCG Cards", game: "pokemon", japanese: false, population: 4321, higher: 0 });
  const jp = psaToForm({ CertNumber: "1", Brand: "POKEMON JAPANESE SWORD & SHIELD SHINY STAR V", Category: "TCG CARDS", Subject: "CHARIZARD VMAX", CardGrade: "NM-MT+ 8.5" });
  assert.equal(jp.japanese, true); assert.equal(jp.set, "Sword & Shield Shiny Star V"); assert.equal(jp.grade, "8.5"); assert.equal(jp.game, "pokemon");
  assert.equal(psaToForm({ Brand: "TOPPS CHROME", Category: "BASKETBALL CARDS", CardGrade: "AUTHENTIC" }).game, "sports"); assert.equal(psaToForm({ CardGrade: "AUTHENTIC" }).grade, "");
  const calls = [];
  const mk = (status, body) => ({ env: { PSA_API_TOKEN: "tok" }, fetch: async (u, i) => { calls.push({ u, auth: i.headers.authorization }); return status === "throw" ? Promise.reject(new Error("boom")) : new Response(body == null ? "" : JSON.stringify(body), { status }); } });
  const ok = await certLookup(mk(200, { PSACert: rec }), "psa", " 8765-4321 ");
  assert.equal(ok.ok, true); assert.equal(ok.name, "Umbreon VMAX"); assert.equal(calls[0].u, "https://api.psacard.com/publicapi/cert/GetByCertNumber/87654321"); assert.equal(calls[0].auth, "bearer tok");
  assert.match((await certLookup(mk(200, { IsValidRequest: true, ServerMessage: "No data found" }), "PSA", "12345678")).error, /No data found/);
  const lim = await certLookup(mk(429, null), "PSA", "12345678"); assert.equal(lim.limited, true); assert.match(lim.error, /daily lookup allowance/);
  assert.match((await certLookup(mk(401, null), "PSA", "12345678")).error, /refused the token/);
  assert.match((await certLookup(mk("throw"), "PSA", "12345678")).error, /PSA did not answer: boom/);
  assert.match((await certLookup(mk(200, {}), "CGC", "12345678")).error, /CGC has no certificate API/);
  assert.match((await certLookup(mk(200, {}), "PSA", "12")).error, /does not look like a PSA certificate number/);
  const off = await certLookup({ env: {}, fetch: async () => { throw new Error("never"); } }, "PSA", "12345678"); assert.equal(off.configured, false); assert.equal(psaConfigured({ PSA_API_TOKEN: "x" }), true);
  const page = renderGraded({ recent: [], setup: null, last: null, psa: true, keep: {} }, { user: { email: "s@x", role: "staff", perms: { graded: true } } });
  assert.ok(page.includes("PSA lookups are on")); assert.ok(page.includes('"psa":true')); assert.ok(page.includes('id="psastate"')); assert.ok(page.includes('src="/graded-add.js?v=11"'));
  assert.ok(readFileSync(new URL("../public/vendor/libheif-1.23.5.bundle.js", import.meta.url)).length > 1500000, "the HEIC decoder is vendored");
  assert.ok(readFileSync(new URL("../public/vendor/jsQR-1.4.0.js", import.meta.url)).length > 200000, "the QR reader is vendored"); assert.ok(page.includes('class="sm rot" hidden'), "a Rotate button per photo box");
  assert.ok(!page.includes("cdnjs.cloudflare.com"), "the QR reader is served by the worker, not a CDN that may 404");
  assert.ok(renderGraded({ recent: [], setup: null, last: null, psa: false, keep: {} }, { user: { email: "s@x", role: "admin" } }).includes("PSA lookups are off"));
});

import { readLabel, labelToForm, LABEL_SCHEMA, LABEL_MODEL } from "../src/graded.js";
test("label reading: Claude's JSON becomes the form; the request shape; refusals, bad answers and the key", async () => {
  const f = labelToForm({ grader: "psa", grade: "GEM MT 10", grade_label: "", cert: "14927 2769", card_name: "Umbreon VMAX", card_number: "215/203", set_name: "Sword & Shield: Evolving Skies", year: "2021", game: "pokemon", japanese: false, notes: "", confidence: 0.93 });
  assert.deepEqual(f, { grader: "PSA", grade: "10", label: "", cert: "149272769", name: "Umbreon VMAX", number: "215/203", set: "Sword & Shield: Evolving Skies", year: "2021", game: "pokemon", japanese: false, notes: "", confidence: 0.93 });
  assert.equal(labelToForm({ grader: "Beckett", grade: "9.5", grade_label: "Gem Mint", game: "basketball", confidence: 2 }).grader, "BGS"); assert.equal(labelToForm({ grader: "Beckett", grade: "9.5", confidence: 2 }).confidence, 1); assert.equal(labelToForm({ grade: "11" }).grade, ""); assert.equal(labelToForm({ game: "basketball" }).game, "");
  const sent = [];
  const client = (script) => ({ beta: { messages: { create: async (params) => { sent.push(params); const next = script.shift(); if (next instanceof Error) throw next; return next; } } } });
  const photo = { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([255, 216, 255, 1]).buffer };
  const answer = (o, stop) => ({ stop_reason: stop || "end_turn", content: [{ type: "text", text: JSON.stringify(o) }], usage: { input_tokens: 2500, output_tokens: 90 } });
  const cx = { env: { ANTHROPIC_API_KEY: "k" } };
  const r = await readLabel(cx, photo, { client: client([answer({ grader: "PSA", grade: "10", grade_label: "", cert: "149272769", card_name: "Umbreon VMAX", card_number: "215", set_name: "Sword & Shield: Evolving Skies", year: "2021", game: "pokemon", japanese: false, notes: "", confidence: 0.9 })]) });
  assert.equal(r.ok, true); assert.equal(r.name, "Umbreon VMAX"); assert.equal(r.cert, "149272769"); assert.equal(r.usedFormat, true); assert.deepEqual(r.usage, { input: 2500, output: 90 });
  const p = sent[0];
  assert.equal(p.model, LABEL_MODEL); assert.equal(p.max_tokens, 600); assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]); assert.equal(p.fallbacks, "default");
  assert.equal(p.output_config.effort, "low"); assert.deepEqual(p.output_config.format, { type: "json_schema", schema: LABEL_SCHEMA });
  assert.equal(p.messages[0].content[0].type, "image"); assert.equal(p.messages[0].content[0].source.media_type, "image/jpeg"); assert.equal(p.messages[0].content[0].source.data, "/9j/AQ=="); assert.match(p.messages[0].content[1].text, /Read its label/);
  // a 400 on the format parameter -> the plain-JSON request; JSON inside prose still parses
  const bad = Object.assign(new Error("output_config.format unsupported"), { status: 400 });
  const r2 = await readLabel(cx, photo, { client: client([bad, answer(null) && { stop_reason: "end_turn", content: [{ type: "text", text: "Here you go: {\"grader\":\"CGC\",\"grade\":\"10\",\"grade_label\":\"Pristine\",\"cert\":\"4312345001\",\"card_name\":\"Charizard\",\"card_number\":\"4/102\",\"set_name\":\"Base Set\",\"year\":\"1999\",\"game\":\"pokemon\",\"japanese\":false,\"notes\":\"\",\"confidence\":0.8}" }], usage: {} }]) });
  assert.equal(r2.ok, true); assert.equal(r2.usedFormat, false); assert.equal(r2.grader, "CGC"); assert.equal(r2.label, "Pristine"); assert.equal(sent.length, 3); assert.equal(sent[2].output_config.format, undefined); assert.match(sent[2].messages[0].content[2].text, /one JSON object only/);
  assert.match((await readLabel(cx, photo, { client: client([answer({}, "refusal")]) })).error, /declined/);
  assert.match((await readLabel(cx, photo, { client: client([{ stop_reason: "end_turn", content: [{ type: "text", text: "no idea" }] }]) })).error, /not readable/);
  assert.match((await readLabel(cx, photo, { client: client([answer({ grader: "", card_name: "", notes: "a coffee cup, not a slab" })]) })).error, /coffee cup/);
  assert.match((await readLabel(cx, photo, { client: client([Object.assign(new Error("busy"), { status: 529 })]) })).error, /HTTP 529/);
  const off = await readLabel({ env: {} }, photo, {}); assert.equal(off.configured, false);
  assert.match((await readLabel(cx, null, {})).error, /Send one photo/);
  assert.ok(renderGraded({ recent: [], setup: null, last: null, psa: false, vision: true, keep: {} }, { user: { email: "s@x", role: "admin" } }).includes("Label reading is on"));
  assert.ok(renderGraded({ recent: [], setup: null, last: null, psa: false, vision: true, keep: {} }, { user: { email: "s@x", role: "admin" } }).includes('"vision":true'));
});
