-- Follow-on D1 migration. The v3 baseline (0001_initial_v3.sql) is already
-- installed on staging D1 with a valid Owner. NEVER re-run the initial schema.
-- This migration contains ONLY additive indexes; no data or passwords touched.
-- D1 d1_migrations ledger tracks the applied version; cloud_schema_contract
-- remains version 3 (the stable application table contract).
--
-- Matching SQLite collation is essential: reservation predicates contain
-- username=? COLLATE NOCASE and at>=datetime('now','-15 minutes').
CREATE INDEX idx_login_attempts_username_nocase_at
  ON login_attempts(username COLLATE NOCASE, at);
CREATE INDEX idx_login_attempts_ip_hash_at
  ON login_attempts(ip_hash, at);
-- Maintenance scans by time only, independent of username or source.
CREATE INDEX idx_login_attempts_at
  ON login_attempts(at);
