// Market pulse (owner 2026-10-20, "do ... seven"): the nightly snapshot's biggest movers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySnapshot, storePage, noteMover, topMovers, priceDoFetch, PRICE_DO } from "../src/price-history.js";
import { servePulse, renderPulse } from "../src/pulse.js";

const DAY = 20_000;                     // a UTC day number the snapshot might use
const ORIGIN = "https://w.example";
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) this.m.set(a, JSON.parse(JSON.stringify(b))); } else this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; } async setAlarm(t) { this.alarm = t; } async deleteAlarm() { this.alarm = null; }
}
const rec = (points) => ({ s: points[0][0], d: points[points.length - 1][0], p: points.map((x) => x.slice()) });

test("noteMover: the Near Mint price now against 7 and 30 days ago; penny cards, unchanged prices and untracked windows are skipped; the list stays capped", () => {
  const acc = {};
  // tracked since day-20 at $5, moved to $8 on day-3: a 7-day riser; no 30-day window yet
  noteMover(acc, { id: "1", handle: "charizard", type: "Pokemon Single", cents: 800 }, rec([[DAY - 20, 500, 500], [DAY - 3, 800, 800]]), DAY);
  assert.deepEqual(acc.w7, [{ id: "1", h: "charizard", t: "Pokemon Single", f: 500, c: 800, p: 60 }]);
  assert.equal(acc.w30, undefined, "not tracked 30 days ago");
  // tracked for 40 days, fell on day-10: a 30-day faller only (7 days ago it was already $3)
  noteMover(acc, { id: "2", handle: "sol-ring", type: "MTG Single", cents: 300 }, rec([[DAY - 40, 1000, 1000], [DAY - 10, 300, 300]]), DAY);
  assert.equal(acc.w7.length, 1); assert.deepEqual(acc.w30, [{ id: "2", h: "sol-ring", t: "MTG Single", f: 1000, c: 300, p: -70 }]);
  // below $2 on either end, or unchanged, or the "email us" sentinel: nothing
  noteMover(acc, { id: "3", handle: "x", cents: 150 }, rec([[DAY - 40, 100, 100], [DAY - 2, 150, 150]]), DAY);
  noteMover(acc, { id: "4", handle: "y", cents: 500 }, rec([[DAY - 40, 500, 500]]), DAY);
  noteMover(acc, { id: "5", handle: "z", cents: 99999900 }, rec([[DAY - 40, 500, 500], [DAY - 1, 99999900, 99999900]]), DAY);
  assert.equal(acc.w7.length, 1); assert.equal(acc.w30.length, 1);
  noteMover(acc, {}, null, DAY);
  // the cap: 600 small movers, the 250 biggest by percent survive
  const big = {};
  for (let i = 0; i < 600; i++) noteMover(big, { id: String(i), handle: "h" + i, cents: 1000 + i * 10 }, rec([[DAY - 40, 1000, 1000], [DAY - 1, 1000 + i * 10, 1000 + i * 10]]), DAY);
  assert.ok(big.w7.length <= 500 && big.w7.length >= 250, "the accumulator is bounded while a run walks the catalogue"); assert.ok(big.w7.some((m) => m.id === "599"), "the biggest move survives the trims"); assert.ok(!big.w7.some((m) => m.id === "0"), "an unchanged price is not a mover");
  const top = topMovers([{ id: "a", p: 10, c: 500 }, { id: "b", p: 50, c: 300 }, { id: "c", p: -20, c: 900 }, { id: "d", p: -5, c: 100 }, { id: "e", p: 50, c: 800 }]);
  assert.deepEqual(top.risers.map((m) => m.id), ["e", "b", "a"], "by percent, dearer first on a tie");
  assert.deepEqual(top.fallers.map((m) => m.id), ["c", "d"]); assert.equal(top.counted, 5);
  assert.deepEqual(topMovers(undefined), { risers: [], fallers: [], counted: 0 });
});

test("storePage notes movers while it writes the snapshot", async () => {
  const st = new MemStorage();
  await st.put("ph:1", rec([[DAY - 20, 500, 500]]));
  const acc = {};
  const w = await storePage(st, [{ id: "1", handle: "charizard", type: "Pokemon Single", cents: 900, min: 900, max: null }, { id: "9", handle: "new", type: "MTG Single", cents: 400, min: 400, max: null }], DAY, acc);
  assert.equal(w.changed, 2);
  assert.deepEqual(acc.w7, [{ id: "1", h: "charizard", t: "Pokemon Single", f: 500, c: 900, p: 80 }], "the new product has no history to compare");
  assert.equal((await st.get("ph:1")).p.length, 2);
});

