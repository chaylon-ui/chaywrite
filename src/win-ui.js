/* ---------------- Enter to win: the pages and the emails ----------------
   Markup only; every decision is made in src/win.js. Public pages are
   self-contained (one stylesheet inline, no script - it has to work on
   any phone that scanned the code at the booth); the admin page shares
   the 9Pocket shell (src/stage-ui.js). */

import { shell, esc, when, LOGO } from "./stage-ui.js";
import { MALLOW_URL } from "./stage-email.js";

const B = "/win", A = "/9pocket/win";
export const REPLY_TO = "customerservice@exorgames.com";
export const INTERESTS = ["Magic: The Gathering", "Pokémon", "Yu-Gi-Oh!", "One Piece", "Lorcana", "Video games", "Board games", "Warhammer & minis"];
const EXOR = "https://exorgames.com", MALLOW = "https://mallowgames.com";
export const SHORT_URL = "https://exorgames.com/win";   // the address on the QR code: a Shopify URL redirect to the worker page (owner, 2026-10-16)
export const ASSET_ORIGIN = "https://exor-binder.nevski.workers.dev";   // the emails need absolute image addresses; public/ files are served from the worker
// The owner's graphic (2026-10-16): the whole thing says "Thank you - you're entered!"
// over the Mallow Games band (buys / sells / trades video games, credit at Exor);
// the band alone rides in the emails and on the landing page's Mallow card.
export const ENTERED_ART = "/win-entered.jpg";
export const MALLOW_BAND = "/win-mallow.jpg";
const RED = "#d62c28", INK = "#27302f", PINK = "#e2529a", PAPER = "#f6f7f8", MUTED = "#6b7780";

export const prizeShort = (cfg) => { const m = /\$\s?\d[\d,]*/.exec(String((cfg && cfg.prize) || "")); return m ? m[0].replace(/\s/g, "") : String((cfg && cfg.prize) || "the prize"); };
export function closesText(cfg) {
  if (!cfg || !cfg.closesAt) return "when the show ends";
  const d = new Date(cfg.closesAt);
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/Halifax", weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-CA", { timeZone: "America/Halifax", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\./g, "").toLowerCase();
  return `${day} at ${time} (Atlantic)`;
}
const back = (o) => B + (o && o.preview ? "?preview=" + encodeURIComponent(o.preview) : "");

const PUB_CSS = `:root{--red:${RED};--ink:${INK};--yel:#ffd800;--pink:${PINK};--cream:#fff7ee;--mute:#5f6b76}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--cream)}a{color:var(--red)}
.top{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--ink);color:#fff}.top img{height:44px;width:auto;display:block}.top .x{font-size:22px;color:#9aa5ad}.top .m{color:var(--pink);font-weight:800;font-size:18px;letter-spacing:.01em}.top .sp{flex:1}.top .ev{font-size:12px;color:#c7d0d6;text-align:right;max-width:40%}
.prev{background:var(--yel);color:var(--ink);font-weight:700;font-size:14px;padding:8px 16px;text-align:center}
.hero{padding:30px 16px 24px;text-align:center;background:linear-gradient(180deg,#fff 0,var(--cream) 100%)}.kicker{margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--red)}
h1{margin:0 0 10px;font-size:clamp(30px,8.5vw,46px);line-height:1.05;letter-spacing:-.01em}h1 b{color:var(--red)}.hero p{margin:0 auto 6px;max-width:560px;color:var(--mute)}.hero .big{font-size:19px;color:var(--ink)}
.btn{display:inline-block;background:var(--red);color:#fff;font-weight:800;padding:14px 24px;border-radius:12px;text-decoration:none;border:0;font:inherit;font-size:17px;font-weight:800;cursor:pointer;margin-top:12px}.btn:hover{background:#b3211e}.btn.pink{background:var(--pink)}.btn.pink:hover{background:#c73f84}.btn.wide{width:100%;padding:16px}.btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 40px}.rules{padding-top:24px}.rules ol{padding-left:20px}.rules li{margin:10px 0}
.card{background:#fff;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 1px 2px rgba(39,48,47,.08)}.card h2{margin:0 0 8px;font-size:26px}.card h3{margin:0 0 6px;font-size:21px}
.row{display:grid;gap:10px}@media(min-width:520px){.row{grid-template-columns:1fr 1fr}}
label.f,p.f{display:block;font-weight:700;font-size:14px;margin:12px 0 4px}.opt{color:var(--mute);font-weight:500}input.t{width:100%;font:inherit;font-size:17px;padding:12px;border:1px solid #cbd3d9;border-radius:10px;background:#fff}input.t:focus{outline:2px solid var(--red);outline-offset:1px;border-color:var(--red)}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips label{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border:1px solid #cbd3d9;border-radius:999px;font-size:14px;background:#fff;cursor:pointer}.chips input{margin:0;width:18px;height:18px}
.chk{display:flex;gap:10px;align-items:flex-start;margin:14px 0;font-size:14px;line-height:1.45}.chk input{width:24px;height:24px;flex:none;margin:0}
.err{background:#fde8e8;color:#7f1d1d;border-radius:10px;padding:10px 12px;margin:0 0 12px;font-weight:600}.fine{font-size:13px;color:var(--mute);margin:10px 0 0}
.hp{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
.split{display:grid;gap:16px;margin:16px 0}.split .card{margin:0}@media(min-width:640px){.split{grid-template-columns:1fr 1fr}}
.entered{display:block;width:100%;max-width:640px;height:auto;margin:0 auto 16px;border-radius:14px;box-shadow:0 1px 3px rgba(39,48,47,.12)}
.exor{border-top:6px solid var(--red)}.exor h3{color:var(--red)}.mallow{border-top:6px solid var(--pink)}.mallow h3{color:var(--pink)}.mallow img{width:100%;height:auto;border-radius:10px;margin:0 0 12px;display:block}
.credit{background:var(--cream);border-radius:10px;padding:10px 12px;font-size:15px}.lnk{font-weight:800;text-decoration:none}.lnk.pink{color:var(--pink)}
.steps{counter-reset:s;list-style:none;padding:0;margin:0}.steps li{position:relative;padding:4px 0 4px 46px;margin:8px 0}.steps li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:2px;width:34px;height:34px;border-radius:50%;background:var(--yel);color:var(--ink);font-weight:800;display:grid;place-items:center}
footer{font-size:13px;color:var(--mute);text-align:center;padding:16px 16px 28px;line-height:1.6}footer a{color:var(--mute)}`;

