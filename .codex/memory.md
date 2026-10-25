# 餐廳好管家 Project Memory

## Current Focus

- 新專案從水電業務管理系統 UI 參考與兩張餐飲版初稿開工，不能誤改水電 Repository。
- 首要目標：PR #14 Cloudflare D1 認證第一階段，只在 Preview 開放唯讀 `/api/me`；以本 PR 最新 HEAD 完成 GitHub Hosted CI、Cloudflare Preview、正式 Codex Review，修正 Findings；禁止未授權合併。PR #13 已合併，staging D1 初始化與健康檢查驗收完成；正式 D1 未遷移。
- 部署政策：程式碼公開，但營運／人事資料嚴禁公開；本機 SQLite 與 Public Demo 必須分離。
- 使用者習慣：正式 Codex Review、逐輪 P1/P2 修正、Hosted CI 最新 SHA 驗證、未授權不 Merge。

## Recent Outcomes (2026-10-23)

- 從水電 Repo 確認 Node.js + SQLite + 無外部 npm deps + RWD 設計路線。
- 建立餐廳 PoC 資料模型、角色與門市範圍、基本操作後端、瀏覽器前端、稽核紀錄。
- 本機 `npm run check` 11 項自動測試 PASS；2026-10-23 已透過 GitHub Connector 提交 24 檔至 PR #1 Draft；Ubuntu 22/24 的首次 CI 已 PASS，Windows 尚待確認。

## Open Handoffs

- 已由使用者建立 Public Repo，透過 GitHub Connector 提交 PR #1；待核對 4 個 CI 結果、正式 Codex Review、Windows 清理回歸及使用者 Merge 授權。
- 優先處理 `.codex/backlog.md` 的後續項目，不得將未完成報為完成。

### Public Vercel Demo handoff (2026-10-23)
- PR 分支新增 `vercel-demo/` 靜態虛構資料演示；與 `server.js` SQLite 正式 API 完全隔離，並提供重設入口。
- Hosted Vercel Preview 部署狀態需依最新 Vercel 專案/Deployment 實際查核，不得把 GitHub CI PASS 當成部署完成。
- PR #1 仍為 Draft，不得未經授權合併；生產環境的多人 RBAC/稽核仍需安全驗收。

### 2026-10-23｜本機 SQLite 備份系統增量（待 Host 驗證）
- 本次為使用者要求比照水電系統的備份功能，補「系統管理 → 備份管理」、業主限定 API、排程 Worker、SQLite v1→v2 安全升級、驗證過的快照及只清理自動版本。
- 資料摘要比對排除 Session、登入嘗試與備份元資料；如果上次自動備份存在且有效、持久內容無變更則更新自動檢查時間並跳過。手動備份仍保留；備份檔不進 Git/Vercel。
- 本機 Node 22 的 `npm run check`：22/22 PASS（含 11 項新備份專項），Hosted Ubuntu/Windows × Node22/24、正式 Review 與 Windows 實際還原尚待確認。
- 仍在 PR #1 Draft；**未取得使用者授權不可 Merge**。Public Vercel 示範站與本機資料庫備份互不相連。

## Pricing Integration Handoff (2026-10-23)
- 比照 menu-planner 的 ingredient_prices、dish_ingredients、cost preview 建立 v3；只有業主可修改共用菜品與配方；各主管可管理自身門市的歷史單價。
- 進貨驗收可選填單價並原子性保存；缺價／單位無法換算時絕不假設零成本。
- 備份 fingerprint 加入價格、菜品、配方，v2→v3 安全 migration snapshot。
- 沒有 AI 跨系統同步，亦非 FIFO/移動平均/POS 實際毛利。見 docs/菜單價格與成本試算.md。
- 此項開發分支 feat/menu-pricing-costs-v3，未經使用者同意不能 Merge。

## 2026-10-23 PR #2 Codex P1 修正
- 針對最新 Code Review `c3f4ed5` 的未解 P1，v2→v3 升級前以獨立記憶體 SQLite 的版本化 Schema 合約核對全部 v2 資料表及具名索引的完整建表 DDL，不再只檢查少數表是否存在。
- v1→v2 與 v3 開啟亦核對必要舊 Schema；異常時關閉 SQLite，拒絕自動修補、建立 migration snapshot 或更改 `user_version`。
- 新增 `repairs`、`stocktakes`、`evaluations` 遺失、欄位遺失、索引遺失及 v3 殘缺的回歸測試；本機對應設計驗證 38/38 PASS。以本 PR 最新 HEAD 的 Hosted CI 與 Codex 複審為最終依據。
- PR #2 仍為 Draft 且依賴 PR #1，未授權不可 Merge。

