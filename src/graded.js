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
import { TAG as AUTO_PRICE_TAG } from "./autoprice.js";

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
  const num = String(product.id).split("/").pop();
  return { ok: true, id: product.id, handle: product.handle, title: product.title || f.title, url: SHOP_URL + "/products/" + product.handle, adminUrl: ADMIN_URL + "/products/" + num, photos: urls.length, published, publishError, placeholder: f.placeholder, autoPrice: f.autoPrice, certUrl: f.certUrl };
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
