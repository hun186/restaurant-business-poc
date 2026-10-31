// Private, not routed: load public Cloudflare Access RS256 verification keys.
// The team issuer MUST come from trusted server configuration, never a request.
const TEAM_ISSUER = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const MAX_BYTES = 64 * 1024;
const MAX_KEYS = 10;
const FAILURE = 'ACCESS_JWKS_UNAVAILABLE';

function validModulus(n) {
  if (typeof n !== 'string' || n.length < 342 || n.length > 684 ||
      !/^[A-Za-z0-9_-]+$/.test(n) || n.length % 4 === 1) return false;
  try {
    const b = atob(n.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(n.length / 4) * 4, '='));
    return b.length >= 256 && b.length <= 512 &&
      btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') === n;
  } catch { return false; }
}

function validateJwks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Array.isArray(value.keys) || !value.keys.length || value.keys.length > MAX_KEYS) throw Error(FAILURE);
  const seen = new Set();
  const keys = value.keys.map(k => {
    if (!k || typeof k !== 'object' || Array.isArray(k) ||
        typeof k.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(k.kid) ||
        seen.has(k.kid) || k.kty !== 'RSA' || k.alg !== 'RS256' ||
        k.use !== 'sig' || k.e !== 'AQAB' || !validModulus(k.n) ||
        ['d','p','q','dp','dq','qi','oth','k'].some(name => name in k)) throw Error(FAILURE);
    seen.add(k.kid);
    return Object.freeze({kid:k.kid,kty:'RSA',alg:'RS256',use:'sig',n:k.n,e:'AQAB'});
  });
  return Object.freeze({keys:Object.freeze(keys)});
}

async function readCapped(response) {
  const claimed = response.headers?.get('content-length');
  if (claimed != null && (!/^\d+$/.test(claimed) || Number(claimed) > MAX_BYTES)) throw Error(FAILURE);
  if (!response.body?.getReader) throw Error(FAILURE);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Error(FAILURE);
      total += value.byteLength;
      if (total > MAX_BYTES) throw Error(FAILURE);
      chunks.push(value);
    }
  } finally { try { await reader.cancel(); } catch { /* fully consumed or aborted */ } }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

// Cache is scoped to this one trusted team URL. No shared mutable global keys.
// Unknown kid triggers a bounded refresh; no stale-on-error after expiration.
export function createAccessJwksLoader({issuer, fetchImpl = fetch, nowMs = Date.now,
  ttlMs = 300000, minRefreshMs = 30000, timeoutMs = 4000} = {}) {
  if (typeof issuer !== 'string' || !TEAM_ISSUER.test(issuer) ||
      typeof fetchImpl !== 'function' || typeof nowMs !== 'function' ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 300000 ||
      !Number.isSafeInteger(minRefreshMs) || minRefreshMs < 1000 || minRefreshMs > ttlMs ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) throw Error(FAILURE);
  const endpoint = issuer + '/cdn-cgi/access/certs';
  let cache = null, expiresAt = 0, lastAttemptAt = -Infinity, pending = null;
  async function refresh() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method:'GET', redirect:'error', credentials:'omit', cache:'no-store',
        referrerPolicy:'no-referrer', signal:ctrl.signal
      });
      if (!response?.ok || response.status !== 200 || response.redirected || response.url !== endpoint ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) throw Error(FAILURE);
      const json = JSON.parse(await readCapped(response));
      const keys = validateJwks(json);
      const now = nowMs();
      if (!Number.isSafeInteger(now) || now < 0) throw Error(FAILURE);
      cache = keys;
      expiresAt = now + ttlMs;
      return keys;
    } catch { throw Error(FAILURE); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    async getJwks({requiredKid} = {}) {
      const now = nowMs();
      if (!Number.isSafeInteger(now) || now < 0 ||
          (requiredKid !== undefined && (typeof requiredKid !== 'string' ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(requiredKid)))) throw Error(FAILURE);
      const fresh = cache && now < expiresAt && now >= expiresAt - ttlMs;
      // Do not stall a still-valid cached kid behind a concurrent rotation.
      if (fresh && (!requiredKid || cache.keys.some(k => k.kid === requiredKid))) return cache;
      if (pending) return pending.then(keys => {
        if (requiredKid && !keys.keys.some(k => k.kid === requiredKid)) throw Error(FAILURE);
        return keys;
      });
      // Bound outbound requests even on cold start and upstream failures.
      if (now - lastAttemptAt < minRefreshMs) throw Error(FAILURE);
      lastAttemptAt = now;
      pending = refresh();
      try {
        const keys = await pending;
        if (requiredKid && !keys.keys.some(k => k.kid === requiredKid)) throw Error(FAILURE);
        return keys;
      } finally { pending = null; }
    }
  });
}
