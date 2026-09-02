import { BinderRoom } from "./room.js";
import { serveCards, serveSearch, serveInstock, serveDeck, serveDeckGate, serveBuyPrice, serveSimilar, serveSisters, serveSisterCheck, serveQty, servePickups, servePickupDone, serveSetSuggest } from "./cards.js";
import { serveReviews } from "./reviews.js";
import { serveStores } from "./stores.js";
import { serveBinderSearch, serveBinderSearchStatus, warmBinderSearch, CACHE_DO } from "./binder-search.js";
import { serveIcs } from "./ics.js";
import { servePriceHistory } from "./price-history.js";

export { BinderRoom };

/* Every TV is a ROOM — its own Durable Object with its own settings, PIN,
   pairing token and QR. ?room=sports on the TV URL gives the sports-area
   TV an independent, compartmentalized showcase; no param = "default"
   (the original TV keeps its state). Rooms create themselves on first use. */
const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// Deck Builder ban list, cached per isolate so banned IPs cost one DO read
// a minute instead of one per request. Fails open: tracking problems must
// never take the Deck Builder down for real customers.
let deckBans = { at: 0, ips: null };
async function deckBanned(env, origin, ip) {
  try {
    if (!deckBans.ips || Date.now() - deckBans.at > 60e3) {
      const r = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(origin + "/deck-banlist"));
      deckBans = { at: Date.now(), ips: new Set(((await r.json()).ips || [])) };
    }
    return ip && deckBans.ips.has(ip);
  } catch { return false; }
}

