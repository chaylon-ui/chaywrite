# Exor Pull Sheet (worker)

The tablet pick-and-pack app at https://exor-pullsheet.nevski.workers.dev.
Staff sign in with a name + 4-digit PIN, pick cards off a consolidated sheet,
pack per order, print labels, and flash ESL shelf tags via ChayESL.

## Where this code came from

`src/index.js` is the copy that was briefly committed to `chaylon-ui/chayesl`
as `public/dl-e9f1d28ef9f8ad65.js` on 2026-07-08 (commit 6a7b2c8) and deleted
the same day ("Remove temp worker download copy"). It is byte-identical to that
file (md5 `6aa2e79a11ce7809e1c2255636a68ab5`). Nothing newer exists in any repo,
so **the live worker may have moved on since July.** Do not deploy from here
until that is checked.

The other half of the system, the Tampermonkey userscript that builds sheets
from the Shopify orders page, lives in chayesl at
`public/us-8e0deea35c31b6d22504/exor-pull-sheet.user.js` (v0.28.0).

## Making this deployable (phase 1)

1. Cloudflare dashboard -> Workers & Pages -> exor-pullsheet -> download the
   live source (Edit code, or `npx wrangler download` locally). Diff it against
   `src/index.js`; commit the live version here if it differs.
2. Dashboard -> KV -> the namespace bound as `JOBS` -> copy its id into
   `wrangler.toml`.
3. Confirm the worker's secrets exist in the dashboard: `API_TOKEN`, `SHOP`,
   `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SESSION_SECRET`, `ESL_KEY`.
   `keep_vars = true` means a deploy never touches them.
4. Run the "Deploy exor-pullsheet" workflow by hand (Actions tab). It refuses to
   run while the KV id placeholder is present, and smoke-tests the sign-in page.
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

## Known defects in this copy (fix in phase 1b, after the source check)

- Line items use `quantity`; edited or partly fulfilled orders re-pull items the
  customer no longer gets. Use `unfulfilledQuantity`.
- `POST /api/jobs/:id/pack` tags EVERY order in the sheet PACKED + PRINTED when
  one order is packed. Tag only that order.
- Sheet-level `state.found` and per-order `state.orders[name].found` are never
  reconciled; picking from order pages leaves the sheet at 0 pulled.
- Every patch is a whole-job read-modify-write in KV (no compare-and-set), so
  two tablets on one sheet overwrite each other.
- `GET /api/jobs` and `/api/stats` read every job body ever stored.
- `/auth` has no rate limit; PINs default to 1234.
- Client four-eye check only tests `startedBy`; the server tests every picker.
- `TAG_AFTER_PRINT` in the userscript is declared but never read.

## Where this is going (phases 2-5)

See PLAN.md.
