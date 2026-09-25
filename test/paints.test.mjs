// Paint colour picker data (src/paints.js): title parsing per brand, chart lookup, grouping.
import { readFileSync } from 'node:fs';
import { parseTitle, findColour, buildSwatches } from '../src/paints.js';
let fails = 0, n = 0;
const eq = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) { fails++; console.log('FAIL ' + name + ' :: got ' + g + ' want ' + w); } };
const chart = {
  Vallejo: { 'Game Color': { warlordpurple: ['72.014', '862351', 'Warlord Purple'], scarletblood: ['72.106', 'B11E1E', 'Scarlet Blood'] }, 'Game Air': { warlordpurple: ['76.014', '841E4D', 'Warlord Purple'] } },
  Citadel: { Layer: { kabalitegreen: ['', '008962', 'Kabalite Green'] }, Base: { abaddonblack: ['', '000000', 'Abaddon Black'] }, Air: { abaddonblack: ['', '000000', 'Abaddon Black'] }, Contrast: { badmoonyellow: ['', 'E0B000', 'Bad Moon Yellow'] }, Technical: { ardcoat: ['', 'F9F9F9', "'Ardcoat"] } },
  'The Army Painter': { Warpaints: { troglodyteblue: ['WP1458', '2588B9', 'Troglodyte Blue'] }, 'Warpaints Air': { oakbrown: ['AW1123', '5A3A1F', 'Oak Brown'] }, 'Warpaints Fanatic': { marsred: ['WP3000', 'B03020', 'Mars Red'] } },
};
eq('vallejo', parseTitle('Vallejo', 'VALLEJO: GAME COLOR WARLORD PURPLE 17 ML'), { range: 'Game Color', name: 'WARLORD PURPLE' });
eq('citadel layer', parseTitle('Citadel', 'LAYER: KABALITE GREEN'), { range: 'Layer', name: 'KABALITE GREEN' });
eq('citadel contrast with size', parseTitle('Citadel', 'CONTRAST: BAD MOON YELLOW (18ML)'), { range: 'Contrast', name: 'BAD MOON YELLOW' });
eq('citadel prefixed', parseTitle('Citadel', 'CITADEL BASE: ABADDON BLACK'), { range: 'Base', name: 'ABADDON BLACK' });
eq('citadel brush is not a paint title', parseTitle('Citadel', 'CITADEL STC BRUSH: M LAYER'), null);
eq('ap warpaints', parseTitle('The Army Painter', 'THE ARMY PAINTER WARPAINTS: TROGLODYTE BLUE'), { range: 'Warpaints', name: 'TROGLODYTE BLUE' });
eq('ap short', parseTitle('The Army Painter', 'WARPAINTS: BRAINMATTER BEIGE'), { range: 'Warpaints', name: 'BRAINMATTER BEIGE' });
eq('ap air', parseTitle('The Army Painter', 'THE ARMY PAINTER WARPAINTS: ACRYLIC AIR OAK BROWN'), { range: 'Warpaints Air', name: 'OAK BROWN' });
eq('ap air found', findColour(chart, 'The Army Painter', 'Warpaints Air', 'OAK BROWN'), { code: 'AW1123', hex: '5A3A1F', name: 'Oak Brown' });
eq('ap falls back to another range', findColour(chart, 'The Army Painter', 'Warpaints', 'MARS RED').hex, 'B03020');
eq('scarlett spelling', findColour(chart, 'Vallejo', 'Game Color', 'SCARLETT BLOOD').code, '72.106');
eq("apostrophe name", findColour(chart, 'Citadel', 'Technical', "'ARDCOAT").hex, 'F9F9F9');
const P = (title, handle, avail = true, extra = {}) => ({ title, handle, status: 'ACTIVE', onlineStoreUrl: 'x', featuredImage: { url: 'https://cdn/x.jpg' }, variants: { nodes: [{ legacyResourceId: '11', price: '4.95', availableForSale: avail }] }, ...extra });
const res = buildSwatches(chart, [
  { brand: 'Citadel', products: [P('BASE: ABADDON BLACK', 'ab'), P('AIR: ABADDON BLACK', 'ab-air', false), P('LAYER: KABALITE GREEN', 'kg'), P('CITADEL STC BRUSH: M LAYER', 'br'), P('LAYER: NOT ON CHART', 'nc'), P('LAYER: DRAFT ONE', 'd', true, { status: 'DRAFT' })] },
  { brand: 'Vallejo', products: [P('VALLEJO: GAME COLOR WARLORD PURPLE 17 ML', 'wp'), P('VALLEJO: GAME AIR WARLORD PURPLE', 'wpa'), P('VALLEJO: GAME COLOR STARTER SET', 'set')] },
]);
const sw = (b, name) => res.swatches.find((s) => s.b === b && s.n === name);
eq('same colour in two ranges is one swatch', sw('Citadel', 'Abaddon Black').items.map((i) => i.r + ':' + i.a), ['Base:true', 'Air:false']);
eq('vallejo two bottles one swatch, each with its own code', sw('Vallejo', 'Warlord Purple').items.map((i) => i.c), ['72.014', '76.014']);
eq('unknown colour keeps a photo swatch', [sw('Citadel', 'Not On Chart').h, sw('Citadel', 'Not On Chart').items[0].i], [null, 'https://cdn/x.jpg']);
eq('sets, brushes and drafts left out', [!!sw('Vallejo', 'Starter Set'), res.counts.Citadel.products, res.counts.Citadel.skipped], [false, 5, 1]);
eq('variant id numeric, size parsed', [sw('Vallejo', 'Warlord Purple').items[0].v, sw('Vallejo', 'Warlord Purple').items[0].s], [11, '17 ml']);
// live titles that used to fall back to a photo (2026-09-25 /paints.json)
eq('citadel repeated range + 6-pack tail', [parseTitle('Citadel', 'LAYER: LAYER:SKULLCRUSHER BRASS (12ML)'), parseTitle('Citadel', 'TECHNICAL: TESSERACT GLOW (18ML) 6-PA'), parseTitle('Citadel', 'SHADE: REIKLAND FLESHSHADE (18ML) (6 P')],
  [{ range: 'Layer', name: 'SKULLCRUSHER BRASS' }, { range: 'Technical', name: 'TESSERACT GLOW' }, { range: 'Shade', name: 'REIKLAND FLESHSHADE' }]);
