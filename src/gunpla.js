/* Exor Games - Gunpla kit facts (owner, 2026-09-23: "would there be an
   option for Gunpla to have it auto update stats and specs like with board
   games?" -> "Let's do the Gunpla one with titles and Bandai").

   Two sources, both free and credential-less:

   1. OUR OWN TITLE, for every kit. BinderPOS/Plamod titles already carry
      the facts a builder shops by, in varying order:
        "HGUC 1/144 #116 Sinanju", "HGUC #45 1/144 MS-14JG Gelgoog Jager
        "Gundam 0080"", "1/144 HGAW GUNDAM X", "BB365 SINANJU",
        "SD SANGOKU SOKETSUDEN [08] Lyu Bu SINANJU & RED HARE"
      -> grade (High Grade, Master Grade ...), line (Universal Century,
      Cosmic Era ...), scale, kit number and the quoted series.

   2. BANDAI'S OWN KIT PAGE, when the kit is on it. tools/bandai-kits.py
      reads Bandai Spirits' global hobby site (English) weekly into
      data/bandai-kits.json: English kit name, launch date, Japanese list
      price, age rating and the page itself. Bandai publishes no barcode
      there (2026-09-23), so the match is by NAME: same grade family, same
      scale, same kit name once punctuation is dropped. Only a unique match
      is used - a wrong release date is worse than none.

   Everything is written to the exor.* namespace as gp_* metafields (never
   the title, price, stock or tags that BinderPOS owns). A signature of the
   values (exor.gp_sig) is written with them, so the nightly pass rewrites a
   product only when something changed - a kit that Bandai adds later gets
   its release date the week it appears. */

export const GUNPLA_QUERY = "product_type:Gunpla AND status:active";
export const KITS_FILE_URL = "https://raw.githubusercontent.com/chaylon-ui/chaywrite/main/data/bandai-kits.json";

/* Most specific first. fam = the grade family the Bandai site files it
   under ("HG 1/144 GM SNIPER" is an HGUC kit on Bandai's page); line = the
   HG sub-line's timeline or show. */
