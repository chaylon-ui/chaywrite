/* 9Pocket > Graded cards: a fast way to list a graded slab (owner, 2026-10-27:
   "a fast way for us to enter in graded cards ... put a link in the card to
   whatever the QR code goes to automatically (from the image) ... followed
   our current naming strategy ... a checkmark to add to auto pricing ...
   easy for staff to do from their phone or computer and add images easily").

   What one add does, in order:
     1. every photo the browser sent (already shrunk to <= 2000 px JPEG there,
        the QR code read there too) goes to Shopify through a staged upload;
     2. ONE productSet creates the product: title in the store's own graded
        naming ("Dark Muk (41/82) [Team Rocket 1st Edition] Graded PSA 9", the
        183 "Pokemon Single Graded" products of 2026-10-27), product type
        "<Game> Single Graded", the photos, a default variant with the price
        (or the store's $999,999 placeholder until auto-pricing suggests one -
        the way staff listed slabs by hand), one in stock at 51 Allen Street,
        the certificate number as SKU + barcode, the certificate link in the
        description (opens in a new window) and in exor.cert_* metafields, and
        the `auto-price` tag when the box is ticked (src/autoprice.js prices
        graded cards from PriceCharting by the title);
     3. publishablePublish to the Online Store (the channel the hand-listed
        slabs are on; Snapcaster Sync publishes itself).
   Nothing here touches BinderPOS. Admin API 2025-01 like the rest of the
   worker (src/price-history.js adminGql). */
import { adminGql } from "./price-history.js";
import { TAG as AUTO_PRICE_TAG, AUTOPRICE_DO } from "./autoprice.js";

export const ONLINE_STORE_PUBLICATION = "gid://shopify/Publication/63498813593";   // "Online Store" (publications query, 2026-10-27)
export const LOCATION = "gid://shopify/Location/53483602073";                       // 51 Allen Street, the store's only location
export const PLACEHOLDER_PRICE = "999999.00";
export const ADD_TAG = "9pocket-graded";                                            // marks what this screen made, for its "recently added" list
export const SHOP_URL = "https://exorgames.com";
export const ADMIN_URL = "https://admin.shopify.com/store/most-wanted-ca";
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export const GAMES = {
  pokemon: { label: "Pokémon", type: "Pokemon Single Graded", vendor: "Pokémon" },
  mtg: { label: "Magic: The Gathering", type: "MTG Single Graded", vendor: "Magic: The Gathering" },
  yugioh: { label: "Yu-Gi-Oh!", type: "Yugioh Single Graded", vendor: "Yu-Gi-Oh!" },
  lorcana: { label: "Disney Lorcana", type: "Lorcana Single Graded", vendor: "Disney Lorcana" },
  onepiece: { label: "One Piece", type: "One Piece Single Graded", vendor: "One Piece Card Game" },
  sports: { label: "Sports", type: "Sports Card Graded", vendor: "" },
  other: { label: "Other", type: "Single Graded", vendor: "" },
};
// Where a grader's certificate page lives when only the number is known
// (the QR code on the label, read in the browser, wins when it is a link).
export const GRADERS = {
  PSA: { cert: (n) => "https://www.psacard.com/cert/" + encodeURIComponent(n) },
  CGC: { cert: (n) => "https://www.cgccards.com/certlookup/" + encodeURIComponent(n) + "/" },
  BGS: { cert: null },
  SGC: { cert: null },
  TAG: { cert: null },
  ACE: { cert: null },
};
export const GRADES = ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"];
export const FINISHES = ["", "Holo", "Reverse Holo", "Full Art", "Alt Art", "Foil", "Non-Foil", "Shadowless", "1st Edition"];

const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 120);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const on = (v) => v === true || v === "1" || v === "on" || v === "true";

/* The store's title shape (every hand-listed slab of 2026-10-27):
   "<Name> (<number>) [<Set>] <finish> Japanese Graded <GRADER> <grade> <label>",
   each part only when given. src/autoprice.js parseGraded reads it back. */
