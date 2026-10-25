// Strict guard for existing staging D1 v3 -> 0002 index-only migration.
// Read-only verification only. Never modify D1 from this module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyStagingConfig, rowsFromWranglerJson, ACCOUNT_ID,
} from './check-cloudflare-staging.mjs';

const MIGRATIONS_DIR = 'cloudflare/migrations';
const INITIAL = '0001_initial_v3.sql';
const INCREMENTAL = '0002_login_attempts_window_indexes.sql';
const INDEXES = Object.freeze([
  ['idx_login_attempts_at', /\bON\s+login_attempts\s*\(\s*at\s*,\s*id\s*\)/i],
  ['idx_login_attempts_ip_hash_at', /\bON\s+login_attempts\s*\(\s*ip_hash\s*,\s*at\s*\)/i],
  ['idx_login_attempts_username_nocase_at', /\bON\s+login_attempts\s*\(\s*username\s+COLLATE\s+NOCASE\s*,\s*at\s*\)/i],
]);
const FILES = ['ledger','indexes','owners','contract','fk','tables'];
const fail = reason => { throw new Error('E_STAGING_0002: ' + reason); };

export function verifyLocal0002(worker, staging, accountId, dir = MIGRATIONS_DIR) {
  verifyStagingConfig(worker, staging);
  if (accountId !== ACCOUNT_ID) fail('unexpected Cloudflare account');
  const actual = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
  if (JSON.stringify(actual) !== JSON.stringify([INITIAL, INCREMENTAL])) fail('unexpected local migration files');
  const sql = fs.readFileSync(path.join(dir, INCREMENTAL), 'utf8');
  const active = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  const statements = active.split(';').map(x => x.trim()).filter(Boolean);
  if (statements.length !== 3 || !statements.every(s => /^CREATE\s+INDEX\s+/i.test(s)))
    fail('0002 must contain exactly three additive indexes');
  for (const [name, pattern] of INDEXES) {
    const matching = statements.filter(s => s.includes(name) && pattern.test(s));
    if (matching.length !== 1) fail('0002 index DDL mismatch: ' + name);
  }
  return true;
}

function namedRows(json, field, label) {
  const rows = rowsFromWranglerJson(json);
  for (const row of rows) if (!row || typeof row[field] !== 'string') fail('invalid ' + label);
  return rows;
}
export function snapshot(json) {
  const ledger = namedRows(json.ledger, 'name', 'migration ledger').map(x => x.name);
  const indexes = namedRows(json.indexes, 'name', 'index rows');
  const owners = namedRows(json.owners, 'id', 'owner rows');
  const contract = rowsFromWranglerJson(json.contract);
  const fk = rowsFromWranglerJson(json.fk);
  const tables = namedRows(json.tables,'name','schema tables').map(x => x.name);
  if (contract.length !== 1 || contract[0].contract_version !== 3) fail('expected v3 contract');
  if (fk.length) fail('foreign-key violations');
  const expected = [...fs.readFileSync(path.join(MIGRATIONS_DIR,INITIAL),'utf8')
    .matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(x=>x[1]);
  expected.push('d1_migrations');
  expected.sort();
  if (expected.length !== 23 || new Set(expected).size !== 23 ||
      JSON.stringify(tables) !== JSON.stringify(expected))
    fail('unexpected existing D1 schema inventory');
  // The owner bootstrap was successful; do not run this migration on a fresh
  // database, or on an environment with extra users.
  if (owners.length !== 1 || owners[0].username !== 'owner' ||
      owners[0].role !== 'owner' || Number(owners[0].active) !== 1 ||
      typeof owners[0].id !== 'string' || owners[0].id.length < 16)
    fail('exactly one existing active staging owner required');
  if (new Set(ledger).size !== ledger.length) fail('duplicate migration ledger records');
  if (new Set(indexes.map(x=>x.name)).size !== indexes.length) fail('duplicate index metadata');
  return { ledger, indexes, owners, tables };
}
function indexMatches(row, name, pattern) {
  return row.name === name && typeof row.sql === 'string' && pattern.test(row.sql);
}
export function assert0002Preflight(data) {
  const state = snapshot(data);
  if (JSON.stringify(state.ledger) !== JSON.stringify([INITIAL])) fail('staging ledger must contain exactly 0001');
  if (state.indexes.length !== 0) fail('0002 indexes already or partially exist');
  return state;
}
export function assert0002Postflight(beforeData, afterData) {
  const before = assert0002Preflight(beforeData), after = snapshot(afterData);
  if (JSON.stringify(after.ledger) !== JSON.stringify([INITIAL,INCREMENTAL]))
    fail('0002 was not recorded as applied or unexpected migration ledger state');
  if (after.indexes.length !== INDEXES.length ||
      !INDEXES.every(([name,pattern]) => after.indexes.some(row => indexMatches(row,name,pattern))))
    fail('0002 index definitions do not match');
  if (JSON.stringify(before.owners) !== JSON.stringify(after.owners) ||
      JSON.stringify(before.tables) !== JSON.stringify(after.tables))
    fail('owner or schema inventory changed during migration');
  return true;
}

function loadDir(dir) {
  if (typeof dir !== 'string' || !dir) fail('missing result directory');
  return Object.fromEntries(FILES.map(n => [n, JSON.parse(fs.readFileSync(path.join(dir,n+'.json'),'utf8'))]));
}
function cli(args) {
  const [mode,...dirs] = args;
  const worker=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  const stage=JSON.parse(fs.readFileSync('wrangler.preview-migrations.jsonc','utf8'));
  verifyLocal0002(worker,stage,process.env.CLOUDFLARE_ACCOUNT_ID);
  if (mode==='preflight' && dirs.length===1) {
    assert0002Preflight(loadDir(dirs[0]));
  } else if (mode==='postflight' && dirs.length===2) {
    assert0002Postflight(loadDir(dirs[0]), loadDir(dirs[1]));
  } else if (mode !== 'config' || dirs.length !== 0) fail('invalid command');
  process.stdout.write('STAGING_0002_'+mode.toUpperCase()+'_PASS\n');
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); }
  catch (error) {
    // Never print remote snapshots or secret material.
    process.stderr.write('E_STAGING_0002: staging migration verification failed; see local regression tests\n');
    process.exitCode=1;
  }
}