## PR #2 最新 Codex P1/P2 修正（2026-10-23）
- 驗證既有 v3 所有版本化 DDL，包括 ingredient_prices、menu_dishes、dish_ingredients 的欄位、FK/CHECK 和具名索引；破損時拒絕啟動，不自動補建。
- v1/v2 preflight 拒絕已出現的較新版物件（含 backup_settings 和 v3 索引），避免不正確的 migration snapshot。
- 新增價格欄位缺失、配方/價格索引缺失、v1 與 v2 混入新物件的回歸測試；本機 Node 22 合計 44/44 PASS。正式 Hosted CI / Codex Review 依 PR 最新 HEAD 核對。
- PR #2 Draft stacked PR，不可未授權 Merge。

## 2026-10-23 PR #1 Codex P1/P2 修正
- 修補庫存任意入庫繞過核准（僅有已核准單可驗收；業主能單次建期初庫存），新增門市授權即撤銷受授員工 Session。
- 將跨門市/員工表列權限篩選移至 SQL LIMIT 前；修復使用者加授門市表單、員工重設密碼錯誤登出。
- 備份中斷清理受解鎖 finally 保護；使用 realpath 避免 symlink/Windows Junction 嵌入營運資料資料夾。DATA_DIR 已在 PR #1 HEAD 的 server.start 套用。
- 新增針對上述問題的回歸測試。以新 HEAD 的 Hosted CI/最新 Codex Review 為準。PR 不可未授權 Merge。

## 2026-10-23 PR #1 Codex 後續 4 個 P2
- 總覽 KPI 以具門市/員工範圍的 SQL COUNT 計算，不受列表 500 筆限制，涵蓋訓練未完成、待處理工作/叫貨/維修與逾期工作。
- 備份完整性納入 sessions/login_attempts 必要結構，但 fingerprint 繼續排除易變登入狀態。
- 逾期且截斷的普通鎖定檔可安全回收；活躍 PID 或尚未逾期則拒絕重入。
- v1→v2 migration snapshot 在目錄建立前重用 getPaths canonical containment，保護 symlink/Junction 祖先。
- openDb 失敗時確實關閉 DB handle；本機 Node22 npm run check：32/32 PASS，正式 Hosted CI 與 Codex 以最新 HEAD 為準。未經許可禁止 Merge。

## 2026-10-24｜Codex PR #1 v1 升級前完整 Schema P2
- v1→v2 在建立遷移快照前對照 db/schema.sql 的完整 v1 結構（17 張必要表、具名索引及 DDL 約束），拒絕缺少 sessions/login_attempts、必要索引/欄位與誤置的 v2 backup_settings。
- 不符合時保持 user_version=1，不建立備份目錄或資料庫更新；補上破壞性回歸測試。本機 38/38 PASS，Hosted CI 與最新 Codex Review 待核對，未授權禁止 Merge。


## 2026-10-24｜PR #2 與 PR #1 安全相容整合
- 將 PR #1 最新 v1 升級前完整性驗證、canonical 備份路徑、庫存核准驗收、期初庫存、Session 與 UI 修正帶入 v3 定價分支。
- 明確拒絕 stock.purchase 直接入庫；價格僅在核准單 order.receive 驗收時與 stock_moves 原子性寫入，保留歷史價格與毛利估算。新增對應價格回歸。
- 原 PR #2 Review 無 Findings，但舊分支與 PR #1 基底分歧且存在安全回退風險；本整合需以最新 HEAD 的 Hosted Ubuntu/Windows CI 和正式 Codex Review 再確認。PR #1/#2 均不合併至目標分支。

## 2026-10-24｜PR #2 跨版本測試修正
- Hosted Ubuntu Node22/24 首輪指出 4 項測試失敗：PR #1 v1 fixture 在 PR #2 v3 新庫未移除 v3 價格表，致 preflight 提早拒絕；另備份結構驗證的錯誤訊息正確但錯誤 code 斷言過嚴。
- 已修正測試 fixture 先移除 v3 價格表、保留需要驗證的 v2 部分升級表，並驗證缺表/缺索引的確切訊息；未放寬任何資料庫驗證或重新開放 stock.purchase。Hosted CI 須以後續 HEAD 為準。

## 2026-10-24｜PR #1 新 3 P2 同步至 PR #2
- 將 PR #1 最新唯讀 preflight（v1/v2/v3）、保留 SQL quoted literals 大小寫的完整 DDL 比對及備份 Schema 驗證整合至 v3；完整檢查 price/recipe 及登入欄位、具名索引。
- 新增 v3 備份破損欄位/索引、v1 quoted CHECK 與 WAL 無副作用回歸。仍禁止 stock.purchase 直接入庫，只有核准單 order.receive 原子寫入價格/庫存。
- PR #2 只同步相依分支 commit，未變更 PR base 或合併 PR；正式 Hosted CI/Review 需重新驗證最新 HEAD。

