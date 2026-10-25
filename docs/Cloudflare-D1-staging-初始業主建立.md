# Cloudflare D1 staging 一次性 Owner 建立（尚未執行）

## 本工項與前置條件

此 PR 建立 **Cloudflare staging D1 初始業主帳號的人工操作工具**。它依賴 PR #14 的 WebCrypto PBKDF2 密碼格式，並且採 **Stacked PR**（先合併 #14，再將本 PR 對向 main 進行最新 HEAD 重新複審）。

- GitHub Hosted **staging** D1 Migration：2026-10-25 Run #40172089719 PASS（空白 v3 schema）、Preview `/api/health` 經使用者確認 `schema_only`。
- Cloudflare 正式 D1 **未初始化**，無正式登入 API。本工項也沒有新增公開登入或自動啟用 Worker 權限。
- Cloudflare Workers Free HTTP CPU 上限目前為 10 ms；本次產生 PBKDF2 雜湊的運算在 GitHub Actions Node.js Runner 上完成，**不能藉此宣稱 Worker Free 能執行 600,000 次 PBKDF2 驗證**。必須進行 Workers 真機 CPU 配額驗收或改用合格身份提供者後才可開啟雲端登入。

## 提交的安全設計

1. 新增 `.github/workflows/d1-staging-owner-bootstrap.yml`，**僅 `workflow_dispatch` + `main` + 精確輸入 `CREATE_STAGING_OWNER_ONCE` + GitHub Environment `d1-staging` 人工審批**；使用現有 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，另外需要 **Environment Secret** `STAGING_OWNER_PASSWORD`（只能在手動執行前由業主自行設定，20–256 字元，不可貼到 ChatGPT／Issue／程式碼／Run 記錄）。
2. `tools/cloudflare-staging-owner.mjs`：檢查 Cloudflare account ID / 固定的 staging DB UUID 與正式 DB 不同；只讀檢查 Schema v3 及使用者／Session／登入嘗試／稽核／門市／庫存／採購皆空。任一有既存資料就拒絕執行。
3. 新 Owner 使用固定帳號 `owner`（display_name `雲端測試業主`），密碼轉換為 PBKDF2-SHA256 / 600,000 次的獨立雲端格式，16-byte 隨機 salt；**不回傳明文密碼或 derived hash**。產生一次性的 SQL 只存在 GitHub Hosted Runner 私有 temp 目錄（`0600` 且拒絕覆寫），指令結束以 trap 刪除；不作 artifacts。
4. 檢查及 SQL 寫入只對 `STAGING_DB` 執行 `--remote --config wrangler.preview-migrations.jsonc`；SQL 的 `NOT EXISTS (SELECT 1 FROM users)` 再次防範重複建立；不執行任何 `d1 migrations apply`。
5. 執行後只讀驗證「剛好一位 active owner、無任何 Session、Schema version 3、FK 沒錯」，不能單憑 GitHub Workflow Successful 就聲稱 Owner 可登入，**登入 API 仍是 503**。
6. 密碼 Secret 在 staging 一次性操作完成後應從 GitHub Environment secrets 移除。**切勿**將它轉成 Repository Secret，更不可做 PR Preview 自動初始化。

## 維運風險和阻擋條件

- GitHub Actions 服務與 Cloudflare Token 持有 staging D1 寫入權限；操作前須由授權管理員核准；建議於完成初次 staging 設置後撤銷臨時 Cloudflare Token 或換成最小必要權限。此 Token 的帳號層 D1 權限本身**不會**被 Workflow 寫死的 staging DB ID 物理限縮。
- `STAGING_OWNER_PASSWORD` 只用來初始化 **測試帳號**，不與正式生產帳號共用，也不應與使用者實際登入網站、郵件或其它服務的密碼相同。
- 與原本 `scryptSync` Node 本機帳號沒有自動遷移；若未來要匯入本機使用者，應另外訂定安全流程。
- 本次 **程式提交與 CI PASS 不等於遠端 Owner 已建立**；建立必須在 PR Merge 後手動通過 Environment 審批，再查 GitHub Actions Run 成功及遠端唯讀驗證。
- 為防止 D1 用量或環境配置問題，不能在正式 D1 嘗試 staging 初始化，也不允許利用 API 註冊第一位 owner。
- Owner 帳號建立後，仍需補登入限流／Audit／Session 建立／跨店資料權限原子性操作，以及 Cloudflare Worker CPU 壓力真機測試，才能考慮正式啟用登入。

參考：
- [Cloudflare D1 Wrangler execute](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
