# 三部署版本帳號管理共用規劃（2026-11-15）

目前確定：Cloudflare D1 的 Native Owner 頁面使用 `vercel-demo/native-account-management-ui.mjs`、`vercel-demo/native-owner-capability.mjs` 共用瀏覽器程式；本機 Node.js/SQLite 另有 `public/app.js` + `src/service.js` 的完整帳號建立、停用、角色與密碼管理；公開 Vercel Demo 的 `vercel-demo/app.js` 明確是 Mock，**不提供真實帳號管理**。

本次修正：由 `/api/accounts` Owner 認證後的 `can_create` 控制帳號頁寫入標示、權限說明；不能使用五項營運寫入 Gate 判斷帳號新增。每次重新讀取先重設為不可寫，對遲到的跨身分回應拒絕更新。

跨平台應共用角色與操作契約、欄位/稽核語義、可重用 UI；但 Cloudflare D1 與本機 SQLite 的認證、交易與資料儲存須以不同 Adapter 實現；Vercel Demo 不得連正式 D1、不可接收真實密碼。

下一項安全工作：把本機已有的 `user.active`（可撤銷 Session + 留下歷史 Audit）以獨立明確 Operator Gate 的 D1 原子交易、Owner 專用端點與帳號 UI 實現；預設拒絕，仍需實機及 Code Review。**勿直接硬刪帳號**，否則會破壞歷史關聯與稽核，先以停用替代。此 PR 未修改 Worker API、D1、Cloudflare Vars/Gates，也未執行正式資料寫入。