# Cloudflare D1 staging 既有資料庫安全套用 0002 索引

**狀態：部署工作流程正在 PR 審查，尚未對遠端 D1 套用 0002。**

## 背景與目標

- 既有 staging D1：`restaurant-business-staging`，v3 `0001_initial_v3.sql` 已在 GitHub Actions Run #40172089719 遷移完成。
- Run #40188578478 已在 staging D1 建立**一位**有效 `owner`，驗證無 Session。不可重新執行空庫 Migration 或 Owner 初始化工作流程。
- PR #17（已合併）新增 `0002_login_attempts_window_indexes.sql`：建立三組 `login_attempts` 查詢/清理索引，但遠端尚未套用。新的 Migration 保留原始 v3 合約和既有資料，正式 production D1 尚未初始化。

## 使用方式（PR 合併後，授權管理員自行操作）

1. GitHub `Settings → Environments → d1-staging` 檢查存取審批規則（**只設定 Environment 並不保證有審批員**）；確保環境具有 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`，且 Cloudflare Token 授權範圍適當。**不需**也不要恢復 `STAGING_OWNER_PASSWORD`。
2. 前往 `Actions → D1 staging incremental 0002 indexes (manual only)`，選 `main`，動作 `CHECK_STAGING_0002`，確認欄位輸入完全一致。這次只執行 Wrangler D1 遠端唯讀 SQL 與 Migration 清單，不會異動 DB。檢查日誌的 `STAGING_0002_PREFLIGHT_PASS`；若失敗，不應試圖繞過。
3. 若純檢查通過、**且已另外取得執行遠端資料庫 Migration 的授權**，可再選 `APPLY_STAGING_0002` 並輸入完全相同字串。Workflow 遵守 `refs/heads/main`、Environment `d1-staging`、與原始 staging Migration 相同的 concurrency lock。再次 preflight 通過才會呼叫 `wrangler d1 migrations apply STAGING_DB --remote --config wrangler.preview-migrations.jsonc`。
4. 完成後需確認 `STAGING_0002_POSTFLIGHT_PASS`、`STAGING_0002_APPLIED_VERIFIED`，且 `d1_migrations` 恰有 `0001_initial_v3.sql` 與 `0002_login_attempts_window_indexes.sql`；`idx_login_attempts_username_nocase_at`、`idx_login_attempts_ip_hash_at`、`idx_login_attempts_at` 三索引 DDL 符合預期、有效 Owner ID／角色／啟用狀態與 migration 前一致、schema v3 及外鍵無異常。
5. **若有任何前置資料不符合預期，停止操作。** 只有 CHECK preflight 通過不代表已套用；APPLY 成功但事後檢查失敗也不可宣告驗收通過。後續請保留 Run URL，供重新核對具體日誌。

## 防護與限制

- 部署腳本 `tools/cloudflare-staging-0002.mjs` 限定既有 Cloudflare account、staging UUID、含 22 個業務表與 `d1_migrations` 的 v3 schema、恰一名啟用 `owner`、Ledger 只有 `0001`，以及 `0002` 三索引都尚不存在。
- 檔案目錄恰有 `0001`、`0002` 兩個 SQL migration；`0002` 僅能含三條預期的 `CREATE INDEX`，不包含 `DROP TABLE`、刪改資料、憑證內容或重建 Schema。索引比對包括 Collation 和欄位順序。
- 對遠端的查詢結果僅寫入 GitHub Runner 暫存目錄，不輸出使用者資料或密碼；只查 Owner 的 ID、帳號名、角色與啟用狀態，不查密碼雜湊。其他正式業務資料完全不讀取，只有 Schema/ledger/外鍵查詢。
- Wrangler 官方 Migration 工具會辨識已套用的檔案、僅處理 pending migrations，並有自動備份／失敗時回滾機制；D1 的 Time Travel/point-in-time restore 也可提供復原可能，但仍需以當次 Cloudflare 實際系統為準，不應假設零風險。
- Workflow 不會透過 Push 或 PR 執行；只有通過人工確認、main 分支與 `d1-staging` Environment 條件才會呼叫 Cloudflare。**這不是 production rollout，也不是 Cloudflare Access 保護**。
- 正式 / Preview `/api/login` 仍 **503**，Production 的 Auth Phase 為 `disabled`。新增索引不代表雲端登入完成；下一階段仍需受保護的 staging 執行環境、PBKDF2 CPU 真機量測、來源 IP 信任與 rate-limit 競爭測試。

## 參考

- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
