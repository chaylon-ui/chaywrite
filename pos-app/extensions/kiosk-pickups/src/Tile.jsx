// The home-screen tile: shows how many pickups are waiting and opens the
// modal. POS re-renders tiles when the home screen shows, so the count
// stays reasonably fresh without any polling loop.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BASE } from "./config.js";

export default async () => {
  render(<Tile />, document.body);
};

function Tile() {
  const [sub, setSub] = useState("Checking…");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const k = await shopify.storage.get("pickupKey");
        if (!k) {
          if (!dead) setSub("Tap to set up");
          return;
        }
        const r = await fetch(`${BASE}/pickups.json?k=${encodeURIComponent(k)}`);
        if (r.status === 403) {
          if (!dead) setSub("PIN changed — tap to fix");
          return;
        }
        const d = await r.json();
        const n = (d.orders || []).length;
        if (!dead) setSub(n === 0 ? "No open pickups" : n === 1 ? "1 order waiting" : `${n} orders waiting`);
      } catch {
        if (!dead) setSub("Tap to view");
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  return (
    <s-tile
      heading="Kiosk Pickups"
      subheading={sub}
      enabled
      onClick={() => shopify.action.presentModal()}
    ></s-tile>
  );
}
