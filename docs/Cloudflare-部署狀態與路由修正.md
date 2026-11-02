# Cloudflare 部署：靜態版 404 與安全啟動修正

## 2026-11-02｜Active Worker Deployment → Worker Version → Git Commit 唯讀證據（待遠端實機）

**已知實機證據**：操作者 Windows 執行 `run-cloudflare-public-readonly.bat` 回報 `PUBLIC_WORKER_READONLY_HTTP_PASS`，`demo_http_verified=true`、`d1_schema_contract_visible=true`、`mutation_routes_fail_closed=true`、`production_ready=false`、無 Production 寫入。這已證明公開 workers.dev Demo/Health 的 GET/HEAD 符合預期，但該探測**無法**證明哪一個 Worker Version 正在提供流量，也不證明所有入口受 Access 保護。

Cloudflare 官方版本架構將 **Build、Worker Version、Deployment** 分開管理。為了避免將 Workers Build Success 當成 Active Deploy 已驗收，本增量新增：

- `tools/cloudflare-g0-active-version-readonly.mjs`：只向固定 `https://api.cloudflare.com/client/v4` 發出兩個 **GET**，不接受任意 Host 或 Path。先用 `GET /accounts/{ACCOUNT_ID}/workers/scripts/restaurant-business-poc/deployments` 讀取 Deployment 清單，保守選取建立時間最新的部署；需有唯一 Active Version 且承接 **100%** 流量，若 2 版本分流、時間衝突或回應格式不明則拒絕核定。接著用 `GET /accounts/{ACCOUNT_ID}/builds/builds?version_ids={VERSION_ID}` 讀取該版本專屬 Workers Build，需成功且 GitHub Repo Owner = `hun186`、Repo = `restaurant-business-poc`、Branch = `main`、Commit SHA **完全等於此次 GitHub Actions checkout 的 `GITHUB_SHA`**。
- `.github/workflows/cloudflare-g0-active-version-readonly.yml`：手動 `workflow_dispatch`、只能選 `main`，要求輸入 `CHECK_ACTIVE_WORKER_READONLY`，使用既有人工核准 Environment `cloudflare-g0-readonly`，唯讀 Cloudflare API Token 只有執行工具的步驟取得，前置先執行原本閉鎖 SHA-256 preflight。此 Workflow **不會在 push/PR 自動跑**，不會修改任何 Cloudflare/SQL。
- 合成測試涵蓋有效 Git SHA 對應、歷史部署、無部署、流量分割、版本缺建置、Build Fail、Repo Owner/Repo/Branch 不符、Commit mismatch、API 403/逾時/回應過大，全部 fail closed。任何遠端 API 失敗不輸出 Token、HTTP Body、帳戶 ID、Route、作者身分；僅有安全的 `G0_ACTIVE_DEPLOYMENT_READONLY_FAILED stage=...`。

### G0 本機帳戶識別失敗（2026-11-02 受控診斷補強）

