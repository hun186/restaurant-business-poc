# Cloudflare D1／本機 SQLite 功能對齊與業主交付路線（2026-11-16）

> 權威依據是 GitHub `main`、每個 PR 的最新 HEAD CI／Codex 和 Cloudflare Active Version 的正式唯讀驗收，不是 Demo 畫面；本文件是**實作路線圖**，不是全部已上線的宣告。

## 三部署角色與共用原則

- **本機 Node.js + SQLite**：目前可操作功能最完整的營運實作與本機備份工具。
- **Cloudflare Workers + D1 Native Owner**：預定供業主與員工跨裝置正式使用。僅經授權功能可對真實 D1 異動；Worker 後端 RBAC、門市範圍、Session/CSRF、原子稽核不可退讓。
- **Vercel Demo**：虛構資料的前端試用。可共用純展示元件、欄位規則、設計 Token，但禁止讀寫真實 D1、接收真實密碼或偽裝成正式資料來源。
- 共用 **policy / command contract / UI component**；各自保持獨立的 SQLite/D1/Mock repository adapters、交易與認證，避免從本機直接複製後端 SQL 或將 Demo 模擬權限引進正式 Worker。

## 對齊優先序

| 優先 | 功能 | SQLite 現況 | Cloudflare 後續交付條件 |
| --- | --- | --- | --- |
| P0 | Owner 登入、門市/食材、工作/叫貨/盤點/維修 | 核心功能存在 | 已接多項 Native API，**逐功能做 Production UAT 與獨立 Gate 實值確認**，不能將 CI 當 Live 測試 |
| P0 | **安全稽核（本 PR）** | Owner 有專用稽核畫面 | 新增 Owner 專用 GET-only `/api/audit`、臺灣日期區間／事件分類／50 筆伺服器分頁、摘要隱私白名單、正式頁入口；待 CI／Review／Cloudflare Active Version／Owner 實場核實 |
| P1 | 員工帳號新增、停用、角色 | SQLite 多項寫入已存在 | Cloudflare API 已實作獨立 Gate；**ROLE Gate 依操作者確認保持 disabled**，不得因視覺對齊自行放行 |
| P1 | 員工門市授權調整與重設他人密碼 | SQLite 有 | Cloudflare 仍缺 Owner-only D1 原子 CAS、Session 撤銷、Audit 與安全復原流程；每項需獨立 Threat Model／合成 CI／Live UAT 與明確 Operator Write Gate 審批 |
| P1 | Excel 匯出／列印 | SQLite 有實際表格匯出 | 先建立 Owner-only 已授權範圍 GET 篩選與資料投影，避免前端直接讀取任何未授權資料；不輸出 Cookie、密碼、IP hash；再共用前端 XLSX 呈現 |
| P2 | 食材歷史價格、菜單／配方／售價／成本 | SQLite 與 Demo 已有模組 | D1 新資料表與 Migrat​​ion 審核、角色／門市成本計算、審計／備份和灰度 UAT，不應為畫面一致直接改 Production Schema |
| P2 | 排班、請假、訓練紀錄與考核 | SQLite 較完整；Native D1 部分唯讀 | 先補 RBAC 限定的唯讀及畫面，再逐功能獨立開放資料修改 Gate |
| P2 | 資料庫備份與恢復 | SQLite 管理 UI | D1 正式採原有營運期加密匯出工具，先核對離線／副本驗證；不可將 Demo 備份按鈕改成可直接還原 Production |

## 安全稽核第一階段契約

- 只接受 `GET /api/audit`、Cloudflare Native Login enabled、有效 Session、**Owner role**；沒有新增 Write Gate、`wrangler.jsonc` Variables、Secrets、Schema、Migration 或任何 D1 正式寫入。
- `category=all|auth|account|operations`、`from/to=YYYY-MM-DD`（以 **Asia/Taipei** 本地日期定界）、`offset` 50 筆分頁且上限 5,000；伺服器固定欄位白名單，不回傳 `ip_hash`、`actor_id`、原始 `detail`、任何密碼或 Session。
- `Cache-Control: private, no-store`；Owner session 過期、角色被撤銷、DB/schema 異常時一律 fail closed。前端僅以 `textContent` 建立 DOM；切頁／登出／Session 切換不得殘留資料。
- 下一關為最新 HEAD Hosted Verify 5/5、正式 Codex 0 unresolved、Clean Merge Gate；合併後仍必須 Cloudflare Active Version + Owner 實機讀取／Session 撤銷驗證。**此 PR 不宣稱正式已上線**。

## 交付策略

採「同功能同規則、先可使用再擴大全覆蓋」：每一項補齊以實際 D1 API、身份／稽核／Session、UI 和跨平台契約測試為一組；不增加無關產品開關、不把 Zero Trust 當必要條件、不延後已可安全交付的 Owner 基本功能。若涉及 Production D1 Schema、Gate 啟用、員工安全異動或 Restore，必須另有操作員明確授權與可驗證回退證據。

## 2026-11-16 第二批：庫存與人事唯讀頁面（PR 進行中）

- #188 安全稽核程式已 Squash Merge 至 `main` `bed040e07eec6f410cc6ebee24d75e6fc8af0320`；合併後 Hosted CI／Cloudflare Active Version／Owner 現場 UAT 必須各自核實。
- 本批預備在 Native D1（**不擴充 Preview GET 白名單**）提供 `stock_moves`、`leave_requests`、`training_records`、`evaluations` 四個已有 v3 資料表的**真實唯讀**列表。查詢必須在 LIMIT 500 前，以 SQL 驗證啟用中的門市授權；員工本人紀錄限制於自己的 user_id，庫存流水限制所屬門市；Owner 可查全店，主管查授權門市。
- 前端共用原有資料表與欄位白名單，用中文狀態顯示，頁面清楚標示「唯讀」。**不新增任何建立、審核、修改、匯入或匯出**，不觸發資料庫/Worker 寫入 Gate，亦不因本次功能呈現而開啟角色寫入。
- 這不代表本機的請假審核／訓練評分／考核新增／庫存耗用寫入已完整移植；上述是後續獨立受控 Write PR。CI/Codex 以及真正 Active Worker／角色 UAT 各自判定，不得以新選單顯示當作已上線。

