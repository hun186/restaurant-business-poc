// GET-only, no-credential Cloudflare Preview/D1 boundary smoke.
// It proves hosted anonymous denial and schema availability, NOT an authenticated D1 data read.
const EXPECTED_SUFFIX = '-restaurant-business-poc.hungyuan-chen.workers.dev';
const DEFAULT_TIMEOUT = 10000;
function fail() { throw new Error('E_STAGING_HTTP_READONLY_CHECK'); }
const MAX_RESPONSE_BYTES = 4096;

// Never buffer an unbounded/chunked body with Response.text(). Count actual
// UTF-8 bytes during streaming, canceling on the first over-limit chunk.
async function readLimitedUtf8(response) {
  const reader = response.body?.getReader();
  if (!reader) fail();
  const chunks = [];
  let bytes = 0, done = false;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) { done = true; break; }
      if (!(item.value instanceof Uint8Array)) fail();
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) fail();
      chunks.push(item.value);
    }
  } finally {
    if (!done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Reject malformed UTF-8 rather than silently replacing bytes.
  return new TextDecoder('utf-8', {fatal: true}).decode(body);
}

export function previewOrigin(input) {
  if (typeof input !== 'string' || input.length > 256) fail();
  let url;
  try { url = new URL(input); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) fail();
  const host = url.hostname;
  const prefix = host.endsWith(EXPECTED_SUFFIX)
    ? host.slice(0, -EXPECTED_SUFFIX.length) : '';
  // The bare production worker hostname has NO preview/version prefix.
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(prefix) ||
      prefix.endsWith('-') || prefix.includes('--')) fail();
  return url.origin;
}

async function requestJson(origin, pathname, expectedStatus, fetcher) {
  const options = {
    method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  };
  const response = await fetcher(origin + pathname, options);
  const directives = (response?.headers.get('cache-control') || '')
    .split(',').map(item => item.trim().toLowerCase());
  // Require the exact directive token. "x-no-store" and quoted values do not count.
  if (!response || response.status !== expectedStatus ||
      response.redirected || response.headers.get('location') ||
      response.headers.get('set-cookie') ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
      !directives.includes('no-store') || directives.includes('public') ||
      response.headers.get('x-content-type-options') !== 'nosniff') fail();
  const size = response.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_RESPONSE_BYTES)) fail();
  const bodyText = await readLimitedUtf8(response);
  let body;
  try { body = JSON.parse(bodyText); } catch { fail(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  return body;
}

export async function checkStagingAnonymousHttp(previewUrl, fetcher = fetch) {
  const origin = previewOrigin(previewUrl);
  // /api/health reads the REAL D1 contract in the deployed Preview; a
  // 200 alone cannot prove the binding or migration succeeded.
  const health = await requestJson(origin, '/api/health', 200, fetcher);
  if (health.status !== 'demo_only' || health.api !== 'not_implemented' ||
      health.database !== 'schema_only' || health.production_ready !== false) fail();

  // Anonymous callers must not see identity, business data, or overview.
  const overview = await requestJson(origin, '/api/overview', 401, fetcher);
  if (overview.code !== 'E_UNAUTHENTICATED' ||
      Object.hasOwn(overview, 'metrics')) fail();
  const data = await requestJson(origin, '/api/data?entity=tasks', 401, fetcher);
  if (data.code !== 'E_UNAUTHENTICATED' || Object.hasOwn(data, 'rows')) fail();
  const me = await requestJson(origin, '/api/me', 401, fetcher);
  if (Object.hasOwn(me, 'user') || Object.hasOwn(me, 'csrf') ||
      Object.hasOwn(me, 'token')) fail();
  const rejectedQuery = await requestJson(origin, '/api/overview?location_id=other', 400, fetcher);
  if (rejectedQuery.code !== 'E_BAD_QUERY') fail();

  // Use GET only. POST or any mutating request is intentionally NOT probed.
  for (const path of ['/api/login', '/api/command']) {
    const blocked = await requestJson(origin, path, 503, fetcher);
    if (blocked.code !== 'E_NOT_READY') fail();
  }
  return Object.freeze({
    status: 'STAGING_HTTP_GET_ONLY_ANONYMOUS_PASS',
    hosted_d1_schema_only_verified: true,
    anonymous_data_exposure_detected: false,
    login_or_command_get_enabled: false,
    authenticated_business_data_verified: false,
    mutating_methods_verified: false,
    cloudflare_access_policy_verified: false,
    production_ready: false
  });
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) fail();
    console.log(JSON.stringify(await checkStagingAnonymousHttp(process.argv[2])));
  } catch {
    // No URL, response body, auth data, origin or SQL appears in hosted logs.
    console.error('STAGING_HTTP_GET_ONLY_ANONYMOUS_FAILED');
    process.exitCode = 1;
  }
}
