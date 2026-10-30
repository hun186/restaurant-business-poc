# 餐廳好管家 Project Memory

## Current Focus

- 2026-10-30 G5/#46 新 D1 機器實證：使用者執行全新的 [G5 D1 inspect Run #41046807367](https://github.com/hun186/restaurant-business-poc/actions/runs/41046807367)（2026-10-30 11:15Z／臺灣 19:15，main SHA `61912fb594173e61ae140c56914bf40c2fc20688`），`inspect=SUCCESS`、`drill=SKIPPED`，遠端日誌回報 `G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS`、`remote_restore_rehearsal_verified=false`。依既有 CLI 完成 metadata、允許 Schema、quick_check、Time Travel Bookmark 唯讀檢查；和 Worker/Pages GET-only Binding inventory #41041385954 success 形成兩項機器實證。**仍不是人工確認無間接存取、無並行寫入或可執行 Restore；Cloudflare Dashboard Audit Logs/帳戶操作者與 GitHub Write Environment 保護仍未查到獨立證據。** Docs PR #59 branch 補進 B1 machine pass，B2 獨立人工維持 pending；更新後必須重新確認 latest HEAD Hosted CI/正式 Codex Review，需使用者另次 Merge 授權。D1 Restore、Migration、Production Write 仍禁。

- 2026-10-30 G5/#46 新實證：PR #58 經明確授權 Squash Merge，最新 `main=61912fb594173e61ae140c56914bf40c2fc20688`、Postmerge Verify #41039593794 **SUCCESS**。真正 Cloudflare GET-only [G5 綁定盤點 #41041385954](https://github.com/hun186/restaurant-business-poc/actions/runs/41041385954) 同 SHA **SUCCESS**，1 script、47 Worker versions、0 Pages projects、0 target D1 direct bindings，日誌 `G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED`。**機器盤點完成，但獨立人工 attestation=false、exclusive_use=false、indirect service access not certified、Restore 未執行、production_ready=false**。舊 disposable D1 `inspect` #40914927490 attempt2 於 10/29 PASS 空庫 Schema/quick_check/Bookmark，是過去快照非目前無並行使用者保證。本分支僅新增最新證據與人工安全覆核（Worker/Pages 部署與間接路徑、當下 D1 read-only inspect、Cloudflare Audit Logs/使用者/排程與維護窗口、GitHub Write Environment main-only/獨立 reviewer/Prevent self-review/無預置 Write token 等）Runbook 與記憶，**不執行遠端 API、Restore/Production Write、不替使用者填人工簽核**。GitHub Connector 無法核對 Cloudflare Dashboard／GitHub Environment 規則，單人 Repo 無法視為獨立 Required reviewer；需另行人工證明。文件 PR 須 CI／正式 Codex Review／另次明確 Merge 授權。

- 2026-10-30 G5/#46 NEW：PR #57 已經使用者明確授權 Squash Merge，`main=233a1c1b58c3865884456d95b8f321764ec35aa5`，Postmerge Verify #41027139504 success。新 GET-only Cloudflare Run #41027408751 使用正確 main SHA / attempt=1，**FAIL** `PAGES_LIST / PAGE_TOTAL_PAGES_INVALID`。PR #57 已允許 null/undefined，其他型別獨立 `PAGE_TOTAL_PAGES_TYPE_INVALID`，故目前錯誤可縮小為 *number* 非正安全整數，可能為 0／負數／小數，實際值不知。本分支僅在所有必要欄位經嚴格驗證且 `page=1,total_count=0,count=0,result=[]` 時接受 `total_pages=0`（空集合零頁假設），非空/其他錯誤仍 Fail Closed；合成測試、SHA256、runbook 同步，待 Hosted CI+正式 Codex+使用者再授權 Merge。不得宣稱遠端 G5 PASS，Pages deployed-version binding/人工證明和 D1 Restore 未完成。

- 2026-10-30 G5/#46：PR #56 已經使用者授權 Squash Merge，`main=70a07aab4f034ccf184385c5f53e0654f17a80ca`；Postmerge Verify #41023736114 **PASS 5/5**。新的真正 Cloudflare GET-only Run #41023956018（run_attempt=1, 正確 main SHA）**仍 FAIL**：`PAGES_LIST / VALIDATION_FAILED / PAGE_TOTAL_PAGES_INVALID`；因此不能歸咎舊 SHA。PR #56 只接受 total_pages undefined，實際還可能是 null／字串／0／其他非法值，日誌未揭露值。官方 Pages List API 宣告 total_pages optional，並未證實 nullable。本分支採窄幅相容：**undefined 或 null** 才視作省略該提示、掃描頁數由必要 validated `total_count/per_page` 計算；如提供數值則必須為正安全整數且一致，其他型別以固定不洩密 `PAGE_TOTAL_PAGES_TYPE_INVALID` 拒絕。資料完整性 Fail Closed 保持，新增合成測試和 SHA256，尚未驗證遠端 G5 通過、Pages deployed versions 未確證、Restore 仍禁。需 Hosted CI、正式 Codex、獨立使用者 Merge 授權才允許新 main GET-only Run。

- 2026-10-30 G5/#46：PR #55 已在正式 Codex 0 findings、Hosted Verify 5/5 後經使用者明確授權 Squash Merge，main `77db23f3e49b108c8246682546febcb35d2e6f9d`，Postmerge Verify #41019351188 PASS。最新真實 GET-only G5 Run #41020107558 **FAIL**：`PAGES_LIST / VALIDATION_FAILED validation_code=PAGE_TOTAL_PAGES_INVALID`。Cloudflare 官方 Pages List API 將 `result_info.total_pages` 明定為 optional（並不表示實際值必然缺失，代碼也可能因 null/類型錯誤）。本分支改成依強制驗證的 `total_count/per_page` 推算預期最後頁，API 缺少 `total_pages` 才允許推算；若提供任何不合法或不一致值仍 fail closed。完整逐頁 page/count/per_page/total_count/上限與 D1 Binding 及已部署版本的不確定性保留；測試、runbook、SHA256 更新。新 PR CI、正式 Codex Review 與獨立 Merge 授權均待完成；未操作 Cloudflare D1 Restore、Production Write、Migration 或擴權。

- 2026-10-30 G5/#46：main `019b74b30b582e630aa4ee78aac6a969d1790676`（PR #54 authorized squash merged；Postmerge Verify #41015489859 PASS）。真實 Cloudflare 唯讀 G5 Runs #41016132258、#41016228381 **均 FAIL**：`stage=PAGES_LIST reason=VALIDATION_FAILED`。先前帶 per_page 的 HTTP 400 未再出現，但現有代碼無法辨別是 `result_info` 缺欄位、頁數/計數不一致還是專案名稱。由於 Cloudflare API result_info/內部欄位允許選填，**不得放鬆完整分頁驗證並宣稱通過**。本分支加入只包含固定列舉的 `validation_code` 診斷、合成回歸、SHA256、runbook，讓下一輪遠端 GET-only Run 具體定位；並保留完整 Fail Closed、Pages deployed bindings 仍需另證、不做 Restore/Production D1 Write。此 PR 仍待 Hosted CI/Codex 與使用者 Merge 授權。

- 2026-10-30 G5/#46 NEW：PR #53 已正式 Codex 0 findings、Hosted Verify 5/5 PASS 後經使用者授權 Squash Merge，最新 main `62e43fce4ef8439c9039579ba8e12817cd5bc462`，Postmerge Verify #41009242292 PASS。其後真實 GET-only Cloudflare Run #41009848022 **FAIL**：`PAGES_LIST reason=HTTP_BAD_REQUEST bare_probe=OK page_probe=OK per_page_probe=HTTP_BAD_REQUEST`；同 Token 無 query/只 page=1 可以列出 Pages，有 `per_page=20` 的請求會 HTTP 400。**尚未完成綁定盤點**，原因以實證鎖定 per_page 參數，但後端為何回 400 尚未定論。本分支把 Pages 專案清單改為只使用 `?page=N`，逐頁驗證 API 提供的 server `result_info.per_page`（上限100）、page/count/total_count/total_pages、跨頁一致性與 MAX_PROJECTS 500，任何不完整均 Fail Closed；Worker Versions 保持 50。合成測試與 SHA256、runbook 同步。等待 Hosted CI、正式 Codex Review、另一次明確 Merge 授權；沒有進行遠端 Restore、D1 Write、Production Migration/login 或生產開放。

- 2026-10-30 G5/#46：最新 main `8fa3600c6a7586cdf598810db8d3a8dd98ac83df`（PR #52 Squash Merged，Postmerge Verify #41002428857 PASS）。新真實 Cloudflare GET-only Run #41002452609 **FAIL**，明確取得 `stage=PAGES_LIST reason=HTTP_BAD_REQUEST bare_probe=OK`。與同 Token 不帶 query GET 可成功對照，推進本分支**僅當第一頁 `?page=1&per_page=20` 400** 時，依序用 GET 對照無 query、`?page=1`、`?per_page=20`，固定回報 `bare_probe/page_probe/per_page_probe` 安全代碼，但**一律拋出原始 400 並保留未完成狀態**。原分頁完整性與 Pages deployed binding 人工關卡不放寬，新增合成測試、SHA256、文件。此分支 Hosted CI、Codex review、Merge 尚未完成；Restore / D1 Write / Production 啟用仍禁止。

- 2026-10-30 G5/#46：PR #51 已經 Codex 0 findings、CI 5/5 後 Squash Merge，main `111f302ad2f8c68102f3ab792ddc000f1a99f060`，Postmerge Verify #40998752737 PASS。正式 Cloudflare 唯讀 Run #40998874342 **FAIL**：`stage=PAGES_LIST reason=HTTP_BAD_REQUEST`；20 筆每頁仍失敗，未找到根因。本分支新增僅在 **Pages 第 1 頁 HTTP 400** 時一次 GET `/pages/projects`（無分頁參數）並只輸出固定 `bare_probe` 代碼；原始 paged 400 仍 Fail Closed，不以 bare GET 取代完整分頁，不洩露 HTTP 本文或 Token。同步測試、文件、SHA256 Manifest；Hosted CI／正式 Review／Merge 均仍待完成，使用者需另外明確授權 Merge。G5 Remote Restore、Production D1 及正式服務一律未核准。

- 2026-10-30 G5 #46：PR #50 已 Squash Merge main `5219b1259117b430cee0103dd44666790c949e59`，主線 Verify #40996277530 PASS；新手動 GET-only Cloudflare 盤點 Run #40997303708 **失敗**：`stage=PAGES_LIST reason=HTTP_OTHER`，此前 Worker 盤點未報錯但不代表最終完整通過。程式原本對 Pages Projects List 使用 `per_page=50`；本分支改用符合 Cloudflare 官方 API 範例的獨立 `per_page=20`、保留嚴格 total_count 分頁驗證、單獨辨識 HTTP 400、加多頁/缺頁合成測試及 SHA-256 閉鎖檔。**HTTP_OTHER 實際狀態碼不明，20 筆是待實測修正，不宣稱根因已查明**；未經 Hosted CI+正式 Codex Review 不得 Merge，且需使用者授權。未實際恢復、部署、移轉或寫入 D1，`G5_DRILL_RESTORE_APPROVED` 繼續關閉。

- 2026-10-30 P0 G5/#46：main= `0dd0484889f3332e9a84b4b9dfde97d5b6aa0326`（PR #48 merged，Postmerge CI #40973179539 PASS）。使用者回報 `d1-recovery-drill-write` 的非敏感 Variables 及 main-only 限制已設定，但不能由 Connector 驗證；單人維護，Required reviewers 不能作獨立雙人簽核。本分支新增 G5 Cloudflare Workers Script/Versions 與 Pages production/preview D1 Binding GET-only 盤點工具、main-only 手動環境、合成回歸、封閉 SHA-256 清單；PR Head Hosted CI/Codex 待核對，不擅自 Merge。新流程還需額外 GET-only Token／Environment，尚未實際遠端執行。未批准破壞性 Restore，無任何 D1 Write／Migration。

- 2026-10-30 G5/#46：以最新 main `938805ac0fa53fe7c0aa462b23e9b0292e8e5fcc` 為基底的安全加固分支新增每次執行都須確認的 Cloudflare 無 Worker Binding 與無並行使用者雙重 typed attestations；Workflow job guard、注入 Write Token 前 approval gate 與 CLI 三層 Fail Closed，增加未授權拒絕回歸與 SHA-256 閉鎖清單。已驗證 disposable 唯讀 Inspect #40914927490 Attempt 2 成功；遠端 Restore、Write Environment 實際保護與最小權限、加密異地備份、RPO/RTO、Production Login 仍未驗收；本分支 CI/Codex/合併另待核對，不得自行執行 Restore 或 Merge。

- 2026-10-30 / PR #41 G0 整合至最新 main（已含 PR #47 的隔離式 D1 Pin UUID）：新增固定 Cloudflare GET only 的 Worker/Domain/Zone 公開暴露面盤點、主線人工 Protected Environment 工作流程、synthetic total_count/多頁 fail-closed 測試及 reviewed SHA-256 allowlist。PR #41 前一 HEAD 903d15d 已通過 Verify 5/5、Workers Build 與 Codex 無 Findings；本整合 HEAD 須重新 Hosted CI + 正式 Codex Review，未通過前不可 Squash Merge。PR #47 已合併，但**未對真正 Cloudflare D1 API 做 remote inspect 或 Restore**。G0 仍未實際運行，Access / 正式登入寫入不可宣稱開放。

