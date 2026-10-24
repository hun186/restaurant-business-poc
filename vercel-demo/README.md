# Vercel 公開展示站

本目錄是完全獨立的**前端虛構資料演示**，不是正式後端部署。

- `index.html`、`app.js`、`styles.css` 使用現有 UI 風格；`mock.js` 攔截瀏覽器內部 /api 呼叫，使用記憶體／sessionStorage 虛構紀錄。
- **無實際帳號、角色驗證、API、SQLite、稽核保障或持久化員工資料**。請勿輸入真實資料或密碼。
- 在 Vercel 專案設定 Root Directory = `vercel-demo`，Framework Preset = Other，無 build command。
- 此版保留操作流程畫面，並包含**食材歷史價格、門市庫存估值、菜品售價、每份配方、成本／材料毛利與缺價提示**的可操作虛構資料。可試新增價格／菜品、改售價、設定配方，也可核准採購單後驗收入庫並選填進價；禁止直接繞過核准入庫。所有金額只估算材料成本，非 FIFO／移動平均、實際毛利或 POS。
- `pricing-demo.js` 計算跨單位、歷史價格與門市成本，`mock.js` 只在記憶體／sessionStorage 操作。重新開啟新分頁或按「重設示範」會回到初始虛構資料；舊展示 sessionStorage 可補入新增價格樣本。
- Preview 由新 PR 分支觸發；必須在 PR 通過 CI／正式 Review 且由維護者授權 Merge 後，`main` 的 Vercel Production 才會取得新版展示功能。部署 Ready 與 GitHub CI PASS 不等於已驗證實際頁面。
