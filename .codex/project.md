# 餐廳好管家 Project Profile

## Current State


> **最新 authoritative snapshot（2026-10-30｜G5/#46，已實際核對 Hosted GitHub）：** PR #58 已經使用者授權 Squash Merge，後續 PR #59（只更新安全稽核 Runbook、專案記憶與人工審查清單）已經獲使用者授權 Squash Merge；最新 **main `4df4a1cf2b48e1bba3f30b5eed7d3b2a51d07dd1`**，[Postmerge Verify #41048404867](https://github.com/hun186/restaurant-business-poc/actions/runs/41048404867) **completed/success 5/5**，Cloudflare Workers Build Success。真實 Cloudflare GET-only [G5 Worker／Pages binding inventory #41041385954](https://github.com/hun186/restaurant-business-poc/actions/runs/41041385954) **completed/success**，檢查 1 Worker Script、47 個 Versions、0 Pages projects，固定 disposable D1 的直接綁定命中 0，回報 `G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED`。真實 Cloudflare [D1 disposable Inspect #41046807367](https://github.com/hun186/restaurant-business-poc/actions/runs/41046807367) **completed/success**，`inspect` SUCCESS、`drill` SKIPPED，日誌 `G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS`，驗證當時空庫 Schema、quick_check、Bookmark，**不是 Restore**。因 PR #59 僅改文件，以上機器成功證據來自 PR #58 合併後的 main、並非在新 SHA 重跑的遠端 Cloudflare 盤點。
>
> **G5 目前阻擋關卡：** 獨立人工 Cloudflare Workers／Pages 與間接 Service Binding／其他操作路徑覆核、固定 D1 的當下人工作證、Cloudflare Audit Logs 與帳戶成員／Token／排程／並行操作安全確認、可驗證的 GitHub `d1-recovery-drill-write` main-only 和真正獨立 reviewer/Prevent self review/無預置 Write Token、私有證據索引與簽核，**均 PENDING**。GitHub Connector 不能直接查閱受保護 Environment 實際規則，沒有 Cloudflare 帳戶 Audit Logs／Dashboard 權限，不能由機器唯讀成功推論以上項目 PASS。Repo 只有一名已知維護者，**不能宣稱已有獨立人員審批**；若無可接受的第二審核人，仍應繼續 BLOCKED 或改採獨立 Cloudflare 帳戶建立全新的 disposable D1 並另經 Pin/Review，不得利用文字自證繞過。
>
> **禁止與下一步：** `G5_DRILL_RESTORE_APPROVED` 應維持未設定、`CLOUDFLARE_D1_DRILL_WRITE_TOKEN` 不得預置。PR Merge／CI PASS／Inspect PASS **均不是** `mode=drill` 或遠端 Restore 的許可；不得做 D1/Production Restore、Production Migration/Login/Write、Token 擴權；未完成加密異地備份與 RPO/RTO 的 Production Ready 仍是 false。下一步依 [G5 Issue #46](https://github.com/hun186/restaurant-business-poc/issues/46) 與 [G5 Runbook](../docs/Cloudflare-G5-Disposable-D1-Real-Restore-Drill.md) 的 A–E 人工安全證據工作單履行，**需另一個明確使用者授權**才能進入破壞性演練。下列較早的 2026-10-30 快照僅為當時狀態，不代表目前 PR 仍未合併或尚未執行 Cloudflare。


> 2026-10-30 P0 G5/#46：使用者表示已完成 `d1-recovery-drill-write` 的 `main` 分支限制及非敏感 Variables；GitHub Connector 不支援 Environment 設定讀取，屬人工回報、非 API 驗證。Repo 無協作者，Required reviewers 雙人審核不可用。主線 PR #48 已 Squash Merge `0dd0484889f3332e9a84b4b9dfde97d5b6aa0326`、Postmerge CI #40973179539 5/5 PASS。現在新增獨立 G5 唯讀 Cloudflare Worker Versions／Pages Project D1 Binding 盤點工具（手動 main-only workflow、合成失敗封閉測試、SHA-256 指紋），只在新 PR 審核；**未呼叫 Cloudflare、未實證無綁定、未授權 Restore**。需人工配置單獨 Read Token/Environment；`G5_DRILL_RESTORE_APPROVED` 必須保持未設定、Write Token 不預置。正式 Production Migration／登入／業務寫入、加密異地備份、RPO/RTO 繼續未完成。

> 2026-10-30 G5/#46：以最新 main `938805ac0fa53fe7c0aa462b23e9b0292e8e5fcc` 為基底的安全加固分支新增每次執行都須確認的 Cloudflare 無 Worker Binding 與無並行使用者雙重 typed attestations；Workflow job guard、注入 Write Token 前 approval gate 與 CLI 三層 Fail Closed，增加未授權拒絕回歸與 SHA-256 閉鎖清單。已驗證 disposable 唯讀 Inspect #40914927490 Attempt 2 成功；遠端 Restore、Write Environment 實際保護與最小權限、加密異地備份、RPO/RTO、Production Login 仍未驗收；本分支 CI/Codex/合併另待核對，不得自行執行 Restore 或 Merge。

> 2026-10-30 / PR #41 G0 整合至最新 main（已含 PR #47 的隔離式 D1 Pin UUID）：新增固定 Cloudflare GET only 的 Worker/Domain/Zone 公開暴露面盤點、主線人工 Protected Environment 工作流程、synthetic total_count/多頁 fail-closed 測試及 reviewed SHA-256 allowlist。PR #41 前一 HEAD 903d15d 已通過 Verify 5/5、Workers Build 與 Codex 無 Findings；本整合 HEAD 須重新 Hosted CI + 正式 Codex Review，未通過前不可 Squash Merge。PR #47 已合併，但**未對真正 Cloudflare D1 API 做 remote inspect 或 Restore**。G0 仍未實際運行，Access / 正式登入寫入不可宣稱開放。

> 2026-10-30 P0 G5 / #46：使用者提供新建 disposable Cloudflare D1 UUID `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`。實際 main `32693574cdbc95838d5697e95a0ac76564ab23a2`，PR #45 已 Squash Merge，後續 Main CI #40906680916 completed/success 5/5 PASS，Workers Builds success。本次**獨立 Pin-ID PR** 僅改 `cloudflare/recovery-drill-target.json`、配套 tests、閉鎖 SHA-256 指紋與文件：固定新 UUID，防止 Production (`b882a6e8-0e56-49a6-bd41-1a6cadd726c9`) / Staging (`2c355bed-d9c3-449c-aa9b-1018f3bc1177`) 誤操作。**尚未由 Cloudflare API 實證名稱／UUID／後端／資料庫空白狀態**；GitHub PIN 驗證不代表遠端 inspect 成功。未建立或改動任何資料庫、未設定 Environments/Token、未執行 Restore/Migration/Owner/正式 login/write。PR Head Hosted CI/正式 Codex Review 尚待完成，使用者另需授權 Merge。下一步若 Merge，先配置保護的 `d1-recovery-drill-readonly` Environment 及獨立 Read Token，人工執行 `inspect`（`CHECK_DISPOSABLE_D1_READONLY`）；破壞性 `drill` 一律需不同 Write Environment、使用者另一明確授權。G5 Production 空庫 Run #40865818477 attempt 3 與 Time Travel Read-only Run #40872307187 均實證 PASS，但不是 Restore 實證。


> 2026-10-29 G5 Production Time Travel Read-only Run #40872307187 真實 PASS（metadata production backend/bookmark 與合成 SQLite），PR #44 Squash Merged main `468e64753db89be650def8a7dd735c67cdde93a9` 且 Postmerge CI #40870570004 success。**本次新階段**：新增只允許另經 PR 審核且固定 UUID 的全新 disposable Cloudflare D1 `restaurant-business-g5-disposable-recovery-drill` 執行的真正遠端 Restore 測試工具＋手動 Workflow＋合成 API 模擬測試。當前 `cloudflare/recovery-drill-target.json` 的 database_id 為 `PENDING_SEPARATE_REVIEWED_TARGET_PR`，全部遠端 inspect/drill 均 Fail Closed；使用者尚未建立新演練庫，也未授權任何 Remote D1 Restore。後續先人工建立獨立空庫、另開 PR Pin DB UUID 並 Review、設置分離的 `d1-recovery-drill-readonly` / `d1-recovery-drill-write` 受保護 Environments 與分離讀寫 Token，再手動 inspect 取得實際證據，最後需**另一次明確的演練庫 Restore 授權**才可跑 drill。Production/Staging DB ID 永遠被排除；沒有執行 Production Migration／還原／Owner/bootstrap，正式 Login/Write 繼續 disabled。獨立雲端演練也不能替代加密異地備份、RPO/RTO、Owner 恢復簽核。PR #41 G0 仍 Open、Issue #42 Cloudflare Workers Build 外部阻斷待單獨追蹤。新 PR CI/Codex 最新 HEAD 尚待核驗，沒有 Merge 授權。


> 2026-10-29 P0 #34 G5：PR #43 已 Squash Merge `ee3a5cceef7c496ab650810f0fe6fc3b26d11e16`，合併後 Main Hosted CI #40862923071 5/5 PASS；G1 Staging 遠端讀取完整性 Run #40854101717 PASS，G5 Production 原始空庫只讀 preflight Run #40865818477 Attempt 3 completed/success，log 有 `PROD_D1_PRISTINE_READONLY_PASS`，初始化 job SKIPPED。Production D1 仍無業務 Schema，未建 Owner，沒有執行 Migration/Restore；G5 `PROD_D1_RESTORE_DRILL_SIGNED_OFF` 不可設定。本輪新增 **獨立 G5 recovery readiness**：人工 main-only `d1-production-recovery-readonly-g5.yml`，於現有受保護 `d1-production-readonly` Environment 用 D1 Read Token 以 Cloudflare 固定 GET API 只讀查詢 Production D1 backend version=production 和 current bookmark；不輸出 bookmark。另做完全隔離的合成 SQLite VACUUM INTO 快照與還原測試；**此非 Cloudflare 遠端 Restore 實證**，也非加密異地備份及 RTO/RPO 已驗證。仍須新建完全獨立的 disposable D1、授權實際 restore 演練、確定帳戶 Free 7d/Paid 30d retention、異地備份加密及 Owner 復原簽核，才可考慮 Production apply。新 PR CI/Codex 最新 HEAD 待核對；不得未授權 Merge。PR #41 G0 未合併、Issue #42 Assets 10013 狀態需各自追蹤，正式 Login/Write 維持禁用。


> 2026-10-29 P0 #34/G5：真正 Staging G1 只讀 Run #40854101717 已完成 success，確認 schema v3、0001/0002、FK、單一測試 Owner（僅此子關卡 PASS）。Cloudflare Production D1 Studio 唯讀確認原始庫只有 `_cf_KV`，正式 Schema 尚不存在。新增 **Production D1 初始化防護流程**：main-only 手動 GitHub Actions 的 `preflight`（僅只讀）和 `apply`（需逐版40字 SHA、Environment 人工審批、復原演練簽核、G1 Run 审核、獨立最小權限 Token）模式，Production-only Wrangler config、不可與 Staging 混用、允許且固定 SHA 的 0001+0002 檔案、資料庫空庫與 quick_check 預檢、再次預檢、Time Travel bookmark 確認、postflight 驗證 22+1 表/3 indexes/0 user/0 stock/無 FK。現階段僅程式碼及合成回歸，未向 Production Cloudflare 發出任何 D1 查詢或 Migration、未實際驗證備份還原、未建立 Owner、不啟用 login/write。PR 待 HEAD Hosted CI/Codex Review、使用者明確 Merge 指令；Merge 不等於授權 Prod apply。PR #41 G0 Open 未 Merge、Cloudflare Workers Assets upload-session 10013 未確認解決（Issue #42）。


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
