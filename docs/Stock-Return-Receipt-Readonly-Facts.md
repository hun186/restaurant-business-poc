# Supplier return: read-only PO/ledger source-of-facts precheck

**Status: inert helper + synthetic tests only.** Issue #212. This builds on
the approved v4 payload contract and integer-milli return budget guard; it
does not grant writes, authenticate a user, deploy a Worker, or alter a
customer database.

`inspectSupplierReturnFacts(db, payload)` reads only `SELECT` statements
on an already-supplied, SQLite-compatible database adapter. It supports
Node `node:sqlite` (`prepare().all(params)`) and the D1 statement
shape (`prepare().bind(params).all()`), but **the tests only use local
in-memory SQLite and simulated D1 adapters, not remote D1**.

It requires:
- An existing proposed-v4 `stock_move_kind_contract` marker; v3 without
  the new move kind cannot represent supplier returns.
- A currently active store and ingredient.
- Exactly one `received` purchase order matching the requested
  store/ingredient and exactly one positive purchase ledger movement with
  matching PO reference and amount. Multiple receipts and mismatches fail
  closed until partial-receipt semantics are explicitly designed.
- Every prior `supplier_return` row with that PO reference belongs to the
  same store and ingredient, is negative, and is individually representable
  in 0.001 units.
- Current total on-hand ledger for the store/ingredient is representable
  using integer thousandths. Any non-grid, nonfinite, out-of-range, or
  excessive historical rows fail closed rather than being silently rounded.
- The proposed return meets both original received-minus-previous-returns
  allowance and current on-hand stock.

Only aggregate numbers and booleans are returned, explicitly including
`transaction_authorized=false`, `remote_d1_verified=false`, and
`writes_performed=false`. Raw PO IDs, staff account details or ledger
rows are not emitted by this helper.

**Critical concurrency caveat:** These observations do not reserve stock
and MUST NOT be used as authorization for a later asynchronous write.
When actual Local/D1 APIs are implemented, the same PO, historical return
and stock conditions must be rechecked *inside the same serialized
transaction* as the new append-only stock movement, idempotency key and
audit insert. Store-scope RBAC, session/CSRF, original stock receipt and
operator release Gate remain independent mandatory protections. No
financial credit note may be inferred just from a physical return.

No active migration, production D1, Cloudflare variables, runtime API,
Vercel persistent storage, or business records are changed in this PR.
