import { test } from "node:test";
import assert from "node:assert/strict";
import { buylistWhere, listBuylists, cardQuery, resetDetailRel, DETAIL_RELS } from "../src/portal.js";

/* The buylists list and its search by card name (owner, 2026-10-28:
   "can we add search by card name as well"). BinderPOS's GraphQL has
   introspection off, so the buylist -> lines relation name is found by
   trying the likely names; the one the API takes is remembered. */

test("buylistWhere: the stage, the window and the card filter", () => {
  assert.deepEqual(buylistWhere({ status: "pending" }).where, { approved: { equals: false }, completed: { equals: false }, dateSubmitted: { not: null } });
  assert.deepEqual(buylistWhere({ status: "completed", since: "2026-01-01" }).where, { completed: { equals: true }, dateCompleted: { not: null, gte: "2026-01-01" } });
  assert.equal(buylistWhere({ status: "nope" }).st, "pending");
  const w = buylistWhere({ status: "approved", card: "Charizard", rel: "ShopifyCustomerBuylistDetail" }).where;
  assert.deepEqual(w.ShopifyCustomerBuylistDetail, { some: { cardName: { contains: "Charizard" } } });
  assert.equal(buylistWhere({ status: "approved", card: "Charizard" }).where.ShopifyCustomerBuylistDetail, undefined, "no relation name, no filter");
  assert.equal(cardQuery('  Jace, "the" \\ Mind\u0000Sculptor  '), "Jace, the Mind Sculptor");
  assert.equal(cardQuery("x".repeat(100)).length, 80);
});

const ROW = { id: 91, dateSubmitted: "2026-10-20T10:00:00Z", dateApproved: null, dateCompleted: null, paymentType: "Cash", approved: false, completed: false,
  ShopifyCustomer: { firstName: "A", lastName: "B", email: "a@x.test" } };

test("search by card name: the relation name is found by trying, then remembered; rows carry the matching lines", async () => {
  resetDetailRel();
  const calls = [];
  const gqlFn = async (env, query, vars) => {
    calls.push({ query, vars });
    const rel = Object.keys(vars.where).find((k) => DETAIL_RELS.includes(k)) || null;
    if (rel === DETAIL_RELS[0]) throw new Error('BinderPOS GraphQL: Field "' + rel + '" is not defined by type "ShopifyCustomerBuylistWhereInput". Did you mean "' + DETAIL_RELS[1] + '"?');
    assert.equal(rel, DETAIL_RELS[1]);
    assert.ok(query.includes(rel + '(where: { cardName: { contains: "Charizard" } }) { cardName setName quantity cashBuyPrice storeCreditBuyPrice }'), "the matching lines are selected on each row");
    assert.deepEqual(vars.where[rel], { some: { cardName: { contains: "Charizard" } } });
    return { ShopifyCustomerBuylist: [{ ...ROW, [rel]: [{ cardName: "Charizard VMAX", setName: "Darkness Ablaze", quantity: 2, cashBuyPrice: "40", storeCreditBuyPrice: "52.5" }] }] };
  };
  const out = await listBuylists({}, { status: "pending", card: "Charizard", take: 50 }, gqlFn);
  assert.equal(calls.length, 2, "the first name was refused, the second taken");
  assert.equal(out.card, "Charizard");
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].id, "91"); assert.equal(out.rows[0].customer.name, "A B");
  assert.deepEqual(out.rows[0].hits, [{ name: "Charizard VMAX", set: "Darkness Ablaze", qty: 2, cash: 40, credit: 52.5 }]);
  // remembered: the next search goes straight to the name that worked
  calls.length = 0;
  await listBuylists({}, { status: "pending", card: "Pikachu" }, async (env, query, vars) => { calls.push(vars); return { ShopifyCustomerBuylist: [] }; });
  assert.equal(calls.length, 1); assert.ok(calls[0].where[DETAIL_RELS[1]]);
  // a plain list never touches the relation and has no hits field
  calls.length = 0;
  const plain = await listBuylists({}, { status: "completed" }, async (env, query, vars) => { calls.push(vars); assert.ok(!Object.keys(vars.where).some((k) => DETAIL_RELS.includes(k))); return { ShopifyCustomerBuylist: [ROW] }; });
  assert.equal(plain.card, null); assert.equal("hits" in plain.rows[0], false);
  // an error that is not about the schema (sign-in, HTTP) is thrown as is
  resetDetailRel();
  await assert.rejects(listBuylists({}, { card: "x" }, async () => { throw new Error("BinderPOS /graphql answered 502"); }), /502/);
  // every name refused: the last refusal is the error
  resetDetailRel();
  await assert.rejects(listBuylists({}, { card: "x" }, async () => { throw new Error('Field "z" is not defined by type "ShopifyCustomerBuylistWhereInput"'); }), /not defined/);
});
