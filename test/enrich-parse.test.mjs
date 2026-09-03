import { parseBookTitle, isbnOf, titleCase, parseBggSearch, parseBggThing, normTitle, chooseBggMatch, bookMetafields,
         cleanSeries, seriesKey, normalisePublisher, isLatin, readAniListMedia, readOpenLibrary, ENRICH_VERSION } from '../src/enrich.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log('FAIL ' + name + '\n  got  ' + g + '\n  want ' + w); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else { fail++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
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
const mf = bookMetafields('gid://shopify/Product/1', 'Attack on Titan 24', '9781632365354', '2026-09-03',
  { author: 'Hajime Isayama', publisher: 'VIZ Media LLC' },
  { demographic: 'Shonen', status: 'Completed', volumes: 34, author: 'Hajime Isayama' });
eq('book metafields', mf.map(m => m.key + '=' + m.value), [
  'series=Attack on Titan', 'series_key=attackontitan', 'volume=24', 'book_format=Single volume',
  'isbn=9781632365354', 'author=Hajime Isayama', 'publisher=VIZ Media', 'demographic=Shonen',
  'series_status=Completed', 'volumes_total=34', 'enrich_status=ok', 'enriched_at=2026-09-03',
  'enrich_version=' + ENRICH_VERSION]);
eq('all namespaced exor', [...new Set(mf.map(m => m.namespace))], ['exor']);

// A field with no value is never written, so no product carries an empty facet.
const bare = bookMetafields('gid://p/9', 'Some Book 2', '', '2026-09-03', null, null);
eq('no empty facets', bare.map(m => m.key),
   ['series', 'series_key', 'volume', 'book_format', 'enrich_status', 'enriched_at', 'enrich_version']);

// --- series cleaning: measured as the difference between 0% and 35% on AniList
eq('Gn stripped', cleanSeries('Akame Ga Kill Gn'), 'Akame Ga Kill');
eq('Sc + Novel kept as words are not format codes', cleanSeries('Accomplishments of Dukes Daughter Novel Sc'), 'Accomplishments of Dukes Daughter Novel');
eq('nothing to strip', cleanSeries('Attack on Titan'), 'Attack on Titan');
eq('trailing separator trimmed', cleanSeries('Ancient Magus Bride -'), 'Ancient Magus Bride');

// --- series_key: the whole point is collapsing one series entered two ways
eq('hyphen and no hyphen collapse', seriesKey('Amazing Spider-man Beyond'), seriesKey('Amazing Spiderman Beyond'));
eq('apostrophe ignored', seriesKey("Ancient Magus' Bride"), seriesKey('Ancient Magus Bride'));
eq('ampersand spelled out', seriesKey('Assassin & Cinderella'), 'assassinandcinderella');
eq('format code ignored in the key', seriesKey('Akame Ga Kill Gn'), 'akamegakill');

// --- publisher normalisation: Open Library returns the same house many ways
eq('viz variants', [normalisePublisher('Viz Media'), normalisePublisher('VIZ Media LLC')], ['VIZ Media', 'VIZ Media']);
eq('kodansha america', normalisePublisher('Kodansha America, Incorporated'), 'Kodansha');
eq('seven seas', normalisePublisher('Seven Seas Entertainment, LLC'), 'Seven Seas');
eq('unknown house tidied not dropped', normalisePublisher('Some Small Press, LLC'), 'Some Small Press');
eq('empty stays empty', normalisePublisher(''), '');

// --- author script: Open Library sometimes answers in Japanese
ok('latin detected', isLatin('Hajime Isayama'));
ok('japanese detected as non-latin', !isLatin('\u677e\u4e95 \u512a\u5f81'));
const jp = bookMetafields('gid://p/2', 'Assassination Classroom 1', '', '2026-09-03',
  { author: '\u677e\u4e95 \u512a\u5f81', publisher: 'VIZ Media LLC' }, { author: 'Yusei Matsui' });
eq('latin author preferred', (jp.find(m => m.key === 'author') || {}).value, 'Yusei Matsui');

// --- reading the two feeds
eq('anilist media read', readAniListMedia({ volumes: 34, status: 'RELEASING', tags: [{ name: 'Action' }, { name: 'Shounen' }],
    staff: { edges: [{ node: { name: { full: 'Hajime Isayama' } } }] } }),
   { demographic: 'Shonen', status: 'Ongoing', volumes: 34, author: 'Hajime Isayama' });
eq('anilist null', readAniListMedia(null), null);
eq('anilist unknown demographic left blank', readAniListMedia({ tags: [{ name: 'Action' }], status: 'FINISHED' }).demographic, '');
eq('open library read', readOpenLibrary({ authors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], publishers: [{ name: 'P' }, { name: 'Q' }] }),
   { author: 'A, B', publisher: 'P' });
eq('open library missing', readOpenLibrary(null), null);

console.log((fail ? 'ENRICH-FAILS ' + fail : 'ENRICH OK') + ' :: ' + pass + '/' + (pass + fail) + ' checks passed');
