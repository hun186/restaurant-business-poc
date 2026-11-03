'use strict';
// Enforce a release boundary: dormant native D1 account mutations must never
// become transitively reachable from the public Cloudflare Worker entrypoint.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const cloudflareRoot=path.join(root,'cloudflare');
const entry=path.join(cloudflareRoot,'worker.mjs');
const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
const dormant=new Set([
  path.join(cloudflareRoot,'account-access-internal.mjs'),
  path.join(cloudflareRoot,'account-security-internal.mjs'),
   path.join(cloudflareRoot,'native-admin-request-internal.mjs'),
  path.join(cloudflareRoot,'native-admin-admission-internal.mjs')
]);
const source=file=>fs.readFileSync(file,'utf8');
function cloudflareSources(dir=cloudflareRoot){
  const files=[];
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    if(item.isDirectory())files.push(...cloudflareSources(file));
    else if(item.isFile()&&/\.(?:js|mjs)$/.test(item.name))files.push(file);
  }
  return files;
}

function inspectWorkerImports(read=source){
  const visited=new Set(),pending=[entry];
  while(pending.length){
    const file=pending.pop();
    if(visited.has(file))continue;
    assert.ok(file.startsWith(cloudflareRoot+path.sep),'E_WORKER_IMPORT_OUTSIDE_CLOUDFLARE');
    assert.ok(fs.existsSync(file),'E_WORKER_IMPORT_MISSING');
    assert.ok(!dormant.has(file),'E_DORMANT_ACCOUNT_IMPORT: '+path.basename(file));
    visited.add(file);
    const body=read(file);
    // An opaque dynamic import prevents this deliberately conservative scan
    // from certifying the dependency graph. Review it before allowing release.
    assert.doesNotMatch(body,/\bimport\s*\(/,'E_DYNAMIC_IMPORT_NEEDS_REVIEW');
    // Non-leading imports and import/comment combinations are valid ESM.
    // Refuse them until the dependency scanner explicitly supports them.
    assert.doesNotMatch(body,/;[ \t]*import\b|\bimport\s*\/\*|;[ \t]*export[ \t]+(?:\*|\{)/,
      'E_UNREVIEWED_WORKER_IMPORT_SYNTAX');
    const statements=(body.match(/^\s*import\s+(?!\()/gm)||[]).length+
      (body.match(/^\s*export\s+[^\n]*\sfrom\s+['"]/gm)||[]).length;
    // Named ESM imports may span multiple lines, as in login-service.mjs.
    // Parse balanced simple import/export specifiers without accepting opaque
    // source forms; the statement count below still fails closed on drift.
    const pattern=/^\s*(?:import|export)\s+(?:(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/gm;
    const imports=[...body.matchAll(pattern)].map(m=>m[1]);
    assert.equal(imports.length,statements,
      'E_UNPARSED_WORKER_IMPORT: '+path.relative(root,file));
    for(const spec of imports){
      // A bare module specifier would require an explicit dependency-review
      // implementation; currently every Worker import is a local ESM path.
      assert.ok(spec.startsWith('./')||spec.startsWith('../'),
        'E_NON_RELATIVE_WORKER_IMPORT: '+spec);
      const destination=path.resolve(path.dirname(file),spec);
      assert.ok(destination.startsWith(cloudflareRoot+path.sep),
        'E_WORKER_IMPORT_OUTSIDE_CLOUDFLARE');
      pending.push(destination);
    }
  }
  // Independent of the ESM parser, all Cloudflare source modules must avoid
  // literal references to either dormant admin implementation. This catches
  // same-line/commented imports and imports through otherwise unvisited files.
  for(const file of cloudflareSources()){
    if(dormant.has(file))continue;
    assert.doesNotMatch(read(file),/(?:account-(?:access|security)-internal|native-admin-(?:request|admission)-internal)(?:\.mjs)?\b/,
      'E_DORMANT_ACCOUNT_REFERENCE: '+path.relative(root,file));
  }
  return visited;
}

test('production Worker import graph excludes both dormant native-account mutation modules',()=>{
  const graph=inspectWorkerImports();
  assert.ok(graph.size>=6,'entrypoint scan must cover transitive dependencies');
  assert.ok(graph.has(path.join(cloudflareRoot,'native-login-http.mjs')));
  assert.ok(graph.has(path.join(cloudflareRoot,'auth-core.mjs')));
  for(const hidden of dormant)assert.ok(!graph.has(hidden));
});

test('import-graph guard fails on direct, transitive and dynamic exposure',()=>{
  const original=source(entry);
  assert.throws(()=>inspectWorkerImports(file=>file===entry?
    original+"\nimport './account-access-internal.mjs';\n":source(file)),
    /E_DORMANT_ACCOUNT_IMPORT/);
  assert.throws(()=>inspectWorkerImports(file=>file===entry?
    original+"\nexport * from './account-security-internal.mjs';\n":source(file)),
    /E_DORMANT_ACCOUNT_IMPORT/);
  const dependency=path.join(cloudflareRoot,'native-login-http.mjs');
  assert.throws(()=>inspectWorkerImports(file=>file===dependency?
    source(file)+"\nimport './account-access-internal.mjs';\n":source(file)),
    /E_DORMANT_ACCOUNT_IMPORT/);
  assert.throws(()=>inspectWorkerImports(file=>file===entry?
    original+"\nconst accountModule = import('./account-access-internal.mjs');\n":source(file)),
    /E_DYNAMIC_IMPORT_NEEDS_REVIEW/);
});

test('same-line and comment-adjacent ESM imports cannot bypass the release guard',()=>{
  const original=source(entry);
  const first="import { inspectD1Contract } from './d1-readiness.mjs';";
  assert.ok(original.includes(first));
  for(const injected of [
    first+" import './account-access-internal.mjs';",
    first+" import './d1-readiness.mjs';",
    "import/* inline comment */ './account-access-internal.mjs';\n"+original,
    "import/* inline comment */ './d1-readiness.mjs';\n"+original
  ]){
    const mutated=injected.startsWith(first)?
      original.replace(first,injected):injected;
    assert.throws(()=>inspectWorkerImports(file=>file===entry?mutated:source(file)),
      /E_UNREVIEWED_WORKER_IMPORT_SYNTAX|E_DORMANT_ACCOUNT_REFERENCE/);
  }
});

test('Wrangler Production and Preview never activate an account administration stage',()=>{
  assert.equal(config.main,'./cloudflare/worker.mjs');
  assert.equal(config.workers_dev,true);
  assert.equal(config.preview_urls,false);
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(config.previews.vars.CLOUD_AUTH_PHASE,'preview-readonly');
  for(const vars of [config.vars,config.previews.vars]){
    assert.equal(Object.hasOwn(vars,'ACCOUNT_SECURITY_STAGE'),false);
    assert.equal(Object.hasOwn(vars,'CLOUD_NATIVE_LOGIN_GATE'),false);
  }
});

test('unlisted account-management HTTP endpoints fail closed even with forged test-only stage',async()=>{
  const worker=(await import('../cloudflare/worker.mjs')).default;
  const paths=[
    '/api/account-security','/api/account/access','/api/accounts',
    '/api/admin/users','/api/user/password','/api/internal/account-access',
    '/api/command'
  ];
  for(const phase of ['disabled','preview-readonly']){
    let statements=0,assets=0;
    const env={
      ...config.vars,CLOUD_AUTH_PHASE:phase,ACCOUNT_SECURITY_STAGE:'internal-test-only',
      DB:{
        prepare(){statements++;throw Error('D1_READ_MUST_NOT_HAPPEN');},
        batch(){statements++;throw Error('D1_WRITE_MUST_NOT_HAPPEN');}
      },
      ASSETS:{fetch(){assets++;throw Error('STATIC_ASSET_FALLBACK_MUST_NOT_RUN');}}
    };
    for(const route of paths){
      const request=new Request('https://restaurant.example.workers.dev'+route,{
        method:'POST',
        headers:{origin:'https://restaurant.example.workers.dev',
          'content-type':'application/json','x-csrf-token':'placeholder',
          cookie:'__Host-restaurant_session=synthetic-not-a-token'},
        body:JSON.stringify({action:'user.role',targetUserId:'synthetic-user',role:'owner'})
      });
      const response=await worker.fetch(request,env);
      assert.equal(response.status,503,phase+':'+route);
      assert.equal((await response.json()).code,'E_NOT_READY',phase+':'+route);
    }
    assert.equal(statements,0,'unknown admin routes must never query/write D1');
    assert.equal(assets,0,'unknown admin routes must not leak to static UI');
  }
});
