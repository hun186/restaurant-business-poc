# 餐廳好管家｜Native 帳號管理現行交付交接（2026-11-25）

> 適用 Issue #182、#34、#176。**本文件是 Main 程式與本地／CI 驗收索引，並非 Production 部署、帳號寫入或功能旗標變更授權。** 核對快照 Main `3722a946f8ea360f059265758689445274932e4f`。過去 dormant API v1 仍為歷史設計；不使用候選 `/api/admin/account` 執行正式操作。

## 1. 現行路由及獨立發布條件

所有下列 Native 功能均以有效 D1 v3、正式登入設定、有效 Owner Session、CSRF 與同源要求為基礎；以實際 Handler 為準。表內旗標均須精確等於 `operator-released`，未設／其他值一律不授權。Native Login 本身另需 `CLOUD_AUTH_PHASE=native-production`、`CLOUD_NATIVE_LOGIN_GATE`、受保護的來源驗證 Pepper 與 D1 binding；**不記錄或要求貼出 Pepper 值**。

| 功能 | HTTP | 已合併的程式所需額外 Gate | Owner GET capability |
|---|---|---|---|
| 帳號列表 | GET /api/accounts | 無額外帳號寫入 Gate（Owner only） | 依下列獨立旗標 |
| 建立員工／主管 | POST /api/accounts | CLOUD_NATIVE_ACCOUNT_WRITE_GATE | can_create |
| 停用／啟用 | POST /api/accounts/status | CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE | can_manage_status |
| 員工／主管角色 | POST /api/accounts/role | ADMIN + CLOUD_NATIVE_ACCOUNT_ROLE_WRITE_GATE | can_manage_role |
| 門市授權 | POST /api/accounts/grant | ADMIN + CLOUD_NATIVE_ACCOUNT_GRANT_WRITE_GATE | can_manage_grants |
| 員工／主管密碼重設 | POST /api/accounts/password-reset | ADMIN + CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE | can_reset_password |
| 本人變更密碼 | POST /api/password/change | Native login 條件；不以帳號管理寫入 Gate 代替本人身分驗證 | 帳號安全頁 |
| 安全稽核 | GET /api/audit | 無額外帳號寫入 Gate（Owner only） | 僅檢視 |

ADMIN 代表 `CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE`。**特別注意依賴關係：** 若 ADMIN 原先未開，不能以「只開密碼重設」為名同時打開 ADMIN 而忽略停用／啟用亦將開放。角色／門市／重設仍各自需要附加 Gate。開啟一個 Gate 不代表所有業務可寫入；既有新增帳號也不自動授權 ADMIN。配置中的 `keep_vars=true` 代表 repo 本身不足以證明目前遠端 Vars 狀態，應由操作者在受控環境確認名稱與狀態，不能從 GitHub merge 推測。

不新增 Owner、重設 Owner、硬刪帳號或跨門市操作。已停用帳號不得透過重設密碼而自動啟用。歷史資料與授權關係保留。Demo 僅展示合成資料，不連正式 Auth/D1。

## 2. 密碼重設實際工程證據（截至本文件建立）

| PR | 精確 HEAD / Hosted CI / 合併 | 已證實 |
|---|---|---|
| #269 | `cd99955256c279860288c5b0375ecdda8ba19e68` [Hosted 45574894742](https://github.com/hun186/restaurant-business-poc/actions/runs/45574894742) 5/5 PASS，formal Codex 0/0，Main `c8ad6a28fdb5eb03eb112ed2ddb78153469dc7d2`，[Main 45577795319](https://github.com/hun186/restaurant-business-poc/actions/runs/45577795319) 5/5 PASS | Owner current password 重新驗證、限制頻率、credential CAS、全部 target Session 撤銷、稽核與原子性負向測試 |
| #270 | `596c0d1b775f4bede82c92fdd4b24e5340e189ce` [Hosted 45578449155](https://github.com/hun186/restaurant-business-poc/actions/runs/45578449155) 5/5 PASS，formal Codex 0/0，Main `0970e974a7c30823ae5592d942ba375ab42503af`，[Main 45579141599](https://github.com/hun186/restaurant-business-poc/actions/runs/45579141599) 5/5 PASS | 32 種 Gate 組合、清除密碼欄、重送防護、延遲回應隔離、UI 僅依已驗證的伺服器 capability |
| #271 | `ed70c828e0081cd6f7647a7e119829c1b1ca5068` [Hosted 45578799375](https://github.com/hun186/restaurant-business-poc/actions/runs/45578799375) 5/5 PASS，formal Codex 0/0，Main `3722a946f8ea360f059265758689445274932e4f`，[Main 45579257101](https://github.com/hun186/restaurant-business-poc/actions/runs/45579257101) 撰寫時尚未完成 | Owner-only 稽核與 Excel 中文一致，標明目前目標登入帳號而非歷史快照，不顯示密碼／Session／內部 ID |
| #272 | `f7c41a9e41948c33d86d770080a43d4dace4e06e` [Hosted 45579381873 / workerd job 139085267057](https://github.com/hun186/restaurant-business-poc/actions/runs/45579381873/job/139085267057) 該 Job PASS；整體 CI、formal Review、Merge 撰寫時尚未完成 | 實際本地 workerd Worker login HTTP、D1 batch；兩個舊 Session 失效、舊密碼拒絕、新密碼重新登入、其他人與門市授權不變、撤銷故障時完整回滾、redacted audit |

