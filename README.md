# 餐廳好管家｜餐飲營運管理 PoC v0.1

> **2026-10-31 上線路線更新（原生登入）**：使用者選擇在 Cloudflare Workers Free 上採用 PBKDF2-HMAC-SHA256 **100,000 次**（PR #81 已 Merge，合併後 Verify #41205348412 5/5 PASS）；不再把 Cloudflare Zero Trust 與信用卡登錄當成必要前提。本次開發增量僅準備**預設關閉**的原生 Worker/D1 `/api/login`、`/api/logout` 及 `/api/me` 介面，**不代表已啟用正式登入**。Production D1 尚需 Schema、Owner、Session/CSRF/限流實站驗收及正式 UI 接線；仍是 Demo，勿輸入真實資料。詳見 [Cloudflare 原生 PBKDF2-100k Production 上線分段驗收](docs/Cloudflare-Native-100k-Production-Rollout.md)。

> **2026-10-31 最新實證（覆蓋下方歷史快照）：** Staging D1 `0003_access_identity_links.sql` 已由 [GitHub Actions #41198456616](https://github.com/hun186/restaurant-business-poc/actions/runs/41198456616) 對真正遠端 D1 成功套用且完成 Postflight；Production 仍未開放、Cloudflare Access policy/Owner Link/登入與業務寫入未驗收。下一步請依 [Staging Access 0003 實站操作員 Runbook](docs/Staging-Access-0003-live-operator-runbook.md) 設定 **Previews only** 的 Access Policy 及獨立授權之測試 Owner 綁定；禁止以 README 的舊時點描述重新套用 0003。

> 2026-10-30 / PR #41 G0 整合至最新 main（已含 PR #47 的隔離式 D1 Pin UUID）：新增固定 Cloudflare GET only 的 Worker/Domain/Zone 公開暴露面盤點、主線人工 Protected Environment 工作流程、synthetic total_count/多頁 fail-closed 測試及 reviewed SHA-256 allowlist。PR #41 前一 HEAD 903d15d 已通過 Verify 5/5、Workers Build 與 Codex 無 Findings；本整合 HEAD 須重新 Hosted CI + 正式 Codex Review，未通過前不可 Squash Merge。PR #47 已合併，但**未對真正 Cloudflare D1 API 做 remote inspect 或 Restore**。G0 仍未實際運行，Access / 正式登入寫入不可宣稱開放。

> 2026-10-30 G5 #46：使用者提供 disposable D1 UUID `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`，已提出**獨立 Pin-ID PR**，只更新演練目標、封閉安全指紋及測試；尚未透過 Cloudflare API 驗證其真實身分/空庫，也未批准或執行任何 Restore。詳見 `docs/Cloudflare-G5-Disposable-D1-Real-Restore-Drill.md`。

> 2026-10-29 G5：正式 Production Time Travel 唯讀能力已於 Run #40872307187 實證 PASS；另新增**全新 disposable D1** 的真實遠端 Restore 演練工具與人工雙環境授權工作流程。**尚未建立或核准演練資料庫 ID**，所有遠端操作預設拒絕；必須另開 Pin ID PR、CI/Review、受保護 Environment 和人工授權。這不表示已恢復正式資料或可以初始化 Production。詳見 `docs/Cloudflare-G5-Disposable-D1-Real-Restore-Drill.md`。

> 2026-10-29 P0 G5：新增 Production D1 Time Travel **唯讀**能力與 Bookmark 可取得性的手動檢查，以及無雲端憑證的隔離合成 SQLite Snapshot/Restore。這**不是** Cloudflare 遠端 Restore、加密異地備份或復原演練放行；正式 Migration、Owner 建立、登入與寫入均維持禁用。詳見 `docs/Cloudflare-G5-D1-Recovery-Readiness-and-Drill.md`。

> 2026-10-29 P0 G5：新增 Production D1 空庫首次初始化的手動嚴格關卡（`d1-production-initialize-g5.yml`），含唯讀預檢、固定 DB 身分、`0001`/`0002` SHA 白名單、人工簽核及復原演練開關。**提交和合併不會自動執行 Production migration**；正式登入與業務寫入仍保持禁止。詳見 `docs/Cloudflare-G5-Production-D1-First-Init-Safety-Gates.md`。

> 2026-10-29 P0 G1：新增手動遠端只讀驗收 .github/workflows/d1-staging-live-readonly-g1.yml，核對 Staging D1 v3 Schema、0001/0002 Migration、登入索引、外鍵、Owner 彙總；目前尚未實際觸發遠端執行。正式 Cloudflare Login／Writes 仍維持禁止。

> 2026-10-29 P0 #34：新增 `cloudflare/stocktake-write-internal.mjs` 的 D1 盤點確認內部原型，支援校驗帳面庫存、原子性調整流水與稽核（合成資料測試）。**尚未接入公開 Cloudflare Worker**；正式 `/api/command` 仍回 503，不能輸入正式營運資料。

> 2026-10-29 P0 #34：多品項叫貨整張核准／驗收入庫的內部 D1 原型在 `cloudflare/group-order-write-internal.mjs`，**未匯入公開 Worker 或啟用正式登入／寫入**。僅透過合成 SQLite/D1 測試；仍缺真正 Access、Production D1、備份／還原與業主 UAT。

> P0 #34（2026-10-29）：D1 單品項叫貨核准/驗收內部交易原型在 `cloudflare/order-write-internal.mjs`，**未接公開路由**；不包含多品項批次單驗收、進價/成本寫回或正式營運。`CLOUD_AUTH_PHASE=disabled` 的 Production `/api/command` 仍回 503，沒有開放真實登入或庫存異動。

> 2026-10-29 P0 #34：D1 正式營運尚未開通。新增的 `cloudflare/task-write-internal.mjs` 僅供內部合成測試的稽核原子性實驗，**沒有連到公開 Worker**；`/api/command` 仍回 503。不可將其解讀為業主已可登入或寫入正式 D1。

> **Cloudflare 上線現況（2026-10-29）**：業主要求先完成雲端正式營運（[P0 Issue #34](https://github.com/hun186/restaurant-business-poc/issues/34)）。現有 Cloudflare Production 仍僅虛構 Demo，登入/業務寫入未啟用。本開發增量只在 Preview 的既有 Session 保護下試行 D1 `/api/data` 唯讀查詢，不代表真實 Owner 已能登入或正式資料庫可用；不得輸入真實帳密／營運資料。

以 [水電好管家](https://github.com/hun186/plumber-business-poc) 的繁體中文深藍／青綠管理介面為視覺參考，針對餐飲業另建的**獨立程式**。本版本具備可執行的 Node.js + SQLite 後端、三層級帳號權限及基本營運工作流程，不是靜態空殼。**狀態：可供本機 PoC 驗證，尚未通過生產環境安全驗收。**

## Cloudflare Staging D1 開發進度（2026-10-30，新 PR，尚未 Merge）

新增 `GET /api/overview` 的真正 D1 聚合讀取，僅在 Worker `CLOUD_AUTH_PHASE=preview-readonly`、D1 v3 Contract、有效 Session 及角色／門市查核同時成立時回傳 `open_tasks`、`pending_orders`、`open_repairs`、`low_stock` 四項統計。Staff 的待辦與單據限本人分派／建立，Manager 限授權且啟用的門市，Owner 看所有啟用門市；低庫存以 `stock_moves` 流水彙總，不讀取偽造的 `on_hand`。未登入、缺 Schema、SQL 錯誤均不會外洩資料；未知查詢參數、寫入方法拒絕。

此 PR 只是下一步真正 D1 串接的**第一個可驗證的 Staging 唯讀 API 增量**；沒有在 Cloudflare 遠端新建立帳號或實際登入、沒有啟用 `/api/login` 或 `/api/command`，沒有修改 Cloudflare Production D1，Production 的 `CLOUD_AUTH_PHASE=disabled` 及 `demo_only`、正式寫入 503 持續保留。即使 Hosted CI 通過，仍需後續取得受 Cloudflare Access 保護的測試環境與真實 Staging API 執行證據，才可宣稱雲端功能可供使用。詳見 [Staging D1 唯讀 Overview 契約](docs/Cloudflare-Staging-D1-Overview-API.md)。

## 現有功能

| 模組 | 目前可執行的功能 | 限制 |
| --- | --- | --- |
| 今日營運總覽 | 待辦／逾期、低庫存、叫貨、維修、訓練 KPI | 尚無營業額與 POS 串接 |
| 工作管理 | 指派、進行、完成、逾期追蹤 | 暫未提供重複性 SOP 任務排程 |
| 食材與庫存 | 食材主檔、安全存量、分店庫存、進貨／耗用不可任意覆寫之流水 | 尚無批號、效期、成本／配方耗用 |
| 叫貨 | 員工申請、主管核准、驗收入庫、取消 | 單張單據限一種食材；無供應商 API |
| 盤點 | 申報帳面／實際數量、主管確認、差異入帳、拒絕重複／過期盤點 | 尚無批次盤點表、照片佐證 |
| 設備維修 | 員工報修、主管派工及結案 | 尚無週期保養排程 |
| 人事 | 分店班表、同日與跨午夜重疊阻擋、請假審核 | 跨日班以結束時間早於開始時間表示；月曆、換班、工時／勞基法計算尚未實作或驗收 |
| 教育訓練 | SOP 課程、員工分派、成績及完成日期 | 尚無題庫、考試計時與線上影片 |
| 員工考核 | 考核期間、分數、回饋與員工本人查閱 | 尚無簽核與多維權重 |
| 多層權限 | 業主／主管／員工，門市授權，操作時後端檢查 | 角色固定三層，細粒度功能權限仍待擴充 |
| 系統稽核 | 成功／失敗登入、登出與資料變更紀錄 | 一般 DB 管理員仍可修改 SQLite，非不可竄改封存 |
| 資料安全 | scrypt 雜湊、HttpOnly SameSite Session、CSRF、防爆量登入、輸入檢核 | 不具備完整威脅建模／外部滲透測試 |
| 備份 | 本機自動／手動 SQLite 一致性備份、無變更跳過、管理頁、下載與輪替 | 異地備份與業主 Windows 還原演練仍待完成 |

## 需求來源與設計

依據業主提供的兩張初版圖：首頁以「今日工作／叫貨與庫存／設備維修／人事與訓練」為四大入口；操作權限以業主、主管、一般員工區分，各人獨立登入。新增分店維度，讓主管無法查看或改動其他門市人事記錄；員工原則上只能讀取自己的工作、班表、訓練、考核，並可建立報修、請假、叫貨與盤點申請。

本版保留「食材主檔是全組織共用、庫存與交易依門市區分」的設計。未來若導入加盟店或多法人需要改為完整 tenant 隔離，不能只沿用門市篩選。

**RB-006 跨日班（本 PR 開發中）：** 在人事排班填入 22:00 上班、06:00 下班，代表翌日 06:00；下班時間等於上班時間會拒絕（不可表示 24 小時班）。同一員工的跨日區間會檢查前一日、當日與隔日全部門市班次是否重疊，剛好銜接允許，不修改 SQLite Schema v3。**尚未**提供排班月曆、換班、勞基法工時計算或請假衝突自動處理；正式 Windows 人工操作與多店 UAT 仍待驗收。

## 快速本機啟動

1. 安裝 **Node.js 22.13 以上**（建議 Node 24 LTS），開啟終端機進入本專案根目錄。
2. 執行 `npm start`，不需先安裝第三方套件。首次啟動自動建立 `data/restaurant.sqlite` 與一個 `owner` 帳號；**終端機只顯示一次隨機密碼，請立即妥善保管**。
3. 用瀏覽器開啟 http://127.0.0.1:3000，以 `owner` 和首次隨機密碼登入，先新增食材與員工。
4. 測試用 `npm run check`（Node.js 內建測試器；不使用實際資料庫）。
5. 備份用 `node tools/backup.js`，會在 `backups/` 產生完整性檢查成功的 `.sqlite`。Windows 使用者另可雙擊 `啟動餐廳好管家.bat`、`部署檢查.bat` 與 `備份資料.bat`（**BAT 尚未在業主 Windows 電腦實機驗收**）。

> **資料重要**：本系統沒有固定、公開或寫死的 Demo 密碼。請勿將 `data/`、`backups/`、`.env` 上傳公開 GitHub。

## 部署安全與限制

- 內建伺服器**僅綁定 `127.0.0.1`**，不可直接供網際網路或門市跨網段連線。
- 若日後要多人跨店使用，須先加入正式 HTTPS 反向代理、可信來源、安全 Cookie (`COOKIE_SECURE=1`)、伺服器身分驗證／存取規則、存取防護、備援、異地備份、OS 權限與滲透測試；部署前請評估 SQLite 多使用者寫入能力，或改為伺服器型資料庫。
- **Vercel 無法直接持久化本機 SQLite**。本版沒有聲稱在 Vercel 上提供正式業務資料功能；若要公開 Demo，應額外建立與真實 API 完全隔離的虛構資料展示站。
- 首次啟動後建立 `data/.installed`。如果資料庫消失，程式會拒絕重建空白資料庫以避免誤判資料遺失；**不得把重新刪除 `.installed` 當作復原手段**。
- 手動備份保存在同一台主機上不等於災難備援。資料還原需先停機、保存原 `.sqlite`／`-wal`／`-shm` 整組、在隔離環境確認備份再操作。
- 稽核僅保護「經應用程式呼叫的操作路徑」，尚非加密簽章防竄改日誌；不得把它當作符合特定法規稽核標準的保證。

## GitHub 開發及驗證

- 公開原始碼位於 [`hun186/restaurant-business-poc`](https://github.com/hun186/restaurant-business-poc)，`main` 是基線，第一版功能放在 [Draft PR #1](https://github.com/hun186/restaurant-business-poc/pull/1)（`feat/restaurant-poc-v0.1`）。
- `.github/workflows/verify.yml` 針對 PR 與 main，在 Ubuntu/Windows、Node 22/24 四個組合執行 `npm run check`。以**當次 PR 最新 HEAD SHA** 的 Hosted CI 結果為準。
- 目前屬初始 PoC，不代表正式跨門市／公網安全可部署；正式 Codex Review 與營運場域驗收仍應另外執行，未獲維護者核准前不可自動 Merge。
- Public Repository 只能包含程式碼與虛構測試資料，不能包含任何員工、薪資、客戶、食材營運機密、密碼、`.env` 或 SQLite/備份。

## 開發方式

- 所有功能都透過 `src/service.js` 的後端權限檢查及 SQLite transaction 更新，不能只靠前端隱藏按鈕。
- `AGENTS.md` 與 `.codex/*` 保存專案定位、驗證命令、進度及規格，避免下一輪對話遺失。
- 參閱 [`docs/開發階段與驗收清單.md`](docs/開發階段與驗收清單.md)。

## 公開 Vercel 展示版（僅虛構資料）

`vercel-demo/` 是獨立靜態站，包含菜單售價／配方／歷史價格與試算的互動展示，採用瀏覽器內部模擬資料（sessionStorage），不啟用 Node.js SQLite API、真實登入、角色授權或伺服器稽核。Vercel 專案 Root Directory 設 `vercel-demo`，PR 分支提供 Preview；正式資料僅能於安全驗證後另外部署固定後端。**請勿在公開 Demo 輸入真實人事與營運資訊。**

## 自動備份與歷史管理（PR #1 分支新增，待 Hosted CI 與正式複審）

正式本機 SQLite 模式：以業主登入後進入「系統管理 → 備份管理」。預設每 **1 天**檢查一次、保留 **50** 份自動備份（可改成 1–365 天、1–500 份），設定保存在 SQLite `backup_settings`，並不是瀏覽器 localStorage。網站啟動立即檢查是否到期，每分鐘再檢查；關機期間不執行，重啟後逾期會補檢一次。

使用背景 Worker 建立 `VACUUM INTO` 一致性快照；驗證 `quick_check`、外鍵與表結構後才發布版本。與上一份**仍存在且通過驗證的自動備份**相比，若持久資料未變更，就更新檢查時間並跳過產生重複檔案（不計 Session／登入暫存／備份元資料）。手動備份永遠建立新版本，不受自動保留份數輪替刪除。管理頁支援儲存設定、建立手動備份、查看／下載／刪除備份，僅業主有權操作。升級 v1→v2 前會先建立 `migration` 安全快照。

**不要把備份檔放進 Public GitHub 或公開 Vercel 示範站。** 同機備份無法防止主機遺失，需另行建立離線／異地副本及實機還原演練。詳細注意事項與資料庫／WAL/SHM 的停機還原程序見 [自動備份與還原 SOP](docs/備份與還原SOP.md)。 真正第二台 Windows 的恢復／Session 撤銷、RTO/RPO 與業主簽收，請依 [Windows 異機還原現場驗收與證據紀錄](docs/Windows異機還原現場驗收紀錄.md) 操作並記錄；這是**待執行範本**，不是已完成的場域驗收。正式公網多人部署尚未通過安全驗收。

## v3｜菜單與食材歷史價格成本
本版新增按門市的歷史單價、進貨驗收價格留痕、每份菜品配方、最新單價食材成本／估算材料毛利與庫存估值。詳見 [AI 菜單價格與成本整合說明](docs/菜單價格與成本試算.md)。**不包含實際 POS、FIFO／移動平均會計成本；Vercel 網站仍是獨立虛構展示站。**

## Vercel 虛構智慧備份操作教學

Vercel Demo 左側「系統管理 → 智慧備份示範」可操作虛構備份設定、快轉模擬到期檢查、無異動跳過、虛構工作變更後建立自動版本、手動版本及自動輪替。**全程只是 sessionStorage 中的示範紀錄，不產生 SQLite 檔案、不執行真正排程，也不可下載／還原**。實際備份及完整性驗證僅存在於本機 Node.js 正式模式。

## 本機登入異常排除（2026-10-24）

若舊版登入後出現 `Cannot read properties of null (reading 'reset')`，是前端在 `await /api/login` 之後使用已結束事件的 `e.currentTarget`，**不是提示 SQLite 損毀或密碼錯誤**。先按 `Ctrl + F5` 重新整理（登入成功的 Session 可能已建立），不要刪除 `data/restaurant.sqlite`、`data/.installed` 或備份。更新本修補版本後再登入；如仍無法登入，查詢 Network `/api/login` HTTP 狀態及 Node 終端機錯誤，不要在公開 Issue 貼登入憑證／Cookie。


## 忘記 owner 密碼：本機離線安全復原

若首次啟動終端機顯示的隨機密碼沒有記錄，無法從 SQLite 雜湊反查；**切勿刪除 `data/restaurant.sqlite`、`data/.installed`、`data/restaurant.sqlite-wal`／`-shm` 或 `backups/`**。

- **尚未登出且 Session 有效**：登入後點「變更密碼」，輸入新密碼（至少 12 字元）。系統會撤銷舊 Session，之後用新密碼登入。
- **已登出且忘記密碼**：務必使用有權存取資料庫的本機電腦，先停止 `npm start` 或關閉 `啟動餐廳好管家.bat` 的 Node 服務；不得對正在運作的資料庫強行執行復原。
- 在專案根目錄以互動式終端機執行：`node tools/reset-owner-password.js`。
- 閱讀提示後鍵入 `RESET owner` 確認。工具先確認 `.installed`、既有 v3 Schema、SQLite 完整性及唯一的有效 owner，再**建立並驗證一份完整手動備份**。備份失敗時**不改動密碼**；成功後於交易內更新隨機 scrypt 密碼、撤銷 owner Session／清理登入錯誤計數、留下不包含密碼的稽核記錄。
- 終端機僅顯示**新的隨機密碼一次**，請立即存入密碼管理器。重新執行 `npm start` 登入；可再使用網頁「變更密碼」設定個人密碼。
- 若使用 `DATA_DIR` 將資料庫放在自訂位置，請在同一終端機環境設定該變數後再執行。工具不會尋找其他資料庫，也不會重建遺失的資料庫。
- 不要在遠端共用會話、公開直播或蒐集終端機輸出的環境執行。此離線工具限受控主機／檔案權限人員使用，不提供匿名遠端「忘記密碼」API。

## 新功能：來源 IP 安全稽核（本機 Node.js）
- 「系統管理 → 安全稽核」業主專屬列表新增「來源 IP」欄。新登入成功、登入失敗、登出及被記錄的營運異動，會保存**實際 TCP 連線來源**，不信任可能偽造的 `X-Forwarded-For`／`X-Real-IP`。
- 本機服務預設綁定 `127.0.0.1`，一般本機登入來源會顯示 `127.0.0.1`，不是使用者外網 IP。未來跨網段代理部署需要另訂可信代理設計，不可直接信任轉送標頭。
- 不修改 SQLite Schema：IP 記錄於稽核 `detail.source_ip`；查閱另外投影為 `ip_address`。舊的稽核僅有不可反解的 IP hash 時，來源 IP 顯示未知，不能補造歷史 IP。業主需妥善保存含 IP 的報表和資料庫備份。
- 此功能不會收集每一次 HTTP 存取，只在既有登入和業務稽核事件留存 IP。

## 新功能：Excel 多工作表匯出與列印（本機 Node.js）
- 各資料列表上方有「匯出此頁 Excel」和「列印此頁」，只包含該頁已搜尋篩選的列。
- 左側「系統管理 → Excel 匯出與列印」可選擇多種資料分類作為 Excel 工作表，逐分類指定欄位，以關鍵字及日期範圍篩選，並可預覽列印。
- 真正的 `.xlsx`（非 CSV），共用水電系統的無第三方套件 OOXML/ZIP 匯出器；所有輸入字串以純文字單元格保存，避免惡意 Excel 公式。
- 所有資料由既有已登入 `/api/data` 取得，後端檢查角色與門市，前端選單不是權限邊界。僅業主可匯出安全稽核和完整帳號清單；主管／員工仍受現有 scope 限制。
- 目前匯出遵循既有列表 API 筆數上限（部分列表最多 300／500 筆），**不等於歷史全量匯出**。Excel 及列印檔可能包含敏感員工、來源 IP、採購價格，應妥善保管。
- Vercel 公開展示版仍只提供虛構資料，不能因此聲稱有真實來源 IP 或 SQLite 匯出。

- **公開 Vercel Demo** 也加入純虛構 Excel 匯出與列印操作，使用獨立的模擬 sessionStorage 資料；「來源 IP」僅顯示文件範例 `192.0.2.20`，不會收集真實訪客來源。

## 多品項叫貨與人工 LINE 叫貨（工作分支，待正式驗收）
- 原先叫貨單為一單一食材；新版可在「叫貨管理 → 多品項叫貨」一次輸入至多 60 項，依**供應商名稱＋門市**自動分成各自的廠商單號。多品項的每筆明細使用不同的內部編號（`POB-...-001`），面向廠商則顯示共用主號（`POB-...`）；既有舊版 `PO-...` 單據不改動、仍可正常核准／驗收。
- 供應商建議以該門市食材**最近有效歷史進價**中的非空供應商為依據，不代表供應商契約或名單已驗證。沒有可參考的供應商時必須人工指定；送出前請核對名稱、食材、數量及單位。
- 多品項單由主管核准後產生一張廠商 LINE 文字草稿；可複製或開啟 LINE 官方 `https://line.me/R/share?text=` 分享畫面，**不會自動傳訊，也不能自動判斷是否已送達或已讀**。選擇收件人、按送出需由人員親自完成。
- 核准及整張驗收採單一 SQLite transaction；每個食材獨立保留一筆 `purchase_orders`、庫存 `stock_moves` 及 reference ID，重複驗收會拒絕。可按品項帶入選填進價，既有歷史進價表繼續適用。不更動 Schema/user_version=3，智慧備份仍涵蓋異動。
- Vercel 公開 Demo 只能產生虛構叫貨與 LINE 草稿，不會連線正式 SQLite 或發真實叫貨訊息；**展示版使用時請勿送出給真正供應商**。

- 「多品項叫貨」表單另提供**依安全庫存填入補貨建議**：採該門市 `max(0,安全庫存-現有庫存)` 計算，填入後仍可人工調整，不會捏造預估銷量或需求預測，且不覆蓋已手動選擇的項目。舊的逐行 `order.approve/receive/cancel` API 對新群組行會拒絕，避免繞過整張單交易造成部分驗收。

- 人員在 LINE **實際按下送出後**，可再按「我已在 LINE 手動送出」留下操作人與時間的稽核紀錄，系統不會因點擊複製或分享連結就擅自改成已送出。此狀態是**人工申報**，不是 LINE 平台提供的送達／已讀回執。未核准不得登記，同張單重複登記會被拒絕；單據若在 LINE 上已送出，再於系統取消也必須另行通知廠商。

## Cloudflare D1 資料庫基礎（開發中，尚非正式雲端版）

- 已有 Demo-only Cloudflare Worker；`/api/health` 回報 `production_ready: false`，不代表已能安全保存營運資料。
- D1 逐步移植工作見 [Cloudflare D1 資料庫基礎 SOP](docs/Cloudflare-D1-正式版資料庫基礎.md)：提供 v3 空白 Migration、Schema 驗證及正式／Preview 雙庫範本，已提供正式／Preview 不同 D1 UUID 的綁定設定，但尚未執行遠端 Migration、也尚未初始化業主帳號。
- 暫時**不要將真實帳密、人事、營運資料輸入 Cloudflare 展示站**；本機原有 SQLite 正式功能不因 D1 工作改變。後續實作仍須 Hosted CI、正式 Codex Review 與獨立的生產驗收。

### Cloudflare D1 認證第一階段（開發中）

- staging D1 已透過 GitHub Actions Run [#40172089719](https://github.com/hun186/restaurant-business-poc/actions/runs/40172089719) 完成 v3 空白 Schema 安裝及 FK 驗證；**production D1 仍未初始化**。
- Worker 新增 WebCrypto／Session／CSRF／RBAC 基礎及僅限 Preview 的唯讀 `GET /api/me`，Production 認證功能仍關閉；`/api/login` 與正式營運 API 仍為 `503 E_NOT_READY`。
- 詳細安全邊界見 [Cloudflare D1 登入與權限第一階段](docs/Cloudflare-D1-登入與權限第一階段.md)。不要輸入真實員工帳密或營運資料，也不要把本機 scrypt 密碼視為可直接移轉到雲端。

### Cloudflare D1 登入安全內部階段（尚未開放帳密登入）

- Staging D1 已建立第一位測試 Owner（[GitHub Run #40188578478](https://github.com/hun186/restaurant-business-poc/actions/runs/40188578478) 遠端 postflight 成功），但無法直接使用公開網站登入。
- 新增 `cloudflare/login-service.mjs`（僅**內部、未接路由**）：原子 D1 登入嘗試限流、PBKDF2 密碼驗證、Session／登入稽核交易、登出 CSRF／Origin 撤銷；前端及正式／Preview 的 `/api/login`、`/api/logout` 仍 **503 E_NOT_READY**。
- Workers Free 每個 HTTP 請求 10ms CPU 限額、Preview 存取保護、IP 來源信任與 D1 實機併發尚未驗收；在完成之前不能將本程式視為可正式登入的功能。詳情：[Cloudflare D1 登入安全服務內部階段](docs/Cloudflare-D1-登入安全服務內部階段.md)。

### Cloudflare Workers PBKDF2 虛構密碼效能探針（尚未上線）

- 新增完全**獨立的本機 workerd** 合成密碼 Hash／Verify 效能探針和手動 GitHub Actions。它不連 staging／production D1、沒有 Cloudflare Secret，也不會開放公開登入路由。
- 本機探針測的是 **wall-clock elapsed time，不是 Cloudflare Hosted CPU time**；Free 10ms CPU 上限與實際 Password Hash 可行性仍須另外在受保護測試環境驗證，否則不能開啟登入。詳見 [PBKDF2 Workerd 合成效能驗證](docs/Cloudflare-PBKDF2-Workerd-合成效能驗證.md)。

### Cloudflare Hosted PBKDF2 CPU 驗證工具（僅準備，未部署）

- 已準備**獨立且預設 disabled** 的合成 Hosted Worker：`wrangler.pbkdf2-hosted-disabled.jsonc` 禁用 workers.dev 與預覽 URL，不連接 D1、營運 API、Owner 密碼或 Session。必須另外核對 Cloudflare Worker-level Access 的 `ctx.access` 與 AUD，取得授權後才可能開啟測試。
- 每個受保護請求只做一個固定虛構向量 PBKDF2；回應與自訂 log 均不提供耗時數值（Hosted `performance.now()` 可能凍結），真正 Hosted CPU／Wall time 必須從 Cloudflare invocation logs 查詢。沒有自動部署或啟用。詳見 [Hosted PBKDF2 Access/CPU 驗證計畫](docs/Cloudflare-Hosted-PBKDF2-Access-CPU-驗證計畫.md)。

### Cloudflare Hosted PBKDF2 部署前安全檢查（離線，未驗 Access）

- `node tools/cloudflare-hosted-probe-preflight.mjs`：離線確認探針仍為 disabled、沒有 routes/D1/Preview，與正式 Worker 完全隔離；Hosted CI 同時跑故意改壞設定的負向測試。
- 靜態工具**不能證明** Cloudflare 遠端 Worker 已受 Access 保護，也不能證明 workers.dev、Version/Deployment URLs 無意外暴露。現場還需核對 Worker-level Access **All traffic**、hostname/path 規則優先序、無 Bypass 與獨立 Worker ID；詳見 [部署前驗收 SOP](docs/Cloudflare-Hosted-CPU-Access-部署前驗收.md)。
- 這套工具不會呼叫 Cloudflare API、部署 Worker 或觸碰 D1；實際 Hosted CPU 驗證需另外授權。


**部署前 Preflight 修正（PR #21）：** 檢查器已改用固定的 SHA-256 白名單，包含 Hosted Access 守衛 Source、GitHub Workflow 及其委派的 `tools/` 與 `package.json`；新增 `false &&` 繞過和委派 `bash tools/deploy-probe.sh` 的負向回歸。將來修改這些檔案應先 Code Review 再更新白名單；此校驗仍不證明 Cloudflare 遠端 Access 已部署／CPU 已測得。

**PR #21 安全檢查加強：** SHA-256 白名單也涵蓋所有目前的 Cloudflare 傳遞 import、`src/`、`tests/*.test.js`、資料庫 SQL、前端模組與 Wrangler 設定，使用遞迴封閉檔案清單避免新檔案繞過。僅更改 `cloudflare/auth-core.mjs` 或測試入口，就會讓 Preflight 失敗。這依然只是原始碼／CI 完整性證據，**不表示遠端 Cloudflare Access 已驗證或允許部署**。

**私人 Access 證據離線稽核（RB-034，開發中）：** [填寫規範與判定邊界](docs/Cloudflare-Hosted-CPU-Access-部署前驗收.md) 與 [無敏感值 JSON 樣板](docs/hosted-access-private-evidence.template.json)。將樣板複製到 Git Repo **外**的私有目錄後才可執行 `node tools/hosted-access-evidence-audit.mjs <private-file.json>`；完成表單**不代表**真的驗證了 Cloudflare Access，也不授權部署。

**Hosted CPU 平台觀測離線分析（RB-035，開發中）：** `node tools/hosted-cpu-log-offline-audit.mjs <repo外私有去識別化JSON>`，依 Cloudflare Workers invocation logs 的 `cpuTimeMs`、`wallTimeMs`、`outcome` 做只讀統計與 Free 10ms 風險提示；[填寫與安全 SOP](docs/Cloudflare-Hosted-CPU-Access-部署前驗收.md)。範例為**虛構數值**；工具不能證明平台資料真偽、Cloudflare Access 安全或部署授權。

**內部 Cloudflare 登入來源 IP 正規化（RB-036，開發中）：** 為尚未啟用的 D1 Login 限流新增合法 IPv4／IPv6 解析，等價 IPv6 與 IPv4-mapped 位址在 HMAC 前統一，避免同一來源使用多個文字表示拆開來源限流；不代表 Cloudflare 標頭來源已獲實站驗證。Production Login 繼續返回 503，不變更遠端 Access、Worker 或 D1。

## Windows 業主忘記密碼：雙擊 BAT 操作（業主友善）

1. 關閉「啟動餐廳好管家.bat」的服務視窗（如果用 `npm start`，也要先停止服務）。
2. 在**原本保存資料庫的專案資料夾**雙擊 **`重設業主密碼.bat`**。請勿解壓到另一個空白目錄，也不要刪除 `data/` 或 `backups/`。
3. 閱讀畫面的中文說明，確認服務已停止後，輸入 **數字 `1`** 並按 Enter；其他輸入會取消。
4. 工具會先建立並驗證備份；驗證通過才更新 `owner` 密碼。新密碼只顯示在視窗中一次，請立即記錄。若顯示錯誤，請保留畫面及原始資料，不要重設資料庫。
5. 重新雙擊「啟動餐廳好管家.bat」，用 `owner` 及新密碼登入。登入後可在「變更密碼」改成自己保存的密碼。

BAT 只簡化本機互動操作，實際安全檢查仍由 `tools/reset-owner-password.js` 執行；不產生固定預設密碼、不開放遠端重設、不改動營運資料。BAT 以 Node.js 的 `--disable-warning=ExperimentalWarning` **只隱藏 SQLite 實驗性警告**，不會隱藏一般錯誤或驗證失敗訊息。若不使用 Windows，仍可執行 `node tools/reset-owner-password.js` 並輸入 `RESET owner`。

**路徑安全：** `重設業主密碼.bat` 會先以 Windows `pushd` 切換至 BAT 所在專案資料夾，失敗時立即中止，避免誤讀其他專案的 SQLite；結束後恢復工作目錄。雖然 `pushd` 能處理 UNC 網路路徑，但正式資料庫**仍建議放在本機磁碟**，不要直接放在不穩定的網路共享位置。

## 菜品封存與配方移除（PR #9 已合併）

「菜品與售價」只有業主可把停售菜品**封存**，封存後預設不顯示於日常菜單、不能調整售價，也不參與成本／毛利試算；勾選「顯示已封存菜品」可檢視並**恢復**，保留原菜品識別碼及配方以利未來重新上架，不會更動食材價格、庫存或歷史異動。

「每份菜品配方」可由業主逐筆**移除食材**（有確認提示），刪除的是特定配方食材連結、不是食材主檔或價格／進貨紀錄；成本試算會即時重算。操作都寫入安全稽核，配方移除稽核保留刪除前的菜品、食材及用量。兩種操作都由正式 Node.js 後端強制執行 owner 權限與 SQLite transaction；Vercel Demo 僅處理 sessionStorage 中的虛構資料，與正式營運資料完全隔離。

## RB-003｜跨角色／跨門市權限回歸驗證

`tests/rbac-matrix.test.js` 使用每次新建的臨時 SQLite、虛構使用者與隨機本機 HTTP 埠，驗證業主、分店主管及一般員工對工作、叫貨、盤點、維修、排班、請假、教育訓練、考核、進價、庫存估值、成本明細與門市資料的讀寫範圍。跨店主管與同店員工不得修改無權存取的業務資料；拒絕請求不得產生成功稽核、庫存或資料指紋異動。透過實際 `/api/me`、`/api/data`、`/api/command` 確認門市授權變更、角色降權與帳號停用會使既有 Session 失效。

執行 `npm run check` 即涵蓋新測試。這是**自動化回歸保護**，不等於正式 Windows／多門市網路／真人操作的完整滲透測試；正式部署仍須額外評估 HTTPS、權限管理、備份還原與登入安全。

## Windows 備份隔離還原驗證（RB-010／RB-011，尚非真正災難復原）

1. 確認自己位於原本保存 `data/restaurant.sqlite` 的完整專案目錄，**不要刪除或取代現有 SQLite / `.installed` / `backups/`**。建議先使用「備份資料.bat」建立新手動備份。
2. Windows 雙擊 **`備份還原演練.bat`**；或在終端執行 `node tools/restore-drill.js`。程式預設選取現有最新備份，亦支援 `node tools/restore-drill.js --backup restaurant-backup-YYYYMMDD-HHMMSS-xxxxxxxx-manual.sqlite` 指定某份合法備份。若設定 `DATA_DIR`／`BACKUP_DIR`，請確認指向實際、受保護的原資料與備份位置。
3. 工具會**只讀**既有備份，複製到受保護的系統暫存位置，確認完整性、Schema/FK、位元組 SHA-256、資料指紋及業主/門市等摘要後清除隔離副本；失敗會以非零結束碼提示。**不修改正式資料庫、不改密碼、不啟動服務、不覆蓋備份**。
4. 真正災難復原驗收仍需另行安排：將加密備份儲存在**不同磁碟或異地受限帳號**、測試故障磁碟以外的獨立 Windows 主機、在隔離主機停止服務後安全還原、啟動服務並由業主驗證登入/菜單/員工/叫貨/庫存與權限，記錄日期、版本、RTO/RPO 與簽收；不得以暫存副本驗證代替。

**隱私提醒：** SQLite 備份含真實人事、登入憑證雜湊與營運資料；請勿將 `.sqlite`、檢查紀錄內的人員資訊、備份目錄或帳密上傳至公開 GitHub、Vercel、雲端 Preview 或此對話。演練工具不會自行上傳資料。

## 外接磁碟／獨立 Windows 電腦備份驗證（RB-011，非實際還原）

備份轉移至另一台電腦後，可在**沒有原主機 data/ 資料庫**的環境驗證。請先於來源電腦建立備份，利用現有 `備份還原演練.bat` 記錄該份備份的 SHA-256，**存放在與備份檔分離的私有紀錄**。透過已加密及受管制的媒體把 .sqlite 複製到另一台 Windows 電腦。

獨立電腦安裝 Node.js 22.13+ 與完整餐廳好管家程式，雙擊 **`異機備份驗證.bat`**，輸入外接備份完整路徑與來源紀錄的 SHA-256。命令列也可使用 `node tools/offsite-backup-verify.js --file "E:\Backup\restaurant-backup-YYYYMMDD-HHMMSS-xxxxxxxx-manual.sqlite" --sha256 <原始 SHA-256>`。

工具只將原始備份複製到受保護的一次性隔離資料夾，核對 SHA-256、SQLite Schema/quick_check/FK、資料指紋與有效業主/營運摘要，然後刪除隔離副本。**不修改來源備份、原主機 data/、檔案 ACL 或密碼；不啟動服務；不等於已完成真正異機還原或業主簽收。**

詳情與安全／異常 SOP 參見 [備份與還原 SOP](docs/備份與還原SOP.md)。絕不可將任何營運備份及個資傳至公開 GitHub、Vercel 或外部分享空間。

## 合成資料隔離復原後服務啟動回歸（RB-011-SMOKE）

`npm run check` 包含 `tests/recovered-service-smoke.test.js`：在臨時目錄建立**全虛構**門市、帳號、食材與庫存，從真實備份程式產生快照，將快照複製到另一全新隔離路徑，啟動 Node.js 本機隨機 HTTP 埠，驗證既有業主／主管帳號、`/api/me`、食材與概況 API、角色 403，以及損毀副本拒絕啟動。來源備份不會被修改，測試後自動清理臨時資料。這只是 CI runner 上的 **synthetic restore-to-service**，沒有啟動公開服務／真實營運資料／真正獨立 Windows 機器，亦不會替業主做正式還原。真實還原前應由技術人員撤銷備份包含的舊 Session 並完成現場 RTO/RPO 簽收；參見 [備份與還原 SOP](docs/備份與還原SOP.md)。

## RB-011-SESSION：還原舊 Session 憑證復活風險（合成測試）

`tests/restore-session-revocation.test.js` 建立完全虛構且可拋棄的 SQLite 備份，模擬快照中的舊 Session 在未清除時可能被 `/api/me` 接受；再只對另一份受控隔離副本在服務未啟動時執行 `DELETE FROM sessions`，確認舊 Cookie 為 401，原帳號重新登入、庫存資料與原始備份均不受影響。`npm run check` 包含此回歸。實際停機復原步驟參考 [備份與還原 SOP](docs/備份與還原SOP.md)。這**不代表**已在真實 Windows 異機還原或對正式資料庫執行 Session 清除；需要授權技術人員現場核對、備份/ACL、RTO/RPO 與業主簽收。
