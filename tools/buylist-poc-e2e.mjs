/* Drives the buylist proof-of-concept page in the runner's own Chrome:
   load, search, add the first offer, see the draft saved on BinderPOS,
   then undo the add so the owner's draft is left as it was. Never
   submits. First prints plain fetches of the routes, and how BinderPOS's
   own page names the store-credit payment type. */
import { chromium } from "playwright-core";

const BASE = process.env.POC_BASE || "https://exor-binder.nevski.workers.dev";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const STORE_ID = "a648e57a-678f-45eb-bae0-f8deb7940192";
const OWNER = "3957471740057";
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const ok = (m) => console.log("  ok   " + m);
const uniq = (a) => a.filter((s, i) => a.indexOf(s) === i);

// 1. plain fetches of the worker routes. The search's "count" field and a
//    400 (not 404) from an empty submit body only exist in the second
//    proof-of-concept module, so they say which worker version is live.
const PROBES = [
  ["/buylist/poc/"], ["/buylist-poc.html"], ["/buylist-poc.js"], ["/buylist/poc/list"],
  ["/buylist/poc/search?q=Lightning%20Bolt&limit=1"],
  ["/buylist/poc/submit", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
];
for (const [p, init] of PROBES) {
  try {
    const r = await fetch(BASE + p, { redirect: "manual", ...(init || {}) });
    const t = await r.text();
    const note = p.includes("/search") ? (t.includes('"count"') ? "  [new module]" : "  [old module]") : "";
    console.log((init ? init.method : "GET") + " " + p + ": HTTP " + r.status + " " + (r.headers.get("content-type") || "") + " " + t.length + "B  " + JSON.stringify(t.slice(0, 90)) + note);
  } catch (e) { console.log("GET " + p + ": " + e.message); }
}

// 2. BinderPOS's own page and script: what the payment-type select sends
try {
  const html = await (await fetch(`https://portal.binderpos.com/external/shopify/${STORE_ID}/buylist?shopifyCustomerId=${OWNER}`)).text();
  console.log("binderpos buylist page: " + html.length + " bytes");
  console.log("  selects: " + JSON.stringify(uniq(html.match(/<select[^>]*>/g) || []).slice(0, 6)));
  console.log("  options: " + JSON.stringify(uniq(html.match(/<option[^>]*>[^<]*/g) || []).slice(0, 12)));
  const js = await (await fetch("https://portal.binderpos.com/shopify/js/buylist.js?v=4")).text();
  console.log("  cashOrStoreCredit assignments: " + JSON.stringify(uniq(js.match(/cashOrStoreCredit=[^,;)]{0,40}/g) || [])));
} catch (e) { console.log("  (could not fetch their page: " + e.message + ")"); }

// 3. the page in a browser
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push("http " + r.status() + " " + r.url()); });
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " " + ((r.failure() || {}).errorText || "")));

const res = await page.goto(BASE + "/buylist/poc/", { waitUntil: "load", timeout: 60000 }).catch(() => null);
console.log("page /buylist/poc/: HTTP " + (res ? res.status() : "none") + "  title: " + (await page.title()));
const pageOk = !!res && res.status() === 200;
if (!pageOk) fail("page did not load: " + ((await page.content().catch(() => "")) || "").slice(0, 200));

try {
  if (pageOk) {
    const snap = () => page.evaluate(() => Array.from(document.querySelectorAll("input.qty")).map((i) => parseInt(i.value, 10) || 0));
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector("#lines").textContent), null, { timeout: 30000 }).catch(() => fail("cart never finished loading"));
    const qBefore = await snap();
    console.log("cart on load: " + qBefore.length + " line(s), " + sum(qBefore) + " card(s)");

    await page.fill("#q", "Lightning Bolt");
    await page.press("#q", "Enter");
    await page.waitForSelector(".hit", { timeout: 45000 }).catch(() => fail("no search results within 45s"));
    const hits = await page.locator(".hit").count();
    const first = ((await page.locator(".hit h3").first().textContent().catch(() => "")) || "").trim();
    console.log("hits: " + hits + ", first: " + first);
    if (!/lightning bolt/i.test(first)) fail("first hit is not Lightning Bolt");
    const offers = await page.locator("button.add:not([disabled])").count();
    console.log("offers with a price: " + offers);
    if (!offers) fail("no offer to add");

    if (offers) {
      const isSave = (r) => r.url().includes("/buylist/poc/save") && r.request().method() === "POST";
      const saved = page.waitForResponse(isSave, { timeout: 30000 });
      await page.locator("button.add:not([disabled])").first().click();
      const sr = await saved.catch(() => null);
      const body = sr ? await sr.json().catch(() => ({})) : {};
      console.log("save after add: HTTP " + (sr ? sr.status() : "none") + " reply=" + JSON.stringify(body.reply || body).slice(0, 160));
      if (!sr || sr.status() !== 200 || !(body.reply && body.reply.actionPass)) fail("draft save did not succeed");
      const qAfter = await snap();
      console.log("cart after add: " + qAfter.length + " line(s), " + sum(qAfter) + " card(s)");
      if (sum(qAfter) !== sum(qBefore) + 1) fail("cart total did not go up by one");
      const list = await (await fetch(BASE + "/buylist/poc/list")).json();
      const serverQty = Array.isArray(list.list) ? list.list.reduce((s, c) => s + (parseInt(c.quantity, 10) || 0), 0) : -1;
      console.log("draft on BinderPOS: " + serverQty + " card(s)");
      if (serverQty !== sum(qAfter)) fail("BinderPOS draft does not match the cart");

      // undo: the line that changed (a new last line, or the one whose count rose)
      const idx = qAfter.length > qBefore.length ? qAfter.length - 1 : qAfter.findIndex((v, i) => v !== qBefore[i]);
      const line = page.locator(".line").nth(idx);
      const undo = page.waitForResponse(isSave, { timeout: 30000 });
      await (qAfter[idx] > 1 ? line.locator("button.dec") : line.locator("button.remove")).click();
      const ur = await undo.catch(() => null);
      const qUndo = await snap();
      console.log("save after undo: HTTP " + (ur ? ur.status() : "none") + "; cart: " + qUndo.length + " line(s), " + sum(qUndo) + " card(s)");
      if (JSON.stringify(qUndo) !== JSON.stringify(qBefore)) fail("cart not back to where it started");
    }
  }
} catch (e) { fail("browser flow threw: " + e.message); }

if (errors.length) { console.log("browser errors:"); errors.forEach((e) => console.log("  " + e)); fail(errors.length + " browser error(s)"); }
else ok("no browser errors");
await browser.close();
console.log(fails ? "POC-E2E FAILS " + fails : "POC-E2E OK");
process.exit(fails ? 1 : 0);
