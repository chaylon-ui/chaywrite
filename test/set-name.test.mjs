import { setNameOf } from '../src/cards.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
};

// Every case below is a real product pulled from the catalogue on 2026-09-17:
// its title, its tags and the opening of its description, verbatim.

// --- MTG: bracket and tag agree ---
eq('mtg plain',
  setNameOf('Charmed Clothier [Wilds of Eldraine]',
    ['Brawl', 'Commander', 'Common', 'Creature', 'White', 'Wilds of Eldraine'],
    'Set: Wilds of Eldraine Type: Creature — Faerie Advisor Rarity: Common Cost: {4}{W} FlyingWhen Charmed Clothier enters the battlefield, create a Roy...'),
  'Wilds of Eldraine');

// A sub-set whose name STARTS with another set's name. Keying on the full
// string is what keeps these two apart in the suggestion list.
eq('mtg sub-set with a colon',
  setNameOf('Utopia Sprawl [Wilds of Eldraine: Enchanting Tales]',
    ['Aura', 'Enchantment', 'Green', 'Uncommon', 'Wilds of Eldraine: Enchanting Tales'],
    'Set: Wilds of Eldraine: Enchanting Tales Type: Enchantment — Aura Rarity: Uncommon Cost: {G} Enchant ForestAs Utopia Sprawl enters the battlefield,...'),
  'Wilds of Eldraine: Enchanting Tales');

// --- Pokemon: set names carrying their own colon, which the non-greedy
// match must not truncate at ---
eq('pokemon colon in the set name',
  setNameOf('Charcadet (026/182) (Cosmos Holo) [Scarlet & Violet: Paradox Rift]',
    ['026', 'Fire', 'Holofoil', 'Promo', 'Scarlet & Violet: Paradox Rift', 'Water [x2]'],
    'Set: Scarlet & Violet: Paradox Rift Type: Fire Rarity: Promo Retreat cost: Colorless,Colorless'),
  'Scarlet & Violet: Paradox Rift');
eq('pokemon long promo set',
  setNameOf('Entei (34) [Wizards of the Coast: Black Star Promos]',
    ['34', 'Black Star Promo', 'Fire', 'Reverse Holofoil', 'Wizards of the Coast: Black Star Promos'],
    'Set: Wizards of the Coast: Black Star Promos Type: Fire Rarity: Black Star Promo Retreat cost: Colorless'),
  'Wizards of the Coast: Black Star Promos');

// --- Yu-Gi-Oh: the bracket is a CARD CODE, so only the tag knows the set.
// This is the case the old title-bracket scrape could never get right. ---
eq('yugioh code bracket',
  setNameOf('Advanced Ritual Art [STON-EN045] Common',
    ['1st Edition', 'Common', 'Ritual Spell', 'Spell', 'Strike of Neos', 'Unlimited'],
    'Set: Strike of Neos Card type: Ritual Spell Rarity: Common Select 1 Ritual monster in your hand. Send Normal Monsters from your Deck to the Graveya...'),
  'Strike of Neos');
eq('yugioh set name containing a colon',
  setNameOf('Graceful Charity [SDP-040] Super Rare',
    ['1st Edition', 'Normal Spell', 'Spell', 'Starter Deck: Pegasus', 'Super Rare', 'Unlimited'],
    'Set: Starter Deck: Pegasus Card type: Normal Spell Rarity: Super Rare Draw 3 cards from your Deck, then discard any 2 cards from your hand.'),
  'Starter Deck: Pegasus');

// --- One Piece: says "Set Name:" and follows with "Card Number:" ---
eq('one piece set name label',
  setNameOf('Captain McKinley [Awakening of the New Era]',
    ['Awakening of the New Era', 'Character', 'Common', 'Sky Island'],
    'Set Name: Awakening of the New Era Card Number: OP05-112 Release Date: 2023-12-08 Rarity: Common Card Type: Character Cost: 3 Power: 3000 [Blocker]...'),
  'Awakening of the New Era');
eq('one piece straight to release date',
  setNameOf('DON!! Card [Ultra Deck - The Three Captains]',
    ['DON!!', 'Starter Decks', 'Ultra Deck - The Three Captains'],
    'Set Name: Ultra Deck - The Three Captains Release Date: TBA Rarity: DON!! Card Type: DON!! Your Turn +1000'),
  'Ultra Deck - The Three Captains');

// --- the tag's casing wins, because that is what the tag filter must send ---
eq('tag casing is authoritative',
  setNameOf('Some Card [wilds of eldraine]',
    ['Wilds of Eldraine'],
    'Set: wilds of eldraine Type: Creature Rarity: Common'),
  'Wilds of Eldraine');

// --- fallbacks ---
eq('no description falls back to a matching tag',
  setNameOf('Some Card [Jungle Unlimited]', ['Holofoil', 'Jungle Unlimited'], ''),
  'Jungle Unlimited');
eq('nothing to go on', setNameOf('Loose Card', [], ''), '');
eq('bracket with no matching tag is not trusted', setNameOf('Sleeve Pack [100ct]', ['Dragon Shield'], ''), '');
eq('tolerates null tags', setNameOf('Card [Set X]', null, 'Set: Set X Type: Creature Rarity: Common'), 'Set X');

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
