// Worker-safe authentication primitives. Never auto-import local node:sqlite scrypt hashes.
// The live login endpoint stays disabled until a separate, reviewed rollout.
const encoder = new TextEncoder();
const SALT_BYTES = 16;
// Hosted 600k WebCrypto was rejected in the isolated staging probe.
// 100k is a Staging compatibility value, below OWASP's PBKDF2-SHA256 recommendation.
// Existing 600k hashes require separately approved reset, never silent rehash.
export const PBKDF2_ITERATIONS = 100000;
export const SESSION_COOKIE = '__Host-restaurant_session';
const ROLES = Object.freeze({ staff: 1, manager: 2, owner: 3 });

const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
function fromHex(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
}
function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}
export async function hashWorkerPassword(password, saltInput = crypto.getRandomValues(new Uint8Array(SALT_BYTES))) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('E_PASSWORD_LENGTH');
  const salt = saltInput instanceof Uint8Array ? saltInput : null;
  if (!salt || salt.length !== SALT_BYTES) throw new Error('E_PASSWORD_SALT');
  return { password_salt: toHex(salt), password_hash: 'pbkdf2-sha256$100000$' + toHex(await derive(password, salt)) };
}
export async function verifyWorkerPassword(password, saltHex, stored) {
  // This format is distinct from the existing Node.js scrypt hash; no silent migration.
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) return false;
  if (typeof stored !== 'string' || !/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/i.test(stored)) return false;
  const salt = fromHex(saltHex);
  if (!salt || salt.length !== SALT_BYTES) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, fromHex(stored.slice('pbkdf2-sha256$100000$'.length)));
}
export function freshSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function readSessionCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  if (cookie.length > 4096) return null;
  const matches = cookie.split(';').map(s => s.trim()).filter(s => s.startsWith(SESSION_COOKIE + '='));
  if (matches.length !== 1) return null; // duplicate-cookie ambiguity must fail closed
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export async function tokenSha256(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('E_TOKEN_FORMAT');
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}
export function sessionCookie(token, maxAgeSeconds = 28800) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('E_TOKEN_FORMAT');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 86400) throw new Error('E_COOKIE_AGE');
  return SESSION_COOKIE + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSeconds;
}
export function expiredSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
}
export function sameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (url.protocol !== 'https:' || !origin) return false;
  try { return new URL(origin).origin === url.origin && origin === url.origin; }
  catch { return false; }
}
export function csrfMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(provided) || !/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;
  return timingSafeEqual(encoder.encode(provided), encoder.encode(expected));
}

export async function loadPrincipal(db, request, now = new Date().toISOString()) {
  const token = readSessionCookie(request);
  if (!token || !db || typeof db.prepare !== 'function') return null;
  const digest = await tokenSha256(token);
  const u = await db.prepare(
    'SELECT s.token_hash, s.csrf_token, s.expires_at, u.id, u.username, u.display_name, u.role ' +
    'FROM sessions s JOIN users u ON u.id=s.user_id ' +
    'WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 LIMIT 1'
  ).bind(digest, now).first();
  if (!u || !Object.hasOwn(ROLES, u.role) || !csrfMatches(u.csrf_token, u.csrf_token)) return null;
  const result = await db.prepare(
    'SELECT ul.location_id FROM user_locations ul JOIN locations l ON l.id=ul.location_id ' +
    'WHERE ul.user_id=? AND l.active=1 ORDER BY ul.location_id'
  ).bind(u.id).all();
  if (!Array.isArray(result?.results)) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name, role: u.role,
    csrf: u.csrf_token, token_hash: u.token_hash,
    locations: result.results.map(x => x.location_id).filter(x => typeof x === 'string')
  };
}
export function hasAccess(principal, minRole = 'staff', locationId = undefined) {
  if (!principal || !Object.hasOwn(ROLES, principal.role) || !Object.hasOwn(ROLES, minRole)) return false;
  if (ROLES[principal.role] < ROLES[minRole]) return false;
  if (locationId === undefined) return true; // for identity/non-scoped operations only
  if (typeof locationId !== 'string' || !locationId) return false;
  return principal.role === 'owner' || principal.locations.includes(locationId);
}
export function authorizedMutation(request, principal, minRole = 'staff', locationId = undefined) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && sameOrigin(request) &&
    csrfMatches(request.headers.get('x-csrf-token'), principal?.csrf) &&
    hasAccess(principal, minRole, locationId);
}
