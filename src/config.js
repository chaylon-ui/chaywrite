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

  // Generic retail-shelf tabs: same wall treatment as the sleeves (product
  // shots on black shelves, title + price stickers) for non-card lines.
  // Collections are sorted newest-first in Shopify, so the default order is
  // date; customers get NEWEST / PRICE / A-Z sort chips on screen.
  // `plain` drops the handwritten name/count stickers and the taped
  // shopkeeper note on that shelf (admin toggle, per tab).
  boardTab: { enabled: false, label: "Board Games", collection: "board-games", plain: false },
  whTab: { enabled: false, label: "Warhammer", collection: "gamesworkshop", plain: false },
  shelfActive: false, // true while a generic shelf tab is on screen

  // What this screen calls its stock in on-screen copy ("Grabbing the
  // cards…", "ADD cards to a cart"). Blank = "cards"; a Warhammer or
  // board-game screen might say "products".
  itemWord: "",

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
  // Cap how many cards fit in a kiosk cart (0 = no limit). At the cap the
  // add buttons bounce with a "cart limit" warning.
  cartMax: 0,
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

// Default tab badges for the shelf tabs (rendered in-house, 56px WebP) —
// same treatment as the Dragon Shield badge; admin uploads override them.
export const BOARD_TAB_ICON = "data:image/webp;base64,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";
export const WH_TAB_ICON = "data:image/webp;base64,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";

export const DEFAULT_PIN = "4242";
