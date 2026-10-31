# Cloudflare Production D1 — Owner 一次性建立（未開放執行）
 
## 目前狀態
- 主線 `26028441205b6d365b09fa0c7d11806eb237bd7e`：PR #83 已 Merge，postmerge Verify #41210737227 5/5 PASS。
- [Run #41207484827](https://github.com/hun186/restaurant-business-poc/actions/runs/41207484827) 是**正式 D1 空庫的唯讀檢查**，沒有建表或建立 Owner。
- 真正 `first-init` 必須由有權管理 GitHub/Cloudflare 的操作者，在 `main` 手動執行 `.github/workflows/d1-production-initialize-g5.yml` 並取得 `PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS`，不能把唯讀 PASS 誤判為 Schema 已初始化。
- 本分支僅新增 `tools/cloudflare-production-owner.mjs` 的**不可遠端自動執行**的輔助程式和合成測試。原計畫的正式 Owner GitHub Actions 寫入 Workflow **尚未建立**：連線端安全檢查已阻擋建立，請勿宣稱已可在 Github Actions 一鍵操作。

## 提議的正式 Owner 建立流程（未實作 Live Workflow）
由獨立、具有 Production D1 最小寫入權限的受控管理員程序：
1. 重新核對 Production D1 的固定 DB ID、v3 schema marker、恰好 `0001_initial_v3.sql`／`0002_login_attempts_window_indexes.sql` 兩個 ledger，所有 20 個 Owner/Session/稽核與業務資料表均為空。
2. 從私密環境變數取得業主初始密碼（12–256 字元）；只在受控 Runner 計算 `pbkdf2-sha256$100000$...` 和獨立 16-byte salt。**不得提交、張貼或記錄密碼或原始 SQL。**
3. 再以原子 `INSERT ... SELECT ... WHERE` 確保所有資料表仍為空、v3 合約和兩個 Migration 未變，最多寫入一名 `owner`。不建立預設門市、無任何 Demo 資料，也不自動啟用登入。
4. 僅輸出去識別化 Postflight：一位 active Owner、有正確雜湊版本、無 Session/Login Attempt/Audit、外鍵零錯誤；失敗時保存診斷資料，不能直接重跑或清庫。
5. 完成後須由管理者設置 Cloudflare Worker Secret `NATIVE_AUTH_SOURCE_PEPPER`、核對 D1 binding、公開 API／CSRF／Cookie／限流，再獨立啟用 native login。正式啟用前保持 `CLOUD_AUTH_PHASE=disabled`。

## 手動初始化空庫的既有工作流程（**僅供操作者明確核准後使用**）
- URL: https://github.com/hun186/restaurant-business-poc/actions/workflows/d1-production-initialize-g5.yml
- Environment `d1-production-migration` 需設定 `PROD_D1_FIRST_INIT_RELEASE_SHA` = 當時 main 的完整 40 字 SHA、`PROD_D1_FIRST_INIT_APPROVED=PRISTINE_EMPTY_PRODUCTION_SCHEMA_ONLY`、`PROD_D1_FIRST_INIT_PREFLIGHT_RUN=41207484827`。
- 需要受控環境私密 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_PROD_D1_WRITE_TOKEN`；不要把 Secret 內容貼在 Issue/聊天中。
- Workflow 手動輸入：branch main，`mode=first-init`，`confirm=INITIALIZE_PRISTINE_PROD_D1_V3_0001_0002`，`expected_main_sha` = 當時 main SHA，`first_init_ack=I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL`，`pristine_run=41207484827`，`recovery_ack` 留空。
- 先經過新一次現場 Readonly 再用受控 Write Token；完成標誌是 `PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS`，**不是正式登入可用**。

此文件是操作與開發交接，**不代表任何 Production 寫入已執行，也不構成自動授權**。
