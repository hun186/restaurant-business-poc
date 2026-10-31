// First cloud owner bootstrap: manual / staging-only, never a public HTTP route.
// No password, session token or owner hash is printed to the GitHub Actions log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hashWorkerPassword } from '../cloudflare/auth-core.mjs';
import { verifyStagingConfig, rowsFromWranglerJson, ACCOUNT_ID, PROD_ID, STAGING_ID } from './check-cloudflare-staging.mjs';

export const INITIAL_EMPTY_TABLES = Object.freeze(["locations","users","user_locations","sessions","login_attempts","audit_logs","tasks","ingredients","stock_moves","purchase_orders","stocktakes","repairs","shifts","leave_requests","training_courses","training_records","evaluations","ingredient_prices","menu_dishes","dish_ingredients"]);
function fail(reason) { throw new Error('E_STAGING_OWNER: ' + reason); }
function oneRow(value) {
  const rows = rowsFromWranglerJson(value);
  if (rows.length !== 1) fail('unexpected remote D1 response');
  return rows[0];
}
function integerCount(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}
export function assertOwnerPreflight(data) {
  const x = oneRow(data);
  if (integerCount(x.contract_version) !== 3) fail('staging v3 schema not present');
  for (const field of INITIAL_EMPTY_TABLES) {
    if (integerCount(x[field]) !== 0) fail('existing ' + field + ' rows; owner bootstrap refuses modified database');
  }
  return true;
}
export function assertOwnerVerified(data, fkData) {
  const x = oneRow(data);
  if (integerCount(x.users) !== 1 || integerCount(x.owners) !== 1 ||
      integerCount(x.sessions) !== 0 || integerCount(x.contract_version) !== 3)
    fail('owner setup not verified');
  if (rowsFromWranglerJson(fkData).length !== 0) fail('staging foreign key violations');
  return true;
}
export function verifyOwnerTarget(worker, migration, accountId) {
  verifyStagingConfig(worker, migration);
  if (accountId !== ACCOUNT_ID || STAGING_ID === PROD_ID) fail('unexpected target account or overlapping staging/prod');
  return true;
}

export async function buildOwnerSql(password) {
  // Kept only in an ephemeral GH environment secret. The initial password is
  // NEVER created in a public Worker and NEVER logged to workflow output.
  if (typeof password !== 'string' || password.length < 12 ||
      password.length > 256 || /[\r\n\0]/.test(password))
    fail('STAGING_OWNER_PASSWORD must be 12 to 256 characters, without newlines');
  const record = await hashWorkerPassword(password);
  const id = randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-f0-9]{32}$/.test(record.password_salt) ||
      !/^pbkdf2-sha256\$100000\$[a-f0-9]{64}$/.test(record.password_hash))
    fail('invalid credential format');
  // Every interpolated value is generated internally and strictly validated.
  // Last guard is atomic with the insert to resist simultaneous invocations.
  return `INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active)
SELECT '${id}','owner','雲端測試業主','owner','${record.password_salt}','${record.password_hash}',1
WHERE (SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3
  AND NOT EXISTS (SELECT 1 FROM users);
`;
}
export function savePrivateSql(file, sql, tmpDir) {
  if (typeof tmpDir !== 'string' || !tmpDir || typeof file !== 'string' ||
      path.resolve(file) !== path.join(path.resolve(tmpDir), 'staging-owner-once.sql'))
    fail('temporary SQL destination is outside the dedicated runner temp path');
  fs.writeFileSync(file, sql, { flag: 'wx', mode: 0o600 });
  return true;
}
export function ownerPreflightQuery() {
  const fields = INITIAL_EMPTY_TABLES.map(table =>
    '(SELECT COUNT(*) FROM ' + table + ') AS ' + table);
  return 'SELECT (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version, ' +
    fields.join(', ') + ';';
}
export function ownerVerifyQuery() {
  return `SELECT
  (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM users WHERE role='owner' AND username='owner' AND active=1) AS owners,
  (SELECT COUNT(*) FROM sessions) AS sessions;`;
}

async function main(args) {
  const [mode, ...rest] = args;
  const worker = JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  const migration = JSON.parse(fs.readFileSync('wrangler.preview-migrations.jsonc','utf8'));
  verifyOwnerTarget(worker, migration, process.env.CLOUDFLARE_ACCOUNT_ID);
  if (mode === 'query-preflight' && rest.length === 0) {
    process.stdout.write(ownerPreflightQuery() + '\n');
    return;
  }
  if (mode === 'preflight' && rest.length === 1) {
    assertOwnerPreflight(JSON.parse(fs.readFileSync(rest[0], 'utf8')));
  } else if (mode === 'write-sql' && rest.length === 1) {
    const password = process.env.STAGING_OWNER_PASSWORD;
    const sql = await buildOwnerSql(password);
    savePrivateSql(rest[0], sql, process.env.RUNNER_TEMP);
  } else if (mode === 'verify' && rest.length === 2) {
    assertOwnerVerified(...rest.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))));
  } else fail('invalid subcommand');
  process.stdout.write('STAGING_OWNER_' + mode.toUpperCase().replace('-', '_') + '_PASS\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    // Only fail-closed category; secrets must not appear in an exception trace.
    process.stderr.write('E_STAGING_OWNER: staging setup refused; check preflight/target/secret availability\n');
    process.exitCode = 1;
  });
}
