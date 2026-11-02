# D1 原生帳號管理：公開 Worker 隔離與發布安全契約

> 狀態：**內部合成測試完成基礎；正式帳號管理 API 未實作、未授權上線。** 本文件不是正式部署核准。

## 現行安全基線

- 公開 Worker 的 Entry Point 是 `cloudflare/worker.mjs`；前端仍是 Demo，Production `CLOUD_AUTH_PHASE=disabled`。
- `wrangler.jsonc` 設定 `workers_dev=true`、`preview_urls=false`；`previews.vars.CLOUD_AUTH_PHASE=preview-readonly`，Production 與 Preview 都**沒有** `ACCOUNT_SECURITY_STAGE`。
- `cloudflare/account-security-internal.mjs` 與 `cloudflare/account-access-internal.mjs` 為合成測試專用函式；不允許從公開 Worker 的直接或間接相依路徑匯入。兩個模組的雙重 Gate **不是**可直接用於正式營運的授權模型。
- 使用者明確選擇**不使用 Cloudflare Zero Trust／Access，也不綁信用卡**。因此未來上線需自行設計與驗證應用層登入、Session、權限、稽核、暴露面及事故復原，而不能繞過安全驗收。
- 真正 Production D1 的 Owner Enrollment、帳號登入、資料寫入、遷移和 Restore 目前均沒有本文件的授權。

## 建議的操作契約（未實作的設計條件）

| Action | 所需角色 | 輸入 | 不可變條件與稽核 |
| --- | --- | --- | --- |
| `user.password` | Owner | targetUserId、新密碼 | 重新驗證有效 Session／CSRF；PBKDF2 輪替後撤銷目標全部 Session；稽核只記變更事實和撤銷筆數 |
| `user.role` | Owner | targetUserId、role | 不可自行降權、不可移除最後一名有效 Owner；交易內重新驗證角色與 Session；撤銷目標全部 Session |
| `user.active` | Owner | targetUserId、active | 不可自行停用、不可停用最後一名有效 Owner；停用及再啟用都不得恢復舊 Session |
| `user.assign-location`／`user.unassign-location` | Owner | targetUserId、locationId | 有效門市、目標帳號與關聯關係；真正變更才撤銷 Session，重複請求不得重複稽核或登出 |

上述名稱是內部 Domain Action，不是任何已存在的公開 HTTP Path。設計正式管理 API 前，需另行確定請求／回應 Schema、負載大小限制、登入來源驗證、授權邊界、錯誤碼、交易一致性、帳號管理權限與回復方案。

## 必須通過的發布 Gate

1. **靜態相依隔離**：`tests/cloudflare-native-account-release-isolation.test.js` 遞迴掃描公開 Worker 的 ESM 相依路徑；禁止把 dormant 管理模組匯入、動態匯入或重新輸出。掃描不支援的匯入型態必須 Fail Closed，不能靜默略過。
2. **公開路由拒絕**：生產與 Preview 配置皆不得設定 `ACCOUNT_SECURITY_STAGE`；既有登入停用狀態保持；即使人工注入合成 Gate，公開 Worker 對未公告的帳號管理路徑也必須回 `503 E_NOT_READY`，不查詢也不寫入 D1。
3. **合成資料安全**：帳號變更必須再次檢查 Owner Session／角色／CSRF／到期時間、目標原狀態，透過 D1 原子交易保證稽核、狀態變更與 Session 撤銷不會半途成功。嚴禁 Audit 含密碼、Token、Cookie 或可回復祕密。
4. **正式上線另行核准**：建立對外 API 需新的 Threat Model、正式身份驗證與授權矩陣、來源與頻率限制、回應保密檢查、D1 遷移／備份與復原準備，以及獨立明確的 Production 寫入／部署授權。不可由通過上述單元測試直接放行。
5. **驗收證據分離**：Hosted CI、正式 Codex Review、GitHub Merge、Cloudflare Build、Cloudflare Active Deployment、公開 HTTP、實際 D1 權限交易各自需要符合其範圍的獨立證據，不得混稱已通過。

本文件是未來對外介接前的最小契約，不取代正式安全設計或營運簽核。
