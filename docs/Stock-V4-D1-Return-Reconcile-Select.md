# Issue #212 — read-only synthetic D1 supplier-return select plan

This is a **non-executing SQL projection proposal**, not a D1 query client.
The module `src/stock-v4-d1-return-reconcile-select.mjs` returns two fixed,
prepared, single-parameter SELECTs for one canonical supplier-return UUID:

1. A max-2-row `stock_moves` projection by exact request ID, with only the
   fields used to match original action, quantity, scope and source PO.
2. A max-2-row `audit_logs` projection by matching entity ID, including
   action, actor, scope and sanitized audit detail. Crucially this projection
   does **not** filter to a particular audit ID or action: unexpected extra
   records must remain observable to fail closed.

The intended future flow is to execute both projections in a vetted
**consistent read snapshot** under the same authorized tenant/session, then
supply those two arrays, the original request and audit ID to the
`reconcileSyntheticD1SupplierReturnSnapshot` helper from PR #227. No
result certifies a remote commit or allows an automatic retry.

All SQL remains inert. Test execution uses only a disposable in-memory SQLite
database, never Cloudflare. Active Cloudflare, Local and Vercel runtimes
cannot import this helper; D1 v3 remains unchanged, and v4 schema/migration
is still an unexecuted proposal.

Before actual remote deployment: require a separately reviewed account/store
authorization and rate-limited read endpoint, consistent-snapshot semantics
and latency checks, v4 schema migration and restoration safety approval,
Scratch D1 concurrency/rollback UAT, production release approval and
Owner verification. This PR authorizes NONE of those activities.
