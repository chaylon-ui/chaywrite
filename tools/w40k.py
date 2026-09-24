#!/usr/bin/env python3
"""Warhammer 40,000 unit specs for our unit boxes, from BSData.

Owner, 2026-09-24: "warhammer, lets do it" (after "would this help with
Warhammer? https://github.com/EshanPrakash/openhammer-api"). OpenHammer is
one person's server over the community BSData files, so this reads those
files directly: github.com/BSData/wh40k-10e, the 10th-edition datasheets
BattleScribe / New Recruit use. Unofficial community data; Games Workshop
owns the game. Only numbers, names and keywords are taken - never ability
or rules text.

For every 40K product (the worker's /w40k/targets.json: id + title) it
works out the faction and unit from the title ("WARHAMMER 40,000 ASTRA
MILITARUM: CADIAN SHOCK TROOPS", often cut short by the distributor:
"LEAGUES OF VOTANN: HEKATON LAND FOR") and, when exactly one datasheet
fits, records that unit's facts: faction, keywords, model count, points
per size, stat lines and weapon profiles. Boxes that are not one unit
(codexes, dice, datacards, Combat Patrols, battleforces, bases, terrain,
Kill Team...) are left alone. A name two datasheets share is never
guessed.

Writes data/w40k.json: {generated, bsdata, counts, products: {id: facts}}.
The worker's nightly enrich sweep (src/w40k.js) writes the facts to the
products (exor.wh_unit, json). Run weekly - points change with each
balance update.

  python3 tools/w40k.py --bsdata DIR [--targets FILE|URL] [--out data/w40k.json] [--dry]
"""
import argparse, json, os, re, sys, time, unicodedata, urllib.request
import xml.etree.ElementTree as ET

TARGETS_URL = "https://exor-binder.nevski.workers.dev/w40k/targets.json"

# ---------------------------------------------------------------- BSData --

