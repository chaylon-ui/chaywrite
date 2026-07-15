export const TOKEN_LIFE_S = 120;
export const IDLE_TIMEOUT_S = 120;

export const DEFAULT_SETTINGS = {
  header: "Featured Singles · New Arrivals over $10",
  collection: "new-arrivals", // active collection handle (follows the selected tab)
  theme: "mtg",               // active case skin: "mtg" | "pokemon" | "yugioh"
  game: "mtg",                // active lane scheme (usually equals theme)
  topLoaders: false,          // show each card inside a clear top-loader (TV only)

  // Game tabs — shown on the PHONE (customer switches; the TV follows).
  // Each tab carries the collection it pulls from, the case skin, and the
  // lane-grouping scheme. Collection handles are editable from /admin.
  tabs: [
    { label: "Magic",     collection: "new-arrivals",     theme: "mtg",     game: "mtg" },
    { label: "Pokémon",   collection: "pokemon-singles-new-arrivals",  theme: "pokemon", game: "pokemon" },
    { label: "Yu-Gi-Oh!", collection: "yu-gi-oh-singles-new-arrivals", theme: "yugioh",  game: "yugioh" },
  ],

  // Ad + Google-review card on the phone (toggle from /admin).
  adEnabled: false,
  adText: "Got cards? Exor Games buys singles, collections & sealed — cash or store credit.",
  reviewUrl: "", // your Google review link (e.g. https://g.page/r/…/review)
};

export const DEFAULT_PIN = "4242";
