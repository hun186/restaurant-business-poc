// Local, interactive Production D1 Owner operator. Never deployed in a Worker.
// Two modes: --check (read only), --enroll (one authorized remote write attempt).
// Do not log credentials, raw SQL, SQL results, salts or password hashes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {execFileSync} from 'node:child_process';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';
import {verifyProductionOwnerTarget, buildProductionOwnerSql} from './cloudflare-production-owner.mjs';
import {ownerReadinessSql,verifyOwnerReadiness} from './cloudflare-prod-owner-readonly.mjs';

const FAIL='E_PRODUCTION_OWNER_OPERATOR';
const APPROVAL='CREATE_ONE_PRODUCTION_OWNER_ONCE';
const MAX_API_BYTES=65536;
const MAX_SECRET_BYTES=4096;
function fail(){throw Error(FAIL);}
const SAFE_PHASES=new Set(['LOCAL_CONFIG','TOKEN_INPUT','READ_BEFORE','READ_AFTER',
  'READ_QUICK','READ_FOREIGN','READ_VALIDATE','WRITE_ATTEMPT','POST_WRITE_VALIDATE']);
const SAFE_REASONS=new Set(['INPUT_UNAVAILABLE','TOKEN_FORMAT','HTTP_401','HTTP_403',
  'HTTP_404','HTTP_429','HTTP_5XX','HTTP_OTHER','NETWORK_OR_TIMEOUT',
  'API_REJECTED','INVALID_JSON','RESPONSE_SHAPE','DATABASE_STATE','UNKNOWN']);
function diagnostic(reason='UNKNOWN',phase){
  const error=Error(FAIL);
  error.safeReason=SAFE_REASONS.has(reason)?reason:'UNKNOWN';
  if(SAFE_PHASES.has(phase))error.safePhase=phase;
  return error;
}
function tagged(error,phase){
  const reason=error?.safeReason??'UNKNOWN';
  return diagnostic(reason,phase);
}
function publicFailure(error,mode){
  const phase=SAFE_PHASES.has(error?.safePhase)?error.safePhase:'LOCAL_CONFIG';
  const reason=SAFE_REASONS.has(error?.safeReason)?error.safeReason:'UNKNOWN';
  const suffix=mode==='--check'
    ?'; READ-ONLY CHECK FAILED (NO WRITE ATTEMPTED).'
    :'; NO AUTOMATIC WRITE RETRY. Use Production Owner READONLY inspection.';
  return FAIL+' phase='+phase+' reason='+reason+suffix;
}
function onlyString(s){return typeof s==='string'&&s.length>0&&s.length<MAX_SECRET_BYTES;}
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// A privileged interactive action is never allowed from a dirty/unreviewed PR checkout.
// This check runs before prompting for the Cloudflare write credential.
export function assertTrustedMainCheckout(){
  if(process.env.GITHUB_ACTIONS==='true')fail();
  try{
    const run=args=>execFileSync('git',args,{
      cwd:repoRoot,encoding:'utf8',timeout:8000,stdio:['ignore','pipe','ignore']
    }).trim();
    if(run(['branch','--show-current'])!=='main' ||
       run(['status','--porcelain','--untracked-files=no'])!=='')fail();
    if(!/^[0-9a-f]{40}$/.test(run(['rev-parse','HEAD'])))fail();
    return true;
  }catch{fail();}
}

export function localProductionTarget(){
  const read=p=>JSON.parse(fs.readFileSync(path.join(repoRoot,p),'utf8'));
  const worker=read('wrangler.jsonc');
  const preview=read('wrangler.preview-migrations.jsonc');
  const production=read('wrangler.production-initialize.jsonc');
  try{verifyProductionOwnerTarget(worker,preview,production,ACCOUNT_ID);}catch{fail();}
  const target=production.d1_databases[0].database_id;
  if(!/^[a-f0-9-]{36}$/.test(target))fail();
  return Object.freeze({accountId:ACCOUNT_ID,databaseId:target});
}

