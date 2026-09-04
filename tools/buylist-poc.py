"""Exercise the worker's buylist proof of concept and print what BinderPOS
answers.

  /buylist/poc/search?q=&game=   unkeyed buylist search - the first hits raw,
                                 so the card object's real field names and
                                 the per-variant buy prices are visible
  /buylist/poc/save              DO_SAVE=yes only: ONE card, built from the
                                 first hit exactly the way BinderPOS's own
                                 app builds it, saved into the OWNER's own
                                 draft list (approved by the owner
                                 2026-09-04). Nothing is ever submitted.
  /buylist/poc/list              the owner's saved draft list, read back
"""
import json
import os
import sys
import urllib.parse
import urllib.request

W = "https://exor-binder.nevski.workers.dev"
Q = os.environ.get("Q", "Lightning Bolt")
GAME = os.environ.get("GAME", "mtg")
DO_SAVE = os.environ.get("DO_SAVE", "no").strip().lower() == "yes"


def call(url, data=None):
    hdrs = {"Accept": "application/json", "User-Agent": "buylist-poc-driver"}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=hdrs, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def parse(body):
    try:
        return json.loads(body)
    except Exception:
        print(body[:800])
        return {}


def card_from_hit(h):
    """The saved-card object BinderPOS's app builds from a search hit e, a
    variant n and that variant's cardBuylistTypes entry p."""
    for n in h.get("variants") or []:
        for p in n.get("cardBuylistTypes") or []:
            return {
                "cardId": h.get("id"),
                "cardName": h.get("cardName"),
                "setName": h.get("setName"),
                "game": h.get("game"),
                "type": p.get("type"),
                "imageUrl": h.get("imageUrl"),
                "quantity": "1",
                "cashBuyPrice": p.get("buyPrice"),
                "storeCreditBuyPrice": p.get("creditBuyPrice"),
                "condition": n.get("id"),
                "conditionName": n.get("variantName"),
                "shopifyVariantId": p.get("productVariantId"),
            }
    return None


def show_list():
    st, body = call(W + "/buylist/poc/list")
    print("\n=== list  worker=%s" % st)
    j = parse(body)
    print("  upstream=%s content-type=%s" % (j.get("upstream"), j.get("contentType")))
    lst = j.get("list")
    if isinstance(lst, list):
        print("  saved list: %d card(s)" % len(lst))
        for c in lst[:5]:
            print("    " + json.dumps(c)[:220])
    else:
        print("  list: %s" % json.dumps(lst)[:600])


def main():
    st, body = call(W + "/buylist/poc/search?q=" + urllib.parse.quote(Q) + "&game=" + urllib.parse.quote(GAME))
    print("=== search  worker=%s" % st)
    j = parse(body)
    print("  upstream=%s q=%r game=%r" % (j.get("upstream"), j.get("q"), j.get("game")))
    hits = j.get("hits")
    card = None
    if isinstance(hits, list) and hits:
        h = hits[0]
        print("  hit[0] keys: %s" % sorted(h.keys())[:30])
        for k in ("id", "cardName", "name", "title", "setName", "game", "imageUrl", "cardTypes"):
            if k in h:
                print("    %-10s %s" % (k, json.dumps(h[k])[:120]))
        vs = h.get("variants") or []
        print("  variants: %d shown" % len(vs))
        for v in vs[:2]:
            print("    variant keys: %s" % sorted(v.keys())[:25])
            for k in ("id", "variantName", "title", "condition", "cardBuylistTypes"):
                if k in v:
                    print("      %-16s %s" % (k, json.dumps(v[k])[:300]))
        card = card_from_hit(h)
    else:
        print("  hits: %s" % json.dumps(hits)[:800])

    if DO_SAVE:
        print("\n=== save (owner's own draft list)")
        if not card:
            print("  no card could be built from the first hit - nothing saved")
        else:
            print("  card: " + json.dumps(card))
            st, body = call(W + "/buylist/poc/save", {"cards": [card]})
            print("  worker=%s" % st)
            j = parse(body)
            print("  upstream=%s content-type=%s sent=%s" % (j.get("upstream"), j.get("contentType"), j.get("sent")))
            print("  reply: %s" % json.dumps(j.get("reply"))[:800])

    show_list()
    print("\nBUYLIST-POC done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
