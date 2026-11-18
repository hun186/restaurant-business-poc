# Supplier-return receipt and stock budget (inert, integer-milli only)

Issue #212. This pure, byte-identical helper appears in `src/`, `cloudflare/`,
and `vercel-demo/` but **is not imported by a live write path**.

A supplier return must have been physically received, match the actual
purchase order, store and ingredient, and be approved by the applicable
Owner/Manager. The future backend must query those facts **within an
authorized atomic transaction** and store a negative `supplier_return`
stock-move with an immutable reason, original receipt reference, audit and
idempotency key. This helper does none of those operations.

The helper only bounds four strictly typed, nonnegative integer quantities
measured in units of **1/1000**:
- `received_milli`: original received quantity for the specific PO line.
- `already_returned_milli`: accumulated returns referencing that receipt.
- `available_stock_milli`: current stock at the authorized location.
- `requested_milli`: positive quantity proposed to return.

It rejects already-returned amounts above received, requests above the
remaining receipt allowance, and requests above existing on-hand stock.
All amounts must be safe integers in [0, 1,000,000,000]; request must be
positive. It computes no raw floating-point SUM, no rounding, and produces
only integer counts; it cannot authenticate, reserve, persist or grant
permission. Client-supplied facts must NEVER be trusted. Actual transaction
idempotency, multi-item PO matching, authorization and concurrent return
races remain mandatory backend work. No credit memo is inferred.

No Local v4 migration, remote D1 migration, Cloudflare Worker, Gate, real
inventory, pricing or business records are modified.