- 2026-10-30 P0 G5 / #46：使用者提供新建 disposable Cloudflare D1 UUID `cc3fe86d-1c46-4c2f-a399-0ec3c46d5198`。實際 main `32693574cdbc95838d5697e95a0ac76564ab23a2`，PR #45 已 Squash Merge，後續 Main CI #40906680916 completed/success 5/5 PASS，Workers Builds success。本次**獨立 Pin-ID PR** 僅改 `cloudflare/recovery-drill-target.json`、配套 tests、閉鎖 SHA-256 指紋與文件：固定新 UUID，防止 Production (`b882a6e8-0e56-49a6-bd41-1a6cadd726c9`) / Staging (`2c355bed-d9c3-449c-aa9b-1018f3bc1177`) 誤操作。**尚未由 Cloudflare API 實證名稱／UUID／後端／資料庫空白狀態**；GitHub PIN 驗證不代表遠端 inspect 成功。未建立或改動任何資料庫、未設定 Environments/Token、未執行 Restore/Migration/Owner/正式 login/write。PR Head Hosted CI/正式 Codex Review 尚待完成，使用者另需授權 Merge。下一步若 Merge，先配置保護的 `d1-recovery-drill-readonly` Environment 及獨立 Read Token，人工執行 `inspect`（`CHECK_DISPOSABLE_D1_READONLY`）；破壞性 `drill` 一律需不同 Write Environment、使用者另一明確授權。G5 Production 空庫 Run #40865818477 attempt 3 與 Time Travel Read-only Run #40872307187 均實證 PASS，但不是 Restore 實證。


- 2026-10-29 G5 Production Time Travel Read-only Run #40872307187 真實 PASS（metadata production backend/bookmark 與合成 SQLite），PR #44 Squash Merged main `468e64753db89be650def8a7dd735c67cdde93a9` 且 Postmerge CI #40870570004 success。**本次新階段**：新增只允許另經 PR 審核且固定 UUID 的全新 disposable Cloudflare D1 `restaurant-business-g5-disposable-recovery-drill` 執行的真正遠端 Restore 測試工具＋手動 Workflow＋合成 API 模擬測試。當前 `cloudflare/recovery-drill-target.json` 的 database_id 為 `PENDING_SEPARATE_REVIEWED_TARGET_PR`，全部遠端 inspect/drill 均 Fail Closed；使用者尚未建立新演練庫，也未授權任何 Remote D1 Restore。後續先人工建立獨立空庫、另開 PR Pin DB UUID 並 Review、設置分離的 `d1-recovery-drill-readonly` / `d1-recovery-drill-write` 受保護 Environments 與分離讀寫 Token，再手動 inspect 取得實際證據，最後需**另一次明確的演練庫 Restore 授權**才可跑 drill。Production/Staging DB ID 永遠被排除；沒有執行 Production Migration／還原／Owner/bootstrap，正式 Login/Write 繼續 disabled。獨立雲端演練也不能替代加密異地備份、RPO/RTO、Owner 恢復簽核。PR #41 G0 仍 Open、Issue #42 Cloudflare Workers Build 外部阻斷待單獨追蹤。新 PR CI/Codex 最新 HEAD 尚待核驗，沒有 Merge 授權。


- 2026-10-29 P0 #34 G5：PR #43 已 Squash Merge `ee3a5cceef7c496ab650810f0fe6fc3b26d11e16`，合併後 Main Hosted CI #40862923071 5/5 PASS；G1 Staging 遠端讀取完整性 Run #40854101717 PASS，G5 Production 原始空庫只讀 preflight Run #40865818477 Attempt 3 completed/success，log 有 `PROD_D1_PRISTINE_READONLY_PASS`，初始化 job SKIPPED。Production D1 仍無業務 Schema，未建 Owner，沒有執行 Migration/Restore；G5 `PROD_D1_RESTORE_DRILL_SIGNED_OFF` 不可設定。本輪新增 **獨立 G5 recovery readiness**：人工 main-only `d1-production-recovery-readonly-g5.yml`，於現有受保護 `d1-production-readonly` Environment 用 D1 Read Token 以 Cloudflare 固定 GET API 只讀查詢 Production D1 backend version=production 和 current bookmark；不輸出 bookmark。另做完全隔離的合成 SQLite VACUUM INTO 快照與還原測試；**此非 Cloudflare 遠端 Restore 實證**，也非加密異地備份及 RTO/RPO 已驗證。仍須新建完全獨立的 disposable D1、授權實際 restore 演練、確定帳戶 Free 7d/Paid 30d retention、異地備份加密及 Owner 復原簽核，才可考慮 Production apply。新 PR CI/Codex 最新 HEAD 待核對；不得未授權 Merge。PR #41 G0 未合併、Issue #42 Assets 10013 狀態需各自追蹤，正式 Login/Write 維持禁用。


- 2026-10-29 P0 #34/G5：真正 Staging G1 只讀 Run #40854101717 已完成 success，確認 schema v3、0001/0002、FK、單一測試 Owner（僅此子關卡 PASS）。Cloudflare Production D1 Studio 唯讀確認原始庫只有 `_cf_KV`，正式 Schema 尚不存在。新增 **Production D1 初始化防護流程**：main-only 手動 GitHub Actions 的 `preflight`（僅只讀）和 `apply`（需逐版40字 SHA、Environment 人工審批、復原演練簽核、G1 Run 审核、獨立最小權限 Token）模式，Production-only Wrangler config、不可與 Staging 混用、允許且固定 SHA 的 0001+0002 檔案、資料庫空庫與 quick_check 預檢、再次預檢、Time Travel bookmark 確認、postflight 驗證 22+1 表/3 indexes/0 user/0 stock/無 FK。現階段僅程式碼及合成回歸，未向 Production Cloudflare 發出任何 D1 查詢或 Migration、未實際驗證備份還原、未建立 Owner、不啟用 login/write。PR 待 HEAD Hosted CI/Codex Review、使用者明確 Merge 指令；Merge 不等於授權 Prod apply。PR #41 G0 Open 未 Merge、Cloudflare Workers Assets upload-session 10013 未確認解決（Issue #42）。


- 2026-10-29｜P0 #34 G1：PR #39 Squash Merge 28cf72e4b899135deb7dff4dfaf41f902f2e10fd，main Hosted CI #40832201411 completed/success 5/5 PASS。新增僅 main 手動 workflow_dispatch 的 Cloudflare Staging D1 遠端唯讀 Schema/Migration/0002 Index/FK/Owner 聚合筆數驗收，固定 STAGING_DB 及專用帳號、d1-staging environment、與 migration 共用 concurrency，secret 僅限 query 步驟，RUNNER_TEMP 暫存清理，不查任何用戶明細或密碼/token，不觸碰 Production。附離線驗證工具、合成測試與 SHA-256 封閉清單。此 PR 本身未實際呼叫 Cloudflare，遠端驗收只在合併後人工觸發才可建立 G1 證據。Access/Hosted CPU/Production migration/備份/Owner UAT 全未實證，Production Login/Write 仍 503。最新 HEAD CI/Codex Review 待核實，未授權不得 Merge。


- 2026-10-29｜PR #39 初輪 HEAD `0c8eeeec5dd26ffb755870d63a6a1c9882dce932` Hosted Ubuntu Node22/24 307/308 PASS、1 test assertion failure（`node:sqlite` 回傳 null prototype Row，deepStrictEqual 原型不一致，資料正確）。已修正測試使用欄位值比對而非 plain object deepStrictEqual，並更新 SHA-256 whitelist；新 HEAD CI 與正式 Codex Review 待複核，不得未經授權合併。


- 2026-10-29 P0 #34：PR #38 已 Squash Merge `5a2daeb2a63395fcfe1e90ce2393ccbfd4fb91b3`；合併後 Main CI #40825398666 啟動，實際結論須重新向 GitHub 核對。下一增量：D1 **盤點確認＋差額庫存流水＋稽核**內部原型，雙守衛 `CLOUD_AUTH_PHASE=preview-readonly` / `STOCKTAKE_WRITE_STAGE=internal-test-only`，**未接公開 Worker**。在 D1.batch 內以 NOT NULL constraint 重驗有效 Session/角色/門市/食材、盤點 pending、帳面與 expected_qty 差異不得超過 1e-6、禁止已有相同盤點 adjustment。差額為零不建立 stock_moves；差額非零建立一筆 adjustment 並驗證 confirmed 結果與最終庫存。合成回歸包含過期、跨店、競態與各階段故障回滾；並不代表遠端 Cloudflare D1／正式 Login／Access／備份／UAT 完成。待新 HEAD Hosted CI 與正式 Codex Review；未經使用者同意不得 Merge。


- 2026-10-29｜P0 #34：PR #37 Squash Merge `6b02c8a7b701ed2b1900f9ceb24afde7da5e3938`，合併後 Main CI #40813298768 5/5 PASS。本輪新增未接上公開 Worker 的 D1 多品項單據整張核准／收貨內部原型：由 SQL NOT NULL constraint 在 batch 交易內檢查完整品項、連號、同一門市與廠商、授權／Session、既有 stock_moves，任何異常必須觸發整批 SQL 交易回滾；收貨使用一個 INSERT…SELECT 全項入帳並檢查狀態，原則上避免 D1 0-row 不回滾缺陷。`GROUP_ORDER_WRITE_STAGE=internal-test-only` 與 `CLOUD_AUTH_PHASE=preview-readonly` 雙守衛。僅測合成資料、未操作 Cloudflare Remote D1，Production `/api/command` 仍 503。最新 HEAD CI／正式 Codex Review 和 Merge 待驗證／授權。


- 2026-10-29｜PR #37 HEAD `508248f166739288355739c82082b1d3a2d0b912` 首輪正式 Codex Review Completed，P2：Session 於批次建構時過期，兩次 condition() 採不同到期時間，D1.batch 將稽核/庫存記入但最終狀態更新 0 筆，卻已 Commit。本增量改用單一 `expiryCutoff` 傳至所有 SQL 述句；新增 Controlled Clock 模擬到期邊界，要求 audit + stock + status 全數同步成功；同步封閉 SHA 清單。修正後最新 HEAD Hosted CI 和正式 Codex 複審待驗，PR Open 未合併；正式 Cloudflare API 仍 503。


- 2026-10-29 P0 #34：已驗證 PR #36 Squash Merge，main `99450d54ba4a4114855bc8ed3c859543842281e0`；主線 Push CI #40793932322 5/5 PASS。下一增量為**不連接 public Worker**的 D1 單品項叫貨核准與收貨交易原型，必須 `CLOUD_AUTH_PHASE=preview-readonly` 且 `ORDER_WRITE_STAGE=internal-test-only`，使用合成資料測試權限、稽核、庫存流水和一次性驗收。整張多品項 POB 單拒絕逐行驗收；本增量不含進價/價格寫回、正式登入、D1 migration、真實 Cloudflare Access/Hosted CPU、業主 UAT。PR 未經使用者授權不得合併。


- 2026-10-29：PR #35 已 Merge `436b10ea8088b31b7294efb4960b4d69201247f8`；新 P0 D1 內部 Task 狀態改動增量：服務不接公開 `/api/command`，以合成 DB 測試 role/store/own task、雙重 internal-only guard、CSRF/Origin、D1 batch audit+task atomicity、無效/重複/撤銷 session。需 Hosted CI 與正式 Codex 複審；雲端 Production 仍只有 Demo，正式業主登入/資料異動/Access/Hosted CPU/備份及現場 UAT 未完成，PR 未經授權不可 Merge。

- 2026-10-29｜PR #35 首輪 Codex P2：非業主 SQL 過濾未排除停用門市（loadPrincipal 已排除，卻可透過剩餘 user_locations 讀取）。本次增量將 DB SQL scope、locations/staff_directory 統一只許 active 門市，新增已停用門市仍殘留 grant 的完整讀取回歸；更新 reviewed exact-byte hashes。新 HEAD CI/正式 Codex 複審待驗，尚未 Merge；正式環境維持 disabled，未操作 Cloudflare Production/D1。

- 2026-10-29｜P0 Cloudflare 正式營運優先：使用者明確要求先完成 Cloudflare 正式部署及業主真實營運，暫緩排班月曆。main 已 Squash Merge PR #33 `976859cd851da6cb917cf1b17594c49c0e4bf63b`、Push Verify #40735901964 5/5 PASS。已開 Issue #34 P0 放行清單。本 PR 先提供 D1 Preview Authenticated Read-only `/api/data` 對 tasks/stock/ingredients/門市及部分營運主檔的 SQL 層 RBAC 隔離測試，Production Auth/業務異動繼續 fail-closed；現場 Access/Hosted CPU、D1 prod migration/備份、真實 Owner 登入與 UAT 均 NOT_DONE。不得未授權 Merge。


- 新專案從水電業務管理系統 UI 參考與兩張餐飲版初稿開工，不能誤改水電 Repository。
- 首要目標：最新 main `40d3607789d3bc14ececd56fb6d7f1b69d6bfad9`（PR #30/#32 已合併，main Push Verify #40628721464 5/5 PASS）；Issue #31 實場 Windows 異機還原與 RTO/RPO 簽收 NOT_RUN。RB-006 跨日排班最小增量進行中：結束時間早於開始時間表示翌日、同員工跨日及跨門市重疊拒絕 409、表單與列表隔日提示，合成資料測試；不改 SQLite v3 或 Cloudflare。PR #33 初輪 Hosted CI PASS，Codex 找到日期上界 9999-12-31 P2；已修正四位數上下界並新增回歸，新 HEAD Hosted CI／正式複審仍待驗證，未授權不得 Merge；月曆、換班、勞動規則、請假衝突仍待後續。
- 部署政策：程式碼公開，但營運／人事資料嚴禁公開；本機 SQLite 與 Public Demo 必須分離。
- 使用者習慣：正式 Codex Review、逐輪 P1/P2 修正、Hosted CI 最新 SHA 驗證、未授權不 Merge。

