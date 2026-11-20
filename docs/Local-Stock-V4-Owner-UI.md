# Local SQLite v4 Owner interface — capability-gated, default OFF

This patch adds an **authenticated read-only** `GET /api/stock/v4-capability`
and the Local stock-page forms for:
- `stock.scrap` (negative debit with a required reason)
- `stock.adjust` (signed positive or negative difference)
- `stock.supplier_return` (receipt-linked debit against an existing
  *received* PO with matching store/ingredient and a required reason)

The endpoint reports only `{enabled:boolean}`, after current() verified
a live session. It returns true for Owner/Manager **only if** the
independent `LOCAL_STOCK_V4_WRITE_GATE=operator-released`, explicit
SQLite v4 version and v4 marker are present. This is **display guidance**:
the Local service independently revalidates live principal, session
CSRF, store, original receipt, historical quantities and stock budget
inside the atomic command transaction. The endpoint does not touch a
business record or change any Gate.

The Local UI never treats the general purchase-order listing (limited to
500 recent rows) as a complete receipt source. Instead the authenticated
`GET /api/stock/v4-receipts` searches **all received orders** for the
selected active store/ingredient and an optional literal PO-number
substring. Server-side role/store checks happen before returning at most
50 rows, with `truncated=true` prompting more specific search. This
keeps legitimate older receipts available without exposing cross-store
purchases. No automatic stock movement is made by a lookup.

The Local stock page always retains the existing stock.usage button.
New controls are absent until a live capability response is true; any
API failure fails closed. Stale responses after page navigation, logout,
or a different login are ignored. Owner and Manager may use the new
controls; Staff cannot.

All new forms require a reason and accept quantities on the 0.001 grid;
the old recipe-quantity forms retain `step=any`. The browser generates
a cryptographic UUID for each confirmed submission and prevents
automatic retry or double submit. On ambiguous failure, it closes the
form and asks the operator to inspect the ledger rather than silently
resending a debit. Old password/login/usage behavior remains unchanged.

## Boundaries and remaining operator acceptance

- No DB v4 migration is executed or authorized; no Gate is enabled.
- The app remains bound to localhost, not a publicly accessible
  Local Node server.
- Tests use in-memory SQLite + fake HTTP sessions and VM-rendered forms,
  **not** real employee/owner data.
- Before any real Local Gate release: verify encrypted backup and
  independent restore, approve a staged disposable-clone v3→v4
  migration, verify audit and amount reconciliation, and conduct
  real Owner/Manager/Staff browser UAT.
- Cloudflare Production D1 schema/independent Gates and actual deploy
  require separate explicit permission; Vercel Demo is synthetic only.
