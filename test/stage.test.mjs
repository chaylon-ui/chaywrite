import { test } from "node:test";
import assert from "node:assert/strict";
import { totalsOf, shapeRecord, mineView, applyEdit, lockUnpaidPrice, stagingOn, safeImage, mergeApproval, numberOf, shapeAdded, mergeAdded, editNeeds } from "../src/stage.js";
import { buildEmail, buildDecisionEmail, instructionsPayload, sendEmail } from "../src/stage-email.js";
import { renderList, renderSheet, renderLoginForm, renderSetup, renderAdmin, renderDenied, renderHeld } from "../src/stage-ui.js";

const ADMIN = { email: "chaylon@exorgames.com", name: "Chaylon", role: "admin", perms: {} };
const VIEWER = { email: "v@exorgames.com", name: "Viewer", role: "staff", perms: {} };
const PRICER = { email: "p@exorgames.com", name: "Pricer", role: "staff", perms: { prices: true } };

const CARDS = [
  { cardId: 101, cardName: "Lightning Bolt", setName: "Magic 2011", game: "mtg", type: "Normal", condition: 1, conditionName: "Near Mint", quantity: "3", cashBuyPrice: 1.5, storeCreditBuyPrice: 1.95, shopifyVariantId: 9 },
  { cardId: 202, cardName: "Sol Ring", setName: "Commander Legends", game: "mtg", type: "Foil", condition: 2, conditionName: "Lightly Played", quantity: "1", cashBuyPrice: 2, storeCreditBuyPrice: 2.6, shopifyVariantId: 10 },
];

test("totals: units and money over the repriced lines", () => {
  const t = totalsOf(CARDS);
  assert.equal(t.units, 4);
  assert.equal(t.lines, 2);
  assert.equal(t.cash, 6.5);
  assert.equal(t.credit, 8.45);
  assert.deepEqual(totalsOf(null), { cash: 0, credit: 0, units: 0, lines: 0 });
});

test("a record needs a customer, a payment type and at least one card", () => {
  const now = 1_700_000_000_000;
  const r = shapeRecord({ customer: "3957471740057", paymentType: "Store Credit", cards: CARDS, repriced: { changed: ["x"], capped: [], dropped: [] } }, now);
  assert.ok(r && r.id.startsWith("01700000000000-"));
  assert.equal(r.status, "staged");
  assert.equal(r.customer, "3957471740057");
  assert.equal(r.totals.units, 4);
  assert.deepEqual(r.repriced, { changed: ["x"], capped: [], dropped: [] });
  assert.deepEqual(r.events.map((e) => e.action), ["submitted"]);
  assert.equal(r.customerName, "");
  const named = shapeRecord({ customer: "3957471740057", customerName: "  Ada Lovelace ", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS }, now);
  assert.equal(named.customerName, "Ada Lovelace");
  assert.equal(named.customerEmail, "ada@example.test");
  assert.equal(shapeRecord({ customer: "abc", paymentType: "Cash", cards: CARDS }, now), null);
  assert.equal(shapeRecord({ customer: "3957471740057", paymentType: "", cards: CARDS }, now), null);
  assert.equal(shapeRecord({ customer: "3957471740057", paymentType: "Cash", cards: [] }, now), null);
});

test("the shopper's view carries status and totals, never the staff note or the reply", () => {
  const r = shapeRecord({ customer: "3957471740057", customerName: "Ada Lovelace", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS }, 5);
  r.note = "check the foil"; r.status = "approved"; r.bp = { number: "8812", upstream: 200, cleared: 200, reply: { secret: true } };
  r.events.push({ ts: 9, action: "approved" });
  const v = mineView(r);
  assert.equal(v.status, "approved");
  assert.equal(v.reference, "8812");
  assert.equal(v.decidedAt, 9);
  assert.equal(v.cards.length, 2);
  assert.equal(v.cards[0].cardName, "Lightning Bolt");
  assert.ok(!("note" in v));
  assert.ok(!("bp" in v));
  assert.ok(!("customerName" in v) && !("customerEmail" in v));
  assert.ok(!JSON.stringify(v).includes("Lovelace"));
  assert.equal(v.customerNote, "");
  r.status = "rejected"; r.customerNote = "condition was Heavily Played";
  assert.equal(mineView(r).customerNote, "condition was Heavily Played");
});

