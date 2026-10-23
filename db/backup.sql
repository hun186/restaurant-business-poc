-- Schema v2; migration from v1 must be verified before applying this addition.
CREATE TABLE backup_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 interval_days INTEGER NOT NULL DEFAULT 1 CHECK(interval_days BETWEEN 1 AND 365),
 retention_count INTEGER NOT NULL DEFAULT 50 CHECK(retention_count BETWEEN 1 AND 500),
 last_auto_at TEXT, last_auto_name TEXT, last_fingerprint TEXT,
 last_result TEXT CHECK(last_result IN ('created','skipped')),
 last_error TEXT
);
INSERT INTO backup_settings(id,interval_days,retention_count) VALUES(1,1,50);