#272 實際 Job 於 2026-11-25 16:49:07 臺灣時間輸出 `NATIVE_ACCOUNT_RESET_LOCAL_D1_UAT_PASS`，Wrangler 4.152.0，real_workerd_dispatch=true、real_d1_batch=true、local_login_http_verified=true、target_sessions_revoked=2、revoke_failure_atomic_rollback=true、old_password_denied=true、new_password_login_verified=true；synthetic_edge_metadata=true、remote_d1_verified=false、real_edge_provenance_verified=false、production_write_performed=false、production_gate_modified=false。原有 stock v4 本地回歸同 Job PASS。使用合成帳號及本地 Edge Metadata，不證明 Hosted CPU 預算、正式 Cloudflare Edge 來源、遠端 D1 或 Production UAT。

## 3. 操作者上線前最短必要清單（全部未在本文件代為核准）

- [ ] #272 精確 HEAD Hosted 5/5、formal Codex completed 無 findings/unresolved、合併及 Main CI；與其餘版本的 Main CI 一併重新核對。
- [ ] 確認真正 Cloudflare Active Worker 版本、正式 D1 v3、正確帳號及資料庫綁定，所有未獲授權 Gate 維持關閉；核對當下公開 readiness，不將 11/21 歷史 PASS 當成今日現況。
- [ ] 核對新鮮的正式加密備份、Verify 與獨立副本；未驗證的恢復能力、G5 Restore 暫緩決策不能寫成 PASS。遵守 #176/#46/#61 既有決策與必要的獨立風險批准。
- [ ] 確認目前正式登入、Session、可信來源與實際 Worker CPU 預算的證據適用於新增的雙 KDF 重設操作；既有登入單次 KDF 或本地 CPU 測量不替代新路徑的 Hosted 驗收。先於隔離合成環境核實，沒有證據不放行。
- [ ] 取得獨立明確的部署與所需 Gate 變更授權；若 ADMIN 從關閉變開啟，連同停用／啟用操作範圍一併確認，不變更未相關 Gate、Owner 資料或資料庫 schema。
- [ ] 在獲准的隔離／受控環境用專用合成員工而非既有營運帳號完成登入、兩 Session、拒絕錯誤 Owner 密碼、重設、新舊登入、稽核、其他 Session 不變驗收；記錄非機密版本/時間/結果，不貼出密碼、Cookie、Token、IP hash、Pepper。
- [ ] 確認異常停損：未確認重設結果時禁止盲目重送，核對安全稽核及實際員工登入；若需停止新重設，優先經核准關閉專屬 PASSWORD_RESET Gate，不因停止重設而誤關既有營運功能。關閉不會恢復舊密碼或已撤銷 Session，資料回復須獨立批准。

登入限制沿用現行 per-user 8 / 15 分鐘、per-source 32 / 15 分鐘（成功嘗試亦計入）；密碼重設另外每位 Owner 每小時最多成功 5 次。操作時避免連續反覆驗證造成 Owner 暫時不能登入。現有 UI 不自動重試；錯誤或中斷需人工核對。

## 4. 交付決策

第一階段原有營運功能可按 #34 既有驗收、最新公開狀態與備份確認獨立交付，不需等所有新帳號管理或庫存 v4 功能同時啟用。本文件不設定遠端 Vars、Secret、Environment，不執行任何 Production D1 寫入、部署或 Restore。若新功能缺實機條件，維持原有營運設定，轉向其他能直接提升業主使用的功能，不重複新增同質離線測試來代替實機批准。
