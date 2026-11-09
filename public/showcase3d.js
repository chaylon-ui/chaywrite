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

const S = { mode: 'door', game: '', cases: [], icons: [], shelves: [], lay: [], shelf: 0, walk: 0, vx: 0, x0: -1, caseLen: 2, pan: 0, look: { yaw: 0, pitch: 0 }, hand: null, handSrc: null, pile: [], ext: [], idf: null, busy: false, eve: 0 };

/* ---------- renderer, camera, the draw-on-demand loop ---------- */
const canvas = $('#gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (x) { window.xgFlat(); throw x; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0809);
const cam = new THREE.PerspectiveCamera(60, 1, .02, 30); cam.rotation.order = 'YXZ'; scene.add(cam);
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
  if (S.mode === 'case') caseTextures(now);
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
function drawCard(g, w, h, c, im) {
  const q = seed(keyOf(c) + '|st');
  g.clearRect(0, 0, w, h); rr(g, 0, 0, w, h, w * .03); g.fillStyle = '#d7dfe2'; g.fill();
  const m = w * .05, x = m, y = m * 1.6, cw = w - 2 * m, chh = h - y - m;
  g.save(); rr(g, x, y, cw, chh, w * .035); g.clip();
  if (im) { const s = Math.max(cw / im.width, chh / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, x + (cw - iw) / 2, y + (chh - ih) / 2, iw, ih); }
  else { g.fillStyle = '#241a1c'; g.fillRect(x, y, cw, chh); g.fillStyle = '#e8dcb8'; g.font = Math.round(w * .1) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; wrapText(g, c.name, x + cw / 2, y + chh * .42, cw * .86, w * .125, 5); }
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
function cutWhite(g, w, h) {
  let d; try { d = g.getImageData(0, 0, w, h); } catch (x) { return null; }
  const px = d.data, seen = new Uint8Array(w * h), st = [];
  const white = (i) => px[i * 4 + 3] < 16 || (px[i * 4] > 232 && px[i * 4 + 1] > 232 && px[i * 4 + 2] > 232);
  const push = (i) => { if (!seen[i] && white(i)) { seen[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const i = st.pop(), x = i % w; px[i * 4 + 3] = 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
  // soften the cut: a kept pixel beside a cleared one goes half see-through
  for (let i = 0; i < w * h; i++) { if (seen[i]) continue; const x = i % w; if ((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (i >= w && seen[i - w]) || (i < w * (h - 1) && seen[i + w])) px[i * 4 + 3] = Math.min(px[i * 4 + 3], 150); }
  g.putImageData(d, 0, 0);
  // where the box itself is, so the sticker can sit on its corner
  let x0 = w, y0 = h, x1 = 0, y1 = 0; for (let i = 0; i < w * h; i++) { if (seen[i]) continue; const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}
function drawSealed(g, w, h, c, im) {
  g.clearRect(0, 0, w, h); let bb = null;
  if (im) { const s = Math.min(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih); bb = cutWhite(g, w, h); }
  else { g.fillStyle = '#e6e1d2'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a1c0e'; g.font = Math.round(w * .09) + 'px "Permanent Marker", cursive'; g.textAlign = 'center'; wrapText(g, c.name, w / 2, h * .4, w * .84, w * .11, 5); }
  sticker(g, w, gunPrice(c.price), { font: '700 ' + Math.round(w * .09) + 'px "Cutive Mono", monospace', ink: '#1b2a55', y: bb ? Math.max(h * .01, bb.y0 + (bb.y1 - bb.y0) * .08) : h * .03, right: bb ? Math.min(w - w * .01, bb.x1 + w * .02) : null, rot: (seed(keyOf(c) + '|st')() - .5) * .14 });
}
async function cardTex(c, w) {
  await fonts; let im = null;
  if (hasPhoto(c)) { try { im = await loadImg(img(c.image, w > 300 ? 1000 : (c.sealed ? 500 : 300))); } catch (x) {} }
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
let hemi, sun, lampL, tubeM, shadeM, bell, pileG, signT, neonL, neonHalo;
function poster(w, h, draw) { return new THREE.MeshLambertMaterial({ map: ctex(w, h, draw) }); }
function buildRoom() {
  hemi = new THREE.HemisphereLight(0xfff3dc, 0x4a3a2c, 2.6); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(1.5, 4, 3); scene.add(sun);
  lampL = new THREE.PointLight(0xffc27a, 0, 6, 1.6); lampL.position.set(2.2, 1.35, -.85); scene.add(lampL);
  const floor = pl(8, 7, lam({ map: ctex(256, 256, drawCarpet, [9, 8]) }), 0, 0, 0); floor.rotation.x = -PI / 2;
  const ceil = pl(8, 7, lam({ map: ctex(128, 128, drawCeil, [13, 12]) }), 0, 2.9, 0); ceil.rotation.x = PI / 2;
  const wallM = lam({ map: ctex(512, 1024, drawWall, [8, 1]) });
  pl(8, 2.9, wallM, 0, 1.45, -3.5, 0); pl(8, 2.9, wallM, 0, 1.45, 3.5, PI); pl(7, 2.9, wallM, -4, 1.45, 0, PI / 2); pl(7, 2.9, wallM, 4, 1.45, 0, -PI / 2);
  // fluorescent tubes
  tubeM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.6], [1.8, 1.6]].forEach((p) => { bx(1.3, .05, .3, lam({ color: 0xbdb8a8 }), p[0], 2.875, p[1]); bx(1.2, .03, .06, tubeM, p[0], 2.84, p[1] - .07); bx(1.2, .03, .06, tubeM, p[0], 2.84, p[1] + .07); });
  // the front door behind you: daylight through the glass, the OPEN sign seen from inside
  pl(1.05, 2.15, poster(256, 512, (g, w, h) => { g.fillStyle = '#3a200d'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#dfeaf2'); gr.addColorStop(.6, '#b9c9bf'); gr.addColorStop(1, '#8b8f84'); g.fillStyle = gr; g.fillRect(22, 22, w - 44, h - 120); g.fillStyle = '#c0392b'; g.fillRect(70, 120, 116, 56); g.fillStyle = '#fff'; g.font = '700 34px Inter, sans-serif'; g.textAlign = 'center'; g.save(); g.translate(128, 160); g.scale(-1, 1); g.fillText('OPEN', 0, 0); g.restore(); g.fillStyle = '#b08a3a'; g.fillRect(w - 44, h * .55, 14, 46); }), 1.7, 1.075, 3.49, PI);
  // posters and notes
  pl(.62, .86, poster(360, 500, (g, w, h) => { g.fillStyle = '#1f2a6b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c230'; g.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * PI * 2, r = i % 2 ? 150 : 115; g.lineTo(w / 2 + Math.cos(a) * r, 185 + Math.sin(a) * r); } g.fill(); g.fillStyle = '#c0392b'; g.font = '36px "Permanent Marker", cursive'; g.textAlign = 'center'; g.fillText('FRIDAY', w / 2, 170); g.fillText('NIGHT', w / 2, 212); g.fillStyle = '#fff'; g.font = '700 40px Inter, sans-serif'; g.fillText('TOURNAMENT', w / 2, 390); g.font = '600 24px Inter, sans-serif'; g.fillText('7 PM · sign up at the counter', w / 2, 432); g.fillStyle = '#2fd0c5'; g.fillRect(30, 455, w - 60, 8); }), -3.99, 1.8, -.7, PI / 2);
  pl(.7, .5, poster(420, 300, (g, w, h) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = '700 62px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('WE BUY', w / 2, 110); g.fillText('CARDS', w / 2, 180); g.font = '30px "Permanent Marker", cursive'; g.fillStyle = '#c0392b'; g.fillText('cash or store credit', w / 2, 245); }), -3.99, 1.75, .9, PI / 2);
  pl(.42, .56, poster(300, 400, (g, w, h) => { g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d3a8a'; g.font = '700 34px Caveat, cursive'; g.textAlign = 'center'; ['Please ask before', 'opening the case.', '', 'No drinks near', 'the cards!', '', '— thanks, mgmt'].forEach((l, i) => g.fillText(l, w / 2, 70 + i * 44)); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(w / 2, 20, 9, 0, PI * 2); g.fill(); }), 3.99, 1.7, -1.5, -PI / 2);
  pl(1.1, .75, poster(550, 375, (g, w, h) => { g.fillStyle = '#9a6b3c'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, ['#7d5329', '#b98a55', '#8a5f33'], .7); g.strokeStyle = '#4a2a12'; g.lineWidth = 16; g.strokeRect(0, 0, w, h); const r = seed('cork'); [['WANTED:', 'old collections'], ['Sleeves', '2 for $5'], ['League', 'Tuesdays 6pm'], ['Lost binder?', 'ask at the till']].forEach((n, i) => { g.save(); g.translate(90 + i * 125, 110 + (i % 2) * 130); g.rotate((r() - .5) * .2); g.fillStyle = ['#f6f1e2', '#f7e98e', '#cfe6f5', '#f6c9d0'][i]; g.fillRect(-55, -50, 110, 100); g.fillStyle = '#1d3a8a'; g.font = '700 22px Caveat, cursive'; g.textAlign = 'center'; g.fillText(n[0], 0, -8); g.fillText(n[1], 0, 20); g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, -40, 6, 0, PI * 2); g.fill(); g.restore(); }); }), 3.99, 1.65, .8, -PI / 2);
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
  pl(.14, .035, new THREE.MeshBasicMaterial({ map: ctex(140, 35, (g, w, h) => { g.fillStyle = '#0d1a0d'; g.fillRect(0, 0, w, h); g.fillStyle = '#5dff7a'; g.font = '700 26px "Cutive Mono", monospace'; g.textAlign = 'right'; g.fillText('0.00', w - 8, 27); }) }), 0, .175, -.1705, PI, till);
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
  // a wall switch by the cork board does the same
  bx(.01, .12, .08, lam({ color: 0xe9e4d4 }), 3.985, 1.3, -.2); hit(bx(.04, .2, .16, hitM, 3.97, 1.3, -.2), 'lights');
  pileG = new THREE.Group(); pileG.position.set(1.7, TOP, -1.0); scene.add(pileG);
  buildHobby();
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
  ball(.105, skin, 0, 1.69, 0, 1.14);                                         // head
  const hr = new THREE.Mesh(new THREE.SphereGeometry(.111, 20, 12, 0, PI * 2, 0, PI * .5), hair); hr.position.set(0, 1.705, -.012); hr.scale.y = 1.1; g.add(hr);
  const bd = new THREE.Mesh(new THREE.SphereGeometry(.094, 20, 12, 0, PI, PI * .56, PI * .44), hair); bd.position.set(0, 1.69, .016); bd.scale.y = 1.2; g.add(bd);   // a short beard
  [-1, 1].forEach((sd) => {
    ball(.011, lam({ color: 0x1a1a1a }), sd * .038, 1.705, .096);
    const gl = new THREE.Mesh(new THREE.TorusGeometry(.027, .0045, 8, 20), lam({ color: 0x111111 })); gl.position.set(sd * .039, 1.705, .103); g.add(gl);
  });
  bx(.026, .005, .005, lam({ color: 0x111111 }), 0, 1.708, .106, g);          // the bridge of the glasses
  const sm = new THREE.Mesh(new THREE.TorusGeometry(.03, .0045, 6, 14, PI * .7), lam({ color: 0x7a3b2a })); sm.position.set(0, 1.668, .094); sm.rotation.z = PI + PI * .15; g.add(sm);   // a smile
  // the logo on the chest: the shop's own when the CDN lets us draw it, the name until then
  const drawLogo = (im) => (c, w, h) => { c.clearRect(0, 0, w, h); if (im) { const s = Math.min(w / im.width, h / im.height); c.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s); } else { c.fillStyle = '#e23b2e'; c.font = '700 54px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('EXOR', w / 2, h * .32); c.fillStyle = '#f2c230'; c.fillText('GAMES', w / 2, h * .72); } };
  const lt = ctex(256, 160, drawLogo(null)), lg = pl(.1, .0625, new THREE.MeshBasicMaterial({ map: lt, transparent: true }), .085, 1.36, .123, .3, g);
  lg.userData.card = false;
  loadImg(img(LOGO, 300)).then((im) => { drawLogo(im)(lt.image.getContext('2d'), 256, 160); lt.needsUpdate = true; kick(); }).catch(() => {});
  hit(bx(.5, .95, .3, hitM, 2.12, 1.4, -1.62), 'staff');
}
/* ---------- the hobby corner (owner, 2026-11-09): "add warhammer paint rack, vallejo, and army painter ...
   as well as a rack with boxes of Warhammer product", in the back left corner. The paint racks are scenery:
   black wire racks with a header board and rows of little pots or dropper bottles running through the
   colours. The fourth rack holds the newest Warhammer kits in stock (/showcase/wargames.json) as cut-outs
   you can pick up, like the booster boxes. */
let kitG = null, kitMeshes = [];
function paintRack(o) {
  const g = new THREE.Group(), black = lam({ color: 0x151515 }), dummy2 = new THREE.Object3D(), col = new THREE.Color();
  bx(o.w, .06, .34, black, 0, .03, .17, g); bx(o.w, o.h, .02, black, 0, o.h / 2, .01, g);
  bx(.025, o.h, .3, black, -o.w / 2 + .012, o.h / 2, .15, g); bx(.025, o.h, .3, black, o.w / 2 - .012, o.h / 2, .15, g);
  bx(o.w, .27, .03, black, 0, o.h + .135, .03, g); pl(o.w - .02, .25, new THREE.MeshBasicMaterial({ map: ctex(512, 220, o.sign) }), 0, o.h + .135, .047, 0, g);
  const pot = o.kind === 'pot', n = o.rows * o.cols, y0 = .3, y1 = o.h - .13;
  const inst = new THREE.InstancedMesh(pot ? new THREE.CylinderGeometry(.02, .02, .034, 12) : new THREE.CylinderGeometry(.0115, .0115, .05, 10), lam({ color: 0xffffff }), n); g.add(inst);
  const caps = pot ? null : new THREE.InstancedMesh(new THREE.CylinderGeometry(.004, .008, .02, 8), lam({ color: o.cap || 0xf2f2f2 }), n); if (caps) g.add(caps);
  const q = seed('rack' + o.kind + o.w + o.rows); let k = 0;
  for (let r = 0; r < o.rows; r++) {
    const y = y1 - r * (y1 - y0) / (o.rows - 1); bx(o.w - .06, .006, .1, black, 0, y - .004, .1, g).rotation.x = pot ? .5 : .12;
    for (let c = 0; c < o.cols; c++) {
      const x = -o.w / 2 + .06 + c * (o.w - .12) / (o.cols - 1), grey = r >= o.rows - 2;
      col.setHSL(((r / (o.rows - 2)) * .9 + (c / o.cols) * .06) % 1, grey ? .06 : .55 + q() * .35, grey ? .2 + .6 * c / o.cols : .32 + .3 * q());
      if (pot) { dummy2.position.set(x, y + .014, .105); dummy2.rotation.set(PI / 2 - .5, 0, 0); } else { dummy2.position.set(x, y + .026, .1); dummy2.rotation.set(-.12, 0, 0); }
      dummy2.updateMatrix(); inst.setMatrixAt(k, dummy2.matrix); inst.setColorAt(k, col);
      if (caps) { dummy2.position.set(x, y + .061, .096); dummy2.updateMatrix(); caps.setMatrixAt(k, dummy2.matrix); }
      k++;
    }
  }
  g.position.set(o.at[0], 0, o.at[1]); g.rotation.y = o.ry || 0; scene.add(g); return g;
}
function buildHobby() {
  const head = (g, w, h, bg, lines) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; lines.forEach((l) => { g.fillStyle = l[2]; g.font = l[1]; let sc = 1; const tw_ = g.measureText(l[0]).width; if (tw_ > w * .9) sc = w * .9 / tw_; g.save(); g.translate(w / 2, l[3]); g.scale(sc, 1); g.fillText(l[0], 0, 0); g.restore(); }); };
  const rainbow = (g, x, y, w, h) => { const gr = g.createLinearGradient(x, 0, x + w, 0); ['#e23b2e', '#f29a2e', '#f2d230', '#3fae4a', '#2f7fd0', '#7a4fc0'].forEach((c, i) => gr.addColorStop(i / 5, c)); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  // plain lettering on each header board, in the colours of the range it holds
  paintRack({ kind: 'pot', w: .64, h: 1.62, rows: 13, cols: 11, at: [-3.45, -3.5], sign: (g, w, h) => { head(g, w, h, '#0c0c0c', [['WARHAMMER', '900 78px Inter, sans-serif', '#ffffff', 82], ['COLOUR', '700 40px Inter, sans-serif', '#ffffff', 172]]); rainbow(g, 60, 128, w - 120, 12); } });
  paintRack({ kind: 'dropper', w: .64, h: 1.62, rows: 11, cols: 16, cap: 0xf4f4f4, at: [-2.74, -3.5], sign: (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#f08a1c'); gr.addColorStop(1, '#c8321e'); head(g, w, h, '#f08a1c', []); g.fillStyle = gr; g.fillRect(0, 0, w, h); head(g, w, h, 'rgba(0,0,0,0)', [['Vallejo', '700 96px Inter, sans-serif', '#ffffff', 88], ['MODEL COLOR · GAME COLOR', '700 30px Inter, sans-serif', '#fff3d6', 172]]); } });
  paintRack({ kind: 'dropper', w: .64, h: 1.62, rows: 11, cols: 16, cap: 0x1a1a1a, at: [-4, -2.55], ry: PI / 2, sign: (g, w, h) => { head(g, w, h, '#6b1d22', []); g.fillStyle = '#a8a35a'; g.fillRect(w * .52, 14, w * .48 - 14, h - 28); head(g, w, h, 'rgba(0,0,0,0)', [['WARPAINTS', '900 58px Inter, sans-serif', '#ffffff', 82], ['THE ARMY PAINTER', '700 28px Inter, sans-serif', '#f3e9c8', 162]]); } });
  // the rack of Warhammer boxes: filled when the feed answers
  kitG = new THREE.Group(); kitG.position.set(-4, 0, -1.48); kitG.rotation.y = PI / 2; scene.add(kitG);
  const black = lam({ color: 0x151515 }), W_ = 1.14, H_ = 1.72;
  bx(W_, H_, .02, black, 0, H_ / 2, .01, kitG); bx(.03, H_, .34, black, -W_ / 2 + .015, H_ / 2, .17, kitG); bx(.03, H_, .34, black, W_ / 2 - .015, H_ / 2, .17, kitG);
  [.2, .58, .96, 1.34].forEach((y) => bx(W_ - .04, .02, .32, black, 0, y - .01, .17, kitG));
  bx(W_, .27, .03, black, 0, H_ + .135, .03, kitG);
  pl(W_ - .02, .25, new THREE.MeshBasicMaterial({ map: ctex(768, 180, (g, w, h) => { head(g, w, h, '#0c0c0c', [['WARHAMMER', '900 96px Inter, sans-serif', '#ffffff', 92]]); g.fillStyle = '#c0392b'; g.fillRect(40, 150, w - 80, 8); }) }), 0, H_ + .135, .047, 0, kitG);
  hit(bx(1.7, 2.0, .5, hitM, -3.1, 1.0, -3.3), 'hobby'); hit(bx(.5, 2.0, 2.2, hitM, -3.8, 1.0, -1.95), 'hobby');
}
function loadKits() {
  fetch(W + '/showcase/wargames.json', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || !d.rows || !kitG) return;
    d.rows.slice(0, 12).forEach((r, i) => {   // three to a shelf, the newest at the top left
      const c = { name: r.name, set: 'Warhammer', price: r.price, image: r.image, url: 'https://exorgames.com/products/' + r.handle, variantId: r.variantId, condition: '', foil: false, game: 'warhammer', sealed: true, ar: clamp(Number(r.ar) || 1, .6, 1.5), qty: r.qty };
      const q = seed('kit' + c.name), bh = .29, bw = clamp(bh * c.ar, .2, .34), hgt = bw / c.ar, face = new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, hgt), face); m.visible = false;
      m.position.set(-.37 + (i % 3) * .37 + (q() - .5) * .02, [1.34, .96, .58, .2][Math.floor(i / 3)] + hgt / 2, .2 + (q() - .5) * .03); m.rotation.y = (q() - .5) * .16; m.userData = { card: c }; kitG.add(m); kitMeshes.push(m);
      cardTex(c, 256).then((t) => { face.map = t; face.needsUpdate = true; m.visible = true; kick(); });
    });
    lights(S.eve);
  }).catch(() => {});
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
const WX = -.4, WZ = -3.2;
function buildWall(d) {
  kill(wallG); wallG = new THREE.Group(); scene.add(wallG); boxMeshes = []; wallFaces = []; wallGen++;
  if (wallHit) { hot.splice(hot.indexOf(wallHit), 1); kill(wallHit); wallHit = null; }
  wallW = 0; S.wallRows = 0;
  if (!d) { placeSealed(); return; }
  const n = d.boxes.length, rows = n <= 3 ? 1 : n <= 8 ? 2 : n <= 15 ? 3 : 4, cols = Math.ceil(n / rows), bw = .42, bh = .105, px = .46, py = .16;
  wallW = cols * px; const y0 = 1.12;
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
  wallHit = hit(bx(wallW + .8, rows * py + .2, .5, hitM, WX - .15, y0 + rows * py / 2, WZ), 'boxes');
  S.wallRows = rows * py; placeSealed(); decorateWall();
}
function boxesView() {
  // wide enough for the whole wall where the screen allows it; a phone sees two boxes across and pans
  const only = S.focus === 'sealed' && sealed.rows.length;   // the Booster boxes button looks at that shelf alone
  const L = only || !wallW ? sealX() - .15 : WX - wallW / 2 - .55, R = sealed.rows.length ? sealX() + sealed.w + .12 : WX + wallW / 2 + .15, cx = (L + R) / 2, hh = only ? sealed.h : Math.max(S.wallRows || 0, sealed.h || 0, .3);
  const fitH = 2 * Math.atan((hh / 2 + .22) / 2.75) * 180 / PI, fitW = 2 * Math.atan((R - L) / 2 / 2.75 / cam.aspect) * 180 / PI;
  const fov = clamp(Math.max(fitH, Math.min(fitW, cam.aspect < 1 ? 41 : 46)), 20, 46), vw = 2 * 2.75 * hTan(fov), max = Math.max(0, (R - L - vw) / 2);
  S.maxPan = max; S.pan = clamp(S.pan, -max, max);
  const v = lookView(new V3(cx + S.pan, 1.56, -.3), new V3(cx + S.pan, 1.09 + hh / 2, WZ + .19), fov); v.vw = vw; return v;
}
/* ---------- new sealed booster boxes, on the back wall beside the set boxes (owner, 2026-11-09) ---------- */
const sealed = { rows: [], w: 0, h: 0 };
let sealG = null, sealMeshes = [], sealHit = null;
const sealX = () => (wallW ? WX + wallW / 2 + .34 : WX - sealed.w / 2);
function placeSealed() { if (sealG) sealG.position.x = sealX(); if (sealHit) sealHit.position.x = sealX() + sealed.w / 2; }
function buildSealed(rows) {
  kill(sealG); sealG = null; sealMeshes = []; sealed.rows = rows || []; sealed.w = sealed.h = 0;
  if (sealHit) { hot.splice(hot.indexOf(sealHit), 1); kill(sealHit); sealHit = null; }
  const n = sealed.rows.length; if (!n) return;
  sealG = new THREE.Group(); scene.add(sealG);
  const nr = n <= 4 ? 1 : 2, cols = Math.ceil(n / nr), px = .29, py = .3, bh = .22, y0 = 1.12;
  sealed.w = cols * px; sealed.h = nr * py + .12;
  for (let r = 0; r < nr; r++) bx(sealed.w + .1, .022, .3, woodM, sealed.w / 2, y0 + r * py - .011, WZ + .05, sealG);
  bx(.03, nr * py + .06, .3, darkWoodM, -.05, y0 + nr * py / 2 - .03, WZ + .05, sealG); bx(.03, nr * py + .06, .3, darkWoodM, sealed.w + .05, y0 + nr * py / 2 - .03, WZ + .05, sealG);
  sealed.rows.forEach((c, i) => {   // the newest at the top left
    const col = i % cols, row = nr - 1 - Math.floor(i / cols), q = seed('seal' + c.name), bw = clamp(bh * (c.ar || 1), .15, .26), face = new THREE.MeshBasicMaterial({ map: phTex, color: cardTint, transparent: true, alphaTest: .35, side: THREE.DoubleSide });
    const hgt = bw / (c.ar || 1), m = new THREE.Mesh(new THREE.PlaneGeometry(bw, hgt), face); m.visible = false;   // a cut-out standing on the shelf, shown once its picture is in
    m.position.set(px / 2 + col * px + (q() - .5) * .02, y0 + row * py + hgt / 2, WZ + .1 + (q() - .5) * .02); m.rotation.y = (q() - .5) * .14; m.userData = { card: c }; sealG.add(m); sealMeshes.push(m);
    cardTex(c, 256).then((t) => { if (!m.parent) { t.dispose(); return; } face.map = t; face.needsUpdate = true; m.visible = true; kick(); });
  });
  const sg = pl(.5, .11, new THREE.MeshBasicMaterial({ map: ctex(500, 110, (g, w, h) => { g.fillStyle = '#f7e98e'; g.fillRect(0, 0, w, h); g.fillStyle = '#c0392b'; g.font = '44px "Permanent Marker", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NEW! booster boxes', w / 2, h / 2 + 2); }) }), Math.max(.25, sealed.w / 2), y0 + nr * py + .05, WZ + .06, 0, sealG);
  sg.rotation.z = .02;
  sealHit = hit(bx(sealed.w + .2, nr * py + .2, .4, hitM, 0, y0 + nr * py / 2, WZ + .05), 'boxes');
  placeSealed(); lights(S.eve);
}
function loadSealed() {
  const game = S.game; buildSealed([]);
  fetch(W + '/showcase/sealed.json?game=' + encodeURIComponent(game), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || game !== S.game || !d.rows) return;
    const rows = d.rows.map((r) => ({ name: r.name, set: 'Sealed booster box', price: r.price, image: r.image, url: 'https://exorgames.com/products/' + r.handle, variantId: r.variantId, condition: '', foil: false, game, sealed: true, ar: clamp(Number(r.ar) || 1, .6, 1.5), qty: r.qty }));
    fonts.then(() => { buildSealed(rows); if (S.mode === 'boxes') setView(boxesView()); kick(); });
  }).catch(() => {});
}
function loadBoxes() {
  const game = S.game; boxes.list = null; buildWall(null);
  fetch(W + '/showcase/boxes.json?game=' + encodeURIComponent(game), { headers: { accept: 'application/json' } }).then((r) => r.json()).then((d) => {
    if (!d || !d.ok || game !== S.game || !d.boxes || !d.boxes.length) return;
    boxes.list = d; fonts.then(() => { buildWall(d); if (S.mode === 'boxes') setView(boxesView()); kick(); });
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
    const nl = clamp(Math.ceil(cards.length / 8), 1, 4), per = Math.max(1, Math.ceil(cards.length / nl)), lanes = []; for (let l = 0; l < nl; l++) { const s = cards.slice(l * per, (l + 1) * per); if (s.length) lanes.push(s); }
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
  const c = { kind: o.kind, name: o.name || '', title: o.title, lanes: o.lanes, ps: o.lanes.map(() => 0), lane: 0, v: 0, sp, Lz, n, g, inst, faces, at: o.at };
  updateCrate(c); return c;
}
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
  const c = cr; if (!c) return; const l = c.lane, max = c.lanes[l].length - 1, from = c.ps[l], to = clamp(Math.round(p), 0, max), t0 = performance.now(); c.v = 0; c.anim = (c.anim || 0) + 1; const id = c.anim;
  anims.push((now) => { if (c.anim !== id || cr !== c) return false; const k = Math.min(1, (now - t0) / (reduce ? 1 : (ms || 220))), e = 1 - Math.pow(1 - k, 3); c.ps[l] = lerp(from, to, e); updateCrate(c); setView(crateView(c)); return k < 1; }); kick();
}
function crateLane(d) { const c = cr; if (!c) return; const l = clamp(c.lane + d, 0, c.n - 1); if (l === c.lane) return; c.lane = l; c.anim = (c.anim || 0) + 1; updateCrate(c); glide(crateView(c), 380); ui(); }
function caption() {
  const c = cr; if (!c) return; const ln = c.lanes[c.lane], i = clamp(Math.round(c.ps[c.lane]), 0, ln.length - 1), k = ln[i];
  $('#capName').textContent = k.name; $('#capSet').textContent = [k.set, condText(k), money(k.price), (i + 1) + ' of ' + ln.length + (c.n > 1 ? ' · row ' + (c.lane + 1) + ' of ' + c.n : '')].filter(Boolean).join(' · ');
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
hand.foil = new THREE.Mesh(geoC, hm({ map: foilT, opacity: .2, blending: THREE.AdditiveBlending })); hand.foil.renderOrder = 996; hand.foil.position.z = .0002; hand.g.add(hand.foil);
hand.glare = new THREE.Mesh(geoC, hm({ map: glareT, opacity: .3, blending: THREE.AdditiveBlending })); hand.glare.renderOrder = 997; hand.glare.position.z = .0003; hand.g.add(hand.glare);
fonts.then(() => { hand.back.material.map = keep(ctex(360, 503, drawBack)); hand.back.material.needsUpdate = true; });
function stage() { const w = canvas.clientWidth, h = canvas.clientHeight; return w > 720 ? { x: 0, y: 0, w: w - 360, h } : { x: 0, y: 0, w, h: h - 60 }; }
function placeHand(now) {
  const st = stage(), W_ = canvas.clientWidth, H_ = canvas.clientHeight, d = .24, wpp = 2 * d * Math.tan(rad(cam.fov / 2)) / H_;
  const ar = S.hand.sealed ? S.hand.ar || 1 : CW / CH;   // a card, or a booster box in its own shape
  const cwPx = Math.max(140, Math.min(st.w - 24, (st.h - 28) * ar)) * (S.hand.sealed ? .8 : 1), k = reduce ? 1 : Math.min(1, (now - hand.t0) / 320), e = 1 - Math.pow(1 - k, 3);
  hand.g.position.set((st.x + st.w / 2 - W_ / 2) * wpp, -(st.y + st.h / 2 - H_ / 2) * wpp - .05 * (1 - e), -d);
  const sc = .55 + .45 * e; hand.g.scale.set(cwPx * wpp / CW * sc, cwPx / ar * wpp / CH * sc, cwPx * wpp / CW * sc);
  if (!hand.drag) { hand.rx += (hand.tx - hand.rx) * .18; hand.ry += (hand.ty - hand.ry) * .18; }
  hand.g.rotation.set(hand.rx, hand.ry, 0);
  const s = Math.sin(hand.ry) * .6 + hand.rx * .5; hand.foil.material.map.offset.set(s, s * .7); hand.glare.material.map.offset.set(s * .9, 0);
  if (k < 1 || Math.abs(hand.tx - hand.rx) + Math.abs(hand.ty - hand.ry) > .002) kick();
}
function lift(c, src) {
  if (S.handSrc) S.handSrc.visible = true;
  S.hand = c; S.handSrc = src || null; if (src) src.visible = false;
  document.body.dataset.hand = '1'; hand.g.visible = true; hand.dim.visible = true; hand.rx = hand.ry = hand.tx = hand.ty = 0; hand.t0 = performance.now();
  hand.front.material.map = phTex; wear(hand.front, c, c.sealed ? 640 : 720); hand.foil.visible = !!c.foil;
  hand.back.visible = !c.sealed; hand.front.material.side = c.sealed ? THREE.DoubleSide : THREE.FrontSide; hand.glare.visible = !c.sealed; hand.front.material.needsUpdate = true;   // a cut-out box has no sleeve back and no flat glare
  fillPanel(c); sheet(false); hint(''); askOrientation(); kick();
}
function putBack() {
  if (!S.hand) return; delete document.body.dataset.hand; hand.g.visible = false; hand.dim.visible = false; bare(hand.front);
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
  if (c.sealed) { ++liftSeq; ++copiesSeq; $('#liftSet').textContent = [c.set || 'Sealed', c.qty ? c.qty + ' in stock' : '', money(c.price)].filter(Boolean).join(' · '); $('#liftCopies').innerHTML = $('#liftAlike').innerHTML = $('#liftMore').innerHTML = ''; return; }
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
function pile() {
  while (pileG.children.length) pileG.remove(pileG.children[0]);
  S.pile.slice(0, 14).forEach((p, i) => { const q = seed(p.name + i), m = new THREE.Mesh(geoSlab, lam({ color: 0xd7dfe2 })); m.rotation.set(-PI / 2, 0, (q() - .5) * .7); m.position.set((q() - .5) * .012, .001 + i * .0022, CH / 2 + (q() - .5) * .012); m.scale.z = 3; pileG.add(m); });
  const n = $('#pileN'); n.hidden = !S.pile.length; n.textContent = S.pile.length; kick();
}
function showTill() {
  const sum = S.pile.reduce((a, p) => a + (Number(p.price) || 0), 0);
  $('#tillList').innerHTML = S.pile.length ? S.pile.map((p, i) => '<div class="trow"><span>' + esc(p.name) + '<small>' + esc([p.set, p.cond, p.foil ? 'foil' : ''].filter(Boolean).join(' · ')) + '</small></span><b>' + money(p.price) + '</b>' + (ON_STORE ? '' : '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">open ↗</a><button type="button" data-drop="' + i + '" aria-label="Take it off the pile">×</button>') + '</div>').join('') : '<div class="empty">Nothing by the till yet. Pick a card up from the case, a box or the bin and set it here.</div>';
  $('#tillFoot').innerHTML = S.pile.length ? '<span>' + S.pile.length + ' card' + (S.pile.length === 1 ? '' : 's') + ' · ' + money(sum) + '</span>' + (ON_STORE ? '<a href="/cart">Go to your cart</a>' : '<span style="color:var(--muted)">This is the preview: on exorgames.com these go into the cart.</span>') : '';
  $('#tillv').classList.add('on');
}

/* ---------- where you stand ---------- */
// from the door: the case and the till side by side, centred
const doorView = () => { const x = (S.x0 + 2.3) / 2, ph = cam.aspect < 1, v = lookView(new V3(x, 1.6, 3.2), new V3(x, ph ? 1.3 : 1.18, -1.2), ph ? 82 : 55); v.yaw += S.look.yaw; v.pitch += S.look.pitch; return v; };
// the till and the person behind it; on a wide screen the pile's sheet covers the right, so they sit left of centre
const tillView = () => { const dx = cam.aspect < 1 ? 0 : .32; return lookView(new V3(1.95 + dx, 1.56, cam.aspect < 1 ? .5 : .25), new V3(2.02 + dx, 1.28, -1.2)); };
const hobbyView = () => lookView(new V3(-1.85, 1.5, cam.aspect < 1 ? .5 : .35), new V3(-3.45, 1.1, -2.7), cam.aspect < 1 ? 80 : 58);
function viewFor() { return S.mode === 'hobby' ? hobbyView() : S.mode === 'case' && S.lay.length ? caseView() : S.mode === 'boxes' ? boxesView() : S.mode === 'crate' && cr ? crateView(cr) : S.mode === 'till' ? tillView() : doorView(); }
function go(mode) {
  leanOff();
  if (S.hand) putBack(); $('#setsv').classList.remove('on'); $('#tillv').classList.remove('on');
  if (mode === 'case') { if (!S.shelves.length) return; S.mode = 'case'; glide(caseView()); hint(matchMedia('(pointer:coarse)').matches ? 'Swipe to walk the case · swipe up to crouch · pinch to lean in · tap a card' : 'Drag to walk the case · scroll to crouch · hold the mouse down to lean in · click a card'); }
  else if (mode === 'hobby') { S.mode = 'hobby'; glide(hobbyView()); hint(kitMeshes.length ? 'Paints and Warhammer · tap a box to pick it up' : 'Paints and Warhammer'); }
  else if (mode === 'sealed') { if (!sealed.rows.length) { hint('No booster boxes in stock for this game right now'); return; } S.mode = 'boxes'; S.focus = 'sealed'; S.pan = 0; glide(boxesView()); hint('The newest booster boxes in stock · tap one to pick it up'); }
  else if (mode === 'boxes') { S.focus = ''; if (!boxes.list && !sealed.rows.length) { hint('The boxes for this game are not on the shelf yet'); return; } S.mode = 'boxes'; if (cam.aspect < 1) S.pan = -1e9; glide(boxesView()); hint(sealed.rows.length ? 'Tap a white box for its sets · the new sealed booster boxes are on the right' : 'Every set we carry · tap a box, pick a set, thumb through'); }
  else if (mode === 'bin') { if (!binCrate) return; enterCrate(binCrate); return; }
  else if (mode === 'till') { S.mode = 'till'; glide(tillView(), 900, showTill); hint(''); }
  else { S.mode = 'door'; S.look.yaw = S.look.pitch = 0; glide(doorView()); hint('Tap the glass case, the boxes, the bin or the till · drag to look around'); }
  ui();
}
function back() {
  if (S.hand) return putBack();
  if ($('#setsv').classList.contains('on')) { $('#setsv').classList.remove('on'); return; }
  if ($('#tillv').classList.contains('on')) return go('door');
  if (S.mode === 'crate' && cr && cr.kind === 'set') { go('boxes'); if (boxes.open) openBox(boxes.open.n); return; }
  go('door');
}
let hintT = 0;
function hint(t) { const el = $('#hint'); clearTimeout(hintT); if (!t) { el.classList.add('gone'); return; } el.textContent = t; el.classList.remove('gone'); hintT = setTimeout(() => el.classList.add('gone'), 6000); }
function ui() {
  document.body.dataset.mode = S.mode;
  const st = S.mode === 'crate' ? (cr && cr.kind === 'bin' ? 'bin' : 'boxes') : S.mode === 'boxes' && S.focus === 'sealed' ? 'sealed' : S.mode;
  $('#boxNote').textContent = st === 'sealed' ? 'tap a booster box to pick it up' : 'tap a white box for its sets · a booster box to pick it up';
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
const HOBBY_LINKS = [['Citadel Contrast', 'citadel-contrast-paints'], ['Citadel Layer', 'citadel-layer-paints'], ['Vallejo Game Color', 'vallejo-game-color'], ['Army Painter Warpaints', 'the-army-painter-warpaints']];
$('#ctxHobby').innerHTML = HOBBY_LINKS.map((l) => '<a href="https://exorgames.com/collections/' + l[1] + '"' + (ON_STORE ? '' : ' target="_blank" rel="noopener"') + '>' + esc(l[0]) + (ON_STORE ? '' : ' ↗') + '</a>').join('');
function tabs() {
  $('#tabs').innerHTML = S.cases.map((c) => { const ic = S.icons.indexOf(c.key) > -1; return '<button type="button" data-game="' + esc(c.key) + '" class="' + (ic ? 'ic' : '') + (c.key === S.game ? ' on' : '') + '" title="' + esc(c.label) + '">' + (ic ? '<img src="' + esc(W + '/showcase/icon/' + c.key + '.png') + '" alt="" draggable="false">' : '') + '<span>' + esc(c.label) + '</span></button>'; }).join('');
  $('#flat').href = W + '/showcase?game=' + encodeURIComponent(S.game);
}

/* ---------- touch, mouse, keys ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(list, x, y) { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(list, false); return h.length ? h[0] : null; }
const HELLO = ['Hi! Ask us to pull any card out for a closer look.', 'Looking for something? The boxes at the back have every set.', 'Got cards to sell? We buy - cash or store credit.', 'Ring the bell if you need a hand!'];
let helloN = 0;
function act(a) { if (a === 'bell') ding(); else if (a === 'lights') toggleLights(); else if (a === 'staff') hint(HELLO[helloN++ % HELLO.length]); else go(a); }
function tap(x, y) {
  if (S.hand) return putBack();
  if (tw) return;
  if (S.mode === 'case') { const h = pick(caseCards.filter((m) => m.visible), x, y); if (h) { const u = h.object.userData; if (u.si !== S.shelf) goShelf(u.si); else lift(u.card, h.object); return; } }
  else if (S.mode === 'boxes') { const h = pick(boxMeshes.concat(sealMeshes), x, y); if (h) return h.object.userData.card ? lift(h.object.userData.card, null) : openBox(h.object.userData.n); }
  else if (S.mode === 'hobby') { const h = pick(kitMeshes.filter((m) => m.visible), x, y); if (h) return lift(h.object.userData.card, null); }
  else if (S.mode === 'crate' && cr) { const h = pick(cr.faces.filter((f) => f.visible), x, y); if (h) { const i = h.object.userData.idx, at = Math.round(cr.ps[cr.lane]); if (i === at) lift(cr.lanes[cr.lane][i], null); else flickTo(i); return; } }
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
function leanView() { const v = caseView(); if (lean.P && lean.k) v.pos.lerp(lean.P, .6 * lean.k); return v; }
function leanStart(x, y) {
  if (S.mode !== 'case' || S.hand || tw || !S.lay.length) return false;
  if (!lean.on) {
    setView(caseView());
    cam.position.copy(view.pos); cam.rotation.set(view.pitch, view.yaw, 0); cam.updateMatrixWorld();
    const h = pick(caseCards.filter((m) => m.visible && m.userData.si === S.shelf), x, y);
    lean.P = h ? h.point.clone() : ray.ray.at(view.dist || .45, new V3());
    caseCards.forEach((m) => { const u = m.userData; if (u.si === S.shelf && !u.hi && m.position.distanceTo(lean.P) < .14) { u.hi = u.has = true; wear(m, u.card, 512); } });
  }
  lean.on = true; lean.id++; S.vx = 0; hint(''); return true;
}
function leanTo(k) { lean.k = k; setView(leanView()); }
function leanAnim(to, ms) {
  const id = ++lean.id, from = lean.k, t0 = performance.now();
  anims.push((now) => { if (lean.id !== id) return false; const t = Math.min(1, (now - t0) / (reduce ? 1 : ms)), e = 1 - Math.pow(1 - t, 3); lean.k = lerp(from, to, e); if (S.mode === 'case' && !tw) setView(leanView()); if (t >= 1 && !to) lean.on = false; return t < 1; }); kick();
}
function leanOff() { lean.id++; lean.k = 0; lean.on = false; pinch = null; }
// the stretch between the fingers, with give at both ends
function elastic(scale) { const r = (scale - 1) / 1.1; return r > 1 ? Math.min(1.12, 1 + (r - 1) * .15) : r < 0 ? Math.max(-.08, r * .1) : r; }
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2 && !pinch) {
    const a = Array.from(pts.values());
    if (leanStart((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2)) { pinch = { d0: Math.max(30, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)), k0: lean.k }; if (drag) clearTimeout(drag.holdT); drag = null; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} return; }
  }
  if (pinch || pts.size > 1) return;
  if (e.button && e.button !== 0) return;
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, axis: '', lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), v: 0, walk: S.walk, pan: S.pan, yaw: S.look.yaw, pitch: S.look.pitch, p: cr ? cr.ps[cr.lane] : 0, rx: hand.rx, ry: hand.ry };
  try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
  S.vx = 0; if (cr) cr.anim = (cr.anim || 0) + 1;
  // a mouse held still on the case leans in to that spot
  if (e.pointerType === 'mouse' && S.mode === 'case' && !S.hand) { const d = drag; d.holdT = setTimeout(() => { if (drag === d && !d.moved && leanStart(d.x0, d.y0)) { d.lean = true; leanAnim(1, 320); } }, 280); }
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
  else if (S.mode === 'door') { S.look.yaw = clamp(drag.yaw + dx * .004, -1.5, 1.5); S.look.pitch = clamp(drag.pitch + dy * .003, -.45, .4); setView(doorView()); }
  else if (S.mode === 'case' && drag.axis === 'x') { const mpp = visW() / canvas.clientWidth; S.walk = clamp(drag.walk - dx * mpp, -.03, (S.maxWalk || 0) + .03); drag.v = (drag.lastX - e.clientX) * mpp / dt * 16; setView(caseView0()); }
  else if (S.mode === 'boxes' && drag.axis === 'x') { const v = boxesView(); S.pan = clamp(drag.pan - dx * v.vw / canvas.clientWidth, -S.maxPan, S.maxPan); setView(boxesView()); }
  else if (S.mode === 'crate' && cr && drag.axis === 'y') { const max = cr.lanes[cr.lane].length - 1; cr.ps[cr.lane] = clamp(drag.p + dy / 46, -.3, max + .3); drag.v = (e.clientY - drag.lastY) / 46 / dt * 16; updateCrate(cr); setView(crateView(cr)); }
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
  if (S.hand) { hand.ty = Math.round(hand.ry / PI) * PI; hand.tx = 0; hand.ry = hand.ry; kick(); return; }   // it settles on its nearer face
  if (d.axis === 'none') return;
  hint('');
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
  if (S.mode === 'case' && e.ctrlKey) {   // a trackpad pinch arrives as ctrl + wheel: lean while it lasts, back out when it stops
    if (!leanStart(e.clientX, e.clientY)) return; lean.id++; leanTo(clamp(lean.k - e.deltaY * .012, -.05, 1.1));
    clearTimeout(wheelLean); wheelLean = setTimeout(() => leanAnim(0, 320), 260); return;
  }
  if (lean.on) return;
  if (S.mode === 'case') { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { S.walk = clamp(S.walk + (e.shiftKey ? e.deltaY : e.deltaX) * .0012, 0, S.maxWalk || 0); setView(caseView()); return; } if (wheelLock || Math.abs(e.deltaY) < 12) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 560); goShelf(S.shelf + (e.deltaY > 0 ? 1 : -1)); }
  else if (S.mode === 'crate' && cr) { if (wheelLock) return; wheelLock = true; setTimeout(() => { wheelLock = false; }, 90); flickTo(Math.round(cr.ps[cr.lane]) + (e.deltaY > 0 ? 1 : -1), 160); }
  else if (S.mode === 'boxes') { S.pan = clamp(S.pan + (e.deltaX || e.deltaY) * .0015, -S.maxPan, S.maxPan); setView(boxesView()); }
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') back(); return; }
  if (e.key === 'Escape') { back(); return; }
  if (S.hand) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { hand.ty = Math.abs(hand.ty) > PI / 2 ? 0 : PI; kick(); e.preventDefault(); } return; }
  const k = e.key;
  if (S.mode === 'case') { if (k === 'ArrowRight' || k === 'ArrowLeft') { S.walk = clamp(S.walk + (k === 'ArrowRight' ? .2 : -.2), 0, S.maxWalk || 0); glide(caseView(), 260); } else if (k === 'ArrowDown') goShelf(S.shelf + 1); else if (k === 'ArrowUp') goShelf(S.shelf - 1); else return; }
  else if (S.mode === 'crate' && cr) { if (k === 'ArrowDown' || k === 'ArrowUp') flickTo(Math.round(cr.ps[cr.lane]) + (k === 'ArrowDown' ? 1 : -1)); else if (k === 'ArrowRight' || k === 'ArrowLeft') crateLane(k === 'ArrowRight' ? 1 : -1); else if (k === 'Enter') lift(cr.lanes[cr.lane][Math.round(cr.ps[cr.lane])], null); else return; }
  else if (S.mode === 'boxes') { if (k === 'ArrowRight' || k === 'ArrowLeft') { S.pan = clamp(S.pan + (k === 'ArrowRight' ? .3 : -.3), -S.maxPan, S.maxPan); glide(boxesView(), 260); } else return; }
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
  else if (b.hasAttribute('data-drop')) { S.pile.splice(Number(b.getAttribute('data-drop')), 1); pile(); showTill(); }
  else if (b.id === 'buy') buy(b);
  else if (b.id === 'x') putBack();
  else if (b.id === 'pull') sheet(!$('#panel').classList.contains('open'));
  else if (b.id === 'crBack' || b.id === 'setsBack' || b.id === 'tillBack') back();
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
fonts.then(() => { buildRoom(); loadKits(); resize(); load(new URLSearchParams(location.search).get('game') || ''); });
window.xgShop = { lean, leanStart, leanTo, leanAnim, pick, tap, hot, S, go, goShelf, lift, putBack, flickTo, crateLane, openBox, openSet, toggleLights, ding, view, get crate() { return cr; }, get cards() { return caseCards; }, get boxMeshes() { return boxMeshes; }, get sealMeshes() { return sealMeshes; }, cam, kick };
