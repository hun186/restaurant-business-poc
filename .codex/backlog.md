# Backlog

> 2026-10-31 P0 #34 下一增量：PR #70 已 Squash Merge main `0524137cf265ba14da2feae66d3e0e1798bcc5ba`，latest HEAD CI #41180712116 5/5 PASS、Codex completed/0 new Findings、P2 resolved。本分支只增加 Staging 0003 before/after **offline evidence validator** 和合成 DB 測試，禁止自動遠端 APPLY；本地遷移過程的 SQL 僅於記憶體 SQLite 合成測試執行。未完成最新 Head CI/Codex Review 前保持 PR Open；Staging 真正套用/身分連結啟用與 Production 仍未授權。


> 2026-10-31 P0 #34 NOW｜PR #69 已 Squash Merge main `95bf23800726da5bb25d52e6a88ac5aa6ca3e438`，其 postmerge Verify #41170341387 仍待最新查詢。本次新增 Staging 0003 的 **人工 GET-only 檢查** 工作流程與嚴格 baseline/schema/ledger 驗證，沒有 APPLY 分支。固定 main/protected `d1-staging`/Staging UUID、共用舊 Migration 鎖和封閉 SHA256，合成 Node SQLite 測試；最新 PR HEAD Hosted CI/Codex Pending。若 Merge 後可用 Action `CHECK_STAGING_0003_READONLY`（仍需現場受控 Token 與環境），不能擅自開放 D1 Migration、正式登入、Production 及 G5 Restore。


> 2026-10-31 P0 #34 NEXT｜PR #68 已合併 `aa0f13c189eab863ab1f5e921c212401a904ca39`，main Verify #41169668388 5/5 PASS。當前僅新增獨立 Staging 0003 Migration 選擇配置（單獨 migrations_dir、明確 staging UUID）與 synthetic schema/allowlist 驗證；保留 0002 舊工作流程和封閉目錄，**無遠端寫入或套用**。必須 Hosted CI + Codex Review + Gate 成立後才可 Merge。下一小型增量可建立嚴格、人工操作的 Staging-only 0003 Workflow，但不得擅自執行遠端 apply；Production 仍 disabled、G5 Restore 暫緩。

> 2026-10-31 P0 #34｜PR #67 Squash Merge main `14a184af02d55b2249ce9adb233b843c5984aeac`，postmerge Verify #41169303453 5/5 PASS。下一小型增量只把 D1 `access_identity_links` 的 inactive-by-default / primary+unique key / FK proposal 和合成資料庫驗證放在 `cloudflare/migration-proposals/` **隔離目錄**；現有 0001/0002 Migration 一鍵驗收與 allowlist 不變，禁止直接放行、遠端執行或當成已套用。Proposal 本地合成 SQLite 6/6 PASS，最新 HEAD Hosted CI/Codex Review 待核對。之後須單獨設計 migration 版本化 Staging-only 放行（受保護環境、人工審批、可回復證據），Owner/subject binding 人工管理，Production 仍 disabled。

> 2026-10-31 P0 #34 CURRENT｜主線 `3a66e99ab9c4b7287cfe86d7e07237a841cc1186`（PR #66 Squash Merge）Postmerge Verify #41165785965 5/5 PASS；本階段小型 PR 只處理「可信 Access JWT 的 subject → 人工預先核准的 D1 使用者、角色、有效門市」之內部唯讀查詢。不存在的 `access_identity_links` 表必須 null/deny；實際 D1 v3 migration 與 enrollment 故意不包含，防止自動帳戶授權。僅合成測試/文件/closed SHA256，**最新 HEAD Hosted CI/Codex Pending、尚未 Merge**。後續另設計版本化 mapping migration/嚴格授權註冊/Session/CSRF、實站 Preview Access E2E；Production 繼續 disabled。

> 2026-10-31 P0 #34｜PR #66 初輪 Hosted Verify #41165314213 5/5 PASS；正式 Codex Review 對原 HEAD `439e68b8c755b51b6b491605275003d7dd92bd0c` 提出有效 P2：Header 合法但 Payload/Signature 破損仍造成 JWKS Fetch。已修正 `keyHint` 在網路前驗證完整三段 canonical Base64url、signature 256–512 bytes 和 payload JSON 物件**僅結構、不信任 claims**；增加 empty/bad/short/malformed payload 網路零請求回歸，本地 4/4 PASS，Git blobs 和 SHA256 清單同步更新。**修正後新 HEAD Hosted CI／正式 Codex Review Pending，尚未 Merge**；無公開 Worker 路由／登入／D1 write／Production 變更。

