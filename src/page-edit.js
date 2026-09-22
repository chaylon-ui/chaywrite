/* ---------------- One-span edit of a Shopify page body ----------------
   Page bodies are the owner's content and long; hand-copying one through
   a chat is how settings JSON got corrupted before. So an edit is: read
   the body with the worker's Admin token, replace exactly ONE literal span
   (find_start .. find_end inclusive, or find_start alone), report what was
   removed and inserted, and - only when dry is false - save and re-read to
   prove the stored body equals what was meant. Staff key or an admin's
   9Pocket session; the runner workflow page-edit.yml (chaywrite main)
   drives it with the checkout's DEFAULT_PIN. Owner-asked changes only. */

const SHOP = (env) => (env && env.SHOPIFY_SHOP) || "most-wanted-ca.myshopify.com";

export function spliceSpan(body, findStart, findEnd, replacement) {
  const s = String(body || ""), fs = String(findStart || ""), fe = String(findEnd || "");
  if (!fs) return { ok: false, error: "find_start required" };
  const count = s.split(fs).length - 1;
  if (count !== 1) return { ok: false, error: "find_start occurs " + count + " times; need exactly 1" };
  const a = s.indexOf(fs);
  let b;
  if (fe) { const e = s.indexOf(fe, a + fs.length); if (e < 0) return { ok: false, error: "find_end not found after find_start" }; b = e + fe.length; }
  else b = a + fs.length;
  return { ok: true, removed: s.slice(a, b), next: s.slice(0, a) + String(replacement || "") + s.slice(b), before: a, after: s.length - b };
}

async function md5(text) {
  // Workers have no MD5 in WebCrypto; SHA-256 is as good a fingerprint here.
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function gql(env, query, variables) {
  const r = await fetch(`https://${SHOP(env)}/admin/api/2025-01/graphql.json`, {
    method: "POST", headers: { "content-type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors) throw new Error("Shopify HTTP " + r.status + " " + JSON.stringify((j && j.errors) || j || "").slice(0, 300));
  return j.data;
}

export async function editPage(env, { pageId, findStart, findEnd, replaceB64, replacement, dry }) {
  if (!env || !env.SHOPIFY_ADMIN_TOKEN) return { ok: false, error: "no SHOPIFY_ADMIN_TOKEN on the worker" };
  const id = "gid://shopify/Page/" + String(pageId || "").replace(/\D/g, "");
  if (id.endsWith("/")) return { ok: false, error: "page id required" };
  let rep = replacement != null ? String(replacement) : "";
  if (replaceB64) { try { rep = new TextDecoder().decode(Uint8Array.from(atob(String(replaceB64)), (c) => c.charCodeAt(0))); } catch { return { ok: false, error: "replace_b64 is not base64" }; } }
  const p = (await gql(env, "query($id:ID!){page(id:$id){id title handle updatedAt body}}", { id })).page;
  if (!p) return { ok: false, error: "no such page " + id };
  const body = p.body || "";
  const sp = spliceSpan(body, findStart, findEnd, rep);
  if (!sp.ok) return { ok: false, error: sp.error, page: { title: p.title, handle: p.handle, updatedAt: p.updatedAt, length: body.length } };
  const out = {
    ok: true, dry: dry !== false, page: { title: p.title, handle: p.handle, updatedAt: p.updatedAt },
    before: { length: body.length, hash: await md5(body) }, removed: sp.removed.slice(0, 4000), inserted: rep.slice(0, 4000),
    untouched: { before: sp.before, after: sp.after }, next: { length: sp.next.length, hash: await md5(sp.next) },
  };
  if (dry !== false) return out;
  const u = (await gql(env, "mutation($id:ID!,$body:String!){pageUpdate(id:$id,page:{body:$body}){page{id updatedAt} userErrors{field message code}}}", { id, body: sp.next })).pageUpdate;
  if (u && u.userErrors && u.userErrors.length) return { ...out, ok: false, saved: false, error: u.userErrors.map((e) => e.message).join("; ") };
  const again = (await gql(env, "query($id:ID!){page(id:$id){updatedAt body}}", { id })).page;
  const verified = (again && again.body) === sp.next;
  return { ...out, saved: true, verified, after: { updatedAt: again && again.updatedAt, hash: await md5((again && again.body) || "") }, ok: verified, error: verified ? undefined : "re-read body differs from what was saved" };
}

export async function servePageEdit(request, env, url, staffOk, adminUser) {
  const noStore = { "cache-control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "POST" }, { status: 405, headers: noStore });
  let b = {}; try { b = (await request.json()) || {}; } catch {}
  const k = String(b.k || url.searchParams.get("k") || "");
  const okKey = k ? await staffOk(env, url.origin, k) : false;
  if (!okKey && !adminUser) return Response.json({ error: "staff key or admin sign-in required" }, { status: 403, headers: noStore });
  let out;
  try { out = await editPage(env, { pageId: b.page_id || b.pageId, findStart: b.find_start || b.findStart, findEnd: b.find_end || b.findEnd, replaceB64: b.replace_b64 || b.replaceB64, replacement: b.replacement, dry: !(b.dry === false || b.dry === "false") }); }
  catch (e) { out = { ok: false, error: String((e && e.message) || e).slice(0, 300) }; }
  return Response.json(out, { status: out.ok ? 200 : 400, headers: noStore });
}
