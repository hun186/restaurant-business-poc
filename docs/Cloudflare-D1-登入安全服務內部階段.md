# Cloudflare D1 登入安全核心：內部程式階段（RB-028）

> **2026-10-31 安全相容性更新（新版本）**：依 Staging 獨立 Worker 的合成測試，PBKDF2 600,000 次於 Hosted 探針失敗（疑似平台迭代上限）；100,000 次三種操作均通過，Cloudflare 儀表板彙總 CPU Time 0.506 ms，但沒有個別 invocation CPU 證據。新產生的 Worker Hash 使用 `pbkdf2-sha256$100000$...`；舊版 `$600000 無法在 Hosted 工具上自動驗證或轉換，需另行批准密碼重設。**100k 低於 OWASP 目前建議的 PBKDF2-HMAC-SHA256 600k 強度，僅作受控 Staging 技術驗證；不得因本次 PR 即開放正式密碼登入。** Production Cloudflare Login 與 Worker Routes 維持關閉、D1 和 Owner 密碼無改動。下方保留初始設計歷史說明。

> 本 PR **不會啟用**雲端登入或登出端點。使用者在 staging D1 已人工建立一位 Owner（Run #40188578478，遠端 postflight PASS），但登入仍需完整資安與 Workers 實機 CPU 驗收後才可對外開放。

## 本輪新增

- `cloudflare/login-service.mjs`：新增 **僅內部呼叫** 的 `authenticateD1()`、`reserveLoginAttempt()`、`revokeD1Session()`、`sourceIpDigest()`。
- 不修改 `cloudflare/worker.mjs`、`wrangler.jsonc` 或 D1 v3 基礎 Schema；本 PR 另提供尚未部署的 **0002 後續索引 Migration**；Production 的 `CLOUD_AUTH_PHASE=disabled`，Preview 的 `preview-readonly`，`POST /api/login`、`POST /api/logout` 依然回 `503 E_NOT_READY`；沒有正式使用者資料導入或實際 D1 寫入。
- 單一 D1 SQL `INSERT ... SELECT WHERE COUNT < threshold`：以資料庫語句的原子性保留登入嘗試，15 分鐘內每帳號最多 8 次、每來源識別碼最多 32 次（含成功嘗試），拒絕時返回 429。登入成功把嘗試標為 success；失敗維持 success=0 並在 `audit_logs` 記錄 `auth.login_failed`。
- `verifyWorkerPassword()` 使用 PBKDF2-SHA256／600,000 次；不存在、停用或不支援雜湊格式的使用者仍執行相同昂貴 KDF（dummy salt/hash），降低帳號存在時間差。成功後產生 32-byte 隨機 Session Token（DB **僅儲存 SHA-256**）、隨機 CSRF token 和 8 小時到期時間；使用 D1 `batch`（原子交易）一次寫入 Session、登入成功 Audit、成功嘗試標記。交易前再次檢查帳號啟用、密碼 salt 與 hash 未變更；失敗不回傳 token。
- `revokeD1Session()` 必須重新取得有效 Session、核對 HTTPS + Origin + CSRF，才會以 D1 batch 寫登出稽核與刪除 Session，回傳清空 `__Host-` Secure／HttpOnly／SameSite=Strict Cookie。
- `sourceIpDigest()` 使用長度至少 32 的秘密 Pepper，HMAC-SHA256 雜湊 `CF-Connecting-IP`，拒絕只有 `X-Forwarded-For`、來源不明或 Pepper 缺少的輸入；不記錄原始來源 IP 或 Pepper。注意 **在任何實際路由啟用前**，仍要針對 Worker 網域／同區 Worker 呼叫情境，驗證 Cloudflare 提供的 IP 標頭可信來源與防偽造策略。

## Codex P2：登入限流索引與歷史清理（已提交待驗證）

- 原正式 Codex Review (HEAD `fe43a9a`) 指出：原有 `login_attempts_lookup(username,at)` 為 BINARY collation，與 `username=? COLLATE NOCASE` 不符；`ip_hash` 也沒有對應索引，會掃描大量歷史資料。
- **保留已套用的 `0001_initial_v3.sql`，不重建 staging D1**。新增版控檔 `cloudflare/migrations/0002_login_attempts_window_indexes.sql`，只加三組索引：`(username COLLATE NOCASE,at)`、`(ip_hash,at)`、`(at,id)`；Owner、Sessions、Contract v3 均不修改。未操作遠端 D1；`d1_migrations` 應在後續人工部署流程記錄此增量。
- 將真正的限流 `INSERT ... SELECT` 語句提取為單一 `LOGIN_RESERVATION_SQL`，回歸測試直接對它執行 `EXPLAIN QUERY PLAN`，確保兩種 15 分鐘視窗使用對應複合索引，不只看測試資料少時的執行結果。
- 新增 **`pruneExpiredLoginAttempts(db, batchSize)`**：只刪除 7 天以前的 `login_attempts`，每次最多 500 筆並使用 `(at,id)` 索引；**不刪除 audit_logs**。內部清理程式已具備，但目前未設定 Cron 或啟用正式登錄，**不會自動在遠端執行**。未來需先部署 0002，完成受保護的 staging 維護排程與真機驗收，才可允許定期清理。
- 舊版 `d1-staging-migration.yml` 只能在**空白 staging DB** 執行 `0001`，已有 Owner 時會依防護正確拒絕。**不可重跑該初始化 Workflow，也不可自行對 prod 執行 Migration**。0002 需另走批准的「既有 staging DB 增量 Migration」專用工作流程或人工審核操作，先驗證 ledger 與備份／復原點，再由使用者授權執行。

## 測試

- 新增 `tests/cloudflare-d1-login-security.test.js`：Node 內建 SQLite v3 真正執行同款 SQL，測驗證成功、Session Hash、Cookie、稽核、錯誤帳密／不存在／停權、帳號/IP 視窗限流、CSRF / Origin、帳號停用／密碼被改動後拒絕 Session、D1 batch 失敗回滾、Production/Preview 公開登入路由仍關閉。
- 新增 `tests/cloudflare-d1-login-indexes.test.js`：從實際 D1 0001 + 0002 Migration 建立 SQLite、保留模擬既有 Owner、查詢計畫必須 `SEARCH ... USING COVERING INDEX`、1,500 筆歷史資料時限流正常、分批清理只刪過期嘗試／保留 Audit、拒絕超出批次上限。
- 無第三方依賴；GitHub CI 仍使用專案原來的 Ubuntu/Windows × Node 22/24 `npm run check`。
- **這些測試只證明 Node SQLite 模擬 D1 的業務 SQL 行為，不能替代遠端 Cloudflare D1 或 Workers 真機驗收**。

## 尚未具備上線資格

1. Cloudflare Workers 官方文件截至 2026-10-25：Free HTTP 請求 CPU 上限 10 ms，Paid 通常 30 秒預設；`600000` 次 PBKDF2 必須在目標方案上的 Workers Runtime 真機驗證 CPU `exceededCpu`、登入延遲、用量和邊緣併發，不能用 Node CI 表現推估。正式登錄尚未上線。
2. 公開的 Preview 分支通常無 Cloudflare Access 保護，且目前所有 Previews 共用 staging D1；不得讓公開 Preview 的任意網址接受真實 Owner 密碼。後續要先建立僅授權人員可進入的固定 staging Worker／Cloudflare Access 或等效隔離，再進行真機驗測。
3. HMAC Pepper 必須透過獨立的 Cloudflare Worker Secret 管理，不得把原始 IP、密碼、Cookie、Token、API Key 等存於公共 Repo、日誌或前端資料。
4. 跨來源分散式猜密碼、高速請求對帳號鎖定的惡意干擾、成功登入後更改密碼的 Session 撤銷，以及 Session 過期資料清理仍需整體威脅模型／遠端競爭驗收。
5. 本機 Node SQLite `scryptSync` 既有帳密不會自動轉為 Workers PBKDF2 形式；不要新增使用者自助第一位 Owner 的公開入口。
6. 正式 D1 **未執行 Schema migration**，正式營運 API／備份還原／多門市業務交易也未上線。不可把此 PR 描述為完成 Cloudflare 正式營運部署。

## 後續

合併前以最新 PR Head 的 Hosted CI、Cloudflare Preview、Codex 正式 Review 為準。下一個分支先完成密碼算法/CPU 實測與獨立 staging 受保護入口、安全稽核，之後才考慮 feature-gated 路由。使用者未授權不可 Merge，也不觸發任何遠端 D1 資料操作。

參考：
- [Cloudflare Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 batch/transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Workers Preview isolation](https://developers.cloudflare.com/workers/previews/)
