"""What BinderPOS's own buylist app sends and receives.

portal.binderpos.com/shopify/js/buylist.js (22KB, jQuery) is the app that
runs inside the iframe. Before a proof of concept can save a draft list the
way the app does, we need, verbatim: every fetch it makes (URL, method,
body), the object it pushes into myBinderBuylist when a card is added, and
how it loads a saved list on open. Print the code around each, unminified
enough to read. Read-only.
"""
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASE = "https://portal.binderpos.com/shopify/js/"


def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def show(js, pattern, before, after, cap, label):
    print("\n=== %s ===" % label)
    n = 0
    for m in re.finditer(pattern, js):
        n += 1
        if n > cap:
            print("  (more, capped)")
            break
        seg = js[max(0, m.start() - before): m.start() + after]
        seg = re.sub(r"\s+", " ", seg)
        print("  [%d] ...%s..." % (n, seg))
    if not n:
        print("  (no match)")


def main():
    for name in ("buylist-search-helpers.js?v=4", "buylist.js?v=4"):
        js = get(BASE + name)
        print("##### %s  %d bytes" % (name, len(js)))
        show(js, r"fetch\(", 40, 420, 14, "every fetch( - URL, method, body")
        show(js, r"myBinderBuylist\.push\(", 900, 120, 3, "the object pushed when a card is added")
        show(js, r"currentSearchResults\s*=", 120, 260, 4, "where search results come from")
        show(js, r"function\s+(?:search|doSearch|searchCards|loadBuylist|getBuylist|populateList)\b", 20, 700, 6, "search / load functions")
        show(js, r"(?:cardId|variantId|productId|setName|condition|printing|foil|quantity|cashBuyPrice|storeCreditBuyPrice|imageUrl|game)\s*:", 60, 160, 12, "object literal fields")
        show(js, r"customerId\s*=", 80, 240, 3, "how customerId is obtained")
        show(js, r"baseUrl\s*=|storeId\s*=", 80, 200, 3, "baseUrl / storeId")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