eq("apostrophe-s dropped", parseTitle('Citadel', "BASE: BUGMAN'S GLOW").name, 'BUGMAN GLOW');
eq('vallejo primers are Surface Primer', [parseTitle('Vallejo', 'VALLEJO: GAME AIR PRIMER BLACK 17ML'), parseTitle('Vallejo', 'VALLEJO: GAME COLOR WHITE PRIMER 17 ML')],
  [{ range: 'Surface Primer', name: 'BLACK' }, { range: 'Surface Primer', name: 'WHITE' }]);
eq('vallejo "GAME AIR - X"', parseTitle('Vallejo', 'VALLEJO: GAME AIR - SCAR RED 17 ML'), { range: 'Game Air', name: 'SCAR RED' });
eq('army painter marker + colour primer spray', [parseTitle('The Army Painter', 'THE ARMY PAINTER SPEEDPAINT MARKER ABSOLUTION GREEN'), parseTitle('The Army Painter', 'THE ARMY PAINTER COLOUR PRIMER: WOLF GREY SPRAY')],
  [{ range: 'Speedpaint Marker', name: 'ABSOLUTION GREEN' }, { range: 'Warpaints Primer', name: 'WOLF GREY' }]);
// GW's 2026 "Warhammer Colour" labels and unprefixed six-packs (not in the Citadel collection)
eq('warhammer colour with range', parseTitle('Citadel', 'WARHAMMER COLOUR LAYER EVIL SUNZ SCARLET 12ML'), { range: 'Layer', name: 'EVIL SUNZ SCARLET' });
eq('warhammer colour without range is loose', [parseTitle('Citadel', 'WARHAMMER COLOUR ABADDON BLACK 12ML'), parseTitle('Citadel', 'MEPHISTON RED 12ML (6-PACK)'), parseTitle('Citadel', 'CITADEL MEPHISTON RED SPRAY')],
  [{ range: null, name: 'ABADDON BLACK', loose: true }, { range: null, name: 'MEPHISTON RED', loose: true }, { range: 'Spray', name: 'MEPHISTON RED', loose: true }]);
const res2 = buildSwatches(chart, [{ brand: 'Citadel', products: [P('WARHAMMER COLOUR ABADDON BLACK 12ML', 'wc-ab'), P('WARHAMMER COLOUR KABALITE GREEN 12ML', 'wc-kg'), P('WARHAMMER COLOUR PAINTING HANDLE', 'wc-h'), P('WARHAMMER COLOUR TOOL SET', 'wc-t')] }]);
eq('loose labels take the range the chart gives (Base before Air); unknown loose names are left out',
  res2.swatches.map((s) => s.n + ':' + s.items.map((i) => i.r).join()), ['Abaddon Black:Base', 'Kabalite Green:Layer']);
// the real chart: a few of our real titles resolve
// (PAINT_CHART=path/to/data/paint-colours.json from chaywrite main; skipped when unset)
const real = process.env.PAINT_CHART ? JSON.parse(readFileSync(process.env.PAINT_CHART, 'utf8')).brands : null;
if (real) for (const [b, t, want] of [['Citadel', 'LAYER: KABALITE GREEN', '008962'], ['Citadel', 'LAYER: TEMPLE GUARD BLUE', null], ['The Army Painter', 'THE ARMY PAINTER WARPAINTS: TROGLODYTE BLUE', '2588B9'], ['Vallejo', 'VALLEJO: GAME COLOR WARLORD PURPLE 17 ML', '862351'],
  ['Citadel', "BASE: BUGMAN'S GLOW", '804C43'], ['Citadel', 'LAYER: LAYER:SKULLCRUSHER BRASS (12ML)', 'F4CB7A'], ['Vallejo', 'VALLEJO: GAME COLOR FLUO GREEN 17 ML', '74B72C'],
  ['Vallejo', 'VALLEJO: GAME COLOR EXTRA OPAQUE HEAVY VIOLET 17 ML', '484069'], ['Vallejo', 'VALLEJO: GAME COLOR HEAVY BLUEGRAY 17ML', 'CBCAC8'],
  ['The Army Painter', 'THE ARMY PAINTER SPEEDPAINT MARKER ABSOLUTION GREEN', '22311F'], ['The Army Painter', 'THE ARMY PAINTER COLOUR PRIMER: WOLF GREY SPRAY', '517383']]) {
  const p = parseTitle(b, t), c = findColour(real, b, p.range, p.name);
  eq('real chart: ' + t, want ? c && c.hex : !!c, want || true);
}
console.log((fails ? 'PAINTS-FAILS ' + fails : 'PAINTS OK') + ' :: ' + (n - fails) + '/' + n + ' checks passed');
if (fails) process.exit(1);
