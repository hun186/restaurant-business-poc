import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOrigin, checkStagingAnonymousHttp} from '../tools/cloudflare-staging-http-readonly.mjs';

const preview = 'https://a1b2c3d4-restaurant-business-poc.hungyuan-chen.workers.dev';
const headers = {'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store', 'x-content-type-options':'nosniff'};
function cases(overrides = {}, settings = {}) {
  const defaultBodies = {
    '/api/health': {status:'demo_only', api:'not_implemented', database:'schema_only', production_ready:false},
    '/api/overview': {code:'E_UNAUTHENTICATED'},
    '/api/data?entity=tasks': {code:'E_UNAUTHENTICATED'},
    '/api/me': {error:'Please log in'},
    '/api/overview?location_id=other': {code:'E_BAD_QUERY'},
    '/api/login': {code:'E_NOT_READY'},
    '/api/command': {code:'E_NOT_READY'}
  };
  const expectedStatuses = {
    '/api/health':200, '/api/overview':401, '/api/data?entity=tasks':401,
    '/api/me':401, '/api/overview?location_id=other':400, '/api/login':503,
    '/api/command':503
  };
  const requests = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url), key = parsed.pathname + parsed.search;
    requests.push({url,options});
    if (!(key in defaultBodies)) throw new Error('Unexpected URL');
    const body = Object.hasOwn(overrides,key) ? overrides[key] : defaultBodies[key];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body),{
      status:settings.status?.[key] || expectedStatuses[key],
      headers:{...headers,...settings.headers},
    });
  };
  return {fetcher,requests};
}
test('strictly pins preview origin and rejects production, credentials, paths and redirect targets', () => {
  assert.equal(previewOrigin(preview),preview);
  for (const url of [
    'http://a1b2c3d4-restaurant-business-poc.hungyuan-chen.workers.dev',
    'https://restaurant-business-poc.hungyuan-chen.workers.dev',
    'https://evil.example.org', 'https://127.0.0.1',
    preview + '/api/overview', preview + '/?query=1',
    preview + '/#fragment',
    'https://user:pass@a1b2c3d4-restaurant-business-poc.hungyuan-chen.workers.dev',
    'https://a1b2c3d4-restaurant-business-poc.hungyuan-chen.workers.dev:8443',
    preview.replace('workers.dev','workers.dev.evil.example'),
    preview.replace('a1b2c3d4-','a1b2c3d4--')
  ]) assert.throws(() => previewOrigin(url),/E_STAGING_HTTP_READONLY_CHECK/);
});
test('hosted GET-only smoke checks D1 schema, anonymous denies and disabled endpoints',async()=>{
  const {fetcher,requests} = cases();
  const result = await checkStagingAnonymousHttp(preview,fetcher);
  assert.equal(result.status,'STAGING_HTTP_GET_ONLY_ANONYMOUS_PASS');
  assert.equal(result.hosted_d1_schema_only_verified,true);
  assert.equal(result.authenticated_business_data_verified,false);
  assert.equal(result.mutating_methods_verified,false);
  assert.equal(requests.length,7);
  for (const {url,options} of requests) {
    assert.equal(new URL(url).origin,preview);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.referrerPolicy,'no-referrer');
  }
});
test('fail closed on missing D1 contract, wrong phase, unexpected sensitive data, or enabled API',async()=>{
  for (const [changes,settings] of [
    [{'/api/health':{status:'demo_only',api:'not_implemented',database:'schema_uninitialized',production_ready:false}},{}],
    [{'/api/health':{status:'active',api:'implemented',database:'schema_only',production_ready:true}},{}],
    [{'/api/overview':{code:'E_UNAUTHENTICATED',metrics:{secret:1}}},{}],
    [{'/api/data?entity=tasks':{code:'E_UNAUTHENTICATED',rows:[]}},{}],
    [{'/api/me':{user:{id:'private'}}},{}],
    [{}, {status:{'/api/overview':200}}],
    [{}, {status:{'/api/command':200}}],
    [{}, {headers:{'content-type':'text/html'}}],
    [{}, {headers:{'cache-control':'public'}}],
    [{}, {headers:{'set-cookie':'session=bad'}}],
    [{'/api/overview':'<html>Access redirect</html>'},{}]
  ]) {
    const f=cases(changes,settings);
    await assert.rejects(checkStagingAnonymousHttp(preview,f.fetcher));
  }
});
test('redirect or network failure never counts as a successful hosted check',async()=>{
  const redirect = async()=>new Response('',{status:302,headers:{location:'https://login.example.org'}});
  await assert.rejects(checkStagingAnonymousHttp(preview,redirect));
  await assert.rejects(checkStagingAnonymousHttp(preview,async()=>{throw new Error('network timeout')}));
});
