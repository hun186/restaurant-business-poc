# Cloudflare D1 Stock v4 — versioned migration candidate (OFFLINE ONLY)

This source is a **non-active, opt-in candidate**, not a deployment
job or a permit to run it. Issue #212 / operational backup #176.

- `cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql`
  is byte-for-byte identical to both reviewed inert 0004 proposals.
- The existing active `cloudflare/migrations` directory continues
  to contain only `0001_initial_v3.sql` and
  `0002_login_attempts_window_indexes.sql`. The existing
  `d1-staging-migration.yml` is for **empty staging initialisation**
  and must never be used to migrate an operating database.
- A reviewed **versioned** Stock v4 installation will leave
  `cloud_schema_contract.contract_version=3` unchanged while adding
  one row to D1's own ledger: `d1_migrations(id=3,
  name='0004_stock_move_kinds.sql')`. The business `stock_moves`
  table is rebuilt atomically with unchanged historical data and a
  new `stock_move_kind_contract` marker.
- An unversioned/manual application of only the DDL with two old
  migration records is **not** accepted as a production-operational
  v4 backup. A v3 database claiming the third migration without
  the matching schema is also rejected.
- Offline `verifyLocalSql(sql,{operational:true})` verifies strict
  migration names/IDs, approved v4 marker and table/index DDL in
  disposable SQLite before accepting the encrypted SQL archive.
  This checks archive *consistency*, not the genuineness of the
  remote Cloudflare migration event itself.

## Required release safeguards (not performed here)

1. Verify independent encrypted backups and actual restore
   rehearsal. Ensure the exported operational v3 archive is
   independently verified, not merely saved.
2. Freeze writes for the explicitly selected isolated target,
   and check exact target UUID, migrations, active Worker version,
   historical ledger and all dependent views/triggers.
3. Perform a reviewed synthetic **remote disposable D1** transaction
   rollback and full-history comparison, then a separately approved
   staging-window migration; do not use the empty-only staging
   initialiser. Verify D1's migration ledger and per-table values.
4. Production database migration and Write Gate activation require
   **separate explicit operator authority**, recovery proof and
   actual Owner/Manager/Staff UAT. The v4 backup should then
   independently verify original + separately stored encrypted copy.
5. A downgrade to v3 after new `scrap` or `supplier_return`
   records cannot rewrite historical rows; use an independently
   authorized consistent backup restore instead.

No CLI, workflow, Wrangler config or Worker invokes this candidate
in normal startup, PR checks, CI or regular deployment. The review
does not grant Production D1 migration authorization.
