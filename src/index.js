import { BinderRoom } from "./room.js";
import { serveCards, serveSearch, serveExact, serveInstock, serveDeck, serveDeckGate, serveBuyPrice, serveSimilar, serveSisters, serveSisterCheck, serveSisterNew, serveQty, servePickups, servePickupDone, serveSetSuggest } from "./cards.js";
import { serveReviews } from "./reviews.js";
import { serveStores } from "./stores.js";
import { serveEvents } from "./events.js";
import { serveBinderSearch, serveBinderSearchStatus, warmBinderSearch, CACHE_DO } from "./binder-search.js";
import { serveIcs } from "./ics.js";
import { servePriceHistory, adminGql, PRICE_DO } from "./price-history.js";
import { serveShowcase, serveShowcaseIcon, serveShowcaseAlike } from "./showcase.js";
import { servePlamodTargets } from "./plamod.js";
import { serveW40kTargets } from "./w40k.js";
import { serveBtTargets } from "./bt.js";
import { servePaints } from "./paints.js";
import { serveEavy } from "./eavy.js";
import { serveKit } from "./kit.js";
import { serveArmyPreview } from "./army.js";
import { GS_PAGE, GS_QUERY, parseGsPage } from "./gamesys.js";
import { serveEnrich, ENRICH_DO } from "./enrich.js";
import { serveBuylist, refreshWantedCards } from "./buylist.js";
import { HOLD_DO, serveHoldPage, serveHoldControl } from "./hold.js";
import { serveStage, servePair, STAGE_DO } from "./stage.js";
import { serveRequests, REQUESTS_DO } from "./requests.js";
import { stockCheckTick, STOCK_DO } from "./stock-check.js";
import { serveWin, WIN_DO } from "./win.js";
import { servePageEdit } from "./page-edit.js";
import { serveAutoprice, AUTOPRICE_DO } from "./autoprice.js";
import { servePortal } from "./portal.js";
import { serveDiscord, discordTick } from "./discord.js";
import { serveDiscordEvents, discordEventsTick } from "./discord-events.js";
import { serveDiscordSeen, serveInteraction, discordSeenTick } from "./discord-seen.js";
import { gatewayTick } from "./discord-gateway.js";
import { serveImpact, impactTick } from "./impact.js";
import { servePulse } from "./pulse.js";
import { servePush, pushTick } from "./push.js";
import { serveAsk } from "./ask.js";
import { serveLastSold } from "./lastsold.js";
import { serveUpc } from "./upc.js";
import { serveThemeStage, repoDataHealth } from "./repo-data.js";
import { stripInternal, staffGate, staffAccess, serveStaffMe, pinAllowed, INTERNAL_HEADER } from "./staff-access.js";
import { harden } from "./harden.js";
import { logAccess } from "./access-log.js";
import { retentionTick } from "./retention.js";

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

