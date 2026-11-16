# Cloudflare D1／本機 SQLite 功能對齊與業主交付路線（2026-11-16）

> 權威依據是 GitHub `main`、每個 PR 的最新 HEAD CI／Codex 和 Cloudflare Active Version 的正式唯讀驗收，不是 Demo 畫面；本文件是**實作路線圖**，不是全部已上線的宣告。

## 三部署角色與共用原則

- **本機 Node.js + SQLite**：目前可操作功能最完整的營運實作與本機備份工具。
- **Cloudflare Workers + D1 Native Owner**：預定供業主與員工跨裝置正式使用。僅經授權功能可對真實 D1 異動；Worker 後端 RBAC、門市範圍、Session/CSRF、原子稽核不可退讓。
- **Vercel Demo**：虛構資料的前端試用。可共用純展示元件、欄位規則、設計 Token，但禁止讀寫真實 D1、接收真實密碼或偽裝成正式資料來源。
- 共用 **policy / command contract / UI component**；各自保持獨立的 SQLite/D1/Mock repository adapters、交易與認證，避免從本機直接複製後端 SQL 或將 Demo 模擬權限引進正式 Worker。

## 對齊優先序

| 優先 | 功能 | SQLite 現況 | Cloudflare 後續交付條件 |
| --- | --- | --- | --- |
| P0 | Owner 登入、門市/食材、工作/叫貨/盤點/維修 | 核心功能存在 | 已接多項 Native API，**逐功能做 Production UAT 與獨立 Gate 實值確認**，不能將 CI 當 Live 測試 |
| P0 | **安全稽核（本 PR）** | Owner 有專用稽核畫面 | 新增 Owner 專用 GET-only `/api/audit`、臺灣日期區間／事件分類／50 筆伺服器分頁、摘要隱私白名單、正式頁入口；待 CI／Review／Cloudflare Active Version／Owner 實場核實 |
| P1 | 員工帳號新增、停用、角色 | SQLite 多項寫入已存在 | Cloudflare API 已實作獨立 Gate；**ROLE Gate 依操作者確認保持 disabled**，不得因視覺對齊自行放行 |
| P1 | 員工門市授權調整與重設他人密碼 | SQLite 有 | Cloudflare 仍缺 Owner-only D1 原子 CAS、Session 撤銷、Audit 與安全復原流程；每項需獨立 Threat Model／合成 CI／Live UAT 與明確 Operator Write Gate 審批 |
| P1 | Excel 匯出／列印 | SQLite 有實際表格匯出 | 先建立 Owner-only 已授權範圍 GET 篩選與資料投影，避免前端直接讀取任何未授權資料；不輸出 Cookie、密碼、IP hash；再共用前端 XLSX 呈現 |
| P2 | 食材歷史價格、菜單／配方／售價／成本 | SQLite 與 Demo 已有模組 | D1 新資料表與 Migrat​​ion 審核、角色／門市成本計算、審計／備份和灰度 UAT，不應為畫面一致直接改 Production Schema |
| P2 | 排班、請假、訓練紀錄與考核 | SQLite 較完整；Native D1 部分唯讀 | 先補 RBAC 限定的唯讀及畫面，再逐功能獨立開放資料修改 Gate |
| P2 | 資料庫備份與恢復 | SQLite 管理 UI | D1 正式採原有營運期加密匯出工具，先核對離線／副本驗證；不可將 Demo 備份按鈕改成可直接還原 Production |

## 安全稽核第一階段契約

- 只接受 `GET /api/audit`、Cloudflare Native Login enabled、有效 Session、**Owner role**；沒有新增 Write Gate、`wrangler.jsonc` Variables、Secrets、Schema、Migration 或任何 D1 正式寫入。
- `category=all|auth|account|operations`、`from/to=YYYY-MM-DD`（以 **Asia/Taipei** 本地日期定界）、`offset` 50 筆分頁且上限 5,000；伺服器固定欄位白名單，不回傳 `ip_hash`、`actor_id`、原始 `detail`、任何密碼或 Session。
- `Cache-Control: private, no-store`；Owner session 過期、角色被撤銷、DB/schema 異常時一律 fail closed。前端僅以 `textContent` 建立 DOM；切頁／登出／Session 切換不得殘留資料。
- 下一關為最新 HEAD Hosted Verify 5/5、正式 Codex 0 unresolved、Clean Merge Gate；合併後仍必須 Cloudflare Active Version + Owner 實機讀取／Session 撤銷驗證。**此 PR 不宣稱正式已上線**。

## 交付策略

採「同功能同規則、先可使用再擴大全覆蓋」：每一項補齊以實際 D1 API、身份／稽核／Session、UI 和跨平台契約測試為一組；不增加無關產品開關、不把 Zero Trust 當必要條件、不延後已可安全交付的 Owner 基本功能。若涉及 Production D1 Schema、Gate 啟用、員工安全異動或 Restore，必須另有操作員明確授權與可驗證回退證據。
