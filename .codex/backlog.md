# Backlog

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