## Recent Outcomes (2026-10-23; historical)

- 從水電 Repo 確認 Node.js + SQLite + 無外部 npm deps + RWD 設計路線。
- 建立餐廳 PoC 資料模型、角色與門市範圍、基本操作後端、瀏覽器前端、稽核紀錄。
- 本機 `npm run check` 11 項自動測試 PASS；2026-10-23 已透過 GitHub Connector 提交 24 檔至 PR #1 Draft；Ubuntu 22/24 的首次 CI 已 PASS，Windows 尚待確認。

## Open Handoffs（2026-10-27 更新；以下日期章節保留歷史狀態）

- 舊 PR #1 與 PR #7/#8/#9/#10 均已合併；這段的歷史開發/Review 訊息不再代表待處理 PR。下一輪先讀本文件 Current Focus 和 `.codex/backlog.md`；正式 Windows/業主簽收、異地備份、雲端 Access/Hosted CPU/production D1 尚未完成。
- 優先處理 `.codex/backlog.md` 的後續項目，不得將未完成報為完成。

### Public Vercel Demo handoff (2026-10-23)
- PR 分支新增 `vercel-demo/` 靜態虛構資料演示；與 `server.js` SQLite 正式 API 完全隔離，並提供重設入口。
- Hosted Vercel Preview 部署狀態需依最新 Vercel 專案/Deployment 實際查核，不得把 GitHub CI PASS 當成部署完成。
- PR #1 仍為 Draft，不得未經授權合併；生產環境的多人 RBAC/稽核仍需安全驗收。

### 2026-10-23｜本機 SQLite 備份系統增量（待 Host 驗證）
- 本次為使用者要求比照水電系統的備份功能，補「系統管理 → 備份管理」、業主限定 API、排程 Worker、SQLite v1→v2 安全升級、驗證過的快照及只清理自動版本。
- 資料摘要比對排除 Session、登入嘗試與備份元資料；如果上次自動備份存在且有效、持久內容無變更則更新自動檢查時間並跳過。手動備份仍保留；備份檔不進 Git/Vercel。
- 本機 Node 22 的 `npm run check`：22/22 PASS（含 11 項新備份專項），Hosted Ubuntu/Windows × Node22/24、正式 Review 與 Windows 實際還原尚待確認。
- 仍在 PR #1 Draft；**未取得使用者授權不可 Merge**。Public Vercel 示範站與本機資料庫備份互不相連。

## Pricing Integration Handoff (2026-10-23)
- 比照 menu-planner 的 ingredient_prices、dish_ingredients、cost preview 建立 v3；只有業主可修改共用菜品與配方；各主管可管理自身門市的歷史單價。
- 進貨驗收可選填單價並原子性保存；缺價／單位無法換算時絕不假設零成本。
- 備份 fingerprint 加入價格、菜品、配方，v2→v3 安全 migration snapshot。
- 沒有 AI 跨系統同步，亦非 FIFO/移動平均/POS 實際毛利。見 docs/菜單價格與成本試算.md。
- 此項開發分支 feat/menu-pricing-costs-v3，未經使用者同意不能 Merge。

## 2026-10-23 PR #2 Codex P1 修正
- 針對最新 Code Review `c3f4ed5` 的未解 P1，v2→v3 升級前以獨立記憶體 SQLite 的版本化 Schema 合約核對全部 v2 資料表及具名索引的完整建表 DDL，不再只檢查少數表是否存在。
- v1→v2 與 v3 開啟亦核對必要舊 Schema；異常時關閉 SQLite，拒絕自動修補、建立 migration snapshot 或更改 `user_version`。
- 新增 `repairs`、`stocktakes`、`evaluations` 遺失、欄位遺失、索引遺失及 v3 殘缺的回歸測試；本機對應設計驗證 38/38 PASS。以本 PR 最新 HEAD 的 Hosted CI 與 Codex 複審為最終依據。
- PR #2 仍為 Draft 且依賴 PR #1，未授權不可 Merge。

## PR #2 最新 Codex P1/P2 修正（2026-10-23）
- 驗證既有 v3 所有版本化 DDL，包括 ingredient_prices、menu_dishes、dish_ingredients 的欄位、FK/CHECK 和具名索引；破損時拒絕啟動，不自動補建。
- v1/v2 preflight 拒絕已出現的較新版物件（含 backup_settings 和 v3 索引），避免不正確的 migration snapshot。
- 新增價格欄位缺失、配方/價格索引缺失、v1 與 v2 混入新物件的回歸測試；本機 Node 22 合計 44/44 PASS。正式 Hosted CI / Codex Review 依 PR 最新 HEAD 核對。
- PR #2 Draft stacked PR，不可未授權 Merge。

## 2026-10-23 PR #1 Codex P1/P2 修正
- 修補庫存任意入庫繞過核准（僅有已核准單可驗收；業主能單次建期初庫存），新增門市授權即撤銷受授員工 Session。
- 將跨門市/員工表列權限篩選移至 SQL LIMIT 前；修復使用者加授門市表單、員工重設密碼錯誤登出。
- 備份中斷清理受解鎖 finally 保護；使用 realpath 避免 symlink/Windows Junction 嵌入營運資料資料夾。DATA_DIR 已在 PR #1 HEAD 的 server.start 套用。
- 新增針對上述問題的回歸測試。以新 HEAD 的 Hosted CI/最新 Codex Review 為準。PR 不可未授權 Merge。

## 2026-10-23 PR #1 Codex 後續 4 個 P2
- 總覽 KPI 以具門市/員工範圍的 SQL COUNT 計算，不受列表 500 筆限制，涵蓋訓練未完成、待處理工作/叫貨/維修與逾期工作。
- 備份完整性納入 sessions/login_attempts 必要結構，但 fingerprint 繼續排除易變登入狀態。
- 逾期且截斷的普通鎖定檔可安全回收；活躍 PID 或尚未逾期則拒絕重入。
- v1→v2 migration snapshot 在目錄建立前重用 getPaths canonical containment，保護 symlink/Junction 祖先。
- openDb 失敗時確實關閉 DB handle；本機 Node22 npm run check：32/32 PASS，正式 Hosted CI 與 Codex 以最新 HEAD 為準。未經許可禁止 Merge。

## 2026-10-24｜Codex PR #1 v1 升級前完整 Schema P2
- v1→v2 在建立遷移快照前對照 db/schema.sql 的完整 v1 結構（17 張必要表、具名索引及 DDL 約束），拒絕缺少 sessions/login_attempts、必要索引/欄位與誤置的 v2 backup_settings。
- 不符合時保持 user_version=1，不建立備份目錄或資料庫更新；補上破壞性回歸測試。本機 38/38 PASS，Hosted CI 與最新 Codex Review 待核對，未授權禁止 Merge。


## 2026-10-24｜PR #2 與 PR #1 安全相容整合
- 將 PR #1 最新 v1 升級前完整性驗證、canonical 備份路徑、庫存核准驗收、期初庫存、Session 與 UI 修正帶入 v3 定價分支。
- 明確拒絕 stock.purchase 直接入庫；價格僅在核准單 order.receive 驗收時與 stock_moves 原子性寫入，保留歷史價格與毛利估算。新增對應價格回歸。
- 原 PR #2 Review 無 Findings，但舊分支與 PR #1 基底分歧且存在安全回退風險；本整合需以最新 HEAD 的 Hosted Ubuntu/Windows CI 和正式 Codex Review 再確認。PR #1/#2 均不合併至目標分支。

## 2026-10-24｜PR #2 跨版本測試修正
- Hosted Ubuntu Node22/24 首輪指出 4 項測試失敗：PR #1 v1 fixture 在 PR #2 v3 新庫未移除 v3 價格表，致 preflight 提早拒絕；另備份結構驗證的錯誤訊息正確但錯誤 code 斷言過嚴。
- 已修正測試 fixture 先移除 v3 價格表、保留需要驗證的 v2 部分升級表，並驗證缺表/缺索引的確切訊息；未放寬任何資料庫驗證或重新開放 stock.purchase。Hosted CI 須以後續 HEAD 為準。

## 2026-10-24｜PR #1 新 3 P2 同步至 PR #2
- 將 PR #1 最新唯讀 preflight（v1/v2/v3）、保留 SQL quoted literals 大小寫的完整 DDL 比對及備份 Schema 驗證整合至 v3；完整檢查 price/recipe 及登入欄位、具名索引。
- 新增 v3 備份破損欄位/索引、v1 quoted CHECK 與 WAL 無副作用回歸。仍禁止 stock.purchase 直接入庫，只有核准單 order.receive 原子寫入價格/庫存。
- PR #2 只同步相依分支 commit，未變更 PR base 或合併 PR；正式 Hosted CI/Review 需重新驗證最新 HEAD。

## 2026-10-24｜正式 Review P1／P2 修正（Session race / POSIX 備份權限）
- P1：HTTP `/api/command` 和 `/api/backups` POST 在 `await parse(req)` 後重新查 Session、角色與 CSRF，改用新的授權主體執行資料異動／稽核，防止慢速 body 期間被降權仍可異動。
- P2：`backup-acl.protect()` POSIX 分支在既有備份資料夾由 SQLite VACUUM INTO 寫入前套用並驗證 0700；檔案套用 0600。使用 O_NOFOLLOW + descriptor 防止 chmod 跟隨替換 symlink。migration 同樣在快照產生前執行 protect。
- 新增 HTTP 暫停 body 後撤銷 Session 的回歸測試，以及一般／升級備份預建 0755 目錄在 VACUUM 前必須變 0700 的測試。CI 與正式 Review 須以新 HEAD 為準，無授權不得 Merge。

## 2026-10-24｜PR #2 與 PR #1 HEAD 1551fb5 相容同步
- PR #1 最新 Head 正式 Codex Review 無重大 Findings，Hosted Ubuntu/Windows × Node22/24 4/4 PASS。
- PR #2 由於 PR #1 後續 auth race 與 POSIX 備份權限修正，已在本分支同步最新 server、backup ACL、HTTP regression；v3 備份測試沿用 PR #1 兩個 VACUUM INTO 前 0700 權限測試，並調整 v1 fixture 移除 v3 價格／配方表。
- 保留 v3 價格、配方、已核准單 order.receive 原子入庫/進價及 stock.purchase 禁止直接入庫；不變更 PR base，不合併至 main。
- 需以本次同步的新 HEAD CI 及正式 Codex Review 重新驗收，未經使用者授權不可合併。

## 2026-10-24｜Vercel Demo 菜單與成本功能（新 PR）
- 新增獨立 browser-only `pricing-demo.js`，以虛構歷史價及菜品配方計算跨門市材料成本、毛利、缺價和庫存估值，沿用現有 Mock API/sessionStorage，不連真實 SQLite。
- Demo 加入「菜單與成本」與「食材歷史價格／庫存估值」選單，允許新增價格、菜品、改售價、調整配方；核准叫貨後可驗收入庫並選填進價。
- 禁止過時 Demo `stock.purchase` 直接入庫操作；可對未有庫存的食材建立單次期初庫存，保留虛構資料警語和重設入口。
- 新 PR 須通過 Hosted CI、正式 Codex Review 及使用者 Merge 授權；Vercel Connector 此前對該 Team 回 403，正式部署仍須核對，不能提前聲稱已上線。

## 2026-10-24｜RB-015 Vercel 虛構智慧備份教學（新 PR）
- 依使用者要求，對 Vercel Demo 新增「系統管理 → 智慧備份示範」。`vercel-demo/backup-demo.js` 只保存模擬設定和版本 metadata 至 sessionStorage，`backup-demo-ui.js` 支援快轉下次到期、跳過未變更資料、手動版本、版本輪替及刪除；所有操作均明確標示無實際 SQLite、無下載還原、無背景排程。
- 新增 `/api/demo-backups` mock only，正式 `/api/backups` 與 SQLite 未更動。示範指紋以虛構營運資料序列化內容比較，不聲稱具備正式 SHA-256 快照完整性驗證。
- CI/Review/合併與 Vercel 實際部署需個別確認；未經授權不得 Merge。

## 2026-10-24｜本機版登入畫面 currentTarget null 修正（新 PR）
- 使用者提供本機 owner 登入截圖，錯誤 `Cannot read properties of null (reading 'reset')`。根因是 `public/app.js` 登入 submit handler `await api('/api/login')` 後才讀 `e.currentTarget.reset()`，瀏覽器事件 dispatch 結束後 currentTarget 已為 null，成功登入卻在前端拋錯。
- 在 await 前保存 `const form=e.currentTarget`，成功後 `form.reset()`；同步修正 Vercel Demo 共用程式碼。新增模擬真實 event.currentTarget 非同步失效的回歸測試；不更動登入憑證、Session、資料庫 Schema 或備份。Hosted CI／最新 Codex Review 需另驗收；無授權不得 Merge。

