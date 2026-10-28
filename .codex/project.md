# 餐廳好管家 Project Profile

## Current State

> 最新狀態以本節、`.codex/backlog.md` 與當前 Hosted GitHub 為準。下方有日期的章節刻意保留舊時點資訊，**不能作為今日 PR／部署狀態**。

- 專案：餐廳好管家 / `restaurant-business-poc` GitHub **Public**。已核實最新 `main` `a35d72df79fdcb1d7ce29934f5d421ffa6ab329a`（PR #29 已 Squash Merge），main push Verify #40613800190 **5/5 PASS**、Workers Build Success；PR #29 的虛構備份→隔離 HTTP 啟動測試已入主線。本輪 RB-011-SESSION 新增合成測試，明確驗證未清空 Session 的備份可能復活舊 Cookie，而在獨立還原工作副本停機清空 Session 後舊 Cookie 401、新登入與營運資料正常；同時增補正式 SOP。此為程式碼／CI 模擬而非 Windows 異機或業主簽收；新 PR 須 Hosted CI/正式 Codex Review 驗證後才可合併。Cloudflare production D1/Access/Hosted PBKDF2 CPU 未驗證，不可啟用正式登入。
- 定位：餐飲業務／營運管理 PoC；非現有水電 Repo 分支。
- 技術：Node.js >=22.13、內建 `node:sqlite`、HTML/CSS/JS、無外部 npm 套件。
- UI：參照 `plumber-business-poc` 深藍側欄、青綠操作、RWD；首頁四大入口比照業主提供的截圖。
- 資料：本機／固定主機 `data/restaurant.sqlite`（Schema user_version=3，包含備份設定、歷史進價與菜品配方）；不允許把 Vercel 一般檔案系統當持久 DB；正式遠端多人架構待定。
- Auth：Owner / Manager / Staff、門市授權、Cookie Session、CSRF、scrypt、稽核。
- 模組：工作、食材、庫存／叫貨／盤點、設備維修、人事排班／請假、教育訓練與考核。
- 指令：`npm start`、`npm run check`、`node tools/backup.js`。
- 初次資料庫無業主資料：建隨機初始密碼只在 console 顯示一次；已有 DB 若資料消失，拒絕靜默重建。

## Not Yet Validated

- 已合併 PR 的程式/Hosted CI 驗證和正式 Windows 業主機、真實營運資料、Vercel/Cloudflare 正式部署驗收是不同層次；目前沒有已證實的正式場域簽收。
- 尚未取得業主實際工作流程、真實欄位範例與正式門市權限表。
- 尚未進行 Windows 真機及正式場域資安、備份還原／多使用者負載驗收。

## 備份功能實作邊界（PR #1 增量）
- `src/backup-manager.js`／`src/backup-worker.js`：排程/手動一致性快照、歷史、資料摘要無變化跳過、自動保留數輪替，Windows 備份資料使用 `src/backup-acl.js` 保護。
- `server.js` 的 `/api/backups`（業主 Session + CSRF）；`public/backup-ui.js` 僅於本機真正 SQLite 模式使用。
- `db/backup.sql`／`db/schema.sql`：舊 v1 升到 v2 前建立 migration 快照。下載備份不是站內即時還原。
- `vercel-demo/` 仍完全獨立，**不能聲稱它有正式備份功能**。

## 2026-10-24｜Historical PR #10 Snapshot（已合併，請以 Current State 為準）

- PR #10：一張多品項叫貨單按供應商分組，主管整張核准／驗收並可逐行填寫進價，LINE 僅產生人工分享草稿；不代表送達。
- 最新 Codex Review `caebe207` Completed，發現 P2：重複快速提交會產生雙份叫貨；`4f8cf235` 已修正式與 Demo 共用 UI，同步提交鎖與失敗重試回歸。最新 SHA CI／複審必須再次驗證；未經使用者授權不 Merge。
- Vercel Preview 遇每日部署限額，公開站不能視為新功能部署成功；正式 Windows 及 LINE 真機流程仍待驗收。

## 2026-10-25｜Cloudflare / D1 Historical Planning Snapshot

- PR #12 已於 2026-10-25 合併，Cloudflare Worker `/api/health` 的 Demo-only 路由與 Preview 設定已納入 main；此結果**不等於**正式登入／D1 已上線。
- 新分支 `feat/cloudflare-d1-foundation-20261025`：建立與 `db/schema.sql` v3 對應的嚴格 D1 初始 Migration、只讀 Schema 狀態探測、正式／Preview 雙庫設定範本與測試。正式 `wrangler.jsonc` 不新增未取得的 D1 UUID 綁定。
- 使用者已建立獨立 D1：`restaurant-business-prod` 與 `restaurant-business-staging`；PR #13 已更新根目錄 `wrangler.jsonc` 的正式／Preview 連線，另新增 `wrangler.preview-migrations.jsonc` staging 專用遷移設定與測試。**D1 遠端 Migration 尚未執行、無 owner 帳號、正式營運 API 尚未啟用**；Google Drive 備份、Worker Auth 未完成。Hosted CI / Cloudflare Preview / Codex Review 須按最新 HEAD 核對；未授權不 Merge。

## 2026-10-25｜D1 Auth 第一階段 Historical Planning Snapshot

- Run #40172089719：staging D1 `0001_initial_v3.sql` 遷移與 Schema/FK/零使用者驗證 PASS；使用者實測 Preview `/api/health` 為 `schema_only`。正式 prod D1 尚無 Schema 移轉。
- 分支 `feat/cloudflare-auth-foundation-20261025`：WebCrypto PBKDF2 雲端專用密碼格式、Secure/HttpOnly Host-only Session、CSRF、Session 唯讀驗證、門市 RBAC；只有 Preview `GET /api/me` 唯讀開啟，Production 關閉。沒有真實登入或建立雲端 Owner，沒有新增或執行 D1 Migration、沒有資料異動 API。
- 本地 Node scrypt 與雲端 PBKDF2 **不自動相容**，未規劃好的密碼移轉不可自動發生。須按本 PR 最新 Head 重新進行 Hosted CI／Cloudflare Preview／正式 Codex Review，不得自行 Merge。

## 2026-10-25｜PR #15 Staging Owner Bootstrap Historical Planning Snapshot

- PR #14 `feat/cloudflare-auth-foundation-20261025` 最新 HEAD `afd5ac01` 已通過 Hosted CI 四組、Cloudflare Preview、正式 Codex Review（無 Findings），但尚未 Merge，未取得合併授權。
- 新 stacked branch `feat/cloudflare-staging-owner-bootstrap-20261025` 基於 PR #14，新增僅 GitHub Actions 人工核准的 staging D1 單次 Owner 初始建立。
- `STAGING_OWNER_PASSWORD` 必須由使用者另於 GitHub `d1-staging` Environment Secret 設定，僅初始建立使用，**目前尚未設定／沒有遠端執行／沒有初始業主帳號**。prod D1 沒有 schema migration，本次不修改正式庫。
- 新 Workflow 固定 staging 資料庫、已存在資料拒絕啟動、SQL 隨機 salt / UUID 與私有 runner temp file、驗證唯一 active owner；正式 Login API 仍 503。
- Cloudflare Free Worker CPU 10ms 可能不適合 PBKDF2 600k；Node Runner 產生 hash 成功不等於 Workers 可驗證。須安排真機性能驗收。此 PR Hosted CI / Codex 必須按最新 Head 獨立驗證，不得未授權 Merge 或執行人工工作流程。
