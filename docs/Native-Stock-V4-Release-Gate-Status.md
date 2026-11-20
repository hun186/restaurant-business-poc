# Native stock v4 release Gates — public read-only status hints

The existing `GET /api/native/status` reports `mode` and the original
task/catalog/order/stocktake/repair/price/stock-usage Gate booleans.
Issue #212 adds **two distinct, default-false status hints**:

- `stock_v4_gate_enabled`: Native login and the separate scrap/adjust
  `CLOUD_NATIVE_STOCK_V4_WRITE_GATE` are operator-released.
- `supplier_return_gate_enabled`: Native login and the separate
  `CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE` are operator-released.

Both values are only booleans, computed by existing reviewed Gate
functions; they never disclose variables, secrets, Owner identities,
credentials, database identifiers, or business records. No database
query or mutation is made by this status endpoint.

**Crucial distinction:** A status value of `true` verifies that the
relevant **environment Gate** is released; it **does not verify**
the live D1 database has a valid v4 stock-kind marker or that a specific
Owner/Manager can mutate a specific assigned store. The authenticated
`GET /api/stock/capability` and actual POST command perform the necessary
schema, Session/CSRF, stock and store-specific checks. Never infer
full live readiness or successful UAT from the public Gate status alone.

The default remains OFF. This code-only change never enables any Gate,
changes Cloudflare Vars/Secrets, deploys the Worker, or migrates D1.
The user/operator must separately authorize v4 migration and release,
complete encrypted backup+independent restore evidence and real UAT.
