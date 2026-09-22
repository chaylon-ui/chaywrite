/* ---------------- Hold on arrival, stage 2: LIVE (behind a switch) ----------------
   Owner, 2026-09-22: "create this but it is off and I can turn it on and
   off like a switch to try it for a couple carts/buylists".

   OFF until an admin turns it on at /9pocket/held. While on, every two
   minutes the hold DO reads BinderPOS's portal for what just arrived:
     - POS carts that bought something (submitted since the last look;
       a buy line carries the Shopify variant id and the quantity)
     - buylists BinderPOS marked completed (their finalised lines, matched
       to a Shopify product by "Name [Set]" + condition + finish)
   and moves that many units of each card from Shopify's "available" into
   "quality_control" (inventoryMoveQuantities), so the website cannot sell
   them until the card room releases them. Stock is fungible, so the move
   is made at once for what is already available and the rest waits for
   BinderPOS's push (the inventory webhook, or the next look) for up to
   45 minutes; whatever never arrives is written down as not held.

   A trial count ("hold the next N arrivals, then switch off") lets the
   owner try it on a couple of carts. Turning it off never releases
   anything by itself; holds already started still finish. Release,
   Release all and Damaged are staff buttons (permission "release" or an
   admin); Damaged moves the copies to Shopify's "damaged" state instead
   of the shelf. Every move carries a gid://exor-9pocket/... reference so
   Shopify's inventory history names the source.

   Storage (in the hold DO, beside stage 1's keys):
     hold:live          the switch and cursors {on, trial, since, by, lastPoll,
                        cartsFrom, buylistsFrom, seenCarts[], seenBuylists[]}
     hl:<ts>-<key>      one record per arrival (cart:<id> / buylist:<id>),
                        with its lines and what happened to each
     hlog:<ts>-<n>      what staff and the hold did (30 days)
   Nothing here runs while hold:live.on is false, except finishing a hold
   that had already started and the staff buttons. */

const KEEP_MS = 30 * 86400e3;
export const POLL_MS = 120e3;
export const RETRY_FOR_MS = 45 * 60e3;
export const LOOKBACK_MS = 6 * 3600e3;
export const REF_APP = "exor-9pocket";
const SEEN_MAX = 400;

const str = (v) => (v == null ? "" : String(v));
const digits = (v) => str(v).replace(/\D/g, "").slice(0, 24);
const tsKey = (ms) => String(Math.max(0, Math.floor(ms))).padStart(14, "0");
const norm = (s) => str(s).toLowerCase().replace(/\s+/g, " ").trim();
const max0 = (n) => Math.max(0, Math.floor(Number(n) || 0));
const errText = (e) => str((e && e.message) || e).slice(0, 200);

/* ---------------- pure helpers (test/hold-live.test.mjs) ---------------- */

export function defaultSettings() {
  return { on: false, trial: null, since: 0, by: "", lastPoll: 0, cartsFrom: 0, buylistsFrom: 0, seenCarts: [], seenBuylists: [], lastError: "" };
}

// How many copies to hold now and how many to wait for. Never more than
// wanted, never more than is available.
export function planHold(wanted, available) {
  const w = max0(wanted), a = max0(available);
  const now = Math.min(w, a);
  return { now, remaining: w - now };
}

// The product title BinderPOS gives a card in Shopify.
export function productTitle(name, set) {
  const n = str(name).trim(), s = str(set).trim();
  return s ? n + " [" + s + "]" : n;
}

// Does a Shopify variant ("Near Mint Foil") fit a buylist line's condition
// and finish? Condition first, then foil or not.
export function variantMatches(variantTitle, condition, finish) {
  const vt = norm(variantTitle), c = norm(condition);
  if (c && vt.indexOf(c) !== 0) return false;
  const foilWanted = /foil/i.test(str(finish)) && !/non/i.test(str(finish));
  return /foil/.test(vt) === foilWanted;
}

// A trimmed portal cart (src/portal.js trimCart) as an arrival.
export function arrivalFromCart(c) {
  const lines = (c.lines || []).filter((l) => l && l.buying && l.qty > 0).map((l) => ({
    title: str(l.title), condition: str(l.condition), finish: /foil/i.test(str(l.condition)) && !/non/i.test(str(l.condition)) ? "Foil" : "",
    variantId: digits(l.variantId), qty: max0(l.qty), image: str(l.image), paid: l.paid,
  }));
  return {
    key: "cart:" + str(c.id), kind: "cart", ref: str(c.id), ts: Date.parse(c.submitted || "") || Date.now(),
    who: str(c.staff), till: str(c.till), customer: (c.customer && c.customer.name) || "", link: str(c.portalUrl),
    paid: c.payout ? { cash: c.payout.cash || 0, credit: c.payout.credit || 0, total: c.payout.total || 0 } : null,
    lines,
  };
}

