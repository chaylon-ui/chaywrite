"""Exercise the worker's read-only buylist proof of concept and print what
BinderPOS answers. Two GETs, nothing written anywhere:

  /buylist/poc/search?q=&game=   keyed buylist search - the first hits raw,
                                 so the card object's real field names and
                                 the per-variant buy prices are visible
  /buylist/poc/list              the owner's saved draft list, if the
                                 forMe endpoint answers a server-side caller
                                 at all (their app calls it from a browser)
"""
import json
import os
import sys
import urllib.parse
import urllib.request

W = "https://exor-binder.nevski.workers.dev"
Q = os.environ.get("Q", "Lightning Bolt")
GAME = os.environ.get("GAME", "mtg")


def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "buylist-poc-driver"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    st, body = get(W + "/buylist/poc/search?q=" + urllib.parse.quote(Q) + "&game=" + urllib.parse.quote(GAME))
    print("=== search  worker=%s" % st)
    try:
        j = json.loads(body)
    except Exception:
        print(body[:800]); j = {}
    print("  upstream=%s q=%r game=%r" % (j.get("upstream"), j.get("q"), j.get("game")))
    hits = j.get("hits")
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
    else:
        print("  hits: %s" % json.dumps(hits)[:800])

    st, body = get(W + "/buylist/poc/list")
    print("\n=== list  worker=%s" % st)
    try:
        j = json.loads(body)
    except Exception:
        print(body[:800]); j = {}
    print("  upstream=%s content-type=%s" % (j.get("upstream"), j.get("contentType")))
    lst = j.get("list")
    if isinstance(lst, list):
        print("  saved list: %d card(s)" % len(lst))
        for c in lst[:5]:
            print("    " + json.dumps(c)[:220])
    else:
        print("  list: %s" % json.dumps(lst)[:600])
    print("\nBUYLIST-POC done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
