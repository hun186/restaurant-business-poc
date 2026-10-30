# Cloudflare Staging D1 真正 Overview 唯讀 API（首個營運串接增量）

本文件對應 P0 [Issue #34](https://github.com/hun186/restaurant-business-poc/issues/34)，讓下一個工作階段優先建立可用的餐廳營運 API，而不是繼續被自願延後的 G5 真實 Restore 演練阻擋。

## 這次新增（僅 PR 內合成測試；尚無新的 Cloudflare 遠端 API 端到端證據）

- `GET /api/overview`：**只在** `CLOUD_AUTH_PHASE=preview-readonly`、具有 D1 `DB` binding、已登入 Session 與 D1 v3 Schema Contract 時可回 `200`。`status=staging_readonly`, `production_ready=false`。
- 伺服器使用固定、參數化的 D1 `SELECT COUNT` 與 `GROUP BY` 聚合，**不接受任何外部 SQL/門市 ID/動態資料表名稱**；任何 query string 均回 `400 E_BAD_QUERY`。
- `metrics.open_tasks`：`tasks.status` 為 `todo`、`doing`；`pending_orders`：`purchase_orders.status` 為 `requested`、`approved`；`open_repairs`：`repairs.status` 為 `reported`、`assigned`。
- `metrics.low_stock`：對每個啟用食材／啟用門市，累計 `stock_moves.qty_delta`，低於 `ingredients.min_stock` 的食材門市組合數。未入庫且低於安全量者也會計算；不假設已有 `on_hand`。
- Owner 看所有啟用門市；Manager 看已授權且啟用門市；Staff 的待辦僅本人被指派，單據／報修僅本人建立，庫存僅授權門市。撤銷 Session、停用使用者或門市能阻止繼續查閱。
- 405 表示非 GET；401 表示缺 Session/非授權；503 `E_NOT_READY` 表示未啟用或缺 DB；503 `E_SCHEMA_NOT_READY` 表示 contract 不符；其他 SQL/驅動異常一律 503 `E_OVERVIEW_UNAVAILABLE`，不返回 SQL 語句及內部錯誤。

## 關鍵界線

- **沒有**開放密碼登入、登出、營運異動、正式資料庫遷移與生產配置。Production `CLOUD_AUTH_PHASE=disabled`、`/api/health` demo_only 及寫入 API 503 完全維持原狀。
- 既有 Staging D1 已有 v3 Schema、索引與**虛構** Owner，但真正密碼驗證牽涉 Hosted Cloudflare Workers PBKDF2 CPU、Access JWT/edge provenance、限流及憑證 Enrollment，必須另 PR 與 Live evidence 驗證；不能因這個 API 可回 200（合成 Session）就宣稱業主已能登入。
- 尚未實際執行新的真實 Cloudflare Staging `/api/overview` 呼叫，PR 內合成 Node SQLite 模擬 D1 binding 的測試**不等於**真實遠端部署。正式 Production D1 的資料初始化與備份亦尚未完成。
- 升級到實際展示之前，須把 Cloudflare Preview 入口放在受 Cloudflare Access 保護的環境，核對實際訪問 URL、角色、Session 與 Scope；**勿拿 Public Demo 輸入真實人事、採購或業務資料**。
- 用 `npm run check`（含 `tests/cloudflare-d1-overview-readonly.test.js`）驗證；合併後再用 main 固定版本做受控 Staging 遠端驗收。沒有使用者 Merge 授權不可合併。

## 下一步（仍未完成）

1. Staging 受保護入口與 Hosted Workers 600K PBKDF2 CPU + Access 來源驗證；規劃只對虛構 Owner 有效的登入／登出、Rate limit、CSRF、Session Cookie。
2. 將本 API 真正部署到受控 Preview/Staging，實測 Session、讀取、越權拒絕、SQL 失敗關閉與無業務寫入。
3. 再逐項把任務、庫存、叫貨與盤點寫入接到 D1 transaction 與後端角色／門市檢查；禁止逕自開放 Production。
4. 獨立備份匯出與精簡（如需）Production 初始化安全閘門另行審查，不得偽造 G5 Restore 已演練。
