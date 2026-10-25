// A read-only D1 schema probe. It never bootstraps users or executes writes.
// Schema availability is NOT proof that the authentication/operations API exists.
const requiredTables = Object.freeze([
  'users', 'locations', 'user_locations', 'sessions', 'audit_logs',
  'stock_moves', 'purchase_orders', 'stocktakes', 'ingredient_prices',
  'menu_dishes', 'dish_ingredients', 'backup_settings'
]);

export async function inspectD1Contract(db) {
  if (!db || typeof db.prepare !== 'function') return 'not_configured';
  try {
    const marker = await db.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id = 1'
    ).first();
    if (Number(marker?.contract_version) !== 3) return 'schema_incompatible';

    const objects = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    const names = new Set((objects?.results || []).map(row => row.name));
    if (!requiredTables.every(name => names.has(name))) return 'schema_incompatible';

    // Deliberately no owner/admin availability query or user-data reads.
    return 'schema_only';
  } catch {
    // Do not expose table names, SQL errors, or internal details publicly.
    return 'schema_uninitialized';
  }
}
