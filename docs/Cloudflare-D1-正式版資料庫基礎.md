# Cloudflare D1 正式版：資料庫基礎建設交接（RB-023）

> **狀態：程式／測試階段，非可交付營運版。** 這份工作建立資料庫結構和只讀健康探測；沒有完成業主登入、營運 API、D1 遠端安裝、Google Drive 備份或正式安全驗收。

## 與原有系統的關係

- 本機版仍由 `server.js` + `node:sqlite` 使用 `data/restaurant.sqlite`（版本 v3）；保留現有角色、庫存交易、安全稽核與備份實作。
- Cloudflare Worker 仍以 `vercel-demo/` 的**虛構資料**提供靜態 UI；所有正式 `/api/*` 除 `/api/health` 外一律拒絕寫入（HTTP 503），不接受真實帳號或業主資料。
- `cloudflare/migrations/0001_initial_v3.sql` 根據 `db/schema.sql` 建立**空白 D1** v3 結構，包含 22 張表（21 張現有業務表及 `cloud_schema_contract`）與既有索引、FK、CHECK。**不建立預設 owner 或隨機密碼**。
- D1 `d1_migrations`（由 Wrangler 管理）與本專案的 `cloud_schema_contract` 分工：前者記錄腳本是否已執行；後者標示應用所需 Schema contract v3。兩者都不能代替結構與資料驗收。
- `cloudflare/d1-readiness.mjs` 只執行 SELECT／讀取 sqlite_master；`GET /api/health` 保持 `status: demo_only`、`api: not_implemented`、`production_ready: false`。即使資料庫結構存在，也**不得**回覆 production_ready=true。
- 不做本機 SQLite → D1 的自動資料匯入，也不會修改既有業主 SQLite 或其備份。

## 為何暫時不在正式 wrangler.jsonc 綁定資料庫

尚未授權或建立 Cloudflare D1 資源。正式 `wrangler.jsonc` 繼續使用空的 `previews: {}`，確保 GitHub PR Preview 與正式部署不會使用亂填 UUID 或意外共用業主資料。

已提供**不會被自動載入**的綁定範本：

- `cloudflare/wrangler.d1.example.jsonc`：正式 D1 與 Preview D1 各自的 `database_id`。
- `cloudflare/wrangler.preview-migrations.example.jsonc`：僅供測試 D1 遷移的 Wrangler CLI 專用設定。

注意：**Cloudflare Worker Previews 不會繼承 Production 的 D1 綁定，但如兩者或不同 PR 指向同一 D1 UUID，就會共用資料**。因此必須分配至少兩個不同資料庫；正式庫不可提供給 PR Preview。

## 一次性設定步驟（操作者有 Cloudflare 權限後）

1. 在 Cloudflare 帳號建立**兩個全新、空白** D1：
   `npx wrangler d1 create restaurant-business-staging`
   `npx wrangler d1 create restaurant-business-prod`
   記錄 Cloudflare 回傳的兩個不同 UUID。**請勿在公開 Issue 或 PR 提交 API token、OAuth token、密碼或正式資料**；D1 ID 不是授權秘密，但必須確認 ID 指向正確資源。
2. 把 `cloudflare/wrangler.d1.example.jsonc` 內容複製到專案根目錄的 `wrangler.jsonc`，替換兩個 UUID，提交前確認 Preview ID **不等於**正式 ID；保留 `previews` 區塊。
3. 另外把 `cloudflare/wrangler.preview-migrations.example.jsonc` 複製成根目錄 `wrangler.preview-migrations.jsonc`，其 `STAGING_DB` UUID 必須與 `wrangler.jsonc` 的 `previews.d1_databases` 完全一致。
4. **先在測試 D1 執行遷移**，明確檢查目標資料庫名稱與 UUID 後再執行：
   ```sh
   npx wrangler d1 migrations list STAGING_DB --remote --config wrangler.preview-migrations.jsonc
   npx wrangler d1 migrations apply STAGING_DB --remote --config wrangler.preview-migrations.jsonc
   ```
   之後用測試資料庫驗證 `cloud_schema_contract`、`PRAGMA foreign_key_check`，並確認 Preview URL 的 `/api/health` 僅標示 `database: schema_only`。
5. 正式 D1 遷移須**另外人工確認**全新目標與備份／回復策略後才能執行：
   ```sh
   npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
   npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
   ```
   生產資料庫絕不在一般 `git push` / Cloudflare Builds 自動執行 migration。未經審核不得對已有營運資料的庫套用初始版本。
6. 完成後重新部署並分別驗證正式網站及 Preview；Cloudflare Builds 的 `npx wrangler preview` 仍須維持預覽環境。正式 `/api/health` 的 `schema_only` **僅代表結構可讀**；正式 API 仍未實作。

## 下一批必須完成的工作

1. D1 專用 Worker Auth（安全密碼雜湊策略、登入防爆破、HttpOnly Secure Cookie、CSRF、帳號停權撤銷 Session），**先經正式威脅檢視**。原本 `scryptSync` 不可不經測試直接搬到 Worker。
2. 各模組查詢與原子性變更（尤其 `stock_moves` 是庫存唯一事實、核准後一次性驗收入庫、盤點變更版本衝突）；D1 非同步 API 並非可直接套用同步 `node:sqlite` 的交易函式。
3. 分門市 RBAC、SQL 查詢範圍、稽核，及整套回歸／端對端測試。
4. Google Drive 異地**加密備份**、還原演練與保留政策；D1 Time Travel 也不能取代異地備份。
5. 舊 SQLite 若已有資料，先另行訂定**校驗及搬遷程序**，不可執行初始化覆蓋。
6. Cloudflare 正式 Preview、正式線上驗收、域名與業主同意後交付。**目前不要輸入真正員工個資或業務資料。**

## 官方參考

- [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers Previews 及資料隔離](https://developers.cloudflare.com/workers/previews/resources/)
- [D1 Foreign Keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
