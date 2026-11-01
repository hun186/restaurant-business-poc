# Cloudflare Production D1 — Owner 一次性建立（未開放執行）

## 2026-11-01｜Owner + Time Travel 一鍵整合唯讀預檢（新選項 3）

Windows `run-production-owner-operator.bat` 新增 **選項 3：Check Owner + Time Travel bookmark（READ ONLY）**；Linux 同樣選 3，CLI 可直接執行 `node tools/cloudflare-prod-owner-operator.mjs --preflight`。此流程仍以本機互動式隱藏 Token 輸入，不需新建 D1。

它先檢查 Production v3、兩筆 Migration、Owner=0、業務與稽核資料為空、完整性與外鍵，接著使用相同的 D1 Read/Write Token 對**固定 Production D1** 發出 GET Metadata 與 GET Time Travel Bookmark。若任一步驟失敗，Fail Closed；不輸出 Token、Bookmark、SQL、完整資料庫回應或錯誤堆疊，亦不執行任何寫入。

成功結果 `PRODUCTION_OWNER_AND_TIME_TRAVEL_READONLY_PASS` 明確保留以下限制：`current_bookmark_retrieved:true`，但 `remote_restore_rehearsal_verified:false`、`offsite_encrypted_backup_verified:false`、`recovery_signoff_granted:false`、`production_write_performed:false`。**Bookmark 可取得不等於該資料庫已有經驗證的離站備份、實際還原能力或恢復簽核。**

若顯示 `phase=READ_RECOVERY reason=RECOVERY_UNAVAILABLE`，請檢查 Token 對固定 Production D1 的 Time Travel 讀取權限或使用既有 [G5 唯讀工作流程](../.github/workflows/d1-production-recovery-readonly-g5.yml) 交叉核對；不可推定是資料毀損或跳過安全門檻。選項 1、選項 2 原有語義不變，且此新選項 PASS **不自動授權**正式 Owner 建立。正式選項 2 仍需另外明確核准及備份／恢復方案。

## 2026-11-01 最新交接｜D1 REST Batch 特定回滾場景已實機 PASS，Owner 仍未建立

- 已確認：使用者在專屬 Scratch D1 上先回報 `SCRATCH_D1_EMPTY_VERIFIED`、後回報 `DISPOSABLE_D1_REST_BATCH_ROLLBACK_PASS`（2 筆控制資料、0 筆回滾殘留）；來源是操作者提供之非敏感輸出，未由此代理人直接查詢 Cloudflare。詳見 [隔離實機驗收](Cloudflare-D1-REST-Batch-Disposable-Rollback-Lab.md)。
- 最新已知 Production D1：Schema v3、0001/0002 已套用，先前 Owner 唯讀實測為 0；**執行任何正式 Owner 寫入之前，必須再次取得新鮮、完整的只讀 `PRODUCTION_OWNER_READY_TO_ENROLL_READONLY`**，不可將歷史 Owner=0 當作即時值。
- 這只解除 REST batch **指定 UNIQUE 故障回滾**的技術疑慮；尚未驗證任意中斷、Cloudflare API timeout 後的不確定提交、所有備份復原情境。不得推定正式 Owner SQL 或登入已通過實機。
- 放行之前還需：受控變更窗口及可恢復點／備份簽核、目標 UUID 與主線 HEAD/程式完整性、最新只讀 preflight、Owner 建立的獨立明確使用者授權及最小權限 Write Token、單次受控寫入、Owner=1/audit=1/Session=0 的只讀 postflight。任何異常只走只讀診斷，不自動 Retry／清庫／回復密碼。
- **本 PR 只更新紀錄與核准清單**；不得因此執行 `run-production-owner-operator.bat` 選項 2、`first-init`、Production Login enable 或 Cloudflare D1 刪除。Production `CLOUD_AUTH_PHASE=disabled` 繼續維持。
- Cloudflare Free D1 數量受限，Scratch Lab 及 G5 Recovery Drill 皆屬暫存用途；須遵守 [資料庫生命週期與回收規範](Cloudflare-D1-Database-Lifecycle.md)。

## 2026-11-01：Windows 選項 1 唯讀查詢失敗的診斷修正（PR 開發中）

