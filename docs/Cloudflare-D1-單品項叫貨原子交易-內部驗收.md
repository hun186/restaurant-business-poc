# P0 #34：Cloudflare D1 單品項叫貨核准／收貨內部原型（未上線）

## 目前交付界線
本增量只新增未接線的 `cloudflare/order-write-internal.mjs` 與合成 SQLite/D1 交易測試。正式 `cloudflare/worker.mjs`、`wrangler.jsonc`、Cloudflare Production / Preview 公開 API 都不啟用 `/api/command`，也沒有執行資料庫 migration。**不可把這版交付業主操作真實庫存。**

內部函式必須由明確傳入的受控測試環境同時設定 `CLOUD_AUTH_PHASE=preview-readonly` 與 `ORDER_WRITE_STAGE=internal-test-only` 才進入處理；使用者 HTTP 欄位無法開啟此開關。沒有真正 Access/CPU、Owner 實場驗證前禁止接線公開路由。

## 已實作
- 僅支援單品項 `order.approve`（requested→approved）與 `order.receive`（approved→received），採用 D1 `batch` 交易，後端重新確認角色、門市/食材啟用、Session/CSRF/Origin；Owner/Manager 有權，Staff 禁止核准及收貨。
- 驗收時在同一交易中先寫稽核，再追加 `stock_moves` purchase 正數紀錄，最後將採購單標記 received。**不直接寫入 on_hand**，收貨後再送相同請求不會增加第二筆流水。
- 資料庫的既有 `stock_moves.reference_id` 若已對應同一筆 purchase，必須拒絕，不得重複入庫。以新產生的 Movement UUID 驗證本次追加成功，防止舊流水誤觸發更新。
- 與本機 `src/order-batches.js` 契約一致：`POB-...-001` 多品項單需要獨立**整張**核准/收貨工作流，這個單品項入口一律拒絕。
- 不接受自填数量、品項、門市、單價等欄位，庫存異動完全由已核准叫貨單欄位決定。
- 本增量**沒有**實作驗收單價寫入 `ingredient_prices`、庫存開帳、盤點確認、完整多品項 POB 工作流；這些需要下一個交易增量及獨立上線審核。

## 測試與待驗事項
`tests/cloudflare-d1-order-write-internal.test.js` 使用合成資料，測試核准/收貨正常路徑、重複驗收、取消後拒絕、POB 逐行拒絕、跨店/停用門市、未授權角色、已存在 ledger、CSRF、Session 撤銷、任何 D1 batch 陳述式失敗必須回滾、角色/門市在交易前變動、Schema 契約失效及公開 Worker API 必須維持 503。測試只證明受控程式邏輯，不是遠端 Cloudflare D1 整合或正式業主 UAT。

PR 最新 HEAD CI 和正式 Codex Review 必須在提交後核對；正式 Access/Hosted CPU、Production D1、備份、真實登入與業主簽收依 Issue #34 分別完成。