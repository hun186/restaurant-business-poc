# D1 原生帳號管理：公開 Worker 隔離與發布安全契約

> 狀態：**內部合成測試完成基礎；正式帳號管理 API 未實作、未授權上線。** 本文件不是正式部署核准。

## 現行安全基線

- 公開 Worker 的 Entry Point 是 `cloudflare/worker.mjs`；前端仍是 Demo，Production `CLOUD_AUTH_PHASE=disabled`。
- `wrangler.jsonc` 設定 `workers_dev=true`、`preview_urls=false`；`previews.vars.CLOUD_AUTH_PHASE=preview-readonly`，Production 與 Preview 都**沒有** `ACCOUNT_SECURITY_STAGE`。
- `cloudflare/account-security-internal.mjs` 與 `cloudflare/account-access-internal.mjs` 為合成測試專用函式；不允許從公開 Worker 的直接或間接相依路徑匯入。兩個模組的雙重 Gate **不是**可直接用於正式營運的授權模型。
- 使用者明確選擇**不使用 Cloudflare Zero Trust／Access，也不綁信用卡**。因此未來上線需自行設計與驗證應用層登入、Session、權限、稽核、暴露面及事故復原，而不能繞過安全驗收。
- 真正 Production D1 的 Owner Enrollment、帳號登入、資料寫入、遷移和 Restore 目前均沒有本文件的授權。

## v1 機器可讀介面契約（設計與合成驗證專用）

新增加的 `docs/native-account-admin-api-contract-v1.json` 是**尚未上線**的 API 設計合約，不是可執行或已註冊的公開路由。候選路徑 `POST /api/admin/account` 目前必須回應 `503 E_NOT_READY`，不查詢 D1，也不寫入任何實際帳號資料。

契約規定：最多 2048 bytes JSON、HTTPS／同來源／Session CSRF、有效 Owner 身分；每個 Action 都有固定輸入鍵與型別，拒絕未知欄位或錯誤角色；更新密碼只在內部函式使用，不記錄到 Audit 或對外回傳。重複授權屬 `409` no-op，真正變更才執行原子帳號更新＋Session 撤銷。

`tests/cloudflare-d1-account-access-internal.test.js` 以此契約列出的所有 Role／Active／Store Action 驗證 Owner 成功、Manager 與 Staff 一律拒絕且無 Side Effect；`tests/cloudflare-d1-account-security-internal.test.js` 驗證密碼輪替也不得由 Manager／Staff 執行。獨立測試確認候選路徑不會從目前公開 Worker 接受任何操作。

## 建議的操作契約（未實作的設計條件）

| Action | 所需角色 | 輸入 | 不可變條件與稽核 |
| --- | --- | --- | --- |
| `user.password` | Owner | targetUserId、新密碼 | 重新驗證有效 Session／CSRF；PBKDF2 輪替後撤銷目標全部 Session；稽核只記變更事實和撤銷筆數 |
| `user.role` | Owner | targetUserId、role | 不可自行降權、不可移除最後一名有效 Owner；交易內重新驗證角色與 Session；撤銷目標全部 Session |
| `user.active` | Owner | targetUserId、active | 不可自行停用、不可停用最後一名有效 Owner；停用及再啟用都不得恢復舊 Session |
| `user.assign-location`／`user.unassign-location` | Owner | targetUserId、locationId | 有效門市、目標帳號與關聯關係；真正變更才撤銷 Session，重複請求不得重複稽核或登出 |

上述名稱是內部 Domain Action，不是任何已存在的公開 HTTP Path。設計正式管理 API 前，需另行確定請求／回應 Schema、負載大小限制、登入來源驗證、授權邊界、錯誤碼、交易一致性、帳號管理權限與回復方案。

## 必須通過的發布 Gate

1. **靜態相依隔離**：`tests/cloudflare-native-account-release-isolation.test.js` 遞迴掃描公開 Worker 的 ESM 相依路徑，另外**獨立檢查所有 Cloudflare JS/MJS 模組是否直接引用 dormant 管理檔名**；禁止直接、間接、動態匯入或重新輸出。單行多重 `import`、`import/*...*/` 等未支援寫法也必須 Fail Closed，不能因解析器漏判而通過。
2. **公開路由拒絕**：生產與 Preview 配置皆不得設定 `ACCOUNT_SECURITY_STAGE`；既有登入停用狀態保持；即使人工注入合成 Gate，公開 Worker 對未公告的帳號管理路徑也必須回 `503 E_NOT_READY`，不查詢也不寫入 D1。
3. **合成資料安全**：帳號變更必須再次檢查 Owner Session／角色／CSRF／到期時間、目標原狀態，透過 D1 原子交易保證稽核、狀態變更與 Session 撤銷不會半途成功。嚴禁 Audit 含密碼、Token、Cookie 或可回復祕密。
4. **正式上線另行核准**：建立對外 API 需新的 Threat Model、正式身份驗證與授權矩陣、來源與頻率限制、回應保密檢查、D1 遷移／備份與復原準備，以及獨立明確的 Production 寫入／部署授權。不可由通過上述單元測試直接放行。
5. **驗收證據分離**：Hosted CI、正式 Codex Review、GitHub Merge、Cloudflare Build、Cloudflare Active Deployment、公開 HTTP、實際 D1 權限交易各自需要符合其範圍的獨立證據，不得混稱已通過。

