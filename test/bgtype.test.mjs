import { test } from "node:test";
import assert from "node:assert/strict";
import { bgTypes, bgPlan, handleize, collectionHandle, tagMutation, tagErrors, parseBgPage, BG_LABELS } from "../src/bgtype.js";

test("types from BGG facts", () => {
  const t = (it) => bgTypes(it).join("|");
  assert.equal(t({ title: "VERDANT", cat: '["Card Game","Environmental","Puzzle"]', mech: '["Solo / Solitaire Game","Tile Placement"]', pmin: "1", pmax: "5", age: "10", wt: "2.06" }), "Card Games|Solo Friendly|Puzzles & Escape Rooms");
  assert.equal(t({ title: "DEEP SEA ADVENTURE", cat: '["Dice","Exploration","Nautical","Party Game"]', mech: '["Push Your Luck"]', pmin: "2", pmax: "6", age: "8", wt: "1.18" }), "Party Games|Family & Kids|Dice Games");
  assert.equal(t({ title: "WU WEI", cat: '["Abstract Strategy"]', mech: '[]', pmin: "1", pmax: "6", age: "14", wt: "3.4" }), "Strategy|Solo Friendly|Chess & Classics");
  assert.equal(t({ title: "NASTY NEIGHBORS", cat: '["Card Game","Humor","Mature / Adult","Party Game"]', mech: '["Take That"]', pmin: "2", pmax: "5", age: "14", wt: "1.0" }), "Party Games|Card Games");
  assert.equal(t({ title: "SIMILO", cat: '["Card Game","Children\'s Game","Deduction"]', mech: '["Cooperative Game","Deduction"]', pmin: "2", pmax: "8", age: "7", wt: "1.05" }), "Family & Kids|Card Games|Co-op|Deduction & Bluffing");
  assert.equal(t({ title: "PLANES ROUND TRIP", cat: '["Expansion for Base-game"]', pmin: "2", pmax: "4", age: "14" }), "Expansions");
  assert.equal(t({ title: "SOMETHING", base: "gid://shopify/Product/1" }), "Expansions");
});
test("title rules for games BGG never matched", () => {
  const t = (title) => bgTypes({ title }).join("|");
  assert.equal(t("ESCAPE ROOM THE GAME FAMILY ED 3 -CANDY AND HEROES"), "Family & Kids|Puzzles & Escape Rooms");
  assert.equal(t("CHRISTMAS LIGHTS CARD GAME 2E"), "Card Games");
  assert.equal(t("PUNS OF ANARCHY EXPANSION PACK"), "Expansions");
  assert.equal(t("CLASSIC CHESS SET"), "Chess & Classics");
  assert.equal(t("TRIVIAL PURSUIT"), "");   // "trivial" is not "trivia"
  assert.equal(t("SMASH UP 10TH ANNIVERSARY SET"), "");
});
test("humor is a party game only with 5+ players; 2-player needs max 2", () => {
  assert.deepEqual(bgTypes({ title: "X", cat: '["Humor"]', pmax: "4" }), []);
  assert.deepEqual(bgTypes({ title: "X", cat: '["Humor"]', pmax: "8" }), ["Party Games"]);
  assert.deepEqual(bgTypes({ title: "X", pmin: "2", pmax: "2" }), ["2-Player"]);
  assert.deepEqual(bgTypes({ title: "X", pmin: "1", pmax: "2" }), ["2-Player", "Solo Friendly"]);
  assert.deepEqual(bgTypes({ title: "X", pmin: "3", pmax: "2" }), []);   // nonsense range
});
test("plan adds and removes only bg: tags", () => {
  const p = bgPlan({ title: "X", cat: '["Party Game"]', tags: ["bg:Co-op", "bg:Party Games", "hot", "bg:Not A Type"] });
  assert.deepEqual(p, { want: ["Party Games"], add: [], remove: ["bg:Co-op", "bg:Not A Type"] });
  assert.deepEqual(bgPlan({ title: "X", tags: ["hot"] }), { want: [], add: [], remove: [] });
});
test("handles like Liquid handleize", () => {
  assert.equal(handleize("Family & Kids"), "family-kids");
  assert.equal(handleize("Co-op"), "co-op");
  assert.equal(handleize("2-Player"), "2-player");
  assert.equal(collectionHandle("Puzzles & Escape Rooms"), "board-games-puzzles-escape-rooms");
  assert.equal(new Set(BG_LABELS.map(collectionHandle)).size, BG_LABELS.length);
});
test("aliased tag mutation and its errors", () => {
  const m = tagMutation("add", [{ id: "gid://shopify/Product/1", tags: ["bg:Co-op"] }, { id: "gid://shopify/Product/2", tags: ["bg:Family & Kids", "bg:2-Player"] }]);
  assert.equal(m, 'mutation { t0: tagsAdd(id: "gid://shopify/Product/1", tags: ["bg:Co-op"]) { userErrors { message } } t1: tagsAdd(id: "gid://shopify/Product/2", tags: ["bg:Family & Kids","bg:2-Player"]) { userErrors { message } } }');
  assert.match(tagMutation("remove", [{ id: "g", tags: ["a"] }]), /^mutation \{ t0: tagsRemove\(/);
  assert.deepEqual(tagErrors({ t0: { userErrors: [] }, t1: { userErrors: [{ message: "bad" }] } }, [{ id: "a" }, { id: "b" }]), ["b: bad"]);
});
test("page parse", () => {
  const p = parseBgPage({ products: { pageInfo: { hasNextPage: true, endCursor: "c" }, nodes: [{ id: "g", title: "T", tags: ["x"], cat: { value: "[]" }, mech: null, pmin: { value: "1" }, pmax: null, age: null, wt: null, base: null }] } });
  assert.deepEqual(p, { items: [{ id: "g", title: "T", tags: ["x"], cat: "[]", mech: "", pmin: "1", pmax: "", age: "", wt: "", base: "" }], hasNext: true, cursor: "c" });
});
