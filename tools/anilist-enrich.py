#!/usr/bin/env python3
"""Look series up on AniList and commit the result for the worker to apply.

Two constraints that between them decide this design:

  * AniList blocks Cloudflare Workers' shared egress range outright.
    Measured side by side, bgg-probe run 33799658686:
      from a GitHub runner : HTTP 200  {"a0":{"volumes":34,...}}
      from the worker      : HTTP 403  "You have been manually blocked."
  * The Shopify Admin token lives as a Cloudflare worker secret. Those are
    write-only, so it cannot be copied into a repo secret, and this runner
    therefore cannot talk to Shopify at all.

So neither side can do the whole job, and each can do half:

    worker -> GET /enrich/series.json   the distinct exor.series values
    runner -> AniList, writes data/anilist-series.json  (this script)
    worker -> reads that file each nightly sweep and applies it

No new credential anywhere. This script only ever talks to the worker's
public series list and to AniList, and commits a data file with the
automatic GITHUB_TOKEN.

Stateless: it re-looks-up everything each run, which keeps volume counts
fresh as ongoing series publish, and a failed run is simply re-run.
"""
import json, os, sys, time, urllib.error, urllib.request

WORKER = os.environ.get("WORKER", "https://exor-binder.nevski.workers.dev")
OUT = os.environ.get("OUT", "data/anilist-series.json")
UA = "ExorGamesCatalogue/1.0 (+https://exorgames.com)"
DRY = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
LIMIT_SERIES = int(os.environ.get("LIMIT_SERIES", "0") or 0)

AL_URL = "https://graphql.anilist.co"
AL_CHUNK = 8          # aliased Media() lookups per GraphQL document
AL_GAP = 0.8          # AniList allows ~90 requests a minute

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


def get(url, tries=4):
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            if attempt < tries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise


def read_series():
    """The worker holds the Shopify token, so it publishes the list; this only
    reads names. Fails loudly rather than writing an empty file, which would
    otherwise look like 'AniList knows nothing' on the next sweep."""
    r = get(WORKER + "/enrich/series.json")
    if not r.get("ok"):
        raise SystemExit("worker /enrich/series.json: " + str(r.get("error") or r)[:200])
    names = [str(n).strip() for n in (r.get("series") or []) if str(n).strip()]
    if not names:
        raise SystemExit("worker returned no series - refusing to write an empty file")
    print("worker published %d series (cached=%s, generated %s)"
          % (len(names), r.get("cached"), r.get("generated")))
    return names


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


def main():
    names = read_series()
    if LIMIT_SERIES:
        names = names[:LIMIT_SERIES]
        print("LIMIT_SERIES=%d, looking up only the first %d" % (LIMIT_SERIES, len(names)))
    found = anilist(names)

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "anilist",
        "asked": len(names),
        "count": len(found),
        "series": {n: {"demographic": v["demographic"], "status": v["status"],
                       "volumes": v["volumes"], "author": v["author"]}
                   for n, v in sorted(found.items())},
    }
    body = json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if DRY:
        print("DRY_RUN: would write %s (%d bytes, %d series)" % (OUT, len(body.encode()), len(found)))
        for n in list(sorted(found))[:8]:
            print("   %-38s %s" % (n[:38], found[n]))
        print("ANILIST-FILE dry_run asked=%d matched=%d" % (len(names), len(found)))
        return 0

    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print("wrote %s - %d of %d series matched" % (OUT, len(found), len(names)))
    print("ANILIST-FILE asked=%d matched=%d bytes=%d" % (len(names), len(found), len(body.encode())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
