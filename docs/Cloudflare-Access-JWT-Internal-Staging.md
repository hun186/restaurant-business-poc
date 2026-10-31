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

## 下一獨立增量：JWKS 可信載入器（尚未接入公開路由）

- `cloudflare/access-jwks-internal.mjs` 是**僅供未來審查的內部**元件，固定由可信伺服器 `issuer` 產生 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`，不接受 Request/JWT 自選 JWKS URL；不更動 Worker 或 Cloudflare Access 政策。
- 僅 GET、HTTPS、拒絕 redirect、無 Cookie/憑證、嚴格核對回應 URL 與 JSON、64 KiB 實際讀取上限及逾時取消；任何錯誤只回傳固定 `ACCESS_JWKS_UNAVAILABLE`，絕不回傳遠端內容。
- 公鑰限制 RSA/RS256/signature/exponent，拒絕重複 kid 與私鑰欄位；每個 Loader 隔離五分鐘 cache，過期時不得使用舊 key，未知 kid 最快每 30 秒嘗試輪換，並行請求共用一次讀取。
- `tests/cloudflare-access-jwks-internal.test.js` 使用合成 RSA 公鑰與假 HTTPS Response，無真實 Cloudflare 呼叫、無 Token 或人員資料。這不是 Cloudflare Access 正式政策驗收，也尚未建立可用的登入鏈。
- 在正式整合前仍需完成信任設定私有保存、Access Previews-only 覆蓋範圍實證、JWKS 與 signed JWT 串接、CPU 測試、D1 身分映射、Session/CSRF/節流與活體 Staging E2E。

> PR #65 初審 P2 修正：公鑰 HTTP 失敗時即使無 cache 也限制重試頻率；當陌生 kid 導致遠端 refresh 時，不阻塞相符且仍有效的快取 kid。新增兩個合成回歸，本地共 8/8 PASS；等待本修正 HEAD Hosted CI 和正式 Codex 複審，禁止把初輪 CI 當作最新 HEAD PASS。

## 第三內部增量：已簽章身分與受信任 JWKS 串接（仍未對外啟用）

- `cloudflare/access-identity-internal.mjs` 建立只讀 `createTrustedAccessIdentity`：從受控 issuer/audience 啟動 JWKS Loader，對 `Cf-Access-Jwt-Assertion` 先做無授權意義的嚴格 kid 格式擷取；這只是 key lookup hint，不是登入或授權。
- 僅在受信任公鑰載入成功後，才交由已審查的 `verifyAccessJwtAssertion` 檢查真實 RSA-SHA256 簽章及完整 JWT Claims；只有全部通過才回傳經驗證 `subject`，未驗證、過期、異常來源皆不返回身分。
- 合成 RSA 私鑰只在測試中當場產生，mock JWKS Response，不呼叫 Cloudflare，不修改公開 Worker／routes／config、D1、登入或 Production。
- 尚需後續單獨設計 Staging 僅 Preview 的真實 Cloudflare Access 政策、受控 D1 subject-user 映射、角色／門市 RBAC、Session/CSRF/Rate limit、CPU 與真實 E2E。不可將本串接視為正式登入 Ready。

### PR #66 Codex P2 修正

在取得 JWKS 前先檢查 Token 三段的 canonical Base64url、Payload 有效 JSON 物件與 Signature 長度；此階段不解讀未驗證 claims 的任何授權意義。所有不合法結構一律 `null` 且不觸發遠端 JWKS Fetch；新增合成回歸，本地 4/4 PASS。仍待最新 HEAD CI 與正式複審。

## Explicit Cloudflare Access subject-to-D1 principal binding (internal-only)

PR continuation after #66 Squash Merge `3a66e99ab9c4b7287cfe86d7e07237a841cc1186` and confirmed postmerge Verify #41165785965 5/5 PASS.

`cloudflare/access-principal-internal.mjs` composes the previously reviewed **signature-verified** Access JWT/JWKS chain with a D1 **read-only**, parameterized lookup. It never grants a role from Access JWT claims, email addresses, user names, or arbitrary HTTP headers. A valid subject must match a **separately approved** active link tied to the exact trusted issuer and application audience; users and stores must be active. Missing/ambiguous links, missing table, wrong v3 contract, disabled users, invalid roles and stale stores deny. Returned role and scope are database-derived, immutable snapshot data, **not an application Session or authority for mutations**; downstream operations must revalidate all grants and CSRF/Session at action time. No schema changes or Cloudflare API requests are performed by the runtime module itself.

**Future schema proposal for independent migration review (NOT executed or shipped as a migration in this PR):**

```sql
CREATE TABLE access_identity_links (
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  PRIMARY KEY(issuer,audience,subject),
  UNIQUE(issuer,audience,user_id)
);
```

Provisioning and role assignment are owner/operator-controlled actions that require a separate audited enrollment design and staging-only migration. **Do not automatically match identities, add seed Owner accounts, or perform production migration.** The actual deployed D1 v3 lacks this table; the resolver intentionally returns null there. Local synthetic fixture tests create the table solely in an isolated in-memory SQLite DB. No Worker route imports this module, and Production remains `CLOUD_AUTH_PHASE=disabled`.

Next gates: review actual Access Preview protection/policies and JWT issuer/audience via private evidence; audited versioned D1 link table/migration and enrollment; hosted identity+DB smoke; session/CSRF/rate limiting and RBAC; production security/backup/readiness approvals. G5 destructive Restore remains deferred.

## 2026-10-31 Access 身分綁定表隔離提案（未部署）

- 提案 SQL 固定在 `cloudflare/migration-proposals/0003_access_identity_links.sql`，而**不是** `cloudflare/migrations/`；完全不接入任何 `workflow_dispatch` 或遠端套用指令。現有 Staging 0001/0002 Ledger 與嚴格允許清單保持不變。
- `active` 預設 **0**（未核准），不會自動登入、建立 Owner 或權限；唯一約束禁止同一 issuer/audience 下兩個 subjects 配到同一使用者，亦禁止同一 subject 重複綁定。獨立的受控人工入職與審核流程後才可切換 active=1。
- Synthetic SQLite 自動測試驗證添加式 DDL、0 新 user/Session、資料不遺失、Audience/Subject/Foreign Key/唯一性約束及停用預設；不代表遠端 Cloudflare D1 Migrated。
- 必須另開獨立 PR 審查版本升級、Staging-only preflight/單次 apply/postflight、防止誤用 Production、D1 可回復性與人工授權，才可考慮將 SQL 移入正式遷移目錄。此 PR **不執行任何 Migration 或部署作業**。

## 2026-10-31 Staging 0003 隔離式 Migration 配置（尚未套用）

PR #68 已合併 `aa0f13c189eab863ab1f5e921c212401a904ca39`，合併後 Verify #41169668388 5/5 PASS。本次只新增獨立 `wrangler.staging-access-0003.jsonc`（固定 STAGING_DB / staging UUID、只包含一個 D1 綁定）和 `cloudflare/migrations-access-0003/0003_access_identity_links.sql`。舊 `wrangler.preview-migrations.jsonc`、`cloudflare/migrations` 0001／0002、原本 0002 手動 Workflow 均原封不動。

根據 Cloudflare 的 Wrangler D1 Migrations 行為，`migrations apply` 會套用指定 migrations_dir 中所有未套用項目，所以不能直接將 0003 放到原本 0002 Migration 目錄。新的隔離配置僅用來準備未來獨立審核的 Staging-only 手動流程，**尚未連接任何 GitHub Actions 遠端 apply 工作、也沒有執行 Cloudflare API 或 D1 寫入**。

合成 SQLite 測試驗證：專屬設定只指向 staging UUID、0003 SQL DDL 與 PR #68 審核提案一致、0001／0002 原清單保持兩檔、已有 v3/0002 使用者與 migration ledger 不被修改、連結表起始空白且 active=0、不可重複綁定，以及 FK 連動。這不是 Cloudflare 遠端 migration 演練。

下一步需經獨立 PR 開發固定 main SHA、禁止任意 Database ID、protected d1-staging Environment、嚴格遠端唯讀 preflight 與 postflight、不可跨環境、不可混套任何其他 pending SQL 的明確工作流程。實際遠端 0003 apply、任何 Owner 身分綁定／授權啟用、Access 政策及 Production 變更尚未獲得本次程式碼合併授權。

## 2026-10-31 Staging 0003 一鍵唯讀檢查（尚未遠端執行）

- 在 GitHub Actions 手動選擇 `Staging Access 0003 D1 read-only status (manual)`，Action/Confirm 皆為 `CHECK_STAGING_0003_READONLY`。僅允許 main、受控 `d1-staging` Environment，與既有 Migration workflows 使用相同 concurrency group，不會與它們並行。需要該 Environment 中適當權限的 Cloudflare Token；此 PR 不設定或修改任何 Secret。
- 工作只會對固定 Staging D1 使用六條唯讀 SQL / PRAGMA（0001/0002/0003 ledger、v3 contract、唯一既有 Owner、0003 sqlite_master DDL、foreign_key_check、quick_check）。Runner 暫存 JSON 不上傳成 Artifact，不回傳 Owner ID／JWT／原始 SQL 給公開 Logs；只回傳 READY 或 ALREADY_APPLIED 及全為 false 的登入／正式上線旗標。
- `tools/cloudflare-staging-access-0003-readonly.mjs` 檢查固定 Staging UUID、Cloudflare Account、獨立 0003 目錄、精確 SQL 提案及對應的 D1 Ledger 內容。不存在 0003 及 Ledger 0001+0002 為 READY；存在且與 approved DDL 一致且 Ledger 0001+0002+0003 為 ALREADY_APPLIED；部分或不相符一律拒絕。只有 **合成 Node SQLite** 測試，不代表已取得現場實證。
- **本 Workflow 完全沒有 APPLY、Wrangler migrations apply、遠端 SQL --file、帳號註冊或資料寫入選項。** 不自動啟用登入、Production、任何 Restore；後續若需要真正 Staging 套用 0003，必須再獨立審查、審批並執行嚴格 apply/postflight。不要把 GET-only PASS 當成 Migration 已套用。

## 2026-10-31 Staging 0003 Migration 前後驗證工具（離線，未套用）

本階段新增 `tools/cloudflare-staging-0003-transition-evidence.mjs`，提供未來受控 Staging-only Migration 執行後的完整性證據檢查，不自行觸發 Wrangler、任何 Cloudflare API、登入、資料寫入或表格建立。

用法為已有兩份受控、未公開的 D1 唯讀快照資料夾時，執行 `node tools/cloudflare-staging-0003-transition-evidence.mjs verify <before-dir> <after-dir>`；需在受控環境提供既有的 `CLOUDFLARE_ACCOUNT_ID` 以檢查 pin，**不可把原始快照附到公開 Issue、PR 或日誌**。每份快照需含 `ledger/contract/owners/tables/indexes/table/fk/integrity/counts.json`，後快照另需 `link_count.json`；這是驗證器的介面契約，現階段沒有遠端自動取得／套用工作流程。

判定必須：before 嚴格 READY (0001/0002)、after 嚴格 ALREADY_APPLIED（0001/0002/0003），Owner、Contract、0002 索引相同，七組使用者/Session/門市/權限/工作/庫存移動/稽核表 COUNT 沒變，`access_identity_links` 新表空白（0）。若狀態不完整或資料變動則 fail closed；工具只檢查指定快照內的有限欄位，不會證明所有未查詢的資料列都未改變、沒有外部並行寫入，也不能證明遠端 migration 曾執行。合成測試只是離線資料庫。正式遠端 APPLY、Owner Access 連結啟用、Production 規劃仍需獨立人工安全授權。

## 2026-10-31 Staging 0003 人工 Schema-only Apply 路由（此 PR 僅提交程式碼）

上游 PR #71 已 Squash Merge `cd1f5921f9c909f28d3abc75c7679c8708d9cfd4`；本次另設獨立 `.github/workflows/d1-staging-access-0003-apply.yml`，只接受 `main` 之 `workflow_dispatch`，必須填寫 `APPLY_STAGING_0003_SCHEMA_ONLY` 及**最新 main 完整 40 碼 SHA**。使用新的 `d1-staging-0003-write` Environment（預設不存在、不可直接執行），須由管理者**另行建立並審核權限、設定僅對 Staging D1 授權之 Token、Account ID，並提供非敏感 Environment Variable `STAGING_0003_SCHEMA_APPLY_APPROVED=ENABLED_STAGING_0003_SCHEMA_ONLY`**。程式碼合併本身不代表同意執行；本對話不建立 Environment、不調整 Secrets、不 dispatch Workflow。

使用與其他 Staging Migration 相同 GitHub concurrency lock。Runner 先執行全程靜態雜湊檢查，精確核對 Staging 專用 UUID、隔離單檔 0003 DDL，再用固定的唯讀 SQL 取得 0001/0002 baseline ledger、22 tables+ledger、0002 三個索引、Schema v3、單一 active Owner、FK、quick_check、七張表數量。若不符合 READY、僅存在一名 Owner 以外的人員或任何業務活動/Session/數量異常，**絕不執行 SQL Migration**。前置檢查成功後，才用唯一的 `wrangler.staging-access-0003.jsonc` 執行一次 remote `d1 migrations apply STAGING_DB`，隨即重新讀取所有資料庫證據並使用 PR #71 的 before/after 保全比對工具確認 0003 新表仍為空、原使用者和業務資料筆數不變。任何失敗標記工作流程 FAIL，不假裝已完成或清空重建。

此為 Staging 單一**可加性** Schema Migration，**並非 Production 正式開通**。離線 SQLite 回歸只有合成資料，不能代替遠端 Time Travel/備份、Cloudflare Access Policy、身份註冊與 Session、RPO/RTO 等驗收。Production Cloudflare D1 ID 與 `CLOUD_AUTH_PHASE=disabled` 不得修改；G5 Restore 一律不在此範圍。手動執行前先確認最新 main Hosted CI、必要 Review，並由有權限操作者依環境操作流程另外啟動，不能由 Agent 自動執行。

## 2026-10-31 Staging Access 身分唯讀查詢（尚未啟用）

- 新增 `GET /api/access/me`，串接既有經 RS256 簽章驗證、JWKS 嚴格載入與 D1 `issuer+audience+subject` 明確綁定功能；僅回傳 D1 讀取的目前有效使用者、角色與有效門市，不讀 JWT 自述職級，不建立 Session/Cookie/CSRF，不接受密碼，沒有寫入路由。
- **預設關閉**：只有 Worker 的 `CLOUD_AUTH_PHASE=preview-readonly`，以及由受控 Preview 環境顯式配置 `CLOUD_ACCESS_IDENTITY_GATE=staging-get-only`、`CLOUD_ACCESS_ISSUER=https://<team>.cloudflareaccess.com`、`CLOUD_ACCESS_AUDIENCE=<64位十六進位aud>` 時，才允許執行；上述值來自可信伺服器設定，**絕不可接收 Request/未驗簽 JWT 提供的 URL 或 Audience**。沒有 Gate/配置一律回 503；沒有有效 JWT/啟用映射一律回 401，禁止 CORS 通用分享及快取。Production `CLOUD_AUTH_PHASE=disabled` 維持拒絕。
- **本 PR 不修改 `wrangler.jsonc` 的 Production／Preview vars，不設定真正的 team domain 或 Audience，不變更 Access Policy，不建立或啟用 D1 連結，不部署正式登入。** 真正 Staging E2E 仍須人工受保護 Preview Access 政策、0003 實際 D1 Migration、人工核准的合成身分連結、實際 JWKS 驗簽與撤權測試。
- 新增合成 RSA JWT/JWKS 與 in-memory SQLite D1 的正常／無簽章／篡改／撤權／停用門市／Production 拒絕／無 Session 等測試，Source/Test/Worker 三檔以精確 SHA256 納入封閉 inventory。這只是可被啟用的唯讀查詢，不代表 Access/生產上線或支援正式操作；後續仍需另行設計有時效的 Session、CSRF、稽核與每項業務操作 RBAC。

