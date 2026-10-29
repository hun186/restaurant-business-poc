# P0 #34｜D1 盤點確認與庫存調整：內部交易驗收

## 交付邊界
本增量只新增 `cloudflare/stocktake-write-internal.mjs` 與 `tests/cloudflare-d1-stocktake-write-internal.test.js`。**未匯入 Cloudflare 公開 `worker.mjs`、未改 Wrangler、未執行 Production D1 migration、未使用真實帳密或營運資料。** Production `/api/command` 繼續 503。必須由受控測試呼叫端同時設置 `CLOUD_AUTH_PHASE=preview-readonly` 及 `STOCKTAKE_WRITE_STAGE=internal-test-only`；HTTP 請求無法自行開啟。

## 業務契約
- 只接受 `stocktake.confirm`（指定 UUID，不接受請求端重新設定盤點的品項、差額、門市或數量），Owner/Manager 可確認，Staff 不可。
- `stocktakes.expected_qty` 是盤點建立時的快照；確認時重新從 `stock_moves` 以 `SUM(qty_delta)` 計算 `current_qty`。若差異超過 `0.000001`，回應 409，須重新盤點。
- SQL batch 開頭的稽核 INSERT 兼作 **DB 內強制約束守衛**。重新檢查仍為 pending、門市／食材有效、Session/角色仍有效且授權、expected/count 不變、庫存與快照一致、先前沒有同盤點的 adjustment 參照。守衛不符合會寫入 NOT NULL 欄位的 NULL，觸發 SQL 錯誤，確保 D1.batch 回滾，不只回傳 0 rows。
- 差額非零：新增恰好一筆 `stock_moves` 的 `adjustment`，`reference_id` 為 stocktake ID，再將盤點改為 confirmed，並使用交易內最後的 NOT NULL 約束再次確認盤點狀態、調整流水存在且最終庫存等於 counted_qty。
- 差額在容忍範圍內：沒有移動流水，只更新 confirmed 和稽核，最終確認沒有同盤點 adjustment。
- 重複確認不會二次入帳，SQL 錯誤或任何中途角色/門市／庫存異動都不能留下部分稽核、調整及 confirmed。

## 回歸與剩餘工作
11 組合成測試涵蓋盤虧、零差額、重複確認、跨門市與職權、盤點後帳面異動、殘留調整流水、Session/CSRF/Origin、公開 API 禁用、每一 SQL 陳述式失敗、DB batch 前權限／數量／門市／狀態變動，以及共用 Session 過期判定時間。

這不是 Hosted Cloudflare D1 受控 Staging 真機交易，也沒有接入正式 Dashboard。後續仍需實測 Access、Hosted Worker CPU／Session、遠端 D1、Production D1 空庫 migration、加密異地備份/RTO-RPO、真實業主 UAT，依 Issue #34 每關安全放行。