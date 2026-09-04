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


import http.cookiejar
JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(JAR))


def get(url, accept="text/html,*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with OPENER.open(req, timeout=45) as r:
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


def theme_of(html):
    m = re.search(r'Shopify\.theme\s*=\s*(\{.*?\})', html)
    return m.group(1)[:160] if m else "(no Shopify.theme)"


def main():
    # Warm-up: the preview switch lives in a cookie that the first response
    # sets; every later request in this jar carries it.
    st, warm, _ = get(BASE + "/?preview_theme_id=" + PREVIEW)
    print("warm-up / %s  theme=%s" % (st, theme_of(warm)))
    print("preview cookie held: %s" % any(c.name == "preview_theme" for c in JAR))
    paths = []
    for p in [os.environ.get("BUYLIST_PATH", "").strip()] + CANDIDATES:
        if p and p not in paths:
            paths.append(p)
    hit = None
    for p in paths:
        url = BASE + p + ("&" if "?" in p else "?") + "preview_theme_id=" + PREVIEW
        st, html, final = get(url)
        # the og:description in <head> repeats the heading, so look in the body only
        body_at = html.lower().find("<body")
        has = "buylist selling" in html.lower()[body_at:] if body_at >= 0 else False
        print("%-38s %s %5dKB selling-heading-in-body=%s theme=%s" % (p, st, len(html) // 1024, has, theme_of(html)))
        if has and hit is None:
            hit = (p, html)
        if hit:
            break
    if not hit:
        print("NO CANDIDATE carried the heading in its body")
        return 0
    p, html = hit
    low = html.lower()
    body_at = low.find("<body")
    i = low.find("buylist selling", body_at)
    region = html[max(body_at, i - 400): i + 5200]

    print("\n=== served by the preview theme? ===")
    print("  .xg-page__body present: %s" % (".xg-page__body" in html or "xg-page__body" in html))
    print("  tile layout rule present: %s" % ('div[style*="text-align"] > a' in html))

    print("\n=== anchor target: does anything carry id=\"buylist\"? ===")
    ids = re.findall(r'<([a-z0-9]+)[^>]*\sid=["\']buylist["\'][^>]*>', html, re.I)
    print("  elements with id=buylist: %d %s" % (len(ids), ids[:3]))
    print("  'binderpos' occurrences in page HTML: %d" % low.count("binderpos"))
    for m in list(re.finditer(r"binderpos", low))[:3]:
        print("    ..." + re.sub(r"\s+", " ", html[max(0, m.start() - 70): m.start() + 90]) + "...")

    print("\n=== body markup around the tiles (scripts/styles stripped) ===")
    txt = strip(region)
    for k in range(0, min(len(txt), 4900), 700):
        print("  | " + txt[k:k + 700])

    print("\n=== tile images: intrinsic size from the PNG header ===")
    imgs = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', region, re.I)
    seen = []
    for src in imgs:
        if src in seen:
            continue
        seen.append(src)
        u = ("https:" + src) if src.startswith("//") else src
        req = urllib.request.Request(u, headers={"User-Agent": UA, "Range": "bytes=0-31"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                b = r.read(32)
        except Exception as e:
            print("  %-70s %s" % (u[-70:], type(e).__name__))
            continue
        if b[:8] == b"\x89PNG\r\n\x1a\n" and len(b) >= 24:
            w = int.from_bytes(b[16:20], "big"); h = int.from_bytes(b[20:24], "big")
            print("  %-46s %4d x %4d  ratio %.2f" % (u.split("/")[-1].split("?")[0], w, h, w / h))
        else:
            print("  %-46s not PNG (%r)" % (u.split("/")[-1].split("?")[0], b[:8]))

    print("\n=== every external script on the page ===")
    srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I)
    ext = []
    for s in srcs:
        u = ("https:" + s) if s.startswith("//") else (BASE + s if s.startswith("/") else s)
        if u not in ext:
            ext.append(u)
    for u in ext[:40]:
        flag = " <-- app embed" if "/extensions/" in u else (" <-- binder" if "binder" in u.lower() else "")
        print("  " + u[:130] + flag)

    print("\n=== inside app-embed / binder scripts: endpoints and buylist URLs ===")
    picked = [u for u in ext if "/extensions/" in u or "binder" in u.lower()][:8]
    for u in picked:
        st, js, _ = get(u, "*/*")
        js = js[:2_000_000]
        eps = sorted(set(re.findall(r'external/shopify/[A-Za-z0-9/_\-]+', js)))
        urls = sorted(set(re.findall(r'https?://[a-z0-9.\-]*binderpos[a-z0-9.\-]*/[A-Za-z0-9/_\-.?=]*', js, re.I)))[:8]
        print("  %s %dKB %s" % (st, len(js) // 1024, u[-80:]))
        print("     binderpos mentions=%d endpoints=%s" % (js.lower().count("binderpos"), eps[:12]))
        for x in urls:
            print("     url: " + x[:120])
    print("\n=== BinderPOS loader scripts (named in the page's inline loader) ===")
    for kind in ("buylist", "storeCredit"):
        u = "https://app.binderpos.com/external/shopify/%s/script?shop=most-wanted-ca.myshopify.com" % kind
        st, js, _ = get(u, "*/*")
        js = js[:3_000_000]
        eps = sorted(set(re.findall(r'external/shopify/[A-Za-z0-9/_\-]+', js)))
        hosts = sorted(set(re.findall(r'https?://[a-z0-9.\-]*binderpos[a-z0-9.\-]*(?:/[A-Za-z0-9/_\-.]*)?', js, re.I)))[:10]
        targets = sorted(set(re.findall(r'(?:getElementById|querySelector(?:All)?)\(\s*["\']([^"\']{1,60})["\']', js)))[:20]
        words = sorted(set(re.findall(r'\b(?:submit[A-Za-z]*|create[A-Za-z]*Buylist|buylist[A-Za-z]*|customer[A-Za-z]*|checkout[A-Za-z]*)\b', js)))[:30]
        print("  %s %s %dKB" % (st, kind, len(js) // 1024))
        print("     endpoints (%d): %s" % (len(eps), eps[:25]))
        print("     hosts: %s" % hosts)
        print("     DOM targets: %s" % targets)
        print("     words: %s" % words)
        for m in list(re.finditer(r"#buylist|id=.buylist|buylist-container|binder-buylist", js))[:4]:
            print("     ..." + re.sub(r"\s+", " ", js[max(0, m.start() - 80): m.start() + 100]) + "...")

    print("\nBUYLIST-PROBE done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
