# Cloudflare Production D1 — Owner 一次性建立（未開放執行）

## 2026-11-01：本機受控 Owner 建立工具（須經 PR 驗證合併）

以下工具在合併前僅為候選程式，不代表 Production Owner 已建立，也沒有直接替管理者執行寫入。Production v3 Schema 已在 Run #41215336274 實際建立；Owner=0 已由 #41265972020 與 #41265998671 兩次遠端唯讀確認。**不可重跑 first-init。**

### 操作者執行方式（自己的 Windows/Linux 終端機、Cloudflare D1 Write Token）

1. 從已通過 Hosted CI、Codex Review 並合併的最新 main 取得原始碼，使用 Node.js 22 或更新版。絕不要從不明來源下載 bat，也不要在其他人的電腦上輸入 Token。
2. Windows 在專案根目錄雙擊 run-production-owner-operator.bat；Linux 執行 bash run-production-owner-operator.sh。或直接執行 node tools/cloudflare-prod-owner-operator.mjs --check（僅檢查）／--enroll（一次性寫入）。
3. 第一次先選 **1 / Check**，在本機隱藏輸入欄貼上對正確 Cloudflare 帳戶與 Production D1 有 D1 Write 權限的 API Token。程式固定核對目標 Account ID 與 DB UUID；Token 不寫入檔案、GitHub Actions、Issue、終端歷史或日誌。只在回傳 PRODUCTION_OWNER_READY_TO_ENROLL_READONLY 時進入下一步。
4. 管理者確認要建立首位 Owner 時選 **2 / Enroll**，再次隱藏輸入 Token；程式用四個唯讀查詢重驗 v3／兩筆 Migration／20 表空白／FK／quick_check。接著必須輸入 CREATE_ONE_PRODUCTION_OWNER_ONCE，再隱藏輸入與重複確認 **12–256 字元** Owner 密碼。WebCrypto 會在本機產生 PBKDF2-SHA256 100,000 次、16-byte salt，只送出 hash/salt，**不傳送原始密碼**。帳號固定為 owner。
5. 使用 Cloudflare 官方 D1 REST POST /accounts/{account_id}/d1/database/{database_id}/query 的單次 batch 請求送兩筆受前置條件保護的 Owner 與 auth.owner_bootstrap 稽核 INSERT。**不得自行改成兩次 CLI writes 或貼入 Cloudflare Console。只會嘗試一次寫入，不會自動重試。** 網路錯誤仍可能發生在寫入提交之後。
6. 程式重新用四種唯讀查詢核對。只有 PRODUCTION_OWNER_CREATED_AUDITED_READONLY_VERIFIED（Owner=1、稽核=1、Migration=2、外鍵與完整性正常）才代表帳號結構完成。CLOUD_AUTH_PHASE 仍必須維持 disabled；此步驟**沒有開放登入**。
7. 任一步失敗只輸出 E_PRODUCTION_OWNER_OPERATOR，**不得直接重按 2、重新建表、清空 D1、重設 Owner 或猜測交易已回滾**。應先選 1 唯讀檢查、記錄不含密碼的狀態，異常交人工審查。顯示已建立 Owner 就不要再建立。

### 已知限制與安全界線

- 工具由本機管理者執行，不是 Cloudflare Worker 端點、GitHub Actions Production Write Workflow 或自動帳號註冊。GitHub Connector 無法代替操作者提供 Production Token。
- Cloudflare 官方 D1 REST /query 支援 batch，但**尚未透過 disposable D1 實站證明**其故障交易回滾；不能把 Worker Binding API batch() 保證直接移植到 REST 實作。故意採用失敗封閉、單次寫入、Postflight、不自動重試。在正式營運前建議用隔離庫驗證失敗注入。
- 不得在聊天、Issue、PR 張貼 Token、Owner 密碼、生成 SQL、hash 或 salt。完成後輪替／撤銷短期 Production Write Token，並核對是否有其他 Environment 共用舊值。
- 正式業務 API、Cookie、CSRF、Session、來源 IP、登入速率限制、UI 仍需要另行實站驗收，才可從 disabled 開放登入。
- 官方文件：https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ 及 https://developers.cloudflare.com/d1/worker-api/d1-database/


## 2026-11-01：新增唯讀驗證（不會建立 Owner）

