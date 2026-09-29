// The full-screen pickup list. First run pairs the tablet: it shows a short
// code, an admin types it on 9Pocket › Admin › Devices and services, and the
// tablet gets its own key (kept in POS storage, revocable there). The old
// staff PIN, if this tablet still has one saved, keeps working until the
// owner switches the PIN off (2026-09-29: accounts and paired devices instead
// of the PIN). After that: every open draft order, newest first — ADD TO CART
// drops the lines into the POS cart to ring through, DONE deletes the draft
// once the sale is made.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BASE } from "./config.js";

export default async () => {
  render(<Modal />, document.body);
};

function age(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ?dk= for a paired tablet, ?k= for one still on the old PIN
const authQs = (a) => (a && a.dk ? `dk=${a.dk}` : `k=${encodeURIComponent((a && a.pin) || "")}`);

function Modal() {
  const [auth, setAuth] = useState(null); // { dk } paired | { pin } old PIN | null
  const [view, setView] = useState("boot"); // boot | pair | list
  const [pairing, setPairing] = useState(null); // { id, code } | { expired: true } | { error }
  const [pairMsg, setPairMsg] = useState("");
  const [pairTry, setPairTry] = useState(0); // bumped by "Get a new code"
  const [orders, setOrders] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [confirmDid, setConfirmDid] = useState("");
  const [adding, setAdding] = useState("");
  const [failed, setFailed] = useState({}); // did -> [titles POS refused to add]

  useEffect(() => {
    (async () => {
      const dk = await shopify.storage.get("pickupDevice").catch(() => null);
      const pin = dk ? null : await shopify.storage.get("pickupKey").catch(() => null);
      if (dk) setAuth({ dk });
      else if (pin) setAuth({ pin });
      setView(dk || pin ? "list" : "pair");
    })();
  }, []);

  // Pairing: ask for a code, show it, and wait for an admin to type it.
  useEffect(() => {
    if (view !== "pair") return;
    let dead = false, timer = null;
    const start = async () => {
      setPairing(null);
      try {
        const r = await fetch(`${BASE}/device/pair/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "pos-tile" }) });
        const d = await r.json();
        if (dead) return;
        if (!r.ok || !d.id) { setPairing({ error: d.error || "Couldn't get a pairing code — try again in a minute." }); return; }
        setPairing({ id: d.id, code: d.code });
        const poll = async () => {
          if (dead) return;
          try {
            const p = await (await fetch(`${BASE}/device/pair/poll?id=${d.id}`)).json();
            if (dead) return;
            if (p.status === "approved" && p.key) {
              await shopify.storage.set("pickupDevice", p.key);
              await shopify.storage.delete("pickupKey").catch(() => {});
              setAuth({ dk: p.key });
              setPairMsg("");
              setOrders(null);
              setView("list");
              shopify.toast.show(`Paired as ${p.name || "this tablet"}`);
              return;
            }
            if (p.status === "expired") { setPairing({ expired: true }); return; }
          } catch {}
          timer = setTimeout(poll, 3000);
        };
        timer = setTimeout(poll, 3000);
      } catch {
        if (!dead) setPairing({ error: "Couldn't reach the pickup server — check the tablet's internet." });
      }
    };
    start();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [view, pairTry]);

  useEffect(() => {
    if (view !== "list" || !auth) return;
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/pickups.json?${authQs(auth)}`);
        if (r.status === 403) {
          // the tablet's key was revoked, or the old PIN was switched off: pair (again)
          await shopify.storage.delete(auth.dk ? "pickupDevice" : "pickupKey").catch(() => {});
          if (!dead) {
            setAuth(null);
            setPairMsg(auth.dk ? "This tablet's key was revoked — pair it again." : "The old staff PIN no longer works — pair this tablet instead.");
            setView("pair");
          }
          return;
        }
        const d = await r.json();
        if (!dead) {
          if (d.orders) {
            setOrders(d.orders);
            setErr("");
          } else {
            setErr(d.error || "Couldn't load");
          }
        }
      } catch (e) {
        if (!dead) setErr("Network problem — pull down or reopen to retry.");
      }
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [view, auth]);

  async function addToCart(o) {
    setAdding(o.did);
    setFailed((f) => ({ ...f, [o.did]: [] }));
    // Stamp the sale with which kiosk pickup it came from — the rung-in
    // order shows "Kiosk pickup: #D274" in its details, so the paper trail
    // survives after the draft itself is cleared. Best-effort: a POS build
    // without cart properties still adds the items fine.
    try { await shopify.cart.addCartProperties({ "Kiosk pickup": String(o.name || o.did) }); } catch {}
    let added = 0;
    const misses = [];
    for (const it of o.items || []) {
      const q = it.q || 1;
      if (it.v) {
        try {
          await shopify.cart.addLineItem(it.v, q);
          added += q;
          // brief breather between adds — rapid-fire cart mutations make POS
          // pop its generic "something went wrong" banner even on success
          await new Promise((res) => setTimeout(res, 300));
        } catch {
          misses.push(it.t);
        }
      } else {
        misses.push(it.t);
      }
    }
    setAdding("");
    setFailed((f) => ({ ...f, [o.did]: misses }));
    shopify.toast.show(
      misses.length
        ? `${added} added — ${misses.length} couldn't be added (see list)`
        : `${o.name}: ${added} item${added === 1 ? "" : "s"} in the cart`
    );
  }

  async function markDone(o) {
    if (confirmDid !== o.did) {
      setConfirmDid(o.did);
      setTimeout(() => setConfirmDid((c) => (c === o.did ? "" : c)), 4000);
      return;
    }
    setConfirmDid("");
    try {
      const r = await fetch(`${BASE}/pickups/done?${authQs(auth)}&did=${o.did}`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setOrders((os) => (os || []).filter((x) => x.did !== o.did));
        shopify.toast.show(`${o.name} cleared`);
      } else {
        shopify.toast.show(d.error || "Couldn't clear it — try from admin");
      }
    } catch {
      shopify.toast.show("Network problem — try again");
    }
  }

  if (view === "pair") {
    return (
      <s-page heading="Kiosk Pickups — pair this tablet">
        <s-scroll-box>
          {pairMsg ? <s-banner tone="warning" heading="Pair this tablet"><s-text>{pairMsg}</s-text></s-banner> : null}
          {pairing && pairing.code ? (
            <s-section heading={`Pairing code:  ${pairing.code}`}>
              <s-text>
                An admin opens 9Pocket › Admin › Devices and services › “Pair a tablet”, types this code, names the
                tablet and ticks “Kiosk pickups”. This screen opens the pickups by itself a few seconds later.
              </s-text>
              <s-text>Waiting for an admin… (the code works for 10 minutes)</s-text>
            </s-section>
          ) : pairing && (pairing.expired || pairing.error) ? (
            <s-section heading={pairing.expired ? "The code ran out" : "Couldn't start pairing"}>
              <s-text>{pairing.expired ? "Codes last 10 minutes. Get a new one and try again." : pairing.error}</s-text>
              <s-button onClick={() => setPairTry((n) => n + 1)}>Get a new code</s-button>
            </s-section>
          ) : (
            <s-section>
              <s-text>Getting a pairing code…</s-text>
            </s-section>
          )}
        </s-scroll-box>
      </s-page>
    );
  }

  if (view !== "list") {
    return (
      <s-page heading="Kiosk Pickups">
        <s-section>
          <s-text>Loading…</s-text>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Kiosk Pickups">
      <s-scroll-box>
        {auth && auth.pin ? (
          <s-section>
            <s-banner tone="warning" heading="This tablet still uses the old staff PIN">
              <s-text>The PIN is being switched off. Pair this tablet now so pickups keep working.</s-text>
            </s-banner>
            <s-button onClick={() => { setPairMsg(""); setView("pair"); }}>Pair this tablet</s-button>
          </s-section>
        ) : null}
        {err ? (
          <s-section>
            <s-banner tone="critical" heading="Can't load pickups"><s-text>{err}</s-text></s-banner>
            <s-text>{err}</s-text>
          </s-section>
        ) : null}
        {orders === null ? (
          <s-section>
            <s-text>Loading open pickups…</s-text>
          </s-section>
        ) : orders.length === 0 ? (
          <s-section heading="All caught up">
            <s-text>No open draft orders right now. New kiosk send-to-counter orders show up here within seconds.</s-text>
          </s-section>
        ) : (
          orders.map((o) => (
            <s-section key={o.did} heading={`${o.kiosk ? "" : "📦 "}${o.name} · $${o.total} · ${age(o.createdAt)}`}>
              {o.kiosk ? <s-text>EXOR KIOSK ORDER</s-text> : null}
              {(o.items || []).map((it, i) => (
                <s-text key={i}>
                  {it.q} × {it.t}
                  {it.v ? "" : " (custom line — add manually)"}
                </s-text>
              ))}
              {o.note ? <s-text>“{o.note}”</s-text> : null}
              {(failed[o.did] || []).length ? (
                <s-banner tone="warning" heading="POS couldn't add these — usually the product isn't on the Point of Sale sales channel">
                  {failed[o.did].map((t, i) => (
                    <s-text key={i}>• {t}</s-text>
                  ))}
                  <s-text>Add them by search, or fix the product's Sales channels in Shopify admin.</s-text>
                </s-banner>
              ) : null}
              <s-stack direction="inline" gap="base">
                <s-button onClick={() => addToCart(o)} disabled={adding === o.did}>
                  {adding === o.did ? "Adding…" : "🛒 Add items to cart"}
                </s-button>
                <s-button tone={confirmDid === o.did ? "critical" : "neutral"} onClick={() => markDone(o)}>
                  {confirmDid === o.did ? "Tap again to confirm" : "✓ Done (clear draft)"}
                </s-button>
              </s-stack>
            </s-section>
          ))
        )}
        <s-section>
          <s-text>
            “Add items to cart” rings the cards through at their current store price; take payment as normal, then tap
            Done to clear the draft. The list refreshes itself every 20 seconds.
          </s-text>
        </s-section>
      </s-scroll-box>
    </s-page>
  );
}
