export const TOKEN_LIFE_S = 120;
export const IDLE_TIMEOUT_S = 120;

export const DEFAULT_SETTINGS = {
  header: "Featured Singles · New Arrivals over $10",
  collection: "new-arrivals", // active collection handle (follows the selected tab)
  theme: "mtg",               // active case skin: "mtg" | "pokemon" | "yugioh"
  game: "mtg",                // active lane scheme (usually equals theme)
  topLoaders: false,          // show each card inside a clear top-loader (TV only)

  // Game tabs — shown on the PHONE (customer switches; the TV follows).
  // Each tab carries the collection it pulls from, the case skin, the
  // lane-grouping scheme, and an enabled flag so every TV (room) can carry
  // its own mix — e.g. the sports-area TV enables only Hockey/Basketball.
  // Collection handles and enabled flags are editable from /admin?room=….
  tabs: [
    { label: "Magic",      collection: "new-arrivals",                  theme: "mtg",        game: "mtg",        enabled: true },
    { label: "Pokémon",    collection: "pokemon-singles-new-arrivals",  theme: "pokemon",    game: "pokemon",    enabled: true },
    { label: "Yu-Gi-Oh!",  collection: "yu-gi-oh-singles-new-arrivals", theme: "yugioh",     game: "yugioh",     enabled: true },
    { label: "Hockey",     collection: "all-hockey-card-singles",       theme: "hockey",     game: "hockey",     enabled: false },
    { label: "Basketball", collection: "all-basketball-singles",        theme: "basketball", game: "basketball", enabled: false },
  ],

  // The physical showcase, mirrored: a tab showing every card tagged
  // ESL-SHOWCASE in the store (the "esl-showcase" smart collection gathers
  // the tag automatically). Mixed games, no price floor — the tag is the
  // curation. Cards group by game: Magic by color, Pokémon by energy,
  // Yu-Gi-Oh by Spell/Trap/attribute, anything else under its own game name.
  showcaseTab: { enabled: true, label: "Showcase", collection: "esl-showcase" },
  showcaseActive: false, // true while the Showcase tab is on screen

  // Performance mode for weaker TV boxes: replaces the preview's backdrop
  // blur with a plain dim and stills the heavy filter animations.
  perfMode: false,

  // "New Today" showcases — an extra phone tab per enabled game showing cards
  // published today (topped up to at least 10, all over $10), with a
  // masking-tape banner across the TV case while active.
  newToday: { mtg: false, pokemon: false, yugioh: false, hockey: false, basketball: false },
  newTodayActive: false, // true while a New Today tab is the active showcase

  // Let customers search ALL in-stock singles from their phone; results show
  // as a temporary showcase on the TV until they clear the search. Off until
  // enabled in /admin.
  searchEnabled: false,

  // Comic-book speech bubble on the featured-card preview. {card} becomes the
  // card's name. One line is picked at random each time; edit them in /admin
  // (clear all three to hide the bubble).
  bubbleMsgs: [
    "Wanna buy {card}, kid? I can ring it up if you add it to your cart!",
    "You gonna look all day, or you gonna buy it? I got customers waiting!",
    "Surely your allowance will cover it, kid — add {card} to your cart, it'll be cool in your deck!",
  ],

  // Masking-tape shout across the top of the case while the TV idles in
  // attract mode (no phone paired). One line is picked at random each time
  // the show starts; edit in /admin (clear all three to hide the tape).
  attractMsgs: [
    "NEW ARRIVALS! No Holds - no trades for beanie babies",
    "NEW ARRIVALS! Yes I checked the prices with newest Scry Mag",
    "NEW ARRIVALS!!! More stock out back just ask!",
  ],

  // Ad + Google-review card on the phone (toggle from /admin).
  adEnabled: false,
  adText: "Got cards? Exor Games buys singles, collections & sealed — cash or store credit.",
  reviewUrl: "", // your Google review link (e.g. https://g.page/r/…/review)
};

export const DEFAULT_PIN = "4242";
