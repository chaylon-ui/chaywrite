/* The hold-on-arrival shadow log, checked and summarised, so the owner does
   not have to read it by hand. Reads /hold/shadow.json with the worker's
   staff PIN (from src/config.js; never printed) and prints:
     - whether the stage is running and both webhooks are on
     - every BinderPOS cart with buys: its rises, how many seconds after the
       order they landed, and MISSED when a buy cart has no rises at all
     - singles that rose with no cart and no buylist (would not be held),
       and whether any sales-only cart or another rise was near them
     - online buylists matched
   Exit code 1 only when the stage is off or a webhook is missing. */
import { readFileSync } from "node:fs";

const BASE = process.env.POC_BASE || "https://exor-binder.nevski.workers.dev";
const DAYS = Math.max(1, Math.min(30, parseInt(process.env.DAYS, 10) || 7));
// The worker's staff PIN, read as text from its config rather than imported
// (the module is written for the Workers runtime). A HOLD_REPORT_PIN secret
// overrides it once the owner changes the PIN in the admin page.
const PIN = process.env.HOLD_REPORT_PIN
  || ((readFileSync(new URL("../src/config.js", import.meta.url), "utf8").match(/DEFAULT_PIN\s*=\s*["'`]([^"'`]+)/) || [])[1] || "");
const when = (ms) => new Date(ms).toLocaleString("en-CA", { timeZone: "America/Halifax", hour12: false });
let problems = 0;
const problem = (m) => { problems++; console.log("  PROBLEM " + m); };

const health = await (await fetch(BASE + "/hold/health")).json().catch(() => null);
console.log("health: " + JSON.stringify(health));

const r = await fetch(BASE + "/hold/shadow.json?days=" + DAYS + "&k=" + encodeURIComponent(PIN));
if (r.status === 403) { problem("the staff PIN in src/config.js no longer opens the shadow page; set a HOLD_REPORT_PIN secret"); process.exit(1); }
const d = await r.json();
console.log(`mode ${d.mode}, last ${d.days} days, generated ${when(d.generatedAt)}`);
if (d.mode !== "shadow") problem("stage is " + d.mode);
if (!d.hooks || !d.hooks.orders || !d.hooks.inventory) problem("webhooks: " + JSON.stringify(d.hooks));
else console.log("webhooks on, last checked " + when(d.hooks.at) + (d.hooks.errors && d.hooks.errors.length ? " errors " + d.hooks.errors.join("; ") : ""));
console.log("counters: " + JSON.stringify(d.counters));

const orders = d.orders || [];
const buys = orders.filter((o) => o.bought);
const sales = orders.filter((o) => !o.bought);
console.log(`\nBinderPOS carts: ${orders.length} (${buys.length} with buys, ${sales.length} sales-only)`);
let missed = 0;
const offsets = [];
for (const o of buys) {
  const rises = o.rises || [];
  const qty = rises.reduce((s, x) => s + (x.delta || 0), 0);
  console.log(`\ncart ${o.cart} · ${when(o.ts)} · order ${o.name} · ${o.customer || "no customer"} · bought ${o.boughtTotal || "?"} · ${(o.tenders || []).join(" · ")}`);
  console.log(`  ${o.link}`);
  if (!rises.length) { missed++; console.log("  MISSED: no stock rise matched this cart"); continue; }
  console.log(`  ${rises.length} rise(s), ${qty} card(s)${rises.some((x) => x.firstSight) ? " (some first-sight, quantity unknown)" : ""}`);
  for (const x of rises.sort((a, b) => a.ts - b.ts)) {
    if (x.offset != null) offsets.push(x.offset);
    console.log(`    ${when(x.ts)}  ${x.title} · ${x.variantTitle}  ${x.firstSight ? "first sight, now " + x.after : "+" + x.delta + " (" + x.before + "→" + x.after + ")"}  ${x.offset != null ? x.offset + "s after order" : ""}${x.late ? " matched late" : ""}  ${x.verified === false ? "PAYLOAD≠SHOPIFY" : ""}`);
  }
}
if (offsets.length) {
  offsets.sort((a, b) => a - b);
  console.log(`\noffsets between order and stock rise: min ${offsets[0]}s, median ${offsets[Math.floor(offsets.length / 2)]}s, max ${offsets[offsets.length - 1]}s (window ${d.windows.orderLeadS}s before to ${d.windows.orderLagS}s after)`);
  if (offsets[0] < -(d.windows.orderLeadS - 30) || offsets[offsets.length - 1] > d.windows.orderLagS - 15) problem("offsets are close to the window edges; widen the window");
}
if (missed) problem(missed + " buy cart(s) with no matched rise (baseline missing, or the window is wrong)");

const decisions = d.decisions || [];
const none = decisions.filter((x) => x.single && x.reason === "none");
console.log(`\nsingles that rose with no cart and no buylist (would NOT be held): ${none.length}`);
for (const x of none.slice(0, 60)) {
  const nearSale = orders.find((o) => !o.bought && Math.abs(o.ts - x.ts) < 180e3);
  const others = decisions.filter((y) => y !== x && Math.abs(y.ts - x.ts) < 120e3).length;
  console.log(`  ${when(x.ts)}  ${x.title} · ${x.variantTitle}  +${x.delta} (${x.before}→${x.after})  ${x.type}` + (nearSale ? `  near sales-only cart ${nearSale.cart}` : "") + (others ? `  ${others} other change(s) within 2 min` : ""));
}
const bl = decisions.filter((x) => x.reason === "buylist");
console.log(`\nonline buylists: ${(d.buylists || []).length} submitted in the period, ${bl.length} rise(s) matched`);
for (const x of bl.slice(0, 30)) console.log(`  ${when(x.ts)}  ${x.title} · ${x.variantTitle}  +${x.delta}  buylist ${x.buylist}`);
const notSingle = decisions.filter((x) => !x.single).length;
console.log(`\n${notSingle} rise(s) on products that are not singles were ignored; ${decisions.filter((x) => x.firstSight).length} first-sight probable(s) recorded`);
console.log(problems ? `HOLD-REPORT PROBLEMS ${problems}` : "HOLD-REPORT OK");
process.exit(problems && (d.mode !== "shadow" || !d.hooks || !d.hooks.orders) ? 1 : 0);
