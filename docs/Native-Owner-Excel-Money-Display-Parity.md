# Native Owner Excel：金額顯示與匯出一致性修正（2026-11-17）

## 原因

正式 Native D1 的 Excel 只匯出已登入使用者在已授權列表載入的最多 500 筆資料，且只取固定欄位。畫面顯示模組 `presentNativeRows()` 會將不合法的負數售價／食材單價／估算成本顯示為「—」。原匯出模組 `nativeOwnerReportSheet()` 卻在這些欄位的原始值仍是有限數字時，逕自輸出該數字。因此異常資料可能在 Excel 出現，與使用者所見不同。

## 修正

匯出數值前先遵守同一個 `presentNativeRows()` 顯示結果；若該欄顯示「—」，Excel 也輸出「—」，不得回頭寫入已被顯示規則拒絕的原始金額。其餘合格數字仍保留 Excel 數值型態、數量欄位保留小數精度，合法的負毛利／負毛利率仍照常輸出。

離線回歸增加壞售價、壞成本、壞食材單價、合法負毛利與機密欄位不得混入 OOXML 的驗證。同步更新 reviewed SHA-256 allowlist。

## 邊界與放行

本修正不修改 Cloudflare Worker、D1 Schema、D1 內容、登入、Cookie、CSRF、門市權限、原有欄位白名單、Excel writer、Cloudflare Secret 或任一 Write Gate；也不進行任何正式資料輸出。

合併前必須確認 PR 最新 HEAD 的五組 Hosted CI 全部通過、正式 Codex Review completed 且無未解決 findings、合併衝突已解。合併後的 main CI 與自動 Cloudflare G0 各自檢查；真實業主 Excel 開檔與資料欄位核對仍屬獨立 UAT，不能以 CI 代替。