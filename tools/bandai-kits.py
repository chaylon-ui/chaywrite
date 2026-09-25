#!/usr/bin/env python3
"""Bandai Hobby kit list -> data/bandai-kits.json (read by src/gunpla.js).

Owner, 2026-09-23: "Let's do the Gunpla one with titles and Bandai" - kit
facts filled in automatically, like the board games get from BoardGameGeek.

Source: Bandai Spirits' own global hobby site, English (USA) edition,
https://global.bandai-hobby.net/en-us/item/01_NNNN/ - one page per kit with
the English kit name (the same wording our Gunpla titles use, e.g.
"HG 1/144 RED GUNDAM"), the Japanese list price, the launch date and the age
rating, plus the page's PRODUCTS INFO box (owner, 2026-09-25: "is there a
chance you can capture this data for gunpla? also the pokemon gunpla"): the
intro line, the "■" feature points and the [Includes] / [Accessories] list.
The page list comes from the site's own sitemap. Bandai publishes no
barcode on these pages (checked 2026-09-23), so the worker matches kits to
our products by name.

Polite and incremental: one request a second, and only pages not already in
the file are fetched, so after the first run a week's new kits cost a few
dozen requests. Runs on a GitHub runner (the worker only reads the result),
like tools/anilist-enrich.py. No credentials.
"""
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "https://global.bandai-hobby.net"
SITEMAP = BASE + "/sitemap/en-usa/sitemap.xml"
OUT = "data/bandai-kits.json"
UA = "Mozilla/5.0 (compatible; ExorGamesCatalogue/1.0; +https://exorgames.com) weekly kit list, 1 request per second"
GAP = 1.0
MAX_FETCH = int(os.environ.get("MAX_FETCH") or "2500")
DRY = os.environ.get("DRY_RUN") == "true"
LIMIT = int(os.environ.get("LIMIT") or "0")
# Stop fetching after this many seconds and save what we have, so a slow
# night never runs into the job's timeout and loses the lot; the next run
# carries on from there (incremental).
BUDGET = int(os.environ.get("BUDGET_SECONDS") or "2400")
# Bump when parse_item learns a new field: kits stamped below it are fetched
# again (within the time budget) so the whole file catches up over a run or two.
INFO_V = 1
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

_last = [0.0]


def get(url):
    wait = GAP - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def launch_date(s):
    # "12 Oct. 2019 (Sat)" -> "2019-10-12"; "Oct. 2019" -> "2019-10"
    m = re.search(r"(?:(\d{1,2})\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{4})", s or "")
    if not m or m.group(2).lower() not in MONTHS:
        y = re.search(r"(\d{4})", s or "")
        return y.group(1) if y else ""
    mon = MONTHS[m.group(2).lower()]
    if m.group(1):
        return "%s-%02d-%02d" % (m.group(3), mon, int(m.group(1)))
    return "%s-%02d" % (m.group(3), mon)


def parse_item(page):
    t = re.search(r"<title>([\s\S]*?)</title>", page)
    name = text(t.group(1)) if t else ""
    name = re.sub(r"\s*[｜|]\s*BANDAI HOBBY SITE\s*$", "", name, flags=re.I).strip()
    specs = {}
    for m in re.finditer(r"<(dt|th)[^>]*>([\s\S]*?)</\1>\s*<(dd|td)[^>]*>([\s\S]*?)</\3>", page):
        k, v = text(m.group(2)).lower(), text(m.group(4))
        if k and v and k not in specs:
            specs[k] = v
    out = {"name": name}
    price = specs.get("price", "")
    p = re.search(r"([\d,]+)\s*yen", price, re.I)
    if p:
        out["price_yen"] = int(p.group(1).replace(",", ""))
    ld = launch_date(specs.get("launch date", ""))
    if ld:
        out["launch"] = ld
    a = re.search(r"(\d+)", specs.get("age", ""))
    if a:
        out["age"] = int(a.group(1))
    info = parse_info(page)
    if info:
        out["info"] = info
    out["iv"] = INFO_V
    brands = re.findall(r'href="(?:https://global\.bandai-hobby\.net)?/en-us/brand/([a-z0-9_\-]+)/?"', page)
    if brands:
        out["brands"] = sorted(set(brands))[:6]
    return out


