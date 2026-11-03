# Exor Pull Sheet (worker)

The tablet pick-and-pack app at https://exor-pullsheet.nevski.workers.dev.
Staff sign in with a name + 4-digit PIN, pick cards off a consolidated sheet,
pack per order, print labels, and flash ESL shelf tags via ChayESL.

## Where this code came from

`src/index.js` is the copy that was briefly committed to `chaylon-ui/chayesl`
as `public/dl-e9f1d28ef9f8ad65.js` on 2026-07-08 (commit 6a7b2c8) and deleted
the same day ("Remove temp worker download copy"). It is byte-identical to that
file (md5 `6aa2e79a11ce7809e1c2255636a68ab5`). Nothing newer exists in any repo,
and on 2026-09-22 the owner pasted the live worker source: it is identical to
that copy apart from a trailing newline. The source here is authoritative.

The other half of the system, the Tampermonkey userscript that builds sheets
from the Shopify orders page, lives in chayesl at
`public/us-8e0deea35c31b6d22504/exor-pull-sheet.user.js` (v0.28.0).

## Making this deployable (phase 1)

1. (Done 2026-09-22: live source diffed against `src/index.js`, identical.)
2. (Nothing to paste: the KV namespace is named `pullsheet-jobs` and the
   workflow resolves its id by name at deploy time.)
3. Confirm the worker's secrets exist in the dashboard: `API_TOKEN`, `SHOP`,
   `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SESSION_SECRET`, `ESL_KEY`.
   `keep_vars = true` means a deploy never touches them.
4. Run the "Deploy exor-pullsheet" workflow by hand (Actions tab). It fails
   early if no `pullsheet-jobs` namespace is found, and smoke-tests the
   sign-in page after deploying.
5. Once one manual deploy is green, switch the workflow's trigger to
   `push` on `pullsheet/**` so pushes deploy like exor-binder.

## Secrets to rotate now

These are hard-coded in the userscript (served publicly and in git) and must be
rotated regardless of anything else:

- Shopify client secret of the Dev Dashboard app the script uses
  (dev.shopify.com -> the app -> Settings -> Credentials). Update the worker
  secret `SHOPIFY_CLIENT_SECRET` too: the worker mints its own token from the
  same app.
- The worker's `API_TOKEN` (also embedded in the served app page for every
  logged-in staff member).
- ChayESL's `STAFF_ACCESS_KEY` on the droplet (`.env`), which the worker holds
  as `ESL_KEY`.

After rotating, the userscript needs the new values until it is retired in
phase 2 (it auto-updates from esl.exorgames.com).

## Defects fixed on this branch (phase 1b)

Verified with a local harness (mock KV + mocked Shopify) before pushing.

- `POST /api/jobs/:id/pack` now tags only the packed order PACKED + PRINTED.
  It used to tag every order in the sheet.
- Per-order picking now lifts the sheet-level `state.found` for that card, so
  picking from the order pages no longer leaves the sheet at "0 pulled".
- `/auth` locks a name + IP for 15 minutes after 5 wrong PINs (KV TTL key);
  the sign-in page shows the lockout message.
- The client four-eye check now matches the server (every picker, not just
  `startedBy`), and admins reach the server's override prompt instead of a
  dead-end alert.
- `GET /api/jobs` answers archived sheets from KV metadata (no body read), and
  the metadata now carries the game badges.
- Userscript v0.29.0 (chayesl branch `claude/pullsheet-userscript-v0.29`):
  lines use `unfulfilledQuantity` instead of `quantity`, so edited or partly
  fulfilled orders are not re-pulled; the dead `TAG_AFTER_PRINT` setting is gone.

## Phase 2 and 3 (on this branch): live queue, Shopify on pack, print, PIN at the bench

**The queue reads Shopify live.** `GET /api/queue` runs one order search
(paid, unfulfilled, online, last 14 days, oldest first) and caches it for a
minute in KV. Nothing is mirrored: a signed order webhook or the Refresh
button drops the cache and the next read asks Shopify again; a 10-minute
cron keeps the cache warm. Cancelled, fulfilled, POS and "Ready for pickup"
orders never appear. Tap an order number for a preview; tick orders and
**Make pull sheet** builds the sheet server-side (same game -> set ->
collector grouping as the userscript), tags them PULLSHEET and refuses
orders already on an active sheet. Rarity and set names are cached in KV
under `enr:*` and topped up by `POST /api/jobs/:id/enrich`.

**Packing drives Shopify** (`src/fulfil.js`). Pickup orders are marked
Ready for pickup (Shopify emails the customer). Shipped orders are
fulfilled with the tracking number typed at the bench when the admin
setting "Fulfil shipped orders in Shopify" is on, leaving out refunded and
quarantined cards; it is off by default because buying a label in Shopify
fulfils the order itself. Quarantining a card puts a hold on the orders
that carry it and clearing it releases the hold. All of this needs the
merchant-managed fulfillment orders scope on the app; until it is added
every action falls back to the PACKED / PRINTED / quarantine1 tags and the
note on the tablet says why. PACKED and PRINTED are still written either
way.

**Whoever packs types their PIN.** Finalize asks "Who is packing?" and a
PIN (`POST /api/verify-pin`, same lockout as sign-in); that name, not the
tablet's session, is the verifier for the four-eye rule and the stats.

**Print** on any sheet opens `GET /print/:id`, the printable page the
userscript used to build, page per game, from the stored sheet.

**Sheet numbers are short** (#43), old 12-digit sheets keep working.

**The userscript is retired**: chayesl branch
`claude/pullsheet-userscript-retire` replaces it with a credential-free
v1.0.0 stub that only points at the app; merge it and pull on the droplet
so installed copies auto-update, then rotate the three keys the old file
carried.

Harnesses: `cd pullsheet/test && node phase1.mjs && node phase2.mjs && node phase3.mjs`.

## Still open (later phases)

- Every patch is a whole-job read-modify-write in KV (no compare-and-set), so
  two tablets on one sheet can overwrite each other. Durable Object later.
- `/api/stats` still reads every job body (admin-only, rare).
- PINs default to 1234 for seeded staff; set real PINs in Staff & settings.
- Cloudflare Access in front of the app, and the print agent for the
  network label printer (make/model still needed).

## Where this is going (phases 2-5)

See PLAN.md.