// A completed buylist (portal row + its lines) as an arrival.
export function arrivalFromBuylist(row, d) {
  const lines = (d.lines || []).filter((l) => l && l.qty > 0).map((l) => ({
    title: productTitle(l.name, l.set), condition: str(l.condition), finish: str(l.finish), variantId: "",
    qty: max0(l.qty), image: str(l.image), paid: null,
  }));
  const credit = /credit/i.test(str(d.paymentType || row.paymentType));
  const total = (d.lines || []).reduce((s, l) => s + (credit ? (l.credit || 0) : (l.cash || 0)) * (l.qty || 0), 0);
  return {
    key: "buylist:" + str(row.id), kind: "buylist", ref: str(row.id), ts: Date.parse(d.completed || row.completed || "") || Date.now(),
    who: "", till: "", customer: d.customer || (row.customer && (row.customer.name || row.customer.email)) || "", link: str(row.portalUrl),
    paid: { cash: credit ? 0 : total, credit: credit ? total : 0, total, type: credit ? "Store Credit" : "Cash" },
    lines,
  };
}

const heldLeft = (l) => Math.max(0, (l.held || 0) - (l.released || 0) - (l.damaged || 0));
export function summarize(rec) {
  const lines = rec.lines || [];
  const open = lines.some((l) => heldLeft(l) > 0 || (l.remaining || 0) > 0 && l.status === "waiting");
  rec.held = lines.reduce((s, l) => s + heldLeft(l), 0);
  rec.status = open ? (lines.some((l) => l.status === "waiting") ? "waiting" : "held") : "done";
  return rec;
}

/* ---------------- Shopify ---------------- */

const MOVE_Q = `mutation($input:InventoryMoveQuantitiesInput!){inventoryMoveQuantities(input:$input){userErrors{field message code} inventoryAdjustmentGroup{createdAt reason}}}`;
const VARIANT_Q = `query($id:ID!){productVariant(id:$id){id title sku product{id title productType handle} inventoryItem{id inventoryLevels(first:1){nodes{location{id} quantities(names:["available","quality_control","damaged"]){name quantity}}}}}}`;
const FIND_Q = `query($q:String!){products(first:3,query:$q){nodes{id title productType handle variants(first:20){nodes{id title sku inventoryItem{id inventoryLevels(first:1){nodes{location{id} quantities(names:["available","quality_control"]){name quantity}}}}}}}}}`;
const LEVEL_Q = `query($id:ID!,$loc:ID!){inventoryItem(id:$id){inventoryLevel(locationId:$loc){quantities(names:["available","quality_control","damaged"]){name quantity}}}}`;

function levelOf(node) {
  const lvl = node && node.inventoryItem && node.inventoryItem.inventoryLevels && node.inventoryItem.inventoryLevels.nodes && node.inventoryItem.inventoryLevels.nodes[0];
  if (!lvl || !lvl.location) return null;
  const q = {};
  for (const x of lvl.quantities || []) q[x.name] = x.quantity;
  return { loc: lvl.location.id, available: q.available || 0, qc: q.quality_control || 0, damaged: q.damaged || 0 };
}
function shape(v, product, lvl) {
  return {
    variantId: digits(v.id), variant: v.id, item: v.inventoryItem.id, loc: lvl.loc,
    title: str(product && product.title) || str(v.product && v.product.title), variantTitle: str(v.title), sku: str(v.sku),
    type: str((product || v.product || {}).productType), handle: str((product || v.product || {}).handle),
    available: lvl.available, qc: lvl.qc,
  };
}

async function resolveByVariant(cx, variantId) {
  const j = await cx.adminGql(VARIANT_Q, { id: "gid://shopify/ProductVariant/" + digits(variantId) });
  const v = j && j.productVariant;
  if (!v || !v.inventoryItem) return null;
  const lvl = levelOf(v);
  return lvl ? shape(v, v.product, lvl) : null;
}

