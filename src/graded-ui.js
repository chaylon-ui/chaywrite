/* 9Pocket > Graded cards: the add form (phone first), the "added lately" list.
   The browser shrinks each photo to <= 2000 px before upload, reads the QR
   code on the label from whichever photo shows it - usually the back (owner,
   2026-10-27) - with BarcodeDetector where the phone has it, jsQR otherwise
   (public/vendor/jsQR-1.4.0.js, served by the worker: the cdnjs URL used at
   first was a 404, so no QR code was ever read - owner, 2026-10-28), into the certificate-link box, and previews the title as it
   will be listed. Everything else happens in src/graded.js. */
import { shell, esc, BASE, when } from "./stage-ui.js";
import { GAMES, GRADERS, GRADES, FINISHES } from "./graded.js";

export const JS_V = "12";   // bump when public/graded-add.js changes (browsers cache it)

const CSS = `.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0 10px}.shot{display:flex;flex-direction:column;gap:6px;border:1px dashed #cbd3d9;border-radius:10px;padding:8px;background:#f8fafb;font-size:13px;color:#374151}.shot label{display:flex;flex-direction:column;gap:6px;cursor:pointer}.shot .turned{font-size:12px}.shot .rot{align-self:flex-start}.shot input{font-size:12px;max-width:100%}.shot img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:6px;background:#eef2f4}.shot img[hidden]{display:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 14px;margin:6px 0}.grid label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#374151;font-weight:600}.grid label.chk{flex-direction:row;align-items:center;align-self:end;font-weight:600}.grid .text{width:100%;flex:none;font-size:16px}.tp{margin:10px 0;padding:8px 12px;background:#eef2f4;border-radius:8px;font-size:14px;word-break:break-word}#qrstate,#psastate{margin:0 0 8px;font-size:13px}#qrstate.ok,#psastate.ok,.line .psa.ok{color:#065f46;font-weight:600}.last{background:#d1fae5;color:#065f46;padding:10px 14px;border-radius:10px;margin:10px 0}.last a{color:#065f46;font-weight:700}.warn{background:#fff8dc;color:#5b4300;padding:8px 12px;border-radius:8px;margin:8px 0;font-size:13px}.rec td img{width:40px;border-radius:4px;background:#eef2f4}textarea.text{font-size:16px}.line{border:1px solid #dde3e7;border-radius:12px;padding:10px 12px;margin:10px 0;background:#fff}.line .ph{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start}.line .ph .figs{display:flex;gap:8px;flex-wrap:wrap}.line .ph figure{margin:0;width:92px;font-size:11px;color:#6b7780;text-align:center}.line .ph figcaption .rot{padding:0 6px;font-size:12px;margin-left:2px}.line .ph img,.line .ph .ph-none{width:92px;aspect-ratio:3/4;object-fit:cover;border-radius:6px;background:#eef2f4;display:flex;align-items:center;justify-content:center;font-size:11px}.line .meta{flex:1 1 160px;font-size:13px;line-height:1.6}.line .meta .ok{color:#065f46;font-weight:600}.line .st{font-size:13px}.line .st.ok{color:#065f46;font-weight:600}.line .st.err{color:#b42318;font-weight:600}.line.done{background:#f3fbf7}.line.busy button{opacity:.6}@media (max-width:600px){.grid{grid-template-columns:1fr 1fr}.grid label.wide{grid-column:1/-1}}`;



