# Cloudflare Native Owner 登入／登出實機 UAT — 公開唯讀 Gate 雙檢查

## 適用範圍

本專案已由操作者以 [GitHub Actions #42933310603](https://github.com/hun186/restaurant-business-poc/actions/runs/42933310603) 確認 Production D1 **只有一位合法 Owner**、保留正常的 `login_attempts` 與登入稽核、Session 目前為零、業務資料尚未建立；Schema v3、兩筆 Migration、稽核／完整性全部 PASS。此結構驗收不等於真正可登入。

專案已有合成 Worker/D1 登入→Cookie→`/api/me`→讀取業務資料→登出→舊 Session 401 測試（`tests/cloudflare-native-login-http.test.js` 與 `tests/cloudflare-native-owner-business-http.test.js`），但**尚未取得 Cloudflare Production 真實 Owner 的登入／登出 UAT 證據**。使用者不願啟用 Cloudflare Zero Trust/Access；因此不要求它作為 Native Owner 驗收前提。

## 新的兩支 Windows 一鍵檢查

這兩支 BAT **不會自動啟用、關閉或部署**任何 Cloudflare 設定；都使用 Windows PowerShell 5.1+，不要求本機 Node.js，僅針對固定的 `restaurant-business-poc.hungyuan-chen.workers.dev` 發送 3 個匿名 **HTTPS GET**，不帶 Cookie／Token／密碼，不會新增登入嘗試或修改 D1。HTTP 禁止 redirect、Cookie 容器、預設憑證，回應嚴格限制大小／JSON／no-store。

- **`run-native-owner-login-uat-preflight.bat`**：在操作員已**獨立核准並短暫開啟** Native Login Gate、但尚未輸入真實密碼前執行。要求 `mode=native`、`login_enabled=true`、五種業務寫入 Gate **全部 false**；匿名 `GET /api/login` 必須 HTTP 405、匿名 `GET /api/me` 必須 HTTP 401 且不得回傳身分／CSRF。成功只輸出 `NATIVE_OWNER_LOGIN_UAT_PREFLIGHT_PASS`。
- **`run-native-owner-login-uat-closeout.bat`**：操作員**先在網站完成登出並核實 `/api/me` 已回 401**，再回 Cloudflare Dashboard 關閉兩項 Native Login Gate 並部署，最後雙擊此 BAT。要求 `mode=demo`、`login_enabled=false`、五個業務 Gate 全 false，且匿名 `GET /api/login`、`GET /api/me` 都為 503 `E_NOT_READY`。成功只輸出 `NATIVE_OWNER_LOGIN_UAT_CLOSEOUT_PASS`。

兩者都會明確回報 `owner_login_logout_uat_verified=false`、`session_revoked_verified=false`、`release_authorized=false`：**公開匿名 GET 永遠無法驗證帶 Cookie 的真正登入／撤銷**；請勿把一鍵檢查 PASS 寫成真實 UAT PASS。

## 受控實機操作流程（需獨立核准，不由 CI／本工具執行）

1. **準備**：登入窗口由授權操作員決定，先確認最新部署版本與 [Issue #34](https://github.com/hun186/restaurant-business-poc/issues/34) 的 Owner 結構驗收證據、可回復的設定／受控備份；五個業務寫入 Gate 保持關閉，不建第二位 Owner，不重跑 D1 Migration。請勿在聊天／Actions／Issue／截圖中公開密碼、Cookie、Session Token、CSRF、內網 IP、API Token 或 Secret。
2. **僅人工暫時啟用認證**：在 Cloudflare Dashboard 受控設定 `CLOUD_AUTH_PHASE=native-production`、`CLOUD_NATIVE_LOGIN_GATE=operator-released`，保留既有 `NATIVE_AUTH_SOURCE_PEPPER` Secret。五個 `CLOUD_NATIVE_*_WRITE_GATE` 必須全部 disabled/absent。這個動作**會改變正式 Worker 配置、向公開 HTTPS 開放受限登入，且可能產生新的登入稽核與 Session；不是唯讀操作**。未安排明確操作員／回復程序前，不做此步。
3. **登入前雙擊 Preflight BAT**。若不是 `NATIVE_OWNER_LOGIN_UAT_PREFLIGHT_PASS`，停止 UAT，不輸入密碼，也不自行繞過 Gate。檢查的版本僅為**當下公開網址的實際回應**，仍需獨立核對 Active Worker 版本；Preflight 本身不驗證來源 IP 或 CSRF。
4. **瀏覽器驗收**：以 Chrome／Edge 開啟 `https://restaurant-business-poc.hungyuan-chen.workers.dev/owner-app`，僅在已確認正式登入啟用且 Gate 均符合要求時輸入保存在私人密碼管理器的 Owner 密碼。檢查登入成功、同源 Cookie（HttpOnly/Secure/SameSite，不截圖 Cookie 值）、`GET /api/me` 200、唯讀總覽與管理選單、1440px 桌機和 390px 手機畫面、五種寫入操作不可用。**不要按任何新增／修改／刪除、不要建立測試業務資料。**
5. **先登出再關 Gate**：按工作台「安全登出」，確認 `POST /api/logout` 200，然後在**同一瀏覽器相同 Cookie 條件**下確認 `GET /api/me` 401。如果登出發生錯誤、無法確認舊 Session 已撤銷，**不得宣稱 UAT 成功**；保持帳號與 Token 不公開，交由授權管理員處理撤銷。切勿以「把 Login Gate 關掉」代替 Session 撤銷。
6. **人工回閉並驗證**：確認已登出，再由操作員將 `CLOUD_AUTH_PHASE=disabled`、`CLOUD_NATIVE_LOGIN_GATE=disabled`，五種 Write Gate 繼續保持關閉，完成 Cloudflare 設定發布。執行 **Closeout BAT**，取得 `NATIVE_OWNER_LOGIN_UAT_CLOSEOUT_PASS`。若 Closeout FAIL，必須視為未完成安全回閉，先停止其他部署；不可僅憑畫面鎖定頁宣稱完成。
7. **回報證據**：提供「Preflight PASS／實際登入是否成功／登出 HTTP 狀態／登出後 `/api/me` HTTP 狀態／Closeout PASS／桌機手機介面結果」的**非機密文字**即可；不需要提供 Network HAR、Cookie、Token、密碼或含個資的截圖。可附上其他不含機密的圖片，再由專案決定是否關閉 #153 的實機 UAT 項目。

## 安全界線

- 此 BAT 不會聯絡 Cloudflare 管理 API、不使用 GitHub Environment Secret、不執行任何 SQL、HTTP POST、Cloudflare deploy 或配置變更。
- 即使 Preflight 與 Closeout 都 PASS，也無法證明兩次檢查之間每一時刻的 Gate 狀態，亦無法證明中間某個登入者已正確登出；**真實登入／登出與 Session 撤銷必須另有受控實證**。
- 若使用者目前不希望啟用正式站登入，則保留 Gate 關閉並停在「待 UAT」即可；沒有必要反覆執行已通過的 Owner D1 結構驗收。
