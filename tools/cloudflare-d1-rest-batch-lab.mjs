// Local Cloudflare D1 REST batch rollback experiment. Dedicated EMPTY scratch DB ONLY.
// Never imports or alters Production/Staging/Recovery D1. No credentials in source/logs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';

const FAIL='E_DISPOSABLE_D1_BATCH_LAB';
const APPROVAL='RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT';
const NAME_PREFIX='restaurant-business-owner-batch-lab-';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fail(phase='INVALID_INPUT'){const e=Error(FAIL);e.phase=phase;throw e;}
const readConfig=p=>JSON.parse(fs.readFileSync(path.join(repoRoot,p),'utf8'));
const tableName=x=>/^owner_batch_lab_[0-9a-f]{16}$/.test(x);
const cleanResponse=data=>data && typeof data==='object' && !Array.isArray(data);
export function assertScratchUuid(uuid){
  if(typeof uuid!=='string'||!UUID.test(uuid))fail('TARGET');
  const refs=[
    ...readConfig('wrangler.jsonc').d1_databases.map(v=>v.database_id),
    ...readConfig('wrangler.preview-migrations.jsonc').d1_databases.map(v=>v.database_id),
    ...readConfig('wrangler.production-initialize.jsonc').d1_databases.map(v=>v.database_id),
    readConfig('cloudflare/recovery-drill-target.json').database_id
  ];
  if(refs.includes(uuid))fail('PROTECTED_TARGET');
  return uuid;
}
export function assertScratchMetadata(uuid,data){
  assertScratchUuid(uuid);
  if(!cleanResponse(data)||data.success!==true||
     !cleanResponse(data.result)||data.result.uuid!==uuid||
     typeof data.result.name!=='string'||
     !new RegExp('^'+NAME_PREFIX+'[a-z0-9-]{4,40}$').test(data.result.name))
    fail('TARGET_METADATA');
  return true;
}
export function assertCleanScratchTables(result){
  if(!Array.isArray(result)||result.length!==1||result[0]?.success!==true||
    !Array.isArray(result[0].results))fail('SCRATCH_SCHEMA');
  const names=result[0].results.map(x=>x?.name);
  if(names.some(x=>typeof x!=='string'||
    (x!=='_cf_KV' && x!=='sqlite_sequence')))fail('SCRATCH_NOT_EMPTY');
  return true;
}
async function send(uuid,token,method,body,transport){
  assertScratchUuid(uuid);
  if(typeof token!=='string'||token.length<20||token.length>4096)fail('TOKEN');
  const url='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_ID+
    '/d1/database/'+uuid+(method==='POST'?'/query':'');
  let response;
  try {
    response=await transport(url,{
      method,redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(20000)
    });
  }catch{fail('NETWORK');}
  if(!response || !Number.isInteger(response.status))fail('HTTP');
  if([401,403,404,429].includes(response.status))fail('HTTP_'+response.status);
  if(response.status>=500)fail('HTTP_5XX');
  let data;
  try{data=await response.json();}catch{fail('JSON');}
  if(!cleanResponse(data)||JSON.stringify(data).length>65536)fail('API_SHAPE');
  return {status:response.status,ok:response.ok===true,data};
}
async function meta(uuid,token,transport){
  const r=await send(uuid,token,'GET',null,transport);
  if(!r.ok||r.status!==200)fail('HTTP');
  assertScratchMetadata(uuid,r.data);
}
async function sql(uuid,token,statement,transport){
  const r=await send(uuid,token,'POST',{sql:statement},transport);
  if(!r.ok||r.status!==200||r.data.success!==true||
    !Array.isArray(r.data.result)||r.data.result.length!==1||
    r.data.result[0]?.success!==true||
    !Array.isArray(r.data.result[0].results))fail('SQL_QUERY');
  return r.data.result;
}
function onlyCount(rows){
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.success!==true||
    !Array.isArray(rows[0].results)||rows[0].results.length!==1||
    !Number.isSafeInteger(rows[0].results[0]?.n))fail('VERIFY_COUNTS');
  return rows[0].results[0].n;
}
const tablesSql="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
export async function preflightScratch({uuid,token,transport=fetch}){
  await meta(uuid,token,transport);
  const t=await sql(uuid,token,tablesSql,transport);
  assertCleanScratchTables(t);
  return Object.freeze({status:'SCRATCH_D1_EMPTY_VERIFIED',production_write_performed:false});
}
function failureIsUnique(data){
  // Consume known error wording only to establish an executed UNIQUE violation.
  // Never include the raw Cloudflare error, SQL or response body in output.
  const messages=[
    ...(Array.isArray(data?.errors)?data.errors.map(e=>e?.message):[]),
    ...(Array.isArray(data?.result)?data.result.filter(x=>x?.success===false).flatMap(x=>[
      x.error,x.message,...(Array.isArray(x.errors)?x.errors.map(e=>e?.message):[])
    ]):[])
  ];
  return messages.some(x=>typeof x==='string' &&
    /(UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint violation)/i.test(x));
}
async function batch(uuid,token,statements,transport){
  if(!Array.isArray(statements)||statements.length!==2 ||
    !statements.every(x=>typeof x?.sql==='string'&&x.sql.length<500))fail('BATCH_INPUT');
  return send(uuid,token,'POST',{batch:statements},transport);
}
function assertBatchSuccess(r){
  if(!r.ok||r.status!==200||r.data.success!==true||
    !Array.isArray(r.data.result)||r.data.result.length!==2||
    !r.data.result.every(x=>x?.success===true&&Array.isArray(x.results)))
    fail('CONTROL_BATCH_FAILED');
}
export async function testDisposableRollback({uuid,token,approval,transport=fetch,
  uniqueId=()=>randomBytes(8).toString('hex')}){
  if(approval!==APPROVAL)fail('APPROVAL');
  await preflightScratch({uuid,token,transport});
  const suffix=uniqueId();
  if(typeof suffix!=='string'||!/^[0-9a-f]{16}$/.test(suffix))fail('IDENTIFIER');
  const name='owner_batch_lab_'+suffix;
  if(!tableName(name))fail('IDENTIFIER');
  // All SQL is constant template + cryptographically generated identifier.
  // Only disposable UUID may be passed to send; no D1 production config binding.
  await sql(uuid,token,
    'CREATE TABLE '+name+' (id INTEGER PRIMARY KEY, marker TEXT UNIQUE NOT NULL);',
    transport);
  const a="INSERT INTO "+name+" (id,marker) VALUES (1,'control_a')";
  const b="INSERT INTO "+name+" (id,marker) VALUES (2,'control_b')";
  assertBatchSuccess(await batch(uuid,token,[{sql:a},{sql:b}],transport));
  let count=onlyCount(await sql(uuid,token,
    'SELECT COUNT(*) AS n FROM '+name+';',transport));
  if(count!==2)fail('CONTROL_DATA');
  // First statement would write ID 3; second must fail due duplicate ID 3.
  const failing=[
    {sql:"INSERT INTO "+name+" (id,marker) VALUES (3,'rollback_marker')"},
    {sql:"INSERT INTO "+name+" (id,marker) VALUES (3,'conflict_marker')"}
  ];
  const failed=await batch(uuid,token,failing,transport);
  // Require evidence of the actual SQL UNIQUE constraint, not an HTTP 401 or
  // premature validation rejection which cannot prove rollback semantics.
  if(!failureIsUnique(failed.data))fail('FAILURE_NOT_PROVEN_UNIQUE');
  count=onlyCount(await sql(uuid,token,
    'SELECT COUNT(*) AS n FROM '+name+';',transport));
  if(count===3)fail('ROLLBACK_NOT_ATOMIC');
  if(count!==2)fail('ROLLBACK_UNEXPECTED_ROWS');
  const leftover=onlyCount(await sql(uuid,token,
    "SELECT COUNT(*) AS n FROM "+name+" WHERE id=3 OR marker='rollback_marker';",transport));
  if(leftover!==0)fail('ROLLBACK_NOT_ATOMIC');
  return Object.freeze({status:'DISPOSABLE_D1_REST_BATCH_ROLLBACK_PASS',
    control_rows:2,rollback_extra_rows:0,production_write_performed:false,
    disposable_only:true,actual_remote_d1_test:true,
    scratch_table_retained_for_inspection:true});
}
function assertCleanMain(){
  if(process.env.GITHUB_ACTIONS==='true')fail('GITHUB_CI');
  try{
    const run=a=>execFileSync('git',a,{
      cwd:repoRoot,encoding:'utf8',timeout:8000,stdio:['ignore','pipe','ignore']
    }).trim();
    if(run(['branch','--show-current'])!=='main'||
      run(['status','--porcelain','--untracked-files=no'])!=='')fail('CHECKOUT');
  }catch{fail('CHECKOUT');}
}
async function hidden(prompt){
  if(!process.stdin.isTTY||!process.stdout.isTTY||
    typeof process.stdin.setRawMode!=='function')fail('TTY');
  process.stdout.write(prompt);
  return new Promise((resolve,reject)=>{
    const wasRaw=process.stdin.isRaw;
    let chunks=[],size=0;
    let finished=false;
    function finish(error){
      if(finished)return;
      finished=true;process.stdin.off('data',onData);
      process.stdin.setRawMode(!!wasRaw);process.stdin.pause();
      process.stdout.write('\n');
      if(error){reject(Error(FAIL));return;}
      try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(
        Buffer.concat(chunks)));}catch{reject(Error(FAIL));}
      chunks.forEach(x=>x.fill(0));chunks=[];
    }
    function onData(buf){
      for(const b of buf){
        if(b===10||b===13){finish();return;}
        if(b===3||b===27){finish(true);return;}
        if(b===127||b===8){if(chunks.length){chunks.pop();size--;}continue;}
        if(b<32||size>4095){finish(true);return;}
        chunks.push(Buffer.from([b]));size++;
      }
    }
    process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
  });
}
async function main(args){
  if(args.length!==2||!['--probe','--test'].includes(args[0]))fail('ARGS');
  const [mode,uuid]=args;assertScratchUuid(uuid);
  if(mode==='--test')assertCleanMain();
  const token=await hidden('Cloudflare D1 Scratch Write Token (hidden): ');
  if(mode==='--probe'){
    process.stdout.write(JSON.stringify(await preflightScratch({uuid,token}))+'\n');
    return;
  }
  await preflightScratch({uuid,token});
  process.stdout.write('Verified named empty disposable D1. This test writes SCRATCH only.\n');
  process.stdout.write('No Production, Staging or Recovery Drill database can be targeted.\n');
  const {createInterface}=await import('node:readline/promises');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let ack='';
  try{ack=await rl.question('Type '+APPROVAL+': ');}finally{rl.close();}
  const result=await testDisposableRollback({uuid,token,approval:ack});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(e=>{
    const allowed=new Set(['ARGS','TARGET','PROTECTED_TARGET','TARGET_METADATA','TOKEN',
      'NETWORK','HTTP','HTTP_401','HTTP_403','HTTP_404','HTTP_429','HTTP_5XX','JSON',
      'API_SHAPE','SQL_QUERY','SCRATCH_SCHEMA','SCRATCH_NOT_EMPTY','VERIFY_COUNTS',
      'APPROVAL','IDENTIFIER','BATCH_INPUT','CONTROL_BATCH_FAILED','CONTROL_DATA',
      'FAILURE_NOT_PROVEN_UNIQUE','ROLLBACK_NOT_ATOMIC','ROLLBACK_UNEXPECTED_ROWS',
      'GITHUB_CI','CHECKOUT','TTY','INVALID_INPUT']);
    const phase=allowed.has(e?.phase)?e.phase:'UNKNOWN';
    process.stderr.write(FAIL+' phase='+phase+'; SCRATCH ONLY; DO NOT REPEAT WRITE ON FAILURE.\n');
    process.exitCode=1;
  });
}
