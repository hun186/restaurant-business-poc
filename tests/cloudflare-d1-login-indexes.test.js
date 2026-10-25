'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const migrationV1 = fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const migrationV2 = fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
const service = import('../cloudflare/login-service.mjs');

function dbWithMigrations(){
  const db = new DatabaseSync(':memory:');
  db.exec(migrationV1);
  db.exec(migrationV2);
  return db;
}
const adaptedDb = db => ({
  prepare(sql){
    return {bind(...args){return {
      run: async()=>({meta:db.prepare(sql).run(...args)}),
      first:async()=>db.prepare(sql).get(...args)
    };}};
  },
  batch:async()=>{throw Error('no batch expected')}
});

test('0002 is additive, preserves v3 baseline and Owner data, and creates matching indexes',()=>{
  const db = new DatabaseSync(':memory:');
  try{
    db.exec(migrationV1);
    db.prepare("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)")
      .run('owner-1','owner','Test Owner','owner','00'.repeat(16),'fake-hash');
    const snapshot = db.prepare('SELECT id,username,password_hash FROM users').get();
    db.exec(migrationV2);
    assert.deepEqual(db.prepare('SELECT id,username,password_hash FROM users').get(),snapshot);
    assert.equal(db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get().contract_version,3);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,0);
    const indexes=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name").all().map(x=>x.name);
    assert.deepEqual(indexes,['idx_login_attempts_at','idx_login_attempts_ip_hash_at','idx_login_attempts_username_nocase_at']);
  }finally{db.close();}
});

test('reservation query plan uses index seeks for NOCASE username and ip hash window',async()=>{
  const { LOGIN_RESERVATION_SQL } = await service;
  const db=dbWithMigrations();
  try{
    // Require actual service SQL, not a copy of the predicate.
    const args=['test-id','OWNER','1'.repeat(64),'OWNER',8,'1'.repeat(64),32];
    const explain=db.prepare('EXPLAIN QUERY PLAN '+LOGIN_RESERVATION_SQL).all(...args).map(x=>x.detail);
    assert.ok(explain.some(x=>x.includes('SEARCH login_attempts USING COVERING INDEX idx_login_attempts_username_nocase_at') &&
                                 x.includes('username=?') && x.includes('at>?')),JSON.stringify(explain));
    assert.ok(explain.some(x=>x.includes('SEARCH login_attempts USING COVERING INDEX idx_login_attempts_ip_hash_at') &&
                                 x.includes('ip_hash=?') && x.includes('at>?')),JSON.stringify(explain));
    assert.ok(!explain.some(x=>/^SCAN login_attempts\b/.test(x)),JSON.stringify(explain));

    // Thousands of stale rows do not count against a fresh quota.
    const insert=db.prepare('INSERT INTO login_attempts(id,username,ip_hash,success,at) VALUES(?,?,?,0,datetime(\'now\',\'-9 days\'))');
    for(let i=0;i<1500;i++) insert.run('stale-'+i, i%2 ? 'owner' : 'someone', '1'.repeat(64));
    const { reserveLoginAttempt }=await service;
    assert.match(await reserveLoginAttempt(adaptedDb(db),'OWNER','1'.repeat(64)),/^[0-9a-f-]{36}$/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,1501);
  }finally{db.close();}
});

test('bounded cleanup uses time index and deletes only rows older than 7 days, without changing audit',async()=>{
  const {LOGIN_CLEANUP_SQL,pruneExpiredLoginAttempts,LOGIN_ATTEMPTS_RETENTION_DAYS,LOGIN_CLEANUP_BATCH_SIZE}=await service;
  const db=dbWithMigrations();
  try{
    assert.equal(LOGIN_ATTEMPTS_RETENTION_DAYS,7);
    assert.equal(LOGIN_CLEANUP_BATCH_SIZE,500);
    const plan=db.prepare('EXPLAIN QUERY PLAN '+LOGIN_CLEANUP_SQL).all(2).map(x=>x.detail);
    assert.ok(plan.some(x=>x.includes('SEARCH login_attempts USING COVERING INDEX idx_login_attempts_at') && x.includes('at<?')),JSON.stringify(plan));
    db.exec(`
      INSERT INTO login_attempts(id,username,ip_hash,success,at) VALUES
       ('old-1','OWNER','hash',0,datetime('now','-9 days')),
       ('old-2','OWNER','hash',0,datetime('now','-8 days')),
       ('old-3','OWNER','hash',0,datetime('now','-8 days')),
       ('recent-1','OWNER','hash',0,datetime('now','-10 minutes')),
       ('recent-2','OWNER','hash',0,datetime('now','-6 days'));
      INSERT INTO audit_logs(id,actor_name,action,entity,detail) VALUES('audit-1','Owner','auth.login_failed','sessions','{}');`);
    assert.equal(await pruneExpiredLoginAttempts(adaptedDb(db),2),2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE at<datetime('now','-7 days')").get().n,1);
    assert.equal(await pruneExpiredLoginAttempts(adaptedDb(db),2),1);
    assert.equal(await pruneExpiredLoginAttempts(adaptedDb(db),2),0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,1);
    await assert.rejects(()=>pruneExpiredLoginAttempts(adaptedDb(db),0),/E_AUTH_CLEANUP_BATCH/);
    await assert.rejects(()=>pruneExpiredLoginAttempts(adaptedDb(db),501),/E_AUTH_CLEANUP_BATCH/);
  }finally{db.close();}
});

test('0002 never redefines initial schema nor performs implicit remote migration',()=>{
  const executable=migrationV2.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(executable,/\b(?:DROP|DELETE|INSERT|UPDATE|ALTER)\b/i);
  assert.doesNotMatch(executable,/password_hash|password_salt|d1_migrations/i);
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-migration.yml'),'utf8');
  assert.match(workflow,/assertEmptyTarget|Read-only check target staging D1 is empty/);
  assert.ok(!workflow.includes('0002_login_attempts_window_indexes'));
});
