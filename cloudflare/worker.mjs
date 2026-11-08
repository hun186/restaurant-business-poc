import { inspectD1Contract } from './d1-readiness.mjs';
import { nativeLoginHttp,nativeLoginEnabled } from './native-login-http.mjs';
import { nativeBusinessReadHttp } from './native-business-http.mjs';
import { nativeTaskHttp,nativeTaskWriteEnabled } from './native-task-http.mjs';
import { nativeCatalogHttp,nativeCatalogWriteEnabled } from './native-catalog-http.mjs';
import { nativeOrderHttp,nativeOrderWriteEnabled } from './native-order-http.mjs';
import { previewIdentity } from './identity.mjs';
import { previewAccessMe } from './access-me-readonly.mjs';
import { previewAccessBusiness } from './access-business-readonly.mjs';
import { previewAccessTaskStatus, previewCommandTaskStatus } from './access-task-status-write.mjs';
import { previewOperationalData } from './operations-readonly.mjs';
import { previewOperationalOverview } from './overview-readonly.mjs';
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
    if (pathname === '/api/native/status') {
      if (request.method !== 'GET') return json({code:'METHOD_NOT_ALLOWED'},405);
      return json({mode:nativeLoginEnabled(env)?'native':'demo',
        login_enabled:nativeLoginEnabled(env),
        task_write_enabled:nativeTaskWriteEnabled(env),
        catalog_write_enabled:nativeCatalogWriteEnabled(env),
        order_write_enabled:nativeOrderWriteEnabled(env)});
    }
    if (pathname === '/api/login' || pathname === '/api/logout') return nativeLoginHttp(request, env);
    if (pathname === '/api/task') return nativeTaskHttp(request,env);
    if (pathname === '/api/catalog') return nativeCatalogHttp(request,env);
    if (pathname === '/api/order') return nativeOrderHttp(request,env);
    if (pathname === '/api/me') return previewIdentity(request, env);
    if (pathname === '/api/access/me') return previewAccessMe(request, env);
    if (pathname === '/api/access/data' || pathname === '/api/access/overview') return previewAccessBusiness(request, env);
    if (pathname === '/api/access/task-status') return previewAccessTaskStatus(request, env);
    if (pathname === '/api/command') {
      // This is a separately approved Staging-only bridge for one action.
      // Production remains disabled; no default command/write capability.
      if (env?.CLOUD_AUTH_PHASE !== 'preview-readonly' ||
          env?.CLOUD_ACCESS_COMMAND_GATE !== 'staging-task-status-only')
        return json({ code: 'E_NOT_READY' }, 503);
      return previewCommandTaskStatus(request, env);
    }
    if (pathname === '/api/data' || pathname === '/api/overview') {
      if(nativeLoginEnabled(env))return nativeBusinessReadHttp(request,env);
      return pathname === '/api/data'
        ? previewOperationalData(request,env)
        : previewOperationalOverview(request,env);
    }
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
    // Native mode sends the homepage to real D1 app, not the simulated Demo.
    if (pathname==='/' && nativeLoginEnabled(env)) {
      return new Response(null,{status:302,headers:{
        Location:'/owner-app.html','Cache-Control':'no-store'
      }});
    }
    // Browser-only mock UI is served by the Cloudflare static assets binding.
    return env.ASSETS.fetch(request);
  },
};
