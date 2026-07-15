/* Offline fallback deck — used only when /cards.json is unreachable.
   Shape matches the worker feed: window.BINDER_CARDS is an array of card
   objects with a COLOR_NAME map attached. Images are null on purpose so the
   pages render their generated card frames without any network. */
(function () {
  var cards = [
    { name: "Smothering Tithe", color: "W", set: "Ravnica Allegiance", type: "Enchantment", price: "42.50", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Esper Sentinel", color: "W", set: "Modern Horizons 2", type: "Creature", price: "38.00", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Solitude", color: "W", set: "Modern Horizons 2", type: "Creature", price: "34.75", foil: true, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Rhystic Study", color: "U", set: "Prophecy", type: "Enchantment", price: "55.00", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Force of Negation", color: "U", set: "Modern Horizons", type: "Instant", price: "48.25", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Mystic Remora", color: "U", set: "Ice Age", type: "Enchantment", price: "18.00", foil: false, condition: "Moderately Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Demonic Tutor", color: "B", set: "Revised Edition", type: "Sorcery", price: "68.90", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Dark Confidant", color: "B", set: "Ravnica", type: "Creature", price: "44.10", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Bolas's Citadel", color: "B", set: "War of the Spark", type: "Artifact", price: "12.25", foil: true, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Ragavan, Nimble Pilferer", color: "R", set: "Modern Horizons 2", type: "Creature", price: "62.00", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Dockside Extortionist", color: "R", set: "Commander 2019", type: "Creature", price: "52.40", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Blood Moon", color: "R", set: "Modern Masters", type: "Enchantment", price: "22.60", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Craterhoof Behemoth", color: "G", set: "Avacyn Restored", type: "Creature", price: "46.30", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Sylvan Library", color: "G", set: "Legends", type: "Enchantment", price: "39.95", foil: false, condition: "Moderately Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Doubling Season", color: "G", set: "Ravnica", type: "Enchantment", price: "58.75", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Atraxa, Praetors' Voice", color: "M", set: "Commander 2016", type: "Creature", price: "24.50", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Kaalia of the Vast", color: "M", set: "Commander", type: "Creature", price: "28.80", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Niv-Mizzet, Parun", color: "M", set: "Guilds of Ravnica", type: "Creature", price: "11.40", foil: true, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Mana Crypt", color: "C", set: "Eternal Masters", type: "Artifact", price: "185.00", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Sensei's Divining Top", color: "C", set: "Champions of Kamigawa", type: "Artifact", price: "32.20", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "The One Ring", color: "C", set: "Tales of Middle-earth", type: "Artifact", price: "89.00", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Wurmcoil Engine", color: "C", set: "Scars of Mirrodin", type: "Artifact", price: "14.90", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Cavern of Souls", color: "C", set: "Avacyn Restored", type: "Land", price: "51.60", foil: false, condition: "Lightly Played", image: null, variantId: null, url: "https://exorgames.com" },
    { name: "Fetid Heath", color: "C", set: "Eventide", type: "Land", price: "16.70", foil: false, condition: "Near Mint", image: null, variantId: null, url: "https://exorgames.com" },
  ];
  cards.COLOR_NAME = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", M: "Multicolor", C: "Colorless" };
  window.BINDER_CARDS = cards;
  window.BINDER_VERSION = "sample";
})();
