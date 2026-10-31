# Cloudflare Staging Access 啟用交接：0003 已在遠端實證完成

> P0 #34，2026-10-31。這是 **Staging 操作員 runbook**，不是執行授權、Automation 或 Production 放行。

## 0. Hosted 已驗證的真實進度

- GitHub main `0eab4ddf8968f7565342b7d08cdc6c3952c519bb`，PR #79 Squash Merged；合併後 Verify #41196915018 完成、五項測試成功。
- 手動 GitHub Actions [#41198456616](https://github.com/hun186/restaurant-business-poc/actions/runs/41198456616) 在 **實際遠端** `STAGING_DB`（UUID `2c355bed-d9c3-449c-aa9b-1018f3bc1177`）執行 `0003_access_identity_links.sql`，Wrangler 顯示 ✅；Preflight 與 Postflight 均成功，終止訊息 `STAGING_0003_SCHEMA_ONLY_APPLIED_AND_VERIFIED`。
- **已完成：** Staging 0003 加法 Schema Migration + 遷移後內容比對。
- **尚無證據／未授權：** Cloudflare Access 的 Previews-only Policy、簽章身分的 Owner D1 綁定、Preview Identity Gate、實站登入/資料查詢 E2E、Staging 交易寫入 Gate、Production 部署與業主 UAT。
- 早期 `.codex` 和其他文件中的 `0003 尚未套用` 是歷史交接快照；以此處實際 Actions 執行紀錄為準。

## 1. 清除一次性 Migration 權限（人工作業）

在 GitHub Settings → Environments → `d1-staging-0003-write`：

1. 刪除或關閉 Environment Variable `STAGING_0003_SCHEMA_APPLY_APPROVED`，避免重複套用 0003。
2. 如先前使用短期專用 Cloudflare D1 Write Token，請在 Cloudflare 控制台撤銷；不要把 Token、私密 SQL、JWT、Cookie、使用者識別碼貼到 GitHub、Actions logs、聊天或 Public PR。
3. 保留固定 Staging UUID 的版本化遷移 SQL 和完成的 Actions 證據；**不要再執行 0003 apply**，也不要嘗試清空或重建 D1。

## 2. 保護 Cloudflare Worker 的所有真正 Preview 入口（人工作業）

依 Cloudflare [官方 Worker Access 指南](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)：

1. 登入 Cloudflare 帳戶並確認已啟用 Zero Trust；在 **Workers & Pages** 選擇 Worker `restaurant-business-poc`，點 **Access**。
2. 選 **Protect this Worker behind Access**，Traffic Scope 必須選 **Previews only**，**不可選 All traffic**（Production 仍未開放）。
3. Authentication policy 採只允許核准的**測試操作員特定身分**（例如單一測試 email）的 Allow 規則，不能採 Everyone、全網域開放或 Bypass。套用前確認不會影響其他 Worker 或 Production。
4. 套用後，用 **未登入／無 Cookie 的無痕瀏覽器** 開啟當前 branch Preview URL，應被 Access 擋下（登入或拒絕），不可匿名直接載入受保護測試頁。再用唯一核准的測試身分登入，確認 Access 可以辨識使用者。
5. 確認涵蓋 **所有 branch Preview URLs 與單次 Deployment URLs**。勿將 Version URL 誤當作獨立 Staging Preview；Cloudflare [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) 可能採用既有部署資源設定，而 [Worker Previews](https://developers.cloudflare.com/workers/previews/) 使用 `previews` 配置。
6. UI 切換若不符合以上條件，先停在 Policy 設定，不進入 D1 身分綁定。

安全界線：`wrangler.jsonc` 的 `previews.d1_databases` 指向 Staging D1、`previews.vars.CLOUD_AUTH_PHASE=preview-readonly`，但預設 **沒有** `CLOUD_ACCESS_IDENTITY_GATE`；Production `CLOUD_AUTH_PHASE=disabled` 不得修改。

## 3. 私下取得正確的 Access 身分材料（人工作業）

- 在 Cloudflare Zero Trust → **Access controls → Applications** 找到剛建立的 Preview 專用 Access 應用，於 **Configure → Additional settings** 查看 **Application Audience (AUD) Tag**，應是 64 字元 16 進位字串。參考 [官方 JWT 驗簽指引](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。
- **Issuer** 必須是實際 team 網域，格式 `https://<team>.cloudflareaccess.com`，不是 Worker URL、GitHub Repo 或自訂 Redirect。
- **Subject** 必須是由已驗證、屬於此 AUD 的 Cloudflare Access **簽章 JWT 的 `sub`**。不能直接用 email、`username`、猜測的 UUID 或未驗簽的任意 Request 值取代。取得 JWT／Subject 的過程應在本人受控環境完成，不得向公開服務或 Issue 洩露完整 Token。
- 管理員需自行核對 Access Policy、整個 Preview 覆蓋範圍及對應測試操作員。此 repo 沒有 Cloudflare Dashboard Settings 讀取權；只有人在 Dashboard 的實證才能確認上述事實。

## 4. 獨立手動核准 Owner 綁定（僅 Staging、會寫入 D1）

**前提**：完整 Step 2／Step 3；獨立確認測試 Owner、復原依據與 D1 只有預期的測試紀錄。若要執行任何實際遠端寫入，需有權限管理員另行明確授權。

在 GitHub Settings → Environments 建立 `d1-staging-access-enroll-write`，限制 `main`；單人帳號無可用獨立 Reviewer 時，不要設定無法滿足的雙人 Reviewer 規則。環境設：

**Environment secrets（不要貼到公開 repo）：**
- `CLOUDFLARE_API_TOKEN`：新的、短效、獨立於 Production 的 Cloudflare D1 Write Token。
- `CLOUDFLARE_ACCOUNT_ID`：經 Dashboard 私下核實的同一帳戶。
- `STAGING_ACCESS_ISSUER`：核實的 `https://<team>.cloudflareaccess.com`。
- `STAGING_ACCESS_AUDIENCE`：Access app 的 64 字元 AUD。
- `STAGING_ACCESS_OWNER_SUBJECT`：核實的 JWT `sub`，非 email。

**Environment variable（僅在決定執行當次啟用）：**

```text
STAGING_ACCESS_OWNER_ENROLL_APPROVED=ALLOW_STAGING_TEST_OWNER_LINK_ONLY
```

另外先手動執行已合併的 **Staging Access 0003 D1 read-only status (manual)**，確認新結果是 `STAGING_0003_READONLY_ALREADY_APPLIED`，不再是 `READY`；如不符就停止。

再於 [GitHub Actions：Staging Access synthetic owner link](https://github.com/hun186/restaurant-business-poc/actions/workflows/d1-staging-access-owner-enroll.yml) 以 `main` 發起一次 `workflow_dispatch`：

```text
action: ENROLL_STAGING_ACCESS_OWNER_ONCE
confirm: ENROLL_STAGING_ACCESS_OWNER_ONCE
reviewed_head_sha: <dispatch 時 main 的完整最新 40 字元 SHA>
```

程式僅接受固定 Staging UUID、單一測試 Owner、0001/0002/0003 完整 Ledger、22 表原始空白狀態。先建立 `active=0` 連結、匿名化操作稽核，再有條件啟用；成功訊息應是 `STAGING_TEST_OWNER_LINK_VERIFIED`。任何失敗 **不可重跑或清庫**，先離線／私下查明部分寫入結果。執行後再次移除核准 Variable 並撤銷短期寫入 Token。

**以上只綁定身分，不會自動建立 Access Policy 或開啟 Worker Gate，更不代表正式登入已可用。**

## 5. 下一個單獨經審查的程式變更：受保護 Preview GET 驗收

只有經操作員確認 Step 2 與 Step 4 成功後，才另開小型 PR，僅於 `wrangler.jsonc` 的 **`previews.vars`** 設定：

```text
CLOUD_ACCESS_IDENTITY_GATE=staging-get-only
CLOUD_ACCESS_ISSUER=https://<approved-team>.cloudflareaccess.com
CLOUD_ACCESS_AUDIENCE=<approved-64-hex-audience>
```

**不**在 Production `vars` 設定這些值，**不**設定 `CLOUD_ACCESS_TASK_WRITE_GATE`，也不改 Production DB。先驗證部署的真正 Preview 已套用這些配置、所有入口均受 Access 限制（包括變更後重新部署）；在核准身分以瀏覽器使用 `/staging-access-preview.html` 測試 `GET /api/access/me`、`/api/access/overview` 和 `/api/access/data`。必須驗證匿名、無效 JWT、跨店、停用使用者／連結撤權均拒絕。

只有 GET E2E 通過後，才評估建立受控測試資料及獨立啟用 `CLOUD_ACCESS_TASK_WRITE_GATE` 的小型 PR／真正 D1 寫入驗證。**任何 Production 變更都需另行安全 Gate 和使用者授權**。