本文件是未來對外介接前的最小契約，不取代正式安全設計或營運簽核。

## 2026-11-03｜Native Admin v1 request decoding: dormant and synthetic only

- New `cloudflare/native-admin-request-internal.mjs` implements an isolated 2048-byte maximum body decoder: strict UTF-8/JSON, v1 exact action keys/types/UUID, and a bounded Request reader checking HTTPS, POST, same-origin and JSON Content-Type. It is **not** imported by public `cloudflare/worker.mjs`.
- New synthetic `tests/native-admin-request-internal.test.js` checks five actions, malformed input, 2048/2049-byte boundary, invalid encoding, unknown properties, rejected origins and streaming cutoff. The Worker import isolation tests and reviewed SHA256 inventory include this module.
- **Not release-ready:** the reader does not implement slow-drip read deadlines, credential/session validation, Owner RBAC, CSRF, rate limiting or deployment gates. It must not be used in any live endpoint until those controls and deployment/UAT are separately reviewed.
- Production `CLOUD_AUTH_PHASE=disabled`, Preview URLs OFF, and proposed `POST /api/admin/account` still returns 503 without D1. No Production D1 write, enrollment, Restore, or Worker deployment is performed by this PR.

### 2026-11-03｜Unreleased stream read time and chunk budget

An additional synthetic-only revision enforces a total 2000ms read deadline (not refreshed by each stream chunk) and a 4096-chunk maximum including empty chunks. A stalled producer or high-rate zero-byte flood is denied without raw-body echo; an ordinary bounded JSON body still works. A timer and chunk cap are defense-in-depth, **not** a production rate-limiter, authentication substitute or comprehensive CPU/resource guarantee. Live endpoint integration remains blocked behind separate review, threat modeling and Owner/session/CSRF/rate-limit/UAT authorization.

### 2026-11-03｜Dormant Owner admission and quota contract (not a public route)

An independent `cloudflare/native-admin-admission-internal.mjs` tests a **fail-closed, non-mutating** admission boundary. It requires a synthetic-only dual gate and D1 interface, a caller-supplied quota provider with strict boolean `consume({scope, actorId?})` semantics, a preauthentication quota check **before D1 lookup**, an active Owner Session via existing `auth-core` primitives, matching HTTPS Origin and session-bound CSRF, then an Owner-specific quota check. It does not read the request body; the existing bounded JSON parser remains separate, and internal D1 mutations must re-validate authorization in their transaction. Failed checks return only stable status/code values without credentials or SQL.

**Important limitations:** No production quota provider exists in this PR; an isolate-local Map is expressly not a substitute for durable distributed enforcement. This admission is not wired to `cloudflare/worker.mjs` or any deployed route; it does not dispatch commands or modify D1. Production Login remains disabled, Preview URLs OFF. Before public release, require independent source-IP trust design, durable global/subject quota policies, principal lifecycle checks, comprehensive actor race validation, hosted staging security UAT, production approval and recovery readiness.

### 2026-11-03｜Synthetic Owner admission deadline (not deployed)

The internal-only preflight now bounds **the entire** preauthentication quota, read-only
D1 principal lookup and owner quota sequence to 2000 ms. Its optional second
quota-provider argument is `{signal: AbortSignal}`; providers should abort
outstanding network requests when signaled. Exhaustion or any async failure
returns the generic `503 E_ADMIN_PREFLIGHT_UNAVAILABLE`, without body reads,
account mutation, SQL or credential exposure. Late successful quota or identity
reads cannot advance to the next admission stage after the deadline.

This is a fail-closed response budget, **not** proof that a non-cooperating
quota service or D1 read has been canceled, or that any durable rate limit
exists. Production integration still needs a real shared provider, identity
source-trust review, transaction-time authorization, security UAT and explicit
release approval. Public Worker remains independent and returns 503 for the
candidate admin endpoint.

### 2026-11-03｜Exact admin-route parsing / admission boundary

Both the dormant bounded JSON decoder and Owner/quota admission independently
require the exact v1 contract path `/api/admin/account`, with no nonempty
query string, fragment, encoded path alias or trailing slash. Off-contract
URLs are rejected before reading the body, checking quotas or touching D1.
The parser returns generic invalid input; admission returns `400 E_INVALID_INPUT`.
Existing HTTPS, Origin, CSRF, Owner, quota and deadline checks remain intact.

