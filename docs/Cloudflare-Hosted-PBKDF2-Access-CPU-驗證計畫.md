# Cloudflare Hosted CPU 實測：Access 保護的合成 PBKDF2 探針（尚未部署）

> **本 PR 僅交付程式、測試與準備程序。尚未部署 Hosted Worker，尚未啟用遠端端點，也未取得 Cloudflare 邊緣 CPU 測量值。** 目前 staging D1 v3/Owner/0002 已驗收完成（#40204026605）；Production D1 仍未遷移，正式登入 API 持續回傳 503。

## 為什麼要另外建 Hosted 探針

2026-10-25 的 [本機 workerd 手動測試 Run #40208993373](https://github.com/hun186/restaurant-business-poc/actions/runs/40208993373) 使用 600,000 次 PBKDF2，三組樣本中位數：hash **79 ms**、正確驗證 **79 ms**、錯誤驗證 **78 ms**。這是本機 **wall-clock**，不是 Cloudflare Hosted CPU time。

Cloudflare [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) 的 Free HTTP CPU 為 10 ms，Paid 預設為 30 秒；應以實際 Hosted Workers Logs 的 `$workers.cpuTimeMs`、`$workers.wallTimeMs`、`$workers.outcome` / error 1102 及當次帳號方案實際配額驗證，不可拿本機 79 ms 直接判定合格或不合格。

## 專案隔離與防護

- 獨立 Worker `restaurant-pbkdf2-hosted-cpu-staging-probe` 使用 `wrangler.pbkdf2-hosted-disabled.jsonc`；**跟正式 `restaurant-business-poc` 不同名稱、不同入口**。
- `workers_dev: false`、`preview_urls: false`、`PROBE_ENABLED: "disabled"`，沒有 routes、D1、KV、R2、Assets、Secrets、Cron、服務綁定。即使誤部署預設配置，也無對外可訪問的 worker URL，邏輯還會拒絕所有請求。
- Worker 第二道安全檢查只接受 Cloudflare **平台已驗證的 `ctx.access`**，並與指定的 `PROBE_ACCESS_AUD` 精確比對。任意傳入 `CF-Access-Jwt-Assertion`、`Authorization` 或假造 Access 標頭，不等於 `ctx.access`。這不是對 Access 設定檢驗的替代品。
- 所有操作都必須透過 HTTPS + POST + 正確的 `X-Synthetic-Probe-Intent: pbkdf2-only`，只接受零位元組 body、無 query string、無跨站 Origin。每次請求執行**一個** KDF，不接收密碼、Salt、帳號、Token 或任何資料庫輸入。
- 三個操作：`POST /synthetic/hash`、`POST /synthetic/verify-correct`、`POST /synthetic/verify-wrong`。固定公開**虛構**密碼/Hash 測試向量，直接呼叫 `auth-core.mjs` 既有 600,000 次 PBKDF2 實作。回應僅操作類型、UUID、迭代數、正確性與 `cpu_verified:false`，**完全不輸出 CPU-ms／wall-ms**；Cloudflare Hosted `performance.now()` 可能在沒有 I/O 時凍結為零，絕不能拿它推算運算耗時。
- 自訂日誌只寫 `pbkdf2_synthetic_only` 事件、UUID、操作與迭代數，**不產出 `wall_ms` 或任何 CPU 計時欄位**；禁止記錄 Access 身分、來源 IP、密碼/雜湊、Cookie 或實際使用者資料。UUID 可用來與系統 invocation log 對應；若 CPU 超額 Worker 中止，可能沒有自訂日誌，仍須查系統 outcome/error 1102。

## 部署前嚴格執行順序（都需要額外授權）

1. **先審核 PR、Hosted CI 與正式 Codex Review，使用者獨立授權才可以 Merge**；此 PR 不新增任何遠端 deploy Workflow。
2. **第一階段只建立「不可路由且停用」的獨立 Worker**：需再次取得明確遠端部署許可後，才使用特定 config 部署這支**無公開入口的 disabled Worker**。絕不可使用主 `wrangler.jsonc` 改寫既有餐廳 Worker。
3. 在 Cloudflare Dashboard **Workers & Pages → 選此專用 Worker → Access → Protect this Worker**，設定為保護 **production 與 preview 的所有入口**（不要只保護預覽、不要設定 Bypass），存取政策僅允許特定測試管理員或核准的 service token。從 Zero Trust 記下此 Access application 的 AUD；不要放入 Public Repo。
4. **由管理員外部確認** Worker-level Access 套用的 hostname、policy 覆蓋、沒有更高優先序的 hostname/path Bypass、未授權請求受到阻擋；由 Access Dashboard 查看保護狀態。**未通過此驗收不得建立可訪問的 Worker 路由**。`ctx.access` 檢查是第二層安全，但不等於外部防護已驗收。
5. 另開**新 PR／新授權**準備受審查的 staging-only 啟用配置：`PROBE_ENABLED=access-only`、由受控部署環境注入 `PROBE_ACCESS_AUD`（不可提交真實 AUD 至公開程式庫）、只開放已 Access 保護的 hostname。確認仍沒有 D1、Production API、User/Session 接線，Hosted CI、Codex Review 全部通過後才能部署。
6. 明確授權後，使用一小批人工請求（每類先一筆），**沒有自動高頻重試**；同時在 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) 查每次 invocation 的 CPU/Wall time、Outcome、是否 1102/Exceeded Resources。不同類型各測幾次後計算中位數與尖峰；Worker 回應／自訂日誌刻意沒有耗時欄位；**只看 Cloudflare 平台 invocation log 的 `$workers.wallTimeMs`、`$workers.cpuTimeMs` 與 `$workers.outcome`**。不要拿本機 wall-clock 作為 Hosted CPU 證據。
7. 只要發現 Access 無法正常隔離、CPU 超額或記錄缺失，立即停止並維持/恢復 `PROBE_ENABLED=disabled`，必要時停用路由；**不能**因此降低正式登入安全性或直接調整 Owner hash。
8. 登入啟用仍需另外的來源 IP 可信度、D1 並發限流、Session、CSRF、撤銷及受保護 staging E2E 驗證。本探針只有 KDF，**不會觸碰遠端 staging / production D1**。