// D1 REST /query: both single and batch bodies are supported by Cloudflare.
// Every response shape is checked strictly; errors are not reflected to stdout.
export async function queryD1(token,body,expected=1,transport=fetch){
  if(!onlyString(token)||token.length<20)throw diagnostic('TOKEN_FORMAT');
  if(!body||typeof body!=='object'||Array.isArray(body)||
     !Number.isSafeInteger(expected)||expected<1||expected>4||
     typeof transport!=='function')fail();
  const target=localProductionTarget();
  let reply;
  try{
    reply=await transport('https://api.cloudflare.com/client/v4/accounts/'+target.accountId+
      '/d1/database/'+target.databaseId+'/query',{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(20000)
    });
  }catch{
    // Do not expose fetch error, URL, response body, headers, or token.
    throw diagnostic('NETWORK_OR_TIMEOUT');
  }
  if(!reply?.ok||reply.status!==200){
    const status=reply?.status;
    const reason=status===401?'HTTP_401':status===403?'HTTP_403':
      status===404?'HTTP_404':status===429?'HTTP_429':
      Number.isInteger(status)&&status>=500&&status<=599?'HTTP_5XX':'HTTP_OTHER';
    throw diagnostic(reason);
  }
  let data;
  try{data=await reply.json();}catch{throw diagnostic('INVALID_JSON');}
  // The official D1 REST API returns result=[{success,results,meta}].
  // Reject unknown response types instead of guessing or printing raw content.
  if(data?.success!==true)throw diagnostic('API_REJECTED');
  if(!Array.isArray(data.result)||data.result.length!==expected||
     data.result.some(x=>x?.success!==true||!Array.isArray(x.results)))
    throw diagnostic('RESPONSE_SHAPE');
  if(JSON.stringify(data).length>MAX_API_BYTES)throw diagnostic('RESPONSE_SHAPE');
  return data.result.map(x=>({success:true,results:x.results}));
}
export async function inspectProductionOwner(token,transport=fetch){
  const data={};
  for(const task of ['before','after','quick','foreign']){
    try{
      // This path accepts only reviewed SELECT or integrity-check PRAGMA SQL.
      const result=await queryD1(token,{sql:ownerReadinessSql(task)},1,transport);
      data[task]=result;
    }catch(error){throw tagged(error,'READ_'+task.toUpperCase());}
  }
  try{return verifyOwnerReadiness(data);}
  catch{throw diagnostic('DATABASE_STATE','READ_VALIDATE');}
}
export function ownerSqlBatch(privateSql){
  if(typeof privateSql!=='string'||privateSql.length>20000)fail();
  const stmts=privateSql.split(';\n').map(x=>x.trim()).filter(Boolean);
  if(stmts.length!==2 || !/^INSERT INTO users\(/.test(stmts[0]) ||
    !/\bINSERT INTO audit_logs\(/.test(stmts[1]) ||
    /\b(DROP|DELETE|UPDATE|ALTER|CREATE|ATTACH|DETACH)\s+/i.test(privateSql))fail();
  return stmts.map(sql=>({sql}));
}
export async function enrollOneProductionOwner({token,password,approval,transport=fetch}){
  if(approval!==APPROVAL || typeof password!=='string' ||
    password.length<12 || password.length>256 ||
    /[\u0000-\u001f\u007f]/.test(password))fail();
  const initial=await inspectProductionOwner(token,transport);
  if(initial.status!=='PRODUCTION_OWNER_READY_TO_ENROLL_READONLY')fail();
  // The SQL itself rechecks that every Owner/business/audit table is pristine.
  const sql=await buildProductionOwnerSql(password);
  const batch=ownerSqlBatch(sql);
  // Exactly one Cloudflare D1 write API request. No automatic write retry.
  let writeSucceeded=false;
  try {
    await queryD1(token,{batch},2,transport);
    writeSucceeded=true;
  }catch{
    // A timeout or malformed API response cannot prove that no write happened.
    // Do not retry or delete anything: the operator must inspect state.
  }
  let post;
  try{post=await inspectProductionOwner(token,transport);}catch{fail();}
  if(!writeSucceeded || post.status!=='PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY')fail();
  return Object.freeze({
    status:'PRODUCTION_OWNER_CREATED_AUDITED_READONLY_VERIFIED',
    owner_count:1,owner_enrollment_audits:1,login_enabled:false,
    write_attempts:1
  });
}
async function hidden(prompt,maxBytes=MAX_SECRET_BYTES){
  if(!process.stdin.isTTY || !process.stdout.isTTY ||
    typeof process.stdin.setRawMode!=='function')fail();
  process.stdout.write(prompt);
  return new Promise((resolve,reject)=>{
    let bytes=Buffer.alloc(0);
    const wasRaw=process.stdin.isRaw;
    let done=false;
    function finish(error){
      if(done)return;
      done=true;process.stdin.off('data',onData);
      process.stdin.setRawMode(!!wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if(error){bytes.fill(0);reject(Error(FAIL));return;}
      try{
        const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        bytes.fill(0);resolve(s);
      }catch{bytes.fill(0);reject(Error(FAIL));}
    }
    function onData(chunk){
      for(const byte of chunk){
        if(byte===13||byte===10){finish();return;}
        if(byte===3||byte===27){finish(true);return;}
        if(byte===127||byte===8){
          let i=bytes.length-1;
          while(i>0&&(bytes[i]&0xc0)===0x80)i--;
          bytes=Buffer.from(bytes.subarray(0,Math.max(0,i)));
        }else if(byte>=32){
          if(bytes.length>=maxBytes){finish(true);return;}
          bytes=Buffer.concat([bytes,Buffer.from([byte])]);
        }else{finish(true);return;}
      }
    }
    process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
  });
}
async function main(args){
  if(args.length!==1||!['--check','--enroll'].includes(args[0]))fail();
  try{localProductionTarget();}catch{throw diagnostic('UNKNOWN','LOCAL_CONFIG');}
  if(args[0]==='--enroll')assertTrustedMainCheckout();
  if(!process.stdin.isTTY || !process.stdout.isTTY)
    throw diagnostic('INPUT_UNAVAILABLE','TOKEN_INPUT');
  let token;
  try{
    token=await hidden(args[0]==='--check'
      ?'Cloudflare Production D1 Read OR Write Token (hidden): '
      :'Cloudflare Production D1 Write Token (hidden): ');
  }catch{throw diagnostic('INPUT_UNAVAILABLE','TOKEN_INPUT');}
  if(!onlyString(token)||token.length<20)
    throw diagnostic('TOKEN_FORMAT','TOKEN_INPUT');
  const initial=await inspectProductionOwner(token);
  if(args[0]==='--check'){
    process.stdout.write(JSON.stringify(initial)+'\n');
    return;
  }
  if(initial.status!=='PRODUCTION_OWNER_READY_TO_ENROLL_READONLY')fail();
  process.stdout.write('Production D1 verified pristine (schema v3, 2 migrations, Owner=0).\n');
  process.stdout.write('Only one remote write attempt; a failure may need manual inspection.\n');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let approved='';
  try{approved=await rl.question('Type '+APPROVAL+' to enroll: ');}finally{rl.close();}
  if(approved!==APPROVAL)fail();
  const pwd=await hidden('New Owner password (hidden, 12-256 chars): ',1024);
  const confirm=await hidden('Confirm Owner password (hidden): ',1024);
  if(pwd!==confirm || pwd.length<12 || pwd.length>256)fail();
  const status=await enrollOneProductionOwner({token,password:pwd,approval:approved});
  process.stdout.write(JSON.stringify(status)+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(error=>{
    // Controlled diagnostic enums only: never output arbitrary error messages
    // or full Cloudflare responses, hashes, SQL, tokens or passwords.
    process.stderr.write(publicFailure(error,process.argv[2])+'\n');
    process.exitCode=1;
  });
}
