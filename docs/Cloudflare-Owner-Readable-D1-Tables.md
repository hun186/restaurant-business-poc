# 原生 D1 業主工作台：營運清單中文化與當頁搜尋

本 PR 只調整正式 Owner 前端呈現，不變更 Worker API、D1 Schema、Migration、正式登入/CSRF、Cloudflare 設定或五項業務寫入 Gate。

## 功能邊界

- 九種已存在的 D1 實體採用明確的中文業務欄位白名單，避免原始 UUID、Token、Hash、未預期的新後端欄位直接顯示。
- 工作、叫貨、盤點、維修的狀態轉成中文。庫存警示只比較伺服器傳回的 on_hand、min_stock；值缺失或異常時顯示「無法判定」，不產生假資料。
- 快速搜尋僅對已登入、已授權的「目前載入」表格進行可見欄位比對，最多 500 筆；**這不是資料庫全文搜尋、也不代表所有符合條件的資料都已取回**。畫面明示上限。
- 純展示模組不讀 Cookie、不打 API、不使用 Browser Storage；頁面仍由同源 Native API 提供資料，DOM textContent 渲染。
- 正式 Login Gate 沒開時依舊不顯示密碼表單，所有寫入 Gate 仍在各自後端實施。

## 驗收層級

以最新 HEAD 驗證 Hosted CI、正式 Codex Review、Merge Gate，合併後重新確認主線建置。這些驗證仍不能取代 Cloudflare Active Worker 版本、Owner 受控登入/登出、Session 撤銷以及桌機／手機真實瀏覽器 UAT。後者在 Issue #153/#34 保持 Pending。不得因 UI 改良而自行開啟正式登入、任何業務 D1 寫入 Gate 或 Remote Restore。
