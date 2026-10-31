// Internal-only bridge from a raw Access assertion to a cryptographically
// verified subject. Not connected to public Worker routes or application RBAC.
import {createAccessJwksLoader} from './access-jwks-internal.mjs';
import {verifyAccessJwtAssertion} from './access-jwt-internal.mjs';

const LIMIT = 16384;
function decodeSegment(segment, maxBytes) {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) return null;
  try {
    const binary = atob(segment.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(segment.length/4)*4,'='));
    if (binary.length > maxBytes ||
        btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'') !== segment) return null;
    return Uint8Array.from(binary, x=>x.charCodeAt(0));
  } catch { return null; }
}
function keyHint(assertion) {
  if (typeof assertion !== 'string' || assertion.length > LIMIT ||
      !/^[A-Za-z0-9_.-]+$/.test(assertion)) return null;
  const parts = assertion.split('.');
  if (parts.length !== 3 || parts[0].length > 1024) return null;
  try {
    const [protectedBytes,payloadBytes,signatureBytes] = [
      decodeSegment(parts[0],1024),decodeSegment(parts[1],LIMIT),decodeSegment(parts[2],512)
    ];
    if (!protectedBytes || !payloadBytes || !signatureBytes || signatureBytes.length < 256) return null;
    // Syntax check only. Do not use unsigned payload claims as identity or policy.
    const claims = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payloadBytes));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    const header = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(protectedBytes));
    return header && !Array.isArray(header) && header.alg === 'RS256' && header.typ === 'JWT' &&
      typeof header.kid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(header.kid) ? header.kid : null;
  } catch { return null; }
}

export function createTrustedAccessIdentity({issuer,audience,fetchImpl,nowMs = Date.now} = {}) {
  if (typeof audience !== 'string' || !/^[0-9a-f]{64}$/i.test(audience) ||
      typeof nowMs !== 'function') throw Error('ACCESS_IDENTITY_CONFIG_INVALID');
  const loader = createAccessJwksLoader({issuer,fetchImpl,nowMs});
  return Object.freeze({
    async verify(request) {
      try {
        const assertion = request?.headers?.get('Cf-Access-Jwt-Assertion');
        const kid = keyHint(assertion);
        if (!kid) return null; // Avoid remote fetch for malformed/missing headers.
        // Header is ONLY an untrusted key selector. Nothing is authenticated here.
        const jwks = await loader.getJwks({requiredKid:kid});
        const nowSeconds = Math.floor(nowMs()/1000);
        return await verifyAccessJwtAssertion(assertion,{issuer,audience,jwks,nowSeconds});
      } catch { return null; }
    }
  });
}