def local(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag

def kids(el, name):
    """Direct children of el named <name> (namespace-free)."""
    return [c for c in el if local(c.tag) == name]

def kid(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None

def children_of(el, wrapper, name):
    w = kid(el, wrapper)
    return kids(w, name) if w is not None else []


class Data:
    def __init__(self, folder):
        self.cats = {}          # catalogue id -> root element
        self.byid = {}          # element id -> element (entries, groups, profiles)
        self.catname = {}       # catalogue id -> name
        self.gst = None
        self.home = {}          # element -> name of the catalogue that defines it
        for fn in sorted(os.listdir(folder)):
            if not (fn.endswith('.cat') or fn.endswith('.gst')):
                continue
            root = ET.parse(os.path.join(folder, fn)).getroot()
            if fn.endswith('.gst'):
                self.gst = root
            else:
                self.cats[root.get('id')] = root
                self.catname[root.get('id')] = root.get('name')
            for el in root.iter():
                i = el.get('id')
                if i and local(el.tag) in ('selectionEntry', 'selectionEntryGroup', 'profile', 'infoGroup') and i not in self.byid:
                    self.byid[i] = el
                    self.home[id(el)] = root.get('name')
        # the points cost type id
        self.pts = None
        for ct in self.gst.iter():
            if local(ct.tag) == 'costType' and ct.get('name') == 'pts':
                self.pts = ct.get('id')

    def roots(self, cat, seen=None):
        """Selectable root entries of a catalogue, incl. imported catalogues."""
        seen = seen if seen is not None else set()
        if cat.get('id') in seen:
            return []
        seen.add(cat.get('id'))
        out = []
        for se in children_of(cat, 'selectionEntries', 'selectionEntry'):
            out.append(se)
        for el in children_of(cat, 'entryLinks', 'entryLink'):
            t = self.byid.get(el.get('targetId'))
            if t is not None and local(t.tag) == 'selectionEntry':
                out.append(t)
        for cl in children_of(cat, 'catalogueLinks', 'catalogueLink'):
            if cl.get('importRootEntries') == 'true' and cl.get('targetId') in self.cats:
                out.extend(self.roots(self.cats[cl.get('targetId')], seen))
        return out


def faction_of(catname):
    # "Imperium - Adeptus Astartes - Blood Angels" -> "Blood Angels";
    # libraries: "Imperium - Imperial Knights - Library" -> "Imperial Knights",
    # "Aeldari - Aeldari Library" / "Library - Tyranids" -> "Aeldari" / "Tyranids"
    parts = [p.strip() for p in (catname or '').split(' - ') if p.strip()]
    parts = [re.sub(r'\s*Library$', '', p).strip() for p in parts if p != 'Library']
    parts = [p for p in parts if p]
    f = parts[-1] if parts else (catname or '')
    return {'Daemons': 'Chaos Daemons'}.get(f, f)          # "Chaos - Daemons Library"


WEAPON_TYPES = {'Ranged Weapons': 'ranged', 'Melee Weapons': 'melee'}
STAT_KEYS = ['M', 'T', 'SV', 'W', 'LD', 'OC']


def chars(p):
    return {c.get('name'): (c.text or '').strip() for c in p.iter() if local(c.tag) == 'characteristic'}


# the Crusade campaign extras BSData hangs on units ("Crusade", "Crusade
# Relics"...) - not "Crusader Squad"
CRUSADE = re.compile(r'^\s*crusade(?![a-z])', re.I)


def walk(d, el, seen=None):
    """Every profile reachable from el: inline, and through entry / info
    links (each target once). Crusade-only extras and hidden entries are
    not part of the datasheet."""
    seen = seen if seen is not None else set()
    for c in el:
        n = local(c.tag)
        if n in ('selectionEntry', 'selectionEntryGroup', 'entryLink') and (
                CRUSADE.match(c.get('name') or '') or c.get('hidden') == 'true'):
            continue
        if n == 'profile':
            yield c
        elif n in ('entryLink', 'infoLink'):
            tid = c.get('targetId')
            if tid and tid not in seen:
                seen.add(tid)
                t = d.byid.get(tid)
                if t is not None:
                    if local(t.tag) == 'profile':
                        yield t
                    elif not (CRUSADE.match(t.get('name') or '') or t.get('hidden') == 'true'):
                        yield from walk(d, t, seen)
        yield from walk(d, c, seen)


def _limits(el):
    lo = hi = None
    for c in children_of(el, 'constraints', 'constraint'):
        if c.get('field') != 'selections' or c.get('scope') != 'parent':
            continue
        v = int(float(c.get('value') or 0))
        if c.get('type') == 'min':
            lo = v
        elif c.get('type') == 'max':
            hi = v
    return lo, hi


def _is_model(d, el):
    t = d.byid.get(el.get('targetId')) if local(el.tag) == 'entryLink' else el
    return t is not None and local(t.tag) == 'selectionEntry' and t.get('type') == 'model'


BIG = 10 ** 6


def _span(d, el, depth=0):
    """(lo, hi) models this node adds when taken, or None when it holds none.
    A model counts its own min/max (on the link, else on the entry). A group
    with limits over models caps their sum; a group over compositions
    ("1 Sergeant and 9 Troopers" / "2 ... and 18 ...") is one choice among
    them."""
    if depth > 8:
        return None
    node = el
    if local(el.tag) == 'entryLink':
        node = d.byid.get(el.get('targetId'))
        if node is None:
            return None
    if _is_model(d, el):
        lo, hi = _limits(el)
        if lo is None and hi is None:
            lo, hi = _limits(node)
        lo = lo or 0
        # no maximum of its own: as many as the group around it allows
        return (lo, hi if hi is not None else BIG)
    parts, all_models = [], True
    for c in list(children_of(node, 'selectionEntries', 'selectionEntry')) + list(children_of(node, 'selectionEntryGroups', 'selectionEntryGroup')) + list(children_of(node, 'entryLinks', 'entryLink')):
        r = _span(d, c, depth + 1)
        if r is None:
            continue
        parts.append(r)
        # a composition ("1 Sergeant and 9 Troopers") is a selectionEntry
        # holding models; models and groups of models just add up
        tgt = d.byid.get(c.get('targetId')) if local(c.tag) == 'entryLink' else c
        if not _is_model(d, c) and tgt is not None and local(tgt.tag) == 'selectionEntry':
            all_models = False
    if not parts:
        return None
    glo, ghi = _limits(el) if local(el.tag) != 'entryLink' else (None, None)
    if local(node.tag) == 'selectionEntryGroup' and (glo is not None or ghi is not None):
        if all_models:
            lo = max(glo or 0, sum(p[0] for p in parts))
            hi = min(ghi if ghi is not None else BIG, sum(p[1] for p in parts))
            return (min(lo, hi), hi)
        if ghi == 1:                                  # pick one composition
            lo = min(p[0] for p in parts) if (glo or 0) >= 1 else 0
            return (lo, max(p[1] for p in parts))
    return (sum(p[0] for p in parts), sum(p[1] for p in parts))


def model_count(d, unit):
    if unit.get('type') == 'model':
        return [1, 1]
    r = _span(d, unit)
    if not r:
        return [1, 1]                   # no model entries of its own: the unit is the one model
    if r[1] <= 0:
        return None
    lo, hi = r
    if hi >= BIG:                       # an open-ended count: only the minimum is known
        hi = max(lo, 1)
    return [max(lo, 1), max(hi, lo, 1)]


def _model_costs(d, el, out, depth=0):
    """pts on the model entries under el (a unit priced per model)."""
    if depth > 6:
        return
    for c in list(children_of(el, 'selectionEntries', 'selectionEntry')) + list(children_of(el, 'selectionEntryGroups', 'selectionEntryGroup')) + list(children_of(el, 'entryLinks', 'entryLink')):
        if CRUSADE.match(c.get('name') or '') or c.get('hidden') == 'true':
            continue
        t = d.byid.get(c.get('targetId')) if local(c.tag) == 'entryLink' else c
        if t is None:
            continue
        if local(t.tag) == 'selectionEntry' and t.get('type') == 'model':
            for k in children_of(t, 'costs', 'cost'):
                if k.get('typeId') == d.pts and float(k.get('value') or 0) > 0:
                    out.add(float(k.get('value')))
        else:
            _model_costs(d, t, out, depth + 1)


def points(d, unit, models):
    base = None
    for c in children_of(unit, 'costs', 'cost'):
        if c.get('typeId') == d.pts:
            base = float(c.get('value') or 0)
    if not base and models:
        # priced per model ("Canoptek Spyder" 75 each, 1-2 per unit)
        each = set()
        _model_costs(d, unit, each)
        if len(each) == 1:
            v = each.pop()
            v = int(v) if v == int(v) else v
            lo, hi = models
            ns = list(range(lo, hi + 1)) if hi - lo < 6 else [lo, hi]
            return [[n, n * v] for n in ns]
    if base is None:
        return []
    rows = {}
    if base > 0:
        rows[models[0] if models else 1] = base
    for m in children_of(unit, 'modifiers', 'modifier'):
        if m.get('field') != d.pts or m.get('type') != 'set':
            continue
        conds = [c for c in m.iter() if local(c.tag) == 'condition']
        if len(conds) != 1:
            continue
        c = conds[0]
        if c.get('field') != 'selections':
            continue
        try:
            n = int(float(c.get('value')))
        except (TypeError, ValueError):
            continue
        t = c.get('type')
        if t == 'greaterThan':
            n += 1
        elif t not in ('atLeast', 'equalTo'):
            continue
        rows[n] = float(m.get('value') or 0)
    out = [[n, int(v) if v == int(v) else v] for n, v in sorted(rows.items()) if v > 0]
    if models and len(out) == 2 and models[1] > models[0]:
        lo, hi = models
        # the second price is "more than N models" - i.e. the larger unit;
        # 10th-edition units come in N or 2N models, and BSData's optional
        # extras can make the counted maximum land a model or two off.
        big = 2 * lo if abs(hi - 2 * lo) <= 2 else hi
        out = [[lo, out[0][1]], [big, out[1][1]]]
        models[1] = big
    return out


def sizes(pts, models):
    """Points rows as the card shows them: [{"m": "5", "p": 75}, {"m": "6-7",
    "p": 130}, ...]. A row's price holds from its model count up to the next
    row's."""
    out = []
    top = models[1] if models else None
    if models and len(pts) == 2 and pts[0][0] == models[0] and pts[1][0] == models[1]:
        # the usual "5 or 10 models" unit: two exact sizes
        return [{'m': str(n), 'p': v} for n, v in pts]
    for i, (n, v) in enumerate(pts):
        nxt = pts[i + 1][0] - 1 if i + 1 < len(pts) else top
        label = str(n) if not nxt or nxt <= n else '%d-%d' % (n, nxt)
        out.append({'m': label, 'p': v})
    return out


SKIP_KEYWORDS = re.compile(r'^(Configuration|Warlord|Reference|Crusade|Legends|Unit)$', re.I)


def unit_facts(d, unit, faction):
    name = unit.get('name', '').strip()
    kws, fkws = [], []
    for cl in children_of(unit, 'categoryLinks', 'categoryLink'):
        n = (cl.get('name') or '').strip()
        if not n or n.lower() == name.lower() or SKIP_KEYWORDS.match(n):
            continue
        if n.lower().startswith('faction:'):
            fkws.append(n.split(':', 1)[1].strip())
        elif n not in kws:
            kws.append(n)
    stats, weapons, wseen, sseen = [], {'ranged': [], 'melee': []}, set(), set()
    for p in walk(d, unit):
        tn = p.get('typeName')
        if tn == 'Unit':
            ch = chars(p)
            row = {k: ch.get(k, '') for k in STAT_KEYS}
            key = tuple(row.values())
            if key in sseen or not any(row.values()):
                continue
            sseen.add(key)
            stats.append(dict(name=p.get('name', ''), **row))
        elif tn in WEAPON_TYPES:
            ch = chars(p)
            wname = re.sub(r'^\W+\s*', '', p.get('name', '')).strip()   # "➤ Plasma pistol - standard"
            if wname in wseen:
                continue
            wseen.add(wname)
            skill = ch.get('BS') or ch.get('WS') or ''
            weapons[WEAPON_TYPES[tn]].append({
                'name': wname, 'range': ch.get('Range', ''), 'a': ch.get('A', ''), 'skill': skill,
                's': ch.get('S', ''), 'ap': ch.get('AP', ''), 'd': ch.get('D', ''), 'kw': '' if ch.get('Keywords', '').strip() in ('', '-') else ch.get('Keywords', '').strip(),
            })
    models = model_count(d, unit)
    pts = points(d, unit, models)
    return {
        'faction': faction, 'name': name, 'legends': '[legends]' in name.lower(),
        'keywords': kws[:16], 'factionKeywords': fkws[:4],
        'models': models, 'points': pts, 'sizes': sizes(pts, models),
        'stats': stats[:4],
        'weapons': {'ranged': weapons['ranged'][:14], 'melee': weapons['melee'][:10]},
    }


def build_units(d):
    """faction display name -> {norm name: [facts, ...]}"""
    out = {}
    for cid, cat in d.cats.items():
        if cat.get('library') == 'true' or 'Library' in (cat.get('name') or ''):
            continue
        faction = faction_of(cat.get('name'))
        pool = out.setdefault(faction, {})
        for u in d.roots(cat):
            if u.get('type') not in ('unit', 'model'):
                continue
            if re.search(r'\[(?!legends\])[^\]]*\]', u.get('name', ''), re.I):
                continue                      # "[Crucible]" and other special versions
            f = unit_facts(d, u, faction_of(d.home.get(id(u), cat.get('name'))))
            if not f['stats']:
                continue
            key = norm(re.sub(r'\s*\[legends\]', '', f['name'], flags=re.I))
            lst = pool.setdefault(key, [])
            if not any(x['name'] == f['name'] for x in lst):
                lst.append(f)
    return out

# ----------------------------------------------------------------- titles --

def norm(s):
    s = ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))   # "Brôkhyr"
    s = s.upper().replace('&', ' AND ').replace("'", '').replace('’', '')
    s = re.sub(r'[^A-Z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


# Title prefix -> BSData faction (display name, last part of the catalogue
# name). Longest first when matching.
ALIASES = {
    'SPACE MARINES': 'Space Marines', 'SPACE MARINE': 'Space Marines', 'ADEPTUS ASTARTES': 'Space Marines',
    'ULTRAMARINES': 'Ultramarines', 'BLOOD ANGELS': 'Blood Angels', 'DARK ANGELS': 'Dark Angels', 'SPACE WOLVES': 'Space Wolves',
    'BLACK TEMPLARS': 'Black Templars', 'DEATHWATCH': 'Deathwatch', 'IMPERIAL FISTS': 'Imperial Fists', 'IRON HANDS': 'Iron Hands',
    'RAVEN GUARD': 'Raven Guard', 'SALAMANDERS': 'Salamanders', 'WHITE SCARS': 'White Scars',
    'GREY KNIGHTS': 'Grey Knights', 'ADEPTA SORORITAS': 'Adepta Sororitas', 'SISTERS OF BATTLE': 'Adepta Sororitas',
    'ADEPTUS CUSTODES': 'Adeptus Custodes', 'CUSTODES': 'Adeptus Custodes',
    'ADEPTUS MECHANICUS': 'Adeptus Mechanicus', 'ADEPT MECHANICUS': 'Adeptus Mechanicus', 'ADMECH': 'Adeptus Mechanicus',
    'ASTRA MILITARUM': 'Astra Militarum', 'IMPERIAL GUARD': 'Astra Militarum',
    'AGENTS OF THE IMPERIUM': 'Agents of the Imperium', 'IMPERIAL AGENTS': 'Agents of the Imperium',
    'IMPERIAL KNIGHTS': 'Imperial Knights', 'CHAOS KNIGHTS': 'Chaos Knights',
    'CHAOS SPACE MARINES': 'Chaos Space Marines', 'CHAOS SPACE MARINE': 'Chaos Space Marines', 'CSM': 'Chaos Space Marines',
    'DEATH GUARD': 'Death Guard', 'THOUSAND SONS': 'Thousand Sons', 'WORLD EATERS': 'World Eaters', 'W E': 'World Eaters',
    'EMPERORS CHILDREN': "Emperor's Children",
    'CHAOS DAEMONS': 'Chaos Daemons', 'DAEMONS OF KHORNE': 'Chaos Daemons', 'DAEMONS OF NURGLE': 'Chaos Daemons',
    'DAEMONS OF TZEENTCH': 'Chaos Daemons', 'DAEMONS OF SLAANESH': 'Chaos Daemons', 'DAEMONS': 'Chaos Daemons',
    'AELDARI': 'Craftworlds', 'CRAFTWORLDS': 'Craftworlds', 'HARLEQUINS': 'Craftworlds', 'ELDAR': 'Craftworlds',
    'DRUKHARI': 'Drukhari', 'YNNARI': 'Ynnari',
    'NECRONS': 'Necrons', 'NECRON': 'Necrons', 'ORKS': 'Orks', 'ORK': 'Orks',
    'T AU EMPIRE': "T'au Empire", 'TAU EMPIRE': "T'au Empire", 'T AU': "T'au Empire", 'TAU': "T'au Empire",
    'TYRANIDS': 'Tyranids', 'TYRANID': 'Tyranids', 'GENESTEALER CULTS': 'Genestealer Cults', 'GSC': 'Genestealer Cults',
    'LEAGUES OF VOTANN': 'Leagues of Votann', 'VOTANN': 'Leagues of Votann',
}
ALIAS_KEYS = sorted(ALIASES, key=len, reverse=True)

# Anything whose title says it is not a single unit box.
NOT_A_UNIT = re.compile(r'\b(KILL TEAM|KILL ZONE|KILLZONE|CODEX|DATACARDS?|DATASHEET|DICE|DIC$|COMBAT PATROL|BOARDING PATROL|'
                        r'BATTLE ?FORCE|ARMY SET|STARTER|CITADEL|BASES?|TERRAIN|MISSION|CHAPTER APPROVED|CHAP APPROVED|'
                        r'CORE BOOK|RULEBOOK|MUG|GLASS|KEYCHAIN|MOUSEPAD|UPGRADES?|TRANSFERS?|COLLECTION|INDEX CARDS|'
                        r'ARKS OF OMEN|ARMY BOX|BUNDLE|PAINT SET|PAINTS|NOVEL|AUDIO|RECRUIT|ESSENTIALS|CAMPAIGN|'
                        r'MAGAZINE|POSTER|PROMO|GIFT|SMH|HB|PB|ENG|ENGLISH|BOOK|PAPERBACK|HARDBACK|OMNIBUS|ANTHOLOGY|'
                        r'BLACK LIBRARY|ANNIVERSARY|ILLUSTRATED|INTRODUCTORY|OBJECTIVE SET|BATTLEFIELD TROPHIES|'
                        r'ACCESSORIES|MINIATURES GAME|ARMY OF FAITH|STRIKE FORCE|REALSPACE RAIDERS)\b')

HEAD = re.compile(r'^\s*WARHAMMER\s+(40\s*,?\s*000|40K)\b[\s:,-]*', re.I)


def parse_title(title):
    """-> (faction or None, unit text) or None when it is not a unit box."""
    t = HEAD.sub('', title or '')
    if t == (title or ''):
        return None
    if NOT_A_UNIT.search(norm(t)):              # "(PB)", "(HB)" before the brackets go
        return None
    t = re.sub(r'\([^)]*\)', ' ', t)          # (ENG), (HB)
    t = re.sub(r'\bADEPT\s*/\s*MECHANICUS', 'ADEPTUS MECHANICUS', t, flags=re.I)
    t = re.sub(r'\bW\s*/\s*E\b', 'WORLD EATERS', t, flags=re.I)
    t = re.sub(r'\bW/\s*', 'WITH ', t, flags=re.I)
    t = t.replace('/', ' OR ')                   # "EXOCRINE/HARUSPEX": builds one or the other
    t = re.sub(r'\b\d{2,3}-\d{2}\b', ' ', t)   # GW product codes "49-29"
    n = norm(t)
    if not n or NOT_A_UNIT.search(n):
        return None
    faction = None
    for k in ALIAS_KEYS:
        if n == k:
            return None                          # just a faction name
        if n.startswith(k + ' '):
            faction = ALIASES[k]
            n = n[len(k) + 1:]
            break
    if faction:
        # "ADEPTA SORORITAS SISTERS OF BATTLE CANONESS": the faction twice
        for k in ALIAS_KEYS:
            if ALIASES[k] == faction and n.startswith(k + ' '):
                n = n[len(k) + 1:]
                break
    n = re.sub(r'^(BL|BLACK LIBRARY)\b.*', '', n).strip()   # novels
    return (faction, n) if n else None


STOP = {'SQUAD', 'TEAM', 'UNIT', 'THE', 'OF', 'WITH', 'AND', 'OR', 'A'}
SPELLING = {'BERSERKER': 'BERZERKER', 'BERSERK': 'BESERK', 'ARCHAEOLOGIST': 'ARCHEOLOGIST', 'ARMOUR': 'ARMOR'}


def words(text):
    out = set()
    for w in text.split():
        if len(w) > 3 and w.endswith('S') and not w.endswith('SS'):
            w = w[:-1]
        w = SPELLING.get(w, w)
        if w not in STOP:
            out.add(w)
    return out


def candidates(pool, text, strict=False, maxtier=4):
    """(tier, datasheets) for text in pool, most certain rule first:
    0 the exact name;
    1 the same words (plurals folded: "BULLGRYNS" = "Bullgryn Squad");
    2 the one name the cut-short text is the start of ("HEKATON LAND FOR");
    3 names holding every word of the text, fewest extra words;
    4 the longest name sitting whole inside the text ("AHRIMAN ARCH-SORCERER
      OF TZEENTCH" -> "Ahriman"; on a tie the name the title starts with).
    Several equally good names come back together - the caller calls that
    ambiguous. (None, []) when nothing fits."""
    if text in pool:
        return 0, pool[text]
    tw = words(text)
    if tw:
        same = [k for k in pool if words(k) == tw]
        if same:
            return 1, [f for k in same for f in pool[k]]
    if maxtier >= 2 and len(text) >= 6:
        hits = [k for k in pool if k.startswith(text + ' ') or (k.startswith(text) and len(text) >= 10)]
        if hits:
            return 2, [f for k in hits for f in pool[k]]
    if maxtier < 3 or not tw:
        return None, []
    sup = [(len(words(k) - tw), k) for k in pool if tw <= words(k)]
    if sup:
        best = min(x[0] for x in sup)
        if best <= 2:
            return 3, [f for n, k in sup if n == best for f in pool[k]]
    if maxtier < 4:
        return None, []
    sub = [k for k in pool if words(k) and words(k) <= tw and len(k) >= (7 if strict else 6)]
    # a one-word name only as the title's head or tail ("TALLYMAN", "GRETCHIN"),
    # not in the middle of other words
    sub = [k for k in sub if len(words(k)) > 1 or text.startswith(k + ' ') or text.endswith(' ' + k)
           or text.endswith(' ' + k + 'S') or text.startswith(k + 'S ')]
    if sub:
        most = max(len(words(k)) for k in sub)
        sub = [k for k in sub if len(words(k)) == most]
        pos = {k: (' ' + text + ' ').find(' ' + k + ' ') for k in sub}
        if any(p >= 0 for p in pos.values()):
            first = min(p for p in pos.values() if p >= 0)
            sub = [k for k in sub if pos[k] == first]
        return 4, [f for k in sub for f in pool[k]]
    return None, []


def pick(facts):
    cur = [f for f in facts if not f['legends']]
    facts = cur or facts
    names = {f['name'] for f in facts}
    return facts[0] if len(names) == 1 else None


_ALL = {}


def match(units, title):
    p = parse_title(title)
    if not p:
        return None, 'not a unit box'
    faction, text = p
    f, why = resolve(units, faction, text)
    sides = re.split(r' (?:AND|OR) ', text)
    if len(sides) > 1 and not (f and why in ('matched:0', 'matched:1')):
        # "EXOCRINE/HARUSPEX", "TORMENTORS AND INFRACTORS": a box that builds
        # one of two datasheets is not either one
        names = []
        for side in sides:
            if len(side) >= 4:
                g, _ = resolve(units, faction, side)
                if g and g['name'] not in names:
                    names.append(g['name'])
        if len(names) >= 2:
            return None, 'ambiguous: two kits ' + ' / '.join(names[:3])
        if not f and not why.startswith('ambiguous') and len(names) == 1 and ' OR ' not in text:
            # "GRIMALDUS & RETINUE": the one side that names a datasheet
            # (never half of an either-or kit whose other half BSData lacks)
            f = next(g for g in (resolve(units, faction, x)[0] for x in sides if len(x) >= 4) if g)
            return f, 'matched:4'
    return f, why


def resolve(units, faction, text):
    variants = [(text, 4)]
    for pre in ('PRIMARIS ', 'CHAOS ', 'NECRON '):
        if text.startswith(pre):
            variants.append((text[len(pre):], 4))
    if faction:
        # "TYRANIDS: WARRIORS" -> "TYRANID WARRIORS": exact / cut-short only
        variants.append((norm(faction).rstrip('S') + ' ' + text, 2))
    key = id(units)
    if key not in _ALL:
        allpool = {}
        for f, pool in units.items():
            for k, lst in pool.items():
                allpool.setdefault(k, []).extend(lst)
        _ALL[key] = allpool
    # the title's own faction first (every rule); then the whole game, where
    # a title naming a faction only takes an exact or cut-short name
    tries = ([(units.get(faction, {}), False, 4)] if faction else []) + [(_ALL[key], True, 2 if faction else 4)]
    for pool, strict, cap in tries:
        best = None
        for v, vcap in variants:
            t, c = candidates(pool, v, strict, min(cap, vcap))
            if c and t >= 2 and all(f['legends'] for f in c):
                c = []                        # an old Legends datasheet only on an exact name
            if c and (best is None or t < best[0]):
                best = (t, c)
        if best:
            f = pick(best[1])
            if f:
                return f, 'matched:%d' % best[0]
            return None, 'ambiguous: ' + ', '.join(sorted({x['name'] for x in best[1]})[:4])
    return None, 'no datasheet' + (' in ' + faction if faction else '')


# ------------------------------------------------------------------ main --

def fetch_json(src):
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={'user-agent': 'ExorW40k/1.0 (+https://exorgames.com)'})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    with open(src) as f:
        return json.load(f)