## 2026-10-31 Staging Access 業務唯讀 API（預設關閉）

PR #73 已在 main 合併且主線 CI #41184285149 為 success 5/5。本次新增兩個預設關閉、只適用 Preview 的 API：

- GET /api/access/data?entity=tasks：可選 locations、ingredients、training_courses、tasks、purchase_orders、repairs、shifts、stock。重用現有伺服器側 SQL/門市條件，拒絕 users、audit_logs、staff_directory、HR、重複或未知 query parameters。
- GET /api/access/overview：重用既有 open_tasks、pending_orders、open_repairs、low_stock 既有 SQL 聚合，權限由 D1 現時的角色/門市決定。

兩個 API 需 CLOUD_AUTH_PHASE=preview-readonly、CLOUD_ACCESS_IDENTITY_GATE=staging-get-only、受信任的 CLOUD_ACCESS_ISSUER 和 CLOUD_ACCESS_AUDIENCE、經 RS256 驗證的 Cloudflare Access JWT 與 D1 active=1 身分綁定。使用合成 RSA/JWKS + SQLite 雙門市回歸測試覆蓋 token 篡改/過期、跨店存取、門市撤權、敏感資源、非法 query 和 POST。回覆 no-store，絕不設定 Session/Cookie 或允許業務寫入。

