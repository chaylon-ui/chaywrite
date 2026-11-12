/* ---------------- The Shop: the Showcase as a 3D room ----------------
   Owner, 2026-11-09: "make it more of a 3d world of a 1990s card shop ...
   more interactive". A small shop drawn with three.js: the glass case at the
   counter (the Showcase's shelves, /showcase.json), the white four-row boxes
   on the back wall (/showcase/boxes.json, set.json), a bargain bin, the till,
   a bell and a lamp. You tap to walk to a spot; at the case you swipe to walk
   along it and swipe up to crouch; a card comes out as a toploader you can
   turn over. Page: public/showcase3d.html. The flat page (/showcase) is
   untouched and is the fallback without WebGL.

   Sizes are metres: a toploader is 63 x 88 mm, the counter is 1 m high.
   The scene is drawn only when something moved (kick()), not every frame. */
import * as THREE from './vendor/three-0.170.0.module.min.js';

const W = /workers\.dev$|^localhost$|^127\./.test(location.hostname) ? '' : 'https://exor-binder.nevski.workers.dev';
const ON_STORE = /(^|\.)exorgames\.com$/.test(location.hostname);
const LOGO = 'https://cdn.shopify.com/s/files/1/0467/3083/8169/files/exor-games-logo-transparent.png?v=1790375946';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => { const n = Number(p) || 0; return '$' + (n >= 100 ? Math.round(n).toLocaleString('en-CA') : n.toFixed(2)); };
const gunPrice = (p) => (Number(p) || 0).toFixed(2) + ' $';   // what the kiosk's price gun prints
const img = (u, w) => { if (!u) return ''; u = String(u); if (/cdn\.shopify\.com/.test(u)) return u + (u.indexOf('?') > -1 ? '&' : '?') + 'width=' + w; return u; };
// A card's own randomness: the same card tilts the same way every visit.
function seed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return function () { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, rad = (d) => d * Math.PI / 180;
const hasPhoto = (c) => !!c.image && !/placeholder|coming|no[-_]?image|missing/i.test(c.image);
const condText = (c) => String(c.condition || '').replace(/\s*\/\s*(english|normal)\b/gi, '').replace(/\s*\/\s*$/, '').trim();
const cond = (c) => condText(c).replace(/\s*\/?\s*japanese\b/i, ' JP').replace(/near mint/i, 'NM').replace(/lightly played/i, 'LP').replace(/moderately played/i, 'MP').replace(/heavily played/i, 'HP').replace(/damaged/i, 'DMG').replace(/1st edition/i, '1st Ed').replace(/unlimited/i, 'Unl').replace(/\s+/g, ' ').trim().slice(0, 14);
const keyOf = (c) => String(c.variantId || c.url || c.name);
const V3 = THREE.Vector3, PI = Math.PI;
const CW = .063, CH = .088;                 // a toploader
const X1 = .9, ZF = -.65, ZB = -1.15;       // the glass case: its right end, front and back
const TOP = 1.0;                            // counter height
const CEIL = 4.3;                           // the ceiling (owner, 2026-11-11: "make ceilings much taller with lights"); the walls' paper and panelling stop at 2.9, plain paint above

const S = { mode: 'door', game: '', cases: [], icons: [], shelves: [], lay: [], shelf: 0, walk: 0, vx: 0, x0: -1, caseLen: 2, pan: 0, look: { yaw: 0, pitch: 0 }, hand: null, handSrc: null, pile: [], ext: [], idf: null, busy: false, eve: 0 };

/* ---------- renderer, camera, the draw-on-demand loop ---------- */
const canvas = $('#gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (x) { window.xgFlat(); throw x; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0809);
scene.fog = new THREE.Fog(0x17120f, 16, 62);   // the far end of a long aisle fades out
const cam = new THREE.PerspectiveCamera(60, 1, .02, 150); cam.rotation.order = 'YXZ'; scene.add(cam);
const view = { pos: new V3(0, 1.6, 2.9), yaw: 0, pitch: -.1, fov: 60 };
const baseFov = () => (cam.aspect < 1 ? 70 : 55);
const hTan = (fov) => Math.tan(rad(fov / 2)) * cam.aspect;
function lookView(pos, tgt, fov) { const d = tgt.clone().sub(pos); return { pos, yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), fov: fov || baseFov(), dist: d.length() }; }
let tw = null, raf = 0; const anims = [];
function glide(to, ms, done) { tw = { a: { pos: view.pos.clone(), yaw: view.yaw, pitch: view.pitch, fov: view.fov }, b: to, t0: performance.now(), ms: reduce ? 1 : (ms || 900), done }; view.dist = to.dist; kick(); }
function setView(to) { tw = null; view.pos.copy(to.pos); view.yaw = to.yaw; view.pitch = to.pitch; view.fov = to.fov; view.dist = to.dist; kick(); }
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0; let busy = false;
  if (tw) {
    const k = Math.min(1, (now - tw.t0) / tw.ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    view.pos.lerpVectors(tw.a.pos, tw.b.pos, e); view.yaw = lerp(tw.a.yaw, tw.b.yaw, e); view.pitch = lerp(tw.a.pitch, tw.b.pitch, e); view.fov = lerp(tw.a.fov, tw.b.fov, e);
    if (k >= 1) { const cb = tw.done; tw = null; if (cb) cb(); } else busy = true;
  }
  for (const a of anims.slice()) { if (a(now) === false) anims.splice(anims.indexOf(a), 1); else busy = true; }
  cam.position.copy(view.pos); cam.rotation.set(view.pitch, view.yaw, 0);
  if (cam.fov !== view.fov) { cam.fov = view.fov; cam.updateProjectionMatrix(); }
  if (S.hand) placeHand(now);
  placeFan();
  if (S.mode === 'case') caseTextures(now);
  if (hall.built) aisleStock(now);
  renderer.render(scene, cam);
  if (busy) kick();
}
function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  if (S.shelves.length || S.mode === 'door') setView(viewFor());
}
addEventListener('resize', resize);

/* ---------- drawing helpers: every surface is painted on a canvas ---------- */
function ctex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  words.forEach((wd) => { const t = cur ? cur + ' ' + wd : wd; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t; }); if (cur) lines.push(cur);
  lines.slice(0, maxLines || 5).forEach((l, i) => g.fillText(l, x, y + i * lh));
  return lines.length;
}
function noise(g, w, h, n, colors, a) { const r = seed('n' + w + n + colors[0]); for (let i = 0; i < n; i++) { g.fillStyle = colors[Math.floor(r() * colors.length)]; g.globalAlpha = a * (.4 + r() * .6); g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } g.globalAlpha = 1; }
function drawWood(g, w, h, base, planks) {
  g.fillStyle = base; g.fillRect(0, 0, w, h); const r = seed('wood' + base);
  for (let i = 0; i < 700; i++) { g.strokeStyle = 'rgba(' + (r() < .55 ? '30,14,4' : '190,130,70') + ',' + (.04 + r() * .1) + ')'; g.lineWidth = .5 + r() * 1.6; const y = r() * h, x = r() * w - 40, l = 40 + r() * 220; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + l * .3, y + (r() - .5) * 5, x + l * .6, y + (r() - .5) * 5, x + l, y + (r() - .5) * 3); g.stroke(); }
  for (let p = 1; p < (planks || 1); p++) { g.fillStyle = 'rgba(18,8,2,.6)'; g.fillRect(0, Math.round(h * p / planks), w, 2); }
}
function drawCarpet(g, w, h) {   // a 1990s shop carpet: dark blue with confetti
  g.fillStyle = '#1b2738'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, ['#0f1722', '#2a3a52', '#223049'], .5);
  const r = seed('carpet'), cols = ['#2f9c95', '#b8457f', '#d6b23c', '#5b6fd0'];
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, c = cols[i % cols.length], t = i % 3; g.save(); g.translate(x, y); g.rotate(r() * PI * 2); g.globalAlpha = .55; g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 3; g.lineCap = 'round';
    if (t === 0) { g.beginPath(); g.moveTo(-12, 0); g.quadraticCurveTo(-6, -9, 0, 0); g.quadraticCurveTo(6, 9, 12, 0); g.stroke(); }
    else if (t === 1) { g.beginPath(); g.moveTo(0, -7); g.lineTo(7, 6); g.lineTo(-7, 6); g.closePath(); g.fill(); }
    else { g.beginPath(); g.arc(0, 0, 3.5, 0, PI * 2); g.fill(); }
    g.restore();
  }
}
function drawWall(g, w, h) {     // aged cream paint over wood panelling
  const split = Math.round(h * .6);
  g.fillStyle = '#cdbf9c'; g.fillRect(0, 0, w, split); noise(g, w, split, 2500, ['#b9aa84', '#d9cdaa', '#c2b38d'], .35);
  const gr = g.createLinearGradient(0, 0, 0, split); gr.addColorStop(0, 'rgba(90,70,30,.28)'); gr.addColorStop(.3, 'rgba(90,70,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, split);
  g.save(); g.translate(0, split); drawWood(g, w, h - split, '#6a3f1d', 1); g.restore();
  for (let x = 0; x < w; x += w / 4) { g.fillStyle = 'rgba(20,9,2,.7)'; g.fillRect(x, split, 3, h - split); g.fillStyle = 'rgba(255,220,170,.08)'; g.fillRect(x + 3, split, 2, h - split); }
  g.fillStyle = '#4a2a12'; g.fillRect(0, split - 6, w, 14); g.fillStyle = 'rgba(255,220,170,.15)'; g.fillRect(0, split - 6, w, 2);
  g.fillStyle = '#3a200d'; g.fillRect(0, h - 26, w, 26);
}
function drawCeil(g, w, h) { g.fillStyle = '#d6d1c2'; g.fillRect(0, 0, w, h); noise(g, w, h, 900, ['#a8a393', '#bdb8a8'], .7); g.strokeStyle = '#9d988a'; g.lineWidth = 4; g.strokeRect(0, 0, w, h); }
function drawFelt(g, w, h) { g.fillStyle = '#4a1c22'; g.fillRect(0, 0, w, h); noise(g, w, h, 4000, ['#3a141a', '#5a252c', '#42181e'], .6); }
function tape(g, w, h, text, font, rot) {  // a strip of masking tape with marker on it, filling the canvas
  g.clearRect(0, 0, w, h); g.save(); g.translate(w / 2, h / 2); g.rotate(rot || 0);
  g.fillStyle = '#e8dcb8'; g.beginPath(); g.moveTo(-w * .48, -h * .34); g.lineTo(w * .47, -h * .3); g.lineTo(w * .48, h * .32); g.lineTo(-w * .47, h * .36); g.closePath(); g.fill();
  g.fillStyle = '#2a1c0e'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  let s = 1; const tw_ = g.measureText(text).width; if (tw_ > w * .88) s = w * .88 / tw_; g.scale(s, s); g.fillText(text, 0, h * .02); g.restore();
}
const fonts = Promise.race([Promise.all(['700 20px "Cutive Mono"', '20px "Permanent Marker"', '700 20px Caveat', '20px "Special Elite"'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});

/* ---------- card images: straight from the shop's CDN, through the worker when a host refuses ---------- */
const badHost = new Set(['images.binderpos.com', 'images.ygoprodeck.com']);   // sends no CORS header (live probe 42694107805, 2026-11-09), so its pictures go through the worker from the start
function loadImg(url) {
  return new Promise((res, rej) => {
    let host = ''; try { host = new URL(url, location.href).host; } catch (x) {}
    const direct = !badHost.has(host), im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => { if (direct && host !== location.host) { badHost.add(host); loadImg(url).then(res, rej); } else rej(new Error('image')); };
    im.src = direct ? url : W + '/showcase/img?u=' + encodeURIComponent(url);
  });
}
// One texture per card: the toploader, the card inside it and the kiosk's
// three labels (price-gun sticker, Holo/foil in blue ink, condition in red).
function sticker(g, w, text, o) {
  g.save(); g.font = o.font; const tw_ = g.measureText(text).width, bw = tw_ + w * .06, bh = w * .145;
  g.translate(Math.max(bw / 2, (o.right != null ? o.right : w - w * .025) - bw / 2), o.y + bh / 2); g.rotate(o.rot);
  g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = w * .02; g.shadowOffsetY = w * .006; g.fillStyle = '#fbf7ec'; rr(g, -bw / 2, -bh / 2, bw, bh, w * .014); g.fill();
  g.shadowColor = 'transparent'; g.fillStyle = o.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, bh * .07); g.restore();
  return o.y + bh + w * .012;
}
/* The grade drawn on the card (owner, 2026-11-11: "add some condition related characteristics to the card based
   off of" the shop's grading guide, exorgames.com/pages/grading-guide). What each grade may show is taken from
   that page: LP slight edge wear or a bit of whitening, lightly worn corners, a few very light scratches; MP
   moderate edge wear and whitening, worn corners, noticeable scuffing or light scratches; HP significant edge
   wear, worn corners, a major crease, fading, minor staining; DMG heavy scratches, staining, major creases,
   frayed edges or tears. The marks are an ILLUSTRATION of the grade, the same for every copy of that grade of
   that card - not a picture of the copy in stock - and the card's details say so. */
const COND_GUIDE = [
  ['Near Mint', 'Minor superficial imperfections at most. Edges sharp and clean with little noticeable whitening or wear; corners crisp; no clouding or staining.', 'Foils have little to no scuffing or clouding.'],
  ['Lightly Played', 'Minor imperfections visible on close inspection: slight edge wear or a bit of whitening, lightly worn corners, maybe a few very light scratches. No major creases.', 'Foils may have light scuffing or minor clouding.'],
  ['Moderately Played', 'Moderate wear, still suitable for sleeve play: moderate edge wear or whitening, corners with moderate wear or minor creases, noticeable scuffing or light scratches.'],
  ['Heavily Played', 'Significant wear, but intact and lying flat: significant edge wear and whitening, worn corners, scuffing or scratches; major creases, fading or minor staining may be present.', 'Foils show significant clouding or wear.'],
  ['Damaged', 'Major flaws: heavy scratches, staining or indents, frayed edges or tears, heavy corner wear, major creases or bends, possibly water damage or writing.', 'Foils in this condition are typically not tournament-legal.']];
function wearLevel(c) { const t = String((c && c.condition) || '').toLowerCase(); return /damaged|\bdmg\b/.test(t) ? 4 : /heav/.test(t) ? 3 : /moder/.test(t) ? 2 : /light/.test(t) ? 1 : 0; }
function drawWear(g, x, y, cw, ch, lvl, key, foil) {
  if (!lvl) return; const q = seed(key + '|wear'), u = cw / 340, rnd = (a, b) => a + q() * (b - a);
  // a foil clouds as it wears (the guide: LP foils "light scuffing/minor clouding", HP "significant clouding or wear"; owner, 2026-11-11: "Same if there is foil")
  if (foil) for (let i = 0, n = [0, 2, 4, 7, 9][lvl]; i < n; i++) { const cx = rnd(x, x + cw), cy = rnd(y, y + ch), r = rnd(.16, .34) * cw, gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(236,240,244,' + [0, .12, .18, .26, .32][lvl] + ')'); gr.addColorStop(1, 'rgba(236,240,244,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); }
  if (lvl >= 3) { g.fillStyle = 'rgba(255,255,255,' + (lvl > 3 ? .13 : .08) + ')'; g.fillRect(x, y, cw, ch); }                       // fading
  if (lvl >= 2) for (let i = 0; i < lvl * 2; i++) { const cx = rnd(x, x + cw), cy = rnd(y, y + ch), r = rnd(18, 46) * u, gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(255,255,255,' + (.05 + lvl * .02) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); }   // scuffing
  g.lineCap = 'round';
  for (let i = 0, n = [0, 3, 8, 14, 26][lvl]; i < n; i++) { const cx = rnd(x, x + cw), cy = rnd(y, y + ch), a = rnd(0, PI), l = rnd(.05, lvl > 2 ? .3 : .16) * cw; g.strokeStyle = 'rgba(255,255,255,' + rnd(.1, lvl > 3 ? .42 : .26) + ')'; g.lineWidth = (lvl > 3 ? rnd(.6, 1.8) : .7) * u; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); }   // scratches
  if (lvl >= 3) {   // staining; water damage on a damaged card
    const cx = rnd(x + cw * .2, x + cw * .8), cy = rnd(y + ch * .25, y + ch * .85), r = rnd(.14, .22) * cw * (lvl > 3 ? 1.5 : 1), gr = g.createRadialGradient(cx, cy, r * .2, cx, cy, r); gr.addColorStop(0, 'rgba(120,84,40,' + (lvl > 3 ? .2 : .1) + ')'); gr.addColorStop(.85, 'rgba(120,84,40,' + (lvl > 3 ? .16 : .07) + ')'); gr.addColorStop(.93, 'rgba(90,60,25,' + (lvl > 3 ? .3 : .1) + ')'); gr.addColorStop(1, 'rgba(120,84,40,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    for (let i = 0; i < lvl - 2; i++) {   // a crease: a dark fold with a lit edge
      const cor = q() < .6, x0 = cor ? x + rnd(.5, .95) * cw : x, y0 = cor ? y : y + rnd(.2, .8) * ch, x1 = cor ? x + cw : x + cw, y1 = cor ? y + rnd(.08, .4) * ch : y0 + rnd(-.12, .12) * ch;
      g.strokeStyle = 'rgba(0,0,0,.34)'; g.lineWidth = 1.6 * u; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.1 * u; g.beginPath(); g.moveTo(x0, y0 + 1.8 * u); g.lineTo(x1, y1 + 1.8 * u); g.stroke();
    }
  }
  // edge wear: white nicks along the border, and the corners rubbed white
  g.fillStyle = '#f4f1ea';
  for (let i = 0, n = [0, 12, 40, 80, 140][lvl]; i < n; i++) { const side = Math.floor(q() * 4), t = q(), len = rnd(2, lvl > 2 ? 14 : 8) * u, th = rnd(.8, [0, 1.6, 2.2, 3, 4.4][lvl]) * u; g.globalAlpha = rnd(.55, .95);
    if (side === 0) g.fillRect(x + t * cw, y, len, th); else if (side === 1) g.fillRect(x + t * cw, y + ch - th, len, th); else if (side === 2) g.fillRect(x, y + t * ch, th, len); else g.fillRect(x + cw - th, y + t * ch, th, len); }
  g.globalAlpha = [0, .5, .75, .9, .95][lvl]; const cr = [0, 5, 9, 15, 22][lvl] * u;
  [[x, y, 1, 1], [x + cw, y, -1, 1], [x, y + ch, 1, -1], [x + cw, y + ch, -1, -1]].forEach((k) => { const r = cr * rnd(.6, 1.2); g.beginPath(); g.moveTo(k[0], k[1]); g.lineTo(k[0] + k[2] * r, k[1]); g.lineTo(k[0], k[1] + k[3] * r); g.closePath(); g.fill(); });
  g.globalAlpha = 1;
  if (lvl > 3) {   // a tear in from an edge: the sleeve shows through
    const t = rnd(.2, .8), dp = rnd(.07, .12) * cw, wd = rnd(.03, .05) * cw, top = q() < .5; g.fillStyle = '#d7dfe2'; g.beginPath();
    if (top) { g.moveTo(x + t * cw - wd, y); g.lineTo(x + t * cw + wd * .4, y + dp); g.lineTo(x + t * cw + wd, y); } else { g.moveTo(x + cw, y + t * ch - wd); g.lineTo(x + cw - dp, y + t * ch + wd * .4); g.lineTo(x + cw, y + t * ch + wd); }
    g.closePath(); g.fill(); g.strokeStyle = '#f4f1ea'; g.lineWidth = 1.4 * u; g.stroke();
  }
}
function drawCard(g, w, h, c, im) {
  const q = seed(keyOf(c) + '|st');
  g.clearRect(0, 0, w, h); rr(g, 0, 0, w, h, w * .03); g.fillStyle = '#d7dfe2'; g.fill();
  const m = w * .05, x = m, y = m * 1.6, cw = w - 2 * m, chh = h - y - m;
  g.save(); rr(g, x, y, cw, chh, w * .035); g.clip();
  if (im) { const s = Math.max(cw / im.width, chh / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, x + (cw - iw) / 2, y + (chh - ih) / 2, iw, ih); }
  else { g.fillStyle = '#241a1c'; g.fillRect(x, y, cw, chh); g.fillStyle = '#e8dcb8'; g.font = Math.round(w * .1) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; wrapText(g, c.name, x + cw / 2, y + chh * .42, cw * .86, w * .125, 5); }
  if (c.foil && !c.sealed) {   // a foil looks foil (owner, 2026-11-11: "The foil should look foil"): a rainbow sheen across the card and two bright bands, on every picture of it
    const q2 = seed(keyOf(c) + '|foil'), off = q2() * .5, rb = g.createLinearGradient(x - cw * off, y, x + cw * (1.3 - off), y + chh);
    ['#ff4f9a', '#ffd23a', '#5dff9a', '#4fc3ff', '#b07aff', '#ff4f9a', '#ffd23a', '#5dff9a', '#4fc3ff'].forEach((col, i, a) => rb.addColorStop(i / (a.length - 1), col));
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = .5; g.fillStyle = rb; g.fillRect(x, y, cw, chh);
    g.globalCompositeOperation = 'screen'; g.globalAlpha = 1; [.18 + q2() * .2, .62 + q2() * .2].forEach((t, i) => { const b = g.createLinearGradient(x + cw * (t - .16), y, x + cw * (t + .16), y + chh * .5); b.addColorStop(0, 'rgba(255,255,255,0)'); b.addColorStop(.5, 'rgba(255,255,255,' + (i ? .2 : .32) + ')'); b.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = b; g.beginPath(); g.moveTo(x + cw * (t - .1), y); g.lineTo(x + cw * (t + .14), y); g.lineTo(x + cw * (t - .2), y + chh); g.lineTo(x + cw * (t - .44), y + chh); g.closePath(); g.fill(); });
    g.restore();
  }
  if (!c.sealed) drawWear(g, x, y, cw, chh, wearLevel(c), String(c.name) + '|' + String(c.set) + (c.foil ? '|foil' : ''), !!c.foil);
  g.restore();
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(.35, 'rgba(255,255,255,0)'); gr.addColorStop(.62, 'rgba(255,255,255,.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  let sy = h * .03;
  sy = sticker(g, w, gunPrice(c.price), { font: '700 ' + Math.round(w * .105) + 'px "Cutive Mono", monospace', ink: '#1b2a55', y: sy, rot: (q() - .5) * .16 });
  if (c.foil) sy = sticker(g, w, c.game === 'pokemon' ? 'Holo' : 'foil', { font: '700 ' + Math.round(w * .13) + 'px Caveat, cursive', ink: '#1d4fc4', y: sy, rot: (q() - .5) * .2 });
  const cd = cond(c); if (cd) sticker(g, w, cd, { font: '700 ' + Math.round(w * .115) + 'px Caveat, cursive', ink: '#b3261e', y: sy, rot: (q() - .5) * .2 });
}
function drawBack(g, w, h) {
  rr(g, 0, 0, w, h, w * .03); g.fillStyle = '#d7dfe2'; g.fill(); const m = w * .05;
  rr(g, m, m * 1.6, w - 2 * m, h - m * 2.6, w * .035); g.fillStyle = '#2b1a20'; g.fill(); noise(g, w, h, 1500, ['#3a252c', '#20131a'], .25);
  g.save(); g.translate(w / 2, h * .48); g.rotate(-.06); g.fillStyle = '#e8dcb8'; g.fillRect(-w * .36, -h * .05, w * .72, h * .1); g.fillStyle = '#2a1c0e'; g.font = Math.round(w * .085) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXOR GAMES', 0, 0); g.restore();
}
// A sealed booster box is its product photo cut out of the photo's white
// background (owner, 2026-11-09: "Booster boxes have white backgrounds"):
// white that touches the picture's edge is cleared, white inside the box art
// stays. The price-gun sticker goes on top.
function cutWhite(g, w, h, photo) {
  let d; try { d = g.getImageData(0, 0, w, h); } catch (x) { return null; }
  const px = d.data, seen = new Uint8Array(w * h), st = [];
  const white = (i) => px[i * 4 + 3] < 16 || (px[i * 4] > 232 && px[i * 4 + 1] > 232 && px[i * 4 + 2] > 232);
  // A photo (a graded slab on a sheet of paper) has no pure white: its background is light, nearly grey, and shades
  // off towards the corners. So there the fill takes any light, low-colour pixel that differs little from the one
  // it came from - it follows the shading and stops at the slab's edge (live probe 42735937053: the first rule,
  // one colour for all four corners, cut nothing).
  const light = (i) => { const r = px[i * 4], g2 = px[i * 4 + 1], b = px[i * 4 + 2], mn = Math.min(r, g2, b); return px[i * 4 + 3] < 16 || (mn > 138 && Math.max(r, g2, b) - mn < 50); };
  const near = (i, j) => Math.abs(px[i * 4] - px[j * 4]) < 9 && Math.abs(px[i * 4 + 1] - px[j * 4 + 1]) < 9 && Math.abs(px[i * 4 + 2] - px[j * 4 + 2]) < 9;
  const push = (i, from) => { if (seen[i]) return; if (photo ? light(i) && (from < 0 || near(i, from)) : white(i)) { seen[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x, -1); push((h - 1) * w + x, -1); } for (let y = 0; y < h; y++) { push(y * w, -1); push(y * w + w - 1, -1); }
  while (st.length) { const i = st.pop(), x = i % w; if (x > 0) push(i - 1, i); if (x < w - 1) push(i + 1, i); if (i >= w) push(i - w, i); if (i < w * (h - 1)) push(i + w, i); }
  if (photo) { let n = 0; for (let i = 0; i < w * h; i++) n += seen[i]; if (n < w * h * .12 || n > w * h * .8) return null; }   // too little or nearly everything gone: not a slab on a plain sheet, leave the photo whole
  for (let i = 0; i < w * h; i++) if (seen[i]) px[i * 4 + 3] = 0;
  // soften the cut: a kept pixel beside a cleared one goes half see-through
  for (let i = 0; i < w * h; i++) { if (seen[i]) continue; const x = i % w; if ((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i < w * (h - 1) && seen[i + w])) px[i * 4 + 3] = Math.min(px[i * 4 + 3], 150); }
  g.putImageData(d, 0, 0);
  // where the box itself is, so the sticker can sit on its corner
  let x0 = w, y0 = h, x1 = 0, y1 = 0; for (let i = 0; i < w * h; i++) { if (seen[i]) continue; const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}
function drawSealed(g, w, h, c, im) {
  g.clearRect(0, 0, w, h); let bb = null;
  if (im) { const s = Math.min(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih); bb = cutWhite(g, w, h, !!c.slab); }
  else { g.fillStyle = '#e6e1d2'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a1c0e'; g.font = Math.round(w * .09) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; wrapText(g, c.name, w / 2, h * .4, w * .84, w * .11, 5); }
  if (c.noSticker) return;
  if (c.ask) { sticker(g, w, 'ASK', { font: '700 ' + Math.round(w * .15) + 'px Caveat, cursive', ink: '#b3261e', y: h * .02, right: w - w * .02, rot: -.08 }); return; }
  sticker(g, w, gunPrice(c.price), { font: '700 ' + Math.round(w * .09) + 'px "Cutive Mono", monospace', ink: '#1b2a55', y: bb ? Math.max(h * .01, bb.y0 + (bb.y1 - bb.y0) * .08) : h * .03, right: bb ? Math.min(w - w * .01, bb.x1 + w * .02) : null, rot: (seed(keyOf(c) + '|st')() - .5) * .14 });
}
async function cardTex(c, w) {
  await fonts; let im = null;
  if (hasPhoto(c)) { try { im = await loadImg(img(c.image, w > 300 ? 1000 : (c.sealed ? 500 : 300))); } catch (x) {} }
  if (c.slab && im && c.plain) {   // in the hand: the whole photo as taken, on white - the cut-out is for the cabinet (owner, 2026-11-12: "the X screen make it white background")
    return ctex(w, Math.round(w / (c.ar || .75)), (g, cw, chh) => { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, chh); const sc = Math.min(cw / im.width, chh / im.height), iw = im.width * sc, ih = im.height * sc; g.drawImage(im, (cw - iw) / 2, (chh - ih) / 2, iw, ih); if (c.noSticker) return;
      if (c.ask) sticker(g, cw, 'ASK', { font: '700 ' + Math.round(cw * .13) + 'px Caveat, cursive', ink: '#b3261e', y: chh * .015, right: cw - cw * .02, rot: -.08 });
      else sticker(g, cw, gunPrice(c.price), { font: '700 ' + Math.round(cw * .075) + 'px "Cutive Mono", monospace', ink: '#1b2a55', y: chh * .015, right: cw - cw * .02, rot: (seed(keyOf(c) + '|st')() - .5) * .1 }); });
  }
  if (c.slab && im) {
    const tw = Math.min(1400, Math.round(w * 1.8)), th = Math.round(tw * im.height / im.width), tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
    const tg = tmp.getContext('2d', { willReadFrequently: true }); tg.drawImage(im, 0, 0, tw, th);
    const bb = cutWhite(tg, tw, th, true); let sx = 0, sy = 0, sw = tw, sh = th;
    if (bb && bb.x1 - bb.x0 > tw * .25 && bb.y1 - bb.y0 > th * .25) { sx = bb.x0; sy = bb.y0; sw = bb.x1 - bb.x0 + 1; sh = bb.y1 - bb.y0 + 1; }
    if (!c.noSticker) c.cut = sw / sh;   // the slab's own shape, for whatever holds it
    return ctex(w, Math.round(w * sh / sw), (g, cw, chh) => { g.clearRect(0, 0, cw, chh); g.drawImage(tmp, sx, sy, sw, sh, 0, 0, cw, chh); if (c.noSticker) return;
      if (c.ask) sticker(g, cw, 'ASK', { font: '700 ' + Math.round(cw * .17) + 'px Caveat, cursive', ink: '#b3261e', y: chh * .01, right: cw - cw * .01, rot: -.08 });
      else sticker(g, cw, gunPrice(c.price), { font: '700 ' + Math.round(cw * .1) + 'px "Cutive Mono", monospace', ink: '#1b2a55', y: chh * .01, right: cw - cw * .01, rot: (seed(keyOf(c) + '|st')() - .5) * .12 }); });
  }
  if (c.sealed) return ctex(w, Math.round(w / (c.ar || 1)), (g, cw, chh) => drawSealed(g, cw, chh, c, im));
  return ctex(w, Math.round(w * CH / CW), (g, cw, chh) => drawCard(g, cw, chh, c, im));
}
// Put a card's texture on a mesh; a newer request for the same mesh wins.
function wear(mesh, c, w) {
  const tk = mesh.userData.tk = (mesh.userData.tk || 0) + 1;
  return cardTex(c, w).then((t) => {
    if (mesh.userData.tk !== tk || !mesh.parent) { t.dispose(); return; }
    const old = mesh.material.map; mesh.material.map = t; mesh.material.needsUpdate = true; if (old && !old.userData.keep) old.dispose(); kick();
  });
}
function bare(mesh) { mesh.userData.tk = (mesh.userData.tk || 0) + 1; const old = mesh.material.map; if (old && !old.userData.keep) { mesh.material.map = phTex; mesh.material.needsUpdate = true; old.dispose(); } }

/* ---------- shared pieces ---------- */
const keep = (o) => { o.userData.keep = true; return o; };
const phTex = keep(ctex(64, 90, (g, w, h) => { rr(g, 0, 0, w, h, 2); g.fillStyle = '#d7dfe2'; g.fill(); g.fillStyle = '#3a2a2e'; g.fillRect(4, 6, w - 8, h - 10); }));
const geoC = keep(new THREE.PlaneGeometry(CW, CH));                                            // a card, centred
const geoB = keep(new THREE.PlaneGeometry(CW, CH).translate(0, CH / 2, 0));                    // a card standing on its bottom edge
const geoSlab = keep(new THREE.BoxGeometry(CW, CH, .0006).translate(0, CH / 2, 0));
const woodT = keep(ctex(512, 256, (g, w, h) => drawWood(g, w, h, '#6b4020', 4), [2, 1]));
const darkWoodT = keep(ctex(512, 256, (g, w, h) => drawWood(g, w, h, '#3d2412', 3), [2, 1]));
const feltT = keep(ctex(256, 256, drawFelt, [4, 1]));
const lam = (o) => new THREE.MeshLambertMaterial(o);
const woodM = keep(lam({ map: woodT })), darkWoodM = keep(lam({ map: darkWoodT })), feltM = keep(lam({ map: feltT }));
const glassT = keep(ctex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(200,225,255,.05)'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3; i++) { const gr = g.createLinearGradient(i * 90, 0, i * 90 + 120, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.13)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(i * 90 + 30, 0); g.lineTo(i * 90 + 60 + i * 8, 0); g.lineTo(i * 90 + 10 + i * 8, h); g.lineTo(i * 90 - 20, h); g.fill(); } }));
const glassM = keep(new THREE.MeshBasicMaterial({ map: glassT, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
const hitM = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
function bx(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; }
function pl(w, h, mat, x, y, z, ry, parent) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = ry || 0; (parent || scene).add(m); return m; }
function kill(g) {
  if (!g) return;
  g.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach((m) => { if (m.userData.keep) return; if (m.map && !m.map.userData.keep) m.map.dispose(); m.dispose(); }); });
  if (g.parent) g.parent.remove(g);
}
const hot = [];                              // things a tap can walk to or set off
const hit = (mesh, act) => { mesh.userData.act = act; hot.push(mesh); return mesh; };

/* ---------- the room ---------- */
let hemi, sun, lampL, tubeM, shadeM, bell, pileG, signT, neonL, neonHalo, rwFull, rwShort, rwUp;
// Track lighting (owner, 2026-11-11: "can we put some track lighting up"): black cans on a rail, each with a lit lens.
// heads: [x, y, z, tilt about x, tilt about z]
function trackHeads(parent, heads) {
  const can = new THREE.InstancedMesh(new THREE.CylinderGeometry(.04, .055, .13, 12), lam({ color: 0x141416 }), heads.length), lens = new THREE.InstancedMesh(new THREE.SphereGeometry(.036, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff3cf }), heads.length), o = new THREE.Object3D(), dir = new V3();
  heads.forEach((h, k) => { o.position.set(h[0], h[1], h[2]); o.rotation.set(h[3], 0, h[4]); o.scale.set(1, 1, 1); o.updateMatrix(); can.setMatrixAt(k, o.matrix); dir.set(0, -1, 0).applyEuler(o.rotation); o.position.addScaledVector(dir, .06); o.updateMatrix(); lens.setMatrixAt(k, o.matrix); });
  parent.add(can); parent.add(lens);
}
function poster(w, h, draw) { return new THREE.MeshLambertMaterial({ map: ctex(w, h, draw) }); }
function buildRoom() {
  hemi = new THREE.HemisphereLight(0xfff3dc, 0x4a3a2c, 2.6); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(1.5, 4, 3); scene.add(sun);
  lampL = new THREE.PointLight(0xffc27a, 0, 6, 1.6); lampL.position.set(2.2, 1.35, -.85); scene.add(lampL);
  const floor = pl(8, 7, lam({ map: ctex(256, 256, drawCarpet, [9, 8]) }), 0, 0, 0); floor.rotation.x = -PI / 2;
  const ceil = pl(8, 7, lam({ map: ctex(128, 128, drawCeil, [13, 12]) }), 0, CEIL, 0); ceil.rotation.x = PI / 2;
  const wallM = lam({ map: ctex(512, 1024, drawWall, [8, 1]) });
  pl(8, 2.9, wallM, 0, 1.45, -3.5, 0); pl(8, 2.9, wallM, 0, 1.45, 3.5, PI); pl(7, 2.9, wallM, -4, 1.45, 0, PI / 2); rwFull = pl(7, 2.9, wallM, 4, 1.45, 0, -PI / 2); rwShort = pl(4.7, 2.9, lam({ map: ctex(512, 1024, drawWall, [5, 1]) }), 4, 1.45, -1.15, -PI / 2); rwShort.visible = false;
  const upM = lam({ color: 0xc4b693 }), uh = CEIL - 2.9, uy = 2.9 + uh / 2;   // the walls above the border
  pl(8, uh, upM, 0, uy, -3.5, 0); pl(8, uh, upM, 0, uy, 3.5, PI); pl(7, uh, upM, -4, uy, 0, PI / 2); rwUp = pl(7, uh, upM, 4, uy, 0, -PI / 2);
  // fluorescent tubes, hung on rods now the ceiling is high
  tubeM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.6], [1.8, 1.6]].forEach((p) => { bx(1.3, .05, .3, lam({ color: 0xbdb8a8 }), p[0], 3.5, p[1]); bx(1.2, .03, .06, tubeM, p[0], 3.465, p[1] - .07); bx(1.2, .03, .06, tubeM, p[0], 3.465, p[1] + .07); [-.5, .5].forEach((dx) => bx(.012, CEIL - 3.525, .012, lam({ color: 0x55555c }), p[0] + dx, (CEIL + 3.525) / 2, p[1])); });
  // track lights: a rail over the counter aimed at the case and the back wall, one down the left side for the cabinet, racks and arcades
  const railM = lam({ color: 0x141416 }), th = [];
  bx(5.6, .03, .05, railM, -.5, 3.2, .1); [-2.8, -.5, 1.8].forEach((x) => bx(.012, CEIL - 3.2, .012, railM, x, (CEIL + 3.2) / 2, .1));
  for (let i = 0; i < 8; i++) th.push([-3.0 + i * .72, 3.12, .1, i % 2 ? .75 : .45, 0]);
  bx(.05, .03, 5.4, railM, -2.6, 3.2, .3); [-2.0, .3, 2.6].forEach((z) => bx(.012, CEIL - 3.2, .012, railM, -2.6, (CEIL + 3.2) / 2, z));
  for (let i = 0; i < 7; i++) th.push([-2.6, 3.12, -2.2 + i * .82, 0, -.6]);
  trackHeads(scene, th);
  // the front door behind you: daylight through the glass, the OPEN sign seen from inside
  pl(1.05, 2.15, poster(256, 512, (g, w, h) => { g.fillStyle = '#3a200d'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#dfeaf2'); gr.addColorStop(.6, '#b9c9bf'); gr.addColorStop(1, '#8b8f84'); g.fillStyle = gr; g.fillRect(22, 22, w - 44, h - 120); g.fillStyle = '#c0392b'; g.fillRect(70, 120, 116, 56); g.fillStyle = '#fff'; g.font = '700 34px Inter, sans-serif'; g.textAlign = 'center'; g.save(); g.translate(128, 160); g.scale(-1, 1); g.fillText('OPEN', 0, 0); g.restore(); g.fillStyle = '#b08a3a'; g.fillRect(w - 44, h * .55, 14, 46); }), 1.7, 1.075, 3.49, PI);
  // posters and notes
  pl(.62, .86, poster(360, 500, (g, w, h) => { g.fillStyle = '#1f2a6b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c230'; g.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * PI * 2, r = i % 2 ? 150 : 115; g.lineTo(w / 2 + Math.cos(a) * r, 185 + Math.sin(a) * r); } g.fill(); g.fillStyle = '#c0392b'; g.font = '36px "Permanent Marker", cursive'; g.textAlign = 'center'; g.fillText('FRIDAY', w / 2, 170); g.fillText('NIGHT', w / 2, 212); g.fillStyle = '#fff'; g.font = '700 40px Inter, sans-serif'; g.fillText('TOURNAMENT', w / 2, 390); g.font = '600 24px Inter, sans-serif'; g.fillText('7 PM · sign up at the counter', w / 2, 432); g.fillStyle = '#2fd0c5'; g.fillRect(30, 455, w - 60, 8); }), .78, 1.8, 3.49, PI);
  pl(.7, .5, poster(420, 300, (g, w, h) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = '700 62px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('WE BUY', w / 2, 110); g.fillText('CARDS', w / 2, 180); g.font = '30px "Permanent Marker", cursive'; g.fillStyle = '#c0392b'; g.fillText('cash or store credit', w / 2, 245); }), -.2, 1.75, 3.49, PI);
  pl(.42, .56, poster(300, 400, (g, w, h) => { g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d3a8a'; g.font = '700 34px Caveat, cursive'; g.textAlign = 'center'; ['Please ask before', 'opening the case.', '', 'No drinks near', 'the cards!', '', '— thanks, mgmt'].forEach((l, i) => g.fillText(l, w / 2, 70 + i * 44)); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(w / 2, 20, 9, 0, PI * 2); g.fill(); }), -2.75, 1.7, 3.49, PI);   // on the door wall: the right wall is gone (owner, 2026-11-11)
  pl(1.1, .75, poster(550, 375, (g, w, h) => { g.fillStyle = '#9a6b3c'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, ['#7d5329', '#b98a55', '#8a5f33'], .7); g.strokeStyle = '#4a2a12'; g.lineWidth = 16; g.strokeRect(0, 0, w, h); const r = seed('cork'); [['WANTED:', 'old collections'], ['Sleeves', '2 for $5'], ['League', 'Tuesdays 6pm'], ['Lost binder?', 'ask at the till']].forEach((n, i) => { g.save(); g.translate(90 + i * 125, 110 + (i % 2) * 130); g.rotate((r() - .5) * .2); g.fillStyle = ['#f6f1e2', '#f7e98e', '#cfe6f5', '#f6c9d0'][i]; g.fillRect(-55, -50, 110, 100); g.fillStyle = '#1d3a8a'; g.font = '700 22px Caveat, cursive'; g.textAlign = 'center'; g.fillText(n[0], 0, -8); g.fillText(n[1], 0, 20); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, -40, 6, 0, PI * 2); g.fill(); g.restore(); }); }), -1.6, 1.65, 3.49, PI);   // the cork board hangs on the door wall now: the right wall has the model racks
  // the shop sign over the boxes: the logo when the CDN lets us draw it, the name in marker until then
  // (owner, 2026-11-09: "make the exor logo neon lit"): a dark backing board, the logo glowing on it, a halo on the wall and a light of its own
  const drawSign = (im) => (g, w, h) => {
    g.fillStyle = '#0d0a0b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2022'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.save();
    if (im) {
      const s = Math.min((w - 150) / im.width, (h - 90) / im.height), iw = im.width * s, ih = im.height * s, x = (w - iw) / 2, y = (h - ih) / 2;
      [['#ff2a2a', 46], ['#ff7a2a', 26], ['#ffd76a', 12]].forEach((p) => { g.shadowColor = p[0]; g.shadowBlur = p[1]; g.drawImage(im, x, y, iw, ih); });   // the glow, wide to tight
      g.shadowColor = 'transparent'; g.filter = 'brightness(1.25) saturate(1.2)'; g.drawImage(im, x, y, iw, ih);
    } else {
      g.font = '96px "Permanent Marker", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      [['#ff2a2a', 46, 10], ['#ff5a3a', 22, 7]].forEach((p) => { g.shadowColor = p[0]; g.shadowBlur = p[1]; g.strokeStyle = p[0]; g.lineWidth = p[2]; g.strokeText('EXOR GAMES', w / 2, h / 2); });
      g.shadowBlur = 6; g.strokeStyle = '#ffe9dc'; g.lineWidth = 3; g.strokeText('EXOR GAMES', w / 2, h / 2);
    }
    g.restore();
  };
  signT = ctex(900, 300, drawSign(null)); pl(2.1, .7, new THREE.MeshBasicMaterial({ map: signT }), -.4, 2.4, -3.47, 0);
  const halo = pl(3.4, 1.5, new THREE.MeshBasicMaterial({ map: ctex(256, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,70,40,.55)'); gr.addColorStop(.5, 'rgba(255,60,40,.16)'); gr.addColorStop(1, 'rgba(255,60,40,0)'); g.save(); g.translate(0, h / 2); g.scale(1, h / w); g.translate(0, -h / 2); g.fillStyle = gr; g.fillRect(0, -h, w, h * 3); g.restore(); }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), -.4, 2.4, -3.485, 0);
  neonHalo = halo.material;
  neonL = new THREE.PointLight(0xff4a30, 1.2, 4.5, 1.4); neonL.position.set(-.4, 2.3, -2.9); scene.add(neonL);
  loadImg(img(LOGO, 700)).then((im) => { drawSign(im)(signT.image.getContext('2d'), 900, 300); signT.needsUpdate = true; kick(); }).catch(() => {});
  // the till counter beside the case
  bx(1.4, TOP - .03, .5, woodM, X1 + .72, (TOP - .03) / 2, -.9); bx(1.44, .03, .54, darkWoodM, X1 + .72, TOP - .015, -.9);
  const till = new THREE.Group(); till.position.set(2.0, TOP, -.93); scene.add(till);
  const beige = lam({ color: 0xcfc7b0 }), dark = lam({ color: 0x2a2a2a });
  bx(.36, .1, .38, beige, 0, .05, 0, till); bx(.34, .012, .2, dark, 0, .1, .08, till).rotation.x = .25; bx(.3, .1, .12, beige, 0, .16, -.11, till);
  pl(.2, .05, new THREE.MeshBasicMaterial({ map: ctex(200, 50, (g, w, h) => { g.fillStyle = '#0d1a0d'; g.fillRect(0, 0, w, h); g.fillStyle = '#5dff7a'; g.font = '700 34px "Cutive Mono", monospace'; g.textAlign = 'right'; g.fillText('0.00', w - 12, 38); }) }), 0, .17, -.049, 0, till);
  for (let i = 0; i < 12; i++) bx(.03, .012, .03, lam({ color: i === 11 ? 0xc0392b : 0xe9e4d4 }), -.09 + (i % 4) * .045, .112 + (2 - Math.floor(i / 4)) * .011, .04 + Math.floor(i / 4) * .042, till).rotation.x = .25;
  // (owner, 2026-11-09: "Till should be facing away from customer"): the keys and the big display face the staff; the customer sees its back and a small total display
  till.rotation.y = PI;
  tillT = ctex(140, 35, (g) => drawTill(g, 0)); pl(.14, .035, new THREE.MeshBasicMaterial({ map: tillT }), 0, .175, -.1705, PI, till);
  hit(bx(.42, .34, .44, hitM, 2.0, TOP + .15, -.93), 'till');
  buildClerk();
  // the counter bell
  bell = new THREE.Group(); bell.position.set(1.5, TOP, -.76); scene.add(bell);
  const brass = lam({ color: 0xd0a63c, emissive: 0x3a2a08 });
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(.04, .042, .008, 24), dark); b1.position.y = .004; bell.add(b1);
  const b2 = new THREE.Mesh(new THREE.SphereGeometry(.034, 24, 12, 0, PI * 2, 0, PI / 2), brass); b2.position.y = .008; bell.add(b2);
  const b3 = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .016, 12), dark); b3.position.y = .048; bell.add(b3);
  hit(bx(.12, .1, .12, hitM, 1.5, TOP + .04, -.76), 'bell');
  // a banker's lamp: tap it for the evening light
  const lamp = new THREE.Group(); lamp.position.set(2.42, TOP, -1.02); scene.add(lamp);
  const l1 = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .015, 20), brass); l1.position.y = .008; lamp.add(l1);
  const l2 = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .2, 10), brass); l2.position.y = .11; lamp.add(l2);
  shadeM = new THREE.MeshLambertMaterial({ color: 0x1f6b3a, emissive: 0x000000 });
  const l3 = new THREE.Mesh(new THREE.CylinderGeometry(.045, .075, .07, 20, 1, false, 0, PI), shadeM); l3.rotation.z = PI / 2; l3.rotation.y = PI / 2; l3.position.set(0, .23, .03); lamp.add(l3);
  hit(bx(.2, .32, .2, hitM, 2.42, TOP + .15, -1.0), 'lights');
  pileG = new THREE.Group(); pileG.position.set(1.7, TOP, -1.0); scene.add(pileG);
  buildHobby();
}
/* ---------- the arcade cabinet plays (owner, 2026-11-10) ----------
   "Can you make the arcade play space invaders but the ship is a sword". The cabinet runs a shooter of that
   kind, drawn and named for this shop rather than copied from the original: SWORD STORM. A sword at the
   bottom throws daggers up at rows of bats, skulls and slimes that march across and step down, faster as
   they thin out, dropping fireballs. Three lives, waves, a high score kept on this device. Tap the cabinet
   to walk up; drag (or the arrow keys) moves the sword, it throws by itself (space throws too).
   Owner, later the same day, with the Mallow Games mascot: "Make sword shooter into Mallow Shooter where it
   sprays molting hot marsh mallow into the invaders. This is the main character" -> the sword is now the
   mascot (white marshmallow head with two points, a pink curl, a dark collar with a blue button, a blue
   bowl), drawn small in pixels, and what it throws is a fan of three blobs of molten marshmallow that splat
   on what they hit. The cabinet and the title read MALLOW SHOOTER. */
const arc = { W: 240, H: 192, state: 'attract', x: 120, score: 0, hi: 0, lives: 3, wave: 1, en: [], shots: [], balls: [], ox: 0, oy: 0, dir: 1, t: 0, fire: 0, drop: 0, safe: 0, keys: {}, last: 0, pops: [] };
arc.cv = document.createElement('canvas'); arc.cv.width = arc.W * 2; arc.cv.height = arc.H * 2; arc.g = arc.cv.getContext('2d');
arc.tex = keep(new THREE.CanvasTexture(arc.cv)); arc.tex.colorSpace = THREE.SRGBColorSpace; arc.tex.magFilter = THREE.NearestFilter;
try { arc.hi = Number(localStorage.getItem('xgSwordStormHi')) || 0; } catch (x) {}
function arcBlip(f, d, v) { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, f * .5), t + d); g.gain.setValueAtTime(v || .03, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .02); } catch (x) {} }
function arcWave() {
  arc.en = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) arc.en.push({ c, r, kind: r === 0 ? 'bat' : r === 1 ? 'skull' : 'slime', alive: true });
  arc.ox = 0; arc.oy = Math.min(40, (arc.wave - 1) * 6); arc.dir = 1; arc.shots = []; arc.balls = []; arc.drop = 1.2;
}
function arcNew() { arc.state = 'play'; arc.score = 0; arc.lives = 3; arc.wave = 1; arc.x = 120; arc.safe = 1; arc.fire = .3; arcWave(); }
const arcPos = (e) => ({ x: 22 + e.c * 22 + arc.ox, y: 26 + e.r * 16 + arc.oy });
function arcStep(dt) {
  arc.t += dt; if (arc.state !== 'play') return;
  const k = arc.keys; if (k.ArrowLeft) arc.x -= 130 * dt; if (k.ArrowRight) arc.x += 130 * dt; arc.x = clamp(arc.x, 10, arc.W - 10);
  arc.safe = Math.max(0, arc.safe - dt); arc.fire -= dt;
  if (arc.fire <= 0 || (k[' '] && arc.fire < .22)) { [-30, 0, 30].forEach((vx) => arc.shots.push({ x: arc.x + vx * .08, y: 150, vx })); arc.fire = .55; arcBlip(520, .09, .015); }
  arc.shots.forEach((s) => { s.y -= 170 * dt; s.x += s.vx * dt; }); arc.shots = arc.shots.filter((s) => s.y > 8 && s.x > 2 && s.x < arc.W - 2);
  const live = arc.en.filter((e) => e.alive); if (!live.length) { arc.wave++; arcWave(); arcBlip(1320, .3, .03); return; }
  let lo = 1e9, hi = -1e9, low = 0; live.forEach((e) => { const p = arcPos(e); lo = Math.min(lo, p.x); hi = Math.max(hi, p.x); low = Math.max(low, p.y); });
  arc.ox += arc.dir * (10 + (32 - live.length) * 1.9 + arc.wave * 3) * dt;
  if ((arc.dir > 0 && hi > arc.W - 14) || (arc.dir < 0 && lo < 14)) { arc.dir *= -1; arc.oy += 7; }
  // daggers against the horde
  arc.shots.forEach((s) => { if (s.dead) return; for (const e of live) { if (!e.alive) continue; const p = arcPos(e); if (Math.abs(s.x - p.x) < 8 && Math.abs(s.y - p.y) < 7) { e.alive = false; s.dead = true; arc.score += e.kind === 'bat' ? 30 : e.kind === 'skull' ? 20 : 10; arc.pops.push({ x: p.x, y: p.y, t: .25 }); arcBlip(220, .09, .03); break; } } });
  arc.shots = arc.shots.filter((s) => !s.dead); arc.pops.forEach((p) => { p.t -= dt; }); arc.pops = arc.pops.filter((p) => p.t > 0);
  // fireballs from whoever is lowest in a column
  arc.drop -= dt; if (arc.drop <= 0) { const cols = {}; live.forEach((e) => { if (!cols[e.c] || cols[e.c].r < e.r) cols[e.c] = e; }); const list = Object.keys(cols), e = cols[list[Math.floor(Math.random() * list.length)]], p = arcPos(e); arc.balls.push({ x: p.x, y: p.y + 6 }); arc.drop = Math.max(.35, 1.15 - arc.wave * .08) * (.6 + Math.random() * .8); }
  arc.balls.forEach((b) => { b.y += (62 + arc.wave * 7) * dt; if (!arc.safe && Math.abs(b.x - arc.x) < 10 && b.y > 153 && b.y < 180) { b.y = 999; arc.lives--; arc.safe = 1.4; arcBlip(110, .35, .05); } }); arc.balls = arc.balls.filter((b) => b.y < arc.H);
  if (arc.lives <= 0 || low > 152) { arc.state = 'over'; arc.overAt = arc.t; if (arc.score > arc.hi) { arc.hi = arc.score; try { localStorage.setItem('xgSwordStormHi', String(arc.hi)); } catch (x) {} } }
}
function arcSword(g, x, y, s) {   // the Mallow Games mascot; x, y = the middle of its collar
  s = s || 1; const R = (c, ax, ay, w, h) => { g.fillStyle = c; g.fillRect(x + ax * s, y + ay * s, w * s, h * s); };
  R('#fff', -7, -9, 14, 9); R('#fff', -6, -10, 12, 1); R('#fff', -8, -7, 16, 6);                       // the head
  R('#fff', -9, -11, 2, 4); R('#fff', -10, -12, 1, 2); R('#fff', 7, -11, 2, 4); R('#fff', 9, -12, 1, 2);   // its two points
  R('#c2478f', -2, -13, 5, 4); R('#c2478f', -1, -14, 3, 1); R('#c2478f', 2, -10, 2, 1); R('#fff', 0, -12, 1, 1);   // the curl
  R('#f5d9a8', -4, -7, 2, 4); R('#f5d9a8', 2, -7, 2, 4);                                              // eyes
  R('#2e1f1c', -9, -1, 18, 2); R('#4aa3c7', -8, 1, 16, 2); R('#4aa3c7', -6, 3, 12, 1);                  // collar and bowl
  R('#4aa3c7', -2, -2, 4, 4); R('#fff', -1, -1, 2, 2);                                                 // the button
}
function arcFoe(g, kind, x, y, f) {
  if (kind === 'slime') { g.fillStyle = '#4fd65a'; g.fillRect(x - 6, y - 1 - f, 12, 6 + f); g.fillRect(x - 4, y - 4 - f, 8, 3); g.fillRect(x - 7, y + 3, 14, 2); g.fillStyle = '#062b0a'; g.fillRect(x - 3, y - 1 - f, 2, 2); g.fillRect(x + 1, y - 1 - f, 2, 2); }
  else if (kind === 'skull') { g.fillStyle = '#efe7d2'; g.fillRect(x - 5, y - 5, 10, 7); g.fillRect(x - 3, y + 2, 6, 2 + f); g.fillStyle = '#111'; g.fillRect(x - 3, y - 3, 2, 3); g.fillRect(x + 1, y - 3, 2, 3); g.fillRect(x - 1, y + 3 + f, 1, 1); g.fillRect(x + 1, y + 3 + f, 1, 1); }
  else { g.fillStyle = '#b064ff'; g.fillRect(x - 2, y - 3, 4, 6); g.fillRect(x - 3, y - 5, 1, 2); g.fillRect(x + 2, y - 5, 1, 2); const wy = f ? -4 : 0; g.fillRect(x - 8, y - 1 + wy, 6, 2); g.fillRect(x + 2, y - 1 + wy, 6, 2); g.fillRect(x - 8, y + 1 + wy, 2, 2); g.fillRect(x + 6, y + 1 + wy, 2, 2); g.fillStyle = '#ffd23a'; g.fillRect(x - 1, y - 2, 1, 1); g.fillRect(x + 1, y - 2, 1, 1); }
}
function arcDraw() {
  const g = arc.g, W_ = arc.W, H_ = arc.H; g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#07061a'; g.fillRect(0, 0, W_, H_); const r = seed('arcstars'); for (let i = 0; i < 40; i++) { g.fillStyle = i % 3 ? '#3a3a6a' : '#8a8ad0'; g.fillRect(Math.floor(r() * W_), Math.floor((r() * H_ + arc.t * (i % 3 ? 4 : 9)) % H_), 1, 1); }
  g.fillStyle = '#2a1b4a'; g.fillRect(0, 182, W_, 10); g.fillStyle = '#ff4f9a'; g.fillRect(0, 181, W_, 1);
  g.font = '700 9px "Cutive Mono", monospace'; g.textBaseline = 'top'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText('SCORE ' + String(arc.score).padStart(5, '0'), 6, 4); g.textAlign = 'right'; g.fillText('HI ' + String(Math.max(arc.hi, arc.score)).padStart(5, '0'), W_ - 6, 4);
  const f = Math.floor(arc.t * 2.5) % 2;
  if (arc.state === 'attract') {
    ['bat', 'skull', 'slime'].forEach((kd, i) => { for (let c = 0; c < 6; c++) arcFoe(g, kd, 50 + c * 28 + Math.sin(arc.t + i) * 8, 40 + i * 18, f); });
    g.textAlign = 'center'; g.font = '900 24px Inter, sans-serif'; g.fillStyle = '#111'; g.fillText('MALLOW', W_ / 2 + 1, 89); g.fillText('SHOOTER', W_ / 2 + 1, 111); g.fillStyle = '#e06aa6'; g.fillText('MALLOW', W_ / 2, 88); g.fillStyle = '#4fb3da'; g.fillText('SHOOTER', W_ / 2, 110);
    arcSword(g, W_ / 2, 155, 1.45); g.font = '700 10px "Cutive Mono", monospace'; g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText(S.mode === 'arcade' ? 'TAP TO START' : 'INSERT COIN', W_ / 2, 168);
  } else {
    arc.en.forEach((e) => { if (e.alive) { const p = arcPos(e); arcFoe(g, e.kind, p.x, p.y, f); } });
    arc.pops.forEach((p) => { g.fillStyle = '#fff'; g.fillRect(p.x - 3, p.y - 2, 6, 4); g.fillStyle = '#fff3d6'; [[-5, -5], [5, -5], [-5, 5], [5, 5], [0, -7], [0, 7], [-7, 0], [7, 0]].forEach((d) => g.fillRect(p.x + d[0] * (1.3 - p.t * 3), p.y + d[1] * (1.3 - p.t * 3), 2, 2)); });
    arc.shots.forEach((s) => { g.fillStyle = '#ff9a3a'; g.fillRect(s.x - 1, s.y + 3, 2, 3); g.fillStyle = '#fff'; g.fillRect(s.x - 2, s.y - 2, 4, 5); g.fillRect(s.x - 1, s.y - 3, 2, 1); g.fillStyle = '#ffe9a8'; g.fillRect(s.x - 1, s.y, 2, 2); });   // molten marshmallow: white, hot in the middle, a drip behind
    arc.balls.forEach((b) => { g.fillStyle = '#ff7a2a'; g.fillRect(b.x - 1.5, b.y - 2, 3, 4); g.fillStyle = '#ffd23a'; g.fillRect(b.x - .5, b.y - 4, 1, 3); });
    if (arc.state === 'play' && !(arc.safe && Math.floor(arc.t * 12) % 2)) arcSword(g, arc.x, 172, 1.4);
    for (let i = 0; i < arc.lives; i++) arcSword(g, 10 + i * 13, 190, .5);
    g.textAlign = 'right'; g.fillStyle = '#7dfff0'; g.fillText('WAVE ' + arc.wave, W_ - 6, 183);
    if (arc.state === 'over') { g.textAlign = 'center'; g.fillStyle = '#000000b0'; g.fillRect(30, 70, W_ - 60, 56); g.font = '900 20px Inter, sans-serif'; g.fillStyle = '#ff4f9a'; g.fillText('GAME OVER', W_ / 2, 78); g.font = '700 10px "Cutive Mono", monospace'; g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText('TAP TO PLAY AGAIN', W_ / 2, 106); }
  }
  arc.tex.needsUpdate = true;
}
// straight at the screen, as close as it fits
const CAB_Z = { arcade: -.13, stack: -.85, dunk: -1.57, line: -2.29 };   // the four cabinets, on the left wall
const arcadeView = () => cabView(CAB_Z.arcade);
function arcTap() { if (arc.state === 'attract' || (arc.state === 'over' && arc.t - arc.overAt > .6)) { arcNew(); arcBlip(660, .2, .03); hint(''); } else if (arc.state === 'play' && arc.fire < .25) arc.fire = 0; }
function arcRun() {
  arc.state = 'attract'; arc.keys = {}; arc.last = 0; const id = arc.id = (arc.id || 0) + 1;
  anims.push((now) => { if (S.mode !== 'arcade' || arc.id !== id) return false; const dt = arc.last ? Math.min(.05, (now - arc.last) / 1000) : 0; arc.last = now; arcStep(dt); arcDraw(); return true; }); kick();
}
function arcStop() { if (arc.state === 'attract' && !arc.id) return; arc.id = (arc.id || 0) + 1; arc.state = 'attract'; arc.keys = {}; arcDraw(); kick(); }
document.addEventListener('keydown', (e) => { if (S.mode !== 'arcade') return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') { arc.keys[e.key] = true; e.preventDefault(); if (e.key === ' ' && arc.state !== 'play') arcTap(); } else if (e.key === 'Enter') arcTap(); });
document.addEventListener('keyup', (e) => { delete arc.keys[e.key]; });

/* ---------- a second cabinet and the TV (owner, 2026-11-10) ----------
   "Put another arcade that is Tetris. Tv on wall make it clickable and it play an ad for exor to sell us
   cards in a 1990s infomercial way".
   BOX STACK: a falling-block puzzle of that kind with its own name, pieces and look - card boxes of two to
   four drop into a well eight wide, a full row is sold off the shelf. Drag moves the piece, a tap turns it,
   a swipe down drops it; arrows, up and space on a keyboard.
   The TV: tap it and a made-up 1990s infomercial for selling your cards to the shop plays on a loop, with a
   button under it to the real buylist page. It promises nothing the shop has not said: we buy cards, singles
   or bulk, cash or store credit, build a list online. A second spot follows it for Mallow Games, with the
   logo the owner sent (public/mallow-games.jpg). Owner, 2026-11-10: Mallow is the "sister site that you sell
   physical video games to for store credit or cash ... we recently made it that you can sell video games for
   exor games store credit ... essentially sell your video games for exor games store credit to buy cards". */
const stk = { W: 8, H: 14, C: 12, state: 'attract', grid: [], p: null, nx: null, score: 0, lines: 0, hi: 0, t: 0, fall: 0, keys: {}, flash: 0 };
stk.cv = document.createElement('canvas'); stk.cv.width = 480; stk.cv.height = 384; stk.g = stk.cv.getContext('2d');
stk.tex = keep(new THREE.CanvasTexture(stk.cv)); stk.tex.colorSpace = THREE.SRGBColorSpace; stk.tex.magFilter = THREE.NearestFilter;
try { stk.hi = Number(localStorage.getItem('xgBoxStackHi')) || 0; } catch (x) {}
const STK_P = [[[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]]];
const STK_C = ['#ffd23a', '#19b5a5', '#ff4f9a', '#7a3fc4', '#3f8fe0', '#ff7a2a', '#4fd65a', '#d62c28'];
const stkPiece = () => { const k = Math.floor(Math.random() * STK_P.length); return { k, cells: STK_P[k].map((c) => c.slice()), x: 3, y: 0 }; };
const stkFits = (cells, x, y) => cells.every((c) => { const cx = x + c[0], cy = y + c[1]; return cx >= 0 && cx < stk.W && cy < stk.H && (cy < 0 || !stk.grid[cy][cx]); });
function stkNew() { stk.grid = Array.from({ length: stk.H }, () => Array(stk.W).fill(0)); stk.score = 0; stk.lines = 0; stk.fall = 0; stk.state = 'play'; stk.nx = stkPiece(); stkSpawn(); }
function stkSpawn() { stk.p = stk.nx; stk.nx = stkPiece(); stk.p.x = 3; stk.p.y = 0; if (!stkFits(stk.p.cells, stk.p.x, stk.p.y)) { stk.state = 'over'; stk.overAt = stk.t; if (stk.score > stk.hi) { stk.hi = stk.score; try { localStorage.setItem('xgBoxStackHi', String(stk.hi)); } catch (x) {} } arcBlip(110, .4, .05); } }
function stkMove(dx) { if (stk.state !== 'play') return false; if (stkFits(stk.p.cells, stk.p.x + dx, stk.p.y)) { stk.p.x += dx; return true; } return false; }
function stkTurn() {
  if (stk.state !== 'play') return; let c = stk.p.cells.map((q) => [-q[1], q[0]]); const mx = Math.min.apply(null, c.map((q) => q[0])), my = Math.min.apply(null, c.map((q) => q[1])); c = c.map((q) => [q[0] - mx, q[1] - my]);
  for (const kx of [0, -1, 1, -2]) if (stkFits(c, stk.p.x + kx, stk.p.y)) { stk.p.cells = c; stk.p.x += kx; arcBlip(700, .04, .012); return; }
}
function stkLock() {
  stk.p.cells.forEach((c) => { const y = stk.p.y + c[1]; if (y >= 0) stk.grid[y][stk.p.x + c[0]] = stk.p.k + 1; });
  const keepRows = stk.grid.filter((r) => r.some((v) => !v)), n = stk.H - keepRows.length, lvl = 1 + Math.floor(stk.lines / 8);
  if (n) { stk.grid = Array.from({ length: n }, () => Array(stk.W).fill(0)).concat(keepRows); stk.lines += n; stk.score += [0, 100, 300, 500, 800][n] * lvl; stk.flash = .25; arcBlip(520 + n * 180, .18, .035); } else arcBlip(160, .05, .02);
  stkSpawn();
}
function stkDown(hard) { if (stk.state !== 'play') return; if (hard) { while (stkFits(stk.p.cells, stk.p.x, stk.p.y + 1)) { stk.p.y++; stk.score += 1; } stkLock(); stk.fall = 0; return; } if (stkFits(stk.p.cells, stk.p.x, stk.p.y + 1)) stk.p.y++; else stkLock(); stk.fall = 0; }
function stkStep(dt) { stk.t += dt; stk.flash = Math.max(0, stk.flash - dt); if (stk.state !== 'play') return; stk.fall += dt * (stk.keys.ArrowDown ? 8 : 1); if (stk.fall >= Math.max(.1, .75 - (Math.floor(stk.lines / 8)) * .07)) stkDown(false); }
function stkBox(g, x, y, k, s) { s = s || 12; g.fillStyle = '#efe7d2'; g.fillRect(x, y, s - 1, s - 1); g.fillStyle = STK_C[k]; g.fillRect(x, y + Math.round(s * .25), s - 1, Math.round(s * .42)); g.fillStyle = '#00000030'; g.fillRect(x, y + s - 2, s - 1, 1); g.fillRect(x + s - 2, y, 1, s - 1); }
function stkDraw() {
  const g = stk.g, C = stk.C, X0 = 24, Y0 = 16; g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#10182c'; g.fillRect(0, 0, 240, 192); g.fillStyle = '#060a14'; g.fillRect(X0, Y0, stk.W * C, stk.H * C); g.strokeStyle = '#19b5a5'; g.lineWidth = 2; g.strokeRect(X0 - 2, Y0 - 2, stk.W * C + 4, stk.H * C + 4);
  g.fillStyle = '#0d1424'; for (let x = 1; x < stk.W; x++) g.fillRect(X0 + x * C - .5, Y0, 1, stk.H * C);
  const f = Math.floor(stk.t * 2.5) % 2; g.textBaseline = 'top'; g.textAlign = 'left';
  if (stk.state === 'attract') { const r = seed('stack'); for (let y = 8; y < stk.H; y++) for (let x = 0; x < stk.W; x++) if (r() < .25 + (y - 8) * .11) stkBox(g, X0 + x * C, Y0 + y * C, Math.floor(r() * 8)); STK_P[6].forEach((c) => stkBox(g, X0 + (2 + c[0]) * C, Y0 + (2 + Math.floor(stk.t * 1.5) % 5 + c[1]) * C, 6)); }
  else { stk.grid.forEach((row, y) => row.forEach((v, x) => { if (v) stkBox(g, X0 + x * C, Y0 + y * C, v - 1); })); if (stk.state === 'play' && stk.p) { let gy = stk.p.y; while (stkFits(stk.p.cells, stk.p.x, gy + 1)) gy++; g.strokeStyle = '#ffffff40'; g.lineWidth = 1; stk.p.cells.forEach((c) => g.strokeRect(X0 + (stk.p.x + c[0]) * C + .5, Y0 + (gy + c[1]) * C + .5, C - 2, C - 2)); stk.p.cells.forEach((c) => stkBox(g, X0 + (stk.p.x + c[0]) * C, Y0 + (stk.p.y + c[1]) * C, stk.p.k)); } }
  if (stk.flash) { g.fillStyle = 'rgba(255,255,255,' + (stk.flash * 2).toFixed(2) + ')'; g.fillRect(X0, Y0, stk.W * C, stk.H * C); }
  g.font = '900 17px Inter, sans-serif'; g.fillStyle = '#ff4f9a'; g.fillText('BOX', 137, 15); g.fillText('STACK', 137, 33); g.fillStyle = '#ffd23a'; g.fillText('BOX', 136, 14); g.fillText('STACK', 136, 32);
  g.font = '700 9px "Cutive Mono", monospace'; g.fillStyle = '#7dfff0'; g.fillText('SCORE', 136, 62); g.fillText('ROWS', 136, 86); g.fillText('BEST', 136, 110); g.fillText('NEXT', 136, 134);
  g.fillStyle = '#fff'; g.fillText(String(stk.score).padStart(6, '0'), 136, 72); g.fillText(String(stk.lines), 136, 96); g.fillText(String(Math.max(stk.hi, stk.score)).padStart(6, '0'), 136, 120);
  if (stk.nx && stk.state !== 'attract') stk.nx.cells.forEach((c) => stkBox(g, 138 + c[0] * 10, 146 + c[1] * 10, stk.nx.k, 10));
  g.textAlign = 'center';
  if (stk.state === 'attract') { g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText(S.mode === 'stack' ? 'TAP TO START' : 'INSERT COIN', X0 + stk.W * C / 2, 76); }
  if (stk.state === 'over') { g.fillStyle = '#000000c0'; g.fillRect(X0, 70, stk.W * C, 46); g.font = '900 14px Inter, sans-serif'; g.fillStyle = '#ff4f9a'; g.fillText('GAME OVER', X0 + stk.W * C / 2, 76); g.font = '700 8px "Cutive Mono", monospace'; g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText('TAP TO PLAY AGAIN', X0 + stk.W * C / 2, 98); }
  stk.tex.needsUpdate = true;
}
const cabView = (z) => { const fov = 50, d = Math.max(.56, .29 / hTan(fov)); return lookView(new V3(-3.448 + d, 1.3, z), new V3(-3.448, 1.3, z), fov); };
function stkTap() { if (stk.state === 'attract' || (stk.state === 'over' && stk.t - stk.overAt > .6)) { stkNew(); arcBlip(660, .2, .03); hint(''); } else stkTurn(); }
function stkRun() { stk.state = 'attract'; stk.keys = {}; stk.last = 0; const id = stk.id = (stk.id || 0) + 1; anims.push((now) => { if (S.mode !== 'stack' || stk.id !== id) return false; const dt = stk.last ? Math.min(.05, (now - stk.last) / 1000) : 0; stk.last = now; stkStep(dt); stkDraw(); return true; }); kick(); }
function stkStop() { stk.id = (stk.id || 0) + 1; stk.state = 'attract'; stk.keys = {}; stkDraw(); kick(); }
document.addEventListener('keydown', (e) => { if (S.mode !== 'stack') return; const k = e.key; if (k === 'ArrowLeft') stkMove(-1); else if (k === 'ArrowRight') stkMove(1); else if (k === 'ArrowUp') stkTap(); else if (k === 'ArrowDown') stk.keys.ArrowDown = true; else if (k === ' ' || k === 'Enter') { if (stk.state === 'play') stkDown(true); else stkTap(); } else return; e.preventDefault(); });
document.addEventListener('keyup', (e) => { delete stk.keys[e.key]; });

// ---- the TV's infomercial ----
const tv = { t: 0, logo: null, scene: -1 };
tv.cv = document.createElement('canvas'); tv.cv.width = 512; tv.cv.height = 392; tv.g = tv.cv.getContext('2d');
tv.tex = keep(new THREE.CanvasTexture(tv.cv)); tv.tex.colorSpace = THREE.SRGBColorSpace;
function tvDraw(idle) {
  const g = tv.g, W_ = 256, H_ = 196, L = 47, t = idle ? 7.6 : tv.t % L; g.setTransform(2, 0, 0, 2, 0, 0); g.textAlign = 'center'; g.textBaseline = 'middle'; g.filter = 'none';
  const big = (txt, y, px, fill, stroke, rot) => { g.save(); g.translate(W_ / 2, y); g.rotate(rot || 0); g.font = 'italic 900 ' + px + 'px Inter, sans-serif'; g.lineJoin = 'round'; g.lineWidth = px / 5; g.strokeStyle = stroke || '#111'; g.strokeText(txt, 0, 0); g.fillStyle = fill; g.fillText(txt, 0, 0); g.restore(); };
  const burst = (cx, cy, r1, r2, n, col, a0) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (a0 || 0) + i / (n * 2) * PI * 2, r = i % 2 ? r1 : r2; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.fill(); };
  const rays = (c1, c2) => { g.fillStyle = c1; g.fillRect(0, 0, W_, H_); g.fillStyle = c2; for (let i = 0; i < 12; i++) { const a = t * .5 + i / 12 * PI * 2; g.beginPath(); g.moveTo(W_ / 2, H_ / 2); g.lineTo(W_ / 2 + Math.cos(a) * 300, H_ / 2 + Math.sin(a) * 300); g.lineTo(W_ / 2 + Math.cos(a + .26) * 300, H_ / 2 + Math.sin(a + .26) * 300); g.fill(); } };
  const cardAt = (x, y, rot, s) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = '#f4efe0'; g.fillRect(-7 * s, -10 * s, 14 * s, 20 * s); g.fillStyle = '#7a3fc4'; g.fillRect(-5 * s, -8 * s, 10 * s, 9 * s); g.fillStyle = '#999'; g.fillRect(-5 * s, 3 * s, 10 * s, 1.5 * s); g.fillRect(-5 * s, 6 * s, 7 * s, 1.5 * s); g.restore(); };
  let sc = 0;
  if (t < 4) {   // the problem, in black and white
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, W_, H_); const sh = Math.sin(t * 30) * 1.5;
    g.fillStyle = '#5a5a5a'; g.fillRect(84 + sh, 110, 88, 46); g.fillStyle = '#444'; g.fillRect(80 + sh, 104, 96, 10); for (let i = 0; i < 9; i++) cardAt(92 + i * 9 + sh, 100 - (i % 3) * 6, (i - 4) * .22, 1);
    g.fillStyle = '#222'; g.beginPath(); g.arc(208, 78, 9, 0, PI * 2); g.fill(); g.fillRect(205, 87, 6, 34); g.save(); g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.moveTo(208, 96); g.lineTo(192, 80 + sh); g.moveTo(208, 96); g.lineTo(226, 80 - sh); g.moveTo(208, 121); g.lineTo(200, 150); g.moveTo(208, 121); g.lineTo(217, 150); g.stroke(); g.restore();
    big('ARE YOUR OLD CARDS', 26, 17, '#fff', '#222'); big('STUCK IN A SHOEBOX?', 46, 17, '#fff', '#222');
    if (t > 2.4) { g.strokeStyle = '#d62c28'; g.lineWidth = 9; g.beginPath(); g.moveTo(70, 90); g.lineTo(186, 166); g.moveTo(186, 90); g.lineTo(70, 166); g.stroke(); }
  } else if (t < 6.5) { sc = 1; g.fillStyle = '#777'; g.fillRect(0, 0, W_, H_); const z = 1 + Math.min(1, (t - 4) / 2.5) * .25; g.save(); g.translate(W_ / 2, H_ / 2); g.scale(z, z); g.translate(-W_ / 2, -H_ / 2); big("THERE'S GOT TO BE", 76, 21, '#fff', '#111', -.04); big('A BETTER WAY!', 106, 26, '#ffd23a', '#111', -.04); g.restore(); }
  else if (t < 10.5) { sc = 2; rays('#ff4f9a', '#ffd23a'); const k = Math.min(1, (t - 6.5) / .5), s = .2 + k * .8;
    if (tv.logo) { const w = 150 * s, h = w * tv.logo.height / tv.logo.width; g.drawImage(tv.logo, W_ / 2 - w / 2, 62 - h / 2, w, h); } else big('EXOR GAMES', 62, 30 * s, '#d62c28', '#fff');
    if (t > 7.3) { burst(W_ / 2, 138, 44 + Math.sin(t * 8) * 2, 58 + Math.sin(t * 8) * 2, 14, '#d62c28', t); big('WE BUY', 128, 20, '#fff', '#111'); big('CARDS!', 150, 22, '#ffd23a', '#111'); } }
  else if (t < 15) { sc = 3; g.fillStyle = '#19b5a5'; g.fillRect(0, 0, W_, H_); g.fillStyle = '#0e8a7d'; for (let i = -6; i < 12; i++) g.fillRect(i * 30 + (t * 20) % 30, 0, 12, H_);
    big('WE TAKE...', 24, 20, '#fff', '#111'); ['SINGLES!', 'BULK!', 'BUILD A LIST ONLINE!'].forEach((txt, i) => { const k = clamp((t - 11 - i * 1.1) / .35, 0, 1); if (!k) return; const x = lerp(-140, 0, 1 - Math.pow(1 - k, 3)); g.save(); g.translate(x, 0); g.fillStyle = '#ffd23a'; g.fillRect(28, 50 + i * 42, 200, 30); g.fillStyle = '#111'; g.font = 'italic 900 ' + (i === 2 ? 15 : 20) + 'px Inter, sans-serif'; g.textAlign = 'left'; g.fillText('✔ ' + txt, 38, 66 + i * 42); g.textAlign = 'center'; g.restore(); }); }
  else if (t < 19) { sc = 4; const fl = Math.floor(t * 3) % 2; g.fillStyle = '#2f9a44'; g.fillRect(0, 0, W_ / 2, H_); g.fillStyle = '#7a3fc4'; g.fillRect(W_ / 2, 0, W_ / 2, H_);
    for (let i = 0; i < 9; i++) { const y = ((t * 60 + i * 47) % 240) - 20; g.fillStyle = '#c9f0c0'; g.fillRect(8 + (i * 37) % 100, y, 22, 11); g.fillStyle = '#2f9a44'; g.fillRect(16 + (i * 37) % 100, y + 3, 6, 5); cardAt(140 + (i * 41) % 100, ((t * 50 + i * 61) % 240) - 20, i + t, .8); }
    g.font = 'italic 900 30px Inter, sans-serif'; g.lineWidth = 6; g.strokeStyle = '#111'; g.strokeText('CASH', 64, 90); g.fillStyle = fl ? '#ffd23a' : '#fff'; g.fillText('CASH', 64, 90); g.font = 'italic 900 19px Inter, sans-serif'; g.strokeText('STORE', 192, 80); g.strokeText('CREDIT', 192, 102); g.fillStyle = fl ? '#fff' : '#ffd23a'; g.fillText('STORE', 192, 80); g.fillText('CREDIT', 192, 102);
    burst(W_ / 2, 92, 15, 22, 10, '#d62c28', t); g.font = '900 14px Inter, sans-serif'; g.fillStyle = '#fff'; g.fillText('OR', W_ / 2, 93); big('YOUR CALL!', 168, 20, '#fff', '#111'); }
  else if (t < 22.5) { sc = 5; rays('#1524c8', '#3f5ff0'); const b = 1 + Math.sin(t * 10) * .05; g.save(); g.translate(W_ / 2, 0); g.scale(b, b); g.translate(-W_ / 2, 0); big('BUT WAIT —', 50, 26, '#fff', '#111', -.05); big("THERE'S MORE!", 84, 28, '#ffd23a', '#111', -.05); g.restore(); if (t > 20.3) { g.font = '18px "Permanent Marker", cursive'; g.fillStyle = '#fff'; g.fillText('...cards. We also sell cards.', W_ / 2, 136); g.fillText('Look around!', W_ / 2, 160); } }
  else if (t < 27) { sc = 6; rays('#d62c28', '#ff7a2a'); big("DON'T DELAY!", 34, 26, '#fff', '#111'); big('SELL TODAY!', 66, 28, '#ffd23a', '#111'); g.fillStyle = '#111'; g.fillRect(20, 92, W_ - 40, 40); g.font = '900 22px Inter, sans-serif'; g.fillStyle = Math.floor(t * 4) % 2 ? '#7dfff0' : '#fff'; g.fillText('EXORGAMES.COM', W_ / 2, 113); g.font = '700 10px Inter, sans-serif'; g.fillStyle = '#fff'; g.fillText('or bring them to the counter', W_ / 2, 146); g.font = '600 7px Inter, sans-serif'; g.fillStyle = '#ffffffc0'; g.fillText('Operators are not standing by. It is a website. Shoebox not included.', W_ / 2, 180); }
  else {   // the second spot: Mallow Games (owner, 2026-11-10: "another add with that logo where you can get exor store credit to buy cards etc buylist online")
    const m = t - 27, CR = '#fbe3b5', PK = '#d0588f', BL = '#4fb0d8', BR = '#2e1f1c';
    const dots = (bg, c) => { g.fillStyle = bg; g.fillRect(0, 0, W_, H_); g.fillStyle = c; for (let y = -1; y < 9; y++) for (let x = -1; x < 11; x++) { g.beginPath(); g.arc(x * 28 + (y % 2) * 14 + (m * 8) % 28, y * 26 + 8, 5, 0, PI * 2); g.fill(); } };
    const gameAt = (x, y, rot, sz, kind) => { g.save(); g.translate(x, y); g.rotate(rot); g.scale(sz, sz); if (kind) { g.fillStyle = '#2a2a30'; g.fillRect(-9, -12, 18, 24); g.fillStyle = BL; g.fillRect(-7, -10, 14, 14); g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(0, -3, 4, 0, PI * 2); g.fill(); g.fillStyle = '#fff'; g.fillRect(-7, 6, 14, 3); } else { g.fillStyle = '#8f9299'; g.fillRect(-11, -9, 22, 18); g.fillRect(-8, 9, 16, 3); g.fillStyle = PK; g.fillRect(-8, -6, 16, 9); g.fillStyle = '#fff'; g.fillRect(-6, -4, 8, 2); g.fillStyle = '#5c5f66'; for (let i = 0; i < 4; i++) g.fillRect(-7 + i * 4, 6, 2, 3); } g.restore(); };
    const logo = (cx, cy, w) => { g.fillStyle = '#fff'; rr(g, cx - w / 2 - 4, cy - w * .47 - 4, w + 8, w * .94 + 8, 10); g.fill(); if (tv.mallow) g.drawImage(tv.mallow, cx - w / 2, cy - w * .47, w, w * tv.mallow.height / tv.mallow.width); else { g.font = '900 ' + w / 6 + 'px Inter, sans-serif'; g.fillStyle = PK; g.fillText('MALLOW', cx, cy - w / 10); g.fillStyle = BL; g.fillText('GAMES', cx, cy + w / 10); } };
    if (m < 2.5) { sc = 7; ['#fff', '#ffd23a', BL, '#4fd65a', PK, '#d62c28', '#3f5ff0'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * W_ / 7, 0, W_ / 7 + 1, H_); }); g.fillStyle = '#111'; g.fillRect(0, 70, W_, 56); g.font = '700 13px "Cutive Mono", monospace'; g.fillStyle = '#fff'; g.fillText('AND NOW A WORD FROM', W_ / 2, 88); g.fillText('OUR SISTER SITE...', W_ / 2, 108); }
    else if (m < 7) { sc = 8; dots(CR, '#f6cfa0'); const k = Math.min(1, (m - 2.5) / .6), e = 1 - Math.pow(1 - k, 3), w = 118 * (e + Math.sin(k * PI) * .15); logo(W_ / 2, 80 + Math.sin(m * 5) * 2, w); if (m > 3.6) { big('SELL US YOUR', 156, 19, '#fff', PK); big('VIDEO GAMES!', 178, 21, '#fff', BL); } }
    else if (m < 12) { sc = 9; dots('#ffe4ef', '#ffd0e2'); big('HOW IT WORKS', 20, 18, '#fff', BR); const k1 = clamp((m - 7.4) / .4, 0, 1), k2 = clamp((m - 8.6) / .4, 0, 1), k3 = clamp((m - 9.8) / .4, 0, 1);
      const cap = (txt, x, y, c) => { g.font = '900 9px Inter, sans-serif'; g.fillStyle = c || BR; txt.split('|').forEach((l, i) => g.fillText(l, x, y + i * 11)); }, arrow = (x) => { g.fillStyle = BR; g.fillRect(x - 9, 84, 12, 5); g.beginPath(); g.moveTo(x + 3, 78); g.lineTo(x + 12, 86.5); g.lineTo(x + 3, 95); g.fill(); };
      if (k1) { g.globalAlpha = k1; gameAt(30, 80, -.2, 1.25, 0); gameAt(52, 90, .15, 1.25, 1); cap('YOUR OLD|VIDEO GAMES', 44, 122); g.globalAlpha = 1; }
      if (k2) { g.globalAlpha = k2; arrow(86); logo(128, 86, 54); cap('SELL THEM TO|MALLOW GAMES', 128, 128, PK); g.globalAlpha = 1; }
      if (k3) { g.globalAlpha = k3; arrow(172); burst(212, 86, 26, 34, 12, '#d62c28', m); g.font = '900 9px Inter, sans-serif'; g.fillStyle = '#fff'; g.fillText('EXOR', 212, 76); g.fillText('STORE', 212, 87); g.fillText('CREDIT', 212, 98); g.globalAlpha = 1; }
      if (m > 10.6) { big('NEW! GET PAID IN', 160, 15, '#fff', PK, -.03); big('EXOR STORE CREDIT', 178, 16, '#ffd23a', BR, -.03); } }
    else if (m < 16) { sc = 10; rays(BL, '#7fcdea'); for (let i = 0; i < 10; i++) cardAt((i * 53) % 256, ((m * 55 + i * 71) % 240) - 20, i + m, .9);
      big('THEN BUY CARDS', 30, 22, '#fff', BR); big('AT EXOR GAMES!', 58, 22, '#ffd23a', BR); if (tv.logo) { const w = 96, h = w * tv.logo.height / tv.logo.width; g.drawImage(tv.logo, W_ / 2 - w / 2, 106 - h / 2, w, h); } if (m > 13.4) big('OLD GAMES IN. NEW CARDS OUT.', 166, 13, '#fff', '#d62c28'); }
    else { sc = 11; dots(CR, '#f6cfa0'); logo(62, 84, 92); g.textAlign = 'left'; g.font = '900 26px Inter, sans-serif'; g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#fff'; g.strokeText('MALLOW', 122, 62); g.strokeText('GAMES', 122, 90); g.fillStyle = PK; g.fillText('MALLOW', 122, 62); g.fillStyle = BL; g.fillText('GAMES', 122, 90);
      g.font = '900 10px Inter, sans-serif'; g.fillStyle = BR; g.fillText('WE BUY VIDEO GAMES', 122, 114); g.fillText('CASH OR STORE CREDIT', 122, 128); g.textAlign = 'center'; g.fillStyle = BR; g.fillRect(20, 148, W_ - 40, 22); g.font = '900 12px Inter, sans-serif'; g.fillStyle = Math.floor(m * 4) % 2 ? '#ffd23a' : '#fff'; g.fillText('NEW: EXOR GAMES STORE CREDIT', W_ / 2, 159); g.font = '600 7px Inter, sans-serif'; g.fillStyle = BR; g.fillText('Physical games only. Not actual marshmallow.', W_ / 2 - 20, 182); }
  }
  // the tape: scan lines, a band of tracking noise, the counter
  g.fillStyle = 'rgba(0,0,0,.16)'; for (let y = 0; y < H_; y += 3) g.fillRect(0, y, W_, 1);
  const by = (tv.t * 37) % (H_ + 40) - 20; g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, by, W_, 4); g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(0, by + 7, W_, 2);
  g.font = '700 10px "Cutive Mono", monospace'; g.fillStyle = '#fff'; g.textAlign = 'left'; if (idle || tv.t < 2.5) g.fillText('PLAY ▶', 8, 12); g.textAlign = 'right'; const s = Math.floor(idle ? 0 : tv.t); g.fillText('0:' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'), W_ - 8, H_ - 10);
  if (idle) { g.textAlign = 'center'; g.fillStyle = '#000000a0'; g.fillRect(0, H_ - 44, W_, 22); g.fillStyle = '#fff'; g.font = '700 11px "Cutive Mono", monospace'; g.fillText('▶ TAP THE TV TO WATCH', W_ / 2, H_ - 33); }
  if (!idle && sc !== tv.scene) { tv.scene = sc; arcBlip([330, 392, 523, 440, 587, 659, 784, 262, 698, 587, 784, 880][sc], .16, .02); }
  tv.tex.needsUpdate = true;
}
function tvView() { const fov = 50, d = Math.max(.6, .3 / hTan(fov)); return lookView(new V3(-3.363 + .7071 * d, 2.19, -2.881 + .7071 * d), new V3(-3.363, 2.19, -2.881), fov); }
function tvRun() { tv.t = 0; tv.scene = -1; tv.last = 0; const id = tv.id = (tv.id || 0) + 1; anims.push((now) => { if (S.mode !== 'tv' || tv.id !== id) return false; const dt = tv.last ? Math.min(.1, (now - tv.last) / 1000) : 0; tv.last = now; tv.t += dt; tvDraw(false); return true; }); kick(); }
function tvStop() { tv.id = (tv.id || 0) + 1; tvDraw(true); kick(); }

/* ---------- flags (owner, 2026-11-11) ----------
   "Put mana symbol flags and pokemon characters on the wall for hanging flags etc". Pennants on the tall
   walls of the shop and hung from the ceiling over the play space. Nothing on them is drawn here: the five
   Magic flags carry the mana symbols as published (Scryfall's symbol files, the same source as the set
   logos), and the Pokemon flags each carry the picture of a Pokemon card the shop has in its own showcase
   feed right now - so the characters on the wall are the shop's stock. Until a picture arrives, or if it
   never does, a flag is its plain colour. */
const FLAG_MANA = [['W', '#f8f1d0', '#b9a25a'], ['U', '#aee0f8', '#2f6f9f'], ['B', '#cfc6c2', '#3a3230'], ['R', '#f7ab90', '#b03a22'], ['G', '#a2d6b2', '#2a6b3c']];
const FLAG_POKE = [['#ffd23a', '#2a4fa0'], ['#e8433a', '#f4efe0'], ['#3f8fe0', '#ffd23a'], ['#4fd65a', '#1c5a2a']];
const flagList = { mana: [], poke: [], asked: false };
function flagMake(kind, i) {
  const list = flagList[kind]; if (list[i]) return list[i];
  const f = { kind, i, im: null }, c = document.createElement('canvas'); c.width = 256; c.height = 384;
  f.draw = () => {
    const g = c.getContext('2d'), mana = kind === 'mana', bg = mana ? FLAG_MANA[i][1] : FLAG_POKE[i % 4][0], edge = mana ? FLAG_MANA[i][2] : FLAG_POKE[i % 4][1];
    g.clearRect(0, 0, 256, 384); g.beginPath(); g.moveTo(4, 4); g.lineTo(252, 4); g.lineTo(252, 300); g.lineTo(128, 380); g.lineTo(4, 300); g.closePath(); g.fillStyle = bg; g.fill(); g.lineWidth = 12; g.strokeStyle = edge; g.stroke();
    g.fillStyle = '#1c1b1d'; g.fillRect(0, 0, 256, 18);
    if (mana) { g.fillStyle = '#ffffffb0'; g.beginPath(); g.arc(128, 158, 96, 0, PI * 2); g.fill(); if (f.im) g.drawImage(f.im, 44, 74, 168, 168); }
    else if (f.im) { const w = 172, h = Math.min(250, w * (f.im.height / f.im.width || 1.4)); g.fillStyle = '#fff'; g.fillRect(128 - w / 2 - 5, 36, w + 10, h + 10); g.drawImage(f.im, 128 - w / 2, 41, w, h); }
    if (f.tex) f.tex.needsUpdate = true;
  };
  f.draw(); f.tex = keep(new THREE.CanvasTexture(c)); f.tex.colorSpace = THREE.SRGBColorSpace; f.tex.anisotropy = 4;
  f.mat = keep(new THREE.MeshBasicMaterial({ map: f.tex, transparent: true, alphaTest: .5, side: THREE.DoubleSide }));
  list[i] = f; return f;
}
function flagLoad() {
  if (flagList.asked) return; flagList.asked = true;
  FLAG_MANA.forEach((m, i) => loadImg('https://svgs.scryfall.io/card-symbols/' + m[0] + '.svg').then((im) => { const f = flagMake('mana', i); f.im = im; f.draw(); kick(); }).catch(() => {}));
  fetch(W + '/showcase.json?game=pokemon', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    const cards = []; ((d && d.shelves) || []).forEach((sh) => (sh.cards || []).forEach((c) => { if (hasPhoto(c)) cards.push(c); }));
    cards.sort((a, b) => Number(b.price) - Number(a.price)).slice(0, 8).forEach((c, i) => loadImg(img(c.image, 300)).then((im) => { const f = flagMake('poke', i); f.im = im; f.draw(); kick(); }).catch(() => {}));
  }).catch(() => {});
}
// one flag: against a wall (ry = the way it faces), or hung in the open on a rod from the ceiling (hung: seen from both sides)
function flagHang(parent, n, x, y, z, ry, w, hung) {
  const f = n % 2 ? flagMake('poke', (n >> 1) % 8) : flagMake('mana', (n >> 1) % 5), h = w * 1.5, m = pl(w, h, f.mat, x, y, z, ry, parent);
  if (hung) { const rod = lam({ color: 0x1c1b1d }); bx(Math.abs(Math.cos(ry)) * w + .04, .02, Math.abs(Math.sin(ry)) * w + .04, rod, x, y + h / 2, z, parent); bx(.012, CEIL - (y + h / 2), .012, rod, x, (CEIL + y + h / 2) / 2, z, parent); }
  return m;
}

/* ---------- the third cabinet: SCALPER DUNK (owner, 2026-11-12) ----------
   "Add another arcade game called 'Scalper Dunk' where you throw apples to dunk scalpers in shark infested
   water. When you throw the apple and miss they taunt you with how much they are going to resell product for
   and get them all as soon as the box store opens up."
   A dunk tank: a scalper sits on a plank over the water, a bullseye slides up and down beside them. Tap where
   to throw; the apple takes a moment to get there, so lead the target. A hit drops the plank and they go in
   with the sharks; a miss gets a taunt. Ten apples, one back for every dunk; each scalper's target is smaller
   and quicker. The owner asked for the scalpers to look like the people in five photos sent with the request:
   NOT done - they are real people; the five here are made-up cartoon characters with made-up names. */
const dnk = { state: 'attract', t: 0, apples: 0, dunked: 0, hi: 0, who: 0, ty: 80, tdir: 1, shot: null, fall: 0, taunt: '', tauntT: 0, lvl: 0, splash: 0 };
dnk.cv = document.createElement('canvas'); dnk.cv.width = 480; dnk.cv.height = 384; dnk.g = dnk.cv.getContext('2d');
dnk.tex = keep(new THREE.CanvasTexture(dnk.cv)); dnk.tex.colorSpace = THREE.SRGBColorSpace; dnk.tex.magFilter = THREE.NearestFilter;
try { dnk.hi = Number(localStorage.getItem('xgScalperDunkHi')) || 0; } catch (x) {}
const DNK_WHO = [   // made up: name, skin, top, hat colour (0 = hood up in the top's colour), shades
  ['FLIP', '#e8b88a', '#6a3fb0', 0, 0], ['MARKUP', '#b97a4e', '#2f9a54', '#f2c230', 1], ['THE BOT', '#f0c9a4', '#2b3a55', '#d62c28', 0], ['CART GUY', '#8a5a3a', '#d0722a', 0, 1], ['RESTOCK', '#dba87c', '#c0397a', '#19b5a5', 0]];
const DNK_TAUNTS = ['Missed! These go for $300 a box online!', 'Doors open at 8. By 8:01 the shelf is MINE.', 'Limit two each? I brought nine cousins!', 'MSRP is for suckers. I charge triple!', 'Every Elite Trainer Box in town - in my trunk!', 'Your kid wants one? That will be $180.', 'I cleared out the big box store before you woke up!', 'Nice throw. See you on the resale sites!', 'I bought the whole pallet. Bidding starts at $500!', 'Restock day? I had a bot in line at midnight!'];
const dnkR = () => Math.max(7, 14 - dnk.lvl * 1.2), dnkSpd = () => 34 + dnk.lvl * 11;
function dnkNew() { dnk.state = 'play'; dnk.apples = 10; dnk.dunked = 0; dnk.lvl = 0; dnk.who = Math.floor(Math.random() * DNK_WHO.length); dnk.ty = 80; dnk.shot = null; dnk.fall = 0; dnk.taunt = ''; dnk.splash = 0; }
function dnkThrow(gx, gy) { if (dnk.state !== 'play' || dnk.shot || dnk.fall || dnk.apples < 1) return; dnk.apples--; dnk.shot = { x: clamp(gx, 6, 234), y: clamp(gy, 22, 150), t: 0 }; arcBlip(520, .1, .02); }
function dnkStep(dt) {
  dnk.t += dt; dnk.tauntT = Math.max(0, dnk.tauntT - dt); dnk.splash = Math.max(0, dnk.splash - dt); if (dnk.state !== 'play') return;
  if (!dnk.fall) { dnk.ty += dnk.tdir * dnkSpd() * dt; if (dnk.ty > 118) { dnk.ty = 118; dnk.tdir = -1; } if (dnk.ty < 40) { dnk.ty = 40; dnk.tdir = 1; } }
  if (dnk.shot) { dnk.shot.t += dt / .5; if (dnk.shot.t >= 1) {
    const hit = Math.hypot(dnk.shot.x - 176, dnk.shot.y - dnk.ty) <= dnkR() + 3; dnk.shot = null;
    if (hit) { dnk.fall = .001; dnk.taunt = ''; dnk.tauntT = 0; arcBlip(880, .12, .04); }
    else { dnk.taunt = DNK_TAUNTS[Math.floor(Math.random() * DNK_TAUNTS.length)]; dnk.tauntT = 2.6; arcBlip(150, .25, .03); }
  } }
  if (dnk.fall) { const was = dnk.fall; dnk.fall += dt; if (was < .55 && dnk.fall >= .55) { dnk.splash = .7; arcBlip(90, .4, .05); }
    if (dnk.fall > 2.1) { dnk.fall = 0; dnk.dunked++; dnk.apples++; dnk.lvl++; dnk.who = (dnk.who + 1 + Math.floor(Math.random() * (DNK_WHO.length - 1))) % DNK_WHO.length; dnk.ty = 80; } }
  if (!dnk.apples && !dnk.shot && !dnk.fall && !dnk.tauntT) { dnk.state = 'over'; dnk.overAt = dnk.t; if (dnk.dunked > dnk.hi) { dnk.hi = dnk.dunked; try { localStorage.setItem('xgScalperDunkHi', String(dnk.hi)); } catch (x) {} } }
}
function dnkGuy(g, x, y, w, wet) {   // sitting, feet dangling; x, y = the seat
  const skin = w[1], top = w[2], hat = w[3] || top;
  g.fillStyle = '#2b3a55'; g.fillRect(x - 7, y - 2, 14, 5); g.fillRect(x - 7, y + 3, 4, 9); g.fillRect(x + 3, y + 3, 4, 9); g.fillStyle = '#111'; g.fillRect(x - 8, y + 12, 6, 3); g.fillRect(x + 2, y + 12, 6, 3);
  g.fillStyle = top; g.fillRect(x - 8, y - 18, 16, 17); g.fillRect(x - 12, y - 16, 4, 11); g.fillRect(x + 8, y - 16, 4, 11);
  g.fillStyle = '#efe7d2'; g.fillRect(x + 9, y - 12, 9, 7); g.fillRect(x + 10, y - 19, 8, 7); g.fillStyle = '#d62c28'; g.fillRect(x + 9, y - 10, 9, 2); g.fillRect(x + 10, y - 17, 8, 2);   // the boxes they are hugging
  g.fillStyle = skin; g.fillRect(x - 6, y - 30, 12, 12); g.fillRect(x - 13, y - 6, 4, 3); g.fillRect(x + 9, y - 6, 4, 3);
  g.fillStyle = hat; if (w[3]) { g.fillRect(x - 7, y - 33, 14, 5); g.fillRect(x - 7, y - 29, 17, 2); } else { g.fillRect(x - 8, y - 33, 16, 6); g.fillRect(x - 8, y - 29, 3, 11); g.fillRect(x + 5, y - 29, 3, 11); }
  g.fillStyle = '#111'; if (w[4]) g.fillRect(x - 5, y - 26, 10, 3); else { g.fillRect(x - 4, y - 26, 2, 2); g.fillRect(x + 2, y - 26, 2, 2); }
  if (wet) { g.fillRect(x - 2, y - 22, 4, 3); } else { g.fillRect(x - 3, y - 21, 6, 1); g.fillRect(x + 2, y - 22, 2, 1); }   // a smirk, or a yell on the way down
}
function dnkDraw() {
  const g = dnk.g, W_ = 240, H_ = 192, f = Math.floor(dnk.t * 2.5) % 2, w = DNK_WHO[dnk.who]; g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false; g.textBaseline = 'top';
  const sky = g.createLinearGradient(0, 0, 0, 140); sky.addColorStop(0, '#2a1b5a'); sky.addColorStop(1, '#ff7aa8'); g.fillStyle = sky; g.fillRect(0, 0, W_, H_);
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#d62c28' : '#f4efe0'; g.beginPath(); g.moveTo(i * 20, 0); g.lineTo(i * 20 + 20, 0); g.lineTo(i * 20 + 10, 13); g.closePath(); g.fill(); }
  // the tank, the water, the fins
  g.fillStyle = '#1c4f8a'; g.fillRect(20, 132, 200, 60); g.fillStyle = '#2f7fd0'; for (let x = 20; x < 220; x += 16) g.fillRect(x + ((dnk.t * 14) % 16), 132 + (Math.floor(x / 16 + dnk.t * 2) % 2), 9, 2);
  g.strokeStyle = '#9fd0ff'; g.lineWidth = 2; g.strokeRect(20, 96, 200, 96);
  [[0, 1], [70, -1], [140, 1]].forEach((s, i) => { const near = dnk.fall > .55, cx = near ? lerp(40 + ((dnk.t * 24 * s[1] + s[0] + 400) % 180), 84, Math.min(1, (dnk.fall - .55) * 1.6)) + (i - 1) * 16 : 30 + ((dnk.t * 24 * s[1] + s[0] + 400) % 180), cy = 150 + i * 12; g.fillStyle = '#8f9aa6'; g.beginPath(); g.moveTo(cx - 8, cy + 6); g.lineTo(cx + (s[1] > 0 ? 3 : -3), cy - 8); g.lineTo(cx + 8, cy + 6); g.closePath(); g.fill(); g.fillStyle = '#2f7fd0'; g.fillRect(cx - 10, cy + 5, 20, 2); });
  // the plank and whoever is on it
  const fl = dnk.fall, drop = fl ? Math.min(1, fl / .55) : 0, gy = 100 + (fl ? Math.min(60, fl * fl * 190) : 0);
  g.fillStyle = '#7a4a22'; g.fillRect(40, 60, 5, 74); g.save(); g.translate(45, 100); g.rotate(drop * 1.2); g.fillStyle = '#b9834a'; g.fillRect(0, -3, 62, 5); g.restore();
  if (!fl || fl < 1.1) { g.save(); if (gy > 132) { g.beginPath(); g.rect(0, 0, W_, 136); g.clip(); } dnkGuy(g, 84, gy - 3, w, fl > 0); g.restore(); }
  if (dnk.splash) { g.fillStyle = '#cfe8ff'; for (let i = 0; i < 9; i++) { const a = PI * (1.1 + i * .1), r = (1 - dnk.splash / .7) * 34 + 6; g.fillRect(84 + Math.cos(a) * r, 134 + Math.sin(a) * r, 3, 3); } }
  // the bullseye on its rail
  g.fillStyle = '#55555c'; g.fillRect(175, 30, 3, 100); const r = dnkR(), ty = dnk.ty;
  [['#f4efe0', 1], ['#d62c28', .68], ['#f4efe0', .38], ['#d62c28', .16]].forEach((c) => { g.fillStyle = c[0]; g.beginPath(); g.arc(176, ty, r * c[1], 0, PI * 2); g.fill(); }); g.fillStyle = '#55555c'; g.fillRect(146, 99, 30, 2);
  // the apple in the air
  if (dnk.shot) { const k = dnk.shot.t, ax = lerp(120, dnk.shot.x, k), ay = lerp(186, dnk.shot.y, k) - Math.sin(k * PI) * 34, s = lerp(9, 4, k); g.fillStyle = '#d62c28'; g.beginPath(); g.arc(ax, ay, s, 0, PI * 2); g.fill(); g.fillStyle = '#3fae4a'; g.fillRect(ax, ay - s - 2, 3, 3); g.fillStyle = '#ffffff90'; g.fillRect(ax - s * .4, ay - s * .4, 2, 2); }
  // what they shout when you miss
  if (dnk.tauntT && dnk.taunt) { g.font = '700 9px Inter, sans-serif'; const words = dnk.taunt.split(' '), lines = []; let ln = ''; words.forEach((wd) => { if (g.measureText(ln + ' ' + wd).width > 118 && ln) { lines.push(ln); ln = wd; } else ln = ln ? ln + ' ' + wd : wd; }); lines.push(ln);
    const bw = 128, bh = lines.length * 11 + 8, bx0 = 100, by0 = 20; g.fillStyle = '#fff'; rr(g, bx0, by0, bw, bh, 6); g.fill(); g.beginPath(); g.moveTo(bx0 + 10, by0 + bh); g.lineTo(bx0 - 4, by0 + bh + 12); g.lineTo(bx0 + 24, by0 + bh); g.closePath(); g.fill(); g.fillStyle = '#16120d'; g.textAlign = 'left'; lines.forEach((l, i) => g.fillText(l, bx0 + 6, by0 + 5 + i * 11)); }
  if (fl > .55) { g.textAlign = 'center'; g.font = '900 22px Inter, sans-serif'; g.fillStyle = '#111'; g.fillText('DUNKED!', 121, 41); g.fillStyle = '#ffd23a'; g.fillText('DUNKED!', 120, 40); }
  // the counts
  g.font = '700 9px "Cutive Mono", monospace'; g.textAlign = 'left'; g.fillStyle = '#fff'; g.fillText('DUNKED ' + dnk.dunked, 6, 17); g.textAlign = 'right'; g.fillText('BEST ' + Math.max(dnk.hi, dnk.dunked), W_ - 6, 17);
  if (dnk.state !== 'attract') { g.textAlign = 'center'; g.fillStyle = '#ffd23a'; g.fillText(w[0], 84, 62); for (let i = 0; i < dnk.apples; i++) { g.fillStyle = '#d62c28'; g.beginPath(); g.arc(10 + i * 9, 184, 3.5, 0, PI * 2); g.fill(); g.fillStyle = '#3fae4a'; g.fillRect(10 + i * 9, 179, 2, 2); } }
  g.textAlign = 'center';
  if (dnk.state === 'attract') { g.font = '900 24px Inter, sans-serif'; g.fillStyle = '#111'; g.fillText('SCALPER DUNK', 121, 31); g.fillStyle = '#ffd23a'; g.fillText('SCALPER DUNK', 120, 30); g.font = '700 10px "Cutive Mono", monospace'; g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText(S.mode === 'dunk' ? 'TAP TO START' : 'INSERT COIN', 120, 54); }
  if (dnk.state === 'over') { g.fillStyle = '#000000c0'; g.fillRect(40, 62, 160, 52); g.font = '900 18px Inter, sans-serif'; g.fillStyle = '#ff4f9a'; g.fillText('OUT OF APPLES', 120, 68); g.font = '700 9px "Cutive Mono", monospace'; g.fillStyle = '#fff'; g.fillText(dnk.dunked + ' DUNKED', 120, 90); g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText('TAP TO PLAY AGAIN', 120, 101); }
  dnk.tex.needsUpdate = true;
}
// a tap on the screen of the cabinet, in the game's own 240 x 192
function dnkTap(x, y) {
  if (dnk.state === 'attract' || (dnk.state === 'over' && dnk.t - dnk.overAt > .6)) { dnkNew(); arcBlip(660, .2, .03); hint(''); return; }
  const z = CAB_Z.dunk, rc = canvas.getBoundingClientRect(), a = new V3(-3.448, 1.5, z + .25).project(cam), b = new V3(-3.448, 1.1, z - .25).project(cam), px = (v) => [(v.x + 1) / 2 * rc.width + rc.left, (1 - v.y) / 2 * rc.height + rc.top], A = px(a), B = px(b);
  dnkThrow((x - A[0]) / (B[0] - A[0]) * 240, (y - A[1]) / (B[1] - A[1]) * 192);
}
function dnkRun() { dnk.state = 'attract'; dnk.last = 0; dnk.fall = 0; dnk.shot = null; dnk.taunt = ''; const id = dnk.id = (dnk.id || 0) + 1; anims.push((now) => { if (S.mode !== 'dunk' || dnk.id !== id) return false; const dt = dnk.last ? Math.min(.05, (now - dnk.last) / 1000) : 0; dnk.last = now; dnkStep(dt); dnkDraw(); return true; }); kick(); }
function dnkStop() { dnk.id = (dnk.id || 0) + 1; dnk.state = 'attract'; dnk.fall = 0; dnk.shot = null; dnk.taunt = ''; dnk.tauntT = 0; dnkDraw(); kick(); }
document.addEventListener('keydown', (e) => { if (S.mode === 'dunk' && (e.key === ' ' || e.key === 'Enter')) { if (dnk.state === 'play') dnkThrow(176, dnk.ty); else dnkTap(0, 0); e.preventDefault(); } });

/* ---------- the fourth cabinet: LINE RUSH (owner, 2026-11-12) ----------
   "Add another arcade that is a side scroller beat em up trying to get to the front of the box store line to
   get a Pokemon etb. You have to fight a slew of characters to beat your way to the front of the line with
   security guards and store employee trying to prevent you from butting in line by putting you back behind
   other people in line.."
   A side-scroller along the line outside a big box store on release morning. Walk right, shove your way past
   the people in line (each takes a couple of shoves and then steps aside); store staff and security guards
   come down the line for you, and if one gets hold of you before you shove them off you are marched back
   down the line - "BACK OF THE LINE!". Reach the doors before the clock runs out and the last Elite Trainer
   Box is yours; run out of time and it is SOLD OUT. Cartoon shoving only, made-up store and people; the box
   is drawn as a plain "ELITE TRAINER BOX" with no game's artwork on it.
   Hold the right or left of the screen to walk, tap to shove; arrows and space on a keyboard. */
const lin = { L: 1560, state: 'attract', t: 0, x: 20, face: 1, dir: 0, punch: 0, time: 0, en: [], carry: null, msg: '', msgT: 0, hi: 0, keys: {} };
lin.cv = document.createElement('canvas'); lin.cv.width = 480; lin.cv.height = 384; lin.g = lin.cv.getContext('2d');
lin.tex = keep(new THREE.CanvasTexture(lin.cv)); lin.tex.colorSpace = THREE.SRGBColorSpace; lin.tex.magFilter = THREE.NearestFilter;
try { lin.hi = Number(localStorage.getItem('xgLineRushHi')) || 0; } catch (x) {}
const LIN_T = { shopper: { hp: 2, sp: 0, back: 0, top: ['#3f8fe0', '#4fd65a', '#ff7a2a', '#b07aff', '#ffd23a'] }, staff: { hp: 3, sp: 22, back: 110, top: ['#d62c28'] }, guard: { hp: 4, sp: 30, back: 190, top: ['#1c2540'] } };
function linNew() {
  lin.state = 'play'; lin.x = 20; lin.face = 1; lin.dir = 0; lin.punch = 0; lin.time = 80; lin.carry = null; lin.msg = ''; lin.msgT = 0; lin.en = [];
  for (let i = 0; i < 22; i++) { const type = i % 5 === 4 ? 'guard' : i % 3 === 2 ? 'staff' : 'shopper', T = LIN_T[type]; lin.en.push({ type, x: 110 + i * 64 + (i * 37 % 17), hp: T.hp, stun: 0, cd: 0, out: 0, col: T.top[i % T.top.length], skin: ['#e8b88a', '#b97a4e', '#f0c9a4', '#8a5a3a'][i % 4] }); }
}
function linPunch() {
  if (lin.state !== 'play' || lin.carry || lin.punch > .12) return; lin.punch = .28; let best = null;
  lin.en.forEach((e) => { if (e.out) return; const d = (e.x - lin.x) * lin.face; if (d > -4 && d < 26 && (!best || d < (best.x - lin.x) * lin.face)) best = e; });
  if (best) { best.hp--; best.stun = .45; best.x += lin.face * 7; arcBlip(240, .07, .03); if (best.hp <= 0) { best.out = .001; arcBlip(520, .14, .03); } } else arcBlip(700, .04, .012);
}
function linStep(dt) {
  lin.t += dt; lin.msgT = Math.max(0, lin.msgT - dt); if (lin.state !== 'play') return;
  lin.time -= dt; lin.punch = Math.max(0, lin.punch - dt);
  if (lin.carry) { lin.x = Math.max(lin.carry.to, lin.x - 260 * dt); if (lin.x <= lin.carry.to) lin.carry = null; }
  else {
    const k = lin.keys, dir = k.ArrowRight ? 1 : k.ArrowLeft ? -1 : lin.dir; if (dir) lin.face = dir;
    let nx = lin.x + dir * 62 * dt;
    lin.en.forEach((e) => { if (e.out) return; if (e.x > lin.x && nx > e.x - 13) nx = e.x - 13; if (e.x < lin.x && nx < e.x + 13) nx = e.x + 13; });   // you cannot walk through someone standing
    lin.x = clamp(nx, 8, lin.L);
  }
  lin.en.forEach((e) => {
    if (e.out) { e.out += dt; return; } e.stun = Math.max(0, e.stun - dt); e.cd = Math.max(0, e.cd - dt); const T = LIN_T[e.type], d = lin.x - e.x;
    if (T.sp && !e.stun && !lin.carry && Math.abs(d) < 120 && Math.abs(d) > 13) e.x += Math.sign(d) * T.sp * dt;
    if (!e.stun && !e.cd && !lin.carry && Math.abs(d) < 16) {
      if (T.back) { lin.carry = { to: Math.max(8, lin.x - T.back) }; e.cd = 3; lin.msg = e.type === 'guard' ? 'SECURITY: BACK OF THE LINE!' : 'STAFF: NO BUTTING IN, PAL!'; lin.msgT = 1.8; arcBlip(130, .3, .05); }
      else { lin.x = Math.max(8, lin.x - 12); e.cd = 1.1; lin.msg = ['HEY! NO CUTTING!', 'I HAVE BEEN HERE SINCE 4 AM!', 'WAIT YOUR TURN!', 'THE LINE STARTS BACK THERE!'][Math.floor(Math.random() * 4)]; lin.msgT = 1.1; arcBlip(180, .1, .03); }
    }
  });
  if (lin.x >= lin.L - 6) { lin.state = 'won'; lin.overAt = lin.t; const sc = Math.ceil(lin.time); if (sc > lin.hi) { lin.hi = sc; try { localStorage.setItem('xgLineRushHi', String(sc)); } catch (x) {} } arcBlip(1040, .4, .04); }
  else if (lin.time <= 0) { lin.time = 0; lin.state = 'over'; lin.overAt = lin.t; arcBlip(110, .5, .05); }
}
function linGuy(g, x, y, skin, top, o) {   // standing on y; o: { face, punch, hat, out, badge, walk }
  o = o || {}; const f = o.face || 1;
  if (o.out) { g.fillStyle = top; g.fillRect(x - 12, y - 7, 18, 7); g.fillStyle = skin; g.fillRect(x + 6, y - 8, 8, 8); g.fillStyle = '#2b3a55'; g.fillRect(x - 22, y - 5, 10, 5); return; }
  const st = o.walk ? Math.floor(o.walk * 8) % 2 : 0;
  g.fillStyle = '#2b3a55'; g.fillRect(x - 5, y - 13, 4, 13 - st * 2); g.fillRect(x + 1, y - 13, 4, 11 + st * 2); g.fillStyle = '#111'; g.fillRect(x - 6, y - 2 - st * 2, 6, 2); g.fillRect(x, y - 2 + st * 0, 6, 2);
  g.fillStyle = top; g.fillRect(x - 7, y - 29, 14, 17); if (o.punch) g.fillRect(x + (f > 0 ? 7 : -19), y - 26, 12, 4); else { g.fillRect(x - 10, y - 28, 3, 10); g.fillRect(x + 7, y - 28, 3, 10); }
  g.fillStyle = skin; g.fillRect(x - 5, y - 40, 10, 11); if (o.punch) g.fillRect(x + (f > 0 ? 19 : -23), y - 27, 4, 5);
  g.fillStyle = '#111'; g.fillRect(x + (f > 0 ? 1 : -3), y - 36, 2, 2);
  if (o.hat) { g.fillStyle = o.hat; g.fillRect(x - 6, y - 43, 12, 4); g.fillRect(x + (f > 0 ? 2 : -8), y - 40, 7, 2); }
  if (o.badge) { g.fillStyle = o.badge; g.fillRect(x - 5, y - 26, 4, 4); }
}
function linDraw() {
  const g = lin.g, W_ = 240, H_ = 192, f = Math.floor(lin.t * 2.5) % 2, cam2 = clamp(lin.x - 70, 0, lin.L - 170), GY = 150; g.setTransform(2, 0, 0, 2, 0, 0); g.imageSmoothingEnabled = false; g.textBaseline = 'top';
  const sky = g.createLinearGradient(0, 0, 0, 100); sky.addColorStop(0, '#1b2a5a'); sky.addColorStop(1, '#ffb27a'); g.fillStyle = sky; g.fillRect(0, 0, W_, H_);
  g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(200 - cam2 * .02, 92, 16, 0, PI * 2); g.fill();
  // the store's long wall, its sign and doors at the far end
  g.fillStyle = '#c9c2b4'; g.fillRect(0, 60, W_, 90); g.fillStyle = '#2f6fd0'; g.fillRect(0, 60, W_, 12); g.fillStyle = '#a9a294'; for (let x = -(cam2 % 48); x < W_; x += 48) g.fillRect(x, 72, 2, 78);
  const dx = lin.L - cam2; if (dx < W_ + 60) { g.fillStyle = '#16233f'; g.fillRect(dx - 4, 88, 44, 62); g.fillStyle = '#9fd0ff'; g.fillRect(dx, 92, 17, 58); g.fillRect(dx + 19, 92, 17, 58); g.fillStyle = '#ffd23a'; g.fillRect(dx - 40, 40, 116, 22); g.fillStyle = '#16233f'; g.font = '900 15px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('MEGA MART', dx + 18, 44);
    g.fillStyle = '#f4efe0'; g.fillRect(dx + 44, 118, 26, 32); g.fillStyle = '#d62c28'; g.fillRect(dx + 44, 124, 26, 8); g.fillStyle = '#16120d'; g.font = '700 5px Inter, sans-serif'; g.fillText('ELITE', dx + 57, 134); g.fillText('TRAINER BOX', dx + 57, 140); }
  g.fillStyle = '#6d6a66'; g.fillRect(0, GY, W_, 42); g.fillStyle = '#85827d'; for (let x = -(cam2 % 32); x < W_; x += 32) g.fillRect(x, GY, 1, 42);
  for (let x = -(cam2 % 64); x < W_; x += 64) { g.fillStyle = '#b08a3a'; g.fillRect(x, GY - 16, 2, 16); g.fillStyle = '#d62c28'; g.fillRect(x, GY - 14, 64, 1); }   // the rope
  // everyone in line, then you
  lin.en.forEach((e) => { const sx = e.x - cam2; if (sx < -30 || sx > W_ + 30) return; const T = e.type; if (e.out > 1.6) return;
    linGuy(g, sx, GY + 6, e.skin, e.col, { face: lin.x > e.x ? 1 : -1, out: !!e.out, hat: T === 'guard' ? '#111' : T === 'staff' ? '#d62c28' : 0, badge: T === 'guard' ? '#ffd23a' : T === 'staff' ? '#fff' : 0, walk: LIN_T[T].sp && Math.abs(lin.x - e.x) < 120 && !e.stun ? lin.t : 0 });
    if (e.stun && !e.out) { g.fillStyle = '#ffd23a'; g.fillRect(sx - 6 + (f ? 3 : 0), GY - 42, 3, 3); g.fillRect(sx + 4 - (f ? 3 : 0), GY - 44, 3, 3); } });
  const px = lin.x - cam2; if (lin.state !== 'attract') linGuy(g, px, GY + 10, '#f0c9a4', '#19b5a5', { face: lin.carry ? -1 : lin.face, punch: lin.punch > .1, hat: '#ff4f9a', walk: (lin.dir || lin.keys.ArrowRight || lin.keys.ArrowLeft || lin.carry) ? lin.t : 0 });
  // the top bar: the clock, how far up the line you are
  g.fillStyle = '#000000a0'; g.fillRect(0, 0, W_, 26); g.font = '700 9px "Cutive Mono", monospace'; g.textAlign = 'left'; g.fillStyle = lin.time < 20 && f ? '#ff4f9a' : '#fff'; g.fillText('SELLS OUT IN ' + Math.ceil(lin.time), 6, 4); g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText('BEST ' + lin.hi, W_ - 6, 4);
  g.fillStyle = '#55555c'; g.fillRect(6, 17, W_ - 12, 4); g.fillStyle = '#ffd23a'; g.fillRect(6, 17, (W_ - 12) * clamp(lin.x / lin.L, 0, 1), 4); g.fillStyle = '#d62c28'; g.fillRect(W_ - 9, 15, 3, 8);
  g.textAlign = 'center';
  if (lin.msgT && lin.msg) { g.font = '900 11px Inter, sans-serif'; const w = g.measureText(lin.msg).width + 12; g.fillStyle = '#fff'; rr(g, 120 - w / 2, 32, w, 17, 5); g.fill(); g.fillStyle = '#d62c28'; g.fillText(lin.msg, 120, 35); }
  if (lin.state === 'attract') { g.font = '900 26px Inter, sans-serif'; g.fillStyle = '#111'; g.fillText('LINE RUSH', 121, 71); g.fillStyle = '#ffd23a'; g.fillText('LINE RUSH', 120, 70); g.font = '700 8px "Cutive Mono", monospace'; g.fillStyle = '#fff'; g.fillText('ONE ELITE TRAINER BOX LEFT. LONG LINE.', 120, 100); g.fillStyle = f ? '#7dfff0' : '#fff'; g.font = '700 10px "Cutive Mono", monospace'; g.fillText(S.mode === 'line' ? 'TAP TO START' : 'INSERT COIN', 120, 116); }
  if (lin.state === 'over' || lin.state === 'won') { g.fillStyle = '#000000c8'; g.fillRect(30, 60, 180, 58); g.font = '900 20px Inter, sans-serif'; g.fillStyle = lin.state === 'won' ? '#ffd23a' : '#ff4f9a'; g.fillText(lin.state === 'won' ? 'YOU GOT IT!' : 'SOLD OUT', 120, 66); g.font = '700 9px "Cutive Mono", monospace'; g.fillStyle = '#fff'; g.fillText(lin.state === 'won' ? Math.ceil(lin.time) + ' SECONDS TO SPARE' : 'TRY THE LOCAL CARD SHOP NEXT TIME', 120, 90); g.fillStyle = f ? '#7dfff0' : '#fff'; g.fillText('TAP TO PLAY AGAIN', 120, 103); }
  lin.tex.needsUpdate = true;
}
function linTap() { if (lin.state === 'attract' || ((lin.state === 'over' || lin.state === 'won') && lin.t - lin.overAt > .8)) { linNew(); arcBlip(660, .2, .03); hint(''); } else linPunch(); }
function linRun() { lin.state = 'attract'; lin.keys = {}; lin.dir = 0; lin.last = 0; const id = lin.id = (lin.id || 0) + 1; anims.push((now) => { if (S.mode !== 'line' || lin.id !== id) return false; const dt = lin.last ? Math.min(.05, (now - lin.last) / 1000) : 0; lin.last = now; linStep(dt); linDraw(); return true; }); kick(); }
function linStop() { lin.id = (lin.id || 0) + 1; lin.state = 'attract'; lin.keys = {}; lin.dir = 0; linDraw(); kick(); }
// holding the right or the left of the screen walks that way
canvas.addEventListener('pointerdown', (e) => { if (S.mode === 'line' && lin.state === 'play') lin.dir = e.clientX > canvas.clientWidth / 2 ? 1 : -1; });
['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => canvas.addEventListener(n, () => { lin.dir = 0; }));
document.addEventListener('keydown', (e) => { if (S.mode !== 'line') return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { lin.keys[e.key] = true; e.preventDefault(); } else if (e.key === ' ' || e.key === 'Enter') { linTap(); e.preventDefault(); } });
document.addEventListener('keyup', (e) => { delete lin.keys[e.key]; });

/* ---------- the 1990s lying around (owner, 2026-11-10) ----------
   "I need it to be much more 1990s looking. More ambient items laying around. Stuff from the 1990s."
   Nothing here is stock; the cabinets and the TV are tap targets (see above): two arcade cabinets and a gumball machine on the right wall, a TV with
   a tape playing up in the corner, a console and bean bags, a games table with a pizza box in the middle of
   the floor, a boom box and long boxes on top of the graded cabinet, a lava lamp and milk caps on the
   counter, posters, a wall clock, and a squiggle border round the top of the walls. All made up: no real
   game, brand or character is drawn. */
function buildNineties() {
  const G = new THREE.Group(); scene.add(G);
  const basic = (o) => new THREE.MeshBasicMaterial(o), TEAL = '#19b5a5', PINK = '#ff4f9a', PURP = '#7a3fc4', YEL = '#ffd23a';
  const cyl = (rt, rb, h, mat, x, y, z, parent, seg) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat); m.position.set(x, y, z); (parent || G).add(m); return m; };
  const grp = (x, y, z, ry) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; G.add(g); return g; };
  // shapes of the decade: triangles, squiggles, dots, on any background
  const memphis = (g, w, h, bg, n, sd) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); const r = seed(sd || 'memphis'), cols = [TEAL, PINK, PURP, YEL, '#111111'];
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, s = (.25 + r() * .3) * h, k = Math.floor(r() * 4); g.save(); g.translate(x, y); g.rotate(r() * PI * 2); g.fillStyle = g.strokeStyle = cols[Math.floor(r() * 5)]; g.lineWidth = Math.max(2, h * .05); g.lineCap = 'round';
      if (k === 0) { g.beginPath(); g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, s / 2); g.lineTo(0, -s / 2); g.closePath(); g.fill(); }
      else if (k === 1) { g.beginPath(); for (let j = 0; j <= 6; j++) g.lineTo((j - 3) * s * .22, (j % 2 ? -1 : 1) * s * .16); g.stroke(); }
      else if (k === 2) { g.beginPath(); g.arc(0, 0, s * .28, 0, PI * 2); g.fill(); }
      else { g.beginPath(); g.arc(0, 0, s * .4, 0, PI * 1.2); g.stroke(); }
      g.restore();
    }
  };
  const scan = (g, w, h) => { g.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2); };
  // a border round the top of the walls
  const fr = (len) => basic({ map: ctex(1024, 96, (g, w, h) => memphis(g, w, h, '#f4efe0', 46, 'frieze'), [Math.max(1, Math.round(len / 2.4)), 1]) });
  pl(4.95, .2, fr(4.95), -1.525, 2.78, -3.492, 0, G);   /* on the back wall it stops where the sealed wall starts: it showed as a white band between the shelves (owner, 2026-11-12: "Remove the white design on the wall") */
  pl(8, .2, fr(8), 0, 2.78, 3.492, PI, G); pl(7, .2, fr(7), -3.992, 2.78, 0, PI / 2, G);

  // the arcade cabinets: the game on each screen is drawn by its own section above
  const blk = lam({ color: 0x111114 });
  const cabinet = (z, name, body, c1, c2, tex, actName) => {
    const A = grp(-3.6, 0, z, PI / 2), cab = lam({ color: body });
    bx(.66, .92, .7, cab, 0, .46, 0, A); bx(.66, .8, .5, cab, 0, 1.32, -.1, A); bx(.66, .2, .58, cab, 0, 1.82, -.06, A);
    const deck = bx(.66, .05, .3, blk, 0, .95, .3, A); deck.rotation.x = .12;
    const side = lam({ map: ctex(256, 512, (g, w, h) => { memphis(g, w, h, '#' + body.toString(16).padStart(6, '0'), 26, 'cab' + name); g.fillStyle = YEL; g.font = '900 ' + Math.min(54, Math.floor(590 / name.length)) + 'px Inter, sans-serif'; g.textAlign = 'center'; g.save(); g.translate(w / 2, h / 2); g.rotate(-PI / 2); g.fillText(name, 0, 18); g.restore(); }) });
    pl(.7, 1.9, side, -.332, .96, 0, -PI / 2, A); pl(.7, 1.9, side, .332, .96, 0, PI / 2, A);
    pl(.5, .4, basic({ map: tex }), 0, 1.3, .152, 0, A);
    hit(bx(.8, 1.95, .7, hitM, -3.6, .98, z), actName);
    pl(.62, .16, basic({ map: ctex(400, 104, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = YEL; g.strokeStyle = '#111'; g.lineWidth = 6; g.font = 'italic 900 ' + Math.min(58, Math.floor(570 / name.length)) + 'px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeText(name, w / 2, h / 2 + 3); g.fillText(name, w / 2, h / 2 + 3); }) }), 0, 1.82, .232, 0, A);
    cyl(.008, .008, .07, blk, -.16, 1.0, .3, A); const knob = new THREE.Mesh(new THREE.SphereGeometry(.022, 12, 8), lam({ color: 0xd62c28 })); knob.position.set(-.16, 1.045, .3); A.add(knob);
    [[.02, 0xffd23a], [.09, 0x19b5a5], [.16, 0xff4f9a]].forEach((b) => cyl(.018, .018, .012, lam({ color: b[1] }), b[0], .985, .3, A));
    pl(.2, .26, lam({ map: ctex(100, 130, (g, w, h) => { g.fillStyle = '#26262b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6a6a72'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#ff8a2a'; g.fillRect(34, 40, 32, 22); g.fillStyle = '#111'; g.font = '700 13px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('25¢', 50, 56); g.fillRect(44, 84, 12, 26); }) }), 0, .5, .352, 0, A);
  };
  cabinet(CAB_Z.arcade, 'MALLOW SHOOTER', 0x1b1640, PURP, PINK, arc.tex, 'arcade'); arcDraw();
  cabinet(CAB_Z.stack, 'BOX STACK', 0x0e3b46, TEAL, '#3f8fe0', stk.tex, 'stack'); stkDraw();
  cabinet(CAB_Z.dunk, 'SCALPER DUNK', 0x4a1420, '#d62c28', YEL, dnk.tex, 'dunk'); dnkDraw();
  cabinet(CAB_Z.line, 'LINE RUSH', 0x16233f, '#2f6fd0', YEL, lin.tex, 'line'); linDraw();

  // the gumball machine
  const red = lam({ color: 0xd62c28 }), chrome = lam({ color: 0xc9ccd2 });
  cyl(.13, .15, .06, red, .95, .03, 3.25); cyl(.022, .022, .72, chrome, .95, .42, 3.25); cyl(.11, .1, .16, red, .95, .86, 3.25);
  const gum = new THREE.Mesh(new THREE.SphereGeometry(.15, 20, 14), basic({ map: ctex(256, 128, (g, w, h) => { g.fillStyle = '#e9f2f5'; g.fillRect(0, 0, w, h); const r = seed('gum'); for (let i = 0; i < 260; i++) { g.fillStyle = [PINK, TEAL, YEL, PURP, '#ff7a2a', '#3f8fe0', '#fff'][Math.floor(r() * 7)]; g.beginPath(); g.arc(r() * w, h * .3 + r() * h * .7, 7, 0, PI * 2); g.fill(); } }) })); gum.position.set(.95, 1.06, 3.25); G.add(gum);
  cyl(.05, .09, .05, red, .95, 1.215, 3.25);

  // a TV up in the corner with a tape playing
  const T = grp(-3.52, 2.18, -3.08, PI / 4), tvM   /* in the back-left corner now: the sealed wall has the right of the back wall */ = lam({ color: 0x2c2c30 });
  bx(.62, .5, .5, tvM, 0, 0, 0, T); bx(.5, .04, .4, blk, 0, -.27, 0, T); bx(.05, .05, .5, blk, 0, -.29, -.3, T);
  pl(.48, .37, basic({ map: tv.tex }), -.03, .01, .252, 0, T); tvDraw(true); hit(bx(.75, .62, .75, hitM, -3.5, 2.18, -3.05), 'tv');
  loadImg(W + '/mallow-games.jpg').then((im) => { tv.mallow = im; }).catch(() => {});
  loadImg(img(LOGO, 700)).then((im) => { tv.logo = im; if (S.mode !== 'tv') { tvDraw(true); kick(); } }).catch(() => {});

  // a console on the floor in front of its own TV, and two bean bags
  bx(.5, .42, .8, darkWoodM, 3.72, .21, -2.3, G); const tv2 = grp(3.7, .42, -2.3, -PI / 2);
  bx(.56, .46, .46, lam({ color: 0x8a8a86 }), 0, .23, 0, tv2);
  pl(.42, .32, basic({ map: ctex(256, 196, (g, w, h) => {   // a made-up platform game
    g.fillStyle = '#58b8f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; [[40, 40], [150, 60], [210, 30]].forEach((c) => { g.fillRect(c[0], c[1], 44, 12); g.fillRect(c[0] + 8, c[1] - 8, 26, 8); });
    g.fillStyle = '#3fae4a'; g.fillRect(0, 156, w, 12); g.fillStyle = '#9a5a2c'; g.fillRect(0, 168, w, 28); g.fillStyle = '#c87a3a'; for (let i = 0; i < 3; i++) g.fillRect(96 + i * 20, 104, 18, 18);
    g.fillStyle = PURP; g.fillRect(60, 132, 14, 24); g.fillStyle = '#ffd9b0'; g.fillRect(62, 124, 10, 10); g.fillStyle = YEL; g.beginPath(); g.arc(170, 96, 7, 0, PI * 2); g.fill(); g.beginPath(); g.arc(196, 96, 7, 0, PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '700 14px "Cutive Mono", monospace'; g.fillText('WORLD 1-2', 10, 16); scan(g, w, h);
  }) }), 0, .25, .232, 0, tv2);
  bx(.3, .06, .22, lam({ color: 0x55555c }), 3.12, .03, -2.3, G); bx(.12, .02, .07, lam({ color: 0xb9b9bf }), 2.9, .012, -2.12, G); bx(.12, .02, .07, lam({ color: 0xb9b9bf }), 2.86, .012, -2.5, G);
  [[2.62, -2.78, 0x19b5a5], [2.55, -1.85, 0x7a3fc4]].forEach((b) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.34, 18, 12), lam({ color: b[2] })); m.scale.set(1, .55, 1); m.position.set(b[0], .17, b[1]); G.add(m); });

  // the games table in the middle of the floor: folding table and chairs, a game half played, pizza
  const P = grp(2.3, 0, 1.85, .12), tblM = lam({ color: 0xb9ad98 }), leg = lam({ color: 0x55555c });
  bx(1.5, .035, .75, tblM, 0, .72, 0, P); [[-.68, -.3], [.68, -.3], [-.68, .3], [.68, .3]].forEach((l) => bx(.03, .7, .03, leg, l[0], .35, l[1], P));
  const flat = (w, d, mat, x, z, ry) => { const m = pl(w, d, mat, x, .739 + flat.n++ * .0006, z, 0, P); m.rotation.set(-PI / 2, 0, ry || 0); return m; }; flat.n = 0;
  flat(.6, .35, lam({ map: ctex(300, 175, (g, w, h) => { memphis(g, w, h, '#16324a', 14, 'mat'); g.strokeStyle = '#ffffff55'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16); }) }), -.3, .12, 0);
  const backM = lam({ map: ctex(126, 176, drawBack) }), r = seed('table');
  for (let i = 0; i < 9; i++) flat(CW, CH, backM, -.52 + (i % 5) * .095 + r() * .02, .06 + Math.floor(i / 5) * .12 + r() * .02, (r() - .5) * .5);
  bx(CW, .022, CH, backM, -.02, .749, .2, P).rotation.y = .2; bx(CW, .03, CH, backM, .1, .753, -.22, P).rotation.y = -.4;
  const d20 = new THREE.Mesh(new THREE.IcosahedronGeometry(.016), lam({ color: 0xd62c28 })); d20.position.set(-.1, .752, .02); P.add(d20);
  const d20b = new THREE.Mesh(new THREE.IcosahedronGeometry(.016), lam({ color: 0x19b5a5 })); d20b.position.set(-.42, .752, -.12); P.add(d20b);
  const pz = bx(.36, .045, .36, lam({ color: 0xe9e2d0 }), .42, .76, -.05, P); pz.rotation.y = .3;
  const pzT = flat(.34, .34, lam({ map: ctex(256, 256, (g, w, h) => { g.fillStyle = '#efe7d2'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c0392b'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28); g.fillStyle = '#c0392b'; g.font = '900 54px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('HOT', w / 2, 104); g.fillText('PIZZA', w / 2, 160); g.font = '700 20px Inter, sans-serif'; g.fillStyle = '#2f7a3a'; g.fillText('fresh · fast · 2 for 1 tuesdays', w / 2, 204); }) }), .42, -.05, -.3); pzT.position.y = .784;
  [[.2, .2, 0x2f7fd0], [.62, .26, 0xd62c28], [-.6, -.26, 0x3fae4a]].forEach((c) => { cyl(.028, .028, .105, lam({ color: c[2] }), c[0], .79, c[1], P); cyl(.026, .026, .004, chrome, c[0], .8445, c[1], P); });
  const hh = bx(.075, .02, .125, lam({ color: 0xbfbfc4 }), .16, .748, -.02, P); hh.rotation.y = .5;   // a handheld someone left
  const hs = flat(.045, .04, basic({ color: 0x7c9a4a }), .1505, -.0375, -.5); hs.position.y = .7585;
  const chair = (x, z, ry) => { const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; P.add(c); bx(.4, .025, .4, leg, 0, .45, 0, c); bx(.4, .3, .02, leg, 0, .78, -.19, c); [[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]].forEach((l) => bx(.022, .45, .022, tvM, l[0], .225, l[1], c)); bx(.022, .36, .022, tvM, -.18, .62, -.19, c); bx(.022, .36, .022, tvM, .18, .62, -.19, c); };
  chair(-.3, -.62, .2); chair(.35, .68, PI - .3); chair(1.02, .0, -PI / 2 + .5);
  const bag = new THREE.Mesh(new THREE.SphereGeometry(.2, 14, 10), lam({ color: 0x7a3fc4 })); bag.scale.set(1, 1.15, .6); bag.position.set(-.82, .22, .42); P.add(bag); bx(.24, .14, .06, lam({ color: 0x19b5a5 }), -.82, .17, .55, P);
  // long boxes of commons under the table and by the door
  const card = lam({ color: 0xe6e0cf });
  bx(.2, .16, .7, card, .3, .08, 0, P).rotation.y = .1; bx(.2, .16, .7, card, 0, .08, .05, P);
  bx(.7, .16, .2, card, 2.75, .08, 3.3, G); bx(.7, .16, .2, card, 2.78, .24, 3.3, G); bx(.2, .16, .7, card, 3.3, .08, 3.1, G).rotation.y = .3;

  // on the floor inside the door: a rug of the decade, and a skateboard left by the counter
  const rug = pl(1.7, 1.05, lam({ map: ctex(512, 316, (g, w, h) => { memphis(g, w, h, '#101018', 30, 'rug'); g.strokeStyle = TEAL; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14); g.strokeStyle = PINK; g.lineWidth = 5; g.strokeRect(22, 22, w - 44, h - 44); }) }), .15, .006, .75, 0, G); rug.rotation.set(-PI / 2, 0, .06);
  const sk = grp(-.75, 0, 1.45, 1.0); bx(.2, .012, .74, lam({ map: ctex(64, 256, (g, w, h) => memphis(g, w, h, '#ff4f9a', 16, 'deck')) }), 0, .085, 0, sk);
  [[-.07, -.24], [.07, -.24], [-.07, .24], [.07, .24]].forEach((q) => { const wl = cyl(.028, .028, .03, lam({ color: 0xffd23a }), q[0], .028, q[1], sk, 12); wl.rotation.z = PI / 2; }); bx(.16, .02, .04, chrome, 0, .06, -.24, sk); bx(.16, .02, .04, chrome, 0, .06, .24, sk);

  // on top of the graded cabinet: a boom box, tapes, more long boxes
  const B = grp(-3.78, gcab.h, .95, PI / 2);
  bx(.56, .26, .15, lam({ color: 0x232327 }), 0, .13, 0, B); bx(.4, .02, .02, chrome, 0, .33, 0, B); bx(.02, .08, .02, chrome, -.19, .29, 0, B); bx(.02, .08, .02, chrome, .19, .29, 0, B);
  pl(.54, .24, lam({ map: ctex(432, 192, (g, w, h) => { g.fillStyle = '#2a2a2f'; g.fillRect(0, 0, w, h); [[84, 104], [348, 104]].forEach((c) => { g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(c[0], c[1], 66, 0, PI * 2); g.fill(); g.strokeStyle = '#8a8a92'; g.lineWidth = 5; g.stroke(); g.fillStyle = '#3a3a40'; g.beginPath(); g.arc(c[0], c[1], 24, 0, PI * 2); g.fill(); }); g.fillStyle = '#111'; g.fillRect(166, 70, 100, 62); g.strokeStyle = '#c9ccd2'; g.lineWidth = 3; g.strokeRect(166, 70, 100, 62); g.fillStyle = '#efe7d2'; g.fillRect(180, 82, 72, 20); g.fillStyle = '#c0392b'; g.fillRect(166, 30, 100, 22); g.fillStyle = YEL; for (let i = 0; i < 6; i++) g.fillRect(170 + i * 16, 148, 12, 16); }) }), 0, .13, .077, 0, B);
  [[.42, 0], [.46, .03], [.44, .06]].forEach((t, i) => bx(.1, .016, .065, lam({ color: [0xff4f9a, 0x19b5a5, 0xffd23a][i] }), t[0], .008 + i * .016, t[1], B).rotation.y = i * .25);
  bx(.2, .16, .68, card, -3.78, gcab.h + .08, 2.8, G); bx(.2, .16, .68, card, -3.76, gcab.h + .24, 2.82, G).rotation.y = .06;

  // on the counter: a lava lamp, a stack of milk caps and a few loose
  const lava = basic({ color: 0xff3fa0 }); cyl(.03, .045, .07, chrome, 1.02, TOP + .035, -1.05); cyl(.022, .04, .2, lava, 1.02, TOP + .17, -1.05); cyl(.012, .022, .05, chrome, 1.02, TOP + .295, -1.05);
  const capM = lam({ map: ctex(96, 96, (g, w, h) => { g.fillStyle = YEL; g.fillRect(0, 0, w, h); g.fillStyle = PURP; g.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * PI * 2, q = i % 2 ? 44 : 22; g.lineTo(48 + Math.cos(a) * q, 48 + Math.sin(a) * q); } g.fill(); g.fillStyle = PINK; g.beginPath(); g.arc(48, 48, 12, 0, PI * 2); g.fill(); }) });
  cyl(.02, .02, .07, [lam({ color: 0xf4efe0 }), capM, capM], 1.42, TOP + .035, -.72);
  [[1.36, -.7, 0], [1.47, -.69, 1], [1.4, -.66, 2]].forEach((c) => cyl(.02, .02, .003, [lam({ color: 0xf4efe0 }), capM, capM], c[0], TOP + .0016 + c[2] * .0004, c[1]));

  // flags on the tall walls above the border: mana along the back wall, Pokemon cards on the door wall and the left wall
  [-3.5, -2.7, -1.9, -1.1, -.3].forEach((x, i) => flagHang(G, i * 2, x, 3.55, -3.488, 0, .62));   // left of the sealed wall
  [-3, -1, 1, 3].forEach((x, i) => flagHang(G, i * 2 + 1, x, 3.55, 3.488, PI, .62));
  [-2.3, -.4, 1.5].forEach((z, i) => flagHang(G, (i + 4) * 2 + 1, -3.988, 3.55, z, PI / 2, .62));
  flagLoad();
  // on the walls: a clock, and three more posters
  pl(.42, .42, basic({ transparent: true, map: ctex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#16121c'; g.beginPath(); g.arc(128, 128, 120, 0, PI * 2); g.fill(); g.shadowColor = TEAL; g.shadowBlur = 18; g.strokeStyle = '#7dfff0'; g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 108, 0, PI * 2); g.stroke(); g.shadowColor = PINK; g.strokeStyle = '#ff9ac6'; g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 58); g.stroke(); g.beginPath(); g.moveTo(128, 128); g.lineTo(176, 150); g.stroke(); g.shadowBlur = 0; g.fillStyle = '#fff'; for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; g.fillRect(126 + Math.cos(a) * 90, 126 + Math.sin(a) * 90, 4, 4); } }) }), 1.7, 2.5, 3.485, PI, G);   // over the door
  pl(.45, .63, poster(336, 468, (g, w, h) => { memphis(g, w, h, '#101018', 18, 'p1'); g.fillStyle = '#101018e0'; g.fillRect(24, 120, w - 48, 230); g.fillStyle = YEL; g.font = '900 64px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('MILK', w / 2, 196); g.fillText('CAPS', w / 2, 262); g.fillStyle = '#fff'; g.font = '700 24px Inter, sans-serif'; g.fillText('& SLAMMERS', w / 2, 300); g.fillStyle = PINK; g.font = '34px "Permanent Marker", cursive'; g.fillText('sold here!', w / 2, 338); }), -3.988, 2.27, -.49, PI / 2, G);   // over the cabinets
  pl(.62, .84, poster(372, 504, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0a0a2a'); gr.addColorStop(1, PURP); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = TEAL; g.lineWidth = 2; for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(w / 2 + (i - 5) * 8, 300); g.lineTo(w / 2 + (i - 5) * 80, h); g.stroke(); } for (let i = 0; i < 7; i++) { const y = 300 + i * i * 4.2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } g.fillStyle = YEL; g.beginPath(); g.arc(w / 2, 210, 80, PI, 0); g.fill(); g.fillStyle = '#fff'; g.font = 'italic 900 50px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('SURF THE', w / 2, 70); g.fillText('WEB', w / 2, 120); g.font = '700 22px Inter, sans-serif'; g.fillStyle = '#7dfff0'; g.fillText('28.8k dial-up · $5 an hour', w / 2, h - 60); g.fillStyle = '#fff'; g.fillText('ask at the counter', w / 2, h - 28); }), 2.95, 1.75, 3.488, PI, G);
  pl(.5, .62, poster(300, 372, (g, w, h) => { g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, w, h); g.fillStyle = '#c0392b'; g.fillRect(0, 0, w, 84); g.fillStyle = '#fff'; g.font = '900 44px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('MARCH 1996', w / 2, 58); g.fillStyle = '#222'; g.font = '600 20px Inter, sans-serif'; for (let d = 1; d <= 31; d++) { const k = d + 4, x = 30 + (k % 7) * 40, y = 130 + Math.floor(k / 7) * 44; g.fillText(String(d), x, y); } g.strokeStyle = '#c0392b'; g.lineWidth = 4; g.beginPath(); g.arc(30 + 5 * 40, 124 + 2 * 44, 18, 0, PI * 2); g.stroke(); g.fillStyle = '#1d3a8a'; g.font = '700 22px Caveat, cursive'; g.fillText('prerelease!', 200, 124 + 2 * 44 + 40); }), -3.988, 1.6, -2.72, PI / 2, G);   // on the left wall by the TV
}
// The person behind the till (owner, 2026-11-09: "a typical card shop employee
// behind it with a black polo shirt with an exor logo on the shirt"): a simple
// figure of plain shapes, glasses and a beard, the logo on the chest. A tap says hello.
function buildClerk() {
  const g = new THREE.Group(); g.position.set(2.12, 0, -1.62); g.rotation.y = -.12; scene.add(g);
  const polo = lam({ color: 0x141414 }), skin = lam({ color: 0xd8a47c }), hair = lam({ color: 0x3a2618 }), jeans = lam({ color: 0x2c3a52 });
  const cyl = (rt, rb, h, mat, x, y, z, sz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 18), mat); m.position.set(x, y, z); if (sz) m.scale.z = sz; g.add(m); return m; };
  const ball = (r, mat, x, y, z, sy) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat); m.position.set(x, y, z); if (sy) m.scale.y = sy; g.add(m); return m; };
  cyl(.15, .13, .92, jeans, 0, .46, 0, .7);                                   // legs, mostly behind the counter
  cyl(.2, .17, .58, polo, 0, 1.2, 0, .66);                                    // the polo
  ball(.2, polo, 0, 1.47, 0, .32).scale.z = .66;                              // shoulders
  [-1, 1].forEach((sd) => {
    const a = new THREE.Group(); a.position.set(sd * .215, 1.45, 0); a.rotation.set(-.5, 0, sd * .1); g.add(a);     // arms reach forward to the counter
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(.058, .052, .24, 14), polo); sl.position.y = -.12; a.add(sl);
    const fa = new THREE.Mesh(new THREE.CylinderGeometry(.04, .034, .34, 14), skin); fa.position.y = -.4; a.add(fa);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(.045, 14, 10), skin); hd.position.y = -.59; a.add(hd);
  });
  cyl(.05, .055, .09, skin, 0, 1.56, 0);                                      // neck
  const col = new THREE.Mesh(new THREE.TorusGeometry(.066, .02, 8, 20), polo); col.rotation.x = PI / 2; col.position.set(0, 1.525, .005); g.add(col);
  // The head (owner, 2026-11-10: "The employee looks like he is wearing a mask, can you make him look more like
  // a person"): the beard that covered the lower face like a mask and the hair that came down to the eyes are
  // gone. The face is painted on the head - eyes with whites and brows, a nose, a smile, a little stubble -
  // with a nose and ears standing out from it, hair set back off the forehead, and the glasses over the eyes.
  const faceT = ctex(512, 256, (c, w, h) => {
    c.fillStyle = '#d8a47c'; c.fillRect(0, 0, w, h); const X = w * .25, Y = h / 2;    // the middle of the face on the sphere's front
    const soft = (x, y, r, col) => { const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); };
    soft(X - 40, Y + 16, 22, 'rgba(214,120,96,.35)'); soft(X + 40, Y + 16, 22, 'rgba(214,120,96,.35)');           // cheeks
    soft(X, Y + 52, 60, 'rgba(70,45,30,.20)');                                                                      // stubble under the jaw line
    const r = seed('stubble'); c.fillStyle = 'rgba(58,38,24,.28)'; for (let i = 0; i < 420; i++) { const a = r() * PI, d = 26 + r() * 30; c.fillRect(X + Math.cos(a) * d * 1.25, Y + 14 + Math.sin(a) * d * .78, 1.3, 1.3); }
    [-1, 1].forEach((sd) => {
      const ex = X + sd * 29, ey = Y - 11;
      c.fillStyle = '#fbf6ee'; c.beginPath(); c.ellipse(ex, ey, 9.5, 5.5, 0, 0, PI * 2); c.fill();
      c.fillStyle = '#5a3a22'; c.beginPath(); c.arc(ex + sd * -.5, ey + .3, 4.4, 0, PI * 2); c.fill(); c.fillStyle = '#16100c'; c.beginPath(); c.arc(ex + sd * -.5, ey + .3, 2.1, 0, PI * 2); c.fill();
      c.fillStyle = '#fff'; c.fillRect(ex + 1, ey - 2.4, 1.6, 1.6);
      c.strokeStyle = '#4a2f1e'; c.lineWidth = 1.8; c.lineCap = 'round'; c.beginPath(); c.ellipse(ex, ey, 9.5, 5.5, 0, PI * 1.05, PI * 1.95); c.stroke();      // the upper lid
      c.strokeStyle = '#3a2618'; c.lineWidth = 4.2; c.beginPath(); c.moveTo(ex - sd * 11, ey - 13); c.quadraticCurveTo(ex, ey - 18.5, ex + sd * 11, ey - 14.5); c.stroke();   // brow
    });
    c.strokeStyle = 'rgba(120,70,48,.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(X - 7, Y + 14); c.quadraticCurveTo(X, Y + 18, X + 7, Y + 14); c.stroke();   // under the nose
    c.strokeStyle = '#7a3b2a'; c.lineWidth = 3; c.beginPath(); c.moveTo(X - 17, Y + 29); c.quadraticCurveTo(X, Y + 41, X + 17, Y + 29); c.stroke();           // a smile
    c.strokeStyle = 'rgba(190,110,90,.6)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(X - 9, Y + 39); c.quadraticCurveTo(X, Y + 43, X + 9, Y + 39); c.stroke();
  });
  const head = ball(.105, lam({ map: faceT }), 0, 1.69, 0, 1.14);
  const nose = ball(.016, skin, 0, 1.688, .106); nose.scale.set(.8, 1.25, 1);
  [-1, 1].forEach((sd) => { const e = ball(.024, skin, sd * .104, 1.693, -.004); e.scale.set(.45, 1.2, .8); });       // ears
  const hr = new THREE.Mesh(new THREE.SphereGeometry(.112, 22, 12, 0, PI * 2, 0, PI * .42), hair); hr.position.set(0, 1.7, -.008); hr.scale.y = 1.14; hr.rotation.x = -.42; g.add(hr);   // set back: the forehead shows
  [-1, 1].forEach((sd) => { const sb = ball(.03, hair, sd * .097, 1.74, -.03); sb.scale.set(.5, 1.5, 1.6); });         // over the ears
  [-1, 1].forEach((sd) => { const gl = new THREE.Mesh(new THREE.TorusGeometry(.027, .004, 8, 20), lam({ color: 0x111111 })); gl.position.set(sd * .039, 1.707, .104); g.add(gl); bx(.004, .004, .1, lam({ color: 0x111111 }), sd * .069, 1.709, .056, g); });
  bx(.026, .005, .005, lam({ color: 0x111111 }), 0, 1.71, .107, g);          // the bridge of the glasses
  // the logo on the chest: the shop's own when the CDN lets us draw it, the name until then
  const drawLogo = (im) => (c, w, h) => { c.clearRect(0, 0, w, h); if (im) { const s = Math.min(w / im.width, h / im.height); c.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s); } else { c.fillStyle = '#e23b2e'; c.font = '700 54px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('EXOR', w / 2, h * .32); c.fillStyle = '#f2c230'; c.fillText('GAMES', w / 2, h * .72); } };
  const lt = ctex(256, 160, drawLogo(null)), lg = pl(.1, .0625, new THREE.MeshBasicMaterial({ map: lt, transparent: true }), .085, 1.36, .123, .3, g);
  lg.userData.card = false;
  loadImg(img(LOGO, 300)).then((im) => { drawLogo(im)(lt.image.getContext('2d'), 256, 160); lt.needsUpdate = true; kick(); }).catch(() => {});
  hit(bx(.5, .95, .3, hitM, 2.12, 1.4, -1.62), 'staff');
}
/* ---------- the hobby corner (owner, 2026-11-09) ----------
   "add warhammer paint rack, vallejo, and army painter ... as well as a rack with boxes of Warhammer
   product", in the back left corner; then "The warhammer box I should be able to look right at it. Also
   the paints, can it display the color picker technology we made from the website in the rack as it would
   be displayed in the rack."
   Four racks, each with a view straight at it. The paint racks hold the paints in stock from the site's
   colour picker feed (/paints.json, src/paints.js): one pot or dropper bottle per colour, in its chart
   colour, ordered range by range and through the colour families. A tap on a pot leans in to it and opens
   the paint: its sizes, price, the till button, and the closest colour from each other brand (the picker's
   own matching: CIEDE2000 on the chart colours, like for like). The fourth rack stands the newest
   Warhammer kits in stock (/showcase/wargames.json) as cut-outs you can pick up. */
const PB = ['Citadel', 'The Army Painter', 'Vallejo', 'Tone Pro'];
const P_RANGES = {
  'Citadel': ['Base', 'Layer', 'Shade', 'Contrast', 'Dry', 'Technical', 'Air', 'Spray', 'Glaze'],
  'The Army Painter': ['Warpaints', 'Warpaints Fanatic', 'Warpaints Fanatic Wash', 'Speedpaint', 'Speedpaint Marker', 'Warpaints Air', 'Warpaints Primer', 'Quickshade Washes Set'],
  'Vallejo': ['Game Color', 'Game Air', 'Model Color', 'Model Air', 'Mecha Color', 'Xpress Color Intense', 'Xpress Color', 'Panzer Aces', 'Metal Color', 'Surface Primer', 'Wash FX', 'Weathering FX'],
  'Tone Pro': ['Tone 1', 'Tone 2', 'Tone 3', 'Tone 4', 'Tone 5'],
};
const P_FAMS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'flesh', 'grey', 'metal', 'wash', 'other'];
// the colour maths below is the picker's (theme sections/xg-paint-picker.liquid), unchanged
const pRgb = (hex) => { hex = hex.replace('#', ''); return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255]; };
function pHsl(hex) { const c = pRgb(hex), r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; let h = 0, s2 = 0; if (d) { s2 = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s2, l]; }
function pLab(hex) { const c = pRgb(hex).map((v) => (v > .04045 ? Math.pow((v + .055) / 1.055, 2.4) : v / 12.92)), x = (c[0] * .4124 + c[1] * .3576 + c[2] * .1805) / .95047, y = c[0] * .2126 + c[1] * .7152 + c[2] * .0722, z = (c[0] * .0193 + c[1] * .1192 + c[2] * .9505) / 1.08883, f = (t) => (t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]; }
function de2000(a, b) {
  const rd = Math.PI / 180, L1 = a[0], a1 = a[1], b1 = a[2], L2 = b[0], a2 = b[1], b2 = b[2];
  const C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cm = (C1 + C2) / 2, G = .5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = C1p ? (Math.atan2(b1, a1p) / rd + 360) % 360 : 0, h2p = C2p ? (Math.atan2(b2, a2p) / rd + 360) % 360 : 0, dL = L2 - L1, dC = C2p - C1p; let dh = 0;
  if (C1p * C2p) { dh = h2p - h1p; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh / 2 * rd), Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2; let hm = h1p + h2p;
  if (C1p * C2p) hm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2;
  const T = 1 - .17 * Math.cos((hm - 30) * rd) + .24 * Math.cos(2 * hm * rd) + .32 * Math.cos((3 * hm + 6) * rd) - .2 * Math.cos((4 * hm - 63) * rd);
  const SL = 1 + .015 * (Lm - 50) * (Lm - 50) / Math.sqrt(20 + (Lm - 50) * (Lm - 50)), SC = 1 + .045 * Cmp, SH = 1 + .015 * Cmp * T;
  const RT = -2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7))) * Math.sin(60 * Math.exp(-Math.pow((hm - 275) / 25, 2)) * rd);
  return Math.sqrt(Math.pow(dL / SL, 2) + Math.pow(dC / SC, 2) + Math.pow(dH / SH, 2) + RT * (dC / SC) * (dH / SH));
}
const P_METAL = /gold|silver|bronze|copper|brass|steel|gunmetal|chainmail|metal|\btin\b|pewter|chrome|leadbelcher|ironbreaker|retributor|alloy|runefang|stormhost|auric|gehenna|sycorax|plate mail|\biron\b|aluminium|mithril/;
const P_WASH = /\bwash|\bink\b|\bshade\b|\btone\b|quickshade/;
function pFamily(g) {
  const n = g.n.toLowerCase(), r = g.items.map((it) => it.r).join(' ').toLowerCase();
  if (P_METAL.test(n) || /metal/.test(r)) return 'metal';
  if (g.b !== 'Tone Pro' && (P_WASH.test(n) || /shade|wash/.test(r))) return 'wash';
  if (!g.h) return 'other';
  if (/flesh|skin/.test(n)) return 'flesh';
  if (/brown|umber|hide|bark|soil|leather|earth|mud|rust|wood/.test(n)) return 'brown';
  const t = pHsl(g.h), h = t[0], s2 = t[1], l = t[2];
  if (s2 < .13 || l < .09 || l > .93) return 'grey';
  if (h >= 15 && h < 48 && l < .5 && s2 < .75) return 'brown';
  if ((h < 15 || h >= 340) && s2 < .45 && l < .5 && !/red|crimson|scarlet|blood|burgundy|wine|maroon|gore/.test(n)) return 'brown';
  if (h < 12 || h >= 345) return 'red'; if (h < 40) return 'orange'; if (h < 68) return 'yellow'; if (h < 170) return 'green'; if (h < 255) return 'blue'; if (h < 300) return 'purple';
  return 'pink';
}
function pKind(g) { const r = g.items.map((it) => it.r).join(' '); if (g.fam === 'wash') return 'wash'; if (g.fam === 'metal') return 'metal'; if (/Contrast|Speedpaint|Xpress/.test(r)) return 'contrast'; if (/Technical|Weathering/.test(r)) return 'fx'; if (/Primer|Spray/.test(r)) return 'primer'; return 'paint'; }
const pChroma = (g) => g.sat > .15 && g.l > .08 && g.l < .95;
const pHueGap = (a, b) => { const x = Math.abs(a.hue - b.hue) % 360; return x > 180 ? 360 - x : x; };
const paints = { all: [] };
function pMatches(g) {   // the closest colour from each other brand, like for like
  if (!g.lab) return []; const out = [];
  PB.forEach((b) => {
    if (b === g.b) return; let best = null;
    paints.all.forEach((o) => {
      if (o.b !== b || !o.lab || o.kind !== g.kind) return;
      if (pChroma(g) && pChroma(o) && pHueGap(g, o) > 25) return;
      const d = de2000(g.lab, o.lab), stock = o.items.some((it) => it.a), score = d + (stock ? 0 : 2.5) + (o.dry && !g.dry ? 3 : 0);
      if (d < 10 && (!best || score < best.score)) best = { g: o, d, score };
    });
    if (best) out.push(best);
  });
  return out.sort((a, b) => a.d - b.d);
}

const racks = [];                      // [{ key, label, link, w, h, at, ry, g, list, pos, hitM }]
let ringM = null;
const rackHead = (g, w, h, bg, lines) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; lines.forEach((l) => { g.fillStyle = l[2]; g.font = l[1]; let sc = 1; const tw_ = g.measureText(l[0]).width; if (tw_ > w * .9) sc = w * .9 / tw_; g.save(); g.translate(w / 2, l[3]); g.scale(sc, 1); g.fillText(l[0], 0, 0); g.restore(); }); };
// One paint rack: black wire, a header board, and a pot or dropper bottle for each paint in `list`
// (generic colours until the feed answers). Returns the group; fills rack.pos with each paint's place.
function fillRack(r) {
  kill(r.g); const g = r.g = new THREE.Group(), black = lam({ color: 0x151515 }), d2 = new THREE.Object3D(), col = new THREE.Color(), pot = r.kind === 'pot';
  bx(r.w, .06, .34, black, 0, .03, .17, g); bx(r.w, r.h, .02, black, 0, r.h / 2, .01, g);
  bx(.025, r.h, .3, black, -r.w / 2 + .012, r.h / 2, .15, g); bx(.025, r.h, .3, black, r.w / 2 - .012, r.h / 2, .15, g);
  bx(r.w, .27, .03, black, 0, r.h + .135, .03, g); pl(r.w - .02, .25, new THREE.MeshBasicMaterial({ map: ctex(512, 220, r.sign) }), 0, r.h + .135, .047, 0, g);
  const cols = pot ? 16 : 22, cap = cols * 20; let list = r.list;
  if (list && list.length > cap) list = Array.from({ length: cap }, (_, k) => list[Math.floor(k * list.length / cap)]);   // more colours than hooks: an even spread of them
  r.shown = list || [];
  const n = list ? list.length : cols * 12, rows = Math.max(8, Math.ceil(n / cols)), y0 = .3, y1 = r.h - .13, pitch = (y1 - y0) / (rows - 1), sc = Math.min(1, pitch / (pot ? .05 : .078));
  const inst = new THREE.InstancedMesh(pot ? new THREE.CylinderGeometry(.02, .02, .034, 12) : new THREE.CylinderGeometry(.0115, .0115, .05, 10), lam({ color: 0xffffff }), n); g.add(inst);
  const caps = pot ? null : new THREE.InstancedMesh(new THREE.CylinderGeometry(.004, .008, .02, 8), lam({ color: r.cap || 0xf2f2f2 }), n); if (caps) g.add(caps);
  const q = seed('rack' + r.key); r.local = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols), c = k % cols, y = y1 - row * pitch, x = -r.w / 2 + .06 + c * (r.w - .12) / (cols - 1);
    if (c === 0) bx(r.w - .06, .006, .1, black, 0, y - .004, .1, g).rotation.x = pot ? .5 : .12;
    if (list) col.set(list[k].h || '#b9b1a2'); else col.setHSL(((row / rows) * .9 + (c / cols) * .06) % 1, .55 + q() * .35, .32 + .3 * q());
    if (pot) { d2.position.set(x, y + .014 * sc, .105); d2.rotation.set(PI / 2 - .5, 0, 0); } else { d2.position.set(x, y + .026 * sc, .1); d2.rotation.set(-.12, 0, 0); }
    d2.scale.setScalar(sc); d2.updateMatrix(); inst.setMatrixAt(k, d2.matrix); inst.setColorAt(k, col); r.local.push(d2.position.clone());
    if (caps) { d2.position.set(x, y + .061 * sc, .096); d2.updateMatrix(); caps.setMatrixAt(k, d2.matrix); }
  }
  g.position.set(r.at[0], 0, r.at[1]); g.rotation.y = r.ry || 0; scene.add(g); g.updateMatrixWorld(true);
  r.pos = r.local.map((v) => v.clone().applyMatrix4(g.matrixWorld));
}
let hobbyHits = [];
// a rack's tap box, wherever the rack stands
function rackHit(r) { const m = r.hitM, ry = r.ry || 0; if (!m) return; m.position.set(r.at[0] + Math.sin(ry) * .18, (r.h + .3) / 2, r.at[1] + Math.cos(ry) * .18); m.rotation.y = ry; }
function buildHobby() {
  const rainbow = (g, x, y, w, h) => { const gr = g.createLinearGradient(x, 0, x + w, 0); ['#e23b2e', '#f29a2e', '#f2d230', '#3fae4a', '#2f7fd0', '#7a4fc0'].forEach((c, i) => gr.addColorStop(i / 5, c)); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  // plain lettering on each header board, in the colours of the range it holds
  racks.push({ key: 'citadel', label: 'Warhammer paints', link: 'citadel-collection', kind: 'pot', w: .78, h: 1.62, at: [-3.05, -3.5], ry: 0, sign: (g, w, h) => { rackHead(g, w, h, '#0c0c0c', [['WARHAMMER', '900 78px Inter, sans-serif', '#ffffff', 82], ['COLOUR · TONE PRO', '700 36px Inter, sans-serif', '#ffffff', 172]]); rainbow(g, 60, 128, w - 120, 12); } });
  racks.push({ key: 'vallejo', label: 'Vallejo', link: 'all-vallejo', kind: 'dropper', cap: 0xf4f4f4, w: .78, h: 1.62, at: [-2.22, -3.5], ry: 0, sign: (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#f08a1c'); gr.addColorStop(1, '#c8321e'); g.fillStyle = gr; g.fillRect(0, 0, w, h); rackHead(g, w, h, 'rgba(0,0,0,0)', [['Vallejo', '700 96px Inter, sans-serif', '#ffffff', 88], ['MODEL COLOR · GAME COLOR', '700 30px Inter, sans-serif', '#fff3d6', 172]]); } });
  racks.push({ key: 'army', label: 'Army Painter', link: 'all-the-army-painter', kind: 'dropper', cap: 0x1a1a1a, w: .78, h: 1.62, at: [-4, -1.75], ry: PI / 2, sign: (g, w, h) => { rackHead(g, w, h, '#6b1d22', []); g.fillStyle = '#a8a35a'; g.fillRect(w * .52, 14, w * .48 - 14, h - 28); rackHead(g, w, h, 'rgba(0,0,0,0)', [['WARPAINTS', '900 58px Inter, sans-serif', '#ffffff', 82], ['THE ARMY PAINTER', '700 28px Inter, sans-serif', '#f3e9c8', 162]]); } });
  racks.forEach((r) => { r.side = 'left'; }); racks.forEach(fillRack);
  // racks of boxed product, filled when their feed answers: Warhammer kits beside the paints, and on the right
  // wall (owner, 2026-11-10: "Here can we put gunpla rack, models rack and another rack with blind boxes")
  const stripes = (g, w, h, cols) => cols.forEach((c, k) => { g.fillStyle = c; g.fillRect(40 + k * (w - 80) / cols.length, 150, (w - 80) / cols.length, 10); });
  // (owner, 2026-11-11: "no longer need the warhammer display on the left perhaps put arcades there" - the aisles carry Warhammer now; the two cabinets stand in its place)
  [].forEach((o) => {
    const kr = Object.assign({ kind: 'kits', w: 1.14, h: 1.72, meshes: [] }, o); racks.push(kr);
    const kg = kr.g = new THREE.Group(); kg.position.set(kr.at[0], 0, kr.at[1]); kg.rotation.y = kr.ry; scene.add(kg);
    const black = lam({ color: 0x151515 }), W_ = kr.w, H_ = kr.h;
    bx(W_, H_, .02, black, 0, H_ / 2, .01, kg); bx(.03, H_, .34, black, -W_ / 2 + .015, H_ / 2, .17, kg); bx(.03, H_, .34, black, W_ / 2 - .015, H_ / 2, .17, kg);
    [.2, .58, .96, 1.34].forEach((y) => bx(W_ - .04, .02, .32, black, 0, y - .01, .17, kg));
    bx(W_, .27, .03, black, 0, H_ + .135, .03, kg);
    pl(W_ - .02, .25, new THREE.MeshBasicMaterial({ map: ctex(768, 180, kr.sign) }), 0, H_ + .135, .047, 0, kg);
  });
  // a tap box in front of each rack, and the corner as a whole from the door
  racks.forEach((r, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h + .3, .36), hitM); m.userData.rack = i; scene.add(m); r.hitM = m; rackHit(r); });
  hobbyHits = [hit(bx(2.0, 2.0, .5, hitM, -2.64, 1.0, -3.3), 'hobby'), hit(bx(.5, 2.0, .9, hitM, -3.8, 1.0, -1.75), 'hobby')];
  ringM = new THREE.Mesh(new THREE.TorusGeometry(.026, .004, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff })); ringM.visible = false; scene.add(ringM);
}
// One rack's feed after another (asked for all at once, the shop's API throttled two of them - live probe
// 42725056109); a rack whose feed fails is asked once more a few seconds later.
function loadKits() {
  const list = racks.filter((r) => r.kind === 'kits');
  const one = (kr, again) => fetch(W + kr.feed, { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || !d.rows) throw new Error('feed');
    d.rows.slice(0, 12).forEach((r, i) => {   // three to a shelf, the newest at the top left
      const c = { name: r.name, set: kr.set, price: r.price, image: r.image, url: 'https://exorgames.com/products/' + r.handle, variantId: r.variantId, condition: '', foil: false, game: kr.key, sealed: true, ar: clamp(Number(r.ar) || 1, .6, 1.5), qty: r.qty };
      const q = seed('kit' + c.name), bh = .31, bw = clamp(bh * c.ar, .2, .34), hgt = bw / c.ar, face = new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, hgt), face); m.visible = false;
      m.position.set(-.37 + (i % 3) * .37 + (q() - .5) * .02, [1.34, .96, .58, .2][Math.floor(i / 3)] + hgt / 2, .2 + (q() - .5) * .03); m.rotation.y = (q() - .5) * .16; m.userData = { card: c }; kr.g.add(m); kr.meshes.push(m);
      cardTex(c, 256).then((t) => { face.map = t; face.needsUpdate = true; m.visible = true; kick(); });
    });
    lights(S.eve);
  }).catch(() => { if (!again) return new Promise((res) => setTimeout(res, 5000)).then(() => one(kr, true)); });
  list.reduce((p, kr) => p.then(() => one(kr)), Promise.resolve()).then(loadGraded).then(loadAisles);   // then the cabinet and the hall, still one feed at a time
}
// The picker's feed: every paint on the site, one swatch per colour. The racks take the ones in stock.
function loadPaints() {
  fetch(W + '/paints.json', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => {
    const all = ((j && j.swatches) || []).filter((g) => PB.indexOf(g.b) > -1 && g.items && g.items.length);
    all.forEach((g) => { g.fam = pFamily(g); g.kind = pKind(g); g.dry = g.items.every((it) => it.r === 'Dry'); if (g.h) { g.lab = pLab(g.h); const t = pHsl(g.h); g.hue = t[0]; g.sat = t[1]; g.l = t[2]; } else { g.hue = 999; g.sat = 0; g.l = 0; }
      const ri = (it) => { const k = (P_RANGES[g.b] || []).indexOf(it.r); return k < 0 ? 99 : k; }; g.items.sort((x, y) => ri(x) - ri(y) || (parseFloat(x.s) || 0) - (parseFloat(y.s) || 0)); g.ri = ri(g.items[0]); });
    paints.all = all; if (!all.length) return;
    const stock = (g) => g.items.some((it) => it.a), by = (a, b) => a.ri - b.ri || P_FAMS.indexOf(a.fam) - P_FAMS.indexOf(b.fam) || a.hue - b.hue || b.l - a.l;
    const of = (b) => all.filter((g) => g.b === b && stock(g)).sort(by);
    const tone = all.filter((g) => g.b === 'Tone Pro' && stock(g)).sort((a, b) => String(a.g || a.n).localeCompare(String(b.g || b.n)) || (a.o || 0) - (b.o || 0));
    [['citadel', of('Citadel').concat(tone)], ['vallejo', of('Vallejo')], ['army', of('The Army Painter')]].forEach((x) => { const r = racks.find((k) => k.key === x[0]); if (r && x[1].length) { r.list = x[1]; fillRack(r); x[1].forEach((g) => { g.rack = r; }); } });
    if (S.mode === 'rack' || S.mode === 'hobby') ui(); kick();
  }).catch(() => {});
}
// Looking straight at a rack: far enough back for the whole of it. A wide lens, so the camera stays close and the racks beside it stay out of the way.
function rackView(r) {
  const fov = 70, n = new V3(Math.sin(r.ry || 0), 0, Math.cos(r.ry || 0)), hgt = r.h + .32, d = Math.max((hgt / 2 + .12) / Math.tan(rad(fov / 2)), (r.w / 2 + .1) / hTan(fov));
  const C = new V3(r.at[0], hgt / 2, r.at[1]).addScaledVector(n, .17);
  return lookView(C.clone().addScaledVector(n, d), C, fov);
}
// Leaning in to one paint: it sits clear of the sheet that opens (above it on a phone, left of it on a desktop).
function paintView(r, k) {
  const n = new V3(Math.sin(r.ry || 0), 0, Math.cos(r.ry || 0)), right = new V3(n.z, 0, -n.x), P = r.pos[k], ph = cam.aspect < 1;
  const T = P.clone().add(new V3(0, ph ? -.1 : 0, 0)).addScaledVector(right, ph ? 0 : .13);
  return lookView(T.clone().addScaledVector(n, ph ? .5 : .62), T, cam.aspect < 1 ? 70 : 55);
}
const psel = { g: null, r: null, k: -1, it: null };
function goRack(i) { const r = racks[i]; if (!r) return; if (S.mode !== 'rack') S.rackFrom = S.mode;   /* where to go back to */ S.side = r.side; if (S.hand) putBack(); closePaint(true); leanOff(); S.mode = 'rack'; S.rack = i; glide(rackView(r), 800); hint(r.kind === 'kits' ? 'Tap a box to pick it up' : r.list ? 'Tap a paint for its colour, price and closest matches' : ''); ui(); }
function openPaint(g, it) {
  const r = g.rack, k = r ? r.shown.indexOf(g) : -1; psel.g = g; psel.r = r; psel.k = k;
  const its = g.items.filter((x) => x.a); psel.it = it && its.indexOf(it) > -1 ? it : its[0] || g.items[0];
  if (r && k > -1) { const i = racks.indexOf(r); if (S.mode !== 'rack' || S.rack !== i) { S.mode = 'rack'; S.rack = i; ui(); } ringM.visible = true; ringM.position.copy(r.pos[k]); ringM.rotation.set(r.kind === 'pot' ? -.5 : 0, r.ry || 0, 0); ringM.position.addScaledVector(new V3(Math.sin(r.ry || 0), 0, Math.cos(r.ry || 0)), .03); glide(paintView(r, k), 520); }
  drawPaint(); $('#paintv').classList.add('on'); hint('');
}
function drawPaint() {
  const g = psel.g, it = psel.it; if (!g) return; const its = g.items.filter((x) => x.a), done = S.pile.some((p) => String(p.variantId) === String(it.v));
  const chip = (o, cls) => '<span class="' + cls + '" style="background:' + esc(o.h || '#b9b1a2') + '"></span>';
  $('#paintBody').innerHTML = '<div class="pv__top">' + chip(g, 'pv__chip') + '<div><h2>' + esc(g.n) + '</h2><div class="set">' + esc([g.b === 'Citadel' ? 'Warhammer Colour' : g.b === 'Tone Pro' ? 'Warhammer Tone Pro' : g.b, it.r, it.s, it.c].filter(Boolean).join(' · ')) + '</div></div></div>'
    + (its.length > 1 ? '<div class="cps">' + its.map((x, i) => '<button type="button" class="cp' + (x === it ? ' on' : '') + '" data-popt="' + g.items.indexOf(x) + '"><b>' + esc(x.r) + '</b>' + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '<span>' + money(x.p) + '</span></button>').join('') + '</div>' : '')
    + '<div class="acts">' + (it.a && it.v ? '<button type="button" class="buy" id="pbuy"' + (done ? ' disabled' : '') + '>' + (done ? (ON_STORE ? 'In your cart ✓' : 'By the till ✓') : (ON_STORE ? 'Add to cart' : 'Set it by the till') + ' · ' + money(it.p)) + '</button>' : '<span class="one">Out of stock</span>')
    + '<a href="https://exorgames.com/products/' + esc(it.u) + '"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>' + (ON_STORE ? 'See the listing' : 'Open on exorgames.com ↗') + '</a></div>'
    + (() => { const m = pMatches(g); return m.length ? '<h3>Closest from other brands</h3><div class="pv__ms">' + m.map((x) => '<button type="button" class="pv__m" data-pmatch="' + paints.all.indexOf(x.g) + '">' + chip(x.g, 'pv__dot') + '<span><b>' + esc(x.g.n) + '</b><small>' + esc((x.g.b === 'Citadel' ? 'Warhammer' : x.g.b) + ' · ' + x.g.items[0].r + (x.g.items.some((y) => y.a) ? '' : ' · out of stock')) + '</small></span><i>' + (x.d < 2 ? 'near identical' : x.d < 5 ? 'very close' : 'close') + '</i></button>').join('') + '</div>' : ''; })();
}
function closePaint(quiet) { const was = !!psel.g; psel.g = null; psel.k = -1; if (ringM) ringM.visible = false; $('#paintv').classList.remove('on'); if (was && !quiet && S.mode === 'rack') glide(rackView(racks[S.rack]), 520); }
function buyPaint(b) {
  const g = psel.g, it = psel.it; if (!g || !it || b.disabled) return; b.disabled = true;
  const done = () => { S.pile.push({ name: g.n, set: [g.b, it.r, it.s].filter(Boolean).join(' '), price: it.p, url: 'https://exorgames.com/products/' + it.u, variantId: it.v, cond: '', foil: false }); pile(); drawPaint(); };
  if (!ON_STORE) { done(); return; }
  b.textContent = 'Adding…';
  fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(it.v), quantity: 1, properties: { _xg: 'showcase' } }] }) })
    .then((r) => { if (!r.ok) throw new Error('cart ' + r.status); return r.json(); }).then(() => { done(); if (window.xgImpact) { try { window.xgImpact('showcase', 'add'); } catch (x) {} } })
    .catch(() => { b.textContent = 'Could not add'; setTimeout(drawPaint, 2000); });
}
// the pot nearest the tap, within a finger's width
function potAt(r, x, y) {
  const rc = canvas.getBoundingClientRect(), v = new V3(); let best = -1, bd = 38 * 38;
  if (!r.list) return -1;
  for (let k = 0; k < r.pos.length; k++) { v.copy(r.pos[k]).project(cam); const dx = (v.x + 1) / 2 * rc.width + rc.left - x, dy = (1 - v.y) / 2 * rc.height + rc.top - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } }
  return best;
}
function lights(k) {   // 0 = the tubes, 1 = the evening, with the lamp
  hemi.intensity = lerp(2.6, .5, k); sun.intensity = lerp(1.1, .12, k); lampL.intensity = lerp(0, 2.4, k);
  neonL.intensity = lerp(1.2, 3.2, k); neonHalo.opacity = lerp(.55, 1, k);   // the neon carries the room in the evening
  tubeM.color.setScalar(lerp(1, .12, k)); shadeM.emissive.setRGB(.05 * k, .45 * k, .16 * k);
  const v = lerp(1, .78, k); cardTint.setRGB(v, v * .96, v * .88);
  scene.traverse((o) => { if (o.userData.card && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.isMeshBasicMaterial) m.color.copy(cardTint); }); });
}
const cardTint = new THREE.Color(1, 1, 1);
function toggleLights() { const to = S.eve > .5 ? 0 : 1, from = S.eve, t0 = performance.now(); anims.push((now) => { const k = Math.min(1, (now - t0) / (reduce ? 1 : 700)); S.eve = lerp(from, to, k); lights(S.eve); return k < 1; }); kick(); }
let ac = null;
function ding() {
  try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime; [[2093, .22, 1.5], [4150, .1, 1.0], [6270, .04, .6]].forEach((f) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f[0]; g.gain.setValueAtTime(f[1], t); g.gain.exponentialRampToValueAtTime(.0001, t + f[2]); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + f[2] + .05); }); } catch (x) {}
  const t0 = performance.now(); anims.push((now) => { const k = Math.min(1, (now - t0) / 260); bell.scale.y = 1 - .25 * Math.sin(k * PI); return k < 1; }); kick();
}

/* ---------- the glass case: the Showcase's shelves, laid by hand ---------- */
let caseG = null, caseCards = [], caseHit = null;
// The top shelf lies under the glass in three overlapping rows; the shelves
// below stand their cards in two rows facing the front glass.
function layoutShelf(sh, idx) {
  const rows = idx === 0 ? 3 : 2, r = seed(S.game + '|' + sh.key), xs = [];
  for (let k = 0; k < rows; k++) xs.push(.05 + CW * ((k % 2) * .55 + Math.floor(k / 2) * .18) + r() * .02);
  const items = sh.cards.map((c, i) => {
    const row = i % rows, q = seed(keyOf(c) + '|' + i), under = q() < .1 && i >= rows;
    if (i >= rows) xs[row] += under ? -CW * (.1 + q() * .1) : CW * (.07 + q() * .16);
    const it = { c, row, x: xs[row] + CW / 2, rz: (q() - .5) * .12, jy: (q() - .5) * .006, under, s: sh.key === 'picks' && i === 0 ? 1.08 : 1 };
    xs[row] += CW; return it;
  });
  return { items, rows, len: Math.max.apply(null, xs.concat([.3])) + .05, tapeX: .12 + r() * .25 };
}
function shelfY(i) { const n = S.shelves.length, s2 = n > 2 ? Math.min(.24, .56 / (n - 2)) : 0; return i === 0 ? .915 : .70 - (i - 1) * s2; }
const TH = .35;                               // the top board leans this much towards you
function buildCase() {
  kill(caseG); caseG = new THREE.Group(); scene.add(caseG); caseCards = [];
  if (caseHit) { hot.splice(hot.indexOf(caseHit), 1); kill(caseHit); caseHit = null; }
  S.lay = S.shelves.map(layoutShelf);
  const len = clamp(Math.max.apply(null, S.lay.map((l) => l.len).concat([0])) + .08, 1.5, 3.4), x0 = X1 - len, xc = x0 + len / 2, zc = (ZF + ZB) / 2, dep = ZF - ZB;
  S.caseLen = len; S.x0 = x0;
  bx(len, .12, dep, woodM, xc, .06, zc, caseG);
  [[x0 + .018, ZF - .018], [X1 - .018, ZF - .018], [x0 + .018, ZB + .018], [X1 - .018, ZB + .018]].forEach((p) => bx(.036, TOP - .12, .036, darkWoodM, p[0], .12 + (TOP - .12) / 2, p[1], caseG));
  bx(len, .03, .036, darkWoodM, xc, TOP - .015, ZF - .018, caseG); bx(len, .03, .036, darkWoodM, xc, TOP - .015, ZB + .018, caseG);
  bx(len, TOP - .12, .012, darkWoodM, xc, .12 + (TOP - .12) / 2, ZB + .006, caseG);
  const caseNo = Math.max(1, S.cases.findIndex((c) => c.key === S.game) + 1);
  S.shelves.forEach((sh, i) => {
    const L = S.lay[i], sy = shelfY(i), top = i === 0;
    if (top) { const b = bx(len - .05, .008, .3, feltM, xc, sy - .004 * Math.cos(TH), -.93 - .004 * Math.sin(TH), caseG); b.rotation.x = -PI / 2 + TH + PI / 2; }
    else { bx(len - .05, .008, .44, feltM, xc, sy - .004, zc, caseG); bx(len - .05, .05, .1, feltM, xc, sy + .025, -.84, caseG); }
    L.items.forEach((it, j) => {
      const m = new THREE.Mesh(top ? geoC : geoB, new THREE.MeshBasicMaterial({ map: phTex, color: cardTint }));
      const x = x0 + it.x;
      if (top) {   // on the leaning board: rows further back sit higher, rows in front lie over them
        const v = (L.rows - 1 - it.row - (L.rows - 1) / 2) * .058 + it.jy, n = .0015 + it.row * .0014 + (it.under ? -.0008 : j * .00001);
        m.position.set(x, sy + v * Math.sin(TH) + n * Math.cos(TH), -.93 - v * Math.cos(TH) + n * Math.sin(TH)); m.rotation.set(-PI / 2 + TH, 0, it.rz);
      } else {
        const back = it.row === 0; m.position.set(x, sy + (back ? .051 : .001), (back ? -.80 : -.725) + (it.under ? -.0015 : j * .00002)); m.rotation.set(-.45, 0, it.rz * .6);
      }
      m.scale.setScalar(it.s); m.userData = { card: it.c, si: i, x }; caseG.add(m); caseCards.push(m);
    });
    // the masking-tape label: Case 2 · Shelf A · the case up front
    const lbl = 'Case ' + caseNo + ' · Shelf ' + String.fromCharCode(65 + i) + ' · ' + sh.tape;
    const t = new THREE.Mesh(new THREE.PlaneGeometry(.21, .024), new THREE.MeshBasicMaterial({ map: ctex(512, 58, (g, w, h) => tape(g, w, h, lbl, '30px "Permanent Marker", cursive', (L.tapeX - .25) * .08)), transparent: true }));
    t.position.set(x0 + L.tapeX + .1, top ? TOP - .015 : sy - .012, ZF + .001); caseG.add(t);
  });
  // the glass
  const gt = pl(len, dep, glassM, xc, TOP, zc, 0, caseG); gt.rotation.x = -PI / 2; pl(len, TOP - .12, glassM, xc, .12 + (TOP - .12) / 2, ZF, 0, caseG);
  caseHit = hit(bx(len, TOP - .1, dep, hitM, xc, .12 + (TOP - .12) / 2, zc), 'case');
  lights(S.eve);
}
// Only the cards near you carry their picture; the rest wait as blank sleeves.
let texAt = 0;
function caseTextures(now) {
  if (now - texAt < 140) return; texAt = now;
  const half = (view.dist || .5) * hTan(view.fov) + .22, cx = view.pos.x, cap = cam.aspect < 1 ? 70 : 150; let n = 0; const far = [];
  for (const m of caseCards) {
    const u = m.userData, near = Math.abs(u.si - S.shelf) <= 1 && Math.abs(u.x - cx) < half;
    if (near && !u.has) { u.has = true; wear(m, u.card, 256); }
    if (u.has) { n++; if (!near) far.push(m); }
  }
  if (n > cap) { far.sort((a, b) => Math.abs(b.userData.x - cx) - Math.abs(a.userData.x - cx)); far.slice(0, n - cap).forEach((m) => { m.userData.has = false; m.userData.hi = false; bare(m); }); }
}
function visW() { return 2 * (view.dist || .5) * hTan(baseFov()); }
function caseView() {
  const i = S.shelf, L = S.lay[i], top = i === 0, sy = shelfY(i);
  const dist = top ? .5 : .42, vw = 2 * dist * hTan(baseFov()), max = Math.max(0, L.len - vw);
  S.maxWalk = max; S.walk = clamp(S.walk, 0, max);
  const x = S.x0 + (L.len <= vw ? L.len / 2 : vw / 2 + S.walk);
  return top ? lookView(new V3(x, sy + .43, -.67), new V3(x, sy + .01, -.94)) : lookView(new V3(x, sy + .2, -.29), new V3(x, sy + .07, -.78));
}
function goShelf(i) {
  leanOff();
  const n = clamp(i, 0, S.shelves.length - 1); if (n === S.shelf) return;
  const p = S.maxWalk ? S.walk / S.maxWalk : 0; S.shelf = n; S.vx = 0; S.walk = 1e9; caseView(); S.walk = p * S.maxWalk;   // the same proportion along the new shelf
  glide(caseView(), 520); ui(); hint('');
}

/* ---------- the boxes on the back wall: every set, by box ---------- */
const boxes = { list: null, open: null, setIdx: -1, seq: 0 };
let wallG = null, boxMeshes = [], wallHit = null, wallW = 0, wallFaces = [], wallGen = 0;
// The end of a white box: the game and box number typed small, the range of sets in marker, and (owner,
// 2026-11-09: "Set logos on the set boxes too") the logos of a few of the sets inside.
function drawBoxFace(g, w, h, d, b, rot, ims) {
  g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h); noise(g, w, h, 500, ['#e2ded2', '#d8d4c6'], .6); g.fillStyle = '#cfcabb'; g.fillRect(0, 0, w, 10);
  rr(g, w / 2 - 44, 20, 88, 26, 13); g.fillStyle = '#2b2620'; g.fill();
  g.fillStyle = '#6a6458'; g.font = '24px "Special Elite", monospace'; g.textAlign = 'left'; g.fillText(d.label + ' · box ' + b.n, 16, 44);
  const n = ims.length, cell = 50, gap = 8, strip = n ? n * cell + (n - 1) * gap : 0, tx = n ? (w - strip - 24) / 2 : w / 2;
  g.fillStyle = '#16120d'; g.font = (n ? 50 : 58) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; g.save(); g.translate(tx, 104); g.rotate(rot); g.fillText(b.label, 0, 0); g.restore();
  ims.forEach((im, k) => { const iw = im.width || 1, ih = im.height || 1, s = Math.min(cell / iw, cell / ih), x = w - 16 - strip + k * (cell + gap), y = 60; g.drawImage(im, x + (cell - iw * s) / 2, y + (cell - ih * s) / 2, iw * s, ih * s); });
}
/* ---------- set logos (worker: /showcase/setlogos.json, src/setlogos.js; the look-up rule is the same there) ---------- */
const logos = { map: {}, game: '' };
const normSet = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const SET_EXTRA = /\s+(tokens?|prerelease promos|promos?|extras|art series|minigames|front cards|substitute cards|commander tokens|jumpstart front cards|base set)$/;
function setLogo(name) {
  if (logos.game !== S.game) return null;
  const n = normSet(name), keys = [n, n.replace(SET_EXTRA, '')], colon = String(name || '').indexOf(':');
  if (colon > 0) { const r = normSet(String(name).slice(colon + 1)); keys.push(r, r.replace(SET_EXTRA, '')); if (r === 'base set' || !r) keys.push(normSet(String(name).slice(0, colon))); }
  for (const k of keys) if (k && logos.map[k]) return logos.map[k];
  return null;
}
function loadLogos() {
  const game = S.game; logos.map = {}; logos.game = '';
  fetch(W + '/showcase/setlogos.json?game=' + encodeURIComponent(game), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.logos || game !== S.game) return; logos.map = d.logos; logos.game = game; decorateWall();
    if ($('#setsv').classList.contains('on')) listSets($('#setsFind').value);
  }).catch(() => {});
}
// Up to four logos per box, spread over the sets it holds; drawn when the pictures are in.
function decorateWall() {
  if (logos.game !== S.game) return; const gen = wallGen;
  wallFaces.forEach((f) => {
    const have = f.b.sets.map(setLogo).filter(Boolean), uniq = have.filter((u, i) => have.indexOf(u) === i), pickN = Math.min(4, uniq.length); if (!pickN) return;
    const urls = Array.from({ length: pickN }, (_, k) => uniq[Math.floor(k * uniq.length / pickN)]);
    Promise.all(urls.map((u) => loadImg(u).catch(() => null))).then((ims) => {
      ims = ims.filter(Boolean); if (gen !== wallGen || !ims.length) return;
      drawBoxFace(f.tex.image.getContext('2d'), 512, 128, f.d, f.b, f.rot, ims); f.tex.needsUpdate = true; kick();
    });
  });
}
let WX = -.4; const WZ = -3.2;
function buildWall(d) {
  kill(wallG); wallG = new THREE.Group(); scene.add(wallG); boxMeshes = []; wallFaces = []; wallGen++;
  if (wallHit) { hot.splice(hot.indexOf(wallHit), 1); kill(wallHit); wallHit = null; }
  wallW = 0; S.wallRows = 0;
  if (!d) return;
  const n = d.boxes.length, rows = n <= 3 ? 1 : n <= 8 ? 2 : n <= 15 ? 3 : 4, cols = Math.ceil(n / rows), bw = .42, bh = .105, px = .46, py = .16;
  wallW = cols * px; const y0 = 1.12; WX = Math.min(-.4, sealed.x0 - .3 - wallW / 2);   // clear of the sealed wall on its right
  const card = lam({ color: 0xf1eee4 });
  for (let r = 0; r < rows; r++) bx(wallW + .12, .022, .44, woodM, WX, y0 + r * py - .011, WZ, wallG);
  bx(.03, rows * py + .1, .44, darkWoodM, WX - wallW / 2 - .06, y0 + rows * py / 2 - .03, WZ, wallG); bx(.03, rows * py + .1, .44, darkWoodM, WX + wallW / 2 + .06, y0 + rows * py / 2 - .03, WZ, wallG);
  d.boxes.forEach((b, i) => {
    const col = Math.floor(i / rows), row = rows - 1 - (i % rows), q = seed('box' + d.game + b.n);
    const rot = (q() - .5) * .05, tex = ctex(512, 128, (g, w, h) => drawBoxFace(g, w, h, d, b, rot, [])), face = lam({ map: tex }); wallFaces.push({ b, tex, rot, d });
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, .38), [card, card, card, card, face, card]);
    m.position.set(WX - wallW / 2 + px / 2 + col * px + (q() - .5) * .012, y0 + row * py + bh / 2, WZ + (q() - .5) * .02); m.rotation.y = (q() - .5) * .05; m.userData.n = b.n; wallG.add(m); boxMeshes.push(m);
  });
  // "Browse our cards by set" (owner, 2026-11-04), on a card taped to the shelf end
  const sg = pl(.34, .2, new THREE.MeshBasicMaterial({ map: ctex(340, 200, (g, w, h) => { g.fillStyle = '#fbf7ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#c0392b'; g.font = '40px "Permanent Marker", cursive'; g.textAlign = 'center'; g.fillText('Browse our', w / 2, 62); g.fillText('cards by set', w / 2, 112); g.fillStyle = '#16120d'; g.font = '700 30px Caveat, cursive'; g.fillText(Number(d.count).toLocaleString('en-CA') + ' sets  →', w / 2, 164); }) }), WX - wallW / 2 - .3, y0 + rows * py / 2, WZ + .2, .12, wallG);
  sg.rotation.z = -.04;
  // (owner, 2026-11-10): "Above the white boxes ... below the exor games sign ... a handwritten sign with a drawn arrow
  // pointing down to the white boxes that says 'Card Singles By Set'": marker on a sheet of paper taped to the wall
  const top = y0 + (rows - 1) * py + bh;
  const hs = pl(.86, .26, new THREE.MeshBasicMaterial({ map: ctex(860, 260, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.save(); g.translate(w / 2, h / 2); g.rotate(-.012); g.fillStyle = '#fbf7ec'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 10; g.shadowOffsetY = 4; g.fillRect(-w / 2 + 14, -h / 2 + 16, w - 28, h - 34); g.restore();
    g.fillStyle = 'rgba(232,220,184,.92)'; [[30, 6, -.5], [w - 110, 4, .45]].forEach((t) => { g.save(); g.translate(t[0] + 40, t[1] + 16); g.rotate(t[2]); g.fillRect(-42, -13, 84, 26); g.restore(); });   // two bits of masking tape
    g.fillStyle = '#16120d'; g.font = '74px "Permanent Marker", cursive'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.save(); g.translate(46, h / 2 + 4); g.rotate(-.02); let sc = 1; const tw_ = g.measureText('Card Singles By Set').width; if (tw_ > w - 210) sc = (w - 210) / tw_; g.scale(sc, 1); g.fillText('Card Singles By Set', 0, 0); g.restore();
    // the arrow, drawn in one go with a red marker: a wobbly shaft and a head pointing down at the boxes
    g.strokeStyle = '#c0392b'; g.lineWidth = 11; g.lineCap = 'round'; g.lineJoin = 'round'; const ax = w - 96;
    g.beginPath(); g.moveTo(ax - 8, 44); g.bezierCurveTo(ax + 16, 84, ax - 18, 130, ax + 2, h - 46); g.stroke();
    g.beginPath(); g.moveTo(ax - 38, h - 86); g.lineTo(ax + 3, h - 40); g.lineTo(ax + 40, h - 92); g.stroke();
  }), transparent: true }), WX, Math.min(top + .16, 1.9), -3.47, 0, wallG);
  hs.rotation.z = .012;
  wallHit = hit(bx(wallW + .8, rows * py + .2, .5, hitM, WX - .15, y0 + rows * py / 2, WZ), 'boxes');
  S.wallRows = rows * py; decorateWall();
}
function boxesView() {
  // the set boxes: wide enough for the whole of them where the screen allows it; a phone sees two boxes across and pans
  const L = WX - wallW / 2 - .3, R = WX + wallW / 2 + .15, cx = (L + R) / 2, hh = Math.max(S.wallRows || 0, .3);
  const fitH = 2 * Math.atan((hh / 2 + .22) / 2.75) * 180 / PI, fitW = 2 * Math.atan((R - L) / 2 / 2.75 / cam.aspect) * 180 / PI;
  const fov = clamp(Math.max(fitH, Math.min(fitW, cam.aspect < 1 ? 41 : 46)), 20, 46), vw = 2 * 2.75 * hTan(fov), max = Math.max(0, (R - L - vw) / 2);
  S.maxPan = max; S.pan = clamp(S.pan, -max, max);
  const v = lookView(new V3(cx + S.pan, 1.56, -.3), new V3(cx + S.pan, 1.09 + hh / 2, WZ + .19), fov); v.vw = vw; return v;
}
/* ---------- new sealed booster boxes, on the back wall beside the set boxes (owner, 2026-11-09) ---------- */
/* The sealed wall behind the counter (owner, 2026-11-11: "Make the wall behind the employee larger allowing us
   to have all our new sealed booster boxes, commander decks, etb and bundles etc for Pokémon, mtg, etc out for
   sale. You should be able to pinch zoom before picking one up"). Eight shelves from counter height to under
   the flags, from the set boxes to the right-hand end of the back wall; every card game's sealed product in
   stock (/showcase/sealedwall.json), a block of columns per game under its name, each game's newest first by
   kind (booster boxes, commander decks, Elite Trainer Boxes, bundles, decks, box sets). It does not change
   with the game tab. Looked at from behind the counter, close: drag to move over it, pinch to lean in, tap a
   box for its page. The set boxes move left to make room. */
const sealed = { rows: [], w: 2.93, h: 0, x0: 1.02, y0: 1.12, py: .3, px: .225, nr: 9, loaded: false };   // 13 columns x 9 shelves = 117 places
let sealG = null, sealMeshes = [], sealHit = null;
function buildSealed(games) {
  kill(sealG); sealG = null; sealMeshes = []; sealed.rows = [];
  if (sealHit) { hot.splice(hot.indexOf(sealHit), 1); kill(sealHit); sealHit = null; }
  games = (games || []).filter((g) => g.rows && g.rows.length); if (!games.length) return;
  const nr = sealed.nr, px = sealed.px, py = sealed.py, y0 = sealed.y0, cols = Math.floor(sealed.w / px), total = games.reduce((n, g) => n + g.rows.length, 0), bh = .235;
  // columns per game: by its share of the stock, one at least, the sum exactly the wall
  let left = cols; games.forEach((g, i) => { g.cols = Math.max(1, Math.min(Math.ceil(g.rows.length / nr), Math.round(cols * g.rows.length / total))); });
  let sum = games.reduce((n, g) => n + g.cols, 0);
  while (sum > cols) { const g = games.slice().sort((a, b) => b.cols - a.cols)[0]; g.cols--; sum--; }
  while (sum < cols) { const g = games.filter((q) => q.cols * nr < q.rows.length).sort((a, b) => (b.rows.length - b.cols * nr) - (a.rows.length - a.cols * nr))[0]; if (!g) break; g.cols++; sum++; }
  sealed.w2 = sum * px; sealed.h = nr * py + .26;
  sealG = new THREE.Group(); sealG.position.x = sealed.x0; scene.add(sealG);
  for (let r = 0; r <= nr; r++) bx(sealed.w2 + .08, .02, .28, r === nr ? darkWoodM : woodM, sealed.w2 / 2, y0 + r * py - .01, WZ + .05, sealG);
  bx(.03, nr * py + .04, .28, darkWoodM, -.04, y0 + nr * py / 2 - .01, WZ + .05, sealG); bx(.03, nr * py + .04, .28, darkWoodM, sealed.w2 + .04, y0 + nr * py / 2 - .01, WZ + .05, sealG);
  let c0 = 0;
  games.forEach((g, gi) => {
    const rows = g.rows.slice(0, g.cols * nr), bw0 = g.cols * px;
    if (gi) bx(.02, nr * py, .27, darkWoodM, c0 * px, y0 + nr * py / 2 - .01, WZ + .05, sealG);
    pl(Math.min(bw0 - .03, .9), .14, new THREE.MeshBasicMaterial({ map: ctex(600, 96, (c, w, h) => { c.fillStyle = '#14100e'; c.fillRect(0, 0, w, h); c.fillStyle = '#d62c28'; c.fillRect(0, 0, w, 8); c.fillStyle = '#f2c230'; c.font = '900 56px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; const t = g.label.toUpperCase(), sc = Math.min(1, (w - 30) / c.measureText(t).width); c.save(); c.translate(w / 2, h / 2 + 6); c.scale(sc, 1); c.fillText(t, 0, 0); c.restore(); }) }), c0 * px + bw0 / 2, y0 + nr * py + .1, WZ + .2, 0, sealG);
    rows.forEach((r, i) => {   // the newest of the first kind at the top left of its block
      const c = { name: r.name, set: r.kind + ' · ' + g.label, price: r.price, image: r.image, url: 'https://exorgames.com/products/' + r.handle, variantId: r.variantId, condition: '', foil: false, game: g.game, sealed: true, ar: clamp(Number(r.ar) || 1, .6, 1.5), qty: r.qty };
      const col = c0 + (i % g.cols), row = nr - 1 - Math.floor(i / g.cols), q = seed('seal' + c.name), bw = clamp(bh * c.ar, .14, .212), face = new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide });
      const hgt = Math.min(bw / c.ar, py - .05), m = new THREE.Mesh(new THREE.PlaneGeometry(hgt * c.ar, hgt), face); m.visible = false;
      m.position.set(px / 2 + col * px + (q() - .5) * .012, y0 + row * py + hgt / 2, WZ + .1 + (q() - .5) * .02); m.rotation.y = (q() - .5) * .1; m.userData = { card: c }; sealG.add(m); sealMeshes.push(m); sealed.rows.push(c);
      cardTex(c, 256).then((t) => { if (!m.parent) { t.dispose(); return; } face.map = t; face.needsUpdate = true; m.visible = true; kick(); });
    });
    c0 += g.cols;
  });
  sealHit = hit(bx(sealed.w2 + .1, nr * py + .3, .4, hitM, sealed.x0 + sealed.w2 / 2, y0 + nr * py / 2, WZ + .05), 'sealed');
  lights(S.eve);
}
function loadSealed() {
  if (sealed.loaded) return; sealed.loaded = true;
  fetch(W + '/showcase/sealedwall.json', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || !d.games) { sealed.loaded = false; return; }
    const order = (k) => { const i = ['Booster box', 'Commander deck', 'Elite Trainer Box', 'Bundle', 'Deck', 'Box set', 'Sealed'].indexOf(k); return i < 0 ? 9 : i; };
    d.games.forEach((g) => { g.rows = g.rows.map((r, i) => [r, i]).sort((a, b) => (order(a[0].kind) - order(b[0].kind)) || (a[1] - b[1])).map((x) => x[0]); });
    fonts.then(() => { buildSealed(d.games); if (S.mode === 'boxes') setView(wallView()); kick(); });
  }).catch(() => { sealed.loaded = false; });
}
// straight at the sealed wall from behind the counter: close, so it is moved over (S.sx, S.sy) on any screen
function sealedView() {
  const fov = 62, W_ = sealed.w2 || sealed.w, H_ = sealed.h, fit = Math.max((H_ / 2 + .1) / Math.tan(rad(fov / 2)), (W_ / 2 + .08) / hTan(fov)), d = Math.min(fit, 1.2);
  const vw = 2 * d * hTan(fov), vh = 2 * d * Math.tan(rad(fov / 2)), mx = Math.max(0, (W_ + .16 - vw) / 2), my = Math.max(0, (H_ + .1 - vh) / 2);
  sealed.mx = mx; sealed.my = my; sealed.vw = vw; S.sx = clamp(S.sx || 0, -mx, mx); S.sy = clamp(S.sy == null ? -1e9 : S.sy, -my, my);
  const C = new V3(sealed.x0 + W_ / 2 + S.sx, sealed.y0 + H_ / 2 - .08 + S.sy, WZ + .1);
  return lookView(new V3(C.x, C.y, C.z + d), C, fov);
}
const wallView = () => (S.focus === 'sealed' && sealed.rows.length ? sealedView() : boxesView());
function loadBoxes() {
  const game = S.game; boxes.list = null; buildWall(null);
  fetch(W + '/showcase/boxes.json?game=' + encodeURIComponent(game), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || game !== S.game || !d.boxes || !d.boxes.length) return;
    boxes.list = d; fonts.then(() => { buildWall(d); if (S.mode === 'boxes') setView(wallView()); kick(); });
  }).catch(() => {});
}
function openBox(n) {
  const d = boxes.list, b = d && d.boxes.find((x) => x.n === n); if (!b) return;
  boxes.open = b; $('#setsTitle').textContent = d.label + ' · box ' + b.n + ' · ' + b.label + ' · ' + b.sets.length + ' sets'; $('#setsFind').value = ''; listSets(''); $('#setsv').classList.add('on');
}
function listSets(f) { const b = boxes.open; if (!b) return; const k = f.trim().toLowerCase(); $('#setsList').innerHTML = b.sets.map((nm, i) => (k && nm.toLowerCase().indexOf(k) < 0 ? '' : '<button type="button" class="divider" data-set="' + i + '">' + (setLogo(nm) ? '<img src="' + esc(setLogo(nm)) + '" alt="" loading="lazy" draggable="false">' : '') + '<span>' + esc(nm) + '</span></button>')).join('') || '<div class="empty">No set in this box matches.</div>'; }
function expand(r, setName) { return { name: r[0], set: setName, price: r[2], image: r[3] || null, url: 'https://exorgames.com/products/' + r[1], variantId: r[4] || null, condition: r[5] || '', foil: !!r[6], copies: r[7] || 0, game: S.game, color: null, type: '', text: '' }; }
function openSet(i) {
  const b = boxes.open; if (!b || !b.sets[i]) return; const nm = b.sets[i], seq = ++boxes.seq; boxes.setIdx = i;
  $('#setsTitle').textContent = 'Lifting out ' + nm + '…';
  fetch(W + '/showcase/set.json?game=' + encodeURIComponent(S.game) + '&set=' + encodeURIComponent(nm), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => {
    if (seq !== boxes.seq) return;
    if (!j || !j.ok) { $('#setsTitle').textContent = 'The shop feed did not answer for ' + nm + ' - try again in a minute.'; return; }
    const cards = (j.rows || []).map((r) => expand(r, nm));
    if (!cards.length) { $('#setsTitle').textContent = 'Nothing from ' + nm + ' in stock right now - pick another set.'; return; }
    // four rows when the set fills them, fewer for a small set
    const nl = clamp(Math.ceil(cards.length / 8), 1, 4), per = Math.max(1, Math.ceil(cards.length / nl)), lanes = []; for (let l = 0, at = 0; l < nl && at < cards.length; l++) { let end = l === nl - 1 ? cards.length : Math.min(cards.length, at + per); while (end < cards.length && cards[end].name === cards[end - 1].name) end++; lanes.push(cards.slice(at, end)); at = end; }   // a card's other conditions stay in its row, behind it
    kill(setCrate && setCrate.g); setCrate = makeCrate({ kind: 'set', name: nm, lanes, at: new V3(X1 - .3, TOP + .004, -.9), title: boxes.list.label + ' · ' + nm + ' · ' + cards.length + ' in stock' });
    $('#setsv').classList.remove('on'); enterCrate(setCrate, true);
  }).catch(() => { if (seq === boxes.seq) $('#setsTitle').textContent = 'Could not reach the shop. Try again in a minute.'; });
}

/* ---------- a box you thumb through: the four-row boxes and the bargain bin ----------
   Cards stand in rows leaning back; the one at the front of the row lifts to
   face you, a drag towards you tips it forward onto the pile and the next
   one comes up. Every card is a thin slab; only the few you can see the face
   of carry a picture. */
let cr = null, binCrate = null, setCrate = null, binHit = null;
const LW = .074, A_UP = -.6, A_SHOW = -.72, A_DOWN = 1.2;
// Letter dividers in a set's box (owner, 2026-11-11: "add letter dividers that stick up a little higher in the
// boxes that you can click on and move to that letter"): a taller card where each letter starts, its tab to the
// left, middle or right in turn so several show at once; a tap on a tab thumbs the row to that letter.
const divLetter = (c) => { const m = String(c.name || '').match(/[A-Za-z0-9]/); return m ? (/[0-9]/.test(m[0]) ? '#' : m[0].toUpperCase()) : '#'; };
const geoDiv = keep(new THREE.PlaneGeometry(CW * 1.02, CH * 1.24).translate(0, CH * .62, 0)), divMats = {};
function divMat(ch) {
  if (divMats[ch]) return divMats[ch];
  const slot = (ch === '#' ? 0 : ch.charCodeAt(0) - 64) % 3, t = keep(ctex(128, 220, (g, w, h) => {
    g.clearRect(0, 0, w, h); const top = h * (1 - 1 / 1.24), tw = w * .4, tx = slot * (w - tw) / 2;
    g.fillStyle = '#e9cf7a'; g.fillRect(0, top, w, h - top); rr(g, tx, 2, tw, top + 10, 7); g.fill(); g.fillStyle = '#b8963c'; g.fillRect(0, top, w, 3);
    g.fillStyle = '#2a1c0e'; g.font = '900 ' + Math.round(top * .86) + 'px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, tx + tw / 2, top / 2 + 5);
  }));
  return (divMats[ch] = keep(new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: .5, side: THREE.DoubleSide, color: cardTint })));
}
function makeCrate(o) {
  const n = o.lanes.length, m = Math.max.apply(null, o.lanes.map((l) => l.length)), sp = clamp(.26 / m, .0025, .01), Lz = m * sp + .2, w = n * LW + .012;
  const g = new THREE.Group(); g.position.copy(o.at); scene.add(g);
  const wallM = lam({ color: o.kind === 'bin' ? 0xb08a5a : 0xf1eee4 }), h = .062;
  bx(w, .004, Lz, wallM, 0, .002, 0, g); bx(w, h, .004, wallM, 0, h / 2, Lz / 2, g); bx(w, h, .004, wallM, 0, h / 2, -Lz / 2, g);
  for (let l = 0; l <= n; l++) bx(.004, h, Lz, wallM, -w / 2 + .004 + l * (w - .008) / n, h / 2, 0, g);
  const total = o.lanes.reduce((a, l) => a + l.length, 0), inst = new THREE.InstancedMesh(geoSlab, lam({ color: 0xffffff }), total); g.add(inst);
  const col = new THREE.Color(); let k = 0;
  o.lanes.forEach((ln) => ln.forEach((c) => { const q = seed(keyOf(c) + 'slab')(); col.setRGB(.82 + q * .14, .8 + q * .13, .74 + q * .12); inst.setColorAt(k++, col); }));
  const faces = []; for (let j = 0; j < 6; j++) { const f = new THREE.Mesh(geoB, new THREE.MeshBasicMaterial({ map: phTex, color: cardTint })); f.visible = false; f.userData = { card: true, idx: -1 }; g.add(f); faces.push(f); }
  if (o.kind === 'set' && o.name) {
    const draw = (im) => (gg, ww, hh) => { gg.fillStyle = '#fbf7ec'; gg.fillRect(0, 0, ww, hh); gg.fillStyle = '#c9b98f'; gg.fillRect(0, 0, ww, 12); gg.fillStyle = '#16120d'; gg.textAlign = 'center';
      if (im) { const iw = im.width || 1, ih = im.height || 1, sc = Math.min((ww - 60) / iw, 84 / ih); gg.drawImage(im, (ww - iw * sc) / 2, 24 + (84 - ih * sc) / 2, iw * sc, ih * sc); }
      gg.font = (im ? 26 : 34) + 'px "Permanent Marker", cursive'; wrapText(gg, o.name, ww / 2, im ? 138 : 80, ww - 30, im ? 28 : 38, 2); };
    const t = ctex(320, 180, draw(null)), sgn = pl(Math.min(w, .16), Math.min(w, .16) * 180 / 320, new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }), 0, h + .05, -Lz / 2 - .003, 0, g);
    sgn.rotation.z = -.02; const lu = setLogo(o.name);
    if (lu) loadImg(lu).then((im) => { if (!sgn.parent) return; draw(im)(t.image.getContext('2d'), 320, 180); t.needsUpdate = true; kick(); }).catch(() => {});
  }
  if (o.kind === 'bin') { const s = pl(.13, .075, new THREE.MeshBasicMaterial({ map: ctex(260, 150, (gg, ww, hh) => { gg.fillStyle = '#f7e98e'; gg.fillRect(0, 0, ww, hh); gg.fillStyle = '#c0392b'; gg.font = '40px "Permanent Marker", cursive'; gg.textAlign = 'center'; gg.fillText('BARGAIN BIN', ww / 2, 62); gg.fillStyle = '#16120d'; gg.font = '700 34px Caveat, cursive'; gg.fillText(o.note || '', ww / 2, 112); }), side: THREE.DoubleSide }), 0, .13, -Lz / 2 - .003, 0, g); s.rotation.z = .04; bx(.006, .1, .004, lam({ color: 0x6b4020 }), 0, .08, -Lz / 2 - .006, g); }
  const divs = []; let endSign = null, endTex = null;
  if (o.kind === 'set') { endTex = ctex(256, 352, (gg) => gg.clearRect(0, 0, 256, 352)); endSign = new THREE.Mesh(geoB, new THREE.MeshBasicMaterial({ map: endTex, side: THREE.DoubleSide, color: cardTint })); endSign.userData = { end: true, what: '' }; g.add(endSign); }
  if (o.kind === 'set') o.lanes.forEach((ln, l) => { let prev = ''; ln.forEach((cd, i) => { const ch = divLetter(cd); if (ch !== prev) { prev = ch; if (ln.length > 12 || i) { const m = new THREE.Mesh(geoDiv, divMat(ch)); m.userData = { div: true, lane: l, idx: i, ch }; g.add(m); divs.push(m); } } }); });
  const c = { kind: o.kind, name: o.name || '', title: o.title, lanes: o.lanes, ps: o.lanes.map(() => 0), lane: 0, v: 0, sp, Lz, n, g, inst, faces, divs, endSign, endTex, at: o.at };
  updateCrate(c); return c;
}
// The end of a row (owner, 2026-11-12: "At the end of a row you should be able to flip the last card and then it
// have a part on the back of the row on the box that says go to next row"): in a set's box the last card can be
// flipped down too, and behind it stands a sign - "NEXT ROW", or on the last row "NEXT SET" / "FIRST ROW" - a tap
// on it goes there.
const laneMax = (c, l) => c.lanes[l].length - (c.kind === 'set' ? 0 : 1);
function endWhat(c) { if (c.lane < c.n - 1) return 'row'; const b = boxes.open; return b && boxes.setIdx < b.sets.length - 1 ? 'set' : c.n > 1 ? 'first' : ''; }
function endGo() { const c = cr; if (!c) return; const w = endWhat(c); if (w === 'row') { c.ps[c.lane + 1] = 0; crateLane(1); } else if (w === 'set') openSet(boxes.setIdx + 1); else if (w === 'first') { c.ps[0] = 0; crateLane(-c.lane); } }
const laneX = (c, l) => (l - (c.n - 1) / 2) * (c.n * LW) / c.n;
const baseZ = (c, i) => c.Lz / 2 - .125 - i * c.sp;
function pose(u) {   // u = how far past this card the thumb is: -1 standing, 0 lifted to face you, 1 tipped onto the pile
  const e = (t) => t * t * (3 - 2 * t);
  if (u <= -1) return [A_UP, 0, 0];
  if (u < 0) { const k = e(u + 1); return [lerp(A_UP, A_SHOW, k), .03 * k, .012 * k]; }
  if (u < 1) { const k = e(u); return [lerp(A_SHOW, A_DOWN, k), .03 * (1 - k), lerp(.012, .04, k)]; }
  return [A_DOWN, 0, .04];
}
const dummy = new THREE.Object3D();
function updateCrate(c) {
  let k = 0;
  c.lanes.forEach((ln, l) => { const p = c.ps[l], x = laneX(c, l); for (let i = 0; i < ln.length; i++) { const ps = pose(p - i); dummy.position.set(x, .004 + ps[1], baseZ(c, i) + ps[2]); dummy.rotation.set(ps[0], 0, 0); dummy.updateMatrix(); c.inst.setMatrixAt(k++, dummy.matrix); } });
  c.inst.instanceMatrix.needsUpdate = true;
  (c.divs || []).forEach((m) => { const u = m.userData, ps = pose(c.ps[u.lane] - (u.idx - .5)); m.position.set(laneX(c, u.lane), .004 + ps[1], baseZ(c, u.idx) + c.sp * .5 + ps[2]); m.rotation.set(ps[0], 0, 0); m.visible = c.ps[u.lane] - (u.idx - .5) < .9; });   // a divider you have thumbed past lies under the pile
  if (c.endSign) {   // the sign at the back of the row you are in
    const w = endWhat(c), es = c.endSign; es.visible = !!w; es.position.set(laneX(c, c.lane), .004, baseZ(c, c.lanes[c.lane].length) - .002); es.rotation.set(A_UP, 0, 0);
    if (w && es.userData.what !== w) { es.userData.what = w; const gg = c.endTex.image.getContext('2d'); gg.fillStyle = '#14100e'; gg.fillRect(0, 0, 256, 352); gg.strokeStyle = '#f2c230'; gg.lineWidth = 10; gg.strokeRect(10, 10, 236, 332); gg.textAlign = 'center'; gg.fillStyle = '#fff'; gg.font = '700 30px Inter, sans-serif'; gg.fillText('END OF ROW', 128, 84); gg.fillStyle = '#f2c230'; gg.font = '900 54px Inter, sans-serif'; (w === 'row' ? ['NEXT', 'ROW'] : w === 'set' ? ['NEXT', 'SET'] : ['FIRST', 'ROW']).forEach((t, i) => gg.fillText(t, 128, 170 + i * 58)); gg.font = '900 70px Inter, sans-serif'; gg.fillText(w === 'first' ? '↺' : '▶', 128, 312); c.endTex.needsUpdate = true; }
  }
  const ln = c.lanes[c.lane], p = c.ps[c.lane], k0 = Math.max(0, Math.floor(p)), x = laneX(c, c.lane);
  c.faces.forEach((f) => { f.userData.want = -1; });
  for (let i = k0; i < Math.min(ln.length, k0 + 6); i++) c.faces[i % 6].userData.want = i;
  c.faces.forEach((f) => {
    const i = f.userData.want; if (i < 0) { f.visible = false; return; }
    const ps = pose(p - i), a = ps[0]; f.visible = true; f.position.set(x, .004 + ps[1] - Math.sin(a) * .0006, baseZ(c, i) + ps[2] + Math.cos(a) * .0006); f.rotation.set(a, 0, 0);
    if (f.userData.idx !== i || f.userData.lane !== c.lane) { f.userData.idx = i; f.userData.lane = c.lane; bare(f); wear(f, ln[i], 256); }
  });
  if (c === cr) caption();
}
function crateView(c) {
  const p = c.ps[c.lane], fov = baseFov(), tv = Math.tan(rad(fov / 2)), d = Math.max(CW / (.62 * 2 * tv * cam.aspect), CH / (.46 * 2 * tv)), el = .84;
  const T = new V3(c.at.x + laneX(c, c.lane), c.at.y + .034 + CH * .38, c.at.z + baseZ(c, p) - .012);
  return lookView(new V3(T.x, T.y + d * Math.sin(el), T.z + d * Math.cos(el)), T, fov);
}
function enterCrate(c, drop) {
  cr = c; S.mode = 'crate'; ui(); caption(); glide(crateView(c), 850);
  if (drop && !reduce) { const t0 = performance.now(), y = c.at.y; anims.push((now) => { const k = Math.min(1, (now - t0) / 520), e = 1 - Math.pow(1 - k, 3); c.g.position.y = y + .25 * (1 - e); return k < 1; }); }
  hint(c.kind === 'bin' ? 'Drag towards you to thumb through · tap the card to pick it up' : 'Drag towards you to thumb through · swipe sideways for the next row');
}
function flickTo(p, ms) {
  const c = cr; if (!c) return; const l = c.lane, max = laneMax(c, l), from = c.ps[l], to = clamp(Math.round(p), 0, max), t0 = performance.now(); c.v = 0; c.anim = (c.anim || 0) + 1; const id = c.anim;
  anims.push((now) => { if (c.anim !== id || cr !== c) return false; const k = Math.min(1, (now - t0) / (reduce ? 1 : (ms || 220))), e = 1 - Math.pow(1 - k, 3); c.ps[l] = lerp(from, to, e); updateCrate(c); setView(crateView(c)); return k < 1; }); kick();
}
function crateLane(d) { const c = cr; if (!c) return; const l = clamp(c.lane + d, 0, c.n - 1); if (l === c.lane) return; c.lane = l; c.anim = (c.anim || 0) + 1; updateCrate(c); glide(crateView(c), 380); ui(); }
function caption() {
  const c = cr; if (!c) return; const ln = c.lanes[c.lane];
  if (Math.round(c.ps[c.lane]) >= ln.length) { const w = endWhat(c); $('#capName').textContent = 'End of row ' + (c.lane + 1) + (c.n > 1 ? ' of ' + c.n : ''); $('#capSet').textContent = w === 'row' ? 'tap the sign for the next row' : w === 'set' ? 'that is the whole set · tap the sign for the next set' : w === 'first' ? 'that is the whole set · tap the sign for the first row' : 'that is the whole set'; $('#capBuy').hidden = true; $('#capTip').hidden = true; capCard = null; return; }
  $('#capTip').hidden = false; const i = clamp(Math.round(c.ps[c.lane]), 0, ln.length - 1), k = ln[i];
  $('#capName').textContent = k.name; $('#capSet').textContent = [k.set, condText(k), money(k.price), (i + 1) + ' of ' + ln.length + (c.n > 1 ? ' · row ' + (c.lane + 1) + ' of ' + c.n : '')].filter(Boolean).join(' · ');
  // the quick button (owner, 2026-11-11: "Add an 'set it by the til' quick button here"): the card in front goes to the pile without picking it up
  const b = $('#capBuy'), done = inPile(k); capCard = k; b.hidden = !k.variantId; b.disabled = done; b.textContent = done ? (ON_STORE ? 'In your cart ✓' : 'By the till ✓') : (ON_STORE ? 'Add to cart' : 'Set it by the till');
}
let capCard = null;
function capBuy(b) {
  const c = capCard; if (!c || b.disabled) return; b.disabled = true;
  const done = () => { S.pile.push({ name: c.name, set: c.set, price: c.price, url: c.url, variantId: c.variantId, cond: c.sealed ? 'sealed' : cond(c), foil: c.foil }); if (capCard === c) b.textContent = ON_STORE ? 'In your cart ✓' : 'By the till ✓'; pile(); };
  if (!ON_STORE) { done(); return; }
  b.textContent = 'Adding…';
  fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(c.variantId), quantity: 1, properties: { _xg: 'showcase' } }] }) })
    .then((r) => { if (!r.ok) throw new Error('cart ' + r.status); return r.json(); }).then(() => { done(); if (window.xgImpact) { try { window.xgImpact('showcase', 'add'); } catch (x) {} } })
    .catch(() => { if (capCard === c) { b.textContent = 'Could not add'; setTimeout(() => { if (capCard === c) { b.textContent = 'Add to cart'; b.disabled = false; } }, 2000); } });
}
function buildBin() {
  if (binHit) { hot.splice(hot.indexOf(binHit), 1); kill(binHit); binHit = null; }
  kill(binCrate && binCrate.g); binCrate = null;
  const all = []; S.shelves.forEach((sh) => sh.cards.forEach((c) => all.push(c)));
  let cards = all.filter((c) => Number(c.price) < 25).sort((a, b) => Number(a.price) - Number(b.price)), note = 'under $25';
  if (cards.length < 6) { cards = all.slice().sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 30); note = 'cheapest in the case'; }
  if (!cards.length) return;
  binCrate = makeCrate({ kind: 'bin', lanes: [cards.slice(0, 80)], at: new V3(1.22, TOP + .002, -.9), title: 'Bargain bin · ' + note, note });
  binHit = hit(bx(.14, .2, binCrate.Lz + .04, hitM, 1.22, TOP + .09, -.9), 'bin');
}

/* ---------- the card in your hand ---------- */
const hand = { g: new THREE.Group(), rx: 0, ry: 0, tx: 0, ty: 0, t0: 0, drag: false };
hand.g.visible = false; cam.add(hand.g);
const hm = (o) => new THREE.MeshBasicMaterial(Object.assign({ depthTest: false, depthWrite: false, transparent: true }, o));   // all in the see-through pass, so renderOrder alone decides what is in front
hand.dim = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), hm({ color: 0x050304, opacity: .9 })); hand.dim.position.z = -.5; hand.dim.renderOrder = 990; hand.dim.visible = false; cam.add(hand.dim);
hand.front = new THREE.Mesh(geoC, hm({ map: phTex })); hand.front.renderOrder = 995; hand.g.add(hand.front);
hand.back = new THREE.Mesh(geoC, hm({ map: phTex })); hand.back.rotation.y = PI; hand.back.renderOrder = 995; hand.g.add(hand.back);
const foilT = keep(ctex(256, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); ['#ff5a8a', '#ffd35a', '#6dff9a', '#5ad1ff', '#b07aff', '#ff5a8a'].forEach((c, i) => gr.addColorStop(i / 5, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, [1, 1]));
const glareT = keep(ctex(256, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(.3, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.55)'); gr.addColorStop(.7, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, [1, 1]));
hand.foil = new THREE.Mesh(geoC, hm({ map: foilT, opacity: .16, blending: THREE.AdditiveBlending })); hand.foil.renderOrder = 996; hand.foil.position.z = .0002; hand.g.add(hand.foil);
hand.glare = new THREE.Mesh(geoC, hm({ map: glareT, opacity: .3, blending: THREE.AdditiveBlending })); hand.glare.renderOrder = 997; hand.glare.position.z = .0003; hand.g.add(hand.glare);
fonts.then(() => { hand.sleeveT = keep(ctex(360, 503, drawBack)); hand.back.material.map = hand.sleeveT; hand.back.material.needsUpdate = true; });
function stage() { const w = canvas.clientWidth, h = canvas.clientHeight; return w > 720 ? { x: 0, y: 0, w: w - 360, h } : { x: 0, y: 0, w, h: h - 60 }; }
function placeHand(now) {
  const st = stage(), W_ = canvas.clientWidth, H_ = canvas.clientHeight, d = .24, wpp = 2 * d * Math.tan(rad(cam.fov / 2)) / H_;
  const ar = S.hand.slab ? S.hand.ar || .75 : S.hand.sealed ? S.hand.cut || S.hand.ar || 1 : CW / CH;   // a card, or a booster box in its own shape
  const cwPx = Math.max(140, Math.min(st.w - 24, (st.h - 28) * ar)) * (S.hand.sealed ? .8 : 1), k = reduce ? 1 : Math.min(1, (now - hand.t0) / 320), e = 1 - Math.pow(1 - k, 3);
  hand.g.position.set((st.x + st.w / 2 - W_ / 2) * wpp, -(st.y + st.h / 2 - H_ / 2) * wpp - .05 * (1 - e), -d);
  const sc = .55 + .45 * e; hand.g.scale.set(cwPx * wpp / CW * sc, cwPx / ar * wpp / CH * sc, cwPx * wpp / CW * sc);
  if (!hand.drag) { hand.rx += (hand.tx - hand.rx) * .18; hand.ry += (hand.ty - hand.ry) * .18; }
  hand.g.rotation.set(hand.rx, hand.ry, 0);
  const s = Math.sin(hand.ry) * .6 + hand.rx * .5; hand.foil.material.map.offset.set(s, s * .7); hand.glare.material.map.offset.set(s * .9, 0);
  if (k < 1 || Math.abs(hand.tx - hand.rx) + Math.abs(hand.ty - hand.ry) > .002) kick();
}
function lift(c, src) {
  if (c.sealed && !c.slab && handleOf(c)) return openProduct(c);   // a boxed product opens as its own page
  if (S.handSrc) S.handSrc.visible = true;
  S.hand = c; S.handSrc = src || null; if (src) src.visible = false;
  document.body.dataset.hand = '1'; if (c.slab) document.body.dataset.slab = '1'; else delete document.body.dataset.slab; hand.g.visible = true; hand.dim.visible = true; hand.rx = hand.ry = hand.tx = hand.ty = 0; hand.t0 = performance.now();
  hand.front.material.map = phTex; wear(hand.front, c.slab ? Object.assign({}, c, { plain: true }) : c, c.slab ? 900 : c.sealed ? 640 : 720); hand.foil.visible = !!c.foil;
  const two = !c.sealed || !!c.back;   // a card in its sleeve, or a slab with a photo of its back: two faces; a cut-out box: one, seen from both sides
  hand.back.visible = two; hand.front.material.side = two ? THREE.FrontSide : THREE.DoubleSide; hand.glare.visible = !c.sealed;
  { const old = hand.back.material.map; hand.back.material.map = hand.sleeveT || phTex; if (old && !old.userData.keep) old.dispose(); const tk = hand.backTk = (hand.backTk || 0) + 1;
    if (c.back) { hand.back.material.map = phTex; cardTex({ name: c.name, image: c.back, sealed: true, slab: true, plain: true, noSticker: true, ar: c.ar, price: 0 }, 900).then((t) => { if (hand.backTk !== tk || S.hand !== c) { t.dispose(); return; } hand.back.material.map = t; hand.back.material.needsUpdate = true; kick(); }); }
    hand.back.material.needsUpdate = true; } hand.front.material.needsUpdate = true;   // a cut-out box has no sleeve back and no flat glare
  fillPanel(c); sheet(false); hint(''); askOrientation(); kick();
}
function putBack() {
  if (!S.hand) return; delete document.body.dataset.hand; delete document.body.dataset.slab; hand.g.visible = false; hand.dim.visible = false; bare(hand.front);
  if (S.handSrc) S.handSrc.visible = true; S.hand = null; S.handSrc = null; orientBase = null; kick();
}
let orientBase = null, askedOrient = false;
addEventListener('deviceorientation', (e) => {
  if (reduce || !S.hand || hand.drag || e.beta == null || e.gamma == null) return;
  if (!orientBase) { orientBase = { beta: e.beta, gamma: e.gamma }; return; }
  const back = Math.abs(hand.ty) > PI / 2 ? PI : 0;
  hand.tx = clamp((e.beta - orientBase.beta) * .012, -.3, .3); hand.ty = back + clamp((e.gamma - orientBase.gamma) * .016, -.35, .35); kick();
});
function askOrientation() { if (askedOrient) return; askedOrient = true; try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (x) {} }

/* ---------- the details panel: copies in stock, the buttons, similar cards ---------- */
const STOP = /^(the|a|an|of|to|and|or|you|your|it|its|this|that|for|on|in|is|are|as|at|by|with|from|be|if|then|each|any|all|may|when|whenever|until|end|card|cards|put|into|have|has|can|only|instead|onto|under|up|top|their|they|who|where|other|than|but|not|no|more|less|get|gets|player|players|opponent|opponents|among|would|was|were|do|does|so|those|these|own|his|her|them|itself|choose|chosen|rather|during|beginning|step|phase|next|additional|turn|turns|battlefield|enters|control|controls|target|single)$/;
function toks(c) {
  const t = {}, own = {};
  const add = (w, wt) => { if (w.length < 3 || STOP.test(w)) return; if (w.length > 4 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1); t[w] = (t[w] || 0) + wt; };
  String(c.name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).forEach((w) => { own[w] = 1; add(w, 1.2); });
  String(c.type || '').toLowerCase().split(/[^a-z0-9]+/).forEach((w) => add(w, 2));
  String(c.text || '').toLowerCase().replace(/\{t\}/g, ' tap ').replace(/\{[^}]*\}/g, ' mana ').split(/[^a-z0-9]+/).forEach((w) => { if (!own[w]) add(w, 1); });
  return t;
}
function idf() {
  if (S.idf) return S.idf; const df = {}, all = [];
  S.shelves.forEach((sh) => sh.cards.forEach((o) => { const m = { o, t: toks(o) }; all.push(m); Object.keys(m.t).forEach((w) => { df[w] = (df[w] || 0) + 1; }); }));
  const n = all.length || 1, w = {}; Object.keys(df).forEach((k) => { w[k] = Math.log((n + 1) / (df[k] + .5)); });
  return (S.idf = { w, all });
}
function cosine(a, b, w) { let dot = 0, na = 0, nb = 0, k, x, y; for (k in a) { x = a[k] * (w[k] || 1); na += x * x; if (b[k]) dot += x * b[k] * (w[k] || 1); } for (k in b) { y = b[k] * (w[k] || 1); nb += y * y; } return na && nb ? dot / Math.sqrt(na * nb) : 0; }
function alikeLocal(c) { const I = idf(), tc = toks(c), out = []; I.all.forEach((m) => { if (m.o === c) return; const sc = cosine(tc, m.t, I.w); if (sc >= .15) out.push({ o: m.o, sc }); }); out.sort((a, b) => b.sc - a.sc); return out.slice(0, 8).map((m) => m.o); }
function similar(c) {
  const out = [], pc = Number(c.price) || 0;
  S.shelves.forEach((sh) => sh.cards.forEach((o) => {
    if (o === c || (o.variantId && o.variantId === c.variantId)) return; let sc = 0;
    if (o.color && o.color === c.color) sc += 3; if (o.set && o.set === c.set) sc += 2; if (!!o.foil === !!c.foil) sc += 1; if (hasPhoto(o)) sc += .5;
    const po = Number(o.price) || 0; if (pc > 0 && po > 0) sc -= Math.abs(Math.log(po / pc)) * 1.5; out.push({ o, sc });
  }));
  out.sort((a, b) => b.sc - a.sc); return out.slice(0, 6).map((m) => m.o);
}
let minis = [];
function miniHtml(o) { minis.push(o); return '<button type="button" class="mini" data-mini="' + (minis.length - 1) + '">' + (hasPhoto(o) ? '<img src="' + esc(img(o.image, 240)) + '" alt="" loading="lazy" draggable="false">' : '<span class="noimg">' + esc(o.name) + '</span>') + '<b>' + esc(gunPrice(o.price)) + '</b>' + esc(o.name) + '</button>'; }
const strip = (title, list) => (list.length ? '<h3>' + title + '</h3><div class="minis">' + list.map(miniHtml).join('') + '</div>' : '');
let liftSeq = 0, copiesSeq = 0;
function fillPanel(c) {
  $('#liftName').textContent = c.name; $('#liftSet').textContent = [c.set, condText(c), c.foil ? (c.game === 'pokemon' ? 'Holo' : 'Foil') : '', money(c.price)].filter(Boolean).join(' · ');
  acts(c); minis = [];
  if (c.sealed) { ++liftSeq; ++copiesSeq; $('#liftSet').textContent = (c.slab ? ['Graded card', c.grade, c.ask ? 'price on request' : money(c.price), c.back ? 'drag to turn it over' : ''] : [c.set || 'Sealed', c.qty ? c.qty + ' in stock' : '', money(c.price)]).filter(Boolean).join(' · '); $('#liftCopies').innerHTML = $('#liftCond').innerHTML = $('#liftAlike').innerHTML = $('#liftMore').innerHTML = ''; return; }
  { const lv = wearLevel(c), gd = /near mint|\bnm\b/i.test(String(c.condition || '')) || lv ? COND_GUIDE[lv] : null;
    $('#liftCond').innerHTML = gd ? '<h3>' + esc(gd[0]) + (c.foil ? ' · foil' : '') + '</h3><p>' + esc(gd[1]) + (c.foil && gd[2] ? ' ' + esc(gd[2]) : '') + (lv ? ' <em>The marks drawn on this card illustrate the grade; they are not a picture of this copy.</em>' : '') + ' <a href="https://exorgames.com/pages/grading-guide"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>Grading guide' + (ON_STORE ? '' : ' ↗') + '</a></p>' : ''; }
  loadCopies(c); const seq = ++liftSeq, al = alikeLocal(c), seen = {}; al.forEach((o) => { seen[o.name.toLowerCase()] = 1; });
  $('#liftAlike').innerHTML = strip('Similar effects', al);
  $('#liftMore').innerHTML = strip('More like this', similar(c).filter((o) => !seen[o.name.toLowerCase()]));
  if (c.game === 'mtg') {
    fetch(W + '/showcase/alike.json?game=mtg&name=' + encodeURIComponent(String(c.name).replace(/\s*\([^)]*\)/g, '').trim()), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
      if (seq !== liftSeq || !d || !d.cards || !d.cards.length) return;
      const byName = {}; idf().all.forEach((m) => { byName[m.o.name.toLowerCase()] = m.o; });
      const merged = [], have = {}; have[String(c.name).toLowerCase()] = 1;
      d.cards.forEach((o) => { const k = String(o.name).toLowerCase(); if (have[k]) return; have[k] = 1; merged.push(byName[k] || o); });
      al.forEach((o) => { const k = o.name.toLowerCase(); if (!have[k]) { have[k] = 1; merged.push(o); } });
      $('#liftAlike').innerHTML = strip('Similar effects', merged.slice(0, 8));
    }).catch(() => {});
  }
}
const inPile = (c) => S.pile.some((p) => String(p.variantId) === String(c.variantId) && p.name === c.name);
function acts(c) {
  if (c.ask) {   // not priced: the button writes to the shop (owner, 2026-11-10), the card's name and link already in the email
    const body = 'Hi Exor Games,\n\nI would like to ask about this graded card:\n\n' + c.name + '\n' + c.url + '\n\n';
    $('#liftActs').innerHTML = '<a class="buy" href="mailto:customerservice@exorgames.com?subject=' + encodeURIComponent('Question about: ' + c.name) + '&body=' + encodeURIComponent(body) + '">Ask about this card</a>'
      + '<a href="' + esc(c.url) + '"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>' + (ON_STORE ? 'See the listing' : 'Open on exorgames.com ↗') + '</a>';
    return;
  }
  const done = inPile(c);
  $('#liftActs').innerHTML = (c.variantId ? '<button type="button" class="buy" id="buy"' + (done ? ' disabled' : '') + '>' + (done ? (ON_STORE ? 'In your cart ✓' : 'By the till ✓') : (ON_STORE ? 'Add to cart' : 'Set it by the till')) + '</button>' : '')
    + '<a href="' + esc(c.url) + '"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>' + (ON_STORE ? 'See the listing' : 'Open on exorgames.com ↗') + '</a>';
}
const handleOf = (c) => { const m = /\/products\/([a-z0-9-]+)/i.exec(String(c.url || '')); return m ? m[1] : ''; };
function loadCopies(c) {
  const box = $('#liftCopies'); box.innerHTML = ''; const h = handleOf(c); if (!h) return; const seq = ++copiesSeq;
  fetch(W + '/showcase/card.json?handle=' + encodeURIComponent(h), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (seq !== copiesSeq || !d || !d.ok || !d.copies) return; c.copies = d.copies;
    if (d.copies.length <= 1) { box.innerHTML = d.copies.length ? '<div class="one">The only copy in stock: ' + esc([d.copies[0].condition, d.copies[0].foil ? 'foil' : '', money(d.copies[0].price)].filter(Boolean).join(' · ')) + '</div>' : ''; return; }
    box.innerHTML = '<h3>In stock · ' + d.copies.length + ' kinds</h3><div class="cps">' + d.copies.map((k, i) => '<button type="button" class="cp' + (String(k.variantId) === String(c.variantId) ? ' on' : '') + '" data-copy="' + i + '"><b>' + esc(cond({ condition: k.condition }) || k.condition) + '</b>' + (k.foil ? '<i>' + (c.game === 'pokemon' ? 'Holo' : 'foil') + '</i>' : '') + '<span>' + money(k.price) + '</span>' + (k.qty ? '<small>×' + k.qty + '</small>' : '') + '</button>').join('') + '</div>';
  }).catch(() => {});
}
function pickCopy(i) {
  const c = S.hand, k = c && c.copies && c.copies[i]; if (!k) return;
  c.variantId = k.variantId; c.price = k.price; c.condition = k.condition; c.foil = !!k.foil;
  $('#liftSet').textContent = [c.set, condText(c), c.foil ? (c.game === 'pokemon' ? 'Holo' : 'Foil') : '', money(c.price)].filter(Boolean).join(' · ');
  document.querySelectorAll('#liftCopies .cp').forEach((el, j) => el.classList.toggle('on', j === i));
  acts(c); wear(hand.front, c, 720); hand.foil.visible = !!c.foil; if (S.handSrc && S.handSrc.userData.si != null) wear(S.handSrc, c, 256);
}
function buy(b) {
  const c = S.hand; if (!c || b.disabled) return; b.disabled = true;
  const done = () => { S.pile.push({ name: c.name, set: c.set, price: c.price, url: c.url, variantId: c.variantId, cond: c.sealed ? 'sealed' : cond(c), foil: c.foil }); b.textContent = ON_STORE ? 'In your cart ✓' : 'By the till ✓'; pile(); };
  if (!ON_STORE) { done(); return; }
  b.textContent = 'Adding…';
  fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(c.variantId), quantity: 1, properties: { _xg: 'showcase' } }] }) })
    .then((r) => { if (!r.ok) throw new Error('cart ' + r.status); return r.json(); })
    .then(() => { done(); if (window.xgImpact) { try { window.xgImpact('showcase', 'add'); } catch (x) {} } })
    .catch(() => { b.textContent = 'Could not add'; setTimeout(() => { b.textContent = 'Add to cart'; b.disabled = false; }, 2000); });
}
// What you have picked sits in a pile beside the till.
/* The till shows what the pile comes to AFTER TAX (owner, 2026-11-12: "TIL should show the after tax price of the
   products set aside"). The shop's prices are before tax (Shopify: taxesIncluded false) and the shop is in
   Charlottetown, Prince Edward Island, where the sales tax is HST at 15%: that is what a sale at this counter
   adds. An order shipped to another province is taxed at that province's rate at checkout - the sheet says so. */
const TAX = { rate: .15, name: 'HST', where: 'PEI' };
let tillT = null;
const pileSum = () => S.pile.reduce((a, p) => a + (Number(p.price) || 0), 0), withTax = (n) => Math.round(n * (1 + TAX.rate) * 100) / 100;
function drawTill(g, total) { g.fillStyle = '#0d1a0d'; g.fillRect(0, 0, 140, 35); g.fillStyle = '#5dff7a'; const t = total.toFixed(2); g.font = '700 ' + (t.length > 7 ? 19 : 26) + 'px "Cutive Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText(t, 132, 27); }
function pile() {
  if (tillT) { drawTill(tillT.image.getContext('2d'), withTax(pileSum())); tillT.needsUpdate = true; }
  while (pileG.children.length) pileG.remove(pileG.children[0]);
  S.pile.slice(0, 14).forEach((p, i) => { const q = seed(p.name + i), m = new THREE.Mesh(geoSlab, lam({ color: 0xd7dfe2 })); m.rotation.set(-PI / 2, 0, (q() - .5) * .7); m.position.set((q() - .5) * .012, .001 + i * .0022, CH / 2 + (q() - .5) * .012); m.scale.z = 3; pileG.add(m); });
  const n = $('#pileN'); n.hidden = !S.pile.length; n.textContent = S.pile.length; kick();
}
function showTill() {
  const sum = pileSum(), total = withTax(sum), cash = (n) => '$' + n.toFixed(2);
  $('#tillList').innerHTML = S.pile.length ? S.pile.map((p, i) => '<div class="trow"><span>' + esc(p.name) + '<small>' + esc([p.set, p.cond, p.foil ? 'foil' : ''].filter(Boolean).join(' · ')) + '</small></span><b>' + money(p.price) + '</b>' + (ON_STORE ? '' : '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">open ↗</a><button type="button" data-drop="' + i + '" aria-label="Take it off the pile">×</button>') + '</div>').join('') : '<div class="empty">Nothing by the till yet. Pick a card up from the case, a box or the bin and set it here.</div>';
  $('#tillFoot').innerHTML = S.pile.length ? '<div class="tsum"><span>' + S.pile.length + ' item' + (S.pile.length === 1 ? '' : 's') + ' · subtotal</span><b>' + cash(sum) + '</b><span>' + TAX.name + ' ' + Math.round(TAX.rate * 100) + '% (' + TAX.where + ')</span><b>' + cash(total - sum) + '</b><span class="tot">Total after tax</span><b class="tot">' + cash(total) + '</b></div><span class="tnote">Tax as charged at the counter in Charlottetown. Orders shipped to another province are taxed at that province’s rate at checkout.</span>' + (ON_STORE ? '<a href="/cart">Go to your cart</a>' : '<span style="color:var(--muted)">This is the preview: on exorgames.com these go into the cart.</span>') : '';
  $('#tillv').classList.add('on');
}

/* ---------- where you stand ---------- */
/* ---------- asking at the counter (owner, 2026-11-11) ----------
   "Add a section here that alludes to asking the shop employee for a card.. if the card comes up we have in
   stock, make them on top loader plastic cases in a virtual hand and as you scroll through the instore copies
   it is like you are fanning through the results in top loaders".
   A note at the top of the screen takes a card's name. You are walked to the till, the person there "checks"
   (/showcase/find.json: the shop's own in-stock search for the game on the tab), and every copy found comes
   back as a top loader in a fan held in front of you: swipe (or arrows, or the wheel) fans through them, the
   one in the middle stands up; tap it to take it in the hand as any card, or use the quick button for the
   till. A card's copies come best condition first, the card asked for by name before near matches. */
const fan = { g: new THREE.Group(), rows: [], p: 0, live: new Map(), q: '', seq: 0 };
fan.g.visible = false; cam.add(fan.g);
fan.dim = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), hm({ color: 0x050304, opacity: .8 })); fan.dim.position.z = -.5; fan.dim.renderOrder = 940; fan.g.add(fan.dim);
function askFor(q) {
  q = String(q || '').replace(/\s+/g, ' ').trim(); if (q.length < 2) { hint('Type at least two letters of the card\'s name'); return; }
  if (S.hand) putBack(); if (S.mode !== 'ask') { fan.from = { mode: S.mode, cr: S.mode === 'crate' ? cr : null, focus: S.focus }; go('till'); } $('#tillv').classList.remove('on'); askClear(); S.mode = 'ask'; fan.q = q; const seq = ++fan.seq; ui(); glide(tillView(), 700);
  hint('“' + q + '? Let me check what we have…”');
  fetch(W + '/showcase/find.json?game=' + encodeURIComponent(S.game || 'mtg') + '&q=' + encodeURIComponent(q), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (seq !== fan.seq || S.mode !== 'ask') return;
    if (!d || !d.ok) { hint('“Sorry, I could not look that up just now - ask me again in a minute.”'); askBar(); return; }
    fan.rows = (d.rows || []).map((r) => expand(r, r[8] || '')); fan.p = 0;
    hint(fan.rows.length ? '“Here' + (fan.rows.length === 1 ? ' is the one copy' : ' are the ' + fan.rows.length + ' copies') + ' we have. Swipe to fan through them.”' : '“Sorry, nothing called ' + q + ' in stock right now.”');
    askBar(); kick();
  }).catch(() => { if (seq === fan.seq) hint('“Sorry, I could not look that up just now - ask me again in a minute.”'); });
}
// Back from the counter: to where you were when you asked, the box you had open still open at its card
// (owner, 2026-11-11: "When you press back from the worker search results it should go back to the place you were")
function askLeave() {
  const f = fan.from || {}; fan.from = null; askClear(); document.body.dataset.fan = '';
  if (f.mode === 'crate' && f.cr && f.cr.g && f.cr.g.parent) { S.mode = 'door'; enterCrate(f.cr); return; }
  go(f.mode === 'boxes' ? (f.focus === 'sealed' ? 'sealed' : 'boxes') : f.mode === 'case' || f.mode === 'till' ? f.mode : 'door');
}
function askClear() { fan.seq++; fan.live.forEach((m) => { const t = m.material.map; if (t && !t.userData.keep) t.dispose(); m.material.dispose(); fan.g.remove(m); }); fan.live.clear(); fan.rows = []; fan.p = 0; fan.g.visible = false; }
function askBar() {
  const n = fan.rows.length, i = clamp(Math.round(fan.p), 0, Math.max(0, n - 1)), k = fan.rows[i];
  $('#askTtl').textContent = n ? '“' + fan.q + '” · ' + n + (n === 1 ? ' copy' : ' copies') + ' in stock' : '“' + fan.q + '”';
  if (!k) { $('#capName').textContent = ''; $('#capSet').textContent = ''; $('#capBuy').hidden = true; document.body.dataset.fan = ''; return; }
  document.body.dataset.fan = '1'; $('#capName').textContent = k.name; $('#capSet').textContent = [k.set, condText(k), k.foil ? 'Foil' : '', money(k.price), (i + 1) + ' of ' + n].filter(Boolean).join(' · ');
  const b = $('#capBuy'), done = inPile(k); capCard = k; b.hidden = !k.variantId; b.disabled = done; b.textContent = done ? (ON_STORE ? 'In your cart ✓' : 'By the till ✓') : (ON_STORE ? 'Add to cart' : 'Set it by the till');
}
// the fan, laid out each frame it is up: the cards turn about a point below the hand, the middle one raised
function placeFan() {
  const on = S.mode === 'ask' && fan.rows.length > 0 && !S.hand; fan.g.visible = on; if (!on) return;
  const W_ = canvas.clientWidth, H_ = canvas.clientHeight, d = .3, wpp = 2 * d * Math.tan(rad(cam.fov / 2)) / H_, hPx = Math.min(H_ * .44, W_ * .6 / (CW / CH)), sc = hPx * wpp / CH, R = hPx * wpp * 1.7, n = fan.rows.length, mid = Math.round(fan.p);
  fan.cardPx = hPx * CW / CH;
  for (let i = Math.max(0, mid - 5); i <= Math.min(n - 1, mid + 5); i++) if (!fan.live.has(i)) { const m = new THREE.Mesh(geoC, hm({ map: phTex })); m.userData = { card: fan.rows[i], fi: i }; fan.g.add(m); fan.live.set(i, m); wear(m, fan.rows[i], 512); }
  fan.live.forEach((m, i) => {
    if (Math.abs(i - mid) > 6) { const t = m.material.map; if (t && !t.userData.keep) t.dispose(); m.material.dispose(); fan.g.remove(m); fan.live.delete(i); return; }
    const o = i - fan.p, a = clamp(o * .27, -1.25, 1.25), up = Math.max(0, 1 - Math.abs(o)), s = sc * (1 + .1 * up);
    m.position.set(Math.sin(a) * R, (Math.cos(a) - 1) * R + .012 + up * .012, -d); m.rotation.set(0, 0, -a); m.scale.set(s, s, s); m.renderOrder = 980 - Math.round(Math.abs(o) * 4); m.visible = Math.abs(o) < 4.6;
  });
}
function fanTo(i, ms) { const from = fan.p, to = clamp(i, 0, Math.max(0, fan.rows.length - 1)), t0 = performance.now(), id = fan.walk = (fan.walk || 0) + 1; anims.push((now) => { if (fan.walk !== id || S.mode !== 'ask' || drag) return false; const k = Math.min(1, (now - t0) / (reduce ? 1 : ms || 220)), e = 1 - Math.pow(1 - k, 3); fan.p = lerp(from, to, e); askBar(); return k < 1; }); kick(); }
function fanTap(x, y) { const h = pick(Array.from(fan.live.values()).filter((m) => m.visible).sort((a, b) => b.renderOrder - a.renderOrder), x, y); if (!h) return; let top = h.object; fan.live.forEach((m) => { if (m.visible && m !== top && m.renderOrder > top.renderOrder && pick([m], x, y)) top = m; }); const i = top.userData.fi; if (i === Math.round(fan.p)) lift(top.userData.card, null); else fanTo(i); }
// In an open box the note is folded to a small button so the letter tabs show (owner, 2026-11-12: "The ask part
// covers the letters"); a tap unfolds it for typing, and it folds again when left empty.
document.addEventListener('submit', (e) => { if (e.target && e.target.id === 'askBar') { e.preventDefault(); const bar = $('#askBar'), inp = $('#askQ'); if (S.mode === 'crate' && !bar.classList.contains('open')) { bar.classList.add('open'); inp.focus(); return; } bar.classList.remove('open'); askFor(inp.value); inp.blur(); } });
document.addEventListener('focusout', (e) => { if (e.target && e.target.id === 'askQ') setTimeout(() => { if (document.activeElement !== $('#askQ') && !$('#askQ').value.trim()) $('#askBar').classList.remove('open'); }, 250); });

/* ---------- a product's own page (owner, 2026-11-11) ----------
   "When clicking on a product on the shelves I should be able to zoom in on the photos and swipe left to right
   to look at any other of the photos for that product. That view should be less like card singles and more
   website looking once you click the product as there is more info and photos to view".
   A boxed product taken off a shelf (the aisles, the booster-box shelf) opens as a page over the shop, not as
   a card in the hand: a gallery of every photo (swipe, thumbnails, arrow keys), a tap on a photo zooms in on
   that spot (drag to move, tap to close), then the name, vendor, price, stock, variants, the button for the
   till / cart, the link to the listing and the description (/showcase/product.json). Graded slabs and card
   singles still come to the hand. */
const prod = { c: null, d: null, v: null };
function openProduct(c) {
  prod.c = c; prod.d = null; prod.v = null; $('#prodv').classList.add('on'); hint(''); prodDraw();
  const h = handleOf(c);
  fetch(W + '/showcase/product.json?handle=' + encodeURIComponent(h), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (prod.c !== c || !d || !d.ok) return; prod.d = d; prod.v = d.variants.find((v) => String(v.id) === String(c.variantId)) || d.variants[0] || null; prodDraw();
  }).catch(() => {});
}
function closeProduct() { if (zoomOff()) return; $('#prodv').classList.remove('on'); prod.c = null; kick(); }
function prodDraw() {
  const c = prod.c, d = prod.d, v = prod.v; if (!c) return;
  const photos = d && d.photos.length ? d.photos : (hasPhoto(c) ? [{ url: c.image, ar: c.ar || 1 }] : []), price = v ? v.price : c.price, qty = v ? v.qty : c.qty, vid = v ? v.id : c.variantId;
  const done = S.pile.some((p) => String(p.variantId) === String(vid));
  $('#prodCrumb').textContent = c.set || '';
  $('#prodBody').innerHTML = '<div class="pgalw"><div class="pgal" id="pgal">' + (photos.length ? photos.map((ph, i) => '<button type="button" class="pshot" data-zoom="' + i + '"><img src="' + esc(img(ph.url, 1000)) + '" alt="' + esc((d ? d.title : c.name) + ' - photo ' + (i + 1)) + '"' + (i ? ' loading="lazy"' : '') + '></button>').join('') : '<div class="pshot none">No photo yet</div>') + '</div>'
    + (photos.length > 1 ? '<span class="pcount" id="pcount">1 / ' + photos.length + '</span><div class="pthumbs">' + photos.map((ph, i) => '<button type="button" data-shot="' + i + '"' + (i ? '' : ' class="on"') + '><img src="' + esc(img(ph.url, 160)) + '" alt=""></button>').join('') + '</div>' : '') + (photos.length ? '<p class="ptip">Tap a photo to zoom in' + (photos.length > 1 ? ' · swipe for more' : '') + '</p>' : '') + '</div>'
    + '<div class="pinfo"><h1>' + esc(d ? d.title : c.name) + '</h1>' + (d && (d.vendor || d.type) ? '<p class="pmeta">' + esc([d.type, d.vendor].filter(Boolean).join(' · ')) + '</p>' : '')
    + '<p class="pprice">' + money(price) + (v && v.was ? ' <s>' + money(v.was) + '</s>' : '') + '</p>' + (qty > 0 ? '<p class="pstock">' + (qty > 5 ? 'In stock' : qty + ' in stock') + '</p>' : '')
    + (d && d.variants.length > 1 ? '<div class="pvars">' + d.variants.map((x, i) => '<button type="button" data-pvar="' + i + '"' + (x === v ? ' class="on"' : '') + '>' + esc(x.title || 'Option ' + (i + 1)) + ' · ' + money(x.price) + '</button>').join('') + '</div>' : '')
    + '<div class="pacts">' + (vid ? '<button type="button" class="buy" id="pbuy2"' + (done ? ' disabled' : '') + '>' + (done ? (ON_STORE ? 'In your cart ✓' : 'By the till ✓') : (ON_STORE ? 'Add to cart' : 'Set it by the till')) + '</button>' : '')
    + '<a href="' + esc(c.url) + '"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>' + (ON_STORE ? 'See the full listing' : 'Open on exorgames.com ↗') + '</a></div>'
    + (d ? (d.text ? '<h2>About this product</h2>' + d.text.split('\n').map((l) => (l ? '<p>' + esc(l) + '</p>' : '')).join('') : '') : '<p class="pwait">Fetching the rest of the photos and details…</p>') + '</div>';
  $('#prodBody').scrollTop = 0; prod.photos = photos;
  const gal = $('#pgal'); if (gal) gal.addEventListener('scroll', () => { const i = Math.round(gal.scrollLeft / Math.max(1, gal.clientWidth)); if ($('#pcount')) $('#pcount').textContent = (i + 1) + ' / ' + photos.length; document.querySelectorAll('.pthumbs button').forEach((b, k) => b.classList.toggle('on', k === i)); }, { passive: true });
}
function prodShot(i) { const gal = $('#pgal'); if (gal) gal.scrollTo({ left: clamp(i, 0, (prod.photos || []).length - 1) * gal.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); }
function prodBuy(b) {
  const c = prod.c, d = prod.d, v = prod.v; if (!c || b.disabled) return; b.disabled = true;
  const vid = v ? v.id : c.variantId, name = (d ? d.title : c.name) + (v && v.title ? ' - ' + v.title : '');
  const done = () => { S.pile.push({ name, set: c.set, price: v ? v.price : c.price, url: c.url, variantId: vid, cond: 'sealed', foil: false }); b.textContent = ON_STORE ? 'In your cart ✓' : 'By the till ✓'; pile(); };
  if (!ON_STORE) { done(); return; }
  b.textContent = 'Adding…';
  fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(vid), quantity: 1, properties: { _xg: 'showcase' } }] }) })
    .then((r) => { if (!r.ok) throw new Error('cart ' + r.status); return r.json(); }).then(() => { done(); if (window.xgImpact) { try { window.xgImpact('showcase', 'add'); } catch (x) {} } })
    .catch(() => { b.textContent = 'Could not add'; setTimeout(() => { b.textContent = 'Add to cart'; b.disabled = false; }, 2000); });
}
// the zoom: the photo two and a half times the screen, the spot you tapped under your finger; drag to move, tap to close
function zoomOn(i, ex, ey, box) {
  const ph = typeof i === 'object' ? i : (prod.photos || [])[i]; if (!ph) return; const z = $('#zoomv'), im = $('#zoomImg'), sc = $('#zoomIn');
  const fx = box ? clamp((ex - box.left) / Math.max(1, box.width), 0, 1) : .5, fy = box ? clamp((ey - box.top) / Math.max(1, box.height), 0, 1) : .5;
  z.classList.add('on'); im.src = img(ph.url, 2000); const vw = sc.clientWidth, vh = sc.clientHeight, fit = Math.min(vw / ph.ar, vh), h = fit * 2.6, w = h * ph.ar;
  im.style.width = w + 'px'; im.style.height = h + 'px'; sc.scrollLeft = fx * w - vw / 2; sc.scrollTop = fy * h - vh / 2;
}
// A slab in the hand can be looked at close (owner, 2026-11-12: "I should be able to zoom in on the slab"): the
// Zoom button or a pinch opens the photo of the face you are looking at, large, to drag about.
function slabZoom() {
  const c = S.hand; if (!c || !c.slab) return false; const back = c.back && Math.abs(Math.round(hand.ty / PI)) % 2 === 1;
  zoomOn({ url: back ? c.back : c.image, ar: c.ar || .75 }, 0, 0, null); return true;
}
function zoomOff() { const z = $('#zoomv'); if (!z.classList.contains('on')) return false; z.classList.remove('on'); $('#zoomImg').removeAttribute('src'); return true; }
// a mouse has no finger to pan with: dragging moves the zoomed photo, and a drag is not the tap that closes it
let zdrag = null;
document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.target.closest('#zoomv')) { const sc = $('#zoomIn'); zdrag = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop, moved: false }; e.preventDefault(); } });
document.addEventListener('pointermove', (e) => { if (!zdrag) return; const dx = e.clientX - zdrag.x, dy = e.clientY - zdrag.y; if (Math.abs(dx) + Math.abs(dy) > 5) zdrag.moved = true; const sc = $('#zoomIn'); sc.scrollLeft = zdrag.l - dx; sc.scrollTop = zdrag.t - dy; });
document.addEventListener('click', (e) => {
  if (e.target.closest('#zoomv')) { const moved = zdrag && zdrag.moved; zdrag = null; if (!moved) zoomOff(); return; }
  const b = e.target.closest('#prodv button'); if (!b) return;
  if (b.hasAttribute('data-zoom')) { const im = b.querySelector('img'); zoomOn(Number(b.getAttribute('data-zoom')), e.clientX, e.clientY, im ? im.getBoundingClientRect() : null); }
  else if (b.hasAttribute('data-shot')) prodShot(Number(b.getAttribute('data-shot')));
  else if (b.hasAttribute('data-pvar')) { prod.v = prod.d.variants[Number(b.getAttribute('data-pvar'))]; const g = $('#pgal'), x = g ? g.scrollLeft : 0; prodDraw(); if ($('#pgal')) $('#pgal').scrollLeft = x; }
  else if (b.id === 'pbuy2') prodBuy(b);
  else if (b.id === 'prodX') closeProduct();
});

/* ---------- the graded cabinet (owner, 2026-11-10) ----------
   "a tall glass showcase (the kind that opens at the front with a lock) that you can put graded cards in ...
   auto delete the white background of the graded card image ... take it out of showcase and flip it over to
   see the back", then "Fill it with all graded cards" and "$999,999 says to ask which opens an email".
   On the left wall by the door: every graded card in stock (/showcase/graded.json) stands on its glass
   shelves cut out of its photo, the ones to ask about first, then the dearest down. Walking up unlocks it
   and the doors swing open; a tap takes a slab out, a drag turns it over to the photo of its back. */
const gcab = { at: [-4, 1.85], w: 2.9, h: 2.02, g: null, doors: [], meshes: [], rows: [], open: 0, gx: 0, gy: 0, queued: false };
function buildCabinet() {
  const g = gcab.g = new THREE.Group(); g.position.set(gcab.at[0], 0, gcab.at[1]); g.rotation.y = PI / 2; scene.add(g);
  const W_ = gcab.w, H_ = gcab.h, wood = darkWoodM, glassShelf = new THREE.MeshBasicMaterial({ color: 0xcfe6f5, transparent: true, opacity: .22, depthWrite: false });
  bx(W_, .2, .42, wood, 0, .1, .21, g); bx(W_, .07, .42, wood, 0, H_ - .035, .21, g); bx(W_, H_, .02, lam({ color: 0xece5d3, emissive: 0x2a2620 }), 0, H_ / 2, .01, g);
  bx(.04, H_, .42, wood, -W_ / 2 + .02, H_ / 2, .21, g); bx(.04, H_, .42, wood, W_ / 2 - .02, H_ / 2, .21, g);
  bx(W_ - .1, .02, .03, new THREE.MeshBasicMaterial({ color: 0xfff4d6 }), 0, H_ - .085, .36, g);                    // the strip light under the top
  gcab.levels = [1.6, 1.3, 1.0, .7, .4, .22].slice(0, 6); gcab.levels.forEach((y, i) => { if (i < 5) bx(W_ - .08, .008, .34, glassShelf, 0, y - .004, .2, g); });
  pl(.7, .1, new THREE.MeshBasicMaterial({ map: ctex(700, 100, (c, w, h) => { c.fillStyle = '#16100c'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2c230'; c.font = '900 58px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GRADED CARDS', w / 2, h / 2 + 2); }) }), 0, H_ + .06, .2, 0, g);
  // two glass doors hinged at the sides, a lock where they meet
  [-1, 1].forEach((sd) => {
    const d = new THREE.Group(); d.position.set(sd * (W_ / 2 - .02), 0, .42); g.add(d); gcab.doors.push(d); d.userData.sd = sd;
    const dw = W_ / 2 - .03; pl(dw, H_ - .3, glassM, -sd * dw / 2, .2 + (H_ - .3) / 2, 0, 0, d);
    bx(dw, .03, .02, wood, -sd * dw / 2, .215, 0, d); bx(dw, .03, .02, wood, -sd * dw / 2, H_ - .085, 0, d); bx(.025, H_ - .3, .02, wood, -sd * (dw - .012), .2 + (H_ - .3) / 2, 0, d);
    if (sd > 0) bx(.035, .05, .03, lam({ color: 0xd0a63c, emissive: 0x3a2a08 }), -sd * (dw - .012), 1.02, .012, d);   // the lock
  });
  hit(bx(.5, H_, W_, hitM, gcab.at[0] + .25, H_ / 2, gcab.at[1]), 'graded');
}
function loadGraded() {
  return fetch(W + '/showcase/graded.json', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || !d.rows || !gcab.g) return;
    gcab.rows = d.rows.map((r) => ({ name: r.name, set: 'Graded card', price: r.price, image: r.front, back: r.back, url: 'https://exorgames.com/products/' + r.handle, variantId: r.variantId, condition: '', foil: false, game: 'graded', sealed: true, slab: true, ask: !!r.ask, grade: r.grade, ar: clamp(Number(r.ar) || .75, .55, 1), qty: 1 }));
    const n = gcab.rows.length, per = Math.max(8, Math.ceil(n / 5)), pitch = (gcab.w - .14) / per, sh = Math.min(.24, pitch / .78);   // five shelves; the slabs as big as the row allows
    gcab.rows.forEach((c, i) => {
      const row = Math.floor(i / per), col = i % per, q = seed('slab' + c.name), hgt = sh, bw = hgt * c.ar;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, hgt), new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide })); m.visible = false;
      m.position.set(-gcab.w / 2 + .07 + (col + .5) * pitch, gcab.levels[Math.min(row, 4)] + hgt / 2 + .006, .2 + (q() - .5) * .02); m.rotation.set(-.1, (q() - .5) * .1, 0); m.userData = { card: c }; gcab.g.add(m); gcab.meshes.push(m);
    });
    $('#gradedN').textContent = n; $('#gradedN').hidden = !n;
    stockCabinet();   // straight away: from the door an unstocked cabinet looks empty (owner, 2026-11-10)
  }).catch(() => {});
}
// the slabs' pictures arrive a few at a time, the first time you walk up
function stockCabinet() {
  if (gcab.queued) return; gcab.queued = true; let k = 0;
  const next = () => { const m = gcab.meshes[k++]; if (!m) return; cardTex(m.userData.card, 256).then((t) => { const c = m.userData.card; if (c.cut) m.scale.x = c.cut / c.ar; m.material.map = t; m.material.needsUpdate = true; m.visible = true; kick(); }).catch(() => {}).then(next); };
  for (let i = 0; i < 5; i++) next();
}
function cabinetDoors(open) {
  const to = open ? 1 : 0; if (gcab.target === to) return; gcab.target = to; const from = gcab.open, t0 = performance.now();
  if (open) click2();
  anims.push((now) => { if (gcab.target !== to) return false; const k = Math.min(1, (now - t0) / (reduce ? 1 : 700)), e = 1 - Math.pow(1 - k, 3); gcab.open = lerp(from, to, e); gcab.doors.forEach((d) => { d.rotation.y = d.userData.sd * gcab.open * 1.95; }); return k < 1; }); kick();
}
function click2() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime; [0, .09].forEach((dt, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = i ? 900 : 1500; g.gain.setValueAtTime(.06, t + dt); g.gain.exponentialRampToValueAtTime(.0001, t + dt + .05); o.connect(g); g.connect(ac.destination); o.start(t + dt); o.stop(t + dt + .06); }); } catch (x) {} }
// straight at the cabinet: a wide screen takes the whole of it, a phone stands closer and pans
function gradedView() {
  const fov = 70, ph = cam.aspect < 1, fit = Math.max((gcab.h / 2 + .1) / Math.tan(rad(fov / 2)), (gcab.w / 2 + .08) / hTan(fov)), d = ph ? Math.min(fit, 1.25) : fit;
  const vw = 2 * d * hTan(fov), vh = 2 * d * Math.tan(rad(fov / 2)), mx = Math.max(0, (gcab.w + .1 - vw) / 2), my = Math.max(0, (gcab.h + .1 - vh) / 2);
  gcab.mx = mx; gcab.my = my; gcab.vw = vw; gcab.gx = clamp(gcab.gx, -mx, mx); gcab.gy = clamp(gcab.gy, -my, my);
  const C = new V3(gcab.at[0] + .2, gcab.h / 2 + gcab.gy, gcab.at[1] - gcab.gx);
  return lookView(new V3(C.x + d, C.y, C.z), C, fov);
}

/* ---------- the hall of aisles (owner, 2026-11-10) ----------
   "make the store much larger so we can display all our product on the shelves for gunpla, figures, board
   games, etc.. where you have headers above the aisles and ... scroll through all the products we have in
   stock. Have signage above the aisles (double sided) that you can walk under into the aisles and see as
   far down as you need to ... exor games branded ... at the right of the counter".
   The right wall opens at the front into a hall of aisles, one per kind of product (/showcase/aisles.json).
   Each aisle is shelved in signed sections, the way a shop does it ("Sort of like how they would be in real
   life in a store"): the newest arrivals by the entrance, then each product line under its own sign.
   You browse an aisle the way you browse the glass case ("I still find aisles feel clunky and unnatural" of
   the first build, which had a look-ahead view and a turn to each side): always facing a shelf, one sideways
   swipe walks you along it; at the far end you turn and come back up the other side, so the whole aisle is one
   ribbon read left to right. Every slot holds a plain box from the start; the ones in front of you become the
   products themselves (photo cut out, price sticker), read a page at a time (/showcase/aisle.json). */
const hall = { list: [], built: false, x0: 4, zf: -.5,   /* the shelving starts well back from the front of the hall (owner, 2026-11-11: "they need to be back further so we can see them" - the paint racks on its ends) */ pitch: 2.9, lv: [1.71, 1.40, 1.09, .78, .47, .16], colW: .3, T: 1.5, d0: .55 };
// (owner, 2026-11-11: "I don't want the shelving to be right at the opening I want an aisle First", then, of the
// dressed shelf that stood there, "There should be no fake product aisle like this one it should be product right
// away"): the FIRST AISLE is the walkway along the shop's open side. It has one shelf, the one facing the shop,
// holding all of its products (a.flip: its ribbon runs the other way across the screen).
const aCx = (i) => hall.x0 + 1.0 + i * hall.pitch;
// where product k of a section stands: columns of six, top shelf down, running along the ribbon
function slotPos(a, sec, k) {
  const right = a.flip || !sec.left, col = sec.c0 + Math.floor(k / 6), d = sec.left ? hall.d0 + col * hall.colW : hall.d0 + (a.nr - 1 - col) * hall.colW;   // the right side ends at the entrance, so a shorter side is bare at the far end, not at the mouth (owner's screenshot, 2026-11-10)
  return { x: aCx(a.i) + (right ? 1.14 : -1.14), y: hall.lv[k % 6] + .012, z: hall.zf - d, ry: right ? -PI / 2 : PI / 2, left: !right, s: sec.s0 + (col - sec.c0) * hall.colW };
}
function drawAisleSign(g, w, h, a) {
  g.fillStyle = '#14100e'; g.fillRect(0, 0, w, h); g.fillStyle = '#d62c28'; g.fillRect(0, 0, w, 46); g.fillStyle = '#f2c230'; g.fillRect(0, 46, w, 6); g.fillRect(0, h - 12, w, 12);
  g.fillStyle = '#ffffff'; g.font = '900 26px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('EXOR GAMES', 22, 24); g.textAlign = 'right'; g.fillText(a.count.toLocaleString('en-CA') + ' in stock', w - 22, 24);
  g.beginPath(); g.arc(86, 150, 54, 0, PI * 2); g.fillStyle = '#f2c230'; g.fill(); g.fillStyle = '#14100e'; g.font = '900 68px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(String(a.i + 1), 86, 154);
  g.font = '900 92px Inter, sans-serif'; g.textAlign = 'left'; let sc = 1; const t = a.label.toUpperCase(), tw_ = g.measureText(t).width; if (tw_ > w - 190) sc = (w - 190) / tw_;
  g.save(); g.translate(164, 154); g.scale(sc, 1); g.fillStyle = '#8f1a17'; g.fillText(t, 4, 5); g.fillStyle = '#f2c230'; g.fillText(t, 0, 0); g.restore();
}
// the sign on top of the shelving where a section starts: the shop's black, red and yellow; the new arrivals' one is yellow
function drawSecSign(g, w, h, sec) {
  const nw = sec.key === 'new';
  g.fillStyle = nw ? '#f2c230' : '#14100e'; g.fillRect(0, 0, w, h); g.fillStyle = '#d62c28'; g.fillRect(0, 0, 14, h); g.fillStyle = nw ? '#14100e' : '#f2c230'; g.fillRect(14, h - 8, w - 14, 8);
  const n = sec.count.toLocaleString('en-CA'); g.textBaseline = 'middle'; g.font = '800 24px Inter, sans-serif'; g.textAlign = 'right'; g.fillStyle = nw ? '#14100e' : '#ffffffb0'; g.fillText(n, w - 14, h / 2 - 3);
  const room = w - 44 - g.measureText(n).width - 14, t = (nw ? '★ ' : '') + sec.label.toUpperCase(); g.font = '900 54px Inter, sans-serif'; g.textAlign = 'left';
  const tw_ = g.measureText(t).width, sc = tw_ > room ? room / tw_ : 1; g.save(); g.translate(30, h / 2 - 2); g.scale(sc, 1); g.fillStyle = nw ? '#14100e' : '#f2c230'; g.fillText(t, 0, 0); g.restore();
}
function buildHall(list) {
  if (hall.built || !list.length) return; hall.built = true;
  hall.list = list.map((a, i) => {
    const o = { key: a.key, label: a.label, count: a.count, i, loading: false, live: new Map() };
    // the sections along the ribbon, each from a fresh column and at least a sign wide
    o.secs = (a.secs && a.secs.length ? a.secs : [{ key: '', label: a.label, count: a.count }]).map((s, j) => ({ key: s.key, label: s.label, count: s.count, j, rows: [], next: '', done: false, fail: 0, cols: Math.max(3, Math.ceil(s.count / 6)) }));
    const N = o.secs.reduce((n, s) => n + s.cols, 0); let run = 0, best = 0, bestV = 1e9;
    o.secs.forEach((s, j) => { run += s.cols; const v = Math.max(run, N - run); if (v < bestV) { bestV = v; best = j + 1; } });   // turn at the section break nearest half way
    if (!i) { best = o.secs.length; o.flip = true; }   // the first aisle: one shelf, facing the shop
    o.nl = o.secs.slice(0, best).reduce((n, s) => n + s.cols, 0); o.nr = N - o.nl;
    o.U = (Math.max(o.nl, o.nr) - 1) * hall.colW; o.L = o.U + 1.1; o.smax = o.nr ? 2 * o.U + hall.T : o.U;
    let c = 0, off = 0, left = true;
    o.secs.forEach((s, j) => { if (left && j >= best && o.nr) { left = false; c = 0; } s.left = left; s.c0 = c; s.s0 = left ? c * hall.colW : o.U + hall.T + (o.U - (o.nr - 1) * hall.colW) + c * hall.colW; s.off = off; c += s.cols; off += s.count; });
    o.slots = off; return o;
  });
  const n = hall.list.length, xMax = aCx(n - 1) + 1.0 + .45 + .35, Lmax = Math.max.apply(null, hall.list.map((a) => a.L)), zBack = Math.min(-3.5, hall.zf - Lmax - 1.6), W_ = xMax - hall.x0, D_ = 3.5 - zBack, zc = (3.5 + zBack) / 2, xc = (hall.x0 + xMax) / 2;
  hall.xMax = xMax; hall.zBack = zBack;
  // (owner, 2026-11-11: "remove the red wall as it ... makes it hard to know unless you turn to look, that there is more store that way")
  rwFull.visible = false; rwShort.visible = false; rwUp.visible = false;
  const G = hall.g = new THREE.Group(); scene.add(G);
  const fl = pl(W_, D_, lam({ map: ctex(256, 256, drawCarpet, [W_ * 1.1, D_ * 1.1]) }), xc, 0, zc, 0, G); fl.rotation.x = -PI / 2;
  const ce = pl(W_, D_, lam({ map: ctex(128, 128, drawCeil, [W_ * 1.65, D_ * 1.65]) }), xc, CEIL, zc, 0, G); ce.rotation.x = PI / 2;
  const wall = (len) => lam({ map: ctex(512, 1024, drawWall, [Math.max(1, Math.round(len)), 1]) });
  pl(W_, 2.9, wall(W_), xc, 1.45, 3.5, PI, G); pl(W_, 2.9, wall(W_), xc, 1.45, zBack, 0, G); pl(D_, 2.9, wall(D_), xMax, 1.45, zc, -PI / 2, G);
  const upM = lam({ color: 0xc4b693 }), uh = CEIL - 2.9, uy = 2.9 + uh / 2; pl(W_, uh, upM, xc, uy, 3.5, PI, G); pl(W_, uh, upM, xc, uy, zBack, 0, G); pl(D_, uh, upM, xMax, uy, zc, -PI / 2, G); if (zBack < -3.51) pl(-3.5 - zBack, uh, upM, hall.x0 + .02, uy, (-3.5 + zBack) / 2, PI / 2, G);
  if (zBack < -3.51) pl(-3.5 - zBack, 2.9, wall(-3.5 - zBack), hall.x0 + .02, 1.45, (-3.5 + zBack) / 2, PI / 2, G);   // the hall runs on behind the shop: a wall there, none between the two rooms
  // shelving in the shop's colours: charcoal steel, a red kick plate, a yellow edge on every shelf
  const steel = lam({ color: 0x1c1b1d }), cream = lam({ color: 0xe9e2d0 }), red = lam({ color: 0xd62c28 }), yellow = lam({ color: 0xf2c230 });
  const tubes = [], col = new THREE.Color(), d2 = new THREE.Object3D();
  hall.list.forEach((a) => {
    const cx = aCx(a.i), zm = hall.zf - a.L / 2;
    [-1, 1].forEach((sd) => {
      const xf = cx + sd * 1.0;   // the shelf's front edge; it runs back from there
      if (a.flip && sd < 0) return;   // the first aisle is open to the shop on that side
      bx(.03, 1.98, a.L, cream, xf + sd * .44, .99, zm, G);
      bx(.45, .15, a.L, red, xf + sd * .225, .075, zm, G); bx(.46, .05, a.L, red, xf + sd * .225, 2.0, zm, G);
      hall.lv.forEach((y, r) => { if (r < 5) bx(.42, .018, a.L, steel, xf + sd * .22, y - .009, zm, G); bx(.012, .034, a.L, yellow, xf + sd * .004, y - .017, zm, G); });
      for (let z = hall.zf; z > hall.zf - a.L - .01; z -= 1.2) bx(.035, 1.98, .035, steel, xf + sd * .02, .99, z, G);
      bx(.035, 1.98, .035, steel, xf + sd * .02, .99, hall.zf - a.L, G);
    });
    // every slot stocked with a plain box from the start
    const inst = a.inst = new THREE.InstancedMesh(new THREE.BoxGeometry(.2, .23, .07).translate(0, .115, 0), lam({ color: 0xffffff }), a.slots); const q = seed('aisle' + a.key);
    a.secs.forEach((sec) => {
      for (let k = 0; k < sec.count; k++) { const p = slotPos(a, sec, k); d2.position.set(p.x, p.y, p.z + (q() - .5) * .03); d2.rotation.set(0, p.ry, 0); d2.scale.set(.8 + q() * .4, .7 + q() * .45, 1); d2.updateMatrix(); inst.setMatrixAt(sec.off + k, d2.matrix); col.setHSL(q(), .25 + q() * .35, .3 + q() * .3); inst.setColorAt(sec.off + k, col); }
      // its sign on top of the shelving where it starts, and a divider down the shelves
      const fw = sec.left ? -1 : 1, p0 = slotPos(a, sec, 0), sd = p0.left ? -1 : 1, w = Math.min(1.1, sec.cols * hall.colW - .04), zs = p0.z + fw * (w / 2 - hall.colW / 2 + .02);
      pl(w, .19, new THREE.MeshBasicMaterial({ map: ctex(560, 96, (g, cw, ch) => drawSecSign(g, cw, ch, sec)) }), cx + sd * .985, 2.135, zs, p0.left ? PI / 2 : -PI / 2, G);
      bx(.44, 1.84, .012, cream, cx + sd * 1.22, 1.07, p0.z - fw * hall.colW / 2, G);
    });
    G.add(inst);
    // the header over the entrance, and again every nine metres: two-sided, hung from the ceiling
    const sm = new THREE.MeshBasicMaterial({ map: ctex(900, 260, (g, w, h) => drawAisleSign(g, w, h, a)) });
    for (let z = hall.zf + .15; z > hall.zf - a.L; z -= 9) { pl(1.8, .52, sm, cx, 2.42, z + .012, 0, G); pl(1.8, .52, sm, cx, 2.42, z - .012, PI, G); bx(1.84, .56, .02, steel, cx, 2.42, z, G); [-.8, .8].forEach((dx) => bx(.012, CEIL - 2.66, .012, steel, cx + dx, (CEIL + 2.66) / 2, z, G)); }
    for (let z = hall.zf - 1.5; z > hall.zf - a.L; z -= 4.5) tubes.push([cx, z]);
    a.hit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.9, 1.4), hitM); a.hit.position.set(cx, 1.45, hall.zf - .5); a.hit.userData.aisle = a.i; G.add(a.hit);
  });
  // Track lights down every aisle, and the floor behind the shorter aisles set out as play space (owner,
  // 2026-11-11: "These dead areas should be filled with 'play space' tables"): folding tables with a mat and
  // four chairs each, under a hanging sign.
  const railM = lam({ color: 0x141416 }), heads = [], tabs = [];
  const psM = new THREE.MeshBasicMaterial({ map: ctex(800, 200, (g, w, h) => { g.fillStyle = '#14100e'; g.fillRect(0, 0, w, h); g.fillStyle = '#19b5a5'; g.fillRect(0, 0, w, 14); g.fillStyle = '#ff4f9a'; g.fillRect(0, h - 14, w, 14); g.fillStyle = '#f2c230'; g.font = '900 96px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PLAY SPACE', w / 2, 86); g.fillStyle = '#fff'; g.font = '700 30px Inter, sans-serif'; g.fillText('pull up a chair · open play all day', w / 2, 156); }) });
  hall.list.forEach((a) => {
    const cx = aCx(a.i), z0 = hall.zf - a.L;
    bx(.05, .03, a.L, railM, cx, 3.2, hall.zf - a.L / 2, G); for (let z = hall.zf - .4; z > z0; z -= 3.2) bx(.012, CEIL - 3.2, .012, railM, cx, (CEIL + 3.2) / 2, z, G);
    for (let z = hall.zf - .7, k = 0; z > z0 + .3; z -= 1.5, k++) heads.push([cx, 3.12, z, 0, a.flip ? .6 : k % 2 ? .6 : -.6]);
    const zs = z0 - 1.6, ze = zBack + 1.2; if (zs - ze < 1.5) return;
    pl(1.6, .4, psM, cx, 2.5, zs + .7 + .012, 0, G); pl(1.6, .4, psM, cx, 2.5, zs + .7 - .012, PI, G); bx(1.64, .44, .02, steel, cx, 2.5, zs + .7, G); [-.7, .7].forEach((dx) => bx(.012, CEIL - 2.72, .012, steel, cx + dx, (CEIL + 2.72) / 2, zs + .7, G));
    for (let z = zs - 1.15, k = a.i; z > ze; z -= 4.6, k++) [-.75, .75].forEach((dx, j) => flagHang(G, k * 2 + j + (k % 2), cx + dx, 3.45, z, 0, .56, true));
    for (let z = zs; z > ze; z -= 2.3) { tabs.push([cx, z]); if (Math.round((zs - z) / 2.3) % 2 === 0) tubes.push([cx, z]); }
  });
  trackHeads(G, heads);
  if (tabs.length) {
    const im = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); G.add(m); return m; }, nT = tabs.length, q3 = seed('play');
    const top = im(new THREE.BoxGeometry(1.5, .035, .75), lam({ color: 0xb9ad98 }), nT), legs = im(new THREE.BoxGeometry(.03, .7, .03), lam({ color: 0x55555c }), nT * 4), seat = im(new THREE.BoxGeometry(.4, .025, .4), lam({ color: 0x55555c }), nT * 4), back = im(new THREE.BoxGeometry(.4, .3, .02), lam({ color: 0x55555c }), nT * 4), mat = im(new THREE.BoxGeometry(.6, .004, .35), lam({ color: 0xffffff }), nT * 2);
    const put = (m, k, x, y, z, ry) => { d2.position.set(x, y, z); d2.rotation.set(0, ry || 0, 0); d2.scale.set(1, 1, 1); d2.updateMatrix(); m.setMatrixAt(k, d2.matrix); };
    tabs.forEach((t, k) => {
      const x = t[0] + (q3() - .5) * .2, z = t[1], ry = (q3() - .5) * .12;
      put(top, k, x, .72, z, ry); [[-.68, -.3], [.68, -.3], [-.68, .3], [.68, .3]].forEach((l, j) => put(legs, k * 4 + j, x + l[0], .35, z + l[1], 0));
      [[-.36, -.62, 0], [.36, -.62, 0], [-.36, .62, PI], [.36, .62, PI]].forEach((c, j) => { const cz = z + c[1] + (q3() - .5) * .12, cr = c[2] + (q3() - .5) * .5; put(seat, k * 4 + j, x + c[0], .45, cz, cr); put(back, k * 4 + j, x + c[0] - Math.sin(cr) * .19, .62, cz - Math.cos(cr) * .19, cr); });
      [-.36, .36].forEach((dx, j) => { put(mat, k * 2 + j, x + dx, .74, z, ry); col.setHSL(q3(), .55, .42); mat.setColorAt(k * 2 + j, col); });
    });
  }
  for (let x = hall.x0 + 2; x < xMax; x += 4) tubes.push([x, 2.4]);
  const ti = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, .03, 1.3), tubeM, tubes.length); tubes.forEach((t, k) => { d2.position.set(t[0], CEIL - .04, t[1]); d2.rotation.set(0, 0, 0); d2.scale.set(1, 1, 1); d2.updateMatrix(); ti.setMatrixAt(k, d2.matrix); }); G.add(ti);
  hit(bx(.4, 2.6, 7, hitM, hall.x0 + .25, 1.3, 0), 'aisles');   // anywhere along the open side
  // a banner hung over the open side, facing the shop: what is through there
  const bm = new THREE.MeshBasicMaterial({ map: ctex(1200, 200, (g, w, h) => { g.fillStyle = '#14100e'; g.fillRect(0, 0, w, h); g.fillStyle = '#d62c28'; g.fillRect(0, 0, w, 14); g.fillStyle = '#f2c230'; g.fillRect(0, h - 14, w, 14); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2c230'; g.font = '900 78px Inter, sans-serif'; g.fillText('MORE STORE THIS WAY  ▸', w / 2, 72); g.fillStyle = '#fff'; g.font = '800 34px Inter, sans-serif'; let t = hall.list.map((a) => a.label.toUpperCase()).join('  ·  '), sc = Math.min(1, (w - 60) / g.measureText(t).width); g.save(); g.translate(w / 2, 142); g.scale(sc, 1); g.fillText(t, 0, 0); g.restore(); }) });
  pl(3.0, .5, bm, hall.x0 - .02, 2.36, -1.0, -PI / 2, G); bx(.02, .54, 3.04, steel, hall.x0, 2.36, -1.0, G); [-1.4, 1.4].forEach((dz) => bx(.012, CEIL - 2.62, .012, steel, hall.x0, (CEIL + 2.62) / 2, -1.0 + dz, G));
  // The paint racks stand at the ends of the shelving now (owner, 2026-11-11: "The paints need to be moved to the
  // end of the aisles closest to warhammer and gunpla"): Vallejo on the end beside the Gunpla aisle, Warhammer
  // paints and Army Painter on the two ends at the Warhammer aisle, each facing the front of the hall and
  // standing proud of the shelving so it shows from the hall and from the shop.
  { const iG = Math.max(0, hall.list.findIndex((a) => a.key === 'gunpla')), fw = hall.list.findIndex((a) => a.key === 'wargames'), iW = fw < 0 ? n - 1 : fw;
    const put = (key, x) => { const r = racks.find((q) => q.key === key); if (!r) return; r.at = [x, hall.zf + .03]; r.ry = 0; fillRack(r); rackHit(r); };
    put('vallejo', aCx(iG) + 1.45); put('citadel', iW > 0 ? aCx(iW) - 1.45 : aCx(iW) + 1.45); put('army', aCx(iW) + 1.22 + (iW > 0 ? 0 : .9));
    hobbyHits.forEach((m) => { const k = hot.indexOf(m); if (k > -1) hot.splice(k, 1); kill(m); }); hobbyHits = []; hall.paints = true; hall.iW = iW; }
  $('#aislesN').textContent = n; $('#aislesN').hidden = false; lights(S.eve); ui(); kick();
}
function loadAisles() {
  return fetch(W + '/showcase/aisles.json', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => { if (d && d.ok && d.aisles) buildHall(d.aisles); }).catch(() => {});
}
// one more page of a section's products, when the walk is getting near the end of what is known
function aislePage(a, sec) {
  if (a.loading || sec.done) return; a.loading = true;
  fetch(W + '/showcase/aisle.json?cat=' + a.key + (sec.key ? '&sec=' + sec.key : '') + (sec.next ? '&after=' + encodeURIComponent(sec.next) : ''), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    a.loading = false; if (!d || !d.ok) { if (++sec.fail > 3) sec.done = true; return; }
    d.rows.forEach((r) => sec.rows.push({ name: r[0], set: a.label + (sec.key ? ' · ' + sec.label : ''), price: r[2], image: r[3], url: 'https://exorgames.com/products/' + r[1], variantId: r[5], condition: '', foil: false, game: a.key, sealed: true, ar: clamp(Number(r[4]) || 1, .5, 1.7), qty: r[6] }));
    sec.next = d.next || ''; if (!d.next || sec.rows.length >= sec.count) sec.done = true; kick();
  }).catch(() => { a.loading = false; });
}
const aisleFov = () => (cam.aspect < 1 ? 84 : 76);   // floor to section signs between the bars at the top and bottom of the screen
const aisleHalf = () => 1.68 * Math.tan(aisleFov() * PI / 360) * cam.aspect;   // half the shelf run on screen, in metres
// Which slots show the product itself: the ones in front of you. The rest stay plain boxes.
let stockAt = 0, stockT = 0; const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
function aisleStock(now) {
  if (!hall.built) return;
  if (now - stockAt < 160) { if (!stockT) stockT = setTimeout(() => { stockT = 0; kick(); }, 180); return; }   // look again shortly: a page that just arrived may need its shelves filled, or the next page asked for
  stockAt = now;
  const cur = S.mode === 'aisle' ? hall.list[S.aisle] : null, hw = Math.min(3.2, aisleHalf() + .45), sNow = S.as || 0;
  hall.list.forEach((a) => {
    const want = new Map(); let ask = null, askD = 0;
    if (a === cur || S.mode === 'aisles' || a.flip) a.secs.forEach((sec) => {
      const n = sec.count; let far = -1;
      for (let c = 0; c < sec.cols; c++) {
        const s = sec.s0 + c * hall.colW;
        if (a === cur ? Math.abs(s - sNow) > hw : !(s < (a.flip ? 4.9 : .7) || (a.nr && s > a.smax - .7))) continue;   // from the hall: just the ends of the shelves by the entrance; the first aisle's shelf faces the shop, so the run of it the shop can see
        for (let w = 0; w < 6; w++) { const k = c * 6 + w; if (k >= n) break; want.set(sec.off + k, [sec, k]); far = k; }
      }
      if (far >= 0 && !sec.done && sec.rows.length < Math.min(sec.count, far + (a === cur ? 36 : 1))) { const dist = Math.max(0, sec.s0 - sNow, sNow - sec.s0 - sec.cols * hall.colW); if (!ask || dist < askD) { ask = sec; askD = dist; } }   // the section you are standing at first
    });
    if (ask) aislePage(a, ask);
    a.live.forEach((m, g) => { if (!want.has(g)) { const old = m.material.map; if (old && !old.userData.keep) old.dispose(); m.material.dispose(); m.geometry.dispose(); hall.g.remove(m); a.live.delete(g); const u = m.userData, p = slotPos(a, u.sec, u.k), d = dummy; d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry, 0); d.scale.set(1, 1, 1); d.updateMatrix(); a.inst.setMatrixAt(g, d.matrix); a.inst.instanceMatrix.needsUpdate = true; } });
    want.forEach((sk, g) => {
      if (a.live.has(g)) return; const sec = sk[0], k = sk[1], c = sec.rows[k]; if (!c) { if (sec.done) { a.inst.setMatrixAt(g, zeroM); a.inst.instanceMatrix.needsUpdate = true; } return; }
      const p = slotPos(a, sec, k), w = c.ar >= 1 ? .27 : .27 * c.ar, h = c.ar >= 1 ? .27 / c.ar : .27, q = seed('slot' + a.key + g);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide })); m.visible = false;
      m.position.set(p.x + (p.left ? .05 : -.05), p.y + h / 2, p.z + (q() - .5) * .02); m.rotation.y = p.ry + (q() - .5) * .08; m.userData = { card: c, sec, k }; hall.g.add(m); a.live.set(g, m);
      cardTex(c, 256).then((t) => { if (a.live.get(g) !== m) { t.dispose(); return; } m.material.map = t; m.material.needsUpdate = true; m.visible = true; a.inst.setMatrixAt(g, zeroM); a.inst.instanceMatrix.needsUpdate = true; kick(); });
    });
  });
}
// The hall is walked a stop at a time (owner, 2026-11-11: "one swipe should move the camera to view down the
// aisle like you're about to walk down it ... the next swipe it snaps to the next aisle"). S.hs: -1 = where you
// come in, looking along the row of headers; 0..n-1 = standing square at the mouth of that aisle, looking down
// it. A swipe steps one stop; a tap on the aisle walks in.
function aislesView() {
  const n = hall.list.length || 1, ph = cam.aspect < 1; S.hs = clamp(S.hs == null ? -1 : S.hs, -1, n - 1);
  if (S.hs < 0) return lookView(new V3(hall.x0 + .5, 1.7, ph ? 3.3 : 3.05), new V3(hall.x0 + .5 + (ph ? 2.1 : 2.4), ph ? 1.4 : 1.62, hall.zf - (ph ? .5 : 1.0)), ph ? 82 : 62);
  const cx = aCx(S.hs); return lookView(new V3(cx, 1.62, 3.3), new V3(cx, 1.25, hall.zf - 6), ph ? 80 : 58);
}
function hallStep(d) { const n = hall.list.length, to = clamp((S.hs == null ? -1 : S.hs) + d, -1, n - 1); S.hs = to; glide(aislesView(), 520); hint(''); ui(); }
function hallTo(i) { S.hs = i; setView(aislesView()); }
// In an aisle you stand S.as metres along its ribbon: down the left shelf, round at the far end, back up the right.
function aisleView() {
  const a = hall.list[S.aisle] || hall.list[0], cx = aCx(a.i), U = a.U, T = hall.T; S.as = clamp(S.as || 0, 0, a.smax);
  const s = S.as, t = !a.nr || s <= U ? 0 : s >= U + T ? 1 : (s - U) / T, d = hall.d0 + (t <= 0 ? s : t >= 1 ? U - (s - U - T) : Math.max(0, U - Math.sin(t * PI) * (.6 + 1 / (Math.tan(aisleFov() * PI / 360) * cam.aspect))));   // turning, you step back from the end so both shelves stay in sight
  const phi = a.flip ? PI : t * t * (3 - 2 * t) * PI, x = cx + .68 * Math.cos(phi), z = hall.zf - (a.flip ? hall.d0 + s : d);   // you stand across the aisle from the shelf you face
  const y = cam.aspect < 1 ? 1.12 : 1.0;
  return lookView(new V3(x, y, z), new V3(x - Math.cos(phi) * 1.78, y, z - Math.sin(phi) * 1.78), aisleFov());
}
const aisleEdge = () => (S.as || 0) - aisleHalf() + .3;   // the ribbon at the left edge of the screen: the section it is in is "where you are"
function aisleSec() { const a = hall.list[S.aisle]; let cur = a.secs[0]; const e = Math.max(0, aisleEdge()); a.secs.forEach((s) => { if (s.s0 <= e + .01) cur = s; }); return cur; }
function goAisle(i, keep) {
  if (!hall.built || !hall.list[i]) return; if (S.hand) putBack(); closePaint(true); leanOff(); cabinetDoors(false);
  S.mode = 'aisle'; S.aisle = i; if (!keep) S.as = 0; S.avz = 0; hall.secOn = -1; glide(aisleView(), 1000);
  const fl = hall.list[i].flip;   // the first aisle's shelf runs away to your left
  hint(matchMedia('(pointer:coarse)').matches ? (fl ? 'Swipe right to walk along the shelf' : 'Swipe to walk along the shelf') + ' · pinch to lean in · tap a product' : 'Drag or scroll to walk along the shelf · hold the mouse down to lean in · click a product'); ui();
}
// walk the ribbon to a spot, turning at the far end if it is on the other side
function aisleTo(s, ms) {
  const a = hall.list[S.aisle]; if (!a) return; leanOff(); S.avz = 0; const from = S.as || 0, to = clamp(s, 0, a.smax), t0 = performance.now(), id = hall.walk = (hall.walk || 0) + 1;
  ms = reduce ? 1 : ms || clamp(380 + Math.abs(to - from) * 110, 380, 1700);
  anims.push((now) => { if (hall.walk !== id || S.mode !== 'aisle' || drag) return false; const k = Math.min(1, (now - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; S.as = lerp(from, to, e); setView(aisleView()); aisleBar(); return k < 1; }); kick();
}
function goSec(j) { const a = hall.list[S.aisle], sec = a && a.secs[j]; if (!sec) return; hint(''); aisleTo(sec.s0 + Math.max(0, aisleHalf() - .28)); }
// turn to the shelf behind you
function aisleTurn() {
  const a = hall.list[S.aisle]; if (!a || !a.nr) return; const U = a.U, T = hall.T, s = S.as || 0; hall.walk = (hall.walk || 0) + 1; leanOff(); S.avz = 0;
  S.as = s <= U + T / 2 ? U + T + (U - Math.min(s, U)) : U - (Math.max(s, U + T) - U - T); glide(aisleView(), 520, aisleBar); aisleBar(); hint('');
}
function aisleWalk(ds) { hall.walk = (hall.walk || 0) + 1; S.as = clamp((S.as || 0) + ds, 0, (hall.list[S.aisle] || {}).smax || 0); setView(aisleView()); aisleBar(); }
function aisleBar() {
  const a = hall.list[S.aisle]; if (!a) return; const sec = aisleSec();
  if (hall.secOn === a.i * 100 + sec.j) return; hall.secOn = a.i * 100 + sec.j;
  $('#aiTitle').textContent = 'Aisle ' + (a.i + 1) + ' · ' + a.label + (sec.key ? ' · ' + sec.label + ' (' + sec.count.toLocaleString('en-CA') + ')' : '');
  const box = $('#aiSecs'); Array.from(box.children).forEach((b, j) => { b.classList.toggle('on', j === sec.j); if (j === sec.j) box.scrollTo({ left: b.offsetLeft - box.clientWidth / 2 + b.offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' }); });
}

// from the door: the case and the till side by side, centred
const doorView = () => { const x = (S.x0 + 2.3) / 2, ph = cam.aspect < 1, v = lookView(new V3(x, 1.6, 3.2), new V3(x, ph ? 1.3 : 1.18, -1.2), ph ? 82 : 55); v.yaw += S.look.yaw; v.pitch += S.look.pitch; return v; };
// the till and the person behind it; on a wide screen the pile's sheet covers the right, so they sit left of centre
const tillView = () => { const dx = cam.aspect < 1 ? 0 : .32; return lookView(new V3(1.95 + dx, 1.56, cam.aspect < 1 ? .5 : .25), new V3(2.02 + dx, 1.28, -1.2)); };
const hobbyView = () => (hall.paints ? lookView(new V3(aCx(hall.iW) - 2.9, 1.6, 3.25), new V3(aCx(hall.iW) + .5, 1.05, hall.zf + .2), cam.aspect < 1 ? 82 : 62)   // from the hall, across the two racks at the Warhammer end
  : lookView(new V3(-1.4, 1.5, cam.aspect < 1 ? 1.9 : 1.4), new V3(-3.3, 1.05, -2.0), cam.aspect < 1 ? 80 : 58));
function viewFor() { return S.mode === 'rack' && racks[S.rack] ? (psel.g && psel.r === racks[S.rack] && psel.k > -1 ? paintView(psel.r, psel.k) : rackView(racks[S.rack])) : S.mode === 'hobby' ? hobbyView() : S.mode === 'graded' ? gradedView() : S.mode === 'arcades' ? arcadesView() : S.mode === 'ask' ? tillView() : S.mode === 'arcade' ? arcadeView() : S.mode === 'stack' ? cabView(CAB_Z.stack) : S.mode === 'dunk' ? cabView(CAB_Z.dunk) : S.mode === 'line' ? cabView(CAB_Z.line) : S.mode === 'tv' ? tvView() : S.mode === 'aisles' ? aislesView() : S.mode === 'aisle' ? aisleView() : S.mode === 'case' && S.lay.length ? caseView() : S.mode === 'boxes' ? wallView() : S.mode === 'crate' && cr ? crateView(cr) : S.mode === 'till' ? tillView() : doorView(); }
function go(mode) {
  leanOff(); closePaint(true); cabinetDoors(mode === 'graded'); if (S.mode === 'arcade') arcStop(); if (S.mode === 'stack') stkStop(); if (S.mode === 'dunk') dnkStop(); if (S.mode === 'line') linStop(); if (S.mode === 'tv') tvStop(); if (S.mode === 'ask') { askClear(); document.body.dataset.fan = ''; }
  if (S.hand) putBack(); $('#setsv').classList.remove('on'); $('#tillv').classList.remove('on');
  if (mode === 'case') { if (!S.shelves.length) return; S.mode = 'case'; glide(caseView()); hint(matchMedia('(pointer:coarse)').matches ? 'Swipe to walk the case · swipe up to crouch · pinch to lean in · tap a card' : 'Drag to walk the case · scroll to crouch · hold the mouse down to lean in · click a card'); }
  else if (mode === 'hobby') { S.mode = 'hobby'; S.side = 'left'; glide(hobbyView()); hint(hall.paints ? 'The paints are at the ends of the aisles · tap a rack, or pick one below' : 'Paints · tap a rack to look straight at it'); }
  else if (mode === 'sealed') { if (!sealed.rows.length) { hint('The sealed wall is still being stocked - try again in a moment'); return; } S.mode = 'boxes'; S.focus = 'sealed'; S.sx = cam.aspect < 1 ? -1e9 : 0; S.sy = -1e9; glide(wallView()); hint(matchMedia('(pointer:coarse)').matches ? 'Sealed boxes, decks and bundles · drag to move · pinch to lean in · tap one for its page' : 'Sealed boxes, decks and bundles · drag to move · hold the mouse down to lean in · click one for its page'); }
  else if (mode === 'boxes') { S.focus = ''; if (!boxes.list) { if (sealed.rows.length) return go('sealed'); hint('The boxes for this game are not on the shelf yet'); return; } S.mode = 'boxes'; if (cam.aspect < 1) S.pan = -1e9; glide(wallView()); hint('Every set we carry · tap a box, pick a set, thumb through'); }
  else if (mode === 'bin') { if (!binCrate) return; enterCrate(binCrate); return; }
  else if (mode === 'till') { S.mode = 'till'; glide(tillView(), 900, showTill); hint(''); }
  else if (mode === 'graded') { S.mode = 'graded'; gcab.gx = cam.aspect < 1 ? -1e9 : 0; gcab.gy = 1e9; glide(gradedView()); stockCabinet(); hint(gcab.rows.length ? (matchMedia('(pointer:coarse)').matches ? 'Graded cards · pinch to lean in · tap one to take it out · drag it to turn it over' : 'Graded cards · hold the mouse down to lean in · click one to take it out · drag it to turn it over') : 'The graded cabinet is being stocked'); }
  else if (mode === 'aisles') { if (!hall.built) { hint('The aisles are still being stocked - try again in a moment'); return; } if (S.mode === 'aisle') S.hs = S.aisle; else if (S.mode !== 'aisles') S.hs = -1; S.mode = 'aisles'; glide(aislesView()); hint(matchMedia('(pointer:coarse)').matches ? 'Swipe to the next aisle · tap an aisle to walk in' : 'Drag, scroll or arrow keys for the next aisle · click an aisle to walk in'); }
  else if (mode === 'arcade') { S.mode = 'arcade'; glide(arcadeView(), 800); arcRun(); hint(matchMedia('(pointer:coarse)').matches ? 'Tap to start · drag to move Mallow · it sprays by itself' : 'Click to start · drag or arrow keys move Mallow · space sprays'); }
  else if (mode === 'arcades') { S.mode = 'arcades'; glide(arcadesView(), 800); hint(matchMedia('(pointer:coarse)').matches ? 'Tap the game you want to play' : 'Click the game you want to play'); }
  else if (mode === 'line') { S.mode = 'line'; glide(cabView(CAB_Z.line), 800); linRun(); hint(matchMedia('(pointer:coarse)').matches ? 'Tap to start · hold right or left to walk · tap to shove' : 'Click to start · arrow keys walk · space shoves'); }
  else if (mode === 'dunk') { S.mode = 'dunk'; glide(cabView(CAB_Z.dunk), 800); dnkRun(); hint(matchMedia('(pointer:coarse)').matches ? 'Tap to start · tap where to throw - lead the target' : 'Click to start · click where to throw - lead the target'); }
  else if (mode === 'stack') { S.mode = 'stack'; glide(cabView(CAB_Z.stack), 800); stkRun(); hint(matchMedia('(pointer:coarse)').matches ? 'Tap to start · drag to move · tap to turn · swipe down to drop' : 'Click to start · arrows move, up turns, space drops'); }
  else if (mode === 'tv') { S.mode = 'tv'; glide(tvView(), 900); tvRun(); hint(''); }
  else { S.mode = 'door'; S.look.yaw = S.look.pitch = 0; glide(doorView()); hint('Tap the glass case, the boxes, the bin or the till · drag to look around'); }
  ui();
}
function back() {
  if ($('#zoomv').classList.contains('on')) { zoomOff(); return; }
  if ($('#prodv').classList.contains('on')) return closeProduct();
  if (S.mode === 'ask' && !S.hand) return askLeave();
  if (S.hand) return putBack();
  if (isCab(S.mode)) return go('arcades');
  if (S.mode === 'aisle') return go('aisles');
  if (psel.g) return closePaint();
  // back from a paint rack: to the hall stop you tapped it from, still able to swipe along (owner, 2026-11-12:
  // "when I came back out to the aisles I could no longer scroll"), else to the paints view
  if (S.mode === 'rack') { if (hall.paints && S.rackFrom === 'aisles') { S.mode = 'aisles'; glide(aislesView(), 600); hint(''); ui(); return; } return go('hobby'); }
  if ($('#setsv').classList.contains('on')) { $('#setsv').classList.remove('on'); return; }
  if ($('#tillv').classList.contains('on')) return go('door');
  if (S.mode === 'crate' && cr && cr.kind === 'set') { go('boxes'); if (boxes.open) openBox(boxes.open.n); return; }
  go('door');
}
let hintT = 0;
function hint(t) { const el = $('#hint'); clearTimeout(hintT); if (!t) { el.classList.add('gone'); return; } el.textContent = t; el.classList.remove('gone'); hintT = setTimeout(() => el.classList.add('gone'), 6000); }
function ui() {
  document.body.dataset.mode = S.mode;
  const st = S.mode === 'crate' ? (cr && cr.kind === 'bin' ? 'bin' : 'boxes') : S.mode === 'boxes' && S.focus === 'sealed' ? 'sealed' : S.mode === 'rack' || S.mode === 'hobby' ? 'hobby' : S.mode === 'aisle' ? 'aisles' : S.mode === 'ask' ? 'till' : S.mode;
  if (S.mode === 'arcades') $('#ctxArcades').innerHTML = '<button type="button" data-go="door">‹ Back</button>' + CABS.map((c) => '<button type="button" data-go="' + c[0] + '">' + c[1] + '</button>').join('');
  if (S.mode === 'aisles') $('#ctxAisles').innerHTML = hall.list.map((a) => '<button type="button" data-aisle="' + a.i + '"' + (a.i === S.hs ? ' class="on"' : '') + '>' + (a.i + 1) + ' · ' + esc(a.label) + '</button>').join('');
  if (S.mode === 'aisle') { const a = hall.list[S.aisle];   // the aisle's sections to jump to, and the turn to the shelf behind
    if (hall.secsFor !== a.i) { hall.secsFor = a.i; hall.secOn = -1; $('#aiSecs').innerHTML = a.secs.length > 1 ? a.secs.map((s) => '<button type="button" data-sec="' + s.j + '">' + esc(s.label) + '</button>').join('') : ''; $('#aiTurn').hidden = !a.nr; }
    aisleBar(); }
  if (S.mode === 'hobby' || S.mode === 'rack') {   // the four racks, and for a paint rack the way to the site's own colour picker
    const r = S.mode === 'rack' ? racks[S.rack] : null;
    $('#ctxHobby').innerHTML = (r ? '<button type="button" id="rackBack">‹ Back</button>' : '') + racks.map((k, i) => ('<button type="button" data-rack="' + i + '"' + (k === r ? ' class="on"' : '') + '>' + esc(k.label) + '</button>')).join('')
      + (r && r.link ? '<a href="https://exorgames.com/collections/' + r.link + '?view=paints"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>Colour picker on the site' + (ON_STORE ? '' : ' ↗') + '</a>' : '');
  }
  $('#boxNote').textContent = st === 'sealed' ? 'drag to move · pinch to lean in · tap a box for its page' : 'tap a white box for its sets';
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-go') === st));
  $('#shelves').innerHTML = S.shelves.map((s, i) => '<button type="button" data-shelf="' + i + '"' + (i === S.shelf ? ' class="on"' : '') + '>' + String.fromCharCode(65 + i) + ' · ' + esc(s.label) + '</button>').join('');
  if (S.mode === 'crate' && cr) {
    const set = cr.kind === 'set', b = boxes.open;
    const lu = set && cr.name ? setLogo(cr.name) : null;
    $('#crTitle').innerHTML = (lu ? '<img src="' + esc(lu) + '" alt="" draggable="false">' : '') + esc(cr.title); $('#crBack').textContent = set ? '‹ Sets' : '‹ Back';
    $('#crPrevSet').hidden = $('#crNextSet').hidden = !set; if (set && b) { $('#crPrevSet').disabled = boxes.setIdx <= 0; $('#crNextSet').disabled = boxes.setIdx >= b.sets.length - 1; }
    $('#crLaneL').hidden = $('#crLaneR').hidden = cr.n < 2; $('#crLaneL').disabled = cr.lane <= 0; $('#crLaneR').disabled = cr.lane >= cr.n - 1;
  }
}
function tabs() {
  $('#tabs').innerHTML = S.cases.map((c) => { const ic = S.icons.indexOf(c.key) > -1; return '<button type="button" data-game="' + esc(c.key) + '" class="' + (ic ? 'ic' : '') + (c.key === S.game ? ' on' : '') + '" title="' + esc(c.label) + '">' + (ic ? '<img src="' + esc(W + '/showcase/icon/' + c.key + '.png') + '" alt="" draggable="false">' : '') + '<span>' + esc(c.label) + '</span></button>'; }).join('');
  $('#flat').href = W + '/showcase?game=' + encodeURIComponent(S.game);
}

/* ---------- touch, mouse, keys ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(list, x, y) { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(list, false); return h.length ? h[0] : null; }
const HELLO = ['Hi! Ask us to pull any card out for a closer look.', 'Looking for something? The boxes at the back have every set.', 'Got cards to sell? We buy - cash or store credit.', 'Ring the bell if you need a hand!'];
let helloN = 0;
// The arcade corner (owner, 2026-11-12: "When clicking on the arcade games, it should first go to the front
// showing all in a way that lets you click the game you want front on"): a tap on any cabinet from elsewhere
// stands you square in front of the row of them; a tap on one there walks up to it; Back from a game returns here.
const CABS = [['arcade', 'Mallow Shooter'], ['stack', 'Box Stack'], ['dunk', 'Scalper Dunk'], ['line', 'Line Rush']];
const isCab = (m) => CABS.some((c) => c[0] === m);
function arcadesView() {
  const zs = CABS.map((c) => CAB_Z[c[0]]), zc = (Math.min.apply(null, zs) + Math.max.apply(null, zs)) / 2, half = (Math.max.apply(null, zs) - Math.min.apply(null, zs)) / 2 + .45, fov = cam.aspect < 1 ? 84 : 58;
  const d = Math.max(half / hTan(fov), 1.25 / Math.tan(rad(fov / 2))); return lookView(new V3(-3.27 + d, 1.5, zc), new V3(-3.27, 1.12, zc), fov);
}
function act(a) { if (isCab(a) && S.mode !== 'arcades') return go('arcades'); if (a === 'bell') ding(); else if (a === 'lights') toggleLights(); else if (a === 'staff') hint(HELLO[helloN++ % HELLO.length]); else go(a); }
function tap(x, y) {
  if (S.hand) return putBack();
  if (tw) return;
  if (S.mode === 'case') { const h = pick(caseCards.filter((m) => m.visible), x, y); if (h) { const u = h.object.userData; if (u.si !== S.shelf) goShelf(u.si); else lift(u.card, h.object); return; } }
  else if (S.mode === 'boxes') { const h = pick(boxMeshes.concat(sealMeshes), x, y); if (h) return h.object.userData.card ? lift(h.object.userData.card, null) : openBox(h.object.userData.n); }
  else if (S.mode === 'hobby') { const h = pick(racks.map((r) => r.hitM), x, y); if (h) return goRack(h.object.userData.rack); }
  else if (S.mode === 'graded') { const h = pick(gcab.meshes.filter((m) => m.visible), x, y); if (h) return lift(h.object.userData.card, null); }
  else if (S.mode === 'ask') return fanTap(x, y);
  else if (S.mode === 'arcade') return arcTap();
  else if (S.mode === 'stack') return stkTap();
  else if (S.mode === 'dunk') return dnkTap(x, y);
  else if (S.mode === 'line') return linTap();
  else if (S.mode === 'tv') return;
  else if (S.mode === 'aisles') { const rk = hall.paints && pick(racks.map((r) => r.hitM).filter(Boolean), x, y); if (rk) return goRack(rk.object.userData.rack); const h = pick(hall.list.map((a) => a.hit), x, y); if (h) return goAisle(h.object.userData.aisle); }
  else if (S.mode === 'aisle') { const a = hall.list[S.aisle], h = pick(Array.from(a.live.values()).filter((m) => m.visible), x, y); if (h) return lift(h.object.userData.card, null); pick([a.hit], x, y);   // (sets the tap's ray; a tap that misses the products no longer jumps to the aisle behind the shelf)
    // a tap past the end of the shelf, on the hall you can see beyond it, walks you back out to the hall (owner, 2026-11-11: "When clicking here I should be able to go back into the aisle again")
    const dx = ray.ray.direction.x, px = aCx(a.i) + (dx > 0 ? 1.0 : -1.0); if (Math.abs(dx) > .05) { const t = (px - ray.ray.origin.x) / dx, z = ray.ray.origin.z + ray.ray.direction.z * t; if (t > 0 && z > hall.zf + .05) return go('aisles'); }
    return; }
  else if (S.mode === 'rack') {
    const r = racks[S.rack];
    if (r.kind === 'kits') { const h = pick(r.meshes.filter((m) => m.visible), x, y); if (h) return lift(h.object.userData.card, null); }
    else { const k = potAt(r, x, y); if (k > -1) return openPaint(r.shown[k]); if (psel.g) return closePaint(); }
    const o = pick(racks.map((q) => q.hitM), x, y); if (o && o.object.userData.rack !== S.rack) return goRack(o.object.userData.rack);
    return;
  }
  else if (S.mode === 'crate' && cr) { const h = pick(cr.faces.filter((f) => f.visible), x, y); if (h) { const i = h.object.userData.idx, at = Math.round(cr.ps[cr.lane]); if (i === at) lift(cr.lanes[cr.lane][i], null); else flickTo(i); return; }
    // whichever is nearer under the finger: a letter tab, or the end-of-row sign standing behind the tabs (a tap on a
    // tab went through to the sign and thumbed to the back of the row - owner, 2026-11-12)
    const dv = pick((cr.divs || []).filter((m) => m.visible), x, y), es = cr.endSign && cr.endSign.visible ? pick([cr.endSign], x, y) : null;
    if (es && (!dv || es.distance < dv.distance)) { if (Math.round(cr.ps[cr.lane]) >= cr.lanes[cr.lane].length) endGo(); else flickTo(cr.lanes[cr.lane].length, 420); return; }
    if (dv) { const u = dv.object.userData; if (u.lane !== cr.lane) { cr.lane = u.lane; ui(); } flickTo(u.idx, 420); hint(u.ch === '#' ? 'Numbers' : 'The ' + u.ch + 's'); return; } }
  const h = pick(hot, x, y); if (h && !(S.mode === 'crate' && cr && cr.kind === h.object.userData.act)) act(h.object.userData.act);
}
/* ---------- leaning in (owner, 2026-11-09): "an elastic pinch to zoom ... without picking up the card
   and as soon as you let it go it zooms back out, like leaning in to read the card titles better".
   At the glass case two fingers pinch the camera towards the spot between them; on a desktop holding
   the mouse button down (or a trackpad pinch) does it. Letting go springs back. The camera moves along
   the line of sight to that spot, so the spot stays under the fingers, and the cards around it take a
   sharper picture while you are close. */
const lean = { k: 0, P: null, on: false, id: 0 };
const pts = new Map(); let pinch = null, wheelLean = 0;
// the same lean at the graded cabinet (owner, 2026-11-10: "graded cards should also allow me to pinch zoom elastic like the counter")
const leanBase = () => (S.mode === 'graded' ? gradedView() : S.mode === 'aisle' ? aisleView() : S.mode === 'boxes' ? wallView() : caseView());
const leanable = () => S.mode === 'case' || S.mode === 'graded' || S.mode === 'aisle' || (S.mode === 'boxes' && S.focus === 'sealed');   // the sealed wall too (owner, 2026-11-11: "You should be able to pinch zoom before picking one up")
function leanView() { const v = leanBase(); if (lean.P && lean.k) v.pos.lerp(lean.P, (S.mode === 'graded' ? .55 : .6) * lean.k); return v; }
function leanStart(x, y) {
  const gr = S.mode === 'graded', ai = S.mode === 'aisle', sw = S.mode === 'boxes';
  if (!leanable() || S.hand || tw || (S.mode === 'case' && !S.lay.length)) return false;
  if (ai) { hall.walk = (hall.walk || 0) + 1; S.avz = 0; }
  if (!lean.on) {
    setView(leanBase());
    cam.position.copy(view.pos); cam.rotation.set(view.pitch, view.yaw, 0); cam.updateMatrixWorld();
    const h = pick(sw ? sealMeshes.filter((m) => m.visible) : ai ? Array.from(hall.list[S.aisle].live.values()).filter((m) => m.visible) : gr ? gcab.meshes.filter((m) => m.visible) : caseCards.filter((m) => m.visible && m.userData.si === S.shelf), x, y);
    lean.P = h ? h.point.clone() : ray.ray.at(view.dist || .45, new V3());
    if (gr && !h) { const px = gcab.at[0] + .2, dx = ray.ray.direction.x; if (Math.abs(dx) > .01) lean.P = ray.ray.at((px - ray.ray.origin.x) / dx, new V3()); }   // between two slabs: the spot on the slabs' own plane, not past it (live probe 42802013535)
    const wp = new V3();
    if (gr || ai || sw) (sw ? sealMeshes : ai ? Array.from(hall.list[S.aisle].live.values()) : gcab.meshes).forEach((m) => { const u = m.userData; if (u.hi || !m.visible || m.getWorldPosition(wp).distanceTo(lean.P) > (ai || sw ? .5 : .32)) return; u.hi = true;   // the slabs around the spot take a sharper picture
      cardTex(u.card, 512).then((t) => { const old = m.material.map; m.material.map = t; m.material.needsUpdate = true; if (old && !old.userData.keep) old.dispose(); kick(); }).catch(() => {}); });
    else caseCards.forEach((m) => { const u = m.userData; if (u.si === S.shelf && !u.hi && m.position.distanceTo(lean.P) < .14) { u.hi = u.has = true; wear(m, u.card, 512); } });
  }
  lean.on = true; lean.id++; S.vx = 0; hint(''); return true;
}
function leanTo(k) { lean.k = k; setView(leanView()); }
function leanAnim(to, ms) {
  const id = ++lean.id, from = lean.k, t0 = performance.now();
  anims.push((now) => { if (lean.id !== id) return false; const t = Math.min(1, (now - t0) / (reduce ? 1 : ms)), e = 1 - Math.pow(1 - t, 3); lean.k = lerp(from, to, e); if (leanable() && !tw) setView(leanView()); if (t >= 1 && !to) lean.on = false; return t < 1; }); kick();
}
function leanOff() { lean.id++; lean.k = 0; lean.on = false; pinch = null; }
// the stretch between the fingers, with give at both ends
function elastic(scale) { const r = (scale - 1) / 1.1; return r > 1 ? Math.min(1.12, 1 + (r - 1) * .15) : r < 0 ? Math.max(-.08, r * .1) : r; }
let drag = null;
// A swipe that starts at the very edge of a phone's screen is the browser's "back" gesture: thumbing left from
// a box's first lane took you out of the shop to the page before it (owner, 2026-11-10: "if I am in left most
// lane of the box if I go left again it goes to the showcase"). A touch that starts there stays ours.
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t && (t.clientX < 28 || t.clientX > innerWidth - 28)) e.preventDefault(); }, { passive: false });
canvas.addEventListener('pointerdown', (e) => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2 && !pinch && S.hand && S.hand.slab) { if (drag) clearTimeout(drag.holdT); drag = null; pts.clear(); slabZoom(); return; }
  if (pts.size === 2 && !pinch) {
    const a = Array.from(pts.values());
    if (leanStart((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2)) { pinch = { d0: Math.max(30, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)), k0: lean.k }; if (drag) clearTimeout(drag.holdT); drag = null; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} return; }
  }
  if (pinch || pts.size > 1) return;
  if (e.button && e.button !== 0) return;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, axis: '', lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), v: 0, walk: S.walk, pan: S.pan, yaw: S.look.yaw, pitch: S.look.pitch, p: cr ? cr.ps[cr.lane] : 0, rx: hand.rx, ry: hand.ry, gx: gcab.gx, gy: gcab.gy, as: S.as || 0, hx: S.hx || 0, sx: arc.x, fp: fan.p, ssx: S.sx || 0, ssy: S.sy || 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
  S.vx = 0; if (cr) cr.anim = (cr.anim || 0) + 1;
  // a mouse held still on the case leans in to that spot
  if (e.pointerType === 'mouse' && leanable() && !S.hand) { const d = drag; d.holdT = setTimeout(() => { if (drag === d && !d.moved && leanStart(d.x0, d.y0)) { d.lean = true; leanAnim(1, 320); } }, 280); }
});
canvas.addEventListener('pointermove', (e) => {
  if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) { const a = Array.from(pts.values()); if (a.length >= 2) { lean.id++; leanTo(clamp(pinch.k0 + elastic(Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / pinch.d0), -.08, 1.12)); } return; }
  if (drag && drag.lean) return;
  if (!drag || e.pointerId !== drag.id) {   // a mouse over the held card tilts it
    if (S.hand && e.pointerType === 'mouse' && !reduce) { const st = stage(); hand.tx = clamp(((e.clientY - st.h / 2) / st.h) * -.5, -.3, .3); hand.ty = (Math.abs(hand.ty) > PI / 2 ? PI : 0) + clamp(((e.clientX - st.w / 2) / st.w) * .6, -.35, .35); kick(); }
    return;
  }
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, now = performance.now(), dt = Math.max(1, now - drag.lastT);
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 7) { drag.moved = true; clearTimeout(drag.holdT); drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'; if (tw && !S.hand) { drag.axis = 'none'; } hand.drag = !!S.hand; }
  if (!drag.moved) return;
  if (S.hand) { hand.ry = drag.ry + dx * .011; hand.rx = clamp(drag.rx + dy * .006, -.6, .6); kick(); }
  else if (drag.axis === 'none') { /* a glide is running */ }
  else if (S.mode === 'graded') { const mpp = (gcab.vw || 1) / canvas.clientWidth; gcab.gx = drag.gx - dx * mpp; gcab.gy = drag.gy + dy * mpp; setView(gradedView()); }
  else if (S.mode === 'ask') { if (drag.axis === 'x' && fan.rows.length) { fan.walk = (fan.walk || 0) + 1; fan.p = clamp(drag.fp - dx / ((fan.cardPx || 160) * .5), -.3, fan.rows.length - .7); askBar(); kick(); } }
  else if (S.mode === 'stack') { if (drag.axis === 'x') { const n = Math.round(dx * 240 / (.5 / (2 * (view.dist || .6) * hTan(view.fov)) * canvas.clientWidth) / 14); let m = n - (drag.cells || 0); while (m) { const st = m > 0 ? 1 : -1; stkMove(st); m -= st; } drag.cells = n; } }
  else if (S.mode === 'arcade') { arc.x = clamp(drag.sx + dx * arc.W / (.5 / (2 * (view.dist || .6) * hTan(view.fov)) * canvas.clientWidth), 10, arc.W - 10); }
  else if (S.mode === 'aisles') {
    if (drag.axis === 'x') { const v = aislesView(); v.yaw += clamp(dx * .0014, -.3, .3); setView(v); }   // the view leans with the finger; letting go steps to the next stop
  }
  else if (S.mode === 'aisle') {   // the shelf follows the finger, as the glass case does
    if (drag.axis === 'x') { const a = hall.list[S.aisle], mpp = 2 * aisleHalf() / canvas.clientWidth * (a.flip ? -1 : 1); hall.walk = (hall.walk || 0) + 1; S.as = clamp(drag.as - dx * mpp, 0, a.smax); drag.v = (drag.lastX - e.clientX) * mpp / dt * 16; setView(aisleView()); aisleBar(); }
  }
  else if (S.mode === 'door') { S.look.yaw = clamp(drag.yaw + dx * .004, -1.5, 1.5); S.look.pitch = clamp(drag.pitch + dy * .003, -.45, .4); setView(doorView()); }
  else if (S.mode === 'case' && drag.axis === 'x') { const mpp = visW() / canvas.clientWidth; S.walk = clamp(drag.walk - dx * mpp, -.03, (S.maxWalk || 0) + .03); drag.v = (drag.lastX - e.clientX) * mpp / dt * 16; setView(caseView0()); }
  else if (S.mode === 'boxes' && S.focus === 'sealed') { const mpp = (sealed.vw || 1) / canvas.clientWidth; S.sx = drag.ssx - dx * mpp; S.sy = drag.ssy + dy * mpp; setView(sealedView()); }
  else if (S.mode === 'boxes' && drag.axis === 'x') { const v = wallView(); S.pan = clamp(drag.pan - dx * v.vw / canvas.clientWidth, -S.maxPan, S.maxPan); setView(wallView()); }
  else if (S.mode === 'crate' && cr && drag.axis === 'y') { const max = laneMax(cr, cr.lane); cr.ps[cr.lane] = clamp(drag.p + dy / 46, -.3, max + .3); drag.v = (e.clientY - drag.lastY) / 46 / dt * 16; updateCrate(cr); setView(crateView(cr)); }
  drag.lastX = e.clientX; drag.lastY = e.clientY; drag.lastT = now; drag.x = e.clientX; drag.y = e.clientY;
});
// the walk without clamping the rubber band at the ends away
function caseView0() { const w = S.walk, v = caseView(); if (w !== S.walk) { v.pos.x += (w - S.walk) * .5; } return v; }
function endDrag(e) {
  pts.delete(e.pointerId);
  if (pinch) { pinch = null; leanAnim(0, 300); return; }   // let go: back out
  if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; hand.drag = false;
  clearTimeout(d.holdT); if (d.lean) { leanAnim(0, 300); return; }
  const dx = d.x - d.x0, dy = d.y - d.y0;
  if (!d.moved) { if (performance.now() - d.t < 600) tap(e.clientX, e.clientY); return; }
  if (S.hand) { const was = Math.round(d.ry / PI), two = hand.back.visible; hand.ty = (two && Math.abs(dx) > 45 && Math.round(hand.ry / PI) === was ? was + (dx > 0 ? 1 : -1) : Math.round(hand.ry / PI)) * PI; hand.tx = 0;   /* a sideways swipe turns it over (owner, 2026-11-12), a longer drag as before */ hand.ry = hand.ry; kick(); return; }   // it settles on its nearer face
  if (d.axis === 'none') return;
  hint('');
  if (S.mode === 'hobby' && hall.paints) { if (d.axis === 'x' && Math.abs(dx) > 36) { S.mode = 'aisles'; S.hs = hall.iW; hallStep(dx < 0 ? 1 : -1); } return; }   /* the paints view is in the hall: a swipe walks on along the aisles */
  if (S.mode === 'ask') { fanTo(Math.round(fan.p + clamp(-(d.x - d.x0) * .002, -.6, .6))); return; }
  if (S.mode === 'stack') { if (d.axis === 'y' && dy > 40) stkDown(true); return; }
  if (S.mode === 'aisles') { if (d.axis === 'x' && Math.abs(dx) > 36) hallStep(dx < 0 ? 1 : -1); else glide(aislesView(), 260); return; }
  if (S.mode === 'aisle') {
    if (d.axis !== 'x') return;
    S.avz = clamp(d.v, -.12, .12); const id = hall.walk = (hall.walk || 0) + 1;
    anims.push(() => { if (S.mode !== 'aisle' || drag || tw || lean.on || hall.walk !== id) return false; S.avz *= .94; S.as = clamp((S.as || 0) + S.avz, 0, hall.list[S.aisle].smax); setView(aisleView()); aisleBar(); return Math.abs(S.avz) > .0006; }); kick(); return;
  }
  if (S.mode === 'case') {
    if (d.axis === 'y') { if (Math.abs(dy) > 44) goShelf(S.shelf + (dy < 0 ? 1 : -1)); return; }
    S.vx = clamp(d.v, -.06, .06);
    anims.push(() => { if (S.mode !== 'case' || drag || tw || lean.on) return false; S.vx *= .93; S.walk = clamp(S.walk + S.vx, 0, S.maxWalk || 0); setView(caseView()); return Math.abs(S.vx) > .0004; }); kick();
  } else if (S.mode === 'crate' && cr) {
    if (d.axis === 'x') { if (Math.abs(dx) > 50) crateLane(dx < 0 ? 1 : -1); return; }
    flickTo(cr.ps[cr.lane] + clamp(d.v * 6, -8, 8), 260 + Math.min(400, Math.abs(d.v) * 900));
  }
}
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
let wheelLock = false;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); if (S.hand || tw) return;
  if (leanable() && e.ctrlKey) {   // a trackpad pinch arrives as ctrl + wheel: lean while it lasts, back out when it stops
    if (!leanStart(e.clientX, e.clientY)) return; lean.id++; leanTo(clamp(lean.k - e.deltaY * .012, -.05, 1.1));
    clearTimeout(wheelLean); wheelLean = setTimeout(() => leanAnim(0, 320), 260); return;
  }
  if (lean.on) return;
  if (S.mode === 'ask') { if (wheelLock || !fan.rows.length) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 110); fanTo(Math.round(fan.p) + ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 1 : -1), 140); return; }
  if (S.mode === 'aisles') { const dl = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (wheelLock || Math.abs(dl) < 12) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 620); hallStep(dl > 0 ? 1 : -1); return; }
  if (S.mode === 'aisle') { aisleWalk((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * .0035 * (hall.list[S.aisle].flip ? -1 : 1)); return; }
  if (S.mode === 'graded') { gcab.gx += e.deltaX * .002; gcab.gy -= e.deltaY * .002; setView(gradedView()); return; }
  if (S.mode === 'case') { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { S.walk = clamp(S.walk + (e.shiftKey ? e.deltaY : e.deltaX) * .0012, 0, S.maxWalk || 0); setView(caseView()); return; } if (wheelLock || Math.abs(e.deltaY) < 12) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 560); goShelf(S.shelf + (e.deltaY > 0 ? 1 : -1)); }
  else if (S.mode === 'crate' && cr) { if (wheelLock) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 90); flickTo(Math.round(cr.ps[cr.lane]) + (e.deltaY > 0 ? 1 : -1), 160); }
  else if (S.mode === 'boxes' && S.focus === 'sealed') { S.sx = (S.sx || 0) + e.deltaX * .002; S.sy = (S.sy || 0) - e.deltaY * .002; setView(sealedView()); }
  else if (S.mode === 'boxes') { S.pan = clamp(S.pan + (e.deltaX || e.deltaY) * .0015, -S.maxPan, S.maxPan); setView(wallView()); }
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if ($('#prodv').classList.contains('on')) { if (e.key === 'Escape') closeProduct(); else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const g = $('#pgal'); if (g) prodShot(Math.round(g.scrollLeft / Math.max(1, g.clientWidth)) + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault(); } return; }
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') back(); return; }
  if (e.key === 'Escape') { back(); return; }
  if (S.hand) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { hand.ty = Math.abs(hand.ty) > PI / 2 ? 0 : PI; kick(); e.preventDefault(); } return; }
  const k = e.key;
  if (S.mode === 'ask') { if (k === 'ArrowRight' || k === 'ArrowLeft') fanTo(Math.round(fan.p) + (k === 'ArrowRight' ? 1 : -1)); else if (k === 'Enter' && fan.rows.length) lift(fan.rows[clamp(Math.round(fan.p), 0, fan.rows.length - 1)], null); else return; e.preventDefault(); return; }
  if (S.mode === 'aisles') { if (k === 'ArrowRight' || k === 'ArrowLeft') hallStep(k === 'ArrowRight' ? 1 : -1); else if (k === 'Enter' && S.hs >= 0) goAisle(S.hs); else return; e.preventDefault(); return; }
  if (S.mode === 'aisle') { if (k === 'ArrowRight' || k === 'ArrowLeft') aisleTo((S.as || 0) + (k === 'ArrowRight' ? 1.2 : -1.2) * (hall.list[S.aisle].flip ? -1 : 1), 300); else if (k === 'ArrowDown' || k === 'ArrowUp') goSec(clamp(aisleSec().j + (k === 'ArrowDown' ? 1 : -1), 0, hall.list[S.aisle].secs.length - 1)); else if (k === 't' || k === 'T') aisleTurn(); else return; e.preventDefault(); hint(''); return; }
  if (S.mode === 'case') { if (k === 'ArrowRight' || k === 'ArrowLeft') { S.walk = clamp(S.walk + (k === 'ArrowRight' ? .2 : -.2), 0, S.maxWalk || 0); glide(caseView(), 260); } else if (k === 'ArrowDown') goShelf(S.shelf + 1); else if (k === 'ArrowUp') goShelf(S.shelf - 1); else return; }
  else if (S.mode === 'crate' && cr) { if (k === 'ArrowDown' || k === 'ArrowUp') flickTo(Math.round(cr.ps[cr.lane]) + (k === 'ArrowDown' ? 1 : -1)); else if (k === 'ArrowRight' || k === 'ArrowLeft') crateLane(k === 'ArrowRight' ? 1 : -1); else if (k === 'Enter') { const cd = cr.lanes[cr.lane][Math.round(cr.ps[cr.lane])]; if (cd) lift(cd, null); else endGo(); } else return; }
  else if (S.mode === 'boxes' && S.focus === 'sealed') { if (k === 'ArrowRight' || k === 'ArrowLeft') S.sx = (S.sx || 0) + (k === 'ArrowRight' ? .3 : -.3); else if (k === 'ArrowUp' || k === 'ArrowDown') S.sy = (S.sy || 0) + (k === 'ArrowUp' ? .3 : -.3); else return; glide(sealedView(), 240); }
  else if (S.mode === 'boxes') { if (k === 'ArrowRight' || k === 'ArrowLeft') { S.pan = clamp(S.pan + (k === 'ArrowRight' ? .3 : -.3), -S.maxPan, S.maxPan); glide(wallView(), 260); } else return; }
  else return;
  e.preventDefault(); hint('');
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-go')) go(b.getAttribute('data-go'));
  else if (b.hasAttribute('data-game')) load(b.getAttribute('data-game'));
  else if (b.hasAttribute('data-shelf')) goShelf(Number(b.getAttribute('data-shelf')));
  else if (b.hasAttribute('data-walk')) { S.walk = clamp(S.walk + .3 * Number(b.getAttribute('data-walk')), 0, S.maxWalk || 0); glide(caseView(), 320); hint(''); }
  else if (b.hasAttribute('data-set')) openSet(Number(b.getAttribute('data-set')));
  else if (b.hasAttribute('data-copy')) pickCopy(Number(b.getAttribute('data-copy')));
  else if (b.hasAttribute('data-mini')) { const c = minis[Number(b.getAttribute('data-mini'))]; if (c) { if (S.handSrc) S.handSrc.visible = true; lift(c, null); } }
  else if (b.hasAttribute('data-rack')) goRack(Number(b.getAttribute('data-rack')))
  else if (b.hasAttribute('data-popt')) { psel.it = psel.g.items[Number(b.getAttribute('data-popt'))]; drawPaint(); }
  else if (b.hasAttribute('data-pmatch')) { const g = paints.all[Number(b.getAttribute('data-pmatch'))]; if (g) openPaint(g); }
  else if (b.id === 'pbuy') buyPaint(b);
  else if (b.id === 'paintX') closePaint();
  else if (b.id === 'rackBack') back();
  else if (b.hasAttribute('data-aisle')) goAisle(Number(b.getAttribute('data-aisle')));
  else if (b.id === 'aiBack') go('aisles');
  else if (b.hasAttribute('data-sec')) goSec(Number(b.getAttribute('data-sec')));
  else if (b.id === 'aiTurn') aisleTurn();
  else if (b.hasAttribute('data-drop')) { S.pile.splice(Number(b.getAttribute('data-drop')), 1); pile(); showTill(); }
  else if (b.id === 'hz') slabZoom();
  else if (b.id === 'buy') buy(b);
  else if (b.id === 'capBuy') capBuy(b);
  else if (b.id === 'x') putBack();
  else if (b.id === 'pull') sheet(!$('#panel').classList.contains('open'));
  else if (b.id === 'linBack' || b.id === 'dnkBack' || b.id === 'askBack' || b.id === 'arcBack' || b.id === 'stkBack' || b.id === 'tvBack' || b.id === 'crBack' || b.id === 'setsBack' || b.id === 'tillBack') back();
  else if (b.id === 'crPrevSet') openSet(boxes.setIdx - 1);
  else if (b.id === 'crNextSet') openSet(boxes.setIdx + 1);
  else if (b.id === 'crLaneL') crateLane(-1);
  else if (b.id === 'crLaneR') crateLane(1);
});
$('#setsFind').addEventListener('input', function () { listSets(this.value); });
function sheet(on) { $('#panel').classList.toggle('open', !!on); if (!on) $('#panel').scrollTop = 0; }

/* ---------- loading a game ---------- */
function load(game) {
  if (S.busy) return; S.busy = true; const st = $('#state'); if (S.shelves.length) hint('Changing the case…');
  fetch(W + '/showcase.json?game=' + encodeURIComponent(game || ''), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    S.busy = false;
    if (!d || !d.ok) { st.classList.remove('off'); st.textContent = 'The shop is locked right now - the feed did not answer. Try again in a minute.'; return; }
    if (S.hand) putBack();
    S.cases = d.cases || []; S.icons = d.icons || []; S.game = d.game; S.shelves = d.shelves || []; S.shelf = 0; S.walk = 0; S.vx = 0; S.idf = null; S.ext = []; boxes.open = null; cr = null; kill(setCrate && setCrate.g); setCrate = null;
    try { history.replaceState(null, '', location.pathname + '?game=' + encodeURIComponent(d.game)); } catch (x) {}
    tabs(); buildCase(); buildBin(); loadBoxes(); loadSealed(); loadLogos(); st.classList.add('off');
    go(S.mode === 'case' ? 'case' : 'door');
  }).catch(() => { S.busy = false; st.classList.remove('off'); st.textContent = 'Could not reach the shop. Try again in a minute.'; });
}
fonts.then(() => { buildRoom(); buildCabinet(); buildNineties(); loadKits(); loadPaints(); resize(); load(new URLSearchParams(location.search).get('game') || ''); });
window.xgShop = { gcab, hall, lin, linTap, linDraw, linStepT: linStep, dnk, dnkTap, dnkThrow, dnkDraw, askFor, fan, fanTo, openProduct, prod, arc, arcTap, stk, stkTap, stkMove, stkDown, tv, tvDraw, flagList, hallTo, hallStep, goAisle, goSec, aisleTurn, aisleTo, aisleWalk, aisleSec, racks, paints, psel, goRack, openPaint, closePaint, potAt, lean, leanStart, leanTo, leanAnim, pick, tap, hot, S, go, goShelf, lift, putBack, flickTo, crateLane, openBox, openSet, toggleLights, ding, view, get crate() { return cr; }, get cards() { return caseCards; }, get boxMeshes() { return boxMeshes; }, get sealMeshes() { return sealMeshes; }, cam, kick };
