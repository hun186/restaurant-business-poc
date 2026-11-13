# 正式 Worker Dashboard 登入開關持久化（受控上線）
 
> 本文件不授權任何 Production D1 寫入、密碼重設、Worker 暴露或強制部署。由可信任操作員在 Cloudflare Dashboard 管理正式運行變數；不在 GitHub 填入正式帳密或秘密。

## 問題根因與修正

先前 `wrangler.jsonc` 在 Production `vars` 把 `CLOUD_AUTH_PHASE` 寫死為 `disabled`，每次由 GitHub 更新 Worker 時，可能覆蓋 Cloudflare Dashboard 內短暫核准的 Native Gate，使 `GET /api/native/status` 回到 `{"mode":"demo","login_enabled":false,...}`。**在登入關閉時，所有 `*_write_enabled=false` 只能證明目前不可寫，不能證明每一個底層 `CLOUD_NATIVE_*_WRITE_GATE` 都被關閉。**

修正：Production `wrangler.jsonc` 新增頂層 `"keep_vars": true`，不再由程式庫部署檔直接設定 Production `CLOUD_AUTH_PHASE`。官方 Wrangler 說明：`keep_vars` 保留 Dashboard 已設定的環境變數。**不會自動開啟登入**；沒有 Gate 或 Secret 時，Native Login 和各寫入模組仍採 fail-closed。Preview 環境的 Staging D1 和 `preview-readonly` 設定保持原樣。不可將 Production 的兩個 Auth Gate 值直接寫進 GitHub 版控。

## 上線前：必須在受信任操作員的 Cloudflare Dashboard 確認

1. 開啟 Cloudflare Workers & Pages → `restaurant-business-poc` → **Deployments/Versions**，核對 Active Deployment 的 Worker Version ID／GitHub Build Commit 是已審查的最新 `main`，不是只確認 Build Success。變數修改會建立新版本；修改後再確認新 Active Version。
2. Settings → **Variables and Secrets**：確認 `DB` Binding 指向固定的正式 `restaurant-business-prod` D1；確認有既有 `NATIVE_AUTH_SOURCE_PEPPER` **Secret**（不能用普通文字變數替代、不能顯示或複製內容至聊天）。
3. **實際逐項查看**五個原始 Write Gate：`CLOUD_NATIVE_TASK_WRITE_GATE`、`CLOUD_NATIVE_CATALOG_WRITE_GATE`、`CLOUD_NATIVE_ORDER_WRITE_GATE`、`CLOUD_NATIVE_STOCKTAKE_WRITE_GATE`、`CLOUD_NATIVE_REPAIR_WRITE_GATE`。初次恢復登入時，這五項**全部必須不存在、disabled 或非 `operator-released`**。切勿僅根據 Status 的 `false` 判定已逐項關閉。
4. 完成資料庫最新加密營運備份並驗證副本、保留回退程序後，才能在有業主與操作員的維護窗口，設定 **Text** 變數 `CLOUD_AUTH_PHASE=native-production`、`CLOUD_NATIVE_LOGIN_GATE=operator-released`，其餘五種業務寫入維持關閉，依 Dashboard 指示 **Deploy** 這項設定。這不是 GitHub 新提交可以代勞的步驟，也不需要 Cloudflare Zero Trust/Access。
5. 重新取得同一正式網址 `/api/native/status`，必須為 `mode=native`、`login_enabled=true`，五個 `*_write_enabled=false`。若仍為 Demo，不要輸入密碼，請檢查 Active Worker 版本、兩項原始 Gate、Pepper Secret 及 DB Binding，勿跳過。
6. 執行 `run-native-owner-login-uat-preflight.bat`（只用匿名 GET、無密碼），期待 `NATIVE_OWNER_LOGIN_UAT_PREFLIGHT_PASS`。在可信任瀏覽器驗收 Owner 登入→`GET /api/me` 200→唯讀資料→安全登出→同一 Session `GET /api/me` 401，確認正式門市及食材資料保留。不要把 Cookie、Token、密碼貼到 GitHub、對話或截圖。
7. 要開放單一 CRUD，另外核准對應的 `CLOUD_NATIVE_*_WRITE_GATE=operator-released`，每次**只開一項**並核實操作後 D1／稽核一致，再考慮下一項；未驗收的維持關閉。正式資料備份與異機回復簽核不能被 CI/Code Review 取代。

## 安全與回復

- 若發現登入安全異常，操作員將 `CLOUD_NATIVE_LOGIN_GATE` 改回 `disabled` 並 **Deploy**，再於 Worker 端驗證 `mode=demo`。若需要進一步撤銷已發出的 Sessions，應由既有正式 Session 撤銷機制另行處理；**切換 Gate 不代表 D1 Session 已清除**。
- 若新程式部署後又顯示 `demo`，先核實當次 Build 的實際 Wrangler 版本／部署命令是否使用倉庫 `keep_vars` 設定，以及 Dashboard 的變數值；不要盲目 Merge 或重跑初始化。
- 本 PR 僅修正**以後部署保存 Dashboard 設定**，不會啟用正式登入、修改 Worker D1 或自行執行任一 Production 操作；部署版本、實際狀態及機上備份仍需單獨驗收。