> 2026-10-31 P0 #34｜PR #65 已正式 Squash Merge `da82791424199c0162e61824e6e9dc17e2ba8590`，最新 HEAD `493d8f24188b997404ad4627101927192eb63cd6` Verify #41165009136 5/5 PASS，Codex re-review Completed/0 new Findings/2 Threads Resolved。此分支第三增量只新增**未接 Worker 公開路由**的 `cloudflare/access-identity-internal.mjs`：從未驗簽 header 中的 kid 只取公鑰索引，從固定 team JWKS Loader 讀取公鑰，再使用原有 WebCrypto RS256 完整驗簽、aud/iss/time 檢查後才回傳 subject；無 Header/驗證失敗皆 null。合成 RSA E2E local 4/4 PASS，最新 Head Hosted CI／正式 Codex Review Pending。沒有登入、D1 身分授權、Session、正式 Access 設定或 Production 變更；Production disabled。

> 2026-10-31 P0 #34｜PR #65 初次 Hosted Verify #41164764670 **5/5 PASS**，正式 Codex Review 對原 HEAD `bc8873cdcc38174d54ec916523aafd33553ea13e` 指出 2 個有效 P2：（1）無有效 cache 時 fetch 失敗未節流；（2）未命中 kid 刷新會阻塞可用的快取 kid。已修改 JWKS Loader 先回傳仍有效、相符的 cache，再加入 pending；所有刷新失敗均遵守 30 秒節流；新增合成回歸 Local **8/8 PASS**、exact Git Blob 核對並更新 SHA256 Manifest。**新 HEAD Hosted CI／Codex 複審待驗證，PR 未合併**；無公開路由、登入或 Cloudflare 遠端寫入，Production disabled。

> 2026-10-31 P0 #34｜已核對 PR #64 Squash Merge `db2e208e0af6680b6f0fd4d833ccc3f0185a862a`、合併後 Verify #41164519699 5/5 PASS；接續小型內部 JWKS 公鑰載入器，針對固定 HTTPS team cert endpoint、redirect/size/timeout/key rotation/cache 以合成測試護欄驗證，尚未對接公開 Worker 或 Cloudflare 遠端。Local 6/6 PASS，PR Head Hosted CI／正式 Codex Review Pending，禁止宣稱 Login/Production D1 Ready；需依已授權 Auto-Merge Gate 核對後才能合併。

> 2026-10-31 P0 #34｜PR #63 Squash Merge main `5663f604ec1a98dee99097d4c7bb47b2287aad22`，合併後 Verify #41107287991 success 5/5，真實 HTTP GET-only Staging Preview #41162137307 `STAGING_HTTP_GET_ONLY_ANONYMOUS_PASS`、D1 `schema_only`。下一增量新增**未接公開路由**的 Cloudflare Access JWT WebCrypto RS256 驗證器、實際 RSA 合成簽章正負測試、關閉的 SHA-256 Allowlist；由於目前 Worker 使用 Static Assets，Cloudflare 的 `ctx.access` 不會傳給 Worker，未來必須驗證已簽章的 `Cf-Access-Jwt-Assertion` 並從可信 team 取得 JWKS。**尚未開通真正登入、未驗證 Access policy / JWKS 可信載入 / Hosted PBKDF2 CPU，Production disabled、沒有 D1 遠端寫入。** 此增量需最新 HEAD Hosted CI 與 Codex 正式 Review；Merge 另需使用者同意。

> 2026-10-31 P0 #34 | PR #62 已授權 Squash Merge main `1927555bd7e82b02d269069d2d0153a4849aa87d`，postmerge Verify #41097660277 completed/success 5/5。後續增量只新增 main-only 人工 Staging Preview GET-only 匿名 HTTP smoke（固定 Cloudflare Workers Preview hostname、禁止 redirect/credentials、預期 401/400/503，health D1 schema_only）、合成負面測試與 SHA256 關閉清單；尚未執行新的真實遠端 HTTP 驗收、沒有實際登入/資料寫入，也不代表 Cloudflare Access 驗收。需最新 PR Head Hosted CI、正式 Codex Review 與使用者 Merge 授權，Production disabled，G5 Restore 仍暫緩。

