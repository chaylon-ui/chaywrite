#!/usr/bin/env python3
"""BattleTech box contents for our products (owner, 2026-09-25: "lets do battle tech").

For every active BattleTech product (the worker's /bt/targets.json: id + title):
  - ForcePacks: what is in the box, from the pack's Sarna page (==Contents==:
    ** ''[[Marauder]]'' lines; the Alpha Strike card lines under it name the
    variants, e.g. ''Hunchback IIC 2'' / ''Hunchback IIC (Standard)'').
  - Salvage Boxes: the one unit named in the title.
Each unit's plain facts come from MegaMek's unit files (data/mekfiles in
github.com/MegaMek/mm-data): tonnage, weight class, tech base, role, walk /
run / jump, introduction year, Master Unit List id. Names and numbers only -
no descriptions, no record sheets.

Writes data/battletech.json:
  { generated, sources, counts, count, products: { <numeric id>: facts } }
  facts = { pack, kind, source, units: [{ name, model, type, tons, cls, tech,
            role, walk, run, jump, year, mul }], sig }
The worker's nightly sweep (src/bt.js) writes them to the products.

LICENCES: MegaMek data is CC BY-NC-SA 4.0 and Sarna is CC BY-NC-SA 3.0 - both
non-commercial. Only uncopyrightable facts (names, numbers) are taken, and
the owner decides before anything shows on the live store.

  python3 tools/battletech.py --mm DIR [--targets FILE|URL] [--out data/battletech.json] [--dry]
"""
import argparse, glob, hashlib, json, math, os, re, sys, time, urllib.parse, urllib.request

TARGETS_URL = "https://exor-binder.nevski.workers.dev/bt/targets.json"
SARNA = "https://www.sarna.net/wiki/api.php"
UA = "ExorGames-catalogue/1.0 (exorgames.com product facts; contact via the store)"

