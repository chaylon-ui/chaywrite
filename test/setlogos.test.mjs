import { test } from "node:test";
import assert from "node:assert/strict";
import { normSet, setLogoKeys, logosOf, serveSetLogos } from "../src/setlogos.js";

/* Set logos on the 3D shop's set boxes (owner, 2026-11-09). */
test("setLogoKeys: the name, then without BinderPOS's tokens/promos words, then without a code prefix", () => {
  assert.equal(normSet("Sword & Shield: Base Set"), "sword and shield base set");
  assert.deepEqual(setLogoKeys("Dominaria"), ["dominaria"]);
  assert.deepEqual(setLogoKeys("Aetherdrift Commander Tokens"), ["aetherdrift commander tokens", "aetherdrift"]);
  assert.deepEqual(setLogoKeys("Aether Revolt Prerelease Promos"), ["aether revolt prerelease promos", "aether revolt"]);
  assert.deepEqual(setLogoKeys("SV09: Journey Together"), ["sv09 journey together", "journey together"]);
  assert.deepEqual(setLogoKeys("SWSH01: Sword & Shield Base Set"), ["swsh01 sword and shield base set", "swsh01 sword and shield", "sword and shield base set", "sword and shield"]);
  assert.deepEqual(setLogoKeys("Scarlet & Violet: Journey Together"), ["scarlet and violet journey together", "journey together"]);
  assert.deepEqual(setLogoKeys("Scarlet & Violet: Base Set"), ["scarlet and violet base set", "scarlet and violet", "base set", "scarlet and violet"].filter((k, i, a) => a.indexOf(k) === i));
  assert.deepEqual(setLogoKeys(""), [""]);
});
test("logosOf: each source's shape; only https pictures; the first of a repeated name wins", () => {
  assert.deepEqual(logosOf("mtg", { data: [{ name: "Dominaria", icon_svg_uri: "https://svgs.scryfall.io/sets/dom.svg?1" }, { name: "Dominaria", icon_svg_uri: "https://svgs.scryfall.io/sets/x.svg" }, { name: "No Icon" }, { name: "Bad", icon_svg_uri: "javascript:alert(1)" }] }), { dominaria: "https://svgs.scryfall.io/sets/dom.svg?1" });
  assert.deepEqual(logosOf("pokemon", { data: [{ name: "Journey Together", images: { symbol: "https://images.pokemontcg.io/sv9/symbol.png", logo: "https://images.pokemontcg.io/sv9/logo.png" } }, { name: "Nothing" }] }), { "journey together": "https://images.pokemontcg.io/sv9/logo.png" });
  assert.deepEqual(logosOf("pokemon", [{ name: "Base", images: { logo: "https://images.pokemontcg.io/base1/logo.png" } }]), { base: "https://images.pokemontcg.io/base1/logo.png" });   // the data file is a plain list
  assert.deepEqual(logosOf("yugioh", [{ set_name: "Duel Power", set_code: "DUPO", set_image: "https://images.ygoprodeck.com/images/sets/DUPO.jpg" }, { set_name: "Plain" }]), { "duel power": "https://images.ygoprodeck.com/images/sets/DUPO.jpg" });
  assert.deepEqual(logosOf("mtg", null), {}); assert.deepEqual(logosOf("yugioh", { data: [] }), {}); assert.deepEqual(logosOf("chess", { data: [{ name: "x", icon_svg_uri: "https://a/b" }] }), {});
});
test("serveSetLogos: the game's source is asked; a game without one answers empty; a failed source is reported and not cached", async () => {
  const seen = [];
  const go = (q, fetchFn) => serveSetLogos(new Request("https://w.example/showcase/setlogos.json" + q), {}, {}, new URL("https://w.example/showcase/setlogos.json" + q), { fetchFn });
  let r = await go("?game=mtg", async (u) => { seen.push(u); return Response.json({ data: [{ name: "Dominaria", icon_svg_uri: "https://svgs.scryfall.io/sets/dom.svg" }] }); });
  let j = await r.json();
  assert.equal(seen[0], "https://api.scryfall.com/sets"); assert.equal(j.ok, true); assert.equal(j.count, 1); assert.equal(j.logos.dominaria, "https://svgs.scryfall.io/sets/dom.svg");
  assert.match(r.headers.get("cache-control"), /max-age=86400/); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  j = await (await go("?game=riftbound", async () => { throw new Error("not asked"); })).json(); assert.deepEqual(j, { ok: true, game: "riftbound", logos: {} });
  r = await go("?game=pokemon", async () => new Response("no", { status: 429 })); j = await r.json();
  assert.equal(j.ok, false); assert.deepEqual(j.logos, {}); assert.equal(r.headers.get("cache-control"), "no-store");
});