> 2026-10-30 P0 #34 **業務目標優先**：暫緩 G5 destructive Time Travel Restore / 新帳戶[#61](https://github.com/hun186/restaurant-business-poc/issues/61)，不能假造 Restore signoff。對目前已存在及核對的 Staging D1 v3/0002（G1 #40854101717）先完成真正 Worker 的 D1 讀取；分支 `feat/staging-d1-readonly-overview-20261030` 增 `/api/overview` 四 KPI 真實 SQL 聚合（Session、Store/Role、低庫存帳本，Preview only），合成試驗／Runbook。**下一階段**：Hosted CI、Codex Review、授權 Merge、受控 Staging 真實 HTTP E2E；再開虛構 Owner 登入/登出 + Access/CPU/Rate limit 可用性，逐模組串接業務交易。正式 Production D1 尚空庫且 /api/login & /api/command 503，無法因本 PR 自行放行；既有 G5 Production initialize 的 restore signoff gate 不可冒名填入，將來需另審真實備份/可回復性替代條件。PR #60 G5 文件-only 仍 OPEN，需另行合併授權。

> 2026-10-30 G5/#46 RECENT VERIFIED：最新 **G5 D1 Inspect #41046807367**（main `61912fb594173e61ae140c56914bf40c2fc20688`）於臺灣 19:15 `inspect SUCCESS / drill SKIPPED`、遠端 `G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS`；搭配先前 GET-only Worker/Pages direct binding #41041385954 PASS（1 script/47 versions/0 Pages/0 direct matches）。本文件 PR #59 更新 B1 機器證據；B2 人工 Cloudflare D1 當前確認、A Worker/Pages 間接存取／獨立審核、C Audit Logs／所有操作者與變更窗口、D Write Environment 防越權/獨立 reviewer/短效 Write Token 未配置確認、E 私有審核簽名 **均 PENDING**。不得當作具破壞性的 G5 Restore 許可；PR 新 HEAD 需要 Hosted CI／正式 Codex Review；Merge 另需使用者明確同意。

> 2026-10-30 G5/#46 NEXT（機器證據 PASS，但人工簽核 BLOCKED）：最新 main `61912fb594173e61ae140c56914bf40c2fc20688`，Postmerge Verify #41039593794 success；真人觸發 Cloudflare GET-only #41041385954 **completed/success**，盤點 1 Worker script、47 versions、0 Pages、0 目標 D1 直接綁定。舊 D1 inspect #40914927490 attempt2 10/29 PASS 空庫/quick_check/Bookmark，**非現時獨占使用證據**。新增 Runbook 獨立安全覆核工作單：A Cloudflare Worker/Pages/deployed versions/間接路徑、B 當下新 inspect 僅 read-only、C Audit Logs + 其他操作者/排程及變更窗口、D GitHub d1-recovery-drill-write main-only 和可行的真正獨立 reviewer + Prevent self review／防 bypass／無預置寫入 Token、E 人工審批和私有證據索引；全部未經管理員證實應保持未完成。**沒有 Cloudflare Dashboard/Env 安全配置 API 權限，不能代簽**。本分支為文件/記憶 PR，需 Hosted CI + 正式 Codex Review + 使用者另一次 Merge 授權；不授權 Restore，不設定 `G5_DRILL_RESTORE_APPROVED`，不進行 D1/Production Writes、Migration 或擴權。

> 2026-10-30 G5/#46 NEXT：`main=233a1c1b58c3865884456d95b8f321764ec35aa5`，Postmerge Verify #41027139504 PASS；真正 GET-only Run #41027408751 **FAIL** `PAGES_LIST/PAGE_TOTAL_PAGES_INVALID`（新 SHA 非重跑）。PR #57 已允許 null/undefined 並對型別另編碼，所以可能為 numeric 0／負數／小數，**沒有原始值證據，不能武斷判定**。新的限定修正僅在 verified empty Pages project list（page1/total_count0/count0/result[]）允許 total_pages0，所有非空及數量矛盾仍拒絕；覆蓋 synthetic regressions、SHA256、Runbook。需 Hosted CI＋正式 Codex Review＋另次 Merge 授權，之後才於最新 main 建新 GET-only G5 Run。未准 D1 Restore / Production Migration / D1 Write / Cloudflare 權限擴增。

