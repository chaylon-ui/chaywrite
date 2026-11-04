import test from "node:test";
import assert from "node:assert/strict";
import { rowOf, arrange, queryFor, condOf, BOX_CAP, boxesRoom, walk, PAGE, copiesOf } from "../src/boxes.js";

const product = (title, variants, img) => ({ title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, ""), featuredImage: img ? { url: img } : null, variants: { nodes: variants } });
const v = (id, title, price, qty, avail) => ({ id: "gid://shopify/ProductVariant/" + id, title, price: String(price), inventoryQuantity: qty, availableForSale: avail == null ? qty > 0 : avail });

test("a row: the best non-foil copy in stock, the foil only when that is all; set from the brackets; nothing in stock -> null", () => {
  const r = rowOf(product("Lightning Bolt [Modern Horizons 3]", [v(1, "Near Mint", 3.5, 0), v(2, "Lightly Played", 3.1, 2), v(3, "Near Mint Foil", 9, 1)], "https://cdn.shopify.com/s/files/1/x/bolt.jpg?v=1"));
  assert.deepEqual(r, ["Lightning Bolt", "lightning-bolt-modern-horizons-3", "3.10", "/s/files/1/x/bolt.jpg?v=1", "2", "Lightly Played", 0, 3]);
  const f = rowOf(product("Sol Ring [Commander Masters]", [v(1, "Near Mint", 3, 0), v(3, "Lightly Played Foil", 8, 1), v(4, "Near Mint Foil", 9, 2)]));
  assert.equal(f[5], "Near Mint"); assert.equal(f[6], 1); assert.equal(f[2], "9.00"); assert.equal(f[7], 3); assert.equal(f[3], "");
  assert.equal(rowOf(product("Gone [Set]", [v(1, "Near Mint", 3, 0)])), null);
  assert.equal(rowOf(product("Freebie [Set]", [v(1, "Near Mint", 0, 4)])), null);
  assert.equal(rowOf(product("No Set", [v(1, "Near Mint / English", 2, 1)]))[5], "Near Mint");
  assert.equal(condOf("Heavily Played Holofoil"), "Heavily Played");
  assert.ok(/product_type:'MTG Single' OR product_type:'Magic: The Gathering Singles'/.test(queryFor("mtg")) && /inventory_total:>0/.test(queryFor("mtg")));
  assert.equal(queryFor("chess"), "");
});

test("arrange: sets alphabetical, cards alphabetical inside, boxes cut at the cap on set boundaries, labelled by initials", () => {
  const rows = [];
  const add = (set, n) => { for (let i = 0; i < n; i++) rows.push({ set, row: ["Card " + String.fromCharCode(65 + ((i * 7) % 26)) + i, "h", "1.00", "", String(i), "Near Mint", 0, 1] }); };
  add("Zendikar", 10); add("Alpha", 5); add("Modern Horizons 3", BOX_CAP - 3); add("Dominaria", 20); add("", 2);
  const { sets, boxes } = arrange(rows);
  assert.deepEqual(sets.map((s) => s.name), ["Alpha", "Dominaria", "Modern Horizons 3", "Other", "Zendikar"]);
  const names = sets[1].rows.map((r) => r[0]);
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  // Alpha (5) + Dominaria (20) fit; MH3 (3197) would overflow -> its own box; Other + Zendikar after it
  assert.deepEqual(boxes.map((b) => [b.n, b.from, b.to, b.count, b.label]), [[1, 0, 1, 25, "A – D"], [2, 2, 3, BOX_CAP - 1, "M – O"], [3, 4, 4, 10, "Z"]]);
  assert.equal(arrange([{ set: "Only", row: ["A", "h", "1.00", "", "1", "NM", 0, 1] }]).boxes[0].label, "A – Z");
});

// a tiny in-memory stand-in for the Durable Object storage
function memStorage() {
  const m = new Map();
  return { m, get: async (k) => Array.isArray(k) ? new Map(k.map((x) => [x, m.get(x)])) : m.get(k), put: async (k, val) => { m.set(k, val); }, delete: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); } };
}

test("the room: pages in, finalize sorts them into sets and parts, index and box come back out, old parts go", async () => {
  const storage = memStorage(); const cx = { storage, now: () => 1700000000000 };
  const u = (p, q) => new URL("https://w" + p + (q || ""));
  const rows1 = [{ set: "Beta", row: ["Zebra", "z", "2.00", "", "1", "NM", 0, 1] }, { set: "Alpha", row: ["Bear", "b", "1.00", "", "2", "NM", 0, 1] }];
  const rows2 = [{ set: "Alpha", row: ["Ant", "a", "1.00", "", "3", "NM", 0, 2] }];
  assert.equal((await boxesRoom(cx, "/_stage/bx/page/put", { game: "mtg", n: 1, rows: rows1 }, u("/_stage/bx/page/put"))).ok, true);
  assert.equal((await boxesRoom(cx, "/_stage/bx/page/put", { game: "mtg", n: 2, rows: rows2 }, u("/_stage/bx/page/put"))).ok, true);
  const f = await boxesRoom(cx, "/_stage/bx/finalize", { game: "mtg", pages: 2 }, u("/_stage/bx/finalize"));
  assert.deepEqual([f.ok, f.count, f.sets, f.boxes], [true, 3, 2, 1]);
  assert.equal(storage.m.has("bxp:mtg:1"), false);
  const ix = await boxesRoom(cx, "/_stage/bx/index", null, u("/_stage/bx/index", "?game=mtg"));
  assert.deepEqual(ix.index.sets, [{ name: "Alpha", n: 2, parts: 1 }, { name: "Beta", n: 1, parts: 1 }]);
  const box = await boxesRoom(cx, "/_stage/bx/box", null, u("/_stage/bx/box", "?game=mtg&n=1"));
  assert.deepEqual(box.sets.map((s) => [s.name, s.rows.map((r) => r[0])]), [["Alpha", ["Ant", "Bear"]], ["Beta", ["Zebra"]]]);
  assert.equal((await boxesRoom(cx, "/_stage/bx/box", null, u("/_stage/bx/box", "?game=mtg&n=2"))).status, 404);
  // a rebuild with fewer sets leaves no stale parts behind
  await boxesRoom(cx, "/_stage/bx/page/put", { game: "mtg", n: 1, rows: rows2 }, u("/_stage/bx/page/put"));
  await boxesRoom(cx, "/_stage/bx/finalize", { game: "mtg", pages: 1 }, u("/_stage/bx/finalize"));
  assert.equal([...storage.m.keys()].filter((k) => k.startsWith("bx:mtg:")).length, 1);
  assert.equal((await boxesRoom(cx, "/_stage/bx/state", null, u("/_stage/bx/state"))).state, null);
});

