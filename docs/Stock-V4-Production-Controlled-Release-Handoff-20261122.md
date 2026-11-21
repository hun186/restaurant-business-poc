# 餐廳好管家｜庫存 v4 正式上線作業交接（2026-11-22）

> 適用：Issue #212、#176、#34。**本文件是執行與驗收清單，不是已完成的 Production 發版證據，也不是自動執行遷移的程序。**
> 建立時 Main = `9c9ed317eeb6611a060c08dacacfe14b55a7b027`（PR #250）。任何變更後先重新驗證 HEAD、Worker Build、備份新鮮度與目標資料庫，勿沿用固定 SHA 當作永久放行條件。

## 0. 已驗證與未驗證的界線

| 檢查 | 證據 | 現況 |
|---|---|---|
| 第一階段原有核心五種 Write Gate／Native 公網狀態 | PR #250；GitHub Actions #44905138627 於 2026-11-21 20:41 台灣時間 `NATIVE_FIRST_PHASE_PUBLIC_READONLY_PASS` | **PASS（僅該時點）** |
| Main CI 與 Active Worker G0 | Actions #44904949966 (5/5 PASS)、#44905138729 (PASS) | **PASS（該 SHA）** |
| 正式營運期加密備份 Export / Verify / Copy Verify | Issue #176 紀錄：2026-11-17 操作者回報三項 PASS，相同 archive SHA256；2026-11-08、11-13 有相關驗證 | **歷史 PASS**；不等於現在最新業務資料已備份 |
| v4 加密備份離線 SQLite 遷移、合成庫存及 rollback | PR #249、CI／Review PASS，來源加密檔不變 | **離線 PASS**；不是遠端 D1 實證 |
| 真實隔離遠端 D1 以 v3 營運形態完成 v4 migration、失敗回滾與 Restore | 尚無已核實的本次 PASS 證據 | **PENDING** |
| Production D1 v4 版本化遷移（含正確第三筆 `d1_migrations` receipt） | 專用 SQL 仍在 inactive opt-in 目錄 | **NOT PERFORMED** |
| Cloudflare 正式 v4 報廢／調整與退貨業務 Gate | 2026-11-21 #250 公網快檢均為 false | **OFF（該時點）** |
| 正式 v4 的 Owner／Manager／Staff 功能 UAT | 11/17 原有第一階段實測 PASS；不涵蓋新版 v4 功能 | **PENDING** |

## 1. 停機／遷移前的 GO/NO-GO

- [ ] 操作者取得**本次升級前新鮮的** Production D1 營運加密備份。Windows `run-production-d1-backup.bat` [4] Export → [2] Verify → [3] Copy Verify，三者結果 PASS、來源／副本 SHA256 一致，副本放在受保護的獨立儲存位置；保留非機密時間與摘要，**不得**公開 Token、密碼、原始 SQL、備份檔或個資。
- [ ] 依 `docs/D1-Stock-V4-Versioned-Migration-Candidate.md` 以 [5] 對上述**最新** v3 加密備份做離線 v4 rehearsal，確認歷史表 fingerprint 不變、合成資料完全 ROLLBACK、舊資料沒有修改。過往 PASS 不必重做沒有變動的程式測試，但最新正式業務資料快照要核對。
- [ ] 已有**經實際驗證的恢復保障**：隔離遠端 D1 Restore 演練、明確的預期停機／回退步驟、可信的備份副本與操作者。僅有 Time Travel bookmark 或 in-memory SQLite rehearsal **不足以**宣稱遠端恢復 PASS。
- [ ] 於獨立**可銷毀 D1** 使用**完全合成** v3 業務資料進行完整版本化遷移、原子性／失敗 rollback／FK／索引／視圖／migration receipts／歷史 ledger 比對，並驗證 Native HTTP／Session／CSRF／角色／門市及退貨累計不得超過原收貨量；驗證後銷毀隔離測試庫。不得把 Production 資料匯入公網測試庫。
- [ ] 操作者核對正式與隔離 D1 固定 UUID、名稱、binding、當下資料庫 Schema 與 Worker SHA；確保沒有併發營運寫入，取得適當維護窗口及停止／回復決策權。**不得**以既有僅適用空庫的 `d1-staging-migration.yml` 升級營運庫。
- [ ] 使用受審、**獨立顯式執行**的版本化 migration runner，保證 v4 完整交易及 D1 `d1_migrations` 第三筆 `(id=3, name='0004_stock_move_kinds.sql')` 一致；不允許只手動貼 SQL 而沒有 receipt、部分遷移、或不確定結果自動重試。
- [ ] 升級前 v4 功能 Gate 仍 OFF。只有全部前置事項具**實際證據**後才執行 Production schema 變更；若 D1 遠端遷移／Restore 的可驗證安全機制不存在，**STOP**，不得用文件或離線測試替代。

