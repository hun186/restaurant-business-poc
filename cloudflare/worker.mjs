import { inspectD1Contract } from './d1-readiness.mjs';
import { previewIdentity } from './identity.mjs';
// Cloudflare staging bootstrap: the D1-backed business API has NOT been ported.
// Keep the public endpoint an explicitly labelled demo; never accept real login
// credentials or pretend that browser-only mock data is persisted by a server.
const common = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: common });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/me') return previewIdentity(request, env);
    if (pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
      }
      const response = json({
        status: 'demo_only',
        api: 'not_implemented',
        database: await inspectD1Contract(env.DB),
        production_ready: false,
      });
      return request.method === 'HEAD'
        ? new Response(null, { status: 200, headers: response.headers })
        : response;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return json({
        code: 'E_NOT_READY',
        error: 'Cloudflare 正式後端尚未啟用；目前只有虛構資料展示版，請勿輸入真實帳密或營運資料。',
      }, 503);
    }
    // Browser-only mock UI is served by the Cloudflare static assets binding.
    return env.ASSETS.fetch(request);
  },
};