本次不變更 wrangler.jsonc、Cloudflare Access Policy、遠端 D1 Migration、人工身分綁定或 Production disabled 狀態。實站 E2E 仍需另取得受保護的 Staging 0003/Preview Access 啟用授權。


## 2026-10-31 Staging 專用唯讀操作頁（程式碼完成、未啟用）

- 新增 `/staging-access-preview.html`，沿用餐廳好管家 RWD 風格，但與公開 `index.html` / `mock.js` 完全隔離。只從**同源**取得 D1 實際身份、首頁指標與允許的營運類別；所有回應應為 server-verified `staging_access_readonly`，並明確 `production_ready=false`、`session_created=false`、`mutations_enabled=false`。
- Browser 發 `GET` 時使用同源 Cookie（由瀏覽器保管 Cloudflare Access Cookie）；不讀取、傳出或保存 Access JWT；不接受使用者可輸入的 URL/Host、角色、Token、帳密。禁止重新導向自動跟隨，拒絕非 JSON 與錯誤格式；切換頁面會清除上一頁資料，過期或撤權時立即擦除畫面，並使用請求序號阻止較晚回來的舊資料覆蓋新頁。
- 前端使用 `textContent` 顯示 D1 資料、不使用 `innerHTML`，加 CSP、`no-referrer` 與 `noindex`；不提供編輯、叫貨核准、個資查詢、Excel 匯出或正式營運功能。Vercel 公開 Demo 可能也包含該靜態頁，**但不含可用的 Access API；不能當作登入示範**。
- 真正的 Cloudflare Preview Access Policy/0003 Migration/issuer/audience/subject link/Gate/有效的 Staging E2E 仍待另外批准與實證，不能將靜態頁發布或 CI PASS 視為登入完成。

