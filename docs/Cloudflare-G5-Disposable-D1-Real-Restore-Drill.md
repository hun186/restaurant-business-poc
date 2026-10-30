# P0 G5｜獨立 Cloudflare D1 真實 Time Travel Restore 演練

## 目前進度與真實證據
- 2026-10-29：G1 Staging 遠端唯讀 [#40854101717](https://github.com/hun186/restaurant-business-poc/actions/runs/40854101717) SUCCESS。
- G5 Production 空庫唯讀 [#40865818477 Attempt 3](https://github.com/hun186/restaurant-business-poc/actions/runs/40865818477/attempts/3) SUCCESS，Production 沒有業務 Schema、沒有 Owner、`apply` SKIPPED。
- G5 Production Time Travel Read-only [#40872307187](https://github.com/hun186/restaurant-business-poc/actions/runs/40872307187) SUCCESS：version=`production`、current bookmark 可取得；隔離合成 SQLite 快照／還原成功。**不是 Cloudflare 遠端 Restore 實證**。

## 風險與策略
Cloudflare 的 `POST /accounts/{account}/d1/database/{id}/time_travel/restore?bookmark=...` **會覆寫目標資料庫**，不是 Clone。只允許在與正式／既有 Staging 完全不同的**新建、可丟棄、沒有任何真實資料**的 D1 演練庫執行。禁止對 `restaurant-business-prod`、`restaurant-business-staging` 執行 Restore，也禁止對它們建立／刪除資料表。
新建演練庫 UUID `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198` 已透過獨立 PR #47 鎖定至 main。**2026-10-29 遠端唯讀 Inspect Run #40914927490 Attempt 2 真實 PASS**，已核對 Cloudflare D1 UUID、名稱、production backend、空白 Schema、quick_check 與 Bookmark；但它**無法驗證 Worker Binding、其他操作者或遠端 Restore**，也未執行任何 Cloudflare 寫入。Write Environment 配置、Token 寫入權限、遠端恢復及簽核仍未取得實證。

## 階段 1：人工建立與 Pin，另走新的 Code Review
1. 由 Cloudflare 帳戶管理員在 Dashboard 的 D1 中**手動建立**全新空白資料庫，名稱必須完全等於 `restaurant-business-g5-disposable-recovery-drill`，且沒有 Worker 綁定、沒有員工／菜單／正式業務資料。不要複製 Production 或 Staging 資料，也不要從現有資料庫還原或 fork。需確認此庫支持 Time Travel 的 `version=production` backend。
2. 新資料庫 UUID 已由使用者提供，Pin-ID PR 提議在 `cloudflare/recovery-drill-target.json` 設為 `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`。先核對 UUID 格式、不同於 Production/Staging，並完成 Hosted CI + 正式 Codex Review + 使用者**另行授權 Merge**；**不能只依提供的 UUID 就斷言 Cloudflare 已驗證資料庫身分或是空庫**。在 Pin PR 合併前 `main` 仍為拒絕執行的占位設定；合併後也只可由授權操作者先準備獨立的唯讀 Environment/Token，再執行 `inspect`，不可直接進入破壞性 `drill`。
3. 另外建立受保護 GitHub Environments `d1-recovery-drill-readonly` 和 `d1-recovery-drill-write`，後者應要求不同的人工審批者。前者提供僅可讀取演練庫的 `CLOUDFLARE_D1_DRILL_READ_TOKEN` 及 `CLOUDFLARE_ACCOUNT_ID`；後者提供獨立最小必要權限的 `CLOUDFLARE_D1_DRILL_WRITE_TOKEN` 及帳戶 ID。Cloudflare 的 D1 Write Token 權限可能涵蓋帳戶多個資料庫；程式 UUID 防護並不等於平台強制的逐庫 IAM 隔離。若不能提供可接受的權限範圍，**不得允許演練寫入**。Secret 不得貼在 Issue/Chat/Log。

## 階段 2：正式執行前唯讀 Inspect
從 GitHub Actions `G5 isolated disposable D1 Time Travel restore rehearsal (manual gated)` 選 branch `main`、mode=`inspect`、confirm=`CHECK_DISPOSABLE_D1_READONLY`，其餘兩欄空白。這只檢查 Metadata 固定 UUID／名稱／`production` backend、`sqlite_master` 只含 D1 保留 `_cf_KV`、`PRAGMA quick_check=ok`、Time Travel Bookmark 可取；唯讀 SQL 是透過 Cloudflare `/query` 的 POST API 發送，沒有 SQL 異動。執行成功才可記為 `G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS`，仍**不是 Restore 通過**。

## 2026-10-30｜G5 寫入前獨立人工隔離確認（本次尚未獲 Restore 授權）

遠端唯讀 Inspect [Run #40914927490 Attempt 2](https://github.com/hun186/restaurant-business-poc/actions/runs/40914927490/attempts/2) **已實際 PASS**；Drill job skipped。這只能證明 D1 metadata、空白 Schema、quick_check、Bookmark，**不能**判定沒有 Worker D1 binding 或其他操作者，也不能當作 Restore PASS。

新增兩項每次 `mode=drill` 都要人工輸入的 typed attestations。這是 **GitHub 流程保護，不是 Cloudflare 機器自動驗證**，必須由獨立審批人在 Cloudflare Dashboard 檢查並於私有變更單保留時間、審批人及查核證據：
1. `binding_attestation=NO_DISPOSABLE_D1_WORKER_BINDING`：逐一確認此 disposable D1 未被任何正式／測試 Worker 或 Pages 服務、任何其他營運工具綁定；尤其檢查 Worker 的 D1 bindings、版本與環境，並確認無其他 script 正使用此 DB UUID。
2. `exclusive_use_attestation=DISPOSABLE_D1_NO_CONCURRENT_USERS`：確認只有合成資料，沒有真實業務資料、使用者或並行 Cloudflare Console/API 編輯，並建立維護窗口與停止其他操作者的方式。

缺任一字串，Inspect-for-drill 與 Write Job 的 job guard 都拒絕；即使流程被改變，Write Token 注入前的 approval gate 與 CLI 仍再次查驗。**Typed attestation 不會自動發現未知 Worker binding，因此沒有獨立的 Cloudflare 實證與人工審批時，不得填入這兩個值。**

正式授權前，`G5_DRILL_RESTORE_APPROVED` 仍不得設定；不預先常駐放置 D1 Write Token。Account-scoped D1 Write Token 仍可能影響同帳戶其他資料庫；固定 UUID 是程式內安全界線，若需平台層強制隔離，改以獨立 Cloudflare 帳戶演練並另行 Pin UUID／Review。失敗或逾時不得重新觸發破壞性演練，先人工查明狀態。

## 階段 3：另行明確批准的破壞性演練
**此階段絕不能因 PR Merge 或 inspect PASS 而自動執行**。確定新資料庫可以丟棄、其他操作者不會同時寫入、停損與證據保管責任人後，需使用者明確批准本次 `drill`。
先在受保護的 `d1-recovery-drill-write` Environment 設定非秘密 Variables：`G5_DRILL_RELEASE_SHA` = 最新已審查 main 完整 SHA、`G5_DRILL_APPROVED_DB_ID` = 本次已在 pin PR 審核的新演練 DB UUID、`G5_DRILL_RESTORE_APPROVED` = `DISPOSABLE_RESTORE_AUTHORIZED`。GitHub Dispatch 選 `mode=drill`、`confirm=RESTORE_DISPOSABLE_D1_ONLY`、`expected_sha` 填同一完整 SHA、`expected_drill_id` 填同一演練 UUID，並在獨立查核完成後填寫 `binding_attestation` 與 `exclusive_use_attestation` 兩個指定字串。只有此工作流程的 `inspect` Job 先通過、受保護 Write Environment 審批、SHA 與雙方 UUID 完整一致，才可執行演練。需另核對 Github Action 時間、執行者、受控變更窗口。
演練程式再次查驗 DB Metadata、空庫與 quick_check，**只在此新演練庫**建立固定的 `g5_disposable_probe` 虛構資料表及基準資料，取當下 Bookmark 後改寫資料、加入第二筆虛構資料，透過 Cloudflare Restore API 還原至 Bookmark，最後驗證基準資料保留、變更消失及 quick_check OK。只回報狀態及此次 Restore+Verify 毫秒；**不回傳或記錄 Bookmark、資料庫 UUID、API 錯誤內容或原始 SQL rows**。
任一步失敗時會 Fail Closed，**不自動 Retry、不清空演練庫、不自動回退**。人工保存 GitHub Run 與 Cloudflare 控制台證據，依獨立停損流程判定演練庫狀態；如果該庫已寫入合成資料，不可重跑空庫演練，需另建全新經審查 Pin 的資料庫。

## 尚未解除的正式上線關卡
- 即使真實獨立遠端 Restore PASS，也不代表正式庫已實際可回復、或具備**加密異地備份**、資料保留、RPO/RTO SLA、復原權限委派、演練簽核。Time Travel Free 7 天／Paid 30 天依方案，並非無限期離線備份。
- 本 PR 所有驗收回報強制 `production_restore_performed=false`、`production_migration_performed=false`、`recovery_signoff_granted=false`、`encrypted_offsite_backup_verified=false`、`production_ready=false`。不改變 Production `CLOUD_AUTH_PHASE=disabled`、業務寫入禁用及 G5 Production apply gate。
- GitHub 合併並不授權 Production Migration。`PROD_D1_RESTORE_DRILL_SIGNED_OFF` 不得因為本流程 CI、合成測試或只是 Inspect 成功而設定；須後續單獨檢查真正的遠端演練、備份及正式恢復方案。

## 官方文件
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/

## 2026-10-30｜G5 Worker／Pages D1 綁定唯讀盤點（新增，尚未對遠端執行）

使用者回報已設定 `d1-recovery-drill-write` 的非敏感 Variables 與 `main` 分支限制；GitHub Connector 無法直接查閱 Environment 規則，屬**使用者已設定／API 未獨立驗證**。因為只有一位 Repo 維護者，**Required reviewers 無法形成雙人審核**；不能將 Wait timer 當成第二位審核者。正式 Restore 仍未取得獨立授權。

新增手動 GitHub Actions `G5 disposable D1 Worker and Pages binding inventory (manual read-only)`，只用 Cloudflare GET API 盤點同帳戶可見 Worker scripts（當前 settings 與分頁歷史 versions 的 D1 bindings）及 Pages Projects（production / preview deployment configs 的 D1 bindings）。檢查目標固定為 `cloudflare/recovery-drill-target.json` 中已 Pin 的可丟棄演練庫；不輸出 Worker 名稱、版本 ID、D1 UUID、Binding 名稱、路由、Domain 或 Cloudflare 原始 JSON。

**首次設置**：在 GitHub Settings → Environments 建立 `d1-recovery-drill-binding-readonly`，Deployment branches 只允許 `main`。建立僅具 Cloudflare **Workers Scripts Read**（至少可讀 Worker versions/settings）及 **Pages Read** 的獨立專用 API Token，設定此環境的 Secrets `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_G5_BINDINGS_READ_TOKEN`。不要沿用 D1 Write Token；不應把 Token 寫到 Issue/Chat。**本 PR 沒有建立 Environment、Secrets、執行 Remote API 或寫入資料庫。**

PR 合併且人工設定後，GitHub Actions 選擇 `main`、輸入 `confirm=CHECK_G5_BINDINGS_READONLY`，執行此獨立 READONLY Workflow。若 API 權限不足、缺 Worker/Pages 可見性、版本列表無法完整分頁、任何回應不可信或存在不明 D1 binding，程式 Fail Closed；不把無資料誤判為沒有綁定。報告分成 `G5_DISPOSABLE_D1_DIRECT_BINDING_FOUND` 或 `G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED`，並有檢查數量與 `direct_binding_matches`。此工具**不能證明無間接 Service Binding、無帳戶外資源、無並行寫入者，亦不能代替人為獨立確認**；正式 `binding_attestation` / `exclusive_use_attestation` 仍維持人工簽核。

若此唯讀盤點結果顯示 `direct_binding_matches>0`，**不得執行 Drill**，須先查明來源、解除使用演練庫的綁定並重新查核（不得自動修改任何 Cloudflare 資源）。即使 `direct_binding_matches=0`，`G5_DRILL_RESTORE_APPROVED` 繼續未設定，Write Token 仍不得預置。

Cloudflare 官方唯讀 API：
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/

### Worker Versions 分頁格式與驗證限制（P2 修正）
Cloudflare `GET /accounts/{account}/workers/scripts/{script}/versions` 官方回應為 `{success:true,result:{items:[...]}}`，**不保證提供頂層 `result_info`**。不同於 Pages Projects 清單，Worker Versions 採獨立的 `page/per_page=50` 逐頁列舉：只有取得少於 50 筆的終端頁才結束；剛好 50 筆的整頁必須再要求下一頁（可能為空頁）；總量上限 500，超出或缺頁、重複版本 ID、回應格式不可信、權限不足均 Fail Closed。這個沒有總筆數的 API 不能保證遠端同時新增／刪除版本時仍為一致快照，因此 `NO_DIRECT_BINDING_DETECTED` 仍不等同安全簽核；要求人工在變更窗口重新核對。

### 2026-10-30｜Codex P2：Pages 已部署版本不能由目前專案設定代替（Fail Closed）

Cloudflare Pages 官方文件指出：更改 D1 Binding 後，必須**重新部署**才會生效。僅檢查 Projects API 的 `deployment_configs.production/preview` 會漏掉仍由舊版部署使用的 D1，即使現在設定已移除 Binding 亦然（[Cloudflare 官方 Pages D1 Bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)）。

本次採用**保守拒絕安全結論**的修正策略：若該 Cloudflare 帳戶有**任何 Pages Project**，本工具仍可盤點當前設定中的直接 D1 Binding，但**不會**宣稱已核實「沒有直接 Binding」；當當前設定未命中且存在 Pages 專案時，狀態為 `G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED`，且 `no_direct_binding_detected=false`、`pages_deployment_bindings_verified=false`、`direct_binding_inventory_collected=false`。只有在完整分頁確認帳戶中**沒有 Pages Project**，又沒有 Worker D1 Binding 命中時，才會輸出原本的 `NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED`；即使如此仍需獨立人為確認間接存取與其他操作者。若發現任一直接綁定，繼續回報 `DIRECT_BINDING_FOUND`，禁止演練。

這是刻意保留的**未完成關卡**，不是自動檢查每個 Pages 實際部署版本。若要關閉此缺口，需另外設計可取得有效部署 Binding 版本與完整清單的可驗證唯讀證據，並獨立人工核對。現階段不可因 Pages Projects 當前 `d1_databases` 是空的就設定 `NO_DISPOSABLE_D1_WORKER_BINDING` 或啟用 Restore 審批。

### 2026-10-30｜遠端唯讀盤點首次失敗與隱私保護診斷

第一次實際手動 [Run #40995372182](https://github.com/hun186/restaurant-business-poc/actions/runs/40995372182)（2026-10-30 03:05 UTC）**completed/failure**；checkout、Node、SHA-256 preflight **PASS**，盤點步驟歷時約 9 秒後輸出 `G5_BINDINGS_READONLY_FAILED`。該 Run Secrets 有 GitHub 遮蔽紀錄，但**不能證明 Token 有效、具有所需 Workers Scripts Read / Pages Read 權限，或 Cloudflare API 確實回傳正確內容**。目前無法從該 Run 確認具體失敗端點或原因；不得宣稱盤點已完成，也不建議在未知原因時直接擴大 Token 權限。

此 PR 新增**固定字串分類**，預計下次同一唯讀 Workflow 只顯示如 `G5_BINDINGS_READONLY_FAILED stage=WORKER_VERSION_LIST reason=HTTP_AUTH`，用於定位錯誤，不顯示 HTTP 原文、Cloudflare API 錯誤內容、D1 ID、Worker/Pages 名稱、API URL、Token 或堆疊。Stage 限於 `PRECONDITIONS`、`WORKER_LIST`、`WORKER_SETTINGS`、`WORKER_VERSION_LIST`、`WORKER_VERSION_DETAIL`、`PAGES_LIST`、`PAGES_PROJECT_DETAIL`、`UNKNOWN`。Reason 限於 `VALIDATION_FAILED`、`API_DECLINED`、`HTTP_AUTH`（401/403）、`HTTP_NOT_FOUND`（404）、`HTTP_RATE_LIMIT`（429）、`HTTP_SERVICE`（5xx）、`HTTP_OTHER`、`NETWORK_ERROR` 與 `BODY_INVALID`。成功回應解析後仍採原本 Fail Closed 規則；偵錯分類本身**不是**安全驗收通過。

只在新 PR 取得 Hosted CI、最新正式 Codex Review、使用者授權合併後，才重新在 `main` 執行 `CHECK_G5_BINDINGS_READONLY`；**不**建立或套用 Write Token、**不**觸發 Restore。
