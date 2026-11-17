# Native D1：業主管理員工門市授權（Phase 3 Backend，2026-11-17）

## 為何需要

Native Owner 的員工帳號管理現已能建立、查看和篩選授權異常，但尚無正式 D1 修改既有員工門市範圍的獨立操作。此項增量先建立受控後端，不直接變更任何正式資料或放行介面。

## 安全契約

- 獨立 `POST /api/accounts/grant`，只接受完整 HTTPS same-origin + 有效 Owner Session + CSRF、schema v3、固定 JSON 欄位：`{action:'assign'|'unassign',targetUserId,locationId,expectedRole:'staff'|'manager',expectedAssigned:boolean}`。
- 只有目標 **active staff/manager** 能新增／移除單一門市授權；拒絕 Owner、自身、停用員工。使用 expectedAssigned 與 expectedRole CAS 避免覆寫同時異動。不可藉此更改角色、密碼或直接刪除員工。
- **兩個不同 Operator Gate 同時具備** 才能寫入：`CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE=operator-released` 且 `CLOUD_NATIVE_ACCOUNT_GRANT_WRITE_GATE=operator-released`；現行 Production 不設定後者，預設 503。現有建立帳號 Gate 或角色 Gate **不能**代替這項授權。
- 新增授權只能指向啟用中門市，每位帳號最多 16 筆；移除後至少保留一個啟用中門市授權，避免有效員工意外失去所有門市。可清除已停用門市的舊授權，但仍須保有其他啟用中門市。
- 同一個 `D1.batch()` 包含受限額／身分保護的審計 INSERT、單一門市授權 INSERT/DELETE、目標**全部 Session 撤銷**與強制 NOT NULL 回滾哨兵。Owner/Target/Store 狀態於交易內重新驗證；任何失敗，不可只改授權卻保留既有 Session。
- 成功返回最少欄位，失敗不輸出 password hash、Token、Cookie、CSRF、SQL/內部錯誤。Owner GET 帳號清單只在雙 Gate 有效時返回 `can_manage_grants:true`；UI 尚未因為程式存在就開放按鈕。

## 驗證、部署及審批

合成 SQLite D1 adapter + 真實 Worker HTTP 測試：Owner/其他角色、雙 Gate、Origin/CSRF、最後啟用門市、失效/錯誤角色、禁止同一授權重播、停用門市清除、每一步 D1 batch fault rollback、queued transaction 的 Session/Role/Target/Store 競態。更新保守 SHA256 清單。

**重要：這只是 Backend 程式與離線回歸，並非正式放行。** 本 PR 不變更 Cloudflare Production Variables/Secrets、正式 D1/Schema、門市、員工、Session 或實際帳號授權；沒有啟用任一 Grant Gate。最新 HEAD Hosted CI 5/5、正式 Codex Code Review completed/0 Findings/0 unresolved、clean mergeable 是程式合併必要條件。**實際開啟 Grant Gate、使用業主操作正式員工授權及 Live UAT，需另外核對 Production 備份、安全審查與操作者明確授權。** UI 操作應在另一個 PR 安全接線。