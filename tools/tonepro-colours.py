#!/usr/bin/env python3
"""tools/tonepro-colours.py - the colour of every Warhammer Tone Pro pot we sell, read
from its product photo, for the colour picker (owner 2026-11-02: "we recently got
warhammer tone pro paints ... can we integrate that into the color picker").

No open chart lists the Tone Pro colours (Arcturus5404/miniature-paints has none), but
every pot photo on exorgames.com is the pot on white with a band of the paint colour
around its foot. Validated 2026-11-02 (probe 41447709994): the last row whose central
10% of columns is not near-white is the pot's bottom; the median of the central 20% of
columns over the rows 2%..4% of the image height above it is the paint colour (deeper
rows hit the black label). Bloodtoof Red 1/3/5 read (125,84,76) (187,66,85) (229,90,96).

Reads the worker's /paints.json (brand "Tone Pro": one swatch per pot with its photo and
title), samples each photo, writes data/tonepro-colours.json in the shape of
data/paint-colours.json: {brands: {"Tone Pro": {"Tone Pro": {<key>: [code, hex, name]}}}}.
A pot without a photo keeps its previous colour when the file already had one, else it
is listed under "missing". --dry prints and writes nothing."""
import io, json, re, statistics, sys, time, urllib.request
from datetime import datetime, timezone
from PIL import Image

PAINTS = "https://exor-binder.nevski.workers.dev/paints.json"
OUT = "data/tonepro-colours.json"
UA = "tonepro-colours (chaylon-ui/chaywrite; one read a week)"

def get(url):
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "*/*"})
    return urllib.request.urlopen(req, timeout=40).read()

def key(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def sample(img):
    """(r, g, b) of the paint band, or None when no pot bottom is found."""
    im = img.convert("RGB")
    w, h = im.size
    px = im.load()
    c0, c1 = int(w * 0.45), int(w * 0.55)
    bottom = None
    for y in range(h - 1, int(h * 0.3), -1):
        dark = sum(1 for x in range(c0, c1) if min(px[x, y]) < 228)
        if dark > (c1 - c0) // 2:
            bottom = y
            break
    if bottom is None:
        return None
    y0, y1 = bottom - int(h * 0.04), bottom - int(h * 0.02)
    c0, c1 = int(w * 0.40), int(w * 0.60)
    rs, gs, bs = [], [], []
    for y in range(max(0, y0), max(0, y1) + 1):
        for x in range(c0, c1):
            r, g, b = px[x, y]
            rs.append(r); gs.append(g); bs.append(b)
    if not rs:
        return None
    return (int(statistics.median(rs)), int(statistics.median(gs)), int(statistics.median(bs)))

def main():
    dry = "--dry" in sys.argv
    old = {}
    try:
        old = json.load(open(OUT, encoding="utf-8")).get("brands", {}).get("Tone Pro", {}).get("Tone Pro", {})
    except Exception:
        pass
    j = json.loads(get(PAINTS).decode("utf-8"))
    pots = [g for g in j.get("swatches", []) if g.get("b") == "Tone Pro"]
    print("tone pro swatches", len(pots), "| generated", j.get("generated"))
    out, missing = {}, []
    for g in sorted(pots, key=lambda g: g["n"]):
        name = g["n"]
        it = g["items"][0]
        img = it.get("i")
        code = ""
        m = re.search(r"-(\d{2}-\d{3})\.(?:jpe?g|png|webp)", img or "", re.I)
        if m:
            code = m.group(1)
        rgb = None
        if img:
            u = img + ("&" if "?" in img else "?") + "width=600"
            try:
                rgb = sample(Image.open(io.BytesIO(get(u))))
            except Exception as e:
                print("  !", name, "photo failed:", str(e)[:80])
            time.sleep(0.4)
        if rgb is None:
            k = key(name)
            if k in old:
                out[k] = old[k]
                print("  -", name, "no photo: kept", old[k][1])
            else:
                missing.append(it.get("t") or name)
                print("  -", name, "no photo, no earlier colour")
            continue
        hexv = "%02X%02X%02X" % rgb
        out[key(name)] = [code, hexv, name]
        print("  ", name.ljust(26), code.ljust(7), hexv, rgb)
    print("coloured", len(out), "| missing", len(missing))
    data = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "the colour band at the foot of each pot in our product photos (tools/tonepro-colours.py)",
            "brands": {"Tone Pro": {"Tone Pro": out}}, "missing": missing}
    if dry:
        print(json.dumps(data, indent=1)[:1500])
        return
    if not out:
        print("nothing read: file left as it was")
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote", OUT)

if __name__ == "__main__":
    main()
