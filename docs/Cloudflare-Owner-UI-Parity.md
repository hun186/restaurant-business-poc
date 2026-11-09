# 正式 Owner 工作台 UI 一致化（Issue #153）

此改動只調整正式 Worker 的 `/owner-app.html`、`/owner-app.css` 和既有原生 `owner-app.js` 的展示控制，不改 `cloudflare/worker.mjs`、Schema、Migration、帳密、Cloudflare Secrets、`CLOUD_AUTH_PHASE`、`CLOUD_NATIVE_LOGIN_GATE` 或五個業務寫入 Gate。

## 視覺與資料契約

- 與本機／Vercel 展示頁共用深藍側欄、群組導航、白色 Topbar、卡片、RWD 手機選單（390px）與桌機主工作區（1440px）的設計語言。只列出實際存在的原生 D1 讀取功能；沒有實作的 Demo 頁籤不可假裝已推出。
- `/api/native/status` 未回傳 `mode=native,login_enabled=true` 時，密碼表單和主工作台保持隱藏。有效登入才呼叫 `/api/me`、`/api/overview` 和 `/api/data`。
- 五個寫入 Gate 由後端 Status 的嚴格布林值決定；UI 僅顯示相應的「操作已啟用」或「唯讀」資訊，既有寫入函式仍依 Gate、Role、CSRF 防護。未開放功能的唯讀清單不顯示假操作。
- `owner-app.js` 不載入 `mock.js` 或 Demo `app.js`；不使用 localStorage/sessionStorage；資料用 `textContent` / DOM 節點顯示，不以 `innerHTML` 拼接回應。CSP、同源 Cookie、CSRF 與登出撤銷程序保持原樣。

## 已載入清單分頁（2026-11-09，CI／正式 Codex Review 待驗）

- 原生清單仍受最多 500 筆的既有 D1 API 上限約束；僅在瀏覽器內把已授權、已載入資料分成每頁 25／50／100 筆，避免一次渲染所有資料。搜尋只覆蓋已載入的列，不提供跨頁後端搜尋。
- 搜尋或變更每頁筆數會回第 1 頁，上一頁／下一頁停在合法邊界，空搜尋結果顯示零筆並停用分頁。使用 DOM textContent、ARIA，且不引入假資料、儲存密碼、模擬授權或新套件。
- 不修改 Worker 路由、D1、權限、Cloudflare Variables/Secrets 或五項寫入 Gate。正式 Owner 真實瀏覽器、登入／登出及 Session UAT 仍需操作者獨立驗證。

## 原生表單欄位與標籤一致性（2026-11-09，待 CI／Codex）

- 叫貨、盤點、維修、工作、門市與食材的正式 D1 表單，原先將 label 與 input/select/textarea 當作**分開的 flex item** 放入 form，視覺上可能形成標籤與控制項錯排，亦未形成 label-control 關聯。共用 `labeledField()` 讓原生控制項實際嵌在可見 label 裡，鍵盤與輔助科技能對應欄位。
- 手機保留完整欄寬與可換行布局；無更改欄位值、表單提交參數、角色／門市授權、CSRF、API、Cloudflare Gate 或 D1。
- 測試要求所有五種表單使用嵌套標籤及禁用 Demo/localStorage/innerHTML；真正 390/1440 瀏覽器與登入 UAT 仍待操作者獨立確認。

## 交付與驗收界限

1. `npm run check`（Node >=22.13）、GitHub Hosted Verify、正式 Codex Review 和最新 HEAD 合併檢查須分別通過，才可考慮合併。
2. 於安全隔離的本機／預覽檢查 1440px 桌機側欄、390px 手機收合、鍵盤 Escape、錯誤訊息、空白 D1 清單與 Overview 卡片。這些 UI 靜態／合成檢查不等於真實瀏覽器 UAT。
3. 由操作者在受控窗口檢查 Cloudflare 正式 Asset 是否一致、Dashboard Variables/Secrets 與下一次 Wrangler 發版是否同步、登入/登出及重新 GET `/api/me` 的 401。不可讓本 PR 自行開啟 Login 或 Business Write Gates，不能變更 Production D1。
4. 本次任何 GitHub 合併可能觸發 Cloudflare 生產部署。若無法確認實際部署會保留 Dashboard 上的 Secrets/Vars，需保持 PR Pending，不以 CI 成功取代部署風險評估。
