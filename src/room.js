import { TOKEN_LIFE_S, IDLE_TIMEOUT_S, DEFAULT_SETTINGS, DEFAULT_PIN, SLEEVES_TAB_ICON, BOARD_TAB_ICON, WH_TAB_ICON } from "./config.js";
import { CACHE_DO, WARM_EVERY_MS, gzipText, warmWithStore } from "./binder-search.js";

const THEMES = ["mtg", "pokemon", "yugioh", "starwars", "onepiece", "riftbound", "hockey", "basketball"];
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
// Optional tab icon: a small data-URL image the admin page has already
// downsampled. Strict shape + size cap keeps settings well under DO limits.
const cleanIcon = (v) =>
  (typeof v === "string" && v.length <= 12000 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)) ? v : "";
// Tab-icon slots shared across every screen: one per game plus the virtual tabs.
const ICON_SLOTS = [...THEMES, "showcase", "sleeves", "board", "wh"];

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
    // Shared tab icons: the DEFAULT room's DO keeps the one icon set every
    // screen shows (same trick as the screen registry it already hosts), so
    // uploading a logo on any screen carries it to all of them.
    this.gicons = {};
    this.giconsAt = 0;
    this.gseeded = false;
    this.isDefault = false;
    try { this.isDefault = !!env.ROOM?.idFromName("default")?.equals?.(state.id); } catch {}
    // The /binder/search cache lives in the DO named CACHE_DO (same class,
    // never a screen): only that instance answers /_cache/* and runs the
    // pre-warm alarm below.
    this.isCacheDo = false;
    try { this.isCacheDo = !!env.ROOM?.idFromName(CACHE_DO)?.equals?.(state.id); } catch {}
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
        this.settings.jpTab = { ...DEFAULT_SETTINGS.jpTab, ...(this.settings.jpTab || {}) };
        const p = await this.state.storage.get("pin");
        if (p) this.pin = p;
        this.gseeded = !!(await this.state.storage.get("gseeded"));
        if (this.isDefault) {
          const gi = await this.state.storage.list({ prefix: "gicon:" });
          for (const [k, v] of gi) this.gicons[k.slice(6)] = v;
          // One-time migration: icons saved per-screen before they went shared
          // become the shared set (fill-empty so newer uploads aren't clobbered).
          if (!this.gseeded) {
            await this.applyGicons({ seed: this.ownIcons() });
            this.gseeded = true;
            await this.state.storage.put("gseeded", 1);
          }
        } else {
          this.syncGicons(true); // not awaited — first fetch shouldn't block construction
        }
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
    // Icon precedence: the shared set (uploaded on ANY screen) wins, then this
    // screen's own pre-sharing upload, then the baked-in badge (specials only).
    const gi = this.gicons || {};
    const base = (Array.isArray(this.settings.tabs) ? this.settings.tabs : []).filter((t) => t.enabled !== false)
      .map((t) => ({ ...t, icon: gi[t.game] || t.icon || "" }));
    const st = this.settings.showcaseTab || {};
    const sc = st.enabled
      ? [{ label: String(st.label || "Showcase").slice(0, 24), collection: st.collection || "esl-showcase", theme: "mtg", game: "showcase", showcase: true, icon: gi.showcase || st.icon || "" }]
      : [];
    const sv = this.settings.sleevesTab || {};
    const sl = sv.enabled
      ? [{ label: String(sv.label || "Sleeves").slice(0, 24), collection: sv.collection || "all-dragon-shield-sleeves", theme: "sleeves", game: "sleeves", sleeves: true, icon: gi.sleeves || sv.icon || SLEEVES_TAB_ICON }]
      : [];
    const shelves = [];
    for (const [key, defLabel, defColl] of [["boardTab", "Board Games", "board-games"], ["whTab", "Warhammer", "gamesworkshop"]]) {
      const tb = this.settings[key] || {};
      if (tb.enabled) shelves.push({ label: String(tb.label || defLabel).slice(0, 24), collection: tb.collection || defColl, theme: "sleeves", game: "sleeves", shelf: true, icon: gi[key === "boardTab" ? "board" : "wh"] || tb.icon || (key === "boardTab" ? BOARD_TAB_ICON : WH_TAB_ICON) });
    }
    const nt = this.settings.newToday || {};
    const extra = base
      .filter((t) => nt[t.game])
      .map((t) => ({ label: ("New Today · " + t.label).slice(0, 24), collection: t.collection, theme: t.theme, game: t.game, newToday: true }));
    return [...base, ...sc, ...sl, ...shelves, ...extra];
  }
  publicSettings() { return { ...this.settings, tabs: this.effectiveTabs(), gicons: { ...this.gicons } }; } // never includes the PIN

  // ---- Shared tab icons ----
  // This screen's own saved icons, keyed by slot — used once to migrate
  // pre-sharing uploads into the shared set.
  ownIcons() {
    const m = {};
    for (const t of (Array.isArray(this.settings.tabs) ? this.settings.tabs : []))
      if (t.icon && THEMES.includes(t.game)) m[t.game] = t.icon;
    for (const [key, slug] of [["showcaseTab", "showcase"], ["sleevesTab", "sleeves"], ["boardTab", "board"], ["whTab", "wh"]])
      if (this.settings[key]?.icon) m[slug] = this.settings[key].icon;
    return m;
  }

  // DEFAULT room only: merge a delta into the shared set. `seed` fills empty
  // slots (migration), `put` overwrites (fresh upload), `clear` removes.
  // Each slot is its own storage key so twelve ~9KB logos never near the
  // 128KB per-value cap. Returns whether anything changed.
  async applyGicons({ seed, put, clear } = {}) {
    let dirty = false;
    for (const [src, overwrite] of [[seed, false], [put, true]]) {
      if (!src || typeof src !== "object") continue;
      for (const k of ICON_SLOTS) {
        const v = cleanIcon(src[k]);
        if (v && (overwrite || !this.gicons[k]) && this.gicons[k] !== v) {
          this.gicons[k] = v;
          await this.state.storage.put("gicon:" + k, v);
          dirty = true;
        }
      }
    }
    if (Array.isArray(clear)) for (const k of clear) {
      if (ICON_SLOTS.includes(k) && this.gicons[k]) {
        delete this.gicons[k];
        await this.state.storage.delete("gicon:" + k);
        dirty = true;
      }
    }
    return dirty;
  }

  // Push a delta to the shared set and pull the full result back. On the
  // default room that's local; other rooms round-trip the default room's DO
  // (same pattern as /rooms-register). Returns false if the hop failed.
  async mergeGicons(delta) {
    if (this.isDefault) { await this.applyGicons(delta); return true; }
    try {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName("default"));
      const r = await stub.fetch(new Request("https://do/icons-sync", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(delta || {}),
      }));
      const j = await r.json();
      if (j && j.icons && typeof j.icons === "object") { this.gicons = j.icons; return true; }
    } catch {}
    return false;
  }

  // Refresh this room's copy of the shared set (throttled). The first
  // successful sync also contributes this screen's own pre-sharing uploads.
  async syncGicons(force) {
    if (this.isDefault || !this.env?.ROOM) return;
    const now = Date.now();
    if (!force && now - this.giconsAt < 60e3) return;
    this.giconsAt = now;
    const before = JSON.stringify(this.gicons);
    const ok = await this.mergeGicons(this.gseeded ? {} : { seed: this.ownIcons() });
    if (ok && !this.gseeded) {
      this.gseeded = true;
      try { await this.state.storage.put("gseeded", 1); } catch {}
    }
    if (ok && JSON.stringify(this.gicons) !== before) this.broadcastSettings();
  }

  // Small Admin GraphQL helper (returns .data or null; never throws).
  async adminGql(query, variables) {
    const token = this.env.SHOPIFY_ADMIN_TOKEN;
    if (!token) return null;
    const shop = this.env.SHOPIFY_SHOP || "most-wanted-ca.myshopify.com";
    try {
      const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables: variables || {} }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      return (await r.json())?.data || null;
    } catch { return null; }
  }

  // Keep the INVENTORY_LEVELS_UPDATE webhook pointed at this worker so
  // restocks flow into /inv-hint without anyone setting it up by hand.
  // Called from the New Today poll path, at most twice a day; failures
  // (e.g. an app token without the scope) are silent and retried later.
  async ensureInvHook(origin) {
    const now = Date.now();
    if (!this.env.SHOPIFY_ADMIN_TOKEN || now - (this.invHookAt || 0) < 43200e3) return;
    this.invHookAt = now;
    const cb = origin + "/hook/inv";
    const j = await this.adminGql(`{webhookSubscriptions(first:20,topics:[INVENTORY_LEVELS_UPDATE]){edges{node{endpoint{... on WebhookHttpEndpoint{callbackUrl}}}}}}`);
    const subs = (j && j.webhookSubscriptions && j.webhookSubscriptions.edges) || [];
    if (j && !subs.some((e) => e.node && e.node.endpoint && e.node.endpoint.callbackUrl === cb)) {
      await this.adminGql(`mutation($cb:URL!){webhookSubscriptionCreate(topic:INVENTORY_LEVELS_UPDATE,webhookSubscription:{callbackUrl:$cb,format:JSON}){userErrors{message}}}`, { cb });
    }
  }

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
    // What this screen calls its stock ("cards" when blank — a Warhammer or
    // board-game screen might say "products"). Plain word, no markup.
    if ("itemWord" in patch) next.itemWord = String(patch.itemWord).replace(/[^\p{L}\p{N} '&-]/gu, "").trim().slice(0, 20);
    if ("collection" in patch) {
      const c = String(patch.collection).trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad collection handle";
      next.collection = c;
    }
    if ("topLoaders" in patch) next.topLoaders = !!patch.topLoaders;
    if ("touchMode" in patch) next.touchMode = !!patch.touchMode;
    if ("counterEnabled" in patch) next.counterEnabled = !!patch.counterEnabled;
    if ("cartMax" in patch) {
      const n = Math.floor(+patch.cartMax);
      next.cartMax = isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
    }
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
    if ("sleeveWhiteBg" in patch) next.sleeveWhiteBg = !!patch.sleeveWhiteBg;
    if ("fullCard" in patch) next.fullCard = !!patch.fullCard;
    if ("siteMode" in patch) next.siteMode = !!patch.siteMode;
    if ("setBrowse" in patch) next.setBrowse = !!patch.setBrowse;
    if ("setRoll" in patch) next.setRoll = !!patch.setRoll;
    if ("newToday" in patch) {
      const nt = patch.newToday;
      if (!nt || typeof nt !== "object") return "bad newToday";
      next.newToday = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.newToday).map((g) => [g, !!nt[g]]));
    }
    // Japanese Pokémon singles switch (the SortSwift catalogue lives in its
    // own collection): per-screen chips on the Pokémon tab flip the case
    // between the English and Japanese decks.
    if ("jpTab" in patch) {
      const jt = patch.jpTab;
      if (!jt || typeof jt !== "object") return "bad jpTab";
      const c = String(jt.collection || "pokemon-japanese-singles").trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad jpTab collection handle";
      next.jpTab = { enabled: !!jt.enabled, collection: c };
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
    // Generic retail-shelf tabs (Board Games, Warhammer) — same wall as the
    // sleeves, minus the Dragon Shield dressing, plus customer sort chips.
    for (const [key, defLabel, defColl] of [["boardTab", "Board Games", "board-games"], ["whTab", "Warhammer", "gamesworkshop"]]) {
      if (!(key in patch)) continue;
      const tb = patch[key];
      if (!tb || typeof tb !== "object") return "bad " + key;
      const c = String(tb.collection || defColl).trim().toLowerCase();
      if (!HANDLE_RE.test(c)) return "bad " + key + " collection handle";
      next[key] = { enabled: !!tb.enabled, label: String(tb.label || defLabel).slice(0, 24).trim() || defLabel, collection: c, icon: cleanIcon(tb.icon), plain: !!tb.plain };
      if (!next[key].enabled && next.shelfActive && next.collection === next[key].collection) {
        const home = (Array.isArray(next.tabs) && next.tabs[0]) || null;
        if (home) { next.collection = home.collection; next.theme = home.theme; next.game = home.game; }
        next.shelfActive = false;
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
    // Mirror this save's icon uploads/removals into the shared set so every
    // other screen picks them up — only slots the patch explicitly carried.
    {
      const put = {}, clear = [];
      const touch = (slug, obj) => {
        if (!obj || typeof obj !== "object" || !("icon" in obj) || !ICON_SLOTS.includes(slug)) return;
        const v = cleanIcon(obj.icon);
        if (v) put[slug] = v; else clear.push(slug);
      };
      if (Array.isArray(patch.tabs)) for (const t of patch.tabs) {
        if (!t || typeof t !== "object") continue;
        touch(THEMES.includes(t.game) ? t.game : t.theme, t);
      }
      touch("showcase", "showcaseTab" in patch ? patch.showcaseTab : null);
      touch("sleeves", "sleevesTab" in patch ? patch.sleevesTab : null);
      touch("board", "boardTab" in patch ? patch.boardTab : null);
      touch("wh", "whTab" in patch ? patch.whTab : null);
      if (Object.keys(put).length || clear.length) await this.mergeGicons({ put, clear });
    }
    if ("newPin" in patch && patch.newPin != null && patch.newPin !== "") {
      const np = String(patch.newPin);
      if (!/^\d{4,8}$/.test(np)) return "PIN must be 4–8 digits";
      this.pin = np;
      await this.state.storage.put("pin", np);
    }
    this.broadcastSettings();
    return null;
  }

  // ---- /binder/search response store. Only the DO named
  // binder-search-cache (src/binder-search.js) is ever asked this, through
  // in-worker stubs; the router never forwards /_cache/* from outside.
  // One global copy of each BinderPOS answer, gzip'd (raw bodies run
  // 84-134KB; storage values cap at 128KB), under "bsc:<sha256 of the
  // canonical body>" as { ts, w (cron-written), rf (refresh lock), gz }.
  //   GET  /_cache/get?k=&fresh=&stale=&lock=[&meta=1]
  //        404 when absent or older than `stale`; else the gz bytes with
  //        x-age, x-state fresh|stale, x-warm 0|1 and x-refresh 1 when
  //        this caller won the background-refresh lock for `lock` ms.
  //   POST /_cache/put?k=&w=   body = gz bytes
  // A tiny "bsct:<k>" -> ts index lets the hourly sweep drop dead entries
  // without loading every body. Cron bookkeeping lives here too: a run
  // lock (POST /_cache/lock?ttl= -> 409 while held, /_cache/unlock), the
  // last run's summary (POST /_cache/note, GET /_cache/status) and per-key
  // metadata (/_cache/status?ks=a,b) for the public status page.
  async cacheOp(request, url) {
    await this.armWarmAlarm();
    const now = Date.now();
    const num = (name, dflt) => { const v = parseInt(url.searchParams.get(name), 10); return v > 0 ? v : dflt; };
    const KEY_RE = /^[a-f0-9]{16,64}$/;
    const k = String(url.searchParams.get("k") || "");
    if ((url.pathname === "/_cache/get" || url.pathname === "/_cache/put") && !KEY_RE.test(k)) {
      return Response.json({ error: "bad key" }, { status: 400 });
    }
    if (url.pathname === "/_cache/get") {
      const rec = await this.state.storage.get("bsc:" + k);
      if (!rec || !rec.gz) return new Response(null, { status: 404 });
      const age = Math.max(0, now - (rec.ts || 0));
      const fresh = num("fresh", 3e5), stale = num("stale", 12e5), lock = num("lock", 6e4);
      if (age >= stale) return new Response(null, { status: 404 });
      let refresh = 0;
      if (age >= fresh && now - (rec.rf || 0) >= lock) {
        rec.rf = now; // this caller refreshes; the rest serve stale quietly for `lock` ms
        await this.state.storage.put("bsc:" + k, rec);
        refresh = 1;
      }
      const h = { "x-age": String(age), "x-state": age < fresh ? "fresh" : "stale", "x-warm": rec.w ? "1" : "0", "x-refresh": String(refresh), "cache-control": "no-store" };
      if (url.searchParams.get("meta")) return new Response(null, { status: 204, headers: h });
      return new Response(rec.gz, { headers: { ...h, "content-type": "application/gzip" } });
    }
    if (url.pathname === "/_cache/put" && request.method === "POST") {
      const gz = await request.arrayBuffer();
      if (!gz.byteLength || gz.byteLength > 126 * 1024) return Response.json({ error: "bad size" }, { status: 413 });
      await this.cachePut(k, gz, url.searchParams.get("w") === "1");
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_cache/lock" && request.method === "POST") {
      const ttl = num("ttl", 72e4);
      const cur = await this.state.storage.get("bsw:lock");
      if (cur && now - cur < ttl) return Response.json({ ok: false, age: now - cur }, { status: 409 });
      await this.state.storage.put("bsw:lock", now);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_cache/unlock" && request.method === "POST") {
      await this.state.storage.delete("bsw:lock");
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_cache/note" && request.method === "POST") {
      await this.state.storage.put("bsw:last", (await request.text()).slice(0, 16384));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_cache/status") {
      const lastTxt = await this.state.storage.get("bsw:last");
      const lock = await this.state.storage.get("bsw:lock");
      let last = null;
      try { last = lastTxt ? JSON.parse(lastTxt) : null; } catch {}
      const entries = {};
      const ks = String(url.searchParams.get("ks") || "").split(",").filter((x) => KEY_RE.test(x)).slice(0, 20);
      for (const kk of ks) {
        const rec = await this.state.storage.get("bsc:" + kk);
        entries[kk] = rec && rec.gz ? { age: Math.max(0, now - (rec.ts || 0)), warm: !!rec.w, bytes: rec.gz.byteLength } : null;
      }
      let alarmIn = null;
      try { const a = await this.state.storage.getAlarm(); alarmIn = a ? a - now : null; } catch {}
      return Response.json({ last, lockAge: lock ? now - lock : null, alarmIn, entries }, { headers: { "cache-control": "no-store" } });
    }
    return new Response(null, { status: 404 });
  }

  // Store one gz'd answer (+ its index row); sweep dead rows hourly.
  async cachePut(k, gz, warm) {
    const now = Date.now();
    await this.state.storage.put({ ["bsc:" + k]: { ts: now, w: warm ? 1 : 0, gz }, ["bsct:" + k]: now });
    if (now - (this.bscSweepAt || 0) > 36e5) {
      this.bscSweepAt = now;
      try {
        const idx = await this.state.storage.list({ prefix: "bsct:", limit: 1000 });
        const dead = [];
        for (const [ik, ts] of idx) if (now - (ts || 0) > 18e5) dead.push(ik, "bsc:" + ik.slice(5));
        for (let i = 0; i < dead.length; i += 128) await this.state.storage.delete(dead.slice(i, i + 128));
      } catch (e) { console.log("cache sweep failed: " + ((e && e.message) || e)); }
    }
  }

  // The warm loop's store adapter over this DO's own storage (same keys
  // the /_cache/* paths use, so the cron and the alarm see one state).
  cacheStore() {
    const st = this.state.storage;
    return {
      meta: async (key) => {
        const rec = await st.get("bsc:" + key);
        if (!rec || !rec.gz) return null;
        return { age: Math.max(0, Date.now() - (rec.ts || 0)), warm: !!rec.w };
      },
      put: async (key, text, warm) => {
        const gz = await gzipText(text);
        if (gz.byteLength > 126 * 1024) throw new Error("gz too large: " + gz.byteLength);
        await this.cachePut(key, gz, warm);
      },
      lock: async (ttl) => {
        const cur = await st.get("bsw:lock");
        if (cur && Date.now() - cur < ttl) return { ok: false, age: Date.now() - cur };
        await st.put("bsw:lock", Date.now());
        return { ok: true, age: 0 };
      },
      unlock: () => st.delete("bsw:lock"),
      note: (obj) => st.put("bsw:last", JSON.stringify(obj).slice(0, 16384)),
    };
  }

  // Pre-warm clock #2: a Durable Object alarm every WARM_EVERY_MS, armed by
  // the first /_cache/* request after a deploy and re-armed at the start of
  // every run (so a run that dies never stops the clock). Delivered by the
  // runtime itself - the worker cron registered by wrangler on 2026-09-02
  // was never seen to invoke scheduled(). Only the cache DO ever sets an
  // alarm, so alarm() is a no-op for every screen's room.
  async armWarmAlarm() {
    if (!this.isCacheDo || this.warmAlarmArmed) return;
    this.warmAlarmArmed = true;
    try {
      if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + 30e3);
    } catch (e) { console.log("binder-warm(alarm): arm failed: " + ((e && e.message) || e)); }
  }

  async alarm() {
    if (!this.isCacheDo) return;
    try { await this.state.storage.setAlarm(Date.now() + WARM_EVERY_MS); } catch {}
    try { await warmWithStore(this.cacheStore(), "alarm"); }
    catch (e) { console.log("binder-warm(alarm): " + ((e && e.message) || e)); }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_cache/")) return this.cacheOp(request, url);
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
        { const p = this.syncGicons(); this.state.waitUntil?.(p); } // rebroadcasts if the shared icons moved
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
      await this.syncGicons(); // throttled shared-icon refresh (no-op on default)
      return Response.json(this.publicSettings(), { headers: { "cache-control": "no-store" } });
    }

    // ---- Shared tab icons (only ever called on the DEFAULT room's DO, via
    // in-worker stubs — the router never exposes this path publicly). Other
    // rooms POST their uploads/removals here and get the full set back.
    if (url.pathname.endsWith("/icons-sync") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const dirty = await this.applyGicons(b || {});
      if (dirty) this.broadcastSettings(); // the default TV updates live too
      return Response.json({ icons: this.gicons }, { headers: { "cache-control": "no-store" } });
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

    // ---- Deck Builder tracking (DEFAULT room only, via in-worker stubs;
    // the router PIN-gates every read). /deck-event ingests one activity
    // event: serveDeck relays proof-of-work-verified searches, the router
    // relays storefront beacons (cart adds, ticks, version swaps). Kept per
    // UTC day: aggregate tallies (dstat), a rolling activity log with IPs
    // for the admin page's ban tooling (dlog, 14 days), and a most-wanted
    // misses tally (dmiss, 60 days). Every event also broadcasts live to
    // staff-role sockets. Card names and IPs stay inside this DO and are
    // only served through the PIN-gated admin endpoints; decklists beyond
    // the capped name summaries are never stored.
    if (url.pathname.endsWith("/deck-event") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const ev = ["search", "cart", "act"].indexOf(b.ev) > -1 ? b.ev : "act";
      const ip = String(b.ip || "").slice(0, 45);
      const game = String(b.game || "other").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "other";
      const n = Math.min(500, Math.max(0, parseInt(b.n, 10) || 0));
      const v = Math.min(5e6, Math.max(0, parseInt(b.v, 10) || 0));
      const found = Math.min(500, Math.max(0, parseInt(b.found, 10) || 0));
      const cleanList = (a, max, len) => (Array.isArray(a) ? a.slice(0, max).map((s) => String(s).slice(0, len)) : []);
      const names = cleanList(b.names, 40, 70);
      const miss = cleanList(b.miss, 25, 70);
      const act = String(b.a || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 12);
      const detail = String(b.d || "").slice(0, 90);
      const sid = String(b.sid || "").replace(/[^a-z0-9]/gi, "").slice(0, 8);

      // Per-IP limiter so a bot can't flood the log or the live feed.
      this.dRate = this.dRate || new Map();
      const nowMs = Date.now();
      const rl = this.dRate.get(ip) || { win: nowMs, ct: 0 };
      if (nowMs - rl.win > 60e3) { rl.win = nowMs; rl.ct = 0; }
      rl.ct++;
      this.dRate.set(ip, rl);
      if (this.dRate.size > 3000) this.dRate.clear();
      if (rl.ct > 40) return Response.json({ ok: false, limited: true });

      const day = new Date().toISOString().slice(0, 10);
      if (ev === "search" || ev === "cart") {
        for (const key of ["dstat:" + day, "dstat:total"]) {
          const s = (await this.state.storage.get(key)) || {};
          const g = (s[ev] = s[ev] || {});
          const row = (g[game] = g[game] || { c: 0, n: 0, v: 0 });
          row.c += 1; row.n += n; row.v += v;
          await this.state.storage.put(key, s);
        }
      }
      const entry = { t: nowMs, ev, ip, sid, game };
      if (ev === "search") { entry.n = n; entry.found = found; if (miss.length) entry.miss = miss; }
      if (ev === "cart") { entry.n = n; entry.v = v; if (names.length) entry.names = names; }
      if (ev === "act") { entry.a = act; entry.d = detail; if (act === "miss" && names.length) entry.names = names; }
      {
        const lk = "dlog:" + day;
        const log = (await this.state.storage.get(lk)) || [];
        log.unshift(entry);
        await this.state.storage.put(lk, log.slice(0, 800));
      }
      if (ev === "search" && miss.length) {
        const mk = "dmiss:" + day;
        const m = (await this.state.storage.get(mk)) || {};
        const mg = (m[game] = m[game] || {});
        for (const name of miss) {
          const key = Object.keys(mg).length >= 300 && !(name in mg) ? "(more)" : name;
          mg[key] = (mg[key] || 0) + 1;
        }
        await this.state.storage.put(mk, m);
      }
      if (Math.random() < 0.02) { // day keys start "…:2…", totals are never swept
        for (const [prefix, days] of [["dstat:2", 400], ["dlog:2", 14], ["dmiss:2", 60]]) {
          const cut = prefix.slice(0, -1) + new Date(nowMs - days * 864e5).toISOString().slice(0, 10);
          const all = await this.state.storage.list({ prefix });
          for (const k of all.keys()) if (k < cut) await this.state.storage.delete(k);
        }
      }
      for (const s of this.staff) this.send(s, { type: "deck", data: entry });
      return Response.json({ ok: true });
    }

    // Ban list for the router's edge check (cached in the isolate).
    if (url.pathname.endsWith("/deck-banlist")) {
      const bans = (await this.state.storage.get("dban")) || {};
      return Response.json({ ips: Object.keys(bans) }, { headers: { "cache-control": "no-store" } });
    }

    // Admin reads/actions for the PIN-gated stats page. The router has
    // already validated the staff PIN before anything reaches here.
    if (url.pathname.endsWith("/deck-admin")) {
      const op = url.searchParams.get("op") || "overview";

      // Owner-managed admin IP allow-list. Empty list = every IP may use
      // the (still PIN-gated) admin; once populated, only listed IPs pass.
      // The router stamps `me` from cf-connecting-ip, so it can't be faked
      // by the caller.
      const me = String(url.searchParams.get("me") || "").slice(0, 45);
      const wl = (await this.state.storage.get("dwl")) || {};
      if (Object.keys(wl).length && !wl[me]) {
        return Response.json({ error: "ip not allowed", me }, { status: 403 });
      }

      if (op === "wl_add" || op === "wl_del") {
        const ip = String(url.searchParams.get("ip") || "").slice(0, 45);
        if (!/^[0-9a-fA-F.:]{3,45}$/.test(ip)) return Response.json({ ok: false, error: "bad ip" });
        if (op === "wl_add") wl[ip] = { at: Date.now() };
        else delete wl[ip];
        await this.state.storage.put("dwl", wl);
        return Response.json({ ok: true, wl, me });
      }

      if (op === "hot_add" || op === "hot_del") {
        const name = String(url.searchParams.get("name") || "").slice(0, 90);
        const game = String(url.searchParams.get("game") || "other").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "other";
        if (name.length < 2) return Response.json({ ok: false, error: "bad name" });
        const hot = (await this.state.storage.get("dhot")) || {};
        const key = game + "|" + name.toLowerCase();
        if (op === "hot_add") hot[key] = { name, game, at: Date.now() };
        else delete hot[key];
        await this.state.storage.put("dhot", hot);
        return Response.json({ ok: true, hot });
      }

      if (op === "misslog") {
        // Every missed-card record in the 14-day log, for the CSV export:
        // search entries carry names only, the storefront's per-search miss
        // beacon carries quantities and any sister-store price.
        const rows = [];
        for (let i = 0; i < 14 && rows.length < 1500; i++) {
          const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
          const log = (await this.state.storage.get("dlog:" + d)) || [];
          for (const e of log) {
            if (e.ev === "search" && e.miss && e.miss.length) rows.push({ t: e.t, game: e.game, kind: "search", list: e.miss });
            else if (e.ev === "act" && e.a === "miss" && e.names && e.names.length) rows.push({ t: e.t, game: e.game, kind: "qty", list: e.names });
            if (rows.length >= 1500) break;
          }
        }
        return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
      }

      if (op === "ban" || op === "unban") {
        const ip = String(url.searchParams.get("ip") || "").slice(0, 45);
        if (!/^[0-9a-fA-F.:]{3,45}$/.test(ip)) return Response.json({ ok: false, error: "bad ip" });
        const bans = (await this.state.storage.get("dban")) || {};
        if (op === "ban") bans[ip] = { note: String(url.searchParams.get("note") || "").slice(0, 80), at: Date.now() };
        else delete bans[ip];
        await this.state.storage.put("dban", bans);
        return Response.json({ ok: true, bans });
      }

      if (op === "orders") {
        // Which carts became real sales: scan new orders for the cart's
        // "Deck Builder" attribute. Incremental with a 1h overlap, cached
        // 15 min, capped pages per refresh so a busy order feed can't run
        // away. Needs the Admin token to be allowed to read orders.
        const nowMs = Date.now();
        let ds = (await this.state.storage.get("dsales")) || { list: [], scanAt: 0, startAt: nowMs - 3 * 864e5 };
        if (nowMs - (ds.scanAt || 0) > 15 * 60e3) {
          const sinceMs = Math.max(ds.startAt, (ds.scanAt || ds.startAt) - 3600e3);
          const since = new Date(sinceMs).toISOString();
          let cursor = null, pages = 0, sawAny = false, denied = false;
          const q = `query($q:String!,$after:String){orders(first:50,query:$q,after:$after,reverse:false){nodes{name createdAt displayFinancialStatus totalPriceSet{shopMoney{amount}}customAttributes{key value}lineItems(first:40){nodes{title quantity}}}pageInfo{hasNextPage endCursor}}}`;
          for (;;) {
            const d = await this.adminGql(q, { q: "created_at:>='" + since + "'", after: cursor });
            const o = d && d.orders;
            if (!o) { denied = !sawAny; break; }
            sawAny = true;
            for (const nd of o.nodes || []) {
              const tag = (nd.customAttributes || []).find((a) => a && a.key === "Deck Builder");
              if (!tag) continue;
              if (ds.list.some((x) => x.name === nd.name)) continue;
              ds.list.unshift({
                name: nd.name,
                at: nd.createdAt,
                status: nd.displayFinancialStatus || "",
                cents: Math.round(parseFloat((nd.totalPriceSet && nd.totalPriceSet.shopMoney && nd.totalPriceSet.shopMoney.amount) || "0") * 100),
                tag: String(tag.value || "").slice(0, 90),
                items: ((nd.lineItems && nd.lineItems.nodes) || []).slice(0, 40).map((li) => ({ t: String(li.title || "").slice(0, 90), q: li.quantity | 0 })),
              });
            }
            pages++;
            if (!o.pageInfo || !o.pageInfo.hasNextPage || pages >= 6) break;
            cursor = o.pageInfo.endCursor;
          }
          ds.available = !denied;
          if (!denied) ds.scanAt = nowMs;
          ds.list.sort((a, b) => (a.at < b.at ? 1 : -1));
          ds.list = ds.list.slice(0, 200);
          await this.state.storage.put("dsales", ds);
        }
        const cents = ds.list.reduce((a, x) => a + (x.cents || 0), 0);
        return Response.json({
          available: ds.available !== false,
          count: ds.list.length, cents,
          scanAt: ds.scanAt || 0, startAt: ds.startAt,
          list: ds.list.slice(0, 60),
        }, { headers: { "cache-control": "no-store" } });
      }

      // op=overview: stats + activity log + per-IP rollup + bans + misses
      const total = (await this.state.storage.get("dstat:total")) || {};
      const statDays = await this.state.storage.list({ prefix: "dstat:2", reverse: true, limit: 31 });
      const days = [];
      for (const [k, s] of statDays) days.push({ day: k.slice(6), ...s });

      let log = [];
      for (let i = 0; i < 3 && log.length < 150; i++) {
        const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
        log = log.concat((await this.state.storage.get("dlog:" + d)) || []);
      }
      log = log.slice(0, 150);
      const ips = {};
      for (const e of log) {
        const r = (ips[e.ip] = ips[e.ip] || { searches: 0, carts: 0, acts: 0, last: 0 });
        if (e.ev === "search") r.searches++; else if (e.ev === "cart") r.carts++; else r.acts++;
        if (e.t > r.last) r.last = e.t;
      }

      const missDays = await this.state.storage.list({ prefix: "dmiss:2", reverse: true, limit: 30 });
      const missAgg = {};
      for (const [, m] of missDays) {
        for (const g of Object.keys(m)) {
          const tgt = (missAgg[g] = missAgg[g] || {});
          for (const name of Object.keys(m[g])) tgt[name] = (tgt[name] || 0) + m[g][name];
        }
      }
      const miss = {};
      for (const g of Object.keys(missAgg)) {
        miss[g] = Object.keys(missAgg[g]).map((name) => ({ name, c: missAgg[g][name] }))
          .sort((a, b) => b.c - a.c).slice(0, 30);
      }

      const bans = (await this.state.storage.get("dban")) || {};
      const hot = (await this.state.storage.get("dhot")) || {};
      return Response.json(
        { note: "c = times, n = cards, v = cents", total, days, log, ips, miss, bans, hot, wl, me },
        { headers: { "cache-control": "no-store" } }
      );
    }

    // ---- "New Today" restock hints (DEFAULT room only; /hook/inv relays
    // Shopify's inventory webhook here). The hint names an inventory item;
    // we resolve it to its product and LIVE total with our own Admin token,
    // then compare with the last total we stored for that product. More
    // stock than before = an arrival for the New Today tabs — this is what
    // catches "added 4 copies of a card we already stocked", which the
    // collection feed can never show. First sighting has no baseline, so
    // it flags only when today's recent orders rule out a plain sale.
    if (url.pathname.endsWith("/inv-hint") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const item = String((b && b.item) || "").replace(/\D/g, "").slice(0, 24);
      const token = this.env.SHOPIFY_ADMIN_TOKEN;
      if (!item || !token) return Response.json({ ok: false });
      // Bulk syncs hammer this — at most one lookup per item per 20s.
      this.invSeen = this.invSeen || new Map();
      const nowMs = Date.now();
      if (nowMs - (this.invSeen.get(item) || 0) < 20e3) return Response.json({ ok: true, throttled: true });
      this.invSeen.set(item, nowMs);
      if (this.invSeen.size > 4000) this.invSeen.clear();
      const j1 = await this.adminGql(`query($id:ID!){inventoryItem(id:$id){variant{product{handle totalInventory status}}}}`,
        { id: "gid://shopify/InventoryItem/" + item });
      const p = j1 && j1.inventoryItem && j1.inventoryItem.variant && j1.inventoryItem.variant.product;
      if (!p || p.status !== "ACTIVE" || !p.handle) return Response.json({ ok: true });
      const handle = String(p.handle).slice(0, 160);
      const total = Math.max(0, p.totalInventory | 0);
      const prev = await this.state.storage.get("pinv:" + handle);
      await this.state.storage.put("pinv:" + handle, total);
      let arrival = false;
      if (typeof prev === "number") arrival = total > prev;
      else if (total > 0) {
        // No baseline for this product yet — flag it unless a just-made sale
        // explains the stock movement (sales fire this same webhook).
        const since = new Date(nowMs - 30 * 60e3).toISOString();
        const j2 = await this.adminGql(`query($q:String!){orders(first:20,query:$q){edges{node{lineItems(first:20){edges{node{product{handle}}}}}}}}`,
          { q: `created_at:>'${since}'` });
        const sold = ((j2 && j2.orders && j2.orders.edges) || []).some((o) =>
          ((o.node && o.node.lineItems && o.node.lineItems.edges) || []).some((li) => li.node && li.node.product && li.node.product.handle === handle));
        arrival = !sold;
      }
      if (arrival) {
        const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
        const k = "ntarr:" + day;
        const list = (await this.state.storage.get(k)) || [];
        if (!list.includes(handle) && list.length < 300) {
          list.push(handle);
          await this.state.storage.put(k, list);
          const old = "ntarr:" + new Date(Date.now() - 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
          await this.state.storage.delete(old);
        }
      }
      return Response.json({ ok: true, arrival });
    }
    // Today's webhook-confirmed restocks, for the New Today deck builder.
    if (url.pathname.endsWith("/nt-arrivals")) {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
      const handles = (await this.state.storage.get("ntarr:" + day)) || [];
      return Response.json({ handles }, { headers: { "cache-control": "no-store" } });
    }

    // ---- "New Today" stock memory (only ever called on the DEFAULT room's
    // DO, via in-worker stubs — the router never exposes this path). The card
    // feed POSTs a hash per in-stock product it can see in a collection; a
    // hash never seen before — or gone for days and now back — is today's
    // arrival (BinderPOS restocks don't touch published_at, so appearing in
    // the feed is the only honest signal). The very first call per collection
    // just seeds the memory, so day one shows the usual newest cards.
    if (url.pathname.endsWith("/nt-mark") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { b = {}; }
      const c = String((b && b.c) || "").slice(0, 80);
      const hs = (Array.isArray(b && b.hs) ? b.hs : []).map((h) => String(h).slice(0, 16)).filter(Boolean).slice(0, 4200);
      if (!c || !hs.length) return Response.json({ fresh: [] });
      { const p = this.ensureInvHook(url.origin); this.state.waitUntil ? this.state.waitUntil(p) : await p; }
      const day = Math.floor(Date.now() / 864e5);
      // Memory layout: "nts:<c>:meta" = { p: lastPollDay } and six hash-
      // sharded maps "nts:<c>:s0..s5" of hash -> [firstSeenDay, lastSeenDay]
      // (a big MTG collection is ~8k entries — too large for one DO value).
      // A guarded entry stores firstSeenDay 0 ("ancient, never flag").
      await this.state.storage.delete("ntseen:" + c); // pre-shard format, hours old — drop, the guard reseeds
      const SHARDS = 6;
      // Shard on the LAST hash character — the first is a magnitude digit
      // (most hashes share it), the last is uniform.
      const shardOf = (h) => (parseInt(h[h.length - 1], 36) || 0) % SHARDS;
      const meta = (await this.state.storage.get("nts:" + c + ":meta")) || null;
      const maps = [];
      for (let i = 0; i < SHARDS; i++) maps.push((await this.state.storage.get("nts:" + c + ":s" + i)) || {});
      const prevPoll = (meta && meta.p) || day;
      let fresh = [];
      for (const h of hs) {
        const m = maps[shardOf(h)];
        const e = m[h];
        if (!e) { m[h] = [day, day]; fresh.push(h); }
        else {
          if (e[1] < prevPoll && e[1] < day - 2) { e[0] = day; fresh.push(h); } // a poll saw it missing for days, now back — an arrival
          else if (e[0] === day) fresh.push(h); // arrived earlier today — stays fresh all day
          e[1] = day;
        }
      }
      // Anomaly guard: a real day brings tens of arrivals. Hundreds+ means a
      // first seed, a coverage change or a feed hiccup — record those quietly
      // (firstSeen 0 so they never flag) and report nothing. This is also
      // what makes seeding silent, so genuine same-day arrivals AFTER the
      // first poll still show the same day.
      if (fresh.length > 150) {
        for (const h of fresh) { const e = maps[shardOf(h)][h]; if (e && e[0] === day) e[0] = 0; }
        fresh = [];
      }
      // Forget what hasn't been seen in 60 days, and cap each shard well
      // inside the DO per-value limit — evicting oldest-last-seen first so
      // currently-stocked entries are never the ones cut.
      for (const m of maps) {
        for (const h of Object.keys(m)) if (day - m[h][1] > 60) delete m[h];
        const keys = Object.keys(m);
        if (keys.length > 1650) {
          keys.sort((a, z) => m[a][1] - m[z][1]);
          for (const k of keys.slice(0, keys.length - 1650)) delete m[k];
        }
      }
      await this.state.storage.put("nts:" + c + ":meta", { p: day });
      for (let i = 0; i < SHARDS; i++) await this.state.storage.put("nts:" + c + ":s" + i, maps[i]);
      return Response.json({ fresh, seeded: !meta });
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
      this.settings = { ...this.settings, collection: t.collection, theme: t.theme, game: t.game || t.theme, newTodayActive: !!t.newToday, showcaseActive: !!t.showcase, sleevesActive: !!t.sleeves, shelfActive: !!t.shelf };
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
    // Admin usage viewer: PIN-guarded, groups a day's events into sessions
    // and rolls them up into the task-based kiosk KPIs (completion rate,
    // funnel, search success, zero-result terms). day:"all" = every stored
    // day (14) aggregated.
    if (url.pathname.endsWith("/alog") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
      if (String((b && b.pin) || "") !== String(this.pin)) return Response.json({ error: "Incorrect PIN" }, { status: 403 });
      let day, rows;
      if ((b && b.day) === "all") {
        day = "all"; rows = [];
        const all = await this.state.storage.list({ prefix: "alog:" });
        for (const v of all.values()) if (Array.isArray(v)) rows.push(...v);
      } else {
        day = /^\d{4}-\d{2}-\d{2}$/.test((b && b.day) || "") ? b.day
          : new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax" });
        rows = (await this.state.storage.get("alog:" + day)) || [];
      }
      const bySid = {};
      for (const [sid, t, e, dd, v] of rows) {
        const s = (bySid[sid] = bySid[sid] || { sid, start: t, end: t, events: [] });
        s.start = Math.min(s.start, t); s.end = Math.max(s.end, t);
        s.events.push({ t, e, d: dd, v });
      }
      const sessions = Object.values(bySid).sort((a, z) => z.start - a.start);
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
      // Task-based KPIs. A session COMPLETES when it reaches any real
      // outcome: checkout QR handoff, sent to counter, or a draft order.
      // Search events carry the result count in v (v>0 hits, -2 explicit
      // zero results; 0/-1 = unknown, from before counts were recorded).
      const kpi = { engaged: 0, carted: 0, completed: 0, abandoned: 0, medianDoneS: 0, searchHits: 0, searchZero: 0 };
      const zt = {}, tq = {}, tt = {}, ta = {}, doneTimes = [], hours = {};
      const bump = (m, label) => {
        label = String(label || "").trim().slice(0, 60);
        if (label.length < 2) return;
        const k2 = label.toLowerCase();
        (m[k2] = m[k2] || { n: 0, label }).n++;
      };
      for (const s of sessions) {
        // Store-local hour of each walk-up, for the customers-per-hour graph
        // (computed over EVERY session, not just the 200 shown).
        const hr = parseInt(new Date(s.start).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Halifax" }), 10);
        if (hr >= 0 && hr <= 24) hours[hr % 24] = (hours[hr % 24] || 0) + 1;
        let doneAt = 0, added = false, engaged = false;
        for (const ev of s.events) {
          if (ev.e === "tap") { engaged = true; sum.taps++; bump(tt, ev.d); }
          else if (ev.e === "q") { engaged = true; sum.searches++; bump(tq, ev.d);
            if (ev.v > 0) kpi.searchHits++; else if (ev.v === -2) { kpi.searchZero++; bump(zt, ev.d); } }
          else if (ev.e === "add") { engaged = true; added = true; sum.adds++; bump(ta, ev.d); }
          else if (ev.e === "qr") { sum.qr++; if (!doneAt) doneAt = ev.t; }
          else if (ev.e === "send") { sum.counter++; sum.counterTotal += ev.v || 0; if (!doneAt) doneAt = ev.t; }
          else if (ev.e === "ord") { sum.orders++; if (!doneAt) doneAt = ev.t; }
          else if (ev.e === "to") sum.timeouts++;
        }
        if (engaged) kpi.engaged++;
        if (added) kpi.carted++;
        if (doneAt) { kpi.completed++; doneTimes.push(Math.max(0, doneAt - s.start)); }
        else if (added) kpi.abandoned++; // built a cart, walked away without checkout
      }
      doneTimes.sort((a, z) => a - z);
      if (doneTimes.length) kpi.medianDoneS = Math.round(doneTimes[Math.floor((doneTimes.length - 1) / 2)] / 1000);
      const top = (m, n) => Object.values(m).sort((a, z) => z.n - a.n).slice(0, n).map((x) => [x.label, x.n]);
      kpi.zeroTerms = top(zt, 15); kpi.topQ = top(tq, 12); kpi.topTap = top(tt, 12); kpi.topAdd = top(ta, 12);
      kpi.hours = hours;
      sum.counterTotal = Math.round(sum.counterTotal * 100) / 100;
      return Response.json({ day, summary: sum, kpi, sessions: sessions.slice(0, 200) }, { headers: { "cache-control": "no-store" } });
    }

    // ---- Review gate feedback ----
    // The star widget (phone + kiosk) posts here: 4-5 stars head to Google,
    // 1-3 come to us instead — the comment lands in admin, never in public.
    // Same open trust level as /counter; capped and clamped hard.
    if (url.pathname.endsWith("/feedback") && request.method === "POST") {
      let d; try { d = await request.json(); } catch { return Response.json({ error: "bad body" }, { status: 400 }); }
      const stars = Math.max(1, Math.min(5, parseInt(d && d.stars, 10) || 0));
      if (!(parseInt(d && d.stars, 10) >= 1)) return Response.json({ error: "stars required" }, { status: 400 });
      const item = {
        t: Date.now(), s: stars,
        c: String((d && d.comment) || "").replace(/\s+/g, " ").trim().slice(0, 400),
        n: String((d && d.name) || "").replace(/\s+/g, " ").trim().slice(0, 40),
      };
      const list = (await this.state.storage.get("feedback")) || [];
      list.unshift(item);
      await this.state.storage.put("feedback", list.slice(0, 200));
      return Response.json({ ok: true });
    }
    // Admin viewer for the comments (PIN-guarded, same as /alog).
    if (url.pathname.endsWith("/fblist") && request.method === "POST") {
      let b; try { b = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
      if (String((b && b.pin) || "") !== String(this.pin)) return Response.json({ error: "Incorrect PIN" }, { status: 403 });
      const items = (await this.state.storage.get("feedback")) || [];
      return Response.json({ items }, { headers: { "cache-control": "no-store" } });
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
