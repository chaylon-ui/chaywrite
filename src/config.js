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
    { label: "Star Wars",  collection: "star-wars-unlimited-singles-in-stock", theme: "starwars",  game: "starwars",  enabled: false },
    { label: "One Piece",  collection: "one-piece-in-stock",            theme: "onepiece",   game: "onepiece",   enabled: false },
    { label: "Riftbound",  collection: "riftbound-singles",             theme: "riftbound",  game: "riftbound",  enabled: false },
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

  // The sleeve wall: a black retail-shelf tab of the Dragon Shield sleeve
  // collection (accessories — no top-loaders, no conditions, no price floor).
  sleevesTab: { enabled: false, label: "Sleeves", collection: "all-dragon-shield-sleeves" },
  sleevesActive: false, // true while the sleeve wall is on screen
  // White backdrop behind each sleeve-box shot on the wall — for catalogues
  // where the product photos aren't transparent cut-outs. Off = current look.
  sleeveWhiteBg: false,

  // Touch kiosks: expanded rows — the shelves stop shingling so the WHOLE
  // card (text box included) is visible without tapping. Fewer cards per
  // page. Off = the current overlapped stack.
  fullCard: false,

  // Website mode: this screen is EMBEDDED ON THE WEBSITE (e.g. the
  // "exor-main-site" room on exorgames.com) rather than running a kiosk.
  // Full browsing UI, but no send-to-counter, no QR handoff (checkout goes
  // through the site's own Shopify cart), no attract show, no kiosk
  // lockdown, and no usage analytics. Phones get a 3-column scroll grid.
  // /tv?site=1 forces it per-URL regardless of this setting.
  siteMode: false,

  // "Browse by set" button beside the search bar (touch kiosks + website):
  // pick any set and see everything in stock from it.
  setBrowse: false,
  // Set panel style: false = type-to-search with live autocomplete;
  // true = an A–Z roll — tap a letter, pick from the sets we stock.
  setRoll: false,

  // Performance mode for weaker TV boxes: replaces the preview's backdrop
  // blur with a plain dim and stills the heavy filter animations.
  perfMode: false,

  // Touch-screen kiosk mode (per room, from /admin): the screen itself is the
  // controller — tap/swipe to browse, on-screen tabs/search/cart, checkout by
  // QR to the shopper's phone, send-to-counter draft orders, and a longer
  // (2 minute) idle window before the attract show. /tv?touch=1 still forces
  // it per-URL regardless of this setting.
  touchMode: false,
  // Let touch kiosks offer "Send to counter" (creates a draft order for
  // staff to ring through). Untick per screen to leave only the QR
  // checkout-on-your-phone path.
  counterEnabled: true,
  // Where the on-screen search keyboard sits on a touch kiosk (some totems
  // are mounted high, some low): top | midtop | middle | midbot | bottom.
  kbPos: "bottom",

  // Seasonal dressing for the case (per room, from /admin). "christmas" adds
  // a string of lights along the top, frosted corners and festive clutter —
  // cards, prices and tabs are untouched.
  holiday: "none", // "none" | "christmas"

  // "New Today" showcases — an extra phone tab per enabled game showing cards
  // published today (topped up to at least 10, all over $10), with a
  // masking-tape banner across the TV case while active.
  newToday: { mtg: false, pokemon: false, yugioh: false, starwars: false, onepiece: false, riftbound: false, hockey: false, basketball: false },
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

  // Kiosk welcome show (touch kiosks, off by default): while the screen
  // idles, a full-screen comic invite explains what the kiosk can do —
  // tap/search/cart/checkout — over the live flipping case. The first touch
  // dismisses it straight into normal browsing. Off = the regular attract
  // show (tape + shopkeeper bubble ads) exactly as before.
  attractShow: false,

  // Which tab the screen snaps back to when the attract show starts — so an
  // abandoned Sleeves/search view resets to latest arrivals for the next
  // passer-by (and the NEW ARRIVALS tape always matches what's on screen).
  attractHome: "mtg", // "mtg" | "pokemon" | "yugioh" | "showcase"

  // Ad + Google-review card on the phone (toggle from /admin).
  adEnabled: false,
  adText: "Got cards? Exor Games buys singles, collections & sealed — cash or store credit.",
  reviewUrl: "", // your Google review link (e.g. https://g.page/r/…/review)
};

// Dragon Shield badge (rendered in-house, 56px WebP) — the sleeve tab's
// default icon; uploading a custom icon in /admin overrides it.
export const SLEEVES_TAB_ICON = "data:image/webp;base64,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";

export const DEFAULT_PIN = "4242";