## 2. 正式 v4 schema 轉換（獨立受控窗口）

- [ ] 將正式寫入流量停止或隔離，前後確認固定 Production D1 實體與正式 Worker binding；既有認證／業務 Gate 不因 migration 變動。
- [ ] 執行**已在隔離 D1 驗過的**版本化 v4 遷移機制；對任何 timeout／未知提交結果先做**唯讀偵測**，不可盲重試。
- [ ] Postflight：`cloud_schema_contract=3`、`stock_move_kind_contract.kind_version=4`、`d1_migrations` 只有精確三筆受審的 1/2/3 receipts；`stock_moves` DDL/index/舊 ledger 身分、數量、數值、時間、稽核及 FK/integrity 均符合升級前對照；沒有外加／遺漏資料。任何異常都**停止放行 Gate**，依事先核准的完整恢復步驟處置。
- [ ] 新 v4 Gate 仍 OFF 時，再檢查舊版五項功能及匿名登入安全界線沒有退化。避免把一次 G0 CI PASS 當成此步完成。

## 3. UAT 與正式 Gate 的正確先後

不能「先做有寫入的 Production v4 UAT、最後才第一次開 Gate」：因為 Gate OFF 時合法 POST 本來就會被拒絕。應採**隔離環境完整 UAT → Production Gate 短時受控開啟並核對真實業務 → 核准保持開放**。

- [ ] 隔離 D1：用**純合成** Owner/Manager/Staff、門市、食材及收貨單測試 supplier_return、scrap、positive/negative adjust，驗證 CSRF、RBAC、跨門市、重送、失敗回滾、負庫存、零異動、報廢原因、原收貨來源／累計退貨上限、ledger + audit 同交易；完成後**整個隔離庫銷毀**，確認測試資料不殘留。
- [ ] Production：不得為 UAT 製造事後必須刪除的假庫存或假稽核資料。正式庫的 `stock_moves`／audit 是**不可覆寫**流水，無法在不破壞歷史的情況下保證「測試資料全部消失」。正式版只做無寫入的角色／Gate／Session 安全測試，及業主批准的**真實營運業務異動**；若當下沒有真實報廢／退貨／調整，記錄該類操作為 **Production UAT 尚未實測**，以隔離環境 PASS 支持初期受控放行，後續首次真實異動再驗收。
- [ ] `CLOUD_NATIVE_STOCK_V4_WRITE_GATE`（scrap／adjust）及 `CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE`（supplier return）**分別放行**；`CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE`、`CLOUD_NATIVE_PRICE_WRITE_GATE` 亦各自獨立，不因本次 v4 升級而一併開放。
- [ ] 每一 Gate 放行後至少驗 `GET /api/native/status` 的 Gate 值；登入後 `GET /api/stock/capability` 必須與 D1 v4 marker + receipts 相符，再核對授權角色與店別。不得僅依 public Gate 值推論資料庫與業務 API 可寫。
- [ ] 任一不符：立即停止**新增** v4 業務異動、回閉該新 Gate，核對資料與 audit；已寫入的真實 ledger 不得直接 DELETE/UPDATE 作為「回滾」。
- [ ] 完成後記錄：Cloudflare Active Worker SHA、公開狀態、兩個 v4 Gate、新鮮備份 Verify/Copied SHA、隔離 D1 UAT／Restore 證據、授權人員與窗口；只分享非機密判斷和連結。

## 4. 結案定義

`#212` 應僅在 **Production v4 migration 與必要現場放行驗收確實完成** 後結案；`#176` 的異機 Restore 與營運備份策略如仍未完整符合原 issue 範圍，應如實保留 Open；`#34` 第一階段既有 PASS 不因 v4 未結案而撤銷。正式授權、Cloudflare 變數變動、遠端 SQL 執行、Owner 實測均不得由文件或 PR 合併代替。

**當前交接結論：Code/CI/G0/first-phase PASS 不代表 Production stock v4 已放行。** 本文件的核取方塊初始均為未勾選，只有附上對應的實際執行證據才可更新。