test("a staff edit changes quantities or removes lines and can never add one", () => {
  const r = shapeRecord({ customer: "3957471740057", paymentType: "Cash", cards: CARDS }, 5);
  const out = applyEdit(r, [
    { cardId: "101", condition: "1", type: "normal", quantity: "2" },     // quantity down
    { cardId: "202", condition: "2", type: "foil", quantity: "0" },       // removed
    { cardId: "999", condition: "1", type: "normal", quantity: "5" },     // not in the record: ignored
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].cardId, 101);
  assert.equal(out[0].quantity, "2");
  assert.equal(out[0].cashBuyPrice, 1.5);   // price untouched by an edit
  assert.ok(!out[0].staffPriced);
  // an untouched line keeps its quantity
  assert.equal(applyEdit(r, [])[0].quantity, "3");
});

test("a staff price on the worksheet marks the line and wins at approval; the rest take the day's price", () => {
  const r = shapeRecord({ customer: "3957471740057", paymentType: "Cash", cards: CARDS }, 5);
  // the worksheet posts every line back, prices as typed (strings, 2 dp)
  const edited = applyEdit(r, [
    { cardId: "101", condition: "1", type: "normal", quantity: "3", cashBuyPrice: "1.50", storeCreditBuyPrice: "1.95" },   // unchanged prices: no flag
    { cardId: "202", condition: "2", type: "foil", quantity: "1", cashBuyPrice: "2.75", storeCreditBuyPrice: "3.5" },      // staff price
  ]);
  assert.ok(!edited[0].staffPriced);
  assert.equal(edited[1].staffPriced, true);
  assert.equal(edited[1].cashBuyPrice, 2.75);
  assert.equal(edited[1].storeCreditBuyPrice, 3.5);
  // a bad price is ignored, not applied
  assert.equal(applyEdit(r, [{ cardId: "101", condition: "1", type: "normal", cashBuyPrice: "abc" }])[0].cashBuyPrice, 1.5);
  assert.equal(applyEdit(r, [{ cardId: "101", condition: "1", type: "normal", cashBuyPrice: "-3" }])[0].cashBuyPrice, 1.5);
  // approval: repriceCards said both lines moved; the staff line keeps its price and drops the flag
  const day = { cards: edited.map((c) => ({ ...c, cashBuyPrice: 9, storeCreditBuyPrice: 9.9 })), changed: ["Lightning Bolt · Near Mint ($1.50 cash / $1.95 credit is now $9.00 / $9.90)", "Sol Ring · Lightly Played · Foil ($2.75 cash / $3.50 credit is now $9.00 / $9.90)"], capped: [], dropped: [] };
  const m = mergeApproval(edited, day);
  assert.equal(m.cards[0].cashBuyPrice, 9);
  assert.equal(m.cards[1].cashBuyPrice, 2.75);
  assert.equal(m.cards[1].storeCreditBuyPrice, 3.5);
  assert.ok(!("staffPriced" in m.cards[0]) && !("staffPriced" in m.cards[1]));
  assert.deepEqual(m.notes.changed, ["Lightning Bolt · Near Mint ($1.50 cash / $1.95 credit is now $9.00 / $9.90)"]);
  assert.equal(m.notes.kept.length, 1);
  assert.match(m.notes.kept[0], /^Sol Ring · Lightly Played · Foil \(\$2\.75 cash \/ \$3\.50 credit; the day's would be \$9\.00 \/ \$9\.90\)$/);
});

test("an edit can only carry the price the list pays: cash on a Cash list, credit on a Store Credit list", () => {
  const e = [{ cardId: "101", condition: "1", type: "normal", quantity: "2", cashBuyPrice: "1.00", storeCreditBuyPrice: "9.99" }, null];
  assert.deepEqual(lockUnpaidPrice({ paymentType: "Cash" }, e), [{ cardId: "101", condition: "1", type: "normal", quantity: "2", cashBuyPrice: "1.00" }, null]);
  assert.deepEqual(lockUnpaidPrice({ paymentType: "Store Credit" }, e), [{ cardId: "101", condition: "1", type: "normal", quantity: "2", storeCreditBuyPrice: "9.99" }, null]);
  const r = shapeRecord({ customer: "1", paymentType: "Store Credit", cards: CARDS }, 1);
  const after = applyEdit(r, lockUnpaidPrice(r, e));
  assert.equal(after[0].cashBuyPrice, 1.5); assert.equal(after[0].storeCreditBuyPrice, 9.99); assert.equal(after[0].quantity, "2");
  assert.deepEqual(lockUnpaidPrice(r, "junk"), []);
});

test("buylist numbers read 9P-<seq>", () => {
  assert.equal(numberOf(1001), "9P-1001");
});

test("the customer email carries the number, every card, the totals, the address and the two links - and no script", async () => {
  const r = shapeRecord({ customer: "3957471740057", customerName: "Ada Lovelace", customerEmail: "ada@example.test", paymentType: "Store Credit", cards: CARDS }, 5);
  r.number = "9P-1001";
  const m = buildEmail(r);
  assert.match(m.subject, /9P-1001/);
  for (const s of ["Hi Ada,", "9P-1001", "Lightning Bolt", "Sol Ring", "Magic 2011", "Lightly Played", "Foil", "$8.45", "Store Credit", "51 Allen Street", "ATTN: Gage Office", "C1A 2V6", "https://exorgames.com/pages/selling-policy", "https://exorgames.com/pages/how-to-sell-cards", "re-grade them", "exceeding 20%", "Buylist Number", "9Pocket by Exor"]) {
    assert.ok(m.html.includes(s), "html has " + s);
  }
  for (const s of ["9P-1001", "Lightning Bolt", "3 x", "51 Allen Street", "https://exorgames.com/pages/selling-policy", "Estimated store credit total: $8.45"]) assert.ok(m.text.includes(s), "text has " + s);
  assert.ok(!/<script/i.test(m.html));
  // the Mallow Games banner (owner, 2026-09-22) sits above the footer, linked, in html and text
  assert.ok(m.html.includes('href="https://mallowgames.com/sell-your-games/"') && m.html.includes("90A38806-3E70-440D-9CA9-E869B6C38946.png") && m.html.indexOf("mallowgames.com") < m.html.lastIndexOf("51 Allen Street"));
  assert.ok(m.text.includes("Mallow Games") && m.text.includes("https://mallowgames.com/sell-your-games/"));
  // a hostile card name is escaped
  const bad = shapeRecord({ customer: "1", paymentType: "Cash", cards: [{ ...CARDS[0], cardName: '<img src=x onerror=alert(1)>' }] }, 5);
  assert.ok(!buildEmail(bad).html.includes("<img src=x"));
  // no key: nothing is sent and the record learns why
  const s = await sendEmail({}, "ada@example.test", m);
  assert.equal(s.ok, false); assert.equal(s.status, "unconfigured");
  const n = await sendEmail({ RESEND_API_KEY: "x" }, "not-an-address", m);
  assert.equal(n.status, "no-address");
});

test("the staff pages: list rows link to worksheets; the worksheet's controls follow the account's permissions and the status", () => {
  const r = shapeRecord({ customer: "3957471740057", customerName: "Ada O'Brien", customerEmail: "ada@example.test", paymentType: "Cash", cards: [{ ...CARDS[0], imageUrl: "https://product-images.tcgplayer.com/1.jpg" }, CARDS[1]] }, 5);
  r.number = "9P-1001";
  const o = { user: ADMIN, on: true, emailOn: false, err: "", msg: "" };
  const list = renderList({ records: [r], counts: { staged: 1 } }, o);
  assert.ok(list.includes("9Pocket by Exor"));
  assert.ok(list.includes('href="/9pocket/b/' + r.id + '"'));
  assert.ok(list.includes("Ada O&#39;Brien"));
  assert.ok(list.includes('href="/9pocket/admin"') && list.includes("Sign out") && list.includes("Chaylon"));
  const sheet = renderSheet(r, o);
  assert.ok(sheet.includes("Back to 9Pocket"));
  assert.ok(sheet.includes('<input class="q" type="number" min="0"') && sheet.includes('<input class="p cash"'));
  assert.ok(sheet.includes('img class="thumb" src="https://product-images.tcgplayer.com/1.jpg"'));
  assert.ok(sheet.includes("Approve → send to BinderPOS"));
  assert.ok(sheet.includes('id="addcard"') && sheet.includes("/buylist/api/search") && sheet.includes('id="ad-set"') && sheet.includes("/buylist/api/sets?game=") && sheet.includes("&set="));
  // paid-as can be changed while it waits (edit permission); the decision forms carry the opt-in email box, off by default
  assert.ok(sheet.includes('value="payment"') && sheet.includes('<option value="Store Credit"') && !sheet.includes('<option value="Store Credit" selected'));
  assert.equal((sheet.match(/name="notify"/g) || []).length, 2);
  assert.ok(!sheet.includes('name="notify" value="1" checked') && sheet.includes("not</b> emailed about a decision unless"));
  assert.ok(sheet.includes('class="hits"') && sheet.includes('id="ad-more"') && sheet.includes("&offset='+offset"));
  assert.ok(sheet.includes('<span class="fin">✦ Foil</span>'));   // the foil line wears the holographic pill
  // regrade under each condition: a count box only where the line has more than one copy, never the line's own condition
  assert.equal((sheet.match(/class="rg-open"/g) || []).length, 2);
  assert.ok(sheet.includes('>regrade some</a>') && sheet.includes('max="3"') && sheet.includes(">regrade</a>"));
  assert.ok(sheet.includes("action:'regrade'") && !sheet.includes('<option value="Near Mint">Near Mint</option><option value="Lightly Played">Lightly Played</option><option value="Moderately Played">Moderately Played</option><option value="Heavily Played">Heavily Played</option><option value="Damaged">Damaged</option></select> <button type="button" class="sm rg-go">Move</button></span></div></td>\n<td class="n"><input class="q" type="number" min="0" max="999" step="1" value="3"'));
  assert.ok(sheet.includes("under Ada OBrien at the prices"));      // the confirm() string cannot carry a quote
  assert.ok(sheet.includes("RESEND_API_KEY"));                      // email off: the worksheet says so
  // a view-only account: no inputs, no add, no decide, no send
  const view = renderSheet(r, { ...o, user: VIEWER });
  assert.ok(!view.includes('<input class="q" type="number" min="0"') && !view.includes('<input class="p cash"') && !view.includes('id="addcard"') && !view.includes("Approve → send") && !view.includes('value="email"'));
  assert.ok(view.includes("needs a permission an admin can give you") && !view.includes('href="/9pocket/admin"'));
  assert.ok(!view.includes('class="rg-open"'));
  // the paid-as price column is marked, the other dimmed: Cash here, Credit on a Store Credit list
  assert.ok(sheet.includes('<th class="n pay">Cash<small>paid</small></th><th class="n dim">Credit</th>') && sheet.includes("paid as <b>Cash</b>: the <b>Cash</b> column"));
  const sc = renderSheet({ ...r, paymentType: "Store Credit" }, o);
  assert.ok(sc.includes('<th class="n dim">Cash</th><th class="n pay">Credit<small>paid</small></th>') && sc.includes("the <b>Credit</b> column is what BinderPOS shows"));
  // only the paid-as column takes a price: the other is locked text (owner, 2026-09-22)
  assert.ok(sc.includes('<input class="p credit"') && !sc.includes('<input class="p cash"') && sc.includes('title="Locked: this list is paid as Store Credit') && sc.includes("$1.50</td>"));
  assert.ok(sheet.includes('<input class="p cash"') && !sheet.includes('<input class="p credit"') && sheet.includes('title="Locked: this list is paid as Cash'));
  assert.ok(sc.includes("the <b>Cash</b> column is locked") && sheet.includes("the <b>Credit</b> column is locked"));
  // prices only: price inputs, quantities as text, still a Save button
  const pr = renderSheet(r, { ...o, user: PRICER });
  assert.ok(pr.includes('<input class="p cash"') && !pr.includes('<input class="q" type="number" min="0"') && pr.includes('id="save"') && pr.includes('data-qty="3"'));
  // decided: read-only for everyone, and no paid-as change
  r.status = "approved"; r.bp = { number: "8812" }; r.decisionEmail = { status: "sent", kind: "approved", to: "ada@example.test", at: 1_760_000_000_000 };
  const done = renderSheet(r, o);
  assert.ok(!done.includes('value="payment"') && done.includes("Decision email (approved) sent to <b>ada@example.test</b>"));
  assert.ok(!done.includes('<input class="p cash"') && !done.includes('<input class="q" type="number" min="0"'));
  assert.ok(!done.includes("Approve → send to BinderPOS") && !done.includes('id="addcard"'));
  assert.ok(done.includes("BinderPOS buylist 8812"));
  assert.ok(renderLoginForm({ next: "/9pocket" }).includes("9Pocket by Exor") && renderLoginForm({}).includes('name="password"'));
  const setup = renderSetup({ k: "pin", email: "chaylon@exorgames.com", err: "" });
  assert.ok(setup.includes('value="chaylon@exorgames.com"') && setup.includes('name="password2"') && setup.includes('value="pin"'));
  assert.ok(!renderSetup({ k: "", noPin: true, err: "x" }).includes('name="password"'));
  const admin = renderAdmin({ ...o, users: [ADMIN, { ...VIEWER, perms: { edit: true, ap_publish: true }, limits: { apMaxDropPct: 10 } }] });
  assert.ok(admin.includes("chaylon@exorgames.com") && admin.includes("v@exorgames.com") && admin.includes("Change quantities and notes") && admin.includes('value="add"'));
  // the auto-pricing group: its checkboxes, the two limit fields with the saved value, and the chips
  assert.ok(admin.includes('name="perm_ap_publish" checked') && admin.includes('name="perm_ap_config" >'));
  assert.ok(admin.includes('name="apMaxDropPct" min="0" max="100" step="0.5" value="10"') && admin.includes('name="apMaxRaisePct" min="0" max="1000" step="0.5" value=""'));
  assert.ok(admin.includes("drop ≤ 10%") && admin.includes('class="perm ap"') && admin.includes('href="/autoprice"'));
  assert.ok(!list.includes('href="/autoprice"') || ADMIN.role === "admin");   // the bar links the auto-pricer for accounts that may open it
  assert.ok(renderDenied({ user: VIEWER }).includes("Admins only"));
});

test("an added card is shaped, checked and merged into a matching line", () => {
  assert.equal(shapeAdded(null), null);
  assert.equal(shapeAdded({ cardId: 5 }), null);
  const c = shapeAdded({ cardId: "202", cardName: " Sol Ring ", setName: "Commander Legends", game: "mtg", type: "Foil", condition: "2", conditionName: "Lightly Played", quantity: "2", imageUrl: "javascript:x", cashBuyPrice: 99 });
  assert.equal(c.cardId, 202); assert.equal(c.condition, 2); assert.equal(c.cardName, "Sol Ring"); assert.equal(c.quantity, "2"); assert.equal(c.imageUrl, ""); assert.equal(c.cashBuyPrice, 0);
  const m = mergeAdded(CARDS, { ...CARDS[1], quantity: "2" });
  assert.equal(m.merged, true); assert.equal(m.cards.length, 2); assert.equal(m.cards[1].quantity, "3");
  const n = mergeAdded(CARDS, { ...CARDS[1], condition: 1, quantity: "1" });
  assert.equal(n.merged, false); assert.equal(n.cards.length, 3);
  assert.equal(mergeAdded(CARDS, { ...CARDS[1], quantity: "999" }).cards[1].quantity, "999");
  // what an edit needs
  assert.deepEqual(editNeeds(CARDS, CARDS), { qty: false, prices: false });
  assert.deepEqual(editNeeds(CARDS, [CARDS[0]]), { qty: true, prices: false });
  assert.deepEqual(editNeeds(CARDS, [CARDS[0], { ...CARDS[1], cashBuyPrice: 2.5 }]), { qty: false, prices: true });
  assert.deepEqual(editNeeds(CARDS, [{ ...CARDS[0], quantity: "1" }, CARDS[1]]), { qty: true, prices: false });
});

test("a thumbnail is drawn only from an https image URL", () => {
  assert.equal(safeImage("https://product-images.tcgplayer.com/714709.jpg"), "https://product-images.tcgplayer.com/714709.jpg");
  assert.equal(safeImage(" https://x.example/a.png "), "https://x.example/a.png");
  assert.equal(safeImage("http://x.example/a.png"), "");
  assert.equal(safeImage("javascript:alert(1)"), "");
  assert.equal(safeImage('https://x.example/a.png" onerror="alert(1)'), "");
  assert.equal(safeImage(null), "");
  assert.equal(safeImage("https://x.example/" + "a".repeat(500)), "");
});

test("staging is on unless the var says off", () => {
  assert.equal(stagingOn({}), true);
  assert.equal(stagingOn({ BUYLIST_STAGING: "on" }), true);
  assert.equal(stagingOn({ BUYLIST_STAGING: "OFF " }), false);
  assert.equal(stagingOn(undefined), true);
});

test("the decision emails and the popup payload carry the number, the list and the reason; the logo sits in every header", () => {
  const r = shapeRecord({ customer: "1", customerName: "Ada Lovelace", customerEmail: "ada@example.test", paymentType: "Cash", cards: CARDS }, 5);
  r.number = "9P-1007"; r.bp = { number: "908738" };
  const a = buildDecisionEmail(r, "approved");
  assert.match(a.subject, /9P-1007 has been approved/);
  for (const x of ["Hi Ada,", "908738", "Lightning Bolt", "Sol Ring", "Cash total: $6.50", "51 Allen Street", "logo2.png"]) assert.ok(a.html.includes(x) || a.text.includes(x), x);
  assert.ok(a.text.includes("Cash total: $6.50") && a.text.includes("51 Allen Street"));
  r.customerNote = "The Sol Ring is a proxy <b>";
  const d = buildDecisionEmail(r, "rejected");
  assert.match(d.subject, /About your buylist 9P-1007/);
  assert.ok(d.html.includes("could not accept") && d.html.includes("The Sol Ring is a proxy &lt;b&gt;") && !d.html.includes("Cash total"));
  assert.ok(d.text.includes("Reason: The Sol Ring is a proxy"));
  assert.ok(buildEmail(r).html.includes("logo2.png"));
  const ins = instructionsPayload();
  assert.ok(ins.nextStep.startsWith("What's the next step?") && ins.sections.length === 7 && ins.sections[1].address === true);
  assert.deepEqual(ins.address.slice(0, 2), ["Exor Games", "ATTN: Gage Office"]);
  assert.ok(ins.sections[2].p[0].includes("{SELL_POLICY}") && ins.links.SELL_POLICY.startsWith("https://exorgames.com/"));
  // the bar carries the logo instead of the word Exor
  const list = renderList({ records: [], counts: {} }, { user: ADMIN, on: true, emailOn: false, err: "", msg: "" });
  assert.ok(list.includes('<img class="logo" src="https://cdn.shopify.com/') && list.includes('aria-label="9Pocket by Exor"'));
  assert.ok(renderLoginForm({}).includes('<img class="logo"'));
});

test("the Held stock page: the switch is an admin's, releasing needs the permission, the counter box finds held cards", () => {
  const T = 1_760_000_000_000;
  const d = { ok: true, generatedAt: T, settings: { on: false, trial: null, since: 0, by: "", lastPoll: 0, lastError: "" }, counts: { held: 3, arrivals: 1, old24: 0, old72: 0, releasedToday: 2, notHeld: 1 },
    open: [{ key: "hl:1-cart:5", kind: "cart", ref: "5", ts: T - 900e3, customer: "", till: "Truro", who: "jordan@exorgames.com", paid: { cash: 186, credit: 0, total: 186 }, link: "https://portal.binderpos.com/#/pointOfSale/carts/5", held: 3, status: "waiting",
      lines: [{ title: "Lightning Bolt [Fourth Edition]", variantTitle: "Near Mint", sku: "B1", qty: 2, held: 2, released: 0, damaged: 0, remaining: 0, status: "held", image: "https://images.binderpos.com/a.jpg" }, { title: "Roronoa Zoro (OP12-020) [Legacy of the Master]", variantTitle: "Near Mint Foil", qty: 1, held: 1, released: 0, damaged: 0, remaining: 0, status: "held" }, { title: "Jinx", condition: "", qty: 3, held: 0, status: "no-product", note: "no Shopify product named Jinx" }] }],
    done: [], notHeld: [{ key: "k", ref: "5", kind: "cart", ts: T - 900e3, title: "Jinx", condition: "", qty: 3, held: 0, status: "no-product", note: "no Shopify product named Jinx" }], history: [{ ts: T - 800e3, by: "hold", action: "arrival", text: "POS cart 5: held 3, 1 could not be held" }], matches: null };
  const o = { user: ADMIN, on: true, emailOn: true, err: "", msg: "", q: "" };
  const page = renderHeld(d, o);
  assert.ok(page.includes("Hold on arrival: OFF") && page.includes('value="on"') && page.includes('name="trial"') && page.includes("Switch ON"));
  assert.ok(page.includes("Release all 3") && page.includes('value="release-all"') && (page.match(/value="damaged"/g) || []).length === 2 && page.includes('value="release"'));
  assert.ok(page.includes('<span class="fin">✦ Foil</span>') && page.includes("no Shopify product named Jinx") && page.includes("POS cart 5: held 3"));
  assert.ok(page.includes('href="/9pocket/held"') && page.includes('name="q"'));
  // on, in a trial
  const on = renderHeld({ ...d, settings: { ...d.settings, on: true, trial: 2, since: T, by: "chaylon@exorgames.com", lastPoll: T } }, o);
  assert.ok(on.includes("Hold on arrival: ON · trial, 2 left") && on.includes("Switch OFF") && on.includes('value="check"') && on.includes("Trial: 2 more arrivals"));
  // matches for the counter
  const m = renderHeld({ ...d, matches: [{ key: "hl:1-cart:5", line: 1, ref: "5", kind: "cart", title: "Roronoa Zoro (OP12-020) [Legacy of the Master]", variantTitle: "Near Mint Foil", held: 1, ts: T - 900e3 }] }, { ...o, q: "zoro" });
  assert.ok(m.includes("Found 1 held line for") && m.includes('value="1"'));
  // a viewer: no switch, no release forms, no Held stock link; a release-only account: forms but no switch
  const v = renderHeld(d, { ...o, user: VIEWER });
  assert.ok(!v.includes("Switch ON") && !v.includes('value="release"') && !v.includes('href="/9pocket/held"') && v.includes("Held stock"));
  const r = renderHeld(d, { ...o, user: { ...VIEWER, perms: { release: true } } });
  assert.ok(!r.includes("Switch ON") && r.includes('value="release"') && r.includes('href="/9pocket/held"'));
});
