// Internal-only Cloudflare Access identity verification for a later reviewed
// staging login rollout. NEVER trust raw Cf-Access-Jwt-Assertion without RS256.
// This module is not imported by the public Worker or any request route.
const utf8 = new TextEncoder();
const CLOCK_SKEW_SECONDS = 30;
const MAX_JWT_BYTES = 16384;

function bytesFromBase64url(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment) ||
      segment.length % 4 === 1) return null;
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
    const binary = atob(padded);
    const canonical = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    if (canonical !== segment) return null;
    return Uint8Array.from(binary, x => x.charCodeAt(0));
  } catch { return null; }
}
function parsePart(segment) {
  const bytes = bytesFromBase64url(segment);
  if (!bytes || bytes.length > MAX_JWT_BYTES) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

// Only accept an expected team domain and Access audience from trusted server config.
// No caller-controlled issuer, team domain, keys, or audience may be accepted.
export async function verifyAccessJwtAssertion(assertion, { audience, issuer, jwks, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (typeof assertion !== 'string' || assertion.length > MAX_JWT_BYTES ||
        !/^[A-Za-z0-9_.-]+$/.test(assertion) ||
        typeof audience !== 'string' || !/^[0-9a-f]{32}$/i.test(audience) ||
        typeof issuer !== 'string' ||
        !/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/.test(issuer) ||
        !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0 ||
        !Array.isArray(jwks?.keys) || jwks.keys.length < 1 || jwks.keys.length > 10) return null;
    const segments = assertion.split('.');
    if (segments.length !== 3) return null;
    const [protectedHeader, payload, signature] = segments;
    const header = parsePart(protectedHeader), claims = parsePart(payload);
    const sig = bytesFromBase64url(signature);
    if (!header || !claims || !sig || sig.length < 256 || sig.length > 512 ||
        header.alg !== 'RS256' || header.typ !== 'JWT' ||
        typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) return null;

    const matches = jwks.keys.filter(j => j && j.kid === header.kid);
    if (matches.length !== 1) return null; // ambiguous or missing key is fail-closed
    const jwk = matches[0];
    if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' ||
        jwk.e !== 'AQAB' || typeof jwk.n !== 'string' ||
        jwk.n.length < 342 || jwk.n.length > 684 || !bytesFromBase64url(jwk.n)) return null;

    const key = await crypto.subtle.importKey('jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig,
      utf8.encode(protectedHeader + '.' + payload));
    if (!verified) return null;
    if (claims.iss !== issuer || !Array.isArray(claims.aud) ||
        !claims.aud.includes(audience) ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
        claims.iat <= 0 || claims.exp <= claims.iat ||
        claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
        claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
        (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) ||
          claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS))) return null;
    // Return only verified identity fields; never return the JWT or key material.
    return Object.freeze({ subject: claims.sub });
  } catch { return null; }
}

export async function verifyAccessRequest(request, config) {
  // Header shape and signature must both verify. Presence alone proves nothing.
  const assertion = request?.headers?.get('Cf-Access-Jwt-Assertion');
  return verifyAccessJwtAssertion(assertion, config);
}
