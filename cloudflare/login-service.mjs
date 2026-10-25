// Cloudflare D1 login service (not wired to public Worker routes).
// KDF runtime budget, Cloudflare IP provenance, and end-to-end staging gating
// must be validated before any caller enables credential acceptance.
import {
  verifyWorkerPassword, freshSessionToken, tokenSha256, sessionCookie,
  expiredSessionCookie, loadPrincipal, authorizedMutation, readSessionCookie
} from './auth-core.mjs';

const utf8 = new TextEncoder();
const DUMMY_SALT = '00'.repeat(16);
const DUMMY_HASH = 'pbkdf2-sha256$600000$' + '00'.repeat(32);
export const LOGIN_LIMITS = Object.freeze({ perUser: 8, perSource: 32, windowMinutes: 15, sessionHours: 8 });
export const LOGIN_ATTEMPTS_RETENTION_DAYS = 7;
export const LOGIN_CLEANUP_BATCH_SIZE = 500;

// These predicates MUST match the versioned D1 migration 0002 indexes.
export const LOGIN_RESERVATION_SQL =
  'INSERT INTO login_attempts(id,username,ip_hash,success) ' +
  'SELECT ?,?,?,0 WHERE ' +
  '(SELECT COUNT(*) FROM login_attempts WHERE username=? COLLATE NOCASE ' +
  "AND at>=datetime('now','-15 minutes')) < ? AND " +
  '(SELECT COUNT(*) FROM login_attempts WHERE ip_hash=? ' +
  "AND at>=datetime('now','-15 minutes')) < ?";

// Bounded maintenance for a future protected staging scheduled Worker invocation.
// This is internal-only; it is NOT automatically deployed, scheduled or executed.
export const LOGIN_CLEANUP_SQL =
  'DELETE FROM login_attempts WHERE id IN (' +
  'SELECT id FROM login_attempts ' +
  "WHERE at < datetime('now','-7 days') ORDER BY at ASC LIMIT ?)";

export async function pruneExpiredLoginAttempts(db, batchSize = LOGIN_CLEANUP_BATCH_SIZE) {
  if (!db || typeof db.prepare !== 'function') throw new Error('E_AUTH_CONFIG');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > LOGIN_CLEANUP_BATCH_SIZE)
    throw new Error('E_AUTH_CLEANUP_BATCH');
  const res = await db.prepare(LOGIN_CLEANUP_SQL).bind(batchSize).run();
  return resultChanges(res);
}
const okUsername = u => typeof u === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(u);
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const newId = () => crypto.randomUUID();