## 2026-10-24｜Owner 初始密碼遺失之本機復原工具（新 PR）
- 使用者反映首次 owner 隨機密碼只於第一次啟動視窗顯示，未抄寫即無法再次取得。密碼以 scrypt 雜湊儲存，不可反查；已有 Session 可在「變更密碼」設定新密碼。
- 新增僅本機互動式 `node tools/reset-owner-password.js`，使用 `DATA_DIR` 定位現有資料庫。執行前要求停止 Node 服務、鍵入 `RESET owner`。拒絕不存在或不可信 `.installed`／SQLite、非 v3 或 owner 非唯一有效等情形；先驗證備份，再交易更新 owner 密碼、撤銷其 Session／登入限流狀態並記錄不含密碼的稽核。
- 不新增任何可匿名呼叫的 Web password-reset endpoint、不修改正式 SQLite schema，也不可刪除既有資料。增加成功復原、非破壞性備份失敗／缺 DB／停用 owner 等回歸測試。正式 Hosted CI / Codex 審查與使用者 Merge 授權須以最新 SHA 為準。

## 2026-10-24｜RB-019 / RB-020 安全稽核來源 IP＋Excel 匯出／列印（新 PR）
- 使用者要求安全稽核 IP 欄，以及比照水電系統提供多工作表 Excel 匯出、特定資料列／欄位列印。
- `src/request-ip.js` AsyncLocalStorage request context，來源一律 socket.remoteAddress，絕不信任任意 XFF／X-Real-IP；預設 local loopback 127.0.0.1 而非外網 IP。audit detail 新增 source_ip，查詢投影 ip_address，登入失敗也留下；不變更 Schema，舊資料無法補 IP。
- `public/xlsx-lite.js` 沿用水電系統無套件 OOXML writer；`public/report-ui.js` 報表頁採既有角色與門市保護的 API 取得資料，支援單頁／多工作表、欄位與關鍵字／日期篩選及列印預覽；不等於全量歷史。
- 新增來源 IP／不可信標頭、RBAC、Excel ZIP/XML／欄位過濾回歸測試。CI／Codex Review／Merge 授權狀態依 Hosted HEAD。

- Vercel Demo 同步新增虛構 Excel／列印操作及測試用稽核 IP `192.0.2.20`，只用 sessionStorage 假資料，無真實帳號授權、SQLite／真實來源 IP；需確認 Vercel Preview／Production 獨立部署狀態。

## 2026-10-24｜PR #8 最新 Codex P2：共用電腦登出後殘留報表可遭 Ctrl+P 列印
- Hosted 最新 Review HEAD `4408efa` Completed 找出 P2：報表列印 CSS 隱藏登入遮罩但顯示舊 `#report-print-preview`，業主登出後共用電腦仍可印出稽核／人事資料。
- 修補本機正式版與 Vercel Demo：showAuth(true) 即清空 main、modal、S.cache／filter／身份，更新 authEpoch，對 body 設置 auth-locked；登出按下即開始 API 並同步鎖定畫面，回應失敗提醒伺服器登出未確認；print CSS 在 auth-locked 狀態一律隱藏 main／預覽，對殘留非同步 DOM 也 fail closed；匯出／列印非同步待命若權限階段變化即中止。增加 Node VM 回歸測試模擬共享終端 Ctrl+P 與登出未完成的非同步流程。仍須最新 Hosted CI、Codex Review，未授權不得 Merge。

- 2026-10-24 Codex 新 P2（HEAD 2b7f277）：舊 logout Set-Cookie 清除可能晚於新 login Set-Cookie，導致新登入 Session 被抹除。正式版與 Demo 新增 logoutInFlight Promise，登出按下同步清畫面／鎖定列印不變；新登入 submit 須先等舊登出請求完成才發送 /api/login，登出失敗亦不得永久卡住；加入 VM 延遲登出回應回歸測試。待 Hosted CI／Codex 複審。

## 2026-10-24｜多品項叫貨與供應商自動分單＋LINE 半自動草稿（新 PR）
- 業主提供先前系統三張畫面：員工盤點→自動整理叫貨→主管核准→依廠商分單→複製 LINE 文字或開啟分享，員工自行按送出。依官方 LINE 文件用 `https://line.me/R/share?text=`，不做自動傳送或假造已讀／已送狀態。
- 不更改嚴格版控的 v3 SQLite Schema：沿用 purchase_orders 每筆一食材，新的多品項群組以 `POB-<randomUUIDhex>-001` 等內部行號與共同 `POB-<randomUUIDhex>` 廠商主單號表示。原始舊單完全保留；同一供應商／門市的多行在交易內一併核准、取消、驗收入庫，逐行 reference_id 防重複，維持後端角色與門市 scope。
- 供應商建議源自門市最近有效歷史價格供應商；可明確覆寫，缺廠商須人工輸入，正式供應商主檔／自動推估安全庫存缺口／外部傳送回執後續可再擴充。
- 新 `src/order-batches.js`、`public/order-batch-ui.js`、`/api/order-batch` 及虛構 Vercel Mock。此為 PoC 功能，需實際 Hosted CI、Codex Review 與 Windows／LINE 操作驗收；未授權不可合併。

- PR #10 Codex 最新 HEAD 8d5ac3 3 個 P2：廠商預覽回應晚於登出可能重開敏感 modal，已於 start/preview/submit/action 檢查 authEpoch+userId；補貨建議等待 API 時若門市由 A 改 B，改成丟棄舊結果；Vercel Mock 新版整張驗收支援各行有效價格先完整驗證才變更庫存，失敗則還原虛構資料 snapshot，不會部分入庫。正式與 Demo UI 同步；補回歸後依最新 SHA 重新送 Review。

- 2026-10-24 PR #10 最新 Codex Review P2：整張批次驗收 UI 缺失逐項進價欄，導致不能如舊 `order.receive` 保留此次進價與庫存關聯；已在正式版和 Vercel Demo 共用 `order-batch-ui.js` 主管驗收視窗加入各行選填進價（元）、進價單位、生效日，送出 `prices[orderLineId]`；空白價不建進價，資料完整性由正式 backend 與 Demo 全張原子交易強制檢查。
- 同輪 P2：Vercel Demo 同日更換供應商的建議選錯舊廠商；供應商排序加入原始 `ingredient_prices` 陣列 index 的同日最新記錄 tie breaker，比照既有 `pricing-demo.js`。需針對最新 HEAD 重新驗證 Hosted CI 與正式 Codex Review，不可沿用舊結果。未授權不得 Merge。

- 2026-10-24 PR #10 Codex P2 (HEAD 98c869c)：`<input type=number>` 在使用者輸入未完成（如 `1e` 或 `-`）時可能 DOM value='' 而 validity.badInput=true，舊判斷誤當自願留空，造成庫存驗收成功但想填的進價未建立。正式與 Demo 先檢查 validity.badInput／checkValidity，再判斷真正空白才跳過，且驗價時再檢查單位／日期有效性；加入模擬瀏覽器 invalid field 及實際按驗收按鈕回歸，確保整張不送出 API。需重跑最新 Hosted CI 與 Codex Review，不得未授權 Merge。

## 2026-10-24｜PR #10 最新 Codex P2：重複快速提交多品項叫貨

- GitHub HEAD `caebe207` 的正式 Codex Review **Completed**，7 個 thread 中 1 個新 P2 未解：`public/order-batch-ui.js` 尚未阻止使用者在首次 `order.batch-create` 回應前連按兩次送出，導致後端建立兩張不同 UUID 的採購申請。
- 已在 `public/order-batch-ui.js` 及 `vercel-demo/order-batch-ui.js` 同步：提交事件一開始阻止重入，通過前端驗證後、發出 API 前同步設定 `submitting` 並 disable 按鈕；API 拒絕後才解鎖允許重試；API 已成功時保持鎖定，即使後續刷新列表失敗也不再重送。
- 新增 `tests/order-batch-double-submit.test.js`，使用 VM 非同步延遲回應重現連點、確認只有單次 API，失敗可重試；成功後刷新失敗亦不可重送。程式＋測試 HEAD `4f8cf235f03f6a731301a7e22927bffd23ff2056`，**不得以其前代 `caebe207` 的 Hosted CI PASS 代表新 HEAD PASS**。
- 後續：查最新 HEAD Ubuntu／Windows Node22/24 Hosted CI；對新 Finding 回覆與 Resolve；提交最新 HEAD 的正式 Codex 複審，確認是否有新 P1/P2。Vercel Preview 目前每日部署額度失敗，與 GitHub CI 分開看。PR #10 仍 Draft，沒有 Merge 授權，Windows／LINE 真人操作未驗收。

## 2026-10-24｜PR #10 新 P2：舊叫貨請求清空新草稿視窗

- 最新已核實 Codex Review：HEAD `2c31530c818b01c47f54bbfaebf4ae9742c7b8fd` **Completed**，新 P2：送出舊叫貨表單後，若在 API 回應前取消、再開啟新表單，舊 API 成功會誤用共用 `#modal-root` 清空新草稿；Review Thread `PRRT_kwDOVUuF1c6v5B4c`。
- 已針對 `public/order-batch-ui.js` 與 `vercel-demo/order-batch-ui.js` 在 submit closure 捕獲實際 DOM form；API 成功、失敗或驗證錯誤時要求 `ownsModal()`（帳號／epoch 未變、modal 可見且當前 form identity 相同），只允許原表單被關閉／解鎖／提示。舊請求仍可能在後端建立單據，這項修正只防止舊結果毀損新 UI，**不宣稱網路請求已取消**。
- 新增 VM 重現：舊表單送出後關閉再建立新草稿，舊成功不得清除新表單；舊失敗不得解鎖或顯示舊錯誤；最新表單仍可提交成功。測試涵蓋正式與 Demo。新 HEAD 的 Hosted CI／正式 Codex Review 待依提交 SHA 核實；前版 PASS 不代表新 HEAD PASS。
- PR 仍 Draft、未經使用者授權不可 Merge；Windows 與 LINE 真機操作、Vercel Preview 部署仍待另行驗收。

## 2026-10-24｜PR #10 新 Codex P2：整張狀態操作與補貨建議須綁定原 modal

- Review HEAD `3bd2bb8d0f13ca156eff7232c6d427ef00770256` **Completed**，新兩項 P2：`PRRT_kwDOVUuF1c6v5Hm4` 舊「主管核准／整張狀態操作」回應可能清空後開的新叫貨草稿；`PRRT_kwDOVUuF1c6v5Hm5` 舊補貨建議在同門市重新開表單後可能填入新草稿。兩者皆在正式版與 Demo 可重現。
- 已在兩份 `order-batch-ui.js` 新增來源 modal instance 檢查：補貨回應先比原 `#batch-form` 實例，再比門市；整張狀態操作回應須比原 `.order-batch-modal` 實例，登入 epoch／帳號亦不變，才可清除畫面及更新 UI。舊失敗亦不能覆蓋新視窗提示。
- 新 `tests/order-batch-modal-lifecycle.test.js` 以 VM 延遲 API 模擬主管核准成功／失敗與舊庫存回應跨表單污染、驗證新視窗保留輸入；`tests/order-batches.test.js` 同步補齊既有進價輸入測試的 modal element 模擬身份，不放寬價格驗證。
- 初版測試 HEAD `95c16db` CI Ubuntu Node22/24 數字價格既有 fixture 失敗（模擬 modal 無實例），已於 `31f317fb` 調整測試；最終 Hosted CI 及正式 Codex 複審**尚須以最新 HEAD 重新核實**。不得沿用前代 PASS。
- PR #10 保留 Draft／OPEN，未經使用者授權不可 Merge。LINE 真機與 Vercel Preview 實站仍未驗收。

## 2026-10-24｜PR #10 P2：初始 GET 開窗覆寫較新的叫貨草稿

- 最新 Codex Review（HEAD `91826043f021485f6c028d85560d3597393a7970`）已 **Completed**，新增一個 P2：`PRRT_kwDOVUuF1c6v5QmB`。舊 `preview()` 的初始 GET 等待回應期間，使用者已 `start()` 開啟新草稿，舊 GET 回來仍會 `show()` 覆蓋新表單；既有 `ownsPreview()` 只保護預覽建立後的狀態 API，不能攔截這條路徑。
- 已修改正式版與 Vercel Demo 的 `order-batch-ui.js`，共用模組內 `openGeneration`，`start()` 與 `preview()` 在登入權限確認後同步取得下一個 generation；所有初始 GET 回應必須確認仍為最新 generation 及原登入主體，才可 `show()`，避免舊預覽／舊建單要求蓋掉新表單。原有表單提交、主管操作、補貨建議 DOM identity guards 保留。
- 新增 `tests/order-batch-opening-generation.test.js` VM 延遲 API 回應，雙版測試（1）舊預覽 GET 晚於新建單表單、保留數量與供應商；（2）舊建單 GET 晚於新預覽；（3）兩次預覽 GET 逆序回應時只顯示最新預覽。修正程式與測試已提交至 `dd50fea7e03ea12ea63357cad9ee173c8b12aedc`，該 HEAD Hosted CI 仍須完成最後核實。
- 此修補僅阻止舊回應改動新 UI，不聲稱已取消發出的 HTTP 請求。新 SHA CI 完成後需回覆／Resolve 原 P2 並正式複審。PR 仍 Draft、未授權禁止 Merge；Vercel Preview／LINE 真機操作未驗收。

## 2026-10-24｜PR #10 最新 Codex P2：舊廠商預覽覆蓋既有單品項表單