## 2026-10-24｜正式 Review P1／P2 修正（Session race / POSIX 備份權限）
- P1：HTTP `/api/command` 和 `/api/backups` POST 在 `await parse(req)` 後重新查 Session、角色與 CSRF，改用新的授權主體執行資料異動／稽核，防止慢速 body 期間被降權仍可異動。
- P2：`backup-acl.protect()` POSIX 分支在既有備份資料夾由 SQLite VACUUM INTO 寫入前套用並驗證 0700；檔案套用 0600。使用 O_NOFOLLOW + descriptor 防止 chmod 跟隨替換 symlink。migration 同樣在快照產生前執行 protect。
- 新增 HTTP 暫停 body 後撤銷 Session 的回歸測試，以及一般／升級備份預建 0755 目錄在 VACUUM 前必須變 0700 的測試。CI 與正式 Review 須以新 HEAD 為準，無授權不得 Merge。

## 2026-10-24｜PR #2 與 PR #1 HEAD 1551fb5 相容同步
- PR #1 最新 Head 正式 Codex Review 無重大 Findings，Hosted Ubuntu/Windows × Node22/24 4/4 PASS。
- PR #2 由於 PR #1 後續 auth race 與 POSIX 備份權限修正，已在本分支同步最新 server、backup ACL、HTTP regression；v3 備份測試沿用 PR #1 兩個 VACUUM INTO 前 0700 權限測試，並調整 v1 fixture 移除 v3 價格／配方表。
- 保留 v3 價格、配方、已核准單 order.receive 原子入庫/進價及 stock.purchase 禁止直接入庫；不變更 PR base，不合併至 main。
- 需以本次同步的新 HEAD CI 及正式 Codex Review 重新驗收，未經使用者授權不可合併。

## 2026-10-24｜Vercel Demo 菜單與成本功能（新 PR）
- 新增獨立 browser-only `pricing-demo.js`，以虛構歷史價及菜品配方計算跨門市材料成本、毛利、缺價和庫存估值，沿用現有 Mock API/sessionStorage，不連真實 SQLite。
- Demo 加入「菜單與成本」與「食材歷史價格／庫存估值」選單，允許新增價格、菜品、改售價、調整配方；核准叫貨後可驗收入庫並選填進價。
- 禁止過時 Demo `stock.purchase` 直接入庫操作；可對未有庫存的食材建立單次期初庫存，保留虛構資料警語和重設入口。
- 新 PR 須通過 Hosted CI、正式 Codex Review 及使用者 Merge 授權；Vercel Connector 此前對該 Team 回 403，正式部署仍須核對，不能提前聲稱已上線。

## 2026-10-24｜RB-015 Vercel 虛構智慧備份教學（新 PR）
- 依使用者要求，對 Vercel Demo 新增「系統管理 → 智慧備份示範」。`vercel-demo/backup-demo.js` 只保存模擬設定和版本 metadata 至 sessionStorage，`backup-demo-ui.js` 支援快轉下次到期、跳過未變更資料、手動版本、版本輪替及刪除；所有操作均明確標示無實際 SQLite、無下載還原、無背景排程。
- 新增 `/api/demo-backups` mock only，正式 `/api/backups` 與 SQLite 未更動。示範指紋以虛構營運資料序列化內容比較，不聲稱具備正式 SHA-256 快照完整性驗證。
- CI/Review/合併與 Vercel 實際部署需個別確認；未經授權不得 Merge。

## 2026-10-24｜本機版登入畫面 currentTarget null 修正（新 PR）
- 使用者提供本機 owner 登入截圖，錯誤 `Cannot read properties of null (reading 'reset')`。根因是 `public/app.js` 登入 submit handler `await api('/api/login')` 後才讀 `e.currentTarget.reset()`，瀏覽器事件 dispatch 結束後 currentTarget 已為 null，成功登入卻在前端拋錯。
- 在 await 前保存 `const form=e.currentTarget`，成功後 `form.reset()`；同步修正 Vercel Demo 共用程式碼。新增模擬真實 event.currentTarget 非同步失效的回歸測試；不更動登入憑證、Session、資料庫 Schema 或備份。Hosted CI／最新 Codex Review 需另驗收；無授權不得 Merge。

