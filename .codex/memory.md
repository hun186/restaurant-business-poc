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

## 2026-10-23 PR #2 Codex P1 修正
- 針對最新 Code Review `c3f4ed5` 的未解 P1，v2→v3 升級前以獨立記憶體 SQLite 的版本化 Schema 合約核對全部 v2 資料表及具名索引的完整建表 DDL，不再只檢查少數表是否存在。
- v1→v2 與 v3 開啟亦核對必要舊 Schema；異常時關閉 SQLite，拒絕自動修補、建立 migration snapshot 或更改 `user_version`。
- 新增 `repairs`、`stocktakes`、`evaluations` 遺失、欄位遺失、索引遺失及 v3 殘缺的回歸測試；本機對應設計驗證 38/38 PASS。以本 PR 最新 HEAD 的 Hosted CI 與 Codex 複審為最終依據。
- PR #2 仍為 Draft 且依賴 PR #1，未授權不可 Merge。

## PR #2 最新 Codex P1/P2 修正（2026-10-23）
- 驗證既有 v3 所有版本化 DDL，包括 ingredient_prices、menu_dishes、dish_ingredients 的欄位、FK/CHECK 和具名索引；破損時拒絕啟動，不自動補建。
- v1/v2 preflight 拒絕已出現的較新版物件（含 backup_settings 和 v3 索引），避免不正確的 migration snapshot。
- 新增價格欄位缺失、配方/價格索引缺失、v1 與 v2 混入新物件的回歸測試；本機 Node 22 合計 44/44 PASS。正式 Hosted CI / Codex Review 依 PR 最新 HEAD 核對。
- PR #2 Draft stacked PR，不可未授權 Merge。

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


## 2026-10-24｜PR #2 與 PR #1 安全相容整合
- 將 PR #1 最新 v1 升級前完整性驗證、canonical 備份路徑、庫存核准驗收、期初庫存、Session 與 UI 修正帶入 v3 定價分支。
- 明確拒絕 stock.purchase 直接入庫；價格僅在核准單 order.receive 驗收時與 stock_moves 原子性寫入，保留歷史價格與毛利估算。新增對應價格回歸。
- 原 PR #2 Review 無 Findings，但舊分支與 PR #1 基底分歧且存在安全回退風險；本整合需以最新 HEAD 的 Hosted Ubuntu/Windows CI 和正式 Codex Review 再確認。PR #1/#2 均不合併至目標分支。

## 2026-10-24｜PR #2 跨版本測試修正
- Hosted Ubuntu Node22/24 首輪指出 4 項測試失敗：PR #1 v1 fixture 在 PR #2 v3 新庫未移除 v3 價格表，致 preflight 提早拒絕；另備份結構驗證的錯誤訊息正確但錯誤 code 斷言過嚴。
- 已修正測試 fixture 先移除 v3 價格表、保留需要驗證的 v2 部分升級表，並驗證缺表/缺索引的確切訊息；未放寬任何資料庫驗證或重新開放 stock.purchase。Hosted CI 須以後續 HEAD 為準。

## 2026-10-24｜PR #1 新 3 P2 同步至 PR #2
- 將 PR #1 最新唯讀 preflight（v1/v2/v3）、保留 SQL quoted literals 大小寫的完整 DDL 比對及備份 Schema 驗證整合至 v3；完整檢查 price/recipe 及登入欄位、具名索引。
- 新增 v3 備份破損欄位/索引、v1 quoted CHECK 與 WAL 無副作用回歸。仍禁止 stock.purchase 直接入庫，只有核准單 order.receive 原子寫入價格/庫存。
- PR #2 只同步相依分支 commit，未變更 PR base 或合併 PR；正式 Hosted CI/Review 需重新驗證最新 HEAD。

## 2026-10-24｜正式 Review P1／P2 修正（Session race / POSIX 備份權限）
- P1：HTTP `/api/command` 和 `/api/backups` POST 在 `await parse(req)` 後重新查 Session、角色與 CSRF，改用新的授權主體執行資料異動／稽核，防止慢速 body 期間被降權仍可異動。
- P2：`backup-acl.protect()` POSIX 分支在既有備份資料夾由 SQLite VACUUM INTO 寫入前套用並驗證 0700；檔案套用 0600。使用 O_NOFOLLOW + descriptor 防止 chmod 跟隨替換 symlink。migration 同樣在快照產生前執行 protect。
- 新增 HTTP 暫停 body 後撤銷 Session 的回歸測試，以及一般／升級備份預建 0755 目錄在 VACUUM 前必須變 0700 的測試。CI 與正式 Review 須以新 HEAD 為準，無授權不得 Merge。

## 2026-10-24｜PR #2 與 PR #1 HEAD 1551fb5 相容同步
- PR #1 最新 Head 正式 Codex Review 無重大 Findings，Hosted Ubuntu/Windows × Node22/24 4/4 PASS。
- PR #2 由於 PR #1 後續 auth race 與 POSIX 備份權限修正，已在本分支同步最新 server、backup ACL、HTTP regression；v3 備份測試沿用 PR #1 兩個 VACUUM INTO 前 0700 權限測試，並調整 v1 fixture 移除 v3 價格／配方表。
- 保留 v3 價格、配方、已核准單 order.receive 原子入庫/進價及 stock.purchase 禁止直接入庫；不變更 PR base，不合併至 main。
- 需以本次同步的新 HEAD CI 及正式 Codex Review 重新驗收，未經使用者授權不可合併。

## 2026-10-24｜Vercel Demo 菜單與成本功能（新 PR）
- 新增獨立 browser-only `pricing-demo.js`，以虛構歷史價及菜品配方計算跨門市材料成本、毛利、缺價和庫存估值，沿用現有 Mock API/sessionStorage，不連真實 SQLite。
- Demo 加入「菜單與成本」與「食材歷史價格／庫存估值」選單，允許新增價格、菜品、改售價、調整配方；核准叫貨後可驗收入庫並選填進價。
- 禁止過時 Demo `stock.purchase` 直接入庫操作；可對未有庫存的食材建立單次期初庫存，保留虛構資料警語和重設入口。
- 新 PR 須通過 Hosted CI、正式 Codex Review 及使用者 Merge 授權；Vercel Connector 此前對該 Team 回 403，正式部署仍須核對，不能提前聲稱已上線。
