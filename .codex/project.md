# 餐廳好管家 Project Profile

## Current State

> 2026-10-29 P0 #34 G0：PR #40 Squash Merge 82944f428cab6591c261273b821c00ff74479cd1；main push CI #40835511042 completed/success 5/5 PASS。G1 Staging 遠端唯讀 Workflow 已入 main，但最新查無 G1 manual workflow_dispatch Run，GitHub Connector 無 dispatch 能力，故 G1 NOT_RUN。新增手動、main-only、受保護 cloudflare-g0-readonly GitHub Environment 的 Cloudflare GET-only metadata inventory（Worker Scripts / Workers Domains / Zone Routes / workers.dev 與 Preview URLs）。需要獨立最小權限唯讀 Cloudflare API Token；輸出只有聚合旗標與數量，不列印實際網域/路由/Token/API 回應。即使全部旗標為 false，因未實地驗證 Access policy、Version/Deployment URLs 與 HTTP 路徑，本工具也永遠不認定 G0 PASS 或授權正式上線。本輪僅提交 code，**未執行 Cloudflare API**、未部署、Production CLOUD_AUTH_PHASE=disabled 與 /api/command 503 均保持不變。新 PR HEAD CI / Codex Review 待驗，未經使用者明確同意不 Merge。


> 2026-10-29｜P0 #34 G1：PR #39 Squash Merge 28cf72e4b899135deb7dff4dfaf41f902f2e10fd，main Hosted CI #40832201411 completed/success 5/5 PASS。新增僅 main 手動 workflow_dispatch 的 Cloudflare Staging D1 遠端唯讀 Schema/Migration/0002 Index/FK/Owner 聚合筆數驗收，固定 STAGING_DB 及專用帳號、d1-staging environment、與 migration 共用 concurrency，secret 僅限 query 步驟，RUNNER_TEMP 暫存清理，不查任何用戶明細或密碼/token，不觸碰 Production。附離線驗證工具、合成測試與 SHA-256 封閉清單。此 PR 本身未實際呼叫 Cloudflare，遠端驗收只在合併後人工觸發才可建立 G1 證據。Access/Hosted CPU/Production migration/備份/Owner UAT 全未實證，Production Login/Write 仍 503。最新 HEAD CI/Codex Review 待核實，未授權不得 Merge。


> 2026-10-29 P0 #34：PR #38 已 Squash Merge `5a2daeb2a63395fcfe1e90ce2393ccbfd4fb91b3`；合併後 Main CI #40825398666 啟動，實際結論須重新向 GitHub 核對。下一增量：D1 **盤點確認＋差額庫存流水＋稽核**內部原型，雙守衛 `CLOUD_AUTH_PHASE=preview-readonly` / `STOCKTAKE_WRITE_STAGE=internal-test-only`，**未接公開 Worker**。在 D1.batch 內以 NOT NULL constraint 重驗有效 Session/角色/門市/食材、盤點 pending、帳面與 expected_qty 差異不得超過 1e-6、禁止已有相同盤點 adjustment。差額為零不建立 stock_moves；差額非零建立一筆 adjustment 並驗證 confirmed 結果與最終庫存。合成回歸包含過期、跨店、競態與各階段故障回滾；並不代表遠端 Cloudflare D1／正式 Login／Access／備份／UAT 完成。待新 HEAD Hosted CI 與正式 Codex Review；未經使用者同意不得 Merge。


> 2026-10-29｜P0 #34：PR #37 Squash Merge `6b02c8a7b701ed2b1900f9ceb24afde7da5e3938`，合併後 Main CI #40813298768 5/5 PASS。本輪新增未接上公開 Worker 的 D1 多品項單據整張核准／收貨內部原型：由 SQL NOT NULL constraint 在 batch 交易內檢查完整品項、連號、同一門市與廠商、授權／Session、既有 stock_moves，任何異常必須觸發整批 SQL 交易回滾；收貨使用一個 INSERT…SELECT 全項入帳並檢查狀態，原則上避免 D1 0-row 不回滾缺陷。`GROUP_ORDER_WRITE_STAGE=internal-test-only` 與 `CLOUD_AUTH_PHASE=preview-readonly` 雙守衛。僅測合成資料、未操作 Cloudflare Remote D1，Production `/api/command` 仍 503。最新 HEAD CI／正式 Codex Review 和 Merge 待驗證／授權。


