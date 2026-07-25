import { BinderRoom } from "./room.js";
import { serveCards, serveSearch, serveInstock, serveQty, servePickups } from "./cards.js";

export { BinderRoom };

/* Every TV is a ROOM — its own Durable Object with its own settings, PIN,
   pairing token and QR. ?room=sports on the TV URL gives the sports-area
   TV an independent, compartmentalized showcase; no param = "default"
   (the original TV keeps its state). Rooms create themselves on first use. */
const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rq = String(url.searchParams.get("room") || "").toLowerCase();
    const roomName = ROOM_RE.test(rq) ? rq : "default";
    const id = env.ROOM.idFromName(roomName);
    const room = env.ROOM.get(id);

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
      url.pathname === "/alog"
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

    if (url.pathname === "/search.json") {
      return serveSearch(request, env);
    }

    if (url.pathname === "/instock.json") {
      return serveInstock(request, ctx);
    }

    if (url.pathname === "/qty.json") {
      return serveQty(request, env, ctx);
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
          if (s) { newToday = !!s.newTodayActive; showcase = !!s.showcaseActive; sleeves = !!s.sleevesActive; }
        } catch {}
      }
      return serveCards(request, ctx, collection || "new-arrivals", newToday, showcase, sleeves);
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
      const k = url.searchParams.get("k") || "";
      let ok = false;
      try {
        const chk = await env.ROOM.get(env.ROOM.idFromName("default"))
          .fetch(new Request(url.origin + "/staff-check?k=" + encodeURIComponent(k)));
        ok = !!(await chk.json()).ok;
      } catch {}
      if (!ok) return Response.json({ error: "staff key required" }, { status: 403 });
      return servePickups(env);
    }
    if (url.pathname.startsWith("/c/")) {
      return serveAsset(env, "/phone.html", request);
    }
    if (url.pathname === "/" || url.pathname === "/tv") {
      return serveAsset(env, "/tv.html", request);
    }
    return env.ASSETS.fetch(request);
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
