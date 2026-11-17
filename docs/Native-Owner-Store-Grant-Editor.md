# Native Owner：員工門市授權單筆調整 UI（2026-11-17）

## 介面與安全界線

在既有 Owner 帳號管理頁中，只有後端 `GET /api/accounts` 明確回傳 `can_manage_grants:true`、目標帳號為**啟用中的 staff／manager** 時，才出現「調整門市」按鈕。只有業主登入可以進入此頁；新增、停用、角色調整以及門市授權各有獨立權限，絕不以前端字串替代 Worker RBAC。

業主選擇一位員工、一間已載入門市，**一次只新增或移除一項授權**；已停用的舊門市授權允許選取後移除，但不能再新增授權。確認對話清楚告知員工**所有登入工作階段會撤銷**，歷史紀錄保留；這不是帳號永久刪除。

表單送往 `POST /api/accounts/grant` 的固定欄位：
`action,expectedAssigned,expectedRole,locationId,targetUserId`，使用已驗證的目前 Session CSRF 和相同 Origin。成功必須驗證回傳 `code:OK`、目標帳號、門市與最新授權狀態才重新讀取正式 D1。401 回登入，409 提示授權已異動／最後有效門市／門市停用，需要刷新核對；不自動重送、不允許舊 Session 或舊畫面進行寫入。

若 `can_manage_grants` 缺失／false，按鈕和表單不會呈現；不因本 PR 合併就開啟正式後端。Owner 工作台帳號管理權限提示也從後端同一個 capability 更新，登出、登入或切頁時清除，避免錯顯示「僅檢視」或舊權限。

## 依賴與發布

- 此 UI 增量以 #202 帳號頁內搜尋為基底；後端需另外通過 #203（預設關閉的雙 Gate `CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE` + `CLOUD_NATIVE_ACCOUNT_GRANT_WRITE_GATE`）。
- Node DOM 回歸涵蓋 Gate OFF 完全不顯示、Owner 不可調整、有效員工授權與移除停用門市、固定單次 payload 與 CSRF、確認結果後刷新、舊 Session 不提交。
- 不修改 Cloudflare Worker、D1 Schema、正式帳號／門市／資料、Variables、Secrets、Operator Gates、正式部署或 Restore；本次的 mock API 是離線合成測，不是正式 UAT。
- #202／#203 主線完成與相依版本核對後，最新 HEAD Hosted Verify 5/5、正式 Codex Review completed/0 Findings/0 unresolved、clean merge 才能合併 UI。實際啟用 Production Grant Gate 及正式員工授權異動**需使用者另行核准、備份與現場驗收**。