def sig(facts):
    s = json.dumps(facts, sort_keys=True, separators=(',', ':'))
    h = 5381
    for ch in s:
        h = ((h << 5) + h + ord(ch)) & 0xffffffff
    return 'v1:%x:%d' % (h, len(s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bsdata', required=True)
    ap.add_argument('--targets', default=TARGETS_URL)
    ap.add_argument('--out', default='data/w40k.json')
    ap.add_argument('--rev', default='')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    t0 = time.time()
    d = Data(a.bsdata)
    units = build_units(d)
    nunits = sum(len(v) for v in units.values())
    print('bsdata: %d factions, %d datasheets (%.1fs)' % (len(units), nunits, time.time() - t0))
    tj = fetch_json(a.targets)
    items = tj.get('items', tj if isinstance(tj, list) else [])
    counts = {'targets': len(items), 'matched': 0, 'notUnit': 0, 'ambiguous': 0, 'none': 0}
    products, misses = {}, []
    for it in items:
        f, why = match(units, it.get('title', ''))
        if f:
            counts['matched'] += 1
            facts = dict(f)
            facts['source'] = 'BSData wh40k-10e' + (' ' + a.rev[:7] if a.rev else '')
            facts['sig'] = sig(facts)
            products[str(it['id']).split('/')[-1]] = facts
            if a.dry or counts['matched'] <= 25:
                # tier: 0 exact, 1 same words, 2 cut-short title, 3 words contained, 4 name inside title
                print('MATCH%s %-60s -> %s / %s  %s models %s pts' % (why.split(':')[1], it['title'][:60], f['faction'], f['name'], f['models'], f['points']))
        elif why == 'not a unit box':
            counts['notUnit'] += 1
        else:
            counts['ambiguous' if why.startswith('ambiguous') else 'none'] += 1
            misses.append((it.get('title', ''), why))
    print('counts', json.dumps(counts))
    for t, why in misses[:120]:
        print('MISS   %-60s %s' % (t[:60], why))
    if a.dry:
        return
    out = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'bsdata': a.rev, 'counts': counts,
           'count': len(products), 'products': products}
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w') as f:
        json.dump(out, f, separators=(',', ':'), sort_keys=True)
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')


if __name__ == '__main__':
    main()
