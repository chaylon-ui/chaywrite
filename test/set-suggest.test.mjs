import { serveSetSuggest } from '../src/cards.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); }
};

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

let seen = null;
const suggest = async (qs, nodes) => {
  seen = null;
  globalThis.fetch = async (url, opt) => {
    seen = JSON.parse(opt.body).variables.q;
    return new Response(JSON.stringify({ data: { products: { edges: nodes.map((node) => ({ node })) } } }), { headers: { 'content-type': 'application/json' } });
  };
  const r = await serveSetSuggest(new Request('https://w.dev/setsuggest.json?' + qs), { SHOPIFY_ADMIN_TOKEN: 't', SHOPIFY_SHOP: 's.myshopify.com' }, null);
  return (await r.json()).sets;
};

// --- MTG: the parent set and its sub-set are offered separately, so picking
// one of them is an unambiguous choice ---
eq('parent and sub-set are distinct entries',
  (await suggest('q=wilds&g=mtg', [
    { title: 'Charmed Clothier [Wilds of Eldraine]', tags: ['White', 'Wilds of Eldraine'], description: 'Set: Wilds of Eldraine Type: Creature Rarity: Common' },
    { title: 'Barrow Naughty [Wilds of Eldraine]', tags: ['Black', 'Wilds of Eldraine'], description: 'Set: Wilds of Eldraine Type: Creature Rarity: Common' },
    { title: 'Utopia Sprawl [Wilds of Eldraine: Enchanting Tales]', tags: ['Green', 'Wilds of Eldraine: Enchanting Tales'], description: 'Set: Wilds of Eldraine: Enchanting Tales Type: Enchantment Rarity: Uncommon' },
  ])).map((x) => x.n),
  ['Wilds of Eldraine', 'Wilds of Eldraine: Enchanting Tales']);

// --- Yu-Gi-Oh: the title brackets a CODE, so the set is only findable through
// the tag. This is the case the old title-only scrape could not serve. ---
const ygo = await suggest('q=savage&g=yugioh', [
  { title: 'Neo Space Connector [SAST-EN008] Common', tags: ['Common', 'Savage Strike'], description: 'Set: Savage Strike Card type: Effect Monster Rarity: Common' },
]);
eq('yugioh set found through its tag', ygo, [{ n: 'Savage Strike', q: 'Savage Strike' }]);
eq('the suggestion query searches tags as well as titles', seen,
  'status:active product_type:"Yugioh Single" (title:*savage* OR tag:*savage*)');

// --- a set named only in the description, with no matching tag, is a dead end
// for the tag filter, so it is never offered ---
eq('unconfirmed set is not suggested',
  await suggest('q=phantom&g=mtg', [
    { title: 'Some Card [Phantom Set]', tags: ['Rare', 'Blue'], description: 'Set: Phantom Set Type: Creature Rarity: Rare' },
  ]),
  []);

// --- what is offered is exactly what /search.json?set= expects ---
const one = await suggest('q=paradox&g=pokemon', [
  { title: 'Charcadet (026/182) [Scarlet & Violet: Paradox Rift]', tags: ['Fire', 'Scarlet & Violet: Paradox Rift'], description: 'Set: Scarlet & Violet: Paradox Rift Type: Fire Rarity: Promo' },
]);
eq('label and filter value are the exact tag', one, [{ n: 'Scarlet & Violet: Paradox Rift', q: 'Scarlet & Violet: Paradox Rift' }]);

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
