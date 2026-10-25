# Cloudflare D1 正式版：資料庫基礎建設交接（RB-023）

> **狀態：程式／測試階段，非可交付營運版。** 這份工作建立資料庫結構和只讀健康探測；沒有完成業主登入、營運 API、D1 遠端安裝、Google Drive 備份或正式安全驗收。

## 與原有系統的關係

- 本機版仍由 `server.js` + `node:sqlite` 使用 `data/restaurant.sqlite`（版本 v3）；保留現有角色、庫存交易、安全稽核與備份實作。
- Cloudflare Worker 仍以 `vercel-demo/` 的**虛構資料**提供靜態 UI；所有正式 `/api/*` 除 `/api/health` 外一律拒絕寫入（HTTP 503），不接受真實帳號或業主資料。
- `cloudflare/migrations/0001_initial_v3.sql` 根據 `db/schema.sql` 建立**空白 D1** v3 結構，包含 22 張表（21 張現有業務表及 `cloud_schema_contract`）與既有索引、FK、CHECK。**不建立預設 owner 或隨機密碼**。
- D1 `d1_migrations`（由 Wrangler 管理）與本專案的 `cloud_schema_contract` 分工：前者記錄腳本是否已執行；後者標示應用所需 Schema contract v3。兩者都不能代替結構與資料驗收。
- `cloudflare/d1-readiness.mjs` 只執行 SELECT／讀取 sqlite_master；`GET /api/health` 保持 `status: demo_only`、`api: not_implemented`、`production_ready: false`。即使資料庫結構存在，也**不得**回覆 production_ready=true。
- 不做本機 SQLite → D1 的自動資料匯入，也不會修改既有業主 SQLite 或其備份。

## 2026-10-25｜已取得資料庫 ID，正式／Preview 綁定已提交 PR #13

使用者已在自己的 Cloudflare 帳號內建立兩個不同的 D1 資源。**本 PR 僅提交 Worker 綁定設定，不代表遠端 Schema 已安裝或系統可用。**

| 用途 | D1 Database | UUID |
| --- | --- | --- |
| 正式版 | `restaurant-business-prod` | `b882a6e8-0e56-49a6-bd41-1a6cadd726c9` |
| GitHub PR Preview | `restaurant-business-staging` | `2c355bed-d9c3-449c-aa9b-1018f3bc1177` |

- 根目錄 `wrangler.jsonc` 的**頂層** `d1_databases[0]` 綁定 `DB` → **prod**，`previews.d1_databases[0]` 綁定 `DB` → **staging**。部署命令保持 Cloudflare Builds 的 `npx wrangler deploy` 和 PR Preview 的 `npx wrangler preview`。
- 根目錄 `wrangler.preview-migrations.jsonc` 只綁定 `STAGING_DB` → **staging**，供人工執行測試庫 Migration。此檔案不作為 `wrangler deploy` 的設定，也不會被 GitHub CI 自動執行。
- `cloudflare/wrangler.*.example.jsonc` 仍保留為不會自動生效的泛用範本，**實際使用的是根目錄的兩份設定**。
- UUID 是 D1 資源識別碼，不是授權密碼；不得把 Cloudflare API Token、OAuth Token、服務金鑰、業主帳密、員工資料或任何 SQLite 備份提交到公開 GitHub。
- **兩個 ID 不能相同**。Cloudflare 官方提醒：共用相同 D1 ID 的不同 Previews 會共用資料列，因此各 PR Preview 目前會共用上述 staging，切勿用於真實資料；日後如需 PR 間完全隔離，還要各建不同測試 D1。
- Cloudflare Workers Preview 本身**不會自動執行資料庫 Migration**，即使 Build/Deployment Success 也不代表 D1 已初始化。

## 尚待執行：測試 D1 遠端 Migration

以下指令需在具備該 Cloudflare 帳戶權限的終端機、GitHub 專案根目錄執行；目前 GitHub Connector 並未取得 Cloudflare D1 遠端執行權限，**尚未執行**：

