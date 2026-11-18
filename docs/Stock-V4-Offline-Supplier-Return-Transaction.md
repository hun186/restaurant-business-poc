# Stock v4 supplier return — disposable atomic transaction rehearsal

**Issue #212. OFFLINE SYNTHETIC TEST ONLY.** This module does not add a
production route, enable any Cloudflare write Gate or alter live Local/D1
schemas. The proposed 0004 migration remains inactive.

The new async \`executeSyntheticSupplierReturn(db,request)\` is an export of
\`src/stock-v4-offline-scrap-adjust.cjs\`. It ONLY accepts memory databases
created by \`createSyntheticStockV4MemoryDb()\`, validated with the same
fail-closed provenance, schema, foreign-key and attachment checks as the
scrap/adjust test executor. The Local/Worker/Vercel runtime never imports it.

1. Validate the shared three-platform stock.supplier_return contract and
   strict UUID actor/request IDs.
2. Begin a serialized SQLite \`BEGIN IMMEDIATE\` transaction on the synthetic
   database; verify active Owner/Manager and granted store, active ingredient
   and store, and case-folded request ID uniqueness **inside** the transaction.
3. Await \`inspectSupplierReturnFacts\` on that same connection **inside the
   open transaction**. Verify the received PO matches the store/ingredient,
   exactly one matching purchase ledger row, all previous returns and
   available stock, with exact 0.001 quantities and no negative/over returns.
4. Append one supplier_return negative movement with the original PO's
   \`reference_id\`, followed by its matched audit row, and commit both.
   The purchase order and historical stock rows are never updated.
5. On any failure, roll back the transaction. Never retry a failed or duplicate
   request ID blindly; caller must reconcile its observed result.

Local-v3 and D1-v3-shaped synthetic database fixtures are populated with
fake shops, users, received purchase orders and ledger history, then migrated
with the inactive SQL proposal **inside temporary memory**. They test
return budgets, exact receipt references, role/store scope, inactive entities,
idempotent replays, simultaneous same-connection calls, atomic audit fault
rollback, malformed quantity/historical precision and untrusted database
rejection. Same-connection concurrency is not remote D1 concurrency; no real
Cloudflare REST/D1 atomicity is attested.

Release prerequisites remain: separate Owner approval, backed-up and
controlled v4 migrations, official session/CSRF and production role checks,
D1 batch/rollback behavior validated against a separate scratch D1, actual
business UAT, formal Codex Review and exact-HEAD CI. This PR performs NONE
of those live activities.
