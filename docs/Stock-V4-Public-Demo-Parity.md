# Public Vercel Demo — stock v4 action parity (fake records only)

Issue #212: add **scrap, signed adjustment, supplier return** to the
public browser-only demonstrator. These follow the same user-facing
operations as the gated Native Owner interface.

- New `stock-v4-demo.js` implements pure, strict 0.001-quantity,
  no-zero/negative-stock, nonempty 300-character reason checks.
- A return needs a matching *received* purchase order, exactly one
  matching original purchase movement, bounded cumulative prior returns
  and sufficient available stock. The original PO/purchase are never
  overwritten; the fake browser snapshot appends a new movement plus
  demo audit and recalculates the displayed stock.
- Demo seed includes an **entirely fake** received purchase order and
  its existing purchase movement for a usable default example. New
  Demo order receipts include a reference_id in the created movement.
  Older sessionStorage examples may have no eligible receipt and can
  be reset using the existing Demo reset button.
- The public Demo displays three separate action buttons and modal
  fields: reason is required; quantity is 0.001 precision; supplier
  returns choose an existing received order. A mismatched order is
  always refused by the pure planner. Signed adjustment can increase
  or decrease inventory.

## Deliberate safety boundary

Vercel browser snapshots have synthetic short IDs (l1/i1/o3), unlike
real v4 UUIDs. The Demo-specific planner validates source relationships
but cannot replace the **Production** `normalizeStockV4` UUID/session/
CSRF/Gate checks or the Local/Cloudflare durable atomic SQL transaction.
The public Demo has no persistent server, password, genuine role-based
authorization or disaster recovery. It never contacts the Native D1 API.

Production D1 v4 migration and two independent write Gates remain
**OFF and unapplied**. Nothing here approves or performs Production
DB writes, a Cloudflare deploy, or changes to employee data. Local
SQLite durable v4 actions and real Owner UAT remain separate.
