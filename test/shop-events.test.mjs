import { test } from "node:test";
import assert from "node:assert/strict";
import { posterEvents, serveShopEvents } from "../src/events.js";

test("showcase/events.json: the home store's coming events, soonest first, with the feed's picture when it has one", async () => {
  const feed = [{ title: "Commander Night", date: "2026-11-20T00:00:00", time: "18:30:00", game: "Magic", ticketPrice: 5, calendarIcon: "https://x.example/mtg.png" },
    { title: "Pokemon League", date: "2026-11-14", time: "13:00:00", game: "Pokemon", banner: "https://x.example/b.jpg", calendarIcon: "https://x.example/p.png" },
    { title: "Hidden", date: "2026-11-13", isDisabled: true }, { title: "No picture", date: "2026-11-15", image: "not a url" }];
  assert.deepEqual(posterEvents(feed, "https://exorgames.com").map((e) => e.title + "|" + e.date + "|" + e.image), ["Pokemon League|2026-11-14|https://x.example/b.jpg", "No picture|2026-11-15|null", "Commander Night|2026-11-20|https://x.example/mtg.png"]);
  let asked = "";
  const j = await (await serveShopEvents(new Request("https://w.example/showcase/events.json"), {}, { now: Date.UTC(2026, 10, 12), fetchFn: async (u) => { asked = u; return new Response(JSON.stringify(feed)); } })).json();
  assert.equal(j.ok, true); assert.equal(j.events.length, 3); assert.match(asked, /startDate=2026-11-12&endDate=2026-12-27/); assert.ok(j.keys.includes("calendarIcon"));
  const bad = await (await serveShopEvents(new Request("https://w.example/showcase/events.json"), {}, { fetchFn: async () => new Response("no", { status: 500 }) })).json(); assert.equal(bad.ok, false);
});
