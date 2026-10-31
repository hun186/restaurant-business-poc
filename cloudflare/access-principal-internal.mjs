// Internal-only, read-only D1 identity binding. Never imported by public Worker.
// No username/email matching, self-registration, sessions, grants or D1 writes.
import {createTrustedAccessIdentity} from './access-identity-internal.mjs';

const ROLES = new Set(['owner','manager','staff']);
const LINK_SQL =
  'SELECT u.id,u.username,u.display_name,u.role ' +
  'FROM access_identity_links l JOIN users u ON u.id=l.user_id ' +
  'WHERE l.issuer=? AND l.audience=? AND l.subject=? ' +
  'AND l.active=1 AND u.active=1 LIMIT 2';
const LOCATIONS_SQL =
  'SELECT l.id AS location_id FROM user_locations ul ' +
  'JOIN locations l ON l.id=ul.location_id ' +
  'WHERE ul.user_id=? AND l.active=1 ORDER BY l.id LIMIT 201';
const ID = /^[A-Za-z0-9_-]{1,128}$/;

// Tables and identity links must be provisioned by a separately reviewed
// migration and explicitly authorized enrollment; they are intentionally
// absent from current D1 v3. Missing schema must DENY, not auto-create.
export function createBoundAccessPrincipal({issuer,audience,fetchImpl,nowMs} = {}) {
  const verifier = createTrustedAccessIdentity({issuer,audience,fetchImpl,nowMs});
  return Object.freeze({
    async resolve(request,env) {
      if (env?.CLOUD_AUTH_PHASE !== 'preview-readonly' || !env.DB?.prepare) return null;
      try {
        const identity = await verifier.verify(request);
        if (typeof identity?.subject !== 'string' ||
            !identity.subject || identity.subject.length > 256) return null;
        const version = await env.DB.prepare(
          'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
        if (version?.contract_version !== 3) return null;
        const mapped = await env.DB.prepare(LINK_SQL)
          .bind(issuer,audience,identity.subject).all();
        if (!Array.isArray(mapped?.results) || mapped.results.length !== 1) return null;
        const user = mapped.results[0];
        if (!user || !ID.test(user.id) ||
            typeof user.username !== 'string' || !user.username || user.username.length > 128 ||
            typeof user.display_name !== 'string' || user.display_name.length > 256 ||
            !ROLES.has(user.role)) return null;
        const rows = await env.DB.prepare(LOCATIONS_SQL).bind(user.id).all();
        if (!Array.isArray(rows?.results) || rows.results.length > 200) return null;
        const locations = [];
        const seen = new Set();
        for (const item of rows.results) {
          const value = item?.location_id;
          if (typeof value !== 'string' || !value || value.length > 128 || seen.has(value)) return null;
          seen.add(value);
          locations.push(value);
        }
        if (user.role !== 'owner' && locations.length === 0) return null;
        // Snapshot only; future protected operation must recheck user/session,
        // current role and active store in its own authorization boundary.
        return Object.freeze({id:user.id,username:user.username,
          display_name:user.display_name,role:user.role,
          locations:Object.freeze(locations)});
      } catch {
        // No SQL/schema/subject/token disclosure to a caller.
        return null;
      }
    }
  });
}
