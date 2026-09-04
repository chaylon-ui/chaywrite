/* Browser test of the Exor Games buylist. Three parts:
   1. plain fetches of the worker's routes, including the api ones the shop
      page uses (games, sets with symbols, search paging, CORS preflight)
   2. the standalone test page (/buylist/poc/, the owner's own list): games,
      set symbols, search, add + toast, saved draft, undo, a typed partial
      set name, browsing a set, show more. Never submits.
   3. the sell page on the PREVIEW theme, logged out: our section is there
      with its log-in prompt, its assets load, the tiles point at it.
   Uses the runner's own Chrome through playwright-core. */
import { chromium } from "playwright-core";

const BASE = process.env.POC_BASE || "https://exor-binder.nevski.workers.dev";
const SHOP = "https://exorgames.com";
const PREVIEW = "157462692013";
const SELL = "/pages/selling-to-exor-games-buylist";
const OWNER = "3957471740057";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const ok = (m) => console.log("  ok   " + m);

// 1. plain fetches
async function probe(label, url, init) {
  try {
    const r = await fetch(url, { redirect: "manual", ...(init || {}) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { label, status: r.status, headers: r.headers, text, json };
  } catch (e) { return { label, status: 0, headers: new Headers(), text: String(e.message), json: null }; }
}
const line = (p, extra) => console.log(p.label + ": HTTP " + p.status + (extra ? "  " + extra : ""));

let p = await probe("GET /buylist/poc/", BASE + "/buylist/poc/"); line(p, p.text.length + "B"); if (p.status !== 200) fail("test page");
p = await probe("GET /buylist.css", BASE + "/buylist.css"); line(p, p.text.length + "B"); if (p.status !== 200) fail("css");
p = await probe("GET /buylist.js", BASE + "/buylist.js"); line(p, p.text.length + "B"); if (p.status !== 200) fail("js");
p = await probe("GET /buylist/api/games", BASE + "/buylist/api/games");
line(p, JSON.stringify(p.json && (p.json.games || p.json.raw)).slice(0, 500)); if (!(p.json && p.json.count > 0)) fail("no games");
p = await probe("GET /buylist/api/sets?game=mtg", BASE + "/buylist/api/sets?game=mtg");
const firstIcon = p.json && Array.isArray(p.json.sets) ? p.json.sets.find((s) => s.icon) : null;
line(p, "sets=" + (p.json && p.json.count) + " withIcon=" + (p.json && p.json.withIcon) + " e.g. " + JSON.stringify(firstIcon));
if (!(p.json && p.json.count > 500)) fail("set list short"); if (!(p.json && p.json.withIcon > 300)) fail("few set symbols");
p = await probe("GET /buylist/api/list (no customer)", BASE + "/buylist/api/list"); line(p, p.text.replace(/\s+/g, " ").slice(0, 60)); if (p.status !== 400) fail("list without a customer should be 400");
p = await probe("GET /buylist/api/list?customer=owner", BASE + "/buylist/api/list?customer=" + OWNER);
line(p, "draft=" + (p.json && Array.isArray(p.json.list) ? p.json.list.length + " card(s)" : p.text.slice(0, 80))); if (p.status !== 200) fail("list for the owner");
p = await probe("GET /buylist/api/search offset=20", BASE + "/buylist/api/search?q=Lightning%20Bolt&offset=20");
line(p, "count=" + (p.json && p.json.count) + " more=" + (p.json && p.json.more)); if (!(p.json && p.json.count > 0)) fail("second page empty");
p = await probe("OPTIONS /buylist/api/save from exorgames.com", BASE + "/buylist/api/save", { method: "OPTIONS", headers: { origin: SHOP, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
line(p, "allow-origin=" + p.headers.get("access-control-allow-origin")); if (p.status !== 204 || p.headers.get("access-control-allow-origin") !== SHOP) fail("CORS preflight for the shop");
p = await probe("OPTIONS /buylist/api/save from elsewhere", BASE + "/buylist/api/save", { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } });
line(p, "allow-origin=" + p.headers.get("access-control-allow-origin")); if (p.headers.get("access-control-allow-origin")) fail("CORS open to other origins");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

// 2. the standalone test page
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push("http " + r.status() + " " + r.url()); });
  const res = await page.goto(BASE + "/buylist/poc/", { waitUntil: "load", timeout: 60000 }).catch(() => null);
  console.log("\ntest page: HTTP " + (res ? res.status() : "none") + "  title: " + (await page.title()));
  if (!res || res.status() !== 200) fail("test page did not load");
  try {
    const snap = () => page.evaluate(() => Array.from(document.querySelectorAll("input.bl__qty")).map((i) => parseInt(i.value, 10) || 0));
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const status = () => page.locator("#bl-status").textContent();
    const settled = () => page.waitForFunction(() => !/Searching|Loading more/.test(document.querySelector("#bl-status").textContent), null, { timeout: 45000 });
    await page.waitForFunction(() => document.querySelector("#bl-lines") && !/Loading/.test(document.querySelector("#bl-lines").textContent), null, { timeout: 30000 }).catch(() => fail("cart never finished loading"));
    await page.waitForFunction(() => document.querySelectorAll("#bl-game option").length >= 1 && document.querySelectorAll("#bl-sets option").length > 500, null, { timeout: 30000 }).catch(() => fail("games or sets never loaded"));
    console.log("games in select: " + JSON.stringify(await page.locator("#bl-game option").evaluateAll((os) => os.map((o) => o.value + "=" + o.textContent))).slice(0, 400));
    console.log("sets in datalist: " + (await page.locator("#bl-sets option").count()) + "; selected game: " + (await page.locator("#bl-game").inputValue()));
    const qBefore = await snap();
    console.log("cart on load: " + qBefore.length + " line(s), " + sum(qBefore) + " card(s)");

    await page.fill("#bl-q", "Lightning Bolt");
    await page.press("#bl-q", "Enter");
    await settled().catch(() => fail("search never finished"));
    const hits = await page.locator(".bl__hit").count();
    const first = ((await page.locator(".bl__hit .bl__name").first().textContent().catch(() => "")) || "").trim();
    const firstSet = await page.locator(".bl__hit").first().getAttribute("data-set").catch(() => null);
    const icons = await page.locator(".bl__hit .bl__seticon").count();
    console.log("hits: " + hits + ", first: " + first + " (" + firstSet + "), set symbols shown: " + icons + ", show more offered: " + !(await page.locator("#bl-more").isHidden()));
    if (!/lightning bolt/i.test(first)) fail("first hit is not Lightning Bolt");
    if (!icons) fail("no set symbols in the results");
    const offers = await page.locator("button.bl__add:not([disabled])").count();
    if (!offers) fail("no offer to add");

    if (offers) {
      const isSave = (r) => r.url().includes("/save") && r.request().method() === "POST";
      const saved = page.waitForResponse(isSave, { timeout: 30000 });
      await page.locator("button.bl__add:not([disabled])").first().click();
      await page.waitForSelector("#bl-toast.bl__toast--show", { timeout: 5000 })
        .then(async () => console.log("toast: " + JSON.stringify(await page.locator("#bl-toast").textContent())))
        .catch(() => fail("no toast after add"));
      const sr = await saved.catch(() => null);
      const body = sr ? await sr.json().catch(() => ({})) : {};
      console.log("save after add: HTTP " + (sr ? sr.status() : "none") + " reply=" + JSON.stringify(body.reply || body).slice(0, 140));
      if (!sr || sr.status() !== 200 || !(body.reply && body.reply.actionPass)) fail("draft save did not succeed");
      const qAfter = await snap();
      if (sum(qAfter) !== sum(qBefore) + 1) fail("cart total did not go up by one");
      const list = await (await fetch(BASE + "/buylist/poc/list")).json();
      const serverQty = Array.isArray(list.list) ? list.list.reduce((s, c) => s + (parseInt(c.quantity, 10) || 0), 0) : -1;
      console.log("cart after add: " + sum(qAfter) + " card(s); draft on BinderPOS: " + serverQty);
      if (serverQty !== sum(qAfter)) fail("BinderPOS draft does not match the cart");
      const idx = qAfter.length > qBefore.length ? qAfter.length - 1 : qAfter.findIndex((v, i) => v !== qBefore[i]);
      const ln = page.locator(".bl__line").nth(idx);
      const undo = page.waitForResponse(isSave, { timeout: 30000 });
      await (qAfter[idx] > 1 ? ln.locator("button.bl__dec") : ln.locator("button.bl__remove")).click();
      await undo.catch(() => null);
      const qUndo = await snap();
      console.log("after undo: " + qUndo.length + " line(s), " + sum(qUndo) + " card(s)");
      if (JSON.stringify(qUndo) !== JSON.stringify(qBefore)) fail("cart not back to where it started");
    }

    // a typed, partial set name
    if (firstSet) {
      const partial = firstSet.slice(0, Math.max(6, Math.floor(firstSet.length * 0.6))).toLowerCase();
      await page.fill("#bl-set", partial);
      await page.press("#bl-q", "Enter");
      await settled().catch(() => fail("set search never finished"));
      const resolved = await page.locator("#bl-set").inputValue();
      const seen = await page.locator(".bl__hit").evaluateAll((els) => els.map((e) => e.getAttribute("data-set")));
      const pick = !(await page.locator("#bl-setpick").isHidden());
      console.log("typed " + JSON.stringify(partial) + " -> " + JSON.stringify(resolved) + "; " + seen.length + " hit(s), other sets: " + seen.filter((s) => s !== firstSet).length + "; symbol beside the box: " + pick + "; " + (await status()));
      if (resolved !== firstSet) fail("typed set did not resolve to " + firstSet);
      if (!seen.length || seen.some((s) => s !== firstSet)) fail("set filter did not narrow to the chosen set");
      await page.fill("#bl-q", "");
      await page.press("#bl-q", "Enter");
      await settled().catch(() => fail("set browse never finished"));
      const browse = await page.locator(".bl__hit").evaluateAll((els) => els.map((e) => e.getAttribute("data-set")));
      console.log("browse the set with no card name: " + browse.length + " hit(s), other sets: " + browse.filter((s) => s !== firstSet).length);
      if (!browse.length || browse.some((s) => s !== firstSet)) fail("set browse did not work");
    }

    // show more
    await page.fill("#bl-set", "");
    await page.fill("#bl-q", "Bolt");
    await page.press("#bl-q", "Enter");
    await settled().catch(() => fail("search never finished"));
    const before = await page.locator(".bl__hit").count();
    const moreVisible = !(await page.locator("#bl-more").isHidden());
    console.log("\"Bolt\": " + before + " hit(s), show more offered: " + moreVisible);
    if (moreVisible) {
      await page.click("#bl-more");
      await settled().catch(() => fail("show more never finished"));
      const after = await page.locator(".bl__hit").count();
      console.log("after show more: " + after + " hit(s); " + (await status()));
      if (after <= before) fail("show more added nothing");
    } else fail("no show more for a full first page");
  } catch (e) { fail("test page flow threw: " + e.message); }
  if (errors.length) { console.log("browser errors:"); errors.forEach((e) => console.log("  " + e)); fail(errors.length + " browser error(s) on the test page"); }
  else ok("no browser errors on the test page");
  await page.close();
}

// 3. the sell page on the preview theme, logged out
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [], assets = {};
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { const u = r.url(); if (/\/buylist\.(css|js)(\?|$)/.test(u)) assets[u.split("/").pop()] = r.status(); });
  // The preview switch is a cookie set by the first response; the context keeps it.
  await page.goto(SHOP + "/?preview_theme_id=" + PREVIEW, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  const res = await page.goto(SHOP + SELL + "?preview_theme_id=" + PREVIEW, { waitUntil: "load", timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const theme = await page.evaluate(() => (window.Shopify && window.Shopify.theme && window.Shopify.theme.id) || null).catch(() => null);
  console.log("\nsell page: HTTP " + (res ? res.status() : "none") + "  theme " + theme + (String(theme) === PREVIEW ? " (the preview)" : " (NOT the preview)"));
  if (String(theme) !== PREVIEW) fail("not on the preview theme");
  const section = await page.locator("#buylist.xg-buylist").count();
  const loginLink = page.locator('#buylist .xg-buylist__login a[href*="/account/login"]');
  const login = await loginLink.count();
  const tiles = await page.locator('.xg-page__body a[href="#buylist"]').count();
  const mounted = await page.locator("#buylist[data-mounted]").count();
  console.log("section: " + section + ", log-in prompt: " + login + " (" + (login ? await loginLink.first().getAttribute("href") : "") + "), tiles pointing at it: " + tiles + ", app mounted while logged out: " + mounted + ", assets: " + JSON.stringify(assets));
  if (!section) fail("no #buylist section on the sell page");
  if (!login) fail("no log-in prompt for a logged-out visitor");
  if (mounted) fail("the app mounted without a customer");
  if (assets["buylist.css"] !== 200 || assets["buylist.js"] !== 200) fail("buylist assets did not load from the worker");
  if (tiles < 6) fail("expected the six game tiles to point at #buylist");
  if (errors.length) { console.log("page errors:"); errors.forEach((e) => console.log("  " + e)); }
  else ok("no page errors on the sell page");
  await ctx.close();
}

await browser.close();
console.log(fails ? "BUYLIST-E2E FAILS " + fails : "BUYLIST-E2E OK");
process.exit(fails ? 1 : 0);
