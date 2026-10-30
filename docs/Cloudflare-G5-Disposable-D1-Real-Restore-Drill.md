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

### 2026-10-30｜G5 Pages Projects API 分頁相容性（Run #40997303708）

真正的手動唯讀 [Run #40997303708](https://github.com/hun186/restaurant-business-poc/actions/runs/40997303708) 使用 `main=5219b1259117b430cee0103dd44666790c949e59`，`HOSTED_PROBE_STATIC_PREFLIGHT_PASS`；後續回報 **`G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=HTTP_OTHER`**。可確定失敗發生在 GET Pages projects list 階段，且不是當時程式識別的 401/403/404/429/5xx/網路錯誤；但原診斷**無法確認是 HTTP 400 還是其他未分類 HTTP 狀態**，不能宣稱帳戶權限問題，也不能宣稱遠端無直接綁定。

原版共用 `per_page=50`，包含 Pages Projects List。Cloudflare [Pages Projects List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 文件示例使用 `per_page=20`，而 Pages 另一份歷史分頁實作曾有每頁 25 限制的回報；不能直接假定兩種端點現行上限相同。本 PR **僅改 Pages Projects List** 使用獨立 `per_page=20`，保留 Workers Versions 的 `per_page=50` 與 Pages 清單 `result_info` 的 `count/page/per_page/total_count/total_pages` 完整性驗證，並新增跨頁 21 筆與缺頁／metadata 不一致的合成測試。HTTP 400 另外歸為固定安全原因 `HTTP_BAD_REQUEST`，不輸出實際回應、URL、Pages 名稱、UUID、Token 或 Cloudflare 錯誤本文。

**這仍屬待驗證的相容性修正，而非已確認根因。** PR 須另行完成 Hosted CI、正式 Codex Review 和使用者批准 Merge；其後以最新 `main` 開新 `workflow_dispatch` 才能再次實測。若仍在 `PAGES_LIST` 回報 400 或其他錯誤，繼續釐清 Cloudflare 請求／權限，而不是放寬檢查或擴大 Token 權限。Cloudflare Restore／Production Write 繼續禁止。

### 2026-10-30｜Pages HTTP 400：GET 對照診斷（新增，尚未實測）

在 [Run #40998874342](https://github.com/hun186/restaurant-business-poc/actions/runs/40998874342)（正式 main `111f302ad2f8c68102f3ab792ddc000f1a99f060`）中，Pages `GET /accounts/{id}/pages/projects?page=1&per_page=20` 實際回覆 **HTTP 400**，日誌為 `G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=HTTP_BAD_REQUEST`；前次改為 20 筆仍未解決。Cloudflare [Pages Projects List 官方 API 文件](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 明確指出 `page`、`per_page` 是**選填**，因此本次改為取得更具鑑別力的唯讀實證，而非繼續猜測限制或擴大 Token 權限。

當且僅當**第一頁** paged Pages GET 失敗並被分類為 `HTTP_BAD_REQUEST` 時，額外執行一次**同一帳戶、同一 API Token 的不帶 query GET**（`/pages/projects`）。結果只記錄固定列舉字串，例如：

- `stage=PAGES_LIST reason=HTTP_BAD_REQUEST bare_probe=OK`：無 query 的 API 回覆有效 Pages list envelope；可以推論兩種 GET 行為不同，但**仍未取得完整盤點證據**。
- `bare_probe=HTTP_BAD_REQUEST`：無 query 也回覆 400，應往帳戶/API 授權、Cloudflare 服務條件等原因進一步核對，不能認定是分頁參數。
- `bare_probe=HTTP_AUTH`、`HTTP_RATE_LIMIT`、`HTTP_SERVICE`、`NETWORK_ERROR`、`BODY_INVALID`、`API_DECLINED` 等：只說明這個唯讀對照的類別，仍不得宣稱根因確立。

任何 `bare_probe` 結果都**一律重新拋出原始 paged HTTP 400**，Workflow 必須以 exit 1 Fail Closed 結束；不會改用 bare GET 結果當作完整專案清單，也不會跳過嚴格 `total_count/total_pages`、Worker/Pages 部署有效綁定或人工驗證。額外請求上限 1 次，只能 GET、不允許 redirect、沿用原本 15 秒逾時與原文 2 MB 上限；無 HTTP response body、API URL、專案名稱、D1 UUID、Token 或堆疊輸出。

合成測試涵蓋 bare GET 有效／失敗／格式異常、第一頁 HTTP 400 觸發一次、其他錯誤及後續頁不得觸發、原始錯誤物件不被取代、永不產生完成盤點的假結論。這項 PR 需 **Hosted CI、正式 Codex Review、另一次使用者明確 Merge 授權**；合併後從最新 `main` 手動發起**全新**唯讀 Run 才能取得真實 `bare_probe` 結果，不應 Re-run 舊 Run。Remote Restore / Production Migration / D1 Write 繼續禁止。

### 2026-10-30｜Pages 清單 HTTP 400：分別測試 page 與 per_page（待實測）

原本 [Run #41002452609](https://github.com/hun186/restaurant-business-poc/actions/runs/41002452609)，在 `main=8fa3600c6a7586cdf598810db8d3a8dd98ac83df`，實際回報 **`G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=HTTP_BAD_REQUEST bare_probe=OK`**。同一帳戶同一 Token 的不帶 query GET 成功回傳 `success:true` 與 `result:array`，但帶 `?page=1&per_page=20` 回傳 HTTP 400；**仍無完整 Pages/Worker 綁定盤點或 Restore 放行證據**。Cloudflare [官方 Pages Projects List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 將 `page`、`per_page` 列為選填數值參數，實際失敗原因尚需隔離。

本 PR 只在**第一頁、`?page=1&per_page=20` 的 GET 回覆 HTTP 400** 時，用相同唯讀 Token 再執行固定上限 **3 次額外 GET**，依序比較：

1. 不帶 query：`/pages/projects` → `bare_probe`；
2. 只帶 `page=1` → `page_probe`；
3. 只帶 `per_page=20` → `per_page_probe`。

每項只回傳固定字串 `OK`、`HTTP_BAD_REQUEST`、`HTTP_AUTH`、`HTTP_NOT_FOUND`、`HTTP_RATE_LIMIT`、`HTTP_SERVICE`、`HTTP_OTHER`、`NETWORK_ERROR`、`BODY_INVALID`、`API_DECLINED`、`VALIDATION_FAILED`；不輸出錯誤本文、Token、URL、帳戶或資源識別碼、堆疊。每次 GET 都維持 15 秒逾時、最多 2 MB 回應、redirect 禁止。即使 3 個 GET 全成功，**仍會原樣拋出原始分頁 GET 的 HTTP 400，Workflow Exit 1**，不可將這些對照讀取內容當成完整項目清單、不可繞過原本完整分頁 metadata、Pages 目前/已部署版本綁定及獨立人工檢查。其他錯誤、後續頁、成功的 paged GET 均不觸發額外對照。

本 PR 合成回歸檢查：三種 query 形態分離、總請求上限、原始錯誤不被覆寫、不同 HTTP 回應的固定代碼、只用 GET、不跟隨 redirect、不洩露敏感資料，且不得製造盤點成功。須最新 HEAD Hosted CI 5/5、正式 Codex Review 完成、使用者**另行**批准 Merge 後，才從最新 `main` 開啟新 `workflow_dispatch` 實測；不擴大 Cloudflare Token、**不**執行 D1 Restore / Production Write。

### 2026-10-30｜G5 Pages GET `per_page` 造成 400：改為 page-only 嚴格清單（PR 待審）

已在最新 main `62e43fce4ef8439c9039579ba8e12817cd5bc462` 的 [G5 Run #41009848022](https://github.com/hun186/restaurant-business-poc/actions/runs/41009848022) 實測：`stage=PAGES_LIST reason=HTTP_BAD_REQUEST bare_probe=OK page_probe=OK per_page_probe=HTTP_BAD_REQUEST`，和較早的 Run #41009437869 一致。實際 GET 結果明確顯示 **含 `per_page=20` 的請求得到 400**，而無 query 或僅 `page=1` 得到有效列表回應；先前只調整 `per_page=50`→20 仍然失敗。Cloudflare 官方 [Pages Projects List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 雖公開定義 `page`／`per_page` 為選填，但此帳戶真實行為不一致，並不代表應該提高 Token 權限。既有診斷未讀取回應原文，不能宣稱 400 的服務端根因已完全查明。

本 PR 把**正式 Pages Projects 清單**改為 `GET .../pages/projects?page=N`，不發出 `per_page` query；每一頁均嚴格要求 Cloudflare `result_info` 的 `page`、`per_page`、`count`、`total_count`、`total_pages` 合法且互相一致。由**伺服器回傳的 `per_page`** 推得完整頁數（上限 100），同次掃描任何頁的 `per_page`、`total_count` 變動、少頁／缺頁、數量不符、無效型別都 fail closed；列舉總專案數上限仍為 500，不能因單一 GET 成功就視為完整盤點。Worker Script Versions 仍走其原本獨立 `per_page=50` 流程。

原本的三種安全對照診斷保留作為舊版 `?page=1&per_page=20` 行為的函式測試，但正式清單不再呼叫會觸發它的 URL。已新增實際 Pages page-only 路徑、動態 server page size=10 / 20、21 筆跨頁、total_count/page/per_page 不一致、缺頁和上限拒絕的合成回歸。保留原本 **Pages Deployment 有任何專案即不得視為已完成有效部署 Binding 全覆蓋** 的判定；若 Pages 清單／詳情仍不可信，一律回報失敗而不是假 `NO_DIRECT_BINDING`。

程式與測試需重新鎖定 SHA-256 並完成最新 HEAD Hosted CI + 正式 Codex Review；**沒有使用者明確 Merge 授權不能合併**。此 PR 不會觸發 Cloudflare 新 Run，也沒有 Cloudflare 變更權限、恢復、Migration 或 Production 寫入；只能在批准合併後由使用者手動在最新 `main` 新建 GET-only Workflow Run，才能確認遠端完整性。


### 2026-10-30｜Pages page-only HTTP 正常後仍 VALIDATION_FAILED：固定類別診斷（待遠端實測）

GitHub main `019b74b30b582e630aa4ee78aac6a969d1790676`（PR #54 合併，Postmerge Verify #41015489859 5/5 PASS）的新 GET-only Cloudflare [Run #41016132258](https://github.com/hun186/restaurant-business-poc/actions/runs/41016132258) 和 [#41016228381](https://github.com/hun186/restaurant-business-poc/actions/runs/41016228381) 都是 **`G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=VALIDATION_FAILED`**。先前失敗原因為帶 `per_page` 時 HTTP 400；改成 `?page=N` 後沒有再報 HTTP 400，但現有日誌無法辨識是 Pages API 回傳的選填 `result_info` 欄位不足、頁數/總筆數不一致、還是專案名稱/重複資料等。Cloudflare 官方 [Pages Projects List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 的 `result_info` / 部分欄位在 schema 上為 optional，因此不可逕自推論根因或把缺漏當作清單完整。

本 PR 只在 **Pages 清單驗證失敗**時補充一個由原始碼固定白名單產生的 `validation_code=...`，例如 `PAGE_RESPONSE_INVALID`、`PAGE_METADATA_MISSING`、`PAGE_SIZE_INVALID`、`PAGE_SIZE_CHANGED`、`PAGE_NUMBER_MISMATCH`、`PAGE_COUNT_MISMATCH`、`PAGE_TOTAL_INVALID`、`PAGE_TOTAL_PAGES_INVALID`、`PAGE_TOTAL_PAGES_MISMATCH`、`PAGE_TOTAL_CHANGED`、`PAGE_INCOMPLETE`、`PAGE_PROJECT_NAME_INVALID`、`PAGE_PROJECT_NAME_DUPLICATE`。不輸出實際欄位值、頁面數值、完整 URL、Cloudflare response/body、專案名稱、D1 UUID、Token、stack 或例外原文。所有錯誤仍使用原有 `VALIDATION_FAILED` 和非零 exit code；不可將診斷代碼視為成功的盤點證據。

維持 500 專案的上限、伺服器 `per_page` 1..100、全頁數量、total_count/total_pages 一致、無重複專案與 Pages 已部署版本綁定無法由 current config 單獨驗證的保護。新增合成 regression 逐一證明固定錯誤類別、不洩露回傳值及合法跨頁資料仍正確；SHA-256 Manifest 和 `.codex` 記憶更新。PR 須先最新 HEAD Hosted CI 5/5 PASS、正式 Codex Review、獨立使用者 Merge 授權；合併後才由使用者啟動最新 `main` 的全新 GET-only Run，取得真正 `validation_code`。不提升權限、不執行 Restore、Migration 或 D1 寫入。


### 2026-10-30｜Pages result_info.total_pages 可省略：保留完整分頁驗證

最新 main `77db23f3e49b108c8246682546febcb35d2e6f9d`（PR #55 已授權 Squash Merge、Postmerge Verify #41019351188 PASS）的實際 Cloudflare GET-only [Run #41020107558](https://github.com/hun186/restaurant-business-poc/actions/runs/41020107558) 通過靜態預檢，但正式 G5 盤點 **FAIL**，且精確回報 `G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=VALIDATION_FAILED validation_code=PAGE_TOTAL_PAGES_INVALID`。此代碼僅能證明 `total_pages` 不符合「正整數」的既有規則（可能是省略、null、字串或不合規數字）；不會透露實際 Cloudflare 欄位原文。官方 [Pages List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 明確將 `result_info.total_pages` 宣告為 **optional**，因此原程式將它視為必填不符合 API 契約。

本 PR 做**最小相容修正**：正式 Pages 清單仍只發 `GET .../pages/projects?page=N`（不發 `per_page`），仍必須確認完整的 `result_info` 以及 `page`、`per_page`（1～100）、`count`、`total_count`（不超過 500）；從 `max(1, ceil(total_count/per_page))` 計算**預期最後一頁**。唯有 `total_pages` 確實**省略**（undefined）時，才可依已核實的兩個必要欄位推算；若該欄位存在，仍必須是正整數且等於計算結果（`null`、字串、零、錯誤整數一律 Fail Closed）。每頁累計項目必須與 `total_count` 精確吻合，跨頁 `per_page`、`total_count` 不可漂移，缺頁、少筆、不合法項目／重複專案名稱仍拒絕。只有限制內完整列舉才會進入 Pages 詳情的 D1 綁定檢查，**Pages 有部署時依然不可推論已查完所有有效部署版本的 D1 Binding**，不得因此准許 G5 Restore。

合成回歸包括缺少 `total_pages` 的單頁、空清單、兩頁，混合「缺少／提供正確 total_pages」的兩頁，仍拒絕提供錯誤 total_pages、缺頁、total_count 變動、per_page 變動、缺少其他必要 metadata；SHA-256 安全 Manifest 與 .codex 專案記憶同步。此為程式修正，**尚未遠端實測**；需 Hosted CI 與正式 Codex Review、使用者再次明確 Merge 授權，合併後從最新 `main` 發起新的人工 GET-only G5 workflow 才能確認下階段結果。不得擴增 Cloudflare Token 權限、不可執行 D1 Restore／Production Migration／資料庫寫入。


### 2026-10-30｜新版仍觸發 PAGE_TOTAL_PAGES_INVALID：限定 nullable hint 相容修正

已實際核對 GitHub 最新 **main=`70a07aab4f034ccf184385c5f53e0654f17a80ca`**（PR #56 已獲使用者明確授權 Squash Merge、[Postmerge Verify #41023736114](https://github.com/hun186/restaurant-business-poc/actions/runs/41023736114) **5/5 PASS**）。全新的真正 Cloudflare GET-only [G5 Run #41023956018](https://github.com/hun186/restaurant-business-poc/actions/runs/41023956018) 使用同一 main SHA、run_attempt=1，靜態預檢 PASS，正式盤點仍明確回報 `G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=VALIDATION_FAILED validation_code=PAGE_TOTAL_PAGES_INVALID`。**不是舊 SHA 的 Re-run**；PR #56 允許 undefined、但仍拒絕任何有值但非正整數的 `total_pages`。現有代碼不會暴露實際回應內容，因此目前**不知道** Cloudflare 提供的是 `null`、字串、零、非整數還是其他型別。不得將任何一種猜測寫成遠端實證。

官方 [Pages List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 表示 `result_info.total_pages` 為 optional number，並不明示 nullable。基於其僅是可選的「總頁數提示」，本 PR 對其進行**窄幅相容**：只有 **undefined 或 null** 才會視為沒有可用提示，不使用它決定掃描頁數；實際預期最後頁始終以已**嚴格驗證**之 `result_info.total_count`（<=500）及 `per_page`（正整數 1..100）計算。若另提供 `total_pages`，必須是數字型別、正安全整數並與計算結果相同。錯誤型別拒絕並新增不洩露值的固定 `PAGE_TOTAL_PAGES_TYPE_INVALID`，非正整數仍為 `PAGE_TOTAL_PAGES_INVALID`，數字不一致仍為 `PAGE_TOTAL_PAGES_MISMATCH`。不接受字串數字、不做無條件忽略、不增加 GET 路徑或 Cloudflare Token scope。

原有 GET-only `?page=N`、`page/count/per_page/total_count` 必填、跨頁總筆數與頁大小不變、每頁項目總數精確符合 total_count、缺頁、重複／不合法專案名稱、500 項上限與正式 Pages 部署版本 Binding 未驗證時的 Fail Closed 均保持。已新增單頁、零筆、兩頁、混合 nullable/undefined/正確值、缺少後頁、跨頁筆數變動、錯誤型別/值/重複專案名的合成回歸。SHA-256 manifest、.`codex` project memory/backlog 更新。**本 PR 尚未合併或遠端實測**；只有在最新 HEAD Hosted CI 5/5 PASS、正式 Codex Review 完成且無未解決 Findings、獲得使用者另一次 Merge 授權後，才能於最新 `main` 建立新的 Cloudflare G5 GET-only Run。若仍有 `PAGE_TOTAL_PAGES_TYPE_INVALID` 等，依下一次實際證據再處理；絕不能以測試過關宣稱 D1 Binding 安全、Pages 已部署版本完整或 Restore 可執行。禁止 D1 Restore、Production Migration／寫入及擴權。


### 2026-10-30｜合併後最新 G5 仍失敗：僅空清單允許 total_pages=0

最新 `main=233a1c1b58c3865884456d95b8f321764ec35aa5`（PR #57 授權 Squash Merged，[Postmerge Verify #41027139504](https://github.com/hun186/restaurant-business-poc/actions/runs/41027139504) completed/success）。新的真人觸發 Cloudflare GET-only [G5 Run #41027408751](https://github.com/hun186/restaurant-business-poc/actions/runs/41027408751) 使用相同 SHA、run_attempt=1，靜態預檢 PASS，但 **`G5_BINDINGS_READONLY_FAILED stage=PAGES_LIST reason=VALIDATION_FAILED validation_code=PAGE_TOTAL_PAGES_INVALID`**。PR #57 已將 null/undefined 視為缺少選填提示，其他型別則回傳不同的 `PAGE_TOTAL_PAGES_TYPE_INVALID`；這次同一錯誤代表資料在既有檢查中屬 **number 但不是非零正安全整數**（例如 0、負數或小數）。API 原始值未輸出，因此**不能斷言實際回傳是零，也不能斷言帳號沒有 Pages 專案**。

Cloudflare 官方 [Pages Projects List API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/) 將 `result_info.total_pages` 定為 optional number，但未保證空清單以零表達。出於數學上「總項目數零對應總頁數零」與空集合處理相容性，本次採**窄幅、有條件**修正：只在已通過檢查的 `page=1`、`total_count=0`、`count=0`、`result=[]`、合法 `per_page` 同時成立時接受 `total_pages=0`；不會跳過第一頁 GET。若 `total_count>0`、結果非空、非第一頁或 `count` 不符，任何 `total_pages=0` 仍 Fail Closed（`PAGE_TOTAL_PAGES_MISMATCH` 或既有頁數／筆數錯誤）。所有負數、小數、錯誤型別及與 `ceil(total_count/per_page)` 不一致的正整數都拒絕；null/undefined 仍由已嚴格驗證的 total_count/per_page 驅動逐頁掃描。

保留 Pages GET-only `?page=N`、總數 max 500、必填 `result_info.page/per_page/count/total_count`、跨頁總數及單頁大小一致、精確數量與無重複項目、Worker Versions 不變，還有 **Pages configured bindings 不是已部署版本直接綁定的證據**的原有保守狀態。合成測試驗證空清單接受零、非空/跨頁零拒絕、錯誤型別/負數/小數/矛盾計數拒絕，並更新 manifest SHA-256、memory/backlog。

此次修正屬**假設性相容性修補**而非已證實的 Cloudflare 回應值；必須完成最新 HEAD Hosted Verify + 正式 Codex Review、經使用者再次明確授權 Merge、再以最新 `main` 開新的 GET-only G5 Run 才能知道真正遠端結果。不得操作 Restore、D1 寫入、正式 Production Migration 或擴大 Cloudflare Token 權限。