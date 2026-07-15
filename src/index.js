import { BinderRoom } from "./room.js";
import { serveCards, serveSearch } from "./cards.js";

export { BinderRoom };

const ROOM_NAME = "default";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = env.ROOM.idFromName(ROOM_NAME);
    const room = env.ROOM.get(id);

    if (
      url.pathname === "/ws" ||
      url.pathname === "/status" ||
      url.pathname === "/settings" ||
      url.pathname === "/admin/api" ||
      url.pathname === "/switch"
    ) {
      return room.fetch(request);
    }

    if (url.pathname === "/search.json") {
      return serveSearch(request);
    }

    if (url.pathname === "/cards.json") {
      let collection = url.searchParams.get("collection") || "";
      if (!collection) {
        try {
          const s = await (await room.fetch(new Request(url.origin + "/settings"))).json();
          if (s && s.collection) collection = s.collection;
        } catch {}
      }
      return serveCards(request, ctx, collection || "new-arrivals");
    }

    if (url.pathname === "/admin" || url.pathname === "/admin.html") {
      return serveAsset(env, "/admin.html", request);
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
