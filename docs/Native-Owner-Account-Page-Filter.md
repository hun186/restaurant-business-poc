# Native Owner 帳號管理｜目前分頁篩選（2026-11-17）

## 使用情境

業主已有建立／停用／角色切換等功能，帳號清單並會把「無有效門市授權」「授權到已停用門市」「授權門市不在本次門市清單」列為提醒。當本頁帳號較多時，業主不必逐列尋找警示，可在同一頁直接篩選。

## 功能及操作限制

- 正式 Native Owner 帳號清單新增「篩選本頁帳號」下拉：**全部帳號**、**需核對門市授權**、**已停用帳號**。
- 僅顯示現有 Owner-only `GET /api/accounts` 已取得的**本次伺服器 50 筆分頁**；不向其他頁、其他 API 查詢，不改變頁數、既有權限或帳號狀態。顯示「本頁顯示 n / m 筆；僅篩選目前分頁，其他頁不受影響」避免把篩選結果誤當全站總數。
- 「需核對」只針對**啟用中且現有門市授權顯示已警示**的帳號；已停用帳號另有獨立篩選，不將歷史帳號錯算為需要緊急補權。Owner 全店權限不會被誤標無門市授權。
- 篩選器只切換原先經安全 `textContent` 渲染的表格列 `hidden` 屬性；不透過 `innerHTML` 或從 DOM 推算使用者權限。所有停用／啟用／角色異動，仍由 Worker RBAC、Session/CSRF、CAS、獨立 Operator Gates 及 D1 稽核原子交易控制；前端篩選**不構成授權**。
- 切換伺服器分頁後篩選重設為全部，避免把上一頁的局部條件誤當跨頁全域條件。失效／切換的 Owner 視圖透過既有 `live()` 拒絕舊下拉操作；不保留帳號資料在本機永久儲存。

## 回歸與上線邊界

合成 Node DOM 測試覆蓋：Owner、正常授權員工、警示員工／主管、已停用員工，完整三種篩選、恢復全部、Live 失效後不改舊表格、不額外傳送網路請求、零正式資料寫入；同步更新保守閉鎖 SHA-256 allowlist。

本 PR 為瀏覽器 Owner-only 顯示層修改，**沒有改動 Cloudflare Worker、D1 Schema / Production 資料、Secrets、Variables、帳號或營運 Write Gate**。需要最新 HEAD Hosted CI 五項通過、正式 Codex Code Review completed / 0 findings / 0 unresolved、clean merge；合併後的 Main Verify / G0 與正式 Owner 平板／桌機 UAT 仍須分開確認。