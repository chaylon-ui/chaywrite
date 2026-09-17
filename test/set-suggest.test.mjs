import { serveSetSuggest } from '../src/cards.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); }
};

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

let seen = [];
// The endpoint now fires three windows: tag oldest-first, tag newest-first and
// one title pass. `nodes` may be a single list (answered to every window) or
// {tag, tagRev, title} to model each window separately — which is the only way
// to reproduce a set that one window can reach and another cannot.
const suggest = async (qs, nodes) => {
  seen = [];
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const q = body.variables.q, gql = body.query;
    seen.push(q);
    const byTag = q.includes('tag:*');
    const rev = gql.includes('reverse:true');
    const list = Array.isArray(nodes) ? nodes : (byTag ? (rev ? (nodes.tagRev || []) : (nodes.tag || [])) : (nodes.title || []));
    return new Response(JSON.stringify({ data: { products: { edges: list.map((node) => ({ node })) } } }), { headers: { 'content-type': 'application/json' } });
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
eq('three windows, two of them over the tag', seen, [
  'status:active product_type:"Yugioh Single" tag:*savage*',
  'status:active product_type:"Yugioh Single" tag:*savage*',
  'status:active product_type:"Yugioh Single" title:*savage*',
]);

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


// --- THE LIVE FAILURE, 2026-09-17: typing "wilds" returned nothing.
// Card names containing "wilds" ("Escape to the Wilds [Throne of Eldraine]")
// filled the one window that existed, and all of them were discarded for
// belonging to a set that does not contain "wilds" — so the list came back
// empty while Wilds of Eldraine sat there fully tagged. The title window may
// still be nothing but that noise; the tag window is what must answer. ---
eq('card names matching the text cannot starve the set list',
  (await suggest('q=wilds&g=mtg', {
    tag: [{ title: 'Sleight of Hand [Wilds of Eldraine]', tags: ['Blue', 'Wilds of Eldraine'], description: 'Set: Wilds of Eldraine Type: Sorcery Rarity: Common' }],
    tagRev: [],
    title: [
      { title: 'Escape to the Wilds [Throne of Eldraine]', tags: ['Green', 'Throne of Eldraine'], description: 'Set: Throne of Eldraine Type: Sorcery Rarity: Rare' },
      { title: 'Ferocity of the Wilds [Throne of Eldraine]', tags: ['Red', 'Throne of Eldraine'], description: 'Set: Throne of Eldraine Type: Enchantment Rarity: Uncommon' },
    ],
  })).map((x) => x.n),
  ['Wilds of Eldraine']);

// A big set's own cards fill the oldest-first window, so its siblings are only
// reachable from the other end. All four of these are really in the catalogue.
eq('sibling sets come back from the newest-first window',
  (await suggest('q=wilds&g=mtg', {
    tag: [{ title: 'Sleight of Hand [Wilds of Eldraine]', tags: ['Wilds of Eldraine'], description: 'Set: Wilds of Eldraine Type: Sorcery Rarity: Common' }],
    tagRev: [
      { title: 'The Goose Mother [Wilds of Eldraine Promos]', tags: ['Rare', 'Wilds of Eldraine Promos'], description: 'Set: Wilds of Eldraine Promos Type: Creature Rarity: Rare' },
      { title: 'Wicked Role [Wilds of Eldraine Tokens]', tags: ['Common', 'Wilds of Eldraine Tokens'], description: 'Set: Wilds of Eldraine Tokens Type: Token Enchantment Rarity: Common' },
    ],
    title: [],
  })).map((x) => x.n).sort(),
  ['Wilds of Eldraine', 'Wilds of Eldraine Promos', 'Wilds of Eldraine Tokens']);

// A Yu-Gi-Oh set CODE shares no letters with its set name, and lives only in
// the title — that is what the third window is for.
eq('a set code typed straight in still finds its set',
  (await suggest('q=sast&g=yugioh', {
    tag: [], tagRev: [],
    title: [{ title: 'Neo Space Connector [SAST-EN008] Common', tags: ['Common', 'Savage Strike'], description: 'Set: Savage Strike Card type: Effect Monster Rarity: Common' }],
  })).map((x) => x.n),
  ['Savage Strike']);

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
