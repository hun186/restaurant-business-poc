'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const mod = import('../tools/cloudflare-staging-owner.mjs');
const ACCOUNT_ID='31b409b04896d260ba0fadf6cc2bb305';
const STAGING_ID='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const PROD_ID='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const wrap = rows => [{ success: true, results: rows }];
const clean = () => ({contract_version:3,users:0,sessions:0,login_attempts:0,audit_logs:0,locations:0,stock_moves:0,purchase_orders:0});

test('Only configured staging D1 accepted; wrong target/account rejected',async()=>{
  const m=await mod;
  const w=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  const stage=JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8'));
  assert.equal(m.verifyOwnerTarget(w,stage,ACCOUNT_ID),true);
  assert.notEqual(STAGING_ID,PROD_ID);
  assert.throws(()=>m.verifyOwnerTarget(w,stage,'other-account'),/E_STAGING_OWNER/);
  const swapped=structuredClone(stage);
  swapped.d1_databases[0].database_id=PROD_ID;
  assert.throws(()=>m.verifyOwnerTarget(w,swapped,ACCOUNT_ID),/E_D1_STAGING/);
});

test('Owner preflight rejects any nonempty user/session/audit or business table',async()=>{
  const m=await mod;
  assert.equal(m.assertOwnerPreflight(wrap([clean()])),true);
  for(const col of ['users','sessions','login_attempts','audit_logs','locations','stock_moves','purchase_orders']){
    assert.throws(()=>m.assertOwnerPreflight(wrap([{...clean(),[col]:1}])),/existing/);
  }
  assert.throws(()=>m.assertOwnerPreflight(wrap([{...clean(),contract_version:2}])),/schema/);
  assert.throws(()=>m.assertOwnerPreflight(wrap([])),/unexpected/);
  assert.throws(()=>m.assertOwnerPreflight([{success:false,results:[clean()]}]),/E_D1_STAGING/);
  assert.throws(()=>m.assertOwnerPreflight(wrap([{}])),/schema/);
});

test('Generated owner insert has only a derived hash and is one-time even if run twice',async()=>{
  const m=await mod;
  const password='staging-demo-password-ONLY-2026!';
  const sql=await m.buildOwnerSql(password);
  assert.doesNotMatch(sql,/staging-demo-password|STAGING_OWNER_PASSWORD|BEGIN TRANSACTION/);
  assert.match(sql,/INSERT INTO users\(/);
  assert.match(sql,/NOT EXISTS \(SELECT 1 FROM users\)/);
  assert.match(sql,/pbkdf2-sha256\$600000\$/);
  assert.match(sql,/contract_version/);
  await assert.rejects(()=>m.buildOwnerSql('too-short'),/20 to 256/);
  await assert.rejects(()=>m.buildOwnerSql('a'.repeat(257)),/20 to 256/);
  await assert.rejects(()=>m.buildOwnerSql('a'.repeat(25)+'\n'),/newlines/);
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(fs.readFileSync(path.join(root,'db/schema.sql'),'utf8'));
    db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY, contract_version INTEGER NOT NULL); INSERT INTO cloud_schema_contract VALUES(1,3);');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
    db.exec(sql);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    db.exec(sql);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    const owner=db.prepare('SELECT role,username,active,password_hash,password_salt FROM users').get();
    assert.equal(owner.role,'owner');
    assert.equal(owner.username,'owner');
    assert.equal(owner.active,1);
    assert.match(owner.password_hash,/^pbkdf2-sha256\$600000\$[a-f0-9]{64}$/);
    assert.match(owner.password_salt,/^[a-f0-9]{32}$/);
    assert.equal((await import('../cloudflare/auth-core.mjs')).verifyWorkerPassword!==undefined,true);
    assert.equal(await (await import('../cloudflare/auth-core.mjs')).verifyWorkerPassword(password,owner.password_salt,owner.password_hash),true);
    const checks=db.prepare("SELECT (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE role='owner' AND username='owner' AND active=1) AS owners, (SELECT COUNT(*) FROM sessions) AS sessions").get();
    assert.equal(m.assertOwnerVerified(wrap([checks]),wrap([])),true);
    assert.throws(()=>m.assertOwnerVerified(wrap([{...checks,owners:0}]),wrap([])),/not verified/);
    assert.throws(()=>m.assertOwnerVerified(wrap([checks]),wrap([{table:'users'}])),/foreign key/);
  }finally{db.close();}
});

test('Temporary owner SQL is created owner-readable only and cannot be overwritten or redirected',async()=>{
  const m=await mod;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-owner-test-'));
  const file=path.join(dir,'staging-owner-once.sql');
  try {
    assert.equal(m.savePrivateSql(file,'SELECT 1;',dir),true);
    assert.equal(fs.readFileSync(file,'utf8'),'SELECT 1;');
    if(process.platform!=='win32') assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.throws(()=>m.savePrivateSql(file,'SELECT 2;',dir));
    assert.throws(()=>m.savePrivateSql(path.join(dir,'different.sql'),'SELECT 2;',dir),/outside/);
    assert.throws(()=>m.savePrivateSql(path.join(dir,'..','unexpected.sql'),'SELECT 2;',dir),/outside/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Workflow manual approval scope, staging-only D1 use and no credential logging',()=>{
  const file=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-owner-bootstrap.yml'),'utf8');
  assert.match(file,/workflow_dispatch:/);
  assert.match(file,/CREATE_STAGING_OWNER_ONCE/);
  assert.match(file,/github.ref == 'refs\/heads\/main'/);
  assert.match(file,/environment: d1-staging/);
  assert.match(file,/secrets.STAGING_OWNER_PASSWORD/);
  assert.match(file,/actions\/checkout@v5/);
  assert.match(file,/actions\/setup-node@v5/);
  assert.match(file,/package-manager-cache: false/);
  // Secrets cannot be exposed to npm install or setup actions via job-level env.
  const installStep=file.slice(file.indexOf('- name: Install fixed Wrangler version'),
                               file.indexOf('- name: Read-only check pristine staging D1'));
  assert.doesNotMatch(installStep,/secrets\.|STAGING_OWNER_PASSWORD|CLOUDFLARE_API_TOKEN/);
  const jobEnv=file.slice(file.indexOf('    env:'),file.indexOf('    steps:'));
  assert.doesNotMatch(jobEnv,/secrets\.|STAGING_OWNER_PASSWORD/);
  assert.equal((file.match(/STAGING_OWNER_PASSWORD: \$\{\{ secrets.STAGING_OWNER_PASSWORD \}\}/g)||[]).length,2);

  assert.match(file,/--file "\$sql"/);
  assert.match(file,/trap 'rm -f "\$sql"' EXIT/);
  assert.equal((file.match(/wrangler d1 execute STAGING_DB --remote/g)||[]).length,4);
  assert.doesNotMatch(file,/wrangler d1 execute DB --remote|migrations apply|push:\s|pull_request:\s|echo.*STAGING_OWNER_PASSWORD|set -x/);
});

test('Importing legacy staging guard does not execute its CLI subcommand',()=>{
  const val=execFileSync(process.execPath,['--input-type=module','-e',
    "process.argv[2]='preflight'; await import('./tools/check-cloudflare-staging.mjs'); console.log('SAFE_IMPORT');"],{cwd:root,encoding:'utf8'});
  assert.match(val,/SAFE_IMPORT/);
});
