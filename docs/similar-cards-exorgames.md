# "Alternatives in stock" (similar-card strip) for exorgames.com product pages

Hand this file to whoever (or whatever) is working on the exorgames.com Shopify
theme. It contains everything needed to reproduce the Exor Showcase kiosk's
"Alternatives in stock" feature on the website's MTG product pages — no access
to the kiosk codebase required.

## What the feature does

On the kiosk, when a customer previews a Magic: The Gathering single, a small
plaque appears: **"Alternatives in stock"** — up to 3 cards that are
functionally better ("strictly better") versions of the card being viewed AND
are currently in stock at Exor Games, each with image, name and price. On the
website version, each card should link to its own product page.

It looks empty most of the time by design: it only renders when the community
database knows upgrades for the card **and** the store actually stocks at
least one of them. Quiet absence is correct behavior, not a bug.

## Architecture (two fetches, both from the BROWSER)

```
shopper's browser
   │ 1. GET https://www.strictlybetter.eu/api/obsoletes/<cardName>
   │      (community DB of "strictly better" relations — MUST be fetched from
   │       the browser: their API is CORS-open, but their Cloudflare zone
   │       301-loops/blocks server-side fetches. Do not proxy it.)
   ▼
 parse & rank superior names (rules below) → up to 8 names
   │ 2. GET https://exor-binder.nevski.workers.dev/instock.json?names=Name1|Name2|…
   │      (Exor's worker maps those names onto actual in-stock products via
   │       the shop's own search; CORS-open: access-control-allow-origin: *)
   ▼
 render up to 3 cards (image / name / price), linking to card.url
```

No API keys, no authentication, nothing secret — both endpoints are public and
read-only.

## Step 1 — strictlybetter.eu response and the exact parse rules

`GET https://www.strictlybetter.eu/api/obsoletes/<URL-encoded card name>` with
`accept: application/json`. The response is either a JSON array of relation
rows or `{ data: [...] }`. Each row has (fields of interest):

```json
{
  "inferiors":  [{ "name": "Cancel" }, ...],
  "superiors":  [{ "name": "Dissolve" }, ...],
  "upvotes": 12, "downvotes": 1,
  "labels": { "downvoted": false, ... }
}
```

Parse rules (match these exactly — they filter out community noise):

1. Keep only rows where **our card's name appears in `inferiors`**
   (case-insensitive exact match). Rows where it appears as a superior are
   about worse cards, not upgrades.
2. Score each row `upvotes - downvotes`; **skip** rows with a negative score
   or `labels.downvoted` truthy.
3. Collect every `superiors[].name` from surviving rows; when a name appears
   in several rows keep its **best** score.
4. Sort names by score (descending), drop any name equal to our card's own
   name, keep the **top 8**.

