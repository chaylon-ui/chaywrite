"""Second pass, slower and narrower, on what the first pass left open.

Pass 1 (2026-09-04): warhammer.com search answered 405 to every GET;
upcitemdb hit 4 of 7 with GW's own copy and images, then said TOO_FAST at
1.2s spacing; Google Books answered 429 at once; Open Library returned HTML
from the /isbn/ shortcut. So this pass: the products upcitemdb never
answered, spaced 12s (its trial allows ~6/min); the two books through Open
Library's /api/books endpoint; Google Books with a pause and the body of any
refusal printed; and GW's own site via its sitemap, then one product page,
to see whether their pages carry a JSON-LD Product block at all.

Read-only. Nothing is written anywhere.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
UPC_LEFT = [
    ("5011921261635", "Warhammer Dice Set"),
    ("5011921153015", "Dark Angels Ravenwing Command Squad"),
    ("5011921217700", "Kill Team Approved Ops"),
    ("9781804573679", "General's Handbook"),
    ("9781804578063", "Combat Patrol Companion"),
]
ISBNS = ["9781804573679", "9781804578063"]


def get(url, accept="*/*", timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, dict(e.headers or {})
    except Exception as e:
        return "ERR " + type(e).__name__, b"", {}


def short(s, n=110):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s[:n] + ("..." if len(s) > n else "")


def text(b):
    return b.decode("utf-8", "replace")


def ldjson(html):
    out = []
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            j = json.loads(b)
        except Exception:
            continue
        for n in (j if isinstance(j, list) else [j]):
            if isinstance(n, dict):
                out.append(str(n.get("@type", "?")))
    return out


def warhammer():
    print("=== warhammer.com via sitemap")
    st, body, hdr = get("https://www.warhammer.com/sitemap.xml", "application/xml,text/xml,*/*")
    t = text(body)
    locs = re.findall(r"<loc>\s*(.*?)\s*</loc>", t)
    print("  sitemap.xml   %s %dKB server=%s locs=%d first=%s" % (
        st, len(body) // 1024, hdr.get("Server") or hdr.get("server"), len(locs), locs[:2]))
    prod_url = None
    for u in locs:
        if "/shop/" in u:
            prod_url = u
            break
    if not prod_url:
        for u in locs[:6]:
            if u.endswith(".xml"):
                time.sleep(2)
                s2, b2, _ = get(u, "application/xml,text/xml,*/*")
                sub = re.findall(r"<loc>\s*(.*?)\s*</loc>", text(b2))
                print("  child %s %s locs=%d" % (short(u, 60), s2, len(sub)))
                cand = [x for x in sub if "/shop/" in x]
                if cand:
                    prod_url = cand[0]
                    break
    if not prod_url:
        print("  no product URL found in sitemap")
        return
    time.sleep(2)
    st, body, hdr = get(prod_url, "text/html,application/xhtml+xml")
    t = text(body)
    desc = re.findall(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', t, re.I | re.S)
    print("  product page  %s %dKB %s" % (st, len(body) // 1024, short(prod_url, 80)))
    print("                ld+json types=%s meta-desc=%s" % (ldjson(t), short(desc[0], 90) if desc else "(none)"))
    if st != 200:
        print("                body: %s" % short(t, 160))


def openlibrary():
    print("=== openlibrary /api/books")
    keys = ",".join("ISBN:" + i for i in ISBNS)
    st, body, _ = get("https://openlibrary.org/api/books?bibkeys=%s&jscmd=data&format=json" % keys, "application/json")
    try:
        j = json.loads(text(body))
    except Exception:
        print("  %s (not json) %s" % (st, short(text(body), 100)))
        return
    for i in ISBNS:
        d = j.get("ISBN:" + i)
        if not d:
            print("  %s  %s  no record" % (st, i))
            continue
        print("  %s  %s  HIT title=%s | pages=%s | publishers=%s | subjects=%s" % (
            st, i, short(d.get("title"), 50), d.get("number_of_pages"),
            short([p.get("name") for p in d.get("publishers", [])], 40),
            short([s.get("name") for s in d.get("subjects", [])][:4], 70)))


def googlebooks():
    print("=== googlebooks (6s apart)")
    for i in ISBNS:
        time.sleep(6)
        st, body, hdr = get("https://www.googleapis.com/books/v1/volumes?q=isbn:" + i, "application/json")
        try:
            j = json.loads(text(body))
        except Exception:
            j = {}
        items = j.get("items") or []
        if st == 200 and items:
            v = items[0].get("volumeInfo") or {}
            print("  200  %s  HIT title=%s | pages=%s | desc=%s | thumb=%s" % (
                i, short(v.get("title"), 50), v.get("pageCount"), short(v.get("description"), 80),
                bool((v.get("imageLinks") or {}).get("thumbnail"))))
        else:
            err = (j.get("error") or {}) if isinstance(j, dict) else {}
            print("  %s  %s  total=%s reason=%s msg=%s" % (
                st, i, j.get("totalItems") if isinstance(j, dict) else None,
                short([e.get("reason") for e in err.get("errors", [])], 40), short(err.get("message"), 90)))


def upcitemdb():
    print("=== upcitemdb (12s apart)")
    hits = 0
    for n, (ean, name) in enumerate(UPC_LEFT):
        if n:
            time.sleep(12)
        st, body, _ = get("https://api.upcitemdb.com/prod/trial/lookup?upc=" + ean, "application/json")
        try:
            j = json.loads(text(body))
        except Exception:
            print("  %s  %s  (not json) %s" % (st, ean, short(text(body), 80)))
            continue
        items = j.get("items") or []
        if not items:
            print("  %s  %s  %-36s no-item code=%s" % (st, ean, name, j.get("code")))
            continue
        it = items[0]
        hits += 1
        print("  %s  %s  %-36s HIT title=%s | model=%s | category=%s | desc=%d chars | imgs=%d" % (
            st, ean, name, short(it.get("title"), 60), it.get("model"), short(it.get("category"), 40),
            len(it.get("description") or ""), len(it.get("images") or [])))
    print("  upcitemdb pass-2 hits: %d/%d" % (hits, len(UPC_LEFT)))


def main():
    for fn in (warhammer, openlibrary, googlebooks, upcitemdb):
        try:
            fn()
        except Exception as e:
            print("  EXC %s: %s" % (fn.__name__, e))
        print()
    print("GW-SOURCES-2 done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
