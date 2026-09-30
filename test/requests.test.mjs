import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeRequest, filterRequests, variantsToCheck, applyStock, requestsDoFetch, requestsDoAlarm, checkStock, serveRequests, serveRequestsStaff, buildStaffEmail, buildConfirmEmail, buildBackInStockEmail, buildReplyEmail, toList, numberOf, REQUESTS_DO } from "../src/requests.js";
import { renderRequests, renderRequest } from "../src/requests-ui.js";
import { PERMS, permsFrom, can } from "../src/stage-auth.js";

class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) { const out = new Map(); for (const x of k) if (this.m.has(x)) out.set(x, this.m.get(x)); return out; } return this.m.get(k); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { for (const x of Array.isArray(k) ? k : [k]) this.m.delete(x); }
  async list(o) { const out = new Map(); for (const k of [...this.m.keys()].sort()) if (!o || !o.prefix || k.startsWith(o.prefix)) out.set(k, this.m.get(k)); return out; }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
}
const T0 = 1_780_000_000_000;
function cx(now, extra) { return { storage: new MemStorage(), env: {}, now: () => now.t, log: () => {}, mem: {}, adminGql: async () => null, ...(extra || {}) }; }
async function call(c, path, body) {
  const url = new URL("https://w.example" + path);
  const req = body ? new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : new Request(url);
  const r = await requestsDoFetch(c, req, url);
  return { status: r.status, body: await r.json() };
}
// a worker env whose ROOM stub is the DO function itself
function envWith(c) {
  return { ...c.env, ROOM: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { assert.equal(n, REQUESTS_DO); return requestsDoFetch(c, req, new URL(req.url)); } }) } };
}
const NEW = { kind: "restock", productId: "8080", variantId: "4545", variantTitle: "Default Title", handle: "space-marines", title: "Space Marines Intercessors", type: "Warhammer 40K", vendor: "Games Workshop", qty: "3", name: "Ada Lovelace", email: "Ada@Example.test", note: "two boxes would do", url: "https://exorgames.com/products/space-marines", image: "https://cdn.shopify.com/s/files/x.jpg", customerId: "3957471740057" };

test("shapeRequest: what a request needs, and the limits", () => {
  const r = shapeRequest(NEW, T0);
  assert.ok(r && r.id.startsWith("01780000000000-"));
  assert.equal(r.email, "ada@example.test");
  assert.equal(r.qty, 3);
  assert.equal(r.status, "open");
  assert.equal(r.events[0].action, "requested");
  assert.equal(shapeRequest({ ...NEW, email: "nope" }, T0), null);
  assert.equal(shapeRequest({ ...NEW, title: "" }, T0), null);
  assert.equal(shapeRequest({ ...NEW, productId: "" }, T0), null, "a restock request names a product");
  assert.equal(shapeRequest({ ...NEW, qty: "0" }, T0).qty, 1);
  assert.equal(shapeRequest({ ...NEW, qty: "5000" }, T0).qty, 999);
  assert.equal(shapeRequest({ ...NEW, url: "https://evil.example/x" }, T0).url, "https://exorgames.com/products/space-marines", "only store links are kept");
  assert.equal(shapeRequest({ ...NEW, image: "javascript:alert(1)" }, T0).image, "");
  const sp = shapeRequest({ kind: "special", title: "Wingspan Asia", qty: 1, email: "b@example.test", note: "the 2022 edition" }, T0);
  assert.equal(sp.kind, "special");
  assert.equal(sp.productId, "");
  assert.equal(numberOf(1), "RQ-1001");
});