export default {
  // Every answer leaves through harden() (src/harden.js): the usual browser
  // protections on all of them; staff screens also refuse framing, send no
  // referrer and are never cached. The routing itself is route() below.
  async fetch(request, env, ctx) {
    return harden(await route(request, env, ctx), new URL(request.url));
  },

  // Cron (wrangler.toml [triggers], every 5 min): re-warm the advanced-search
  // landing bodies so the storefront's default query never reaches BinderPOS
  // cold (25s+ Pokémon, 60s MTG). Per-game timings go to console.log, so
  // `wrangler tail` shows them.
  async scheduled(event, env, ctx) {
    try { await warmBinderSearch(env); }
    catch (e) { console.log("binder-warm: failed: " + ((e && e.message) || e)); }
    // Shelf drops to Discord (quiet unless a DISCORD_WEBHOOK_* secret is set).
    try { const d = await discordTick(env); if (d && (d.posted || d.errors)) console.log("discord: " + JSON.stringify(d)); }
    catch (e) { console.log("discord: failed: " + ((e && e.message) || e)); }
    // Store events -> Discord Scheduled Events (quiet unless DISCORD_BOT_TOKEN is set; at most every 30 min).
    try { const d = await discordEventsTick(env); if (d && !d.skipped) console.log("discord-events: " + JSON.stringify(d)); }
    catch (e) { console.log("discord-events: failed: " + ((e && e.message) || e)); }
    // Discord "last seen" (src/discord-seen.js): new posts since the last tick -> who was seen when. Counts only in the log.
    try { const d = await discordSeenTick(env); if (d && !d.skipped) console.log("discord-seen: " + JSON.stringify(d)); }
    catch (e) { console.log("discord-seen: failed: " + ((e && e.message) || e)); }
    // The gateway connection for online status (src/discord-gateway.js): make sure it is up; quiet while it is.
    try { const g = await gatewayTick(env); if (g && !g.running && g.reason !== "stopped by staff") console.log("discord-gateway: " + JSON.stringify({ running: false, state: g.state || null, reason: g.reason || g.halted || null })); }
    catch (e) { console.log("discord-gateway: failed: " + ((e && e.message) || e)); }
    // The sell page's "cards we need most" (src/wanted.js): rebuilt once a
    // day per game (Magic, then Pokemon), one polite BinderPOS lookup at a
    // time, off the request path.
    try { const w = await refreshWantedCards(env); if (w && !w.skipped) console.log("wanted: " + JSON.stringify({ game: w.game || "mtg", count: w.count, tried: w.tried, error: w.error || null })); }
    catch (e) { console.log("wanted: failed: " + ((e && e.message) || e)); }
    // Stock check (src/stock-check.js): units of the daily run - orders,
    // stock scan, lookups - done here where waiting on Shopify costs nothing;
    // the stock-check DO only plans and stores. Quiet when idle.
    try { const s = await stockCheckTick(env); if (s && !s.skipped && !s.idle) console.log("stock-check: " + JSON.stringify(s)); }
    catch (e) { console.log("stock-check: failed: " + ((e && e.message) || e)); }
    // Data retention (src/retention.js): once a day, personal data past its
    // period is deleted from every store that holds some; counts only.
    try { const r = await retentionTick(env); if (r && r.ran) console.log("retention: " + JSON.stringify(r)); }
    catch (e) { console.log("retention: failed: " + ((e && e.message) || e)); }
    // Sales impact (src/impact.js): new orders attributed to the tools that filled the cart, a few pages every 10 min.
    try { const i = await impactTick(env); if (i && !i.skipped) console.log("impact: " + JSON.stringify(i)); }
    catch (e) { console.log("impact: failed: " + ((e && e.message) || e)); }
    // Web push digests (src/push.js): the daily arrivals per game and the Monday pulse, 10:00 Atlantic.
    try { const p = await pushTick(env); if (p && !p.skipped && (p.sent.length || p.error)) console.log("push: " + JSON.stringify(p)); }
    catch (e) { console.log("push: failed: " + ((e && e.message) || e)); }
  },
};

