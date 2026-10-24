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

## 2026-10-23 PR #1 Codex P1/P2 修正
- 修補庫存任意入庫繞過核准（僅有已核准單可驗收；業主能單次建期初庫存），新增門市授權即撤銷受授員工 Session。
- 將跨門市/員工表列權限篩選移至 SQL LIMIT 前；修復使用者加授門市表單、員工重設密碼錯誤登出。
- 備份中斷清理受解鎖 finally 保護；使用 realpath 避免 symlink/Windows Junction 嵌入營運資料資料夾。DATA_DIR 已在 PR #1 HEAD 的 server.start 套用。
- 新增針對上述問題的回歸測試。以新 HEAD 的 Hosted CI/最新 Codex Review 為準。PR 不可未授權 Merge。

## 2026-10-23 PR #1 Codex 後續 4 個 P2
- 總覽 KPI 以具門市/員工範圍的 SQL COUNT 計算，不受列表 500 筆限制，涵蓋訓練未完成、待處理工作/叫貨/維修與逾期工作。
- 備份完整性納入 sessions/login_attempts 必要結構，但 fingerprint 繼續排除易變登入狀態。
- 逾期且截斷的普通鎖定檔可安全回收；活躍 PID 或尚未逾期則拒絕重入。
- v1→v2 migration snapshot 在目錄建立前重用 getPaths canonical containment，保護 symlink/Junction 祖先。
- openDb 失敗時確實關閉 DB handle；本機 Node22 npm run check：32/32 PASS，正式 Hosted CI 與 Codex 以最新 HEAD 為準。未經許可禁止 Merge。

## 2026-10-24｜Codex PR #1 v1 升級前完整 Schema P2
- v1→v2 在建立遷移快照前對照 db/schema.sql 的完整 v1 結構（17 張必要表、具名索引及 DDL 約束），拒絕缺少 sessions/login_attempts、必要索引/欄位與誤置的 v2 backup_settings。
- 不符合時保持 user_version=1，不建立備份目錄或資料庫更新；補上破壞性回歸測試。本機 38/38 PASS，Hosted CI 與最新 Codex Review 待核對，未授權禁止 Merge。

## 2026-10-24｜PR #1 最新 Codex 3 個 P2
- DDL 正規化保留單引號字面值大小寫，避免 CHECK role/status 常數變更仍被誤判相容。
- 對既有 v1/v2 資料庫先開唯讀連線執行 quick_check、外鍵、完整表/索引/DDL、owner 與 v2 備份設定預檢；拒絕損壞資料庫時不先切 WAL 或改動正式庫。
- 備份與快照驗證使用完整 v2 Schema 契約，不只確認資料表存在；新增欄位/索引缺失、字面值變異與拒絕時檔案 hash/journal_mode 不變測試。
- 本機 Node22 npm run check 41/41 PASS；Hosted CI 與正式 Codex Review 待最新 SHA 驗證。未經授權禁止 Merge。

## 2026-10-24｜正式 Review P1／P2 修正（Session race / POSIX 備份權限）
- P1：HTTP `/api/command` 和 `/api/backups` POST 在 `await parse(req)` 後重新查 Session、角色與 CSRF，改用新的授權主體執行資料異動／稽核，防止慢速 body 期間被降權仍可異動。
- P2：`backup-acl.protect()` POSIX 分支在既有備份資料夾由 SQLite VACUUM INTO 寫入前套用並驗證 0700；檔案套用 0600。使用 O_NOFOLLOW + descriptor 防止 chmod 跟隨替換 symlink。migration 同樣在快照產生前執行 protect。
- 新增 HTTP 暫停 body 後撤銷 Session 的回歸測試，以及一般／升級備份預建 0755 目錄在 VACUUM 前必須變 0700 的測試。CI 與正式 Review 須以新 HEAD 為準，無授權不得 Merge。
