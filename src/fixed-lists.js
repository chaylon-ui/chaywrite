/* Fixed-price buylists (owner, 2026-11-05/06: "a new buylist for the new
   McDonald's Pokemon toys ... images of each, a buy cash and credit price
   (I can enter) and a selling price as well as loose, CIB, and new",
   "a maximum ability so we could limit how many we buy as well as after a
   certain qty we keep buying but pay less", "ability to turn on and off
   which cleanly removes from buylist as this may be a temporary promotion",
   "Build it in a way nobody sees it until it's on").

   A list the store writes itself, apart from BinderPOS's card buylist: a
   handful of items with a photo each, three conditions per item (loose /
   complete in box / new), and for every item x condition the cash and
   credit we pay, what we sell it for, how many we take at that price
   ("first N"), the lower pair we pay past that, the most we buy in all, and
   the running count of what has been reserved. Lists live in the stage
   room's storage (keys fl:<id>), so a submitted list becomes an ordinary
   9Pocket record (staff email, customer email, the worksheet) with its
   lines marked fixed: approving one sends nothing to BinderPOS.

   OFF is the default and means invisible: the sell page's strip does not
   appear, /buylist/api/list answers "not found" exactly like an unknown
   action, and a submit is refused. The editor (/9pocket/lists) carries a
   preview key so staff can look at the shopper's view while it is off. */

import { BASE, shell, esc, when } from "./stage-ui.js";
import { can } from "./stage-auth.js";
import { adminGql } from "./price-history.js";

export const FL = "fl:";
export const MAX_ITEMS = 200;
export const MAX_LINES = 100;
export const CONDITIONS = [
  { key: "loose", label: "Loose" },
  { key: "cib", label: "Complete in box with cards" },   // owner, 2026-11-06: "Make it say complete in box with cards"
  // "New (sealed)" went 2026-11-06 (owner: "Remove new sealed as there is no seal"): a boxed toy is the top state.
];

const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
const int = (v) => { if (v === "" || v == null) return null; const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e6) : null; };
const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const cleanUrl = (u) => { const s = str(u, 500); return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ""; };
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const doJson = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
async function bodyOf(request) { try { return (await request.json()) || {}; } catch { return {}; } }
const token = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };

/* ---------------- offers: prices, tiers, caps ---------------- */

export function blankOffer() { return { cash: null, credit: null, sell: null, fullUpTo: null, afterCash: null, afterCredit: null, max: null, bought: 0 }; }
export function cleanOffer(o, prev) {
  const s = o && typeof o === "object" ? o : {};
  const bought = s.bought === "" || s.bought == null ? (prev ? prev.bought : 0) : int(s.bought);
  return { cash: num(s.cash), credit: num(s.credit), sell: num(s.sell), fullUpTo: int(s.fullUpTo), afterCash: num(s.afterCash), afterCredit: num(s.afterCredit), max: int(s.max), bought: Math.max(0, bought || 0) };
}
// Buying at all: a cash or a credit price above zero.
export function buying(o) { return !!(o && ((o.cash || 0) > 0 || (o.credit || 0) > 0)); }
// A lower price past "first N": only when N is set and a lower pair exists.
export function hasAfter(o) { return !!(o && o.fullUpTo != null && ((o.afterCash || 0) > 0 || (o.afterCredit || 0) > 0)); }
// How many more units the store takes of this offer; null = no limit.
export function remaining(o) {
  if (!buying(o)) return 0;
  let cap = o.max;
  if (o.fullUpTo != null && !hasAfter(o)) cap = cap == null ? o.fullUpTo : Math.min(cap, o.fullUpTo);
  return cap == null ? null : Math.max(0, cap - (o.bought || 0));
}
export function fullLeft(o) { return o.fullUpTo == null ? null : Math.max(0, o.fullUpTo - (o.bought || 0)); }
// Price `qty` units against the counts as they stand: the tiers (full
// price, then the lower one), what is taken and what is refused.
export function quote(o, qty) {
  const want = Math.max(0, int(qty) || 0);
  const rem = remaining(o);
  const take = rem == null ? want : Math.min(want, rem);
  const tiers = [];
  if (take > 0) {
    const fl = fullLeft(o);
    const atFull = fl == null ? take : Math.min(take, fl);
    if (atFull > 0) tiers.push({ qty: atFull, cash: o.cash || 0, credit: o.credit || 0, after: false });
    const rest = take - atFull;
    if (rest > 0) tiers.push({ qty: rest, cash: o.afterCash || 0, credit: o.afterCredit || 0, after: true });
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { want, take, refused: want - take, tiers, cash: r2(tiers.reduce((s, t) => s + t.qty * t.cash, 0)), credit: r2(tiers.reduce((s, t) => s + t.qty * t.credit, 0)) };
}

/* ---------------- a list ---------------- */

// The Shopify product an item was given (productsOnShopify below): the
// product, and per condition the variant and its inventory item.
function cleanShopify(v) {
  if (!v || typeof v !== "object" || !/^gid:\/\/shopify\/Product\/\d+$/.test(String(v.product || ""))) return null;
  const variants = {};
  for (const [k, x] of Object.entries(v.variants || {})) if (x && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(x.id || ""))) variants[slug(k)] = { id: x.id, inventoryItem: /^gid:\/\/shopify\/InventoryItem\/\d+$/.test(String(x.inventoryItem || "")) ? x.inventoryItem : "" };
  return { product: v.product, handle: str(v.handle, 200), status: String(v.status || "").toUpperCase() === "ACTIVE" ? "ACTIVE" : "DRAFT", variants };
}

