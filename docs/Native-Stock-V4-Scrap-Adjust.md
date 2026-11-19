# Native D1 stock v4 scrap and adjustment (default OFF)

Issue #212 — first production-code integration, not production activation.

Routes and capability:
- POST /api/stock/v4 accepts exactly stock.scrap or stock.adjust.
- Requires Native login, Owner/Manager, same Origin + CSRF + store scope, a unique
  X-Idempotency-Key UUID, and CLOUD_NATIVE_STOCK_V4_WRITE_GATE=operator-released.
- Gate defaults OFF. No wrangler.jsonc/Secrets/Vars are changed in this PR.
- Also requires cloud_schema_contract v3 plus stock_move_kind_contract v4.
  This second contract has NOT been migrated to the live D1 database.
- Every batch rechecks live actor/session/scope, active store and ingredient,
  idempotency, ledger precision and bounded nonnegative stock; only append
  stock_moves and audit_logs in one transaction with a rollback sentinel.
- No updates or deletes to old stock movements, and no unsafe retry on a
  transport error with an uncertain commit result.
- The existing stock.usage API is unchanged and independently gated.
- Supplier returns still need separate original-receipt/return-budget integration
  and read-back reconciliation; this route deliberately rejects that action.

Release HOLD: do not enable this Gate or migrate a live D1 without separately
approved backup/restore plan, v4 migration validation on Scratch D1, current
Worker/version attestation, Owner/Manager/Staff real-device UAT and roll-back
signoff. Synthetic CI passing does NOT count as Production D1 UAT.
