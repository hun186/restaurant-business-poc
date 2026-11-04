# 正式交付：業主登入與真實 D1 營運查詢

## 本版新功能（程式已提交，實際啟用尚待驗收）

Cloudflare 原生帳密的 Release Gate 通過後，正式網站首頁會導向
/owner-app.html；該頁不使用公開 Demo 的 mock.js、sessionStorage 或
localStorage。前端先透過同源 GET /api/native/status 確認真實登入模式已
啟用，未啟用時**不顯示密碼輸入**。既有登入／登出／身分 API
（/api/login、/api/logout、/api/me）沿用 HttpOnly Secure Session、CSRF、
登入失敗限流與 D1 稽核，前端僅在記憶體保存 CSRF。

登入後可由 Cloudflare D1 取得總覽、工作、叫貨、庫存、維修、排班、
食材、門市與課程。新正式 /api/data 和 /api/overview 僅在 native
Production Gate 完整通過時可用；伺服器每次查詢均檢查有效 Session、
角色／門市範圍、D1 contract v3，且不公開 Users/Audit Logs 等敏感表。
目前這是一個「**真實登入與資料查詢**」垂直切片，還不是全面 CRUD。

為避免 Cloudflare 靜態資源在首頁直接返回 Demo，Wrangler 的
assets.run_worker_first 增加 /；預設關閉時 Worker 一樣把首頁轉交 Demo，
只有獨立授權、啟用 Production Native Gate 後才會導向真實工作台。
Vercel Root 仍保留獨立虛構展示，不能當作正式資料庫。

## 尚需完成才能交付業主

1. 以最新 Production D1 唯讀預檢確認 Schema v3、Owner／Session
   狀態及備份／復原證據。原本曾確認 Owner=0，但正式寫入前必須重驗。
2. 依既有受控程序，以單次寫入建立 Owner，完成 audit／Session 後驗。
   這是 Production D1 寫入，必須取得使用者**另一次明確核准**。
3. 配置正式 Pepper Secret，驗證 HTTPS、原生登入、來源識別、Cookie、
   CSRF、失效／撤銷和帳號鎖定；透過另一次 Release Gate 檢查
   CLOU D_AUTH_PHASE 與 CLOUD_NATIVE_LOGIN_GATE 設定。此文件不授權
   修改生產環境 Gate 或 Cloudflare Secrets。
4. 補上業主實際可操作的工作建立／狀態變更與後續叫貨、盤點等
   寫入，再做真實 D1 測試帳號端到端驗收、資料重新讀取與復原演練。
5. 確認 Cloudflare **Active Worker Version** 與 Main SHA 一致、
   業主可以真實登入並完成核心業務操作後才能宣告正式上線。

測試採用本機合成 SQLite D1 Adapter；PASS 不等於遠端業主實機驗收。

## 2026-11-04｜第一個真實 D1 工作異動（程式碼已實作，正式寫入未啟用）

正式工作台可讓業主與主管選擇有效門市新增工作（task.create），
業主／主管及被分派的員工可修改工作狀態（task.status）。
POST /api/task 僅在現有 native-production + operator-released 登入 Gate
**以及獨立 CLOUD_NATIVE_TASK_WRITE_GATE=operator-released** 全部啟用時
才接受請求；目前 wrangler.jsonc 不含這個值，因此 Production 仍不會寫入。

Server 每次操作重新驗證 Secure Session、同源 Origin、CSRF 與
角色／門市；建立、更新及稽核寫入在同一個 D1 batch，
交易內再查有效 Session、角色與門市，拒絕權限被撤銷或工作已變動的
競爭情況。寫入逾時／結果不明時 UI 提示先重新查詢，
不直接重新傳送以避免重複建立。輸入有 4 KiB 上限與讀取期限。

合成 SQLite/D1 測試包含完整 Owner 登入後建立→D1 查詢→更新狀態→
稽核、主管跨店拒絕、員工不可建立／修改他人工作、
CSRF／Origin 失敗、交易回滾與權限在執行前撤銷。
**這些不等於真正 Production D1 已接受寫入。**

## 真正業主正式使用前的最後關卡

1. 取得 Production D1 的最新只讀前檢、備份／還原證據，
   確認 Owner 狀態，不能沿用舊的 Owner=0 假設。
2. 另經授權完成一次性 Owner 建立及稽核／Session 後檢。
3. 以受控測試帳號驗證 Cloudflare 原生登入、Store 權限、
   Cookie／CSRF／限流與安全登出。
4. 獨立核准登入及工作寫入 Gate，執行一筆可回復的真實 D1 工作
   建立／狀態變更，核對 UI、D1 與 Audit 三方一致。
5. 未驗收的其他模組（叫貨、盤點、員工權限維護等）仍保持
   **只讀**，不可稱為全部正式營運 CRUD 已上線。
