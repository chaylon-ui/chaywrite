#!/usr/bin/env python3
"""Fill exor.demographic / series_status / volumes_total from AniList.

Why this runs on a GitHub runner instead of in the worker, where the rest
of the enrichment lives: AniList blocks Cloudflare Workers' shared egress
range outright. Measured side by side, bgg-probe run 33799658686:

    from a GitHub runner : HTTP 200  {"a0":{"volumes":34,"status":"FINISHED"}}
    from the worker      : HTTP 403  "You have been manually blocked.
                                      Please come to the principal's office."

Nothing was wrong with the query. Workers pool their outbound IPs across
every customer, so one abuser gets the whole range banned. The Open Library
half of the enrichment is unaffected and stays in the worker.

Shape: AniList data is per-SERIES, so this reads the distinct exor.series
values off the catalogue, looks each up ONCE, and writes the result to
every product in that series. A few hundred lookups covers ~1,900 books.

Idempotent and stateless. It rewrites the same values every run, which
keeps volume counts fresh as ongoing series publish, and needs no cursor
or cache to resume - a failed run is simply re-run.
"""
import json, os, sys, time, urllib.error, urllib.request

SHOP = os.environ.get("SHOPIFY_SHOP", "most-wanted-ca.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ADMIN_TOKEN", "")
API = "2025-01"
UA = "ExorGamesCatalogue/1.0 (+https://exorgames.com)"
DRY = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
LIMIT_SERIES = int(os.environ.get("LIMIT_SERIES", "0") or 0)

AL_URL = "https://graphql.anilist.co"
AL_CHUNK = 8          # aliased Media() lookups per GraphQL document
AL_GAP = 0.8          # AniList allows ~90 requests a minute
SET_CHUNK = 25        # metafieldsSet accepts 25 metafields per call

DEMOS = {"shounen": "Shonen", "shoujo": "Shojo", "seinen": "Seinen", "josei": "Josei"}
STATUS = {"RELEASING": "Ongoing", "FINISHED": "Completed", "HIATUS": "Hiatus",
          "CANCELLED": "Cancelled", "NOT_YET_RELEASED": "Upcoming"}


def post(url, payload, headers, tries=4):
    body = json.dumps(payload).encode()
    for attempt in range(tries):
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                wait = 60 if e.code == 429 else 3 * (attempt + 1)
                print("  HTTP %d, waiting %ds" % (e.code, wait))
                time.sleep(wait)
                continue
            raise
        except Exception:
            if attempt < tries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise


def shopify(query, variables=None):
    return post("https://%s/admin/api/%s/graphql.json" % (SHOP, API),
                {"query": query, "variables": variables or {}},
                {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN, "User-Agent": UA})


PRODUCT_PAGE = """query($q:String!,$after:String){
  products(first:250, query:$q, sortKey:ID, after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{
      id
      series: metafield(namespace:"exor", key:"series"){ value }
    }
  }
}"""

SET = """mutation($mf:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$mf){ userErrors{ field message } }
}"""


def read_catalogue():
    """-> { series name: [product gid, ...] }"""
    by_series, after, pages = {}, None, 0
    while True:
        r = shopify(PRODUCT_PAGE, {"q": "product_type:Books AND status:active", "after": after})
        if "errors" in r and r.get("errors"):
            raise SystemExit("Shopify: " + json.dumps(r["errors"])[:300])
        pr = r["data"]["products"]
        for n in pr["nodes"]:
            s = (n.get("series") or {}).get("value") if n.get("series") else None
            if s:
                by_series.setdefault(s.strip(), []).append(n["id"])
        pages += 1
        if not pr["pageInfo"]["hasNextPage"]:
            break
        after = pr["pageInfo"]["endCursor"]
    print("read %d pages, %d distinct series, %d products with a series"
          % (pages, len(by_series), sum(len(v) for v in by_series.values())))
    return by_series


