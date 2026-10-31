# G5｜Production D1 空庫首次初始化：安全預檢與人工放行

## 已確認的起點
- `G1` 遠端 Staging D1 唯讀驗收 [Run 40854101717](https://github.com/hun186/restaurant-business-poc/actions/runs/40854101717) completed/success，確認 v3、0001/0002、外鍵及一位 Staging Owner。這是 Staging 證據，不是 Production 寫入授權。
- 2026-10-29 使用者在 Cloudflare Production D1 Studio 實際查詢僅有保留系統表 `_cf_KV`；目前沒有業務 Schema，`/api/health` 回報 schema_uninitialized／demo_only。此時正確策略是先制定 Production 空庫 guard，**不是自動初始化**。
- 外部 Cloudflare Workers Assets 上傳 `10013` 與 D1 Schema 分屬不同問題，詳見 Issue #42。即使 Migration 完成，仍必須保留 `CLOUD_AUTH_PHASE=disabled`、公開 `/api/command` 503。

## 2026-10-31 補充：真正空庫可選 one-time first-init（**新增安全選項，非已授權寫入**）

真正 Cloudflare [Run #41207484827](https://github.com/hun186/restaurant-business-poc/actions/runs/41207484827) 在 Production 目標上完成唯讀、嚴格空庫和 PRAGMA quick_check 檢查：`PROD_D1_PRISTINE_READONLY_PASS`、`production_write_performed:false`。原先兩次 [#40914927490](https://github.com/hun186/restaurant-business-poc/actions/runs/40914927490)／[#41046807367](https://github.com/hun186/restaurant-business-poc/actions/runs/41046807367) **只完成 disposable inspect，真正 Restore job 均 skipped**，不可聲稱已演練。

為避免一個從未存入營運資料的全新空白 Production DB 卡在不相稱的「先真實 Restore」程序，本 PR 在**保留舊 `apply` 及 `RECOVERY_REHEARSED_AND_APPROVED` 全部原始防線**下，新增需**另一組獨立放行**的 `first-init` 模式：只能對真正空白庫套 0001/0002 建表、不能 Owner Bootstrap、不能登入、不能改動營運資料。

### 一次性 first-init 人工設定（需此 PR 合併、獨立准許正式寫入之後）

在 GitHub Environment `d1-production-migration` 手動設定 **Variables**（不是 Secrets；都是非敏感的 release 確認）：

| 名稱 | 精確值 |
| --- | --- |
| `PROD_D1_FIRST_INIT_RELEASE_SHA` | 這次 PR 合併後通過完整 CI／正式 Codex Review 的 **main 40 字 SHA**；每個 release 重新指定 |
| `PROD_D1_FIRST_INIT_APPROVED` | `PRISTINE_EMPTY_PRODUCTION_SCHEMA_ONLY` |
| `PROD_D1_FIRST_INIT_PREFLIGHT_RUN` | `41207484827` |

該 Environment 的 dedicated Secrets `CLOUDFLARE_PROD_D1_WRITE_TOKEN`（僅必要 Production D1 讀寫權限）和 `CLOUDFLARE_ACCOUNT_ID` 仍必須由操作者另外在 GitHub 設定；不可重用 Staging Token，亦不可貼在對話、公共 PR 或日誌。原本 `d1-production-readonly` 的唯讀環境保持不變。部署操作員應先確認指定 DB 沒有使用者或並行 writer。

打開原先 workflow `d1-production-initialize-g5.yml` → `Run workflow`，分支 `main`，一次性 **mode=`first-init`**，填寫：

- `confirm` = `INITIALIZE_PRISTINE_PROD_D1_V3_0001_0002`
- `expected_main_sha` = 這次 PR 合併後的 main **完整 40 字 SHA**
- `first_init_ack` = `I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL`
- `pristine_run` = `41207484827`
- `recovery_ack` **留空**（絕不可偽稱 Restore 演練已完成）

任何錯誤／遺漏值皆拒絕，且拒絕在動用 Production Write Token **之前**發生。先由獨立 Environment 完成真正遠端只讀空庫 Preflight；於寫入 Environment 再確認當前 main SHA、獨立操作員核准與既有的完全相同 22 表／2 遷移檔 SHA 清單，再次查空庫及完整性、取得**不公開的復原 bookmark**，才會執行 `wrangler d1 migrations apply PROD_DB --remote`。最後比對 22 張業務表 + Ledger + 3 個索引、FK、quick_check 及 0 Owner／Session／營運記錄；任何不符即中止，不會清庫或重試。

**注意風險與復原：** 這條快速路線**刻意不宣稱已完成真實 Restore drill**；書籤只是可用復原點的證據，不等於已驗收還原。Cloudflare D1 Time Travel 在 Free 方案僅保留至多 7 天、Restore 會覆寫資料。正式存入資料前，仍須有可執行的獨立備份／回復方案與演練。Migration 0001 成功、0002 失敗時，資料庫可能停在部分初始化狀態：**絕不直接重跑或強行清空**，應凍結寫入、保存原狀與日誌、人工診斷。首次初始化成功後，操作者應撤銷／清除上述三個一次性放行 Variable 與 Write Token。

以上只建立**可受控啟動的程式管線**；任何 PR Merge 都不會自動呼叫遠端 D1 寫入，也不能作為已完成使用者授權。真正的正式初始化仍需專屬行動與操作員簽署核准，Owner 密碼與原生登入需另一階段。

## Workflows 與模式
新增 `.github/workflows/d1-production-initialize-g5.yml`，**只有 `workflow_dispatch`、只有 `main`，沒有 push、PR 或 schedule 觸發**。使用獨立 `wrangler.production-initialize.jsonc`，僅宣告 `PROD_DB` 一個 D1 binding，固定 Production ID；不包含 Worker main、Assets、Route 或任何自動部署。對比 `wrangler.jsonc` 和 `wrangler.preview-migrations.jsonc`，拒絕 Production / Staging 交換。完整檔案及 Workflow 在執行前經現有 SHA-256 封閉清單驗證。

### 模式 A：唯讀預檢（預設安全途徑）
手動選 `main`，mode=`preflight`，confirm=`PROD_D1_READONLY_CHECK`，工作流程在 Environment `d1-production-readonly` 內使用專用只讀 `CLOUDFLARE_PROD_D1_READ_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。完成固定 Wrangler 4.152.0 的無憑證安裝後，才執行遠端 `PROD_DB` 的 `sqlite_master` 結構與 `PRAGMA quick_check` 唯讀查詢。
只允許恰好一個 `_cf_KV` 保留表與其自身允許的內部索引；任何額外 table、view、trigger、index、已有 `d1_migrations`、SQL 查詢錯誤、非 OK 快速檢查均中止。只有受控 Runner 暫存原始 JSON，umask 077 並於 EXIT 刪除。不公開帳戶 ID、原始表清單或令牌。
成功只代表 `PROD_D1_PRISTINE_READONLY_PASS`：沒有 Migration、沒有 Owner bootstrap、沒有營運異動。

### 模式 B：真正 Production Schema 初始化（目前 **不授權執行**）
**開發 PR Merge 並不是可以執行這個模式的授權。** 需先完成獨立的 Production 回復演練、核對 Cloudflare D1 backend/Time Travel 是否可還原、實際備份與復原責任人、業主批准，以及 GitHub `d1-production-migration` Environment 的 required reviewers 和保護措施。
GitHub Environment `d1-production-migration` 必須事先由授權操作者手動設置三個非秘密 **環境變數**：
- `PROD_D1_SCHEMA_APPLY_RELEASE` = 已通過 Hosted CI / Codex Review 並正式授權的 `main` **完整 40 字 SHA**（每次 Release 需重設）。
- `PROD_D1_RESTORE_DRILL_SIGNED_OFF` = `RECOVERY_REHEARSED_AND_APPROVED`；不可以在沒有實際演練與完整證據前填入。
- `PROD_D1_G1_REVIEWED_RUN` = `40854101717`（需核對該次 Run 仍有效且真的是此次 Staging 實證）。
並在該 Environment 中提供專用最小權限 `CLOUDFLARE_PROD_D1_WRITE_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，權限僅限必要的 Production D1 schema migration；不可使用 Staging Token，亦不可將 Token 放入公開 Commit 或 Issue。
操作者在手動 Workflow 選 mode=`apply`、confirm=`INITIALIZE_EMPTY_PROD_D1_V3_0001_0002`、expected_main_sha=完整 `main` SHA、recovery_ack=`RECOVERY_REHEARSED_AND_APPROVED`。所有條件、人工 Environment 審批、兩道獨立 DB 空庫預檢、遷移 SHA-256 與來源檔案白名單都通過後，才呼叫 **一次** `wrangler d1 migrations apply PROD_DB --remote --config wrangler.production-initialize.jsonc`。
本次方案**明確安裝兩份**現有遷移：`0001_initial_v3.sql`（22 張表及 v3 Contract）和 `0002_login_attempts_window_indexes.sql`（3 個登入索引），不使用 Staging migration workflow、不建立 Owner、不登入、不執行業務 API、不修改 Worker。

完成後的唯讀核對必須嚴格比對 22 張業務表 + `d1_migrations`、v3 Contract、恰好 0001/0002 Migration、3 個預定 Index、外鍵零錯誤、`PRAGMA quick_check=ok`，且 users/sessions/locations/purchase_orders/stocktakes/stock_moves/audit_logs 均為 0。結果字樣只能是 `PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS`，絕不表示 Production Ready。

## 回復、限制與停損
- D1 Time Travel 可支援回復，但恢復會覆寫資料，具有破壞性；需在正式寫入之前獨立確認資料庫 backend 的 Time Travel 支援及保留天數，完成實際復原演練及異地備份/RTO-RPO。參考：https://developers.cloudflare.com/d1/reference/time-travel/ 。
- apply workflow 在實際寫入前要求取得 Time Travel bookmark 的證據，**不自動執行任何 Restore**；該 bookmark 不輸出到公開 GitHub Log/Artifact。Wrangler 每個 migration 成功/失敗有自帶處理；若第一份成功、第二份失敗，**不得盲目整批重跑或清庫**，人工保存狀態、檢查 ledger、按經審核的復原計畫處理。
- 遠端預檢與寫入間仍存在其他操作者介入的競態：需要受控變更窗口、暫停其他生產 D1 writers、固定 Environment 人工審批；不能把兩次查詢宣稱為跨 API 的不可競態交易。
- **截至此 PR 開發，不曾真正呼叫 Cloudflare Production D1 Migration。** 需最新 HEAD Hosted CI/Codex Review，使用者另行允許 PR Merge；接著 **還須另一個明確的 Production apply 授權**，不可用 Merge 指令代替執行授權。
- Cloudflare 正式登入/實際業務操作、Access、Workers CPU、備份/恢復證據、業主 UAT 仍屬 G2–G6 後續獨立放行。

參考：https://developers.cloudflare.com/d1/wrangler-commands/ 、https://developers.cloudflare.com/d1/reference/time-travel/