// Who gets each submitted list besides the Buylist emails list (owner,
// 2026-11-11: the toy lists to a staff inbox of their own): up to ten
// addresses, typed one per line or comma-separated in the editor.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanEmails(v) {
  const raw = Array.isArray(v) ? v.join("\n") : String(v == null ? "" : v);
  const out = [];
  for (const piece of raw.split(/[\s,;]+/)) { const e = piece.trim().toLowerCase(); if (e && EMAIL_RE.test(e) && !out.includes(e)) out.push(e); }
  return out.slice(0, 10);
}
export function cleanList(b, prev, now, by) {
  const id = slug(b && b.id) || (prev && prev.id);
  if (!id) return null;
  const conds = CONDITIONS;
  const items = [], seen = new Set();
  for (const it of (Array.isArray(b && b.items) ? b.items : []).slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== "object") continue;
    const key = slug(it.key || it.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const prevIt = prev ? (prev.items || []).find((x) => x.key === key) : null;
    const offers = {};
    for (const c of conds) offers[c.key] = cleanOffer(it.offers && it.offers[c.key], prevIt && prevIt.offers ? prevIt.offers[c.key] : null);
    items.push({ key, name: str(it.name, 80) || key, image: cleanUrl(it.image), retired: it.retired === true || it.retired === "on" || it.retired === "1", offers,
      shopify: cleanShopify(it.shopify) || (prevIt && prevIt.shopify) || null });
  }
  return {
    id, title: str(b && b.title, 80) || (prev && prev.title) || id, blurb: str(b && b.blurb, 300),
    banner: cleanUrl(b && b.banner),   // owner, 2026-11-06: the McDonald's x Pokémon logo at the top of the list
    tile: cleanUrl(b && b.tile),       // the square picture beside the game tiles on the sell page (owner: "like Pokemon, mtg, Star Wars etc")
    info: cleanUrl(b && b.info),       // the wide explainer at the top of the open list (owner: "another informational one once the McDonald's toys are chosen")
    emails: b && b.emails !== undefined ? cleanEmails(b.emails) : (prev && prev.emails) || [],   // besides the Buylist emails list; kept when a save does not mention it
    on: prev ? !!prev.on : false, pv: (prev && prev.pv) || token(), conditions: conds, items,
    created: (prev && prev.created) || now, updatedAt: now, updatedBy: str(by, 160),
  };
}

// What the sell page's strip shows: the lists that are on (or previewed).
export function summaryView(l) {
  const live = (l.items || []).filter((i) => !i.retired);
  return { id: l.id, title: l.title, blurb: l.blurb || "", banner: l.banner || "", tile: l.tile || "", images: live.map((i) => i.image).filter(Boolean).slice(0, 4), count: live.length,
    buying: live.filter((i) => CONDITIONS.some((c) => buying(i.offers[c.key]))).length };
}
// What the shopper sees of a list: never the running counts themselves,
// only what is left and the tiers; never the preview key.
export function publicView(l) {
  return {
    id: l.id, title: l.title, blurb: l.blurb || "", banner: l.banner || "", info: l.info || "", conditions: CONDITIONS,
    items: (l.items || []).filter((i) => !i.retired).map((i) => ({
      key: i.key, name: i.name, image: i.image,
      offers: Object.fromEntries(CONDITIONS.map((c) => {
        const o = i.offers[c.key] || blankOffer();
        return [c.key, { buying: buying(o), cash: o.cash || 0, credit: o.credit || 0, remaining: remaining(o), fullLeft: fullLeft(o), fullUpTo: o.fullUpTo, afterCash: hasAfter(o) ? o.afterCash || 0 : null, afterCredit: hasAfter(o) ? o.afterCredit || 0 : null }];
      })),
    })),
  };
}
export const visible = (l, pv) => !!l && (!!l.on || (!!pv && !!l.pv && pv === l.pv));

export function cleanLines(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const x of v.slice(0, MAX_LINES)) {
    if (!x || typeof x !== "object") continue;
    const item = slug(x.item), cond = slug(x.cond), qty = Math.min(999, int(x.qty) || 0);
    if (!item || !cond || !qty || seen.has(item + "|" + cond)) continue;
    seen.add(item + "|" + cond);
    out.push({ item, cond, qty });
  }
  return out;
}

// The stage record's lines for a reserved quote: one per tier, marked
// fixed so approval skips BinderPOS and a rejection gives the units back.
export function cardsOf(list, lines) {
  const cards = [], notes = [];
  const condLabel = (k) => (CONDITIONS.find((c) => c.key === k) || {}).label || k;
  for (const ln of lines) {
    const item = (list.items || []).find((i) => i.key === ln.item && !i.retired);
    const o = item && item.offers[ln.cond];
    if (!item || !o) { notes.push(ln.item + " · " + ln.cond + ": not on this list"); continue; }
    const q = quote(o, ln.qty);
    if (q.refused) notes.push(item.name + " · " + condLabel(ln.cond) + ": " + (q.take ? "we can take " + q.take + " more, not " + q.want : buying(o) ? "we are at our limit" : "we are not buying that one right now"));
    for (const t of q.tiers) {
      cards.push({ cardId: FL + list.id + ":" + item.key + ":" + ln.cond + (t.after ? ":after" : ""), cardName: item.name, setName: list.title, game: "fixed", type: "Normal",
        condition: ln.cond, conditionName: condLabel(ln.cond) + (t.after ? " · after the first " + o.fullUpTo : ""), quantity: String(t.qty),
        cashBuyPrice: t.cash, storeCreditBuyPrice: t.credit, imageUrl: item.image || "", fixed: { list: list.id, item: item.key, cond: ln.cond, after: !!t.after } });
    }
  }
  return { cards, notes };
}

/* ---------------- the stage room's handlers (/_stage/fl/*) ---------------- */

async function allLists(cx) {
  const m = await cx.storage.list({ prefix: FL });
  const out = [];
  for (const v of m.values()) if (v && v.id) out.push(v);
  out.sort((a, b) => (a.created || 0) - (b.created || 0));
  return out;
}
// A rejected list gives its units back (called by the mark handler).
export async function releaseFixed(cx, cards) {
  const byList = {};
  for (const c of Array.isArray(cards) ? cards : []) {
    const f = c && c.fixed;
    if (!f || !f.list) continue;
    (byList[f.list] = byList[f.list] || []).push({ item: f.item, cond: f.cond, qty: Math.max(0, parseInt(c.quantity, 10) || 0) });
  }
  let released = 0;
  for (const [id, lines] of Object.entries(byList)) {
    const l = await cx.storage.get(FL + id);
    if (!l) continue;
    for (const ln of lines) {
      const it = (l.items || []).find((i) => i.key === ln.item);
      const o = it && it.offers[ln.cond];
      if (!o) continue;
      const give = Math.min(o.bought || 0, ln.qty);
      o.bought = (o.bought || 0) - give; released += give;
    }
    await cx.storage.put(FL + id, l);
  }
  return released;
}

