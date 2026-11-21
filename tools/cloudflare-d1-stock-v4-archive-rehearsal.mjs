// OFFLINE ONLY: consume an authenticated operational D1 archive in memory,
// rehearse Stock v3 -> v4 on a disposable SQLite DB; never writes SQL to disk.
// No Cloudflare API, Production D1, Gate, Worker deploy or restore capability.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline/promises';
import {decryptSql,verifyLocalSql,readHiddenBackupPassphrase,normalizeCopyPromptPath} from './cloudflare-prod-d1-encrypted-backup.mjs';
import {assertMemoryOnlySql} from './cloudflare-d1-memory-sql-guard.mjs';
import {runMemoryOnlyStockV4Probe} from './cloudflare-d1-stock-v4-archive-transaction-probe.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PREFIX='E_D1_STOCK_V4_ARCHIVE_REHEARSAL_';
const FORMAT='RBPOC_D1_AES256_GCM_OPERATIONAL_SQL_V1';
const MAX_ARCHIVE=64*1024*1024;
function fail(code){const e=new Error(PREFIX+code);e.code=PREFIX+code;throw e;}
function readArchive(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||!file.endsWith('.sql.aes'))
  fail('PATH');
 let fd;
 try{
  const link=fs.lstatSync(file,{bigint:true});
  if(!link.isFile()||link.isSymbolicLink()||link.nlink!==1n||
     link.size<=0n||link.size>BigInt(MAX_ARCHIVE))fail('PATH');
  fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const before=fs.fstatSync(fd,{bigint:true});
  if(!before.isFile()||before.dev!==link.dev||before.ino!==link.ino||
     before.size!==link.size)fail('SOURCE_RACE');
  const bytes=fs.readFileSync(fd);
  const after=fs.fstatSync(fd,{bigint:true});
  const now=fs.lstatSync(file,{bigint:true});
  if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||
     before.ctimeNs!==after.ctimeNs||bytes.length!==Number(before.size)||
     now.dev!==before.dev||now.ino!==before.ino||now.size!==before.size)
   fail('SOURCE_RACE');
  return bytes;
 }catch(e){if(e?.code?.startsWith(PREFIX))throw e;fail('PATH');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
// Retain the established public API and error codes while sharing the
// identical fail-closed scanner with operational backup verification.
export function assertMemoryOnlyArchiveSql(sql){
 try{return assertMemoryOnlySql(sql);}catch{fail('UNSAFE_SQL');}
}
export function dropLastUtf8CodePoint(bytes){
 if(!Buffer.isBuffer(bytes))fail('INPUT');
 let i=bytes.length-1;
 while(i>0&&(bytes[i]&0xc0)===0x80)i--;
 return Buffer.from(bytes.subarray(0,Math.max(0,i)));
}
function snapshot(db,tables){
 const output=new Map();
 for(const name of tables){
  const escaped='"'+name.replaceAll('"','""')+'"';
  const rows=db.prepare('SELECT * FROM '+escaped).all()
   .map(row=>JSON.stringify(row)).sort();
  output.set(name,Object.freeze({rows:rows.length,
   sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}));
 }
 return output;
}
const tableNames=db=>db.prepare(
 "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"
).all().map(x=>x.name);
const indexNames=db=>db.prepare(
 "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
).all().map(x=>x.name);
const uniqueRows=db=>db.prepare(
 "SELECT type,name,sql FROM sqlite_master WHERE type IN ('view','trigger') ORDER BY type,name"
).all().map(x=>JSON.stringify(x));
function same(a,b){if(JSON.stringify(a)!==JSON.stringify(b))fail('HISTORY');}
function checked(db){
 if(db.prepare('PRAGMA temp_store').get()?.temp_store!==2)fail('UNSAFE_TEMP_STORE');
 if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok'||
    db.prepare('PRAGMA foreign_key_check').all().length!==0||
    db.prepare('PRAGMA user_version').get()?.user_version!==0)
  fail('INTEGRITY');
}
function verifyNewDdl(db,candidate){
 const reference=new DatabaseSync(':memory:');
 try{
  reference.exec('PRAGMA temp_store=MEMORY');
  if(reference.prepare('PRAGMA temp_store').get()?.temp_store!==2)
   fail('UNSAFE_TEMP_STORE');
  const initial=fs.readFileSync(path.join(ROOT,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
  const indexes=fs.readFileSync(path.join(ROOT,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
  reference.exec(initial+'\n'+indexes+'\n'+candidate);
  for(const [type,name] of [['table','stock_moves'],['table','stock_move_kind_contract'],['index','stock_moves_stock']]){
   const query='SELECT sql FROM sqlite_master WHERE type=? AND name=?';
   const actual=db.prepare(query).get(type,name)?.sql;
   const expected=reference.prepare(query).get(type,name)?.sql;
   if(!actual||!expected||actual!==expected)fail('SCHEMA');
  }
 }finally{reference.close();}
}
export function rehearseArchiveBytes(bytes,passphrase,expectedSha256){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_ARCHIVE||
    typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/i.test(expectedSha256))
  fail('INPUT');
 const archiveSha=createHash('sha256').update(bytes).digest('hex');
 if(archiveSha!==expectedSha256.toLowerCase())fail('SHA256_MISMATCH');
 let format;
 try{format=JSON.parse(bytes.toString('utf8')).format;}catch{fail('ARCHIVE_FORMAT');}
 if(format!==FORMAT)fail('NOT_OPERATIONAL');
 let sql,v3;
 try{sql=decryptSql(bytes,passphrase);}catch{fail('SOURCE_VERIFY');}
 assertMemoryOnlyArchiveSql(sql);
 try{v3=verifyLocalSql(sql,{operational:true,memoryOnlyTemp:true});}catch{fail('SOURCE_VERIFY');}
 if(v3.stock_ledger_version!==3||v3.applied_migrations!==2||
    v3.schema_version!==3||v3.owner_count!==1)fail('NOT_V3');
 const candidate=fs.readFileSync(
  path.join(ROOT,'cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'),'utf8');
 const local=fs.readFileSync(path.join(ROOT,'db/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
 const proposal=fs.readFileSync(path.join(ROOT,'cloudflare/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
 if(candidate!==local||candidate!==proposal)fail('CANDIDATE_MISMATCH');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA temp_store=MEMORY');
  if(db.prepare('PRAGMA temp_store').get()?.temp_store!==2)
   fail('UNSAFE_TEMP_STORE');
  db.exec(sql);
  db.exec('PRAGMA foreign_keys=ON');
  checked(db);
  const beforeTables=tableNames(db),beforeIndexes=indexNames(db),
   beforeViews=uniqueRows(db);
  const preserve=beforeTables.filter(x=>x!=='d1_migrations');
  const before=snapshot(db,preserve);
  const moves=before.get('stock_moves')?.rows;
  if(!Number.isSafeInteger(moves))fail('SCHEMA');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec(candidate);
   db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
    .run(3,'0004_stock_move_kinds.sql');
   checked(db);
   same(tableNames(db),[...beforeTables,'stock_move_kind_contract'].sort());
   same(indexNames(db),beforeIndexes);
   same(uniqueRows(db),beforeViews);
   const ledger=db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all()
    .map(x=>({id:x.id,name:x.name}));
   same(ledger,[{id:1,name:'0001_initial_v3.sql'},
    {id:2,name:'0002_login_attempts_window_indexes.sql'},
    {id:3,name:'0004_stock_move_kinds.sql'}]);
   const marker=db.prepare('SELECT id,kind_version FROM stock_move_kind_contract').all();
   same(marker.map(x=>({id:x.id,kind_version:x.kind_version})),[{id:1,kind_version:4}]);
   verifyNewDdl(db,candidate);
   const after=snapshot(db,preserve);
   for(const name of preserve)same(after.get(name),before.get(name));
   db.exec('COMMIT');
  }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
  checked(db);
  const committed=snapshot(db,preserve);
  for(const name of preserve)same(committed.get(name),before.get(name));
  // Rehearse the new ledger kinds only on the disposable in-memory v4 copy.
  // Synthetic rows are rolled back; prove every real history fingerprint again.
  let probe;
  try{probe=runMemoryOnlyStockV4Probe(db);}catch{fail('PROBE');}
  checked(db);
  const afterProbe=snapshot(db,preserve);
  for(const name of preserve)same(afterProbe.get(name),before.get(name));
  same(db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all()
   .map(x=>({id:x.id,name:x.name})),ledger);
  same(db.prepare('SELECT id,kind_version FROM stock_move_kind_contract').all()
   .map(x=>({id:x.id,kind_version:x.kind_version})),
   [{id:1,kind_version:4}]);
  return Object.freeze({
   status:'D1_STOCK_V4_ENCRYPTED_ARCHIVE_OFFLINE_REHEARSAL_PASS',
   source_archive_sha256:archiveSha,source_stock_ledger_version:3,
   simulated_stock_ledger_version:4,simulated_migration_receipts:3,
   original_stock_move_rows:moves,preserved_tables:preserve.length,
   all_historical_rows_preserved:true,encrypted_source_read_only:true,
   ...probe,
   plaintext_sql_written_to_disk:false,disposable_sqlite_memory_only:true,
   cloudflare_api_called:false,production_d1_modified:false,
   remote_d1_rehearsal_verified:false,production_restore_performed:false,
   production_gate_enabled:false,release_authorized:false
  });
 }catch(e){if(e?.code?.startsWith(PREFIX))throw e;fail('MIGRATION');}
 finally{db.close();}
}
export function rehearseArchiveFile(file,passphrase,expectedSha256){
 return rehearseArchiveBytes(readArchive(file),passphrase,expectedSha256);
}
export function parseArgs(args){
 if(!Array.isArray(args)||args.length!==4||args[0]!=='--archive'||
    args[2]!=='--sha256')fail('ARGS');
 return {file:args[1],expectedSha256:args[3]};
}
export function parseInteractiveArchiveInput(archiveText,shaText){
 if(typeof archiveText!=='string'||typeof shaText!=='string'||
    !/^[a-f0-9]{64}$/i.test(shaText.trim()))fail('ARGS');
 let file;
 try{file=normalizeCopyPromptPath(archiveText);}catch{fail('PATH');}
 return Object.freeze({file,expectedSha256:shaText.trim().toLowerCase()});
}
async function interactiveArchiveArgs(){
 // No operator-provided strings are interpolated into cmd.exe or shell.
 // The SHA must come from an independently verified source backup, not
 // from silently recalculating and trusting the current file.
 if(!process.stdin.isTTY||!process.stdout.isTTY)fail('TTY');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  const archive=await rl.question('Verified operational .sql.aes full path: ');
  const sha=await rl.question('Independent verification SHA-256 (64 hex): ');
  return parseInteractiveArchiveInput(archive,sha);
 }finally{rl.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const argv=process.argv.slice(2);
  const {file,expectedSha256}=argv.length===1&&argv[0]==='--interactive'
   ?await interactiveArchiveArgs():parseArgs(argv);
  const passphrase=await readHiddenBackupPassphrase('Operational backup passphrase (hidden): ');
  console.log(JSON.stringify(rehearseArchiveFile(file,passphrase,expectedSha256)));
 }catch(e){
  const code=e?.code?.startsWith(PREFIX)?e.code:'E_D1_STOCK_V4_ARCHIVE_REHEARSAL_FAILED';
  console.error(code+'; NO REMOTE D1 MIGRATION; NO PRODUCTION RESTORE.');
  process.exitCode=1;
 }
}
