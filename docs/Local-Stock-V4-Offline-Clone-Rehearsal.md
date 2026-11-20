# Local SQLite v4 — isolated backup-clone migration rehearsal

This is the last **offline proof step**, not a live migration tool.
`tools/local-stock-v4-clone-rehearsal.js` accepts an existing **named,
offline** `restaurant-backup-YYYYMMDD-HHMMSS-xxxxxxxx-(auto|manual|migration).sqlite`
plus a separately recorded SHA-256.

For example, on a Windows terminal, from the project folder:

```powershell
node tools/local-stock-v4-clone-rehearsal.js --file "D:\\OfflineBackup\\restaurant-backup-YYYYMMDD-HHMMSS-xxxxxxxx-manual.sqlite" --sha256 "<the 64-character SHA-256 recorded independently>"
```

Replace the illustrative file path and digest with an actual **independently
verified backup**, never `data/restaurant.sqlite`. The command prints
only aggregate row counts and a pass/fail status, not passwords, users,
suppliers, or individual records.

## Isolation and actual work

1. Open the source as **raw bytes only**, using no-follow and immutable
   file identity checks; do **not** connect SQLite to that source.
2. Verify the independently recorded SHA-256. Make two access-protected,
   randomly named SQLite copies under the system temporary directory,
   without overwriting an existing file.
3. Independently verify the copied v3 full schema, SQLite integrity,
   business-data fingerprint and stock ledger preflight.
4. In a **single `BEGIN IMMEDIATE` transaction on the working copy**,
   apply the reviewed 0004 proposal; run the existing postflight that
   compares *all* historical tables/rows (not just counts). Only after
   that postflight succeeds, change `user_version` to 4 and verify the
   full strict v4 startup schema, ledger and business fingerprint.
5. Commit the **working copy only**, close it, reopen it read-only
   and independently verify the final v4 state and fingerprint.
   Delete both private copies at the end, including on error.

The tool has **no `--apply` option**, does not open the active data
folder, enable any write Gate, access a Cloudflare credential or
mutate Production D1. Every failure reports a sanitized code and
exits nonzero. Existing backup files never receive SQLite WAL/SHM
sidecars, permission changes or SQL operations.

The synthetic tests include true history preservation, independent
hash mismatch, unsafe file type/links, old-schema drift, unwanted
trigger, missing index, already-migrated and unsupported versions.
All fixtures are fabricated locally inside disposable directories.

## What this still does not authorize

A dry rehearsal PASS is **not** live data approval or restore
verification. Before a separate Local v3→v4 production migration:
obtain an encrypted operational backup, verify its independent copied
backup on another disk/host, confirm a usable restore, check no
concurrent Local writers, review the clone result and approved
rollback, then seek an explicit operator release. Cloudflare D1 needs
its own database-specific migration and restore/rollback validation;
this Local clone exercise does not establish remote D1 atomicity.