export async function fixedDo(cx, request, url) {
  const p = url.pathname, post = request.method === "POST";
  const now = cx.now();
  if (p === "/_stage/fl/list") return doJson({ ok: true, lists: await allLists(cx) });
  if (p === "/_stage/fl/get") {
    const l = await cx.storage.get(FL + slug(url.searchParams.get("id")));
    return l ? doJson({ ok: true, list: l }) : doJson({ ok: false, error: "no such list" }, 404);
  }
  if (p === "/_stage/fl/create" && post) {
    const b = await bodyOf(request);
    const id = slug(b.id);
    if (!id) return doJson({ ok: false, error: "the list needs an id (letters and digits)" }, 400);
    if (await cx.storage.get(FL + id)) return doJson({ ok: false, error: "a list with that id exists" }, 409);
    const l = cleanList({ ...b, id }, null, now, b.by);
    await cx.storage.put(FL + id, l);
    return doJson({ ok: true, list: l });
  }
  if (p === "/_stage/fl/save" && post) {
    const b = await bodyOf(request);
    const prev = await cx.storage.get(FL + slug(b.id || (b.list && b.list.id)));
    if (!prev) return doJson({ ok: false, error: "no such list" }, 404);
    const l = cleanList({ ...(b.list || {}), id: prev.id }, prev, now, b.by);
    await cx.storage.put(FL + prev.id, l);
    return doJson({ ok: true, list: l });
  }
  if (p === "/_stage/fl/set" && post) {
    const b = await bodyOf(request);
    const l = await cx.storage.get(FL + slug(b.id));
    if (!l) return doJson({ ok: false, error: "no such list" }, 404);
    if (b.delete === true) {
      if (l.on) return doJson({ ok: false, error: "switch the list off first" }, 409);
      await cx.storage.delete(FL + l.id);
      return doJson({ ok: true, deleted: l.id });
    }
    if (typeof b.on === "boolean") { l.on = b.on; l.updatedAt = now; l.updatedBy = str(b.by, 160); l.switchedAt = now; }
    if (b.newPreview === true) l.pv = token();
    await cx.storage.put(FL + l.id, l);
    return doJson({ ok: true, list: l });
  }
  // Quote and reserve in one step: the counts move here, under the room's
  // input gate, so two shoppers cannot both take the last units.
  if (p === "/_stage/fl/reserve" && post) {
    const b = await bodyOf(request);
    const l = await cx.storage.get(FL + slug(b.id));
    if (!l || !l.on) return doJson({ ok: false, error: "This list is not open right now.", status: 404 }, 404);
    const lines = cleanLines(b.lines);
    if (!lines.length) return doJson({ ok: false, error: "the list is empty", status: 400 }, 400);
    const { cards, notes } = cardsOf(l, lines);
    if (!cards.length) return doJson({ ok: false, error: "None of these can be taken right now: " + notes.join("; "), notes, status: 409 }, 409);
    for (const c of cards) {
      const it = l.items.find((i) => i.key === c.fixed.item);
      const o = it.offers[c.fixed.cond];
      o.bought = (o.bought || 0) + (parseInt(c.quantity, 10) || 0);
    }
    l.reservedAt = now;
    await cx.storage.put(FL + l.id, l);
    const units = cards.reduce((s, c) => s + (parseInt(c.quantity, 10) || 0), 0);
    return doJson({ ok: true, id: l.id, title: l.title, cards, notes, units });
  }
  if (p === "/_stage/fl/stocked" && post) {
    const b = await bodyOf(request);
    const key = "st:" + String(b.id || "").slice(0, 40);
    const rec = await cx.storage.get(key);
    if (!rec) return doJson({ ok: false, error: "no such record" }, 404);
    rec.stocked = b.stocked && typeof b.stocked === "object" ? b.stocked : null;
    rec.events = (rec.events || []).concat([{ ts: now, action: "stocked on Shopify", by: str(b.by, 160) }]).slice(-30);
    await cx.storage.put(key, rec);
    return doJson({ ok: true, record: rec });
  }
  if (p === "/_stage/fl/release" && post) {
    const b = await bodyOf(request);
    return doJson({ ok: true, released: await releaseFixed(cx, b.cards) });
  }
  return doJson({ ok: false, error: "not found" }, 404);
}

/* ---------------- Shopify: the products behind a list ----------------
   Owner, 2026-11-06: "Do they go live on shopify" / "Approve add
   automatically". One product per item (title "Pikachu [<list title>]",
   draft, an option Condition with one variant per condition at the sell
   price or the store's placeholder, tracked, 0 at 51 Allen Street, the
   item's picture), made by a button on the editor and published to the
   Online Store; saving the list pushes changed sell prices to the variants;
   approving a list adds its quantities to stock and makes the products
   active. Nothing reaches BinderPOS. */
export const LOCATION = "gid://shopify/Location/53483602073";                       // 51 Allen Street (src/graded.js)
export const ONLINE_STORE_PUBLICATION = "gid://shopify/Publication/63498813593";   // "Online Store" (src/graded.js)
export const PLACEHOLDER_PRICE = "999999.00";
export const ADMIN_URL = "https://admin.shopify.com/store/most-wanted-ca";
const SET_M = `mutation($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { id handle status variants(first: 10) { nodes { id sku inventoryItem { id } selectedOptions { name value } } } } userErrors { field message code } } }`;
const PUB_M = `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const PRICE_M = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`;
const ADJ_M = `mutation($input: InventoryAdjustQuantitiesInput!) { inventoryAdjustQuantities(input: $input) { userErrors { field message } } }`;
const STATUS_M = `mutation($input: ProductInput!) { productUpdate(input: $input) { product { id status } userErrors { field message } } }`;
const errsOf = (o) => ((o && o.userErrors) || []).map((e) => (e.field ? [].concat(e.field).join(".") + ": " : "") + e.message).join("; ");
const money2 = (n) => (Number(n) || 0).toFixed(2);
export const skuOf = (list, item, cond) => (list.id + "-" + item.key + "-" + cond).toUpperCase();

export function productInputOf(list, item) {
  const conds = CONDITIONS;
  return {
    title: item.name + " [" + list.title + "]",
    productType: "Toys", vendor: "Exor Games", status: "DRAFT",
    tags: ["fixed-list", "fl:" + list.id, list.title],
    descriptionHtml: "<p>" + esc(item.name) + " from " + esc(list.title) + "." + (list.blurb ? " " + esc(list.blurb) : "") + "</p>",
    productOptions: [{ name: "Condition", values: conds.map((c) => ({ name: c.label })) }],
    variants: conds.map((c) => {
      const o = item.offers[c.key] || {};
      return { optionValues: [{ optionName: "Condition", name: c.label }], price: o.sell ? money2(o.sell) : PLACEHOLDER_PRICE, sku: skuOf(list, item, c.key),
        inventoryItem: { tracked: true }, inventoryQuantities: [{ locationId: LOCATION, name: "available", quantity: 0 }] };
    }),
    files: item.image ? [{ originalSource: item.image, contentType: "IMAGE", alt: item.name, filename: item.key + ".png" }] : [],
  };
}
// The variants productSet made, keyed by condition.
export function shopifyOf(product) {
  const variants = {};
  for (const v of ((product.variants || {}).nodes) || []) {
    const label = ((v.selectedOptions || []).find((o) => o.name === "Condition") || {}).value;
    const c = CONDITIONS.find((x) => x.label === label);
    if (c) variants[c.key] = { id: v.id, inventoryItem: (v.inventoryItem && v.inventoryItem.id) || "" };
  }
  return { product: product.id, handle: product.handle || "", status: product.status || "DRAFT", variants };
}
export function gqlCx(env, fetchFn) { return { env, fetch: fetchFn || ((u, i) => fetch(u, i)) }; }