實機操作回報：Windows 執行 `run-production-owner-operator.bat`，選 `1 / Check`，輸入隱藏 Token 後只顯示 `E_PRODUCTION_OWNER_OPERATOR`。這**無法判定**是 API Token、Cloudflare HTTP、REST 回應、網路或資料庫狀態問題；因為原始碼全部攔截成相同錯誤。選項 1 只發唯讀 SELECT/PRAGMA，不會建立 Owner，也不會修改 Production D1。正式 Schema v3/兩個 Migration 已完成，不可重跑 first-init。

本修正提供安全的分階段代碼：

| phase/reason | 操作者應做的事情 |
|---|---|
| `TOKEN_INPUT / TOKEN_FORMAT` | 確認輸入的是新建立或輪替後的 **Cloudflare API Token 值**（非 Token 名稱、GitHub Secret 名稱），無前後空白。不要把 Token 貼進聊天、GitHub 或日誌 |
| `READ_BEFORE / HTTP_401` 或 `HTTP_403` | 檢查 Token 是否仍有效、是否指向正確 Cloudflare Account，及是否包含該帳戶的 D1 Read 權限；403 也可能受 Cloudflare 存取政策影響，不直接判定憑證遭撤銷 |
| `READ_* / HTTP_404` | 查核 Token 對目標 D1 的授權、固定 Account/Database 設定是否匹配 |
| `READ_* / HTTP_429` 或 `HTTP_5XX` | API 可能限流或服務異常，稍後只重試**唯讀選項 1**，不要重跑寫入 |
| `READ_* / NETWORK_OR_TIMEOUT` | 檢查連線、代理伺服器、防火牆或 TLS；不要輸出原始錯誤或 URL／Token |
| `READ_* / API_REJECTED`、`INVALID_JSON`、`RESPONSE_SHAPE` | 需要檢查 REST SQL 支援與回應格式；錯誤代碼可提供給開發者，不要附原始 D1 API 回應 |
| `READ_VALIDATE / DATABASE_STATE` | 回傳數據不符合 Schema/Owner/稽核／完整性條件；使用 GitHub **Production D1 Owner readiness** 既有只讀 Workflow 交叉核對，不應啟動寫入 |

**選項 1 的隱藏 Token 可以使用獨立 D1 Read Token**，不需 Cloudflare Production D1 Write Token；Cloudflare D1 REST Query 官方允許 D1 Read 或 D1 Write。原版提示文字寫成 Write Token 容易誤導。修正後無論 Read/Write Token，只有在操作 `--enroll` 時才要求 Write Token 與二次密碼確認。所有錯誤訊息只包含程式內白名單列舉的階段／原因，不暴露 Token、SQL、密碼或資料庫原始資料。安全測試必須涵蓋 401/403/404/429/5xx、API 拒絕、異常 JSON、網路逾時、資料異常、不意外寫入。

修正 PR 未合併／未驗證前，不要把新代碼視為已正式發布；即便修正後選項 1 PASS，**仍不代表 Owner 已建立或允許立刻選 2**。Production 正式寫入前還需隔離 D1 實站驗證 REST batch 回滾與受控放行。

## 2026-11-01：本機受控 Owner 建立工具（須經 PR 驗證合併）

以下工具在合併前僅為候選程式，不代表 Production Owner 已建立，也沒有直接替管理者執行寫入。Production v3 Schema 已在 Run #41215336274 實際建立；Owner=0 已由 #41265972020 與 #41265998671 兩次遠端唯讀確認。**不可重跑 first-init。**

### 操作者執行方式（自己的 Windows/Linux 終端機、Cloudflare D1 Write Token）

