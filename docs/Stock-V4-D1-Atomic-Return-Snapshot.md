# Supplier-return atomic read snapshot (offline-only)

Issue #212 / Phase: future D1 supplier-return reconciliation.

## Problem

The earlier two-SELECT inspection reads stock_moves and audit_logs separately.
Concurrent changes between those reads can make a partial observation look
misleading. A single SQLite SELECT uses one statement-level read snapshot.

## Proposed plan

- src/stock-v4-d1-return-atomic-snapshot.mjs builds ONE parameterized SELECT
  using two bounded CTEs and UNION ALL with a row_kind tag.
- Each branch is capped at 2 rows (4 total); unexpected duplicates, malformed
  projections and missing/mismatched audits never authorize a replay.
- Reconciliation reuses the #227 strict supplier-return content matching. All
  results have safe_to_retry=false and remote_d1_verified=false.
- Tests exercise real in-memory SQLite using PRAGMA query_only=ON.

## Explicitly not delivered

No production Cloudflare route, DB prepare/bind/all invocation, D1 write,
schema migration, auth/scope verification, Gate or release permission.
No remote transaction-commit proof: even a single statement cannot establish
what happened after an uncertain HTTP response. A future authenticated
operator-only adapter must bind to the same D1 database, verify owner/store
scope and execute the SQL read-only; a true Scratch D1 test and explicitly
approved v4 migration/release remain required before real supplier returns.