// Make the products the list's live items lack. Returns what was made and what failed.
export async function productsOnShopify(cx, list) {
  const made = [], errors = [];
  if (!cx.env || !cx.env.SHOPIFY_ADMIN_TOKEN) return { made, errors: ["the worker has no Shopify token"], list };
  for (const item of (list.items || []).filter((i) => !i.retired && !(i.shopify && i.shopify.product))) {
    try {
      const r = await adminGql(cx, SET_M, { input: productInputOf(list, item) });
      const ps = (r.data && r.data.productSet) || {};
      const e = errsOf(ps) || (r.errors ? r.errors.map((x) => x.message).join("; ") : "");
      if (!ps.product || e) { errors.push(item.name + ": " + (e || "no product came back")); continue; }
      item.shopify = shopifyOf(ps.product);
      try { const pr = await adminGql(cx, PUB_M, { id: ps.product.id, input: [{ publicationId: ONLINE_STORE_PUBLICATION }] }); const pe = errsOf(pr.data && pr.data.publishablePublish); if (pe) errors.push(item.name + ": made, but not published: " + pe); } catch (x) { errors.push(item.name + ": made, but not published: " + String((x && x.message) || x).slice(0, 120)); }
      made.push(item.name);
    } catch (x) { errors.push(item.name + ": " + String((x && x.message) || x).slice(0, 160)); }
  }
  return { made, errors, list };
}
// Sell prices that changed between two saved copies, pushed to the variants.
export function priceChanges(prev, next) {
  const out = [];
  for (const item of next.items || []) {
    if (!item.shopify || !item.shopify.product) continue;
    const before = prev ? (prev.items || []).find((i) => i.key === item.key) : null;
    const variants = [];
    for (const c of CONDITIONS) {
      const v = item.shopify.variants[c.key];
      const sell = item.offers[c.key] && item.offers[c.key].sell;
      const was = before && before.offers[c.key] ? before.offers[c.key].sell : undefined;
      if (v && sell && sell !== was) variants.push({ id: v.id, price: money2(sell) });
    }
    if (variants.length) out.push({ productId: item.shopify.product, variants, name: item.name });
  }
  return out;
}
export async function syncPrices(cx, prev, next) {
  const changes = priceChanges(prev, next), done = [], errors = [];
  if (changes.length && !(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) return { done, errors: ["no Shopify token"] };
  for (const ch of changes) {
    try { const r = await adminGql(cx, PRICE_M, { productId: ch.productId, variants: ch.variants }); const e = errsOf(r.data && r.data.productVariantsBulkUpdate); if (e) errors.push(ch.name + ": " + e); else done.push(ch.name); }
    catch (x) { errors.push(ch.name + ": " + String((x && x.message) || x).slice(0, 120)); }
  }
  return { done, errors };
}
// What an approved record adds to stock: one change per variant, and the items with no product yet.
export function stockChanges(list, rec) {
  const byKey = {}, missing = [];
  for (const c of rec.cards || []) {
    const f = c.fixed; if (!f || f.list !== list.id) continue;
    const q = Math.max(0, parseInt(c.quantity, 10) || 0); if (!q) continue;
    const k = f.item + "|" + f.cond;
    byKey[k] = (byKey[k] || 0) + q;
  }
  const changes = [], lines = [], products = new Set();
  for (const [k, qty] of Object.entries(byKey)) {
    const [itemKey, cond] = k.split("|");
    const item = (list.items || []).find((i) => i.key === itemKey);
    const v = item && item.shopify && item.shopify.variants[cond];
    const label = ((CONDITIONS.find((c) => c.key === cond) || {}).label) || cond;
    if (!item || !v || !v.inventoryItem) { missing.push((item ? item.name : itemKey) + " (" + label + ") ×" + qty); continue; }
    changes.push({ delta: qty, inventoryItemId: v.inventoryItem, locationId: LOCATION });
    lines.push({ item: item.key, name: item.name, cond, label, qty, variant: v.id });
    products.add(item.shopify.product);
  }
  return { changes, lines, missing, products: [...products] };
}
export async function stockFixed(cx, list, rec) {
  const plan = stockChanges(list, rec);
  const out = { at: Date.now(), lines: plan.lines, missing: plan.missing, errors: [], activated: [] };
  if (!plan.changes.length) return out;
  if (!(cx.env && cx.env.SHOPIFY_ADMIN_TOKEN)) { out.errors.push("no Shopify token"); return out; }
  try {
    const r = await adminGql(cx, ADJ_M, { input: { reason: "received", name: "available", changes: plan.changes } });
    const e = errsOf(r.data && r.data.inventoryAdjustQuantities) || (r.errors ? r.errors.map((x) => x.message).join("; ") : "");
    if (e) { out.errors.push("stock: " + e); return out; }
  } catch (x) { out.errors.push("stock: " + String((x && x.message) || x).slice(0, 160)); return out; }
  out.added = true;
  for (const pid of plan.products) {
    const item = (list.items || []).find((i) => i.shopify && i.shopify.product === pid);
    if (!item || item.shopify.status === "ACTIVE") continue;
    try {
      const r = await adminGql(cx, STATUS_M, { input: { id: pid, status: "ACTIVE" } });
      const e = errsOf(r.data && r.data.productUpdate);
      if (e) out.errors.push(item.name + ": not made live: " + e); else { item.shopify.status = "ACTIVE"; out.activated.push(item.name); }
    } catch (x) { out.errors.push(item.name + ": not made live: " + String((x && x.message) || x).slice(0, 120)); }
  }
  return out;
}
export function stockText(st) {
  if (!st) return "";
  const bits = [];
  if (st.added) bits.push("Added to stock on Shopify: " + st.lines.map((l) => "+" + l.qty + " " + l.name + " (" + l.label + ")").join(", ") + ".");
  if (st.activated && st.activated.length) bits.push("Now live: " + st.activated.join(", ") + ".");
  if (st.missing && st.missing.length) bits.push("No product on Shopify yet for " + st.missing.join(", ") + " - make them under Fixed-price lists and add the stock by hand.");
  if (st.errors && st.errors.length) bits.push("Shopify said: " + st.errors.join("; "));
  return bits.join(" ");
}

/* ---------------- the first list ---------------- */

const CDN = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/mcd-pokemon-2026-";
const MCD = [["pikachu", "Pikachu", "1793967307"], ["eevee", "Eevee", "1793967307"], ["umbreon", "Umbreon", "1793967307"], ["charmander", "Charmander", "1793967307"], ["squirtle", "Squirtle", "1793967308"],
  ["bulbasaur", "Bulbasaur", "1793967308"], ["piplup", "Piplup", "1793967307"], ["rowlet", "Rowlet", "1793967308"], ["torchic", "Torchic", "1793967307"], ["sobble", "Sobble", "1793967307"],
  ["sprigatito", "Sprigatito", "1793967308"], ["munchlax", "Munchlax", "1793967307"], ["minccino", "Minccino", "1793967308"], ["espurr", "Espurr", "1793967307"], ["weedle", "Weedle", "1793967307"]];
export const SEED = {
  id: "mcd-pokemon-2026", title: "McDonald's Pokémon toys",
  blurb: "The 2026 Happy Meal figures. Count what you have of each, loose or complete in its box with the cards, and choose cash or store credit.",
  items: MCD.map(([key, name, v]) => ({ key, name, image: CDN + key + ".png?v=" + v, offers: {} })),
};

/* ---------------- the staff editor (/9pocket/lists) ---------------- */

export const SELL_PAGE = "https://exorgames.com/pages/selling-to-exor-games-buylist";
// The owner's McDonald's x Pokémon 30th Anniversary Collab logo, uploaded to Shopify Files 2026-11-06 (1774x887).
export const MCD_LOGO = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/CCA7E631-6CC7-4FBA-8180-A17D8787E71A.png?v=1793976459";
// The square tile made from it (logo on yellow, Eevee / Pikachu / Charmander), in Files as mcd-pokemon-2026-tile.png.
export const MCD_TILE = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/mcd-pokemon-2026-tile.png?v=1793977254";
// The owner's wide explainer ("Sell us your Pokémon Happy Meal toys!", 2172x724), Files 2026-11-06.
export const MCD_INFO = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/5334CF63-54F4-4215-BAA0-B438FD35901A.png?v=1793977635";

export async function serveListsStaff(request, env, url, user, form, helpers) {
  const { html, redirect, q, toLogin, opts, call } = helpers;
  const gql = gqlCx(env, helpers.fetchFn);
  const p = url.pathname;
  const noStore = { "cache-control": "no-store" };
  const R = BASE + "/lists";
  const allowed = can(user, "lists");
  if (p === R + ".json") {
    if (!user) return Response.json({ error: "sign in required" }, { status: 403, headers: noStore });
    if (!allowed) return Response.json({ error: "no lists permission" }, { status: 403, headers: noStore });
    return Response.json(await call("/_stage/fl/list"), { headers: noStore });
  }
  if (!user) return toLogin();
  if (!allowed) return html(renderLists({ ...opts, denied: true, lists: [] }), 403);
  if (p === R + "/control" && request.method === "POST") {
    const f = form || {};
    const action = String(f.action || "");
    const id = slug(f.id);
    const by = user.email;
    let result;
    if (action === "seed") {
      const r = await call("/_stage/fl/create", { ...SEED, by });
      result = r.ok ? { ok: true, message: "The McDonald's Pokémon list is here with its 15 toys and every price blank. Fill the prices in and save; switch it on when it is ready." } : r;
    } else if (action === "create") {
      const r = await call("/_stage/fl/create", { id: slug(f.id || f.title), title: f.title, blurb: f.blurb, items: f.withToys ? SEED.items : [], by });
      result = r.ok ? { ok: true, message: "List \"" + r.list.title + "\" created (off)" + (f.withToys ? " with the 15 McDonald's toys." : ". Add its items, then save.") } : r;
    } else if (action === "addseed") {
      // Owner, 2026-11-06: made a list of their own ("2026 McDonalds Pokémon
      // Toys") with the empty form and found no toys in it. Any list can take
      // the 15 toys; ones already there are left as they are.
      const g = await call("/_stage/fl/get?id=" + encodeURIComponent(id));
      if (!g.ok) result = g;
      else {
        const have = new Set((g.list.items || []).map((i) => i.key));
        const add = SEED.items.filter((i) => !have.has(i.key));
        const r = add.length ? await call("/_stage/fl/save", { id, list: { ...g.list, items: (g.list.items || []).concat(add) }, by }) : { ok: true, list: g.list };
        result = r.ok ? { ok: true, message: add.length ? "Added the " + add.length + " McDonald's toy" + (add.length === 1 ? "" : "s") + " to \"" + r.list.title + "\" with their pictures; the prices are blank until you fill them in." : "\"" + g.list.title + "\" already has all 15 toys." } : r;
      }
    } else if (action === "save") {
      let list = f.list;
      if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = null; } }
      if (!list || typeof list !== "object") result = { ok: false, error: "nothing to save" };
      else {
        const before = await call("/_stage/fl/get?id=" + encodeURIComponent(id));
        const r = await call("/_stage/fl/save", { id, list, by });
        if (!r.ok) result = r;
        else {
          const sp = await syncPrices(gql, before.ok ? before.list : null, r.list);
          result = { ok: true, message: "Saved " + r.list.items.length + " item" + (r.list.items.length === 1 ? "" : "s") + " on \"" + r.list.title + "\"." + (sp.done.length ? " Sell prices updated on Shopify for " + sp.done.join(", ") + "." : "") + (sp.errors.length ? " Shopify price update failed: " + sp.errors.join("; ") : "") };
        }
      }
    } else if (action === "products") {
      const g = await call("/_stage/fl/get?id=" + encodeURIComponent(id));
      if (!g.ok) result = g;
      else {
        const r = await productsOnShopify(gql, g.list);
        if (r.made.length) await call("/_stage/fl/save", { id, list: r.list, by });
        result = { ok: !r.errors.length || r.made.length > 0, message: (r.made.length ? "Made " + r.made.length + " product" + (r.made.length === 1 ? "" : "s") + " on Shopify (draft, 0 in stock, at the sell prices): " + r.made.join(", ") + "." : "Every item already has its product.") + (r.errors.length ? " Problems: " + r.errors.join("; ") : ""), error: r.errors.length && !r.made.length ? r.errors.join("; ") : undefined };
      }
    } else if (action === "on" || action === "off") {
      const r = await call("/_stage/fl/set", { id, on: action === "on", by });
      result = r.ok ? { ok: true, message: action === "on" ? "\"" + r.list.title + "\" is ON: the strip is on the sell page now." : "\"" + r.list.title + "\" is OFF: gone from the sell page; prices and counts are kept." } : r;
    } else if (action === "preview-key") {
      const r = await call("/_stage/fl/set", { id, newPreview: true, by });
      result = r.ok ? { ok: true, message: "New preview link made; the old one no longer works." } : r;
    } else if (action === "delete") {
      if (user.role !== "admin") result = { ok: false, error: "Only an admin can delete a list." };
      else { const r = await call("/_stage/fl/set", { id, delete: true, by }); result = r.ok ? { ok: true, message: "List deleted." } : r; }
    } else result = { ok: false, error: "unknown action" };
    if (f.__form) return redirect(R + q(result.ok ? { msg: result.message } : { err: result.error || "failed" }));
    return Response.json(result, { status: result.ok ? 200 : (result.status || 400), headers: noStore });
  }
  const j = await call("/_stage/fl/list");
  return html(renderLists({ ...opts, lists: j.ok ? j.lists : [], origin: url.origin }));
}

