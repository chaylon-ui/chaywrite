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
# Comma-separated names to look up INSTEAD of the worker's list. Lets a run
# prove the pipeline against titles AniList certainly has, separating "our
# matching is broken" from "these particular series are not in AniList".
TEST_SERIES = [x.strip() for x in os.environ.get("TEST_SERIES", "").split(",") if x.strip()]
DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")

AL_URL = "https://graphql.anilist.co"
AL_CHUNK = 8          # aliased Media() lookups per GraphQL document
AL_GAP = 2.2          # AniList degraded the public limit to 30 req/min

DEMOS = {"shounen": "Shonen", "shoujo": "Shojo", "seinen": "Seinen", "josei": "Josei"}
STATUS = {"RELEASING": "Ongoing", "FINISHED": "Completed", "HIATUS": "Hiatus",
          "CANCELLED": "Cancelled", "NOT_YET_RELEASED": "Upcoming"}


def _errtext(j):
    msgs = []
    for e in (j.get("errors") or [])[:2]:
        m = (e or {}).get("message")
        if m:
            msgs.append(str(m))
    return "; ".join(msgs) or "(no message)"


def post(url, payload, headers, tries=4):
    body = json.dumps(payload).encode()
    for attempt in range(tries):
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            # AniList answers 404 when EVERY aliased lookup in the document
            # misses - but the body is still a valid GraphQL response and any
            # aliases that did match are in it. Raising here threw away whole
            # batches: the first rehearsal reported 0 of 40 series for exactly
            # this reason. So parse the body whenever it is usable, whatever
            # the status, and only retry/raise when it is not.
            raw = b""
            try:
                raw = e.read()
            except Exception:
                pass
            try:
                j = json.loads(raw.decode("utf-8", "replace"))
            except Exception:
                j = None
            #
            # 429 is the one status whose body must NOT be taken at face
            # value. AniList answers it with {"errors":[{"message":"Too Many
            # Requests"}]}, which satisfied the "errors" half of the old test
            # above, so post() returned it as though it were a result and the
            # backoff below never ran. A full sweep matched 8 of 1380 series
            # for exactly that reason: one batch got through and the other 172
            # were rate-limited into silence. Require real data instead.
            if e.code != 429 and isinstance(j, dict) and j.get("data"):
                j["_http"] = e.code
                return j
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                if e.code == 429:
                    try:
                        wait = int(e.headers.get("Retry-After") or 60) + 1
                    except (TypeError, ValueError):
                        wait = 61
                else:
                    wait = 3 * (attempt + 1)
                print("  HTTP %d, waiting %ds" % (e.code, wait))
                time.sleep(wait)
                continue
            if isinstance(j, dict) and j.get("errors"):
                print("  HTTP %d: %s" % (e.code, _errtext(j)))
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


# format_not: ONE_SHOT keeps search relevance from landing on a prototype
# one-shot that shares the serial's name - "Naruto" alone matched #36444,
# the 1997 single chapter, instead of the 72-volume series. Novels stay in,
# because a good part of the shelf is light novels.
ALIAS = ('a%d: Media(search: %s, type: MANGA, format_not: ONE_SHOT) '
         '{ id format chapters volumes status '
         'title { romaji english } tags { name } '
         'staff(perPage: 8) { edges { role node { name { full } } } } }')


def pick_author(m):
    """AniList credits every contributor - guest illustrators, cover artists,
    spin-off writers - and the first edge is not reliably the person who made
    the series (Attack on Titan's first edge is Tatsuya Endou, of Spy x Family).
    Rank the edges by role instead: creator, then writer, then artist."""
    best, best_rank = "", 99
    for e in ((m.get("staff") or {}).get("edges") or []):
        full = (((e or {}).get("node") or {}).get("name") or {}).get("full")
        if not full:
            continue
        role = str((e or {}).get("role") or "").lower()
        if "original creator" in role or "story & art" in role:
            rank = 0
        elif "story" in role:
            rank = 1
        elif "art" in role:
            rank = 2
        else:
            rank = 3
        if rank < best_rank:
            best, best_rank = full, rank
        if best_rank == 0:
            break
    return best


def read_media(m):
    if not m:
        return None
    demo = ""
    for t in m.get("tags") or []:
        d = DEMOS.get(str(t.get("name", "")).lower())
        if d:
            demo = d
            break
    author = pick_author(m)
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
        if r.get("errors") and not r.get("data"):
            # A batch that answers with errors and no data returned nothing at
            # all, and used to look identical to a batch of genuine misses.
            print("  anilist batch %d returned no data: %s" % (i, _errtext(r)))
        data = r.get("data") or {}
        if DEBUG:
            # Which AniList entry a name actually landed on is the thing worth
            # seeing - a plausible-looking miss is usually a wrong match, not a
            # broken query.
            for k, n in enumerate(chunk):
                m = data.get("a%d" % (i + k)) or {}
                t = (m.get("title") or {})
                print("  DEBUG %-34s -> #%s %s [%s] vols=%s ch=%s"
                      % (n[:34], m.get("id"), (t.get("english") or t.get("romaji") or "-")[:40],
                         m.get("format"), m.get("volumes"), m.get("chapters")))
        got = 0
        for k, n in enumerate(chunk):
            v = read_media(data.get("a%d" % (i + k)))
            if v:
                found[n] = v
                got += 1
            else:
                misses += 1
        if DEBUG and not got:
            # A batch of eight that yields nothing is either eight honest
            # misses or one failed request, and those read identically from
            # the outside. Print what AniList actually said.
            print("  DEBUG empty batch http=%s reply=%s"
                  % (r.get("_http", 200), json.dumps(r)[:700]))
        time.sleep(AL_GAP)
        if (i // AL_CHUNK) % 10 == 0:
            print("  ...%d/%d series looked up" % (min(i + AL_CHUNK, len(names)), len(names)))
    print("anilist matched %d of %d series (%d without usable data)"
          % (len(found), len(names), misses))
    return found


def main():
    if TEST_SERIES:
        names = TEST_SERIES
        print("TEST_SERIES set - looking up %d given names, ignoring the worker list" % len(names))
    else:
        names = read_series()
        print("first 12 series as published: %s" % json.dumps(names[:12], ensure_ascii=False))
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
