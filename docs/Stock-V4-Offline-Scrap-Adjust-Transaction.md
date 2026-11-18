# Stock v4 scrap / manual adjustment: in-memory atomic transaction rehearsal

**Issue #212 — synthetic SQLite only, not a production feature.**

`src/stock-v4-offline-scrap-adjust.cjs` demonstrates an actual
`BEGIN IMMEDIATE` + append-only ledger + audit + `COMMIT` transaction for
the future `stock.scrap` and `stock.adjust` actions. The module is
deliberately **not imported** by the Local HTTP API, Cloudflare Worker, or
Vercel Demo. Both active database schemas remain v3.

The module refuses to operate unless its caller supplies an ephemeral
SQLite **:memory:** database with an empty in-memory `main` entry
(and at most an unused, empty `temp` schema), database `location()` returning
null, foreign keys enabled, a synthetic v4 marker and
a basic v4 ledger check. It rejects any on-disk SQLite file or attached
database before beginning a write. It has no file-opening or network API;
the only mutations it can perform are to this disposable test connection.

The in-transaction checks query authoritative synthetic DB data:
- Owner or Manager user must be active; Staff is denied; Managers must have
  the store grant; store and ingredient must be active.
- A strict UUID request ID is used as the new `stock_moves.id`: replayed
  operations fail before writing, even if action or quantity differs.
- Signed adjustments and scrap quantity must meet the shared 0.001-grid
  data contract. The entire existing store+ingredient ledger is summed
  using integer thousandths. A negative result, non-grid historical
  quantity, or unreasonably large balance fails closed.
- One new ledger row and one corresponding audit row must both be written
  within the **same transaction**, with a sanitized failure result and full
  rollback if either fails. There is no direct `on_hand` update.
- The read-only return-facts validator is a separate follow-up step:
  **this executor does not implement supplier returns**.

Only synthetic Local-v3 and D1-v3 schemas rebuilt by the **inactive**
0004 proposal are used in tests. A simulated D1 SQLite schema is not
proof of remote Cloudflare D1 transactional/rollback behavior. This does
not create any production capability, API, role grant, release variable,
D1 schema, or migration runner. No money or supplier credit is updated.

Before activation, require independent real migration/backup approval,
remote D1 atomicity and idempotency evidence, a transactionally guarded
production adapter, role/session/CSRF enforcement, explicit write Gate,
and Owner/Manager UAT. None are authorized by the synthetic PASS.