const pub = (title, body, cfg, o) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${PUB_CSS}</style></head><body>
<header class="top"><a href="${EXOR}" target="_blank" rel="noopener"><img src="${LOGO}" alt="Exor Games" width="61" height="44"></a><span class="x">×</span><span class="m">Mallow Games</span><span class="sp"></span><span class="ev">${esc(cfg.event)}<br>${esc(cfg.place)}</span></header>
${o && o.preview ? `<div class="prev">Preview - not open to the public yet. Entries made from this preview are marked test and never drawn.</div>` : ""}
${body}
<footer>Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6 · <a href="mailto:${REPLY_TO}">${REPLY_TO}</a><br><a href="${B}/rules${o && o.preview ? "?preview=" + encodeURIComponent(o.preview) : ""}">Contest rules</a> · <a href="${EXOR}" target="_blank" rel="noopener">ExorGames.com</a> · <a href="${MALLOW}" target="_blank" rel="noopener">MallowGames.com</a></footer></body></html>`;

const ABOUT = (cfg) => `<section class="split">
<div class="card exor"><h3>Exor Games</h3><p>Trading cards, board games, Warhammer, accessories and more - in store and at <a href="${EXOR}" target="_blank" rel="noopener">ExorGames.com</a>. Magic, Pokémon, Yu-Gi-Oh!, One Piece, Lorcana... if it comes in a booster, we probably have it.</p><a class="lnk" href="${EXOR}" target="_blank" rel="noopener">Shop ExorGames.com →</a></div>
<div class="card mallow"><a href="${MALLOW_URL}" target="_blank" rel="noopener"><img src="${MALLOW_BAND}" alt="Mallow Games buys, sells and trades video games - use your video games for Exor Games store credit" width="1200" height="373" loading="lazy"></a><h3>Mallow Games</h3><p>Our sister shop for video games. We <b>buy and sell used video games</b>. Got games gathering dust? Check what we pay on the Mallow Games buylist at <a href="${MALLOW}" target="_blank" rel="noopener">mallowgames.com</a> and take cash or Exor Games store credit.</p><p class="credit">Win the draw and your <b>${esc(prizeShort(cfg))} credit</b> works on cards <i>or</i> video games.</p><a class="lnk pink" href="${MALLOW_URL}" target="_blank" rel="noopener">See the video game buylist →</a></div></section>`;

const HOW = (cfg, o) => `<section class="card"><h3>How it works</h3><ol class="steps"><li><b>Enter</b> your name and email above.</li><li><b>Tap the link</b> we email you - that confirms your entry (and your spot on our list).</li><li><b>One winner</b> is drawn at random ${esc(cfg.drawText)} and emailed. Entries close ${esc(closesText(cfg))}.</li></ol><p class="fine">No purchase necessary. Open to residents of Canada (excluding Quebec) who are the age of majority in their province. Full <a href="${B}/rules${o && o.preview ? "?preview=" + encodeURIComponent(o.preview) : ""}">contest rules</a>.</p></section>`;

export function renderLanding(cfg, o) {
  o = o || {};
  const f = o.f || {};
  const ints = Array.isArray(f.interests) ? f.interests : f.interests ? [f.interests] : [];
  return pub(`Win ${prizeShort(cfg)} in store credit - Exor Games × Mallow Games`, `
