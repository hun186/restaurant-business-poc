# 餐廳好管家 Project Memory

## Current Focus

- 新專案從水電業務管理系統 UI 參考與兩張餐飲版初稿開工，不能誤改水電 Repository。
- 首要目標：確認 PR #1 最新 HEAD 的 Hosted CI、正式 Codex Review 與安全／相容性修正；禁止未授權合併。
- 部署政策：程式碼公開，但營運／人事資料嚴禁公開；本機 SQLite 與 Public Demo 必須分離。
- 使用者習慣：正式 Codex Review、逐輪 P1/P2 修正、Hosted CI 最新 SHA 驗證、未授權不 Merge。

## Recent Outcomes (2026-10-23)

- 從水電 Repo 確認 Node.js + SQLite + 無外部 npm deps + RWD 設計路線。
- 建立餐廳 PoC 資料模型、角色與門市範圍、基本操作後端、瀏覽器前端、稽核紀錄。
- 本機 `npm run check` 11 項自動測試 PASS；2026-10-23 已透過 GitHub Connector 提交 24 檔至 PR #1 Draft；Ubuntu 22/24 的首次 CI 已 PASS，Windows 尚待確認。

## Open Handoffs

- 已由使用者建立 Public Repo，透過 GitHub Connector 提交 PR #1；待核對 4 個 CI 結果、正式 Codex Review、Windows 清理回歸及使用者 Merge 授權。
- 優先處理 `.codex/backlog.md` 的後續項目，不得將未完成報為完成。

### Public Vercel Demo handoff (2026-10-23)
- PR 分支新增 `vercel-demo/` 靜態虛構資料演示；與 `server.js` SQLite 正式 API 完全隔離，並提供重設入口。
- Hosted Vercel Preview 部署狀態需依最新 Vercel 專案/Deployment 實際查核，不得把 GitHub CI PASS 當成部署完成。
- PR #1 仍為 Draft，不得未經授權合併；生產環境的多人 RBAC/稽核仍需安全驗收。
