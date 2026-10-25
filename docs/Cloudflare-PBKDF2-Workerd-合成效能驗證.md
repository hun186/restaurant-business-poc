# Cloudflare PBKDF2 600k：合成 workerd 效能探針（安全第一階段）

> 狀態：本 PR 僅新增**隔離的本機** PBKDF2 效能驗證工具。**尚未在 Cloudflare 邊緣測得實際 CPU ms；不能以本機執行成功宣稱 Cloudflare Free 10 ms CPU 上限已符合**。不接觸真實 Owner 密碼、staging / production D1、Session 或任何 Cloudflare Secrets。

## 背景

- staging D1 的 schema v3、唯一 active Owner，以及 `0002_login_attempts_window_indexes.sql` 已由正式 GitHub Actions Runs #40172089719、#40188578478、#40204026605 實際完成。原始 staging D1 不必重設。
- PR #17 已 Merge，但 `cloudflare/login-service.mjs` 仍為**內部函式**；公開 `/api/login`、`/api/logout` 依然 `503 E_NOT_READY`，Production `CLOUD_AUTH_PHASE=disabled`。
- 官方 [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)（2026-10-12）：Free HTTP 請求 **CPU 10 ms**；Paid 預設 **30 秒**，最高可調至 **5 分鐘**。CPU 跟牆鐘經過時間（wall time）不同，WebCrypto PBKDF2 600,000 次對實際 Workers CPU 限額有風險。
- [Local development](https://developers.cloudflare.com/workers/local-development/)：`wrangler dev --local` 以 workerd 在本機跑 Worker，**但不等同 Cloudflare Hosted CPU 追蹤、限制和計費**。

## 本 PR 的工具

| 檔案 | 用途 |
| --- | --- |
| `cloudflare/pbkdf2-local-probe.mjs` | 調用正式 `hashWorkerPassword` 和 `verifyWorkerPassword`，以固定虛構密碼做 hash、正確驗證、錯誤驗證，各測其 wall-clock |
| `cloudflare/pbkdf2-local-probe-worker.mjs` | 封閉本機 Worker：只接受 `http://127.0.0.1`，拒絕網際網路 URL、外部 CF IP、任意密碼或 body |
| `wrangler.pbkdf2-local.jsonc` | 獨立 Worker config；`workers_dev=false`、`preview_urls=false`；**沒有 D1、KV、R2、Asset、路由或 Secrets** |
| `tools/pbkdf2-workerd-sandbox.mjs` | 將僅 3 個白名單 Worker 模組與嚴格設定複製到隨機私有暫存目錄，Wrangler 在此獨立 cwd/HOME/TMPDIR/XDG_CONFIG_HOME 啟動；不讀取專案 `.env` 或 `.dev.vars` |
| `tools/run-pbkdf2-local-workerd.mjs` | 用 loopback 啟動本機 workerd，手動採 3 組合成樣本，僅輸出 wall-clock 中位數與 `cpu_limit_verified:false`；`--smoke` 模式只有 1 組，另使用真實 HTTP 傳輸檢查空 POST 接受、帶密碼內容或 Authorization 拒絕 |
| `.github/workflows/pbkdf2-local-workerd.yml` | **人工 workflow_dispatch**，僅能在 main 且精確確認字串 `RUN_LOCAL_SYNTHETIC_ONLY` 後執行。沒有 push/PR 自動執行、Cloudflare API Token、D1、Deploy |
| `tests/cloudflare-pbkdf2-local-probe.test.js` | 正確/錯誤密碼結果、安全入口阻擋、零位元組 body stream、帶內容拒絕、模擬 `.env`/`.dev.vars` canary 不會進入隔離暫存目錄，以及正式 Worker 完全獨立等回歸 |
| `.github/workflows/verify.yml` | PR/Push Hosted CI 額外啟動**純本機** `pbkdf2-workerd-http-smoke`：安裝固定 Wrangler 後進行 1 組 workerd 真實 HTTP 傳輸整合回歸。它不部署 Cloudflare、不讀取 D1/Secrets，也不代表 Hosted CPU 性能測量 |

合成測試輸出不包含密碼、salt、PBKDF2 hash、Token、來源 IP 或真實帳號，只列數字耗時和驗證通過狀態。

## 執行步驟（合併與獨立授權後）

1. 在 Repository 的 GitHub Actions 找到 **PBKDF2 synthetic local workerd benchmark (manual only)**，選 `main`。
2. 輸入 `RUN_LOCAL_SYNTHETIC_ONLY`，啟動。
3. 在 Job `Run three synthetic loopback workerd PBKDF2 samples (WALL only)` 確認輸出 `LOCAL_WORKERD_SYNTHETIC_PASS`、`iterations:600000`、`samples:3`、`cpu_limit_verified:false`。
4. 如果發現耗時異常或 Workflow 失敗，不應跳過問題直接開放雲端登入；提供該次 Run URL 以分析。

## 正式 Codex Review P1/P2 修正（本 PR 待最新 HEAD 複審）

- **P1：** workerd 實際 HTTP Transport 可以給零內容 POST 建立非 null `request.body`。已改為只允許 Content-Length 為 0 的 body stream，使用 bounded 首 chunk read 確認立即 EOF；若缺失長度、標示非零、chunked、傳送任何內容或 Authorization，一律拒絕。新增真實本機 workerd HTTP 流程 `pbkdf2-workerd-http-smoke`，不再只測 Node Request 模擬。
- **P2：** Wrangler 可能自動載入專案根目錄的 `.env`、`.dev.vars`。已新增隨機私有暫存的獨立 workerd workspace，只複製三個經審查模組與安全 config，將執行 cwd、HOME、TMPDIR、XDG_CONFIG_HOME 指到沙箱，子行程採正向環境變數白名單並關閉 dotenv 載入；測試以虛構 secret canary 確認不複製來源的隱藏環境檔。
- 這些修改必須以最後 HEAD 的 Hosted CI／最新正式 Codex Review 為準。先前正式 Review Completed 不代表這一版自動通過。

## 尚未達成的驗收關卡

- **真正 Cloudflare Hosted CPU 用量**：需先選定 Cloudflare Workers 方案，在隔離的測試 Worker 和 Cloudflare Access / 其他嚴格管控機制保護下，使用**虛構**資料執行；從 Workers Logs、Tail 或 Analytics 擷取 `cpuTime`、`wallTime`、`exceededCpu`。不依賴使用者帳密、不綁正式/測試 D1；遠端部署需**另外明確授權**。
- 真實登入前尚須 Cloudflare 可信 IP/反向代理來源驗證、限流原子性實機併發、Session 撤銷、Cloudflare Access、登入帳密傳輸與稽核完整驗收；此階段不啟用任何登入路由、不開放公開效能探針。
- 本地合成測試的 wall-clock **不是**等價的 Hosted CPU ms；也不以固定牆鐘閾值直接決定 Free/Paid 可不可用。

## 操作邊界

- 不把此工具接到 `cloudflare/worker.mjs`，不更改 `wrangler.jsonc` 的 Production/Preview 配置。
- 此 PR 不會執行 `wrangler deploy`、不呼叫遠端 Wrangler D1。PR/Push **只會**自動執行 1 組純合成的本機 workerd HTTP 安全回歸（`--smoke`），3 組效能採樣仍須另行人工觸發。兩者的數值都不能當成 Cloudflare Hosted CPU 證據。
- Review／Hosted CI 不代表遠端性能已通過；未取得明確 Merge 授權不可合併。