const CSS = `.fl-head{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}.fl-head h3{margin:0}
.fl-meta{display:grid;grid-template-columns:1fr 2fr;gap:8px;margin:8px 0}.fl-meta label{display:block;font-size:12px;color:#5b6770}.fl-meta input,.fl-meta textarea{width:100%}
.fl-banner{grid-column:1/-1}.fl-bannerrow{display:flex;gap:6px;align-items:center}.fl-bannerrow input{flex:1 1 auto}.fl-bannerpv{display:block;max-width:360px;width:100%;height:auto;margin-top:6px;border-radius:8px;border:1px solid #e3e7ea}.fl-tilepv{max-width:120px}
.fl-item{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;border-top:1px solid #e3e7ea;padding:10px 0}.fl-item img{width:72px;height:72px;object-fit:contain;background:#f4f6f7;border-radius:8px}
.fl-item .nm{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:6px}.fl-item .nm input.name{font-weight:700;width:180px}.fl-item .nm input.img{flex:1 1 260px;min-width:160px;font-size:12px}
.fl-row{display:grid;grid-template-columns:128px repeat(8,minmax(60px,1fr));gap:4px;align-items:center;font-size:12.5px;margin:2px 0}.fl-row>b{font-weight:600}.fl-row input{width:100%;padding:4px 5px;font-size:13px}
.fl-f{display:block;min-width:0}.fl-f span{display:none}
.fl-cols{display:grid;grid-template-columns:128px repeat(8,minmax(60px,1fr));gap:4px;font-size:11px;color:#5b6770;text-transform:uppercase;letter-spacing:.04em;margin:6px 0 2px}.fl-cols span:first-child{text-transform:none;letter-spacing:0}
.fl-row.off input{opacity:.55}.fl-item.retired{opacity:.5}.fl-sw{display:inline-flex;gap:6px;align-items:center}.fl-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}
.fl-shop{margin:10px 0 0;padding:8px 10px;background:#f4f6f7;border-radius:8px;font-size:13px}
.fl-top{position:sticky;top:0;background:#fff;padding:8px 0;z-index:2;border-bottom:1px solid #e3e7ea;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
@media(max-width:900px){.fl-cols{display:none}.fl-row{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 6px;margin:8px 0;padding:8px;background:#f7f9fa;border-radius:10px}.fl-row.off{background:#fafafa}
.fl-row .fl-cn{grid-column:1/-1;font-size:14px}.fl-row .fl-cn small{font-size:12px;font-weight:400}
.fl-f span{display:flex;align-items:flex-end;min-height:2.3em;font-size:10.5px;line-height:1.1;color:#5b6770;text-transform:uppercase;letter-spacing:.03em;margin:0 0 3px}
.fl-row input{font-size:16px;padding:8px 6px;border-radius:8px}
.fl-item{grid-template-columns:56px minmax(0,1fr);gap:8px}.fl-item img{width:56px;height:56px}
.fl-item .nm input.name{width:100%;font-size:16px}.fl-item .nm input.img{font-size:12px}
.fl-meta{grid-template-columns:1fr}.fl-head form,.fl-head a.btn{font-size:13px}}
@media(max-width:380px){.fl-row{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

export function renderLists(o) {
  if (o.denied) return shell("Fixed-price lists", `<h1>Fixed-price lists</h1><div class="err">Your account cannot edit the fixed-price lists. Ask an admin for the "lists" permission.</div>`, o, true);
  const lists = o.lists || [];
  const hasSeed = lists.some((l) => l.id === SEED.id);
  const LABEL = { cash: "Cash", credit: "Credit", sell: "Sell", fullUpTo: "First", afterCash: "Then cash", afterCredit: "Then credit", max: "Max", bought: "Bought" };
  const inp = (k, key, v, step, title) => `<label class="fl-f"><span>${LABEL[key]}</span><input type="number" min="0" step="${step}" inputmode="decimal" data-k="${k}" data-f="${key}" value="${v == null ? "" : esc(v)}" title="${esc(title)}"></label>`;
  const item = (l, it) => `<div class="fl-item${it.retired ? " retired" : ""}" data-item="${esc(it.key)}">
