# Issue #212 — supplier-return ambiguous result reconciliation (offline)

This is a **synthetic-only, read-only interpretation** of a proposed future D1
supplier return. Source: `src/stock-v4-d1-return-reconcile.mjs`; tests:
`tests/stock-v4-d1-return-reconcile.test.js`.

Given the validated original request and two independent, caller-supplied
row arrays for **exactly that request ID**, the helper checks the expected
movement ID, actor, store, ingredient, negative quantity, received PO reference,
reason, and the matching audit ID/action/JSON detail.

The possible statuses are:

- `SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT`: matching stock and audit were
  observed in the supplied snapshot. This is NOT proof of remote durability.
- `SYNTHETIC_RETURN_ABSENT_IN_SNAPSHOT_NO_RETRY`: neither row appeared.
  Delayed commits, inconsistent snapshots and replication still make automatic
  resubmission unsafe.
- `SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY`: partial, duplicate, or mismatched
  observations. Manual reconciliation required.
- Malformed input raises a generic validation error with no secret contents.

No outcome sets `safe_to_retry=true`. The helper does not query a DB, verify
a snapshot's provenance, invoke HTTP, execute SQL, or attempt any write.
The active Local, Vercel and Cloudflare runtimes do not import it. Production
D1 schema remains v3; the v4 migration remains an inactive proposal.

Future production use requires separately reviewed, scope-limited read-only
query implementation with a **consistent snapshot**, explicit idempotency
design, separate Owner-approved v4 migration and Gate, Scratch D1 concurrency /
rollback UAT, and real Owner business verification. None are authorized by this
PR. Never treat a successful HTTP response, test fixture or SQL plan as evidence
that an ambiguous remote transaction has durably committed.
