// The full-screen pickup list. First run asks for the staff PIN (the same
// one the /staff and /pickups pages use), checks it against the worker and
// keeps it in POS storage per device. After that: every open draft order,
// newest first — ADD TO CART drops the lines into the POS cart to ring
// through, DONE deletes the draft once the sale is made.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BASE, LOGO } from "./config.js";

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

function Modal() {
  const [key, setKey] = useState(null); // null = still loading storage
  const [view, setView] = useState("boot"); // boot | pin | list
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [confirmDid, setConfirmDid] = useState("");
  const [adding, setAdding] = useState("");

  useEffect(() => {
    (async () => {
      const k = await shopify.storage.get("pickupKey").catch(() => null);
      if (k) {
        setKey(k);
        setView("list");
      } else {
        setView("pin");
      }
    })();
  }, []);

  useEffect(() => {
    if (view !== "list" || !key) return;
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/pickups.json?k=${encodeURIComponent(key)}`);
        if (r.status === 403) {
          // PIN was changed on the kiosk admin — ask again.
          await shopify.storage.delete("pickupKey").catch(() => {});
          if (!dead) {
            setKey(null);
            setPinErr("The staff PIN changed — enter the new one.");
            setView("pin");
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
  }, [view, key]);

  async function savePin() {
    const k = pin.trim();
    if (!k) return;
    setBusy(true);
    setPinErr("");
    try {
      const r = await fetch(`${BASE}/pickups.json?k=${encodeURIComponent(k)}`);
      if (r.status === 403) {
        setPinErr("That PIN isn't right — it's the same one the staff alert page uses.");
      } else if (r.ok) {
        await shopify.storage.set("pickupKey", k);
        setKey(k);
        setOrders(null);
        setView("list");
      } else {
        setPinErr("The pickup server answered oddly — try again in a minute.");
      }
    } catch {
      setPinErr("Couldn't reach the pickup server — check the tablet's internet.");
    }
    setBusy(false);
  }

  async function addToCart(o) {
    setAdding(o.did);
    let added = 0;
    let skipped = 0;
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
          skipped += q;
        }
      } else {
        skipped += q;
      }
    }
    setAdding("");
    shopify.toast.show(
      skipped
        ? `${added} added — ${skipped} item${skipped === 1 ? "" : "s"} need manual add`
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
      const r = await fetch(`${BASE}/pickups/done?k=${encodeURIComponent(key)}&did=${o.did}`, { method: "POST" });
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

  if (view === "pin") {
    return (
      <s-page heading="Kiosk Pickups — setup">
        <s-scroll-box>
          <s-section heading="One-time setup on this tablet">
            <s-text>
              Enter the staff PIN (the same one the kiosk admin and staff alert pages use). It's checked against the
              pickup server and remembered on this device.
            </s-text>
            <s-text-field
              label="Staff PIN"
              value={pin}
              onInput={(e) => setPin(e.currentTarget.value)}
              onChange={(e) => setPin(e.currentTarget.value)}
            ></s-text-field>
            {pinErr ? <s-banner tone="critical" heading="Check the PIN"><s-text>{pinErr}</s-text></s-banner> : null}
            <s-button onClick={savePin} disabled={busy || !pin.trim()}>
              {busy ? "Checking…" : "Save & open pickups"}
            </s-button>
          </s-section>
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
              {o.kiosk ? (
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-image src={LOGO} alt="Exor Games kiosk" inlineSize="28px" aspectRatio="2380/2084" objectFit="contain"></s-image>
                  <s-text>Kiosk order</s-text>
                </s-stack>
              ) : null}
              {(o.items || []).map((it, i) => (
                <s-text key={i}>
                  {it.q} × {it.t}
                  {it.v ? "" : " (custom line — add manually)"}
                </s-text>
              ))}
              {o.note ? <s-text>“{o.note}”</s-text> : null}
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
