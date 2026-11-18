# Issue #212 — proposed D1-shaped supplier return batch (not deployed)

**Scope: synthetic only.** Source: src/stock-v4-d1-synthetic-return-batch.mjs.
Builds a two-statement parameterized SQL plan, without any DB connection,
network, key, Worker import or execution function. The Cloudflare Worker,
Local API, Vercel Demo, active v3 migrations and release flags are unchanged.
This is NOT production functionality and gives no permission to run it on
production, staging or an existing scratch D1.

## Transaction model — independent remote validation still needed

A future Worker would need to supply a verified principal, CSRF and
session hash and execute both prepared statements in ONE atomic D1 batch.
Each statement must affect exactly one row.

1. Movement: a fixed parameterized INSERT SELECT always emits one row.
   Its qty_delta is the requested negative quantity only when an in-SQL
   EXISTS verifies an active Owner/Manager with live session and CSRF,
   permitted store, active ingredient, received PO, exactly one matching
   purchase ledger movement, consistent prior returns and 0.001-grid stock
   budget. Otherwise qty_delta=0 violates the v4 CHECK and aborts the batch.
   Duplicate UUIDs violate the primary key.
2. Audit: append one corresponding stock.supplier_return log linked to the
   movement ID in the SAME batch. Audit failure must roll back the debit.

Reject inconsistent return scopes, non-grid history, excessive ledger row
counts and absent v4 kind marker. Never update original POs, old ledger,
on-hand caches, prices, supplier credits or valuation rows.

Synthetic tests use disposable in-memory SQLite created with the D1 v3
schema + INACTIVE v4 proposal, with fake Owner/Manager sessions, store,
ingredient, PO and ledger. They cover successful append, duplicate request,
late stock debit, audit fault rollback, invalid PO/receipt, cross-store
history, expired session, wrong CSRF, disabled actor and missing v4 marker.

## Critical release boundaries

- No remote Cloudflare D1 transaction was executed; local SQLite
  transactions cannot attest actual remote D1 isolation or rollback.
- No production route is wired. A future HTTP implementation MUST verify
  same-origin HTTPS, Cookie Session, CSRF and role/store admission before
  constructing this plan. SQL checks are defense in depth only.
- An ambiguous D1 error must be reconciled by request ID, never blindly
  retried.
- Live release separately needs owner-authorized migrations, backup and
  recovery, Scratch D1 atomicity UAT, formal review, explicit gate approval,
  real business UAT and platform parity. None are performed here.

The module name includes synthetic deliberately to avoid implying release.