- Review HEAD `01e93916cf665f00f135552f49317e5a5b16c98e` 正式 **Completed**，新增 P2 `PRRT_kwDOVUuF1c6v5U8r`：舊 `OrderBatchUI.preview()` 初始 GET 尚在等待時，使用者開啟原有 `app.js showForm('order.create')` 單品項叫貨表單並填寫，因該入口未增加批次模組的 `openGeneration`，舊回應仍覆蓋共用 `#modal-root`，導致資料遺失；正式／Demo 皆可重現。
- 已在正式及 Demo 共四個 UI 檔改用 DOM 根節點共用 `__openTicket`：`order-batch-ui.js` 的 start/preview 在 await 初始 GET 前 claim ticket，回應後比對；`app.js showForm` 在 await getLists 前先 invalidate ticket，回應後比對 ticket/登入 epoch/帳號才開窗；原兩版 modal Close／背景關閉、auth overlay 清空視窗時同步 invalidate，防止已關閉後舊 GET 再開啟。保留既有 DOM identity guard，沒有變更交易或權限。
- 新增 `tests/order-batch-shared-modal.test.js`，使用兩版真實 `showForm()` 函數與真實 OrderBatchUI VM：舊批次預覽 GET 延遲→原有單品項表單開啟且其輸入保留；舊單品項 getLists 延遲→新批次預覽成功且不被舊表單覆蓋。代碼 Commit `0d9e5b65`，測試補至 `9fbda867`。需用**最後 HEAD** 核對 Hosted Ubuntu/Windows Node22/24 CI，再正式回覆/Resolve P2 並重送 Codex Review，不能沿用先前 Completed。
- PR #10 繼續 Draft，未取得使用者明確同意不得 Merge；Windows 真機及 LINE 人工流程仍待驗收，Vercel Preview 部署限額需另查。

## 2026-10-25｜D1 首輪基礎建設（RB-023，等待 CI／Review）
- 已核對 PR #12 合併後的 `main`；Cloudflare Preview 基礎路由可用，正式 API 仍 Demo-only，未綁定 D1。
- 新分支 `feat/cloudflare-d1-foundation-20261025`：以現有 SQLite v3 Schema 轉換 D1 初始 Migration，禁止 `IF NOT EXISTS` 掩蓋非空資料庫，保留 FK/CHECK/index、建立 `cloud_schema_contract`。不匯入真實資料、不建立預設 owner、不改本機 SQLite。
- 增加 D1 只讀結構探測，只有 DB 綁定時檢查 Schema，仍一律 `production_ready:false`；提供正式／Preview 分離綁定設定範本、Migration 操作 SOP、Node SQLite parity/FK/拒絕重複初始化測試。
- 使用者已建立正式 `restaurant-business-prod`（ID `b882a6e8-0e56-49a6-bd41-1a6cadd726c9`）與測試 `restaurant-business-staging`（ID `2c355bed-d9c3-449c-aa9b-1018f3bc1177`）D1。PR #13 已提交根目錄 `wrangler.jsonc` 正式/Preview 分離綁定、`wrangler.preview-migrations.jsonc` 僅 staging 的遷移設定、綁定隔離回歸和安全 SOP。**沒有遠端執行 Migration 的 Cloudflare 帳戶操作權限**，也尚未完成真實營運 API、Google Drive 備份或業主登入。新 HEAD Hosted CI／Codex Review 尚需確認、不得未授權 Merge。

## 2026-10-25｜GitHub Actions staging-only D1 Migration 工作流
- 在 PR #13 新增 `.github/workflows/d1-staging-migration.yml`（workflow_dispatch ONLY，限制 main、必填 `APPLY_STAGING_ONLY`、Environment `d1-staging`），並新增 `tools/check-cloudflare-staging.mjs` 只讀 preflight 及 migration 後完整性校驗。
- 使用者正在設定 Cloudflare Token / GitHub Secrets；**不能宣稱已確認 Token 存入 GitHub，亦不能宣稱 workflow 或遠端 D1 migration 已執行**。
- Workflow 確認 Cloudflare 帳號 ID 和兩個不同 D1 UUID；preflight 拒絕 staging 既有任何使用者 table/d1_migrations；僅對 STAGING_DB 執行 migration，後測 v3 contract、表集合、FK 及無 owner。環境審查規則需 GitHub Settings 額外設定才會生效。
- 本次 Commit 後需以最新 PR HEAD 驗證 Hosted CI／Cloudflare Preview 與正式 Codex Review；PR #13 尚未經使用者授權 Merge。正式 D1 不可自動 Migration。

## 2026-10-25｜PR #13 最新正式 Codex P1 `_cf_KV`
- 使用者已在 GitHub 建立 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 兩筆 Secrets（值不讀取、不能聲稱 API 存取已驗證）。
- 正式 Codex Review HEAD `4e914e7` Completed 發現 P1：新建立 D1 預設包含系統保留表 `_cf_KV`；staging Migration preflight/postflight 僅排除 `sqlite_%` 會誤判空庫／Schema 不符。
- 已在 `.github/workflows/d1-staging-migration.yml` 的前後兩個只讀 SQL 查詢排除 `_cf_KV`，`tools/check-cloudflare-staging.mjs` 統一只過濾此精確系統表（不過度排除未知表、保留 d1_migrations 非空拒絕），測試增 `_cf_KV` 單獨存在、與業務表/ledger 並存及未知表。後續必須檢查最新 HEAD CI、Cloudflare Preview、正式 Codex 複審，處理 Findings 並確認後才可請求使用者 Merge；**目前未執行遠端 Migration**。

## 2026-10-25｜RB-025 Cloudflare 認證基礎（尚未合併）
- 2026-10-25 staging D1 Run #40172089719 遠端 Migration `0001_initial_v3.sql` 成功，30 SQL commands + `STAGING_ONLY_VERIFY_PASS`；使用者實測 Preview `schema_only`，正式 D1 未移轉。
- 新分支 `feat/cloudflare-auth-foundation-20261025`：`cloudflare/auth-core.mjs` WebCrypto PBKDF2(600k SHA-256, 16-byte salt) 測試用密碼介面、Host-only Session Cookie 與 SHA256 token、Session expiration/user.active、Origin/CSRF 檢查、Owner/Manager/Staff + active locations 範圍；`cloudflare/identity.mjs` 唯讀 `GET /api/me`，僅 Worker Preview `CLOUD_AUTH_PHASE=preview-readonly` 可用，Production `disabled`。其他 login/logout/command API 仍 503，沒有啟動真實密碼 API 或任何 schema 變更。
- 既有 Node `scryptSync` 密碼不可直接當 PBKDF2 使用；Workes Free CPU 10ms 限制及未來密碼初始化、登入限流／稽核要另驗測。下一步為 PR Hosted CI、正式 Codex Review、修 Findings，使用者明確授權才 Merge。

## 2026-10-25｜PR #15 staging D1 單次 Owner 建立（STAGED，未執行）
- PR #14 `afd5ac01` Codex Code Review Completed / 無 Findings，CI 4/4 PASS、Preview Build/Deployment PASS；仍 OPEN Draft，使用者只說「繼續」，未授權 Merge。
- 為避免阻塞後續業主登入，另開 Stacked PR #15 分支 `feat/cloudflare-staging-owner-bootstrap-20261025`，基於 PR #14：人工核准 GitHub workflow `d1-staging-owner-bootstrap.yml`，新 `tools/cloudflare-staging-owner.mjs` 及獨立回歸測試；命名 `STAGING_OWNER_PASSWORD` 的環境 Secret 尚未要求使用者設定，切勿貼入聊天或 repo。
- 僅在已初始化 v3、無使用者與營運紀錄之 `restaurant-business-staging` 才可產生第一位 Owner，驗證唯一 active owner / FK，絕不操作 production D1 或把明文／密碼 hash 放入 GitHub logs；此工作流程目前未執行。
- 修正 `tools/check-cloudflare-staging.mjs` 被其它工具 import 會意外執行 CLI 的副作用，改 direct-script guard。
- Cloudflare Workers Free HTTP CPU 10ms；PBKDF2 600k 是否適合 Worker 需另行真機測試，不能把 Github Runner 生成成功當成正式 Login ready。PR #15 必須以最新 Hosted CI、Preview、正式 Codex Review 驗證，待使用者分別授權 Merge #14 與 #15，再由使用者手動觸發 Owner 初始化。

## 2026-10-25｜staging Owner 初始密碼下限改為 12 字元（獨立 PR，未合併）
- 使用者明確要求將 staging Owner 一次性初始化的 `STAGING_OWNER_PASSWORD` 最小長度由 20 改為 12（上限維持 256），不是放寬至 8；原雲端 `cloudflare/auth-core.mjs` 的密碼雜湊函式本來就要求 12～256，不需修改正式 Worker 登入（目前仍停用）。
- 新分支 `fix/staging-owner-password-min12-20261025` 修改 `tools/cloudflare-staging-owner.mjs` 的輸入下限與錯誤訊息、`tests/cloudflare-staging-owner-bootstrap.test.js` 邊界測試（8/11 拒絕、12 可生成和驗證、257 拒絕），同步更新 `docs/Cloudflare-D1-staging-初始業主建立.md`。不改 schema、Cloudflare prod/staging D1 綁定、Workflow Secrets 或 SQL 空庫防護。
- PR #14、#15 已取得授權並已合併；staging D1 Schema Run #40172089719 已驗收，但**staging 初始 Owner 尚未被遠端建立，也未執行一次性 Bootstrap Workflow**；任何 PR 待最新 Hosted CI / 正式 Codex Review 與使用者明確 Merge 授權後才可合併。不能將這次程式修改視為密碼已經設定或資料庫已經初始化。

## 2026-10-25｜RB-028 Cloudflare 登入服務內部階段（開發中、不可對外）
- 已核對 GitHub：PR #14/#15/#16 均 MERGED；staging D1 Owner Bootstrap workflow_dispatch Run #40188578478 經實際日誌證實 `STAGING_OWNER_PREFLIGHT_PASS`、`WRITE_SQL_PASS`、`VERIFY_PASS`，遠端 STAGING_DB 有一位 active Owner、無 Session；Production D1 沒有執行 migration。
- 分支 `feat/cloudflare-d1-login-security-20261025` 新增 `cloudflare/login-service.mjs`：D1 單語句原子 `INSERT ... SELECT COUNT` 限流（per-user 8/per-source 32、15 分鐘）、PBKDF2 600k dummy KDF 以減少 username 枚舉時差、登入失敗/成功 Audit、成功 Session SHA-256 + CSRF + 8 小時 Secure Host-only Cookie，D1 batch 同時寫 Session/成功 Audit/嘗試標記且 guard 帳號活動/密碼雜湊變動。登出需要 HTTPS Origin + CSRF + 有效 Session，再 batch 撤銷 Session 與 Audit。來源 HMAC digest 只讀 CF-Connecting-IP，拒絕 X-Forwarded-For、缺 Pepper。
- 新增 `tests/cloudflare-d1-login-security.test.js` 使用 Node SQLite v3 執行實際 SQL 模擬 D1，測正確/錯誤帳密、停權/不存在、SQL 限流、密碼更換的 race、D1 batch rollback、CSRF/跨來源與已停用公開 API；另有部署阻擋文件。
- **尚未接上 Worker 公開路由**，本 PR 沒有任何遠端 D1 寫入、Cloudflare Secret 變更、Migration 或正式登入上線。Cloudflare Workers Free 的 CPU 10ms 對 PBKDF2 600k 未在真機驗證，Preview 網址公開且共用 staging DB，所以嚴禁公開接收真實 Owner 密碼。下一輪需先實測/隔離，不能把 CI PASS 當成可正式登入。Hosted 最新 HEAD CI、Cloudflare Preview、正式 Codex Review 和未授權不得 Merge 規範繼續適用。

## 2026-10-25｜PR #17 Codex P2：索引/清理修正（最新 HEAD 待 CI 與正式重審）
- 最新正式 Codex Review 前一版 `fe43a9ad` Completed，有 1 項未解 P2：登入限流 `username COLLATE NOCASE` 與舊 BINARY 索引不匹配，`ip_hash` 缺複合索引，且登入嘗試紀錄沒有過期清理；上一輪 CI PASS 不能當成新 HEAD 驗收。
- 已新增 `cloudflare/migrations/0002_login_attempts_window_indexes.sql`，只加 `(username COLLATE NOCASE, at)`、`(ip_hash,at)`、`(at,id)` 三組索引；保留已經安裝於 staging 的 v3 `0001` 原樣，**無遠端 D1 Migration 或資料寫入**。D1 ledger 後續須走人工核准的既有庫增量流程，不可重跑只允許空庫的 `d1-staging-migration.yml`。
- `cloudflare/login-service.mjs` 提取共用 `LOGIN_RESERVATION_SQL`，新 `pruneExpiredLoginAttempts()` 以 7 天保留/每批最多 500 筆之 SQL 清理（不刪 Audit）。**尚未設立 Cron、未對遠端 staging/prod 自動清理**；待 staging 0002 套用、真機驗證與後續安全部署批准。
- 新 `tests/cloudflare-d1-login-indexes.test.js` 讀 D1 0001+0002，在 Node SQLite 以 `EXPLAIN QUERY PLAN` 驗證兩條 15 分鐘限流子查詢和清理均有對應索引，測既有 Owner 不變、分批刪除舊登入嘗試不影響 Session/Audit、批次上限。須等最新 Head Hosted Ubuntu/Windows Node22/24 CI、Cloudflare Preview、正式 Codex Review，再修 Findings；使用者尚未授權合併。

