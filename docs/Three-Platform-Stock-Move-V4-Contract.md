# Inert three-platform stock movement v4 data contract

**Issue #212 — staging contract only. No deployment authorization.**

`src/stock-move-v4-contract.mjs`, `cloudflare/stock-move-v4-contract.mjs`,
and `vercel-demo/stock-move-v4-contract.mjs` are byte-identical pure
validators. They are not yet imported by production runtime modules.
This PR does not change active SQLite/D1 v3 schemas, operations, Worker routes,
Cloudflare variables, or customer data.

| Action | Required input | Proposed append-only ledger |
|---|---|---|
| `stock.supplier_return` | ingredient_id, location_id, reference_id, qty, reason | negative supplier_return, reference_id is received PO id |
| `stock.scrap` | ingredient_id, location_id, qty, reason | negative scrap, no PO |
| `stock.adjust` | ingredient_id, location_id, qty_delta, reason | signed nonzero adjustment |

Canonical properties: strict UUID strings, exact key sets, required trimmed
reason of 1–300 characters, numeric quantities up to absolute 1,000,000 with
at most three decimal places. Reject zero, unbounded values, strings as
numbers, unapproved keys, control characters, missing PO references, and
excess decimals. Normalization outputs `move_type`, `qty_delta`,
`reference_id`, and `note`; no writes are performed.

**Not sufficient to execute**: local, demo and D1 backends must still validate
Owner/Manager authorization, active authorized store/ingredient, that the
purchase order is received and matches ingredient/store, quantity returned so
far (including concurrent attempts), no negative stock, reason audit,
idempotency, price treatment, append-only ledger and audit in ONE atomic
transaction. Physical return is not an automatic credit memo.

Both active schemas are still v3 and cannot yet persist supplier_return or
scrap. Only the offline, non-executable 0004 proposal defines v4 kinds.
A disposable D1 rehearsal and independently authorized migration are
required before connecting adapters, UI, or enabling any new mutation Gate.
