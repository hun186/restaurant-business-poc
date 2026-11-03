# Internal atomic quota adapter / Owner preflight synthetic acceptance

**Scope:** no production Cloudflare binding, public endpoint, credentials,
network, actual D1 or durable quota backend. This isolated test suite connects
the adapter to `preflightNativeAdminV1` and demonstrates:

- a backend with a deliberately supplied `consumeAtomic` function receives only
  `{scope:'native-admin-preauth'}` and later
  `{scope:'native-admin-owner',actorId}` for an authenticated synthetic Owner;
- preauth quota denial returns 429 without D1 reads, invalid/throwing backend
  decisions return a generic 503 without leaking diagnostics, and a missing
  adapter returns `E_NOT_READY`;
- Owner-specific denial follows read-only synthetic identity checks but does
  not consume the request body, write D1 or dispatch account mutations;
- Manager cannot consume the Owner quota or be authorized by this preflight.

The test backend is a local synthetic stub and does **not** demonstrate
cross-isolate atomicity. A distributed quota design still needs a trusted
preauth subject identity, durable/atomic storage, source-header threat model,
global/subject window and concurrency policies, staging UAT, and separate
production release approval. Vercel Preview is expected to remain disabled;
this PR should not trigger a Preview Deployment.
