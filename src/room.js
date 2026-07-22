import { TOKEN_LIFE_S, IDLE_TIMEOUT_S, DEFAULT_SETTINGS, DEFAULT_PIN } from "./config.js";

const THEMES = ["mtg", "pokemon", "yugioh", "hockey", "basketball"];
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export class BinderRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.controllerId = null;
    this.lastActivity = 0;
    this.tv = null;
    this.phone = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.pin = DEFAULT_PIN;
    this.state.blockConcurrencyWhile?.(async () => {
      try {
        const s = await this.state.storage.get("settings");
        if (s) this.settings = { ...DEFAULT_SETTINGS, ...s };
        // One-time upgrade: settings saved before the newest-first collections
        // existed still point at the old price/best-seller sorted handles.
        const up = { "pokemon-singles": "pokemon-singles-new-arrivals", "yu-gi-oh-singles": "yu-gi-oh-singles-new-arrivals" };
        if (Array.isArray(this.settings.tabs))
          this.settings.tabs = this.settings.tabs.map((t) => (up[t.collection] ? { ...t, collection: up[t.collection] } : t));
        if (up[this.settings.collection]) this.settings.collection = up[this.settings.collection];
        // One-time upgrade: settings saved before the sports tabs existed
        // lack enabled flags and the Hockey/Basketball entries (added off).
        if (Array.isArray(this.settings.tabs)) {
          this.settings.tabs = this.settings.tabs.map((t) => ({ ...t, enabled: t.enabled !== false }));
          for (const d of DEFAULT_SETTINGS.tabs)
            if (!this.settings.tabs.some((t) => t.game === d.game)) this.settings.tabs.push({ ...d });
        }
        this.settings.newToday = { ...DEFAULT_SETTINGS.newToday, ...(this.settings.newToday || {}) };
        const p = await this.state.storage.get("pin");
        if (p) this.pin = p;
      } catch {}
    });
    this.rotateToken();
    this.state.setInterval?.(() => this.tick(), 1e3) ?? (this._iv = setInterval(() => this.tick(), 1e3));
  }

  now() { return Date.now(); }

  rotateToken() {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.token = "EX-" + rand;
    this.tokenExpiresAt = this.now() + TOKEN_LIFE_S * 1e3;
    this.pushTvState();
  }

  secondsLeft(untilMs) { return Math.max(0, Math.ceil((untilMs - this.now()) / 1e3)); }

  // Send current lock/token state to the TV so it can render the QR/countdown.
  pushTvState() {
    if (!this.tv) return;
    const paired = !!this.controllerId;
    this.send(this.tv, {
      type: "tv_state",
      paired,
      token: paired ? null : this.token,
      tokenLeft: paired ? 0 : this.secondsLeft(this.tokenExpiresAt),
      idleLeft: paired ? this.secondsLeft(this.lastActivity + IDLE_TIMEOUT_S * 1e3) : 0,
    });
  }

  tick() {
    if (!this.controllerId) {
      if (this.now() >= this.tokenExpiresAt) this.rotateToken();
      else this.pushTvState();
    } else {
      const idleLeft = this.secondsLeft(this.lastActivity + IDLE_TIMEOUT_S * 1e3);
      if (idleLeft <= 0) {
        this.dropSession("idle");
      } else {
        this.pushTvState();
        if (this.phone) this.send(this.phone, { type: "idle", idleLeft });
      }
    }
  }

  dropSession(reason) {
    if (this.phone) {
      this.send(this.phone, { type: "dropped", reason });
      try { this.phone.close(1e3, reason); } catch {}
    }
    this.phone = null;
    this.controllerId = null;
    this.rotateToken();
    if (this.tv) this.send(this.tv, { type: "unpaired", reason });
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  // ---- Settings (admin-editable, persisted) ----
  // The Showcase tab (the physical case, mirrored) and enabled "New Today"
  // games appear as extra virtual tabs after the base ones.
  effectiveTabs() {
    const base = (Array.isArray(this.settings.tabs) ? this.settings.tabs : []).filter((t) => t.enabled !== false);
    const st = this.settings.showcaseTab || {};
    const sc = st.enabled
      ? [{ label: String(st.label || "Showcase").slice(0, 24), collection: st.collection || "esl-showcase", theme: "mtg", game: "showcase", showcase: true }]
      : [];
    const sv = this.settings.sleevesTab || {};
    const sl = sv.enabled
      ? [{ label: String(sv.label || "Sleeves").slice(0, 24), collection: sv.collection || "all-dragon-shield-sleeves", theme: "sleeves", game: "sleeves", sleeves: true }]
      : [];
    const nt = this.settings.newToday || {};
    const extra = base
      .filter((t) => nt[t.game])
      .map((t) => ({ label: ("New Today · " + t.label).slice(0, 24), collection: t.collection, theme: t.theme, game: t.game, newToday: true }));
    return [...base, ...sc, ...sl, ...extra];
  }
  publicSettings() { return { ...this.settings, tabs: this.effectiveTabs() }; } // never includes the PIN

  broadcastSettings() {
    const m = { type: "settings", data: this.publicSettings() };
    if (this.tv) this.send(this.tv, m);
    if (this.phone) this.send(this.phone, m);
  }

  // Validate + merge an admin patch; returns null on success or an error string.
  async applyAdminPatch(patch) {
    if (!patch || typeof patch !== "object") return "empty";
    const next = { ...this.settings };
    if ("header" in patch) next.header = String(patch.header).slice(0, 200);
    if ("collection" in patch) {
      const c = String(patch.collection).trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad collection handle";
      next.collection = c;
    }
    if ("topLoaders" in patch) next.topLoaders = !!patch.topLoaders;
    if ("touchMode" in patch) next.touchMode = !!patch.touchMode;
    if ("kbPos" in patch) {
      if (!["top", "midtop", "middle", "midbot", "bottom"].includes(patch.kbPos)) return "bad kbPos";
      next.kbPos = patch.kbPos;
    }
    if ("holiday" in patch) {
      if (!["none", "christmas"].includes(patch.holiday)) return "bad holiday";
      next.holiday = patch.holiday;
    }
    if ("searchEnabled" in patch) next.searchEnabled = !!patch.searchEnabled;
    if ("perfMode" in patch) next.perfMode = !!patch.perfMode;
    if ("newToday" in patch) {
      const nt = patch.newToday;
      if (!nt || typeof nt !== "object") return "bad newToday";
      next.newToday = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.newToday).map((g) => [g, !!nt[g]]));
    }
    if ("showcaseTab" in patch) {
      const st = patch.showcaseTab;
      if (!st || typeof st !== "object") return "bad showcaseTab";
      const c = String(st.collection || "esl-showcase").trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad showcase collection handle";
      next.showcaseTab = { enabled: !!st.enabled, label: String(st.label || "Showcase").slice(0, 24).trim() || "Showcase", collection: c };
      // If the Showcase tab was just disabled while on screen, fall back home.
      if (!next.showcaseTab.enabled && next.showcaseActive) {
        const home = (Array.isArray(next.tabs) && next.tabs[0]) || null;
        if (home) { next.collection = home.collection; next.theme = home.theme; next.game = home.game; }
        next.showcaseActive = false;
      }
    }
    if ("sleevesTab" in patch) {
      const sv = patch.sleevesTab;
      if (!sv || typeof sv !== "object") return "bad sleevesTab";
      const c = String(sv.collection || "all-dragon-shield-sleeves").trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad sleeves collection handle";
      next.sleevesTab = { enabled: !!sv.enabled, label: String(sv.label || "Sleeves").slice(0, 24).trim() || "Sleeves", collection: c };
      // If the sleeve wall was just disabled while on screen, fall back home.
      if (!next.sleevesTab.enabled && next.sleevesActive) {
        const home = (Array.isArray(next.tabs) && next.tabs[0]) || null;
        if (home) { next.collection = home.collection; next.theme = home.theme; next.game = home.game; }
        next.sleevesActive = false;
      }
    }
    if ("theme" in patch) {
      if (!THEMES.includes(patch.theme)) return "bad theme";
      next.theme = patch.theme;
    }
    if ("bubbleMsgs" in patch) {
      if (!Array.isArray(patch.bubbleMsgs) || patch.bubbleMsgs.length > 5) return "bad bubble messages";
      next.bubbleMsgs = patch.bubbleMsgs.map((m) => String(m ?? "").slice(0, 220).trim()).filter(Boolean);
    }
    if ("attractHome" in patch) {
      if (!["mtg", "pokemon", "yugioh", "showcase"].includes(patch.attractHome)) return "bad attractHome";
      next.attractHome = patch.attractHome;
    }
    if ("attractMsgs" in patch) {
      if (!Array.isArray(patch.attractMsgs) || patch.attractMsgs.length > 5) return "bad attract messages";
      next.attractMsgs = patch.attractMsgs.map((m) => String(m ?? "").slice(0, 120).trim()).filter(Boolean);
    }
    if ("adEnabled" in patch) next.adEnabled = !!patch.adEnabled;
    if ("adText" in patch) next.adText = String(patch.adText).slice(0, 300);
    if ("reviewUrl" in patch) {
      const u = String(patch.reviewUrl).trim();
      if (u && !/^https:\/\/[\w.\-/?=&%#:@]+$/i.test(u)) return "review URL must start with https://";
      next.reviewUrl = u.slice(0, 400);
    }
    // Game tabs (label fixed per game in the admin UI; collections and the
    // per-game enabled flag editable — that's how a room carries only sports).
    if ("tabs" in patch) {
      if (!Array.isArray(patch.tabs) || patch.tabs.length < 1 || patch.tabs.length > 8) return "bad tabs";
      const clean = [];
      for (const t of patch.tabs) {
        if (!t || typeof t !== "object") return "bad tab entry";
        const label = String(t.label || "").slice(0, 24).trim();
        if (!label) return "tab label required";
        const c = String(t.collection || "").trim().toLowerCase();
        if (!HANDLE_RE.test(c)) return "bad collection handle for " + label;
        const theme = THEMES.includes(t.theme) ? t.theme : "mtg";
        const game = THEMES.includes(t.game) ? t.game : theme;
        clean.push({ label, collection: c, theme, game, enabled: t.enabled !== false });
      }
      next.tabs = clean;
      // Keep the active collection/theme/game pointing at a real ENABLED tab —
      // unless the virtual Showcase tab is the one on screen.
      const enabledClean = clean.filter((t) => t.enabled !== false);
      const active = enabledClean.find((t) => t.collection === next.collection)
        || ((next.showcaseActive || next.sleevesActive) ? null : enabledClean[0] || clean[0]);
      if (active) {
        if (active.collection !== next.collection) next.newTodayActive = false; // the room got re-pointed
        next.collection = active.collection;
        next.theme = active.theme;
        next.game = active.game;
      }
    }
    this.settings = next;
    await this.state.storage.put("settings", next);
    if ("newPin" in patch && patch.newPin != null && patch.newPin !== "") {
      const np = String(patch.newPin);
      if (!/^\d{4,8}$/.test(np)) return "PIN must be 4–8 digits";
      this.pin = np;
      await this.state.storage.put("pin", np);
    }
    this.broadcastSettings();
    return null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const role = url.searchParams.get("role");
      const token = url.searchParams.get("token");
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      if (role === "tv") {
        this.tv = server;
        this.send(server, { type: "settings", data: this.publicSettings() });
        this.pushTvState();
        server.addEventListener("close", () => {
          if (this.tv === server) this.tv = null;
        });
      } else if (role === "phone") {
        const ok = token && token === this.token && this.now() < this.tokenExpiresAt;
        if (this.controllerId) {
          this.send(server, { type: "rejected", reason: "busy" });
          server.close(4001, "busy");
        } else if (!ok) {
          this.send(server, { type: "rejected", reason: "expired" });
          server.close(4002, "expired");
        } else {
          this.controllerId = crypto.randomUUID();
          this.phone = server;
          this.lastActivity = this.now();
          this.rotateToken();
          this.send(server, { type: "claimed", controllerId: this.controllerId });
          this.send(server, { type: "settings", data: this.publicSettings() });
          if (this.tv) this.send(this.tv, { type: "paired" });
          this.pushTvState();
          server.addEventListener("message", (ev) => this.onPhoneMessage(ev));
          server.addEventListener("close", () => {
            if (this.phone === server) this.dropSession("closed");
          });
        }
      } else {
        server.close(4e3, "unknown role");
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/settings") && request.method === "GET") {
      return Response.json(this.publicSettings(), { headers: { "cache-control": "no-store" } });
    }

    // ---- Screen registry (only ever called on the DEFAULT room's DO) ----
    // The worker pings /rooms-register whenever a room shows activity, so
    // /admin can offer a dropdown of every screen instead of hand-typed URLs.
    if (url.pathname.endsWith("/rooms-register")) {
      const n = String(url.searchParams.get("name") || "").toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(n)) {
        if (!this.roomsSeen) this.roomsSeen = (await this.state.storage.get("roomsSeen")) || {};
        const now = Date.now();
        if (!this.roomsSeen[n] || now - this.roomsSeen[n] > 36e5) { // persist at most hourly per room
          this.roomsSeen[n] = now;
          await this.state.storage.put("roomsSeen", this.roomsSeen);
        }
      }
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith("/rooms-list")) {
      if (!this.roomsSeen) this.roomsSeen = (await this.state.storage.get("roomsSeen")) || {};
      const rooms = [{ name: "default" },
        ...Object.keys(this.roomsSeen).filter((n) => n !== "default").sort().map((name) => ({ name }))];
      return Response.json({ rooms }, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname.endsWith("/switch")) {
      const i = parseInt(url.searchParams.get("i"), 10);
      const tabs = this.effectiveTabs();
      if (!(i >= 0 && i < tabs.length)) return Response.json({ error: "bad tab" }, { status: 400 });
      const t = tabs[i];
      this.settings = { ...this.settings, collection: t.collection, theme: t.theme, game: t.game || t.theme, newTodayActive: !!t.newToday, showcaseActive: !!t.showcase, sleevesActive: !!t.sleeves };
      await this.state.storage.put("settings", this.settings);
      this.broadcastSettings();
      return Response.json({ ok: true, settings: this.publicSettings() });
    }

    if (url.pathname.endsWith("/admin/api") && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "bad json" }, { status: 400 });
      }
      if (String(body.pin || "") !== String(this.pin)) {
        return Response.json({ error: "Incorrect PIN" }, { status: 403 });
      }
      const err = await this.applyAdminPatch(body.patch);
      if (err) return Response.json({ error: err }, { status: 400 });
      return Response.json({ ok: true, settings: this.publicSettings() });
    }

    // Touch-kiosk "send to counter": same draft-order path the phone uses,
    // but over HTTP since the totem has no phone. Items are re-sanitized here
    // (the TV UI is trusted, but the request could come from anywhere).
    if (url.pathname.endsWith("/counter") && request.method === "POST") {
      let d; try { d = await request.json(); } catch { return Response.json({ error: "bad body" }, { status: 400 }); }
      const items = (Array.isArray(d.items) ? d.items : []).slice(0, 100)
        .map((i) => ({
          variantId: String((i && i.variantId) || "").replace(/\D/g, ""),
          name: String((i && i.name) || "").slice(0, 140),
          price: String((i && i.price) || "0"),
          qty: Math.max(1, Math.min(99, parseInt(i && i.qty, 10) || 1)),
        }))
        .filter((i) => i.variantId);
      if (!items.length) return Response.json({ error: "empty cart" }, { status: 400 });
      this.state.waitUntil(this.handleCounterCheckout({
        items, count: Math.max(1, Math.min(999, parseInt(d.count, 10) || items.length)),
        total: String(d.total || "0.00").slice(0, 12),
      }));
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith("/status")) {
      return Response.json({
        paired: !!this.controllerId,
        token: this.controllerId ? null : this.token,
        tokenLeft: this.secondsLeft(this.tokenExpiresAt),
      });
    }
    return new Response("binder room", { status: 200 });
  }

  // Create a Shopify draft order for a "send to counter" cart, then tell both
  // screens the result. Requires the SHOPIFY_ADMIN_TOKEN secret
  // (`npx wrangler secret put SHOPIFY_ADMIN_TOKEN` — needs write_draft_orders);
  // without it we still notify, just with no order number.
  async handleCounterCheckout(data) {
    const out = { name: null, count: data.count ?? 0, total: data.total ?? "0.00" };
    const token = this.env.SHOPIFY_ADMIN_TOKEN;
    const shop = this.env.SHOPIFY_SHOP || "most-wanted-ca.myshopify.com";
    if (token && Array.isArray(data.items) && data.items.length) {
      try {
        const query = `mutation($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id name }
            userErrors { field message }
          }
        }`;
        const input = {
          note: "Exor showcase TV — customer sent cart to counter (Kiosk)",
          tags: ["showcase-tv", "Kiosk"],
          lineItems: data.items.slice(0, 100).map((i) => ({
            variantId: "gid://shopify/ProductVariant/" + i.variantId,
            quantity: Math.max(1, Math.min(99, +i.qty || 1)),
          })),
        };
        const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query, variables: { input } }),
        });
        const j = await r.json();
        const dr = j?.data?.draftOrderCreate?.draftOrder;
        if (dr) out.name = dr.name;
        else out.error = JSON.stringify(j?.data?.draftOrderCreate?.userErrors || j?.errors || r.status);
      } catch (e) {
        out.error = String((e && e.message) || e);
      }
    }
    const m = { type: "counter_order", data: out };
    if (this.tv) this.send(this.tv, m);
    if (this.phone) this.send(this.phone, m);
  }

  onPhoneMessage(ev) {
    if (!this.phone) return;
    this.lastActivity = this.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const allowed = ["flip", "next", "prev", "select", "unselect", "addcart", "rmcart", "checkout", "search", "endsearch"];
    if (allowed.includes(msg.type)) {
      if (this.tv) this.send(this.tv, msg);
      this.send(this.phone, { type: "ack", of: msg.type, data: msg.data ?? null });
    }
    if (msg.type === "checkout" && msg.data && msg.data.where === "counter") {
      this.handleCounterCheckout(msg.data);
    }
  }
}