## 2026-10-24｜Owner 初始密碼遺失之本機復原工具（新 PR）
- 使用者反映首次 owner 隨機密碼只於第一次啟動視窗顯示，未抄寫即無法再次取得。密碼以 scrypt 雜湊儲存，不可反查；已有 Session 可在「變更密碼」設定新密碼。
- 新增僅本機互動式 `node tools/reset-owner-password.js`，使用 `DATA_DIR` 定位現有資料庫。執行前要求停止 Node 服務、鍵入 `RESET owner`。拒絕不存在或不可信 `.installed`／SQLite、非 v3 或 owner 非唯一有效等情形；先驗證備份，再交易更新 owner 密碼、撤銷其 Session／登入限流狀態並記錄不含密碼的稽核。
- 不新增任何可匿名呼叫的 Web password-reset endpoint、不修改正式 SQLite schema，也不可刪除既有資料。增加成功復原、非破壞性備份失敗／缺 DB／停用 owner 等回歸測試。正式 Hosted CI / Codex 審查與使用者 Merge 授權須以最新 SHA 為準。

## 2026-10-24｜RB-019 / RB-020 安全稽核來源 IP＋Excel 匯出／列印（新 PR）
- 使用者要求安全稽核 IP 欄，以及比照水電系統提供多工作表 Excel 匯出、特定資料列／欄位列印。
- `src/request-ip.js` AsyncLocalStorage request context，來源一律 socket.remoteAddress，絕不信任任意 XFF／X-Real-IP；預設 local loopback 127.0.0.1 而非外網 IP。audit detail 新增 source_ip，查詢投影 ip_address，登入失敗也留下；不變更 Schema，舊資料無法補 IP。
- `public/xlsx-lite.js` 沿用水電系統無套件 OOXML writer；`public/report-ui.js` 報表頁採既有角色與門市保護的 API 取得資料，支援單頁／多工作表、欄位與關鍵字／日期篩選及列印預覽；不等於全量歷史。
- 新增來源 IP／不可信標頭、RBAC、Excel ZIP/XML／欄位過濾回歸測試。CI／Codex Review／Merge 授權狀態依 Hosted HEAD。

- Vercel Demo 同步新增虛構 Excel／列印操作及測試用稽核 IP `192.0.2.20`，只用 sessionStorage 假資料，無真實帳號授權、SQLite／真實來源 IP；需確認 Vercel Preview／Production 獨立部署狀態。

## 2026-10-24｜PR #8 最新 Codex P2：共用電腦登出後殘留報表可遭 Ctrl+P 列印
- Hosted 最新 Review HEAD `4408efa` Completed 找出 P2：報表列印 CSS 隱藏登入遮罩但顯示舊 `#report-print-preview`，業主登出後共用電腦仍可印出稽核／人事資料。
- 修補本機正式版與 Vercel Demo：showAuth(true) 即清空 main、modal、S.cache／filter／身份，更新 authEpoch，對 body 設置 auth-locked；登出按下即開始 API 並同步鎖定畫面，回應失敗提醒伺服器登出未確認；print CSS 在 auth-locked 狀態一律隱藏 main／預覽，對殘留非同步 DOM 也 fail closed；匯出／列印非同步待命若權限階段變化即中止。增加 Node VM 回歸測試模擬共享終端 Ctrl+P 與登出未完成的非同步流程。仍須最新 Hosted CI、Codex Review，未授權不得 Merge。

- 2026-10-24 Codex 新 P2（HEAD 2b7f277）：舊 logout Set-Cookie 清除可能晚於新 login Set-Cookie，導致新登入 Session 被抹除。正式版與 Demo 新增 logoutInFlight Promise，登出按下同步清畫面／鎖定列印不變；新登入 submit 須先等舊登出請求完成才發送 /api/login，登出失敗亦不得永久卡住；加入 VM 延遲登出回應回歸測試。待 Hosted CI／Codex 複審。

## 2026-10-24｜多品項叫貨與供應商自動分單＋LINE 半自動草稿（新 PR）
- 業主提供先前系統三張畫面：員工盤點→自動整理叫貨→主管核准→依廠商分單→複製 LINE 文字或開啟分享，員工自行按送出。依官方 LINE 文件用 `https://line.me/R/share?text=`，不做自動傳送或假造已讀／已送狀態。
- 不更改嚴格版控的 v3 SQLite Schema：沿用 purchase_orders 每筆一食材，新的多品項群組以 `POB-<randomUUIDhex>-001` 等內部行號與共同 `POB-<randomUUIDhex>` 廠商主單號表示。原始舊單完全保留；同一供應商／門市的多行在交易內一併核准、取消、驗收入庫，逐行 reference_id 防重複，維持後端角色與門市 scope。
- 供應商建議源自門市最近有效歷史價格供應商；可明確覆寫，缺廠商須人工輸入，正式供應商主檔／自動推估安全庫存缺口／外部傳送回執後續可再擴充。
- 新 `src/order-batches.js`、`public/order-batch-ui.js`、`/api/order-batch` 及虛構 Vercel Mock。此為 PoC 功能，需實際 Hosted CI、Codex Review 與 Windows／LINE 操作驗收；未授權不可合併。