test("/_ph/movers: not ready until a run finished; then the lists with titles and pictures looked up once per run day", async () => {
  const st = new MemStorage();
  const calls = [];
  const cx = { storage: st, mem: {}, env: { SHOPIFY_ADMIN_TOKEN: "t" }, now: () => Date.UTC(2026, 9, 21), log: () => {}, fetch: async (u, init) => { const b = JSON.parse(init.body); calls.push(b.variables.ids); return new Response(JSON.stringify({ data: { nodes: b.variables.ids.map((gid) => ({ id: gid, title: "Card " + gid.slice(-1), handle: "card-" + gid.slice(-1), status: "ACTIVE", totalInventory: gid.endsWith("1") ? 3 : 0, featuredImage: { url: "https://cdn.example/" + gid.slice(-1) + ".png" } })) } }), { status: 200 }); } };
  const get = async (q) => { const url = new URL(ORIGIN + "/_ph/movers" + (q || "")); return (await priceDoFetch(cx, new Request(url), url)).json(); };
  assert.deepEqual(await get(), { ok: true, ready: false });
  await st.put("phs:movers", { day: DAY, date: "2026-10-21", at: 1, w7: { risers: [{ id: "1", h: "card-1", t: "Pokemon Single", f: 500, c: 800, p: 60 }], fallers: [{ id: "2", h: "card-2", t: "MTG Single", f: 1000, c: 300, p: -70 }], counted: 2 }, w30: { risers: [], fallers: [], counted: 0 } });
  let r = await get();
  assert.equal(r.ready, true); assert.equal(r.w7.risers[0].p, 60); assert.deepEqual(r.detail, {}, "no enrichment unless asked");
  r = await get("?enrich=1");
  assert.deepEqual(r.detail["1"], { title: "Card 1", image: "https://cdn.example/1.png", inStock: true, url: "https://exorgames.com/products/card-1", active: true });
  assert.equal(r.detail["2"].inStock, false);
  assert.deepEqual(calls, [["gid://shopify/Product/1", "gid://shopify/Product/2"]]);
  await get("?enrich=1");
  assert.equal(calls.length, 1, "cached for the run day");
  await st.put("phs:movers", { day: DAY + 1, date: "2026-10-22", at: 2, w7: { risers: [{ id: "3", h: "card-3", t: "", f: 200, c: 400, p: 100 }], fallers: [], counted: 1 }, w30: { risers: [], fallers: [], counted: 0 } });
  await get("?enrich=1");
  assert.deepEqual(calls[1], ["gid://shopify/Product/3"], "a new run day looks up the new ids");
  // Shopify down: the page still gets the lists, without pictures
  cx.fetch = async () => new Response("nope", { status: 500 });
  await st.put("phs:movers", { day: DAY + 2, date: "2026-10-23", at: 3, w7: { risers: [{ id: "4", h: "card-4", t: "", f: 200, c: 400, p: 100 }], fallers: [], counted: 1 }, w30: { risers: [], fallers: [], counted: 0 } });
  r = await get("?enrich=1");
  assert.equal(r.ready, true); assert.deepEqual(r.detail, {});
});

test("the public page: before the first run a note; after it the two windows with names, prices and percent badges; the JSON twin", async () => {
  const st = new MemStorage();
  const cx = { storage: st, mem: {}, env: { SHOPIFY_ADMIN_TOKEN: "t" }, now: () => Date.UTC(2026, 9, 21), log: () => {}, fetch: async () => new Response("nope", { status: 500 }) };
  const env = { ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const url = new URL(req.url); if (n !== PRICE_DO) return new Response("wrong store", { status: 404 }); return priceDoFetch(cx, req, url); } }) } };
  const page = async (path) => { const url = new URL(ORIGIN + path); return servePulse(new Request(url), env, url); };
  let r = await page("/pulse");
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(await r.text(), /first pulse is taken on the next nightly price snapshot/);
  await st.put("phs:movers", { day: DAY, date: "2026-10-21", at: 1, w7: { risers: [{ id: "1", h: "charizard-ex-199", t: "Pokemon Single", f: 1250, c: 1800, p: 44 }], fallers: [{ id: "2", h: "sol-ring", t: "MTG Single", f: 1000, c: 300, p: -70 }], counted: 2 }, w30: { risers: [], fallers: [], counted: 0 } });
  await st.put("phs:movers:detail", { day: DAY, byId: { 1: { title: "Charizard ex (199/165)", image: "https://cdn.example/1.png", inStock: true, url: "https://exorgames.com/products/charizard-ex-199" } } });
  const html = await (await page("/pulse")).text();
  assert.match(html, /Charizard ex \(199\/165\)/); assert.match(html, /Pokemon · in stock/); assert.match(html, /\$12\.50 <span class="m__arr">&rarr;<\/span> <b>\$18\.00<\/b>/); assert.match(html, /is-up">\+44%/);
  assert.match(html, /Sol Ring/, "a handle becomes a name when no title was looked up"); assert.match(html, /is-down">-70%/);
  assert.match(html, /Taken 2026-10-21/); assert.match(html, /Nothing rose\./);
  const j = await (await page("/pulse.json")).json();
  assert.equal(j.ready, true); assert.equal(j.w7.risers[0].c, 1800); assert.equal(j.detail["1"].title, "Charizard ex (199/165)");
  assert.equal((await page("/pulse.json")).headers.get("access-control-allow-origin"), "*");
  assert.match(renderPulse({ ok: false, ready: false }), /Check back tomorrow/);
});
