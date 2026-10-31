# Vercel 公開展示站

本目錄是完全獨立的**前端虛構資料演示**，不是正式後端部署。

- `index.html`、`app.js`、`styles.css` 使用現有 UI 風格；`mock.js` 攔截瀏覽器內部 /api 呼叫，使用記憶體／sessionStorage 虛構紀錄。
- **無實際帳號、角色驗證、API、SQLite、稽核保障或持久化員工資料**。請勿輸入真實資料或密碼。
- 在 Vercel 專案設定 Root Directory = `vercel-demo`，Framework Preset = Other，無 build command。
- 此版保留操作流程畫面，並包含**食材歷史價格、門市庫存估值、菜品售價、每份配方、成本／材料毛利與缺價提示**的可操作虛構資料。可試新增價格／菜品、改售價、設定配方，也可核准採購單後驗收入庫並選填進價；禁止直接繞過核准入庫。所有金額只估算材料成本，非 FIFO／移動平均、實際毛利或 POS。
- `pricing-demo.js` 計算跨單位、歷史價格與門市成本，`mock.js` 只在記憶體／sessionStorage 操作。重新開啟新分頁或按「重設示範」會回到初始虛構資料；舊展示 sessionStorage 可補入新增價格樣本。
- Preview 由新 PR 分支觸發；必須在 PR 通過 CI／正式 Review 且由維護者授權 Merge 後，`main` 的 Vercel Production 才會取得新版展示功能。部署 Ready 與 GitHub CI PASS 不等於已驗證實際頁面。

## 智慧備份互動示範（RB-015）

- 左側「系統管理 → 智慧備份示範」展示預設每 1 天、50 個自動版本（可設 1–365 天／1–500 份），設定與版本紀錄**僅保存在瀏覽器 sessionStorage**，不是正式 SQLite `backup_settings`。
- 按「模擬下次到期檢查」會**快轉示範時間**，比較虛構營運資料的序列化內容；無變更跳過；「模擬一筆營運異動」可新增虛構工作後觸發新自動版本；手動版本每次建立，保留份數只清理自動紀錄。
- 版本只是示範標籤，**不產生備份 SQLite 檔、無真正 checksum／快照完整性驗證、無伺服器排程、不得下載／還原**。正式備份請至受控 Node.js SQLite 版使用業主帳號。
- 原有 Demo `mock.js` 模擬 API `/api/demo-backups`，不與正式的 `/api/backups` 共用。按「重設示範」清空本分頁模擬紀錄。

## Excel 與列印虛構示範
- 「系統管理 → Excel 匯出與列印」可多工作表、選欄位、條件篩選後下載真 `.xlsx`、預覽列印，所有資料均來自本瀏覽器 `sessionStorage` 模擬庫，不連真實 SQLite、員工或 IP。
- 安全稽核中的 IP `192.0.2.20` 是保留的文件範例位址；**不是使用者／訪客的真實來源 IP**。Demo 無真正登入與權限保護，請勿輸入任何營運或個人資料。


## Staging Access 唯讀驗收頁（與公開 Demo 完全分離）

`staging-access-preview.html`、`staging-access-preview.js`、`staging-access-client.js` 和 `staging-access-preview.css` 是**獨立**的操作介面，不載入 `mock.js`，不使用 Vercel 的虛構登入，也不在瀏覽器儲存 Token 或營運資料。這些靜態檔案可能隨 Demo 發佈而公開，但它們**不是授權邊界**：只會向所在網域的 `/api/access/me`、`/api/access/overview`、`/api/access/data` 發出 `GET`，由伺服器驗證 Cloudflare Access RS256 JWT 與 D1 使用者/門市綁定。Vercel 公開站並沒有這套已啟用的後端；頁面應顯示不可用，而非自動改走公開 Demo 或跨站請求。

只有在**整個 Cloudflare Preview 受 Access 政策保護**、Staging 0003 Migration 已經正式核准並套用、管理員明確啟用身分綁定及 `CLOUD_ACCESS_IDENTITY_GATE=staging-get-only`，以及可信任的 team issuer/audience 完成配置後，這個網址才有機會查詢真實 D1 Staging 測試資料。這些外部步驟本 PR 一項都沒有執行；Production 的 `CLOUD_AUTH_PHASE=disabled` 不變。

驗收方式：在受保護的 Cloudflare Preview 開啟 `/staging-access-preview.html`，由 Cloudflare Access 在邊緣授權使用者後讀取身份、總覽與各類門市資料；測試帳號撤銷或停用門市後按重新整理，必須立即清除舊顯示並拒絕存取。此頁只有唯讀呈現，沒有建立 Session、密碼登入、匯出、寫入、修改權限或備份功能。**不可因為頁面能被打開就判定 Access 防護已經生效；需獨立驗證未授權匿名請求會被 Cloudflare Access 阻擋。**


## Staging 工作狀態人工操作驗收（程式碼完成、未啟用）

獨立 `/staging-access-preview.html` 的「今日工作」表格新增單一 Staging 測試動作：選擇 `待辦／處理中／已完成`，再按「確認更新（Staging）」並接受確認視窗。僅向同源 `POST /api/access/task-status` 發送固定 `task.status` 命令，瀏覽器管理自己的 Cloudflare Access Cookie，前端不接收 JWT、角色或門市等欄位、不在 Storage 留存資料。成功後重新呼叫 GET；失敗時擦除舊資料、要求先重新讀取核對，**不自動重試**以免發生重複更新。其他模組仍唯讀。

此路由是 PR #76 已合併、預設關閉的寫入元件。需要管理者另行配置 `CLOUD_ACCESS_TASK_WRITE_GATE=staging-task-status-only`、受保護的 Staging Access Policy、可信 issuer/audience、0003 D1 Schema Migration 及已批准的身份對應。本次 PR 不執行這些遠端操作、不配置寫入 Gate；未設定時 POST 回 503，公開 Vercel Mock 無真實後端，Production 仍 disabled。此介面只是受控驗收工具，**不是已上線的餐廳管理系統**。