export function titleOf(f) {
  const grade = str(f.grade, 6) + (str(f.label, 24) ? " " + str(f.label, 24) : "");
  return [
    str(f.name) + (str(f.number, 24) ? " (" + str(f.number, 24) + ")" : ""),
    str(f.set, 80) ? "[" + str(f.set, 80) + "]" : "",
    str(f.finish, 24),
    on(f.japanese) ? "Japanese" : "",
    "Graded " + str(f.grader, 8).toUpperCase() + " " + grade,
  ].filter(Boolean).join(" ");
}

// A link only if it is one the shopper can open: http(s), no scripts, short.
export function cleanUrl(u) {
  const s = str(u, 300);
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return "";
  try { const x = new URL(s); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : ""; } catch { return ""; }
}
export function certUrlOf(grader, cert, qrUrl) {
  const q = cleanUrl(qrUrl);
  if (q) return q;
  const g = GRADERS[str(grader, 8).toUpperCase()];
  const n = str(cert, 24);
  return g && g.cert && /^[A-Za-z0-9-]{4,24}$/.test(n) ? g.cert(n) : "";
}

// The form -> what the product will be; {error} when something essential is missing.
export function cleanForm(form) {
  const f = form || {};
  const game = GAMES[str(f.game, 16).toLowerCase()] ? str(f.game, 16).toLowerCase() : "pokemon";
  const grader = str(f.grader, 8).toUpperCase();
  if (!GRADERS[grader]) return { error: "Pick the grading company." };
  const grade = str(f.grade, 6);
  if (!GRADES.includes(grade)) return { error: "Pick the grade." };
  const name = str(f.name);
  if (name.length < 2) return { error: "Type the card's name." };
  const cert = str(f.cert, 24).replace(/[^A-Za-z0-9-]/g, "");
  const autoPrice = on(f.auto_price);
  const priceRaw = str(f.price, 16).replace(/[$,\s]/g, "");
  let price = null;
  if (priceRaw) {
    price = Number(priceRaw);
    if (!(price >= 0.01 && price < 1000000)) return { error: "The price does not look right." };
    price = price.toFixed(2);
  } else if (!autoPrice) return { error: "Enter a price, or tick auto-pricing to list it at the $999,999 placeholder until a price is suggested." };
  const costRaw = str(f.cost, 16).replace(/[$,\s]/g, "");
  const cost = costRaw ? Number(costRaw) : null;
  if (costRaw && !(cost >= 0 && cost < 1000000)) return { error: "The cost does not look right." };
  const qty = Math.max(1, Math.min(99, parseInt(f.qty, 10) || 1));
  const out = {
    game, grader, grade, label: str(f.label, 24), name, number: str(f.number, 24), set: str(f.set, 80),
    finish: FINISHES.includes(str(f.finish, 24)) ? str(f.finish, 24) : str(f.finish, 24), japanese: on(f.japanese),
    cert, qrUrl: cleanUrl(f.qr_url), price: price || PLACEHOLDER_PRICE, placeholder: !price, cost: costRaw ? cost.toFixed(2) : null,
    qty, autoPrice, notes: str(f.notes, 400),
  };
  out.title = titleOf(out);
  out.certUrl = certUrlOf(out.grader, out.cert, out.qrUrl);
  return out;
}

export function descriptionOf(f) {
  const grade = esc(f.grade + (f.label ? " " + f.label : ""));
  const link = f.certUrl ? ` <a href="${esc(f.certUrl)}" target="_blank" rel="noopener noreferrer">View the ${esc(f.grader)} certificate</a>` : "";
  return `<p>${esc(f.grader)} ${grade} graded card${f.cert ? ", certificate " + esc(f.cert) : ""}.${link}</p>` + (f.notes ? `<p>${esc(f.notes)}</p>` : "");
}

