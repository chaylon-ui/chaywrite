/* Figure filters (owner, 2026-09-30: "is there more information we can grab for
   figures? like descriptions etc and also make a filtering system for them?").

   Every active Figures / Blind Box / Funko product gets two of our own tags:
     fig:<franchise>   the series it is from (One Piece, Dragon Ball, Hatsune Miku ...)
     figline:<line>    the product line (Nendoroid, Pop Up Parade, S.H.Figuarts, Funko Pop! ...)
   The franchise comes from PLAMOD's series fact (exor.pl_series, written by the plamod
   phase) folded through FRANCHISES so "ONE PIECE", "One Piece" and "Dragon Ball Z" /
   "Dragon Ball Super" land on one label, else from the title (Bandai titles end in the
   series in quotes; Funko titles carry it after the line). The line comes from PLAMOD's
   brand fact (exor.pl_brand) or the title through LINES. A product with no match gets
   no tag of that kind. Smart collections (figures-<handleized label>, rule: tag EQUALS
   fig:<label>; figure-line-<handle> for figline:) are what the theme's "Shop by series"
   and "Shop by line" chip rows link to (snippets/breadcrumb.liquid - the labels there
   must match FRANCHISES / LINES). Only fig:/figline: tags are ever added or removed.
   Written by the enrich "figtype" phase, after bgtype. */

import { handleize, tagMutation, tagErrors, TAG_BATCH } from "./bgtype.js";
export { handleize, tagMutation, tagErrors, TAG_BATCH };

export const FIG_PREFIX = "fig:";
export const LINE_PREFIX = "figline:";
export const FIG_QUERY = "status:active AND (product_type:Figures OR product_type:'Blind Box' OR product_type:Funko)";
export const FIG_PAGE = `query($q:String!,$after:String){products(first:100,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title vendor productType tags series: metafield(namespace:"exor", key:"pl_series"){value} brand: metafield(namespace:"exor", key:"pl_brand"){value} maker: metafield(namespace:"exor", key:"pl_maker"){value}}}}`;