> 2026-10-30 G5/#46 NEXT：最新 `main=70a07aab4f034ccf184385c5f53e0654f17a80ca`、Postmerge Verify #41023736114 PASS；實際新 G5 GET-only #41023956018 **FAIL** `PAGES_LIST / VALIDATION_FAILED / PAGE_TOTAL_PAGES_INVALID`。核對證實不是舊 SHA；因日誌不含原始值，不能假設是 null。新分支只把 **null/undefined** 當作無可用選填 `total_pages` 提示，完整性仍嚴格以必填 `total_count/per_page/page/count`、跨頁總筆數/唯一專案驗證，提供的非數字型別加固定安全 `PAGE_TOTAL_PAGES_TYPE_INVALID`，不合法數字仍拒絕。CI + 正式 Codex Review + 新 Merge 授權後再開新 GET-only main G5 Run。所有 Restore、Production Write、權限擴增仍禁止。

> 2026-10-30 G5/#46 NEXT：最新 `main=77db23f3e49b108c8246682546febcb35d2e6f9d`，合併後 Verify #41019351188 5/5 PASS；真正 G5 GET-only #41020107558 失敗於 `PAGES_LIST / VALIDATION_FAILED / PAGE_TOTAL_PAGES_INVALID`。根據 Cloudflare 官方 Pages List Schema 的 optional total_pages，將 total_pages 省略情形改成從**必填並嚴格核對**的 `total_count` 與 `per_page` 計算總頁數，null／錯誤型別／不一致仍拒絕；維持完整資料累積、跨頁一致性和 Pages 已部署版本確認的 Fail Closed。完成新 PR Hosted CI＋正式 Codex Review，需使用者明確 Merge 才能從最新 main 另行執行 GET-only G5 Run。**不得將程式測試通過寫成遠端 G5 盤點成功，Restore／Production Migration／寫入尚未核准。**

> 2026-10-30 G5/#46 NEXT：latest main `019b74b30b582e630aa4ee78aac6a969d1790676`，PR #54 postmerge Verify #41015489859 5/5 PASS；正式 Cloudflare GET-only #41016132258/#41016228381 都在 PAGES_LIST `VALIDATION_FAILED`。準備診斷 PR：保留所有分頁完整性檢查，僅增加固定 `validation_code` 分辨伺服器回覆缺漏、頁數/計數不一致、專案名稱驗證，**不輸出任何 API 欄位值/名稱/Token**。最新 HEAD 必須 Hosted CI、正式 Codex Review，再獲使用者新 Merge 授權，合併後新開唯讀 `main` Run 才能判定實際原因。任何 Restore、Production migration/login/write 仍禁止。

> 2026-10-30 G5/#46 NEXT：最新 main `62e43fce4ef8439c9039579ba8e12817cd5bc462`，正式 GET-only Run #41009848022 回報 `PAGES_LIST / HTTP_BAD_REQUEST bare_probe=OK page_probe=OK per_page_probe=HTTP_BAD_REQUEST`；確認 `per_page=20` 參數觸發 HTTP 400，`page=1` 有效，但還不能宣稱完整 Pages D1 Binding 盤點 PASS。現在開發只用 `page=N` 清單、依遠端 `result_info.per_page` 的嚴格分頁；不能用單頁成功繞過全量/已部署 Pages 綁定驗證。完成 Hosted CI + 最新正式 Codex Review、獨立 Merge 授權才新開 main 手動讀取。不得提前跑 Restore、Production Migration／登入／寫入或擴大 token scopes。

> 2026-10-30 G5/#46 NEXT：PR #52 已合併，main `8fa3600c6a7586cdf598810db8d3a8dd98ac83df`，Postmerge Verify #41002428857 PASS。真實手動唯讀 Run #41002452609 回報 `PAGES_LIST / HTTP_BAD_REQUEST bare_probe=OK`；帶 page+per_page 400，無 query 成功，**仍未有完整 Pages D1 Binding 覆蓋證據**。本分支以額外 2 次 GET 對照 page-only / per_page-only（連既有 bare 上限 3 次）追查 query 支援情形；需 Hosted CI、Codex Review 與獨立使用者 Merge 授權，之後由 main 新開唯讀工作流程取證。絕不可將對照 GET 結果當作 no direct binding PASS。D1 Restore、Production migration/login/write、offsite recovery sign-off 仍未完成。

> 2026-10-30 G5/#46 CURRENT（PR #51 merged 後）：最新 main `111f302ad2f8c68102f3ab792ddc000f1a99f060`，正式 GET-only Cloudflare Pages 盤點 #40998874342 明確 HTTP 400（`PAGES_LIST / HTTP_BAD_REQUEST`），尚未驗收、不可宣稱無直接綁定。下一步提交第一頁 paged 400 的**一次性無 query GET** 安全對照診斷（固定 `bare_probe`、永遠原錯誤 Fail Closed）；完成獨立 PR／CI／Codex Review 後才徵求 Merge 授權，再新開 main workflow_dispatch。任何 Remote Restore／Production migration、登入或寫入不在本階段授權內。

