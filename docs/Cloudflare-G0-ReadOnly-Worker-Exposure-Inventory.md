# P0 G0 — Cloudflare Worker 公開暴露面唯讀盤點

## 目的
本 PR 只新增程式與合成測試；尚未連接真實 Cloudflare。即使 Hosted CI / Codex Review 通過，也不能宣告 G0 已實地驗收、部署成功或業主可正式登入。

## 手動觸發
PR 取得 Code Review / CI 通過且經明確 Merge 後，建立受保護的 GitHub Environment `cloudflare-g0-readonly`，要求人工核准並將 `CLOUDFLARE_ACCOUNT_ID` 與單獨申請的 `CLOUDFLARE_G0_READONLY_TOKEN` 設為 Environment Secrets。Token 僅提供指定 Cloudflare 帳戶的 Workers Scripts/Metadata Read、Worker Routes Read、Zone Zone Read 等必要唯讀權限，**不可提供部署、D1 管理或 Workers 修改權限**。
GitHub Actions > Cloudflare G0 Worker exposure inventory (manual read-only) > main > 輸入 `CHECK_G0_READONLY`。不是 PR/push/schedule 觸發。封閉 SHA-256 preflight 先執行；只有查詢步驟拿到專用 Token。Node.js 呼叫固定 `https://api.cloudflare.com/client/v4`，只用 GET、拒絕 redirect、有逾時與回應大小限制。

## Cloudflare API 完整性
查詢 Workers Scripts 清單、Workers Domains、逐 Worker subdomain (workers.dev 與 Preview URLs)、該帳戶所有可見 Zones 的 Worker Routes，並檢查分頁結構。不允許 API 失敗、403、缺漏分頁或指向錯誤 Worker 被當成沒有暴露入口。Zone 讀取權限若不足或帳戶有未列入管理的自訂網域，仍需獨立人工盤點。
輸出只有總筆數和布林旗標，不輸出實際 Domain、URL、Route pattern、Token、帳戶/Zone ID 或 API Error Response；不建立外部 artifact，也不修改 Cloudflare。

## 安全界線
結果碼永久為 `G0_REMOTE_INVENTORY_ONLY_HUMAN_REVIEW_REQUIRED`，`g0_certified=false`、`access_policy_verified=false`、`deployment_and_version_url_probes_verified=false`、`release_authorized=false`。若已存在 workers.dev/Preview/Custom Domain/Route，代表還需獨立核對該入口的 Access、防繞過和實際回應；未找到暴露也不能自動授權上線。
目前 wrangler.jsonc 配置的 Production Worker 仍採 Demo，CLOUD_AUTH_PHASE=disabled；此驗收不嘗試關閉路由、不修改帳號、也不打開任何正式登入或業務寫入。

## 官方參考
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/
- https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/
- https://developers.cloudflare.com/api/resources/zones/methods/list/
