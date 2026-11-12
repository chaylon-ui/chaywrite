/* ---------------- BinderPOS store credit from 9Pocket (owner, 2026-11-11/12) ----------------
   "Is it possible to apply the binderpos store credit upon approval" ...
   "Do small dry run on my account". The portal's own "Adjust store credit"
   window (bundle main.38a6000f, read 2026-11-11) posts
     POST /api/customers/adjustStoreCredit
       { customerId, amountToAdjust, typeOfAdjustment: "increase" | "decrease", publicNotes, privateNotes }
   and beside it: GET /api/customers?keyword=<text> (search), GET
   /api/customers/byId/<id>, GET /api/customers/byId/<id>/creditHistory?offset=&limit=.
   A customer is matched by email, exactly, never by name. creditDryRun adds a
   small amount with a note, reads the history, takes the amount back and
   reads the balance again. Every report here carries ids, amounts, notes and
   masked emails only: the runner that prints it logs to a public repo. */
import { portalGet, portalPost } from "./portal.js";

const str = (v) => (v == null ? "" : String(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const r2 = (n) => Math.round(n * 100) / 100;
const errText = (e) => str((e && e.message) || e).slice(0, 200);
export const CUSTOMERS = "/api/customers";
export const MAX_DRY_RUN = 1;   // dollars: a dry run never moves more than this
const DEPS = { get: portalGet, post: portalPost };

export const maskEmail = (e) => { const s = str(e).trim(); const at = s.indexOf("@"); return at > 0 ? s[0] + "***" + s.slice(at) : s ? "***" : ""; };
export const normEmail = (e) => str(e).trim().toLowerCase();

// The rows of a customers answer, whatever wrapper BinderPOS puts around them.
export function customerRows(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object") for (const k of ["customers", "results", "data", "items", "rows"]) if (Array.isArray(j[k])) return j[k];
  return [];
}
export function pickByEmail(rows, email) {
  const want = normEmail(email);
  if (!want) return null;
  return (rows || []).find((c) => c && normEmail(c.email) === want) || null;
}
const custView = (c) => ({ id: str(c.id), email: maskEmail(c.email), storeCredit: num(c.storeCredit), keys: Object.keys(c).slice(0, 24) });

export async function findCustomer(env, email, deps) {
  const d = deps || DEPS;
  const want = normEmail(email);
  if (!want) return { ok: false, error: "no email to search by" };
  let j;
  try { j = await d.get(env, CUSTOMERS + "?keyword=" + encodeURIComponent(want)); } catch (e) { return { ok: false, error: "customer search: " + errText(e) }; }
  const rows = customerRows(j);
  const hit = pickByEmail(rows, want);
  if (!hit) return { ok: false, error: "no BinderPOS customer with that email (" + rows.length + " search row" + (rows.length === 1 ? "" : "s") + ")", rows: rows.length };
  return { ok: true, customer: custView(hit), rows: rows.length };
}
export async function readCustomer(env, id, deps) {
  const d = deps || DEPS;
  const j = await d.get(env, CUSTOMERS + "/byId/" + encodeURIComponent(str(id)));
  const c = j && j.customer && typeof j.customer === "object" ? j.customer : j;
  return custView(c || {});
}
export async function creditHistory(env, id, limit, deps) {
  const d = deps || DEPS;
  const j = await d.get(env, CUSTOMERS + "/byId/" + encodeURIComponent(str(id)) + "/creditHistory?offset=0&limit=" + (limit || 5));
  const rows = customerRows(j);
  // A history row as BinderPOS sends it (dry run 2026-11-12): amountChanged (signed), amountBeforeChange, amountAfterChange, updatedDate, actionedBy, publicNotes, privateNotes, actionNotes, invoiceNumber, cart, shopifyCustomerBuylist.
  return rows.map((h) => ({ amount: num(h.amountChanged != null ? h.amountChanged : h.amount), before: num(h.amountBeforeChange), after: num(h.amountAfterChange), publicNotes: str(h.publicNotes).slice(0, 120), at: str(h.updatedDate || h.dateCreated || ""), by: str(h.actionedBy).slice(0, 80), keys: Object.keys(h).slice(0, 16) }));
}
// The adjustment itself. type is "increase" or "decrease"; amount is positive dollars.
export async function adjustCredit(env, a, deps) {
  const d = deps || DEPS;
  const amount = r2(Number(a && a.amount));
  const type = a && a.type === "decrease" ? "decrease" : "increase";
  if (!(amount > 0)) return { ok: false, error: "amount must be more than zero" };
  if (!str(a.customerId)) return { ok: false, error: "no BinderPOS customer id" };
  const payload = { customerId: Number(a.customerId) || str(a.customerId), amountToAdjust: amount, typeOfAdjustment: type, publicNotes: str(a.publicNotes).slice(0, 300), privateNotes: str(a.privateNotes).slice(0, 300) };
  try {
    const j = await d.post(env, CUSTOMERS + "/adjustStoreCredit", payload);
    return { ok: true, type, amount, reply: j && typeof j === "object" ? { keys: Object.keys(j).slice(0, 16), storeCredit: num(j.storeCredit != null ? j.storeCredit : j.customer && j.customer.storeCredit) } : { text: str(j).slice(0, 120) } };
  } catch (e) { return { ok: false, type, amount, error: errText(e) }; }
}

/* The dry run: a few cents on, a look at the history, the same cents off.
   Never more than MAX_DRY_RUN. Stops at the first failure and says where. */
export async function creditDryRun(env, o, deps) {
  const amount = r2(Math.min(MAX_DRY_RUN, Math.max(0.01, Number((o && o.amount) || 0.05))));
  const by = str(o && o.by).slice(0, 120);
  const out = { ok: false, amount, steps: [] };
  const step = (name, r) => { out.steps.push({ step: name, ...r }); return r; };
  const found = step("find", await findCustomer(env, o && o.email, deps));
  if (!found.ok) { out.error = found.error; return out; }
  const id = found.customer.id;
  try { step("before", { ok: true, balance: (await readCustomer(env, id, deps)).storeCredit }); } catch (e) { step("before", { ok: false, error: errText(e) }); }
  const note = "9Pocket dry run " + new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
  const up = step("increase", await adjustCredit(env, { customerId: id, amount, type: "increase", publicNotes: note + " (test, reversed right after)", privateNotes: "by " + by }, deps));
  if (!up.ok) { out.error = "increase failed: " + up.error; return out; }
  try { step("history", { ok: true, rows: await creditHistory(env, id, 3, deps) }); } catch (e) { step("history", { ok: false, error: errText(e) }); }
  const down = step("decrease", await adjustCredit(env, { customerId: id, amount, type: "decrease", publicNotes: note + " reversed", privateNotes: "by " + by }, deps));
  if (!down.ok) { out.error = "the increase went through but the decrease failed: " + down.error + " - take $" + amount.toFixed(2) + " off by hand"; return out; }
  try { step("after", { ok: true, balance: (await readCustomer(env, id, deps)).storeCredit }); } catch (e) { step("after", { ok: false, error: errText(e) }); }
  const b0 = out.steps.find((s) => s.step === "before"), b1 = out.steps.find((s) => s.step === "after");
  out.ok = true;
  out.customer = found.customer.id;
  out.balanceBefore = b0 && b0.balance; out.balanceAfter = b1 && b1.balance;
  out.unchanged = b0 && b1 && b0.balance != null && b1.balance != null ? r2(b0.balance) === r2(b1.balance) : null;
  return out;
}