> 2026-10-30 G5/#46 NEXT：在 main `0dd0484889f3332e9a84b4b9dfde97d5b6aa0326` 上開發 read-only Worker/Pages D1 binding inventory PR。`d1-recovery-drill-write` 的 Branch main-only/Variables 由使用者回報完成，GitHub Connector 無 API 證明；無 Collaborator 無法設定 Required reviewers。新 GET-only 工具與 workflow 必須先完成 Hosted CI／正式 Codex Review 並取得另一次 Merge 授權，然後配置 `d1-recovery-drill-binding-readonly` Environment 和 Worker Scripts Read + Pages Read 專用 token，才可人工發起唯讀 GET 盤點。`G5_DRILL_RESTORE_APPROVED` 與 Write Token 仍不啟用，真實 Restore、offsite backup、RPO/RTO 及 Production Ready 仍 NOT_DONE。

> 2026-10-30 G5/#46：以最新 main `938805ac0fa53fe7c0aa462b23e9b0292e8e5fcc` 為基底的安全加固分支新增每次執行都須確認的 Cloudflare 無 Worker Binding 與無並行使用者雙重 typed attestations；Workflow job guard、注入 Write Token 前 approval gate 與 CLI 三層 Fail Closed，增加未授權拒絕回歸與 SHA-256 閉鎖清單。已驗證 disposable 唯讀 Inspect #40914927490 Attempt 2 成功；遠端 Restore、Write Environment 實際保護與最小權限、加密異地備份、RPO/RTO、Production Login 仍未驗收；本分支 CI/Codex/合併另待核對，不得自行執行 Restore 或 Merge。

> 2026-10-30 / PR #41 G0 整合至最新 main（已含 PR #47 的隔離式 D1 Pin UUID）：新增固定 Cloudflare GET only 的 Worker/Domain/Zone 公開暴露面盤點、主線人工 Protected Environment 工作流程、synthetic total_count/多頁 fail-closed 測試及 reviewed SHA-256 allowlist。PR #41 前一 HEAD 903d15d 已通過 Verify 5/5、Workers Build 與 Codex 無 Findings；本整合 HEAD 須重新 Hosted CI + 正式 Codex Review，未通過前不可 Squash Merge。PR #47 已合併，但**未對真正 Cloudflare D1 API 做 remote inspect 或 Restore**。G0 仍未實際運行，Access / 正式登入寫入不可宣稱開放。

> 2026-10-30 / #46：G5 disposable D1 **Pin-ID PR 待審**：UUID 已由使用者提供，未經 Cloudflare API 唯讀核對；main 目前仍為 PENDING 占位，僅 PR 提議納入新 UUID。必須通過 Hosted CI / 正式 Codex Review 並由使用者另授權 Merge。然後人工先做唯讀 inspect；任何 remote drill/Production migration/login/write 都禁止提前執行。


> G5 2026-10-29：Time Travel Read-only Live Run #40872307187 PASS。新增 **獨立 disposable D1 Restore 演練**的合成測試／安全 Workflow（code only），等待另建實際 Cloudflare 演練庫、PR 審查 Pin UUID、受保護 Environment、Token、人工 inspect 與 write/Restore 授權。Production / Staging 仍不得 Restore、Production Migration / 登入仍禁用。


> 2026-10-29 G5：Production 空庫遠端唯讀 Run #40865818477 Attempt 3 PASS；本輪開發 Time Travel metadata/bookmark **read-only capability** + 完全隔離 SQLite 合成還原，尚未 Cloudflare 實際 Restore，未完成遠端演練/加密異地備份/RPO/RTO/簽核。Production Migration 仍禁止執行。


> 2026-10-29 P0 G5：Production D1 初次 Schema 安全流程程式開發（含獨立 read-only preflight / 人工簽核 apply）已提交本輪工作，**真實 Prod 仍空庫，沒有跑 Migration**。G1 Staging 遠端只讀子關卡 Run #40854101717 實際 PASS；G0/G2–G6 未整體通過。不得開放 login/write；實際 Production apply 另需使用者獨立授權及回復演練證據。


