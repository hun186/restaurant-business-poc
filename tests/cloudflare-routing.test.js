'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projectDir = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'wrangler.jsonc'), 'utf8'));
const workerPromise = import('../cloudflare/worker.mjs');
const assets = { fetch: async () => new Response('demo document', { status: 200 }) };
async function send(route, init) {
  const worker = (await workerPromise).default;
  return worker.fetch(new Request(`https://example.workers.dev${route}`, init), { ASSETS: assets });
}

test('Wrangler config uses demo assets and invokes Worker for API routes', () => {
  // Cloudflare Workers Builds invokes `wrangler preview` on PR branches.
  // `preview_urls` alone is not enough: Wrangler requires this block.
  assert.deepEqual(config.previews, {});
  assert.equal(config.main, './cloudflare/worker.mjs');
  assert.equal(config.assets.directory, './vercel-demo');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
  assert.ok(fs.existsSync(path.join(projectDir, config.assets.directory, 'index.html')));
});

test('GET /api/health exists but never claims production readiness', async () => {
  const res = await send('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.status, 'demo_only');
  assert.equal(body.production_ready, false);
  assert.equal(body.database, 'not_configured');
});

test('HEAD /api/health returns no body', async () => {
  const res = await send('/api/health', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('production API paths fail closed before accepting real credentials or writes', async () => {
  for (const route of ['/api/login', '/api/data', '/api/command', '/api/backups', '/api']) {
    const options = route === '/api/login' ? { method: 'POST', body: 'password=not-sent' } : undefined;
    const res = await send(route, options);
    assert.equal(res.status, 503, route);
    assert.equal((await res.json()).code, 'E_NOT_READY');
  }
});

test('non-API route delegates to Cloudflare static assets', async () => {
  const res = await send('/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'demo document');
});
