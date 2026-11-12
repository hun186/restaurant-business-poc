'use strict';
// Offline tests only: no Wrangler process, Cloudflare access, or Production D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('recovery runner forces inspector:false with local Worker and explicit config',async()=>{
 const runner=await import('../tools/cloudflare-prod-owner-recovery-runner.mjs');
 const opts=runner.inspectorDisabledOptions(18239);
 assert.equal(opts.inspect,false);
 assert.equal(opts.local,true);
 assert.equal(opts.ip,'127.0.0.1');
 assert.equal(opts.config,'wrangler.owner-recovery.local.jsonc');
 let called=0;
 const mock={
  unstable_dev:async(script,options)=>{
   called++;
   assert.equal(script,'./owner-recovery-local-worker.mjs');
   assert.equal(options.inspect,false,'inspector must be off before any Worker starts');
   assert.deepEqual(options,opts);
   return {stop:async()=>{}};
  }
 };
 const instance=await runner.serveRecoveryWorker(18239,{
  resolve:()=> 'file:///synthetic/pinned-wrangler-api',
  load:async()=>mock
 });
 assert.equal(called,1);
 await instance.stop();
 for(const p of [0,80,9229,65536,-1,'9229'])
  assert.throws(()=>runner.inspectorDisabledOptions(p));
});
test('runner requires exactly pinned npm-exec Wrangler; no arbitrary fallback',async t=>{
 const runner=await import('../tools/cloudflare-prod-owner-recovery-runner.mjs');
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-runner-test-'));
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const bin=path.join(parent,'node_modules','.bin');
 const pkg=path.join(parent,'node_modules','wrangler');
 const dist=path.join(pkg,'wrangler-dist');
 fs.mkdirSync(bin,{recursive:true});
 fs.mkdirSync(dist,{recursive:true});
 fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({
  name:'wrangler',version:'4.160.0'
 }));
 fs.writeFileSync(path.join(dist,'cli.js'),'export const dummy=1;\n');
 const result=runner.resolvePinnedWrangler(bin);
 assert.ok(result.startsWith('file:'));
 assert.match(result,/wrangler-dist/);
 assert.throws(()=>runner.resolvePinnedWrangler(''));
 fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({
  name:'wrangler',version:'4.0.0'
 }));
 assert.throws(()=>runner.resolvePinnedWrangler(bin),
  'must never substitute an outdated Wrangler with exposed Inspector');
});
test('operator code cannot invoke wrangler dev or inspector-enabled mode',()=>{
 const root=path.join(__dirname,'..');
 const source=fs.readFileSync(path.join(root,'tools/cloudflare-prod-owner-password-recovery.mjs'),'utf8');
 const runner=fs.readFileSync(path.join(root,'tools/cloudflare-prod-owner-recovery-runner.mjs'),'utf8');
 assert.match(source,/--package=wrangler@4\.160\.0/);
 assert.match(source,/cloudflare-prod-owner-recovery-runner\.mjs/);
 assert.doesNotMatch(source,/\['--yes','wrangler@4','dev'/);
 assert.match(runner,/inspect:false/);
 assert.doesNotMatch(runner,/inspect:true/);
});