> P0 #34 G1（2026-10-29）：新增手動 Cloudflare Staging D1 只讀遠端驗收 Workflow / 離線 Schema Guard；只有 code，尚未遠端執行。其他 G0 G2 G3 G4 G5 G6 尚未完成，不得開放正式登入。


> 2026-10-29 P0 #34：D1 盤點確認內部原型已提交開發分支（PR 與 CI/Review 須以 Hosted 最新狀態確認）。只有合成資料與未接線交易 API，不能視為正式 Cloudflare 生產寫入、Access、備份或 UAT 完成；RB-006 進階排班繼續後延。


> 2026-10-27 主線事實快照：核對 GitHub PR #1、#7–#10、#12–#24 已合併，當時沒有未結 PR。`MERGED_CODE_ONLY` 僅代表程式碼入 `main`，**不代表 Windows 實機、Vercel 正式部署、Cloudflare Access/Hosted CPU、production D1 或業主驗收已完成**。歷史日期在 `.codex/memory.md` 仍保留；後續需以最新 Hosted GitHub 與實站驗證覆蓋此快照。


| ID | Status | Priority | Work |
| --- | --- | --- | --- |
| RB-001 | MERGED_CODE_ONLY | P1 | PR #1 已合併（PoC 基礎營運、SQLite/RBAC/稽核）；現有 main 程式合併後驗證已進行，但業主 Windows 安裝、真實門市權限/災難復原與上線前驗收仍待辦 |
| RB-002 | PLANNED | P1 | 多人正式部署拓樸、HTTPS、Secure Cookie、遠端連線安全與後端儲存選型 |
| RB-003 | MERGED_CODE_ONLY | P1 | PR #26 已 Squash Merge `1eb9fa7930c49c4dcecc90b8c4ca683d3859a0b8`，main push CI #40505949563 5/5 PASS、正式 Codex Review 無新 P1/P2，2/2 Threads Resolved；RBAC 矩陣已納入主線，但正式門市角色政策／Windows 多使用者實機 UAT 尚未執行 |
| RB-004 | MERGED_CODE_ONLY | P1 | PR #1 自動備份、無資料異動跳過與站內備份管理程式已合併；Windows 隔離還原、備份磁碟隔離/異地複本及業主簽收尚未執行 |
| RB-011 | MERGED_CODE_ONLY | P1 | PR #28 Squash Merge `0e8c80f8364b6b268c6ec39874a7b0cfebdbcf71`，主線 push CI #40603773240 completed/success；外接/異機快照唯讀 SHA-256/SQLite 校驗與 BAT 已合併，但未進行真正異機啟動或真人災難復原簽收 |
| RB-011-SMOKE | MERGED_CODE_ONLY | P1 | PR #29 已 Squash Merge，main `a35d72df79fdcb1d7ce29934f5d421ffa6ab329a`，Verify #40613800190 5/5 PASS；單機隔離 synthetic HTTP 還原回歸已入主線，但真正 Windows 異機、舊 Session、RTO/RPO、業主簽收均未實測 |
| RB-011-SESSION | MERGED_CODE_ONLY | P1 | PR #30 已 Squash Merge `b0e02aadc9bfc0d9707727e460cec149af070872`；原 HEAD `0ed4b027ec7001dcf3ffe53fd653295579ec0f28` Hosted Verify #40622456552 5/5 PASS、Codex Completed／無重大 Findings／0 Threads。Session 舊 Cookie 401 合成測試及停機清理 SOP 已入主線；實機 Session 撤銷仍待驗收 |
| RB-011-UAT | MERGED_DOCS_ONLY | P1 | PR #32 Squash Merge `40d3607789d3bc14ececd56fb6d7f1b69d6bfad9`；主線 Verify #40628721464 5/5 PASS。G0–G7 UAT 空白範本／RPO 定義已入 main，但 Issue #31 真實 Windows 異機還原與業主簽收仍 NOT_RUN |
| RB-005 | PARTIAL_CODE | P2 | PR #10 多品項叫貨與供應商分單已實作；批號效期、FIFO/成本法、耗損/進銷存報表等仍待規劃與驗收 |
| RB-006 | IN_REVIEW_PARTIAL_CODE | P2 | 第一階段新增跨日班（end_time < start_time 代表翌日）、前／當／隔日與跨店防重疊、UI 隔日標示、合成回歸；SQLite v3 無遷移。**月曆、換班、假別工時／人力、請假衝突仍未完成**；初輪 Hosted CI 通過，Codex P2 指出 9999-12-31 上界繞過防重疊；已新增 0000/9999 邊界回歸，新 HEAD CI／複審待驗，未授權不 Merge |
| RB-007 | PLANNED | P2 | 課程附件、測驗題庫、複訓與多維度考核流程 |
| RB-008 | PLANNED | P2 | 預定保養、開關店 SOP、值日表、設備／食安檢查表 |
| RB-009 | PARTIAL_CODE | P2 | PR #8 已提供 Excel 匯出及列印預覽；進階庫存成本/營運分析、POS 介接與業主使用流程仍待規劃 |
| RB-010 | MERGED_CODE_ONLY | P1 | PR #27 已 Squash Merge `e6827cb7436c7b86b1808d4f0de55983138eac28`；合併後 main push CI #40542421530 **5/5 PASS**。Windows 雙擊隔離備份驗證 CLI/BAT 與來源唯讀防護已入 main；正式業主 Windows 實機部署、登入/操作及災難還原簽收仍未執行 |

