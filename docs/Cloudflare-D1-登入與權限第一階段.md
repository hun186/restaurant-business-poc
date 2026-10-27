# Cloudflare D1 身分驗證第一階段：唯讀 Session / WebCrypto / RBAC（RB-025）

> **尚非正式登入系統**：本輪只建立安全原語與 Preview 唯讀 `GET /api/me`。沒有提供雲端登入、登出、帳號建立、初始業主密碼、資料變更 API，也沒有建立或修改正式／測試 D1 的任何資料。

## 事實基準

- 2026-10-25 GitHub Actions Run `40172089719` 已對 **staging D1** 執行 `0001_initial_v3.sql` 並通過遠端驗證；使用者實際測試 Worker Preview 健康端點顯示 `database: schema_only`、`production_ready:false`。
- `restaurant-business-prod` 未執行任何 migration，Worker 正式營運 API 仍未完成。
- 原本本機 `server.js` 的 SQLite 帳密驗證是 Node `scryptSync`，雲端模組 **沒有**偷偷改掉或自動相容匯入該雜湊。
- Cloudflare Workers Web Crypto 支援 PBKDF2；雲端測試的格式是 `password_salt` 16-byte hex 與 `password_hash` `pbkdf2-sha256$600000$<64-hex>`，使用每次隨機 salt 及固定時間比較。**僅用於獨立程式碼測試，尚未對外提供輸入密碼的 API。**
- 正式密碼演算法、成本及 CPU 限額仍需在 Cloudflare staging 真機實測，尤其 Workers Free 單次請求 CPU 配額與慢雜湊相容性。

## 本次程式範圍

- `cloudflare/auth-core.mjs`：Web Crypto 密碼 KDF／驗證、隨機 Session Token 與 SHA-256 雜湊、`__Host-restaurant_session`（`Secure; HttpOnly; SameSite=Strict; Path=/`）、拒絕重複 Cookie、讀取有效 Session 與使用者角色／已啟用門市、Origin + CSRF 對照、嚴格的 Owner／Manager／Staff 與門市範圍判斷。
- `cloudflare/identity.mjs`：`GET /api/me` 只讀 D1；未登入回 401，Schema／連線不可用回 503，不回傳密碼雜湊或儲存的 Session Token。此 API 完全沒有寫入 SQL。
- `wrangler.jsonc`：Production `vars.CLOUD_AUTH_PHASE=disabled`，Preview `previews.vars.CLOUD_AUTH_PHASE=preview-readonly`；兩邊繼續分別綁正式／測試 D1。此明確開關限制 Production 不能提供身份查詢。
- `cloudflare/worker.mjs`：只對 `/api/me` 增加對應路由；`/api/health` 仍展示版狀態，`/api/login`、`/api/logout`、`/api/command`、`/api/backups` 等維持 503 `E_NOT_READY`。
- `tests/cloudflare-auth-foundation.test.js`：Node SQLite 模擬 D1 讀取，測密碼雜湊、Token／Cookie、Session 過期／停權、門市／角色降權、跨來源／CSRF、正式環境鎖定與 Preview 唯讀身份查詢（僅在測試記憶體中使用虛構員工）。

## 安全邊界與後續必做事項

1. **絕不**從公開 API 初始化第一位 Owner；既有本機 SQLite 的 scrypt password hash 不能冒充雲端 PBKDF2 登入。雲端帳號的獨立註冊／安全升級程序、資料庫匯入規格必須另外設計與複審。
2. 真正的登入 API 必須先完成：D1 端防暴力破解／限流，時間資訊與使用者存在與否不得洩漏；帳號停權及門市授權變更撤銷 Session；所有登入與敏感操作稽核；交易完整性、密碼雜湊與安全限額實測。
3. 後續資料異動服務對**每一個業務命令**都必須重新取得有效 Session、確認角色與門市、核對 Origin 和 CSRF，再以 D1 可支援的交易/樂觀並發策略執行，不能只憑 `/api/me` 的前端角色欄位。
4. 所有 Worker Preview 目前共用 staging D1，因此不應將其當成隔離多位真實使用者的正式測試場域。若要測真實個資或帳密，先採各分支 D1 隔離與環境存取保護。
5. 本輪**不新增 D1 Migration**，也不需要執行 staging D1 初始化 Workflow（不可重跑該空庫限定程序）；正式 D1 未動。
6. 本地 Node.js SQLite、Vercel 虛構 Demo 不受此改動影響。後續還有營運模組原子寫入、異地加密備份與復原演練、正式場域驗收。

驗證標準：以本 PR 最新 HEAD 的 Ubuntu／Windows Node 22/24 Hosted CI、Cloudflare Preview Build 和正式 Codex Review 為準；沒有使用者 Merge 指令不可合併。

參考：[Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)／[Workers Preview settings](https://developers.cloudflare.com/workers/previews/configuration/)／[Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/)。
