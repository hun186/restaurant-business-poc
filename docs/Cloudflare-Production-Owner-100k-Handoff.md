# Cloudflare Production D1 — Owner 一次性建立（未開放執行）

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
3. 使用 guarded `INSERT ... SELECT ... WHERE` 確保所有資料表仍為空、v3 合約和兩個 Migration 未變，最多寫入一名 `owner`；同一私有 SQL 批次寫入一筆 `auth.owner_bootstrap` 稽核，記錄授權建立事件但不含密碼、salt 或 Token。Cloudflare D1 不接受 SQL 檔內顯式 `BEGIN/COMMIT`；遠端批次的原子性需在正式授權流程實站驗證後才可宣稱。沒有 Demo 資料，也不自動啟用登入。
4. 僅輸出去識別化 Postflight：一位 active Owner、有正確雜湊版本、**恰好一筆初始權限授予稽核**、無 Session／Login Attempt、外鍵零錯誤；失敗時保存診斷資料，不能直接重跑或清庫。
5. 完成後須由管理者設置 Cloudflare Worker Secret `NATIVE_AUTH_SOURCE_PEPPER`、核對 D1 binding、公開 API／CSRF／Cookie／限流，再獨立啟用 native login。正式啟用前保持 `CLOUD_AUTH_PHASE=disabled`。

## 已完成的 Production Schema 歷史

首次空庫 Migration 已由 [Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 成功完成，請勿重複執行。接下來只需建立 Production Owner，不需要重新建表、重新備援 Restore 或更改既有 Migration SQL。

此文件是操作與開發交接，**不代表任何 Production 寫入已執行，也不構成自動授權**。