| RB-011-PRICING | MERGED_CODE_ONLY | P1 | 已合併 v3 食材歷史進價、叫貨驗收單價、菜品配方與估算毛利；屬估算功能，正式營運成本／會計與真實菜單驗收尚未完成 |
| RB-012 | PLANNED | P2 | FIFO／移動平均、批次效期、稅費／折扣、POS 出餐扣料與營運會計成本 |
| RB-013 | PLANNED | P2 | 與 AI menu-planner 的可控、版本化資料交換與食材識別碼映射，目前未做 |

| RB-014 | MERGED_CODE_ONLY | P1 | Vercel Demo 虛構菜單、食材歷史價、配方與成本估算、進貨驗收價格已合併；公開網站最新部署/人工互動仍須獨立驗證 |

| RB-015 | MERGED_CODE_ONLY | P1 | Vercel Demo 虛構智慧備份教學（定時檢查、無更新跳過、手動版本/保留/刪除）程式已合併；不能視為真實資料庫備份 |

| RB-016 | MERGED_CODE_ONLY | P1 | 本機登入後表單 reset 非同步錯誤修正及回歸程式已合併；正式 Windows 操作仍需人工驗收 |

| RB-017 | MERGED_CODE_ONLY | P1 | 本機離線 owner 密碼復原（備份驗證、SQLite 防護、Session 撤銷、稽核）已合併；Windows 中文 BAT 為 RB-018，現場演練仍未完成 |
| RB-018 | MERGED_CODE_ONLY | P1 | PR #7 Squash `d307bc38967f05446dd79b3b093a2085d669a364`，main push CI #40464034678 **5/5 PASS**；Windows 業主離線復原雙擊 BAT 已合併，正式 Windows 業主機操作/備份還原尚未現場驗收 |

| RB-019 | MERGED_CODE_ONLY | P1 | PR #8 已合併安全稽核直接 TCP 來源 IP（owner 查閱，不信任可偽造標頭）；過去紀錄來源 IP 無法追補，正式環境可信代理另需驗證 |
| RB-020 | MERGED_CODE_ONLY | P1 | PR #8 已合併從授權列表產出 .xlsx／列印預覽與條件篩選；真實業主 Excel／印表機工作流程尚未驗收 |
| RB-021 | MERGED_CODE_ONLY | P1 | PR #9 Squash `6e474b187843179dc2af15836f55675210eca3a4`，main push CI #40484482579 **5/5 PASS**、最新 Head Codex 無重大問題；owner-only 菜品封存/恢復與配方食材移除程式已合併，正式營運與 Demo 人工操作尚未驗收 |

| RB-020-SEC | MERGED_CODE_ONLY | P2 | PR #8 已合併登出清除報表快取、列印 CSS 鎖定及非同步舊報表重現防護；正式場域操作仍待人工驗收 |

| RB-022 | MERGED_CODE_ONLY | P1 | PR #10 已合併多品項叫貨、供應商分單、整張主管核准／驗收、逐行價與 LINE 人工草稿；實際 LINE 分享與門市工作流程尚未真機驗收，草稿不代表已發送 |

| RB-022-SEC | MERGED_CODE_ONLY | P2 | PR #10 已合併正式與 Demo 的同步提交鎖、按鈕停用及失敗重試回歸；真實跨裝置/慢網路與人工連點驗收尚未執行 |

| RB-022-MODAL | MERGED_CODE_ONLY | P2 | PR #10 已合併共享 modal 生命週期 ticket、DOM instance guard，避免舊 GET/關閉後回應覆蓋新視窗；保留 VM 回歸，真實瀏覽器操作待驗收 |