<div>${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : `<div style="width:72px;height:72px;background:#f4f6f7;border-radius:8px"></div>`}</div>
<div><div class="nm"><input class="text name" data-f="name" value="${esc(it.name)}" placeholder="name"><input class="text img" data-f="image" value="${esc(it.image || "")}" placeholder="image URL (https://cdn.shopify.com/...)"><label class="chk"><input type="checkbox" data-f="retired" ${it.retired ? "checked" : ""}> retired (hidden)</label>${it.shopify && it.shopify.product ? `<a class="muted" href="${ADMIN_URL}/products/${esc(it.shopify.product.replace(/\D/g, ""))}" target="_blank" rel="noopener" title="This item's product on Shopify">${it.shopify.status === "ACTIVE" ? "live" : "draft"} on Shopify ↗</a>` : ""}<button type="button" class="sm" data-act="copyall" title="Every toy on this list gets the same cash, credit, sell, first, then and max as this one; bought stays as it is. Then press Save changes.">Use these prices for every toy</button></div>
${CONDITIONS.map((c) => { const of = it.offers[c.key] || blankOffer(); const rem = remaining(of);
    return `<div class="fl-row${buying(of) ? "" : " off"}" data-cond="${esc(c.key)}"><b class="fl-cn">${esc(c.label)}<br><small class="muted">${buying(of) ? (rem == null ? "no limit" : rem + " more") : "not buying"}</small></b>
${inp(c.key, "cash", of.cash, "0.01", "cash we pay")}${inp(c.key, "credit", of.credit, "0.01", "store credit we pay")}${inp(c.key, "sell", of.sell, "0.01", "what we sell it for (the Shopify price; shoppers do not see it)")}
${inp(c.key, "fullUpTo", of.fullUpTo, "1", "how many at that price (counted across every list)")}${inp(c.key, "afterCash", of.afterCash, "0.01", "cash past that count")}${inp(c.key, "afterCredit", of.afterCredit, "0.01", "credit past that count")}
${inp(c.key, "max", of.max, "1", "the most we buy in all (blank = no cap)")}${inp(c.key, "bought", of.bought, "1", "reserved so far by submitted lists; lower it if a list never arrived")}</div>`; }).join("")}
</div></div>`;
  const card = (l) => {
    const live = (l.items || []).filter((i) => !i.retired).length;
    const withProducts = (l.items || []).filter((i) => !i.retired && i.shopify && i.shopify.product).length;
    const activeCount = (l.items || []).filter((i) => !i.retired && i.shopify && i.shopify.status === "ACTIVE").length;
    const missing = SEED.items.filter((s) => !(l.items || []).some((i) => i.key === s.key)).length;
    const preview = SELL_PAGE + "?xgfl=" + encodeURIComponent(l.id) + "&pv=" + encodeURIComponent(l.pv || "") + "#buylist";
    const hid = `<input type="hidden" name="__form" value="1"><input type="hidden" name="id" value="${esc(l.id)}">`;
    return `<div class="card fl-list" data-id="${esc(l.id)}">