## 2026-10-25｜D1 staging 0002 安全增量部署（PR 開發中）
- 最新 Hosted GitHub PR #17 已 merged，僅 `cloudflare/migrations/0002_login_attempts_window_indexes.sql` 合併，**沒有套用 remote staging/prod**。Run #40188578478 建立一位 active staging Owner 且驗收 PASS，切勿重跑原先空庫專用 `d1-staging-migration.yml`。
- 新分支 `feat/d1-staging-0002-incremental-20261025`：新增 `tools/cloudflare-staging-0002.mjs`，對帳戶/正式與 staging D1 ID、兩檔 Migration 清單、0002 只含三項 CREATE INDEX、遠端 ledger 必須只有 0001、staging v3 完整表集合、恰一 active Owner、零 FK 錯、0002 未套用作嚴格 preflight；若 Apply，postflight 檢查 ledger 正確新增 0002、索引 DDL 一致及 Owner/Schema 前後未改動。
- GitHub Workflow `.github/workflows/d1-staging-incremental-0002.yml` `workflow_dispatch` only、main + 精確輸入、Environment `d1-staging`、與舊 staging schema migration 共用 concurrency group、Wrangler 4.152.0 固定、機密不傳入 npm install。預設動作 `CHECK_STAGING_0002` 只讀；`APPLY_STAGING_0002` 需獨立授權與人工觸發。
- 新 `tests/cloudflare-staging-0002-migration.test.js` 以 D1 0001 模擬已建立 Owner／ledger，回歸部分套用、錯庫、owner 缺失、遷移污染、postflight 確認。紀錄於 `docs/Cloudflare-D1-staging-0002-安全增量遷移.md`。
- 此 PR 不能聲稱已對 D1 做任何操作。正式登入仍關閉，Workers 真機 PBKDF2 600k CPU/受保護 staging 還未完成。須 Hosted CI、Preview、正式 Codex Review 完成，使用者授權才 Merge。

## 2026-10-25｜PR #19 Codex P1/P2 修正與實際 workerd HTTP 回歸（持續審查）
- Hosted PR #19 原 HEAD `1f1b49d00053ea53e6eb8258d7fc678c404f176f` 正式 Codex Review Completed 有 **P1 1 項、P2 1 項**：P1 workerd 接受零內容 POST 時仍可能有 `request.body` stream，原本會誤回 400；P2 Wrangler `dev --local` 會自動載入 source checkout 的 `.env`/`.dev.vars`，原 ENV allowlist 不足以隔離 Secrets。
- 修正 P1：`cloudflare/pbkdf2-local-probe-worker.mjs` 將真實零位元組 Content-Length: 0 的可讀串流與非空請求區分，只檢查第一個 stream chunk 是否立即 done；Content-Length 非 0／不明串流／Authorization／傳輸編碼等一律 fail-closed。新增直接 Request 零內容 stream／偽裝非空內容測試。
- 修正 P2：`tools/pbkdf2-workerd-sandbox.mjs` 建立權限限制的私有隨機 tmp 專案，只將 review 過的 `auth-core`、probe、probe Worker 與無遠端 bindings 的 config 複製入；Wrangler 的 cwd/config/HOME/TMPDIR/XDG_CONFIG_HOME 都在暫存目錄；限制環境變數正向白名單且關閉 dotenv。回歸以 `.env`、`.dev.vars` canary 驗證 Secret 不會複製進沙箱。
- `tools/run-pbkdf2-local-workerd.mjs --smoke` 新增真實 loopback HTTP 傳輸測試（POST 零內容應回 200、帶內容或 Authorization 應回 400），單組合成 KDF。GitHub `.github/workflows/verify.yml` 增加 Ubuntu 24 的 `pbkdf2-workerd-http-smoke`，已在本輪早期 Run #40207616103 看到此專用 Job SUCCESS；**後續仍須以最終 HEAD 重新核對全部 CI**。
- 以上皆為本機 synthetic workerd wall-clock，**不是 Cloudflare Hosted CPU 毫秒測試**。不讀真實 Owner Secret、不連 D1、不開放 /api/login。需依最新 SHA 正式 Codex 複審、修 Findings、未授權不 Merge。

## PR #20｜2026-10-26 Codex P2 Hosted performance.now 凍結問題修正（待複審）
- 原 HEAD `e99940821819ea2a6b2be27fa9672894a9ff0383` 的正式 Codex Review Completed，1 項 P2、Review Thread `PRRT_kwDOVUuF1c6wCyy9`：Hosted `performance.now()` 在無 I/O 時可能不前進，舊 `wall_ms` 可能誤報 0；Node 本機時鐘測試無法證明真實 Hosted wall-time。
- 已更新 `cloudflare/pbkdf2-hosted-synthetic.mjs` 移除 clock 參數／`performance.now` 差值；`cloudflare/pbkdf2-hosted-access-worker.mjs` 的回應和自訂 log 不再含任何 CPU/Wall 計時欄位；保留 `probe_id` 及操作，用於比對 Cloudflare 平台 invocation logs 的 `$workers.cpuTimeMs`、`$workers.wallTimeMs`、`$workers.outcome`。
- `tests/cloudflare-pbkdf2-hosted-access.test.js` 新增凍結 `performance.now()` 為 0 的回歸，逐一驗證 hash／verify-correct／verify-wrong，應無任何偽計時欄位。
- 此修正不表示已取得 Hosted CPU 實測，不允許自動部署遠端 Worker、變更 D1 或開啟登入。最新 HEAD Hosted CI、正式 Codex Review 和 Thread Resolve 均待核對；未授權不 Merge。

## 2026-10-26｜PR #21 初輪 Codex P2 × 2 修正（最新 HEAD 複審待辦）
- PR #21 原 HEAD `ef0e833d98b644a28088ea8349108abfbd7732f8` 正式 Codex Review Completed，但 2 項 P2、未解 Review Thread：`PRRT_kwDOVUuF1c6wC--v` 守衛只靠文字正規式、可能 `if(false && guard)` 停用仍 PASS；`PRRT_kwDOVUuF1c6wC--0` GitHub Workflow 委派 `bash tools/deploy-probe.sh` 時只看 YAML 可能漏報。
- 已新增 `tools/cloudflare-hosted-probe-approved-sha256.mjs`，鎖定兩支 Hosted probe Source、五個 GitHub Workflows、現有 `tools/` 已審核委派可執行入口與 `package.json` 的完整位元組 SHA-256。靜態 preflight 先驗證完整內容，再檢查配置與執行防護；未知 Workflow、未知 `tools/` 執行檔、`.github/actions` local Action 皆 fail-closed。編修經白名單批准的可執行檔必須由獨立 Code Review 檢查差異並更新 checksum，不能自動重算放行。
- `tests/cloudflare-hosted-probe-preflight.test.js` fixture 擴充：保留原始 regex 字串的兩種 `false &&` 守衛繞過、委派部署 YAML/new script、改既存 Workflow、改既存委派腳本、新 Composite Action，全部預期拒絕。CI 須以最終 HEAD Ubuntu/Windows Node22/24 + workerd smoke 成功核對。
- 沒有更動正式 Worker、Cloudflare Access、遠端 D1、登入 API 或真正 Hosted CPU 探針；靜態 PASS 不等於 live Access 驗證。原 Review Threads 待修正回覆、正式 Codex 複審及確認後才能 Resolve。未經使用者授權不可 Merge。

## 2026-10-26｜PR #21 第二輪 Codex P2：傳遞相依閉包修正

- 最新正式 Codex Review 對 HEAD `1457286bee211c574e2605ae8bdc9c1622792685` Completed，新增 1 項 P2，Review Finding `4373190686`、Thread `PRRT_kwDOVUuF1c6wG2RM`：`tools/cloudflare-staging-owner.mjs` import 的 `cloudflare/auth-core.mjs`、以及 `npm run check` 直接執行的 `tests/*.test.js` 未納 SHA-256，僅篡改傳遞模組仍會 PASS。
- 已於 PR #21 原分支擴大 `APPROVED_TRANSITIVE_DEPENDENCIES_SHA256`，鎖定 `cloudflare/`、`db/`、`public/`、`src/`、`tests/`、`vercel-demo/` 全部當前原始碼/資產與根目錄執行／Wrangler 設定；原 Worker Source、五個 Workflow、`tools/` 和 package.json 繼續釘選。資料夾與根目錄執行檔均封閉清單；不只 regex、也非只鎖最上層入口。
- `tests/cloudflare-hosted-probe-preflight.test.js` 新增篡改 `auth-core.mjs`、其他傳遞載入模組、現存測試檔／SQL／前端程式、以及新增來源檔與新測試入口的 fail-closed fixture。檢查器先發現 digest 變更時可回傳 `E_UNREVIEWED_TRANSITIVE_DEPENDENCY`，故同步調整舊測試對拒絕錯誤碼的預期，惡意內容仍須被拒。
- 以上屬**程式碼與靜態 CI**，並非 Cloudflare 遠端 Hosted CPU 實測。最新 HEAD Hosted CI／Codex 複審和 P2 Thread Resolve 均要再次核實。未經使用者明確授權不得 Merge、Cloudflare 部署、Access 變更或操作 D1。

## 2026-10-26｜PR #21 第三輪 Codex P2：根目錄 .npmrc 注入缺口

- 正式 Codex Review 已對舊 HEAD `a6e00bff0f47572ab1835577d8838637606473e1` Completed；新 P2 Finding `4373339968`、Thread `PRRT_kwDOVUuF1c6wHNCT`：未審核的根目錄 `.npmrc` 會被 npm/npx 讀取，`node-options=--import=...` 可注入額外執行程式，但原本僅按副檔名篩選的 root 閉包會漏過。
- 本輪在 `tools/cloudflare-hosted-probe-preflight.mjs` 對根目錄任何 `.npmrc`（含空檔案）明確 fail-closed（`E_UNREVIEWED_NPM_CONFIG`）；`tests/cloudflare-hosted-probe-preflight.test.js` 加入只建立該檔的 `node-options`、`script-shell` 與空檔負向 fixture，沒有執行 payload；更新人工審核的該測試檔 SHA-256 指紋，其餘 approved digest 不變。
- 此修正只能驗證 PR checkout 的靜態檔案，**不會認證 runner 主機/npm 全域設定或遠端 Access**；必須依最新 HEAD 確認五個 Hosted CI Jobs 與正式 Codex 複審，並處理 Review Thread。未經使用者授權不得 Merge、Cloudflare 部署、Access 變更、D1 寫入或公開登入。

## 2026-10-26｜PR #21 第四輪 Codex P2：Windows .npmrc 大小寫變體

- 最新正式 Codex Review 已對 HEAD `032eee62d3f241a6c2a4525766f80a5e85887e8f` Completed；新增 P2 Finding `4376481803`、Thread `PRRT_kwDOVUuF1c6wOxWz`：根目錄 `.NPMRC`／`.npmRc` 在 Windows 不區分大小寫檔案系統中可被 npm 當作 `.npmrc` 讀取，但原本 `includes('.npmrc')` 會忽略，導致離線 preflight PASS。
- 已改為 `fs.readdirSync(root).some(name=>name.toLowerCase()==='.npmrc')`，所有大小寫變體與空白變體均 fail-closed；在原本 `.npmrc` 的三項 regression 外另加入 `.NPMRC`、`.npmRc`、`.nPmRc` 測試，僅建立 fixture，不執行可能注入的設定內容。更新唯一有變更的測試檔 SHA-256 白名單，不自動重新信任其他原始碼。
- 此為靜態程式與回歸測試，不是 Cloudflare Access 遠端驗證、Hosted CPU 測試或部署授權；須依新 HEAD 驗證 Hosted CI 五項與正式 Codex 複審、在 Thread 回覆。仍不允許未經使用者授權 Merge、部署 Cloudflare 或操作 D1。

## 2026-10-26｜PR #21 第五輪 Codex P2：在首次 npm/npx 執行之前安全預檢

- 最新正式 Codex Review 對 HEAD `d91a935f5b98c66599b988aab369268674ac9e59` Completed，新增 P2 Finding `4379430230`、Thread `PRRT_kwDOVUuF1c6wV0jz`：Verify workflow 在 `npm run check` 後才執行靜態 preflight；未審核 `.npmrc` 可在 npm 先執行惡意程式後自行刪除，造成其後掃描 PASS，安全檢查時序無效。
- 本輪將離線安全 preflight 移到 Verify Node22/24 Windows/Ubuntu test 的 `npm run check` 之前，也在 Verify 的 local workerd smoke Job 與四個 `workflow_dispatch` 專用 Workflows（D1 staging migration、staging owner bootstrap、incremental 0002、PBKDF2 local workerd）的 Node setup 之後、任何 npm/npx 或委派工具之前加入獨立 `node tools/cloudflare-hosted-probe-preflight.mjs` 步驟。
- 擴充測試，逐 Job 驗證實際 workflow 步驟順序與獨立 Node preflight（共六個 npm/npx Jobs），另有交換 npm/preflight 順序後必須失敗的負向 fixture；未執行注入 payload，也不執行任何遠端 API。人工同步更新五個 Workflow 與單一測試檔 SHA-256 allowlist，其他指紋不變。
- 需於新 HEAD 核對 Hosted CI、正式 Codex 複審並回覆 Finding；仍禁止未獲用戶授權的 Merge、Cloudflare 部署、Access/D1 更動或 Hosted CPU 開啟。此靜態保護並不等於遠端 Access 驗證。

## 2026-10-26｜PR #21 Codex 補充：具名 run 與 Windows CRLF

- 上輪正式 Codex Review 對過程 HEAD `1a000f677f4241c371882a2c8d7a841c905d8ac6` 完成，新增兩個 P2 Findings `437986...`（依新 Threads 的實際 ID）指出 Workflow 順序測試：`run: npm ...` 解析遺漏，以及 Windows CRLF 與測試內固定 LF 不一致。
- 已在後續 Commit 將 `run: npm/npx` 具名步驟也納入掃描，使 5 個 Workflow 共 6 個 Jobs 確實統計；本輪於 `assertOrder` 入口與 verify fixture 均正規化 CRLF→LF，增加每支 Workflow CRLF 模擬與顛倒步驟後仍拒絕的 CRLF 負向回歸。同步手工更新新增測試的 SHA-256，其餘 approved workflow hashes 不變。
- 尚需核對最終 HEAD Hosted CI 與正式 Codex Review。未 Merge，不啟動遠端 Cloudflare、Access 或 D1。