| RB-023 | DONE_STAGING | P1 | Cloudflare Workers＋D1 staging v3 Schema 已經 Run #40172089719 遠端驗證 PASS；prod D1 仍未 migration，正式 API 未上線 |
| RB-024 | PLANNED | P1 | D1 正式/Preview 各建獨立資源與 migration；Worker Auth/RBAC/CSRF/安全初始業主建立；各營運模組 D1 原子性資料存取；加密異地備份與災難復原驗收後才可交付業主 |

| RB-025 | MERGED_CODE_ONLY | P1 | PR #14 的 WebCrypto Password、Session／Origin／CSRF／RBAC 基礎已合併；Preview /api/me 唯讀，Production Auth disabled，雲端登入仍未對外啟用 |

| RB-026 | DONE_STAGING | P1 | PR #15 已合併、Run #40188578478 實際建立 staging D1 active Owner=1、Session=0、Schema/FK 驗證 PASS；Cloudflare 正式 Login API 仍 503 |
| RB-027 | PLANNED | P1 | Workers Free CPU 10ms 下之 PBKDF2 600k 真機成本／相容性驗收，與 login 防暴力破解、帳號鎖定稽核、雲端原生 Session 與登出開發；不可在性能／安全證據前啟用實際登入 |

| RB-028 | MERGED_CODE_ONLY | P1 | PR #17 已合併 D1 Login/Session/Audit/限流與 0002 程式；**staging D1 0002 已於 PR #18 的 Run #40204026605 套用驗證**，production 未套用，公開 API 仍 503，Hosted CPU/Access 尚未實測 |
| RB-029 | PLANNED | P1 | Workers Runtime 真機 PBKDF2 600k CPU/付費方案與 Cloudflare CF-Connecting-IP 來源可信度 驗收、Preview Access 限制與獨立 staging Worker；全部完成且驗證前不得開啟公開真實登入 |

| RB-028-P2 | MERGED_CODE_ONLY | P2 | PR #17 的 NOCASE/來源索引與過期登入嘗試清理程式、D1 0002 migration 和 EXPLAIN 測試已合併；staging 0002 已驗證、production 未套用，Cron 真實排程未設置 |

| RB-030 | DONE_STAGING | P1 | PR #18 已 Merge；CHECK #40203410303 PASS、APPLY #40204026605 PASS，staging D1 `0002` 實際套用並完成 ledger/三索引/Owner/FK 驗收；production 不變 |

| RB-031 | DONE_LOCAL | P1 | PR #19 已 Merge，手動 synthetic local workerd 三樣本 Run #40208993373 PASS；wall median hash/正確/錯誤 79/79/78 ms，**非 Hosted CPU** |
| RB-032 | PLANNED_HOSTED_VALIDATION | P1 | PR #20 已 Merge，但 Hosted PBKDF2 探針仍 disabled／未部署；待 Cloudflare Worker-level Access 與所有 URL/Bypass 現場證據，才可另行授權部署、測量實際 CPU time |
| RB-033 | MERGED_CODE_ONLY | P1 | PR #21 已 Squash Merge `85f055e74593`，main push CI #40375126939 5/5 PASS、Codex 無新 P1/P2、歷史 Threads 8/8 Resolve；只有靜態安全檢查與 Access 驗收 SOP，**遠端 Access/Hosted CPU 尚未驗證** |
| RB-034 | MERGED_CODE_ONLY | P1 | PR #22 已 Squash Merge `324677783fc1`，main push CI #40380907839 5/5 PASS，正式 Codex Review 最新 HEAD 無重大問題，唯一 P2 已 Resolve；私人 Access 證據紀錄格式稽核僅離線功能，**未驗證真實 Cloudflare Access** |
| RB-035 | MERGED_CODE_ONLY | P1 | PR #23 已 Squash Merge `98e88811658b`，main push CI #40421482417 **5/5 PASS**；Workers invocation CPU/Wall/outcome 人工去識別化資料之離線分析已合併，**未部署探針、未取得真實 Hosted CPU** |
| RB-036 | MERGED_CODE_ONLY | P1 | PR #24 Squash Merge `832165a00430`，main push CI #40435777549 completed/success **5/5 PASS**；Cloudflare 內部 Login IPv4/IPv6 正規化已合併；CF-Connecting-IP 實站可信性、Access、Hosted CPU 未驗證，公開 Login 仍 503 |
