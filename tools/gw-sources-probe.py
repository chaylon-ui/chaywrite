"""Which public sources know anything about our Games Workshop stock?

Nine real products from the store (barcodes as they sit on the variants),
looked up against every keyless source that could plausibly carry product
details. Each line reports the HTTP status and, when something came back,
the fields worth having. Read-only; nothing is written anywhere.

Sources:
  warhammer.com  - GW's own shop. Search page and any JSON-LD Product blocks.
  upcitemdb      - keyless trial EAN lookup (100/day).
  openlibrary    - by ISBN, books only (already wired into the worker).
  googlebooks    - by ISBN, books only, keyless.
  wikidata       - wbsearchentities on the title.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

ITEMS = [
    ("5011921176557", "Nuln Oil", "paint"),
    ("5011921072927", "Citadel Plastic Glue", "tool"),
    ("5011921261635", "Warhammer Dice Set", "accessory"),
    ("5011921201853", "Skaventide", "box"),
    ("5011921153015", "Dark Angels Ravenwing Command Squad", "kit"),
    ("5011921241347", "Battle of Edoras", "box"),
    ("5011921217700", "Kill Team Approved Ops", "cards"),
    ("9781804573679", "General's Handbook", "book"),
    ("9781804578063", "Combat Patrol Companion", "book"),
]


def get(url, headers=None, timeout=30):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body
    except Exception as e:
        return "ERR " + type(e).__name__, b""


def short(s, n=110):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s[:n] + ("..." if len(s) > n else "")


def jsonld_products(html):
    out = []
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            j = json.loads(b)
        except Exception:
            continue
        nodes = j if isinstance(j, list) else [j]
        for n in nodes:
            if isinstance(n, dict) and "Product" in str(n.get("@type", "")):
                out.append(n)
    return out


def probe_warhammer(ean, name):
    q = urllib.parse.quote(name)
    st, body = get("https://www.warhammer.com/en-CA/search?query=" + q,
                   {"Accept": "text/html,application/xhtml+xml"})
    html = body.decode("utf-8", "replace")
    prods = jsonld_products(html)
    hit = name.lower().split()[0] in html.lower()
    api = re.findall(r'https?://[a-z0-9.\-]*(?:algolia|api)[a-z0-9.\-/]*', html, re.I)[:2]
    return "%s %dKB name-in-page=%s ld+json-products=%d api-hints=%s" % (
        st, len(body) // 1024, hit, len(prods), api)


def probe_upcitemdb(ean, name):
    st, body = get("https://api.upcitemdb.com/prod/trial/lookup?upc=" + ean,
                   {"Accept": "application/json"})
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return "%s (not json) %s" % (st, short(body, 80))
    items = j.get("items") or []
    if not items:
        return "%s no-item code=%s msg=%s" % (st, j.get("code"), short(j.get("message"), 60))
    it = items[0]
    return "%s HIT title=%s | brand=%s | desc=%s | imgs=%d" % (
        st, short(it.get("title"), 60), it.get("brand"), short(it.get("description"), 90),
        len(it.get("images") or []))


def probe_openlibrary(ean, name):
    st, body = get("https://openlibrary.org/isbn/%s.json" % ean, {"Accept": "application/json"})
    if st != 200:
        return "%s" % st
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return "%s (not json)" % st
    return "%s HIT title=%s | pages=%s | publishers=%s | subjects=%s" % (
        st, short(j.get("title"), 50), j.get("number_of_pages"),
        short(j.get("publishers"), 40), short(j.get("subjects"), 60))


def probe_googlebooks(ean, name):
    st, body = get("https://www.googleapis.com/books/v1/volumes?q=isbn:" + ean, {"Accept": "application/json"})
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return "%s (not json)" % st
    items = j.get("items") or []
    if not items:
        return "%s no-item total=%s" % (st, j.get("totalItems"))
    v = items[0].get("volumeInfo") or {}
    return "%s HIT title=%s | pages=%s | desc=%s | thumb=%s" % (
        st, short(v.get("title"), 50), v.get("pageCount"), short(v.get("description"), 80),
        bool((v.get("imageLinks") or {}).get("thumbnail")))


def probe_wikidata(ean, name):
    st, body = get("https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=3&search="
                   + urllib.parse.quote(name), {"Accept": "application/json"})
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except Exception:
        return "%s (not json)" % st
    hits = [(h.get("label"), short(h.get("description"), 50)) for h in (j.get("search") or [])]
    return "%s %s" % (st, hits or "no-hit")


SOURCES = [
    ("warhammer.com", probe_warhammer, None),
    ("upcitemdb", probe_upcitemdb, None),
    ("openlibrary", probe_openlibrary, "book"),
    ("googlebooks", probe_googlebooks, "book"),
    ("wikidata", probe_wikidata, None),
]


def main():
    tally = {}
    for ean, name, kind in ITEMS:
        print("=== %s  %s  [%s]" % (ean, name, kind))
        for sname, fn, only in SOURCES:
            if only and kind != only:
                continue
            try:
                line = fn(ean, name)
            except Exception as e:
                line = "EXC %s %s" % (type(e).__name__, e)
            print("  %-14s %s" % (sname, line))
            t = tally.setdefault(sname, [0, 0])
            t[1] += 1
            if "HIT" in line or "name-in-page=True" in line:
                t[0] += 1
            time.sleep(1.2)
        print()
    print("GW-SOURCES " + "  ".join("%s=%d/%d" % (k, v[0], v[1]) for k, v in tally.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
