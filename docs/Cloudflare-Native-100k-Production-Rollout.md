# 餐廳好管家：原生帳密（PBKDF2 100k）Cloudflare Production 上線分段驗收

## 2026-10-31 已批准的技術選擇
使用者選擇在 Cloudflare Workers Free 使用 PBKDF2-HMAC-SHA256 **100,000 次**。已在獨立 Cloudflare Hosted 測試 Worker 執行 hash / verify-correct / verify-wrong，三項 HTTP PASS；儀表板 24 小時彙總 CPU 506 μs，**尚未得到三筆個別 invocation CPU/outcome**。100k 比 OWASP 推薦 PBKDF2-HMAC-SHA256 600k 弱，使用者已知情並接受其作為本次 Cloudflare 登入方案；維持長密碼、唯一 salt、D1 登入限流、HttpOnly Secure Session、CSRF、門市權限與稽核。不得退化成一般 SHA-256。

## 當前 Worker 部署後的真實狀態
本增量只建立**程式**與合成測試，**沒有直接操作 Cloudflare 帳戶**。獨立 `cloudflare/native-login-http.mjs` 僅當 `CLOUD_AUTH_PHASE=native-production`、`CLOUD_NATIVE_LOGIN_GATE=operator-released`、受控 Worker Secret `NATIVE_AUTH_SOURCE_PEPPER` 長度 >=32 且 D1 Binding 正常時才接受登入/登出。既有 `wrangler.jsonc` 的 Production `CLOUD_AUTH_PHASE=disabled` 與 Preview `preview-readonly` **不變**；分支 Preview、正式 Demo 均不自動開放帳密。

- `POST /api/login`：HTTPS、同源 Origin、JSON、2 KiB 有界 body、Cloudflare 運行時提供的 cf 來源、HMAC 化的 CF-Connecting-IP，確認 D1 contract v3；使用既有 D1 原子限流、PBKDF2-100k、Session/CSRF 與稽核。
- `POST /api/logout`：同源 Origin + Cookie + CSRF，撤銷 Session 並稽核。
- `GET /api/me`：既有 read-only Session 身分，在原本 Preview 模式或正式 **同一組** native login gate 下可讀取。登入/登出不會對任何業務資料寫入。
- `/api/command`、採購與庫存等操作、Public Demo 仍不是正式營運前端；不因本 PR 開放。

## 必須依序取得的上線事實（不可省略）
1. Hosted PR Head Verify 全數 PASS、正式 Codex Review 無未解決 Findings，且完成 Merge；Cloudflare Worker 部署 Build／Deployment 有真實成功證據。
2. 對固定 **Production D1** UUID 先以既有 `d1-production-initialize-g5.yml`、mode=`preflight` 執行只讀查核。Production 的原始 Schema 尚未完成；不可誤認 Preview/Staging 0001–0003 已經等於 Production。
3. 獨立保留可復原證據，符合既有 `d1-production-migration` 的人工安全放行後，以既有受控的 0001/0002 Migration 初始化**經查核確實空白**的 Production D1；不可為了趕上線虛報已完成 Restore 演練、改寫歷史 migration 或跳過守衛。
4. 選用受控管理員程序建立 Production 初始 Owner，**必須是新版 `pbkdf2-sha256$100000$...`**。Staging 現有 600k Owner 必須另行重設，不能直接當成 Production 帳號，也不得移植公開專案的假密碼、用公開 API 自註冊 Owner。
5. 生產環境 Secret `NATIVE_AUTH_SOURCE_PEPPER` 以安全亂數產生，透過 Cloudflare Secrets 注入（勿貼入聊天、GitHub、CI log、程式碼）。驗證 Worker 的來源識別、防重放、登入限流、D1 批次一致性、Cookie、Session、CSRF、帳號禁用與稽核，並收集個別 CPU/Outcome 紀錄。
6. **只有 1–5 都確認**才在獨立、經複審的生產版本設定 `CLOUD_AUTH_PHASE=native-production` 與 `CLOUD_NATIVE_LOGIN_GATE=operator-released`。完成受控單一測試管理員真機登入/登出後，再進行業務讀寫、UI 和備份驗收。
7. 關閉時移除登入 Release Gate 或恢復 `CLOUD_AUTH_PHASE=disabled`，並撤銷現有 Session；**只有把門關閉不代表已撤銷先前建立的 Session**，資料庫仍須由受控維護程序清除或全部到期。

**禁止**重跑 Staging 0003 Migration、直接對 Production D1 用 Staging Token、從公共 Preview 輸入真實帳密、把 24 小時平均 CPU 當成單次 CPU 認證。

## 尚待完成
本輪不是完整餐廳業務上線。Production schema、Owner 初始化、真正 D1 密碼登入、門市 CRUD、叫貨/盤點交易、前端從虛構 Demo 切換真實 API、備份/復原與獨立 CPU 記錄，皆需要各自實站驗收；不能用 GitHub CI PASS 取代。
