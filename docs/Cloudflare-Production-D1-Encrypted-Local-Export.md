# Cloudflare Production D1：加密本機匯出與離線重播驗證（無新增 D1）

## 2026-11-02｜Windows 真實 Export API 錯誤：安全診斷修正（仍需實機複驗）

使用者已在可信任 Windows 選 `run-production-d1-backup.bat` 選項1、輸入 `EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP`、隱藏 Cloudflare Token 與加密密碼，工具在匯出階段回傳 `E_PRODUCTION_D1_BACKUP phase=EXPORT_API`，**未產生可驗證的加密備份成功證據**。此錯誤不包含 API 原始回應，因此不能斷言是 Token、Bookmark 格式、Task 失敗或下載連結問題；此錯誤本身亦不表示已執行 SQL 寫入。**不要在修正合併前反覆重啟遠端 Export**，因為 Cloudflare 官方說明 Export 可阻塞查詢且進行中任務需持續輪詢或自動取消。

此次修正：按照 [Cloudflare 官方 Export API 文件](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/) 將 `at_bookmark` 視為有界不含控制字元的**不透明字串**，不再硬限定為固定的 `8-8-8-32` 十六進位形式；`type` 與 `status` 可能缺省，但 `success`、完成時 `signed_url`、輪詢時有效 `at_bookmark` 仍需嚴格查核。失敗不再一律只輸出 `EXPORT_API`，增加經白名單保護的 `detail=TASK_ERROR|TASK_REJECTED|RESPONSE_SHAPE|STATUS_INVALID|BOOKMARK_MISSING|BOOKMARK_INVALID|BOOKMARK_CHANGED|COMPLETE_URL_MISSING` 等分類。**絕不輸出** Cloudflare 原始回應、Task messages/error、Bookmark、簽署 URL、SQL、Token、密碼或 Stack，避免公開支援紀錄洩密。

這是 **GitHub 程式修正 + 合成 HTTP 測試**，不是已遠端 Export 成功。任何真實重試須先在最新已 Merge `main` 且合併後 CI 全綠、正式 Codex Review 完成、安全維護窗口內由操作者確認；新錯誤的 `phase` / `detail` 可安全貼回支援，但不可貼 API 原文。成功匯出仍不等於異地副本或真實 Cloudflare Restore 完成。

## 部署平台分工與合併檢查

- **正式 Web/App：Cloudflare Workers**，靜態前端透過 `wrangler.jsonc` 的 `assets` Binding 提供、`/api/*` 由 Worker 路由處理，Production 綁定既有 `restaurant-business-prod` D1；Preview 綁定 `restaurant-business-staging` D1。正式登入 `CLOUD_AUTH_PHASE=disabled` 未開通；**不得把目前 Demo 靜態頁當已驗收的正式營運 UI**。
- **Vercel：僅供虛構 Demo**。2026-11-02 已經 Vercel 專案設定更新 `previewDeploymentsDisabled=true`，保留既有 main Demo 路線以節省免費部署額度；這不修改 Cloudflare 的 Worker、D1 或登入 Gate。
- GitHub **合併閘門不會因 Vercel 配額錯誤被偷偷降低**。最低限度是最新 HEAD Hosted Verify 全 PASS、Workers Build PASS、正式 Codex Review Completed 且無未解決 P1/P2、無 Merge Conflict／必要分支保護阻擋；Vercel 原有 `api-deployments-free-per-day` 失敗仍需明確辨識，舊失敗狀態不會自動消失。若狀態仍使 PR 為 `unstable`，需另行獲得該 PR 個別 Merge 指令或先恢復外部檢查，不能把 failure 偽裝成 success。
- Production Cloudflare Worker 的發佈、DNS 綁定、正式登入開關、Owner 寫入及 Production D1 備份 Export 是**彼此獨立的放行操作**。本 PR 只新增本機工具及文件；不自動觸發 Cloudflare 發佈、遠端 Export 或正式登入。
- Vercel 專案設定 API 已成功接受更新，且回查確認同一專案仍存在；目前讀取介面沒有回傳 Preview-disabled 欄位，因此**沒有由讀回欄位再度獨立確認其布林值**。以後若需要調整 Preview，應先到 Vercel Project Settings 確認狀態。

## 適用範圍與安全限制