## 2026-10-31 Access 身分的 Staging 工作狀態交易（預設關閉）

新增 `POST /api/access/task-status`：**程式碼完成不代表遠端已啟用。** 只有同時具有 `CLOUD_AUTH_PHASE=preview-readonly`、`CLOUD_ACCESS_IDENTITY_GATE=staging-get-only`、`CLOUD_ACCESS_TASK_WRITE_GATE=staging-task-status-only`，且配置可信的 Access Issuer／Audience、經 RS256 驗簽的 `Cf-Access-Jwt-Assertion`、active D1 身分連結、授權角色和門市，才能嘗試更新單一工作狀態。後者寫入 Gate 在 `wrangler.jsonc` **不存在且本 PR 不設定**，Production 仍 `disabled`。

請求必須由 HTTPS **同源**瀏覽器發起，`Origin` 等於 Request Origin、`Sec-Fetch-Site: same-origin`，且含 `X-Staging-Intent: task.status`；Content-Type JSON，Body 最多 4096 bytes，格式限定 `{"action":"task.status","data":{"id":"UUID","status":"todo|doing|done"}}`。沒有萬用 CORS 或 Cookie/Session 的應用程式產生。所有參數入 SQL `bind`，不接受 Request 指定角色、門市或 user_id。

交易 `D1.batch` 在**每一個關鍵 SQL** 確認 live `access_identity_links` active、user active/role、active store、user_locations 和 staff assignment；先新增稽核，再更新工作狀態，最後在同筆交易驗證；若更新失敗或驗證不一致，透過 NOT NULL constraint fail-closed **ROLLBACK**；D1 changes 必須三筆皆為 1 才回傳 200。重複狀態 409、越權或停用門市拒絕、失效 JWT 401、異常 D1 503 且不回傳 SQL、JWT 或帳密。使用合成 JWT、in-memory SQLite 模擬授權、跨店、撤權競態、失敗批次原子性。尚未經 Cloudflare 真實 D1 寫入測試；不可把合成證據寫成實站 PASS。

安全順序：管理員另行核准 Staging 0003 Migration、Cloudflare Preview Access 完整覆蓋、受信任 issuer/audience、人工核准的 subject-user 授權，才可再單獨審查是否啟用這個**僅限 Staging 工作狀態**的獨立 Write Gate。這不提供叫貨、盤點或 Production 寫入，既有 Staging 頁面仍是唯讀，不會自動發出 POST。正式業務寫入/啟用前仍須真正的遠端 D1 transaction + 權限 + CSRF UAT。