<section class="hero"><p class="kicker">${esc(cfg.event)} · ${esc(cfg.place)} · ${esc(cfg.dates)}</p>
<h1>Win <b>${esc(prizeShort(cfg))}</b> in store credit</h1>
<p class="big">Spend it at ExorGames.com on trading cards, board games and more - or on video games from Mallow Games.</p>
<p>One winner, drawn ${esc(cfg.drawText)}. Takes 30 seconds.</p>
<a class="btn" href="#enter">Enter the draw</a></section>
<div class="wrap">
<section class="card" id="enter"><h2>Enter to win</h2>
${o.err ? `<div class="err" role="alert">${esc(o.err)}</div>` : ""}
<form method="post" action="${esc(back(o))}">
<div class="row"><div><label class="f" for="first">First name</label><input class="t" id="first" name="first" value="${esc(f.first)}" required maxlength="60" autocomplete="given-name"></div>
<div><label class="f" for="last">Last name</label><input class="t" id="last" name="last" value="${esc(f.last)}" maxlength="60" autocomplete="family-name"></div></div>
<label class="f" for="email">Email</label><input class="t" id="email" type="email" name="email" value="${esc(f.email)}" required maxlength="160" autocomplete="email" inputmode="email">
<p class="f">What do you play or collect? <span class="opt">(optional)</span></p>
<div class="chips">${INTERESTS.map((i) => `<label><input type="checkbox" name="interests" value="${esc(i)}"${ints.includes(i) ? " checked" : ""}> ${esc(i)}</label>`).join("")}</div>
<label class="chk"><input type="checkbox" name="consent" value="1"${f.consent ? " checked" : ""}${cfg.consentRequired ? " required" : ""}><span>Yes - email me Exor Games and Mallow Games news: new releases, deals, events and what we're buying.${cfg.consentRequired ? "" : " (optional)"} Unsubscribe any time.</span></label>
<label class="chk"><input type="checkbox" name="rules" value="1"${f.rules ? " checked" : ""} required><span>I am the age of majority in my province and I accept the <a href="${B}/rules${o.preview ? "?preview=" + encodeURIComponent(o.preview) : ""}" target="_blank">contest rules</a>.</span></label>
<div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="btn wide" type="submit">Enter the draw</button>
<p class="fine">We'll email you a confirmation link - your entry counts once you tap it. One entry per person.</p>
</form></section>
${ABOUT(cfg)}
${HOW(cfg, o)}
</div>`, cfg, o);
}

export function renderHolding(cfg, o) {
  o = o || {};
  const ended = !!o.ended;
  return pub(`${cfg.event} - Exor Games × Mallow Games`, `<section class="hero"><p class="kicker">${esc(cfg.event)} · ${esc(cfg.place)} · ${esc(cfg.dates)}</p>
<h1>${ended ? "Entries have closed" : "Our Expo draw opens at the show"}</h1>
<p class="big">${ended ? `Thanks to everyone who entered! The winner is drawn ${esc(cfg.drawText)} and emailed.` : `Come see Exor Games and Mallow Games at the ${esc(cfg.event)} - scan the code at our booth to enter to win <b>${esc(prizeShort(cfg))}</b> in store credit.`}</p></section>
<div class="wrap">${ABOUT(cfg)}</div>`, cfg, o);
}

export function renderCheckInbox(cfg, o) {
  o = o || {};
  return pub("Check your email", `<section class="hero"><p class="kicker">One more step</p><h1>Check your email${o.first ? ", " + esc(o.first) : ""}!</h1>
