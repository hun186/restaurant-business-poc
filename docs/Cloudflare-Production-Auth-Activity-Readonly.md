# Production D1 驗證活動唯讀診斷（獨立手動 Action）

## 為什麼需要

操作者 2026-11-10 執行真正的 Production D1 Owner Readiness [#42749747912](https://github.com/hun186/restaurant-business-poc/actions/runs/42749747912)，回傳：

```text
E_PRODUCTION_OWNER_READONLY stage=OWNER_STATE reason=AUTH_ACTIVITY_PRESENT
```

既有程式先驗證 Schema v3、2 個 Migration、Integrity/FK 與 D1 結果格式，再發現 `sessions` **或** `login_attempts` 至少一張表不是空的。這不能推論有 Owner、登入成功、被入侵或資料庫損壞，也不能推論何時產生這些紀錄。原本的 Readiness 工具是嚴格「空庫／恰好一位 Owner 有完整 bootstrap audit」檢查，**不能以重跑同一 Action 代替診斷**。

## 專用的最小權限步驟

新 GitHub 手動 Workflow：`.github/workflows/d1-production-auth-activity-readonly.yml`。只能從 `main` 選 **Run workflow**，輸入完整確認詞 `CHECK_PROD_AUTH_ACTIVITY_READONLY`，使用原有 protected Environment `d1-production-readonly` 的 D1 Read Token。程式先通過 Reviewed SHA256、固定 Production D1 Target、受控 Wrangler 安裝；對固定 `PROD_DB` 發出**一筆唯讀 SELECT（Cloudflare API transport 可能是 POST，但 SQL 絕無修改）**。遠端原始 JSON 存在 runner 0700 私有暫存區，使用 trap 完成後刪除；工具只印固定 boolean 值，不輸出筆數、原始資料或身分。

結果 `PROD_AUTH_ACTIVITY_READONLY_PASS` 僅表示安全彙總完成，包含：

- `sessions_present`：是否有 Session 紀錄
- `unexpired_active_user_session_present`：是否有關聯啟用使用者且時間未到期的 Session（**不代表目前可以登入、也不證明 Cookie 有效**）
- `expired_sessions_present`、`invalid_session_expiry_present`：過期／到期欄位異常
- `login_attempts_present`、`recent_login_attempts_present`（最近 7 日）、`successful_login_attempts_present`、`failed_login_attempts_present`：嘗試紀錄的布林存在性；成功標記並非成功建立 Session 的獨立證明
- `users_present`、`owner_candidate_present`、`owner_bootstrap_audit_present`：僅供交叉比對的結構性布林值，不能代替 Owner Readiness 驗證

Schema/Migration 不符合、結果格式異常、相依狀態自相矛盾或沒有原始證據，立即非零退出且**不放行任何寫入**。僅使用固定的 `E_PROD_AUTH_ACTIVITY_READONLY stage=...`，不回應實際資料庫內容、個資、帳號、IP Hash、Cookie、Token、密碼、SQL 結果或原始例外。

## 安全邊界及之後處理

此 Action 不建立、刪除、更新 Session/Owner/Attempt/稽核，不執行 Migration、Restore 或 Export，也不啟用 `CLOUD_AUTH_PHASE`、Login Gate 或五個寫入 Gate。若看到歷史 Attempt 或過期 Session，應先判斷資料來源與保存需求；**不得直接清空紀錄或假設刪除沒有影響**。若有尚未過期的 Session，仍須受控確認後端 Gate/使用者授權、Session 撤銷策略及備份／復原程序；正式登入不能因此自動開啟。任何 Owner 首次建立、變更 Production D1 或營運開放必須另行明確核准。

此工具是前一嚴格 Readiness 失敗後的**調查**，不是把驗收標準放寬成成功，也不是正式上線憑證。
