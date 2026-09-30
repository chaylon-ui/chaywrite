/* Board game types (owner, 2026-09-30: "add filters to board games like we did with
   warhammer" - "at the top having buttons for types of games").

   Every active Board Games product gets one tag per type it belongs to, "bg:<label>"
   (bg:Party Games, bg:Co-op, ...), from the BoardGameGeek facts the nightly enrich run
   already wrote (exor.categories / mechanics / players_min / players_max / age_min /
   weight / base_game) plus the title for the games BGG never matched. A smart
   collection per type (board-games-<handleized label>, rule: tag EQUALS bg:<label>)
   is what the theme's "Shop by type" chip row links to (snippets/breadcrumb.liquid -
   the labels there must match BG_TYPES exactly; the handle is Liquid `handleize` of
   the label, which drops "&" and apostrophes: board-games-family-kids).

   Only our own bg: tags are ever added or removed - a product's other tags are left
   as they are. Written by the enrich "bgtype" phase, after gamesys. */

export const TAG_PREFIX = "bg:";
export const BG_QUERY = "status:active AND product_type:'Board Games'";
export const BG_PAGE = `query($q:String!,$after:String){products(first:100,query:$q,after:$after,sortKey:ID){pageInfo{hasNextPage endCursor}nodes{id title tags cat: metafield(namespace:"exor", key:"categories"){ value } mech: metafield(namespace:"exor", key:"mechanics"){ value } pmin: metafield(namespace:"exor", key:"players_min"){ value } pmax: metafield(namespace:"exor", key:"players_max"){ value } age: metafield(namespace:"exor", key:"age_min"){ value } wt: metafield(namespace:"exor", key:"weight"){ value } base: metafield(namespace:"exor", key:"base_game"){ value }}}}`;

/* [label, rule(facts)] - a product may belong to several. Facts: cats/mechs are Sets of
   the BGG names, pmin/pmax/age/wt numbers or null, title the product title, base true
   when exor.base_game is set. */
export const BG_TYPES = [
  ["Party Games", (f) => f.cats.has("Party Game") || (f.cats.has("Humor") && f.pmax !== null && f.pmax >= 5) || /\bparty\b/i.test(f.title)],
  ["Family & Kids", (f) => f.cats.has("Children's Game") || (f.age !== null && f.age <= 8 && (f.wt === null || f.wt < 2.2)) || /\b(kids?|junior|family|my first)\b/i.test(f.title)],
  ["Strategy", (f) => (f.wt !== null && f.wt >= 2.5) || ["Economic", "Civilization", "Territory Building", "Wargame", "City Building", "Political", "Industry / Manufacturing"].some((c) => f.cats.has(c))],
  ["Card Games", (f) => f.cats.has("Card Game") || /\bcard game\b/i.test(f.title)],
  ["Co-op", (f) => f.cats.has("Cooperative Game") || f.mechs.has("Cooperative Game") || /\bco-?op(erative)?\b/i.test(f.title)],
  ["2-Player", (f) => (f.pmax === 2 && (f.pmin === null || f.pmin <= 2)) || /\b(two|2)[- ]player\b/i.test(f.title)],
  ["Solo Friendly", (f) => f.pmin === 1 || f.mechs.has("Solo / Solitaire Game") || /\bsolo\b|\bsolitaire\b/i.test(f.title)],
  ["Dice Games", (f) => f.cats.has("Dice") || /\bdice\b/i.test(f.title)],
  ["Deduction & Bluffing", (f) => ["Deduction", "Bluffing", "Mafia", "Spies/Secret Agents", "Murder / Mystery"].some((c) => f.cats.has(c)) || ["Hidden Roles", "Traitor Game", "Deduction", "Betting and Bluffing", "Hidden Movement"].some((m) => f.mechs.has(m))],
  ["Puzzles & Escape Rooms", (f) => f.cats.has("Puzzle") || /escape room|\bexit\b|\bunlock!?\b|\bpuzzle\b/i.test(f.title)],
  ["Chess & Classics", (f) => f.cats.has("Abstract Strategy") || /\bchess\b|\bcheckers\b|\bbackgammon\b|\bcribbage\b|\bdominoe?s\b|\bmahjong\b|\bmancala\b|\bplaying cards\b/i.test(f.title)],
  ["Trivia & Word", (f) => f.cats.has("Trivia") || f.cats.has("Word Game") || /\btrivia\b|\bword game\b|\bcrossword\b/i.test(f.title)],
  ["Expansions", (f) => f.cats.has("Expansion for Base-game") || f.base || /\bexpansion\b|\bexp\b/i.test(f.title)],
];

export const BG_LABELS = BG_TYPES.map((t) => t[0]);
export const tagOf = (label) => TAG_PREFIX + label;

// Liquid `handleize`: lower-case, apostrophes dropped ("Emperor's" -> "emperors"),
// runs of anything else but a-z0-9 become one "-", trimmed
export function handleize(s) {
  return String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export const collectionHandle = (label) => "board-games-" + handleize(label);

const num = (v) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };
const list = (v) => { try { const a = JSON.parse(v || "[]"); return new Set(Array.isArray(a) ? a.map(String) : []); } catch (e) { return new Set(); } };

export function factsOf(it) {
  return {
    title: String(it.title || ""),
    cats: list(it.cat), mechs: list(it.mech),
    pmin: num(it.pmin), pmax: num(it.pmax), age: num(it.age), wt: num(it.wt),
    base: !!it.base,
  };
}

/* Labels a product belongs to, in BG_TYPES order. */
export function bgTypes(it) {
  const f = factsOf(it);
  return BG_TYPES.filter(([, rule]) => rule(f)).map(([label]) => label);
}

export function parseBgPage(data) {
  const p = data && data.products;
  if (!p) return { items: [], hasNext: false, cursor: null };
  const v = (m) => (m && m.value) || "";
  return {
    items: p.nodes.map((n) => ({ id: n.id, title: n.title, tags: Array.isArray(n.tags) ? n.tags : [],
      cat: v(n.cat), mech: v(n.mech), pmin: v(n.pmin), pmax: v(n.pmax), age: v(n.age), wt: v(n.wt), base: v(n.base) })),
    hasNext: p.pageInfo.hasNextPage,
    cursor: p.pageInfo.endCursor,
  };
}

/* {want, add, remove} for one product: the bg: tags to add and the bg: tags it carries
   that it no longer earns (or that name a type we no longer have). Other tags: untouched. */
export function bgPlan(it) {
  const want = bgTypes(it);
  const wantTags = new Set(want.map(tagOf));
  const have = new Set((it.tags || []).filter((t) => t.startsWith(TAG_PREFIX)));
  const add = [...wantTags].filter((t) => !have.has(t));
  const remove = [...have].filter((t) => !wantTags.has(t));
  return { want, add, remove };
}

/* One aliased mutation for up to TAG_BATCH products: {id, tags} per entry. */
export const TAG_BATCH = 20;
export function tagMutation(kind, entries) {
  const op = kind === "remove" ? "tagsRemove" : "tagsAdd";
  const parts = entries.map((e, i) => `t${i}: ${op}(id: ${JSON.stringify(e.id)}, tags: ${JSON.stringify(e.tags)}) { userErrors { message } }`);
  return "mutation { " + parts.join(" ") + " }";
}
export function tagErrors(data, entries) {
  const out = [];
  entries.forEach((e, i) => {
    const r = data && data["t" + i];
    const errs = (r && r.userErrors) || [];
    if (errs.length) out.push(e.id + ": " + errs.map((x) => x.message).join("; "));
  });
  return out;
}