<p class="big">We sent a confirmation link to <b>${esc(o.email)}</b>. Tap it and you're in the draw for ${esc(prizeShort(cfg))}.</p>
<p>Nothing there? Give it a minute and check your spam folder. The link works for 48 hours.</p><a class="btn" href="${esc(back(o))}">Back</a></section>
<div class="wrap">${ABOUT(cfg)}</div>`, cfg, o);
}

export function renderVerified(cfg, o) {
  o = o || {};
  return pub("You're in!", `<section class="hero"><img class="entered" src="${ENTERED_ART}" alt="Thank you - you're entered! You're now in the draw to win a $100 Exor Games gift card. Mallow Games buys, sells and trades video games - use your video games for Exor Games store credit." width="1200" height="800"><p class="kicker">Entry confirmed</p><h1>You're in${o.first ? ", " + esc(o.first) : ""}! 🎉</h1>
<p class="big">${o.already ? "This address was already confirmed - you're in the draw once, and once is all it takes." : `You're in the draw for ${esc(prizeShort(cfg))} in store credit.`} We draw the winner ${esc(cfg.drawText)} and email them.</p>
<p>While you're here: see what's new at Exor Games, or find out what Mallow Games pays for the video games you're done with.</p>
<div class="btns"><a class="btn" href="${EXOR}">Shop ExorGames.com</a><a class="btn pink" href="${MALLOW_URL}">Sell your video games</a></div></section>
<div class="wrap">${ABOUT(cfg)}</div>`, cfg, o);
}

export function renderExpired(cfg, o) {
  o = o || {};
  const exp = o.reason === "expired", again = !!(o.live || o.preview);
  return pub(exp ? "Link expired" : "Link not valid", `<section class="hero"><h1>${exp ? "That link has expired" : "That link isn't valid"}</h1>
<p class="big">${exp ? "Confirmation links work for 48 hours." : "It may have been used already, or copied incompletely."} ${again ? "You can enter again - it only takes a moment." : "Entries are closed for now."}</p>
${again ? `<a class="btn" href="${esc(back(o))}">Enter again</a>` : ""}</section>`, cfg, o);
}

export function renderNotFound(cfg, o) {
  return pub("Not found", `<section class="hero"><h1>There's nothing here</h1><p class="big">The contest page is at <a href="${esc(back(o))}">${SHORT_URL}</a>.</p></section>`, cfg, o || {});
}

export function renderRules(cfg, o) {
  o = o || {};
  return pub("Contest rules", `<div class="wrap rules"><h1>Contest rules</h1><p class="fine">${esc(cfg.event)} draw · Exor Games × Mallow Games</p>
<ol>
<li><b>Sponsor.</b> Exor Games, 51 Allen Street, Charlottetown, PE C1A 2V6, Canada (<a href="mailto:${REPLY_TO}">${REPLY_TO}</a>).</li>
<li><b>Who can enter.</b> Legal residents of Canada, excluding Quebec, who have reached the age of majority in their province or territory at the time of entry. Employees of Exor Games and Mallow Games, and the members of their households, cannot enter.</li>
<li><b>Contest period.</b> Entries are accepted from the opening of the ${esc(cfg.event)} (${esc(cfg.dates)}) until ${esc(closesText(cfg))}. Entries not confirmed by then do not count.</li>
<li><b>How to enter.</b> No purchase necessary. Visit this page (scan the code at our booth), enter your name and email address and tap the confirmation link we email you. One entry per person and per email address; extra entries are removed.</li>
<li><b>Prize.</b> One (1) prize: ${esc(cfg.prize)}, issued as an Exor Games gift card (approximate retail value $100 CAD), redeemable at ExorGames.com and in store on anything we sell, including video games from Mallow Games. No cash value, not transferable, no substitution except by the sponsor if the prize becomes unavailable.</li>
<li><b>Draw.</b> One winner is chosen at random from all confirmed entries ${esc(cfg.drawText)}. The odds of winning depend on the number of eligible entries received. The winner is notified by email and must correctly answer a mathematical skill-testing question and reply within seven (7) days, or an alternate winner is drawn.</li>
<li><b>Your information.</b> We use your name and email address to run the draw and contact the winner. If you ticked the email box, we also add you to the Exor Games / Mallow Games email list as a subscribed customer; every email carries an unsubscribe link. We never sell your information.</li>
<li><b>General.</b> By entering you accept these rules and the sponsor's decisions, which are final. The sponsor may disqualify entries made by automated means or in breach of these rules. Void where prohibited by law. This contest is subject to all applicable federal, provincial and municipal laws.</li>
</ol><p><a href="${esc(back(o))}">← Back to the entry page</a></p></div>`, cfg, o);
}