- PR #10 Codex 最新 HEAD 8d5ac3 3 個 P2：廠商預覽回應晚於登出可能重開敏感 modal，已於 start/preview/submit/action 檢查 authEpoch+userId；補貨建議等待 API 時若門市由 A 改 B，改成丟棄舊結果；Vercel Mock 新版整張驗收支援各行有效價格先完整驗證才變更庫存，失敗則還原虛構資料 snapshot，不會部分入庫。正式與 Demo UI 同步；補回歸後依最新 SHA 重新送 Review。

- 2026-10-24 PR #10 最新 Codex Review P2：整張批次驗收 UI 缺失逐項進價欄，導致不能如舊 `order.receive` 保留此次進價與庫存關聯；已在正式版和 Vercel Demo 共用 `order-batch-ui.js` 主管驗收視窗加入各行選填進價（元）、進價單位、生效日，送出 `prices[orderLineId]`；空白價不建進價，資料完整性由正式 backend 與 Demo 全張原子交易強制檢查。
- 同輪 P2：Vercel Demo 同日更換供應商的建議選錯舊廠商；供應商排序加入原始 `ingredient_prices` 陣列 index 的同日最新記錄 tie breaker，比照既有 `pricing-demo.js`。需針對最新 HEAD 重新驗證 Hosted CI 與正式 Codex Review，不可沿用舊結果。未授權不得 Merge。

- 2026-10-24 PR #10 Codex P2 (HEAD 98c869c)：`<input type=number>` 在使用者輸入未完成（如 `1e` 或 `-`）時可能 DOM value='' 而 validity.badInput=true，舊判斷誤當自願留空，造成庫存驗收成功但想填的進價未建立。正式與 Demo 先檢查 validity.badInput／checkValidity，再判斷真正空白才跳過，且驗價時再檢查單位／日期有效性；加入模擬瀏覽器 invalid field 及實際按驗收按鈕回歸，確保整張不送出 API。需重跑最新 Hosted CI 與 Codex Review，不得未授權 Merge。

## 2026-10-24｜PR #10 最新 Codex P2：重複快速提交多品項叫貨

- GitHub HEAD `caebe207` 的正式 Codex Review **Completed**，7 個 thread 中 1 個新 P2 未解：`public/order-batch-ui.js` 尚未阻止使用者在首次 `order.batch-create` 回應前連按兩次送出，導致後端建立兩張不同 UUID 的採購申請。
- 已在 `public/order-batch-ui.js` 及 `vercel-demo/order-batch-ui.js` 同步：提交事件一開始阻止重入，通過前端驗證後、發出 API 前同步設定 `submitting` 並 disable 按鈕；API 拒絕後才解鎖允許重試；API 已成功時保持鎖定，即使後續刷新列表失敗也不再重送。
- 新增 `tests/order-batch-double-submit.test.js`，使用 VM 非同步延遲回應重現連點、確認只有單次 API，失敗可重試；成功後刷新失敗亦不可重送。程式＋測試 HEAD `4f8cf235f03f6a731301a7e22927bffd23ff2056`，**不得以其前代 `caebe207` 的 Hosted CI PASS 代表新 HEAD PASS**。
- 後續：查最新 HEAD Ubuntu／Windows Node22/24 Hosted CI；對新 Finding 回覆與 Resolve；提交最新 HEAD 的正式 Codex 複審，確認是否有新 P1/P2。Vercel Preview 目前每日部署額度失敗，與 GitHub CI 分開看。PR #10 仍 Draft，沒有 Merge 授權，Windows／LINE 真人操作未驗收。

## 2026-10-24｜PR #10 新 P2：舊叫貨請求清空新草稿視窗

- 最新已核實 Codex Review：HEAD `2c31530c818b01c47f54bbfaebf4ae9742c7b8fd` **Completed**，新 P2：送出舊叫貨表單後，若在 API 回應前取消、再開啟新表單，舊 API 成功會誤用共用 `#modal-root` 清空新草稿；Review Thread `PRRT_kwDOVUuF1c6v5B4c`。
- 已針對 `public/order-batch-ui.js` 與 `vercel-demo/order-batch-ui.js` 在 submit closure 捕獲實際 DOM form；API 成功、失敗或驗證錯誤時要求 `ownsModal()`（帳號／epoch 未變、modal 可見且當前 form identity 相同），只允許原表單被關閉／解鎖／提示。舊請求仍可能在後端建立單據，這項修正只防止舊結果毀損新 UI，**不宣稱網路請求已取消**。
- 新增 VM 重現：舊表單送出後關閉再建立新草稿，舊成功不得清除新表單；舊失敗不得解鎖或顯示舊錯誤；最新表單仍可提交成功。測試涵蓋正式與 Demo。新 HEAD 的 Hosted CI／正式 Codex Review 待依提交 SHA 核實；前版 PASS 不代表新 HEAD PASS。
- PR 仍 Draft、未經使用者授權不可 Merge；Windows 與 LINE 真機操作、Vercel Preview 部署仍待另行驗收。

