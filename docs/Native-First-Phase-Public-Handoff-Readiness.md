# 餐廳好管家｜第一階段正式交付公開狀態快檢（唯讀）

這份快檢解決先前的證據缺口：GitHub G0 只能證明 **Active Worker 的程式版本**，無法單獨證明正式網址目前已啟用 Native 登入及五種核心業務寫入。原有 `cloudflare-public-runtime-readonly.yml` 是「Demo-only」保護快檢，必然不適用於已正式開啟 Native 的營運狀態，這兩種用途不得混淆。

## 取得新證據

GitHub Actions → **First-phase Native public Owner readiness (anonymous GET, informational)**

- 每次 Main `Verify` Push CI 成功後自動執行，或透過「Run workflow」並輸入 `CHECK_NATIVE_FIRST_PHASE_READONLY` 手動執行。
- 僅以固定 https 正式 workers.dev 網址發送四個**匿名 GET**：
  1. `/api/native/status`：嚴格要求 `mode=native`、`login_enabled=true`、task/catalog/order/stocktake/repair 這五個核心 Write Gate 均為 `true`。
  2. 同一份狀態中，第二階段 `stock_v4_gate_enabled` 與 `supplier_return_gate_enabled` 必須均為 `false`；額外的 price/stock_usage Gate 只回報目前布林值，不自動認定已實機驗收。
  3. `/api/login`：匿名 GET 必須是 405；`/api/me`：匿名 GET 必須是 401，且絕不回傳 user/CSRF。
  4. `/owner-app.html`：真實 Owner 入口 HTML 應回傳 200、noindex 及同源 CSP，不能是 Demo 假登入頁。
- HTTP 狀態、Content-Type、no-store、無非預期 Cookie／Redirect、回應大小與 UTF-8 全數嚴格核對；網路故障、資料形狀不符或 Gate 關閉以安全分類失敗，不印出伺服器原始回應或敏感內容。
- 完全**不使用 Cloudflare Token、Owner 密碼、Cookie、CSRF、POST、SQL、資料庫連線或部署權限**。

## PASS 能證明什麼

`NATIVE_FIRST_PHASE_PUBLIC_READONLY_PASS` 證明**觀測當刻**，公開正式網址回報 Native 登入與五種核心功能旗標已開啟、新 v4 異動旗標未開啟，且基本匿名身分邊界、Owner 網頁入口可用。這是一項有價值的**交付時差異／新鮮度證據**，不取消 11/17 已通過的 Owner/Manager/Staff 操作者 UAT。

但它**不會**登入正式 Owner、驗證五個寫入 API 的實際提交、取得 D1 schema/資料完整性、檢查最新加密備份或遠端還原、驗證自訂域名，亦**不取代獨立 G0** 的 Worker Build/Main SHA 核對。

GitHub Action 成功不會自動執行 v4 正式遷移、開放任何 Gate 或替代操作者的最終交付決議。若正式營運暫停、DNS 不通或 Gate 調整，這項獨立資訊性 Action 可能失敗，不能把它誤判為程式碼 CI 失敗。

**第一階段業主交付**：以既有實機 UAT，加上新版公開 HTTP 狀態、獨立 Active Worker G0 與營運備份新鮮度確認作出明確交付決策；第二階段 v4 持續獨立放行。
