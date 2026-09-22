/* Which orders count as Deck Builder sales (src/room.js op=orders).
   Order #205473 (2026-09-22) carried the cart attribute "Deck Builder:
   Magic: The Gathering, 1 card, $4.95" but held only a sealed preorder: the
   shopper had added a card from the Deck Builder, dropped it, and the cart
   attribute outlived the line. So:
     1. Lines the Deck Builder added carry the line property _deck=1
        (public/deck-builder.js). An order with such lines counts, and its
        Deck Builder value is the sum of THOSE lines only.
     2. Orders from before that property (attribute only) count only when at
        least one line is a single (productType with "single"); a sealed-only
        cart with a stale attribute does not. The whole order value counts,
        as before, since the lines cannot be told apart. */
const money = (set) => Math.round(parseFloat((set && set.shopMoney && set.shopMoney.amount) || "0") * 100);
export function deckSaleOf(nd) {
  if (!nd) return null;
  const lines = (nd.lineItems && nd.lineItems.nodes) || [];
  const tagged = lines.filter((li) => (li.customAttributes || []).some((a) => a && a.key === "_deck"));
  const tag = (nd.customAttributes || []).find((a) => a && a.key === "Deck Builder");
  let mode, cents;
  if (tagged.length) { mode = "lines"; cents = tagged.reduce((a, li) => a + money(li.originalTotalSet), 0); }
  else if (tag && lines.some((li) => /single/i.test(String((li.product && li.product.productType) || "")))) { mode = "legacy"; cents = money(nd.totalPriceSet); }
  else return null;
  return {
    name: nd.name, at: nd.createdAt, status: nd.displayFinancialStatus || "", cents, mode,
    tag: String((tag && tag.value) || "").slice(0, 90),
    items: lines.slice(0, 40).map((li) => ({ t: String(li.title || "").slice(0, 90), q: li.quantity | 0, d: tagged.includes(li) ? 1 : 0 })),
  };
}
