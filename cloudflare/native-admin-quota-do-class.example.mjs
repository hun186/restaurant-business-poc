// EXAMPLE ONLY. Not referenced by Wrangler or public Worker.
// Staging needs a separately reviewed Durable Object binding/migration.
import {DurableObject} from 'cloudflare:workers';
import {consumeAtomicWindowV1} from './native-admin-quota-do-core-internal.mjs';
export class NativeAdminQuotaDurableObject extends DurableObject {
  async consumeQuotaV1(scope){
    return consumeAtomicWindowV1(this.ctx.storage,scope,Date.now());
  }
}