## 2026-10-27｜PR #21 已合併、RB-034 私人證據表單離線稽核

- **主線已驗證**：PR #21 Squash Merge `85f055e745931b280818b9fdad0c1cb9b4ea1833`，合併後 push CI Run #40375126939 completed/success 5/5。安全 Workflow 首次 npm/npx 前執行固定 Node preflight；正式 Codex Review（最後 PR HEAD `7da292aa56`）無新重大問題、八個歷史 Threads 已 Resolve。
- **本輪 RB-034 開發內容**：`tools/hosted-access-evidence-audit.mjs` 離線查核私人 JSON 結構／指定獨立 Worker／十二條 Access/URL/Policy 人工勾選條件、48h 時效；新增無真實資訊的樣板與負向回歸測試。工具不連 Cloudflare、不讀 Token、不部署、不印私有值，完成表單時仍固定 `live_cloudflare_access_verified:false` 和 `deployment_authorized:false`。證據應放 Git Repo 外，不能寫入 Public Repo。
- **SHA-256 管控**：新 tools 程式與新 tests 檔案須由人核對並加入既有固定 SHA-256 清單；其他已審核 digest 不變。PR 最新 CI/正式 Codex Review 未完成前不可報為已驗收或 Merge。
- **後續**：具權限管理員須獨立在 Cloudflare 後台查核 Worker-level Access All traffic、host/path 優先級、Bypass、Version/Preview/Deployment URLs，將證據保留私下；使用者另行授權前不部署 dedicated Worker、也不操作遠端 Access/D1/Hosted CPU。

## 2026-10-27｜RB-034 Windows CI 跨磁碟來源路徑誤拒

- 初版 PR #22 HEAD `2e100e8875f40d808ab67b70b96097d83962d2df` Ubuntu22/24、workerd smoke PASS，但 Windows Node24 Run #40376870321 在 CLI 私有暫存檔測試中失敗，因 Runner checkout 在 D:，`os.tmpdir()` 可能位於 C:。Windows `path.relative(D:, C:)` 返回絕對目標路徑，不是以 `..` 開頭，原程式誤把非 Repo 檔案當成 Repo 內部。
- 對字串路徑與 realpath 雙重查核都改由 `isOutsideRepository()` 統一判斷；跨磁碟時 `path.isAbsolute(relative)` 視為外部，子路徑仍拒絕。新增 win32 跨磁碟、Repo 內、相鄰目錄、同前綴目錄及 Repo 根路徑的負向/正向回歸。同步人工更新**僅兩個變更檔**的 SHA-256 白名單。
- 必須按新 HEAD 核對 Windows/Ubuntu Node22/24 Hosted CI 與正式 Codex Review；仍無遠端部署或 Access/D1 操作。

## 2026-10-27｜PR #22 主線合併與 RB-035 離線 CPU 平台日誌摘要

- PR #22 已成功 Squash Merge 至 main：`324677783fc1fedb90023c4f0529c36236fb55c0`，main push CI #40380907839 completed/success 5/5。原 PR Codex Review 對 `2b65112288` 無新重大問題、Windows 跨磁碟 P2 Thread 1/1 Resolved。RB-034 **MERGED_CODE_ONLY**，不等於 live Access 已查核。
- Cloudflare 官方 2026-10-12 文檔：Workers Logs 的 invocation 事件提供平台 `$workers.cpuTimeMs`、`$workers.wallTimeMs` 與 `outcome`；Workers Free HTTP CPU 10 ms，Wall time 不應取代 CPU time，Worker 自行使用 `performance.now()` 也不是 Cloudflare 平台 CPU。真正驗收需取得管理員私下保存、去識別化後的**平台觀測來源**並完成來源覆核。
- RB-035 擬新增 `tools/hosted-cpu-log-offline-audit.mjs`：輸入 Git Repo 外的 JSON、只允許目標專用 Worker／固定 Workers invocation logs manually redacted source／三種操作 (hash, verify_correct, verify_wrong) 的 `cpuTimeMs`、`wallTimeMs`、`outcome`。逐操作輸出樣本數、CPU median/p95/max、Wall max、非 ok 數、Free 10ms 參考線到達數。任何樣本不足、異常或接近上限都不得視為風險已清除；就算全部樣本低於 10 ms 也不能宣稱性能驗收、Access 保護或遠端部署可行。
- 不連 Cloudflare、不讀 Token、不讀取 request URLs/IP/headers/IDs，未知資料鍵直接拒絕以避免私人資料誤入；輸出永遠固定 `platform_log_provenance_verified:false`、`remote_cpu_independently_verified:false`、`live_cloudflare_access_verified:false` 與 `deployment_authorized:false`。
- 應同步人工將新工具／測試檔的 SHA-256 加入封閉白名單，新增 CLI / schema / timestamp / 失敗 outcome / Free 10 ms / wall-vs-CPU 反例回歸。後續 Hosted CI 與正式 Codex Review 以最新 HEAD 為準。沒有進行真實 Cloudflare 部署、Access/D1 修改或 Hosted CPU 測試。

## 2026-10-27｜PR #23 已合併，RB-036 Cloudflare Login 來源 IP 正規化

- Hosted 主線確認：PR #23 Squash Commit `98e88811658bfd2d702fd3dee95a0522c1a6c8b2`，push CI #40421482417 **completed/success 5/5**，前次 Codex 無 P1/P2。RB-035 只是離線 CPU 紀錄摘要工具，仍無真正 Hosted CPU 實測。
- 內部 `cloudflare/login-service.mjs` 原版 `sourceIpDigest` 將 `CF-Connecting-IP` 小寫後 HMAC；不同 IPv6 零展開/壓縮文字為同一來源卻可能產生不同 digest，令 `login_attempts.ip_hash` 限流計數拆分。IPv4 正規式原本也沒檢查 octet 最大 255，非法字面可通過。
- RB-036 新增 Worker-safe `cloudflare/client-ip.mjs`，限制合法的四段十進位 IPv4（拒絕前導 0、超過 255、hex/octal 變體），使用 WHATWG URL IPv6 標準正規化，IPv4-mapped IPv6 與 IPv4 共用 `4:` HMAC 輸入，普通 IPv6 用 `6:` 區分。拒絕逗號列表、空白、方括號、IPv6 zone id、port、奇怪 mixed dotted；不信任 `X-Forwarded-For`。新測試校驗 HMAC 相等／差異與公開 Worker Login 永遠 503，既有登入交易邏輯不改。
- 僅更新實際新增/變更的已審查 source/test SHA-256，保持全 Repo fail-closed 白名單。此工作不驗證 `CF-Connecting-IP` 在 Cloudflare edge 是否可信、無遠端部署／Access/D1 寫入／真實登入開啟。正式驗收仍須最新 PR HEAD CI、Codex Review 與使用者合併授權。

## 2026-10-24｜Windows 業主密碼復原 BAT 操作引導（新 PR）
- 業主實機執行 `node tools/reset-owner-password.js` 停在輸入 `RESET owner` 提示，又出現 Node.js SQLite ExperimentalWarning；希望降低非資訊背景使用者的操作困難。
- 新增根目錄「重設業主密碼.bat」，檢查 Node.js 版本、原有資料庫與 `.installed`、工作目錄，以 UTF-8 顯示中文步驟，呼叫 CLI `--guided`，改成輸入數字 1 確認；無論成功失敗都 pause 留下畫面。僅針對 ExperimentalWarning 停用警告，其他錯誤照常顯示。
- CLI 原本互動式 `RESET owner` 保留，`--guided` 只改確認方式，不繞過 TTY、schema / owner 驗證、完整備份、CAS 並行保護、Session 撤銷與稽核。正式 Windows 實機操作仍需額外驗收。
- 仍須 Hosted CI 及 Codex Review，未獲 Merge 指示不得合併。

- 2026-10-24 Codex P2：舊 BAT `cd /d "%~dp0"` 在 UNC／切換失敗時可能繼續從舊工作目錄執行錯誤專案。已改以 `pushd` 並檢查失敗立即中止、所有成功／失敗路徑 `popd`；回歸測試驗證順序與配對。需再跑 CI／正式複審。

## 2026-10-27｜PR #7 回補主線安全預檢相容性

- 最新 main 已確認 PR #24 Squash `832165a00430558c09869ebbfb876358a5c1f1ef`，合併後 Verify #40435777549 5/5 PASS；公開雲端 Login 仍禁用。
- PR #7 原 HEAD `1749544ecf7f15c61a3313c7f9719c476e4be2e5` 對應正式 Codex Review 無重大問題、舊 CI #40077146458 success，但與新 main 衝突。採用兩個父 Commits 的 Merge Commit（第一父 PR7 HEAD、第二父 main），避免 force-push 或重置舊 Commits。
- PR7 原先新增 `重設業主密碼.bat`、`tests/owner-recovery-launcher.test.js`、更新 `tools/reset-owner-password.js`：和最新 main 的 tool 原始基底逐位相同，故可直接帶入修正後工具。保留並追加原 PR7 README/記憶，不以舊版覆寫新主線文件。
- 主線目前安全預檢封閉列表要求所有 `tools/`、`tests/`、根目錄 BAT 由人工審核並 SHA-256 綁定；本輪必須只更新上述三項 digest，其餘保持不變。新 HEAD 的 Hosted CI 和正式 Codex Review 完成前不可認定合併適格；Windows 實機驗收仍未完成。
## 2026-10-24｜菜品封存／配方食材移除（新 PR）
- 使用者回報「菜品與售價、食材配方只能新增修改，無法刪過時品項」。採 owner-only `dish.active`（0 封存／1 恢復）與 owner-only `recipe.delete`（只刪 dish_ingredients 連結），避免硬刪菜品造成配方連鎖消失及價值歷史混淆。
- 封存菜品不列入 costs/recipe 選單與預設菜品列表，仍可檢視封存項與恢復；不影響庫存或歷史價格。配方移除立刻影響成本試算，稽核 detail 記錄刪除前數量／食材。驗證重複／無效操作、非 owner 拒絕、交易與備份 fingerprint；Vercel Mock 同步模擬，正式環境不改 DB Schema。最新 CI／Codex Review 與 Merge 狀態須個別驗證。

## 2026-10-27｜PR #9 既有菜品／配方功能回補主線

- main 先前確認 PR #7 Squash `d307bc38967f05446dd79b3b093a2085d669a364`，push CI #40464034678 完成 5/5 PASS，RB-018 仍有正式 Windows 業主現場驗收。
- PR #9 原有 HEAD `acda039c612760b80d43a0de20789bd508e8db21` 已通過舊版 Codex Review 與舊 CI，但因 main 多次擴充造成衝突。採用原 Head 與最新 main 雙親 Merge Commit，不 reset、不 force push、不失去先前記憶。以新 main 為檔案基底只回補菜品封存/恢復、配方逐項移除、正式和 Demo UI、報表篩選、測試；保留 main 的多品項叫貨、登入安全、來源稽核、Cloudflare 限制。
- 既存 SHA-256 fail-closed preflight 涵蓋所有新的/修改過的 src/public/demo/tests；人工逐項核對目標 source 後才更新 9 筆允許雜湊，不變動 Worker 探針、部署流程、Access、D1。
- 本次以最新 HEAD 的 Hosted CI 及正式 Codex Review 為權威；舊的 Codex PASS 不等於整合後 PR PASS；PR 維持 Draft、未授權 Merge。

## 2026-10-27｜主線狀態結算與後續交接

## 2026-10-27｜Current authoritative handoff

- 最新已驗證 `main` HEAD：`6e474b187843179dc2af15836f55675210eca3a4`（PR #9 Squash）。PR #7 `d307bc38967f05446dd79b3b093a2085d669a364`、PR #9 均已 Merge；main push CI 分別 #40464034678、#40484482579 **completed/success 5/5 PASS**；兩者最新整合 HEAD 的 Codex Code Review **Completed／無重大問題**。
- GitHub REST `pulls?state=open` 查詢 **0 個 Open PR**；歷史 PR #1、#7–#10、#12–#24 均已合併。`backlog.md` 已分出 MERGED_CODE_ONLY、PARTIAL_CODE、DONE_STAGING、PLANNED 與仍需真人/Hosted 驗證項目，不再把已合併 PR 描述成等待 Merge。
- 下一個可在離線開發環境先行的重點：改善跨角色／跨店驗收、Windows 隔離還原演練 SOP（RB-003/RB-010/RB-011），並定義真正可驗證的 Hosted CPU/Access 先決條件（RB-027/RB-029/RB-032）；任何實站權限設定、Probe 部署、遠端 D1 migration 必須獲使用者明確授權。
- Production Workers Login **仍為 503**；production D1 未 migration、Cloudflare Access/真實 Hosted CPU/登入來源信任尚未實測。Staging `0002` 已經 PR #18 的 Run #40204026605 套用，與 production 不可混淆。
- 此為專案記憶/狀態修正 PR，只更新文件，不改執行程式、測試、密碼、營運資料、Cloudflare/D1 或已通過的安全 allowlist。新的文件 PR 須走 Hosted CI／Codex Review；未經使用者明確授權不可 Merge。


## 2026-10-27｜RB-003 RBAC 跨店／跨角色矩陣開發交接

