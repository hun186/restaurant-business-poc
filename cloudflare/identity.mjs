import { loadPrincipal, hasAccess } from './auth-core.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers });
}

// Only read-only identity verification is deliberately exposed in PR Previews.
// Login, account creation, logout/mutations and operations remain blocked until
// new scoped migrations, rate limiting and credential enrollment are reviewed.
export async function previewIdentity(request, env) {
  if (request.method !== 'GET') return response(405, { code: 'METHOD_NOT_ALLOWED' });
  if (env?.CLOUD_AUTH_PHASE !== 'preview-readonly' || !env.DB?.prepare) {
    return response(503, { code: 'E_NOT_READY' });
  }
  try {
    const principal = await loadPrincipal(env.DB, request);
    if (!principal || !hasAccess(principal, 'staff')) {
      return response(401, { error: '請先登入' });
    }
    return response(200, {
      user: {
        id: principal.id,
        username: principal.username,
        display_name: principal.display_name,
        role: principal.role,
        locations: principal.locations,
      },
      csrf: principal.csrf,
    });
  } catch {
    // Never reveal SQL, token or database details to public callers.
    return response(503, { code: 'E_AUTH_UNAVAILABLE' });
  }
}
