# Staging Cloudflare Access JWT：內部簽章驗證基礎（P0 #34）

## 證據及背景

2026-10-31 已確認 PR #63 合併後 main Verify #41107287991 success 5/5，遠端 Preview GET-only [Run #41162137307](https://github.com/hun186/restaurant-business-poc/actions/runs/41162137307) completed/success：`STAGING_HTTP_GET_ONLY_ANONYMOUS_PASS`、`hosted_d1_schema_only_verified:true`。**這不表示已登入、Cloudflare Access 或有權限的 D1 查詢已驗收。**

此專案 Worker 配置 `assets` Static Assets；Cloudflare 官方說明：Assets 內部 Router **不傳送 `ctx.access` 給應用 Worker**，不得將 `ctx.access` 的一般範例直接當成此架構有效的 Access 身分辨識。

官方參考：
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

## 本 PR 交付（未對外啟用）

- `cloudflare/access-jwt-internal.mjs`：純內部 WebCrypto RSA/SHA-256 JWT 驗簽器，**沒有連接公開 Worker 路由**，不會打開登入。要求可信任的 Cloudflare team issuer、預期 Access Audience 及受信任的公開 JWKS（不得來自 Request）。
- `Cf-Access-Jwt-Assertion` 必須通過嚴格 Base64url、RSA Public JWK、RS256 簽章、Issuer、Audience、簽發／到期／生效時間、`kid` 唯一性等檢查；不接受 `alg:none`、不憑未驗簽 Header 授權，失敗一律 `null`。
- 成功僅返回受驗證的 `subject`，不回傳原始 JWT 或密鑰，也**不代表擁有 Owner／Manager／Staff 權限**。仍須透過後端將 subject 對應 D1 使用者、職級、門市，並執行 Session 與 CSRF 驗證。
- `tests/cloudflare-access-jwt-internal.test.js` 使用每次新產生的合成 RSA 測試私鑰、正負案例，未使用任何真實員工資料、Access Token 或正式憑證。

## 未完成的啟用門檻

1. 管理者應在 Cloudflare Workers > Access 選擇 **Previews only** 為 Preview Worker 保護整個預覽面（不可只保護單一預覽網址），取得私下保存的政策/所有網址/Access 應用 Audience 和 team domain 實證。不能在 Issue 或 Repo 公開 JWT、Cookie、憑證或員工資訊。
2. 呼叫端需要獨立審查的 HTTPS JWKS 載入器，從固定 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` 取得公開簽章 Key，且必須有嚴格 URL、Redirect、Size、Timeout、Rotation/cache 及失敗封閉；本 PR **不會**抓 JWKS，也不改 Worker 的任何遠端網路行為。
3. 完成 Hosted PBKDF2 600K CPU、實際 Cloudflare 來源 IP 與 Access、合成 Owner 測試登入、Rate limit、Session、CSRF、權限與跨門市 E2E，且禁止從舊本機 Node scrypt 靜默遷移密碼。
4. Production `CLOUD_AUTH_PHASE=disabled`、`/api/login` 與 `/api/command` 503 維持不變；未執行 D1 Migration、Staging／Production D1 寫入、Access 政策修改或 Restore。

變更必須通過最新 SHA 的 Hosted CI 與正式 Codex Review，再取得使用者明確 Merge 授權；不得以合成 PASS 代替真正 Cloudflare Access 驗收。
