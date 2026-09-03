#!/usr/bin/env python3
"""Can we actually fill author/publisher/demographic/status/volumes for manga?

Two candidate sources, both free and unauthenticated, both BATCHED - the
Wikidata probe took 20 minutes because it fetched documents one at a time.

  Open Library  /api/books?bibkeys=ISBN:a,ISBN:b,...   -> author, publisher
  AniList       one GraphQL doc with aliased Media()   -> demographic, status,
                                                          volumes

Also answers a second question: the series names we derived from our own titles
carry trade-format shorthand ("Akame Ga Kill Gn", "... Sc Novel") and
inconsistent punctuation ("Amazing Spider-man Beyond" vs "Amazing Spiderman
Beyond" - the same series, split in two). So every series is searched BOTH raw
and cleaned, and the two hit rates are reported separately. If cleaning wins,
that is a fix to make before filling anything.
"""
import json, re, sys, urllib.parse, urllib.request

UA = "ExorGamesCatalogue/1.0 (+https://exorgames.com) coverage-probe"

# series name -> one representative ISBN, straight out of the catalogue
SAMPLE = [
    ("2.5 Dimensional Seduction", "9798888436318"),
    ("7Th Loop Villainess Carefree Life Sc Novel", "9781638588580"),
    ("A Condition Called Love", "9781646518104"),
    ("A Man and His Cat", "9781646092468"),
    ("A Sign of Affection", "9798888771938"),
    ("A Starlit Darkness", "9781646094851"),
    ("A White Rose in Bloom", "9798888432068"),
    ("A-do", "9781646519323"),
    ("Accomplishments of Dukes Daughter Novel Sc", "9781638588597"),
    ("Akame Ga Kill Gn", "9780316340076"),
    ("Akame Ga Kill Zero Gn", "9780316397865"),
    ("Akane-banashi", "9781974745753"),
    ("Alpha Wolfgirl X Omega Wolfboy", "9798891602120"),
    ("Always a Catch!", "9781646094202"),
    ("Amazing Spider-man Beyond", "9781302932572"),
    ("Amazing Spiderman Beyond", "9781302932114"),
    ("Ancient Magus Bride", "9781626921870"),
    ("Ancient Magus' Bride Wizard's Blue", "9798888433850"),
    ("Animal Crossing: New Horizons", "9781974752058"),
    ("Anyway, I'm Falling in Love with You", "9798888771167"),
    ("Archie vs Predator Ii", "9781645769835"),
    ("Assassin & Cinderella", "9781646093496"),
    ("Assassination Classroom", "9781421576077"),
    ("A Man and His Cat", "9781646092468"),
]

# Trade-format shorthand the distributor puts in titles. "Gn" = graphic novel,
# "Sc"/"Hc" = soft/hardcover, "Tp" = trade paperback, "Ln" = light novel.
FORMAT_TAIL = re.compile(r"\b(gn|sc|hc|tp|tpb|ln|novel|manga|omnibus)\b", re.I)

def clean_series(s):
    s = FORMAT_TAIL.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip(" -,:")

def series_key(s):
    """Punctuation-insensitive slug: Spider-man and Spiderman collapse to one."""
    s = clean_series(s).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s

def post_json(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

DEMOS = {"shounen": "Shonen", "shoujo": "Shojo", "seinen": "Seinen", "josei": "Josei"}

ANILIST_Q = """query {
%s
}"""
ALIAS = ('  a%d: Media(search: %s, type: MANGA) { '
         'title { romaji english } volumes status '
         'tags { name } staff(perPage: 2) { edges { role node { name { full } } } } }')

def anilist(names):
    """One request, many aliased Media lookups."""
    out = {}
    for start in range(0, len(names), 8):
        chunk = names[start:start + 8]
        body = "\n".join(ALIAS % (start + i, json.dumps(n)) for i, n in enumerate(chunk))
        try:
            res = post_json("https://graphql.anilist.co", {"query": ANILIST_Q % body})
        except Exception as e:
            print("  anilist batch failed: %s" % e)
            continue
        data = res.get("data") or {}
        for i, n in enumerate(chunk):
            out[n] = data.get("a%d" % (start + i))
    return out

def demographic_of(media):
    for t in (media or {}).get("tags") or []:
        d = DEMOS.get(str(t.get("name", "")).lower())
        if d:
            return d
    return None

def openlibrary(isbns):
    keys = ",".join("ISBN:" + i for i in isbns)
    url = ("https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys="
           + urllib.parse.quote(keys, safe=":,"))
    try:
        return get_json(url)
    except Exception as e:
        print("  openlibrary failed: %s" % e)
        return {}

def main():
    seen, pairs = set(), []
    for name, isbn in SAMPLE:
        if name in seen:
            continue
        seen.add(name)
        pairs.append((name, isbn))

    print("=== Open Library: one batched call for %d ISBNs ===" % len(pairs))
    ol = openlibrary([i for _, i in pairs])
    print("    returned %d of %d\n" % (len(ol), len(pairs)))

    raw_names = [n for n, _ in pairs]
    clean_names = [clean_series(n) for n, _ in pairs]
    print("=== AniList: aliased Media() batches, raw names then cleaned ===")
    a_raw = anilist(raw_names)
    a_clean = anilist(clean_names)
    print()

    n = len(pairs)
    has_author = has_pub = 0
    hit_raw = hit_clean = has_demo = has_vols = 0
    for name, isbn in pairs:
        rec = ol.get("ISBN:" + isbn) or {}
        authors = ", ".join(a.get("name", "") for a in rec.get("authors") or [])
        pubs = ", ".join(p.get("name", "") for p in rec.get("publishers") or [])
        if authors: has_author += 1
        if pubs: has_pub += 1

        mr = a_raw.get(name)
        mc = a_clean.get(clean_series(name))
        if mr: hit_raw += 1
        if mc: hit_clean += 1
        m = mc or mr
        demo = demographic_of(m)
        vols = (m or {}).get("volumes")
        if demo: has_demo += 1
        if vols: has_vols += 1

        mark = "OK " if m else "-- "
        print("%s%-42s" % (mark, name[:42]))
        print("      OL author=%-26s publisher=%s" % ((authors or "-")[:26], (pubs or "-")[:34]))
        if m:
            t = (m.get("title") or {})
            print("      AL %-30s status=%-10s vols=%-4s demo=%s"
                  % ((t.get("english") or t.get("romaji") or "?")[:30],
                     m.get("status") or "-", vols if vols else "-", demo or "-"))
        print("      key=%s" % series_key(name))

    pct = lambda k: "%d/%d (%.0f%%)" % (k, n, 100.0 * k / n)
    print("\n" + "=" * 78)
    print("OPENLIB   author %s   publisher %s" % (pct(has_author), pct(has_pub)))
    print("ANILIST   raw-name match %s   cleaned-name match %s" % (pct(hit_raw), pct(hit_clean)))
    print("ANILIST   demographic %s   volumes_total %s" % (pct(has_demo), pct(has_vols)))
    ks = {}
    for name, _ in pairs:
        ks.setdefault(series_key(name), []).append(name)
    merged = {k: v for k, v in ks.items() if len(v) > 1}
    print("SERIES_KEY collapses %d name pair(s): %s" % (len(merged), merged or "none"))

if __name__ == "__main__":
    sys.exit(main())
