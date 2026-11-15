# Native Owner role change: separate double-gated release (2026-11-15)

Phase 2 of [Issue #182](https://github.com/hun186/restaurant-business-poc/issues/182): Cloudflare Worker gains `POST /api/accounts/role` that only changes an *active* staff or manager between these two roles. Owner cannot edit their own or anyone else's Owner role through this path. Requires same-origin, CSRF, Owner Session, schema v3, client `expectedRole` CAS, hourly quota and no credentials in responses/audit detail. A single D1.batch transaction adds `audit_logs:user.role`, updates users.role conditionally, revokes **all** target Sessions and validates a NOT NULL rollback sentinel. This retains historical records.

**Two independent required operator gates**: `CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE=operator-released` AND `CLOUD_NATIVE_ACCOUNT_ROLE_WRITE_GATE=operator-released`. Neither is added to `wrangler.jsonc`, and account-create gate cannot unlock this endpoint. With either missing the route replies 503. The GET Owner account list returns `can_manage_role` only when both are enabled.

Status: code + synthetic tests only, never credentials or production D1. This PR must stay **Draft until exact-head 5/5 Hosted CI and Codex completed**, then requires separate operator consent to merge/deploy with role Gate kept absent; enabling role Gate must be separately authorized and audited. Vercel Demo is mock-only, local SQLite role management is separate; no blanket permission to promote to Owner, password reset or hard delete is introduced.

### Owner UI
When the Owner GET list returns `can_manage_role:true` (requires both independent gates), staff/manager rows display a single explicit action: `升為主管` or `改為員工`. It requires confirmation, then POSTs the exact `expectedRole`; HTTP 401 clears Owner workspace, 409 prompts refresh, all successful role changes reload from D1. No button exists for Owner targets or inactive accounts. With the production Role Gate absent, no role button appears.