test("filterRequests: status, type, days (open ones always), words", () => {
  const mk = (o) => ({ number: "RQ-1", title: "T", variantTitle: "", name: "", email: "x@y.z", type: "", vendor: "", note: "", status: "open", ts: T0, ...o });
  const all = [mk({ number: "RQ-1001", title: "Clue", type: "Board Games", name: "Ada Lovelace", status: "closed", ts: T0 - 100 * 86400e3 }), mk({ number: "RQ-1002", title: "Intercessors", type: "Warhammer 40K", email: "bob@example.test" }), mk({ number: "RQ-1003", title: "Catan", type: "Board Games", status: "open", ts: T0 - 400 * 86400e3 })];
  assert.deepEqual(filterRequests(all, { status: "open" }, T0).map((r) => r.number), ["RQ-1002", "RQ-1003"]);
  assert.deepEqual(filterRequests(all, { type: "Board Games" }, T0).map((r) => r.number), ["RQ-1001", "RQ-1003"]);
  assert.deepEqual(filterRequests(all, { days: 30 }, T0).map((r) => r.number), ["RQ-1002", "RQ-1003"], "the old closed one drops, the old open one stays");
  assert.deepEqual(filterRequests(all, { q: "ada love" }, T0).map((r) => r.number), ["RQ-1001"]);
  assert.deepEqual(filterRequests(all, { q: "BOB" }, T0).map((r) => r.number), ["RQ-1002"]);
  assert.deepEqual(filterRequests(all, { q: "rq-1003" }, T0).map((r) => r.number), ["RQ-1003"]);
});

test("stock: which variants to check, and when the store is told", () => {
  const a = { status: "open", kind: "restock", variantId: "1", stock: {} }, b = { status: "closed", kind: "restock", variantId: "2" }, c = { status: "open", kind: "special", variantId: "" }, d = { status: "open", kind: "restock", variantId: "1" };
  assert.deepEqual(variantsToCheck([a, b, c, d]), ["1"]);
  assert.equal(applyStock(a, { available: false, qty: 0 }, T0), false);
  assert.equal(applyStock(a, { available: true, qty: 4 }, T0 + 1), true, "back in: tell");
  assert.equal(applyStock(a, { available: true, qty: 3 }, T0 + 2), false, "still in: told already");
  assert.equal(applyStock(a, { available: false, qty: 0 }, T0 + 3), false);
  assert.equal(applyStock(a, { available: true, qty: 1 }, T0 + 4), true, "out and back again: tell again");
  const closed = { status: "closed", kind: "restock", variantId: "1", stock: { available: false } };
  assert.equal(applyStock(closed, { available: true, qty: 1 }, T0), false, "a decided request is never announced");
});