/* ---------- /9pocket/win (admins) ---------- */
const OM_LABEL = { subscribed: "subscribed (new customer)", updated: "subscribed (existing customer)", pending: "waiting", "no-consent": "no consent", unconfigured: "no Shopify token", failed: "failed" };
export function renderWinAdmin(d, o) {
  o = o || {};
  const cfg = d.cfg || {}, list = d.entries || [], draws = d.draws || [], now = d.now || 0;
  const real = list.filter((e) => !e.test), tests = list.filter((e) => e.test);
  const okOm = (e) => e.shopify && /^(subscribed|updated)$/.test(e.shopify.status);
  const onList = real.filter(okOm).length;
  const failed = real.filter((e) => e.consent && e.shopify && !okOm(e) && e.shopify.status !== "pending").length;
  const live = !!cfg.open && (!cfg.closesAt || now <= cfg.closesAt);
  const pubUrl = (o.origin || "") + B, prev = pubUrl + "?preview=" + encodeURIComponent(cfg.previewKey || "");
  const ctl = A + "/control";
  const hid = (a) => `<input type="hidden" name="action" value="${a}">`;
  const drawnSet = new Set(draws.map((x) => x.email));
  const state = cfg.open ? (live ? "OPEN" : "CLOSED - past the closing time") : "CLOSED";
  const page = `<style>.wmsg{background:#d1fae5;color:#065f46;padding:10px 12px;border-radius:10px;margin:0 0 12px;font-weight:600}.werr{background:#fee2e2;color:#7f1d1d;padding:10px 12px;border-radius:10px;margin:0 0 12px;font-weight:600}.wset label{display:block;font-size:13px;font-weight:600;margin:8px 0 2px}.wset input[type=text],.wset input[type=datetime-local]{width:100%;max-width:520px;padding:8px;border:1px solid #cbd3d9;border-radius:8px;font:inherit}.wset .two{display:grid;gap:0 16px;grid-template-columns:1fr 1fr;max-width:760px}.winl{font-size:14px;line-height:1.8}.winl code{background:#eef2f4;padding:2px 6px;border-radius:6px;word-break:break-all}.wtab{width:100%;border-collapse:collapse;font-size:13px}.wtab td,.wtab th{text-align:left;vertical-align:top;border-top:1px solid #eef2f4;padding:6px}.wtab form{display:inline}.wtab .om.bad{color:#b42318;font-weight:600}.wtab .om.ok{color:#065f46;font-weight:600}.draw{background:#fff;border:2px solid #d62c28;border-radius:12px;padding:12px 14px;margin:8px 0}.draw b.w{font-size:17px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:#eef2f4}.badge.on{background:#d1fae5;color:#065f46}.badge.off{background:#fee2e2;color:#7f1d1d}button.primary{background:#d62c28;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}button.dim{background:#eef2f4;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}</style>
<div class="hz"><h1>Expo contest</h1><span class="sw ${live ? "on" : ""}">${state}</span>
<form method="post" action="${ctl}">${hid(cfg.open ? "close" : "open")}<button type="submit" class="${cfg.open ? "dim" : "primary"}"${cfg.open ? "" : ` onclick="return confirm('Open the contest to the public now? The QR code page starts taking entries.')"`}>${cfg.open ? "Close the contest" : "Open the contest"}</button></form></div>
${o.msg ? `<div class="wmsg">${esc(o.msg)}</div>` : ""}${o.err ? `<div class="werr">${esc(o.err)}</div>` : ""}
<p class="muted" style="margin:4px 0 10px">${esc(cfg.event)} · ${esc(cfg.place)} · ${esc(cfg.dates)} · prize: ${esc(cfg.prize)} · entries close ${esc(closesText(cfg))} · draw ${esc(cfg.drawText)}</p>
<div class="pg"><b>Setup</b><br>
<span class="badge ${o.emailOn ? "on" : "off"}">Confirmation email (Resend): ${o.emailOn ? "ready" : "RESEND_API_KEY missing"}</span>
<span class="badge ${o.shopifyOn && o.customersWrite ? "on" : "off"}">Shopify customers: ${!o.shopifyOn ? "no token on the worker" : o.customersWrite ? "the token can create and subscribe customers" : o.scopeError ? "scope check failed - " + esc(o.scopeError) : "the token lacks write_customers"}</span>
<div class="muted" style="margin-top:6px">Omnisend takes its list from Shopify's customers: a confirmed entrant who ticked the box becomes a Shopify customer marked <b>subscribed</b> (confirmed opt-in) and tagged <b>${esc(cfg.tags)}</b>; one who already is a customer gets the tags and the subscription.${o.shopifyOn && !o.customersWrite ? " <b>Until the token has the write_customers scope</b> (Shopify admin › Settings › Apps and sales channels › Develop apps › the worker's app › Configuration), entries are kept here - use <b>Retry</b> per row or the CSV export afterwards." : ""}</div></div>
<div class="tiles">
<div class="tile2"><b>${real.length}</b><br><span class="muted">confirmed entries</span></div>
<div class="tile2"><b>${d.pending || 0}</b><br><span class="muted">awaiting confirmation</span></div>
<div class="tile2"><b>${onList}</b><br><span class="muted">subscribed in Shopify</span></div>
<div class="tile2"><b>${failed}</b><br><span class="muted">Shopify failed</span></div>
<div class="tile2"><b>${tests.length}</b><br><span class="muted">test entries (preview)</span></div>
</div>
<div class="pg winl"><b>Links</b><br>
Short address on the QR code and the sign: <a href="${SHORT_URL}" target="_blank" rel="noopener"><code>${SHORT_URL}</code></a> <span class="muted">(a Shopify redirect to <code>${esc(pubUrl)}</code>${live ? "" : "; shows the holding page while closed"})</span><br>
Preview while closed (admins only - do not print this one): <a href="${esc(prev)}" target="_blank" rel="noopener"><code>${esc(prev)}</code></a><br>
QR code for the booth: <a href="/win-qr.png" target="_blank">PNG</a> · <a href="/win-qr.svg" target="_blank">SVG (print)</a> · <a href="/win-sign.html" target="_blank">printable sign</a> · <a href="${B}/rules" target="_blank">rules page</a> · <a href="${A}/export.csv">export entries (CSV)</a><br>
<form method="post" action="${ctl}" style="display:inline">${hid("test_email")}<button type="submit" class="dim">Send me a sample confirmation email</button></form></div>
<h2>The draw</h2>
<form method="post" action="${ctl}" onsubmit="return confirm('Draw a winner now from the ${real.filter((e) => !drawnSet.has(e.email)).length} confirmed entries not drawn yet?')">${hid("draw")}<button type="submit" class="primary">Draw a winner</button> <span class="muted">Random pick among confirmed, non-test entries not drawn before. Draw again only if a winner does not answer within 7 days.</span></form>
${draws.map((w, i) => `<div class="draw"><b class="w">${i + 1}. ${esc(w.first)} ${esc(w.last)}</b> · <a href="mailto:${esc(w.email)}">${esc(w.email)}</a><br><span class="muted">drawn ${esc(when(w.at))} by ${esc(w.by)}</span><br>Skill-testing question: <b>${esc(w.q)} = ?</b> &nbsp;answer <b>${esc(w.a)}</b> (they must reply with it before the gift card goes out)<br>
${w.emailed && w.emailed.ok ? `<span class="badge on">winner emailed ${esc(when(w.emailed.at))}</span>` : `${w.emailed ? `<span class="badge off">email failed: ${esc(w.emailed.error)}</span> ` : ""}<form method="post" action="${ctl}" style="display:inline" onsubmit="return confirm('Email ${esc(w.first)} that they won, with the skill-testing question?')">${hid("email_winner")}<input type="hidden" name="email" value="${esc(w.email)}"><button type="submit" class="primary">Email the winner</button></form>`}</div>`).join("")}
<details class="sc-note" style="margin:16px 0"><summary><b>Settings</b></summary>
<form method="post" action="${ctl}" class="wset">${hid("cfg")}
<div class="two"><div><label>Event</label><input type="text" name="event" value="${esc(cfg.event)}" maxlength="120"></div><div><label>Place</label><input type="text" name="place" value="${esc(cfg.place)}" maxlength="120"></div>
<div><label>Dates (as shown on the page)</label><input type="text" name="dates" value="${esc(cfg.dates)}" maxlength="120"></div><div><label>Prize</label><input type="text" name="prize" value="${esc(cfg.prize)}" maxlength="160"></div>
<div><label>Entries close (Atlantic time)</label><input type="datetime-local" name="closes" value="${esc(o.closesInput || "")}"></div><div><label>Draw (as shown on the page)</label><input type="text" name="drawText" value="${esc(cfg.drawText)}" maxlength="120"></div></div>
<label>Customer tags in Shopify (comma-separated)</label><input type="text" name="tags" value="${esc(cfg.tags)}" maxlength="200">
<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" name="consentRequired" value="1"${cfg.consentRequired ? " checked" : ""}> The email box must be ticked to enter (untick to let people enter the draw without joining the list)</label>
<button type="submit" class="primary" style="margin-top:10px">Save settings</button></form></details>
<h2>Entries <span class="muted" style="font-size:14px">(${list.length})</span></h2>
${list.length ? `<table class="wtab"><tr><th>#</th><th>Name</th><th>Email</th><th>Confirmed</th><th>Emails</th><th>Plays</th><th>Shopify</th><th></th></tr>
${list.map((e, i) => `<tr${e.test ? ' style="opacity:.6"' : ""}><td>${i + 1}</td><td>${esc(e.first)} ${esc(e.last)}${e.test ? ' <span class="badge">test</span>' : ""}${drawnSet.has(e.email) ? ' <span class="badge on">drawn</span>' : ""}</td><td>${esc(e.email)}</td><td>${esc(when(e.verifiedAt))}</td><td>${e.consent ? "yes" : "no"}</td><td>${esc((e.interests || []).join(", "))}</td>
<td><span class="om ${okOm(e) ? "ok" : e.shopify && e.shopify.status !== "pending" && e.consent ? "bad" : ""}">${esc(OM_LABEL[(e.shopify || {}).status] || (e.shopify || {}).status || "")}</span>${e.shopify && e.shopify.id ? ` <a href="https://admin.shopify.com/store/most-wanted-ca/customers/${esc(e.shopify.id)}" target="_blank" rel="noopener">open</a>` : ""}${e.shopify && e.shopify.error ? `<br><small class="muted">${esc(e.shopify.error)}</small>` : ""}${e.consent && !okOm(e) ? ` <form method="post" action="${ctl}">${hid("retry")}<input type="hidden" name="email" value="${esc(e.email)}"><button type="submit" class="dim">Retry</button></form>` : ""}</td>
<td><form method="post" action="${ctl}" onsubmit="return confirm('Remove ${esc(e.first)}\\'s entry? This cannot be undone.')">${hid("delete")}<input type="hidden" name="email" value="${esc(e.email)}"><button type="submit" class="dim">Remove</button></form></td></tr>`).join("")}</table>` : `<p class="muted">No confirmed entries yet.</p>`}`;
  return shell("Expo contest", page, o, true);
}

