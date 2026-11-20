# Local SQLite stock v4 commands — gated and disabled by default

Issue #212 / staged backend implementation, **not** a real operational release.

## Local API

Existing authenticated `POST /api/command` delegates the new actions to
`appendLocalStockV4()` **inside the existing synchronous BEGIN IMMEDIATE /
COMMIT transaction**; no nested transaction, direct stock value overwrites or
changes to existing purchase/usage code.

Supported actions:
- `stock.scrap`: negative debit with a nonempty bounded reason
- `stock.adjust`: signed positive or negative quantity with a reason
- `stock.supplier_return`: negative debit with an exact *received*
  purchase-order ID, one original linked purchase ledger, per-receipt
  cumulative return cap and current on-hand stock budget.

Required payload adds `request_id` UUID to the shared v4 fields.
The UUID becomes the immutable movement ID; a replay or case variant
is rejected and cannot add a second debit/audit.

Before any write, require all:
- Existing live Local session and CSRF, active Owner/Manager account,
  current assigned store scope and active ingredient/store.
- Separate operator-provided `LOCAL_STOCK_V4_WRITE_GATE=operator-released`
  (**unset/default OFF**) and explicit already-migrated Local SQLite
  `PRAGMA user_version=4` plus matching v4 kind marker.
- Strict 0.001 quantities and bounds for the request *and historical stock*;
  neither negative stock nor returns above original received quantity.
- INSERT append-only `stock_moves` and corresponding `audit_logs`
  within the same transaction; audit failure rolls back the debit.

Do not set this Gate in the project defaults or production scripts.
The v4 migration is **never automatic**, and operator approval for
encrypted independent backup verification, offline-clone migration,
real Local/Cloudflare UAT, Production D1 migration and individual write
Gates remains separate. The Local browser still needs its v4 forms
and a server-verified capability flag. This PR only adds the gated
Local backend plus disposable `:memory:` tests.

## Post-merge acceptance gate

A code-only merge is **not** approval to launch. Confirm current Local
operational backup export and **independent verified copy** before any
separately approved v4 schema migration. An operator must explicitly
release the Local write Gate only after migration, restore rehearsal and
Owner/Manager/Staff real-browser UAT. Until the Local UI/capability is
implemented, there is no supported new-action button in the Local browser.
Cloudflare's D1 schema migration and write Gates are independent.
