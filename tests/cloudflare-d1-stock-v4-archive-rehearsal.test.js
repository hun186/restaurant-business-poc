'use strict';
// Synthetic operational D1 archives only. No real SQL, Cloudflare calls or writes.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,
 'cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'),'utf8');
const initial=fs.readFileSync(path.join(root,
 'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const indexes=fs.readFileSync(path.join(root,
 'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
const v3=initial+'\n'+indexes+'\n'+[
 'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);',
 "INSERT INTO d1_migrations(id,name) VALUES(1,'0001_initial_v3.sql');",
 "INSERT INTO d1_migrations(id,name) VALUES(2,'0002_login_attempts_window_indexes.sql');",
 "INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES('fake-owner','owner','Synthetic Owner','owner','"+'b'.repeat(32)+"','pbkdf2-sha256$100000$"+'a'.repeat(64)+"',1);",
 'INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES(\'bootstrap\',\'production-bootstrap\',\'auth.owner_bootstrap\',\'users\',\'fake-owner\',\'{"hash_version":"pbkdf2-sha256$100000"}\');',
 "INSERT INTO locations(id,name,active) VALUES('fake-store','Fake Store',1);",
 "INSERT INTO ingredients(id,sku,name,unit,min_stock,active) VALUES('fake-item','FAKE-01','Fake Item','kg',0,1);",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES('first','fake-item','fake-store',12.125,'purchase','fake-owner');",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES('second','fake-item','fake-store',-1.125,'usage','fake-owner');",
 "INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES('fake-token','fake-csrf','fake-owner','2030-01-01');",
 "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) VALUES('login','fake-owner','owner','auth.login','sessions','{}');"
].join('\n');
const v4=v3+'\n'+migration+
 "\nINSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');";
const pass='synthetic-encrypted-archive-passphrase-2026';
const modulePromise=import('../tools/cloudflare-d1-stock-v4-archive-rehearsal.mjs');
const archivePromise=import('../tools/cloudflare-prod-d1-encrypted-backup.mjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('offline encrypted v3 rehearsal proves 0004 migration and every historical table unchanged',async t=>{
 const [mod,backup]=await Promise.all([modulePromise,archivePromise]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fake-d1-v4-archive-rehearsal-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'synthetic-operational.sql.aes');
 const bytes=backup.encryptSql(v3,pass,{operational:true});
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 const sha=digest(bytes);
 const actual=mod.rehearseArchiveFile(file,pass,sha);
 assert.equal(actual.status,'D1_STOCK_V4_ENCRYPTED_ARCHIVE_OFFLINE_REHEARSAL_PASS');
 assert.equal(actual.source_archive_sha256,sha);
 assert.equal(actual.source_stock_ledger_version,3);
 assert.equal(actual.simulated_stock_ledger_version,4);
 assert.equal(actual.simulated_migration_receipts,3);
 assert.equal(actual.original_stock_move_rows,2);
 assert.ok(actual.preserved_tables>=20);
 assert.equal(actual.all_historical_rows_preserved,true);
 assert.equal(actual.plaintext_sql_written_to_disk,false);
 assert.equal(actual.production_d1_modified,false);
 assert.equal(actual.remote_d1_rehearsal_verified,false);
 assert.equal(actual.release_authorized,false);
 assert.equal(digest(fs.readFileSync(file)),sha,'source encrypted file unchanged');
 assert.deepEqual(fs.readdirSync(dir),['synthetic-operational.sql.aes'],
  'no plaintext or migration sqlite file persisted');
});
test('strictly reject wrong digest, passphrase, legacy format, corrupted archive and pre-migrated v4',async()=>{
 const [mod,backup]=await Promise.all([modulePromise,archivePromise]);
 const bytes=backup.encryptSql(v3,pass,{operational:true});
 const sha=digest(bytes);
 const bad=(b,p,h)=>assert.throws(()=>mod.rehearseArchiveBytes(b,p,h),
  /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_/);
 bad(bytes,pass,'0'.repeat(64));
 bad(bytes,'wrong-password',sha);
 const legacyArchive=backup.encryptSql(v3,pass);
 bad(legacyArchive,pass,digest(legacyArchive));
 const altered=Buffer.from(bytes);
 altered[altered.length-10]^=1;
 bad(altered,pass,digest(altered));
 const migrated=backup.encryptSql(v4,pass,{operational:true});
 bad(migrated,pass,digest(migrated));
 bad(Buffer.alloc(0),pass,'0'.repeat(64));
});
test('CLI uses explicit --archive/--sha256, and rejects unverified source types',async t=>{
 const [mod,backup]=await Promise.all([modulePromise,archivePromise]);
 const parsed=mod.parseArgs(['--archive','/synthetic.sql.aes','--sha256','a'.repeat(64)]);
 assert.equal(parsed.expectedSha256,'a'.repeat(64));
 assert.throws(()=>mod.parseArgs(['--archive','/synthetic.sql.aes']),/REHEARSAL_ARGS/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fake-d1-v4-archive-path-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bytes=backup.encryptSql(v3,pass,{operational:true});
 const src=path.join(dir,'source.sql.aes');
 fs.writeFileSync(src,bytes,{mode:0o600});
 const link=path.join(dir,'link.sql.aes');
 try{
  fs.symlinkSync(src,link);
  assert.throws(()=>mod.rehearseArchiveFile(link,pass,digest(bytes)),/REHEARSAL_PATH/);
 }catch(e){
  if(e.code!=='EPERM'&&e.code!=='EACCES')throw e;
 }
 assert.throws(()=>mod.rehearseArchiveFile(dir,pass,digest(bytes)),/REHEARSAL_PATH/);
 assert.throws(()=>mod.rehearseArchiveFile('source.sql.aes',pass,digest(bytes)),/REHEARSAL_PATH/);
});

test('authenticated disk-writing SQL is blocked before either replay and never creates a plaintext database',async t=>{
 const [mod,backup]=await Promise.all([modulePromise,archivePromise]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fake-d1-injection-regression-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const dest=path.join(dir,'leaked-users.sqlite');
 const escaped=dest.replaceAll("'","''");
 const injected=v3+'\nATTACH DATABASE '+"'"+escaped+"'"+' AS leaked;\n'+
  'CREATE TABLE leaked.users AS SELECT * FROM main.users;\nDETACH DATABASE leaked;';
 const archive=backup.encryptSql(injected,pass,{operational:true});
 assert.throws(()=>mod.rehearseArchiveBytes(archive,pass,digest(archive)),
  /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_UNSAFE_SQL/);
 assert.equal(fs.existsSync(dest),false,'no plaintext SQLite or users table on disk');
 assert.equal(mod.assertMemoryOnlyArchiveSql(
  "SELECT 'ATTACH DATABASE'; -- VACUUM INTO is a harmless comment\n"+
  "SELECT 'TEMP_STORE_DIRECTORY'; /* DETACH is not executable */"),true);
 for(const dangerous of [
  "VACUUM INTO 'leak.sqlite';","PRAGMA temp_store=FILE;",
  "CREATE TEMP TABLE tmp (id);","SELECT load_extension('file');",
  "DETACH DATABASE injected;"
 ])assert.throws(()=>mod.assertMemoryOnlyArchiveSql(dangerous),
  /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_UNSAFE_SQL/);
});
test('hidden input backspace erases an entire UTF-8 code point',async()=>{
 const mod=await modulePromise;
 for(const suffix of ['é','測','🍜']){
  const value=Buffer.from(pass+suffix,'utf8');
  assert.equal(mod.dropLastUtf8CodePoint(value).toString('utf8'),pass);
 }
 assert.equal(mod.dropLastUtf8CodePoint(Buffer.alloc(0)).length,0);
});

test('quoted SQLite identifiers cannot bypass in-memory disk-write guard',async()=>{
 const mod=await modulePromise;
 for(const sql of [
  'PRAGMA "temp_store"=FILE;',
  'PRAGMA '+String.fromCharCode(96)+'temp_store'+String.fromCharCode(96)+'=FILE;',
  'PRAGMA [temp_store]=FILE;',
  'PRAGMA "temp_store_directory"="/tmp";',
 ])assert.throws(()=>mod.assertMemoryOnlyArchiveSql(sql),
   /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_UNSAFE_SQL/);
 assert.equal(mod.assertMemoryOnlyArchiveSql(
  "SELECT 'PRAGMA \"temp_store\"=FILE';"),true);
});

test('single-quoted SQLite identifiers are rejected before encrypted archive replay',async()=>{
 const [mod,backup]=await Promise.all([modulePromise,archivePromise]);
 const injected=v3+"\nPRAGMA 'temp_store'=FILE;"+
  "\nCREATE TABLE 'temp'.spill AS SELECT u.*, zeroblob(4000000) AS padding FROM main.users u;";
 const bytes=backup.encryptSql(injected,pass,{operational:true});
 assert.throws(()=>mod.rehearseArchiveBytes(bytes,pass,digest(bytes)),
  /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_UNSAFE_SQL/);
 for(const text of [
  "PRAGMA 'temp_store'=FILE;",
  "CREATE TABLE 'temp'.spill AS SELECT 1;",
  "INSERT INTO 'temp'.spill VALUES (1);",
  "SELECT * FROM 'temp'.spill;"
 ])assert.throws(()=>mod.assertMemoryOnlyArchiveSql(text),
  /E_D1_STOCK_V4_ARCHIVE_REHEARSAL_UNSAFE_SQL/);
 // Ordinary SQL string data containing those words is permitted.
 assert.equal(mod.assertMemoryOnlyArchiveSql(
  "INSERT INTO notes(detail) VALUES('temp'),('temp_store'),('vacuum');"),true);
});
