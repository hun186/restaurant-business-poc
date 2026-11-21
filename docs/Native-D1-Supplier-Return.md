# Native supplier return (default-OFF)

Issue #212 — staged code, **not a production release**.

- POST /api/stock/return accepts exactly action=stock.supplier_return, with
  data={ingredient_id,location_id,reference_id,qty,reason}.
- Requires a unique request UUID in X-Idempotency-Key, same-origin Session and
  CSRF, active Owner/Manager with authorized location, correct received PO, an
  active ingredient and location, v4 stock move schema marker, and exactly
  the three reviewed D1 migration receipts (0001 / 0002 / 0004) in order.
  Direct API calls with missing/forged/extra receipts fail closed even when the
  public Gate and marker are ON; receipt validity is rechecked inside D1 batch.
- \`CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE=operator-released\` is a distinct
  default-OFF switch. No config or remote secret is changed by the PR.
- Within ONE D1 db.batch transaction, the reviewed SQL rechecks active
  session/role/store, exact received PO ledger, all prior supplier returns,
  available stock and historical precision. Any mismatch fails v4
  nonzero-quantity CHECK and rolls back. A final NOT NULL sentinel requires
  both ledger and audit records. No old movement or original PO is overwritten.
- Unknown response/transport errors receive E_STOCK_RETURN_UNCERTAIN_NO_RETRY,
  never a claim that the return was absent or safe to replay.

The reviewed D1-shaped SQL from #224 is reused as literal SQL, **not** imported
from a synthetic-only runtime module. Synthetic Worker/SQLite tests do not
prove Cloudflare remote batch behavior or durability.

Before Gate activation: separately approve disposable Scratch D1 migration,
verify pre/post migration row inventory, complete current production encrypted
backup copy verification and rollback procedure, test Owner/Manager/Staff
real-browser transaction and failure cases, attest live version, and obtain
explicit approval of Production D1 v4 migration and Gate release. Supplier
return UI and Local/Vercel parity are separate tasks. Never deploy or migrate
automatically on PR merge.
