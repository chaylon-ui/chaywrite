import { parseBookTitle, isbnOf, titleCase, parseBggSearch, parseBggThing, normTitle, chooseBggMatch, bookMetafields } from '../src/enrich.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); }
};

// --- real titles pulled from the catalogue today ---
eq('mixed-case + bare vol', parseBookTitle('Attack on Titan 24'), { series: 'Attack on Titan', volume: 24, format: 'Single volume' });
eq('ALLCAPS VOL.', parseBookTitle('HAIKYU!! VOL. 36'), { series: 'Haikyu!!', volume: 36, format: 'Single volume' });
eq('omnibus', parseBookTitle('BLUE LOCK OMNIBUS 4'), { series: 'Blue Lock', volume: 4, format: 'Omnibus' });
eq('deluxe hardcover, no vol', parseBookTitle('ZELDA ENCYCLOPEDIA DELUXE EDITION HARDCOVER'), { series: 'Zelda Encyclopedia', volume: null, format: 'Deluxe' });
eq('colon title kept whole', parseBookTitle('Afterlife with Archie: Escape from Riverdale'), { series: 'Afterlife with Archie: Escape from Riverdale', volume: null, format: '' });
// --- guards ---
// A year must not become a volume. It stays part of the series name, which
// is correct - it is part of the book's title, not an issue number.
eq('year is not a volume', parseBookTitle('SOME ARTBOOK 2024'), { series: 'Some Artbook 2024', volume: null, format: '' });
eq('explicit marker beats the cap', parseBookTitle('GOLGO 13 VOL. 250'), { series: 'Golgo 13', volume: 250, format: 'Single volume' });
eq('box set', parseBookTitle('DEMON SLAYER COMPLETE BOX SET'), { series: 'Demon Slayer Complete', volume: null, format: 'Box set' });
eq('small words stay low', parseBookTitle('THE RISE OF THE SHIELD HERO 12'), { series: 'The Rise of the Shield Hero', volume: 12, format: 'Single volume' });
eq('empty', parseBookTitle(''), { series: '', volume: null, format: '' });
eq('trailing punctuation trimmed', parseBookTitle('ONE PIECE, VOL. 3'), { series: 'One Piece', volume: 3, format: 'Single volume' });

// --- ISBN vs UPC ---
eq('isbn13 kept', isbnOf('9781632365354'), '9781632365354');
eq('upc rejected', isbnOf('729220071347'), '');
eq('junk rejected', isbnOf(''), '');

// --- BGG search XML ---
const SEARCH = `<?xml version="1.0" encoding="utf-8"?><items total="2">
<item type="boardgame" id="266192"><name type="primary" value="Wingspan"/><yearpublished value="2019" /></item>
<item type="boardgameexpansion" id="290448"><name type="primary" value="Wingspan: European Expansion"/><yearpublished value="2019" /></item>
<item type="boardgame" id="999" ><name type="alternate" value="Alt"/><name type="primary" value="Point Salad"/><yearpublished value="2019"/></item>
</items>`;
eq('search parses boardgames only', parseBggSearch(SEARCH), [
  { id: 266192, name: 'Wingspan', year: 2019 },
  { id: 999, name: 'Point Salad', year: 2019 },
]);

// --- BGG thing XML ---
const THING = `<items><item type="boardgame" id="266192">
<name type="primary" sortindex="1" value="Wingspan"/>
<minplayers value="1"/><maxplayers value="5"/>
<playingtime value="70"/><minplaytime value="40"/><maxplaytime value="70"/><minage value="10"/>
<link type="boardgamemechanic" id="2001" value="Card Drafting"/>
<link type="boardgamemechanic" id="2004" value="Engine Building"/>
<link type="boardgamedesigner" id="1234" value="Elizabeth Hargrave"/>
<link type="boardgamecategory" id="1089" value="Animals"/>
<statistics><ratings><averageweight value="2.4429"/></ratings></statistics>
</item></items>`;
eq('thing parses', parseBggThing(THING), {
  playersMin: 1, playersMax: 5, playtimeMin: 40, playtimeMax: 70, ageMin: 10,
  weight: 2.44, mechanics: ['Card Drafting', 'Engine Building'], designer: 'Elizabeth Hargrave',
});
eq('playingtime fills missing min/max', parseBggThing('<item><playingtime value="30"/></item>').playtimeMin, 30);

// --- matching ---
eq('noise stripped both sides', normTitle('WINGSPAN BOARD GAME'), normTitle('Wingspan'));
eq('one exact match accepted', chooseBggMatch([{ id: 1, name: 'Calico', year: 2020 }, { id: 2, name: 'Calico: Cats', year: 2021 }], 'CALICO'),
   { status: 'ok', id: 1, name: 'Calico' });
eq('two exact -> ambiguous, nothing written', chooseBggMatch([{ id: 9, name: 'Smash Up', year: 2018 }, { id: 4, name: 'Smash Up', year: 2012 }], 'SMASH UP'),
   { status: 'ambiguous', candidates: [4, 9] });
eq('no exact -> notfound', chooseBggMatch([{ id: 3, name: 'Verdant Realms', year: 2020 }], 'VERDANT'),
   { status: 'notfound', candidates: [3] });
eq('empty search -> notfound', chooseBggMatch([], 'VERDANT'), { status: 'notfound', candidates: [] });

// --- metafield payloads ---
const mf = bookMetafields('gid://shopify/Product/1', 'Attack on Titan 24', '9781632365354', '2026-09-03');
eq('book metafields', mf.map(m => m.key + '=' + m.value),
   ['series=Attack on Titan', 'volume=24', 'book_format=Single volume', 'isbn=9781632365354', 'enrich_status=ok', 'enriched_at=2026-09-03']);
eq('all namespaced exor', [...new Set(mf.map(m => m.namespace))], ['exor']);

console.log((fail ? 'ENRICH-FAILS ' + fail : 'ENRICH OK') + ' :: ' + pass + '/' + (pass + fail) + ' checks passed');