async function resolveByTitle(cx, title, condition, finish) {
  const want = norm(title);
  if (!want) return null;
  const j = await cx.adminGql(FIND_Q, { q: 'title:"' + title.replace(/["\\]/g, " ") + '"' });
  const products = (j && j.products && j.products.nodes) || [];
  const product = products.find((p) => norm(p.title) === want) || null;
  if (!product) return null;
  const v = (product.variants && product.variants.nodes || []).find((x) => variantMatches(x.title, condition, finish));
  if (!v || !v.inventoryItem) return null;
  const lvl = levelOf(v);
  return lvl ? shape(v, product, lvl) : null;
}

async function readLevel(cx, line) {
  const j = await cx.adminGql(LEVEL_Q, { id: line.item, loc: line.loc });
  const lvl = j && j.inventoryItem && j.inventoryItem.inventoryLevel;
  if (!lvl) return null;
  const q = {};
  for (const x of lvl.quantities || []) q[x.name] = x.quantity;
  return { available: q.available || 0, qc: q.quality_control || 0, damaged: q.damaged || 0 };
}

// One move of n units between two states of one card at its location.
async function move(cx, line, n, from, to, reason, ref) {
  const ledger = "gid://" + REF_APP + "/Hold/" + ref;
  const term = (name) => ({ locationId: line.loc, name, ...(name !== "available" ? { ledgerDocumentUri: ledger } : {}) });
  const input = { reason, referenceDocumentUri: "gid://" + REF_APP + "/Arrival/" + ref, changes: [{ inventoryItemId: line.item, quantity: n, from: term(from), to: term(to) }] };
  const j = await cx.adminGql(MOVE_Q, { input });
  const r = j && j.inventoryMoveQuantities;
  if (!r) return { ok: false, error: "Shopify did not answer the move" };
  const errs = r.userErrors || [];
  if (errs.length) return { ok: false, error: errs.map((e) => e.message).join("; ").slice(0, 200) };
  return { ok: true };
}

/* ---------------- the records ---------------- */

export async function settingsOf(cx) {
  return { ...defaultSettings(), ...((await cx.storage.get("hold:live")) || {}) };
}
async function saveSettings(cx, s) {
  s.seenCarts = (s.seenCarts || []).slice(-SEEN_MAX);
  s.seenBuylists = (s.seenBuylists || []).slice(-SEEN_MAX);
  await cx.storage.put("hold:live", s);
  cx.mem.liveSettings = null;
}

async function log(cx, by, action, text, extra) {
  const ts = cx.now();
  cx.mem.logN = ((cx.mem.logN || 0) + 1) % 1000;
  await cx.storage.put("hlog:" + tsKey(ts) + "-" + String(cx.mem.logN).padStart(3, "0"), { ts, by: str(by), action, text: str(text).slice(0, 300), ...(extra || {}) });
}

async function openRecords(cx) {
  const l = await cx.storage.list({ prefix: "hl:", start: "hl:" + tsKey(cx.now() - KEEP_MS), limit: 500 });
  return [...l.entries()].map(([k, v]) => ({ k, v })).filter((x) => x.v);
}

// Hold what can be held now for one line; the rest waits.
async function holdLine(cx, rec, line, available) {
  const want = line.remaining != null ? line.remaining : line.qty;
  const plan = planHold(want, available);
  if (plan.now > 0) {
    const r = await move(cx, line, plan.now, "available", "quality_control", "quality_control", rec.key);
    if (!r.ok) { line.status = "error"; line.note = r.error; line.remaining = want; return; }
    line.held = (line.held || 0) + plan.now;
  }
  line.remaining = plan.remaining;
  line.status = plan.remaining > 0 ? "waiting" : "held";
  if (plan.remaining > 0) line.note = "waiting for " + plan.remaining + " more to arrive";
  else line.note = "";
}

async function ingest(cx, s, arr) {
  const rec = {
    key: arr.key, kind: arr.kind, ref: arr.ref, ts: arr.ts, at: cx.now(), who: arr.who, till: arr.till, customer: arr.customer, link: arr.link, paid: arr.paid,
    lines: [], status: "held", held: 0,
  };
  for (const ln of arr.lines.slice(0, 120)) {
    const line = { title: ln.title, condition: ln.condition, finish: ln.finish, qty: ln.qty, image: ln.image, held: 0, released: 0, damaged: 0, remaining: ln.qty, status: "", note: "" };
    let hit = null;
    try {
      if (ln.variantId) hit = await resolveByVariant(cx, ln.variantId);
      if (!hit && ln.title) hit = await resolveByTitle(cx, ln.title, ln.condition, ln.finish);
    } catch (e) { line.status = "error"; line.note = "lookup failed: " + errText(e); rec.lines.push(line); continue; }
    if (!hit) { line.status = "no-product"; line.note = ln.variantId ? "no Shopify variant " + ln.variantId : "no Shopify product named " + ln.title + (ln.condition ? " in " + ln.condition : ""); line.remaining = 0; rec.lines.push(line); continue; }
    Object.assign(line, { variantId: hit.variantId, item: hit.item, loc: hit.loc, title: hit.title || line.title, variantTitle: hit.variantTitle, sku: hit.sku, type: hit.type, handle: hit.handle });
    await holdLine(cx, rec, line, hit.available);
    rec.lines.push(line);
  }
  summarize(rec);
  const k = "hl:" + tsKey(rec.ts) + "-" + rec.key;
  await cx.storage.put(k, rec);
  const heldN = rec.lines.reduce((a, l) => a + (l.held || 0), 0), waitN = rec.lines.filter((l) => l.status === "waiting").length, noN = rec.lines.filter((l) => l.status === "no-product" || l.status === "error").length;
  await log(cx, "hold", "arrival", (rec.kind === "cart" ? "POS cart " : "buylist ") + rec.ref + ": held " + heldN + (waitN ? ", " + waitN + " line" + (waitN > 1 ? "s" : "") + " waiting" : "") + (noN ? ", " + noN + " could not be held" : ""), { key: k });
  return { k, rec };
}

// Lines still waiting for BinderPOS's push: try again, give up after 45 min.
async function retryWaiting(cx, onlyItem) {
  const now = cx.now();
  let changed = 0, stillWaiting = 0;
  for (const { k, v: rec } of await openRecords(cx)) {
    if (!(rec.lines || []).some((l) => l.status === "waiting")) continue;
    let dirty = false;
    for (const line of rec.lines) {
      if (line.status !== "waiting" || !line.item) continue;
      if (onlyItem && digits(line.item) !== digits(onlyItem)) continue;
      if (now - rec.ts > RETRY_FOR_MS) { line.status = line.held ? "short" : "never-arrived"; line.note = "only " + (line.held || 0) + " of " + line.qty + " arrived in 45 minutes"; dirty = true; continue; }
      let lvl = null;
      try { lvl = await readLevel(cx, line); } catch {}
      if (!lvl) { stillWaiting++; continue; }
      if (lvl.available <= 0) { stillWaiting++; continue; }
      await holdLine(cx, rec, line, lvl.available);
      dirty = true; changed++;
      if (line.status === "waiting") stillWaiting++;
    }
    if (dirty) { summarize(rec); await cx.storage.put(k, rec); }
  }
  return { changed, stillWaiting };
}

async function trialTick(cx, s) {
  if (s.trial == null) return true;
  s.trial = Math.max(0, (Number(s.trial) || 0) - 1);
  if (s.trial > 0) return true;
  s.on = false; s.trial = null;
  await log(cx, "hold", "trial-done", "trial finished: the hold switched itself off");
  return false;
}

// The look at BinderPOS: new buy carts and newly completed buylists.
export async function pollLive(cx) {
  const s = await settingsOf(cx);
  const now = cx.now();
  const out = { ok: true, on: s.on, carts: 0, buylists: 0, errors: [] };
  if (s.on && cx.portal) {
    try {
      const from = Math.max(s.cartsFrom || 0, now - LOOKBACK_MS) - 30 * 60e3;
      const carts = await cx.portal.buyCartsBetween(from, now);
      for (const c of carts.sort((a, b) => (Date.parse(a.submitted || "") || 0) - (Date.parse(b.submitted || "") || 0))) {
        if (!c || !c.id || s.seenCarts.includes(c.id)) continue;
        if ((Date.parse(c.submitted || "") || 0) < s.since) { s.seenCarts.push(c.id); continue; }   // before the switch
        await ingest(cx, s, arrivalFromCart(c));
        s.seenCarts.push(c.id); out.carts++;
        if (!(await trialTick(cx, s))) break;
      }
      s.cartsFrom = now;
    } catch (e) { out.errors.push("carts: " + errText(e)); }
  }
  if (s.on && cx.portal) {
    try {
      const rows = await cx.portal.completedBuylists(Math.max(s.buylistsFrom || 0, now - LOOKBACK_MS) - 30 * 60e3);
      for (const row of rows.slice().reverse()) {
        if (!row || !row.id || s.seenBuylists.includes(row.id)) continue;
        if ((Date.parse(row.completed || "") || 0) < s.since) { s.seenBuylists.push(row.id); continue; }
        const d = await cx.portal.buylistLines(row.id);
        await ingest(cx, s, arrivalFromBuylist(row, d));
        s.seenBuylists.push(row.id); out.buylists++;
        if (!(await trialTick(cx, s))) break;
      }
      s.buylistsFrom = now;
    } catch (e) { out.errors.push("buylists: " + errText(e)); }
  }
  try { const r = await retryWaiting(cx); out.retried = r.changed; out.waiting = r.stillWaiting; } catch (e) { out.errors.push("retry: " + errText(e)); }
  s.lastPoll = now; s.lastError = out.errors.join(" · ");
  await saveSettings(cx, s);
  out.on = s.on;
  return out;
}

// A stock rise seen by the inventory webhook: a waiting line for that item
// can be held now.
export async function liveOnRise(cx, item, available) {
  if (!(available > 0)) return { ok: true, skipped: true };
  if (!(await cx.storage.get("hold:live"))) return { ok: true, skipped: true };   // never switched on: nothing can be waiting
  const waiting = (await openRecords(cx)).some((x) => (x.v.lines || []).some((l) => l.status === "waiting" && digits(l.item) === digits(item)));
  if (!waiting) return { ok: true, skipped: true };
  return retryWaiting(cx, item);
}

/* ---------------- staff actions ---------------- */

async function release(cx, b) {
  const k = str(b.key);
  const rec = k ? await cx.storage.get(k) : null;
  if (!rec || !rec.lines) return { ok: false, error: "no such arrival" };
  const to = b.to === "damaged" ? "damaged" : "available";
  const idx = b.line == null || b.line === "" ? null : parseInt(b.line, 10);
  const targets = idx == null ? rec.lines.map((l, i) => i) : [idx];
  let moved = 0, errors = [];
  for (const i of targets) {
    const line = rec.lines[i];
    if (!line || !line.item) continue;
    const left = heldLeft(line);
    const n = idx == null ? left : Math.min(left, max0(b.n == null || b.n === "" ? left : b.n));
    if (n <= 0) continue;
    const r = await move(cx, line, n, "quality_control", to, to === "damaged" ? "damaged" : "quality_control", rec.key);
    if (!r.ok) { errors.push(line.title + ": " + r.error); continue; }
    if (to === "damaged") line.damaged = (line.damaged || 0) + n; else line.released = (line.released || 0) + n;
    moved += n;
    if (line.status === "waiting" && line.remaining > 0 && b.stopWaiting) { line.status = "short"; line.remaining = 0; }
  }
  summarize(rec);
  if (rec.status === "done" && !rec.doneAt) rec.doneAt = cx.now();
  await cx.storage.put(k, rec);
  if (moved) await log(cx, b.by, to === "damaged" ? "damaged" : "release", (idx == null ? "released all " + moved : (to === "damaged" ? "marked " : "released ") + moved + " × " + rec.lines[idx].title + " (" + rec.lines[idx].variantTitle + ")" + (to === "damaged" ? " damaged" : "")) + " from " + (rec.kind === "cart" ? "POS cart " : "buylist ") + rec.ref, { key: k });
  return { ok: errors.length === 0, moved, errors, status: rec.status, error: errors.join("; ") || undefined };
}

// The counter: a card name, a SKU or a barcode → the held lines that fit.
async function find(cx, q) {
  const want = norm(q);
  if (!want) return [];
  const out = [];
  for (const { k, v: rec } of await openRecords(cx)) {
    (rec.lines || []).forEach((l, i) => {
      if (heldLeft(l) <= 0) return;
      const hay = norm(l.title + " " + (l.variantTitle || ""));
      if (hay.includes(want) || (l.sku && norm(l.sku) === want) || (l.variantId && l.variantId === want)) out.push({ key: k, line: i, ref: rec.ref, kind: rec.kind, title: l.title, variantTitle: l.variantTitle, held: heldLeft(l), image: l.image, ts: rec.ts });
    });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 12);
}

async function setSwitch(cx, b) {
  const s = await settingsOf(cx);
  const now = cx.now();
  const on = b.on === true || b.on === "1" || b.on === "on" || b.on === "true";
  if (on) {
    const trial = max0(b.trial);
    s.on = true; s.trial = trial > 0 ? trial : null; s.since = now; s.by = str(b.by); s.cartsFrom = now; s.buylistsFrom = now; s.lastError = "";
    await log(cx, b.by, "on", trial > 0 ? "switched on for the next " + trial + " arrival" + (trial > 1 ? "s" : "") : "switched on");
  } else {
    s.on = false; s.trial = null;
    await log(cx, b.by, "off", "switched off (nothing was released)");
  }
  await saveSettings(cx, s);
  try { await cx.storage.setAlarm(now + 5e3); } catch {}
  return { ok: true, on: s.on, trial: s.trial };
}

/* ---------------- what the page and the health line read ---------------- */

export async function liveStatus(cx, q) {
  const s = await settingsOf(cx);
  const now = cx.now();
  const all = await openRecords(cx);
  const open = all.filter((x) => x.v.status !== "done").map((x) => ({ key: x.k, ...x.v })).sort((a, b) => b.ts - a.ts);
  const done = all.filter((x) => x.v.status === "done" && (x.v.doneAt || 0) >= now - 86400e3).map((x) => ({ key: x.k, ...x.v })).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const notHeld = [];
  for (const x of all) if (x.v.ts >= now - 7 * 86400e3) for (const l of x.v.lines || []) if (["no-product", "error", "short", "never-arrived"].includes(l.status)) notHeld.push({ key: x.k, ref: x.v.ref, kind: x.v.kind, ts: x.v.ts, title: l.title, condition: l.variantTitle || l.condition, qty: l.qty, held: l.held || 0, status: l.status, note: l.note });
  const logs = await cx.storage.list({ prefix: "hlog:", start: "hlog:" + tsKey(now - 7 * 86400e3), limit: 400 });
  const history = [...logs.entries()].filter((e) => e[1]).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map((e) => e[1]);   // newest first, in the order they were written
  const dayStart = now - 86400e3;
  const counts = {
    held: open.reduce((a, r) => a + (r.held || 0), 0),
    arrivals: open.length,
    old24: open.filter((r) => r.held > 0 && now - r.ts > 86400e3).length,
    old72: open.filter((r) => r.held > 0 && now - r.ts > 3 * 86400e3).length,
    releasedToday: history.filter((h) => h.action === "release" && h.ts >= dayStart).reduce((a, h) => a + (parseInt((h.text.match(/released (?:all )?(\d+)/) || [])[1], 10) || 0), 0),
    notHeld: notHeld.length,
  };
  const { seenCarts, seenBuylists, ...settings } = s;
  return { ok: true, settings, counts, open, done, notHeld: notHeld.sort((a, b) => b.ts - a.ts).slice(0, 60), history: history.slice(0, 60), matches: q ? await find(cx, q) : null, generatedAt: now };
}

export async function liveHealth(cx) {
  const s = await settingsOf(cx);
  const open = (await openRecords(cx)).filter((x) => x.v.status !== "done");
  return { on: s.on, trial: s.trial, lastPoll: s.lastPoll, lastError: s.lastError || "", open: open.length, held: open.reduce((a, x) => a + (x.v.held || 0), 0), oldest: open.length ? Math.min(...open.map((x) => x.v.ts)) : null };
}

// Any hold still finishing (waiting lines)? The alarm keeps polling for it.
export async function liveBusy(cx) {
  const s = await settingsOf(cx);
  if (s.on) return true;
  const open = await openRecords(cx);
  return open.some((x) => (x.v.lines || []).some((l) => l.status === "waiting"));
}

// The DO-side router for /_hold/live/*; null when the path is not ours.
export async function liveFetch(cx, url, body) {
  const p = url.pathname;
  if (p === "/_hold/live/status") return liveStatus(cx, url.searchParams.get("q") || "");
  if (p === "/_hold/live/set") return setSwitch(cx, body || {});
  if (p === "/_hold/live/release") return release(cx, body || {});
  if (p === "/_hold/live/poll") return pollLive(cx);
  if (p === "/_hold/live/find") return { ok: true, matches: await find(cx, str((body && body.q) || url.searchParams.get("q"))) };
  return null;
}