export function renderWinDenied(o) {
  return shell("Expo contest", `<h1>Expo contest</h1><div class="err">Only an admin can open the contest screen.</div>`, o, true);
}

/* ---------- emails ---------- */
const frame = (inner, foot) => `<!doctype html><html><body style="margin:0;background:${PAPER};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="background:${INK};padding:16px 28px"><img src="${LOGO}" alt="Exor Games" width="80" height="58" style="display:block;height:58px;width:auto"></td></tr><tr><td style="padding:26px 28px 10px;font-size:16px;line-height:1.55">${inner}</td></tr><tr><td style="background:${PAPER};padding:16px 28px;font-size:12px;color:${MUTED};line-height:1.6">${foot}</td></tr></table></td></tr></table></body></html>`;
const button = (href, text) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="background:${RED};border-radius:10px"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;color:#fff;font-weight:700;text-decoration:none;font-size:16px">${esc(text)}</a></td></tr></table>`;
const ADDR = `Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6, Canada · <a href="mailto:${REPLY_TO}" style="color:${MUTED}">${REPLY_TO}</a>`;
const ADDR_TEXT = `Exor Games · 51 Allen Street, Charlottetown, PE C1A 2V6, Canada · ${REPLY_TO}`;

export function buildVerifyEmail(a) {
  const cfg = a.cfg || {}, first = a.first ? ", " + a.first : "";
  const subject = `Confirm your entry - win ${prizeShort(cfg)} at Exor Games`;
  const html = frame(`<h1 style="margin:0 0 10px;font-size:24px">One tap and you're in${esc(first)}</h1>
<p>Thanks for entering our draw at the ${esc(cfg.event)}. Confirm your email address to enter the draw for <b>${esc(cfg.prize)}</b>.</p>
${button(a.link, "Confirm my entry")}
<p style="font-size:14px;color:${MUTED}">The link works for 48 hours. If the button does not work, copy this address into your browser:<br><a href="${esc(a.link)}" style="color:${RED};word-break:break-all">${esc(a.link)}</a></p>
<p style="font-size:14px;color:${MUTED}">Ticked the email box? Confirming also signs you up for Exor Games and Mallow Games emails - new releases, deals, events and what we're buying. Every email has an unsubscribe link.</p>
<p style="font-size:14px;color:${MUTED}">Didn't enter? Ignore this email and nothing happens.</p>
<a href="${MALLOW_URL}" style="display:block;margin:18px 0 6px;text-decoration:none"><img src="${ASSET_ORIGIN}${MALLOW_BAND}" alt="Mallow Games buys, sells and trades video games - use your video games for Exor Games store credit" width="544" height="169" style="display:block;width:100%;max-width:544px;height:auto;border-radius:10px"></a>
<p style="font-size:14px;color:${MUTED};margin:0 0 8px">Got video games you're done with? Mallow Games, our sister shop, buys them for cash or Exor Games store credit - <a href="${MALLOW_URL}" style="color:${RED}">see what we pay</a>.</p>${a.test ? `<p><b>This is a sample sent from the 9Pocket admin screen; the button opens the preview page.</b></p>` : ""}`,
    `${ADDR}<br>You received this one-time message because this address was entered in our contest at the ${esc(cfg.event)}.`);
  const text = [`One tap and you're in${first}`, "", `Thanks for entering our draw at the ${cfg.event}. Confirm your email address to enter the draw for ${cfg.prize}:`, "", a.link, "", "The link works for 48 hours.", "Ticked the email box? Confirming also signs you up for Exor Games and Mallow Games emails (unsubscribe any time).", "Didn't enter? Ignore this email and nothing happens.", "", "Got video games you're done with? Mallow Games, our sister shop, buys them for cash or Exor Games store credit: " + MALLOW_URL, "", ADDR_TEXT].join("\n");
  return { subject, html, text };
}

