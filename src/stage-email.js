/* ---------------- 9Pocket: the "we have your list" email ----------------
   Owner, 2026-09-19: "when the buylist is submitted to 9Pocket ... the
   customer gets an email with the list and instructions that BinderPOS shows
   when submitting a buylist" - and the instructions text, verbatim below,
   "attractive in the email".

   buildEmail(rec) renders the record into a subject, an HTML body (table
   layout, inline styles - the only CSS mail clients agree on) and a plain-
   text body. sendEmail() posts it to Resend (https://resend.com, a
   transactional-mail API) with the RESEND_API_KEY worker secret; the from
   address is EMAIL_FROM (default below) and must be on a domain verified in
   that Resend account. With no key nothing is sent and the record says so,
   so staff can send it from the worksheet once the key exists. The
   customer's address comes from Shopify (stage.js lookupCustomer), never from
   the browser. */

const BRAND = "9Pocket by Exor";
const RED = "#d52c28", INK = "#1d2327", MUTED = "#6b7780", RULE = "#e6ebee", PAPER = "#f4f6f7";
const SELL_POLICY = "https://exorgames.com/pages/selling-policy";
const HOW_TO_SELL = "https://exorgames.com/pages/how-to-sell-cards";
const STATUS_PAGE = "https://exorgames.com/pages/selling-to-exor-games-buylist";
const REPLY_TO = "customerservice@exorgames.com";
export const EMAIL_FROM_DEFAULT = "9Pocket by Exor <9pocket@exorgames.com>";
const LOGO = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/logo2.png?v=1789388474";   // the store's mark, the theme header's own file
// Owner, 2026-09-22: "an ad for Mallow Games to also sell their video games
// using this graphic inside the email" - the banner the owner uploaded to
// Shopify Files (2172x724, transparent margins); the CDN serves it resized.
export const MALLOW_URL = "https://mallowgames.com/sell-your-games/";
// The PNG carries transparent bands above and below the strip (rows ~250-460
// of 724); the CDN crops the middle out so no dead space rides along.
export const MALLOW_BANNER = "https://cdn.shopify.com/s/files/1/0467/3083/8169/files/90A38806-3E70-440D-9CA9-E869B6C38946.png?v=1790106076&width=1200&height=172&crop=center";
const MALLOW_ALT = "Selling video games? Get cash or Exor Games store credit at Mallow Games - start selling";
const mallowHtml = () => `<tr><td style="padding:4px 28px 22px"><a href="${MALLOW_URL}" style="display:block;text-decoration:none"><img src="${MALLOW_BANNER}" alt="${MALLOW_ALT}" width="544" height="78" style="display:block;width:100%;max-width:544px;height:auto;border:0"></a></td></tr>`;
const mallowText = () => `Selling video games too? Mallow Games, our sister shop, buys them for cash or Exor Games store credit: ${MALLOW_URL}`;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const qty = (c) => Math.max(0, parseInt(c && c.quantity, 10) || 0);

export function emailConfigured(env) { return !!(env && env.RESEND_API_KEY); }
export function emailFrom(env) { return String((env && env.EMAIL_FROM) || EMAIL_FROM_DEFAULT); }

