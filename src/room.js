import { TOKEN_LIFE_S, IDLE_TIMEOUT_S, DEFAULT_SETTINGS, DEFAULT_PIN } from "./config.js";

const THEMES = ["mtg", "pokemon", "yugioh", "starwars", "onepiece", "riftbound", "hockey", "basketball"];
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
// Optional tab icon: a small data-URL image the admin page has already
// downsampled. Strict shape + size cap keeps settings well under DO limits.
const cleanIcon = (v) =>
  (typeof v === "string" && v.length <= 12000 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)) ? v : "";

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
    this.staff = new Set(); // /staff alert pages watching this room (any number)
    this.remotes = new Set(); // admin remote-control mirrors of this room's kiosk
    this.settings = { ...DEFAULT_SETTINGS };
    this.pin = DEFAULT_PIN;
    this.state.blockConcurrencyWhile?.(async () => {
      try {
        const s = await this.state.storage.get("settings");
        if (s) this.settings = { ...DEFAULT_SETTINGS, ...s };
        // One-time upgrade: settings saved before the newest-first collections
        // existed still point at the old price/best-seller sorted handles.
        const up = { "pokemon-singles": "pokemon-singles-new-arrivals", "yu-gi-oh-singles": "yu-gi-oh-singles-new-arrivals",
          // the newest-1000 feeds were too thin for these — in-stock collections instead
          "star-wars-unlimited-singles-trading-cards": "star-wars-unlimited-singles-in-stock",
          "one-piece-cards": "one-piece-in-stock" };
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
      ? [{ label: String(st.label || "Showcase").slice(0, 24), collection: st.collection || "esl-showcase", theme: "mtg", game: "showcase", showcase: true, icon: st.icon || "" }]
      : [];
    const sv = this.settings.sleevesTab || {};
    const sl = sv.enabled
      ? [{ label: String(sv.label || "Sleeves").slice(0, 24), collection: sv.collection || "all-dragon-shield-sleeves", theme: "sleeves", game: "sleeves", sleeves: true, icon: sv.icon || "" }]
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
    for (const r of this.remotes) this.send(r, m); // mirrors refetch their deck off this
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
    if ("counterEnabled" in patch) next.counterEnabled = !!patch.counterEnabled;
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
      next.showcaseTab = { enabled: !!st.enabled, label: String(st.label || "Showcase").slice(0, 24).trim() || "Showcase", collection: c, icon: cleanIcon(st.icon) };
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
      next.sleevesTab = { enabled: !!sv.enabled, label: String(sv.label || "Sleeves").slice(0, 24).trim() || "Sleeves", collection: c, icon: cleanIcon(sv.icon) };
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
    if ("attractShow" in patch) next.attractShow = !!patch.attractShow;
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
      if (!Array.isArray(patch.tabs) || patch.tabs.length < 1 || patch.tabs.length > 12) return "bad tabs";
      const clean = [];
      for (const t of patch.tabs) {
        if (!t || typeof t !== "object") return "bad tab entry";
        const label = String(t.label || "").slice(0, 24).trim();
        if (!label) return "tab label required";
        const c = String(t.collection || "").trim().toLowerCase();
        if (!HANDLE_RE.test(c)) return "bad collection handle for " + label;
        const theme = THEMES.includes(t.theme) ? t.theme : "mtg";
        const game = THEMES.includes(t.game) ? t.game : theme;
        clean.push({ label, collection: c, theme, game, enabled: t.enabled !== false, icon: cleanIcon(t.icon) });
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
        this.send(server, { type: "remotes", data: { n: this.remotes.size } });
        // The kiosk streams mirror snapshots; fan them out to the remotes.
        server.addEventListener("message", (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m && m.type === "mirror") for (const r of this.remotes) this.send(r, m);
        });
        server.addEventListener("close", () => {
          if (this.tv === server) this.tv = null;
        });
      } else if (role === "remote") {
        // Admin remote-control mirror (worker already checked the PIN):
        // receives the kiosk's mirror stream, sends rc commands back to it.
        this.remotes.add(server);
        this.send(server, { type: "settings", data: this.publicSettings() });
        if (this.tv) this.send(this.tv, { type: "remotes", data: { n: this.remotes.size } });
        if (this.tv) this.send(this.tv, { type: "rc", data: { a: "hello" } });
        server.addEventListener("message", (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m && m.type === "rc" && this.tv) this.send(this.tv, m);
        });
        server.addEventListener("close", () => {
          this.remotes.delete(server);
          if (this.tv) this.send(this.tv, { type: "remotes", data: { n: this.remotes.size } });
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
      } else if (role === "staff") {
        // Counter-alert listeners (the /staff Chrome page). Any number may
        // watch a room; they only receive broadcasts and can never drive it.
        this.staff.add(server);
        this.send(server, { type: "staff_hello" });
        server.addEventListener("close", () => this.staff.delete(server));
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
      if (this.settings.counterEnabled === false) return Response.json({ error: "counter checkout disabled" }, { status: 403 });
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

    // Shopify Flow's "Send HTTP request" action POSTs here to pop an alert on
    // every connected /staff page — body like {"name":"{{draftOrder.name}}",
    // "total":"12.00","note":"Draft order created"}. The /staff page dedupes
    // by order name, so a kiosk order that also fires Flow only rings once.
    // ---- Kiosk usage analytics ----
    // Touch screens batch-post interaction events here (session id + what was
    // tapped/searched/carted and how the visit ended). Stored per LOCAL store
    // day (Atlantic time), capped, kept 14 days. Same open trust level as
    // /counter — worst case someone fabricates browsing stats.
    if (url.pathname.endsWith("/track") && request.method === "POST") {
      let d; try { d = await request.json(); } catch { return Response.json({ error: "bad body" }, { status: 400 }); }
      const sid = String((d && d.sid) || "").slice(0, 24);
      const evs = (Array.isArray(d && d.events) ? d.events : []).slice(0, 40);
      const OKEV = ["ss", "tap", "q", "add", "rm", "qr", "send", "ord", "to", "se"];
      if (!sid || !evs.length) return Response.json({ ok: true });
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
      const key = "alog:" + day;
      const cur = (await this.state.storage.get(key)) || [];
      for (const ev of evs) {
        if (cur.length >= 1500) break; // per-day cap
        if (!ev || !OKEV.includes(ev.e)) continue;
        // qr events carry the full cart permalink (so admin can re-pop the
        // QR); everything else stays short.
        cur.push([sid, Math.round(+ev.t || Date.now()), String(ev.e), String(ev.d ?? "").slice(0, ev.e === "qr" ? 600 : 80), Math.round((+ev.v || 0) * 100) / 100]);
      }
      await this.state.storage.put(key, cur);
      if (this.lastPruneDay !== day) { // drop days older than 14, once per day
        this.lastPruneDay = day;
        const cut = "alog:" + new Date(Date.now() - 14 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
        const all = await this.state.storage.list({ prefix: "alog:" });
        for (const k of all.keys()) if (k < cut) await this.state.storage.delete(k);
      }
      return Response.json({ ok: true });
    }
    // Admin usage viewer: PIN-guarded, groups a day's events into sessions.
    if (url.pathname.endsWith("/alog") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
      if (String((b && b.pin) || "") !== String(this.pin)) return Response.json({ error: "Incorrect PIN" }, { status: 403 });
      const day = /^\d{4}-\d{2}-\d{2}$/.test((b && b.day) || "") ? b.day
        : new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
      const rows = (await this.state.storage.get("alog:" + day)) || [];
      const bySid = {};
      for (const [sid, t, e, dd, v] of rows) {
        const s = (bySid[sid] = bySid[sid] || { sid, start: t, end: t, events: [] });
        s.start = Math.min(s.start, t); s.end = Math.max(s.end, t);
        s.events.push({ t, e, d: dd, v });
      }
      const sessions = Object.values(bySid).sort((a, z) => z.start - a.start).slice(0, 200);
      // Collapse letter-by-letter search chains (live search once fired per
      // keystroke; also cleans batches that crossed a flush boundary): while
      // consecutive q events extend/backspace the same text, keep the last.
      for (const s of sessions) {
        const out = [];
        for (const ev of s.events) {
          const prev = out[out.length - 1];
          if (prev && prev.e === "q" && ev.e === "q" && ev.t - prev.t < 25000
            && (String(ev.d).startsWith(String(prev.d)) || String(prev.d).startsWith(String(ev.d)))) out[out.length - 1] = ev;
          else out.push(ev);
        }
        s.events = out;
      }
      const sum = { sessions: sessions.length, taps: 0, searches: 0, adds: 0, qr: 0, counter: 0, orders: 0, timeouts: 0, counterTotal: 0 };
      for (const s of sessions) for (const ev of s.events) {
        if (ev.e === "tap") sum.taps++; else if (ev.e === "q") sum.searches++; else if (ev.e === "add") sum.adds++;
        else if (ev.e === "qr") sum.qr++; else if (ev.e === "send") { sum.counter++; sum.counterTotal += ev.v || 0; }
        else if (ev.e === "ord") sum.orders++; else if (ev.e === "to") sum.timeouts++;
      }
      sum.counterTotal = Math.round(sum.counterTotal * 100) / 100;
      return Response.json({ day, summary: sum, sessions }, { headers: { "cache-control": "no-store" } });
    }

    // Worker-internal: validates the staff key (this room's admin PIN) for
    // /staff pages and /alert calls. Not reachable from outside — the worker
    // only routes /ws, /alert etc. here. Light lockout blunts brute force.
    if (url.pathname.endsWith("/staff-check")) {
      const now = Date.now();
      if (this.skWin && now - this.skWin > 6e5) { this.skWin = 0; this.skFails = 0; }
      if ((this.skFails || 0) >= 20) return Response.json({ ok: false, locked: true });
      const ok = (url.searchParams.get("k") || "") === String(this.pin);
      if (!ok) { this.skFails = (this.skFails || 0) + 1; this.skWin = this.skWin || now; }
      return Response.json({ ok });
    }

    if (url.pathname.endsWith("/alert") && request.method === "POST") {
      let d; try { d = await request.json(); } catch { d = {}; }
      const data = {
        name: String((d && d.name) || "").slice(0, 32) || null,
        count: Math.max(0, Math.min(999, parseInt(d && d.count, 10) || 0)),
        total: String((d && d.total) || "").slice(0, 12),
        note: String((d && d.note) || "").slice(0, 140),
        // where the order came from — the /staff page badges each row with it
        // ("kiosk" is implied for counter orders; Flow sends e.g. "shipday")
        src: String((d && d.src) || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20),
        // optional deep link (e.g. the order in Shopify admin) — https only
        url: /^https:\/\/[\w.\-/?=&%#:@]+$/.test(String((d && d.url) || "")) ? String(d.url).slice(0, 300) : "",
      };
      // An empty body is the /staff page's key probe — validate, don't ring.
      if (!data.name && !data.note && !data.total && !data.count) return Response.json({ ok: true, delivered: 0 });
      let delivered = 0;
      for (const s of this.staff) { this.send(s, { type: "staff_alert", data }); delivered++; }
      return Response.json({ ok: true, delivered });
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
    const out = {
      name: null, count: data.count ?? 0, total: data.total ?? "0.00",
      items: (Array.isArray(data.items) ? data.items : []).slice(0, 8)
        .map((i) => ({ name: String((i && i.name) || "").slice(0, 140), qty: Math.max(1, +((i && i.qty)) || 1) })),
    };
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
          // POS tablets filter their drafts list by source: staff-created
          // drafts carry shopify_draft_order while app-created ones carry the
          // app's name and get hidden. Match the staff source so kiosk orders
          // show up on the tablets like Tyler's do.
          sourceName: "shopify_draft_order",
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
        if (dr) { out.name = dr.name; out.did = String(dr.id || "").replace(/\D/g, ""); }
        else out.error = JSON.stringify(j?.data?.draftOrderCreate?.userErrors || j?.errors || r.status);
      } catch (e) {
        out.error = String((e && e.message) || e);
      }
    }
    const m = { type: "counter_order", data: out };
    if (this.tv) this.send(this.tv, m);
    if (this.phone) this.send(this.phone, m);
    for (const s of this.staff) this.send(s, m);
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