Reference implementation (this is the kiosk's, verbatim in behavior):

```js
function sbParse(j, target) {
  const rows = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []);
  const t = String(target).toLowerCase();
  const scores = new Map();
  for (const r of rows) {
    const infs = Array.isArray(r && r.inferiors) ? r.inferiors : [];
    const sups = Array.isArray(r && r.superiors) ? r.superiors : [];
    if (!infs.some(c => c && typeof c.name === 'string' && c.name.toLowerCase() === t)) continue;
    const score = ((+r.upvotes) || 0) - ((+r.downvotes) || 0);
    if (score < 0 || (r.labels && r.labels.downvoted)) continue;
    for (const s of sups) {
      if (s && typeof s.name === 'string') scores.set(s.name, Math.max(scores.get(s.name) ?? -1, score));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])
    .filter(n => n.toLowerCase() !== t).slice(0, 8);
}
```

## Step 2 — the in-stock mapping endpoint (Exor's worker)

```
GET https://exor-binder.nevski.workers.dev/instock.json?names=Dissolve|Counterspell|Absorb
```

- `names` is **pipe-separated** (card names contain commas), max 8 names,
  each ≤80 chars. URL-encode the whole value.
- Response is cached at the edge for 10 minutes per name-set and carries
  `access-control-allow-origin: *`.
- The worker checks names in the order given and stops after 4 hits, so the
  ranking from step 1 is preserved.

Response shape:

```json
{
  "count": 2,
  "cards": [
    {
      "name": "Dissolve",
      "set": "Theros",
      "game": "mtg",
      "type": "MTG Single",
      "color": "C",
      "price": "0.79",
      "foil": false,
      "condition": "Near Mint",
      "image": "https://cdn.shopify.com/s/files/1/.../x.jpg",
      "variantId": 35776144933017,
      "url": "https://exorgames.com/products/dissolve-theros"
    }
  ]
}
```

`price` is the **cheapest in-stock copy** in CAD; `url` is the product page —
that's the link target on the website. `image` may be `null`.

## Putting it on the product page

The store's MTG singles have `product.type == "MTG Single"` and titles like
`"Lightning Bolt [Magic 2011]"` — the plain card name is the title with the
trailing `[Set Name]` bracket stripped.

Easiest integration: **Online Store → Customize → product template → Add
section/block → Custom Liquid**, paste the block below (or drop it into the
product template in the theme code editor). It renders nothing at all for
non-MTG products and when there are no in-stock upgrades.

```liquid
{% if product.type == 'MTG Single' %}
<div id="exor-betters" style="display:none" data-card-name="{{ product.title | split: ' [' | first | escape }}"></div>
<script>
(function () {
  var box = document.getElementById('exor-betters');
  if (!box) return;
  var name = box.getAttribute('data-card-name');
  if (!name) return;

  function sbParse(j, target) {
    var rows = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : []);
    var t = String(target).toLowerCase();
    var scores = new Map();
    rows.forEach(function (r) {
      var infs = Array.isArray(r && r.inferiors) ? r.inferiors : [];
      var sups = Array.isArray(r && r.superiors) ? r.superiors : [];
      if (!infs.some(function (c) { return c && typeof c.name === 'string' && c.name.toLowerCase() === t; })) return;
      var score = ((+r.upvotes) || 0) - ((+r.downvotes) || 0);
      if (score < 0 || (r.labels && r.labels.downvoted)) return;
      sups.forEach(function (s) {
        if (s && typeof s.name === 'string') scores.set(s.name, Math.max(scores.has(s.name) ? scores.get(s.name) : -1, score));
      });
    });
    return Array.from(scores.entries()).sort(function (a, b) { return b[1] - a[1]; })
      .map(function (x) { return x[0]; })
      .filter(function (n) { return n.toLowerCase() !== t; }).slice(0, 8);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  fetch('https://www.strictlybetter.eu/api/obsoletes/' + encodeURIComponent(name), { headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var names = j ? sbParse(j, name) : [];
      if (!names.length) return null;
      return fetch('https://exor-binder.nevski.workers.dev/instock.json?names=' + encodeURIComponent(names.join('|')));
    })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .then(function (d) {
      var cards = (d && Array.isArray(d.cards) ? d.cards : []).slice(0, 3);
      if (!cards.length) return;
      box.innerHTML =
        '<div class="exor-betters-title">Upgrades in stock</div>' +
        '<div class="exor-betters-row">' + cards.map(function (b) {
          return '<a class="exor-betters-card" href="' + esc(b.url) + '">' +
            (b.image ? '<img src="' + esc(b.image) + '&width=200" alt="' + esc(b.name) + '" loading="lazy">' : '') +
            '<span class="exor-betters-name">' + esc(b.name) + '</span>' +
            '<span class="exor-betters-price">$' + esc(b.price) + '</span></a>';
        }).join('') + '</div>';
      box.style.display = '';
    })
    .catch(function () { /* quiet — the strip simply doesn't appear */ });
})();
</script>
<style>
  #exor-betters { margin-top: 1.25rem; }
  .exor-betters-title { font-weight: 700; margin-bottom: .5rem; }
  .exor-betters-row { display: flex; gap: .75rem; flex-wrap: wrap; }
  .exor-betters-card { width: 110px; text-decoration: none; color: inherit; text-align: center; }
  .exor-betters-card img { width: 100%; aspect-ratio: 0.715; object-fit: cover; border-radius: 6px; display: block; }
  .exor-betters-name { display: block; font-size: .8rem; margin-top: .25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .exor-betters-price { display: block; font-size: .85rem; font-weight: 700; }
</style>
{% endif %}
```

Restyle freely to match the theme — the markup above is deliberately plain.
(The kiosk titles the plaque "Alternatives in stock"; on a product page
"Upgrades in stock" reads better, since the shopper is already looking at the
inferior card. Pick either.)

## Caveats and edge cases (please keep these behaviors)

- **MTG only.** StrictlyBetter has no data for other games. The Liquid guard
  on `product.type` handles this; don't run it for Pokémon/Yu-Gi-Oh/etc.
- **Fail silently.** If either fetch errors, times out, returns nothing, or
  the card has special title decorations that don't match a StrictlyBetter
  name (e.g. `"Karn, the Great Creator (Japanese Alternate Art)"`), the strip
  just doesn't render. Never show an error or a spinner.
- **Don't proxy strictlybetter.eu server-side** (app proxy, worker, etc.) —
  their Cloudflare blocks non-browser callers. Browser fetch only.
- **Don't hammer the endpoints.** One pair of fetches per product page view
  is the intended load. The worker caches per name-set for 10 minutes;
  strictlybetter.eu is a small community project — be polite.
- **Community data.** "Strictly better" relations are crowd-voted opinions;
  the vote filtering above removes most junk. The strip is a suggestion, not
  a rules engine.
- The worker endpoint is read-only public product data, safe to call from any
  origin. If it ever changes shape, the kiosk file `public/tv.html`
  (`loadBetters`/`sbParse`) and `src/cards.js` (`serveInstock`/`findInStock`)
  in the `chaylon-ui/chaywrite` repo are the source of truth.

## Quick test checklist

1. Open a product page for a cheap, well-known inferior card — good test
   subjects: **Cancel**, **Murder**, **Shock**, **Divination** (upgrades are
   plentiful, so the strip appears whenever any upgrade is stocked).
2. DevTools network tab: see one `obsoletes/<name>` call (200, JSON) and, if
   it found names, one `instock.json?names=…` call (200, JSON with CORS).
3. Strip shows up to 3 cards; each links to its exorgames.com product page.
4. Open a non-MTG product — nothing renders and neither fetch fires.
5. Open an MTG card with no known upgrades (most expensive staples) —
   nothing renders, no console errors.