// The owner's instructions, section by section, in the owner's words.
const ADDRESS = ["Exor Games", "ATTN: Gage Office", "51 Allen Street", "Charlottetown, PE", "C1A 2V6", "CANADA"];
const SECTIONS = [
  { h: "Thank you", p: ["Thank you for submitting the list of cards you wish to sell! We greatly appreciate your business and look forward to establishing a long-term relationship with you as a valued customer."] },
  { h: "Bring or mail your cards to us", p: ["Now, it's time to bring or mail your cards to us for verification. You can either visit our shop in person or conveniently send them to our address:"], address: true },
  { h: "Our terms", p: ["By submitting your buylist, you agree to abide by our terms and conditions, which can be found in detail on our Selling Policy page at {SELL_POLICY}. For instructions on how to sell us cards, please refer to our guide, {HOW_TO_SELL}."] },
  { h: "If you mail your cards", p: ["If you choose to mail your cards, we recommend opting for tracking, insurance, and delivery confirmation for added security. Buylists are processed in the order in which we receive them. When sending your package, kindly include the Buylist Number, along with your full name, address, email address, and phone number. Please note that we do not return deck boxes, sleeves, or any additional items, so refrain from including anything you wish to keep with the cards. In the event that either party decides not to proceed with the transaction during the approval process, the seller is responsible for the return shipping costs associated with the Buylist process."] },
  { h: "Re-grading", p: ["Please note that upon receiving your cards, we will re-grade them. If there are any changes exceeding 20% from the initial assessment, we will promptly notify you before approving your buylist."] },
  { h: "About the prices", p: ["We want to highlight that while our Buylist generally functions smoothly, there may be instances where prices for older or rare cards present challenges. This occurs due to limited information availability, leading to price estimates based on the existing market data. Consequently, inconsistencies in card values can arise. Rest assured, during the approval of pending buylists, any such discrepancies will be rectified. While we strive to maintain accurate automated pricing, occasional anomalies can occur. Therefore, please bear in mind that the price you submit is an estimate and may change upon verification."] },
  { h: "Thank you again", p: ["Thank you again for choosing Exor Games. We appreciate your understanding and cooperation throughout this process. Should you have any further inquiries, please don't hesitate to reach out to us. We're here to assist you!"] },
];
const NEXT_STEP = "What's the next step? Bring in, or mail your cards to us! Once received, we will verify and approve your cards against the list you just submitted and apply the store credit or send you an etransfer, PayPal or cash (in-store only).";

// The same instructions for the sell page's popup at submission (owner,
// 2026-09-22: "the instructions should show in a popup on the website at
// submission like BinderPOS does"). Paragraphs keep their {SELL_POLICY} /
// {HOW_TO_SELL} tokens; the page swaps them for links after escaping.
export function instructionsPayload() {
  return { nextStep: NEXT_STEP, sections: SECTIONS.map((s) => ({ h: s.h, p: s.p.slice(), address: !!s.address })), address: ADDRESS.slice(), links: { SELL_POLICY, HOW_TO_SELL } };
}

function linkify(p, html) {
  const a = (url, text) => html ? `<a href="${url}" style="color:${RED};font-weight:600;text-decoration:underline">${esc(text)}</a>` : `${text} (${url})`;
  return (html ? esc(p) : p).replace("{SELL_POLICY}", a(SELL_POLICY, "Exor Games Selling Policy")).replace("{HOW_TO_SELL}", a(HOW_TO_SELL, "How to Sell Cards"));
}

