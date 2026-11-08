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

## 2026-11-08｜工作指派到門市員工（待本 PR Hosted 驗證）

業主或主管在建立工作時可選擇同門市、仍有效的主管／員工，亦可不指派。
候選清單為 `GET /api/data?entity=assignable_staff`，僅 Owner／Manager
能查詢，回傳必要的姓名、角色、門市及 UUID，不含密碼、Session 或登入資訊；
主管只能讀取已授權的有效門市。員工不能讀取候選名單。

`task.create` 接受可選的 `assigned_to` UUID。後端 D1 交易內同時驗證
Owner／Manager、有效 Session、建立門市授權與受指派員工的有效角色與門市關聯，
授權撤銷或不符即拒絕整筆工作與稽核寫入。尚未另外核准正式環境登入、
寫入或 Owner bootstrap；在 Production Gate disabled 時所有新增能力均不可操作。

## 2026-11-08｜工作改派（開發中，待本 PR CI 與正式複審）

正式工作台新增未完成工作的改派／取消指派。僅業主／主管能操作：
`task.assign` 需精確提供工作 UUID、預期的舊指派 UUID（可 null）、
新的指派 UUID（可 null）。後端檢查角色、有效門市、本人門市授權、
有效 Session/CSRF、被指派人的門市與啟用狀態，並於 D1 batch 交易內
重新檢查。已完成工作、舊指派不符或重複操作回 409；
若交易未完成，不留下「改派成功」Audit。沒有開放新 Production Gate、
任何 D1 Migration、Owner 建立或 Secrets 變更。

## 2026-11-08｜工作日期與期限異動（待本 PR Review/CI）

不更動 D1 schema；使用既有 `tasks.due_date`。新建工作可設定有效
西曆 YYYY-MM-DD 日期，嚴格檢驗月份／大小月／閏年，不添加時區解讀。
業主／主管可對未完成工作發出 `task.due`，攜帶原期限供比對後變更
或清除期限；後端角色、有效 Session、同源、CSRF、門市在 D1 batch
交易內重檢，Audit 與工作變更同交易。舊期限不一致回 409。
本變更不包含 Production D1 寫入授權、Owner 初始化、Secrets 或
Cloudflare Release Gate 操作；仍須最新 HEAD CI 與正式 Codex Review。

## 2026-11-08｜Owner D1 門市與食材建立（待 PR 檢驗）

原生工作台新增業主專用新增門市和食材主檔，不再需要操作員直接
在 D1 中手填 SQL。此功能獨立要求
`CLOUD_NATIVE_CATALOG_WRITE_GATE=operator-released` 並繼承 Native
Login Gate；預設正式部署未設定 Gate，不能寫入。
後端在 D1.batch 交易內確認 Owner 仍有效、Session 未過期、
CSRF/同源前檢通過，並於建檔後建立 Audit。食材代碼唯一，
食材數量下限固定三位小數的安全範圍；不新增 D1 Migration。
合成測試不等於真實 Production Owner 設定／實機驗收。

## 2026-11-08｜真正 D1 叫貨→核准→驗收入庫（待本 PR CI/Review）

原生工作台提供門市內工作人員建立**單品項**叫貨單
`order.create`，由業主／主管執行 `order.approve`、
`order.cancel`、`order.receive`。
所有 API 只在 Native Login 正式 Gate 及**獨立**
`CLOUD_NATIVE_ORDER_WRITE_GATE=operator-released` 啟用後才可使用；
預設正式部署沒有此 Gate。後端驗證 Session、CSRF、Origin、
啟用門市／食材、角色與有效門市授權，且在 D1.batch 交易內重驗。
已核准的單品項訂單才能驗收入庫，並將
`purchase_orders.status=received`、唯一的進貨 `stock_moves`
與 Audit **同交易**完成；不直接寫入庫存餘額，也不自動重試不明寫入。
重複驗收、狀態被更新及已有入庫流水均拒絕；舊有多品項分單
在未實作整張交易前保持只讀。合成 D1 測試不是正式實機 UAT。

## 2026-11-08｜原生 D1 盤點與差異帳本（本 PR 驗證中）

工作台新增「盤點」頁：員工建立盤點記錄，D1 交易內由 `stock_moves`
帳本取得預期庫存快照；主管或業主確認尚未完成的盤點。若盤點後
庫存已異動、門市或食材停用、權限／Session 撤銷、盤點已完成則拒絕。
確認時，`stocktakes.status`、`stock_moves` adjustment 與 Audit
同 D1.batch 交易處理；沒有差異時不建立零數量流水。
獨立 `CLOUD_NATIVE_STOCKTAKE_WRITE_GATE=operator-released`，
預設正式部署未設此 Gate，無 Production D1、Secrets、Owner、
Wrangler 變更、Migration 或真實驗收。

## 2026-11-08｜原生 D1 報修、指派、結案（本 PR 驗證中）

員工可在授權門市提交設備與故障描述；業主／主管能指派同門市仍有效
的主管／員工、改派或結案。所有操作以 D1 交易內的 Session、角色、
門市授權與受指派人有效狀態重新檢驗，使用報修單預期狀態與
預期舊指派值進行 CAS，以防止多人同時編輯覆蓋結果；資料與稽核
同交易。結案後不可再直接改派。獨立
`CLOUD_NATIVE_REPAIR_WRITE_GATE=operator-released` 預設關閉，
本 PR 不建立正式帳號、不啟用 Production Gate、不碰 Secrets、
D1 Migration 或正式資料。
