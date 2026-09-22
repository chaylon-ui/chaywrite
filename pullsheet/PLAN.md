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

## Decisions needed from the owner before phase 2

- Are online orders ever fulfilled from more than one of the six stores? This
  decides whether the queue is per location (fulfillment orders carry the
  assigned location either way).
- Is there a Wi-Fi label printer or a PC near the packing bench (print agent)?
- Keep PIN login behind Cloudflare Access, or switch to Access only?
- Wave rules: manual only, or auto-wave (time / size / per game)?
