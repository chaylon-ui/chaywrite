# Kiosk Pickups — POS tile app

Puts a **Kiosk Pickups** tile on the Shopify POS home screen of every
register. Tapping it lists every OPEN draft order (kiosk send-to-counter
orders and any others), with one-tap **Add items to cart** and a **Done**
button that clears the draft after the sale is rung through.

This exists because POS tablets only list draft orders created by
first-party Shopify apps — kiosk drafts are invisible there. The tile reads
the same PIN-gated `/pickups.json` feed as https://exor-binder.nevski.workers.dev/pickups.

## One-time deploy (~10 minutes, needs the store owner login)

Run these on any computer with Node 20+ installed (your laptop is fine —
this doesn't touch the kiosk or the worker):

```bash
cd pos-app
npm install
npm run deploy
```

The deploy command walks you through, one prompt at a time:

1. **Log in** — a browser window opens; sign in with the Shopify account
   that owns Exor Games.
2. **"Create this project as a new app?"** → **Yes**, keep the name
   **Kiosk Pickups**. (The CLI writes the new app's client_id into
   `shopify.app.toml` — commit that change if you want.)
3. Confirm the release when asked ("Yes, release this new version").

Then install it on the store:

4. The CLI prints a link to the app in your **Dev Dashboard** (or find it at
   dev dashboard → Apps → Kiosk Pickups). Open it and choose
   **Install on store** → pick Exor Games / most-wanted-ca.

## On each POS tablet (~1 minute each)

1. On the POS **home screen**, tap **Add tile** (or ≡ → Settings → Smart
   grid → Add tile) → **App** → **Kiosk Pickups**.
2. Tap the new tile once — it asks for the **staff PIN** (the same PIN the
   kiosk admin / staff alert pages use). It checks the PIN against the
   pickup server and remembers it on that tablet.

That's it. The tile subtitle shows how many orders are waiting.

## Daily use

- Customer taps **SEND TO COUNTER** on the kiosk → within seconds the
  order is on the tile.
- Tap the tile → tap **🛒 Add items to cart** on their order → the cards
  land in the POS cart at current store price → take payment as normal.
- Tap **✓ Done (clear draft)** → **tap again to confirm** → the draft
  order is deleted so the list stays clean. (If you skip this, the draft
  just stays open in Shopify admin — nothing breaks.)
- Lines marked "custom line — add manually" had no matching product
  variant; ring those by hand.

## Updating the app later

Edit the files in `pos-app/extensions/kiosk-pickups/src/`, then:

```bash
cd pos-app && npm run deploy
```

Tablets pick the new version up automatically (kill and reopen the POS app
if one seems stale).

## Troubleshooting

- **Tile says "PIN changed — tap to fix"** — the admin PIN was changed;
  tap the tile and enter the new one.
- **"Couldn't reach the pickup server"** — the tablet has no internet, or
  the worker is down; the kiosk itself would be down too.
- **An order won't clear** — it may already be completed/deleted; check
  https://exor-binder.nevski.workers.dev/pickups or Shopify admin → Draft
  orders.
