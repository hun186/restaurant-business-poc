# Vercel 公開展示站

本目錄是完全獨立的**前端虛構資料演示**，不是正式後端部署。

- `index.html`、`app.js`、`styles.css` 使用現有 UI 風格；`mock.js` 攔截瀏覽器內部 /api 呼叫，使用記憶體／sessionStorage 虛構紀錄。
- **無實際帳號、角色驗證、API、SQLite、稽核保障或持久化員工資料**。請勿輸入真實資料或密碼。
- 在 Vercel 專案設定 Root Directory = `vercel-demo`，Framework Preset = Other，無 build command。
- 此版保留操作流程畫面，但僅供互動示意；重新開啟新分頁或重設將回到初始虛構資料。
- Preview 使用 PR 分支 `feat/restaurant-poc-v0.1`。待正式 Review 完成、由維護者授權 Merge 後，正式 production branch 才含此目錄。
