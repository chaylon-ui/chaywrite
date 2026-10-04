// Deck builder name matching (owner 2026-10-04: "Cards with commas if someone types in
// without the comma it doesn't bring up the card in deck builder").
import test from "node:test";
import assert from "node:assert/strict";
import { nameMatches, foldName } from "../src/cards.js";

const m = (title, typed, game) => nameMatches(title, String(typed).toLowerCase(), game || "mtg");

test("foldName drops punctuation, accents and case but keeps every letter and digit in order", () => {
  assert.equal(foldName("Adewale, Breaker of Chains"), "adewale breaker of chains");
  assert.equal(foldName("Peter Pan's Ally"), "peter pans ally");
  assert.equal(foldName("Witch-king of Angmar"), "witch king of angmar");
  assert.equal(foldName("Lim-Dûl's Vault"), "lim duls vault");
  assert.equal(foldName("  Sol   Ring "), "sol ring");
});

test("a name typed without its comma, apostrophe, hyphen or accent still matches the exact card", () => {
  assert.equal(m("Adewale, Breaker of Chains [Assassin's Creed]", "Adewale breaker of chains"), true);
  assert.equal(m("Adewale, Breaker of Chains (Showcase) [Assassin's Creed]", "adewale, breaker of chains"), true);
  assert.equal(m("Peter Pan's Ally [Lorcana]", "peter pans ally", "lorcana"), true);
  assert.equal(m("Witch-king of Angmar [The Lord of the Rings]", "witch king of angmar"), true);
  assert.equal(m("Lim-Dûl's Vault [Alliances]", "lim-dul's vault"), true);
});

test("still exact: a different card, a longer name or a bare prefix never matches", () => {
  assert.equal(m("Adewale, Breaker of Chains [Assassin's Creed]", "adewale"), false);
  assert.equal(m("Sol Ring [Commander 2021]", "sol rings"), false);
  assert.equal(m("Lightning Bolt [Magic 2010]", "lightning"), false);
  assert.equal(m("Stitch - Rock Star [The First Chapter]", "stitch", "lorcana"), false);
  assert.equal(m("Sol Ring [Commander 2021]", ""), false);
});

test("Secret Lair flavour titles match by segment; double-faced cards match by either face", () => {
  assert.equal(m("Master Emerald Shrine - Command Tower (7030) [Secret Lair Drop Series]", "command tower"), true);
  assert.equal(m("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki [Kamigawa: Neon Dynasty]", "fable of the mirror breaker"), true);
  assert.equal(m("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki [Kamigawa: Neon Dynasty]", "fable of the mirror-breaker // reflection of kiki-jiki"), true);
  assert.equal(m("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki [Kamigawa: Neon Dynasty]", "reflection"), false);
});
