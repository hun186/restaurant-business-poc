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

### 2026-10-23｜本機 SQLite 備份系統增量（待 Host 驗證）
- 本次為使用者要求比照水電系統的備份功能，補「系統管理 → 備份管理」、業主限定 API、排程 Worker、SQLite v1→v2 安全升級、驗證過的快照及只清理自動版本。
- 資料摘要比對排除 Session、登入嘗試與備份元資料；如果上次自動備份存在且有效、持久內容無變更則更新自動檢查時間並跳過。手動備份仍保留；備份檔不進 Git/Vercel。
- 本機 Node 22 的 `npm run check`：22/22 PASS（含 11 項新備份專項），Hosted Ubuntu/Windows × Node22/24、正式 Review 與 Windows 實際還原尚待確認。
- 仍在 PR #1 Draft；**未取得使用者授權不可 Merge**。Public Vercel 示範站與本機資料庫備份互不相連。

## Pricing Integration Handoff (2026-10-23)
- 比照 menu-planner 的 ingredient_prices、dish_ingredients、cost preview 建立 v3；只有業主可修改共用菜品與配方；各主管可管理自身門市的歷史單價。
- 進貨驗收可選填單價並原子性保存；缺價／單位無法換算時絕不假設零成本。
- 備份 fingerprint 加入價格、菜品、配方，v2→v3 安全 migration snapshot。
- 沒有 AI 跨系統同步，亦非 FIFO/移動平均/POS 實際毛利。見 docs/菜單價格與成本試算.md。
- 此項開發分支 feat/menu-pricing-costs-v3，未經使用者同意不能 Merge。