> 2026-10-29 P0 #34：已驗證 PR #36 Squash Merge，main `99450d54ba4a4114855bc8ed3c859543842281e0`；主線 Push CI #40793932322 5/5 PASS。下一增量為**不連接 public Worker**的 D1 單品項叫貨核准與收貨交易原型，必須 `CLOUD_AUTH_PHASE=preview-readonly` 且 `ORDER_WRITE_STAGE=internal-test-only`，使用合成資料測試權限、稽核、庫存流水和一次性驗收。整張多品項 POB 單拒絕逐行驗收；本增量不含進價/價格寫回、正式登入、D1 migration、真實 Cloudflare Access/Hosted CPU、業主 UAT。PR 未經使用者授權不得合併。


> 2026-10-29｜PR #35 已 Squash Merge，main `436b10ea8088b31b7294efb4960b4d69201247f8`；P0 Issue #34 下一步為 D1 任務狀態異動及稽核的受控內部增量。此 PR 僅新增**未連接公網 Worker 路由**的內部程式和合成回歸，需 `TASK_WRITE_STAGE=internal-test-only`、`CLOUD_AUTH_PHASE=preview-readonly` 雙重測試守衛。Production/Preview 公開 `/api/command` 仍 503；不涉及 production D1 migration、正式帳密及營運資料。等待最新 HEAD Hosted CI、正式 Codex Review 與使用者 Merge 授權；Cloudflare 實站 Access/CPU/資料備援/UAT 均未完成。

> 2026-10-29｜P0 Cloudflare 正式營運優先：依業主要求，正式生產部署及 D1 實際業務操作優先於 RB-006 第二階段。main PR #33 Squash `976859cd851da6cb917cf1b17594c49c0e4bf63b`、Push Verify #40735901964 5/5 completed/success。Issue #34 為 Production 放行追蹤。本增量只新增 Preview D1 `/api/data` 白名單唯讀資料與 DB 內角色/門市過濾，不開啟雲端登入、不做 production D1 migration、不修改正式資料。Production 仍是 Demo-only、CLOUD_AUTH_PHASE=disabled。Owner 真實營運/Access/Hosted CPU/備份/UAT 仍待完成；本 PR 最新 Head CI/Codex 以 Hosted 實測為準。


> 最新狀態以本節、`.codex/backlog.md` 與當前 Hosted GitHub 為準。下方有日期的章節刻意保留舊時點資訊，**不能作為今日 PR／部署狀態**。

- 專案：餐廳好管家 / `restaurant-business-poc` GitHub **Public**。最新已核對 Hosted main `40d3607789d3bc14ececd56fb6d7f1b69d6bfad9`（PR #30/#32 均 Squash Merge；main push Verify #40628721464 completed/success 5/5）。RB-011 真實 Windows 異機還原／RTO-RPO／業主簽收 Issue #31 尚未實測。本輪 RB-006 進入跨日班第一階段開發：不改 SQLite Schema v3，`shift.create` 允許 end_time 早於 start_time 代表翌日；檢查同員工前／當／隔日與跨店班次重疊；UI 明確標示隔日，加入虛構回歸測試。PR #33 初輪 Hosted CI completed/success、正式 Codex Review 有 P2：9999-12-31 日期上界令 SQL 範圍失效；本修正補 0000/9999 邊界與回歸，新 HEAD CI／複審仍待驗證，未授權不得 Merge；月曆／換班／工時法規／請假衝突未實作。Cloudflare production D1/Access/Hosted CPU 未驗證，正式登入不可開啟。
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
