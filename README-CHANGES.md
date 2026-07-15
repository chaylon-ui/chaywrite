# Exor Binder — multi-game update (deploy notes)

## What changed (your 7 asks)

1. **Top-loaders no longer shrink the card.** The art now fills the full card
   size and the clear sleeve is drawn *outside* it (rim + frosted lip extend
   beyond the card edges). `tv.html`
2. **TV showcase is now 8 columns** (was 6) — 24 cards per case (3 shelves × 8).
   `tv.html`
3. **Game tabs moved from the TV to the phone.** Customers switch Magic /
   Pokémon / Yu-Gi-Oh from their phone; the TV reskins + reloads automatically.
   `phone.html` (tab bar), `tv.html` (tabs removed)
4. **Phone grid is 3 columns** (was 2). `phone.html`
5. **Pokémon singles get their own collection feed and are grouped by energy
   type** (Grass / Fire / Water / Lightning / Psychic / Fighting / Darkness /
   Metal / Dragon / Colorless / Trainer). `src/cards.js`
6. **Yu-Gi-Oh added** — its own collection feed, grouped Spell / Trap / then
   monster attribute (Dark, Light, Earth, Water, Fire, Wind), plus a new
   midnight-slate & gold case theme. `src/cards.js`, `tv.html`
7. **Admin now has three collection fields** — one handle each for Magic,
   Pokémon, Yu-Gi-Oh. Saving updates the tabs live on both screens.
   `admin.html`, `src/room.js`

The `> $10` + in-stock filter applies to every game (unchanged worker logic).

## Files in this package

```
src/config.js      — tabs now carry {label, collection, theme, game}
src/room.js        — validates a `tabs` admin patch; /switch carries game; theme whitelist +yugioh
src/cards.js       — game-aware lanes (MTG color / Pokémon energy / YGO spell-trap-attribute)
src/index.js       — unchanged routing (included for completeness)
public/tv.html     — outset top-loaders, 8 cols, TRAY 24, no tabs, theme-yugioh, lane colors
public/phone.html  — 3 cols, TRAY 24, game tab bar (drives /switch)
public/admin.html  — three collection-handle fields
public/cards.sample.js — regenerated offline fallback deck (original was never shared)
```

## ⚠ Before you deploy

1. **Diff `src/` against your local source.** I reconstructed these from the
   built bundle you pasted; your local `src/` should match, but check.
2. **Logo:** the original pages embedded your PNG logo as a base64 `<img>`.
   I could not reproduce 22 KB of base64 reliably, so both pages use a styled
   text logo (`EXOR·GAMES`) with a comment marking the spot — paste your
   original `<img …>` line back if you want the graphic.
3. **`cards.sample.js`** is a regenerated stand-in (you never shared the
   original). If you still have yours, keep it — either works.
4. Deploy: `npx wrangler deploy` from the project root.

## Shopify collections — DONE ✓ (created 2026-07-15)

Two smart collections were created live on your store and this package
already points at them (config defaults + admin fallbacks):

- **Pokémon Singles — New Arrivals** — handle `pokemon-singles-new-arrivals`
  — conditions (all): Product type = `Pokemon Single` · Inventory > 0 ·
  Price > 10 · Sort: Newest first (`CREATED_DESC`)
- **Yu-Gi-Oh! Singles — New Arrivals** — handle `yu-gi-oh-singles-new-arrivals`
  — same conditions with Product type = `Yugioh Single`

Nothing to do — deploy and the Pokémon/Yu-Gi-Oh tabs pull the new feeds.
(Smart collections index in the background; they fill within a few minutes
of creation.)

## Verified locally (stub room + Playwright)

- 8-column TV grid, 24/24 tray parity with the phone (spread sync holds)
- Top-loader mode: card art full-bleed, sleeve rim measured *outside* the card
- Phone: 3 columns, tabs render, tab tap → /switch → TV reskins + refetches
- Pokémon energy lanes and YGO spell/trap/attribute lanes group correctly
- Featured-card zoom in top-loader mode
- Zero console errors on both pages

Live WebSocket pairing / draft orders can't run in this sandbox — smoke-test
the QR flow once after `wrangler deploy`.