// The ProductSetInput for one slab; resourceUrls are the staged uploads.
export function productInput(f, resourceUrls) {
  const g = GAMES[f.game] || GAMES.other;
  const tags = ["Graded", f.grader, ADD_TAG];
  if (f.set) tags.push(f.set);
  if (f.autoPrice) tags.push(AUTO_PRICE_TAG);
  const metafields = [
    { namespace: "exor", key: "grader", type: "single_line_text_field", value: f.grader },
    { namespace: "exor", key: "grade", type: "single_line_text_field", value: f.grade + (f.label ? " " + f.label : "") },
  ];
  if (f.cert) metafields.push({ namespace: "exor", key: "cert_number", type: "single_line_text_field", value: f.cert });
  if (f.certUrl) metafields.push({ namespace: "exor", key: "cert_url", type: "url", value: f.certUrl });
  const variant = {
    optionValues: [{ optionName: "Title", name: "Default Title" }],
    price: f.price,
    inventoryItem: { tracked: true, ...(f.cost ? { cost: f.cost } : {}) },
    inventoryQuantities: [{ locationId: LOCATION, name: "available", quantity: f.qty }],
  };
  if (f.cert) { variant.sku = f.grader + "-" + f.cert; variant.barcode = f.cert; }
  return {
    title: f.title, productType: g.type, vendor: g.vendor, status: "ACTIVE", tags,
    descriptionHtml: descriptionOf(f), metafields,
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [variant],
    files: (resourceUrls || []).map((u, i) => ({ originalSource: u, contentType: "IMAGE", alt: f.title + (i ? " (" + (i + 1) + ")" : ""), filename: "graded-" + (i + 1) + ".jpg" })),
  };
}

