/* PLAMOD -> data/plamod.json (read by the worker's nightly sweep, src/plamod.js).

   Owner, 2026-09-23: official photos for our Gunpla, figures and blind boxes
   from PLAMOD, the distributor we buy them from - "Let's do it, add all
   photos if you can", facts too, "but make sure any case language isn't
   included" (blind boxes are sold one at a time, not by the case).

   Signs in to the retailer portal with the owner's account (env PCO / PUS /
   PPW from Actions secrets), reads our work list from the worker
   (/plamod/targets.json: every active Gunpla / Figures / Blind Box product,
   its barcode and its current photos), and for each barcode not checked
   recently: searches the portal, opens the one product whose barcode
   matches, and records
     - its photos (full-size public files on images.plamod.com), minus any
       that is the same picture as a photo the product already has (compared
       by a 64-bit difference hash, so our renamed or resized box art counts);
     - release date, series and brand - and nothing that talks about cases,
       cartons, display boxes or pack counts.
   NEVER records or prints prices, stock, descriptions, cookies or the
   secrets: this repo and its logs are public. Only navigates; never clicks
   cart / preorder / notify.

   Incremental: a found product is re-checked after 30 days, a miss after 14,
   so after the first pass a run only looks at new products. Time budget per
   run; the next run carries on. */
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const OUT = "data/plamod.json";
const W = "https://exor-binder.nevski.workers.dev";
const DRY = process.env.DRY_RUN === "true";
const LIMIT = parseInt(process.env.LIMIT || "0", 10);
const ONLY = (process.env.BARCODES || "").split(",").map((s) => s.trim()).filter(Boolean);
const BUDGET_MS = parseInt(process.env.BUDGET_MIN || "40", 10) * 60 * 1000;
const TABS = 2;                     // two pages at once, each at most one load a second
const DAY = 86400000;
const SECRETS = [process.env.PCO, process.env.PUS, process.env.PPW].filter((s) => s && s.length > 2);
const clean = (s) => { s = String(s); for (const x of SECRETS) s = s.split(x).join("[secret]"); return s.replace(/\$\s?\d[\d,.]*/g, "$[x]"); };
const log = (...a) => console.log(clean(a.join(" ")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = /\/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})(?:-[A-Z])?\.(png|jpe?g|webp)/;

// "case of 12", "display box", "carton", "12 pcs", "assortment", "set of 6" ...
export const CASE_WORDS = /\b(cases?|cartons?|display(?:\s*box)?|box(?:es)?\s+of|sets?\s+of|packs?\s+of|\d+\s*(?:pcs?|pieces|packs?|boxes)|assort(?:ment|ed)?|inner|master\s*pack|bulk)\b/i;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// "December 1, 2016" -> "2016-12" (the 1st is PLAMOD's "some day that month"); "May 30, 2023" -> "2023-05-30"
export function isoRelease(s) {
  const m = String(s || "").match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return "";
  const y = +m[3], mo = MONTHS[m[1].toLowerCase()], d = +m[2];
  if (y < 2001) return "";           // 2000-01-01 is PLAMOD's "unknown"
  const mm = String(mo).padStart(2, "0");
  return d === 1 ? `${y}-${mm}` : `${y}-${mm}-${String(d).padStart(2, "0")}`;
}
export const fact = (s) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s && s.length <= 80 && !CASE_WORDS.test(s) ? s : ""; };

// 64-bit difference hash of a picture: same image at another size or
// compression lands within a few bits; a different photo is ~30 bits away.
async function dhash(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const px = await sharp(Buffer.from(await r.arrayBuffer())).flatten({ background: "#ffffff" }).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}
const bits = (a, b) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
const SAME = 8;

