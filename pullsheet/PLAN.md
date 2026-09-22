# Pull sheet v2 - plan

Goal: keep the tablets and the floor workflow (game -> set -> collector number,
ESL flash, four-eye pack, LTM/EXP labels, stats), replace the snapshot-and-tags
plumbing with a live queue fed by Shopify, and let Shopify hold the "done" state.

## Target shape

- **Intake by webhook.** The worker subscribes to paid-order and order-update
  webhooks (exor-binder already self-registers INVENTORY_LEVELS_UPDATE in
  src/room.js; same pattern). Every paid order lands in a per-location pick
  queue with unfulfilled quantities, the assigned fulfillment location and
  enriched card data. A "sheet" becomes a wave: a lead groups queued orders,
  or a rule does (morning, per location, or at N orders). No userscript, no
  DOM scraping, no secrets in browsers.
- **State in a Durable Object with SQLite storage, one per location.**
  Serialized writes (no lost picks), WebSocket hibernation for live tablets
  (no polling), SQL for stats and history. KV only caches rarity, images and
  the Shopify token.
- **Shopify holds "done".** Pack -> fulfillment created with tracking (customer
  gets the shipping email). Quarantine -> fulfillment-order hold with reason.
  Refund mark -> NEEDS-REFUND tag + note, listed in the nightly ESL digest.
  PULLSHEET / PACKED / PRINTED / quarantine1 tags go away.
- **Tablets as an installed web app.** Camera barcode scan to verify a pick
  against the SKU; service worker with an offline mutation queue; login via
  Cloudflare Access (tablet enrolls once, every tap attributed to a person).
  A POS tile (like Kiosk Pickups) can open it.
- **Printing from the worker.** A print agent on a store PC or Pi with a
  network label printer; "Pack" prints with no dialog; reprint is one tap.
- **Enrichment server-side, once per SKU**, shared by every tablet.

## Phases (each ships alone, each can be rolled back)

1. **Source control + deploy** (this directory). Rotate the three exposed
   secrets. Then fix the known defects listed in README.md.
2. **Webhook intake + queue screen** beside the existing sheets. Userscript
   keeps working while staff try the queue.
3. **Durable Object state + WebSockets.** Pick/pack UI ports mostly as-is.
4. **Fulfill on pack, hold on quarantine, drop the tags.**
5. **Scan, offline queue, print agent, Access login.**

## Owner decisions (2026-09-22)

- **One store ships everything.** Online orders are fulfilled from a single
  location, so the queue is one list. No per-location split; the assigned
  fulfillment location is still recorded per order for the day that changes.
- **Network label printer at the packing bench.** Phase 5 adds a print agent
  that drives it from the worker; no browser print dialog on the tablet.
  (Printer make/model still to be confirmed before phase 5.)
- **Keep PINs, add Cloudflare Access in front.** Access gates the URL (a tablet
  enrols once); staff still pick their name and PIN, so every tap is attributed.
- **Manual waves only.** Orders land in a live queue; a lead ticks the ones to
  pull and makes a sheet. No scheduled or size-triggered sheets.

## Phase 2 scope (next)

1. Webhook intake: the worker registers ORDERS_PAID / ORDERS_UPDATED /
   ORDERS_CANCELLED webhooks on itself (same self-registration pattern as
   exor-binder's INVENTORY_LEVELS_UPDATE), verifies the HMAC with the app's
   client secret, and keeps a `queue:` entry per unfulfilled order with
   unfulfilled quantities, customer, shipping method, assigned location.
2. Backfill: an admin button imports unfulfilled orders since a chosen date
   (the store reports ~4,900 "unfulfilled" orders; most are old kiosk/POS
   orders that will never ship, so intake needs a start date, not "all").
3. Queue screen: live list of queued orders (age, items, shipping/pickup,
   already-on-a-sheet flag); tick orders, "Make pull sheet" builds the same
   job the userscript builds today, server-side (SKU parse, game/set/collector
   grouping, rarity + image enrichment cached in KV).
4. The userscript keeps working through phase 2; it is retired in phase 3.
