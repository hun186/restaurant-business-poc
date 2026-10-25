// Manually-triggered staging-only D1 schema guard. No API keys are logged.
// Fail closed on unexpected/missing Wrangler --json shape or target identifiers.
import fs from 'node:fs';

export const PROD_ID = 'b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
export const STAGING_ID = '2c355bed-d9c3-449c-aa9b-1018f3bc1177';
export const ACCOUNT_ID = '31b409b04896d260ba0fadf6cc2bb305';

function fail(message) { throw new Error('E_D1_STAGING: ' + message); }
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
export function verifyStagingConfig(
  worker = readJson('wrangler.jsonc'),
  migration = readJson('wrangler.preview-migrations.jsonc')
) {
  const prod = worker.d1_databases;
  const preview = worker.previews?.d1_databases;
  const stage = migration.d1_databases;
  if (prod?.length !== 1 || prod[0].binding !== 'DB' ||
      prod[0].database_name !== 'restaurant-business-prod' || prod[0].database_id !== PROD_ID)
    fail('production binding not expected; refusing to proceed');
  if (preview?.length !== 1 || preview[0].binding !== 'DB' ||
      preview[0].database_name !== 'restaurant-business-staging' ||
      preview[0].database_id !== STAGING_ID)
    fail('Preview binding not expected; refusing to proceed');
  if (stage?.length !== 1 || stage[0].binding !== 'STAGING_DB' ||
      stage[0].database_name !== 'restaurant-business-staging' ||
      stage[0].database_id !== STAGING_ID ||
      stage[0].migrations_dir !== 'cloudflare/migrations' ||
      STAGING_ID === PROD_ID)
    fail('migration target must be staging only');
  return true;
}

export function rowsFromWranglerJson(data) {
  const objects = Array.isArray(data) ? data : data?.result;
  if (!Array.isArray(objects) || objects.length !== 1 || !Array.isArray(objects[0]?.results) ||
      objects[0]?.success === false) fail('unexpected Wrangler JSON output');
  return objects[0].results;
}
export function assertEmptyTarget(data) {
  const rows = rowsFromWranglerJson(data);
  // "d1_migrations" is intentionally *not* ignored: never reinitialize a used DB.
  if (rows.length !== 0) fail('staging D1 already contains tables; do not run initial migration');
}
export function assertInstalledSchema(tablesData, contractData, fkData, ownerData) {
  const expected = fs.readFileSync('cloudflare/migrations/0001_initial_v3.sql','utf8')
    .matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g);
  const names = new Set([...expected].map(x => x[1]));
  if (names.size !== 22) fail('unexpected local migration contract');
  const actual = new Set(rowsFromWranglerJson(tablesData).map(x => x.name));
  // D1 adds d1_migrations after running its migration.
  if (!actual.has('d1_migrations')) fail('Wrangler migration ledger not found');
  for (const name of names) if (!actual.has(name)) fail('missing migrated table: ' + name);
  if (actual.size !== names.size + 1) fail('unexpected tables in staging schema');
  const contract = rowsFromWranglerJson(contractData);
  if (contract.length !== 1 || Number(contract[0].contract_version) !== 3)
    fail('cloud schema contract mismatch');
  if (rowsFromWranglerJson(fkData).length) fail('foreign key violations');
  const owner = rowsFromWranglerJson(ownerData);
  if (owner.length !== 1 || Number(owner[0].count) !== 0)
    fail('migration unexpectedly created users');
  return true;
}

// Command line used by the GitHub workflow. All queries are read-only.
const mode = process.argv[2];
if (mode) {
  try {
    if (mode === 'config') {
      verifyStagingConfig();
    } else if (mode === 'preflight' && process.argv.length === 4) {
      verifyStagingConfig();
      assertEmptyTarget(readJson(process.argv[3]));
    } else if (mode === 'verify' && process.argv.length === 7) {
      verifyStagingConfig();
      assertInstalledSchema(...process.argv.slice(3).map(readJson));
    } else {
      fail('unknown command');
    }
    process.stdout.write('STAGING_ONLY_' + mode.toUpperCase() + '_PASS\n');
  } catch (error) {
    process.stderr.write(String(error.message) + '\n');
    process.exitCode = 1;
  }
}