## 2026-10-24｜PR #10 新 Codex P2：整張狀態操作與補貨建議須綁定原 modal

- Review HEAD `3bd2bb8d0f13ca156eff7232c6d427ef00770256` **Completed**，新兩項 P2：`PRRT_kwDOVUuF1c6v5Hm4` 舊「主管核准／整張狀態操作」回應可能清空後開的新叫貨草稿；`PRRT_kwDOVUuF1c6v5Hm5` 舊補貨建議在同門市重新開表單後可能填入新草稿。兩者皆在正式版與 Demo 可重現。
- 已在兩份 `order-batch-ui.js` 新增來源 modal instance 檢查：補貨回應先比原 `#batch-form` 實例，再比門市；整張狀態操作回應須比原 `.order-batch-modal` 實例，登入 epoch／帳號亦不變，才可清除畫面及更新 UI。舊失敗亦不能覆蓋新視窗提示。
- 新 `tests/order-batch-modal-lifecycle.test.js` 以 VM 延遲 API 模擬主管核准成功／失敗與舊庫存回應跨表單污染、驗證新視窗保留輸入；`tests/order-batches.test.js` 同步補齊既有進價輸入測試的 modal element 模擬身份，不放寬價格驗證。
- 初版測試 HEAD `95c16db` CI Ubuntu Node22/24 數字價格既有 fixture 失敗（模擬 modal 無實例），已於 `31f317fb` 調整測試；最終 Hosted CI 及正式 Codex 複審**尚須以最新 HEAD 重新核實**。不得沿用前代 PASS。
- PR #10 保留 Draft／OPEN，未經使用者授權不可 Merge。LINE 真機與 Vercel Preview 實站仍未驗收。

## 2026-10-24｜PR #10 P2：初始 GET 開窗覆寫較新的叫貨草稿

- 最新 Codex Review（HEAD `91826043f021485f6c028d85560d3597393a7970`）已 **Completed**，新增一個 P2：`PRRT_kwDOVUuF1c6v5QmB`。舊 `preview()` 的初始 GET 等待回應期間，使用者已 `start()` 開啟新草稿，舊 GET 回來仍會 `show()` 覆蓋新表單；既有 `ownsPreview()` 只保護預覽建立後的狀態 API，不能攔截這條路徑。
- 已修改正式版與 Vercel Demo 的 `order-batch-ui.js`，共用模組內 `openGeneration`，`start()` 與 `preview()` 在登入權限確認後同步取得下一個 generation；所有初始 GET 回應必須確認仍為最新 generation 及原登入主體，才可 `show()`，避免舊預覽／舊建單要求蓋掉新表單。原有表單提交、主管操作、補貨建議 DOM identity guards 保留。
- 新增 `tests/order-batch-opening-generation.test.js` VM 延遲 API 回應，雙版測試（1）舊預覽 GET 晚於新建單表單、保留數量與供應商；（2）舊建單 GET 晚於新預覽；（3）兩次預覽 GET 逆序回應時只顯示最新預覽。修正程式與測試已提交至 `dd50fea7e03ea12ea63357cad9ee173c8b12aedc`，該 HEAD Hosted CI 仍須完成最後核實。
- 此修補僅阻止舊回應改動新 UI，不聲稱已取消發出的 HTTP 請求。新 SHA CI 完成後需回覆／Resolve 原 P2 並正式複審。PR 仍 Draft、未授權禁止 Merge；Vercel Preview／LINE 真機操作未驗收。

## 2026-10-24｜PR #10 最新 Codex P2：舊廠商預覽覆蓋既有單品項表單

