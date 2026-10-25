# Cloudflare 部署：靜態版 404 與安全啟動修正

## 現象

Cloudflare Workers Builds 顯示 `npx wrangler deploy` Success，且上傳 `public/` 靜態資源，但訪問 `/api/health` 出現 HTTP 404。這只證明原本部署沒有服務該 API；**不是 D1、登入或正式營運已完成的證據**。

## 本次 PR 的功能範圍

- 新增 `wrangler.jsonc` 明確指定 Workers 程式入口與 `/api/*` 優先路由。
- 新增 Cloudflare Worker：`GET /api/health` 回應 `status: demo_only`、`production_ready: false`；**HTTP 200 僅代表路由有效，並不是可正式營運的健康檢查**。
- 其他 `/api/*` 一律回 HTTP 503 `E_NOT_READY`，不處理真正的登入密碼、帳號、庫存或營運變更。
- Cloudflare 網站改用 `vercel-demo/` 虛構資料展示靜態檔案，不再把 `public/` 本機 SQLite 正式登入畫面當成可在雲端運作的頁面。
- 保留 Vercel Demo 與 Node.js SQLite 本機正式程式不變；這不是 D1 移植。

## 部署設定

既有 Cloudflare Builds：根目錄 `/`、Build command 留空、Deploy command `npx wrangler deploy`。合併之前請先通過 CI；本 PR 不自動合併。合併後需查看 Cloudflare Build 紀錄，確認 `cloudflare/worker.mjs` 和靜態資源實際完成部署。

檢查：

1. `https://restaurant-business-poc.hungyuan-chen.workers.dev/api/health` 應回 `{"status":"demo_only","api":"not_implemented","database":"not_configured","production_ready":false}`。
2. 首頁應明確寫出「公開示範版 · 全部為虛構資料」，而非本機 SQLite 正式登入頁。
3. `POST /api/login` 應回 503 `E_NOT_READY`，不接受真實密碼。
4. 正式 D1、資料遷移、業主身分驗證、營運 API、備份／還原與生產驗收仍須獨立完成。

**請勿將現有 Cloudflare 網址交付業主作為正式營運服務。** 正式版必須獨立完成安全審核，並避免 Preview 指向正式 D1。

## Cloudflare Workers Builds Preview 失敗修正（2026-10-25）

PR #12 的 Preview Build 曾因執行 `npx wrangler preview` 而失敗。Cloudflare 日誌明確指出 `Your Wrangler configuration is missing a previews block`。這與 GitHub CI 成功、Workers 正式版靜態資源已部署是不同的驗證層次。

已在 `wrangler.jsonc` 頂層加入 `"previews": {}`，這是 Cloudflare Workers Preview 所要求的必要區塊；`preview_urls: true` 並不能取代它。`assets`、`compatibility_date` 仍應保持頂層設定。新增測試在 CI 中防止此設定意外遺失。

- Cloudflare Workers Builds：正式分支執行 `npx wrangler deploy`；PR Preview 執行 `npx wrangler preview`。
- 此階段只有靜態虛構 Demo 及不接受寫入的 `/api/health`，**沒有任何正式 D1 綁定或秘密資訊**，因此可使用空的 `previews`。
- **日後導入 D1 時，不可直接沿用空 Preview 資料綁定**：應分別配置正式 D1 與獨立測試 D1，禁止 Preview 存取業主資料。
- 是否修復 Cloudflare Preview，必須看新 commit 對應的 Hosted Cloudflare Build 狀態／Preview URL；單靠 JSON 格式正確不能聲稱部署通過。

官方依據：https://developers.cloudflare.com/workers/previews/configuration/
