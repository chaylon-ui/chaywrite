/* Geometry of the seven buylist game tiles on the PREVIEW theme, measured
   in a real browser at three widths. The owner's complaint was symmetry:
   three tiles, one alone under the middle, three more. A screenshot cannot
   come back through this pipeline, so the layout is asserted as numbers:
   every tile the same size, every row centred on the body, equal gaps,
   rows that do not touch, and no row of one unless it is the last.

   Uses the runner's own Chrome through playwright-core, so nothing is
   downloaded beyond the npm package. Read-only. */
import { chromium } from "playwright-core";

const BASE = "https://exorgames.com";
const PREVIEW = "157462692013";
const PATH = "/pages/selling-to-exor-games-buylist";
const WIDTHS = [1280, 820, 390];
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

let fails = 0;
const fail = (msg) => { fails++; console.log("  FAIL " + msg); };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 500 });
  const page = await ctx.newPage();
  // The preview switch is a cookie set by the first response; the context keeps it.
  await page.goto(BASE + "/?preview_theme_id=" + PREVIEW, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.goto(BASE + PATH + "?preview_theme_id=" + PREVIEW, { waitUntil: "load", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const theme = (window.Shopify && window.Shopify.theme) || {};
    const body = document.querySelector(".xg-page__body");
    const tiles = body ? [...body.querySelectorAll('div[style*="text-align"] > a')] : [];
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      theme: { id: theme.id, name: theme.name },
      body: body ? box(body) : null,
      display: body ? getComputedStyle(body).display : null,
      tiles: tiles.map(box),
    };
  });

  console.log(`=== ${width}px  theme=${r.theme.id} "${r.theme.name}"  body.display=${r.display}  body=${JSON.stringify(r.body)}`);
  if (String(r.theme.id) !== PREVIEW) fail(`served theme ${r.theme.id}, not the preview`);
  if (!r.body || r.display !== "flex") fail(`body not the flex container (${r.display})`);
  if (r.tiles.length !== 7) fail(`expected 7 tiles, found ${r.tiles.length}`);
  if (!r.tiles.length) { await ctx.close(); continue; }

  const sizes = new Set(r.tiles.map((t) => t.w + "x" + t.h));
  console.log(`  tile sizes: ${[...sizes].join(", ")}`);
  if (sizes.size !== 1) fail("tiles are not all the same size");

  // rows: tiles whose top edges agree within 4px
  const rows = [];
  for (const t of [...r.tiles].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((rw) => Math.abs(rw[0].y - t.y) <= 4);
    if (row) row.push(t); else rows.push([t]);
  }
  const bodyCentre = r.body.x + r.body.w / 2;
  rows.forEach((row, i) => {
    row.sort((a, b) => a.x - b.x);
    const left = row[0].x, right = row[row.length - 1].x + row[row.length - 1].w;
    const centre = (left + right) / 2;
    const gaps = row.slice(1).map((t, k) => t.x - (row[k].x + row[k].w));
    const gapSet = [...new Set(gaps)];
    console.log(`  row ${i + 1}: ${row.length} tiles  x ${left}-${right}  centre-offset ${Math.round(centre - bodyCentre)}px  gaps ${gapSet.join("/") || "-"}  y ${row[0].y}`);
    if (Math.abs(centre - bodyCentre) > 3) fail(`row ${i + 1} is off-centre by ${Math.round(centre - bodyCentre)}px`);
    if (gapSet.length > 1 || (gaps.length && (gaps[0] < 8 || gaps[0] > 24))) fail(`row ${i + 1} gaps uneven or odd: ${gaps.join("/")}`);
    if (i < rows.length - 1) {
      const next = rows[i + 1];
      const vgap = next[0].y - (row[0].y + row[0].h);
      if (vgap < 8) fail(`row ${i + 1} touches row ${i + 2} (vertical gap ${vgap}px)`);
      if (row.length === 1) fail(`row ${i + 1} is a lone tile with rows after it`);
    }
  });
  console.log(`  rows: ${rows.map((rw) => rw.length).join(" + ")}`);
  await ctx.close();
}
await browser.close();
console.log(`BUYLIST-GEOM ${fails ? "FAILS " + fails : "OK"}`);