INCLUDE_HEAD = re.compile(r"^\[\s*(includes?|accessories|set contents?|contents|components|included items?)\s*\]", re.I)


def parse_info(page):
    """PRODUCTS INFO -> {intro, features, includes}; {} when the page has none.
    The box is <div class="pg-products__article"> holding one <p> per line:
    an intro sentence, "■" points, then "[Includes]" and its "■" items."""
    m = re.search(r'class="pg-products__article"[^>]*>([\s\S]*?)<div class="pg-products__(?:bnrWrap|linkWrap)"', page)
    if not m:
        return {}
    lines = []
    for p in re.findall(r"<p[^>]*>([\s\S]*?)</p>", m.group(1)):
        t = text(p.replace("&nbsp;", " ")).replace("\u00a0", " ").strip()
        if t:
            lines.append(t)
    intro, feats, incl, other = [], [], [], []
    part = "intro"
    for t in lines:
        if t.startswith("[") and "]" in t[:40]:
            part = "includes" if INCLUDE_HEAD.match(t) else "other"
            continue
        item = re.sub(r"^[■◆●・\-\*]\s*", "", t).strip()
        if not item:
            continue
        if part == "intro" and t[0] in "■◆●・":
            part = "features"
        {"intro": intro, "features": feats, "includes": incl, "other": other}[part].append(item[:240])
    out = {}
    if intro:
        out["intro"] = " ".join(intro)[:600]
    if feats:
        out["features"] = feats[:20]
    if incl:
        out["includes"] = incl[:20]
    return out


def sitemap_items():
    queue, seen, pages = [SITEMAP], set(), []
    while queue and len(seen) < 50:
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        status, body = get(u)
        if status != 200:
            print("sitemap %s -> HTTP %s" % (u, status))
            continue
        locs = re.findall(r"<loc>([^<]+)</loc>", body)
        (queue if "<sitemapindex" in body else pages).extend(locs)
    items = {}
    for u in pages:
        m = re.search(r"/en-us/item/(\d+_\d+)/?$", u.strip())
        if m:
            items[m.group(1)] = u.strip()
    return items


def main():
    try:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    kits = data.get("kits") or {}
    # pages that answered with the site's "404" page are not kits: drop them
    # so the next run tries them again
    kits = {k: v for k, v in kits.items() if (v.get("name") or "").strip() not in ("", "404", "Not Found")}
    items = sitemap_items()
    print("sitemap: %d kit pages, %d already in the file" % (len(items), sum(1 for k in items if k in kits)))
    todo = [k for k in sorted(items) if k not in kits]
    # kits read before the current INFO_V (no PRODUCTS INFO yet): read again, newest first
    stale = [k for k in sorted(items, reverse=True) if k in kits and (kits[k].get("iv") or 0) < INFO_V]
    print("%d new kit pages, %d to re-read for the products info" % (len(todo), len(stale)))
    todo = todo + stale
    if LIMIT:
        todo = todo[:LIMIT]
    fetched = failed = with_info = 0
    t0 = time.time()
    for k in todo[:MAX_FETCH]:
        if time.time() - t0 > BUDGET:
            print("time budget spent after %d pages; the rest next run" % fetched)
            break
        status, page = get(items[k])
        fetched += 1
        if status != 200 or not page:
            failed += 1
            continue
        kit = parse_item(page)
        if not kit.get("name") or kit["name"].strip() in ("404", "Not Found"):
            failed += 1
            continue
        kit["url"] = items[k]
        kits[k] = kit
        if kit.get("info"):
            with_info += 1
        if fetched <= 5 or fetched % 200 == 0:
            print("%5d %s %s" % (fetched, k, json.dumps(kit, ensure_ascii=False)[:200]))
    gone = [k for k in kits if k not in items]
    print("fetched %d, failed %d, with products info %d, kits now %d (%d no longer in the sitemap, kept; %d still to re-read)" % (
        fetched, failed, with_info, len(kits), len(gone), sum(1 for v in kits.values() if (v.get("iv") or 0) < INFO_V)))
    data = {
        "source": BASE + "/en-us/",
        "generated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(kits),
        "kits": dict(sorted(kits.items())),
    }
    if DRY:
        print("dry run: not writing", OUT)
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=False)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
