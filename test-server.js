/* Local stand-in for the Cloudflare Worker: serves public/, stubs
   /cards.json per game, /settings, /switch, /admin/api, and runs a minimal
   BinderRoom over a real WebSocket so TV+phone pair for screenshots. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require(path.join(__dirname, "..", "node_modules", "ws"));

const PUB = path.join(__dirname, "public");
const PORT = 8787;

const state = {
  settings: {
    header: "Featured Singles · New Arrivals over $10",
    collection: "new-arrivals",
    theme: "mtg",
    game: "mtg",
    topLoaders: false,
    tabs: [
      { label: "Magic", collection: "new-arrivals", theme: "mtg", game: "mtg" },
      { label: "Pokémon", collection: "pokemon-singles-new-arrivals", theme: "pokemon", game: "pokemon" },
      { label: "Yu-Gi-Oh!", collection: "yu-gi-oh-singles-new-arrivals", theme: "yugioh", game: "yugioh" },
    ],
    adEnabled: false,
    adText: "Got cards? Exor Games buys singles, collections & sealed — cash or store credit.",
    reviewUrl: "",
  },
};

/* ---- stub decks (mirror worker output shape) ---- */
function deck(game) {
  const mk = (lanes, names, colorNames) => {
    const cards = [];
    let vid = 1000;
    lanes.forEach((lane, li) => {
      for (let i = 0; i < 4; i++) {
        cards.push({
          name: `${names[li % names.length]} ${i + 1}`,
          color: lane,
          set: game.toUpperCase() + " Test Set",
          type: lane,
          price: (12 + li * 3 + i * 2.25).toFixed(2),
          foil: (li + i) % 5 === 0,
          condition: "Near Mint",
          image: null,
          variantId: String(vid++),
          url: "https://exorgames.com",
        });
      }
    });
    return { version: game + "-v1", updated: new Date().toISOString(), count: cards.length, game, colorNames, cards };
  };
  if (game === "pokemon") {
    const lanes = ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Dragon", "Colorless", "Trainer"];
    return mk(lanes, ["Venusaur ex", "Charizard ex", "Blastoise ex", "Pikachu ex", "Mewtwo ex", "Machamp", "Darkrai", "Metagross", "Rayquaza", "Snorlax", "Boss's Orders"], Object.fromEntries(lanes.map((l) => [l, l])));
  }
  if (game === "yugioh") {
    const lanes = ["Spell", "Trap", "Dark", "Light", "Earth", "Water", "Fire", "Wind", "Monster"];
    return mk(lanes, ["Pot of Greed", "Mirror Force", "Dark Magician", "Blue-Eyes", "Obelisk", "Levia-Dragon", "Volcanic", "Stardust", "Ash Blossom"], Object.fromEntries(lanes.map((l) => [l, l])));
  }
  const lanes = ["W", "U", "B", "R", "G", "M", "C"];
  return mk(lanes, ["Esper Sentinel", "Rhystic Study", "Demonic Tutor", "Ragavan", "Craterhoof", "Atraxa", "Mana Crypt"], { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", M: "Multicolor", C: "Colorless" });
}
const gameOfCollection = (c) => (c || "").includes("pokemon") ? "pokemon" : (c || "").includes("yu") ? "yugioh" : "mtg";

/* ---- room ---- */
let tv = null, phone = null;
const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
const broadcastSettings = () => {
  const m = { type: "settings", data: state.settings };
  if (tv) send(tv, m);
  if (phone) send(phone, m);
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
  const file = (f) => {
    const fp = path.join(PUB, f);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "text/plain", "cache-control": "no-store" });
    res.end(fs.readFileSync(fp));
  };
  if (p === "/settings") return json(state.settings);
  if (p === "/cards.json") {
    const c = url.searchParams.get("collection") || state.settings.collection;
    return json(deck(gameOfCollection(c)));
  }
  if (p === "/switch") {
    const i = parseInt(url.searchParams.get("i"), 10);
    const t = state.settings.tabs[i];
    if (!t) return json({ error: "bad tab" }, 400);
    state.settings = { ...state.settings, collection: t.collection, theme: t.theme, game: t.game };
    broadcastSettings();
    return json({ ok: true, settings: state.settings });
  }
  if (p === "/admin/api" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        const b = JSON.parse(body || "{}");
        if (String(b.pin || "") !== "4242") return json({ error: "Incorrect PIN" }, 403);
        state.settings = { ...state.settings, ...(b.patch || {}) };
        broadcastSettings();
        json({ ok: true, settings: state.settings });
      } catch { json({ error: "bad json" }, 400); }
    });
    return;
  }
  if (p === "/" || p === "/tv") return file("tv.html");
  if (p.startsWith("/c/")) return file("phone.html");
  if (p === "/admin" || p === "/admin.html") return file("admin.html");
  return file(p.slice(1));
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const role = url.searchParams.get("role");
  if (role === "tv") {
    tv = ws;
    send(ws, { type: "settings", data: state.settings });
    send(ws, { type: "tv_state", paired: !!phone, token: phone ? null : "EX-TEST", tokenLeft: 120, idleLeft: phone ? 120 : 0 });
  } else if (role === "phone") {
    phone = ws;
    send(ws, { type: "claimed", controllerId: "test" });
    send(ws, { type: "settings", data: state.settings });
    if (tv) { send(tv, { type: "paired" }); send(tv, { type: "tv_state", paired: true, token: null, tokenLeft: 0, idleLeft: 120 }); }
    ws.on("message", (data) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (tv) send(tv, msg);
      send(ws, { type: "ack", of: msg.type, data: msg.data ?? null });
    });
    ws.on("close", () => { if (phone === ws) phone = null; });
  }
});

server.listen(PORT, () => console.log("binder test server on http://localhost:" + PORT));