test("the DO: new, status, list, mark, message, switches, rate limit", async () => {
  const now = { t: T0 };
  const c = cx(now);
  const st0 = await call(c, "/_req/status?product=8080");
  assert.equal(st0.body.on, true);
  const n1 = await call(c, "/_req/new", { ...NEW, ip: "1.2.3.4" });
  assert.equal(n1.status, 200);
  assert.equal(n1.body.number, "RQ-1001");
  assert.equal(n1.body.record.email, "ada@example.test");
  now.t += 1000;
  const n2 = await call(c, "/_req/new", { kind: "special", title: "Wingspan Asia", qty: 2, email: "bob@example.test", name: "Bob", ip: "1.2.3.4" });
  assert.equal(n2.body.number, "RQ-1002");
  assert.equal((await call(c, "/_req/new", { ...NEW, email: "x" })).status, 400);
  const list = await call(c, "/_req/list");
  assert.equal(list.body.count, 2);
  assert.equal(list.body.records[0].number, "RQ-1002", "newest first");
  assert.deepEqual(list.body.types, { "Warhammer 40K": 1 });
  assert.equal((await call(c, "/_req/list?type=Warhammer%2040K")).body.count, 1);
  assert.equal((await call(c, "/_req/list?q=bob")).body.records[0].number, "RQ-1002");
  const id = n1.body.id;
  const g = await call(c, "/_req/get?id=" + id);
  assert.equal(g.body.record.customerId, "3957471740057");
  // mark and message
  const m = await call(c, "/_req/mark", { id, status: "ordered", by: "staff@exorgames.com", note: "GW order 55" });
  assert.equal(m.body.record.status, "ordered");
  assert.equal(m.body.record.staffNote, "GW order 55");
  assert.equal(m.body.record.events.at(-1).action, "ordered");
  assert.equal((await call(c, "/_req/mark", { id, status: "bogus" })).status, 400);
  const msg = await call(c, "/_req/message", { id, text: "Ordered today, about two weeks.", from: "staff", by: "staff@exorgames.com", email: { status: "sent", id: "re_1" } });
  assert.equal(msg.body.record.messages.length, 1);
  assert.equal(msg.body.record.messages[0].email.status, "sent");
  assert.equal((await call(c, "/_req/message", { id, text: "  " })).status, 400);
  const mail = await call(c, "/_req/mail", { id, mail: { staff: { status: "sent", id: "re_2" } } });
  assert.equal(mail.body.record.mail.staff.id, "re_2");
  // a product switched off: status says so, a new request is refused, the list carries the cfg
  const off = await call(c, "/_req/cfg/set", { product: "8080", productOff: true, title: "Space Marines Intercessors", by: "admin@exorgames.com" });
  assert.equal(off.body.cfg.offProducts["8080"].title, "Space Marines Intercessors");
  assert.equal((await call(c, "/_req/status?product=8080")).body.on, false);
  assert.equal((await call(c, "/_req/status?product=1")).body.on, true);
  const refused = await call(c, "/_req/new", { ...NEW, ip: "9.9.9.9" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "off");
  await call(c, "/_req/cfg/set", { product: "8080", productOff: false });
  assert.equal((await call(c, "/_req/status?product=8080")).body.on, true);
  // the whole store off
  await call(c, "/_req/cfg/set", { off: true, by: "admin@exorgames.com" });
  assert.equal((await call(c, "/_req/status?product=1")).body.on, false);
  assert.equal((await call(c, "/_req/status")).body.off, true);
  assert.equal((await call(c, "/_req/new", { ...NEW, ip: "9.9.9.9" })).status, 409);
  await call(c, "/_req/cfg/set", { off: false });
  // rate limit per address
  for (let i = 0; i < 6; i++) assert.equal((await call(c, "/_req/new", { ...NEW, ip: "1.2.3.4" })).status, 200, "request " + i);
  assert.equal((await call(c, "/_req/new", { ...NEW, ip: "1.2.3.4" })).status, 429);
  assert.equal((await call(c, "/_req/new", { ...NEW, ip: "5.5.5.5" })).status, 200);
  now.t += 3600e3 + 1;
  assert.equal((await call(c, "/_req/new", { ...NEW, ip: "1.2.3.4" })).status, 200, "an hour later the address may again");
  const h = await call(c, "/_req/health");
  assert.equal(h.body.total, 10);
  assert.ok(c.storage.alarm != null, "the first call arms the alarm");
});

test("stock check: asks Shopify for open restock variants, writes the answer, emails once per return", async () => {
  const now = { t: T0 };
  const asked = [];
  const sent = [];
  const c = cx(now, {
    env: { RESEND_API_KEY: "re_test", REQUESTS_EMAIL_TO: "charlottetown@exorgames.com, extra@exorgames.com" },
    adminGql: async (q, v) => { asked.push(v.ids); return { nodes: v.ids.map((id) => ({ id, availableForSale: id.endsWith("/4545"), inventoryQuantity: id.endsWith("/4545") ? 5 : 0, inventoryPolicy: "DENY" })) }; },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "re_x" }), { status: 200 }); };
  try {
    await call(c, "/_req/new", { ...NEW, ip: "a" });
    now.t += 10;
    await call(c, "/_req/new", { ...NEW, variantId: "7777", title: "Other kit", email: "c@example.test", ip: "b" });
    now.t += 10;
    await call(c, "/_req/new", { kind: "special", title: "Not listed", email: "d@example.test", ip: "c" });
    const r1 = await checkStock(c, true);
    assert.equal(r1.variants, 2);
    assert.equal(r1.back, 1);
    assert.equal(r1.emailed, true);
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].sort(), ["gid://shopify/ProductVariant/4545", "gid://shopify/ProductVariant/7777"]);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["charlottetown@exorgames.com", "extra@exorgames.com"]);
    assert.match(sent[0].subject, /^Back in stock: Space Marines Intercessors - 1 request waiting/);
    assert.match(sent[0].text, /Ada Lovelace wants 3/);
    assert.equal(sent[0].reply_to, undefined, "internal mail: no reply-to");
    const list = await call(c, "/_req/list");
    const ada = list.body.records.find((r) => r.email === "ada@example.test");
    assert.equal(ada.stock.available, true);
    assert.equal(ada.stock.qty, 5);
    assert.ok(ada.stock.notifiedAt > 0);
    assert.equal(ada.events.at(-1).action, "back in stock");
    const other = list.body.records.find((r) => r.email === "c@example.test");
    assert.equal(other.stock.available, false);
    // a second look: still in stock, nothing new is sent
    const r2 = await checkStock(c, true);
    assert.equal(r2.back, 0);
    assert.equal(sent.length, 1);
    // the alarm runs the check and re-arms half an hour out
    await requestsDoAlarm(c);
    assert.equal(c.storage.alarm, now.t + 30 * 60e3);
    // the inventory webhook pulls the next look forward
    await call(c, "/_req/inv", {});
    assert.equal(c.storage.alarm, now.t + 60e3);
  } finally { globalThis.fetch = realFetch; }
});

