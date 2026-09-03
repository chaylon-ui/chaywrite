"""What Google actually sees on exorgames.com.

The theme's own <title> and <meta name="description"> are commented out
because Booster SEO injects its own, and a Tapita snippet injects schema at
runtime. Neither is visible in the theme source, so reading the .liquid files
tells you nothing about what ships. This fetches the rendered pages and
reports what is really in the head.

Read-only. Fetches public URLs and prints; writes nothing anywhere.
"""
import json
import re
import sys
import urllib.request

PREVIEW = "157462692013"
BASE = "https://exorgames.com"
UA = "Mozilla/5.0 (compatible; ExorSEOProbe/1.0)"

PAGES = [
    ("home", "/"),
    ("product", "/products/attack-on-titan-28"),
    ("collection", "/collections/manga"),
    ("page", "/pages/drop-off-points"),
]


def fetch(path):
    url = BASE + path + ("&" if "?" in path else "?") + "preview_theme_id=" + PREVIEW
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.status, r.read().decode("utf-8", "replace")


def head_of(html):
    m = re.search(r"<head[^>]*>(.*?)</head>", html, re.S | re.I)
    return m.group(1) if m else html[:200000]


def jsonld_types(html):
    """Every @type in every ld+json block, with the count of blocks."""
    blocks = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.S | re.I)
    types = []
    for b in blocks:
        for t in re.findall(r'"@type"\s*:\s*"([^"]+)"', b):
            types.append(t)
    return len(blocks), types


def main():
    fails = []
    for name, path in PAGES:
        try:
            status, html = fetch(path)
        except Exception as e:
            print("%-11s FETCH FAILED %s" % (name, e))
            fails.append(name + ":fetch")
            continue
        head = head_of(html)

        titles = re.findall(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
        descs = re.findall(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
            head, re.S | re.I)
        canons = re.findall(
            r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', head, re.I)
        h1s = re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.S | re.I)
        nblocks, types = jsonld_types(html)
        robots = re.findall(
            r'<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']+)', head, re.I)

        def clean(s):
            return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()

        print("=== %s  (%s)  HTTP %s  %d KB" % (name, path, status, len(html) // 1024))
        print("  title      x%d  %s" % (len(titles), clean(titles[0])[:90] if titles else "(NONE)"))
        print("  descripton x%d  %s" % (len(descs), clean(descs[0])[:110] if descs else "(NONE)"))
        print("  canonical  x%d  %s" % (len(canons), canons[0] if canons else "(NONE)"))
        print("  robots        %s" % (", ".join(robots) if robots else "-"))
        print("  h1         x%d  %s" % (len(h1s), " | ".join(clean(h)[:40] for h in h1s[:3])))
        print("  ld+json    %d block(s): %s" % (nblocks, ", ".join(sorted(set(types))) or "(none)"))

        if len(titles) != 1:
            fails.append("%s:title=%d" % (name, len(titles)))
        if len(descs) != 1:
            fails.append("%s:desc=%d" % (name, len(descs)))
        if len(h1s) != 1:
            fails.append("%s:h1=%d" % (name, len(h1s)))
        if name == "product" and "Product" not in types:
            fails.append("product:no-Product-jsonld")
        if name == "collection" and "BreadcrumbList" not in types:
            fails.append("collection:no-breadcrumbs")
        if name == "home" and not ({"LocalBusiness", "Store"} & set(types)):
            fails.append("home:no-LocalBusiness")
        print()

    print("SEO-FAILS %d :: %s" % (len(fails), ", ".join(fails) if fails else "clean"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
