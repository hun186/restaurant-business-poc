# 正式 Owner 工作台 UI 一致化（Issue #153）

此改動只調整正式 Worker 的 `/owner-app.html`、`/owner-app.css` 和既有原生 `owner-app.js` 的展示控制，不改 `cloudflare/worker.mjs`、Schema、Migration、帳密、Cloudflare Secrets、`CLOUD_AUTH_PHASE`、`CLOUD_NATIVE_LOGIN_GATE` 或五個業務寫入 Gate。

## 視覺與資料契約

- 與本機／Vercel 展示頁共用深藍側欄、群組導航、白色 Topbar、卡片、RWD 手機選單（390px）與桌機主工作區（1440px）的設計語言。只列出實際存在的原生 D1 讀取功能；沒有實作的 Demo 頁籤不可假裝已推出。
- `/api/native/status` 未回傳 `mode=native,login_enabled=true` 時，密碼表單和主工作台保持隱藏。有效登入才呼叫 `/api/me`、`/api/overview` 和 `/api/data`。
- 五個寫入 Gate 由後端 Status 的嚴格布林值決定；UI 僅顯示相應的「操作已啟用」或「唯讀」資訊，既有寫入函式仍依 Gate、Role、CSRF 防護。未開放功能的唯讀清單不顯示假操作。
- `owner-app.js` 不載入 `mock.js` 或 Demo `app.js`；不使用 localStorage/sessionStorage；資料用 `textContent` / DOM 節點顯示，不以 `innerHTML` 拼接回應。CSP、同源 Cookie、CSRF 與登出撤銷程序保持原樣。

## 交付與驗收界限

1. `npm run check`（Node >=22.13）、GitHub Hosted Verify、正式 Codex Review 和最新 HEAD 合併檢查須分別通過，才可考慮合併。
2. 於安全隔離的本機／預覽檢查 1440px 桌機側欄、390px 手機收合、鍵盤 Escape、錯誤訊息、空白 D1 清單與 Overview 卡片。這些 UI 靜態／合成檢查不等於真實瀏覽器 UAT。
3. 由操作者在受控窗口檢查 Cloudflare 正式 Asset 是否一致、Dashboard Variables/Secrets 與下一次 Wrangler 發版是否同步、登入/登出及重新 GET `/api/me` 的 401。不可讓本 PR 自行開啟 Login 或 Business Write Gates，不能變更 Production D1。
4. 本次任何 GitHub 合併可能觸發 Cloudflare 生產部署。若無法確認實際部署會保留 Dashboard 上的 Secrets/Vars，需保持 PR Pending，不以 CI 成功取代部署風險評估。
