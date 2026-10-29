# P0 G5｜獨立 Cloudflare D1 真實 Time Travel Restore 演練

## 目前進度與真實證據
- 2026-10-29：G1 Staging 遠端唯讀 [#40854101717](https://github.com/hun186/restaurant-business-poc/actions/runs/40854101717) SUCCESS。
- G5 Production 空庫唯讀 [#40865818477 Attempt 3](https://github.com/hun186/restaurant-business-poc/actions/runs/40865818477/attempts/3) SUCCESS，Production 沒有業務 Schema、沒有 Owner、`apply` SKIPPED。
- G5 Production Time Travel Read-only [#40872307187](https://github.com/hun186/restaurant-business-poc/actions/runs/40872307187) SUCCESS：version=`production`、current bookmark 可取得；隔離合成 SQLite 快照／還原成功。**不是 Cloudflare 遠端 Restore 實證**。

## 風險與策略
Cloudflare 的 `POST /accounts/{account}/d1/database/{id}/time_travel/restore?bookmark=...` **會覆寫目標資料庫**，不是 Clone。只允許在與正式／既有 Staging 完全不同的**新建、可丟棄、沒有任何真實資料**的 D1 演練庫執行。禁止對 `restaurant-business-prod`、`restaurant-business-staging` 執行 Restore，也禁止對它們建立／刪除資料表。
目前已由使用者提供新建的演練庫 UUID `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`，已提交獨立 Pin-ID 審查 PR；**尚未透過 Cloudflare 實際唯讀 API 驗證 UUID 與資料庫名稱、production backend、空庫狀態或 Worker 綁定**。這次 GitHub Pin 不會查詢／寫入遠端 D1，也沒有執行 Restore、設定 Token／Environment；遠端復原實績及簽核仍未取得。

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
