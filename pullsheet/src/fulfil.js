/**
 * Shopify fulfilment actions for the pull sheet.
 *
 * Packing an order drives Shopify instead of only tagging it:
 *   pickup orders  -> fulfillmentOrderLineItemsPreparedForPickup ("Ready for pickup",
 *                     customer notified by Shopify)
 *   shipped orders -> fulfillmentCreate (optional, Staff & settings), with the
 *                     tracking number typed at pack time; refunded and
 *                     quarantined cards are left out of the fulfilment
 *   quarantine     -> fulfillmentOrderHold / fulfillmentOrderReleaseHold, so the
 *                     order shows "On hold" in the admin
 *
 * Every call needs the merchant-managed fulfillment orders scope on the app.
 * Without it Shopify answers "access denied"; callers fall back to tags and
 * say so, nothing breaks.
 */

const errText = (r, key) => {
  const ue = (r && r.data && r.data[key] && r.data[key].userErrors) || [];
  const ge = (r && r.errors) || [];
  return [...ue.map((e) => e.message), ...ge.map((e) => e.message)].filter(Boolean);
};
export const isScopeError = (msgs) => (msgs || []).some((m) => /access denied|access scope|scope/i.test(m));

// The order's fulfillment orders with what is still open on each line.
export async function fetchFulfillmentOrders(env, shopQuery, gid) {
  const q = `query($id:ID!){ order(id:$id){ fulfillmentOrders(first:10){ edges{ node{ id status requestStatus deliveryMethod{ methodType }
    fulfillmentHolds { id reason }
    lineItems(first:100){ edges{ node{ id remainingQuantity lineItem{ sku variant{ id } } } } } } } } } }`;
  const r = await shopQuery(env, q, { id: gid });
  const o = r && r.data && r.data.order;
  if (!o || !o.fulfillmentOrders) {
    const msgs = errText(r, 'order');
    return { fos: [], error: msgs.length ? msgs.join(' | ') : 'no fulfillment orders returned', scope: isScopeError(msgs) };
  }
  const fos = (o.fulfillmentOrders.edges || []).map((e) => e.node).filter(Boolean).map((n) => ({
    id: n.id, status: String(n.status || '').toUpperCase(), requestStatus: n.requestStatus || '',
    methodType: String((n.deliveryMethod && n.deliveryMethod.methodType) || '').toUpperCase(),
    held: ((n.fulfillmentHolds || []).length > 0),
    lines: ((n.lineItems && n.lineItems.edges) || []).map((x) => x.node).filter(Boolean).map((li) => ({
      id: li.id, remaining: +li.remainingQuantity || 0,
      sku: (li.lineItem && li.lineItem.sku) || '', variantId: String((li.lineItem && li.lineItem.variant && li.lineItem.variant.id) || '').replace(/\D+/g, ''),
    })),
  }));
  return { fos, error: '' };
}
export const openFos = (fos) => (fos || []).filter((f) => ['OPEN', 'IN_PROGRESS', 'SCHEDULED', 'ON_HOLD'].includes(f.status) && f.lines.some((l) => l.remaining > 0));

export async function markReadyForPickup(env, shopQuery, foIds) {
  const r = await shopQuery(env, `mutation($input:FulfillmentOrderLineItemsPreparedForPickupInput!){ fulfillmentOrderLineItemsPreparedForPickup(input:$input){ userErrors{ field message } } }`,
    { input: { lineItemsByFulfillmentOrder: foIds.map((id) => ({ fulfillmentOrderId: id })) } });
  const msgs = errText(r, 'fulfillmentOrderLineItemsPreparedForPickup');
  return { ok: !!(r && r.data && r.data.fulfillmentOrderLineItemsPreparedForPickup) && !msgs.length, errors: msgs, scope: isScopeError(msgs) };
}

// What to fulfil: every open line, minus the quantities we are not sending
// (refunded or quarantined cards), keyed by SKU.
export function planShipment(fos, excludeBySku) {
  const ex = { ...(excludeBySku || {}) };
  const out = [];
  for (const f of openFos(fos)) {
    const items = [];
    for (const l of f.lines) {
      let q = l.remaining;
      if (l.sku && ex[l.sku] > 0) { const d = Math.min(q, ex[l.sku]); q -= d; ex[l.sku] -= d; }
      if (q > 0) items.push({ id: l.id, quantity: q });
    }
    if (items.length) out.push({ fulfillmentOrderId: f.id, fulfillmentOrderLineItems: items });
  }
  return out;
}

export async function createFulfillment(env, shopQuery, { byFo, tracking, notify = true }) {
  if (!byFo || !byFo.length) return { ok: false, errors: ['nothing to fulfil'], scope: false };
  const f = { lineItemsByFulfillmentOrder: byFo, notifyCustomer: !!notify };
  if (tracking && tracking.number) f.trackingInfo = { number: String(tracking.number).trim(), ...(tracking.company ? { company: String(tracking.company) } : {}) };
  const r = await shopQuery(env, `mutation($f:FulfillmentInput!){ fulfillmentCreate(fulfillment:$f){ fulfillment{ id status } userErrors{ field message } } }`, { f });
  const msgs = errText(r, 'fulfillmentCreate');
  const made = r && r.data && r.data.fulfillmentCreate && r.data.fulfillmentCreate.fulfillment;
  return { ok: !!made && !msgs.length, id: made ? made.id : '', errors: msgs, scope: isScopeError(msgs) };
}

export async function setHold(env, shopQuery, foId, on, note) {
  const r = on
    ? await shopQuery(env, `mutation($id:ID!,$h:FulfillmentOrderHoldInput!){ fulfillmentOrderHold(id:$id, fulfillmentHold:$h){ userErrors{ field message } } }`, { id: foId, h: { reason: 'OTHER', reasonNotes: String(note || 'Pull sheet quarantine').slice(0, 250), notifyMerchant: false } })
    : await shopQuery(env, `mutation($id:ID!){ fulfillmentOrderReleaseHold(id:$id){ userErrors{ field message } } }`, { id: foId });
  const msgs = errText(r, on ? 'fulfillmentOrderHold' : 'fulfillmentOrderReleaseHold');
  return { ok: !msgs.length && !!(r && r.data), errors: msgs, scope: isScopeError(msgs) };
}
