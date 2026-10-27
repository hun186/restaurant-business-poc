'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname,'..');
const guardModule = import('../tools/cloudflare-staging-0002.mjs');
const initial = fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const incremental = fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
const worker = JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8'));
const ACCOUNT = '31b409b04896d260ba0fadf6cc2bb305';
const wrap = values => [{success:true,results:values}];
function fixture(){
  const db = new DatabaseSync(':memory:');
  db.exec(initial);
  db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(1,'0001_initial_v3.sql');
  db.prepare("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)")
    .run('test-owner-0000000000000001','owner','Staging Owner','owner','a'.repeat(32),'pbkdf2-sha256$600000$'+'b'.repeat(64));
  return db;
}
function view(db){
  const read=sql=>wrap(db.prepare(sql).all());
  return {
    ledger:read('SELECT name FROM d1_migrations ORDER BY name'),
    indexes:read("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name"),
    owners:read('SELECT id,username,role,active FROM users ORDER BY id'),
    contract:read('SELECT contract_version FROM cloud_schema_contract WHERE id=1'),
    fk:read('PRAGMA foreign_key_check'),
    tables:read("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"),
  };
}
test('strict versioned 0002 migration file list and Cloudflare database binding guards',async()=>{
  const g=await guardModule;
  assert.equal(g.verifyLocal0002(worker,config,ACCOUNT,path.join(root,'cloudflare/migrations')),true);
  assert.throws(()=>g.verifyLocal0002(worker,config,'another-account',path.join(root,'cloudflare/migrations')),/E_STAGING_0002/);
  const swapped=structuredClone(config);
  swapped.d1_databases[0].database_id=worker.d1_databases[0].database_id;
  assert.throws(()=>g.verifyLocal0002(worker,swapped,ACCOUNT,path.join(root,'cloudflare/migrations')),/E_D1_STAGING/);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'staging-0002-guard-'));
  try {
    fs.writeFileSync(path.join(temp,'0001_initial_v3.sql'),initial);
    fs.writeFileSync(path.join(temp,'0002_login_attempts_window_indexes.sql'),incremental);
    fs.writeFileSync(path.join(temp,'0003_unreviewed.sql'),'SELECT 1;');
    assert.throws(()=>g.verifyLocal0002(worker,config,ACCOUNT,temp),/unexpected local migration files/);
    fs.rmSync(path.join(temp,'0003_unreviewed.sql'));
    fs.writeFileSync(path.join(temp,'0002_login_attempts_window_indexes.sql'),'DROP TABLE users;');
    assert.throws(()=>g.verifyLocal0002(worker,config,ACCOUNT,temp),/exactly three additive indexes/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('preflight accepts only v3 with active owner, ledger 0001 and zero new indexes',async()=>{
  const g=await guardModule,db=fixture();
  try {
    const before=view(db);
    assert.deepEqual(g.assert0002Preflight(before).ledger,['0001_initial_v3.sql']);
    const corrupt=structuredClone(before);
    corrupt.ledger[0].results.push({name:'0002_login_attempts_window_indexes.sql'});
    assert.throws(()=>g.assert0002Preflight(corrupt),/exactly 0001/);
    const noOwner=structuredClone(before);
    noOwner.owners[0].results=[];
    assert.throws(()=>g.assert0002Preflight(noOwner),/exactly one existing active/);
    const inactive=structuredClone(before);
    inactive.owners[0].results[0].active=0;
    assert.throws(()=>g.assert0002Preflight(inactive),/exactly one existing active/);
    const badContract=structuredClone(before);
    badContract.contract[0].results[0].contract_version=2;
    assert.throws(()=>g.assert0002Preflight(badContract),/expected v3/);
    const badFk=structuredClone(before);
    badFk.fk[0].results=[{table:'users',rowid:1,parent:'locations'}];
    assert.throws(()=>g.assert0002Preflight(badFk),/foreign-key/);
    const missingTable=structuredClone(before);
    missingTable.tables[0].results=missingTable.tables[0].results.filter(r=>r.name!=='sessions');
    assert.throws(()=>g.assert0002Preflight(missingTable),/schema inventory/);
    const altered=structuredClone(before);
    altered.indexes[0].results=[{name:'idx_login_attempts_at',sql:'CREATE INDEX idx_login_attempts_at ON login_attempts(at)'}];
    assert.throws(()=>g.assert0002Preflight(altered),/already or partially exist/);
  }finally{db.close();}
});
test('postflight validates 0002 ledger, three exact indexes and owner preservation',async()=>{
  const g=await guardModule,db=fixture();
  try {
    const before=view(db);
    db.exec(incremental);
    db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(2,'0002_login_attempts_window_indexes.sql');
    const after=view(db);
    assert.equal(g.assert0002Postflight(before,after),true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const missingLedger=structuredClone(after);
    missingLedger.ledger[0].results.pop();
    assert.throws(()=>g.assert0002Postflight(before,missingLedger),/not recorded/);
    const renamedIndex=structuredClone(after);
    renamedIndex.indexes[0].results[0].sql='CREATE INDEX idx_login_attempts_at ON login_attempts(at)';
    assert.throws(()=>g.assert0002Postflight(before,renamedIndex),/definitions do not match/);
    const changedOwner=structuredClone(after);
    changedOwner.owners[0].results[0].active=0;
    assert.throws(()=>g.assert0002Postflight(before,changedOwner),/exactly one existing active/);
    const changedOwnerId=structuredClone(after);
    changedOwnerId.owners[0].results[0].id='new-owner-0000000000000000000';
    assert.throws(()=>g.assert0002Postflight(before,changedOwnerId),/owner or schema inventory changed/);
    assert.throws(()=>g.assert0002Preflight(after),/exactly 0001/);
  }finally{db.close();}
});
test('manual workflow permits read-only check or explicitly-approved staging 0002 only',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-incremental-0002.yml'),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/type: choice/);
  assert.match(workflow,/default: CHECK_STAGING_0002/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/environment: d1-staging/);
  assert.match(workflow,/group: restaurant-business-d1-staging-migrations/);
  assert.match(workflow,/inputs\.action == 'APPLY_STAGING_0002' && inputs\.confirm == 'APPLY_STAGING_0002'/);
  assert.match(workflow,/inputs\.action == 'CHECK_STAGING_0002' && inputs\.confirm == 'CHECK_STAGING_0002'/);
  assert.match(workflow,/d1 migrations apply STAGING_DB --remote --config wrangler\.preview-migrations\.jsonc/);
  assert.doesNotMatch(workflow,/d1 migrations apply DB\b|wrangler d1 execute DB\b|push:\s|pull_request:\s|set -x|STAGING_OWNER_PASSWORD/);
  assert.match(workflow,/node tools\/cloudflare-staging-0002\.mjs preflight/);
  assert.match(workflow,/node tools\/cloudflare-staging-0002\.mjs postflight/);
  const install=workflow.slice(workflow.indexOf('- name: Install fixed Wrangler'),workflow.indexOf('- name: Read-only preflight'));
  assert.doesNotMatch(install,/secrets\.|CLOUDFLARE_API_TOKEN/);
  const topEnv=workflow.slice(workflow.indexOf('    env:'),workflow.indexOf('    steps:'));
  assert.doesNotMatch(topEnv,/secrets\.|CLOUDFLARE_API_TOKEN/);
  assert.match(workflow,/wrangler@4\.152\.0/);
  const existing=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-migration.yml'),'utf8');
  assert.match(existing,/Read-only check target staging D1 is empty/);
});