- Review HEAD `01e93916cf665f00f135552f49317e5a5b16c98e` 正式 **Completed**，新增 P2 `PRRT_kwDOVUuF1c6v5U8r`：舊 `OrderBatchUI.preview()` 初始 GET 尚在等待時，使用者開啟原有 `app.js showForm('order.create')` 單品項叫貨表單並填寫，因該入口未增加批次模組的 `openGeneration`，舊回應仍覆蓋共用 `#modal-root`，導致資料遺失；正式／Demo 皆可重現。
- 已在正式及 Demo 共四個 UI 檔改用 DOM 根節點共用 `__openTicket`：`order-batch-ui.js` 的 start/preview 在 await 初始 GET 前 claim ticket，回應後比對；`app.js showForm` 在 await getLists 前先 invalidate ticket，回應後比對 ticket/登入 epoch/帳號才開窗；原兩版 modal Close／背景關閉、auth overlay 清空視窗時同步 invalidate，防止已關閉後舊 GET 再開啟。保留既有 DOM identity guard，沒有變更交易或權限。
- 新增 `tests/order-batch-shared-modal.test.js`，使用兩版真實 `showForm()` 函數與真實 OrderBatchUI VM：舊批次預覽 GET 延遲→原有單品項表單開啟且其輸入保留；舊單品項 getLists 延遲→新批次預覽成功且不被舊表單覆蓋。代碼 Commit `0d9e5b65`，測試補至 `9fbda867`。需用**最後 HEAD** 核對 Hosted Ubuntu/Windows Node22/24 CI，再正式回覆/Resolve P2 並重送 Codex Review，不能沿用先前 Completed。
- PR #10 繼續 Draft，未取得使用者明確同意不得 Merge；Windows 真機及 LINE 人工流程仍待驗收，Vercel Preview 部署限額需另查。

## 2026-10-25｜D1 首輪基礎建設（RB-023，等待 CI／Review）
- 已核對 PR #12 合併後的 `main`；Cloudflare Preview 基礎路由可用，正式 API 仍 Demo-only，未綁定 D1。
- 新分支 `feat/cloudflare-d1-foundation-20261025`：以現有 SQLite v3 Schema 轉換 D1 初始 Migration，禁止 `IF NOT EXISTS` 掩蓋非空資料庫，保留 FK/CHECK/index、建立 `cloud_schema_contract`。不匯入真實資料、不建立預設 owner、不改本機 SQLite。
- 增加 D1 只讀結構探測，只有 DB 綁定時檢查 Schema，仍一律 `production_ready:false`；提供正式／Preview 分離綁定設定範本、Migration 操作 SOP、Node SQLite parity/FK/拒絕重複初始化測試。
- 使用者已建立正式 `restaurant-business-prod`（ID `b882a6e8-0e56-49a6-bd41-1a6cadd726c9`）與測試 `restaurant-business-staging`（ID `2c355bed-d9c3-449c-aa9b-1018f3bc1177`）D1。PR #13 已提交根目錄 `wrangler.jsonc` 正式/Preview 分離綁定、`wrangler.preview-migrations.jsonc` 僅 staging 的遷移設定、綁定隔離回歸和安全 SOP。**沒有遠端執行 Migration 的 Cloudflare 帳戶操作權限**，也尚未完成真實營運 API、Google Drive 備份或業主登入。新 HEAD Hosted CI／Codex Review 尚需確認、不得未授權 Merge。

## 2026-10-25｜GitHub Actions staging-only D1 Migration 工作流
- 在 PR #13 新增 `.github/workflows/d1-staging-migration.yml`（workflow_dispatch ONLY，限制 main、必填 `APPLY_STAGING_ONLY`、Environment `d1-staging`），並新增 `tools/check-cloudflare-staging.mjs` 只讀 preflight 及 migration 後完整性校驗。
- 使用者正在設定 Cloudflare Token / GitHub Secrets；**不能宣稱已確認 Token 存入 GitHub，亦不能宣稱 workflow 或遠端 D1 migration 已執行**。
- Workflow 確認 Cloudflare 帳號 ID 和兩個不同 D1 UUID；preflight 拒絕 staging 既有任何使用者 table/d1_migrations；僅對 STAGING_DB 執行 migration，後測 v3 contract、表集合、FK 及無 owner。環境審查規則需 GitHub Settings 額外設定才會生效。
- 本次 Commit 後需以最新 PR HEAD 驗證 Hosted CI／Cloudflare Preview 與正式 Codex Review；PR #13 尚未經使用者授權 Merge。正式 D1 不可自動 Migration。

## 2026-10-25｜PR #13 最新正式 Codex P1 `_cf_KV`
- 使用者已在 GitHub 建立 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 兩筆 Secrets（值不讀取、不能聲稱 API 存取已驗證）。
- 正式 Codex Review HEAD `4e914e7` Completed 發現 P1：新建立 D1 預設包含系統保留表 `_cf_KV`；staging Migration preflight/postflight 僅排除 `sqlite_%` 會誤判空庫／Schema 不符。
- 已在 `.github/workflows/d1-staging-migration.yml` 的前後兩個只讀 SQL 查詢排除 `_cf_KV`，`tools/check-cloudflare-staging.mjs` 統一只過濾此精確系統表（不過度排除未知表、保留 d1_migrations 非空拒絕），測試增 `_cf_KV` 單獨存在、與業務表/ledger 並存及未知表。後續必須檢查最新 HEAD CI、Cloudflare Preview、正式 Codex 複審，處理 Findings 並確認後才可請求使用者 Merge；**目前未執行遠端 Migration**。

