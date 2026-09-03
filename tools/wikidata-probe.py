#!/usr/bin/env python3
"""How much of Exor's board-game shelf does Wikidata actually know?

BoardGameGeek answers 401 to automated calls from every network we have, so
Wikidata is the candidate replacement. Before building anything on it, measure
it against REAL titles from the catalogue - including the awkward ones, because
the shelf is not all hobby games: it has puzzles, mass-market classics,
expansions, edition variants and, in at least one case, card sleeves filed as
"Board Games".

Two HTTP calls per title, both public and unauthenticated:
  1. wbsearchentities  - find candidate entities for the name
  2. Special:EntityData - read the candidate's claims

A candidate counts as a match only if it is a game (P31 chain reaches board
game / card game / tabletop game) AND carries at least one field we would
actually filter on. Anything else is reported as a miss, on purpose: a
generous definition of "match" here would just move the disappointment to the
storefront.
"""
import json, re, sys, time, urllib.parse, urllib.request

UA = "ExorGamesCatalogue/1.0 (+https://exorgames.com) coverage-probe"
API = "https://www.wikidata.org/w/api.php"
ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/%s.json"

# P31 targets that mean "this is a game we could show filters for"
GAME_CLASSES = {
    "Q131436": "board game",
    "Q142714": "card game",
    "Q11410": "game",
    "Q3244175": "tabletop game",
    "Q21029893": "collectible card game",
}
FIELDS = {
    "P1872": "players_min",
    "P1873": "players_max",
    "P2047": "duration",
    "P287": "designer",
    "P123": "publisher",
    "P571": "released",
}

TITLES = [
    "MAGNETIC TRAVEL GAMES", "MASTERMIND CLASSIC", "GREED", "MURDLE: THE CARD GAME",
    'CHH 18" BROWN/TAN BACKGAMMON SET', "POCKET GOLF", "TOKAIDO",
    "ANIMAL CROSSING CHALLENGE 1000 PC PUZZLE", "EVOLUTION: ANOTHER WORLD RETAIL EDITION",
    "MONOPOLY KPOP DEMON HUNTERS", "OK, ZOOMER A TRIVIA GAME FOR ALL GENERATIONS",
    "STARDEW VALLEY: THE BOARD GAME", "FLAMECRAFT", "TALISMAN CORE GAME",
    "ONE PIECE PUZZLE 500PC", "WAVELENGTH", "EVERDELL COLLECTORS EDITION 3RD EDITION",
    "CARDS AGAINST HUMANITY: FAMILY EDITION", "BATTLESHIP CLASSIC", "GATES OF DELIRIUM",
    "IF THEN", "STARCRAFT TWO PLAYER STARTER SET FOUNDERS EDITION", "WARP'S EDGE",
    "MUNCHKIN CRAZY COOKS", "UG SUPREME PAGES SIDE-LOADING 18PKT GREY 10CT",
    "THE ORIGINAL TAPPLE PARTY GAME", "ROOT THE HOMELAND EXPANSION", "Ark Nova",
    "AVALON BIG BOX", "CARDS AGAINST HUMANITY: SCI-FI PACK",
]

# Counts only ever follow a number - "500PC", "1000 PIECE", "10CT". Stripping a
# bare "piece" turned ONE PIECE PUZZLE into "ONE PUZZLE" in the first run, which
# is a probe bug that would have been read as a Wikidata gap.
COUNT = re.compile(r"\b\d+\s*(pc|pcs|ct|pkt|piece|pieces)\b", re.I)
NOISE = re.compile(
    r"\b(board\s*game|card\s*game|the\s+game|retail\s+edition|collectors?\s+edition|"
    r"founders?\s+edition|family\s+edition|core\s+game|core\s+set|big\s+box|classic|"
    r"expansion|starter\s+set|two\s+player|\d+(st|nd|rd|th)\s+edition|edition|deluxe)\b",
    re.I)

def normalise(t):
    t = COUNT.sub(" ", t)
    t = NOISE.sub(" ", t)
    t = re.sub(r"[^A-Za-z0-9' ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()

def candidates_for(title):
    """Full normalised name first, then progressively shorter prefixes. A retail
    title is usually the game's name plus trailing qualifiers ("ROOT THE HOMELAND
    EXPANSION" -> "ROOT"), so the base game is a prefix of what we hold."""
    base = normalise(title) or title
    words = base.split()
    seen, out = set(), []
    for n in range(len(words), 0, -1):
        term = " ".join(words[:n])
        if len(term) >= 3 and term.lower() not in seen:
            seen.add(term.lower())
            out.append(term)
    return out[:4]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def search(term, limit=4):
    q = urllib.parse.urlencode({
        "action": "wbsearchentities", "search": term, "language": "en",
        "uselang": "en", "format": "json", "type": "item", "limit": limit})
    try:
        return [h["id"] for h in get(API + "?" + q).get("search", [])]
    except Exception as e:
        print("   search failed: %s" % e)
        return []

def claims_of(qid):
    try:
        ent = get(ENTITY % qid)["entities"][qid]
    except Exception:
        return None, {}
    cl = ent.get("claims", {})
    kinds = []
    for c in cl.get("P31", []):
        try:
            kinds.append(c["mainsnak"]["datavalue"]["value"]["id"])
        except Exception:
            pass
    have = {}
    for pid, name in FIELDS.items():
        if cl.get(pid):
            have[name] = True
    label = ent.get("labels", {}).get("en", {}).get("value", qid)
    return (label, kinds), have

def probe(title):
    """An entity counts as a game if Wikidata says so via P31, OR if it carries a
    player count - nothing but a game has a minimum number of players, and
    relying on P31 alone missed entries whose classification is a subclass we
    did not enumerate."""
    tried = []
    for term in candidates_for(title):
        tried.append(term)
        for qid in search(term, limit=7):
            got, have = claims_of(qid)
            if not got:
                continue
            label, kinds = got
            is_game = any(k in GAME_CLASSES for k in kinds)
            has_players = bool({"players_min", "players_max"} & set(have))
            if (is_game or has_players) and have:
                return {"ok": True, "qid": qid, "label": label, "term": term,
                        "fields": sorted(have), "byP31": is_game}
            time.sleep(0.1)
        time.sleep(0.1)
    return {"ok": False, "term": " | ".join(tried)}

def main():
    hits, filterable, rows = 0, 0, []
    for t in TITLES:
        r = probe(t)
        rows.append((t, r))
        if r["ok"]:
            hits += 1
            if {"players_min", "players_max"} & set(r["fields"]):
                filterable += 1
        time.sleep(0.2)
    n = len(TITLES)
    print("=" * 78)
    for t, r in rows:
        if r["ok"]:
            print("  HIT   %-42s -> %-24s %-10s [%s]" % (t[:42], r["label"][:24], r["qid"], ",".join(r["fields"])))
        else:
            print("  miss  %-42s    tried: %s" % (t[:42], r["term"][:70]))
    print("=" * 78)
    print("WIKIDATA-COVERAGE  matched %d/%d (%.0f%%)  with a player count %d/%d (%.0f%%)"
          % (hits, n, 100.0 * hits / n, filterable, n, 100.0 * filterable / n))

if __name__ == "__main__":
    sys.exit(main())