export function buildEmail(rec) {
  const ref = rec.number || rec.id;
  const first = String(rec.customerName || "").trim().split(/\s+/)[0] || "";
  const credit = rec.paymentType === "Store Credit";
  const cards = Array.isArray(rec.cards) ? rec.cards : [];
  const t = rec.totals || { cash: 0, credit: 0, units: 0, lines: cards.length };
  const total = credit ? t.credit : t.cash;
  const each = (c) => credit ? c.storeCreditBuyPrice : c.cashBuyPrice;
  const subject = `Your buylist ${ref} - we have your list (${BRAND})`;

  const rows = cards.map((c, i) => `<tr style="background:${i % 2 ? PAPER : "#ffffff"}">
<td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap">${qty(c)} ×</td>
<td style="padding:8px 10px;border-bottom:1px solid ${RULE}"><strong>${esc(c.cardName)}</strong><br><span style="color:${MUTED};font-size:12px">${esc(c.setName)} · ${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? " · " + esc(c.type) : ""}</span></td>
<td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap">${money(each(c))}</td>
<td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap"><strong>${money(qty(c) * (Number(each(c)) || 0))}</strong></td></tr>`).join("");

  const section = (s) => `<h2 style="margin:26px 0 8px;font-size:17px;line-height:1.3;color:${RED}">${esc(s.h)}</h2>` +
    s.p.map((p) => `<p style="margin:0 0 10px;line-height:1.55">${linkify(p, true)}</p>`).join("") +
    (s.address ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 4px"><tr><td style="border-left:4px solid ${RED};padding:6px 14px;font-size:15px;line-height:1.5"><strong>${ADDRESS[0]}</strong><br>${ADDRESS.slice(1).map(esc).join("<br>")}</td></tr></table>` : "");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${RED};padding:22px 28px;color:#ffffff">
  <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.9">9Pocket by <img src="${LOGO}" alt="Exor Games" width="44" height="32" style="vertical-align:middle;height:32px;width:auto;margin-left:2px"></div>
  <div style="font-size:26px;font-weight:700;line-height:1.2;margin-top:4px">We have your buylist</div>
  <div style="font-size:15px;margin-top:6px;opacity:.95">Buylist Number <strong style="font-size:17px">${esc(ref)}</strong></div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
  <p style="margin:0 0 14px;font-size:16px">${first ? "Hi " + esc(first) + "," : "Hello,"}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PAPER};border-radius:10px"><tr><td style="padding:14px 16px;line-height:1.55"><strong>What's the next step?</strong> ${esc(NEXT_STEP.replace(/^What.s the next step\?\s*/, ""))}</td></tr></table>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 6px"><tr>
    <td style="padding:0 8px 0 0"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Cards</div><div style="font-size:20px;font-weight:700">${t.units}</div></td>
    <td style="padding:0 8px"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Paid as</div><div style="font-size:20px;font-weight:700">${esc(rec.paymentType)}</div></td>
    <td style="padding:0 0 0 8px;text-align:right"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Estimated total</div><div style="font-size:20px;font-weight:700;color:${RED}">${money(total)}</div></td>
  </tr></table>
</td></tr>
<tr><td style="padding:6px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <thead><tr style="color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.06em"><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Qty</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid ${RULE}">Card</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Each</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Line</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700">Estimated ${credit ? "store credit" : "cash"} total</td><td style="padding:10px;text-align:right;font-weight:700;color:${RED};white-space:nowrap">${money(total)}</td></tr></tfoot>
  </table>
  <p style="margin:8px 0 0;font-size:12px;color:${MUTED};line-height:1.5">Prices are today's buylist estimate for the conditions you chose. Nothing is paid until we have your cards in hand and have verified them. You can see this list's status any time on <a href="${STATUS_PAGE}" style="color:${RED}">our sell page</a> while signed in.</p>
</td></tr>
<tr><td style="padding:10px 28px 26px">${SECTIONS.map(section).join("")}</td></tr>
${mallowHtml()}
<tr><td style="background:${PAPER};padding:16px 28px;font-size:12px;color:${MUTED};line-height:1.6">Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6 · <a href="mailto:${REPLY_TO}" style="color:${MUTED}">${REPLY_TO}</a><br>You are receiving this because a buylist was submitted from your Exor Games account. Reply to this email if that was not you.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${BRAND} - we have your buylist`, `Buylist Number: ${ref}`, "",
    first ? `Hi ${first},` : "Hello,", "", NEXT_STEP, "",
    `Cards: ${t.units} · Paid as: ${rec.paymentType} · Estimated total: ${money(total)}`, "",
    ...cards.map((c) => `${qty(c)} x ${c.cardName} [${c.setName}] ${c.conditionName || c.condition}${c.type && c.type !== "Normal" ? " " + c.type : ""} @ ${money(each(c))} = ${money(qty(c) * (Number(each(c)) || 0))}`),
    `Estimated ${credit ? "store credit" : "cash"} total: ${money(total)}`, "",
    `Prices are today's buylist estimate; nothing is paid until we have verified your cards. Status: ${STATUS_PAGE}`, "",
    ...SECTIONS.flatMap((s) => [s.h.toUpperCase(), ...s.p.map((p) => linkify(p, false)), ...(s.address ? ["", ...ADDRESS] : []), ""]),
    mallowText(), "",
    `Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6 · ${REPLY_TO}`,
  ].join("\n");

  return { subject, html, text };
}

