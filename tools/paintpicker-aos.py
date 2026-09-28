#!/usr/bin/env python3
"""Age of Sigmar paint guides from Paint Picker (paintpicker.co.uk/factions/age-of-sigmar).

Owner, 2026-09-28: "please fill in age of sigmar with the suggested paints with this
guide if possible". Each faction page carries a written guide ("Painting ogor skin",
"Gutplates, fur and iron", ...) with the Citadel paints in bold. This keeps, per
section, ONLY the names of the Citadel paints it uses - checked against our colour
chart (data/paint-colours.json), so an emphasised word that is not a paint is
dropped - plus the link back. The prose, steps and pictures stay on Paint Picker;
the card links to the page and credits it.

Paragraphs offering an alternative ("For speed, ... contrast over ...", "if you
prefer ...") are skipped so a section lists the recipe, not its substitutes.

Politeness: robots.txt allows these pages; their terms ask for no scraping "at
excessive rates" - one request every 4 s, about 50 requests a week.

Output data/paintpicker-aos.json in the shape of data/eavy-archive.json pages:
  {url, title, game: "age-of-sigmar", faction, src: "pp",
   schemes: [{slug: "paint-picker", name, areas: [{slug, name, paints: [...]}]}]}

  python3 tools/paintpicker-aos.py [--dry] [--only SLUG]
"""
import argparse, datetime, json, os, re, sys, time, urllib.request, urllib.error

BASE = "https://paintpicker.co.uk"
INDEX = BASE + "/factions/age-of-sigmar"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "paintpicker-aos.json")
CHART = os.path.join(os.path.dirname(__file__), "..", "data", "paint-colours.json")
UA = "Mozilla/5.0 (compatible; ExorGamesCatalogue/1.0; +https://exorgames.com) weekly paint list, 1 request / 4 s"
PAUSE = 4.0
# sections that are not the army's recipe: tips, speed/batch variants, other palettes and dynasties
NOT_RECIPE = re.compile(r"\b(tips?|mistakes?|palettes?|batch|speed|quick|alternatives?|variants?|other|dynast(y|ies)|tribes?|colours|schemes?|bas(e|es|ing)|where to start|getting started|faq)\b", re.I)
ALT = re.compile(r"\b(for speed|alternatively|alternative|instead|if you prefer|prefer your|swap (it )?for|or swap)\b", re.I)
_last = [0.0]


def get(url):
    wait = PAUSE - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as e:
        print("fetch failed", url, e)
        return None


def key(s):
    # the chart keys "Bugman's Glow" as bugmanglow: drop the possessive, then everything not a-z0-9
    return re.sub(r"[^a-z0-9]", "", re.sub(r"['\u2019]s\b", "", str(s or "").lower()))


def citadel_names():
    """key -> the chart's spelling of every Citadel colour (all ranges)."""
    with open(CHART) as f:
        chart = json.load(f)["brands"]["Citadel"]
    names = {}
    for rng in chart.values():
        for k, v in rng.items():
            names[k] = v[2] if isinstance(v, list) and len(v) > 2 else k
    return names