async function main() {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  const items = data.items || {};
  const tj = await (await fetch(W + "/plamod/targets.json", { signal: AbortSignal.timeout(400000) })).json();
  if (!tj.items) throw new Error("targets: " + JSON.stringify(tj).slice(0, 200));
  const now = Date.now();
  const stale = (e) => !e || !e.checked || now - Date.parse(e.checked) > (e.found ? 30 : 14) * DAY;
  let todo = tj.items.filter((t) => t.barcode && (ONLY.length ? ONLY.includes(t.barcode) : stale(items[t.barcode])));
  log("targets", tj.count, "| in the file", Object.keys(items).length, "| to look up", todo.length);
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);
  if (!todo.length) { log("nothing to do"); return; }

  const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const first = await browser.newPage();
  await first.goto("https://www.plamod.com/retailer-sign-in", { waitUntil: "networkidle2", timeout: 60000 });
  const vis = [];
  for (const h of await first.$$("input")) if (await h.evaluate((e) => e.offsetParent !== null && !["hidden", "checkbox", "submit", "password"].includes(e.type))) vis.push(h);
  if (vis.length >= 2) { await vis[0].type(process.env.PCO || ""); await vis[1].type(process.env.PUS); } else if (vis[0]) await vis[0].type(process.env.PUS);
  await (await first.$("input[type=password]")).type(process.env.PPW);
  await Promise.all([first.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => null), first.keyboard.press("Enter")]);
  for (let i = 0; i < 20 && /sign-in/.test(first.url()); i++) await sleep(1000);
  if (/sign-in/.test(first.url())) throw new Error("sign-in failed (still on the sign-in page)");
  log("signed in");

  const tally = { looked: 0, found: 0, notFound: 0, ambiguous: 0, photos: 0, sameAsOurs: 0, errors: 0 };
  const t0 = Date.now();
  let next = 0, saved = 0;
  async function worker(page) {
    let last = 0;
    const go = async (url) => { const w = 1000 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now(); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); };
    while (next < todo.length && Date.now() - t0 < BUDGET_MS) {
      const t = todo[next++];
      tally.looked++;
      try {
        await go("https://www.plamod.com/retailer/search?q=" + t.barcode);
        // "No products found" shows until the results arrive - wait for the barcode
        await page.waitForFunction((bc) => (document.body.innerText || "").includes("Barcode: " + bc), { timeout: 10000 }, t.barcode).catch(() => null);
        const hits = await page.evaluate((bc) => {
          const out = new Set();
          for (const a of document.querySelectorAll('a[href*="/retailer/products/"]')) {
            let card = a;
            for (let i = 0; i < 6 && card && !(card.innerText || "").includes("Barcode"); i++) card = card.parentElement;
            if (card && (card.innerText || "").includes("Barcode: " + bc)) out.add(a.getAttribute("href").split("?")[0]);
          }
          return [...out];
        }, t.barcode);
        if (hits.length !== 1) {
          tally[hits.length ? "ambiguous" : "notFound"]++;
          items[t.barcode] = { found: false, checked: new Date().toISOString(), why: hits.length ? "ambiguous" : "not on PLAMOD" };
          continue;
        }
        await go("https://www.plamod.com" + hits[0]);
        await page.waitForFunction((bc) => (document.body.innerText || "").includes(bc) && document.querySelector('img[src*="images.plamod.com"]'), { timeout: 12000 }, t.barcode).catch(() => null);
        await sleep(800);
        const info = await page.evaluate(() => ({
          text: document.body.innerText.replace(/\s+/g, " "),
          imgs: [...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src).filter((u) => /images\.plamod\.com/.test(u)),
        }));
        if (!info.text.includes("Barcode " + t.barcode)) { tally.ambiguous++; items[t.barcode] = { found: false, checked: new Date().toISOString(), why: "barcode not on the product page" }; continue; }
        const seen = new Set(), photos = [];
        for (const u of info.imgs) {
          const m = u.match(KEY);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          photos.push({ key: m[1], url: u.replace(/-[A-Z]\.(png|jpe?g|webp)(\?.*)?$/, ".$1") });
        }
        // same picture as one of ours (not already matched by name)?
        const ourKeys = new Set(t.keys || []);
        const ourOthers = (t.urls || []).filter((u) => !KEY.test(u.split("?")[0].replace(/_[0-9a-f-]{36}(?=\.)/, "")));
        const dup = [];
        if (ourOthers.length) {
          const ours = [];
          for (const u of ourOthers.slice(0, 6)) { try { ours.push(await dhash(u.split("?")[0] + "?width=300")); } catch {} }
          for (const p of photos) {
            if (ourKeys.has(p.key)) continue;
            try { const h = await dhash(p.url.replace(/\.(png|jpe?g|webp)$/, "-S.$1")); if (ours.some((o) => bits(o, h) <= SAME)) dup.push(p.key); } catch {}
          }
        }
        const pick = (re) => { const m = info.text.match(re); return m ? m[1].trim() : ""; };
        const entry = {
          found: true, checked: new Date().toISOString(),
          sku: pick(/SKU (\S+) Barcode/),
          photos, dup,
          release: isoRelease(pick(/Release Date (.+?) Country of Origin/)),
          series: fact(pick(/Series (.+?) Categories/)),
          brand: fact(pick(/Manufacturer Brand (.+?) Release Date/)),
          maker: fact(pick(/Manufacturer (.+?) Manufacturer Brand/)),
        };
        items[t.barcode] = entry;
        tally.found++; tally.photos += photos.length; tally.sameAsOurs += dup.length;
        if (tally.found <= 12 || tally.found % 100 === 0) log("FOUND", t.type, "|", t.title.slice(0, 55), "| plamod", entry.sku, "| photos", photos.length, "| same as ours", dup.length, "|", entry.release || "-", "|", entry.series || "-", "|", entry.brand || "-");
      } catch (e) {
        tally.errors++;
        log("ERROR", t.barcode, clean(e.message).slice(0, 140));
      }
      if (!DRY && tally.looked - saved >= 100) { save(); saved = tally.looked; }
    }
  }
  function save() {
    const out = { source: "https://www.plamod.com/retailer", generated: new Date().toISOString(), count: Object.keys(items).length, items: Object.fromEntries(Object.entries(items).sort()) };
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  }
  const pages = [first];
  for (let i = 1; i < TABS; i++) pages.push(await browser.newPage());
  await Promise.all(pages.map(worker));
  log("SUMMARY", JSON.stringify(tally), "| left for the next run:", Math.max(0, todo.length - next));
  if (!DRY) save(); else log("dry run: not writing", OUT);
  await browser.close();
}

if (process.argv[1] && process.argv[1].endsWith("plamod-sync.mjs") && !process.env.PLAMOD_TEST) {
  main().catch((e) => { console.log("ERROR", clean(e.message)); process.exit(1); });
}