test("the public API: CORS, status, new (emails the store with the customer as reply-to, confirms the customer), honeypot, off", async () => {
  const now = { t: T0 };
  const c = cx(now, { env: { RESEND_API_KEY: "re_test" } });
  const env = envWith(c);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "re_" + sent.length }), { status: 200 }); };
  try {
    const mk = (path, body, origin) => new Request("https://w.example" + path, body ? { method: "POST", headers: { "content-type": "application/json", origin: origin || "https://exorgames.com", "cf-connecting-ip": "8.8.8.8" }, body: JSON.stringify(body) } : { headers: { origin: origin || "https://exorgames.com" } });
    const pre = await serveRequests(new Request("https://w.example/requests/api/new", { method: "OPTIONS", headers: { origin: "https://exorgames.com" } }), env, new URL("https://w.example/requests/api/new"), null);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "https://exorgames.com");
    const st = await serveRequests(mk("/requests/api/status?product=8080"), env, new URL("https://w.example/requests/api/status?product=8080"), null);
    assert.deepEqual(await st.json(), { ok: true, on: true });
    const strange = await serveRequests(mk("/requests/api/status", null, "https://evil.example"), env, new URL("https://w.example/requests/api/status"), null);
    assert.equal(strange.headers.get("access-control-allow-origin"), null, "other origins get no CORS");
    const r = await serveRequests(mk("/requests/api/new", NEW), env, new URL("https://w.example/requests/api/new"), null);
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.number, "RQ-1001");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].to, ["charlottetown@exorgames.com"]);
    assert.equal(sent[0].reply_to, "ada@example.test", "the store can answer from the inbox");
    assert.match(sent[0].subject, /^Item request RQ-1001: Space Marines Intercessors x3 \(Ada Lovelace\)/);
    assert.match(sent[0].text, /Customer: Ada Lovelace <ada@example.test> - signed in, customer 3957471740057/);
    assert.match(sent[0].text, /Note: two boxes would do/);
    assert.deepEqual(sent[1].to, ["ada@example.test"]);
    assert.equal(sent[1].reply_to, "charlottetown@exorgames.com");
    assert.match(sent[1].subject, /^We got your request RQ-1001/);
    assert.match(sent[1].text, /Thanks, Ada\./);
    const g = await call(c, "/_req/get?id=" + j.id);
    assert.equal(g.body.record.mail.staff.status, "sent");
    assert.equal(g.body.record.mail.confirm.status, "sent");
    // a bot filling the hidden field is told yes and stored nowhere
    const bot = await serveRequests(mk("/requests/api/new", { ...NEW, website: "http://spam" }), env, new URL("https://w.example/requests/api/new"), null);
    assert.equal((await bot.json()).number, "RQ-0");
    assert.equal((await call(c, "/_req/list")).body.total, 1);
    // off for that product: 409 with a message the page can show
    await call(c, "/_req/cfg/set", { product: "8080", productOff: true });
    const off = await serveRequests(mk("/requests/api/new", NEW), env, new URL("https://w.example/requests/api/new"), null);
    assert.equal(off.status, 409);
    assert.match((await off.json()).error, /not taking requests/);
    const bad = await serveRequests(mk("/requests/api/new", { ...NEW, productId: "1", email: "nope" }), env, new URL("https://w.example/requests/api/new"), null);
    assert.equal(bad.status, 400);
    const h = await serveRequests(mk("/requests/health"), env, new URL("https://w.example/requests/health"), null);
    const hj = await h.json();
    assert.equal(hj.total, 1);
    assert.equal(hj.email, "configured");
  } finally { globalThis.fetch = realFetch; }
});