def devalue(p):
    """Nuxt payload (devalue: a flat array, references by index) -> plain JSON."""
    memo = {}

    def r(i, depth=0):
        if depth > 60:
            return None
        if i in memo:
            return memo[i]
        v = p[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in ("Reactive", "ShallowReactive", "Ref", "ShallowRef"):
                out = r(v[1], depth + 1) if len(v) > 1 else None
            elif v and isinstance(v[0], str) and v[0] in ("EmptyRef", "EmptyShallowRef", "Set", "Map", "Date", "BigInt", "RegExp", "null"):
                out = None
            else:
                out = [r(x, depth + 1) if isinstance(x, int) and not isinstance(x, bool) else x for x in v]
        elif isinstance(v, dict):
            out = {k: (r(x, depth + 1) if isinstance(x, int) and not isinstance(x, bool) else x) for k, x in v.items()}
        else:
            out = v
        memo[i] = out
        return out

    return r(0)


def text(node):
    if isinstance(node, str):
        return node
    if isinstance(node, list) and len(node) >= 2 and isinstance(node[0], str) and isinstance(node[1], dict):
        return "".join(text(c) for c in node[2:])
    if isinstance(node, list):
        return "".join(text(c) for c in node)
    return ""


def strongs(node, out):
    if isinstance(node, list) and len(node) >= 2 and isinstance(node[0], str) and isinstance(node[1], dict):
        if node[0] in ("strong", "b"):
            out.append(text(node).strip())
            return
        for c in node[2:]:
            strongs(c, out)
    elif isinstance(node, list):
        for c in node:
            strongs(c, out)


def blocks(node):
    """A list/paragraph node -> its paragraph-level pieces (each li of a list separately)."""
    if isinstance(node, list) and len(node) >= 2 and isinstance(node[0], str) and node[0] in ("ul", "ol"):
        return [c for c in node[2:] if isinstance(c, list)]
    return [node]


def area_name(h):
    h = re.sub(r"^(painting|how to paint|paint)\s+(the\s+)?", "", h.strip(), flags=re.I)
    return h[:1].upper() + h[1:]


def parse(slug, page, names):
    m = re.search(r'/factions/%s/_payload\.json[^"\']*' % re.escape(slug), page)
    if not m:
        return None, "no payload link"
    raw = get(BASE + m.group(0).replace("&amp;", "&"))
    if not raw:
        return None, "payload fetch failed"
    root = devalue(json.loads(raw))
    doc = None
    for v in ((root or {}).get("data") or {}).values():
        if isinstance(v, dict) and v.get("body"):
            doc = v
            break
    if not doc:
        return None, "no guide in payload"
    title = re.sub(r"^how to paint\s+", "", doc.get("title") or slug, flags=re.I).strip()
    areas, cur = [], None
    for node in (doc["body"].get("value") or []):
        if not isinstance(node, list) or len(node) < 2:
            continue
        tag = node[0]
        if tag in ("h2", "h3"):
            cur = {"slug": (node[1] or {}).get("id") or key(text(node)), "name": area_name(text(node)), "paints": []}
            if NOT_RECIPE.search(cur["name"]):
                cur = None                       # read past it until the next heading
            else:
                areas.append(cur)
            continue
        if cur is None:
            continue
        for b in blocks(node):
            if ALT.search(text(b)):
                continue
            found = []
            strongs(b, found)
            for n in found:
                k = key(n)
                # the guide's own spelling ("Bugman's Glow"), once per section
                if k in names and k not in [key(x) for x in cur["paints"]]:
                    cur["paints"].append(re.sub(r"\s+", " ", n).strip(" .,:;"))
    areas = [a for a in areas if a["paints"]]
    if not areas:
        return None, "no Citadel paints in the guide"
    return {
        "url": BASE + "/factions/" + slug,
        "title": title,
        "game": "age-of-sigmar",
        "faction": slug,
        "src": "pp",
        "schemes": [{"slug": "paint-picker", "name": title + " (Paint Picker guide)", "areas": areas}],
    }, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    names = citadel_names()
    idx = get(INDEX)
    if not idx:
        print("index fetch failed")
        return 1
    slugs = sorted(set(re.findall(r'href="/factions/([a-z0-9-]+)"', idx)) - {"age-of-sigmar"})
    if a.only:
        slugs = [a.only]
    print("factions:", len(slugs), slugs)
    pages, failed = {}, []
    for s in slugs:
        page = get(BASE + "/factions/" + s)
        rec, why = parse(s, page, names) if page else (None, "page fetch failed")
        if not rec:
            failed.append((s, why))
            print("  %-26s -- %s" % (s, why))
            continue
        pages[rec["url"]] = rec
        ar = rec["schemes"][0]["areas"]
        print("  %-26s %2d areas, %2d paints: %s" % (s, len(ar), sum(len(x["paints"]) for x in ar),
              "; ".join("%s: %s" % (x["name"], ", ".join(x["paints"])) for x in ar)[:400]))
    print("pages %d, failed %d %s" % (len(pages), len(failed), failed))
    data = {
        "source": INDEX,
        "credit": "Paint Picker - faction paint guides (paintpicker.co.uk)",
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(pages),
        "pages": dict(sorted(pages.items())),
    }
    if a.dry or a.only:
        print("dry run: not writing", OUT)
        return 0
    if len(pages) < 10:
        print("too few pages - keeping the old file")
        return 1
    with open(OUT, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
