# Offline stock v4 postflight (no migration runner)

Issue #212. This is a **read-only verifier for two independent, already-open
SQLite snapshots**: one known v3 source and one copy after applying the
*inactive* v4 proposal in a disposable offline test. It cannot open files,
connect to Cloudflare, execute migrations, or use production credentials.

`checkStockV4OfflinePostflight(beforeDb, afterDb, origin)` verifies:
- Source passes the approved v3 read-only preflight, `quick_check` and FK checks.
- Post-schema is still the explicit *proposal* state: single v4 marker,
  unchanged original v3 version metadata, the expanded five-kind stock
  constraint, no temporary table, and stock lookup index.
- Every original table and every original row remains, including all ledger
  IDs, deltas, notes, timestamps, linked accounts, audit records, ingredient
  prices, and any other business table. The only allowed additional table is
  `stock_move_kind_contract`. Unrelated DDL/indices cannot drift.
- Exact approved SQL for the proposed ledger, marker and stock index, not
  merely their names or partial CHECK snippets; unknown schemas fail closed.
- Reject TEMP schema objects and qualify all data reads to the main database.
  Reject nonfinite REAL values before row encoding; include SQLite storage
  types so numeric coercion cannot falsify historical equality.
- Output only counts and safe booleans; underlying business rows remain
  inside the verifier and errors are sanitized. No writes are performed.

The `beforeDb` and `afterDb` values must be independent snapshots captured
before and after migration, not two wrappers over the same underlying
database. Otherwise a simultaneous mutation could falsify the comparison.
Tests use only two independent `:memory:` databases, and deliberately
corrupt past ledger, audit, prices, and migration metadata.

**Limitations:** This does not test actual Cloudflare D1 remote transactions,
rollback semantics, administrative binding permissions, network convergence,
production backup integrity, or concurrent writers. It intentionally
reports `migration_authorized=false` and `remote_d1_verified=false`.
It is not a runnable migration or an operator release decision. The active
Local and D1 schemas remain v3, and no Worker route, Gate, or CLI is added.
