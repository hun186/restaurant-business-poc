# Staging Preview HTTP 匿名唯讀驗收（P0 #34）

此工具與 `GET /api/overview` 對應，可在 GitHub Actions 一鍵執行**無登入、無憑證、僅 GET** 的真實 Cloudflare Preview HTTP 驗收。與先前 G1 D1 遠端 Schema 驗收是不同證據；無須重跑 Restore。

## 執行方法

1. 於 Cloudflare Workers 的 PR Preview 成功部署記錄取得實際版本網址（`https://...-restaurant-business-poc.hungyuan-chen.workers.dev`）。**不能使用正式 Worker 網址**。請確認是目前欲測試的版本，並先確保這個網址沒有真實營運資料。
2. GitHub Actions 選擇 **Staging Preview D1 anonymous HTTP GET-only smoke (manual)**，選 `main`，填入 `preview_url`（只有 Origin，不含路徑、query、密碼或 Token），`confirm` 填 `CHECK_STAGING_HTTP_ANONYMOUS`。
3. 工作流程先執行完整 SHA-256 關閉清單預檢，再對指定 Preview 送出七筆 GET：`/api/health`、`/api/overview`、`/api/data?entity=tasks`、`/api/me`、`/api/overview?location_id=other`、`/api/login`、`/api/command`。
4. 成功時輸出 `STAGING_HTTP_GET_ONLY_ANONYMOUS_PASS`。驗收要求 `/api/health` 的 D1 `database=schema_only` 且 `production_ready=false`，Overview／業務資料／身分匿名請求 401，非法查詢 400，登入與 command 的 GET 503。回傳皆必須符合 JSON、No-store、Nosniff，任何非預期回應都失敗。

**嚴格界線：** 只有實際執行的 Hosted Run 完成成功，才有匿名 HTTP + Preview D1 Schema read 的遠端證據。Workflow 或合成測試 CI PASS **不代表遠端驗收 PASS**。Cloudflare Access 可能封鎖匿名請求，回傳登入導向／403，此時流程應失敗而不是繞過 Access。完全不送 Cookie、密碼、Token、POST 或其他寫入方法；不會建立 Session、接觸員工資料或修改 D1。

本次不驗證已登入使用者的 D1 查詢、Cloudflare Access policy、Workers KDF CPU、POST 禁用、Owner 帳號、Production Migration／登入或任何業務交易。之後需受控 Access／合成 Session 的獨立 E2E，並保留後端角色、門市及 CSRF 驗證。

公開 Preview URL 並非秘密；但真實 Cloudflare Access Evidence、Token、Cookie／帳密不得貼到 Issue、Commit、Actions Input 或日誌。
