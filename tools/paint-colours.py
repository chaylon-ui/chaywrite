#!/usr/bin/env python3
"""Paint colour chart for the store's colour picker (owner, 2026-09-25: "can color
picker help with the army painter, warhammer paints, etc" -> "Sure").

Reads the open paint lists of Miniature Painter Pro (github.com/Arcturus5404/
miniature-paints, paints/<Brand>.md: name, code, set, RGB, hex) and writes
data/paint-colours.json:
  { generated, source, brands: { <brand>: { <set>: { <name key>: [code, hex, name] } } } }
The worker's /paints.json matches our paint products to it.

Their licence note says "Feel free to use ... in your own personal projects": fine for
the preview; before the picker goes live the owner decides, or the colours move to the
makers' own charts / swatches sampled from our product photos.

  python3 tools/paint-colours.py [--out data/paint-colours.json]
"""
import argparse, json, os, re, time, urllib.request

BASE = "https://raw.githubusercontent.com/Arcturus5404/miniature-paints/main/paints/"
BRANDS = {
    # brand: (file, sets kept - None = all but the dropped ones, dropped pattern)
    "Vallejo": ("Vallejo.md", ["Game Color", "Game Color Wash", "Game Color Special FX", "Game Air", "Model Color", "Model Air",
                               "Mecha Color", "Xpress Color", "Xpress Color Intense", "Panzer Aces", "Metal Color",
                               "Surface Primer", "Wash FX", "Weathering FX"], None),
    "Citadel": ("Citadel_Colour.md", None, r"discontinued"),
    "The Army Painter": ("Army_Painter.md", None, r"^D&D|^$"),
}
# Vallejo's washes and special effects live under Game Color in our titles
SET_ALIAS = {"Vallejo": {"Game Color Wash": "Game Color", "Game Color Special FX": "Game Color"},
             "The Army Painter": {"Speedpaint Set 2.0": "Speedpaint", "Speedpaint Set": "Speedpaint"}}
# which duplicate to keep when one colour sits in a set twice (old and new codes)
PREFIX = {"Game Color": "72.0", "Game Air": "76.0", "Model Color": "70.", "Model Air": "71.", "Mecha Color": "69."}

def key(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())

def rows(md):
    head = None
    for line in md.split("\n"):
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if head is None:
            head = [c.lower() for c in cells]
            continue
        if set(cells[0]) <= set("-: "):
            continue
        r = dict(zip(head, cells))
        m = re.search(r"`#([0-9A-Fa-f]{6})`", r.get("hex", ""))
        if not m or not r.get("name"):
            continue
        code = r.get("code", "")
        yield r["name"], ("" if code in ("", "null") else code), r.get("set", ""), m.group(1).upper()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/paint-colours.json")
    a = ap.parse_args()
    out = {}
    counts = {}
    for brand, (fn, keep, drop) in BRANDS.items():
        with urllib.request.urlopen(urllib.request.Request(BASE + fn, headers={"User-Agent": "ExorGames-catalogue/1.0"}), timeout=60) as r:
            md = r.read().decode("utf-8")
        b = out.setdefault(brand, {})
        n = 0
        for name, code, st, hx in rows(md):
            if keep is not None and st not in keep:
                continue
            if drop and re.search(drop, st, re.I):
                continue
            st = SET_ALIAS.get(brand, {}).get(st, st)
            d = b.setdefault(st, {})
            k = key(name)
            pre = PREFIX.get(st) if brand == "Vallejo" else None
            if k in d and (not pre or d[k][0].startswith(pre) or not code.startswith(pre)):
                continue
            d[k] = [code, hx, name]
            n += 1
        counts[brand] = n
    body = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "github.com/Arcturus5404/miniature-paints",
            "counts": counts, "brands": out}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(body, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    print("wrote", a.out, os.path.getsize(a.out), counts)

if __name__ == "__main__":
    main()
