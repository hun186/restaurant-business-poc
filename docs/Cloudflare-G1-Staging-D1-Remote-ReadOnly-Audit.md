# P0 #34 / G1：Cloudflare Staging D1 遠端只讀驗收

## 程式交付不等於現場驗收
本 PR 增加 .github/workflows/d1-staging-live-readonly-g1.yml 與 tools/cloudflare-staging-live-audit.mjs，只供在合併 main、最新 HEAD Hosted CI / Codex Review 通過、取得 d1-staging 授權之後由 GitHub Actions 手動執行。PR/CI PASS 不是已驗證遠端 Staging。

## 手動執行
GitHub Actions > D1 staging G1 remote read-only snapshot (manual only) > main，輸入 CHECK_STAGING_G1_READONLY。Workflow 只能手動觸發、main-only，不能 PR/push/schedule 自動觸發。d1-staging Environment 應設定必要的人工核准與 Staging 專用 Secrets。
先執行封閉 SHA-256 來源驗證，確認固定 Staging D1 ID / Cloudflare Account ID（不得等於 Production D1），再安裝固定 Wrangler 4.152.0。安裝過程無 Cloudflare Token，只有最後只讀查詢步驟才有 Secret。
SQL 只查：sqlite_master tables、cloud_schema_contract v3、d1_migrations 的 0001+0002、三個 idx_login_attempts 索引定義、PRAGMA foreign_key_check、users/owner/sessions/purchase_orders/stocktakes/stock_moves 的 COUNT 彙總。
不查單一帳號、帳密、Token、Session 明細或營運交易內容。原始 JSON 僅存 GitHub Runner RUNNER_TEMP，umask 077，trap 刪除；不輸出原始資料也不上傳 Artifact。任何不一致均 Fail Closed，記錄只有狀態，不列印敏感內容。

## 成功界線與上線風險
只有真正執行完成的 GitHub Workflow Run 才能算 G1 遠端 Staging 資料表、Migration、索引、FK、Owner 摘要的一次性現場證據。無法由此證實 G0 所有公開網址、G2 Cloudflare Access 或 Hosted PBKDF2 CPU、G3 受控遠端營運異動、G4 業主完整操作、G5 正式 D1 與加密備份/還原、G6 業主 UAT。Production CLOUD_AUTH_PHASE=disabled 且 /api/command HTTP 503 必須繼續維持。不得上傳任何私下 Access 證據、Cloudflare 金鑰或真實營運資料到公開 GitHub。
