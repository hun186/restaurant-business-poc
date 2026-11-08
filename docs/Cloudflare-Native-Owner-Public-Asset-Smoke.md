# 一鍵驗證 Cloudflare 正式 Owner 公開頁面（GET-only）

Windows 上在專案根目錄執行 `run-native-owner-public-readonly.bat`。不需要 Node.js、Cloudflare API Token、密碼、Cookie 或登入正式 Owner。

## 檢查內容與使用時機

1. 固定 HTTPS Host `restaurant-business-poc.hungyuan-chen.workers.dev`，只 GET `/api/native/status`，要求 `mode=demo`、`login_enabled=false`，以及 task/catalog/order/stocktake/repair 五個 Write Gates 均為 boolean false。正式登入受控 UAT 暫時打開時，此檢查會 Fail Closed，**不要為了通過檢查而在未登出的時候關 Gate**。
2. 分別 GET `/owner-app`（Cloudflare 預設 `auto-trailing-slash` 的正式標準路徑，對應 checkout 的 `owner-app.html`）、`/owner-app.css`、`/owner-app.js`、`/native-owner-display.mjs`，以最大 96KiB、12 秒、無重導、無 Cookie、無預設憑證的 HTTP 請求讀取；MIME/HTTP Status 不合要求就拒絕；不自動跟隨 `/owner-app.html` → `/owner-app` 的 307 轉址。參考 Cloudflare 官方 HTML handling：https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/。
3. 把遠端解壓後原始位元組與當前 checkout 的 `vercel-demo/` 對應檔案做 SHA-256 比對。僅將 Windows CRLF 與 LF 文字換行正規化；沒有其他內容修改。請先在 repo 執行 `git pull --ff-only origin main` 以確定檔案版本最新，否則比對是對自己的舊 checkout。
4. 成功顯示 `NATIVE_OWNER_PUBLIC_ASSETS_READONLY_PASS`，包含已比較四個資源、當前 checkout 相同、Native Login/五個 Write Gates 關閉、GET-only 與零 D1/Cloudflare 寫入。失敗只輸出定值階段與錯誤碼，不印 API Body、憑證、Cookie、SQL 或秘密。
5. 若需先確認 PowerShell 在本機能執行，可離線執行 `powershell.exe -NoProfile -NonInteractive -File tools/native-owner-public-assets-readonly.ps1 -SelfTest`。此模式**不會連網**。

## 驗證不能推論的事項

本檢查只能證明當刻公開 HTTP 回應的四個靜態資源與 checkout 內容一致，及 status 表示功能關閉。**不等於 Cloudflare Active Worker Version/Git SHA 已通過 G0、也不代表 Owner 真實登入/登出、Session 撤銷、D1 業務 CRUD、桌機 1440／手機 390 實際視覺驗收已成功。**這些仍由 Issue #153/#34 安全分階段驗證。

本工具不讀取或更動任何 Dashboard Vars、Secrets、D1、正式 Owner 或部署設定，且不支援任何動作型 HTTP Method。
