// Internal-only bridge from a raw Access assertion to a cryptographically
// verified subject. Not connected to public Worker routes or application RBAC.
import {createAccessJwksLoader} from './access-jwks-internal.mjs';
import {verifyAccessJwtAssertion} from './access-jwt-internal.mjs';

const LIMIT = 16384;
function keyHint(assertion) {
  if (typeof assertion !== 'string' || assertion.length > LIMIT ||
      !/^[A-Za-z0-9_.-]+$/.test(assertion)) return null;
  const parts = assertion.split('.');
  if (parts.length !== 3 || parts[0].length > 1024) return null;
  try {
    const input = parts[0];
    if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) return null;
    const binary = atob(input.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(input.length/4)*4,'='));
    if (btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'') !== input) return null;
    const header = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary, x=>x.charCodeAt(0))));
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
