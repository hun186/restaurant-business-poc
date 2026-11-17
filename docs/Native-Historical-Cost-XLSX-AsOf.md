# Native D1 歷史菜品成本 Excel：價格有效日可追溯（2026-11-17）

## 背景

Cloudflare 正式 Owner/Manager 的唯讀 `dish_costs`、`dish_cost_lines` 允許指定 `as_of=YYYY-MM-DD`，按當日以前生效的食材價格估算成本。此前畫面有顯示有效日，但下載 Excel 時只有一般工作表名稱與未附日期的檔名，檔案離開瀏覽器後容易被誤認為當日成本。

## 改善範圍

- Native Owner 已成功載入的兩種**歷史價格估算**清單，匯出時在 Excel 工作表名稱與檔名加上當次 API 回傳並經前端格式驗證的價格有效日，如 `菜品成本／毛利_2026-10-01` 與 `餐廳好管家_dish_costs_2026-10-01_資料.xlsx`。
- 不改動資料、日期查詢、SQL、Excel writer、角色或伺服器授權。資料仍限定為目前已授權且已載入的最多 500 筆；不會匯出完整 D1 資料。
- **現有庫存估值 `inventory_values` 不加歷史日期標示**。該頁使用當前庫存流水，絕不能誤稱為歷史庫存快照。
- 原一般工作、叫貨、庫存、訓練等 Excel 名稱保持相容；不合法的額外 `asOf` 不可污染下載檔名或工作表標籤。
- 匯出仍需目前身分、CSRF epoch、當前頁 revision 有效；前一個 Session／已切換頁面不能使用舊連結。

## 回歸與驗收

新增真實匯出事件的 Node VM 模擬，驗證日期進入 worksheet / 檔名、舊 Session 和舊畫面禁止匯出、庫存估值與非日期清單不被誤標。同步更新 reviewed SHA-256 清單。

這只是程式增量。PR 最新 HEAD 須通過 Hosted Verify 五項、Codex Review completed 且無 Finding／未解決 Thread、Clean Merge，才能合併；main CI/自動 G0 與 Owner/Manager 真正 Excel 下載開檔 UAT 仍須分開確認。**不執行 Production D1 寫入、Cloudflare Secret/Gate 設定、Deploy 或 Restore。**