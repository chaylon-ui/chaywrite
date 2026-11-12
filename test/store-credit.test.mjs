import { test } from "node:test";
import assert from "node:assert/strict";
import { customerRows, pickByEmail, maskEmail, findCustomer, adjustCredit, creditHistory, creditDryRun, MAX_DRY_RUN, CUSTOMERS } from "../src/store-credit.js";

// A pretend portal: a customer search, the customer by id, the history, the adjustment.
function portal(o) {
  const w = { calls: [], balance: (o && o.balance) || 12.5, history: [], fail: (o && o.fail) || {} };
  const me = { id: 4242, firstName: "Ada", lastName: "Lovelace", email: "Owner@Example.test", storeCredit: w.balance };
  const other = { id: 7, firstName: "Ada", lastName: "Lovelace", email: "someone-else@example.test", storeCredit: 1 };
  w.deps = {
    get: async (env, path) => {
      w.calls.push(["GET", path]);
      if (path.startsWith(CUSTOMERS + "?keyword=")) return { customers: [other, { ...me, storeCredit: w.balance }], count: 2 };
      if (/\/creditHistory\?/.test(path)) return w.history.slice().reverse();
      if (path.startsWith(CUSTOMERS + "/byId/4242")) return { ...me, storeCredit: w.balance };
      throw new Error("BinderPOS " + path + " answered 404");
    },
    post: async (env, path, body) => {
      w.calls.push(["POST", path, body]);
      if (w.fail[body.typeOfAdjustment]) throw new Error("BinderPOS /api/customers/adjustStoreCredit answered 500: nope");
      const delta = body.typeOfAdjustment === "increase" ? body.amountToAdjust : -body.amountToAdjust;
      w.balance = Math.round((w.balance + delta) * 100) / 100;
      w.history.push({ id: w.history.length + 1, amountChanged: delta, amountBeforeChange: w.balance - delta, amountAfterChange: w.balance, publicNotes: body.publicNotes, privateNotes: body.privateNotes, updatedDate: "2026-11-12T10:00:00Z", actionedBy: "api" });
      return { actionPass: true, messageType: "success", message: "", data: null };   // as BinderPOS answers (dry run 2026-11-12)
    },
  };
  return w;
}

test("rows out of any wrapper; a customer is matched by email exactly, never by name; emails are masked", () => {
  assert.deepEqual(customerRows([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(customerRows({ customers: [{ id: 2 }], count: 1 }), [{ id: 2 }]);
  assert.deepEqual(customerRows({ results: [] }), []);
  assert.deepEqual(customerRows(null), []);
  const rows = [{ id: 7, firstName: "Ada", email: "a@x.test" }, { id: 8, firstName: "Ada", email: "B@X.test" }];
  assert.equal(pickByEmail(rows, "b@x.test").id, 8);
  assert.equal(pickByEmail(rows, "ada"), null);
  assert.equal(pickByEmail(rows, ""), null);
  assert.equal(maskEmail("owner@example.test"), "o***@example.test");
  assert.equal(maskEmail(""), "");
});

test("find: the row whose email matches, as a view without name or email; none -> a clear error", async () => {
  const w = portal();
  const f = await findCustomer({}, "owner@example.test", w.deps);
  assert.deepEqual([f.ok, f.customer.id, f.customer.email, f.customer.storeCredit, f.rows], [true, "4242", "O***@Example.test", 12.5, 2]);
  assert.ok(!JSON.stringify(f).includes("Lovelace") && !JSON.stringify(f).includes("Owner@Example.test"));
  const none = await findCustomer({}, "nobody@example.test", w.deps);
  assert.deepEqual([none.ok, none.error], [false, "no BinderPOS customer with that email (2 search rows)"]);
});

test("adjust: the portal's payload, increase or decrease, never zero", async () => {
  const w = portal();
  const r = await adjustCredit({}, { customerId: "4242", amount: 0.05, type: "increase", publicNotes: "test", privateNotes: "by me" }, w.deps);
  assert.deepEqual([r.ok, r.type, r.amount, r.reply.keys], [true, "increase", 0.05, ["actionPass", "messageType", "message", "data"]]);
  assert.deepEqual(w.calls[0], ["POST", CUSTOMERS + "/adjustStoreCredit", { customerId: 4242, amountToAdjust: 0.05, typeOfAdjustment: "increase", publicNotes: "test", privateNotes: "by me" }]);
  assert.equal((await adjustCredit({}, { customerId: "4242", amount: 0, type: "increase" }, w.deps)).ok, false);
  assert.equal((await adjustCredit({}, { customerId: "", amount: 1 }, w.deps)).ok, false);
  const h = await creditHistory({}, "4242", 3, w.deps);
  assert.deepEqual([h.length, h[0].amount, h[0].before, h[0].after, h[0].publicNotes, h[0].by], [1, 0.05, 12.5, 12.55, "test", "api"]);
});

test("the dry run: find, balance, a few cents on, the history, the cents off, balance again - unchanged; never more than the cap", async () => {
  const w = portal({ balance: 20 });
  const r = await creditDryRun({}, { email: "owner@example.test", amount: 0.07, by: "chaylon@exorgames.com" }, w.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.amount, r.customer, r.balanceBefore, r.balanceAfter, r.unchanged], [0.07, "4242", 20, 20, true]);
  assert.deepEqual(r.steps.map((s) => s.step), ["find", "before", "increase", "history", "decrease", "after"]);
  assert.deepEqual(w.calls.filter((c) => c[0] === "POST").map((c) => [c[2].typeOfAdjustment, c[2].amountToAdjust]), [["increase", 0.07], ["decrease", 0.07]]);
  assert.ok(w.calls[2][2].publicNotes.startsWith("9Pocket dry run ") && w.calls[2][2].publicNotes.endsWith("(test, reversed right after)") && w.calls[2][2].privateNotes === "by chaylon@exorgames.com");
  assert.equal(w.balance, 20);
  assert.ok(!JSON.stringify(r).includes("Lovelace") && !JSON.stringify(r).includes("Owner@Example.test"), "no name or email in the report");
  const big = await creditDryRun({}, { email: "owner@example.test", amount: 50 }, portal().deps);
  assert.equal(big.amount, MAX_DRY_RUN);
});

test("the dry run stops where it fails: no match; an increase refused (nothing taken back); a decrease refused (says to take it off by hand)", async () => {
  const none = await creditDryRun({}, { email: "nobody@example.test" }, portal().deps);
  assert.deepEqual([none.ok, none.steps.length], [false, 1]);
  const w = portal({ fail: { increase: true } });
  const r = await creditDryRun({}, { email: "owner@example.test" }, w.deps);
  assert.deepEqual([r.ok, r.steps.map((s) => s.step)], [false, ["find", "before", "increase"]]);
  assert.match(r.error, /^increase failed: BinderPOS .* 500/);
  assert.equal(w.balance, 12.5);
  const w2 = portal({ fail: { decrease: true } });
  const r2 = await creditDryRun({}, { email: "owner@example.test" }, w2.deps);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /the increase went through but the decrease failed: .* - take \$0\.05 off by hand$/);
  assert.equal(w2.balance, 12.55);
});