const G = (re, code, grade, fam, line, scale) => ({ re, code, grade, fam, line: line || "", scale: scale || "" });
export const GRADES = [
  G(/\bPG\s*UNLEASHED\b/i, "PG UNLEASHED", "Perfect Grade Unleashed", "PG", "", "1/60"),
  G(/\bPG\b/i, "PG", "Perfect Grade", "PG", "", "1/60"),
  G(/\bMGEX\b/i, "MGEX", "Master Grade EX", "MG", "", "1/100"),
  G(/\bMGSD\b/i, "MGSD", "Master Grade SD", "MGSD"),
  G(/\bMG\b/i, "MG", "Master Grade", "MG", "", "1/100"),
  G(/\bRG\b/i, "RG", "Real Grade", "RG", "", "1/144"),
  G(/\bRE\s*\/\s*100\b|^RE\s+1\/100\b/i, "RE/100", "Reborn-One Hundred", "RE", "", "1/100"),
  G(/\bHI-?RESOLUTION\s+MODEL\b|\bHIRM\b/i, "HiRM", "Hi-Resolution Model", "HIRM", "", "1/100"),
  G(/\bFULL\s+MECHANICS\b/i, "FM", "Full Mechanics", "FM", "", "1/100"),
  G(/\bMEGA\s+SIZE(?:\s+MODEL)?\b/i, "MEGA SIZE", "Mega Size Model", "MEGA", "", "1/48"),
  G(/\bENTRY\s+GRADE\b|\bEG\b/i, "EG", "Entry Grade", "EG", "", "1/144"),
  G(/\bEX-?STANDARD\b/i, "SDEX", "SD Gundam EX-Standard", "SD"),
  G(/\bSD\s+GUNDAM\s+CROSS\s+SILHOUETTE\b|\bSDCS\b/i, "SDCS", "SD Gundam Cross Silhouette", "SD"),
  G(/\bSDW\s+HEROES\b/i, "SDW HEROES", "SD Gundam World Heroes", "SD"),
  G(/\bSANGOKU\s*SOKETSUDEN\b/i, "SD SANGOKU", "SD Sangoku Soketsuden", "SD"),
  G(/\bSDBF\b/i, "SDBF", "SD Build Fighters", "SD"),
  G(/\bBB\s*\d{2,3}\b|\bBB\s+SENSHI\b/i, "BB", "BB Senshi", "SD"),
  G(/\bHAROPLA\b/i, "HAROPLA", "Haropla", "HAROPLA"),
  G(/\bBEST\s+MECHA\s+COLLECTION\b/i, "BEST MECHA", "Best Mecha Collection", "BMC", "", "1/144"),
  G(/\bHGUC\b/i, "HGUC", "High Grade", "HG", "Universal Century", "1/144"),
  G(/\bHGCE\b/i, "HGCE", "High Grade", "HG", "Cosmic Era", "1/144"),
  G(/\bHGAC\b/i, "HGAC", "High Grade", "HG", "After Colony", "1/144"),
  G(/\bHGAW\b/i, "HGAW", "High Grade", "HG", "After War", "1/144"),
  G(/\bHGFC\b/i, "HGFC", "High Grade", "HG", "Future Century", "1/144"),
  G(/\bHGBD\s*:?\s*R\b/i, "HGBD:R", "High Grade", "HG", "Build Divers Re:RISE", "1/144"),
  G(/\bHGBD\b/i, "HGBD", "High Grade", "HG", "Build Divers", "1/144"),
  G(/\bHGBF\b/i, "HGBF", "High Grade", "HG", "Build Fighters", "1/144"),
  G(/\bHGBC\b/i, "HGBC", "High Grade", "HG", "Build Custom", "1/144"),
  G(/\bHGTB\b/i, "HGTB", "High Grade", "HG", "Thunderbolt", "1/144"),
  G(/\bHG\s*00\b/i, "HG00", "High Grade", "HG", "Gundam 00", "1/144"),
  G(/\bHG\s*AGE\b/i, "HGAGE", "High Grade", "HG", "Gundam AGE", "1/144"),
  G(/\bHG\s*ORPHANS\b|\bORPHANS\s+HG\b|\bHGIBO\b/i, "HGIBO", "High Grade", "HG", "Iron-Blooded Orphans", "1/144"),
  G(/\bHG\b/i, "HG", "High Grade", "HG"),
  G(/\bSD\b/i, "SD", "SD Gundam", "SD"),
];