<div class="fl-head"><h3>${esc(l.title)}</h3><span class="tag ${l.on ? "tag-approved" : "tag-off"}">${l.on ? "ON - on the sell page" : "OFF - nobody sees it"}</span><span class="muted">${live} item${live === 1 ? "" : "s"}${l.updatedAt ? " · saved " + esc(when(l.updatedAt)) + (l.updatedBy ? " by " + esc(l.updatedBy) : "") : ""}</span>
<span class="sp"></span>
<form method="post" action="${BASE}/lists/control" onsubmit="return confirm('${l.on ? "Switch this list OFF? It disappears from the sell page at once; prices and counts are kept." : "Switch this list ON? The strip appears on the sell page for everyone at once."}')">${hid}<input type="hidden" name="action" value="${l.on ? "off" : "on"}"><button type="submit" class="${l.on ? "" : "ok"}">${l.on ? "Switch off" : "Switch on"}</button></form>
<a class="btn" href="${esc(preview)}" target="_blank" rel="noopener" title="Opens the sell page with this list showing for you only, even while it is off">Preview as a shopper ↗</a>
${missing ? `<form method="post" action="${BASE}/lists/control">${hid}<input type="hidden" name="action" value="addseed"><button type="submit" class="ok" title="The 15 Happy Meal figures with their pictures, prices blank">Add the ${missing === 15 ? "15 " : ""}McDonald's toys${missing === 15 ? "" : " (" + missing + " missing)"}</button></form>` : ""}
${l.on ? "" : `<form method="post" action="${BASE}/lists/control" onsubmit="return confirm('Delete this list and its prices? This cannot be undone.')">${hid}<input type="hidden" name="action" value="delete"><button type="submit">Delete</button></form>`}</div>
<div class="fl-meta"><label>Title<input class="text" data-f="title" value="${esc(l.title)}"></label><label>Blurb on the sell page<input class="text" data-f="blurb" value="${esc(l.blurb || "")}" placeholder="one or two sentences"></label><label>Email each submitted list to<input class="text" data-f="emails" value="${esc((l.emails || []).join(", "))}" placeholder="addresses, comma-separated - besides the Buylist emails list on Admin"></label>
<label class="fl-banner">Banner image (a Shopify Files URL; shown at the top of the list)<span class="fl-bannerrow"><input class="text" data-f="banner" value="${esc(l.banner || "")}" placeholder="https://cdn.shopify.com/..."><button type="button" class="sm" data-act="logo" title="Fills the three boxes from your Files: the McDonald's x Pokémon 30th Anniversary Collab logo, the square tile made from it, and the 'Sell us your Pokémon Happy Meal toys!' explainer">Use the McDonald's × Pokémon logo, tile and explainer</button></span>${l.banner ? `<img class="fl-bannerpv" src="${esc(l.banner)}" alt="">` : ""}</label>
<label class="fl-banner">Tile image (square; sits in the row of game tiles on the sell page while the list is on - without one the banner is used)<span class="fl-bannerrow"><input class="text" data-f="tile" value="${esc(l.tile || "")}" placeholder="https://cdn.shopify.com/..."></span>${l.tile ? `<img class="fl-bannerpv fl-tilepv" src="${esc(l.tile)}" alt="">` : ""}</label>
<label class="fl-banner">Explainer image (wide; heads the open list in place of the banner, so it can say what the list is)<span class="fl-bannerrow"><input class="text" data-f="info" value="${esc(l.info || "")}" placeholder="https://cdn.shopify.com/..."></span>${l.info ? `<img class="fl-bannerpv" src="${esc(l.info)}" alt="">` : ""}</label></div>
<p class="muted" style="margin:4px 0 0">Per item and condition: <b>cash</b> and <b>credit</b> = what you pay; <b>sell</b> = your selling price, shown to the seller; <b>first</b> = how many you take at that cash/credit price; <b>then cash</b> / <b>then credit</b> = the lower pair you pay for every one after that (leave both blank to stop buying once "first" is reached); <b>max</b> = the most you buy in all, blank = no cap; <b>bought</b> = reserved by submitted lists so far. Example: cash 3, credit 4, first 10, then cash 1.50, then credit 2, max 50 = the first 10 at $3/$4, the next 40 at $1.50/$2, nothing past 50. Blank cash and credit = not buying that one. Counts run across every customer; a rejected list gives its units back.</p>
<div class="fl-cols"><span>Condition</span><span>Cash</span><span>Credit</span><span>Sell</span><span>First</span><span>Then cash</span><span>Then credit</span><span>Max</span><span>Bought</span></div>
<div class="fl-items">${(l.items || []).map((it) => item(l, it)).join("") || `<p class="muted">No items yet.</p>`}</div>
<div class="fl-add"><input class="text" data-add="name" placeholder="new item: name"><input class="text" data-add="image" placeholder="image URL" style="flex:1 1 260px"><button type="button" class="sm" data-act="add">Add item</button></div>
<div class="fl-shop"><b>Products on Shopify:</b> ${withProducts} of ${live} item${live === 1 ? "" : "s"} ${withProducts === 1 ? "has" : "have"} one${withProducts ? " (" + activeCount + " live)" : ""}. <span class="muted">Approving a sent list adds its quantities to stock and makes the products live; saving here keeps the sell prices in step.</span>
${withProducts < live ? `<form method="post" action="${BASE}/lists/control" style="display:inline" onsubmit="return confirm('Make ${live - withProducts} product${live - withProducts === 1 ? "" : "s"} on Shopify now? Draft, 0 in stock, at the sell prices (or the store placeholder where blank), with the pictures.')">${hid}<input type="hidden" name="action" value="products"><button type="submit" class="sm">Make the ${live - withProducts === live ? "" : "missing "}product${live - withProducts === 1 ? "" : "s"} on Shopify</button></form>` : ""}</div>
<div class="act"><button type="button" class="save" data-act="save">Save changes</button><span class="muted" data-msg></span></div>
</div>`;
  };
  const body = `<h1>Fixed-price lists</h1>
