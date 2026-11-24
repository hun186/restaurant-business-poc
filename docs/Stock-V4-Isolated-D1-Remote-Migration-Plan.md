# 餐廳好管家｜Stock v4 獨立 D1 實機遷移驗證路線

> **2026-11-23：只完成隔離 G6 目標的預先註冊安全框架，不是已執行遠端遷移。**
> 關聯：Issue #212／#176；Production、Staging 與 G5 Recovery 演練目標不得拿來替代。

## 2026-11-23｜G6 實機唯讀驗收與下一階段狀態

- **新 G6 遠端空庫唯讀驗證已 PASS**：[Actions #45099304913](https://github.com/hun186/restaurant-business-poc/actions/runs/45099304913) 在 Main `3ee1e1200efbf831524c925f575388ffef063bac`，`STOCK_V4_DISPOSABLE_PRISTINE_READONLY_PASS`，Identity／pristine schema／quick_check／Time Travel bookmark 可讀均真實通過；不得重做此項以充數。
- **Production v3 遠端唯讀來源 Gate 已 PASS**：[Actions #45095751400](https://github.com/hun186/restaurant-business-poc/actions/runs/45095751400)；v3 contract、兩筆既有 migration、歷史流水及 FK/quick_check 合格；無生產寫入。
- **本 PR 新增 G6 Worker／Pages 直接綁定唯讀盤點**：`d1-stock-v4-disposable-binding-readonly.yml`，Branch `main`、confirm `CHECK_G6_BINDINGS_READONLY`。繼承既有 G5 經實機驗證的 Worker Scripts／versions 與 Pages 分頁枚舉機制，但只檢查新的 G6 固定 UUID。尚未實機執行、不得先標記 PASS；即使無直接綁定，也不代表間接存取、獨占、人工作業核准已完成。
- **寫入階段仍未開始**：本 PR 不建立遠端 v3/v4 schema、不執行任何 D1 SQL write、不使用 Write Token、不執行 Restore，也不開 Production Gate。真正的 G6 synthetic 版本化 v3→v4 migration + Postflight 必須另有受審 PR 與獨立寫入許可。

## 已確認的前置證據

- 正式營運加密 Export、Verify、Copy Verify 與同一來源 [5] memory-only v3→v4 rehearsal 均有使用者實機 PASS（Issue #212／#176），未進行正式升級。
- [G5 readonly inspect #45045820720](https://github.com/hun186/restaurant-business-poc/actions/runs/45045820720) PASS；[G5 Binding inventory #45046728884](https://github.com/hun186/restaurant-business-poc/actions/runs/45046728884) 及 [#45046757404](https://github.com/hun186/restaurant-business-poc/actions/runs/45046757404) 均未發現直接 Worker/Pages 綁定。
- G5 Time Travel **真實 Restore 未執行**，其原有專屬 D1 必須保留給獨立恢復演練。也尚未核實異地備份、獨占及間接存取。
- Production v3 stock source readonly 預檢見 PR #253；其 CI/Review/程式上線與實機 Cloudflare 遠端 PASS 是不同證據。

## G6 專屬隔離資料庫：事前建立與代碼鎖定

需由操作者在原 Cloudflare 帳戶 `31b409b04896d260ba0fadf6cc2bb305` 中建立**全新空白、未綁定任何 Worker／Pages、沒有營運資料**的 D1，名稱精確為：

`restaurant-business-stock-v4-disposable`

**暫勿將正式庫的任何備份、帳號、密碼或店務資料放入 G6。** 操作者於 2026-11-23 回報已建立名稱為 `restaurant-business-stock-v4-disposable` 的 G6，並提供 UUID `909037ca-bb9d-45d3-b090-bc2af0e5951f`。本次獨立 UUID Pin PR 將此 ID 以安全 SHA-256 清單、CI 與 Codex Review 管控；**UUID 只是操作者提供的候選識別，尚未透過 Cloudflare API 證明名稱、空白 Schema、Time Travel 或無綁定**。不可用舊 G5 Inspect PASS 代替 G6 新庫驗收。待本 PR 合併且 Main CI PASS，才可手動執行 G6 read-only Inspect。

G6 pin 必須與以下所有保護目標不同：

- Production `b882a6e8-0e56-49a6-bd41-1a6cadd726c9`
- Staging `2c355bed-d9c3-449c-aa9b-1018f3bc1177`
- G5 現行 Recovery `04566a27-cd95-4415-9bd7-c3e19d60ab6c`
- G5 已停用舊目標 `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`

## 第一階段：僅唯讀 G6 inspect

成功 pin 並且通過 CI／Review／Main 後，從 `.github/workflows/d1-stock-v4-disposable-inspect.yml` 手動 Run workflow：

- Branch：`main`
- confirm：`CHECK_STOCK_V4_DISPOSABLE_READONLY`

只允許固定 URL 的 Cloudflare GET metadata、GET Time Travel bookmark，以及兩個明確的唯讀 SQLite SQL：

- `SELECT type,name,tbl_name FROM sqlite_master WHERE substr(lower(name),1,7) <> 'sqlite_' ORDER BY type,name;`
- `PRAGMA quick_check;`

`STOCK_V4_DISPOSABLE_PRISTINE_READONLY_PASS` **僅證明**目標身分、空白結構與 Bookmark 可讀；不證明沒有間接存取、沒有人正在使用、更不授權 Migration/Restore/Production。若 Cloudflare 的既有 G5 專用 readonly token 未包含 G6 權限，應更新獨立最小權限配置，不可借用正式寫入 Token 來繞過。

## 2026-11-23 G6 實機唯讀證據與獨立 Binding Gate（新）

- [G6 inspect #45099304913](https://github.com/hun186/restaurant-business-poc/actions/runs/45099304913) 已真實 **PASS**：`STOCK_V4_DISPOSABLE_PRISTINE_READONLY_PASS`、`isolated_target_identity_verified=true`、`empty_schema_verified=true`、`time_travel_bookmark_available=true`；輸出亦明確 `no_direct_worker_binding_certified=false`、`exclusive_use_verified=false`、`remote_v4_migration_performed=false`。無須重跑 G6 空庫 Inspect。

- 本次 PR 新增 **獨立 G6 Worker／Pages 直接綁定盤點**：重用原 G5 經實機驗證的完整 Worker Versions 分頁、Pages Project 分頁及安全錯誤處理，僅將目標鎖定為受控 G6 Pin，名稱和 UUID 不允許任意輸入。Main CI／正式 Codex 審查合格後，手動執行 `.github/workflows/d1-stock-v4-disposable-binding-readonly.yml`，Branch=`main`，confirm=`CHECK_G6_BINDINGS_READONLY`。使用現有 **GET-only** `d1-recovery-drill-binding-readonly` Environment 和 `CLOUDFLARE_G5_BINDINGS_READ_TOKEN`（此名稱為既有唯讀資源，**不得**換用 Write Token）。

- 若盤點發現任何 G6 Worker/Pages D1 直接綁定、結果不完整，或存在不能核實歷史部署綁定的 Pages Project，該工作流程會 fail-closed。只有日誌實際輸出 `G6_STOCK_V4_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED` 才能標記**機器盤點未發現直接綁定**；即使這個狀態出現，也**不代表**已完成間接 Service Binding/外部存取、人員獨占、人工獨立簽核或 Migration 授權。

- 這是 G6 空庫 Inspect 之後、真正遠端合成資料 v3→v4 版控 Migration 之前的一個唯讀關卡。正式 Production 與 G5 Recovery 不會被修改。

## 2026-11-23｜G6 v4 Postflight 唯讀驗收器（待遠端 Migration 後才可實機執行）

- [PR #256](https://github.com/hun186/restaurant-business-poc/pull/256) 已在 HEAD `09988d0a2c76c44ffdb2cc3670b1f5f7590ba7bc` 取得 5/5 CI 及正式 Codex Review 0/0 後合併。這只使 **G6 綁定盤點程式**可用，尚未實機執行該 Workflow。必須等 Main CI 完成後再手動做 G6 binding inventory，否則不得推進遠端寫入階段。

- 新增 `tools/cloudflare-stock-v4-g6-postflight.mjs` 與 **after-migration only** 工作流程 `d1-stock-v4-disposable-postflight-readonly.yml`。這項 Gate 要在 **另行審查、明確授權、真正執行 G6 synthetic v3→v4** 後，才可能通過；空白 G6 現在執行會預期 **FAIL**，不得把這種失敗誤判為實機驗證已完成。

- 驗證固定 G6 身分、完整三筆 `d1_migrations` 的精確 ID（1、2、3）與名稱、`cloud_schema_contract=3`、`stock_move_kind_contract=4`、v4 CHECK 約束語句、九欄 ledger、複合索引、`foreign_key_check`、`quick_check`；嚴格比對五筆**固定虛構** movement（兩筆 v3 purchase/usage＋三筆 v4 supplier_return/scrap/adjustment），及一筆虛構 audit 和 price；同時逐表驗證完整資料表清單、不得新增非預期 View／Trigger、14 個其他業務表均為空、backup_settings 維持預設值，並核對庫存欄位型別、NOT NULL 與主鍵設定。另須逐欄核對虛構 Owner 的顯示名稱／非真實憑證欄位、門市與食材狀態，以及 backup_settings 的歷史備份欄位均為 NULL，不能只比對 IDs 而放過混入的真實營運資訊。出現未知／多出紀錄、帳號、綁定 UUID 錯誤、任何 SQL／DDL 不符即 fail-closed；**只輸出計數和固定 PASS/FAIL，不輸出任何查到的資料列**。

- 執行方式：完成 G6 實機 migration 後，從 Main 手動執行該 Workflow，confirm=`CHECK_G6_V4_POSTFLIGHT_READONLY`，使用既有 `d1-recovery-drill-readonly` Environment 與最小權限 `CLOUDFLARE_D1_DRILL_READ_TOKEN`。Token 只在 SHA-256 preflight 之後交給工具；實際網路限於 pinned G6 的 GET metadata、POST **固定字面** SELECT/PRAGMA。無 Wrangler、SQL 寫入、Migration、Restore 或 Production Gate 權限。

- **限制**：這是合成資料的遷移後驗收器，不是遷移執行器，不是直接／間接綁定隔離保證，不是 Production 遷移授權。實機 Postflight 目前尚未執行，應保留 Pending。

## 第二階段：需要**另開受審 PR** 的遠端 Migration 實驗（尚未開發完成）

1. 使用獨立受保護的 Write Environment、經審查的精確 G6 UUID 和 SHA、固定工單及人工獨占確認。先進行遠端 metadata／空庫預檢，Write token 必須在全部 Gate 後才提供。
2. 僅在 G6 安裝版本化 **v3** 0001/0002（應得到兩筆正確的 `d1_migrations`）。不得使用既有 `d1-staging-migration.yml`（它只針對既有 Staging 空庫的初始化）。
3. 僅在 G6 插入完全虛構 Owner／門市／食材／歷史採購、耗用與稽核流水；保存資料指紋，確定 v3 基線符合預期。**不得使用 Production 備份。**
4. 使用受審之 Wrangler/D1 版本化 **0004_stock_move_kinds.sql** 在相同 G6 升級，不許孤立執行 DDL 而缺失第三筆 migration receipt。
5. 遠端 Postflight 核對 `cloud_schema_contract=3`、`stock_move_kind_contract=4`、**精確三筆** receipts、歷史 ledger／audit 一致、FK／quick_check、索引與約束；另以全新可銷毀 G6 測試場景驗證故意失敗的 Rollback 與正確的 Supplier Return／Scrap／Adjustment 業務原子性。
6. 若演練未知結果或中途斷線，先唯讀調查；**禁止無條件重跑 Migration**。Time Travel Restore／完整回復應在獨立授權下做足並記錄結果；最後由操作者回收獨立 G6，勿修改 G5／Staging／Production。
7. 以上遠端實驗與 Production v3 唯讀 Gate 都通過後，再依 `docs/Stock-V4-Production-Controlled-Release-Handoff-20261122.md` 取得正式維護窗口及升級授權；Production 遷移與兩個 v4 Gate 仍各自獨立決策。

**本次 UUID Pin PR 不包含任何 Write Environment、D1 遷移命令、可寫 Token、Worker 綁定、Restore 或 Production Gate 的變動。** 只註冊操作者提供的專用 G6 ID，並在一般 Scratch 工具中保護 G6 不被誤用。