const SCALE = /\b1\s*\/\s*(144|100|72|60|48|35|24|20|12|1)\b/;
// Mis-decoded UTF-8 in some BinderPOS titles ("GUNDVÃ–LVA", "DOANÃ¢â‚¬â„¢S") and
// the full-width roman numerals Bandai uses ("Mk-Ⅱ").
const MOJIBAKE = [[/Ã–/g, "O"], [/Ã¶/g, "o"], [/Ã¢â‚¬â„¢|â€™|’/g, "'"], [/Ⅱ/g, "II"], [/Ⅲ/g, "III"], [/Ⅳ/g, "IV"], [/ν/g, "Nu"]];
export function cleanTitle(s) {
  let t = String(s || "");
  for (const [re, to] of MOJIBAKE) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

// "HGUC 1/144 #116 Sinanju" -> { code:"HGUC", grade:"High Grade", fam:"HG",
//   line:"Universal Century", scale:"1/144", scaleStated:true, number:"116",
//   series:"", name:"Sinanju" }. Returns null when no grade is recognised.
export function parseGunplaTitle(raw) {
  const title = cleanTitle(raw);
  const g = GRADES.find((x) => x.re.test(title));
  if (!g) return null;
  const sm = title.match(SCALE);
  const scale = sm ? "1/" + sm[1] : g.scale;
  let number = "";
  const nm = title.match(/#\s*0*(\d{1,3})\b/) || title.match(/\bBB\s*(\d{2,3})\b/i) ||
    title.match(/\bEX-?STANDARD\s+0*(\d{1,3})\b/i) || title.match(/\[\s*0*(\d{1,3})\s*\]/) ||
    title.match(/\bHG\s+1\/144\s+(R\d{2})\b/i);
  if (nm) number = nm[1].toUpperCase();
  // Series in quotes: "Gundam SEED", or 'Char's Counterattack ...' (a
  // single-quoted one may hold apostrophes, so it must end at a comma or
  // the end of the title).
  const qm = title.match(/"([^"]{3,60})"/) || title.match(/\s'(.{3,60}?)'\s*(?:,|$)/);
  const series = qm ? qm[1].trim() : "";
  let name = (qm ? title.replace(qm[0], " ") : title)
    .replace(/\bEX-?STANDARD\s+\d{1,3}\b/gi, " ")
    .replace(g.re, " ")
    .replace(SCALE, " ")
    .replace(/#\s*\d{1,3}\b|\[\s*\d{1,3}\s*\]/g, " ")
    .replace(/\bBB\s*\d{2,3}\b/gi, " ")
    .replace(/\b(Bandai\s+Spirits|Bandai|Model\s+Kit|Scale|Gundam\s+Universe)\b/gi, " ")
    .replace(/^\s*(R\d{2})\b/, " ")
    .replace(/^[\s,\-–]*(SD(\s+GUNDAM)?\b)?[\s,\-–]*/i, "")
    .replace(/[\s,\-–]+$/, "")
    .replace(/\s+/g, " ").trim();
  if (g.code === "HGIBO") name = name.replace(/\bORPHANS\b/i, "").trim();
  return { code: g.code, grade: g.grade, fam: g.fam, line: g.line, scale, scaleStated: !!sm, number, series, name };
}

/* Matching key parts. Letters and digits only, upper case: "SINANJU STEIN
   (NARRATIVE Ver.)" and "SINANJU STEIN (NARRATIVE VER)" are one key. */
export function coreKey(name) {
  return cleanTitle(name).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, "");
}
// A mobile-suit model number (RX-78-2, MS-06S, XXXG-01W, GN-0000+GNR-010)
// is dropped for a second, looser key - Bandai's English names include it
// on some kits and not others.
const MODEL_NO = /\b[A-Z]{1,5}\d*[A-Z]*-[0-9A-Z]+(?:[-+/][0-9A-Z]+)*\b/g;
// The model numbers in a name, letters and digits only ("RX-93ff" -> "RX93FF").
export function modelNos(name) {
  return (cleanTitle(name).toUpperCase().match(MODEL_NO) || []).map((m) => m.replace(/[^A-Z0-9]/g, ""));
}
export function looseKey(name) {
  const stripped = cleanTitle(name).toUpperCase().replace(MODEL_NO, " ").replace(/\s+/g, " ").trim();
  const words = stripped.split(" ").filter((w) => /[A-Z0-9]/.test(w));
  return words.length >= 2 ? coreKey(stripped) : "";
}

/* data/bandai-kits.json -> lookup tables keyed three ways. A key two kits
   share is marked ambiguous (null) and never used. */
export function indexKits(json) {
  const exact = new Map(), noScale = new Map(), loose = new Map();
  const put = (m, k, kit) => { if (!k) return; m.set(k, m.has(k) && m.get(k) !== kit ? null : kit); };
  const kits = (json && json.kits) || {};
  for (const id in kits) {
    const k = kits[id];
    if (!k || !k.name) continue;
    const p = parseGunplaTitle(k.name);
    if (!p) continue;
    const core = coreKey(p.name);
    if (!core) continue;
    const kit = { id, name: k.name, url: k.url || "", launch: k.launch || "", age: Number.isFinite(k.age) ? k.age : null, priceYen: Number.isFinite(k.price_yen) ? k.price_yen : null, models: modelNos(p.name) };
    put(exact, p.fam + "|" + p.scale + "|" + core, kit);
    put(noScale, p.fam + "|" + core, kit);
    put(loose, p.fam + "|" + p.scale + "|" + looseKey(p.name), kit);
  }
  return { exact, noScale, loose, size: Object.keys(kits).length };
}

export function matchKit(parsed, idx) {
  if (!parsed || !idx) return null;
  const core = coreKey(parsed.name);
  if (!core) return null;
  const a = idx.exact.get(parsed.fam + "|" + parsed.scale + "|" + core);
  if (a) return a;
  if (a === null) return null;                       // two Bandai kits share the name: no guess
  const b = idx.noScale.get(parsed.fam + "|" + core);
  if (b) return b;
  if (b === null) return null;
  const lk = looseKey(parsed.name);
  const c = lk ? idx.loose.get(parsed.fam + "|" + parsed.scale + "|" + lk) : null;
  if (!c) return null;
  /* The loose key ignores model numbers, but on Bandai's side a model number
     can BE the difference: "RG 1/144 RX-93ff ν GUNDAM" is the 2022 Gundam
     Side-F kit, not the 2019 RG ν Gundam (which Bandai's English list lacks),
     and our "RG 1/144 Nu GUNDAM" matched it (2026-09-23). So a Bandai kit
     whose name carries a model number only matches a title carrying it too. */
  if (c.models && c.models.length) {
    const ours = modelNos(parsed.name);
    if (!c.models.some((m) => ours.includes(m))) return null;
  }
  return c;
}

// Small, stable, non-cryptographic: only has to notice a change.
export function sigOf(list) {
  const s = list.map((m) => m.key + "=" + m.value).join("\n");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "v1:" + h.toString(16) + ":" + s.length;
}

const GP_KEYS = ["gp_line", "gp_scale", "gp_number", "gp_series", "gp_release", "gp_year", "gp_age", "gp_price_jpy", "gp_bandai_url", "gp_bandai_name"];
const MF = (ownerId, key, type, value) => ({ ownerId, namespace: "exor", key, type, value: String(value) });

/* One Gunpla product -> the metafields it should carry, or null when the
   title names no grade we know (nothing is written then). */
export function gunplaMetafields(ownerId, title, idx, today) {
  const p = parseGunplaTitle(title);
  if (!p) return null;
  const kit = matchKit(p, idx);
  const facts = [];
  facts.push(MF(ownerId, "gp_grade", "single_line_text_field", p.grade));
  facts.push(MF(ownerId, "gp_grade_code", "single_line_text_field", p.code));
  if (p.line) facts.push(MF(ownerId, "gp_line", "single_line_text_field", p.line));
  if (p.scale) facts.push(MF(ownerId, "gp_scale", "single_line_text_field", p.scale));
  if (p.number) facts.push(MF(ownerId, "gp_number", "single_line_text_field", p.number));
  if (p.series) facts.push(MF(ownerId, "gp_series", "single_line_text_field", p.series));
  if (kit) {
    if (kit.launch) {
      facts.push(MF(ownerId, "gp_release", "single_line_text_field", kit.launch));
      facts.push(MF(ownerId, "gp_year", "number_integer", Number(kit.launch.slice(0, 4))));
    }
    if (kit.age != null) facts.push(MF(ownerId, "gp_age", "number_integer", kit.age));
    if (kit.priceYen != null) facts.push(MF(ownerId, "gp_price_jpy", "number_integer", kit.priceYen));
    if (kit.url) facts.push(MF(ownerId, "gp_bandai_url", "url", kit.url));
    facts.push(MF(ownerId, "gp_bandai_name", "single_line_text_field", kit.name));
  }
  const status = kit ? "ok" : "title";
  facts.push(MF(ownerId, "enrich_status", "single_line_text_field", status));
  const sig = sigOf(facts);
  facts.push(MF(ownerId, "gp_sig", "single_line_text_field", sig));
  facts.push(MF(ownerId, "enriched_at", "single_line_text_field", today));
  // gp_* keys this product should NOT carry now (e.g. its Bandai match went
  // away): the sweep deletes them so an old wrong fact cannot linger.
  const have = new Set(facts.map((m) => m.key));
  const clear = GP_KEYS.filter((k) => !have.has(k));
  return { status, sig, metafields: facts, clear, parsed: p, kit };
}