test("walk: pages until the cursor ends, parks each page in the room, finalizes and moves to the next game", async () => {
  const calls = [];
  const room = { pages: {}, state: null };
  const env = { SHOPIFY_ADMIN_TOKEN: "t", ROOM: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { const u = new URL(req.url); const b = req.method === "POST" ? await req.json() : null; calls.push(u.pathname);
    if (u.pathname === "/_stage/bx/page/put") { room.pages[b.game + ":" + b.n] = b.rows; return Response.json({ ok: true }); }
    if (u.pathname === "/_stage/bx/finalize") return Response.json({ ok: true, count: 3, sets: 2, boxes: 1 });
    if (u.pathname === "/_stage/bx/state/put") { room.state = b.state; return Response.json({ ok: true }); }
    if (u.pathname === "/_stage/bx/state") return Response.json({ ok: true, state: room.state });
    return Response.json({ ok: false }); } }) } };
  let n = 0;
  const fetcher = async (url, o) => { n++; const vars = JSON.parse(o.body).variables; assert.ok(/MTG Single/.test(vars.q));
    const nodes = n === 1 ? [product("Bolt [MH3]", [v(1, "Near Mint", 3, 1)]), product("Dud [MH3]", [v(2, "Near Mint", 3, 0)])] : [product("Ant [Alpha]", [v(3, "Near Mint", 1, 1)]), product("Bear [Alpha]", [v(4, "Near Mint", 1, 1)])];
    return new Response(JSON.stringify({ data: { products: { pageInfo: { hasNextPage: n === 1, endCursor: n === 1 ? "c1" : null }, nodes } }, extensions: { cost: { actualQueryCost: 10, throttleStatus: { currentlyAvailable: 1000, restoreRate: 50 } } } }), { status: 200 }); };
  const state = { startedAt: 5, queue: ["mtg", "pokemon"], game: "mtg", cursor: null, page: 0, rows: 0, done: {} };
  const w = await walk(env, state, 10, fetcher);
  assert.deepEqual([w.did, state.game, state.page, state.cursor], [2, "pokemon", 0, null]);
  assert.deepEqual(room.pages["mtg:1"].map((r) => r.row[0]), ["Bolt"]);
  assert.deepEqual(room.pages["mtg:2"].map((r) => r.set), ["Alpha", "Alpha"]);
  assert.equal(state.done.mtg.count, 3);
  assert.ok(calls.includes("/_stage/bx/finalize") && room.state.game === "pokemon");
  assert.equal(room.state.lockUntil, 0);
  // a stop that lands while a page is being fetched ends the walk before that page is written, and the walk's finally leaves the stop in place
  const st2 = { startedAt: 7, game: "pokemon", queue: ["pokemon"], cursor: "c9", page: 3, done: {} };
  const stopper = async (url, o) => { room.state = Object.assign({}, room.state, { stopAt: 9 }); return new Response(JSON.stringify({ data: { products: { pageInfo: { hasNextPage: true, endCursor: "c10" }, nodes: [product("Pika [Base]", [v(9, "Near Mint", 2, 1)])] } } }), { status: 200 }); };
  const w2 = await walk(env, st2, 10, stopper);
  assert.equal(w2.did, 0);
  assert.equal(room.pages["pokemon:4"], undefined);
  assert.deepEqual([room.state.game, room.state.stopAt, room.state.lockUntil, room.state.page], ["pokemon", 9, 0, 3]);
  assert.ok(PAGE <= 100);
});

test("copiesOf: every copy in stock at a price, non-foil first by condition, then foil", () => {
  const vv = (id, title, price, qty) => ({ id: "gid://shopify/ProductVariant/" + id, title, price: String(price), inventoryQuantity: qty, availableForSale: qty > 0 });
  const out = copiesOf({ variants: { nodes: [vv(5, "Heavily Played Foil", 4, 1), vv(1, "Near Mint", 3.5, 0), vv(2, "Lightly Played", 3.1, 2), vv(3, "Near Mint Foil", 9, 1), vv(4, "Moderately Played", 2.8, 5), vv(6, "Damaged", 0, 3)] } });
  assert.deepEqual(out.map((k) => [k.variantId, k.condition, k.foil, k.price, k.qty]), [["2", "Lightly Played", false, "3.10", 2], ["4", "Moderately Played", false, "2.80", 5], ["3", "Near Mint", true, "9.00", 1], ["5", "Heavily Played", true, "4.00", 1]]);
  assert.deepEqual(copiesOf({ variants: { nodes: [] } }), []);
  assert.deepEqual(copiesOf(null), []);
});
