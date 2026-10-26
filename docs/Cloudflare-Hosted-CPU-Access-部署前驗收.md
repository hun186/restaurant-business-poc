# Hosted PBKDF2 探針：Cloudflare Access 部署前驗收關卡

> 狀態：**僅完成離線安全檢查程式與測試；尚未部署、沒有正式 Cloudflare Access 設定證據，也未測得 Hosted CPU。** 即使本文件的 GitHub CI 全部 PASS，也**不構成遠端部署授權**。不得以任何備援路由繞過此關卡。

## 本輪靜態安全檢查（可以在 PR/CI 執行）

指令：`node tools/cloudflare-hosted-probe-preflight.mjs`；工作流程 `.github/workflows/verify.yml` 在 Node 22/24 與 Ubuntu/Windows 執行。

靜態程式執行時**不使用 Cloudflare Token**，沒有網路呼叫、不連 D1、不讀 Owner/Session、沒有 Wrangler `deploy`、不讀取 Cloudflare Account 設定。它只檢查目前 checkout 的程式檔和 JSON 變數、GitHub Actions workflow。

- `wrangler.pbkdf2-hosted-disabled.jsonc`：只允許固定的 7 個安全鍵；專用 Worker 名稱與正式 Worker 不同；`workers_dev:false`、`preview_urls:false`、`PROBE_ENABLED=disabled`；無 routes、D1、assets、services、secrets、Triggers 等任何未知設定。
- `wrangler.jsonc`：正式 Worker 入口維持 `cloudflare/worker.mjs`，Production Login 仍 disabled、Preview 為 preview-readonly。
- 專用 Worker Source：預設 `PROBE_ENABLED` 與 `ctx.access`/AUD 守衛文字尚在；沒有重新出現 PBKDF2 `performance.now()`、`wall_ms`／`cpu_ms` 自行計時。
- GitHub Actions：沒有任何 Workflow 引用這支專用探針的 disabled config 或 Worker 名稱執行部署。
- `tests/cloudflare-hosted-probe-preflight.test.js` 以多個惡意配置及錯誤接線作負向測試：例如開放 workers.dev、Preview、D1、Routes、意外變數、新版本部署 Workflow、意外啟用登入，必須 fail-closed。

輸出固定包含：

```json
{
  "result": "HOSTED_PROBE_STATIC_PREFLIGHT_PASS",
  "live_cloudflare_access_verified": false,
  "version_and_deployment_url_exposure_verified": false,
  "remote_cpu_verified": false,
  "deployment_authorized": false,
  "next": "MANUAL_ACCESS_EVIDENCE_REQUIRED"
}
```

上列布林值是**不能通過靜態檢查的關卡**。即使靜態檢查 PASS，仍保留為 false，不能藉由人工修改本地 JSON 當作正式安全放行證據。這個工具不能證明 GitHub 主線之外的 Cloudflare 遠端 Worker 目前是否已有其他設定。

## Cloudflare 實站驗收（目前全部待驗，未被本 PR 執行）

依據 [Cloudflare Workers Access 官方文件](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)（2026-10-12 更新），Worker-level Access 需選**Production and preview / All traffic**，API `destinations.type=worker`、`worker_id` 對應**正確的獨立 Probe Worker**；`preview_worker` **只**保護 Preview，不符合本工項。需由具授權的 Cloudflare 管理員依下表留存**私人**截圖／查核紀錄：

| 關卡 | 必須查核的遠端事實 | 不符合時 |
|---|---|---|
| A | 目前 Cloudflare 帳戶/Zone 正確；probe Worker ID、名稱、預定綁定入口無誤，不能誤指向正式 `restaurant-business-poc` | 停止 |
| B | 該獨立 Worker 的 Access Policy Scope 明確為 **All traffic**，不是 Preview only；Access Destination 指向正確 Worker ID | 停止 |
| C | Access Policy 僅明確核准受信任測試管理員或專用 Service Token；**沒有 Bypass / Everyone / 過寬條件** | 停止 |
| D | 檢查每個**可能的** hostname/path 規則、Custom Domain、`workers.dev`、Version URL、Preview URL、Deployment URL，確認無更高優先序的較寬鬆 Access 規則；不得只因 `workers_dev:false` 假定全面隱藏 | 停止 |
| E | 由管理員確認 `PROBE_ENABLED=disabled`，無 route、Custom Domain、Preview exposure，且無既存遠端版本或 URL 帶來未檢核的暴露 | 停止 |
| F | 人工查核保存的證據只留在非公開的受控環境；不把 AUD、Cookie、Access Token、真實帳密、截圖的敏感資訊放在 Public Repo、PR、CI logs | 停止 |
| G | 先取得**另外明確授權**，才能執行「部署 disabled、不可路由的獨立探針」；第二次啟用 Route + `access-only` 也要另開 PR／安全複審及授權 | 停止 |

特別注意：Cloudflare 官方明確表示 hostname/path Access 優先於 Worker-level，其次才是帳戶層級；Worker 級 Access 的設定如果選擇 Bypass 也可能放寬全帳戶級保護。參考 [Access hierarchy](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#understand-access-hierarchy)。

而 [workers.dev 官方文件](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) 說明關閉 workers.dev **不表示所有 Version、Preview、Deployment URL 都被關閉**。`preview_urls:false` 仍須在 Cloudflare 實站確認已生效，不能用一個 JSON 檔推論遠端所有網址都不可存取。

## 後續三個獨立階段（均不得自動執行）

1. **目前**：只維護/審核靜態安全驗證 PR，Ubuntu/Windows CI 與 Codex Review；不得對 Cloudflare API 執行任何修改或讀取 Secrets。
2. **另行許可**：以**專用**配置在正確 Cloudflare 帳戶建立 dormant Worker；預設不可路由、disabled。建立後才能取得精確 Worker ID，再設定/驗收 Worker-level Access，確認沒有任何外部暴露後才可進入下一階段。若遠端已存在相同 Worker，必須先辨識和確認其配置，不能覆寫。
3. **再授權**：另開啟用 PR，走 Code Review、Hosted CI、遠端 Access 事實證據、顯式允許測試入口與人工小批量測；從 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) 取得真正 invocation CPU/Wall/Outcome/error。**不得用 Worker 自訂回應的計時推論 CPU quota。**

