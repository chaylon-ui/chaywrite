// EMAIL_FROM hygiene: the From header must never carry a pasted line break.
import test from "node:test";
import assert from "node:assert/strict";
import { emailFrom, EMAIL_FROM_DEFAULT, buildStaffBuylistEmail } from "../src/stage-email.js";
import { parseNotifyList, BUYLIST_NOTIFY_DEFAULT } from "../src/stage.js";

test("emailFrom trims a trailing newline from the secret", () => {
  assert.equal(emailFrom({ EMAIL_FROM: "Exor Games <customerservice@exorgames.com>\n" }), "Exor Games <customerservice@exorgames.com>");
  assert.equal(emailFrom({ EMAIL_FROM: "  Exor Games <customerservice@exorgames.com>\r\n" }), "Exor Games <customerservice@exorgames.com>");
});

test("emailFrom falls back to the default when the secret is blank or missing", () => {
  assert.equal(emailFrom({ EMAIL_FROM: "\n" }), EMAIL_FROM_DEFAULT);
  assert.equal(emailFrom({}), EMAIL_FROM_DEFAULT);
  assert.equal(emailFrom(undefined), EMAIL_FROM_DEFAULT);
});

test("the staff copy of a buylist: who, how to reach them, every card with both payouts, the total, the reference, the link; one address list parser", () => {
  const rec = { id: "x1", number: "9P-1042", customer: "3957471740057", customerName: "Ada <Lovelace>", customerEmail: "ada@example.test", customerPhone: "(902) 555-0100", paymentType: "Store Credit",
    cards: [{ cardName: "Lightning Bolt", setName: "Magic 2011", conditionName: "Near Mint", type: "Normal", quantity: "3", cashBuyPrice: 1.5, storeCreditBuyPrice: 1.95 }, { cardName: "Sol Ring <img src=x onerror=1>", setName: "Commander Legends", conditionName: "Lightly Played", type: "Foil", quantity: "1", cashBuyPrice: 2, storeCreditBuyPrice: 2.6 }],
    totals: { cash: 6.5, credit: 8.45, units: 4, lines: 2 }, repriced: { changed: ["Sol Ring · Lightly Played · Foil ($2.50 credit is now $2.60)"], capped: [], dropped: ["Black Lotus (not on the buylist right now)"] } };
  const m = buildStaffBuylistEmail(rec, { customerMail: { ok: true, to: "ada@example.test" }, link: "https://w/portal/buylists" });
  assert.equal(m.subject, "New buylist 9P-1042: Ada <Lovelace> - 4 cards, $8.45 store credit");
  for (const s of ["Ada &lt;Lovelace&gt;", "mailto:ada@example.test", "(902) 555-0100", "customers/3957471740057", "9P-1042", "Lightning Bolt", "Magic 2011", "Near Mint", "3 ×", "$1.50", "$1.95", "$5.85", "Sol Ring &lt;img src=x onerror=1&gt;", "$2.60", "Store credit total", "$8.45", "price updated: Sol Ring", "dropped: Black Lotus", "went to ada@example.test", 'href="https://w/portal/buylists"', "Open the BinderPOS buylists on 9Pocket", "nobody sees the others"]) assert.ok(m.html.includes(s), "html has " + s);
  assert.ok(!m.html.includes("<img src=x"));
  for (const s of ["Customer: Ada <Lovelace> <ada@example.test> · (902) 555-0100", "Paid as: Store Credit · 4 cards · store credit total $8.45", "3 x Lightning Bolt [Magic 2011] Near Mint - cash $1.50 / credit $1.95", "1 x Sol Ring <img src=x onerror=1> [Commander Legends] Lightly Played Foil - cash $2.00 / credit $2.60", "dropped: Black Lotus", "Open: https://w/portal/buylists"]) assert.ok(m.text.includes(s), "text has " + s);
  // cash list, waiting for approval, the customer's email failed, no phone, no email
  const cash = buildStaffBuylistEmail({ ...rec, paymentType: "Cash", customerEmail: "", customerPhone: "", repriced: null }, { staged: true, customerMail: { ok: false, error: "no email address for this customer" }, link: "https://w/9pocket/b/x1" });
  assert.equal(cash.subject, "New buylist 9P-1042: Ada <Lovelace> - 4 cards, $6.50 cash (waiting for approval)");
  assert.ok(cash.html.includes("waiting for approval") && cash.html.includes("Review it on 9Pocket") && cash.html.includes("none on the customer record") && cash.html.includes("was NOT sent</strong> (no email address for this customer) - no email address on the Shopify customer"));
  assert.ok(!cash.html.includes("Phone") && !cash.html.includes("Changed on the way in"));
  assert.ok(cash.text.includes("(no email on the customer record)") && cash.text.includes("cash total $6.50"));
  // the recipients: one per line (or comma), cleaned, deduped, capped at 10
  assert.deepEqual(parseNotifyList("Customerservice@ExorGames.com\nchaylon@exorgames.com\n\n sebastian@exorgames.com , catlin@mostwantedpei.com; not an address\nchaylon@exorgames.com"), ["customerservice@exorgames.com", "chaylon@exorgames.com", "sebastian@exorgames.com", "catlin@mostwantedpei.com"]);
  assert.deepEqual(parseNotifyList(""), []); assert.deepEqual(parseNotifyList(null), []);
  assert.equal(parseNotifyList(Array.from({ length: 14 }, (_, i) => `a${i}@x.test`).join("\n")).length, 10);
  assert.deepEqual(BUYLIST_NOTIFY_DEFAULT, ["customerservice@exorgames.com"]);
});