test("staff pages: the permission gate, the list, one request, reply and mark", async () => {
  const now = { t: T0 };
  const c = cx(now, { env: { RESEND_API_KEY: "re_test" } });
  const env = envWith(c);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "re_r" }), { status: 200 }); };
  try {
    const n = await call(c, "/_req/new", { ...NEW, ip: "z" });
    const id = n.body.id;
    const helpers = { html: (s, status) => new Response(s, { status: status || 200, headers: { "content-type": "text/html" } }), redirect: (to) => new Response(null, { status: 303, headers: { location: to } }), q: (o) => { const s = new URLSearchParams(); for (const [a, b] of Object.entries(o)) if (b) s.set(a, b); const t = s.toString(); return t ? "?" + t : ""; }, toLogin: () => new Response(null, { status: 303, headers: { location: "/9pocket/login" } }), opts: { user: null } };
    const admin = { email: "chaylon@exorgames.com", name: "Chaylon", role: "admin", perms: {} };
    const viewer = { email: "v@exorgames.com", name: "Viewer", role: "staff", perms: permsFrom({ perm_edit: "on" }) };
    const clerk = { email: "c@exorgames.com", name: "Clerk", role: "staff", perms: permsFrom({ perm_requests: "on" }) };
    assert.ok(PERMS.some((p) => p.key === "requests"));
    assert.equal(can(clerk, "requests"), true);
    assert.equal(can(viewer, "requests"), false);
    const get = (path, user) => serveRequestsStaff(new Request("https://w.example" + path), env, new URL("https://w.example" + path), user, null, { ...helpers, opts: { user } });
    const post = (path, user, form) => serveRequestsStaff(new Request("https://w.example" + path, { method: "POST" }), env, new URL("https://w.example" + path), user, form, { ...helpers, opts: { user } });
    assert.equal((await get("/9pocket/requests", null)).status, 303, "signed out: to the login");
    const denied = await get("/9pocket/requests", viewer);
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /cannot see item requests/);
    const list = await get("/9pocket/requests?type=Warhammer%2040K", clerk);
    const lt = await list.text();
    assert.match(lt, /RQ-1001/);
    assert.match(lt, /Ada Lovelace/);
    assert.match(lt, /ada@example\.test/);
    assert.ok(!lt.includes("Switch off"), "only an admin sees the store-wide switch");
    assert.match(await (await get("/9pocket/requests", admin)).text(), /Switch off/);
    const one = await get("/9pocket/requests/r/" + id, clerk);
    const ot = await one.text();
    assert.match(ot, /Space Marines Intercessors/);
    assert.match(ot, /customers\/3957471740057/, "the signed-in customer links to Shopify admin");
    assert.match(ot, /Stop taking requests for this product/);
    // a reply goes out by email under the store's address and lands on the thread
    const rep = await post("/9pocket/requests/control", clerk, { action: "reply", id, text: "Ordered today, about two weeks." });
    assert.equal(rep.status, 303);
    assert.match(rep.headers.get("location"), /msg=Emailed\+ada%40example\.test/);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["ada@example.test"]);
    assert.equal(sent[0].reply_to, "charlottetown@exorgames.com");
    assert.match(sent[0].subject, /^Re: your request RQ-1001/);
    assert.match(sent[0].text, /Ordered today, about two weeks\.\n- Clerk/);
    const noMail = await post("/9pocket/requests/control", clerk, { action: "reply", id, text: "Left a voicemail.", send: "0" });
    assert.match(noMail.headers.get("location"), /msg=Noted/);
    assert.equal(sent.length, 1);
    const rec = (await call(c, "/_req/get?id=" + id)).body.record;
    assert.equal(rec.messages.length, 2);
    assert.equal(rec.messages[1].email.status, "kept");
    // mark, product off (the clerk may), store off (admin only)
    const mk = await post("/9pocket/requests/control", clerk, { action: "mark", id, status: "arrived", note: "on the shelf" });
    assert.match(mk.headers.get("location"), /msg=Marked\+arrived/);
    const poff = await post("/9pocket/requests/control", clerk, { action: "product-off", id, product: "8080", title: "Space Marines Intercessors" });
    assert.match(poff.headers.get("location"), /msg=Requests\+are\+off/);
    assert.equal((await call(c, "/_req/status?product=8080")).body.on, false);
    const soff = await post("/9pocket/requests/control", clerk, { action: "off", json: 1 });
    assert.equal(soff.status, 400);
    assert.match((await soff.json()).error, /Only an admin/);
    const aoff = await post("/9pocket/requests/control", admin, { action: "off", json: 1 });
    assert.equal((await aoff.json()).ok, true);
    assert.equal((await call(c, "/_req/status")).body.off, true);
    const chk = await post("/9pocket/requests/control", admin, { action: "check", json: 1 });
    assert.match((await chk.json()).message, /Checked 0 variants/, "an arrived request is no longer watched");
    const json = await get("/9pocket/requests.json", clerk);
    assert.equal((await json.json()).total, 1);
    const page = await get("/9pocket/requests/r/" + id, admin);
    assert.match(await page.text(), /Take requests for this product again/);
  } finally { globalThis.fetch = realFetch; }
});