export function buildAlreadyEmail(a) {
  const cfg = a.cfg || {}, first = a.first ? ", " + a.first : "";
  const subject = `You're already in the draw - Exor Games`;
  const html = frame(`<h1 style="margin:0 0 10px;font-size:24px">You're already in${esc(first)}</h1><p>This address is already confirmed for our ${esc(cfg.event)} draw - you're in once, and once is all it takes. We draw the winner ${esc(cfg.drawText)} and email them.</p><p style="font-size:14px;color:${MUTED}">Didn't enter just now? Someone typed your address by mistake; nothing changes.</p>`, ADDR);
  const text = [`You're already in${first}`, "", `This address is already confirmed for our ${cfg.event} draw. We draw the winner ${cfg.drawText} and email them.`, "", ADDR_TEXT].join("\n");
  return { subject, html, text };
}

export function buildWinnerEmail(a) {
  const cfg = a.cfg || {}, first = a.first ? ", " + a.first : "";
  const subject = `You won our ${cfg.event} draw!`;
  const html = frame(`<h1 style="margin:0 0 10px;font-size:24px">Congratulations${esc(first)} - you won!</h1>
<p>Your entry was drawn in our ${esc(cfg.event)} contest: <b>${esc(cfg.prize)}</b> is yours.</p>
<p>One formality first. Canadian contest rules ask the winner a skill-testing question, so please reply to this email with the answer to:</p>
<p style="font-size:22px;font-weight:700;margin:10px 0">${esc(a.question)} = ?</p>
<p>Reply within 7 days and we'll send your gift card to this address. Spend it at ExorGames.com or in store - on cards, games or video games from Mallow Games.</p>
<a href="${MALLOW_URL}" style="display:block;margin:18px 0 6px;text-decoration:none"><img src="${ASSET_ORIGIN}${MALLOW_BAND}" alt="Mallow Games buys, sells and trades video games - use your video games for Exor Games store credit" width="544" height="169" style="display:block;width:100%;max-width:544px;height:auto;border-radius:10px"></a>
<p style="font-size:14px;color:${MUTED};margin:0 0 8px">Got video games you're done with? Mallow Games, our sister shop, buys them for cash or Exor Games store credit - <a href="${MALLOW_URL}" style="color:${RED}">see what we pay</a>.</p>`, ADDR);
  const text = [`Congratulations${first} - you won!`, "", `Your entry was drawn in our ${cfg.event} contest: ${cfg.prize} is yours.`, "", `Canadian contest rules ask the winner a skill-testing question. Reply to this email with the answer to: ${a.question} = ?`, "", "Reply within 7 days and we'll send your gift card to this address.", "", "Got video games you're done with? Mallow Games buys them for cash or Exor Games store credit: " + MALLOW_URL, "", ADDR_TEXT].join("\n");
  return { subject, html, text };
}
