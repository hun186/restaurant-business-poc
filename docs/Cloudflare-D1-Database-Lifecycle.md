# Cloudflare D1 名額與實驗資料庫生命週期（2026-11-01）

## 核心決策

Cloudflare D1 本質為基於 SQLite 的託管資料庫；**正式系統只需要一個 Production D1**。開發期間另保留一個固定 Staging D1，用以隔離與正式資料的風險。不要將「新實驗」直接等同「永久再建一庫」。使用者回報 Cloudflare Free 額度為最多 10 個 D1，目前已建立 4 個（此為操作者提供的帳戶列表，非本工具讀取帳戶盤點）。

| 名稱 | 作用 | 保留策略 | 目前動作 |
| --- | --- | --- | --- |
| `restaurant-business-prod` | 正式資料及未來 Owner | **永久保留** | 禁止刪除、重跑 first-init、未核准寫入 |
| `restaurant-business-staging` | Preview/測試環境 | **開發期間固定保留** | 不與 Production 共享測試資料 |
| `restaurant-business-g5-disposable-recovery-drill` | G5 Restore 隔離演練 | **候選回收，非即刻可刪** | 先核對 `cloudflare/recovery-drill-target.json` 的固定 UUID、手動 workflows、有效 Worker/Pages Binding、未完成演練與證據要求；若要退休須另開安全變更而非直接刪庫 |
| `restaurant-business-owner-batch-lab-20261101` | REST Batch UNIQUE 回滾實機測試 | **驗收後候選回收** | 已有操作者 PASS，內含測試表和 2 筆虛構控制資料；不再選 2 重跑，先封存輸出與確認無綁定及無後續驗收需求，才由操作者手動刪除 |

## 新實驗優先順序

1. **純業務邏輯／SQL**：優先使用本機 SQLite、`wrangler dev --local` 或現有 CI 合成測試；不新增遠端 D1。
2. **部署、Worker、D1 特性實測**：可在既有 Staging 上進行非破壞性、與營運資料隔離的測試；涉及「全新空庫」或故障注入需另評估風險。
3. **必須全新隔離庫的破壞性驗收**：只在明確不可使用 Staging 且有同意的操作流程時建立暫存 Scratch D1；預先定義到期／回收準則、不得使用 Prod/Staging/G5 的 UUID，禁止自動建立、清空或復原任何真實業務庫。
4. **禁止自動回收**：建立 DB 數量看板/後續 Issue 可以，但不能透過 CI/PR Merge/本地一鍵腳本自動刪除 Cloudflare D1。

## 暫存 D1 人工回收檢核（順序不可省略）

- [ ] 已將不含 Token、密碼與真實業務內容的操作者結果存檔；確認使用者提供的 PASS 並非 GitHub CI 模擬。
- [ ] 確認 Cloudflare 控制台 DB 名稱／UUID 是**欲回收的 Scratch 專用庫**，不是 Prod、Staging，也不是仍被固定 Pin 的 G5 Drill。
- [ ] 查核所有 Workers/Pages 的現有與可作用部署版本、手動 workflow、外部工具、已排定的任務及任何其他操作者是否仍使用此庫；查核不足則 **停止**。
- [ ] 確定不再需要保留 SQL 測試資料／證據或執行未完的 Restore 驗收。必要時先完成**不含敏感資料**的獨立證據保存。
- [ ] 由有權限的 Cloudflare 管理員在 Dashboard **人工**刪除一次性 Scratch DB，並核對已消失；任何失敗或名稱/UUID 不匹配都停止，禁止程式盲目重試。
- [ ] 如果是 G5 Drill，先修改或停用其已審查的固定目標與相關工作流程、通過完整 CI/Review，**然後**再考慮刪除。不可先刪造成未來錯誤指向其他資料庫。

## 已知驗收與界線

- 操作者 2026-11-01 實機輸出 `SCRATCH_D1_EMPTY_VERIFIED`、`DISPOSABLE_D1_REST_BATCH_ROLLBACK_PASS`，control_rows=2、rollback_extra_rows=0；限於此唯一約束衝突情境，不涵蓋網路斷線/逾時。
- 使用者端輸出宣告 `production_write_performed:false`；沒有獨立雲端稽核，勿將其延伸為全帳戶無其他寫入。
- 本文件和相關 PR **只記錄及規範**；不執行任何 Cloudflare 遠端資料庫寫入、還原、刪除、Owner 建立或正式登入放行。
