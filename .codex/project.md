# 餐廳好管家 Project Profile

## Current State

- 專案：餐廳好管家 / `restaurant-business-poc`；GitHub `hun186/restaurant-business-poc` **Public**。PR #10、#12、#13 已合併；目前進行 PR #14 Cloudflare 認證第一階段（Draft），PR #7 與 #9 仍 OPEN/Draft；正式審查與 CI 必須以最新 PR HEAD 核對。
- 定位：餐飲業務／營運管理 PoC；非現有水電 Repo 分支。
- 技術：Node.js >=22.13、內建 `node:sqlite`、HTML/CSS/JS、無外部 npm 套件。
- UI：參照 `plumber-business-poc` 深藍側欄、青綠操作、RWD；首頁四大入口比照業主提供的截圖。
- 資料：本機／固定主機 `data/restaurant.sqlite`（Schema user_version=3，包含備份設定、歷史進價與菜品配方）；不允許把 Vercel 一般檔案系統當持久 DB；正式遠端多人架構待定。
- Auth：Owner / Manager / Staff、門市授權、Cookie Session、CSRF、scrypt、稽核。
- 模組：工作、食材、庫存／叫貨／盤點、設備維修、人事排班／請假、教育訓練與考核。
- 指令：`npm start`、`npm run check`、`node tools/backup.js`。
- 初次資料庫無業主資料：建隨機初始密碼只在 console 顯示一次；已有 DB 若資料消失，拒絕靜默重建。

## Not Yet Validated

- GitHub Public Repo 已建立；PR #1 於 2026-10-23 建立，Hosted CI 須以最新 HEAD 核實，正式 Codex Review 尚未確認完成。
- 尚未取得業主實際工作流程、真實欄位範例與正式門市權限表。
- 尚未進行 Windows 真機及正式場域資安、備份還原／多使用者負載驗收。

## 備份功能實作邊界（PR #1 增量）
- `src/backup-manager.js`／`src/backup-worker.js`：排程/手動一致性快照、歷史、資料摘要無變化跳過、自動保留數輪替，Windows 備份資料使用 `src/backup-acl.js` 保護。
- `server.js` 的 `/api/backups`（業主 Session + CSRF）；`public/backup-ui.js` 僅於本機真正 SQLite 模式使用。
- `db/backup.sql`／`db/schema.sql`：舊 v1 升到 v2 前建立 migration 快照。下載備份不是站內即時還原。
- `vercel-demo/` 仍完全獨立，**不能聲稱它有正式備份功能**。

## 2026-10-24｜Current PR Focus

- PR #10：一張多品項叫貨單按供應商分組，主管整張核准／驗收並可逐行填寫進價，LINE 僅產生人工分享草稿；不代表送達。
- 最新 Codex Review `caebe207` Completed，發現 P2：重複快速提交會產生雙份叫貨；`4f8cf235` 已修正式與 Demo 共用 UI，同步提交鎖與失敗重試回歸。最新 SHA CI／複審必須再次驗證；未經使用者授權不 Merge。
- Vercel Preview 遇每日部署限額，公開站不能視為新功能部署成功；正式 Windows 及 LINE 真機流程仍待驗收。

## 2026-10-25｜Cloudflare / D1 新工作（PR 尚未合併）

- PR #12 已於 2026-10-25 合併，Cloudflare Worker `/api/health` 的 Demo-only 路由與 Preview 設定已納入 main；此結果**不等於**正式登入／D1 已上線。
- 新分支 `feat/cloudflare-d1-foundation-20261025`：建立與 `db/schema.sql` v3 對應的嚴格 D1 初始 Migration、只讀 Schema 狀態探測、正式／Preview 雙庫設定範本與測試。正式 `wrangler.jsonc` 不新增未取得的 D1 UUID 綁定。
- 使用者已建立獨立 D1：`restaurant-business-prod` 與 `restaurant-business-staging`；PR #13 已更新根目錄 `wrangler.jsonc` 的正式／Preview 連線，另新增 `wrangler.preview-migrations.jsonc` staging 專用遷移設定與測試。**D1 遠端 Migration 尚未執行、無 owner 帳號、正式營運 API 尚未啟用**；Google Drive 備份、Worker Auth 未完成。Hosted CI / Cloudflare Preview / Codex Review 須按最新 HEAD 核對；未授權不 Merge。

## 2026-10-25｜D1 Auth 第一階段（新 PR，未合併）

- Run #40172089719：staging D1 `0001_initial_v3.sql` 遷移與 Schema/FK/零使用者驗證 PASS；使用者實測 Preview `/api/health` 為 `schema_only`。正式 prod D1 尚無 Schema 移轉。
- 分支 `feat/cloudflare-auth-foundation-20261025`：WebCrypto PBKDF2 雲端專用密碼格式、Secure/HttpOnly Host-only Session、CSRF、Session 唯讀驗證、門市 RBAC；只有 Preview `GET /api/me` 唯讀開啟，Production 關閉。沒有真實登入或建立雲端 Owner，沒有新增或執行 D1 Migration、沒有資料異動 API。
- 本地 Node scrypt 與雲端 PBKDF2 **不自動相容**，未規劃好的密碼移轉不可自動發生。須按本 PR 最新 Head 重新進行 Hosted CI／Cloudflare Preview／正式 Codex Review，不得自行 Merge。
