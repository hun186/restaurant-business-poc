# 餐廳好管家 Project Memory

## Current Focus

- 新專案從水電業務管理系統 UI 參考與兩張餐飲版初稿開工，不能誤改水電 Repository。
- 首要目標：建立獨立 Public GitHub Repo，提交基礎 PoC，確認 PR Review／Hosted CI。
- 部署政策：程式碼公開，但營運／人事資料嚴禁公開；本機 SQLite 與 Public Demo 必須分離。
- 使用者習慣：正式 Codex Review、逐輪 P1/P2 修正、Hosted CI 最新 SHA 驗證、未授權不 Merge。

## Recent Outcomes (2026-10-23)

- 從水電 Repo 確認 Node.js + SQLite + 無外部 npm deps + RWD 設計路線。
- 建立餐廳 PoC 資料模型、角色與門市範圍、基本操作後端、瀏覽器前端、稽核紀錄。
- 本機 `npm run check` 初輪八項自動測試 PASS；Host GitHub CI 尚未驗證。

## Open Handoffs

- 由使用者在 GitHub 建立 `hun186/restaurant-business-poc` 的 Public 空白 Repository，再以 GitHub Connector 提交並開始 PR Review／CI；目前連接權限沒有 create-repository 動作。
- 優先處理 `.codex/backlog.md` 的後續項目，不得將未完成報為完成。
