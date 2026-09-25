#!/usr/bin/env python3
"""'Eavy Archive paint lists -> data/eavy-archive.json (read by src/eavy.js).

Owner, 2026-09-25: "Can you use this website to help suggest paints on
Warhammer products with direct links to the paints on our site for sale
https://eavy-archive.com/40k/adeptus-mechanicus/".

'Eavy Archive is "a completely free library of box-art recipes collected
together by The Infernal Brush Discord Community" (its About), unofficial and
not endorsed by Games Workshop. Every army page holds one or more schemes
(e.g. "Mars Forge World"), each split into areas ("Red Cloak", "Metals"...)
with a list of painting steps ("Basecoat: Mephiston Red & Evil Sunz Scarlet
1:1").

What is kept: for each area, only the NAMES of the paints its steps use - a
shopping list - plus the links back to that scheme and area on 'Eavy Archive.
The steps themselves, the mixing ratios, the tags and the photos are not
copied: the product page sends painters to 'Eavy Archive for the method.

Polite: the page list comes from the site's own sitemap, one request every
1.5 s, a descriptive User-Agent. Runs weekly on a GitHub runner.

  python3 tools/eavy-archive.py [--limit N] [--dry] [--only URL]
"""
import argparse, datetime, html, json, os, re, sys, time, urllib.request, urllib.error

BASE = "https://eavy-archive.com"
SITEMAP = BASE + "/page-sitemap.xml"
OUT = "data/eavy-archive.json"
UA = "Mozilla/5.0 (compatible; ExorGamesCatalogue/1.0; +https://exorgames.com) weekly paint list, 1 request / 1.5 s"
GAP = 1.5
_last = [0.0]


def get(url):
    wait = GAP - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # network hiccup: skip this page this week
        print("fetch failed", url, e)
        return 0, ""


def text(fragment):
    """HTML -> text with a newline only where the page breaks a line."""
    s = re.sub(r"<(script|style)[\s\S]*?</\1>", "", fragment)
    s = re.sub(r"<br\s*/?>|</(p|li|div|h\d|tr)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    return "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in s.split("\n"))


STEP = re.compile(r"^([A-Z][A-Za-z /'-]{1,40}?)\s*:\s*(.*)$")
NOT_PAINT = re.compile(r"^(if necessary|optional|thinned|watered down|mix|glaze|wash|thin|layer|x\d+)$", re.I)


def paints_of(step_body):
    """'Mephiston Red & Evil Sunz Scarlet 1:1' -> ['Mephiston Red', 'Evil Sunz Scarlet'].
    Ratios, parentheses and thinning notes are dropped; alternatives ('A or B', 'A/B')
    all count as paints you might buy."""
    s = re.sub(r"\([^)]*\)", " ", step_body)
    s = re.sub(r"\b\d+\s*:\s*\d+(\s*:\s*\d+)?\b", " ", s)
    s = re.sub(r"\b\d+\s*%", " ", s)
    out = []
    for part in re.split(r"\s*(?:&|\+|,|/|\bor\b|\band\b|\bthen\b)\s*", s, flags=re.I):
        p = re.sub(r"\s+", " ", part).strip(" .-;")
        if not p or len(p) < 3 or not re.search(r"[A-Za-z]", p) or NOT_PAINT.match(p):
            continue
        if len(p) > 40:  # a sentence, not a paint name
            continue
        out.append(p)
    return out


