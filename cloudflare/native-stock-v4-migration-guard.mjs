// Stock v4 release receipts: one source of truth for authenticated UI readiness
// and the atomic Native D1 stock movement predicates. Never runs migrations.
const EXPECTED=Object.freeze([
  '0001_initial_v3.sql',
  '0002_login_attempts_window_indexes.sql',
  '0004_stock_move_kinds.sql'
]);
export const STOCK_V4_MIGRATION_READ_SQL='SELECT id,name FROM d1_migrations ORDER BY id LIMIT 4';
export function stockV4MigrationReceiptsValid(rows){
 return Array.isArray(rows)&&rows.length===EXPECTED.length&&
  rows.every((row,i)=>row?.id===i+1&&row?.name===EXPECTED[i]);
}
export async function stockV4MigrationReady(db){
 try{
  const result=await db.prepare(STOCK_V4_MIGRATION_READ_SQL).all();
  return stockV4MigrationReceiptsValid(result?.results);
 }catch{return false;}
}
// Boundless, static SQL; evaluated INSIDE the same D1 batch as ledger/audit writes.
// Re-check protects against ledger changes between preflight and commit.
export const STOCK_V4_MIGRATION_BATCH_PREDICATE=[
 "(SELECT COUNT(*) FROM d1_migrations)=3",
 ...EXPECTED.map((name,i)=>
  "EXISTS(SELECT 1 FROM d1_migrations WHERE id="+(i+1)+
  " AND name='"+name+"')")
].join(' AND ');