- 目標固定為 `restaurant-business-prod` 的**既有** Cloudflare Account/DB UUID；不建立第五個 D1，不匯入、還原、Migration、刪除或建立 Owner。工具在任何 Export API 前，先核對 Production Metadata 並執行完整的 Owner 唯讀 v3/Migration2/Owner0 預檢。
- 官方 D1 SQL Export 是 `POST /d1/database/{id}/export`，**不發送任何 SQL 寫入語句**，但官方明確警告：**匯出執行中可能阻塞同一個 D1 的其他查詢**，因此必須選擇沒有業務流量的維護時段，操作前需明確確認。不可把其稱為零營運影響。
- 請使用可信任的 Windows 使用者帳號與獨立 D1 Read/Export 權限 Token；能執行查詢的 Token **不一定擁有 Export 權限**，若 Cloudflare API 拒絕請檢查 Token Scope，**不要**為了省事直接使用 Global API Key。
- 備份是完整 SQL schema + data，**不只 schema-only**。工具限制匯出 SQL 不超過 32 MiB，超出則 fail closed，應另規劃大資料庫方案。Cloudflare export 對虛擬表有已知限制；失敗不可宣稱備份完成。
- 絕不將 Token、密碼、SQL、Bookmark、簽署 URL、員工資料、稽核內容寫入 GitHub／CI／對話。GitHub Hosted 測試只使用虛構 SQLite 與合成 HTTP。
- 輸出是**本機 AES-256-GCM 加密封存**，在匯出時未產生明文 `.sql` 檔。密碼至少 16 字元、PBKDF2-SHA256 金鑰衍生。密碼**不會寫入檔案，也無法透過本程式找回**；請使用密碼管理器保存。
- 產生加密檔案不等於已完成 **異地備份**。必須另行人工複製到可控的外部裝置／加密異地位置、保留 SHA-256，並在**另外一台可信任電腦**離線驗證，才可紀錄異地副本證據。請遵守 Windows 檔案 ACL；本機密文不是公開資料。
- 本工具不會呼叫 `/import`、`/restore`、`d1 create`、`d1 delete`，不會產生 Owner，也不代表遠端 Cloudflare Restore 演練、RPO/RTO 或 Production Login 已通過。

## Windows 一鍵操作

1. 在可信任 Windows 電腦，專案根目錄執行 `git checkout main`、`git pull --ff-only origin main`，確認是已審查且合併的最新版本。
2. 執行 `run-production-d1-backup.bat`，選 **1 / Export**。操作員須自行評估匯出期間暫停查詢的影響，再輸入 `EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP`。
3. 隱藏貼上具 D1 Export 權限的 API Token；輸入兩次相同的加密密碼（至少 16 字元）。**此 Token 不傳入命令列或檔案。**
4. 程式查核固定 Production D1 身分與 v3/兩筆 Migration/Owner0/完整性，啟動有界的 D1 官方 Export API，取得短效簽署 URL，僅允許 HTTPS Cloudflare/R2 預期網域下載。下載時不會把 API Token 發給簽署 URL。
5. 下載的 SQL 僅在記憶體中以 SQLite 重播，檢查 `PRAGMA quick_check`、`PRAGMA foreign_key_check`、schema contract v3、migration ledger 2、必要資料表與 Owner 數量，再於使用者家目錄 `RestaurantD1PrivateBackups` 保存唯一命名的 `.sql.aes` 加密檔。檔名與 SHA-256 可供使用者**自行私下記錄**。
6. 執行相同 BAT 選 **2 / Verify**，輸入該檔案完整路徑與隱藏密碼；只在記憶體中解密並重新 SQLite 重播，不會連 Cloudflare。再將加密檔複製到另一台可信任離線電腦/異地受保護儲存位置，核對 SHA-256 與相同離線 Verify 成功。
7. 若失敗，只貼回 `E_PRODUCTION_D1_BACKUP phase=...` 的非敏感錯誤代碼；切勿分享 SQL、Token、密碼、URL 或備份。

## 成功與限制

預期 `PROD_D1_ENCRYPTED_LOCAL_EXPORT_PASS`（本機匯出加密與 SQLite Replay），及 `PROD_D1_ENCRYPTED_LOCAL_VERIFY_PASS`（離線封存再驗證）。**以上成功不自動設 `offsite_encrypted_backup_verified=true`**，因為沒有替操作員查證第二份異地副本，也沒有實測 Cloudflare 上的遠端 Restore。正式建立 Owner（原工具選項 2）仍需獨立明確授權、可恢復計畫簽核與 Audit Postflight。

若 Production D1 已有 Owner，這個**首次 Owner 建立前專用工具**會在匯出前保守拒絕，避免跳過既定初始狀態條件；將來正式營運階段的例行備份需另行設計，不得誤以為本工具可以永久沿用。

官方參考：
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/
