# Native admin quota Durable Object — isolated Staging acceptance

**Status: BLOCKED for live activation.** The repo contains a dormant candidate
transactional quota core and mocked tests. No Durable Object binding, namespace
migration, production quotas, HMAC key provider or public account endpoint exists.

## Acceptance sequence (requires separate staging approval)

1. Provision a **separate Staging** SQLite-backed Durable Object namespace via
   a reviewed `new_sqlite_classes` migration; preserve Production Wrangler,
   D1 and Worker configuration unchanged.
2. Derive a per-request `trustedPreauthKey` from a verified network or gateway
   identity with a server-side secret HMAC. Never use request-provided
   `CF-Connecting-IP`, `X-Forwarded-For`, raw IPs, cookies or a single shared
   global key as authority. Confirm anti-spoofing and key rotation.
3. Configure realistic limits and collision-resistant partitioning; the
   candidate 3/min preauth and 2/min Owner are **unit-test examples only**.
4. Run concurrent calls from **two or more independent Worker isolates** to
   the same named SQLite-backed Durable Object, exceeding the limit. Verify
   exactly the configured number of positive decisions, the rest denied, and
   that the counter remains durable after an Object restart/deployment.
5. Verify isolated subjects do not share preauth buckets. Two subjects
   associated with the **same Owner** must still share Owner quota; different
   Owners must not share a bucket. Test burst, window rollover, clock skew,
   backend errors, cancellation after commit and indeterminate RPC outcomes.
6. Confirm no automatic retry after an indeterminate RPC result: the attempt
   may have consumed quota. Define idempotency/versioning and replay policy
   before activating admin writes.
7. Validate real HTTP requests are denied before reading passwords or
   performing D1 account actions, and no HMAC, token, raw IP or CSRF appears
   in logs, audit, cache keys or exception messages.
8. Run Hosted CI, formal Codex Review, staging performance/security UAT,
   rollback and explicit release approvals **before** wiring any Worker route.
   Do not enroll the Production Owner or perform any Production D1 mutation.

## What the current tests establish

`tests/native-admin-quota-durable-candidate.test.js` checks the pure
transactional state machine with a serialized local fake. The integration
suite verifies the DO transport (injected namespace) through the existing
external quota adapter and read-only Owner preflight. It checks 9 concurrent
synthetic admissions, separate preauth HMAC-shaped partitions, a shared Owner
bucket, and failure-before-body on missing trusted key or backend errors.

**These synthetic tests do not establish real multi-isolate semantics.**
The candidate is not connected to Cloudflare; staging remains blocked until
items 1–8 are independently evidenced.
