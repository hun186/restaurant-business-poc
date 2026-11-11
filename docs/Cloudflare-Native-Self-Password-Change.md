# Cloudflare 原生帳號變更密碼（Owner／主管／員工）

## 使用者操作

登入正式 **/owner-app** → 系統管理 → 我的帳號／變更密碼。輸入「目前密碼」及「新密碼／確認」，長度 12–256 字元且不得與舊密碼相同。更新完成會清除瀏覽器 Session Cookie 並撤銷這個帳號在 D1 上的**所有登入工作階段**，須用新密碼重新登入。不需登出／手動執行 BAT／變更 Cloudflare 五個業務 Write Gate。

## 伺服器契約

`POST /api/password/change` 只在既有 Native Login Gate／Production D1 Schema v3 可用時受理。與本機版不同，此功能由正式 Cloudflare Worker/D1 自行驗證，沒有新增匿名重設 API、沒有電子郵件／簡訊驗證或未登入的代碼傳遞。

- **必須**有效 HTTPS 同源 Session、Origin、CSRF、防跨站 Request Metadata，請求 2KB/2s 限制、僅接受精確的 `current_password`／`new_password` 欄位；對認證輸入拒絕無效格式。
- 舊密碼以既有 PBKDF2-HMAC-SHA256 100k 比對，失敗不透露帳號或資料，並使用現有 `login_attempts` 限流，防止登入後不斷猜舊密碼。
- 產生新隨機 16-byte salt 與 32-byte digest。D1 `batch` 在相同交易中以舊 hash/salt 與有效 Session CAS 條件更新密碼、刪除該 User 的全部 Session、寫 `auth.password_change` 稽核並將成功的重驗 attempt 標記成功。
- 不記錄原始密碼、新密碼、salt、hash、CSRF、Cookie 或來源 IP；資料庫內仍保存雜湊與既有業務資料。成功回應只包含固定 `code=OK` 與過期的 HttpOnly Secure Cookie。
- **不依賴五項業務 Write Gate**，登入的所有合法角色皆可變更本人密碼，但不提供變更他人密碼或匿名復原。正式 Production D1 **不由開發／CI 直接改動**。

## 忘記密碼處理

如果完全忘記舊密碼，這個自助路由**無法**重設。維護者須透過獨立的受控 Production D1 工具，先核對固定 Production D1 身分、唯一啟用 Owner 及唯一 Bootstrap 稽核、已存在的資料與可復原備份，另外取得維護者的明確授權才可一次性重設。**不得**清空 D1、刪除使用者、重新初始化 Owner 或在 GitHub Issue／聊天紀錄貼新密碼。

這次合併只加入「有舊密碼的本人密碼變更」，不代表忘記密碼的受控 Production 重設工具已完成，也不代表新版 Worker 已部署。正式站需按原有安全部署流程發布新版資產，注意維持既有 Auth 與業務 Write Gate，不可盲目讓預設 `CLOUD_AUTH_PHASE=disabled` 覆蓋線上設定。
