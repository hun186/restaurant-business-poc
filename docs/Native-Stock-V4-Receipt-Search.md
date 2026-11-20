# Native D1 supplier return — searchable full receipt history

Issue #212. This addresses a release-critical mismatch found while
verifying three-platform parity: `/api/data?entity=purchase_orders`
returns only the most recent 500 purchase-order rows. A received PO
older than that can still be **eligible for return**, but the Native
Owner form could not select it.

## Implementation

- New **read-only** `GET /api/stock/receipts` accepts exactly
  `location_id`, `ingredient_id`, and optional `q` (ASCII PO number
  substring, maximum 64 characters).
- Requires a live cookie Session, Owner/Manager access, currently
  assigned active store, an active ingredient, existing D1 v3 schema
  and stock-kind v4 marker, and the **independent Supplier Return
  write Gate**. If any check fails, no receipt rows are exposed.
- All SQL uses parameter binding and applies scope predicates *before*
  a bounded `LIMIT 51`. At most 50 rows are returned, with
  `truncated=true` requiring a more precise PO-number search.
  No customer data, employee data, password or full unbounded table
  scan is returned to the browser.
- The Native stock page no longer loads `purchase_orders` from the
  recent-list API when rendering its v4 form. It uses an explicit
  search button after choosing a store and ingredient. Selection
  is discarded when either changes and stale asynchronous responses
  cannot populate the form after logout, navigation or new selection.
- The real `POST /api/stock/return` still independently rechecks
  active role/scope, exact received PO, original purchase movement,
  current stock, cumulative returned quantity, CSRF and idempotency
  within the atomic D1 transaction. **A search result alone does not
  grant write authorization or promise that the PO is returnable.**

Synthetic D1/Worker tests include over 520 newer received rows and
a matching older PO, Owner/Manager/Staff and cross-store isolation,
invalid queries and independent OFF Gate, with read-only SQL assertion.

## Safety and release boundary

This patch does not migrate or touch Production D1, enable a Gate,
change existing purchase/stock/audit rows, deploy a Worker or establish
real Owner UAT. Keep the release gate closed until independently
verified Production backup/restore, scoped staging v4 migration and
formal operator authorization.
