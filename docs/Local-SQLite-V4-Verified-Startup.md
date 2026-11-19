# Local SQLite v4 verified startup — no automatic migration

This stage prepares the Local SQLite adapter for Issue #212, but **does not
activate any v4 stock write command** and never upgrades operator data.

## Explicit version contract

- The existing Local v1→v2→v3 migrations remain unchanged.
- Startup and read-only preflight continue to refuse broken databases.
- For an existing database explicitly marked `PRAGMA user_version=4`,
  the verifier constructs a **separate disposable in-memory database**
  from the reviewed v3 schema plus the v4 migration proposal. It then
  compares every installed required table/index DDL against that exact
  canonical v4 schema, and checks the single kind-version marker is 4.
- Databases with partial/stale stock_moves_v4 or mismatched v3/v4
  metadata are rejected. Unknown future schema versions are rejected.
- The application NEVER executes the v4 migration SQL against the
  operator database automatically and never infers authorization
  from a marker alone. A migration proposal is not a release ticket.
- The Local operational backup source and independent snapshot verifier
  now read the recorded schema version and require the same strict
  `verifyInstalledSchema` contract for v3 or v4. A v4 source with an
  invalid marker/DDL is rejected. Tests create a disposable v4 SQLite
  `VACUUM INTO` copy and verify its snapshot fingerprint.
- This verifies **backup integrity/readability**, not a full operator
  restore/UAT or permission to migrate live data.

## Remaining release steps

1. Finish the separately gated Local SQLite `stock.scrap`,
   `stock.adjust`, and received-PO `stock.supplier_return` handlers
   and the Local browser forms. Production Server/SQLite must enforce
   authenticated Owner/Manager, store scope, idempotency, exact
   receipt/balance checks and atomic append-only ledger plus audit.
2. With explicit operator authorization, first verify encrypted backup
   and independent copy restore, run a staged v3→v4 migration on a
   disposable clone, and validate counts, constraints, indexes,
   old transactions and cost projections.
3. Only after successful controlled UAT and a separate operator
   release decision can live Local data be upgraded. **This PR
   performs no such migration and sets no write Gate**.

All tests use disposable in-memory SQLite only; CI results do not
prove a real operator DB or remote D1 upgrade.
