# Issue #212 — future D1 supplier return batch result validation

This is a PURE, SYNTHETIC-ONLY future D1 response-shape guard.
Source: src/stock-v4-d1-batch-result-guard.mjs; tests:
tests/stock-v4-d1-batch-result-guard.test.js.

A proposed supplier-return batch has two statements:
1. Append exactly one stock_moves supplier_return negative movement.
2. Append exactly one corresponding audit_logs record.

The validator accepts only an array of **exactly two statement results** and
requires each entry to report **exactly one changed row**, using D1-style
meta.changes or the test adapter's flat changes. If both fields are present,
both must equal 1. Explicit statement failure, error, partial/malformed
results, getter-based metadata and ambiguous counts are rejected.
This prevents interpreting an HTTP 200 or completed batch call alone
as proof that BOTH ledger and audit were appended.

The helper NEVER issues a DB command and has no connection, network,
session or configuration permissions. It does NOT prove a transaction was
durably committed; a remote timeout or transport ambiguity still requires
reconciliation using a unique request ID. Calling code MUST NOT
automatically retry an ambiguous supplier return.

The proposed module is not imported by any running Local HTTP API,
Cloudflare Worker or Vercel Demo. Both active schemas remain v3.
All formal deployment requirements, Scratch D1 live rollback UAT,
Owner approval and separate production Gate release remain outstanding.