1. 從已通過 Hosted CI、Codex Review 並合併的最新 main 取得原始碼，使用 Node.js 22 或更新版。絕不要從不明來源下載 bat，也不要在其他人的電腦上輸入 Token。
2. Windows 在專案根目錄雙擊 run-production-owner-operator.bat；Linux 執行 bash run-production-owner-operator.sh。或直接執行 node tools/cloudflare-prod-owner-operator.mjs --check（僅檢查）／--enroll（一次性寫入）。
3. 第一次先選 **1 / Check**，在本機隱藏輸入欄貼上對正確 Cloudflare 帳戶與 Production D1 有 D1 Write 權限的 API Token。程式固定核對目標 Account ID 與 DB UUID；Token 不寫入檔案、GitHub Actions、Issue、終端歷史或日誌。只在回傳 PRODUCTION_OWNER_READY_TO_ENROLL_READONLY 時進入下一步。
4. 管理者確認要建立首位 Owner 時選 **2 / Enroll**，再次隱藏輸入 Token；程式用四個唯讀查詢重驗 v3／兩筆 Migration／20 表空白／FK／quick_check。接著必須輸入 CREATE_ONE_PRODUCTION_OWNER_ONCE，再隱藏輸入與重複確認 **12–256 字元** Owner 密碼。WebCrypto 會在本機產生 PBKDF2-SHA256 100,000 次、16-byte salt，只送出 hash/salt，**不傳送原始密碼**。帳號固定為 owner。
5. 使用 Cloudflare 官方 D1 REST POST /accounts/{account_id}/d1/database/{database_id}/query 的單次 batch 請求送兩筆受前置條件保護的 Owner 與 auth.owner_bootstrap 稽核 INSERT。**不得自行改成兩次 CLI writes 或貼入 Cloudflare Console。只會嘗試一次寫入，不會自動重試。** 網路錯誤仍可能發生在寫入提交之後。
6. 程式重新用四種唯讀查詢核對。只有 PRODUCTION_OWNER_CREATED_AUDITED_READONLY_VERIFIED（Owner=1、稽核=1、Migration=2、外鍵與完整性正常）才代表帳號結構完成。CLOUD_AUTH_PHASE 仍必須維持 disabled；此步驟**沒有開放登入**。
7. 任一步失敗只輸出 E_PRODUCTION_OWNER_OPERATOR，**不得直接重按 2、重新建表、清空 D1、重設 Owner 或猜測交易已回滾**。應先選 1 唯讀檢查、記錄不含密碼的狀態，異常交人工審查。顯示已建立 Owner 就不要再建立。

### 已知限制與安全界線

- 工具由本機管理者執行，不是 Cloudflare Worker 端點、GitHub Actions Production Write Workflow 或自動帳號註冊。GitHub Connector 無法代替操作者提供 Production Token。
- Cloudflare 官方 D1 REST /query 支援 batch，但**尚未透過 disposable D1 實站證明**其故障交易回滾；不能把 Worker Binding API batch() 保證直接移植到 REST 實作。故意採用失敗封閉、單次寫入、Postflight、不自動重試。在正式營運前建議用隔離庫驗證失敗注入。
- 不得在聊天、Issue、PR 張貼 Token、Owner 密碼、生成 SQL、hash 或 salt。完成後輪替／撤銷短期 Production Write Token，並核對是否有其他 Environment 共用舊值。
- 正式業務 API、Cookie、CSRF、Session、來源 IP、登入速率限制、UI 仍需要另行實站驗收，才可從 disabled 開放登入。
- 官方文件：https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ 及 https://developers.cloudflare.com/d1/worker-api/d1-database/


## 2026-11-01：新增唯讀驗證（不會建立 Owner）

