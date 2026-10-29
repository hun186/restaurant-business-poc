# G5｜D1 備份／復原能力與獨立還原演練驗收

## 事實與邊界（2026-10-29）
- Staging G1 真正遠端唯讀驗收 [#40854101717](https://github.com/hun186/restaurant-business-poc/actions/runs/40854101717)：Schema v3 / 0001+0002 / index / FK / one staging Owner PASS。
- Production G5 真正遠端空庫唯讀預檢 [#40865818477, Attempt 3](https://github.com/hun186/restaurant-business-poc/actions/runs/40865818477/attempts/3)：`PROD_D1_PRISTINE_READONLY_PASS` 和 `G5_PROD_D1_READONLY_PREFLIGHT_PASS`，初始化 Job Skipped，當時只存在系統 `_cf_KV`，沒有 Migration/Owner。
- 本 PR **僅提供** Production Time Travel 能力的**唯讀 Metadata + Bookmark** 取回檢查，以及在 GitHub Runner 臨時目錄內對**虛構 SQLite 檔案**的備份還原演練；**不是 Cloudflare 遠端 Restore、不是獨立 D1 還原演練成功、也不是加密異地備份或復原簽核**。
- 禁止向 Production 發出 D1 Restore、Migration、Export、資料異動。`CLOUD_AUTH_PHASE=disabled` / `/api/command` 503 不變。這個 PR 不更改既有 Production 初始化 apply workflow，也不設定 `PROD_D1_RESTORE_DRILL_SIGNED_OFF`。

## 新增唯讀人工驗收流程
GitHub Actions `G5 Production D1 Time Travel capability and isolated synthetic restore (manual read-only)`：僅 `main` 的 `workflow_dispatch`，輸入 `CHECK_PROD_D1_RECOVERY_READONLY`。共用 G5 Production 初始化 `concurrency`，使用現有受保護 Environment `d1-production-readonly`。不需要新的 Production Write token。
前置 SHA-256 指紋、合成 SQLite `VACUUM INTO` Snapshot、原檔變動後從 Snapshot 複製到另一個隔離的暫存 SQLite、`PRAGMA quick_check`／資料列／快照 SHA-256 驗證，全部在**無 Cloudflare 憑證**的 Node.js 24 步驟完成。從未對 `data/restaurant.sqlite` 或正式備份資料夾讀寫。
接著先用現有 `tools/cloudflare-prod-d1-init.mjs config` 驗證固定 Production D1 ID/帳號；只有最後一步才提供 `CLOUDFLARE_ACCOUNT_ID` 及 `CLOUDFLARE_PROD_D1_READ_TOKEN`。以 HTTPS 固定 API Host、GET、拒絕 Redirect、15 秒 Timeout、64KiB 上限，僅取：
- `GET /accounts/{account}/d1/database/{production_db_id}`：必須回傳固定的 Production DB name/UUID 與 `version=production`。
- `GET /accounts/{account}/d1/database/{production_db_id}/time_travel/bookmark`：必須提供符合格式的 **目前 bookmark**；絕不寫到日誌、Artifact、Commit、Issue 或對話。
若 API 失敗、Token 權限不足、DB ID 錯誤、非 Time Travel production backend、Bookmark 格式不符，流程 fail closed。成功只列印安全狀態與 `current_bookmark_retrieved=true`，其他欄位強制 `remote_restore_rehearsal_verified=false`, `offsite_encrypted_backup_verified=false`, `recovery_signoff_granted=false`, `production_ready=false`。

## 真正的 Cloudflare 遠端 Restore 演練，仍需另建隔離環境
官方 D1 Time Travel 可用於 `production` backend，Recovery Window 依 Workers 方案而不同：**Free 7 天、Paid 30 天**（2026-10-24 最新 Limits）。目前尚未驗證此帳戶實際方案、可還原時間與加密備份持久度。Restore 是**破壞性覆寫**且可終止執行中的查詢；不得在 Production 或現有營運 Staging 上直接演練。
後續真正 Cloudflare 演練須另由帳戶管理人建立**全新可刪除的 D1 演練庫**，固定並審核唯一 DB ID（必須與 Production/Staging ID 不同）、只有虛構資料的 seed、實際受控快照與 Time Travel bookmark、獨立最小權限 Write Token、保護 Environment 人工核准。演練採基準資料 → 插入虛構後續變動 → 以已核准 Bookmark **僅還原演練庫** → 查驗原始資料／新變動消失 → SQL quick_check／FK／migration 兼容性查核，並保留不含原始資料或 Bookmark 的私有 Run 證據。
該實際 Restore 工具和受保護 Workflow **目前未提供／未執行**；先設計獨立資料庫與權限、Rollback Owner 審批、防手滑措施，通過 Hosted CI／正式 Codex Review 且取得明確的『演練庫寫入與 Restore』授權後才能建立或執行。不可將本 PR 的合成檔案演練結果簽成正式 Cloudflare 遠端復原演練。

## 復原策略與簽核證據清單
- **復原時點：** 製作有日期與生效時段的 Runbook，保留 Bookmark 於受保護環境而非公開 Actions Logs；確保點位在 Cloudflare Time Travel 可恢復窗口內。
- **備份保留：** 另規劃超出 7／30 天窗口的**加密異地備份**（含存取權限、輪替、不可變留存／刪除策略），不能把 Time Travel 當作無限期異地備份。
- **RPO/RTO：** 在獨立 D1 演練庫計時並量測，記錄目標與實際結果；目前沒有可據以給出數字的實證，必須明寫未驗證。
- **作業權限：** 明確批准人、操作者、復原負責人、是否有操作中業務交易、隔離和停機程序，及復原後稽核／完整性驗證。再次確認 Production API 仍 fail-closed。
- **上線放行：** 本 PR 無論 CI/Review/遠端 Read-only PASS，都不能修改現有 `d1-production-migration` Environment 的 `PROD_D1_RESTORE_DRILL_SIGNED_OFF`，不能執行 Production Schema `apply`。只有實際遠端演練、備份策略與審核證據完成後，才可討論另一次明確授權。

## 官方參考
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/
