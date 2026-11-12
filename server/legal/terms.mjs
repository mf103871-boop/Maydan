import { json, readJson } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { readSession, withRotation } from '../accounts/session.mjs';
import { getTermsDocument, isCurrentTermsAcceptance, termsDescriptor, termsIdentity, TERMS_UPDATED, TERMS_VERSION, TERMS_SUPPORT_EMAIL } from '../../src/shared/legal/terms.js';
import { GUEST_TERMS_HEADER } from '../../src/shared/legal/guest-receipt.js';
import { issueGuestTermsReceipt, verifyGuestTermsReceipt } from './guest-terms.mjs';

const acceptanceOf = row => row ? { termsVersion: row.terms_version, locale: row.locale, documentHash: row.document_hash, acceptedAt: row.accepted_at } : null;
async function accountAcceptance(env, userId) {
  return acceptanceOf(await env.DB.prepare(`SELECT a.terms_version,a.locale,a.document_hash,a.accepted_at
    FROM legal_terms_acceptances a JOIN users u ON u.id=a.user_id WHERE a.user_id=? AND a.terms_version=?
    AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=a.user_id)`)
    .bind(userId, TERMS_VERSION).first());
}
export async function legalStatus(env, userId, { request } = {}) {
  const acceptance = userId ? await accountAcceptance(env, userId) : request
    ? await verifyGuestTermsReceipt(env, request, request.headers.get(GUEST_TERMS_HEADER)) : null;
  return { ...termsDescriptor(), required: !isCurrentTermsAcceptance(acceptance), acceptance: isCurrentTermsAcceptance(acceptance) ? acceptance : null };
}
// Enforcement rollout is owned by the worker: call this only at guarded new-use
// boundaries. Never apply it to account deletion, privacy, reports or an old WS.
export async function requireCurrentTerms(env, userId, options = {}) {
  const status = await legalStatus(env, userId, options);
  if (status.required) fail('TERMS_REQUIRED', 403);
  return status.acceptance;
}
export function termsDeleteStatements(env, userId) {
  return [env.DB.prepare('DELETE FROM legal_terms_acceptances WHERE user_id=?').bind(userId)];
}
function validateAcceptance(input) {
  if (Object.keys(input).some(key => !['termsVersion', 'locale', 'documentHash', 'accepted'].includes(key)) || input.accepted !== true) fail('INVALID', 400);
  if (!isCurrentTermsAcceptance(input)) fail('TERMS_VERSION_CHANGED', 409);
  return termsIdentity(input.locale);
}
async function explicitSession(env, request, options) {
  const found = await readSession(env, request, options);
  // A malformed bearer is not a reason to downgrade a signed request to a guest.
  if (!found && request.headers.has('authorization')) fail('AUTH_EXPIRED', 401);
  return found;
}
export async function handleLegalRequest(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/legal/status' && path !== '/api/legal/accept') return null;
  if (path === '/api/legal/status' && request.method !== 'GET' || path === '/api/legal/accept' && request.method !== 'POST') fail('METHOD', 405);
  // Bounded body/explicit choice is checked before any account writes/rotation.
  const identity = request.method === 'POST' ? validateAcceptance(await readJson(request, 512)) : null;
  const auth = await explicitSession(env, request);
  if (!identity) return withRotation(json(await legalStatus(env, auth?.user.id, { request })), auth?.rotated);
  if (!auth) {
    const guestReceipt = await issueGuestTermsReceipt(env, request, identity);
    const acceptance = await verifyGuestTermsReceipt(env, request, guestReceipt);
    return json({ ...termsDescriptor(), required: false, acceptance, guestReceipt });
  }
  // Evaluate live SQLite time in whole milliseconds (without float rounding).
  // Whole seconds can mistake a just-revoked session for future rotation grace.
  const clock = "MAX(?,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
  let principal = auth;
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = Date.now(), session = principal.session;
    // Match the authenticated snapshot as well as live time: a revocation or
    // expiry mutation must win even if Worker/D1 clocks differ by a millisecond.
    await env.DB.prepare(`INSERT INTO legal_terms_acceptances(user_id,terms_version,document_hash,locale,accepted_at)
      SELECT u.id,?,?,?,? FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.id=? AND s.secret_hash=? AND s.expires_at=? AND s.revoked_at IS ?
      AND s.expires_at>${clock} AND (s.revoked_at IS NULL OR s.revoked_at>${clock})
      AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=u.id)
      ON CONFLICT(user_id,terms_version) DO NOTHING`)
      .bind(TERMS_VERSION, identity.documentHash, identity.locale, now, auth.user.id, session.id,
        session.secret_hash, session.expires_at, session.revoked_at ?? null, now, now).run();
    const current = await explicitSession(env, request, { rotate: false });
    const status = await legalStatus(env, auth.user.id);
    if (!status.required) return withRotation(json(status), auth.rotated);
    // One fresh attempt accommodates legitimate rotation into a grace period.
    // A revoked/expired/deleted owner has already failed explicitSession above.
    if (attempt === 0 && (current.session.revoked_at !== session.revoked_at || current.session.expires_at !== session.expires_at || current.session.secret_hash !== session.secret_hash)) {
      principal = current; continue;
    }
    fail('TERMS_VERSION_CHANGED', 409);
  }
  fail('TERMS_UNAVAILABLE', 503);
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function termsPageResponse(method = 'GET', locale = 'ar') {
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  if (!['ar', 'en'].includes(locale)) return json({ error: 'INVALID' }, 400);
  const document = getTermsDocument(locale), ar = locale === 'ar';
  const body = `<!doctype html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(document.title)}</title>
    <style>body{margin:0;background:#fff8eb;color:#292334;font:18px/1.8 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:24px}h1{line-height:1.3}h2{font-size:1.3em;margin-top:32px}a{color:#065d59;min-height:48px;display:inline-flex;align-items:center;padding:0 8px;overflow-wrap:anywhere}nav{display:flex;gap:12px;flex-wrap:wrap}small{color:#51485b}a:focus-visible{outline:3px solid #54407a;outline-offset:3px}</style></head><body><main>
    <nav><a href="?lang=ar" lang="ar" dir="rtl">العربية</a><a href="?lang=en" lang="en">English</a><a href="/privacy/">${ar ? 'الخصوصية' : 'Privacy'}</a></nav>
    <h1>${escape(document.title)}</h1><small>${ar ? 'آخر تحديث' : 'Updated'}: <time dir="ltr" datetime="${TERMS_UPDATED}">${TERMS_UPDATED}</time> · ${ar ? 'النسخة' : 'Version'} <bdi>${TERMS_VERSION}</bdi></small>
    <p>${escape(document.summary)}</p>${document.sections.map(section => `<section aria-labelledby="terms-${section.id}"><h2 id="terms-${section.id}">${escape(section.title)}</h2>${section.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</section>`).join('')}
    <footer><a href="mailto:${TERMS_SUPPORT_EMAIL}"><bdi>${TERMS_SUPPORT_EMAIL}</bdi></a></footer></main></body></html>`;
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'content-language': locale, 'cache-control': 'public, max-age=300',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer'
  } });
}
