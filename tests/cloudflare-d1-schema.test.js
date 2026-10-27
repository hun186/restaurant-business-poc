'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'cloudflare/migrations/0001_initial_v3.sql'), 'utf8'
);
const load = sql => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(sql);
  return db;
};
const snapshot = db => db.prepare(
  "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
).all();
const compact = sql => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, '').replace(/\s+/g, ' ').trim();
const d1Binding = db => ({
  prepare(sql) {
    return {
      first: async () => db.prepare(sql).get(),
      all: async () => ({ results: db.prepare(sql).all() })
    };
  }
});

test('D1 bootstrap has same SQLite v3 tables, columns, foreign keys and indexes', () => {
  const legacy = load(source);
  const d1 = load(migration);
  try {
    const expected = snapshot(legacy);
    const actual = snapshot(d1).filter(x => x.name !== 'cloud_schema_contract');
    assert.deepEqual(actual.map(x => [x.type, x.name, compact(x.sql)]),
      expected.map(x => [x.type, x.name, compact(x.sql)]));
    // D1 uses the Wrangler migration ledger and an explicit application contract,
    // not PRAGMA user_version (reserved to the existing local Node SQLite runtime).
    assert.equal(d1.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(d1.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get().contract_version, 3);
    assert.equal(d1.prepare('SELECT interval_days FROM backup_settings WHERE id=1').get().interval_days, 1);
  } finally { legacy.close(); d1.close(); }
});

test('D1 migration does not seed users, tokens or business data', () => {
  const db = load(migration);
  try {
    for (const table of ['users', 'locations', 'sessions', 'audit_logs', 'stock_moves', 'purchase_orders', 'ingredient_prices']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, 0, table);
    }
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:users|sessions|locations|stock_moves)\b/i);
    assert.throws(() => db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run('bad','bad'), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('initial migration fails closed on nonempty target or duplicate installation', () => {
  const db = load(migration);
  try { assert.throws(() => db.exec(migration), /already exists/); }
  finally { db.close(); }
  const partial = new DatabaseSync(':memory:');
  try {
    partial.exec('CREATE TABLE locations (id TEXT PRIMARY KEY)');
    assert.throws(() => partial.exec(migration), /already exists/);
    assert.equal(partial.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='users'").get().n, 0);
  } finally { partial.close(); }
});

test('D1 contract inspection distinguishes unbound, uninitialized and schema-only', async () => {
  const { inspectD1Contract } = await import('../cloudflare/d1-readiness.mjs');
  assert.equal(await inspectD1Contract(undefined), 'not_configured');
  const empty = new DatabaseSync(':memory:');
  try { assert.equal(await inspectD1Contract(d1Binding(empty)), 'schema_uninitialized'); }
  finally { empty.close(); }

  const db = load(migration);
  try {
    assert.equal(await inspectD1Contract(d1Binding(db)), 'schema_only');
    db.exec('DROP TABLE backup_settings');
    assert.equal(await inspectD1Contract(d1Binding(db)), 'schema_incompatible');
  } finally { db.close(); }
});

test('Cloudflare /api/health never claims ready, even when D1 schema exists', async () => {
  const worker = (await import('../cloudflare/worker.mjs')).default;
  const db = load(migration);
  const assets = { fetch: async () => new Response('demo') };
  try {
    const res = await worker.fetch(new Request('https://example.workers.dev/api/health'),
      { ASSETS: assets, DB: d1Binding(db) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      status: 'demo_only',
      api: 'not_implemented',
      database: 'schema_only',
      production_ready: false
    });
    const deny = await worker.fetch(new Request('https://example.workers.dev/api/command', {method:'POST'}),
      { ASSETS: assets, DB: d1Binding(db) });
    assert.equal(deny.status, 503);
  } finally { db.close(); }
});