test("emails: the builders say what matters", () => {
  const r = { ...shapeRequest(NEW, T0), number: "RQ-1001" };
  const s = buildStaffEmail(r);
  assert.match(s.text, /Quantity: 3/);
  assert.match(s.text, /Open in 9Pocket: https:\/\/exor-binder\.nevski\.workers\.dev\/9pocket\/requests\/r\//);
  const sp = buildStaffEmail({ ...shapeRequest({ kind: "special", title: "Wingspan Asia", email: "b@example.test", qty: 1 }, T0), number: "RQ-1002" });
  assert.match(sp.subject, /^Special order RQ-1002: Wingspan Asia x1$/);
  const cf = buildConfirmEmail(r);
  assert.match(cf.html, /Nothing is charged or reserved yet/);
  assert.match(cf.html, /See the item/);
  assert.match(cf.text, /Your note: two boxes would do/);
  const rp = buildReplyEmail(r, "Hi <there>", "Clerk");
  assert.match(rp.html, /Hi &lt;there&gt;/);
  const b = buildBackInStockEmail([{ ...r, stock: { qty: 5 } }, { ...r, number: "RQ-1003", name: "Bob", qty: 1 }]);
  assert.match(b.text, /Space Marines Intercessors - 5 in stock/);
  assert.match(b.text, /RQ-1003: Bob wants 1/);
  assert.match(b.subject, /2 requests waiting/);
  assert.deepEqual(toList({}), ["charlottetown@exorgames.com"]);
  assert.deepEqual(toList({ REQUESTS_EMAIL_TO: "a@x.y,b@x.y" }), ["a@x.y", "b@x.y"]);
});

test("renderers: a request from a signed-out shopper, a special order", () => {
  const r = { ...shapeRequest({ kind: "special", title: "Wingspan <Asia>", email: "b@example.test", qty: 2, note: "2022 print" }, T0), number: "RQ-1002" };
  const page = renderRequest(r, { user: { role: "admin", email: "a@x" }, cfg: {}, adminCustomer: "https://admin.shopify.com/store/x/customers/", emailTo: ["charlottetown@exorgames.com"] });
  assert.match(page, /Wingspan &lt;Asia&gt;/);
  assert.match(page, /special order/);
  assert.match(page, /not signed in/);
  assert.match(page, /A special order names no listed product/);
  const list = renderRequests({ records: [r], counts: { open: 1 }, types: {}, total: 1, cfg: { off: true, offProducts: { 1: { title: "Hot thing", by: "a@x", at: T0 } } } }, { user: { role: "staff", email: "c@x", perms: { requests: true } }, filters: {}, emailTo: [] });
  assert.match(list, /OFF for the whole store/);
  assert.match(list, /Requests off for:<\/b> Hot thing/);
  assert.match(list, /RQ-1002/);
});
