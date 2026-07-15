/* Playwright smoke test: renders TV + phone against the local stub room,
   captures screenshots, reports console errors and spread parity. */
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"));
const BASE = "http://localhost:8787";
const OUT = __dirname + "/shots";
require("fs").mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const errs = { tv: [], phone: [] };

  // --- TV (1080p) ---
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  tv.on("pageerror", (e) => errs.tv.push("pageerror: " + e.message));
  tv.on("console", (m) => { if (m.type() === "error" && !/net::|Failed to load resource/.test(m.text())) errs.tv.push(m.text()); });
  await tv.goto(BASE + "/tv", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await tv.waitForTimeout(1800);
  await tv.screenshot({ path: OUT + "/tv-mtg-8col.png" });

  // --- phone pairs (390x844) ---
  const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const ph = await phCtx.newPage();
  ph.on("pageerror", (e) => errs.phone.push("pageerror: " + e.message));
  ph.on("console", (m) => { if (m.type() === "error" && !/net::|Failed to load resource/.test(m.text())) errs.phone.push(m.text()); });
  await ph.goto(BASE + "/c/EX-TEST", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await ph.waitForTimeout(1500);
  await ph.screenshot({ path: OUT + "/phone-mtg-3col-tabs.png" });

  // spread parity
  const tvSpreads = await tv.evaluate(() => ({ spreads, tray: TRAY, cols: COLS }));
  const phSpreads = await ph.evaluate(() => ({ spreads, tray: TRAY, cols: COLS }));
  console.log("TV:", JSON.stringify(tvSpreads), " PHONE:", JSON.stringify(phSpreads),
    tvSpreads.spreads === phSpreads.spreads && tvSpreads.tray === phSpreads.tray ? "PARITY-OK" : "PARITY-FAIL");
  const tabInfo = await ph.evaluate(() => [...document.querySelectorAll(".ptab")].map((b) => b.textContent + (b.className.includes("on") ? "*" : "")));
  console.log("phone tabs:", JSON.stringify(tabInfo));

  // --- switch to Pokémon from the PHONE tab ---
  await ph.evaluate(() => switchTab(1));
  await tv.waitForTimeout(2200); await ph.waitForTimeout(300);
  await tv.screenshot({ path: OUT + "/tv-pokemon-theme.png" });
  await ph.screenshot({ path: OUT + "/phone-pokemon.png" });
  const pkmLanes = await tv.evaluate(() => [...new Set(CARDS.map((c) => c.color))]);
  console.log("tv pokemon lanes:", JSON.stringify(pkmLanes));

  // --- switch to Yu-Gi-Oh ---
  await ph.evaluate(() => switchTab(2));
  await tv.waitForTimeout(2200);
  await tv.screenshot({ path: OUT + "/tv-yugioh-theme.png" });
  const ygoLanes = await tv.evaluate(() => [...new Set(CARDS.map((c) => c.color))]);
  console.log("tv yugioh lanes:", JSON.stringify(ygoLanes));

  // --- toploader mode ON (admin patch) ---
  await tv.evaluate(async () => {
    await fetch("/admin/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "4242", patch: { topLoaders: true } }) });
  });
  await tv.waitForTimeout(1500);
  await tv.screenshot({ path: OUT + "/tv-yugioh-toploaders.png" });
  // back to MTG + TL for the money shot
  await ph.evaluate(() => switchTab(0));
  await tv.waitForTimeout(2200);
  await tv.screenshot({ path: OUT + "/tv-mtg-toploaders.png" });

  // measure: in TL mode the art (.scan/.card box) vs sleeve (::after) sizes
  const tl = await tv.evaluate(() => {
    const card = document.querySelector(".card.intl");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card, "::after");
    return { cardW: +r.width.toFixed(1), cardH: +r.height.toFixed(1), afterInset: cs.inset || cs.top, overflow: getComputedStyle(card).overflow };
  });
  console.log("toploader card:", JSON.stringify(tl));

  // featured-card zoom in TL mode
  await ph.evaluate(() => { const k = CARDS[2] && (CARDS[2].variantId || CARDS[2].name); if (k) PICK(String(k)); });
  await tv.waitForTimeout(900);
  await tv.screenshot({ path: OUT + "/tv-feature-toploader.png" });

  // --- admin page ---
  const ad = await tvCtx.newPage();
  await ad.goto(BASE + "/admin", { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
  await ad.fill("#pin", "4242");
  await ad.click("#unlock");
  await ad.waitForTimeout(800);
  await ad.screenshot({ path: OUT + "/admin-three-collections.png", fullPage: true });

  console.log("tv errors:", JSON.stringify(errs.tv));
  console.log("phone errors:", JSON.stringify(errs.phone));
  await browser.close();
})();
