import { test } from "node:test";
import assert from "node:assert/strict";
import { sleeveFit, fitSleeves, RULES } from "../src/kit.js";

test("sleeve titles size by brand chart or the title's own mm", () => {
  assert.deepEqual(sleeveFit("DRAGON SHIELD BG SLEEVES EUROPEAN STANDARD 100CT"), { w: 59, h: 92, count: 100 });
  assert.deepEqual(sleeveFit("DRAGON SHIELD BG SLEEVES AMERICAN MINI 100CT"), { w: 41, h: 63, count: 100 });
  assert.deepEqual(sleeveFit("DRAGON SHIELD BG SLEEVES EXTRA LARGE 100CT"), { w: 65, h: 100, count: 100 });
  assert.deepEqual(sleeveFit("UP BG LITE SLEEVES EUROPEAN 59MMX92MM 100CT"), { w: 59, h: 92, count: 100 });
  assert.deepEqual(sleeveFit("UP BG SLEEVES TAROT 70MMX120MM 50CT"), { w: 70, h: 120, count: 50 });
  assert.deepEqual(sleeveFit("ARCANE TINMEN BG SLEEVES NONGLARE LARGE"), { w: 59, h: 92, count: null });
  assert.deepEqual(sleeveFit("ARCANE TINMEN BG SLEEVES NONGLARE OVERSZ"), { w: 80, h: 120, count: null });
  assert.equal(sleeveFit("DRAGON SHIELD SLEEVES MATTE BLOOD RED 100CT"), null);   // TCG sleeves: no board-game size
  assert.equal(sleeveFit("UP SLEEVES CARD 100CT"), null);
});

test("fitting picks the snug sleeve, never one the card cannot enter, and counts packs", () => {
  const S = [
    { handle: "euro", title: "euro", fit: { w: 59, h: 92, count: 100 }, stock: 3 },
    { handle: "amstd", title: "am std", fit: { w: 57.5, h: 89, count: 100 }, stock: 9 },
    { handle: "mini", title: "mini", fit: { w: 41, h: 63, count: 50 }, stock: 9 },
    { handle: "xl", title: "xl", fit: { w: 65, h: 100, count: 100 }, stock: 9 },
  ];
  const [dom, ttr, amer] = fitSleeves([{ n: 500, w: 59, h: 91, label: "Cards" }, { n: 30, w: 41, h: 63 }, { n: 110, w: 89, h: 56 }], S);
  assert.deepEqual(dom.sleeves.map((x) => x.handle), ["euro"]);
  assert.equal(dom.sleeves[0].packs, 5);
  assert.deepEqual(ttr.sleeves.map((x) => x.handle), ["mini"]);
  assert.equal(ttr.sleeves[0].packs, 1);
  assert.equal(amer.w, 56); assert.equal(amer.h, 89);          // turned upright
  assert.deepEqual(amer.sleeves.map((x) => x.handle), ["amstd", "euro"]);
});

test("tool rules keep real tools and drop look-alikes", () => {
  const r = (k, c) => RULES[k].find((x) => x.key === c);
  const ok = (rule, t) => rule.re.test(t) && (!rule.also || rule.also.test(t)) && !(rule.not && rule.not.test(t));
  assert.ok(ok(r("wh", "clippers"), "CITADEL FINE DETAIL CUTTERS"));
  assert.ok(!ok(r("wh", "clippers"), "GodHand - Glass Cutter Mat"));
  assert.ok(ok(r("wh", "glue"), "CITADEL PLASTIC GLUE"));
  assert.ok(!ok(r("wh", "glue"), "ARMY PAINTER SUPER GLUE 20GM"));
  assert.ok(ok(r("wh", "primer"), "THE ARMY PAINTER COLOUR PRIMER: MATTE BLACK SPRAY"));
  assert.ok(ok(r("wh", "primer"), "SPRAY: CHAOS BLACK"));
  assert.ok(!ok(r("wh", "primer"), "VALLEJO: GAME AIR PRIMER BLACK 17ML"));
  assert.ok(ok(r("gunpla", "nippers"), "Mr Basic Nipper II"));
  assert.ok(ok(r("gunpla", "markers"), "GUNDAM MARKER GM301 PANEL LINING BLACK"));
  assert.ok(ok(r("gunpla", "topcoat"), "Mr. Premium Top Coat Flat"));
});
