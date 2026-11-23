// G6: Worker/Pages direct D1 binding inventory only; never mutates Cloudflare.
// Reuses G5's exhaustively tested, strict GET-only pagination implementation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';
import {
  collectG6BindingInventory, approvedG6BindingTarget,
  cloudflareReadOnlyGET, readWithPagesDifferential
} from './cloudflare-g5-binding-inventory.mjs';
const CONFIRM='CHECK_G6_BINDINGS_READONLY';
const ERROR='G6_BINDINGS_READONLY_FAILED';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TARGET=path.join(root,'cloudflare/stock-v4-disposable-target.json');
const need=x=>{if(!x)throw Error(ERROR);};
export async function checkG6Bindings(pin,get){
 const id=approvedG6BindingTarget(pin);
 need(typeof id==='string'&&typeof get==='function');
 const result=await collectG6BindingInventory(pin,get);
 // A partial inventory, a direct binding, or any Pages project is a hard stop.
 need(result.no_direct_binding_detected===true&&
  result.direct_binding_matches===0&&
  result.pages_deployment_bindings_verified===true);
 return result;
}
export async function readPinnedG6Bindings(token,get){
 need(typeof token==='string'&&token.length>12);
 const st=fs.lstatSync(TARGET);
 need(st.isFile()&&!st.isSymbolicLink()&&st.size<2048);
 const pin=JSON.parse(fs.readFileSync(TARGET,'utf8'));
 approvedG6BindingTarget(pin);
 return checkG6Bindings(pin,async p=>readWithPagesDifferential(
  q=>get(q,token),p,()=>{}));
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&
   process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G6_BINDINGS_READ_CONFIRM===CONFIRM&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  const result=await readPinnedG6Bindings(token,(p,t)=>cloudflareReadOnlyGET(p,t));
  // No database ID, Worker name, token or API response payload is logged.
  console.log(JSON.stringify(result));
 }catch{
  console.error(ERROR+'; no write, no restore and no authorization.');
  process.exitCode=1;
 }
}