## 2026-10-25｜RB-025 Cloudflare 認證基礎（尚未合併）
- 2026-10-25 staging D1 Run #40172089719 遠端 Migration `0001_initial_v3.sql` 成功，30 SQL commands + `STAGING_ONLY_VERIFY_PASS`；使用者實測 Preview `schema_only`，正式 D1 未移轉。
- 新分支 `feat/cloudflare-auth-foundation-20261025`：`cloudflare/auth-core.mjs` WebCrypto PBKDF2(600k SHA-256, 16-byte salt) 測試用密碼介面、Host-only Session Cookie 與 SHA256 token、Session expiration/user.active、Origin/CSRF 檢查、Owner/Manager/Staff + active locations 範圍；`cloudflare/identity.mjs` 唯讀 `GET /api/me`，僅 Worker Preview `CLOUD_AUTH_PHASE=preview-readonly` 可用，Production `disabled`。其他 login/logout/command API 仍 503，沒有啟動真實密碼 API 或任何 schema 變更。
- 既有 Node `scryptSync` 密碼不可直接當 PBKDF2 使用；Workes Free CPU 10ms 限制及未來密碼初始化、登入限流／稽核要另驗測。下一步為 PR Hosted CI、正式 Codex Review、修 Findings，使用者明確授權才 Merge。

## 2026-10-25｜PR #15 staging D1 單次 Owner 建立（STAGED，未執行）
- PR #14 `afd5ac01` Codex Code Review Completed / 無 Findings，CI 4/4 PASS、Preview Build/Deployment PASS；仍 OPEN Draft，使用者只說「繼續」，未授權 Merge。
- 為避免阻塞後續業主登入，另開 Stacked PR #15 分支 `feat/cloudflare-staging-owner-bootstrap-20261025`，基於 PR #14：人工核准 GitHub workflow `d1-staging-owner-bootstrap.yml`，新 `tools/cloudflare-staging-owner.mjs` 及獨立回歸測試；命名 `STAGING_OWNER_PASSWORD` 的環境 Secret 尚未要求使用者設定，切勿貼入聊天或 repo。
- 僅在已初始化 v3、無使用者與營運紀錄之 `restaurant-business-staging` 才可產生第一位 Owner，驗證唯一 active owner / FK，絕不操作 production D1 或把明文／密碼 hash 放入 GitHub logs；此工作流程目前未執行。
- 修正 `tools/check-cloudflare-staging.mjs` 被其它工具 import 會意外執行 CLI 的副作用，改 direct-script guard。
- Cloudflare Workers Free HTTP CPU 10ms；PBKDF2 600k 是否適合 Worker 需另行真機測試，不能把 Github Runner 生成成功當成正式 Login ready。PR #15 必須以最新 Hosted CI、Preview、正式 Codex Review 驗證，待使用者分別授權 Merge #14 與 #15，再由使用者手動觸發 Owner 初始化。

## 2026-10-25｜staging Owner 初始密碼下限改為 12 字元（獨立 PR，未合併）
- 使用者明確要求將 staging Owner 一次性初始化的 `STAGING_OWNER_PASSWORD` 最小長度由 20 改為 12（上限維持 256），不是放寬至 8；原雲端 `cloudflare/auth-core.mjs` 的密碼雜湊函式本來就要求 12～256，不需修改正式 Worker 登入（目前仍停用）。
- 新分支 `fix/staging-owner-password-min12-20261025` 修改 `tools/cloudflare-staging-owner.mjs` 的輸入下限與錯誤訊息、`tests/cloudflare-staging-owner-bootstrap.test.js` 邊界測試（8/11 拒絕、12 可生成和驗證、257 拒絕），同步更新 `docs/Cloudflare-D1-staging-初始業主建立.md`。不改 schema、Cloudflare prod/staging D1 綁定、Workflow Secrets 或 SQL 空庫防護。
- PR #14、#15 已取得授權並已合併；staging D1 Schema Run #40172089719 已驗收，但**staging 初始 Owner 尚未被遠端建立，也未執行一次性 Bootstrap Workflow**；任何 PR 待最新 Hosted CI / 正式 Codex Review 與使用者明確 Merge 授權後才可合併。不能將這次程式修改視為密碼已經設定或資料庫已經初始化。
