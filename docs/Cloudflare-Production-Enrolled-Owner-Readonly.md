# 正式 D1 已建立 Owner 的獨立唯讀驗證（保留登入歷史）

## 驗證目的與來源

2026-11-10 操作者實機 [Production auth activity read-only #42766673038](https://github.com/hun186/restaurant-business-poc/actions/runs/42766673038) 確認 `users_present=true`、`owner_candidate_present=true`、`owner_bootstrap_audit_present=true`、`sessions_present=false`、`login_attempts_present=true`，且登入嘗試有成功及失敗標記。此結果不能證明 Owner **只有一人**、密碼可正常登入、完整稽核一致或目前可正式營運。原 `Production D1 Owner readiness` 不通過的理由是它要求首次建立時的零登入紀錄，這不適用於已存在的 Owner 和正常保留的稽核歷史。

**不修改** `tools/cloudflare-production-owner.mjs`、`tools/cloudflare-prod-owner-readonly.mjs`、`tools/cloudflare-prod-owner-operator.mjs`、首次 Owner 建立、原 `Production D1 Owner readiness` Workflow、受控寫入/Release Gate。首次建立依然要求全部 20 業務和認證表為空；驗證成功也**不授權再次建立 Owner**。

## 新的人工唯讀檢查

GitHub Actions `Production already-enrolled Owner structural verification (manual read-only)`，檔案 `.github/workflows/d1-production-enrolled-owner-readonly.yml`；只能由操作者在 **main** 手動執行，輸入 `CHECK_ENROLLED_OWNER_READONLY`。使用既有受保護 `d1-production-readonly` Environment 和 D1 Read Token，固定 Production D1 設定、封閉的 SHA256 可執行檔指紋、既有 Wrangler 鎖定版本與 D1 初始化互斥鎖。

工具 `tools/cloudflare-prod-enrolled-owner-readonly.mjs` 只執行四組 SELECT/PRAGMA：前後兩個審核快照、`PRAGMA quick_check`、`PRAGMA foreign_key_check`。不查原始登入身分、IP、Cookie、Session Hash、密碼或資料明細；查詢原始 JSON 僅存在 runner 私有暫存目錄並在任務結束後刪除；日誌僅顯示核定狀態和布林性質，不顯示實際登入次數、Owner ID 或帳號資料。

`PRODUCTION_ENROLLED_OWNER_READONLY_PASS` 的**所有**要求：

- Schema 契約 v3、恰好 2 筆指定 migrations、`quick_check=ok` 且無 FK 異常
- 用戶表**恰好一筆**、且該筆必須是 active 的 Owner，固定 100k PBKDF2 hash/salt 格式
- 必須恰好一筆與該 Owner ID 及 hash 版本匹配的 `auth.owner_bootstrap` 稽核
- 允許保留正常的 `login_attempts`（成功或失敗標記皆可），但 `sessions` 仍必須為零
- 除初始化稽核外的其他 Audit 只允許程式碼認得的 `auth.login_failed`、`auth.login`、`auth.logout` 事件，必要的 actor 關聯、類型與非敏感欄位形狀必須正確；意外業務或未知稽核拒絕
- 尚未開放業務前的其他表全部必須為空，前後快照的使用者、Session、Login Attempt 和 Audit 筆數必須一致

任何異常都 Fail Closed，只回報固定錯誤階段，不會重建、清除、修改資料或自行修復。上述限制只適合目前**業務寫入 Gate 尚未開放**的 Pre-release 驗證，不是未來已上線後可含正式業務資料的營運健康檢查。

## 不得推論或逕行操作

本檢查只證明資料庫結構契約與當刻保存的 Owner 初始稽核一致；**不等於本人知道 Owner 密碼、真實公網登入成功、Account Access/Cloudflare Worker Gate 可用、有效 Session 安全機制通過、正式備份恢復簽核或可營運上線**。不能藉這次證據開啟 `CLOUD_AUTH_PHASE`、`CLOUD_NATIVE_LOGIN_GATE` 或五個業務寫入 Gate，也不能重跑首次 Owner 建立程序。實機驗證後先判讀是否符合條件，再另立受控版本與登入測試清單。無任何 Production D1 寫入操作。
