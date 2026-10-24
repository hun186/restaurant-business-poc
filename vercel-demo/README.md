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
