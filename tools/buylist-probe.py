"""The BinderPOS buylist landing, as shipped: tile markup and widget endpoints.

Two questions, one fetch each way:
  1. What is the DOM around "BUYLIST SELLING!"? The seven game tiles sit in
     a 3-column grid with one orphan; a symmetry fix has to target real
     classes, and it is impossible if the tiles live in an iframe.
  2. Which endpoints does BinderPOS's own buylist script call? The worker
     already uses external/shopify/buylist/cards/forStore with the store's
     key for prices; whether a SUBMISSION endpoint exists on the same
     surface decides whether a custom front end can hand a list back.

Read-only: fetches the public page and its public scripts, prints, exits.
"""
import os
import re
import sys
import urllib.request

BASE = "https://exorgames.com"
PREVIEW = "157462692013"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CANDIDATES = ["/a/buylist", "/apps/buylist", "/a/buylist/selling", "/apps/binderpos/buylist", "/pages/buylist"]


def get(url, accept="text/html,*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, body, url
    except Exception as e:
        return "ERR " + type(e).__name__, "", url


def strip(html):
    html = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style.*?</style>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    return re.sub(r"\s+", " ", html)


def main():
    paths = []
    for p in [os.environ.get("BUYLIST_PATH", "").strip()] + CANDIDATES:
        if p and p not in paths:
            paths.append(p)
    hit = None
    for p in paths:
        url = BASE + p + ("&" if "?" in p else "?") + "preview_theme_id=" + PREVIEW
        st, html, final = get(url)
        has = "buylist selling" in html.lower()
        print("%-28s %s %5dKB selling-heading=%s final=%s" % (p, st, len(html) // 1024, has, final[:70]))
        if has and hit is None:
            hit = (p, html)
    if not hit:
        print("NO CANDIDATE carried the heading; pass the real path as BUYLIST_PATH")
        return 0
    p, html = hit
    print("\n=== %s: markup around the tiles (scripts/styles stripped) ===" % p)
    low = html.lower()
    i = low.find("buylist selling")
    region = html[max(0, i - 900): i + 4500]
    iframes = re.findall(r"<iframe[^>]+>", html, re.I)
    print("iframes on page: %d %s" % (len(iframes), [f[:100] for f in iframes[:2]]))
    txt = strip(region)
    for k in range(0, min(len(txt), 4200), 700):
        print("  | " + txt[k:k + 700])
    print("\n=== tile links ===")
    for m in re.findall(r'<a[^>]+href=["\']([^"\']*)["\'][^>]*>\s*<img[^>]+src=["\']([^"\']*)["\']', region, re.I | re.S)[:10]:
        print("  href=%s  img=%s" % (m[0][:80], m[1][-60:]))
    print("\n=== BinderPOS scripts on the page ===")
    srcs = [s for s in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I) if "binder" in s.lower()]
    for s in srcs[:6]:
        print("  " + s[:120])
    print("\n=== endpoints named inside those scripts (external/shopify/...) ===")
    seen = set()
    for s in srcs[:4]:
        if s.startswith("//"):
            s = "https:" + s
        elif s.startswith("/"):
            s = BASE + s
        st, js, _ = get(s, "*/*")
        eps = sorted(set(re.findall(r'external/shopify/[A-Za-z0-9/_\-]+', js)))
        methods = sorted(set(re.findall(r'(?:buylist|submit|create|checkout)[A-Za-z]*\s*[:(]', js)))[:12]
        print("  %s %s %dKB endpoints=%d" % (st, s[-60:], len(js) // 1024, len(eps)))
        for e in eps:
            if e not in seen:
                seen.add(e)
                print("     " + e)
        if methods:
            print("     fn-names: " + ", ".join(m.strip() for m in methods))
    print("\nBUYLIST-PROBE done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