<p class="muted">Buylists the store prices itself, apart from the card buylist: a toy promotion, sealed product, anything with a photo and a price per condition. A list that is <b>on</b> shows as a strip on the <a href="${SELL_PAGE}" target="_blank" rel="noopener">sell page</a>; <b>off</b> is invisible (the page, the strip and submissions all go away; what you typed stays for next time). A sent list lands on 9Pocket like any other, with its lines marked fixed; approving one sends nothing to BinderPOS.</p>
${o.err ? `<div class="err">${esc(o.err)}</div>` : ""}${o.msg ? `<div class="okmsg">${esc(o.msg)}</div>` : ""}
${lists.map(card).join("")}
<div class="card"><h3>New list</h3>
${hasSeed ? "" : `<form method="post" action="${BASE}/lists/control" class="act"><input type="hidden" name="__form" value="1"><input type="hidden" name="action" value="seed"><button type="submit" class="ok">Create the McDonald's Pokémon list (15 toys with pictures, prices blank, off)</button></form>`}
<p class="muted" style="margin:8px 0 4px">Or a list with your own title. Tick the box to start it with the 15 McDonald's toys; untick it for an empty list you fill in yourself.</p>
<form method="post" action="${BASE}/lists/control" class="act"><input type="hidden" name="__form" value="1"><input type="hidden" name="action" value="create"><input class="text" name="title" placeholder="title, e.g. 2026 McDonald's Pokémon Toys" required><label class="chk"><input type="checkbox" name="withToys" value="1" checked> with the 15 McDonald's toys</label><button type="submit">Create (off)</button></form></div>
<script>
(function(){var CTL=${JSON.stringify(BASE + "/lists/control")};
function collect(card){var list={title:card.querySelector('[data-f="title"]').value,blurb:card.querySelector('[data-f="blurb"]').value,emails:card.querySelector('[data-f="emails"]').value,banner:card.querySelector('[data-f="banner"]').value,tile:card.querySelector('[data-f="tile"]').value,info:card.querySelector('[data-f="info"]').value,items:[]};
card.querySelectorAll('.fl-item').forEach(function(el){var it={key:el.getAttribute('data-item'),name:el.querySelector('[data-f="name"]').value,image:el.querySelector('[data-f="image"]').value,retired:el.querySelector('[data-f="retired"]').checked,offers:{}};
el.querySelectorAll('.fl-row').forEach(function(r){var o={};r.querySelectorAll('input[data-k]').forEach(function(i){o[i.getAttribute('data-f')]=i.value;});it.offers[r.getAttribute('data-cond')]=o;});list.items.push(it);});return list;}
function post(body,cb){fetch(CTL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(cb,function(e){cb({ok:false,error:String(e)});});}
document.querySelectorAll('.fl-list').forEach(function(card){var id=card.getAttribute('data-id'),msg=card.querySelector('[data-msg]');
card.querySelector('[data-act="save"]').addEventListener('click',function(){var b=this;b.disabled=true;msg.textContent='Saving…';post({action:'save',id:id,list:collect(card)},function(j){b.disabled=false;if(!j.ok){msg.textContent=j.error||'failed';return;}location.href=location.pathname+'?msg='+encodeURIComponent(j.message);});});
card.querySelector('[data-act="add"]').addEventListener('click',function(){var n=card.querySelector('[data-add="name"]'),im=card.querySelector('[data-add="image"]');if(!n.value.trim()){n.focus();return;}
var list=collect(card);list.items.push({key:'',name:n.value.trim(),image:im.value.trim(),retired:false,offers:{}});msg.textContent='Adding…';post({action:'save',id:id,list:list},function(j){if(!j.ok){msg.textContent=j.error||'failed';return;}location.href=location.pathname+'?msg='+encodeURIComponent('Added '+n.value.trim()+'.');});});
card.addEventListener('input',function(){card.classList.add('is-dirty');msg.textContent='unsaved changes';});
var lg=card.querySelector('[data-act="logo"]');if(lg)lg.addEventListener('click',function(){card.querySelector('[data-f="banner"]').value=${JSON.stringify(MCD_LOGO)};card.querySelector('[data-f="tile"]').value=${JSON.stringify(MCD_TILE)};card.querySelector('[data-f="info"]').value=${JSON.stringify(MCD_INFO)};card.classList.add('is-dirty');msg.textContent='Logo, tile and explainer chosen - press Save changes.';});
card.querySelectorAll('[data-act="copyall"]').forEach(function(b){b.addEventListener('click',function(){var src=b.closest('.fl-item'),items=card.querySelectorAll('.fl-item'),n=0;if(items.length<2)return;
if(!confirm('Give every toy on this list the same prices and limits as '+(src.querySelector('[data-f="name"]').value||'this one')+'? Bought stays as it is. You still press Save changes after.'))return;
items.forEach(function(el){if(el===src)return;n++;el.querySelectorAll('.fl-row').forEach(function(r){var from=src.querySelector('.fl-row[data-cond="'+r.getAttribute('data-cond')+'"]');if(!from)return;r.querySelectorAll('input[data-k]').forEach(function(i){var f=i.getAttribute('data-f');if(f==='bought')return;var s=from.querySelector('input[data-k][data-f="'+f+'"]');if(s)i.value=s.value;});});});
card.classList.add('is-dirty');msg.textContent='Copied to '+n+' toys - press Save changes.';});});});
window.addEventListener('beforeunload',function(e){if(document.querySelector('.fl-list.is-dirty')&&!document.body.getAttribute('data-leaving')){e.preventDefault();e.returnValue='';}});
document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(){document.body.setAttribute('data-leaving','1');});});
})();
</script>`;
  return shell("Fixed-price lists", `<style>${CSS}</style>` + body, o, true);
}
