# Native Owner — stock v4 operations (pending controlled release)

Issue #212. This change makes the Native Owner stock page capable of
displaying forms for **scrap, signed adjustment and received-PO supplier
return**, but only after authenticated server capability checks.

## UI and backend separation

- Read-only `GET /api/stock/capability` requires Native login, a valid
  session and Owner/Manager. It reports each independently enabled Gate
  **only if** the deployed D1 has the v3 business contract and v4 stock-kind
  marker. Staff and unavailable schema return both flags false.
- The stock page fetches this response after loading the authorized page;
  UI state is never a write permission. Every POST checks role, Session,
  CSRF, store, receipt/budget and schema again inside the D1 transaction.
- Forms load active stores and ingredients from Native D1 and show only
  **received** purchase orders matching the chosen store and ingredient.
  The native read endpoint may cap the loaded rows; a missing older PO
  is never replaced by free-text or by a fake purchase record.
- Signed adjustments choose increase/decrease separately, quantities
  use a 0.001 grid, and a nonblank reason is required for every action.
  The existing platform-neutral v4 validator rejects bad payloads before
  confirmation. No browser mock data and no browser storage.
- Each write has its own random idempotency UUID. On an unknown response
  the submit button stays disabled and explicitly directs the operator
  to inspect the stock ledger before any new attempt; never auto-retry.
- Existing stock.usage remains independent and the stock_moves/valuation
  pages remain read-only. Role and store enforcement belongs to the
  server, not to labels or hidden buttons.

## Release boundary

The real D1 v4 migration proposal has **not** been applied to Production,
both new v4 Gates remain OFF unless separately approved and configured.
This PR neither changes Cloudflare vars/Secrets nor operates a live
database. The completed CI is synthetic, not Production UI UAT.
Before enabling: fresh verified encrypted operational backup with copied
offline verification, reviewed Scratch D1 migration/postflight, current
Active Worker/version check, real Owner/Manager/Staff browser/UAT, and
explicit Operator approval for any migration and Gate change.