def key(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').lower())

# ---------------------------------------------------------------- MegaMek units

def weight_class(tons, utype):
    if tons is None:
        return ''
    if utype == 'Battle Armor':
        return ''
    if tons < 20: return 'Ultralight'
    if tons < 40: return 'Light'
    if tons < 60: return 'Medium'
    if tons < 80: return 'Heavy'
    if tons <= 100: return 'Assault'
    return 'Superheavy'

def tech_of(s):
    s = str(s or '')
    if re.search(r'mixed', s, re.I): return 'Mixed'
    if re.search(r'clan', s, re.I): return 'Clan'
    return 'Inner Sphere' if s else ''

def num(s):
    try:
        return int(float(str(s).strip()))
    except Exception:
        return None

def parse_mtf(path):
    d = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.startswith('#') or ':' not in line:
                continue
            k, v = line.split(':', 1)
            k = k.strip().lower()
            if k not in d:
                d[k] = v.strip()
    if not d.get('chassis'):
        return None
    walk = num(d.get('walk mp'))
    return {
        'chassis': d.get('chassis', ''), 'clanname': d.get('clanname', ''), 'model': d.get('model', ''),
        'type': 'BattleMech' if (d.get('config', '') or '').lower().find('lam') < 0 else 'LAM',
        'tons': num(d.get('mass')), 'tech': tech_of(d.get('techbase')), 'role': d.get('role', ''),
        'walk': walk, 'run': int(math.ceil(walk * 1.5)) if walk is not None else None,
        'jump': num(d.get('jump mp')) or 0, 'year': num(d.get('era')), 'mul': num(d.get('mul id')),
    }

BLK_TAG = re.compile(r'<([^/>][^>]*)>\s*\n(.*?)\n\s*</', re.S)

def parse_blk(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        text = '\n'.join(l for l in f.read().split('\n') if not l.startswith('#'))
    d = {}
    for m in BLK_TAG.finditer(text):
        k = m.group(1).strip().lower()
        if k not in d:
            d[k] = m.group(2).strip().split('\n')[0].strip()
    if not d.get('name'):
        return None
    ut = (d.get('unittype') or '').lower()
    utype = 'Battle Armor' if 'battlearmor' in ut else 'Combat Vehicle' if ut in ('tank', 'supportank', 'largesupporttank', 'vtol', 'supportvtol', 'naval') else (d.get('unittype') or 'Unit')
    walk = num(d.get('cruisemp'))
    return {
        'chassis': d.get('name', ''), 'clanname': '', 'model': d.get('model', ''), 'type': utype,
        'tons': num(d.get('tonnage')), 'tech': tech_of(d.get('type')), 'role': d.get('role', ''),
        'walk': walk, 'run': int(math.ceil(walk * 1.5)) if walk is not None and utype != 'Battle Armor' else walk,
        'jump': num(d.get('jumpingmp')) or 0, 'year': num(d.get('year')), 'mul': num(d.get('mul id:') or d.get('mul id')),
    }

def load_units(mm):
    base = os.path.join(mm, 'data', 'mekfiles')
    idx = {}
    n = 0
    for sub, ext, fn in (('meks', 'mtf', parse_mtf), ('vehicles', 'blk', parse_blk), ('battlearmor', 'blk', parse_blk)):
        for p in glob.glob(os.path.join(base, sub, '**', '*.' + ext), recursive=True):
            if re.search(r'unofficial|unoff', p, re.I):
                continue
            try:
                u = fn(p)
            except Exception:
                u = None
            if not u:
                continue
            n += 1
            for name in {u['chassis'], u['clanname']}:
                if name:
                    idx.setdefault(key(name), []).append(u)
    print('units loaded', n, 'names', len(idx))
    return idx

def pick_variant(variants, hints):
    """The variant a box's Alpha Strike cards name, else the earliest one."""
    for h in hints:
        hk = key(h)
        for v in variants:
            if hk and (key(v['chassis'] + v['model']) == hk or key(v['clanname'] + v['model']) == hk):
                return v
        m = re.search(r'\(standard\)|\bprime\b', h, re.I)
        if m:
            for v in variants:
                if re.search(r'^prime$|standard', v['model'] or '', re.I):
                    return v
    live = [v for v in variants if v['year']]
    return sorted(live or variants, key=lambda v: (v['year'] or 9999, len(v['model'] or '')))[0]

def unit_facts(name, target, hints, idx):
    cands = [name, target]
    m = re.match(r'^(.*?)\s*\((.*?)\)$', target or '')
    if m:
        cands += [m.group(1), m.group(2)]
    cands += [re.sub(r'\s*\(.*?\)', '', c or '') for c in list(cands)]
    for c in cands:
        vs = idx.get(key(c))
        if vs:
            v = pick_variant(vs, hints)
            return {'name': name, 'model': v['model'], 'type': v['type'], 'tons': v['tons'],
                    'cls': weight_class(v['tons'], v['type']), 'tech': v['tech'], 'role': v['role'],
                    'walk': v['walk'], 'run': v['run'], 'jump': v['jump'], 'year': v['year'], 'mul': v['mul']}
    return None

# ---------------------------------------------------------------- Sarna

def sarna(**params):
    params['format'] = 'json'
    url = SARNA + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read().decode('utf-8'))
            time.sleep(0.6)
            return data
        except Exception as e:
            print('sarna retry', attempt, str(e)[:80])
            time.sleep(3 + attempt * 3)
    return {}

def wikitext(title):
    j = sarna(action='parse', page=title, prop='wikitext', redirects=1)
    if not j or 'error' in j:
        return None, None
    return j['parse']['title'], j['parse']['wikitext']['*']

LINK = re.compile(r"\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]")

def contents(text):
    """[(display name, link target, [variant hints])] from ==Contents==."""
    m = re.search(r'==\s*Contents\s*==(.*?)(\n==[^=]|\Z)', text, re.S)
    if not m:
        return []
    out, hints_all = [], []
    for line in m.group(1).split('\n'):
        s = line.strip()
        if s.startswith('***'):
            hints_all += re.findall(r"''([^']+)''", s)
            continue
        if s.startswith('**') and not s.startswith('***'):
            lk = LINK.search(s)
            if lk and "''" in s:
                target = lk.group(1).strip()
                disp = (lk.group(2) or target).strip()
                if not re.search(r'card|pilot|miniature|record sheet', disp, re.I):
                    out.append([disp, target, []])
    for u in out:
        u[2] = [h for h in hints_all if key(u[0]) and key(u[0]) in key(h) or key(re.sub(r'\s*\(.*?\)', '', u[1])) in key(h)]
    return out

def pack_pages():
    t, text = wikitext('List of ForcePacks')
    pages = []
    for lk in LINK.finditer(text or ''):
        tt = lk.group(1).strip()
        if tt.startswith('BattleTech:') and tt not in pages:
            pages.append(tt)
    print('sarna forcepack pages', len(pages))
    return pages

def title_key(t):
    k = key(t)
    for w in ('battletech', 'forcepack', 'forcepacks', 'forcepak'):
        k = k.replace(w, '')
    return k

def search_pack(title):
    q = re.sub(r'(?i)\b(battletech|forcepack|force pack)\b', '', title).strip(' :-')
    j = sarna(action='query', list='search', srsearch=q + ' ForcePack', srlimit=5)
    for s in ((j or {}).get('query') or {}).get('search') or []:
        tk, want = title_key(s['title']), title_key(q)
        if want and (tk == want or tk.endswith(want) or want.endswith(tk)):
            return s['title']
    return None

# ---------------------------------------------------------------- main

def fetch_json(src):
    if re.match(r'https?://', src):
        req = urllib.request.Request(src, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))
    with open(src) as f:
        return json.load(f)

