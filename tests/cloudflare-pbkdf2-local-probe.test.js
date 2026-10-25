'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const base=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(base,'cloudflare/pbkdf2-local-probe-worker.mjs'),'utf8');
const prod=fs.readFileSync(path.join(base,'cloudflare/worker.mjs'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(base,'wrangler.pbkdf2-local.jsonc'),'utf8'));
const wf=fs.readFileSync(path.join(base,'.github/workflows/pbkdf2-local-workerd.yml'),'utf8');
const runner=fs.readFileSync(path.join(base,'tools/run-pbkdf2-local-workerd.mjs'),'utf8');
const workerPromise=import('../cloudflare/pbkdf2-local-probe-worker.mjs');
const probePromise=import('../cloudflare/pbkdf2-local-probe.mjs');
const url='http://127.0.0.1:18786';

test('synthetic only: 600k production PBKDF2 auth-core functions match correctly, no credentials in output',async()=>{
  const probe=await probePromise;
  const result=await probe.runSyntheticPbkdf2Probe();
  assert.equal(result.kind,'synthetic_local_workerd_wall_ms_not_cpu');
  assert.equal(result.iterations,600000);
  assert.equal(result.correct_match,true);
  assert.equal(result.wrong_match,false);
  assert.ok(['hash_ms','verify_correct_ms','verify_wrong_ms'].every(k=>Number.isFinite(result[k]) && result[k]>=0));
  const output=JSON.stringify(result);
  assert.doesNotMatch(output,/password|token|salt|hash_value|owner|account|staging|ip_hash/i);
});
test('loopback-only Worker refuses public URLs, caller payloads, authorization and forwards',async()=>{
  const worker=(await workerPromise).default;
  const req=(suffix,init={})=>new Request(url+suffix,init);
  assert.equal((await worker.fetch(req('/health'))).status,200);
  assert.equal((await worker.fetch(req('/health?admin=1'))).status,404);
  assert.equal((await worker.fetch(req('/run'))).status,404);
  assert.equal((await worker.fetch(new Request('https://127.0.0.1:18786/run',{method:'POST'}))).status,404);
  assert.equal((await worker.fetch(new Request('http://bench.example/run',{method:'POST'}))).status,404);
  assert.equal((await worker.fetch(req('/run',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.4'}}))).status,404);
  assert.equal((await worker.fetch(req('/run',{method:'POST',headers:{'x-forwarded-for':'203.0.113.4'}}))).status,404);
  assert.equal((await worker.fetch(req('/run',{method:'POST',headers:{authorization:'Bearer invented'}}))).status,400);
  assert.equal((await worker.fetch(req('/run',{method:'POST',body:JSON.stringify({password:'example-only'})}))).status,400);
  assert.equal((await worker.fetch(req('/run',{method:'POST',headers:{'content-length':'4'}}))).status,400);
  assert.equal((await worker.fetch(req('/run',{method:'POST',headers:{'cf-connecting-ip':'127.0.0.1'},body:'no'}))).status,400);
  assert.equal((await worker.fetch(req('/what',{method:'POST'}))).status,404);
});
test('loopback synthetic Worker returns only finite wall-clock timings and does not write to D1',async()=>{
  const worker=(await workerPromise).default;
  const res=await worker.fetch(new Request(url+'/run',{method:'POST'}));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.kind,'synthetic_local_workerd_wall_ms_not_cpu');
  assert.equal(body.iterations,600000);
  assert.equal(body.correct_match,true);
  assert.equal(body.wrong_match,false);
  for(const k of ['hash_ms','verify_correct_ms','verify_wrong_ms'])assert.ok(Number.isFinite(body[k]) && body[k]>=0);
  assert.doesNotMatch(JSON.stringify(body),/synthetic-benchmark|secret|salt|worker_password|owner|session/);
});
test('benchmark config never exposes public route or Cloudflare D1/prod/preview bindings',()=>{
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.main,'./cloudflare/pbkdf2-local-probe-worker.mjs');
  for(const key of ['d1_databases','routes','route','services','assets','vars','triggers','kv_namespaces','r2_buckets'])
    assert.equal(Object.hasOwn(config,key),false,key);
  assert.doesNotMatch(prod,/pbkdf2-local-probe|pbkdf2-local-probe-worker/);
  assert.match(prod,/E_NOT_READY/);
  assert.doesNotMatch(source,/\b(env\.DB|INSERT|UPDATE|DELETE|select\s+.*from|fetch\('https:\/\/)\b/i);
  assert.match(runner,/'--local'/);
  assert.match(runner,/'--ip','127\.0\.0\.1'/);
  assert.doesNotMatch(runner,/--remote|wrangler deploy|migrations apply|CLOUDFLARE_API_TOKEN:\s*process\.env/);
});
test('opt-in hosted action invokes local-only workerd and no secret/deploy/prod keys',()=>{
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
  assert.match(wf,/RUN_LOCAL_SYNTHETIC_ONLY/);
  assert.match(wf,/wrangler@4\.152\.0/);
  assert.match(wf,/node tools\/run-pbkdf2-local-workerd\.mjs/);
  assert.doesNotMatch(wf,/push:\s|pull_request:\s|\bdeploy\s|--remote|secrets\.|STAGING_OWNER_PASSWORD|d1 migrations apply|environment: d1-staging/);
  assert.match(wf,/contents: read/);
});