正式 Production D1 已於 [Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 完成 v3 Schema／0001、0002；**不要重跑 `first-init`**。PR #84 已合併主線 `31e29b678b781dfc0f4b59eb92d5d111f1cd6c40`，主線 Verify #41217213971 PASS 5/5。正式 Owner 仍未確認建立、登入仍關閉。

這個新的開發增量新增 `.github/workflows/d1-production-owner-readonly.yml`：**僅在合併主線後才能從 Actions 手動運行**，Branch 選 `main`、輸入 `CHECK_PRODUCTION_OWNER_READONLY`。使用既有 `d1-production-readonly` Environment 的 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_PROD_D1_READ_TOKEN`，**絕不使用 Migration Write Token 或 Owner 密碼**。

它會先驗證固定目標、Reviewed SHA-256、現有 v3 合約與 2 個 Migration Ledger，再以四個唯讀 SQL（兩個 SELECT 統計、`PRAGMA quick_check`、`PRAGMA foreign_key_check`）查詢正式 D1。只有以下兩種嚴格符合的狀態會 PASS：

- `PRODUCTION_OWNER_READY_TO_ENROLL_READONLY`：20 張 Owner／Session／稽核／業務表均無資料，可規劃受控首次 Owner 建立；**不代表已建立或允許寫入**。
- `PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY`：恰好一位 active 的 PBKDF2-100k Owner 與恰好一筆去識別化權限授予稽核、無 Session／登入嘗試；這是結構就緒，並非公網登入或密碼實測成功。

任一來源回傳不符、缺失或 quick_check／FK 檢查異常即 **Fail closed**，只輸出泛化錯誤、不印 D1 原始內容、憑證或密碼。嚴格檢查簽章的 CLI 在 `tools/cloudflare-prod-owner-readonly.mjs`，本地測試在 `tests/cloudflare-prod-owner-readonly.test.js`。

注意：**這個增量絕不建立正式 Owner**；真正密碼建立須另經受控流程核准與 Cloudflare 實站驗收。若 Migration Token 曾 Rotate，唯讀環境可能使用獨立 Read Token；不得因寫入 Token 已更新就假定唯讀 Token 也有效。

 
## 目前狀態
- 主線 `26028441205b6d365b09fa0c7d11806eb237bd7e`：PR #83 已 Merge，postmerge Verify #41210737227 5/5 PASS。
- [Run #41207484827](https://github.com/hun186/restaurant-business-poc/actions/runs/41207484827) 是先前正式 D1 空庫的唯讀檢查。**更新：**[Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 已實際執行兩個正式 Migration，並取得 `PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS`、Schema v3、Migration=2、Owner=0、登入關閉。請勿重跑只能在空庫執行的 `first-init`。
- Production Schema **已初始化**，下一步為一次性 Owner 建立。現有的正式 Owner Workflow 尚未實作／批准，因此仍不能對 Production 建立帳號或啟用登入。
- 本分支僅新增 `tools/cloudflare-production-owner.mjs` 的**不可遠端自動執行**的輔助程式和合成測試。原計畫的正式 Owner GitHub Actions 寫入 Workflow **尚未建立**：連線端安全檢查已阻擋建立，請勿宣稱已可在 Github Actions 一鍵操作。

## 提議的正式 Owner 建立流程（未實作 Live Workflow）
由獨立、具有 Production D1 最小寫入權限的受控管理員程序：
1. 重新核對 Production D1 的固定 DB ID、v3 schema marker、恰好 `0001_initial_v3.sql`／`0002_login_attempts_window_indexes.sql` 兩個 ledger，所有 20 個 Owner/Session/稽核與業務資料表均為空。
2. 從私密環境變數取得業主初始密碼（12–256 字元）；只在受控 Runner 計算 `pbkdf2-sha256$100000$...` 和獨立 16-byte salt。**不得提交、張貼或記錄密碼或原始 SQL。**
3. 使用 guarded `INSERT ... SELECT ... WHERE` 確保所有資料表仍為空、v3 合約和兩個 Migration 未變，最多寫入一名 `owner`；同一私有 SQL 檔中的第二段 SQL 依新 Owner 的精確 UUID／salt／hash／角色比對再寫入 `auth.owner_bootstrap` 稽核，不依賴可能因分段執行失效的 `changes()`。稽核內容不含密碼、salt 或 Token。Cloudflare D1 不接受 SQL 檔內顯式 `BEGIN/COMMIT`；**不能保證兩段 SQL 一定以單一交易執行**。倘寫入中斷而只產生 Owner、沒有稽核，Postflight/唯讀檢查應 Fail-Closed、標示需人工處理，**不得清除 Owner、不得重置資料庫、不得自動重跑或啟用登入**。沒有 Demo 資料，也不自動啟用登入。
4. 僅輸出去識別化 Postflight：一位 active Owner、有正確雜湊版本、**恰好一筆初始權限授予稽核**、無 Session／Login Attempt、外鍵零錯誤；失敗時保存診斷資料，不能直接重跑或清庫。
5. 完成後須由管理者設置 Cloudflare Worker Secret `NATIVE_AUTH_SOURCE_PEPPER`、核對 D1 binding、公開 API／CSRF／Cookie／限流，再獨立啟用 native login。正式啟用前保持 `CLOUD_AUTH_PHASE=disabled`。

## 已完成的 Production Schema 歷史

首次空庫 Migration 已由 [Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 成功完成，請勿重複執行。接下來只需建立 Production Owner，不需要重新建表、重新備援 Restore 或更改既有 Migration SQL。

此文件是操作與開發交接，**不代表任何 Production 寫入已執行，也不構成自動授權**。