def sig(facts):
    s = json.dumps(facts, sort_keys=True, separators=(',', ':'))
    return 'v1:' + hashlib.sha1(s.encode()).hexdigest()[:12]

SKIP = re.compile(r'\b(hc|hardback|rpg|manual|readout|operations|warfare|map|mat|battlemat|mappack|deck|counters|case|plushytech|plushy|paint|dice|legends|universe|recognition guide|novel|sourcebook|box set|boxed set|beginner box|game of armored combat|alpha strike|destiny|mercenaries box|expansion box|asst|assortment)\b', re.I)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mm', required=True)
    ap.add_argument('--targets', default=TARGETS_URL)
    ap.add_argument('--out', default='data/battletech.json')
    ap.add_argument('--rev', default='')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    idx = load_units(a.mm)
    items = fetch_json(a.targets).get('items') or []
    pages = pack_pages()
    by_key = {title_key(p): p for p in pages}
    counts = {'targets': len(items), 'forcepack': 0, 'salvage': 0, 'skipped': 0, 'nopack': 0, 'unitMissing': 0}
    products, cache, report = {}, {}, []

    for it in items:
        title = it['title']
        pid = str(it['id']).split('/')[-1]
        sal = re.search(r'(?i)salvage box\s*:?\s*(.+)$', title)
        if sal and not re.search(r'(?i)asst|assortment|\bmercenaries\b|battlefield support', title):
            name = re.sub(r'(?i)\b\d+\s*ct\b', '', sal.group(1)).strip()
            u = None
            for cand in (name, name.replace(' ', ''), re.sub(r'(?i)\s*lam$', '', name)):
                u = unit_facts(cand.title(), cand, [], idx)
                if u:
                    break
            if u:
                u['name'] = re.sub(r'(?i)urban\s*mech', 'UrbanMech', name.title())
                f = {'pack': name.title(), 'kind': 'salvage', 'source': 'MegaMek', 'units': [u]}
                f['sig'] = sig(f); products[pid] = f; counts['salvage'] += 1
                report.append(('SALVAGE', title, u['name'], u['tons']))
            else:
                counts['unitMissing'] += 1; report.append(('SALVAGE?', title, name, ''))
            continue
        if SKIP.search(title) and not re.search(r'(?i)lance|star|level ii|platoon|company|squadron|points|pack', title):
            counts['skipped'] += 1
            continue
        tk = title_key(title)
        page = by_key.get(tk)
        if not page:
            for k2, p2 in by_key.items():
                if tk and (k2.endswith(tk) or tk.endswith(k2)) and min(len(tk), len(k2)) >= 10:
                    page = p2; break
        if not page and re.search(r'(?i)lance|star|level ii|platoon|company|squadron|points|forcepack|force pack', title):
            page = search_pack(title)
        if not page:
            counts['nopack'] += 1
            report.append(('NOPACK', title, '', ''))
            continue
        if page not in cache:
            cache[page] = wikitext(page)
        ptitle, text = cache[page]
        units, missing = [], []
        for disp, target, hints in contents(text or ''):
            u = unit_facts(disp, target, hints, idx)
            if u: units.append(u)
            else: missing.append(disp)
        if not units:
            counts['nopack'] += 1
            report.append(('EMPTY', title, page, ','.join(missing)))
            continue
        if missing:
            counts['unitMissing'] += len(missing)
        f = {'pack': re.sub(r'^BattleTech:\s*', '', ptitle or page), 'kind': 'forcepack', 'source': 'Sarna + MegaMek', 'units': units}
        f['sig'] = sig(f)
        products[pid] = f
        counts['forcepack'] += 1
        report.append(('PACK', title, f['pack'], '; '.join('%s %s %st %s' % (u['name'], u['model'], u['tons'], u['cls']) for u in units) + (' | MISSING ' + ','.join(missing) if missing else '')))

    for r in report:
        print(' | '.join(str(x) for x in r))
    print('counts', json.dumps(counts))
    out = {'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'sources': {'megamek': a.rev, 'sarna': 'List of ForcePacks'},
           'counts': counts, 'count': len(products), 'products': products}
    if a.dry:
        print('dry run: not writing', a.out)
        return
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    old = None
    if os.path.exists(a.out):
        with open(a.out) as f:
            old = json.load(f)
    if old and old.get('products') == products:
        print('no change')
        return
    with open(a.out, 'w') as f:
        json.dump(out, f, separators=(',', ':'), sort_keys=True)
    print('wrote', a.out, len(products))

if __name__ == '__main__':
    main()
