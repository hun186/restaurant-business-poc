# 餐廳好管家｜Windows 異機還原現場驗收及證據紀錄（RB-011-UAT）

> 狀態：**範本／待現場執行，不是已完成的驗收報告**。追蹤 [Issue #31](https://github.com/hun186/restaurant-business-poc/issues/31)。本文件只用於固定主機 Node.js + SQLite；不代表 Cloudflare D1、Vercel Demo 或正式公網部署已完成。
>
> 先閱讀 [備份與還原 SOP](備份與還原SOP.md)；其中舊 Session 在獨立工作副本中清除、WAL/SHM 分離等內容目前屬 PR #30，**PR #30 尚未合併前，不得將主線視為已具備整套流程**。

## 目的與失敗即停止原則

以**第二台獨立 Windows 電腦**及受控、可捨棄的測試資料驗證：外部備份移轉後可核對原始 SHA-256、在停機的隔離副本完成安全復原、先清空舊 Session、啟動本機 HTTP、舊 Cookie 401、可使用原帳密重新登入、跨角色／跨門市拒絕越權、庫存帳本和營運資料正確。最後才量測 RTO/RPO 與業主簽收。

**任何關卡 FAIL、NOT_RUN 或缺證據，整體只能記為 BLOCKED／NOT_ACCEPTED；不得因 GitHub CI、模擬腳本或其他項目 PASS 而推定現場 PASS。** 測試中若發生來源雜湊不同、Schema 損毀、權限不足、資料帳本不一致、舊 Cookie 仍被接受，停止啟動／切換，保存現場證據，按 SOP 回退或由技術人員調查。絕不可為了通過測試，修改原始備份、強制刪除 WAL/SHM 或覆寫唯一正式 DB。

## 先決條件（請現場逐項確認）

- [ ] 測試得到業主同意，有**另一台** Windows 主機／受控磁碟，原營運主機不受破壞；實機版本、Node.js 22.13+、程式 Commit、主機代號、權限與測試時區已核對。
- [ ] 優先使用可捨棄的虛構資料庫。若確需使用營運副本，必須經核准、隔離網路／人員、加密傳輸與受權限保護；不得上傳 Public GitHub、Cloudflare Preview、Vercel 或一般訊息附件。
- [ ] 明確指定來源主機、快照時間、原主機**獨立保存**的 SHA-256 紀錄與可寫復原工作資料夾（不能把搬運後才計算的雜湊當成預期值）。
- [ ] 停止 Node 服務及備份 Worker；若原庫存在，封存 `restaurant.sqlite`／`-wal`／`-shm` 全組，沒有核實之前不能直接刪除或覆寫。
- [ ] PR #30 的 Session 風險 SOP 已納入待測部署版本、由技術人員審閱；待測服務須保持離線，直到恢復副本的 Session 清理與完整性檢查全部完成。
- [ ] 現場先決定 RTO、RPO **目標值**、災難起算事件與時間紀錄來源；若尚未定義，仍能測流程，但**不得宣稱達成 RTO／RPO 目標**。
- [ ] 準備一個「先前已簽發、在測試時本應仍有效」的**受控測試 Session**，用來測清除前／清除後結果。僅在私有環境保管 Cookie，公開報告只記錄測試結果；若無此先決條件，舊 Session 驗收填 NOT_RUN，不能把自然逾期的 401 算成安全 PASS。

## 現場執行與關卡

| 關卡 | 執行與最低證據要求 | PASS 判準 |
| --- | --- | --- |
| G0 安全隔離 | 停機、核對第二台主機及 NTFS/目錄 ACL；封存舊 DB/WAL/SHM 的私有紀錄 | 未對正式唯一資料庫進行覆寫，來源備份與封存資料完整 |
| G1 複製／驗雜湊 | 在另一台 Windows 執行 `異機備份驗證.bat`，使用來源**先前獨立紀錄**的 SHA-256；記錄退出碼與去識別結果 | 原始雜湊比對一致，SQLite quick_check/FK/schema 成功，來源沒有新 WAL/SHM／權限變化 |
| G2 離線安全準備 | 原始檔只讀，對**另一份可寫隔離副本**先做驗證；停機時依 SOP 交易清空 `sessions` 並查 `COUNT(*)=0` | Session=0，清除後 quick_check/FK 成功，營運 fingerprint／`stock_moves` 不變 |
| G3 隔離啟動 | 確認沒有舊 WAL/SHM 混入、新資料目錄 ACL／`.installed` 正確，於第二台 Windows 啟動本機 Node HTTP（不得開到公網） | 現有 SQLite 直接啟動，未產生新 Owner／沒有靜默重建或 Schema 重置 |
| G4 Session／登入 | 使用受控舊 Cookie 測 `/api/me`、`/api/overview`，再用原 Owner／Manager 測試帳號登入 | 舊 Cookie 都是 401，原帳密可成功重新登入；不得記錄實際 Cookie／密碼 |
| G5 業務／授權 | 以授權角色確認原門市／庫存量、`stock_moves`、叫貨資料；用跨門市／Staff 測試拒存取 | 紀錄和來源備份一致、無越權寫入、需要拒絕的 API 為 403；測試資料不被非預期改寫 |
| G6 故障／回退 | 測試錯 SHA-256／損毀副本／不足空間情境，演練停止、隔離、回退與證據保存 | 失敗拒絕繼續、不覆寫來源、不將檢查失敗誤報成功 |
| G7 時間／簽收 | 記錄時間點、RTO/RPO 計算依據、證據索引與剩餘風險 | 有可追溯數據與業主**明確**簽收；無法量測時標記 NOT_MEASURABLE |

## RTO／RPO 計時及判讀

所有時間點使用**相同時區（建議含 `+08:00` offset 的 ISO 8601）**與可靠時鐘；若跨主機時鐘不同步，先校時或保留誤差，不得自行湊出漂亮數值。

- **RTO 實測**：從事先約定的服務中斷／演練開始點 `T_incident` 到服務**真正恢復並通過必要健康、登入、權限、營運驗證**的 `T_usable`，`RTO = T_usable - T_incident`。不要用「開始拷貝檔案」或「Node 進程已開」冒充完整恢復。
- **RPO 實測**：先界定故障前最後一筆可核實已提交的業務變更時間 `T_last_committed`，以及還原資料庫可核實的最新已恢復提交時間 `T_last_restored`，`RPO = T_last_committed - T_last_restored`（有受控、可信任的資料點才可計算）。**備份檔案時間戳、mtime、快照檔名不等於已證明的最後業務提交時間。**
- 若無法從業務紀錄／受控測試事件確認時間，RPO 填 `NOT_MEASURABLE`；沒有約定目標，填 `NO_TARGET`。目標達成需要實測值與事先目標均存在且可比對。

## 私有證據工作表（複製到 Git Repository **以外**的受權限保護位置後填寫）

請**勿將實際填妥的版本 commit 到 Public Repo，勿貼於 Issue #31**。以下方括號僅為欄位提示，範本本身不代表執行紀錄。

| 項目 | 填寫欄位（範本，勿在 GitHub 填入實際值） |
| --- | --- |
| 演練／授權 | `[演練日期與時區]`／`[核准人角色]`／`[私有授權記錄位置]` |
| 工具與兩台機器 | `[Git HEAD]`／`[Windows、Node 版本]`／`[去識別來源／目的主機代號]` |
| 敏感資料隔離 | `[可捨棄測試 DB / 特別核准的受保護副本]`／`[ACL 與加密保護是否核對]` |
| 來源備份 | `[私有 SHA-256 證據索引]`／`[雜湊一致 YES/NO]`／`[原始檔無修改 YES/NO]` |
| Session 清理 | `[清理前是否確認有效測試 Session]`／`[清理後 count=0 YES/NO]`／`[舊 Cookie 401 YES/NO/NOT_RUN]` |
| 營運驗證 | `[Owner/Manager 重新登入 PASS/FAIL]`／`[庫存帳本一致 PASS/FAIL]`／`[跨門市 RBAC 403 PASS/FAIL]` |
| 故障回退 | `[雜湊不符／損毀／磁碟不足的 PASS/FAIL/NOT_RUN]`／`[回退證據私有索引]` |
| 時間點 | `[T_incident]`／`[T_usable]`／`[T_last_committed]`／`[T_last_restored]`／`[時鐘誤差]` |
| RTO／RPO | `[實測分鐘或 NOT_MEASURABLE]`／`[事先目標或 NO_TARGET]`／`[是否達標 YES/NO/UNDETERMINED]` |
| 結果與簽收 | `[G0…G7 的 PASS/FAIL/NOT_RUN]`／`[整體 NOT_ACCEPTED / ACCEPTED]`／`[未解問題]`／`[業主簽收私有證據索引]` |

### 可公開的最小交接摘要（只有去識別內容）

只有在確認**不含**姓名、來源 IP／完整路徑、登入憑證、Cookie、真實營運數量、敏感資料或可連結回個人的時間紀錄後，才可以在 Issue #31 回報：`[日期]`、`[測試程式 SHA]`、`[另一台 Windows 實機 YES/NO]`、`[G0…G7 狀態]`、`[RTO/RPO 是否具可靠證據 YES/NO]`、`[業主是否簽收 YES/NO]`、`[仍阻擋驗收的風險]`。原始證據請留在組織授權的私有儲存位置，不上傳到 Public GitHub。

## 結束與狀態更新規則

只有 G0–G7 全部具備現場證據且 PASS、RTO/RPO 判斷明確、業主授權簽收，才可將 Issue #31 標記已完成。即使現場通過，也不代表 Cloudflare Hosted CPU/Access、D1 production、跨網路 HTTPS 或正式公網登入已通過驗收；後者須另案授權與驗證。