## 2026-11-16 第三批：正式 Native D1 使用者可匯出已授權列表（本 PR 審查中）

- Cloudflare Native 正式登入者在已授權的清單（工作、叫貨、盤點、維修、門市／食材／庫存、排班、請假、訓練紀錄、考核等）可下載目前搜尋結果 Excel `.xlsx`，使用**本機 SQLite / Vercel Demo 已存在且內容一致**的 `xlsx-lite.js` 工作簿產生器；不新增 D1 SQL、Export API、帳號、查詢 Gate 或正式 D1 寫入。
- 匯出資料完全透過 `presentNativeRows()` 的固定中文欄位白名單，再由純 `nativeOwnerReportSheet()` 產生，僅涵蓋當前 Session 已經 GET 取得且符合本機搜尋的前 500 筆；**不代表完整資料庫備份或全量報表**。數量欄位保留可運算數字，字串依現有 XLSX writer 寫成 `inlineStr`，避免公式執行。
- 每次使用者手動點擊下載均顯示含個資／營運資料的保管確認。登出、重新登入或切換頁面後，舊頁面下載處理器必須 fail closed；前端自行產生檔案，不提交 Excel 至雲端。
- 空清單共用文案由「此門市」改為「目前授權範圍內」，讓 Owner 全店／Manager 門市／Staff 本人的條件更準確。
- 仍需最新 PR HEAD Hosted CI 5/5、正式 Codex Completed/0 Finding、Clean Merge Gate；合併後須 Owner 實機 Excel 下載、資料列／隱私核對、行動裝置下載行為驗收。這不是新增稽核查詢或全量 D1 備份。

## 2026-11-16 第四批：正式 D1 食材價格、菜品售價與配方「唯讀」對齊（本 PR 仍需驗證）

- 業主已回報 #190 實機下載的 Excel **檔案正常開啟、中文欄位、資料筆數、數值皆正確**；配合 G0 100% main SHA 驗證後，該項「Owner 實機下載及內容」可標記為使用者回報 PASS。其他角色隔離、D1 全量備份未因此驗證。
- 原有 D1 v3 Schema **已具備** `ingredient_prices`、`menu_dishes`、`dish_ingredients`，本批只在正式 Native `/api/data`（不擴張 Preview）新增三項 Owner／Manager 唯讀清單：食材歷史價格（依授權且啟用門市限制）、菜品售價、每份食材配方。Manager 沒有任何啟用門市授權時，全球菜單／配方也必須回空；Staff GET 403。後端固定 SQL、參數綁定、先授權篩選後 LIMIT 500、no-store；不回傳查詢用 ID／未投影機密。
- 前端共用 Native 資料表、中文固定欄位及既有 Excel 產生器，價錢從整數 TWD cents 換算為 **元**；Owner／Manager 才顯示選單，Staff 不顯示，也不能靠猜 API URL 取得資料。沒有新增菜品／配方寫入、修改單價、正式 D1 Schema／Gate，沒有修改 Worker Preview 或帳號權限。
- **本批不提供成本／毛利試算**：落地版 `src/pricing.js` 依門市、歷史單價有效日、kg/g、L/ml 單位換算、缺價原因，逐行四捨五入到分計算。若未完整移植不得用價格乘數量臆測成本或把這些頁標為成本估算已上線。
- 發布流程必須 PR 最新 HEAD CI 5/5、Codex completed/0 Findings/0 unresolved、Clean Merge Gate；Main Postmerge CI 與 Cloudflare G0 Active Version／Owner 正式頁資料 UAT 各自驗證。這裡只是**開發中規劃與程式範圍**，不能預先宣稱已上線。

## 2026-11-16 自動化部署版本核對（#192 提案，非已部署宣告）

- 原本每次合併 `main` 後都需操作員手動執行 Cloudflare G0。新增固定 Workflow `cloudflare-g0-active-version-readonly.yml` 的 `workflow_run` 入口，在**同一 Repo 的 `Verify`、`push` 主線、結論 success、觸發 Commit 與當前 main GitHub SHA 完全一致**時，才啟動既有 G0 Cloudflare GET-only 建置關聯核對。來自 PR、失敗/取消 CI、非 main、非同 Repo、過時 Commit 的觸發一律略過，不能使用 Cloudflare Secrets。
- 原有手動 `workflow_dispatch` + `CHECK_ACTIVE_WORKER_READONLY` 留作備援；新自動模式最多 8 次、每次失敗後間隔 30 秒，處理 CI 完成而 Cloudflare Git 建置尚在切版的合理延遲。逾上限仍 **FAIL，絕不自動部署、放行寫入或宣稱 Live UAT 完成**；不讀取 D1 營運資料，也不更改任何正式 Workers 版本。
- 自動 G0 只有版本與 Git 建置 Commit/100% 流量的證據，不檢驗網域路由、業主登入、檔案下載或操作正確性。跨批可在同一 PR 完成 2～3 個低風險功能，先完成完整 CI＋Codex 再合併一次，讓主線自動跑 G0；**含資料庫寫入/帳號安全/復原/正式 Gate 變更的 PR 必須分開做**。