export async function sourceIpDigest(request, secret) {
  // Never use unverified X-Forwarded-For / X-Real-IP headers.
  const ip = request.headers.get('CF-Connecting-IP');
  if (typeof secret !== 'string' || secret.length < 32 ||
      !ip || ip.length > 45 || !/^[a-fA-F0-9:.]+$/.test(ip)) throw new Error('E_AUTH_SOURCE_UNAVAILABLE');
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(ip.toLowerCase()))));
}
function resultChanges(result) {
  const n = result?.meta?.changes ?? result?.changes;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('E_AUTH_D1_RESULT');
  return n;
}
function hasPreparedDb(db) {
  return !!db && typeof db.prepare === 'function' && typeof db.batch === 'function';
}
export async function reserveLoginAttempt(db, username, ipHash) {
  if (!hasPreparedDb(db) || !okUsername(username) || !/^[0-9a-f]{64}$/.test(ipHash || ''))
    throw new Error('E_AUTH_CONFIG');
  const id = newId();
  // This is one SQLite statement; concurrent reservations are serialized by D1.
  // Every accepted attempt (including correct credentials) consumes the window quota.
  const stmt = db.prepare(LOGIN_RESERVATION_SQL)
    .bind(id, username, ipHash, username, LOGIN_LIMITS.perUser, ipHash, LOGIN_LIMITS.perSource);
  const res = await stmt.run();
  return resultChanges(res) === 1 ? id : null;
}
async function recordAuthFailure(db, username, ipHash) {
  // No password, token, IP address or hash material is logged in detail.
  const result = await db.prepare(
    'INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)'
  ).bind(newId(), username, 'auth.login_failed', 'sessions', ipHash, '{}').run();
  if (resultChanges(result) !== 1) throw new Error('E_AUTH_D1_RESULT');
  return { status: 401, code: 'E_INVALID_CREDENTIALS' };
}
export async function authenticateD1(db, { username, password, ipHash }) {
  // Internal-only service. No caller can enable this by passing a public flag.
  if (!hasPreparedDb(db)) throw new Error('E_AUTH_CONFIG');
  if (!okUsername(username) || typeof password !== 'string' ||
      password.length < 12 || password.length > 256 || !/^[0-9a-f]{64}$/.test(ipHash || ''))
    return { status: 401, code: 'E_INVALID_CREDENTIALS' };
  const id = await reserveLoginAttempt(db, username, ipHash);
  if (!id) return { status: 429, code: 'E_RATE_LIMITED' };

  let user;
  try {
    user = await db.prepare(
      "SELECT id,username,password_salt,password_hash FROM users WHERE username=? COLLATE NOCASE AND active=1 LIMIT 1"
    ).bind(username).first();
    // Unknown/inactive users still execute the expensive KDF to avoid existence timing leaks.
    const isModern = !!user && /^[0-9a-f]{32}$/i.test(user.password_salt || '') &&
      /^pbkdf2-sha256\$600000\$[0-9a-f]{64}$/i.test(user.password_hash || '');
    const salt = isModern ? user.password_salt : DUMMY_SALT;
    const stored = isModern ? user.password_hash : DUMMY_HASH;
    const matches = await verifyWorkerPassword(password, salt, stored);
    if (!user || !matches) return await recordAuthFailure(db, username, ipHash);

    const token = freshSessionToken(), csrf = freshSessionToken();
    const tokenHash = await tokenSha256(token);
    const expiry = new Date(Date.now() + LOGIN_LIMITS.sessionHours * 3600000).toISOString();
    const statements = [
      db.prepare(
        'INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) ' +
        'SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND active=1 AND password_hash=? AND password_salt=?)'
      ).bind(tokenHash,csrf,user.id,expiry,user.id,user.password_hash,user.password_salt),
      db.prepare(
        'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,ip_hash,detail) ' +
        "SELECT ?,u.id,u.username,'auth.login','sessions',?,'{}' FROM users u " +
        'JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token_hash=?'
      ).bind(newId(), ipHash, user.id, tokenHash),
      db.prepare('UPDATE login_attempts SET success=1 WHERE id=? AND success=0 AND EXISTS '+
        '(SELECT 1 FROM sessions WHERE token_hash=?)').bind(id,tokenHash)
    ];
    const outcome = await db.batch(statements);
    if (!Array.isArray(outcome) || outcome.length !== 3 ||
        outcome.some(x => resultChanges(x) !== 1))
      throw new Error('E_AUTH_ATOMIC');
    return {
      status: 200, code: 'OK',
      cookie: sessionCookie(token, LOGIN_LIMITS.sessionHours * 3600),
      csrf, user: { id: user.id, username: user.username }
    };
  } catch (e) {
    // Never return password, SQL or token in caller-visible errors.
    // Aborted transaction leaves a failed reserved attempt to throttle retries.
    if (/^E_AUTH_/.test(String(e?.message))) throw e;
    throw new Error('E_AUTH_UNAVAILABLE');
  }
}
export async function revokeD1Session(db, request) {
  if (!hasPreparedDb(db)) throw new Error('E_AUTH_CONFIG');
  if (!readSessionCookie(request)) return { status: 401, code: 'E_UNAUTHENTICATED' };
  const p = await loadPrincipal(db,request);
  if (!p) return { status: 401, code: 'E_UNAUTHENTICATED' };
  if (!authorizedMutation(request,p,'staff')) return { status: 403, code: 'E_CSRF_ORIGIN' };
  const result = await db.batch([
    // Guard audit and deletion against a revoked session between read and batch.
    db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) '+
      "SELECT ?,u.id,u.username,'auth.logout','sessions','{}' FROM sessions s "+
      'JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1')
      .bind(newId(),p.token_hash),
    db.prepare('DELETE FROM sessions WHERE token_hash=? AND EXISTS '+
      '(SELECT 1 FROM users WHERE id=? AND active=1)')
      .bind(p.token_hash,p.id)
  ]);
  if (!Array.isArray(result) || result.length!==2 || result.some(x=>resultChanges(x)!==1))
    throw new Error('E_AUTH_ATOMIC');
  return { status:200, code:'OK', cookie:expiredSessionCookie() };
}