- 已核對 Hosted main `4a0d6d03c159b14b5f292e22e106c53fd73f6c45`；PR #25 Closed/Merged，合併後 CI #40491933689 5/5 PASS，正式 Codex Review 完成且沒有重大問題。
- 本輪新測試用獨立臨時 SQLite（`openDb`），同時覆蓋 owner、A/B 兩店主管、A 店兩名員工與 B 店員工；讀取 8 類個人資料、7 類門市資料，越權寫入要回 403 且資料 fingerprint、audit 與庫存不變；另測批次叫貨與正式 HTTP Session 的新增門市、降權及停用撤銷。
- 新測試檔案依完整實際位元組 SHA-256 `7580293896754e7d52c41f0e6f62b0774396c56b8cc32d6a7a363900e965cdd4` 明確加入 `tools/cloudflare-hosted-probe-approved-sha256.mjs` 白名單，其他 entries 維持原值；無 Schema/Workers/D1/Access/正式部署變更。
- 此為原始碼＋回歸測試提案，並非真人門市實際授權/UAT 完成。新 HEAD Hosted CI/正式 Codex Review 結果須重新查證，若有 P1/P2 先修正再複審；未獲指示不得 Merge。

### RB-003 Codex 首輪 P2 修正（2026-10-27）

- 正式 Codex Review 針對 HEAD `0fad7ffe2cbb0ef80edb5bcd39158391ccfc5e8d` 提出兩項 P2 測試缺口（不是既證實的業務越權漏洞）：(1) 降權後僅測舊 Session 撤銷，沒有檢查重新登入 Staff 權限；(2) Staff 對進價／庫存估值／成本明細拒讀未形成直接測試。
- 已補充 `/api/me` 降權角色 assert、降權前 Manager 可成功而降權後 Staff 必須 403 的後端命令對照；另新增 `ingredient_prices`、`inventory_values`、`dish_cost_lines` 及 `dish_ingredients` 等 DB/HTTP 真 Cookie 的 Staff 403 覆蓋。新測試 exact SHA-256 `7580293896754e7d52c41f0e6f62b0774396c56b8cc32d6a7a363900e965cdd4`；更新 manifest，其他程式未變。
- 須以本次修正後最新 HEAD 重跑 Windows/Ubuntu Hosted CI 及正式 Codex Review；未取得完成證據不得標記 P2 解決或 Merge。

## 2026-10-27｜RB-010／RB-011 隔離備份還原演練工具

- 本輪基底 `main` `1eb9fa7930c49c4dcecc90b8c4ca683d3859a0b8`；PR #26 RB-003 已 Squash Merge；main push Verify #40505949563 全 5/5 PASS，Workers Build Success。舊 `.codex` Current Focus 已更新。
- `tools/restore-drill.js` 僅對既有備份做唯讀校驗，以獨立、受 ACL 保護的系統暫存目錄建立一次性副本，驗證 SHA-256 位元組一致、SQLite v3 Schema/quick_check/FK、業務 fingerprint 和有效業主/門市資料；最後刪除副本。不得覆寫營運 DB，不得自動重建 DB。
- `備份還原演練.bat` 為 Windows 中文提示雙擊啟動器，使用 `pushd`/Node 22.13+ 檢查；`tests/restore-drill.test.js` 測試正式庫備份後異動仍不受演練影響、預設選最新、指定備份名稱校驗、壞備份與遺失 DB fail-closed；新可執行項目確切 SHA-256 均列入封閉式安全 manifest。
- **驗證範圍限制**：僅一次性隔離副本的可讀性與結構安全，未進行真正的 Windows 業主機部署、異機啟動登入、跨磁碟/異地備份、實際還原寫入、RTO/RPO、人工簽收。不得把工具 PASS 寫成完整災難復原完成。
- 最新 HEAD Hosted CI 和正式 Codex Review 必須完成，若 P1/P2 須修正/再審。使用者未另行授權不可 Merge。

### 2026-10-27｜PR #27 Codex P2：來源備份零寫入修正

- 首輪正式 Codex Review 對 HEAD `4212a881583474ce71cc6b4ede8313e3dfc30f35` 發現 2 項 P2：(1) `backup-manager.list` 原本會透過 `protect` 修改未選取備份/目錄 ACL；(2) 對原始 WAL SQLite 使用 `verifySnapshot` 即使 readOnly 仍可能產生 -wal/-shm 暫存檔，並且在來源 descriptor 身分檢查前已開啟來源路徑。
- 修正為 `backupsReadOnly` 使用 readdir/lstat 列舉、拒絕非一般檔/符號連結，不調整原始備份任何權限；複製時由已固定、驗證身分的來源 FD 一次取得原始位元組 SHA-256，僅對受保護的隔離副本使用 SQLite 完整性與 fingerprint 校驗。新增原始檔/資料夾 mode 不變、WAL sidecar 不產生、symlink fail-closed 回歸。
- 新工具／測試精確 SHA-256 分別為 `8ebd3d933287d7bcd0994f6095f02f01ba2ee121dcbd52c167d792d1ef920b14`／`13cf3b47ab6e4eda3e6d139973bba2d74754ec4b4a34396d97d4b56c11445efb`，更新安全白名單後需新 HEAD Windows/Ubuntu Hosted CI 與正式 Codex Review 複審，舊 P2 在核對後方可 Resolve；未授權不可合併。

## 2026-10-28｜RB-011 外接磁碟／異機備份驗證新工作

- 已確認 PR #27 `e6827cb7436c7b86b1808d4f0de55983138eac28` 合併後 main push #40542421530 **completed/success 5/5 PASS**；本輪起始無 Open PR。RB-010 狀態調整為 `MERGED_CODE_ONLY`，非業主現場 UAT 通過。
- `tools/offsite-backup-verify.js`：外接檔案完整路徑 + 來源主機獨立留存 SHA-256，來源一般檔和開啟 FD 身分檢查，在受 ACL 保護的一次性 temp 僅執行 SQLite 完整性、Schema/FK/fingerprint 與有效業主摘要，清理副本。**不要求原電腦 data/ 存在**，不修改備份 ACL，不在原備份位置產生 SQLite WAL/SHM。
- `異機備份驗證.bat`：Node 22.13+ 版本檢查，使用 Node readline 互動輸入外部來源路徑／雜湊，避免在 CMD 插入使用者輸入；沒有真的還原啟動服務。
- `tests/offsite-backup-verify.test.js`：驗證無原 data 仍能處理、來源位元組與 mode 不變、錯誤 hash／損毀檔拒絕、WAL sidecar 不出現在來源，以及 Windows 啟動器靜態檢查。
- 須更新 3 個執行檔 exact bytes SHA-256 安全 allowlist；Hosted CI/Codex 正式複審、P1/P2 修正與合併授權尚待完成。正式 Windows 實機/異機真正恢復、加密異地備份、RTO/RPO 與業主簽收必須另行安排。

### RB-011 PR #28 首輪 Codex P2：互動 EOF 不得回傳成功

- 正式 Codex Review 在 `6b51e887dce9b612c5951fd640c1977362f4ffcf` 指出 1 個 P2：Node readline/promises 互動中 stdin 提前 EOF 時 pending `question()` 不一定 reject，行程可能在尚未驗證前以退出碼 0 結束，Windows BAT 因而誤顯示成功。
- 修正為 `requiredAnswer` 監聽 readline 的 close、未填完整即以 `E_INPUT` reject；CLI main 先預設 `process.exitCode=1`，只有完成 `verifyOffsiteCopy` 並輸出 PASS 才改成 0。新增空輸入與只輸入第一行就 EOF 的實際 child_process 測試，必須非零退出且不得印 PASS。
- 新 SHA-256 CLI `4a07a66aa3ccc06bcb1f12fe1971c71a086a0e91a83394f9c3248efb291358ef`、test `8acce74ffcdf384def6752e09e0a183c3240044b872b271a618e4d83c50ea3d2`；已更新封閉 manifest。需新 HEAD Hosted CI 及正式 Codex 複審，再確認舊 P2 才可 Resolve／Merge。

## 2026-10-28｜PR #28 已合併；RB-011-SMOKE 乾淨隔離復原後 HTTP 服務回歸

- PR #28 合併到 Hosted `main` `0e8c80f8364b6b268c6ec39874a7b0cfebdbcf71`；Verify Run #40603773240 completed/success。既有外接／異機備份唯讀工具、SHA-256 搬運一致、隔離 SQLite 驗證程式完成，**未在業主 Windows 異機真正還原啟動**。
- 本輪新增 `tests/recovered-service-smoke.test.js`：以全新虛構 SQLite建立門市、食材庫存與主管；建立正式 snapshot；來源 DB 關閉後複製備份到另一個不存在原 data 的隔離目錄。用 `openDb` 驗證已存在 DB，不可重新產生業主密碼；透過實際 `server.makeHandler` 的 loopback 隨機埠測試健康、未登入 401、原業主密碼、食材資料、概況、主管權限拒絕 403。另有毀損備份 clone 的 fail-closed 與原始 source hash 無變動測試。
- **未宣稱事項**：單一 CI runner 的不同資料夾≠Windows 第二台機器；程式未測外接真實磁碟、真正斷線/故障切換、舊 Session revocation、防護代理、現場 RTO/RPO 或人員驗收；僅測 synthetic fixture。正式還原前應先停服務、封存舊 DB/WAL/SHM、離線檢查後撤銷備份中的舊 sessions 再起服務，不能直接把歷史 session 視為仍有效。
- 新增 Node test 在 package `tests/*.test.js` 自動涵蓋，需加入新測試的精確 SHA-256 白名單，不更動正式 DB schema/Cloudflare/Auth Route。最新 HEAD Hosted CI 和正式 Codex Review 未完成前保持 Draft，不得自行 Merge。

## 2026-10-28｜RB-011-SESSION 合成還原後 Session 復活風險

- 基底 main `a35d72df79fdcb1d7ce29934f5d421ffa6ab329a`；PR #29 已合併，主線 Verify #40613800190 5/5 PASS，Cloudflare Build Success，0 Open PR（工作開始時）。
- 新 `tests/restore-session-revocation.test.js` 自建臨時虛構 SQLite，插入僅用於測試的 future valid Session，以正式備份系統 VACUUM 快照並作原始 SHA-256；第一份隔離恢復副本以真實 Node HTTP `/api/me` 觀察舊 Cookie 被接受；第二份隔離恢復副本關站離線 SQLite transaction `DELETE FROM sessions` 後啟動 Node HTTP，舊 Cookie 必須 401、既有 Owner 帳密重新登入成功、庫存仍在，原始備份 SHA/SQLite footprint 不變。
- 精確 SHA-256 `e3e2f0fdda14da45831022652d7e93ef0b96f30de33f4f6c4f48776ebba2d6c2` 已加入 fail-closed manifest。更新 SOP 停機移除 WAL/SHM 與 Session 清理/稽核步驟，並強調此非可在正式服務直接執行的一鍵還原。
- 待最新 HEAD Hosted Windows/Ubuntu CI、Cloudflare Preview/正式 Codex Review；不得宣稱實機 Windows／異地／業主驗收完成。未經指示不可 Merge。

## 2026-10-28｜RB-011-UAT 現場驗收紀錄範本（本 PR 尚待 CI／Codex）

- 基於 Hosted main `a35d72df79fdcb1d7ce29934f5d421ffa6ab329a` 建立獨立**文件**分支；不疊加 PR #30，沒有更動其 Session 合成測試、工具雜湊、SQLite Schema／API，亦未觸及 production D1/Access。
- 新增 `docs/Windows異機還原現場驗收紀錄.md`，以 G0–G7 的現場關卡、私人證據索引、時點與 RTO/RPO 可量測性、失敗拒絕及業主簽收作為未來可稽核 UAT；README 加入口。
- 工作表只可在 Repo 外私下填寫。沒有現場資料或預定義目標時不能冒稱 RTO/RPO 達標；實機、舊 Cookie 受控測試、Owner/Manager 重新登入仍是 **NOT_RUN**。關聯 Issue #31。
- PR #30 已 Squash Merge 至 main `b0e02aadc9bfc0d9707727e460cec149af070872`，但實場驗收仍未完成。PR #32 首輪 Codex 於 `e7d4fe1b94627f0f8c177ca53ddff5a201ad936e` 發現 1 項 P2：時間型 RPO 不可用最後提交與還原點的差值，應以 `T_incident - T_last_restored`；已依此修正文檔，重測 CI／正式 Codex 複審尚待完成。該 PR 未合併；兩者不混淆。

## 2026-10-28｜RB-006 跨日班第一階段（開發中／待 Hosted 驗證）

- 基底 main `40d3607789d3bc14ececd56fb6d7f1b69d6bfad9`，已確認 #30/#32 Squash Merge、主線 CI #40628721464 completed/success 5/5；Issue #31 實場驗收維持 Open。
- `src/service.js`：end_time 早於 start_time 表示次日，不支援 24 小時整班；用 UTC-like 數值比較不做時區換算；掃描前一日、當天與隔日同一員工在所有門市的班次，以半開時間區間拒絕相交（409），剛好相接允許。
- `public/app.js`：表單提供隔日語意、跨日紀錄下班欄標示「隔日」。不改 SQL Schema/UserVersion、帳號權限、Cloudflare D1。
- `tests/shifts-overnight.test.js`：隔日資料、前後相交、跨店、跨年／閏日、非法日期與權限失敗無持久變更；更新 exact SHA-256 fail-closed 測試／程式白名單。
- RB-006 其餘排班月曆、換班、假別、工時／人力需求及請假衝突仍需另行設計、測試與場域驗收。本輪程式與測試尚待新 Head Hosted CI、正式 Codex Review；未授權不得 Merge。
