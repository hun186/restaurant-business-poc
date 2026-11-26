import { inspectD1Contract } from './d1-readiness.mjs';
import { nativeLoginHttp,nativeLoginEnabled } from './native-login-http.mjs';
import {nativePasswordChangeHttp} from './native-password-change-http.mjs';
import {nativeAccountsHttp,nativeAccountStatusHttp,nativeAccountRoleHttp} from './native-account-management-http.mjs';
import {nativeAccountGrantHttp} from './native-account-grant-http.mjs';
import {nativeAccountPasswordResetHttp} from './native-account-password-reset-http.mjs';
import {nativeAuditHttp} from './native-audit-http.mjs';
import { nativeBusinessReadHttp } from './native-business-http.mjs';
import {nativePriceHttp,nativePriceWriteEnabled} from './native-price-http.mjs';
import {nativeStockUsageHttp,nativeStockUsageWriteEnabled} from './native-stock-usage-http.mjs';
import {nativeStockV4Http,nativeStockV4WriteEnabled} from './native-stock-v4-http.mjs';
import {nativeStockReturnHttp,nativeStockReturnWriteEnabled} from './native-stock-return-http.mjs';
import {nativeStockOperationsCapabilityHttp} from './native-stock-operations-capability.mjs';
import {nativeStockReceiptsHttp} from './native-stock-receipts-http.mjs';
import { nativeTaskHttp,nativeTaskWriteEnabled } from './native-task-http.mjs';
import {nativeShiftHttp} from './native-shift-http.mjs';
import {nativeTrainingHttp} from './native-training-http.mjs';
import {nativeTrainingCapabilityHttp} from './native-training-capability.mjs';
import {nativeEvaluationHttp} from './native-evaluation-http.mjs';
import {nativeEvaluationCapabilityHttp} from './native-evaluation-capability.mjs';
import {nativeShiftCapabilityHttp} from './native-shift-capability.mjs';
import { nativeCatalogHttp,nativeCatalogWriteEnabled } from './native-catalog-http.mjs';
import { nativeOrderHttp,nativeOrderWriteEnabled } from './native-order-http.mjs';
import { nativeStocktakeHttp,nativeStocktakeWriteEnabled } from './native-stocktake-http.mjs';
import { nativeRepairHttp,nativeRepairWriteEnabled } from './native-repair-http.mjs';
import {nativeLeaveHttp} from './native-leave-http.mjs';
import {nativeLeaveCapabilityHttp} from './native-leave-capability.mjs';
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
        order_write_enabled:nativeOrderWriteEnabled(env),
        stocktake_write_enabled:nativeStocktakeWriteEnabled(env),
        repair_write_enabled:nativeRepairWriteEnabled(env),
        price_write_enabled:nativePriceWriteEnabled(env),
        stock_usage_write_enabled:nativeStockUsageWriteEnabled(env),
        stock_v4_gate_enabled:nativeStockV4WriteEnabled(env),
        supplier_return_gate_enabled:nativeStockReturnWriteEnabled(env)});
    }
    if (pathname === '/api/login' || pathname === '/api/logout') return nativeLoginHttp(request, env);
    if (pathname === '/api/password/change') return nativePasswordChangeHttp(request,env);
    if (pathname === '/api/accounts') return nativeAccountsHttp(request,env);
    if (pathname === '/api/audit') return nativeAuditHttp(request,env);
    if (pathname === '/api/accounts/status') return nativeAccountStatusHttp(request,env);
    if (pathname === '/api/accounts/role') return nativeAccountRoleHttp(request,env);
    if (pathname === '/api/accounts/grant') return nativeAccountGrantHttp(request,env);
    if (pathname === '/api/accounts/password-reset') return nativeAccountPasswordResetHttp(request,env);
    if (pathname === '/api/task') return nativeTaskHttp(request,env);
    if (pathname === '/api/shift') return nativeShiftHttp(request,env);
    if (pathname === '/api/training') return nativeTrainingHttp(request,env);
    if (pathname === '/api/training/capability') return nativeTrainingCapabilityHttp(request,env);
    if (pathname === '/api/evaluation') return nativeEvaluationHttp(request,env);
    if (pathname === '/api/evaluation/capability') return nativeEvaluationCapabilityHttp(request,env);
    if (pathname === '/api/shift/capability') return nativeShiftCapabilityHttp(request,env);
    if (pathname === '/api/catalog') return nativeCatalogHttp(request,env);
    if (pathname === '/api/order') return nativeOrderHttp(request,env);
    if (pathname === '/api/stocktake') return nativeStocktakeHttp(request,env);
    if (pathname === '/api/repair') return nativeRepairHttp(request,env);
    if (pathname === '/api/leave') return nativeLeaveHttp(request,env);
    if (pathname === '/api/leave/capability') return nativeLeaveCapabilityHttp(request,env);
    if (pathname === '/api/price') return nativePriceHttp(request,env);
    if (pathname === '/api/stock/usage') return nativeStockUsageHttp(request,env);
    if (pathname === '/api/stock/v4') return nativeStockV4Http(request,env);
    if (pathname === '/api/stock/return') return nativeStockReturnHttp(request,env);
    if (pathname === '/api/stock/capability') return nativeStockOperationsCapabilityHttp(request,env);
    if (pathname === '/api/stock/receipts') return nativeStockReceiptsHttp(request,env);
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
