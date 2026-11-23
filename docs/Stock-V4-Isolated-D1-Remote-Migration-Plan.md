# 餐廳好管家｜Stock v4 獨立 D1 實機遷移驗證路線

> **2026-11-23：只完成隔離 G6 目標的預先註冊安全框架，不是已執行遠端遷移。**
> 關聯：Issue #212／#176；Production、Staging 與 G5 Recovery 演練目標不得拿來替代。

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

## 第二階段：需要**另開受審 PR** 的遠端 Migration 實驗（尚未開發完成）

1. 使用獨立受保護的 Write Environment、經審查的精確 G6 UUID 和 SHA、固定工單及人工獨占確認。先進行遠端 metadata／空庫預檢，Write token 必須在全部 Gate 後才提供。
2. 僅在 G6 安裝版本化 **v3** 0001/0002（應得到兩筆正確的 `d1_migrations`）。不得使用既有 `d1-staging-migration.yml`（它只針對既有 Staging 空庫的初始化）。
3. 僅在 G6 插入完全虛構 Owner／門市／食材／歷史採購、耗用與稽核流水；保存資料指紋，確定 v3 基線符合預期。**不得使用 Production 備份。**
4. 使用受審之 Wrangler/D1 版本化 **0004_stock_move_kinds.sql** 在相同 G6 升級，不許孤立執行 DDL 而缺失第三筆 migration receipt。
5. 遠端 Postflight 核對 `cloud_schema_contract=3`、`stock_move_kind_contract=4`、**精確三筆** receipts、歷史 ledger／audit 一致、FK／quick_check、索引與約束；另以全新可銷毀 G6 測試場景驗證故意失敗的 Rollback 與正確的 Supplier Return／Scrap／Adjustment 業務原子性。
6. 若演練未知結果或中途斷線，先唯讀調查；**禁止無條件重跑 Migration**。Time Travel Restore／完整回復應在獨立授權下做足並記錄結果；最後由操作者回收獨立 G6，勿修改 G5／Staging／Production。
7. 以上遠端實驗與 Production v3 唯讀 Gate 都通過後，再依 `docs/Stock-V4-Production-Controlled-Release-Handoff-20261122.md` 取得正式維護窗口及升級授權；Production 遷移與兩個 v4 Gate 仍各自獨立決策。

**本次 UUID Pin PR 不包含任何 Write Environment、D1 遷移命令、可寫 Token、Worker 綁定、Restore 或 Production Gate 的變動。** 只註冊操作者提供的專用 G6 ID，並在一般 Scratch 工具中保護 G6 不被誤用。
