# Owner 員工停用／啟用 D1 Phase 1 — 安全上線交接

此增量以 [Issue #182](https://github.com/hun186/restaurant-business-poc/issues/182) 為準。Cloudflare D1 與本機 SQLite 均以 `user.active` 與 `users.active` 表達帳號停用，保留工作／叫貨／盤點及歷史稽核，不做資料表 DELETE。Vercel 展示資料只能模擬，不能觸及正式帳密。

## 結果
- 新 `POST /api/accounts/status`，獨立 `CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE=operator-released`；目前 Production 沒有此變數，因此**預設 503、不能停用/啟用**。現有 `CLOUD_NATIVE_ACCOUNT_WRITE_GATE` 僅允許建立新帳號，兩者互不代授權。
- 只允許有效 Owner Session、CSRF 與同源，且只能修改 staff/manager；拒絕自己與全部 Owner；要求 client 提供 expectedActive 防陳舊狀態覆蓋；輸出不洩漏密碼/Token。
- 一個 D1.batch 內完成 CAS 狀態變更、稽核和撤銷全部目標 Session，使用 NOT NULL SQL 哨兵阻止漏掉任何步驟後部分提交。
- 前端只有 `can_manage_status:true` 才顯示「停用／啟用」；動作確認、同源/CSRF、401 回登入與清空敏感資料，409 提示重新整理。
- 本 PR 沒有觸碰正式 D1、Owner、已建立 `Test`、Cloudflare Vars/Secret/Schema/備份，且不能在沒有最新 HEAD Hosted CI 及 Codex 審查和部署授權前 Merge。
- 此 PR 尚未提供變更角色／他人密碼重設／永久刪除，後者需獨立稽核/資料保留政策。