// The email staff can choose to send when a list is approved or rejected
// (owner, 2026-09-22: staff ENABLE the customer getting an email at this
// stage). Same look as the confirmation; the list at the prices it was
// decided at, and for a rejection the reason the customer was given.
export function buildDecisionEmail(rec, kind) {
  const approved = kind === "approved";
  const ref = rec.number || rec.id;
  const first = String(rec.customerName || "").trim().split(/\s+/)[0] || "";
  const credit = rec.paymentType === "Store Credit";
  const cards = Array.isArray(rec.cards) ? rec.cards : [];
  const t = rec.totals || { cash: 0, credit: 0, units: 0, lines: cards.length };
  const total = credit ? t.credit : t.cash;
  const each = (c) => credit ? c.storeCreditBuyPrice : c.cashBuyPrice;
  const reason = String(rec.customerNote || "").trim();
  const subject = approved ? `Your buylist ${ref} has been approved (${BRAND})` : `About your buylist ${ref} (${BRAND})`;
  const headline = approved ? "Your buylist is approved" : "We could not accept this buylist";
  const lead = approved
    ? `We have checked your list and sent it through. ${credit ? "The store credit" : "Your payment"} is applied once we have your cards in hand and have verified them${rec.bp && rec.bp.number ? " (store reference " + esc(rec.bp.number) + ")" : ""}.`
    : `We looked at your list and could not accept it as submitted.${reason ? " Reason: <strong>" + esc(reason) + "</strong>." : ""} You are welcome to submit a new list from our sell page.`;
  const rows = cards.map((c, i) => `<tr style="background:${i % 2 ? PAPER : "#ffffff"}"><td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap">${qty(c)} ×</td><td style="padding:8px 10px;border-bottom:1px solid ${RULE}"><strong>${esc(c.cardName)}</strong><br><span style="color:${MUTED};font-size:12px">${esc(c.setName)} · ${esc(c.conditionName || c.condition)}${c.type && c.type !== "Normal" ? " · " + esc(c.type) : ""}</span></td><td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap">${money(each(c))}</td><td style="padding:8px 10px;border-bottom:1px solid ${RULE};text-align:right;white-space:nowrap"><strong>${money(qty(c) * (Number(each(c)) || 0))}</strong></td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${approved ? "#0d7a5f" : RED};padding:22px 28px;color:#ffffff">
  <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.9">9Pocket by <img src="${LOGO}" alt="Exor Games" width="44" height="32" style="vertical-align:middle;height:32px;width:auto;margin-left:2px"></div>
  <div style="font-size:26px;font-weight:700;line-height:1.2;margin-top:4px">${headline}</div>
  <div style="font-size:15px;margin-top:6px;opacity:.95">Buylist Number <strong style="font-size:17px">${esc(ref)}</strong></div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
  <p style="margin:0 0 14px;font-size:16px">${first ? "Hi " + esc(first) + "," : "Hello,"}</p>
  <p style="margin:0 0 14px;line-height:1.55">${lead}</p>
  ${approved ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0"><tr>
    <td style="padding:0 8px 0 0"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Cards</div><div style="font-size:20px;font-weight:700">${t.units}</div></td>
    <td style="padding:0 8px"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Paid as</div><div style="font-size:20px;font-weight:700">${esc(rec.paymentType)}</div></td>
    <td style="padding:0 0 0 8px;text-align:right"><div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em">Total</div><div style="font-size:20px;font-weight:700;color:${RED}">${money(total)}</div></td>
  </tr></table>` : ""}
</td></tr>
<tr><td style="padding:6px 28px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <thead><tr style="color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.06em"><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Qty</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid ${RULE}">Card</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Each</th><th style="text-align:right;padding:6px 10px;border-bottom:2px solid ${RULE}">Line</th></tr></thead>
  <tbody>${rows}</tbody>
  ${approved ? `<tfoot><tr><td colspan="3" style="padding:10px;text-align:right;font-weight:700">${credit ? "Store credit" : "Cash"} total</td><td style="padding:10px;text-align:right;font-weight:700;color:${RED};white-space:nowrap">${money(total)}</td></tr></tfoot>` : ""}
  </table>
</td></tr>
<tr><td style="padding:16px 28px 26px">${approved ? `<h2 style="margin:10px 0 8px;font-size:17px;line-height:1.3;color:${RED}">Bring or mail your cards to us</h2><p style="margin:0 0 10px;line-height:1.55">If they are not with us yet: visit the shop, or mail them with the Buylist Number and your name to</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 4px"><tr><td style="border-left:4px solid ${RED};padding:6px 14px;font-size:15px;line-height:1.5"><strong>${ADDRESS[0]}</strong><br>${ADDRESS.slice(1).map(esc).join("<br>")}</td></tr></table>` : ""}<p style="margin:14px 0 0;line-height:1.55">Questions? Reply to this email or write to <a href="mailto:${REPLY_TO}" style="color:${RED}">${REPLY_TO}</a>.</p></td></tr>
<tr><td style="background:${PAPER};padding:16px 28px;font-size:12px;color:${MUTED};line-height:1.6">Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6 · <a href="mailto:${REPLY_TO}" style="color:${MUTED}">${REPLY_TO}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${BRAND} - ${headline.toLowerCase()}`, `Buylist Number: ${ref}`, "",
    first ? `Hi ${first},` : "Hello,", "", lead.replace(/<[^>]+>/g, ""), "",
    ...cards.map((c) => `${qty(c)} x ${c.cardName} [${c.setName}] ${c.conditionName || c.condition}${c.type && c.type !== "Normal" ? " " + c.type : ""} @ ${money(each(c))} = ${money(qty(c) * (Number(each(c)) || 0))}`),
    ...(approved ? [`${credit ? "Store credit" : "Cash"} total: ${money(total)}`, "", "Bring or mail your cards to us:", ...ADDRESS] : []),
    "", `Questions? ${REPLY_TO}`,
  ].join("\n");
  return { subject, html, text };
}

/* ---- a staff notice (the auto-pricing digest, 2026-09-22) ----------------
   The same paper as the customer mail, but the body is the digest's own
   short lines, one per price move, keeping the marks the ntfy push uses
   (⚠ flagged, ↑ up, ↓ down, ⏳ waiting, ✖ failed) and colouring them. It
   is internal mail: no reply-to, no shop address, no unsubscribe. */
const MARK = { "⚠": "#b45309", "✖": "#b91c1c", "⏳": "#1e3a8a", "↑": "#14532d", "↓": "#b91c1c" };

export function buildNoticeEmail(n) {
  const subject = String(n.subject || "Exor Games");
  const lines = (n.lines || []).map((l) => String(l == null ? "" : l)).filter((l) => l !== "");
  const colour = (l) => MARK[[...l.trimStart()][0]] || INK;
  const row = (l, i) => `<tr><td style="padding:7px 10px;border-bottom:1px solid ${RULE};background:${i % 2 ? PAPER : "#ffffff"};color:${colour(l)};font-size:14px;line-height:1.4">${esc(l)}</td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${INK};padding:16px 28px"><img src="${LOGO}" width="132" alt="${esc(BRAND)}" style="display:block;border:0;height:auto"></td></tr>
<tr><td style="padding:22px 28px 6px"><h1 style="margin:0;font-size:19px;line-height:1.3;color:${INK}">${esc(n.heading || subject)}</h1>${n.sub ? `<p style="margin:6px 0 0;color:${MUTED};font-size:13px">${esc(n.sub)}</p>` : ""}</td></tr>
<tr><td style="padding:12px 18px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${RULE};border-radius:10px;overflow:hidden">${lines.map(row).join("")}</table></td></tr>
${n.click ? `<tr><td style="padding:16px 28px 26px"><a href="${esc(n.click)}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">${esc(n.clickLabel || "Open the page")}</a></td></tr>` : ""}
<tr><td style="background:${PAPER};padding:14px 28px;font-size:12px;color:${MUTED};line-height:1.6">${esc(n.foot || "Sent by the Exor Games worker. Staff notice - customers never see this.")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [n.heading || subject, ...(n.sub ? ["", n.sub] : []), "", ...lines, ...(n.click ? ["", (n.clickLabel || "Open the page") + ": " + n.click] : [])].join("\n");
  return { subject, html, text };
}

/* Resend's send call. Returns what the record keeps: never the key.
   `to` is one address or a list of them (staff notices go to a few).
   opts: { replyTo: null } drops the customer reply-to for internal mail,
   { fetchFn } injects fetch for the tests. */
export async function sendEmail(env, to, msg, opts) {
  const o = opts || {};
  if (!emailConfigured(env)) return { ok: false, status: "unconfigured", error: "RESEND_API_KEY is not set on the worker" };
  const list = (Array.isArray(to) ? to : [to]).map((a) => String(a || "").trim()).filter(Boolean);
  const bad = list.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (!list.length || bad.length) return { ok: false, status: "no-address", error: list.length ? "not an email address: " + bad.join(", ").slice(0, 120) : "no email address for this customer" };
  const replyTo = o.replyTo === undefined ? REPLY_TO : o.replyTo;
  const f = o.fetchFn || fetch;
  try {
    const r = await f("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + String(env.RESEND_API_KEY).trim() },
      body: JSON.stringify({ from: emailFrom(env), to: list, ...(replyTo ? { reply_to: replyTo } : {}), subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: "failed", error: "HTTP " + r.status + (j && j.message ? " " + String(j.message).slice(0, 160) : "") };
    return { ok: true, status: "sent", id: j && j.id ? String(j.id).slice(0, 64) : "" };
  } catch (e) { return { ok: false, status: "failed", error: String((e && e.message) || e).slice(0, 160) }; }
}