const sel = (name, opts, cur, labels) => `<select name="${name}">${opts.map((o) => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>${esc(labels ? labels(o) : (o || "—"))}</option>`).join("")}</select>`;

export function renderGradedDenied(o) {
  return shell("Graded cards", `<h1>Graded cards</h1><p class="muted">Your account cannot add graded cards. Ask an admin to tick “Graded cards” on your account (9Pocket › Admin › Users).</p><p><a href="${BASE}">Back to 9Pocket</a></p>`, o, true);
}

export function renderGraded(d, o) {
  const k = d.keep || {};
  const setup = d.setup;
  const last = d.last;
  const warn = setup && !setup.ok ? `<div class="warn">${setup.error ? `Setup check: ${esc(setup.error)}` : `The worker's Shopify token is missing ${setup.missing.map((m) => `<b>${esc(m)}</b>`).join(", ")}${setup.locationActive ? "" : " and the store location is not active"}: adds will fail until an admin adds those scopes to the custom app in Shopify (Settings › Apps and sales channels › Develop apps).`}</div>` : "";
  const lastBox = last ? `<div class="last">Added <b>${esc(last.title)}</b> · <a href="https://exorgames.com/products/${esc(last.handle)}" target="_blank" rel="noopener">see it on the site</a> · <a href="https://admin.shopify.com/store/most-wanted-ca/products?selectedView=all&query=${encodeURIComponent(last.title)}" target="_blank" rel="noopener">open in Shopify</a>${last.placeholder ? " · listed at the $999,999 placeholder until auto-pricing suggests a price" : ""}${last.published ? "" : ` · <b>not published to the Online Store</b>${last.publishError ? " (" + esc(last.publishError) + ")" : ""}: publish it from the Shopify page`}</div>` : "";
  const err = o.err ? `<div class="err">${esc(o.err)}</div>` : "";
  const graders = Object.keys(GRADERS);
  const rows = (d.recent || []).map((r) => `<tr><td class="t">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ""}</td><td><a href="${esc(r.adminUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a><br><span class="muted">${esc(when(Date.parse(r.createdAt)))}${r.autoPrice ? " · auto-pricing" : ""}${r.status !== "ACTIVE" ? " · " + esc(r.status.toLowerCase()) : ""}</span></td><td class="n">${r.price === "999999.00" ? '<span class="muted">placeholder</span>' : "$" + esc(r.price)}</td><td class="n">${esc(r.qty)}</td><td class="n"><a href="${esc(r.url)}" target="_blank" rel="noopener">site</a></td></tr>`).join("");
  const body = `<style>${CSS}</style>
<h1>Graded cards</h1>
<p class="muted">Photograph the slab, fill in the card, tap Add. The QR code on the label (usually the back) is read from whichever photo shows it and becomes a “View the certificate” link on the listing that opens in a new window. Titles follow the store's graded naming, the card goes in stock at 51 Allen Street on the Online Store, and the auto-pricing box adds it to the nightly PriceCharting run.</p>
${err}${lastBox}${warn}<p class="muted">${d.vision ? "Label reading is on: the back photo (the label) is read by Claude and fills in the card, number, set, grader, grade and certificate for PSA, CGC and Beckett slabs alike; check the title, it reads a photo, not a database. " : ""}${d.psa ? "PSA lookups are on: a PSA certificate number (typed, or read from the QR code) fills in the card, set, number and grade from PSA's records; check them, PSA writes set names its own way." : "PSA lookups are off. An admin can switch them on by adding a PSA access token (psacard.com/publicapi, free) as the PSA_API_TOKEN secret: then a certificate number fills in the card, set, number and grade by itself."}</p>
<form id="gform" class="card" method="post" action="${BASE}/graded/add" enctype="multipart/form-data">
<h3>Photos</h3>
<div class="shots">
<div class="shot"><label><span>Front of the slab</span><input type="file" name="photo1" accept="image/*"><img alt="" hidden></label><span class="muted turned"></span><button type="button" class="sm rot" hidden>↻ Rotate</button></div>
<div class="shot"><label><span>Back: the label with the QR code</span><input type="file" name="photo2" accept="image/*"><img alt="" hidden></label><span class="muted turned"></span><button type="button" class="sm rot" hidden>↻ Rotate</button></div>
<div class="shot"><label><span>Extra</span><input type="file" name="photo3" accept="image/*"><img alt="" hidden></label><span class="muted turned"></span><button type="button" class="sm rot" hidden>↻ Rotate</button></div>
</div>
<div id="qrstate" class="muted">Every photo is checked for the QR code (usually on the back of the label).</div>
<div id="psastate" class="muted"></div>
<h3>Card</h3>
<div class="grid">
<label>Game ${sel("game", Object.keys(GAMES), k.game || "pokemon", (g) => GAMES[g].label)}</label>
<label>Grader ${sel("grader", graders, k.grader || "PSA")}</label>
<label>Grade ${sel("grade", GRADES, "10")}</label>
<label>Grade label <input class="text" name="label" placeholder="Pristine, Gem Mint, Black Label" autocomplete="off"></label>
<label class="wide">Card name * <input class="text" name="name" required placeholder="Dark Muk" autocomplete="off"></label>
<label>Number <input class="text" name="number" placeholder="41/82" autocomplete="off"></label>
<label>Set <input class="text" name="set" value="${esc(k.set || "")}" placeholder="Team Rocket 1st Edition" autocomplete="off"></label>
<label>Finish ${sel("finish", FINISHES, k.finish || "", (f) => f || "none")}</label>
<label class="chk"><input type="checkbox" name="japanese" value="1"${k.japanese ? " checked" : ""}> Japanese</label>
<label>Certificate number <input class="text" id="cert" name="cert" inputmode="numeric" placeholder="from the label" autocomplete="off"></label>
<label class="wide">Certificate link <input class="text" id="qr_url" name="qr_url" placeholder="filled in from the QR code; PSA and CGC links are built from the number if there is no QR" autocomplete="off"></label>
</div>
<div class="tp">Title: <b id="tprev"></b></div>
<h3>Price and stock</h3>
<div class="grid">
<label>Price (CAD) <input class="text" name="price" inputmode="decimal" placeholder="blank = $999,999 until auto-pricing suggests one" autocomplete="off"></label>
<label>Cost (optional) <input class="text" name="cost" inputmode="decimal" placeholder="what the store paid" autocomplete="off"></label>
<label>Quantity <input class="text" name="qty" type="number" min="1" max="99" value="1"></label>
<label class="chk"><input type="checkbox" name="auto_price" value="1" checked> Add to auto-pricing</label>
</div>
<p class="muted">Auto-pricing looks the card up on PriceCharting every night by its title and grade; suggestions wait on the Auto-pricing page until someone publishes them, like every other product.</p>
<label style="display:block;font-size:13px;font-weight:600;color:#374151">Notes (shown on the listing)<textarea class="text" name="notes" rows="2" placeholder="e.g. light scuff on the case"></textarea></label>
<div class="act"><button class="save" type="submit" id="addbtn">Add to Shopify</button> <span class="muted">Photos are shrunk on your phone before they upload.</span></div>
</form>
<div class="card"><h3>Batch: a pile of slabs at once</h3>
<p class="muted">Pick every photo in one go. Shoot each slab front then back (or say which order below) and the photos are paired in that order; a QR code read on the back adds the certificate. Choose “mixed” to pair purely by QR codes. Sideways photos are turned upright (tap ↻ on a thumbnail if one comes out wrong). iPhone HEIC photos are converted here, so a PC works as well as the phone. Each slab becomes a line below: check the pair, fill in the card, and add them one at a time or all at once.</p>
<label style="display:block;font-size:13px;font-weight:600;color:#374151;margin:6px 0">The photos are in this order <select id="pairmode"><option value="fb">front then back of each slab</option><option value="bf">back then front of each slab</option><option value="qr">mixed: find each back by its QR code</option></select></label>
<input type="file" id="batch" accept="image/*" multiple>
<div id="batchstate" class="muted"></div>
<div id="lines"></div>
<div class="act"><button type="button" id="addall" class="save" hidden>Add every filled-in line</button></div>
</div>
<div class="card rec"><h3>Added from here lately</h3>${rows ? `<table><thead><tr><th></th><th>Card</th><th class="n">Price</th><th class="n">Qty</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nothing yet. The first slab you add shows up here.</p>'}</div>
<script src="/vendor/jsQR-1.4.0.js" defer></script>
<script>window.xgGraded=${JSON.stringify({ grades: GRADES, finishes: FINISHES, graders: Object.keys(GRADERS), games: Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, g.label])), base: BASE, psa: !!d.psa, vision: !!d.vision }).replace(/<\//g, "<\\/")}</script>
<script src="/graded-add.js?v=${JS_V}" defer></script>`;
  return shell("Graded cards", body, o, true);
}
