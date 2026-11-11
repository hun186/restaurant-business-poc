# Cloudflare Production D1 業主忘記密碼 — 本機維護者安全重設

**僅限業主完全忘記舊密碼時使用。** 平常業主應自行在「我的帳號」修改密碼；正式 Worker 沒有公開忘記密碼 API。維護者不需要知道舊密碼，也不能重新建立 Owner、清空庫存或重跑 Migration。

## 為何更新原 PR #172

舊版 REST `{batch:[UPDATE, DELETE, INSERT]}` 的全部回滾保證尚未獲 Cloudflare 明確確認，因此**已在程式中禁止原 REST 寫入函式**。官方有明確交易保證的是 Worker D1 Binding `db.batch()`：

https://developers.cloudflare.com/d1/worker-api/d1-database/

本版使用**操作員電腦的本機 Wrangler Worker**，透過 Remote D1 Binding（`remote:true`）存取固定 Production D1。Worker 使用官方具交易保證的 `db.batch()` 同時更新密碼、刪除舊 Session、寫入稽核。沒有對現有正式 Worker 新增任何路由，也不透過網際網路提供密碼重設端點。

## 管理員 Windows 操作

1. 在可信任管理電腦使用已審核、已合併的最新 `main`；工作目錄需乾淨，Node.js >= 22.13。**不要從未合併的 PR 分支執行正式操作**。
2. 完成 Cloudflare 管理員的本機 Wrangler 登入：`npx wrangler@4 login`。此帳號必須授權操作指定 Production D1；不要把密碼或 Token 放進環境變數、命令列、GitHub、聊天或截圖。
3. 確認真正存在可用的 D1 加密備份，並安排受控維護窗口；避免其他人同時登入或處理營運寫入。核實提出申請的業主身分。
4. 雙擊 `重設雲端業主密碼.bat`：
   - **1：唯讀檢查**。輸入受限 Cloudflare Production D1 Read Token（遮蔽）；只檢查 Owner、Schema、Migration 及資料完整性，不修改資料。
   - **2：本機 Worker 一次性重設**。CLI 驗證本地設定釘選 Production D1 UUID、`remote:true`、`workers_dev:false`、`preview_urls:false`，使用 `npx wrangler@4 dev` 在 `127.0.0.1` 的隨機埠啟動本機 Worker。通過 Worker 端唯讀預檢後，逐字輸入 `RESET_EXISTING_OWNER_PASSWORD_ONCE`，再輸入兩次新密碼（遮蔽）。
5. 本機 CLI 只傳送新密碼的 PBKDF2-SHA256 雜湊與隨機 Salt 給本機 Worker。Worker 必須執行三條參數化 D1 Binding SQL 的同一個 `db.batch()`：CAS 更新原 Owner 密碼、撤銷所有 Owner Session、寫入 `auth.password_reset` 稽核，隨後唯讀核對結果。成功僅顯示 `PRODUCTION_OWNER_PASSWORD_RESET_VERIFIED`，不輸出密碼、Cookie 或 Token。
6. 任何 `REMOTE_WRITE_UNCERTAIN`／`READ_POSTCHECK`／`LOCAL_WORKER` 等錯誤都**不能直接重試**。先做唯讀查核及備份比對，因網路超時可能表示寫入已完成但回應遺失。
7. 成功後由業主用新密碼實際登入並核對原有門市、食材、庫存等資料，再依需要自行改密碼。

## 安全與上線界線

- 獨立 Worker 原始檔：`cloudflare/owner-recovery-local-worker.mjs`；交易元件：`cloudflare/owner-recovery-atomic-internal.mjs`；本機釘選：`cloudflare/wrangler.owner-recovery.local.jsonc`。**不執行 wrangler deploy**，亦不匯入正式 `cloudflare/worker.mjs`。
- 僅允許本機迴圈位址及 `RECOVERY_LOCAL_MODE`；拒絕外部 Host、Origin、Cookie、Authorization 與未授權路徑。操作電腦仍須為可信任的受控主機，避免同機惡意程式碰觸 localhost。
- `db.batch()` 有官方失敗回滾保證，但網路超時仍需獨立核對；Operator 必須確認沒有並行登入／新 Session 的競態。
- Synthetic SQLite 測試驗證第三條稽核 SQL 失敗會讓密碼與 Session 撤銷全部回滾；它不是 Cloudflare 實機 UAT。
- 此 PR 不操作任何正式 Production D1、Cloudflare Vars/Secrets、Login Gate、五項業務 Write Gates、Schema 或部署。**GitHub 合併不等於正式已上線**；仍需 Owner 實機登入、Session 撤銷與資產版本驗收。
