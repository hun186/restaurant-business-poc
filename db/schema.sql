PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS locations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_locations (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id, location_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS login_attempts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, ip_hash TEXT NOT NULL,
 success INTEGER NOT NULL CHECK(success IN (0,1)), at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup ON login_attempts(username, at);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT NOT NULL,
 action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, location_id TEXT,
 ip_hash TEXT, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_logs_at ON audit_logs(at DESC);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), title TEXT NOT NULL,
 due_date TEXT, status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
 assigned_to TEXT REFERENCES users(id), description TEXT NOT NULL DEFAULT '',
 created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ingredients (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, unit TEXT NOT NULL,
 min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock>=0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS stock_moves (
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 location_id TEXT NOT NULL REFERENCES locations(id), qty_delta REAL NOT NULL CHECK(qty_delta != 0),
 move_type TEXT NOT NULL CHECK(move_type IN ('purchase','usage','adjustment')),
 reference_id TEXT, note TEXT NOT NULL DEFAULT '', actor_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS stock_moves_stock ON stock_moves(ingredient_id,location_id);
CREATE TABLE IF NOT EXISTS purchase_orders (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
 location_id TEXT NOT NULL REFERENCES locations(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 supplier TEXT NOT NULL, qty REAL NOT NULL CHECK(qty>0),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','received','cancelled')),
 created_by TEXT NOT NULL REFERENCES users(id), approved_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, received_at TEXT
);
CREATE TABLE IF NOT EXISTS stocktakes (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 expected_qty REAL NOT NULL, counted_qty REAL NOT NULL CHECK(counted_qty>=0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
 created_by TEXT NOT NULL REFERENCES users(id), confirmed_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS repairs (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), equipment TEXT NOT NULL,
 description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reported'
 CHECK(status IN ('reported','assigned','closed')),
 assigned_to TEXT REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS shifts (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES locations(id), user_id TEXT NOT NULL REFERENCES users(id),
 shift_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(location_id,user_id,shift_date,start_time)
);
CREATE TABLE IF NOT EXISTS leave_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training_courses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 required_score INTEGER NOT NULL DEFAULT 80 CHECK(required_score BETWEEN 0 AND 100),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS training_records (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES training_courses(id),
 user_id TEXT NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id),
 score INTEGER CHECK(score BETWEEN 0 AND 100), completed_on TEXT,
 assessor_id TEXT REFERENCES users(id), UNIQUE(course_id,user_id,location_id)
);
CREATE TABLE IF NOT EXISTS evaluations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), location_id TEXT NOT NULL REFERENCES locations(id),
 period TEXT NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
 feedback TEXT NOT NULL DEFAULT '', reviewer_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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

PRAGMA user_version=2;
