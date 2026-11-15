# P0 Owner 新增員工／主管帳號 — 安全上線交接

狀態：**僅內部合成交易已實作，正式 Worker API 與畫面仍未接入。** 不要誤稱已上線，不可透過修改 Cloudflare Gate 直接釋出本功能。

## 這個增量完成的部分
- 沿用既有 D1 v3 users / user_locations / sessions / audit_logs，不重建 Owner、不執行正式資料遷移。
- 只有有效 Owner Session＋CSRF 可發起建立，允許 staff/manager；新 Owner 身分建立另需單獨授權。
- 驗證使用者名稱、顯示名稱、密碼、最多 16 個不重複且啟用的門市。
- PBKDF2 雜湊，不把密碼或雜湊放入 API 結果與稽核。
- 原子 D1.batch 包含使用者、門市授權、audit；Owner 在 batch 前降權、Session 撤銷、門市停用、帳號重名及中途 SQL 失敗，整筆交易回滾，不能留下半個帳號。
- 保留原本公開 Worker 完全不 import account-access-internal.mjs 的強制隔離測試；此增量未新增正式路由或 Cloudflare 設定。

## 正式開放仍需完成
- 設計獨立、受控 Owner API 的登入、CSRF/Origin、請求解碼上限、來源頻率限制；不可直接把 synthetic gate 改成 native-production。
- 對正式帳號管理頁面加入清單、新增、停用、角色、門市、重設密碼，安全處理首登密碼與不當帳號列舉。
- 對真實 D1 執行明確授權的備份、Review、Gated UAT、完整交易／Session 撤銷測試，確認 Active Version。
- 對公開入口或部署/Settings 的任何修改都是另一項 Production 風險 Gate，不能以此次 CI PASS 取代。