// The worker's routing, one request at a time (the body of fetch() until the
// 2026-10-20 privacy review; its indentation is kept so the history reads).
async function route(request, env, ctx) {
    // x-exor-staff is ours alone: set only below, after an account passed (src/staff-access.js)
    request = stripInternal(request);
    const url = new URL(request.url);
    // staffOk(env, origin, k) for one screen: account with its permission, automation key, or the PIN while it is on
    const gate = (perm, opts) => staffGate(request, env, url, perm, { ctx, ...(opts || {}) });
    const rq = String(url.searchParams.get("room") || "").toLowerCase();
    // The search-cache DO shares the BinderRoom class; its name is not a screen.
    const roomName = ROOM_RE.test(rq) && rq !== CACHE_DO ? rq : "default";
    const id = env.ROOM.idFromName(roomName);
    const room = env.ROOM.get(id);

    // This repo's own files, read with GITHUB_DATA_TOKEN so the repo can be private
    // (src/repo-data.js): the theme uploads Shopify fetches by URL, and a health check.
    if (url.pathname.startsWith("/theme-stage/")) return serveThemeStage(request, env, url);
    // What a staff page may do for whoever is looking (src/staff-access.js).
    if (url.pathname === "/staff/me.json") return serveStaffMe(request, env, url);
    // A till tablet or the BinderPOS add-on asks for a pairing code and waits for an admin (src/stage.js).
    if (url.pathname.startsWith("/device/pair/")) return servePair(request, env, url);
    if (url.pathname === "/repo-data/health") {
      return new Response(JSON.stringify(await repoDataHealth(env)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

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
    // Round 31: nightly catalogue enrichment so manga and board games have
    // something to filter on (src/enrich.js).
    if (url.pathname === "/enrich/status" || url.pathname === "/enrich/run" || url.pathname === "/enrich/bgg-check" || url.pathname === "/enrich/al-check" || url.pathname === "/enrich/series.json" || url.pathname === "/games/like.json" || url.pathname === "/w40k/like.json") {
      return serveEnrich(request, env, ctx);
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
        const a = await staffAccess(request, env, url, wsRole === "remote" ? "tv" : url.pathname === "/alert" ? "alerts" : ["alerts", "decks"], url.searchParams.get("k") || "", { ctx, pinRoom: wsRole === "remote" ? roomName : "default", route: url.pathname + (wsRole ? "?role=" + wsRole : "") });
        if (!a.ok) return Response.json({ error: "sign in, or the staff key" }, { status: 403 });
      }
      // TV settings, usage log, comments: the room checks the PIN in the body; an account
      // with the TV permission goes in with the internal header instead.
      if ((url.pathname === "/admin/api" || url.pathname === "/alog" || url.pathname === "/fblist") && request.method === "POST") {
        let pin = "";
        try { pin = String(((await request.clone().json()) || {}).pin || ""); } catch {}
        const a = await staffAccess(request, env, url, "tv", pin, { ctx, pinRoom: roomName });
        if (!a.ok) return Response.json({ error: (await pinAllowed(env, url.origin)) ? "Incorrect PIN" : "Sign in with your staff account (the PIN is switched off)." }, { status: 403 });
        if (a.via !== "pin") {
          const h = new Headers(request.headers);
          h.set(INTERNAL_HEADER, "1");
          return room.fetch(new Request(request, { headers: h }));
        }
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
    if (url.pathname === "/search/exact.json") {
      return serveExact(request, env, ctx);
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
      const dg = gate("decks");
      if (!(await dg(env, url.origin, url.searchParams.get("k")))) {
        return Response.json({ error: "staff key required" }, { status: 403, headers: { "cache-control": "no-store" } });
      }
      const opIn = url.searchParams.get("op") || "overview";
      const op = ["orders", "misslog", "overview"].indexOf(opIn) > -1 ? opIn : "overview";
      logAccess(env, ctx, url.origin, { who: dg.last && dg.last.who, via: dg.last && dg.last.via, what: "deck builder stats", id: op });
      const me = encodeURIComponent(request.headers.get("cf-connecting-ip") || "");
      const res = await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(url.origin + "/deck-admin?op=" + op + "&me=" + me));
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (url.pathname === "/deck-admin" && request.method === "POST") {
      if (!(await gate("decks")(env, url.origin, url.searchParams.get("k")))) {
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

    // Our buylist on top of BinderPOS's: /buylist/api/* for the shop's sell
    // page (signed-in customer), /buylist/poc/* for the owner-only test page.
    // See src/buylist.js.
    // Hold on arrival, stage 1 (shadow): Shopify's order webhook, so a
    // BinderPOS POS cart is known by its cart number the moment it is
    // submitted. Untrusted hint; the hold DO re-reads the order with its
    // own token. Nothing in this stage changes inventory. See src/hold.js.
    if (url.pathname === "/hook/order" && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const id = String((b && b.id) || "").replace(/\D/g, "").slice(0, 24);
      if (id) ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName(HOLD_DO))
        .fetch(new Request(url.origin + "/_hold/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })));
      return Response.json({ ok: true });
    }
    // Sealed auto-pricing (src/autoprice.js): staff page, report, controls.
    // Opt-in by the auto-price tag; shadow mode until switched on the page.
    if (url.pathname === "/autoprice" || url.pathname === "/autoprice/all" || url.pathname === "/autoprice/login" || url.pathname === "/autoprice/logout" || url.pathname === "/autoprice/report.json" || url.pathname === "/autoprice/status" || url.pathname === "/autoprice/control" || url.pathname === "/autoprice/digest.json" || url.pathname === "/autoprice/comp-feed.json") {
      return serveAutoprice(request, env, url, gate("admin"));
    }
    // One-span edit of a Shopify page body (src/page-edit.js): staff key,
    // dry unless told otherwise, verified by a re-read. Owner-asked edits only.
    // Which Durable Object is which (Cloudflare's usage analytics show only ids): name -> id for every named object and known screen room (2026-10-03, budget email).
    if (url.pathname === "/admin/do-ids.json") {
      if (!(await gate("admin")(env, url.origin, url.searchParams.get("k")))) return Response.json({ error: "staff PIN required" }, { status: 403, headers: { "cache-control": "no-store" } });
      const names = { default: "default", cache: CACHE_DO, portal: "portal-cache", price: PRICE_DO, enrich: ENRICH_DO, hold: HOLD_DO, stage: STAGE_DO, requests: REQUESTS_DO, autoprice: AUTOPRICE_DO, stock: STOCK_DO, win: WIN_DO };
      const out = {};
      for (const [k, n] of Object.entries(names)) out[k] = { name: n, id: env.ROOM.idFromName(n).toString() };
      let rooms = null;
      try { rooms = await (await env.ROOM.get(env.ROOM.idFromName("default")).fetch(new Request(url.origin + "/rooms-list"))).json(); } catch {}
      const list = Array.isArray(rooms) ? rooms : (rooms && (rooms.rooms || rooms.list)) || [];
      for (const r of list) { const n = typeof r === "string" ? r : r && (r.room || r.name || r.id); if (n && !out["room:" + n]) out["room:" + n] = { name: String(n), id: env.ROOM.idFromName(String(n)).toString(), seen: r && r.seen || r && r.last || null }; }
      return Response.json(out, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/admin/page-edit.json") return servePageEdit(request, env, url, gate("admin"), null);
    if (url.pathname === "/hold/health") return serveHoldPage(request, env, url);
    if (url.pathname === "/hold/control" && request.method === "POST") return serveHoldControl(request, env, url, gate("admin"));
    if (url.pathname === "/hold/shadow" || url.pathname === "/hold/shadow.json") {
      const hg = gate("admin");
      if (!(await hg(env, url.origin, url.searchParams.get("k")))) {
        return Response.json({ error: "staff key required" }, { status: 403, headers: { "cache-control": "no-store" } });
      }
      logAccess(env, ctx, url.origin, { who: hg.last && hg.last.who, via: hg.last && hg.last.via, what: "hold report" });
      return serveHoldPage(request, env, url);
    }
    if (url.pathname.startsWith("/buylist/poc/") || url.pathname.startsWith("/buylist/api/")) {
      return serveBuylist(request, env);
    }
    // 9Pocket by Exor (src/stage.js): the staff buylist list and worksheets,
    // their data and the approve / reject / edit / email control, behind the
    // staff PIN. /buylist/staged* was the page's first address and redirects.
    // Item requests (src/requests.js): the store's pages post sold-out and
    // special-order requests here; /requests/health for the deploy smoke.
    if (url.pathname.startsWith("/requests/api/") || url.pathname === "/requests/health") return serveRequests(request, env, url, ctx);
    // Enter to win (src/win.js): the Expo contest page reached by the booth's QR
    // code, its emailed confirmation link, rules and health. Public; its admin
    // screen is /9pocket/win inside 9Pocket.
    if (url.pathname === "/win" || url.pathname.startsWith("/win/")) return serveWin(request, env, url, ctx);
    // Sales impact of the site tools (src/impact.js): the tools' counts-only beacon.
    if (url.pathname === "/impact") return serveImpact(request, env, url, ctx);
    // Market pulse (src/pulse.js): the nightly price snapshot's biggest movers, public.
    if (url.pathname === "/pulse" || url.pathname === "/pulse.json") return servePulse(request, env, url);
    // Web push alerts (src/push.js): the sign-up page, its key, subscribe / unsubscribe / test. The
    // service worker and manifest are plain assets (public/alerts-sw.js, public/alerts.webmanifest).
    if (url.pathname === "/alerts" || url.pathname.startsWith("/alerts/")) return servePush(request, env, url, ctx);
    // Ask Exor (src/ask.js): the shop assistant - its page, its question route, its health.
    if (url.pathname === "/ask" || url.pathname === "/ask.json" || url.pathname.startsWith("/ask/")) return serveAsk(request, env, url, ctx);
    // The Showcase (src/showcase.js, public/showcase.html): browse singles like the store's glass cases.
    if (url.pathname === "/showcase" || url.pathname === "/showcase/") return serveAsset(env, "/showcase.html", request);
    if (url.pathname === "/showcase.json") return serveShowcase(request, env, ctx);
    if (url.pathname === "/showcase/alike.json") return serveShowcaseAlike(request, env, ctx);
    { const im = /^\/showcase\/icon\/([a-z0-9]+)\.png$/.exec(url.pathname); if (im) return serveShowcaseIcon(request, env, ctx, im[1]); }
    if (url.pathname === "/9pocket" || url.pathname === "/9pocket.json" || url.pathname.startsWith("/9pocket/") || url.pathname === "/buylist/staged" || url.pathname === "/buylist/staged.json" || url.pathname.startsWith("/buylist/staged/")) {
      return serveStage(request, env, url, gate("admin"), { ctx });
    }

    // Round 32: our own read-only view of BinderPOS's online buylists
    // (pending / approved / completed, with live buy prices), behind the
    // staff PIN. The page is a static shell; every read goes through
    // src/portal.js, which signs in to the portal with the staff login.
    if (url.pathname === "/portal/buylists") {
      return serveAsset(env, "/buylists.html", request);
    }
    if (url.pathname.startsWith("/portal/") && url.pathname.endsWith(".json")) {
      const pg = gate("portal");
      const res = await servePortal(request, env, url, pg);
      if (pg.last && pg.last.ok && res && res.status === 200) logAccess(env, ctx, url.origin, { who: pg.last.who, via: pg.last.via, what: "BinderPOS " + url.pathname.slice(8, -5) });
      return res;
    }

    if (url.pathname === "/buyprice.json") {
      return serveBuyPrice(request, env, ctx);
    }

    // Homepage reviews band: Google reviews proxied + curated server-side
    // (5-star only, text sentiment-screened) so the key stays private.
    // Shelf drops to Discord: staff preview / test / post-now (src/discord.js).
    if (url.pathname.startsWith("/discord/")) return serveDiscord(request, env, url, gate("admin"));
    // Store events as Discord Scheduled Events: staff preview / sync-now / test (src/discord-events.js).
    if (url.pathname.startsWith("/discord-events/")) return serveDiscordEvents(request, env, url, gate("admin"));
    // Discord "last seen" (src/discord-seen.js): slash commands arrive signed from
    // Discord at /interactions (public, Ed25519-checked); health is counts only;
    // the rest is staff. The member list is customer-ish data: logged.
    if (url.pathname === "/discord-seen/interactions") return serveInteraction(request, env, url);
    if (url.pathname.startsWith("/discord-seen/")) {
      const sg = gate("admin");
      const res = await serveDiscordSeen(request, env, url, sg, { ctx });
      if (url.pathname === "/discord-seen/list.json" && sg.last && sg.last.ok && res.status === 200) logAccess(env, ctx, url.origin, { who: sg.last.who, via: sg.last.via, what: "Discord last-seen list" });
      return res;
    }

    if (url.pathname === "/reviews.json") {
      return serveReviews(request, env, ctx);
    }

    // Store-hours band: every Exor store's live opening hours from its
    // Google Business Profile, proxied the same way so the key stays private.
    // Store pages: a sister store's events, asked of BinderPOS as that store (events.js).
    if (url.pathname === "/events.json") {
      return serveEvents(request, ctx);
    }

    // PLAMOD runner's work list: our Gunpla / Figures / Blind Box / plastic model kit products
    // with barcode and the image files they already have (src/plamod.js).
    if (url.pathname === "/plamod/targets.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return servePlamodTargets(request, env, ctx, gql);
    }

    // Warhammer 40K runner's work list: id + title of every 40K product
    // (src/w40k.js, tools/w40k.py). Public storefront data only.
    if (url.pathname === "/w40k/targets.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return serveW40kTargets(request, env, ctx, gql);
    }

    // BattleTech runner's work list: id + title of every active BattleTech
    // product (src/bt.js, tools/battletech.py). Public storefront data only.
    if (url.pathname === "/bt/targets.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return serveBtTargets(request, env, ctx, gql);
    }

    // Paint colour picker data: Vallejo / Citadel / Army Painter paints matched to a colour
    // chart, one swatch per colour (src/paints.js). Public storefront data only.
    if (url.pathname === "/paints.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return servePaints(request, env, ctx, gql);
    }

    // "Paint it like the box": 'Eavy Archive paint lists for a Warhammer product, each paint
    // linked to our own Citadel listing (src/eavy.js). Public storefront data only.
    if (url.pathname === "/army/preview.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return serveArmyPreview(request, env, ctx, gql, GS_PAGE, parseGsPage, GS_QUERY);
    }

    // In-stock add-ons for a product page: hobby tools for Warhammer boxes and Gunpla kits,
    // board-game sleeves with the card size each fits (src/kit.js). Public storefront data only.
    if (url.pathname === "/kit.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return serveKit(request, env, ctx, gql);
    }

    if (url.pathname === "/eavy/for.json") {
      const gql = async (q, v) => {
        const r = await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q, v);
        return r && r.data;
      };
      return serveEavy(request, env, ctx, async () => (await servePaints(request, env, ctx, gql)).json());
    }

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

    // Store pages: the newest listings at a sister store's own storefront.
    if (url.pathname === "/sisternew.json") {
      return serveSisterNew(request, ctx);
    }

    if (url.pathname === "/qty.json") {
      return serveQty(request, env, ctx);
    }

    // Last sale per SKU, for the Asmodee stock-check userscript (staff PIN).
    if (url.pathname === "/lastsold.json") {
      return serveLastSold(request, env, ctx, async (q) => (await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q)).data, gate("admin"));
    }

    // Products by barcode across the whole store, for the same userscript (public).
    if (url.pathname === "/upc.json") {
      return serveUpc(request, env, ctx, async (q) => (await adminGql({ env, fetch: (a, b) => fetch(a, b) }, q)).data);
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
      // ... and wakes the item-requests stock check (src/requests.js).
      if (item) ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName(REQUESTS_DO))
        .fetch(new Request(url.origin + "/_req/inv", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })));
      // The same hint feeds the hold-on-arrival shadow log (src/hold.js).
      if (item) ctx.waitUntil(env.ROOM.get(env.ROOM.idFromName(HOLD_DO))
        .fetch(new Request(url.origin + "/_hold/inv", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ item, location: String((b && b.location_id) || "").replace(/\D/g, "").slice(0, 24), available: Number(b && b.available) }) })));
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
      const pk = gate("pickups");
      const ok = await pk(env, url.origin, url.searchParams.get("k") || "");
      if (!ok) return Response.json({ error: "staff key required" }, { status: 403, headers: cors });
      logAccess(env, ctx, url.origin, { who: pk.last && pk.last.who, via: pk.last && pk.last.via, what: "pickups (open draft orders)" });
      return servePickups(env);
    }
    // Mark a pickup done (deletes the open draft order after it's rung
    // through the register) — POST from the POS tile, same PIN gate.
    if (url.pathname === "/pickups/done") {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS" };
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers: cors });
      const ok = await gate("pickups")(env, url.origin, url.searchParams.get("k") || "");
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
}

async function serveAsset(env, path, request) {
  const u = new URL(request.url);
  u.pathname = path;
  const res = await env.ASSETS.fetch(new Request(u.toString(), request));
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
