import { serveSearch } from '../src/cards.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); }
};

// A product in the adminSearch GraphQL shape, with the real description
// preamble each game writes, since that is what the set is read from.
const node = (title, set, tags) => ({ node: {
  title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  productType: 'MTG Single', vendor: 'Magic: The Gathering',
  tags: tags || [set], description: `Set: ${set} Type: Creature Rarity: Common Cost: {1}{W}`,
  featuredImage: { url: 'https://cdn.example/x.png' },
  variants: { edges: [{ node: { id: 'gid://shopify/ProductVariant/1', title: 'Near Mint', sku: 'WOE-6-EN-NF-1', price: '0.25', availableForSale: true, inventoryQuantity: 35, inventoryPolicy: 'DENY' } }] },
} });

// Shopify's tag:"X" is a phrase-CONTAINS match, so the stub answers a set
// filter the way the live API does: the picked set AND its colon sub-set.
const CATALOGUE = [
  node('Charmed Clothier [Wilds of Eldraine]', 'Wilds of Eldraine'),
  node('Eriette of the Charmed Apple [Wilds of Eldraine]', 'Wilds of Eldraine'),
  node('Utopia Sprawl [Wilds of Eldraine: Enchanting Tales]', 'Wilds of Eldraine: Enchanting Tales'),
];

let seen = [];
const runSearch = async (params, edges = CATALOGUE) => {
  seen = [];
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    seen.push(body.variables.q);
    return new Response(JSON.stringify({ data: { products: { pageInfo: { hasNextPage: false }, edges } } }), { headers: { 'content-type': 'application/json' } });
  };
  const r = await serveSearch(new Request('https://w.dev/search.json?' + params), { SHOPIFY_ADMIN_TOKEN: 't', SHOPIFY_SHOP: 's.myshopify.com' });
  return await r.json();
};

// --- the query string handed to Shopify ---
let d = await runSearch('q=charmed&set=Wilds%20of%20Eldraine&g=mtg');
eq('set + name compose into two terms', seen[0],
   'status:active product_type:"MTG Single" tag:"Wilds of Eldraine" title:*charmed*');
// The bug that started this: the name used to be appended to the set, giving
// "[Wilds of Eldraine]charmed", which no product title can contain.
eq('the set never lands in the title term', seen[0].includes('[') || seen[0].includes(']'), false);

d = await runSearch('set=Wilds%20of%20Eldraine&g=mtg');
eq('set alone needs no title term', seen[0], 'status:active product_type:"MTG Single" tag:"Wilds of Eldraine"');

d = await runSearch('q=charizard&g=pokemon');
eq('a plain name search is unchanged', seen[0], 'status:active product_type:"Pokemon Single" title:*charizard*');

d = await runSearch('set=DUPO&g=yugioh');
eq('a bare set code scopes by SKU prefix, not by tag', seen[0], 'status:active product_type:"Yugioh Single" sku:DUPO*');

// --- the exact-set post-filter ---
d = await runSearch('set=Wilds%20of%20Eldraine&g=mtg');
eq('the colon sub-set is not folded into the parent set',
   d.cards.map((c) => c.name).sort(), ['Charmed Clothier', 'Eriette of the Charmed Apple']);
d = await runSearch('set=Wilds%20of%20Eldraine%3A%20Enchanting%20Tales&g=mtg');
eq('the sub-set is reachable on its own', d.cards.map((c) => c.name), ['Utopia Sprawl']);
eq('the set is echoed back', d.set, 'Wilds of Eldraine: Enchanting Tales');

// --- guards ---
d = await runSearch('q=a&g=mtg');
eq('one letter and no set is still not a search', d.count, 0);
eq('one letter never reaches Shopify', seen.length, 0);

// A set whose name merely CONTAINS the query must not come back: this is the
// live failure, where tag:"of Eldraine" returns Throne of Eldraine.
d = await runSearch('set=of%20Eldraine&g=mtg');
eq('a partial set name matches nothing', d.count, 0);

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
