-- OFFLINE PROPOSAL ONLY: stock_moves v3 -> movement-kind extension.
-- NEVER copy into active migrations or execute against staging/production
-- without separately approved backup, readiness, deployment gate and rollback.
-- Execute atomically on an isolated database clone with foreign_keys=ON.
-- Existing id/quantity/type/reference/note/actor/timestamp must survive exactly.
-- No business data, Owner credentials or migration ledger are seeded.
CREATE TABLE stock_moves_v4 (
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 location_id TEXT NOT NULL REFERENCES locations(id),
 qty_delta REAL NOT NULL CHECK(qty_delta != 0),
 move_type TEXT NOT NULL CHECK(move_type IN ('purchase','usage','adjustment','supplier_return','scrap')),
 reference_id TEXT, note TEXT NOT NULL DEFAULT '', actor_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(move_type NOT IN ('supplier_return','scrap') OR
       (qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300)),
 CHECK(move_type != 'supplier_return' OR
       (reference_id IS NOT NULL AND length(trim(reference_id)) BETWEEN 1 AND 100))
);
INSERT INTO stock_moves_v4 (
 id,ingredient_id,location_id,qty_delta,move_type,
 reference_id,note,actor_id,created_at
)
SELECT id,ingredient_id,location_id,qty_delta,move_type,
       reference_id,note,actor_id,created_at
FROM stock_moves;
DROP TABLE stock_moves;
ALTER TABLE stock_moves_v4 RENAME TO stock_moves;
CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id);