操作員 [Run #41420086497](https://github.com/hun186/restaurant-business-poc/actions/runs/41420086497) 在 Cloudflare GET 前出現 `G0_ACTIVE_DEPLOYMENT_READONLY_FAILED stage=LOCAL_CONFIG`。核對目前 `main` 的 `wrangler.jsonc` Worker、Production/Staging D1 ID 與 phase 都符合閉鎖條件；最可能是 Protected Environment `cloudflare-g0-readonly` 的 `CLOUDFLARE_ACCOUNT_ID` Secret 不存在、不可見或填錯。**GitHub Connector 無法檢視這個 Secret，不可聲稱已確診其實際值。** 此 PR 只把本機檢查失敗分類為 `LOCAL_CONFIG_ACCOUNT_ID_MISSING`、`LOCAL_CONFIG_ACCOUNT_ID_MISMATCH`，兩者均維持 fail-closed；真正 Worker 設定不符仍為 `LOCAL_CONFIG`，且任何訊息不會印出帳戶 ID、Token 或原始例外。操作者應至 GitHub Settings → Environments → `cloudflare-g0-readonly`，在 Environment Secrets 設定正確的 `CLOUDFLARE_ACCOUNT_ID`（不要貼到聊天／Issue），並確認唯讀 Token Secret 存在。然後**僅在主線 PR 合併後**，於 main 手動重新執行相同的唯讀工作流程。這不能授權 D1 Write/Owner/Login/Deploy。

### 操作者唯讀設定與使用

1. 在 GitHub Settings → Environments → `cloudflare-g0-readonly` 核對 Environment 仍受人工核准／授權控制；需要已有 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_G0_READONLY_TOKEN` 的 Environment Secrets。**若既有 G0 Read Token 尚無 `Workers CI Read` 權限，需由 Cloudflare 管理員重新核發／安全替換最小權限的 Read Token**，同時保留 `Workers Scripts Read`。請勿提供 Workers Scripts Write、Workers CI Write、D1 Write、Deploy Token 或 Global API Key。所有秘密只存 GitHub Secrets，不要貼在 issue、聊天或 log。GitHub Connector 本身無權讀取這些秘密或確認 Environment Policy，需操作者核對。
2. 開啟 GitHub → Actions → **Cloudflare G0 active Worker version attestation (manual read-only)** → Run workflow → Branch `main` → 輸入 `CHECK_ACTIVE_WORKER_READONLY`。不需在 Windows 安裝 Node。
3. 只有當雲端真實回應與 checkout 完全一致，才會看到 `G0_ACTIVE_DEPLOYMENT_BUILD_READONLY_PASS`，同時 `active_version_to_build_link_verified=true`、`active_build_commit_matches_main=true`，Commit SHA 會顯示在非機密 JSON 內。此只驗證**查詢當下 Cloudflare API 所報的 Active Deployment→Version→Build→Git Commit**，並不證明 workers.dev 客戶端此刻承接同一個版本，`public_hostname_version_verified=false`、`access_policy_verified=false`、`staging_live_access_verified=false`、`release_authorized=false` 保持 false。
4. 如果輸出 `G0_ACTIVE_DEPLOYMENT_READONLY_FAILED stage=CREDENTIALS|HTTP_STATUS|BUILDS|COMMIT_MISMATCH|...`，請停止，不要透過修改正式 Worker 變數、重新部署、建立 Owner 或重做 Production D1 備份來「修正」Read Token、權限或版差。

官方 Cloudflare API 參考：
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/
- https://developers.cloudflare.com/api/resources/workers_builds/methods/get_builds_by_version/
- https://developers.cloudflare.com/workers/versions-and-deployments/

## 2026-11-02｜Windows 真實連線阻斷：`API_HEALTH REQUEST_UNAVAILABLE`

操作員使用 PR #98 的內建 PowerShell 5.1 備援執行 `run-cloudflare-public-readonly.bat`，成功印出 `using built-in Windows PowerShell`，但第一個固定網址 `GET /api/health` 回報 `PUBLIC_WORKER_READONLY_FAIL stage=API_HEALTH detail=REQUEST_UNAVAILABLE`。**這只表示 Windows 並未拿到 HTTP 回應，不能證明 Worker 壞掉、網站未部署、D1 異常、帳號或密碼錯誤。** GitHub Cloudflare Workers Build success 亦不能證明這個客戶端可連通。此執行完全唯讀，沒有任何 SQL 寫入或登入。

### 安全診斷增量

新 PR 以純粹例外**類型／狀態 enum**分類 Windows PowerShell 發出的連線失敗，不印出會包含本地 Proxy/URL/環境資訊的原始例外字串：

- `DNS_LOOKUP_FAILED`、`PROXY_DNS_FAILED`：本機或 Proxy 名稱解析回報失敗。
- `TCP_CONNECT_FAILED`、`NETWORK_UNREACHABLE`：基礎 TCP 或網路不可到達，並非 HTTP 503。
- `TLS_FAILED`：傳輸層 TLS 驗證／通道失敗，**不會**關閉憑證驗證或降低 TLS 要求。
- `REQUEST_TIMEOUT`：操作逾時／取消。
- `REQUEST_UNAVAILABLE`：無法依例外型別可靠分類，保留不確定性。

僅在第一個 `/api/health` 連線失敗時，再透過系統 DNS 解譯**固定**的 `restaurant-business-poc.hungyuan-chen.workers.dev`；回報 `PUBLIC_WORKER_LOCAL_DNS result=RESOLVED|NO_ADDRESSES|LOOKUP_FAILED`，並標示 `LOCAL_DNS_ONLY_NOT_REMOTE_OR_PROXY_PROOF`。這是本機解析情況，**不**能證明 HTTP 服務是否已部署、Worker 是否健康，Proxy 甚至可能由遠端代為解析 DNS。不得據此修改 Production D1／建 Owner／繞過 Access 或擅自啟用 Public Write。

### 操作者後續

更新 main 並執行原本 `run-cloudflare-public-readonly.bat` 即可，**不需** Node/Token/帳密。把 `PUBLIC_WORKER_READONLY_FAIL stage=... detail=...` 與 `PUBLIC_WORKER_LOCAL_DNS result=...` 的**安全代碼**貼回來，無需貼 Windows Proxy、Cookie、IP、帳密、HTTP body。也可使用原有 GitHub Actions main-only `Cloudflare public Worker runtime HTTP smoke (manual GET only)` 輸入 `CHECK_PUBLIC_RUNTIME_READONLY`，比較不同網路位置是否成功；此工作流程無 Token、無 POST，但 Hosted CI 成功**不替代** Windows 端的網路結果。若有疑問，可在本機 CMD 額外用 `nslookup restaurant-business-poc.hungyuan-chen.workers.dev` 查看本機 DNS，**不**要將 Proxy 認證資訊貼到 Issue。

## 2026-11-02｜Windows 無 Node.js 時的實機故障與安全替代

操作員已 `git pull --ff-only origin main`（Already up to date），執行 `run-cloudflare-public-readonly.bat` 回報：

```
ERROR: Node.js 22.13 or later is required.
```

原因是原始 BAT 的 `where node` 在該 CMD PATH 找不到 Node，直接中止。**這不是 Cloudflare Build/Worker/Production D1 異常，也尚未發出任何 HTTP。** 不需修改 Cloudflare Token、重新 Export 或新增 D1。

本 PR 改為 BAT 優先實際執行 `node -e` 檢查 Node 22.13+；找不到或版本不足時，自動轉用 Windows PowerShell 5.1+ 的 `tools/cloudflare-public-runtime-readonly.ps1`。不需要為了這個固定公網健康測試先安裝 Node.js。

PowerShell 版本與 Node 版共用相同的**公開 HTTP 合約**：固定 workers.dev URL、只允許 GET/HEAD、無輸入網址、無 Cookie/Token/登入/SQL/POST/部署，禁止 Redirect、8 秒逾時、8 KiB 回應上限、明確 Demo/Health/schema_only/關閉的敏感路由/虛構靜態頁檢查、只輸出白名單錯誤碼。PowerShell 工具使用 UTF-8 BOM 相容 WinPS 5.1 的中文檢查，避免語系誤判。新增無網路 `-SelfTest` 合成測試，Windows GitHub CI 直接啟動 Windows PowerShell 版本，並更新原本封閉的 Exact SHA-256 審查清單。

測試無須 Cloudflare 密碼或 Token。PR CI/Codex 審核與合併前**不能**把工具存在當成已獲實際公網 HTTP PASS；修正後需由操作者再執行一次同一 BAT，回報 `PUBLIC_WORKER_READONLY_HTTP_PASS` 或匿名 `PUBLIC_WORKER_READONLY_FAIL stage=... detail=...`。即使 HTTP PASS，Active Deployment Version / Access / Production Release 仍非本工具的驗收範圍。

## 2026-11-02｜真實 Worker 公開網址 HTTP 驗收工具（只讀，尚未實機 PASS）

GitHub main `22d69c0d72c20c873efd74cb73cfbaf420590065` 的最新 Cloudflare Workers Builds check `success`，Build ID `5755c1a8-c70b-4f42-a65d-66ea810237fb`，說明先前 Issue #42 的 `assets-upload-session 10013` 在這次建置**沒有重新出現**；但仍需**實際**回應證據與 Active Deployment Version/Commit 對照才能完成部署驗收。

此增量新增：
- Windows `run-cloudflare-public-readonly.bat`：無需 API Token 或密碼，不會呼叫 Cloudflare 管理 API、`wrangler deploy`、寫入 SQL 或登入；
- 手動 GitHub Actions `Cloudflare public Worker runtime HTTP smoke (manual GET only)`：僅限 `main`，輸入固定 `CHECK_PUBLIC_RUNTIME_READONLY`，無需 Environment Secret，不會自動在 PR 或 Push 時發出對外流量；
- 共用 `tools/cloudflare-public-runtime-readonly.mjs` 只向程式碼中固定的 `https://restaurant-business-poc.hungyuan-chen.workers.dev` 發出 **GET／HEAD**，TLS 及 HTTP Redirect 不放行、每次 8 秒逾時、回應主體 8 KiB 上限，沒有 Cookie、Token、任意 URL 或 POST。

探測條件：`GET /api/health` 必須回 HTTP 200 + JSON `status=demo_only`、`api=not_implemented`、`database=schema_only`、`production_ready=false`、No-store；`HEAD /api/health` 回 200 且無 Body；`GET /api/command`、`/api/login`、`/api/data`、`/api/me` 只能回 503 `E_NOT_READY`；`GET /` 必須是標示虛構資料的 Demo HTML。這些 GET 不帶任何登入狀態或動作 Body，因此**不會觸發業務交易**。回應不符合時僅輸出白名單 `stage` / `detail`，不輸出原始 HTTP Body、URL、任何認證資訊或堆疊。

成功僅輸出 `PUBLIC_WORKER_READONLY_HTTP_PASS`，也**不是** Worker Active Version ID / Git SHA、所有自訂域名、Access Policy、防繞過、正式 Owner 或可營運登入的完整驗收：以上欄位皆固定 `false`。如果無法解析 DNS 或 Access 保護導致 Redirect，也必須報告未取得 HTTP PASS，不能判斷 Worker 不存在、部署失敗，亦不能繞過保護。

**目前狀態：**程式設計與合成測試需 Hosted CI + 正式 Codex Review；由操作者啟動 GitHub manual workflow 或 Windows BAT 的真實 HTTP 結果尚未提供。Production `CLOUD_AUTH_PHASE=disabled`，Owner 0、登入未放行；不重做已驗證的 C/D 雙實體磁碟加密備份、不自動部署／啟動 Staging Gate。

## 現象

Cloudflare Workers Builds 顯示 `npx wrangler deploy` Success，且上傳 `public/` 靜態資源，但訪問 `/api/health` 出現 HTTP 404。這只證明原本部署沒有服務該 API；**不是 D1、登入或正式營運已完成的證據**。

## 本次 PR 的功能範圍

- 新增 `wrangler.jsonc` 明確指定 Workers 程式入口與 `/api/*` 優先路由。
- 新增 Cloudflare Worker：`GET /api/health` 回應 `status: demo_only`、`production_ready: false`；**HTTP 200 僅代表路由有效，並不是可正式營運的健康檢查**。
- 其他 `/api/*` 一律回 HTTP 503 `E_NOT_READY`，不處理真正的登入密碼、帳號、庫存或營運變更。
- Cloudflare 網站改用 `vercel-demo/` 虛構資料展示靜態檔案，不再把 `public/` 本機 SQLite 正式登入畫面當成可在雲端運作的頁面。
- 保留 Vercel Demo 與 Node.js SQLite 本機正式程式不變；這不是 D1 移植。

## 部署設定

既有 Cloudflare Builds：根目錄 `/`、Build command 留空、Deploy command `npx wrangler deploy`。合併之前請先通過 CI；本 PR 不自動合併。合併後需查看 Cloudflare Build 紀錄，確認 `cloudflare/worker.mjs` 和靜態資源實際完成部署。

檢查：

1. `https://restaurant-business-poc.hungyuan-chen.workers.dev/api/health` 應回 `{"status":"demo_only","api":"not_implemented","database":"not_configured","production_ready":false}`。
2. 首頁應明確寫出「公開示範版 · 全部為虛構資料」，而非本機 SQLite 正式登入頁。
3. `POST /api/login` 應回 503 `E_NOT_READY`，不接受真實密碼。
4. 正式 D1、資料遷移、業主身分驗證、營運 API、備份／還原與生產驗收仍須獨立完成。

**請勿將現有 Cloudflare 網址交付業主作為正式營運服務。** 正式版必須獨立完成安全審核，並避免 Preview 指向正式 D1。

## Cloudflare Workers Builds Preview 失敗修正（2026-10-25）

PR #12 的 Preview Build 曾因執行 `npx wrangler preview` 而失敗。Cloudflare 日誌明確指出 `Your Wrangler configuration is missing a previews block`。這與 GitHub CI 成功、Workers 正式版靜態資源已部署是不同的驗證層次。

已在 `wrangler.jsonc` 頂層加入 `"previews": {}`，這是 Cloudflare Workers Preview 所要求的必要區塊；`preview_urls: true` 並不能取代它。`assets`、`compatibility_date` 仍應保持頂層設定。新增測試在 CI 中防止此設定意外遺失。

- Cloudflare Workers Builds：正式分支執行 `npx wrangler deploy`；PR Preview 執行 `npx wrangler preview`。
- 此階段只有靜態虛構 Demo 及不接受寫入的 `/api/health`，**沒有任何正式 D1 綁定或秘密資訊**，因此可使用空的 `previews`。
- **日後導入 D1 時，不可直接沿用空 Preview 資料綁定**：應分別配置正式 D1 與獨立測試 D1，禁止 Preview 存取業主資料。
- 是否修復 Cloudflare Preview，必須看新 commit 對應的 Hosted Cloudflare Build 狀態／Preview URL；單靠 JSON 格式正確不能聲稱部署通過。

官方依據：https://developers.cloudflare.com/workers/previews/configuration/