**Cloudflare Preview Build 成功只代表原專案 Preview 工作流程成功，不代表新的 Hosted 探針已部署或 Access 已通過。**

## 2026-10-26｜Codex 初審兩項 P2 修正

- **P2-1，安全守衛內容指紋**：原先僅用正規表示式搜尋 \`PROBE_ENABLED\` 和 \`ctx.access\` 字串，無法辨識 \`if(false && ...)\` 的守衛停用。現在新增 \`tools/cloudflare-hosted-probe-approved-sha256.mjs\`，將兩支已審核的 Hosted Worker Source **原始位元組 SHA-256** 固定在白名單；任何 guard 程式改動會直接失敗。測試重現將 disabled 與 Audience 判斷包在 \`false &&\` 的繞過案例。
- **P2-2，委派腳本與 Actions**：封閉五個既有 Workflow 名單與 SHA-256；所有已審核的 \`tools/\` 本機執行檔及 \`package.json\` 也固定 SHA-256。新增／修改 Workflow、委派腳本（例如 \`run: bash tools/deploy-probe.sh\`）、新增本機 Composite Actions、隱藏部署在既有腳本中，都不會只因 YAML 未直接提到專用 config 而被放行。新增惡意委派腳本、改寫既有工具、增加本機 Action 的負向 fixture。
- **使用限制**：這是**封閉版本**白名單。今後正常修改 Worker、Workflow、工具或 \`package.json\` 前，需人工複審差異後才更新批准雜湊。**不得自動掃描檔案再自動更新白名單**。Preflight CLI 本身與雜湊白名單仍需 Code Review，不是不可篡改的簽章，不能取代 branch protection。
- 靜態輸出維持 \`live_cloudflare_access_verified:false\`、\`version_and_deployment_url_exposure_verified:false\`、\`remote_cpu_verified:false\`、\`deployment_authorized:false\`。CI PASS **不能**證明 Cloudflare 遠端實際受 Access 保護，也不是部署授權。

### Windows／Linux 一致性（SHA-256）

第一次新增白名單後，Windows Git checkout 可能將換行 LF 改成 CRLF，使逐位元組 SHA-256 在 Ubuntu 通過、Windows 誤判。已修改檢查器**只**將 CRLF 轉成 LF 後再算 SHA-256，不會移除空格、程式碼或註解，也不會執行檔案。負向測試覆蓋 Windows 換行變體仍 PASS、但任何 `if(false && ...)` 安全守衛繞過仍 FAIL。SHA-256 白名單所列值以 Git repository 的 LF 文字為準。白名單本身與檢查器均需正式 Code Review。

## 2026-10-26｜第二輪 Codex P2：傳遞相依模組與測試入口完整覆蓋

正式 Codex 複審 HEAD `1457286bee211c574e2605ae8bdc9c1622792685` 指出：雖已鎖定工具入口、五個 Workflow 與 `package.json`，但 `tools/cloudflare-staging-owner.mjs` 間接載入的 `cloudflare/auth-core.mjs` 尚未釘選；在有 Cloudflare credentials 的 Workflow 步驟中，若僅篡改該檔仍可能通過 Preflight。此外 `npm run check` 的 `tests/*.test.js` 原未全數列入完整性檢查。

修正方案採用人工審核之**執行相依的封閉超集合**，而非只依賴程式碼字串：
- `tools/cloudflare-hosted-probe-approved-sha256.mjs` 新增 `APPROVED_TRANSITIVE_DEPENDENCIES_SHA256`，納入所有 `cloudflare/`（含 `auth-core.mjs`、D1、migrations）、`src/`、`db/`、`public/`、`tests/`、`vercel-demo/` 目前檔案與根目錄 JS、Wrangler JSONC、Windows BAT。原兩支 Hosted Worker Source 仍由既有 `APPROVED_PROBE_SHA256` 保護；Workflow、`tools/` 及 `package.json` 繼續使用既有指紋白名單。
- 以上六個資料夾實施**遞迴封閉檔案清單**：新增或刪除任何子檔案、將檔案替換成 symlink、改寫任一已審核模組/SQL/測試入口，必須直接拒絕。根目錄執行或部署設定檔也維持封閉清單。
- 負向測試只修改 `cloudflare/auth-core.mjs`、`cloudflare/d1-readiness.mjs`、`src/security.js`、`tests/core.test.js`、其他測試檔與業務原始碼；並分別插入新 Cloudflare helper、新測試檔、新根目錄可執行檔，確保即使所有 Workflow／工具入口 SHA 完全不變，仍 fail-closed。
- Windows Git checkout 使用 CRLF 時僅將換行正規化為 LF 再計算 SHA-256，其餘程式文字不放寬。SHA 白名單不是自動產生通行證：後續任何合法改動都須人工比對差異、審核後手動更新，並重新跑 CI 與正式 Codex Review。

此檢查只證明所審核 checkout 的程式/設定完整性，**不是** Cloudflare 遠端 Access、Worker Version URLs、D1 或 Hosted CPU 實站驗收證據。絕不自動部署或給予遠端修改授權。
