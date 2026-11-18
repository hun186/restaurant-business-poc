# Inactive v4 stock ledger migration: exhaustive offline fault matrix

Issue #212. This is a **test-only synthetic SQLite rehearsal**, not a
migration executor or a Cloudflare remote D1 test. The active Local and
Cloudflare D1 schemas remain v3.

The two byte-identical inactive 0004 proposals are split into seven
statements: create replay-protection marker; insert marker v4; create v4
ledger; copy historical rows; drop original ledger; rename new ledger; and
recreate the stock lookup index.

`tests/stock-move-v4-fault-matrix-offline.test.js` tests each source schema
(Local v3 and D1 v3) and injects a deliberate SQL failure at **eight
boundaries** (before the first statement and after every statement).
For every boundary the test starts an explicit `BEGIN IMMEDIATE` transaction
and requires a full rollback of historical ledger, exact schema objects,
audit logs, prices, users, ingredients, stores, schema version, and indexes.
After rollback `quick_check` and foreign-key integrity must pass.

A separate synthetic negative demonstration executes three statements
**without** a transaction, injects an error, and proves the marker and
temporary v4 table can remain present. This is why any future migration
runner MUST require a validated transaction and cleanup/recovery plan.
No customer database is ever passed into these tests.

This is a local SQLite statement-atomicity proof, **not** remote Cloudflare
D1 transaction behavior, concurrent-writer fencing, or restoration of real
production backups. Before any staging/live migration, run a separately
reviewed disposable remote D1 drill with a pinned isolated binding,
fail-closed transaction proof, manual authorization, backup attestation and
operator signoff. Neither test grants release authorization or changes any
Worker route, Cloudflare Gate, or production database.