```sh
# 先核對 staging 目標綁定是否正確（不是正式庫）
npx wrangler d1 migrations list STAGING_DB --remote --config wrangler.preview-migrations.jsonc
# 確認是全新空庫後才執行，會建立既有 SQLite v3 的空白表格結構
npx wrangler d1 migrations apply STAGING_DB --remote --config wrangler.preview-migrations.jsonc
# 唯讀確認 Schema contract
npx wrangler d1 execute STAGING_DB --remote --config wrangler.preview-migrations.jsonc --command "SELECT contract_version FROM cloud_schema_contract WHERE id=1"
```

完成 staging Migration 後，再重新部署 PR Preview；`/api/health` 預期資料庫欄位為 `schema_only`，**但仍必須保持 `api:not_implemented` 與 `production_ready:false`**。

## 正式 D1 Migration 的額外安全限制

絕不可只因 staging PASS 就自動對 prod 執行 migration。須先人工確認正式 D1 ID／名稱無誤、尚無營運資料、回復計畫及後續版本升級策略，並取得正式操作授權後，才可考慮：

```sh
npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

**不要把這兩行放入 Cloudflare Build command、GitHub push、Pull Request CI 或任一無需人工確認的自動部署流程。** Cloudflare 的自動部署只應發布 Worker 程式與靜態資源，不能自行變更業主的正式資料庫 Schema。


## GitHub Actions：只初始化 staging 的人工操作流程

本 PR 新增 `.github/workflows/d1-staging-migration.yml`，只在 GitHub `main` 可手動啟動（`workflow_dispatch`）；一般 Commit、PR 或 Cloudflare Builds 都不會執行。**新流程尚未合併 main 以前，在 Actions 頁面可能不會出現 Run workflow**。

建立並存入 GitHub Repository → Settings → Secrets and variables → Actions：
- `CLOUDFLARE_API_TOKEN`：Cloudflare 自訂 Token，僅授與此帳號的 D1 Read 和 D1 Write。請勿張貼到 Issue、PR、聊天或程式碼。
- `CLOUDFLARE_ACCOUNT_ID`：`31b409b04896d260ba0fadf6cc2bb305`。

**注意：Cloudflare 帳號層級 D1 Write 可能有能力修改正式 D1；只執行 staging 的限制來自受保護的 GitHub 工作流程，不是 Token 本身對正式庫的硬性隔離。** 正式營運前應考慮將測試庫移至另一 Cloudflare 帳號，或在初始化結束後撤銷這個短期 Token。

工作流程同時使用 GitHub Environment `d1-staging`。建議到 Settings → Environments 建立環境並設定 Required reviewers / Protected branches，增加人工核准與防止其他分支使用高權限憑證的保護。是否可設定審查人依 GitHub 計畫與可用功能為準。沒有額外的 Environment 規則時，不能聲稱已有第二層人工審批。

完成 PR 正式審查與使用者明確合併授權後：

1. 到 GitHub → Actions → `D1 staging schema initialization (manual only)`。
2. 選 `Run workflow`、分支 `main`，輸入 **`APPLY_STAGING_ONLY`**。
3. 工作會先檢查 GitHub Secrets、正確 Cloudflare Account ID、正式/測試 D1 UUID 差異、測試庫必須尚無任何業務表或 migration ledger。
4. 僅在全數通過後，使用 `STAGING_DB` 的獨立 Wrangler 設定執行 `migrations apply --remote`。
5. 工作結束前讀取測試 D1，確認完整 22 張表、D1 migration ledger、cloud_schema_contract v3、沒有外鍵錯誤、沒有建立 owner/員工。
6. 如果上一步失敗，**不要直接重新點 Run**，先查看 GitHub Actions 日誌與 staging D1 狀態；重新執行時前置空庫檢查可能因已寫入結構而拒絕，這是刻意保護。

這套流程不包括正式資料庫 Migration，也不會建立可登入的業主帳號；Schema 安裝成功仍然只是後端移植的其中一步。

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