/* [label, regex] - most specific first; matched against the series fact, then the title. */
export const FRANCHISES = [
  ["One Piece", /\bone\s*piece\b/i],
  ["Dragon Ball", /\bdragon\s*ball\b|\bdbz\b|\bdbs\b/i],
  ["Demon Slayer", /demon slayer|kimetsu/i],
  ["Naruto", /\bnaruto\b|\bboruto\b/i],
  ["Jujutsu Kaisen", /jujutsu|\bjjk\b/i],
  ["My Hero Academia", /hero academia|boku no hero|\bmha\b/i],
  ["Chainsaw Man", /chainsaw/i],
  ["Spy x Family", /spy\s*[x×]\s*family/i],
  ["Hatsune Miku", /hatsune|\bmiku\b|vocaloid|piapro/i],
  ["Pokemon", /pok[eé]mon/i],   // no accent: the label is the collection handle and the tag
  ["Sailor Moon", /sailor moon/i],
  ["Frieren", /frieren/i],
  ["Attack on Titan", /attack on titan|shingeki/i],
  ["Bleach", /\bbleach\b/i],
  ["Hunter x Hunter", /hunter\s*[x×]\s*hunter/i],
  ["JoJo's Bizarre Adventure", /jojo/i],
  ["Evangelion", /evangelion/i],
  ["Gundam", /gundam|mobile suit|zaku/i],
  ["Star Wars", /star wars|mandalorian|darth|jedi|sith/i],
  ["Marvel", /\bmarvel\b|spider-?man|avengers|x-men|deadpool|iron man|\bvenom\b|wolverine|\bhulk\b|\bthor\b|captain america|black panther/i],
  ["DC Comics", /\bdc\b|batman|superman|\bjoker\b|harley quinn|wonder woman|\bflash\b|aquaman|catwoman/i],
  ["Warhammer 40K", /warhammer|40,?000|\b40k\b|adepta|space marine|ultramarine|blood angel|dark angel|orks?\b|necron|tyranid|astartes|adeptus|imperial|chaos|death guard/i],
  ["Digimon", /digimon/i],
  ["Yu-Gi-Oh!", /yu-?gi-?oh/i],
  ["Kirby", /\bkirby\b/i],
  ["The Legend of Zelda", /zelda|\blink\b.*hyrule|hyrule/i],
  ["Super Mario", /\bmario\b|\bluigi\b|\byoshi\b|\bbowser\b|\bkoopa\b/i],
  ["Sonic the Hedgehog", /\bsonic\b|\btails\b|knuckles|\bshadow the hedgehog\b/i],
  ["Mega Man", /mega\s*man|rockman/i],
  ["Street Fighter", /street fighter|\bchun-?li\b|\bryu\b/i],
  ["Final Fantasy", /final fantasy|\bff(vii|7|xvi|16|xiv|14|x|10)\b|cloud strife|sephiroth/i],
  ["Persona", /\bpersona\s*[345]?\b/i],
  ["Kingdom Hearts", /kingdom hearts/i],
  ["Re:Zero", /re:?\s*zero/i],
  ["Overlord", /\boverlord\b/i],
  ["Berserk", /\bberserk\b/i],
  ["Transformers", /transformers|optimus|megatron|bumblebee/i],
  ["Kamen Rider", /kamen rider|masked rider/i],
  ["Ultraman", /ultraman/i],
  ["Godzilla", /godzilla|\bkaiju\b|\bkong\b/i],
  ["Bocchi the Rock!", /bocchi/i],
  ["Oshi no Ko", /oshi no ko/i],
  ["Dandadan", /dandadan/i],
  ["Haikyu!!", /haikyu/i],
  ["Sword Art Online", /sword art online|\bsao\b/i],
  ["Fate", /\bfate\/|\bfate:|fate grand order|\bfgo\b/i],
  ["Hololive", /hololive/i],
  ["Genshin Impact", /genshin/i],
  ["Honkai", /honkai/i],
  ["Blue Archive", /blue archive/i],
  ["Sanrio", /sanrio|hello kitty|kuromi|cinnamoroll|my melody|pompompurin/i],
  ["Disney", /\bdisney\b|mickey|\bstitch\b|\bpixar\b|toy story|frozen\b/i],
  ["Harry Potter", /harry potter|hogwarts|wizarding/i],
  ["The Lord of the Rings", /lord of the rings|\blotr\b|hobbit/i],
  ["Stranger Things", /stranger things/i],
  ["Five Nights at Freddy's", /five nights|\bfnaf\b/i],
  ["Minecraft", /minecraft/i],
  ["Fortnite", /fortnite/i],
  ["Teenage Mutant Ninja Turtles", /ninja turtles|\btmnt\b/i],
  ["Power Rangers", /power rangers/i],
  ["Macross", /macross|robotech/i],
  ["Gremlins", /gremlins/i],
  ["My Little Pony", /my little pony/i],
  ["Cardcaptor Sakura", /cardcaptor/i],
  ["Fullmetal Alchemist", /fullmetal/i],
  ["Death Note", /death note/i],
  ["Tokyo Ghoul", /tokyo ghoul/i],
  ["Black Clover", /black clover/i],
  ["Fairy Tail", /fairy tail/i],
  ["Cowboy Bebop", /cowboy bebop/i],
  ["Trigun", /\btrigun\b/i],
  ["Vinland Saga", /vinland/i],
  ["Solo Leveling", /solo leveling/i],
  ["Blue Lock", /blue lock/i],
  ["Kaiju No. 8", /kaiju no\.? ?8/i],
  ["Tokyo Revengers", /tokyo revengers/i],
  ["Mob Psycho 100", /mob psycho/i],
  ["One Punch Man", /one[- ]punch/i],
  ["Zom 100", /zom ?100/i],
  ["Hell's Paradise", /hell'?s paradise|jigokuraku/i],
  ["Undead Unluck", /undead unluck/i],
  ["Mashle", /\bmashle\b/i],
  ["Nier", /\bnier\b|automata|2b\b/i],
  ["Resident Evil", /resident evil|biohazard/i],
  ["Monster Hunter", /monster hunter/i],
  ["Devil May Cry", /devil may cry/i],
  ["Overwatch", /overwatch/i],
  ["League of Legends", /league of legends|arcane/i],
  ["Cyberpunk", /cyberpunk/i],
  ["The Witcher", /witcher/i],
  ["Elden Ring", /elden ring|dark souls|bloodborne/i],
  ["Halo", /\bhalo\b/i],
  ["Metroid", /metroid|samus/i],
  ["Splatoon", /splatoon/i],
  ["Animal Crossing", /animal crossing/i],
  ["Studio Ghibli", /ghibli|totoro|kiki'?s|spirited away|howl'?s|princess mononoke|ponyo/i],
  ["Nintendo", /\bnintendo\b/i],
];

/* [label, regex] product lines - matched against the brand fact, then the title. */
export const LINES = [
  ["Nendoroid", /nendoroid/i],
  ["Pop Up Parade", /pop ?up ?parade/i],
  ["figma", /\bfigma\b/i],
  ["S.H.Figuarts", /s\.?\s?h\.?\s?figuarts/i],
  ["FiguartsZERO", /figuarts\s?zero/i],
  ["Ichibansho", /ichiban/i],
  ["Banpresto", /banpresto|masterlise|grandista|q ?posket|dxf\b|\bglitter\s*&\s*glamours|chosenshiretsuden|world figure colosseum|\bwfc\b|solid edge|ex ?chronicles|the movie figure|senkozekkei/i],
  ["SEGA Prize", /\bsega\b|luminasta|\bspm\b|super premium|figurizm|\bfigurizm/i],
  ["FuRyu", /furyu|noodle stopper|trio-?try-?it|\btenitol\b|bicute/i],
  ["Taito", /\btaito\b|coreful/i],
  ["Funko Pop!", /funko|\bpop!?\s|\bpop!\b|\bvinyl\b/i],
  ["JoyToy", /joy ?toy/i],
  ["ARTFX", /artfx|kotobukiya/i],
  ["MegaHouse", /megahouse|portrait\.?\s?of\.?\s?pirates|\bp\.o\.p\b|\bg\.e\.m\b|look ?up|\blookup\b/i],
  ["Good Smile", /good smile|\bgsc\b|max factory|moderoid/i],
  ["Bandai Spirits", /bandai spirits|tamashii/i],
  ["Shokugan", /shokugan|candy toy/i],
  ["Scale figures", /\b1\/(4|5|6|7|8|10|12)\b|scale figure/i],
  ["Blind box", /blind box|mystery box|trading figure|surprise/i],
  ["Statues & busts", /statue|\bbust\b|diorama|resin/i],
  ["Plush", /plush|plushie/i],
];

export const FIG_LABELS = FRANCHISES.map((t) => t[0]);
export const LINE_LABELS = LINES.map((t) => t[0]);
export const franchiseCollection = (label) => "figures-" + handleize(label);
export const lineCollection = (label) => "figure-line-" + handleize(label);

function match(table, text) {
  const s = String(text || "");
  if (!s) return "";
  for (const [label, re] of table) if (re.test(s)) return label;
  return "";
}

/* Bandai-style titles put the series last in quotes: ... "One Piece". */
export function quotedSeries(title) {
  const m = String(title || "").match(/["“]([^"“”]{2,80})["”]\s*,?\s*$/);
  return m ? m[1].trim() : "";
}

export function franchiseOf(it) {
  const series = String(it.series || "");
  return match(FRANCHISES, series) || match(FRANCHISES, quotedSeries(it.title)) || match(FRANCHISES, it.title);
}

export function lineOf(it) {
  const t = String(it.title || "");
  const type = String(it.productType || "");
  if (/^funko$/i.test(type)) return "Funko Pop!";
  const byBrand = match(LINES, it.brand);
  // the brand fact names the line for most figures; a generic brand ("Figure",
  // "Other Figures", "Prize Figure") says nothing, so the title decides then
  if (byBrand && !/^(Statues & busts|Plush|Blind box)$/.test(byBrand)) return byBrand;
  const byTitle = match(LINES, t);
  if (byTitle) return byTitle;
  if (/^blind box$/i.test(type)) return "Blind box";
  if (byBrand) return byBrand;
  const byMaker = match(LINES, it.maker);
  return byMaker || "";
}

export function parseFigPage(data) {
  const p = data && data.products;
  const nodes = (p && p.nodes) || [];
  return {
    items: nodes.map((n) => ({ id: n.id, title: n.title || "", vendor: n.vendor || "", productType: n.productType || "", tags: Array.isArray(n.tags) ? n.tags : [],
      series: n.series && n.series.value || "", brand: n.brand && n.brand.value || "", maker: n.maker && n.maker.value || "" })),
    hasNext: !!(p && p.pageInfo && p.pageInfo.hasNextPage),
    cursor: (p && p.pageInfo && p.pageInfo.endCursor) || null,
  };
}

/* {want, add, remove}: the fig:/figline: tags the product should carry, and the
   difference from what it carries. Other tags are never touched. */
export function figPlan(it) {
  const want = [];
  const f = franchiseOf(it);
  if (f) want.push(FIG_PREFIX + f);
  const l = lineOf(it);
  if (l) want.push(LINE_PREFIX + l);
  const ours = (it.tags || []).filter((t) => t.startsWith(FIG_PREFIX) || t.startsWith(LINE_PREFIX));
  return { want, add: want.filter((t) => !ours.includes(t)), remove: ours.filter((t) => !want.includes(t)), franchise: f, line: l };
}