ALIAS = ('a%d: Media(search: %s, type: MANGA) { volumes status tags { name } '
         'staff(perPage: 2) { edges { node { name { full } } } } }')


def read_media(m):
    if not m:
        return None
    demo = ""
    for t in m.get("tags") or []:
        d = DEMOS.get(str(t.get("name", "")).lower())
        if d:
            demo = d
            break
    author = ""
    for e in ((m.get("staff") or {}).get("edges") or []):
        full = (((e or {}).get("node") or {}).get("name") or {}).get("full")
        if full:
            author = full
            break
    vols = m.get("volumes")
    out = {"demographic": demo, "status": STATUS.get(str(m.get("status") or ""), ""),
           "volumes": vols if isinstance(vols, int) and vols > 0 else None, "author": author}
    return out if (out["demographic"] or out["status"] or out["volumes"]) else None


def anilist(names):
    found, misses = {}, 0
    for i in range(0, len(names), AL_CHUNK):
        chunk = names[i:i + AL_CHUNK]
        doc = "query {\n" + "\n".join(
            ALIAS % (i + k, json.dumps(n)) for k, n in enumerate(chunk)) + "\n}"
        try:
            r = post(AL_URL, {"query": doc},
                     {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
        except Exception as e:
            print("  anilist batch %d failed: %s" % (i, e))
            continue
        data = r.get("data") or {}
        for k, n in enumerate(chunk):
            v = read_media(data.get("a%d" % (i + k)))
            if v:
                found[n] = v
            else:
                misses += 1
        time.sleep(AL_GAP)
        if (i // AL_CHUNK) % 10 == 0:
            print("  ...%d/%d series looked up" % (min(i + AL_CHUNK, len(names)), len(names)))
    print("anilist matched %d of %d series (%d without usable data)"
          % (len(found), len(names), misses))
    return found


def mf(owner, key, typ, value):
    return {"ownerId": owner, "namespace": "exor", "key": key, "type": typ, "value": str(value)}


def write(pairs):
    """pairs: list of metafield dicts. Returns how many were written."""
    if DRY:
        print("DRY_RUN: would write %d metafields" % len(pairs))
        return 0
    wrote = 0
    for i in range(0, len(pairs), SET_CHUNK):
        chunk = pairs[i:i + SET_CHUNK]
        r = shopify(SET, {"mf": chunk})
        errs = (((r.get("data") or {}).get("metafieldsSet") or {}).get("userErrors")) or []
        if errs:
            raise SystemExit("metafieldsSet: " + json.dumps(errs)[:300])
        wrote += len(chunk)
        if (i // SET_CHUNK) % 20 == 0:
            print("  ...%d/%d metafields written" % (wrote, len(pairs)))
    return wrote


def main():
    if not TOKEN:
        print("SHOPIFY_ADMIN_TOKEN is not set - nothing to do")
        return 1
    by_series = read_catalogue()
    names = sorted(by_series.keys())
    if LIMIT_SERIES:
        names = names[:LIMIT_SERIES]
        print("LIMIT_SERIES=%d, looking up only the first %d" % (LIMIT_SERIES, len(names)))
    found = anilist(names)

    pairs, touched = [], 0
    for name, info in found.items():
        for pid in by_series.get(name, []):
            touched += 1
            if info["demographic"]:
                pairs.append(mf(pid, "demographic", "single_line_text_field", info["demographic"]))
            if info["status"]:
                pairs.append(mf(pid, "series_status", "single_line_text_field", info["status"]))
            if info["volumes"]:
                pairs.append(mf(pid, "volumes_total", "number_integer", info["volumes"]))
    print("writing %d metafields across %d products" % (len(pairs), touched))
    wrote = write(pairs)
    print("ANILIST-ENRICH series_matched=%d products_touched=%d metafields_written=%d"
          % (len(found), touched, wrote))
    return 0


if __name__ == "__main__":
    sys.exit(main())