The guard prevents accidental handler reuse; it is not a new public HTTP
route or authorization to deploy. Public Cloudflare Worker still returns
`503 E_NOT_READY` and does not import these internal modules. No Cloudflare,
Production D1, Owner enrollment or Restore changes were performed.

### 2026-11-03｜Cheap admin request envelope before expensive Owner admission

The dormant `preflightNativeAdminV1` now mirrors the parser's inexpensive
`Content-Type: application/json` (optional `charset=utf-8`), no
`Content-Encoding`, and strictly numeric declared `Content-Length <= 2048`
rules before preauth quota or D1 principal queries. Limits reuse the
decoder's `MAX_ADMIN_BODY_BYTES` constant. Bad envelopes return generic
`400 E_INVALID_INPUT` without reading the body, consuming quota or reading D1.

This validates only the declared header envelope: an absent or forged
Content-Length does not prove actual body size. The bounded streaming parser
still must run **after admission**; the public Worker still does not import
the dormant implementation and keeps `503 E_NOT_READY`. No Production
Auth/Owner/D1 write, deployment or Restore authorization is implied.

### 2026-11-03｜Shared body-header policy (synthetic, not released)

`validAdminBodyHeadersV1` is the sole cheap validation function for
`Content-Type: application/json` with optional UTF-8 charset, absence of
`Content-Encoding`, and a safe, canonical declared `Content-Length <= 2048`.
Both dormant `readAdminRequestV1` and `preflightNativeAdminV1` now call
the same fail-closed function, so a future policy adjustment cannot silently
diverge across parsing and Owner/quota admission. Malformed header objects,
unexpected types and thrown header getters are rejected without leaking
their values. Synthetic tests cover MIME, encoding and declared lengths and
prove early admission rejects before body/quota/D1 access.

This helper is not an independent security check of streamed body contents
or a distributed rate limiter; the bounded stream reader remains mandatory.
Public Worker still does not import dormant admin modules and retains
`503 E_NOT_READY`. Production Auth disabled, Preview URLs OFF, no D1 write,
Owner enrollment, restore or Cloudflare deployment setting modified.

Vercel deployment preference (operator, 2026-11-03): keep Preview Deployments
disabled for `restaurant-business-poc`, and deploy Production only following
a merge to `main`. The Vercel Connector accepted that project settings
update earlier, but the available project read API does not expose that
flag; do not claim live preview isolation verified without an independent
read or harmless future event.

### 2026-11-03｜External atomic quota transport candidate (synthetic only)

The private `createExternalNativeAdminQuotaV1(transport)` adapter accepts only
the preauth or Owner scope, validates a canonical Owner UUID, strips all
unlisted fields, requires a live AbortSignal, and treats nonboolean backend
decisions and post-abort completions as unavailable. Only a specifically
provided `consumeAtomic(payload,{signal})` transport is delegated to;
no local counters, request body, cookies, credentials, IP headers, storage or
network calls are introduced. A `false` result means deny; throws and malformed
results result in a fail-closed 503 when passed through the existing preflight.

This does **not** implement a shared quota service. Before any release, a
durable cross-isolate backend, verified atomic decision semantics, trusted
preauth identity/key source, quota-window policy, and staging tests must be
designed and audited separately. In particular, a single global preauth
bucket may cause denial of service and is not approved. Public Worker and
Production Login remain disabled; no Cloudflare binding, D1 write or deployment.

### 2026-11-03｜Malformed stream and header-object fault containment

The dormant request decoder now catches errors from untrusted/mock Header
getters (including an Origin getter or Content-Length changing between
validation and use), Body/getReader setup, and nonstandard reader cancellation
and release. It returns a stable invalid-input result, not a leaked exception
or backend diagnostic. Tests exercise throwing and malformed synthetic stream
interfaces, rejection before body reads, and cleanup. The 2048-byte bound,
2000ms deadline, 4096-chunk budget and v1 shape validation remain unchanged.

Real Cloudflare Request objects normally expose compliant Web Stream interfaces.
These synthetic guards do not constitute a deployed administration endpoint or
a replacement for rate limits, a shared quota service and transaction-time RBAC.
Production login/Worker admin route/D1 write remain disabled.

### 2026-11-03｜Early missing/consumed/locked body rejection

Before spending preauthentication quota or reading D1 identity, the dormant
Owner preflight now checks that the Request has an unconsumed, unlocked
ReadableStream-like body. Missing, consumed, locked and throwing body getters
fail closed as 400. This check does not read bytes or acquire the stream lock.
Synthetic tests show zero quota and SQL calls for those inputs.

These are inexpensive plausibility checks only: a producer may still provide
oversize/invalid JSON or lock the stream after preflight. The bounded decoder
must always run later and the D1 mutation must reauthorize in its transaction.
No exposed admin route, remote quota backend, production login or D1 write.