正式 Production D1 已於 [Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 完成 v3 Schema／0001、0002；**不要重跑 `first-init`**。PR #84 已合併主線 `31e29b678b781dfc0f4b59eb92d5d111f1cd6c40`，主線 Verify #41217213971 PASS 5/5。正式 Owner 仍未確認建立、登入仍關閉。

這個新的開發增量新增 `.github/workflows/d1-production-owner-readonly.yml`：**僅在合併主線後才能從 Actions 手動運行**，Branch 選 `main`、輸入 `CHECK_PRODUCTION_OWNER_READONLY`。使用既有 `d1-production-readonly` Environment 的 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_PROD_D1_READ_TOKEN`，**絕不使用 Migration Write Token 或 Owner 密碼**。

它會先驗證固定目標、Reviewed SHA-256、現有 v3 合約與 2 個 Migration Ledger，再以四個唯讀 SQL（兩個 SELECT 統計、`PRAGMA quick_check`、`PRAGMA foreign_key_check`）查詢正式 D1。只有以下兩種嚴格符合的狀態會 PASS：

- `PRODUCTION_OWNER_READY_TO_ENROLL_READONLY`：20 張 Owner／Session／稽核／業務表均無資料，可規劃受控首次 Owner 建立；**不代表已建立或允許寫入**。
- `PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY`：恰好一位 active 的 PBKDF2-100k Owner 與恰好一筆去識別化權限授予稽核、無 Session／登入嘗試；這是結構就緒，並非公網登入或密碼實測成功。

任一來源回傳不符、缺失或 quick_check／FK 檢查異常即 **Fail closed**，只輸出泛化錯誤、不印 D1 原始內容、憑證或密碼。嚴格檢查簽章的 CLI 在 `tools/cloudflare-prod-owner-readonly.mjs`，本地測試在 `tests/cloudflare-prod-owner-readonly.test.js`。

注意：**這個增量絕不建立正式 Owner**；真正密碼建立須另經受控流程核准與 Cloudflare 實站驗收。若 Migration Token 曾 Rotate，唯讀環境可能使用獨立 Read Token；不得因寫入 Token 已更新就假定唯讀 Token 也有效。

 
## 目前狀態
- 主線 `26028441205b6d365b09fa0c7d11806eb237bd7e`：PR #83 已 Merge，postmerge Verify #41210737227 5/5 PASS。
- [Run #41207484827](https://github.com/hun186/restaurant-business-poc/actions/runs/41207484827) 是先前正式 D1 空庫的唯讀檢查。**更新：**[Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 已實際執行兩個正式 Migration，並取得 `PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS`、Schema v3、Migration=2、Owner=0、登入關閉。請勿重跑只能在空庫執行的 `first-init`。
- Production Schema **已初始化**，下一步為一次性 Owner 建立。現有的正式 Owner Workflow 尚未實作／批准，因此仍不能對 Production 建立帳號或啟用登入。
- 本分支僅新增 `tools/cloudflare-production-owner.mjs` 的**不可遠端自動執行**的輔助程式和合成測試。原計畫的正式 Owner GitHub Actions 寫入 Workflow **尚未建立**：連線端安全檢查已阻擋建立，請勿宣稱已可在 Github Actions 一鍵操作。

## 提議的正式 Owner 建立流程（未實作 Live Workflow）
由獨立、具有 Production D1 最小寫入權限的受控管理員程序：
1. 重新核對 Production D1 的固定 DB ID、v3 schema marker、恰好 `0001_initial_v3.sql`／`0002_login_attempts_window_indexes.sql` 兩個 ledger，所有 20 個 Owner/Session/稽核與業務資料表均為空。
2. 從私密環境變數取得業主初始密碼（12–256 字元）；只在受控 Runner 計算 `pbkdf2-sha256$100000$...` 和獨立 16-byte salt。**不得提交、張貼或記錄密碼或原始 SQL。**
3. 使用 guarded `INSERT ... SELECT ... WHERE` 確保所有資料表仍為空、v3 合約和兩個 Migration 未變，最多寫入一名 `owner`；同一私有 SQL 檔中的第二段 SQL 依新 Owner 的精確 UUID／salt／hash／角色比對再寫入 `auth.owner_bootstrap` 稽核，不依賴可能因分段執行失效的 `changes()`。稽核內容不含密碼、salt 或 Token。Cloudflare D1 不接受 SQL 檔內顯式 `BEGIN/COMMIT`；**不能保證兩段 SQL 一定以單一交易執行**。倘寫入中斷而只產生 Owner、沒有稽核，Postflight/唯讀檢查應 Fail-Closed、標示需人工處理，**不得清除 Owner、不得重置資料庫、不得自動重跑或啟用登入**。沒有 Demo 資料，也不自動啟用登入。
4. 僅輸出去識別化 Postflight：一位 active Owner、有正確雜湊版本、**恰好一筆初始權限授予稽核**、無 Session／Login Attempt、外鍵零錯誤；失敗時保存診斷資料，不能直接重跑或清庫。
5. 完成後須由管理者設置 Cloudflare Worker Secret `NATIVE_AUTH_SOURCE_PEPPER`、核對 D1 binding、公開 API／CSRF／Cookie／限流，再獨立啟用 native login。正式啟用前保持 `CLOUD_AUTH_PHASE=disabled`。

## 已完成的 Production Schema 歷史

首次空庫 Migration 已由 [Run #41215336274](https://github.com/hun186/restaurant-business-poc/actions/runs/41215336274) 成功完成，請勿重複執行。接下來只需建立 Production Owner，不需要重新建表、重新備援 Restore 或更改既有 Migration SQL。

此文件是操作與開發交接，**不代表任何 Production 寫入已執行，也不構成自動授權**。
