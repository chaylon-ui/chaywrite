/* ---------------- 9Pocket -> BinderPOS: carrying the worksheet's prices over
   Owner, 2026-09-22 (BinderPOS showing $5.28 where 9P-1004 was approved at a
   staff price of $2.00): "9pocket, when sending to BinderPOS is not saving
   the edited prices, is this even possible?"

   The customer-side submit is priced by BinderPOS from its own rules, so
   the prices sent with it are ignored. BinderPOS's staff portal, though,
   edits a pending buylist through POST /api/buylist/save with the buylist
   details object whose shopifyCustomerBuylistDetails[] carry the edited
   cashBuyPrice / storeCreditBuyPrice / quantity per line (its bundle,
   probe 35740293851: `{...details, shopifyCustomerBuylistDetails: lines}`
   with `cards` deleted). planBuylistPrices() builds exactly that from the
   details BinderPOS returns and the 9Pocket worksheet, and says which lines
   matched and which did not. Nothing here writes: the dry run prints the
   plan; the save itself comes in a later step, after the owner has seen
   one plan for a real buylist. */

import { portalGet, portalPost } from "./portal.js";

const str = (v) => (v == null ? "" : String(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (n) => Math.round(n * 100) / 100;
// "Normal", "Non foil", "" and null are the same plain finish; anything else
// (Foil, Reverse Holo, 1st Edition ...) has to match by name.
export const finishKey = (t) => { const s = str(t).trim().toLowerCase(); return !s || s === "normal" || s === "non foil" || s === "non-foil" ? "" : s; };

// The BinderPOS line for a worksheet card: same card id, same condition (by
// variant id, else by its name) and same finish.
export function matchLine(theirs, card) {
  const cid = str(card.cardId);
  const cond = str(card.condition), condName = str(card.conditionName).trim().toLowerCase();
  const fin = finishKey(card.type);
  return theirs.find((l) => str(l.cardId) === cid && finishKey(l.type) === fin && (str(l.variantId) === cond && cond !== "" || str(l.variantName).trim().toLowerCase() === condName && condName !== "")) || null;
}

export function planBuylistPrices(details, cards, paymentType) {
  const theirs = Array.isArray(details && details.shopifyCustomerBuylistDetails) ? details.shopifyCustomerBuylistDetails : [];
  const used = new Set();
  const lines = [];
  const unmatchedOurs = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    const l = matchLine(theirs.filter((x) => !used.has(x)), c);
    if (!l) { unmatchedOurs.push({ cardId: str(c.cardId), name: str(c.cardName), set: str(c.setName), condition: str(c.conditionName || c.condition), finish: str(c.type) }); continue; }
    used.add(l);
    const ourCash = num(c.cashBuyPrice), ourCredit = num(c.storeCreditBuyPrice), ourQty = Math.max(0, parseInt(c.quantity, 10) || 0);
    const bpCash = num(l.cashBuyPrice), bpCredit = num(l.storeCreditBuyPrice), bpQty = num(l.quantity);
    const change = (ourCash != null && bpCash !== ourCash) || (ourCredit != null && bpCredit !== ourCredit) || (bpQty !== ourQty);
    lines.push({ id: str(l.id), name: str(l.cardName), set: str(l.setName), condition: str(l.variantName), finish: str(l.type), variantId: str(l.variantId),
      bpQty, bpCash, bpCredit, ourQty, ourCash, ourCredit, staffPriced: !!c.staffPriced, change });
  }
  const unmatchedTheirs = theirs.filter((l) => !used.has(l)).map((l) => ({ id: str(l.id), name: str(l.cardName), set: str(l.setName), condition: str(l.variantName), finish: str(l.type), qty: num(l.quantity), cash: num(l.cashBuyPrice), credit: num(l.storeCreditBuyPrice) }));
  // The payload the portal would send: their object, lines replaced, cards dropped.
  const credit = paymentType === "Store Credit";
  const byId = new Map(lines.map((x) => [x.id, x]));
  const newLines = theirs.map((l) => {
    const m = byId.get(str(l.id));
    if (!m) return { ...l };
    const out = { ...l, quantity: m.ourQty };
    if (m.ourCash != null) out.cashBuyPrice = m.ourCash;
    if (m.ourCredit != null) out.storeCreditBuyPrice = m.ourCredit;
    const each = credit ? out.storeCreditBuyPrice : out.cashBuyPrice;
    if (num(each) != null && l.totalPrice != null) out.totalPrice = r2(num(each) * m.ourQty);
    return out;
  });
  const payload = { ...(details || {}), shopifyCustomerBuylistDetails: newLines };
  delete payload.cards;
  return { matched: lines.length, changes: lines.filter((x) => x.change).length, lines, unmatchedOurs, unmatchedTheirs, payload };
}

// What the details carry that a log must not: the customer. The plan's
// printed copy replaces them with their presence.
export function redactDetails(d) {
  if (!d || typeof d !== "object") return d;
  const out = { ...d };
  for (const k of Object.keys(out)) {
    if (/customer|email|phone|firstName|lastName|address|notes/i.test(k) && k !== "shopifyCustomerBuylistDetails" && k !== "shopifyCustomerBuylistId") out[k] = out[k] == null ? null : "<present>";
  }
  return out;
}

// The dry run for one 9Pocket record already sent to BinderPOS.
export async function dryRunPlan(env, rec) {
  const bpId = rec && rec.bp && rec.bp.number ? String(rec.bp.number) : "";
  if (!bpId) return { ok: false, error: "this buylist has no BinderPOS number yet (approve it first)" };
  let details;
  try { details = await portalGet(env, "/api/buylist/byId/" + encodeURIComponent(bpId) + "/details"); }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
  const plan = planBuylistPrices(details, rec.cards, rec.paymentType);
  return { ok: true, dryRun: true, bpId, number: rec.number, paymentType: rec.paymentType, detailKeys: Object.keys(details || {}), theirLines: (details && details.shopifyCustomerBuylistDetails || []).length,
    finalLines: (details && details.finalBuylistDetails || []).length, approved: details && details.approved, completed: details && details.completed,
    ...plan, payload: redactDetails(plan.payload) };
}

// The real thing: read, plan, POST /api/buylist/save with the plan's payload,
// read again and check every changed line now carries the worksheet's
// prices. Only for a buylist that is still pending in BinderPOS. Returns what
// the record keeps; never throws.
export async function pushBuylistPrices(env, rec, opts) {
  const o = opts || {};
  const bpId = rec && rec.bp && rec.bp.number ? String(rec.bp.number) : "";
  if (!bpId) return { ok: false, error: "this buylist has no BinderPOS number yet" };
  if (o.confirm != null && String(o.confirm) !== bpId) return { ok: false, error: "confirm must be the BinderPOS number " + bpId };
  let details;
  try { details = await portalGet(env, "/api/buylist/byId/" + encodeURIComponent(bpId) + "/details"); }
  catch (e) { return { ok: false, error: "read failed: " + String((e && e.message) || e).slice(0, 200) }; }
  if (details && (details.approved || details.completed)) return { ok: false, error: "BinderPOS already has this buylist " + (details.completed ? "completed" : "approved") + "; prices can only be saved while it is pending", bpId };
  const plan = planBuylistPrices(details, rec.cards, rec.paymentType);
  const summary = { bpId, matched: plan.matched, changes: plan.changes, unmatchedOurs: plan.unmatchedOurs.length, unmatchedTheirs: plan.unmatchedTheirs.length };
  if (!plan.changes) return { ok: true, saved: false, ...summary, message: "BinderPOS already has these prices; nothing to save" };
  let reply;
  try { reply = await portalPost(env, "/api/buylist/save", plan.payload); }
  catch (e) { return { ok: false, error: "save failed: " + String((e && e.message) || e).slice(0, 200), ...summary }; }
  // Verify: read it back and compare the lines that were meant to change.
  let after;
  try { after = await portalGet(env, "/api/buylist/byId/" + encodeURIComponent(bpId) + "/details"); }
  catch (e) { return { ok: true, saved: true, verified: false, error: "saved, but the re-read failed: " + String((e && e.message) || e).slice(0, 200), ...summary }; }
  const theirs = Array.isArray(after && after.shopifyCustomerBuylistDetails) ? after.shopifyCustomerBuylistDetails : [];
  const checks = plan.lines.filter((l) => l.change).map((l) => {
    const now = theirs.find((x) => str(x.id) === l.id) || null;
    const cash = now ? num(now.cashBuyPrice) : null, credit = now ? num(now.storeCreditBuyPrice) : null, qty = now ? num(now.quantity) : null;
    const good = !!now && (l.ourCash == null || cash === l.ourCash) && (l.ourCredit == null || credit === l.ourCredit) && qty === l.ourQty;
    return { id: l.id, name: l.name, condition: l.condition, finish: l.finish, wanted: { qty: l.ourQty, cash: l.ourCash, credit: l.ourCredit }, now: now ? { qty, cash, credit } : null, good };
  });
  const verified = checks.every((c) => c.good);
  return { ok: true, saved: true, verified, checks, reply: typeof reply === "object" && reply ? Object.keys(reply).slice(0, 12) : String(reply).slice(0, 80), ...summary,
    message: verified ? "Saved: BinderPOS now shows the worksheet prices on " + checks.length + " line" + (checks.length === 1 ? "" : "s") + "." : "Saved, but the re-read does not show every price - see checks." };
}
