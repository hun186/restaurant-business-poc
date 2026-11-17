# 門市授權 UAT｜匿名唯讀前置檢查（2026-11-17）

## 執行

在下載並驗證最新版 GitHub 程式的 Windows 電腦，以 Node.js 22.13+ 執行 `run-native-owner-grant-uat-readonly.bat`。不需要提供 Owner 帳密、Cloudflare Token、Secret 或 D1 金鑰，不接受參數；它只會向固定正式 Worker 網址發出三筆無 Cookie 的 GET。

1. `GET /api/native/status`：要求 `mode=native`、`login_enabled=true`，且五項營運寫入均為 false。
2. `GET /api/accounts`：匿名使用者必須收到 401 `E_UNAUTHENTICATED`。
3. `GET /api/accounts/grant`：要求收到 503 `E_NOT_READY`，證明本次匿名請求被拒絕（不得以 POST 測試）。這不等於實際 Gate 設定已確認；後端 D1 未就緒也可能回傳同一錯誤。

三者全部符合才輸出 `NATIVE_OWNER_GRANT_UAT_READONLY_PREFLIGHT_PASS`；其餘一律失敗並只列出固定錯誤碼。失敗時不要自行開 Gate 或反覆輸入密碼，先核對正式部署版本及設定。

## 重要限制

PASS 僅證明**當次匿名 GET 所觀察到的公開路由拒絕與登入／業務寫入狀態**，不代表 Owner 已完成真實登入、門市授權 POST、Session 撤銷、稽核寫入、D1 原子性、異地備份、Restore 或正式放行。不能據此把 `CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE` 或 `CLOUD_NATIVE_ACCOUNT_GRANT_WRITE_GATE` 切成 `operator-released`。未驗證操作員權限、Cloudflare Active Version 對應以及正式業主 UAT 前，所有正式員工門市授權寫入仍應維持關閉。

本程式不修改任何 GitHub／Cloudflare／D1／Worker 設定，沒有 POST、PUT、PATCH、DELETE、Cookie、密碼與 Token。

特別注意：輸出會明確標記 `grant_write_gate_configuration_verified:false`，表示未驗證 Dashboard 實際變數、未證明雙 Gate 都為 OFF；正式 Gate 設定須由具權限的操作員另行唯讀核對，不能由匿名 503 推論。
