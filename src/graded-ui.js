/* 9Pocket > Graded cards: the add form (phone first), the "added lately" list.
   The browser shrinks each photo to <= 2000 px before upload, reads the QR
   code on the label (BarcodeDetector where the phone has it, jsQR from cdnjs
   otherwise) into the certificate-link box, and previews the title as it
   will be listed. Everything else happens in src/graded.js. */
import { shell, esc, BASE, when } from "./stage-ui.js";
import { GAMES, GRADERS, GRADES, FINISHES } from "./graded.js";

const CSS = `.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0 10px}.shot{display:flex;flex-direction:column;gap:6px;border:1px dashed #cbd3d9;border-radius:10px;padding:8px;background:#f8fafb;cursor:pointer;font-size:13px;color:#374151}.shot input{font-size:12px;max-width:100%}.shot img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:6px;background:#eef2f4}.shot img[hidden]{display:none}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 14px;margin:6px 0}.grid label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#374151;font-weight:600}.grid label.chk{flex-direction:row;align-items:center;align-self:end;font-weight:600}.grid .text{width:100%;flex:none;font-size:16px}.tp{margin:10px 0;padding:8px 12px;background:#eef2f4;border-radius:8px;font-size:14px;word-break:break-word}#qrstate{margin:0 0 8px;font-size:13px}#qrstate.ok{color:#065f46;font-weight:600}.last{background:#d1fae5;color:#065f46;padding:10px 14px;border-radius:10px;margin:10px 0}.last a{color:#065f46;font-weight:700}.warn{background:#fff8dc;color:#5b4300;padding:8px 12px;border-radius:8px;margin:8px 0;font-size:13px}.rec td img{width:40px;border-radius:4px;background:#eef2f4}textarea.text{font-size:16px}@media (max-width:600px){.grid{grid-template-columns:1fr 1fr}.grid label.wide{grid-column:1/-1}}`;

const JS = `(function(){
var qrState=document.getElementById('qrstate'),qrUrl=document.getElementById('qr_url'),cert=document.getElementById('cert'),prev=document.getElementById('tprev'),form=document.getElementById('gform'),btn=document.getElementById('addbtn');
function v(n){var e=form.elements[n];return e?String(e.value||'').replace(/\\s+/g,' ').trim():'';}
function title(){var name=v('name');if(!name)return '';var gl=v('grade')+(v('label')?' '+v('label'):'');return [name+(v('number')?' ('+v('number')+')':''),v('set')?'['+v('set')+']':'',v('finish'),form.elements.japanese.checked?'Japanese':'','Graded '+v('grader').toUpperCase()+' '+gl].filter(Boolean).join(' ');}
function preview(){prev.textContent=title()||'(type the card name)';}
form.addEventListener('input',preview);form.addEventListener('change',preview);preview();
function fit(bmp,max){var s=Math.min(1,max/Math.max(bmp.width,bmp.height));var c=document.createElement('canvas');c.width=Math.max(1,Math.round(bmp.width*s));c.height=Math.max(1,Math.round(bmp.height*s));c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);return c;}
function decodeCanvas(c){if(!window.jsQR)return null;var d=c.getContext('2d').getImageData(0,0,c.width,c.height);var r=jsQR(d.data,d.width,d.height,{inversionAttempts:'attemptBoth'});return r&&r.data||null;}
async function detect(bmp){if('BarcodeDetector' in window){try{var det=new BarcodeDetector({formats:['qr_code']});var res=await det.detect(bmp);if(res&&res[0]&&res[0].rawValue)return res[0].rawValue;}catch(e){}}var sizes=[1400,2200,3000];for(var i=0;i<sizes.length;i++){try{var val=decodeCanvas(fit(bmp,sizes[i]));if(val)return val;}catch(e){}}return null;}
async function onPhoto(input){var file=input.files&&input.files[0];if(!file)return;var img=input.parentNode.querySelector('img');var bmp=null;try{bmp=await createImageBitmap(file);}catch(e){}
if(bmp){try{var c=fit(bmp,2000);var blob=await new Promise(function(res){c.toBlob(res,'image/jpeg',0.86);});if(blob&&blob.size<file.size){var dt=new DataTransfer();dt.items.add(new File([blob],(file.name||'photo').replace(/\\.[A-Za-z0-9]+$/,'')+'.jpg',{type:'image/jpeg'}));input.files=dt.files;}if(img){img.src=URL.createObjectURL(blob||file);img.hidden=false;}}catch(e){if(img){img.src=URL.createObjectURL(file);img.hidden=false;}}}
else if(img){img.src=URL.createObjectURL(file);img.hidden=false;}
if(bmp&&(input.name==='photo1'||!qrUrl.value)){qrState.className='muted';qrState.textContent='Reading the QR code\\u2026';var val=await detect(bmp);if(val&&/^https?:\\/\\//i.test(val)){qrUrl.value=val;qrState.className='ok';qrState.textContent='QR code read: '+val;var m=/(\\d{6,12})/.exec(val);if(m&&!cert.value)cert.value=m[1];}else{qrState.className='muted';qrState.textContent=val?'The QR code is not a link ('+val.slice(0,60)+'); type the certificate number instead.':'No QR code found in that photo; you can type the certificate number instead, or retake it closer to the label.';}}}
Array.prototype.forEach.call(form.querySelectorAll('input[type=file]'),function(i){i.addEventListener('change',function(){onPhoto(i);});});
form.addEventListener('submit',function(){btn.disabled=true;btn.textContent='Adding\\u2026 (uploading photos)';});
})();`;

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
<p class="muted">Photograph the slab, fill in the card, tap Add. The QR code on the label is read from the first photo and becomes a “View the certificate” link on the listing that opens in a new window. Titles follow the store's graded naming, the card goes in stock at 51 Allen Street on the Online Store, and the auto-pricing box adds it to the nightly PriceCharting run.</p>
${err}${lastBox}${warn}
<form id="gform" class="card" method="post" action="${BASE}/graded/add" enctype="multipart/form-data">
<h3>Photos</h3>
<div class="shots">
<label class="shot"><span>Front: the label with the QR code</span><input type="file" name="photo1" accept="image/*" capture="environment"><img alt="" hidden></label>
<label class="shot"><span>Back</span><input type="file" name="photo2" accept="image/*" capture="environment"><img alt="" hidden></label>
<label class="shot"><span>Extra</span><input type="file" name="photo3" accept="image/*" capture="environment"><img alt="" hidden></label>
</div>
<div id="qrstate" class="muted">The QR code is read from the first photo.</div>
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
<div class="card rec"><h3>Added from here lately</h3>${rows ? `<table><thead><tr><th></th><th>Card</th><th class="n">Price</th><th class="n">Qty</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Nothing yet. The first slab you add shows up here.</p>'}</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js" defer></script>
<script>${JS}</script>`;
  return shell("Graded cards", body, o, true);
}