def parse_page(url, page):
    title = re.search(r"<title>([\s\S]*?)</title>", page)
    title = html.unescape(title.group(1)).strip() if title else ""
    title = re.sub(r"\s*[-–|]\s*[‘']Eavy Archive\s*$", "", title).strip()
    parts = [p for p in url.replace(BASE, "").strip("/").split("/") if p]
    rec = {"url": url, "title": title, "game": parts[0] if parts else "", "faction": parts[1] if len(parts) > 1 else "",
           "sub": parts[2] if len(parts) > 2 else "", "schemes": []}
    # one modal per scheme: <div ... data-recipe-title="Mars Forge World" data-recipe-faction-url="...">
    starts = [m.start() for m in re.finditer(r'data-recipe-title="', page)]
    for i, s in enumerate(starts):
        chunk = page[s: starts[i + 1] if i + 1 < len(starts) else len(page)]
        name = html.unescape(re.match(r'data-recipe-title="([^"]*)"', chunk).group(1)).strip()
        slug = re.search(r'id="modal-title-([^"]+)"', chunk)
        slug = slug.group(1) if slug else re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        scheme = {"slug": slug, "name": name, "areas": []}
        bstarts = [m for m in re.finditer(r'<div class="card mb-3" id="' + re.escape(slug) + r'--([^"]+)"', chunk)]
        for j, bm in enumerate(bstarts):
            block = chunk[bm.start(): bstarts[j + 1].start() if j + 1 < len(bstarts) else len(chunk)]
            h = re.search(r'<h5 class="card-title">([\s\S]*?)(<a |</h5>)', block)
            area = text(h.group(1)).strip() if h else bm.group(1).replace("-", " ").title()
            body = block[h.end():] if h else block
            lines = [ln for ln in text(body).split("\n") if ln]
            steps, paints = 0, []
            for ln in lines:
                m = STEP.match(ln)
                if not m or ln.startswith("#"):
                    continue
                label = m.group(1).strip().lower()
                if label in ("toggle block favourite", "recommended tags"):
                    continue
                steps += 1
                for p in paints_of(m.group(2)):
                    if p.lower() not in [x.lower() for x in paints]:
                        paints.append(p)
            if paints:
                scheme["areas"].append({"slug": bm.group(1), "name": area, "paints": paints[:16]})
        if scheme["areas"]:
            rec["schemes"].append(scheme)
    return rec


def sitemap():
    st, body = get(SITEMAP)
    if st != 200:
        print("sitemap HTTP", st)
        return []
    locs = re.findall(r"<loc>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?</loc>", body)
    return sorted(set(l.strip() for l in locs if re.match(re.escape(BASE) + r"/(40k|age-of-sigmar|other-games)/.+", l.strip())))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    urls = [a.only] if a.only else sitemap()
    if a.limit:
        urls = urls[: a.limit]
    print("pages to read:", len(urls))
    pages, failed = {}, 0
    for n, u in enumerate(urls, 1):
        st, page = get(u)
        if st != 200 or not page:
            failed += 1
            continue
        rec = parse_page(u, page)
        if rec["schemes"]:
            pages[u] = rec
        if n <= 3 or a.dry and n <= 6 or n % 50 == 0:
            print("%4d %s -> %d schemes %s" % (n, u, len(rec["schemes"]), json.dumps(rec["schemes"][:1], ensure_ascii=False)[:600]))
    paints = {}
    for rec in pages.values():
        for s in rec["schemes"]:
            for ar in s["areas"]:
                for p in ar["paints"]:
                    paints[p] = paints.get(p, 0) + 1
    print("pages with schemes %d, failed %d, schemes %d, areas %d, distinct paint names %d" % (
        len(pages), failed, sum(len(r["schemes"]) for r in pages.values()),
        sum(len(s["areas"]) for r in pages.values() for s in r["schemes"]), len(paints)))
    print("most used:", sorted(paints.items(), key=lambda kv: -kv[1])[:40])
    data = {
        "source": BASE + "/",
        "credit": "'Eavy Archive - box-art recipes collected by The Infernal Brush Discord community (unofficial, not endorsed by Games Workshop)",
        "generated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(pages),
        "pages": dict(sorted(pages.items())),
    }
    if a.dry or a.only:
        print("dry run: not writing", OUT)
        return 0
    if len(pages) < 50:
        print("fewer than 50 pages parsed - keeping the old file")
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