// Staff-PIN check against the default room (same lockout as /staff, /pickups).
async function staffOk(env, origin, k) {
  try {
    const chk = await env.ROOM.get(env.ROOM.idFromName("default"))
      .fetch(new Request(origin + "/staff-check?k=" + encodeURIComponent(k || "")));
    return !!(await chk.json()).ok;
  } catch { return false; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rq = String(url.searchParams.get("room") || "").toLowerCase();
    // The search-cache DO shares the BinderRoom class; its name is not a screen.
    const roomName = ROOM_RE.test(rq) && rq !== CACHE_DO ? rq : "default";
    const id = env.ROOM.idFromName(roomName);
    const room = env.ROOM.get(id);

    // Cached proxy for the advanced-search widget's BinderPOS product POST
    // (binder-search.js): global DO store + cron pre-warm, CORS for the
    // storefront. Same body in, same JSON out, plus x-xg-cache.
    if (url.pathname === "/binder/search") {
      return serveBinderSearch(request, env, ctx);
    }
    if (url.pathname === "/binder/search/status") {
      return serveBinderSearchStatus(env);
    }

    // Round 27: one-link add-to-calendar (.ics) for store events, and the
    // nightly price history behind the card-page sparkline. Modules in
    // src/ics.js and src/price-history.js.
    if (url.pathname === "/ics") {
      return serveIcs(request, env, ctx);
    }
    if (url.pathname === "/price-history.json" || url.pathname.startsWith("/price-history/")) {
      return servePriceHistory(request, env, ctx);
    }

    // The default room's DO doubles as the screen registry: remember every
    // room that shows activity so /admin can offer a picker of known screens.
    if (url.pathname === "/rooms") {
      return env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(url.origin + "/rooms-list"));
    }

    if (
      url.pathname === "/ws" ||
      url.pathname === "/status" ||
      url.pathname === "/settings" ||
      url.pathname === "/admin/api" ||
      url.pathname === "/switch" ||
      url.pathname === "/counter" ||
      url.pathname === "/alert" ||
      url.pathname === "/track" ||
      url.pathname === "/alog" ||
      url.pathname === "/feedback" ||
      url.pathname === "/fblist"
    ) {
      // PIN-gated connections. Staff alert pages and Flow's /alert POSTs check
      // against the DEFAULT room's admin PIN (one key covers every screen);
      // remote-control mirrors check against the TARGET screen's own PIN.
      // The room DO applies a lockout against brute force either way.
      const wsRole = url.pathname === "/ws" ? (url.searchParams.get("role") || "") : "";
      if (url.pathname === "/alert" || wsRole === "staff" || wsRole === "remote") {
        const k = url.searchParams.get("k") || "";
        const gate = wsRole === "remote" ? room : env.ROOM.get(env.ROOM.idFromName("default"));
        let ok = false;
        try {
          const chk = await gate.fetch(new Request(url.origin + "/staff-check?k=" + encodeURIComponent(k)));
          ok = !!(await chk.json()).ok;
        } catch {}
        if (!ok) return Response.json({ error: "staff key required" }, { status: 403 });
      }
      if (roomName !== "default" && url.pathname !== "/status") {
        ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName("default"))
          .fetch(new Request(url.origin + "/rooms-register?name=" + roomName)));
      }
      return room.fetch(request);
    }

    if (url.pathname === "/setsuggest.json") {
      return serveSetSuggest(request, env, ctx);
    }
    if (url.pathname === "/search.json") {
      return serveSearch(request, env);
    }

    if (url.pathname === "/instock.json") {
      return serveInstock(request, env, ctx);
    }

    // Owner-managed IP bans cover the Deck Builder surface: the search, its
    // gate, the sister-store follow-up and the activity beacon.
    if (url.pathname === "/deck.json" || url.pathname === "/deck-gate" ||
        url.pathname === "/sisterstock.json" || url.pathname === "/deck-track") {
      const ip = request.headers.get("cf-connecting-ip") || "";
      if (await deckBanned(env, url.origin, ip)) {
        return Response.json({ error: "unavailable" }, { status: 403, headers: { "access-control-allow-origin": "*" } });
      }
    }

    if (url.pathname === "/deck.json") {
      return serveDeck(request, env, ctx);
    }

    // Issues the proof-of-work seed the Deck Builder must solve before each
    // /deck.json call (anti-scrape gate; see serveDeckGate in cards.js).
    if (url.pathname === "/deck-gate") {
      return serveDeckGate(request, env);
    }

    // Deck Builder admin. The page ships to anyone, but every read and
    // action behind it requires the staff PIN (with the default room's
    // brute-force lockout), because the data now includes shopper IPs,
    // carted card names and sales.
    if (url.pathname === "/deckstats") {
      return serveAsset(env, "/deckstats.html", request);
    }
    if (url.pathname === "/deckstats.json") {
      if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) {
        return Response.json({ error: "staff key required" }, { status: 403, headers: { "cache-control": "no-store" } });
      }
      const opIn = url.searchParams.get("op") || "overview";
      const op = ["orders", "misslog", "overview"].indexOf(opIn) > -1 ? opIn : "overview";
      const me = encodeURIComponent(request.headers.get("cf-connecting-ip") || "");
      const res = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(url.origin + "/deck-admin?op=" + op + "&me=" + me));
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (url.pathname === "/deck-admin" && request.method === "POST") {
      if (!(await staffOk(env, url.origin, url.searchParams.get("k")))) {
        return Response.json({ error: "staff key required" }, { status: 403 });
      }
      const op = url.searchParams.get("op");
      if (["ban", "unban", "wl_add", "wl_del", "hot_add", "hot_del"].indexOf(op) === -1) {
        return Response.json({ error: "bad op" }, { status: 400 });
      }
      deckBans = { at: 0, ips: null }; // this isolate re-reads the ban list next request
      const qs = new URLSearchParams({
        op,
        ip: url.searchParams.get("ip") || "",
        note: url.searchParams.get("note") || "",
        name: url.searchParams.get("name") || "",
        game: url.searchParams.get("game") || "",
        me: request.headers.get("cf-connecting-ip") || "",
      });
      const res = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(url.origin + "/deck-admin?" + qs));
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    // The storefront's activity beacon (write-only, rate-limited in the
    // DO). ev=cart carries the carted names in the body; ev=act carries a
    // control interaction. Searches are logged worker-side in serveDeck
    // behind the proof-of-work, so they are not accepted here.
    if (url.pathname === "/deck-track") {
      const ev = url.searchParams.get("ev");
      if (ev === "cart" || ev === "act") {
        let body = {};
        try {
          const txt = (await request.text()).slice(0, 4096);
          if (txt) body = JSON.parse(txt);
        } catch { body = {}; }
        const payload = {
          ev,
          ip: request.headers.get("cf-connecting-ip") || "",
          sid: url.searchParams.get("sid") || "",
          game: url.searchParams.get("game") || "",
          n: url.searchParams.get("n") || 0,
          v: url.searchParams.get("v") || 0,
          a: url.searchParams.get("a") || "",
          d: url.searchParams.get("d") || "",
          names: Array.isArray(body.names) ? body.names : [],
        };
        ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName("default"))
          .fetch(new Request(url.origin + "/deck-event", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
          })).catch(() => {}));
      }
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
    }

    if (url.pathname === "/buyprice.json") {
      return serveBuyPrice(request, env, ctx);
    }

    // Homepage reviews band: Google reviews proxied + curated server-side
    // (5-star only, text sentiment-screened) so the key stays private.
    if (url.pathname === "/reviews.json") {
      return serveReviews(request, env, ctx);
    }

    // Store-hours band: every Exor store's live opening hours from its
    // Google Business Profile, proxied the same way so the key stays private.
    if (url.pathname === "/stores.json") {
      return serveStores(request, env, ctx);
    }

    // The card-page reveal script on exorgames.com reads this file with a
    // cross-origin fetch(); the raw asset response carries no CORS header,
    // so browsers block it (curl/node never see this). Wrap it.
    if (url.pathname === "/buy-rules.json") {
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers);
      h.set("access-control-allow-origin", "*");
      return new Response(res.body, { status: res.status, headers: h });
    }

    if (url.pathname === "/similar.json") {
      return serveSimilar(request, ctx);
    }

    if (url.pathname === "/sisters.json") {
      return serveSisters(request, ctx);
    }

    // Deck Builder follow-up: are the copies Charlottetown can't cover in
    // stock at a sister store? Batched over their public search (cards.js).
    if (url.pathname === "/sisterstock.json") {
      return serveSisterCheck(request, ctx);
    }

    if (url.pathname === "/qty.json") {
      return serveQty(request, env, ctx);
    }

    // Shopify's inventory webhook: stock moved on some item. The payload is
    // treated as an untrusted HINT — the default room re-reads the real
    // numbers with its own Admin token before believing anything, so a
    // spoofed post can at worst cause a lookup. Reply fast, work after.
    if (url.pathname === "/hook/inv" && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const item = String((b && b.inventory_item_id) || "").replace(/\D/g, "").slice(0, 24);
      if (item) ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName("default"))
        .fetch(new Request(url.origin + "/inv-hint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item }) })));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/cards.json") {
      let collection = url.searchParams.get("collection") || "";
      let newToday = url.searchParams.get("nt") === "1";
      let showcase = url.searchParams.get("sc") === "1";
      let sleeves = url.searchParams.get("sv") === "1";
      if (!collection) {
        try {
          const s = await (await room.fetch(new Request(url.origin + "/settings"))).json();
          if (s && s.collection) collection = s.collection;
          if (s) { newToday = !!s.newTodayActive; showcase = !!s.showcaseActive; sleeves = !!s.sleevesActive || !!s.shelfActive; }
        } catch {}
      }
      return serveCards(request, env, ctx, collection || "new-arrivals", newToday, showcase, sleeves);
    }

    if (url.pathname === "/admin" || url.pathname === "/admin.html") {
      return serveAsset(env, "/admin.html", request);
    }
    if (url.pathname === "/staff") {
      return serveAsset(env, "/staff.html", request);
    }
    if (url.pathname === "/pickups") {
      return serveAsset(env, "/pickups.html", request);
    }
    // Live list of every open draft order (the POS drafts list hides
    // third-party ones) — gated behind the default room's admin PIN with
    // the same lockout as the staff page.
    if (url.pathname === "/pickups.json") {
      // CORS on every branch (403 included) so the POS tile app — a
      // Shopify-hosted extension origin — can read the response and tell
      // "wrong PIN" apart from "network down".
      const cors = { "access-control-allow-origin": "*" };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      const k = url.searchParams.get("k") || "";
      let ok = false;
      try {
        const chk = await env.ROOM.get(env.ROOM.idFromName("default"))
          .fetch(new Request(url.origin + "/staff-check?k=" + encodeURIComponent(k)));
        ok = !!(await chk.json()).ok;
      } catch {}
      if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: cors });
      return servePickups(env);
    }
    // Mark a pickup done (deletes the open draft order after it's rung
    // through the register) — POST from the POS tile, same PIN gate.
    if (url.pathname === "/pickups/done") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS" };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers: cors });
      const k = url.searchParams.get("k") || "";
      let ok = false;
      try {
        const chk = await env.ROOM.get(env.ROOM.idFromName("default"))
          .fetch(new Request(url.origin + "/staff-check?k=" + encodeURIComponent(k)));
        ok = !!(await chk.json()).ok;
      } catch {}
      if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: cors });
      const did = (url.searchParams.get("did") || "").replace(/\D/g, "").slice(0, 24);
      if (!did) return Response.json({ error: "did required" }, { status: 400, headers: cors });
      return servePickupDone(env, did);
    }
    if (url.pathname.startsWith("/c/")) {
      return serveAsset(env, "/phone.html", request);
    }
    if (url.pathname === "/" || url.pathname === "/tv") {
      return serveAsset(env, "/tv.html", request);
    }
    return env.ASSETS.fetch(request);
  },

  // Cron (wrangler.toml [triggers], every 5 min): re-warm the advanced-search
  // landing bodies so the storefront's default query never reaches BinderPOS
  // cold (25s+ Pokémon, 60s MTG). Per-game timings go to console.log, so
  // `wrangler tail` shows them.
  async scheduled(event, env, ctx) {
    try { await warmBinderSearch(env); }
    catch (e) { console.log("binder-warm: failed: " + ((e && e.message) || e)); }
  },
};

async function serveAsset(env, path, request) {
  const u = new URL(request.url);
  u.pathname = path;
  const res = await env.ASSETS.fetch(new Request(u.toString(), request));
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