## CI 與驗收證據

- `tests/cloudflare-pbkdf2-hosted-access.test.js` 必須在 Windows/Ubuntu Node 22/24 驗證：默認關閉、配置與正式 Worker 隔離、虛假 Access header 無效、AUD 不符拒絕、body/跨站拒絕、三個合成 KDF 正確、沒有任何自行計算的 wall／CPU 毫秒欄位、模擬 `performance.now()` 永遠回傳 `0` 時仍正確執行且回應與自訂日誌不含誤導性數值。
- 不得將 Github Hosted CI（Node.js 不是 Cloudflare 邊緣）或 Cloudflare Preview 的 Build/Deployment 視為真正的 Hosted 探針部署。只有經另外授權的獨立 Worker 部署和 Logs 才算 Hosted CPU 驗收。
- [Cloudflare Access 官方說明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)：Worker-level Access 會保護所有 Worker URL，且 `ctx.access` 只有在 Access 對該請求驗證後才有值。請勿用不受驗證的 header 當作替代。

## 2026-10-26｜Codex P2 凍結計時器修正（待最新 HEAD 正式複審）

- 初輪正式 Codex Review 指出 Hosted Workers 在沒有外部 I/O 時 `performance.now()` 可能停止前進，不能把 PBKDF2 WebCrypto 前後差值當作 wall-clock。
- `runHostedSyntheticOperation()` 不再讀取任何自建時鐘，只確認合成操作正確性、類型、迭代數。
- Hosted HTTP 回應 `kind=hosted_synthetic_result_no_inline_timings`，不再提供 `wall_ms`、`cpu_ms`、`wallTimeMs`、`cpuTimeMs`；自訂 log 也不再記錄這些欄位，只用 `probe_id`／operation 輔助關聯平台 logs。
- Node 回歸凍結 `performance.now()` 為 `0`，執行所有三種合成操作並檢查輸出和自訂日誌完全沒有不可靠的耗時欄位。**是否符合實際 CPU 限制，只能在另行授權的 Hosted 隔離測試階段，用 Cloudflare invocation logs 核對。**
