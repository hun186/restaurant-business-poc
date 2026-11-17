# Stock movement kinds: v3 → proposed next contract (offline only)

**Status: design and offline rehearsal only.** Neither SQL file is an active
migration. The live Local SQLite schema is v3, and Cloudflare's production and
preview D1 `cloud_schema_contract` remains **3**. **Do not execute either
proposal on a real database** until a separate reviewed release workflow and
operator approval exist.

## Current incompatibility

Both deployment schemas define `stock_moves.move_type` with a
`CHECK(move_type IN ('purchase','usage','adjustment'))`.
Forcing a supplier return or spoilage into `usage` would make the durable
ledger and export misleading. A new kind requires a checked SQLite table
rebuild, not a plain `ALTER TABLE ADD COLUMN`.

## Proposed business contract

| kind | Meaning | Sign | Additional requirements |
|---|---|---|---|
| `purchase` | approved receiving | positive | preserve current order.receive path |
| `usage` | normal kitchen consumption | negative | preserve current stock.usage path |
| `adjustment` | stocktake / controlled opening | either nonzero | preserve current audited flows |
| `supplier_return` | stock physically returned to supplier | negative | reason **and** source receiving/order reference |
| `scrap` | spoilage, damage, expired ingredients | negative | mandatory specific reason |

The database proposal deliberately refuses a nonnegative supplier return or
scrap, an empty reason, or a supplier return without `reference_id`. The
future HTTP/local/demo write actions must also validate the referenced order,
that it belongs to the same authorized active store and ingredient, has
actually been received, and that prior returns for that PO do not exceed the
original received quantity. The DB `reference_id` column is polymorphic, so
the **application's atomic transaction** must verify the purchase-order
relationship at the time of debit; this proposal does not pretend the CHECK
alone enforces it.

All three platforms should eventually expose the same action names
`stock.supplier_return`, `stock.scrap` and
`stock.adjust` (controlled/manual adjustment). Acknowledgement,
idempotency, RBAC, optional manager approval and financial-credit treatment
require separate design and tests. Do not infer purchase-credit memos from a
physical stock return.

## Migration invariants and offline test evidence

The two source files are **identical**:
- `db/migration-proposals/0004_stock_move_kinds.sql`
- `cloudflare/migration-proposals/0004_stock_move_kinds.sql`

Each first creates a standalone `stock_move_kind_contract` version-4 marker,
which **refuses any replay** and is rolled back with the rebuild on failure.
This marker does not alter Local `PRAGMA user_version` or D1's existing
`cloud_schema_contract` yet; an actual deployment requires separately
reviewed version transitions and postflight checks.

Each then creates a new checked table, copies **every existing column including
original `created_at`, id, actor, reference, note and quantity**, replaces
the old ledger and recreates its `stock_moves_stock` index. No customer
rows, credentials or audit records are inserted/deleted or re-initialized.
SQLite's table rebuild is only safe when run **as one transaction** after a
full structural and data-count read-only preflight; schema replacement and
metadata verification must be part of the same change window.

`tests/stock-move-kinds-migration-proposal.test.js` works entirely in
synthetic in-memory SQLite based on each v3 source schema and demonstrates:
copy identity, ledger preservation, old price/audit preservation,
foreign-key/integrity checks, new move kinds and invalid-move rejection, full
rollback of an injected mid-migration error, and replay refusal. The test
**does not emulate D1 remote migration transaction semantics**.

## Before any live/staging migration is authorized

1. Create a new isolated D1 binding and run a read-only inventory of actual
   schema, active indexes, triggers, views, `d1_migrations`, original and
   foreign-key row counts. Reject any unexpected object or future version.
2. Obtain **fresh encrypted production D1 backup**, verify independent copy
   and run an isolated restore rehearsal; keep secrets and restores away from
   the public Worker. For the local version, likewise make a verified
   SQLite backup before changing `PRAGMA user_version`.
3. Validate no unknown tables or views have a foreign-key or SQL dependency on
   `stock_moves`. Confirm D1's migration transaction / remote rollback
   behavior on **disposable** D1 with realistic old rows, concurrent writes
   fenced, and controlled failure injection.
4. Build *separate* migration mechanisms: local v3 → v4 with versioned
   read-only schema validation and fail-closed backup/restore; D1 guarded
   explicit action from a new migration folder and dedicated manual-only
   workflow (never use existing `d1-staging-migration.yml`, which assumes
   EMPTY D1). Bind only explicitly approved staging first. Never grant a
   production migration credential to a PR or regular CI job.
5. Verify all original ledger IDs, timestamps, rows, audit references,
   balances, indexes, FK integrity, costing and the migration ledger after
   applying; compare exact snapshots and fail on any difference. Existing
   Owner/Manager/Staff sessions and permissions must remain unchanged.
6. Backward **downgrade to v3 is invalid once any `supplier_return` or
   `scrap` rows exist**. Rollback is restore from an approved consistent
   backup, or a separately reviewed compensating migration with proper
   business evidence. Never silently delete new ledger entries or modify
   past entries to make a downgrade succeed.
7. Only after the migration is deployed safely should a separate,
   default-closed API Gate and Owner/Manager UI be released and UAT tested.
   Unmigrated D1 must return a clear not-ready status, not attempt an insert.

**Immediate scope of this PR:** the two proposed SQL files, offline
regression tests and this design record. No `db/schema.sql`,
`cloudflare/migrations/`, Wrangler config, runtime API, production database,
or existing Gate is modified.