const SU_M = `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`;
const SET_M = `mutation($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { id handle title } userErrors { field message code } } }`;
const PUB_M = `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const SETUP_Q = `{ currentAppInstallation { accessScopes { handle } } location(id: "${LOCATION}") { name isActive } }`;
const RECENT_Q = `{ products(first: 12, sortKey: CREATED_AT, reverse: true, query: "tag:${ADD_TAG}") { nodes { id title handle status createdAt totalInventory tags variants(first: 1) { nodes { price } } media(first: 1) { nodes { ... on MediaImage { image { url } } } } } } }`;

const errsOf = (o) => ((o && o.userErrors) || []).map((e) => (e.field ? e.field.join(".") + ": " : "") + e.message).join("; ");

// One photo -> Shopify's staged bucket -> the resourceUrl productSet accepts.
export async function stageUpload(cx, photo, filename) {
  const bytes = await photo.arrayBuffer();
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error(filename + " is too big (" + Math.round(bytes.byteLength / 1048576) + " MB)");
  const mime = photo.type && /^image\/(jpeg|png|webp|heic|heif)$/i.test(photo.type) ? photo.type : "image/jpeg";
  const r = await adminGql(cx, SU_M, { input: [{ resource: "IMAGE", filename, mimeType: mime, httpMethod: "POST", fileSize: String(bytes.byteLength) }] });
  const su = r.data.stagedUploadsCreate || {};
  if (errsOf(su)) throw new Error("staged upload: " + errsOf(su));
  const target = (su.stagedTargets || [])[0];
  if (!target || !target.url) throw new Error("staged upload: no target");
  const fd = new FormData();
  for (const p of target.parameters || []) fd.append(p.name, p.value);
  fd.append("file", new Blob([bytes], { type: mime }), filename);
  const up = await cx.fetch(target.url, { method: "POST", body: fd });
  if (!(up.status >= 200 && up.status < 300)) throw new Error("photo upload HTTP " + up.status);
  return target.resourceUrl;
}

/* The whole add. photos: File-like objects (arrayBuffer(), type, name).
   Returns {ok, id, handle, title, url, adminUrl, photos, published,
   publishError} or {ok:false, error}. */
export async function createGraded(cx, form, photos) {
  if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return { ok: false, error: "The worker has no Shopify admin token." };
  const f = cleanForm(form);
  if (f.error) return { ok: false, error: f.error };
  const list = (photos || []).filter((p) => p && typeof p.arrayBuffer === "function" && (p.size == null || p.size > 0)).slice(0, MAX_PHOTOS);
  const urls = [];
  try {
    for (let i = 0; i < list.length; i++) urls.push(await stageUpload(cx, list[i], "graded-" + Date.now() + "-" + (i + 1) + ".jpg"));
  } catch (e) { return { ok: false, error: "Photo upload failed: " + String((e && e.message) || e).slice(0, 200) }; }
  let product;
  try {
    const r = await adminGql(cx, SET_M, { input: productInput(f, urls) });
    const ps = r.data.productSet || {};
    if (errsOf(ps)) return { ok: false, error: "Shopify refused the product: " + errsOf(ps).slice(0, 300) };
    product = ps.product;
    if (!product || !product.id) return { ok: false, error: "Shopify returned no product." };
  } catch (e) { return { ok: false, error: "Creating the product failed: " + String((e && e.message) || e).slice(0, 200) }; }
  let published = false, publishError = "";
  try {
    const r = await adminGql(cx, PUB_M, { id: product.id, input: [{ publicationId: ONLINE_STORE_PUBLICATION }] });
    const pe = errsOf(r.data.publishablePublish);
    if (pe) publishError = pe; else published = true;
  } catch (e) { publishError = String((e && e.message) || e).slice(0, 200); }
  // Auto-pricing ticked: the pricer's own "add" path lists the slab on the
  // Auto-pricing page at once and prices it within a minute (owner, 2026-10-28:
  // "I put a check to add lopunny to auto pricing but I dont see it" - the page
  // otherwise only picks new products up on its nightly run).
  let priced = false, priceError = "";
  if (f.autoPrice && cx.env.ROOM) {
    try {
      const g = GAMES[f.game] || GAMES.other;
      const stub = cx.env.ROOM.get(cx.env.ROOM.idFromName(AUTOPRICE_DO));
      const r = await stub.fetch(new Request((cx.origin || SHOP_URL) + "/_ap/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add", id: product.id, title: product.title || f.title, handle: product.handle, type: g.type, stock: f.qty, price: f.placeholder ? 0 : Number(f.price), who: cx.by || "9pocket graded" }) }));   // "who": the pricer's audit column
      const j = await r.json().catch(() => null);
      if (j && j.ok) priced = true; else priceError = (j && j.error) || "the pricer did not answer";
    } catch (e) { priceError = String((e && e.message) || e).slice(0, 120); }
  }
  const num = String(product.id).split("/").pop();
  return { ok: true, id: product.id, handle: product.handle, title: product.title || f.title, url: SHOP_URL + "/products/" + product.handle, adminUrl: ADMIN_URL + "/products/" + num, photos: urls.length, published, publishError, placeholder: f.placeholder, autoPrice: f.autoPrice, priced, priceError, certUrl: f.certUrl };
}

// What the screen shows at the top for admins: the token's scopes vs what an add needs, and the location.
export const NEEDED_SCOPES = ["write_products", "write_inventory", "write_publications"];
export async function setupCheck(cx) {
  if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return { ok: false, error: "no SHOPIFY_ADMIN_TOKEN on the worker" };
  try {
    const r = await adminGql(cx, SETUP_Q, {});
    const scopes = (((r.data.currentAppInstallation || {}).accessScopes) || []).map((s) => s.handle);
    const missing = NEEDED_SCOPES.filter((s) => !scopes.includes(s));
    const loc = r.data.location || null;
    return { ok: !missing.length && !!(loc && loc.isActive), scopes, missing, location: loc ? loc.name : null, locationActive: !!(loc && loc.isActive) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
}

export async function recentGraded(cx) {
  if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return [];
  try {
    const r = await adminGql(cx, RECENT_Q, {});
    return ((r.data.products || {}).nodes || []).map((p) => ({
      id: p.id, title: p.title, handle: p.handle, status: p.status, createdAt: p.createdAt, qty: p.totalInventory,
      price: (((p.variants || {}).nodes || [])[0] || {}).price || "", autoPrice: (p.tags || []).includes(AUTO_PRICE_TAG),
      image: ((((p.media || {}).nodes || [])[0] || {}).image || {}).url || "",
      url: SHOP_URL + "/products/" + p.handle, adminUrl: ADMIN_URL + "/products/" + String(p.id).split("/").pop(),
    }));
  } catch { return []; }
}

/* ---- PSA certificate lookup (owner, 2026-10-27: "Look into api") ----
   PSA's public API (psacard.com/publicapi): a bearer access token made with a
   PSA login, GET /publicapi/cert/GetByCertNumber/<cert> -> { PSACert: {
   CertNumber, YearIssued, Brand, Category, CardNumber, Subject, Variety,
   CardGrade ("GEM MT 10"), AutographGrade, TotalPopulation, PopulationHigher,
   ... } }, {IsValidRequest, ServerMessage: "No data found"} when unknown, 429
   past the free tier's daily allowance (about 100 a day). CGC, Beckett, SGC,
   TAG and ACE publish no API (GemRate aggregates them for partners), so the
   lookup is PSA-only; the token lives on the worker as PSA_API_TOKEN and the
   browser only ever calls /9pocket/graded/cert.json. Found certs are cached a
   week so a retried batch costs no calls. */
export const PSA_API = "https://api.psacard.com/publicapi/cert/GetByCertNumber/";
export const psaConfigured = (env) => !!(env && env.PSA_API_TOKEN);
const KEEP_CAPS = /^(GX|EX|V|VMAX|VSTAR|TAG|TEAM|SM|SWSH|XY|BW|DP|HGSS|TCG|MTG|LP|NM|PSA|CGC|BGS|SGC|II|III|IV|VI|VII|VIII|IX|X|XI|XII|HP|MP|SP|SSP|USA|UK|NBA|NFL|MLB|NHL|UFC|WWE|F1|JR|SR|CP|XI|ZX)$/;
// PSA writes everything in capitals; the store's titles are in title case.
export function titleCase(s) {
  return String(s || "").toLowerCase().replace(/[a-z0-9'’]+/g, (w) => { const up = w.toUpperCase(); return KEEP_CAPS.test(up) ? up : w.charAt(0).toUpperCase() + w.slice(1); }).replace(/\s+/g, " ").trim();
}
export function psaToForm(c) {
  const gradeText = String((c && c.CardGrade) || "").replace(/\s+/g, " ").trim();
  const gm = /(10|[1-9](?:\.5)?)\s*$/.exec(gradeText);
  const brand = String((c && c.Brand) || "").replace(/\s+/g, " ").trim(), cat = String((c && c.Category) || "").trim();
  const bl = brand.toLowerCase(), cl = cat.toLowerCase();
  const game = /pokemon|pokémon/.test(bl) ? "pokemon" : /magic/.test(bl) ? "mtg" : /yu-?gi-?oh/.test(bl) ? "yugioh" : /lorcana/.test(bl) ? "lorcana" : /one piece/.test(bl) ? "onepiece" : /tcg/.test(cl) ? "other" : /basketball|football|baseball|hockey|soccer|wrestling|racing|golf|tennis|ufc|mma|boxing/.test(cl) ? "sports" : "other";
  const japanese = /japanese/.test(bl);
  const set = brand.replace(/^pok[eé]mon\s+/i, "").replace(/\bjapanese\b/i, " ").replace(/\s+/g, " ").trim();
  const num = (v) => (v == null || v === "" ? null : Number(v));
  return {
    grader: "PSA", cert: String((c && c.CertNumber) || "").trim(), grade: gm ? gm[1] : "", gradeText,
    name: titleCase(c && c.Subject), number: String((c && c.CardNumber) || "").trim(), set: titleCase(set), variety: titleCase(c && c.Variety),
    year: String((c && c.YearIssued) || "").trim(), category: titleCase(cat), game, japanese,
    population: num(c && c.TotalPopulation), higher: num(c && c.PopulationHigher),
  };
}
export async function certLookup(cx, grader, cert) {
  const g = String(grader || "").toUpperCase(), n = String(cert || "").replace(/\D/g, "");   // PSA certificates are digits; spaces and dashes from the label are dropped
  if (g !== "PSA") return { ok: false, error: (g || "That grader") + " has no certificate API we can use yet; type the card in." };
  if (!/^\d{6,12}$/.test(n)) return { ok: false, error: "That does not look like a PSA certificate number." };
  if (!psaConfigured(cx.env)) return { ok: false, configured: false, error: "PSA lookups are not switched on yet (no PSA_API_TOKEN on the worker)." };
  const key = "https://exor-binder.nevski.workers.dev/_psa/" + n;
  const cache = typeof caches !== "undefined" && caches.default;
  if (cache) { const h = await cache.match(key).catch(() => null); if (h) { try { return await h.json(); } catch {} } }
  let r;
  try { r = await cx.fetch(PSA_API + n, { headers: { authorization: "bearer " + cx.env.PSA_API_TOKEN, accept: "application/json", "user-agent": "ExorGraded/1.0 (+workers.dev)" }, signal: AbortSignal.timeout(12000) }); }
  catch (e) { return { ok: false, error: "PSA did not answer: " + String((e && e.message) || e).slice(0, 120) }; }
  if (r.status === 429) return { ok: false, limited: true, error: "PSA's daily lookup allowance is used up; type the card in (it resets tomorrow)." };
  if (r.status === 401 || r.status === 403) return { ok: false, error: "PSA refused the token (expired or wrong): make a new access token at psacard.com/publicapi and update the PSA_API_TOKEN secret." };
  if (!r.ok) return { ok: false, error: "PSA HTTP " + r.status };
  const j = await r.json().catch(() => null);
  const c = j && j.PSACert;
  if (!c || !c.CertNumber) return { ok: false, error: (j && j.ServerMessage) || "PSA has no record of that certificate." };
  const out = { ok: true, ...psaToForm(c) };
  if (cache) { const put = cache.put(key, Response.json(out, { headers: { "cache-control": "public, max-age=604800" } })).catch(() => {}); if (cx.ctx && cx.ctx.waitUntil) cx.ctx.waitUntil(put); else await put; }
  return out;
}

/* ---- Reading the label with Claude (owner, 2026-10-28: "is there any other
   way to generate it?" - the PSA token page would not play; the Anthropic key
   is already on the worker for Ask Exor). One photo of the slab -> the
   grader, grade, certificate, card name, number, set, year, game and whether
   it is Japanese, as JSON (structured output; a plain-JSON request if the
   format parameter is refused). Works for PSA, CGC, Beckett, SGC, TAG and
   ACE labels alike; about a cent or two a slab at claude-opus-5-5. The photo
   never leaves 9Pocket except to Anthropic; nothing is stored. */
export const visionConfigured = (env) => !!(env && env.ANTHROPIC_API_KEY);
export const LABEL_MODEL = "claude-opus-5-5";
export const LABEL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["grader", "grade", "grade_label", "cert", "card_name", "card_number", "set_name", "year", "game", "japanese", "notes", "confidence"],
  properties: {
    grader: { type: "string", description: "PSA, CGC, BGS, SGC, TAG, ACE, or empty if no grading label is visible" },
    grade: { type: "string", description: "the numeric grade as printed: 10, 9.5, 9 ... or empty" },
    grade_label: { type: "string", description: "a word printed with the grade such as Pristine, Gem Mint, Black Label, Perfect; empty for a plain PSA GEM MT 10" },
    cert: { type: "string", description: "the certificate or serial number on the label" },
    card_name: { type: "string", description: "the card's name as a shop lists it: title case, GX EX V VMAX VSTAR in capitals" },
    card_number: { type: "string", description: "the card number as printed, such as 41/82 or 215" },
    set_name: { type: "string", description: "the set in full as a card shop lists it, e.g. Sword & Shield: Evolving Skies, Team Rocket 1st Edition" },
    year: { type: "string" },
    game: { type: "string", enum: ["pokemon", "mtg", "yugioh", "lorcana", "onepiece", "sports", "other"] },
    japanese: { type: "boolean" },
    notes: { type: "string", description: "anything odd: not a slab, label unreadable, two slabs in frame" },
    confidence: { type: "number", description: "0 to 1" },
  },
};
export const LABEL_PROMPT = "This photo shows one graded trading-card slab (PSA, CGC, BGS/Beckett, SGC, TAG or ACE). Read its label and fill in every field. Use empty strings for anything you cannot read; never guess a certificate number. If it is not a graded slab, leave grader empty and say why in notes.";

const GRADER_WORDS = { PSA: "PSA", CGC: "CGC", BGS: "BGS", BECKETT: "BGS", SGC: "SGC", TAG: "TAG", ACE: "ACE" };
export function labelToForm(j) {
  const o = j && typeof j === "object" ? j : {};
  const s = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 120);
  const grader = GRADER_WORDS[s(o.grader, 12).toUpperCase().replace(/[^A-Z]/g, "")] || "";
  const gm = /(?<![\d.])(10|[1-9](?:\.5)?)(?![\d.])/.exec(s(o.grade, 24));   // "GEM MT 10" -> 10, "NM-MT+ 8.5" -> 8.5, "11" -> nothing
  const grade = gm && GRADES.includes(gm[1]) ? gm[1] : "";
  const game = GAMES[s(o.game, 12).toLowerCase()] ? s(o.game, 12).toLowerCase() : "";
  const conf = Number(o.confidence);
  return {
    grader, grade, label: s(o.grade_label, 24), cert: s(o.cert, 24).replace(/[^0-9A-Za-z-]/g, ""),
    name: s(o.card_name), number: s(o.card_number, 24), set: s(o.set_name, 80), year: s(o.year, 8),
    game, japanese: o.japanese === true, notes: s(o.notes, 200), confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}
export async function readLabel(cx, photo, opts) {
  const o = opts || {};
  if (!visionConfigured(cx.env)) return { ok: false, configured: false, error: "Label reading is not switched on (no Anthropic key on the worker)." };
  if (!photo || typeof photo.arrayBuffer !== "function") return { ok: false, error: "Send one photo." };
  const bytes = await photo.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) return { ok: false, error: "The photo must be under 4 MB (the page shrinks them; reload it)." };
  const mime = /^image\/(jpeg|png|webp|gif)$/i.test(photo.type || "") ? photo.type.toLowerCase() : "image/jpeg";
  const data = btoa(Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join(""));
  const client = o.client || new (await import("@anthropic-ai/sdk")).default({ apiKey: cx.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const content = [{ type: "image", source: { type: "base64", media_type: mime, data } }, { type: "text", text: LABEL_PROMPT }];
  const base = { model: LABEL_MODEL, max_tokens: 600, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low" }, messages: [{ role: "user", content }] };
  let res, usedFormat = true;
  try {
    res = await client.beta.messages.create({ ...base, output_config: { ...base.output_config, format: { type: "json_schema", schema: LABEL_SCHEMA } } });
  } catch (e) {
    const st = e && e.status;
    if (st !== 400) return { ok: false, error: "Claude could not read the label just now" + (st ? " (HTTP " + st + ")" : "") + "." };
    usedFormat = false;
    try { res = await client.beta.messages.create({ ...base, messages: [{ role: "user", content: [...content, { type: "text", text: "Answer with one JSON object only, with these keys: " + Object.keys(LABEL_SCHEMA.properties).join(", ") + "." }] }] }); }
    catch (e2) { return { ok: false, error: "Claude could not read the label just now." }; }
  }
  if (res && res.stop_reason === "refusal") return { ok: false, error: "Claude declined to read this photo." };
  const text = ((res && res.content) || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { const m = /\{[\s\S]*\}/.exec(text); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  if (!parsed) return { ok: false, error: "Claude's answer was not readable." };
  const f = labelToForm(parsed);
  const usage = res.usage ? { input: res.usage.input_tokens || 0, output: res.usage.output_tokens || 0 } : null;
  if (!f.grader && !f.name) return { ok: false, error: f.notes || "No grading label could be read in that photo.", usage };
  return { ok: true, ...f, source: "label", usedFormat, usage };
}
