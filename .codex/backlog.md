# Backlog

| ID | Status | Priority | Work |
| --- | --- | --- | --- |
| RB-001 | IN_REVIEW | P1 | Public Repo 已建立，PR #1 已提交完整 PoC；等待新 HEAD 對應的 Windows／Ubuntu Hosted CI 與正式 Codex Review，未授權不可 Merge |
| RB-002 | PLANNED | P1 | 多人正式部署拓樸、HTTPS、Secure Cookie、遠端連線安全與後端儲存選型 |
| RB-003 | PLANNED | P1 | 角色細粒度授權、跨店／跨角色越權完整測試與帳號停權操作流程 |
| RB-004 | IN_REVIEW | P1 | 自動備份、無變化跳過、管理介面已於 PR #1 開發；待 Hosted CI、正式 Codex 複審與 Windows/安全驗收 |\n| RB-011 | PLANNED | P1 | 異地／跨磁碟備份、Windows 隔離還原演練、業主簽收（本機功能完成不等於整體災難復原完成） |
| RB-005 | PLANNED | P2 | 多品項採購、批號效期、進銷存成本、配方與耗損報表 |
| RB-006 | PLANNED | P2 | 排班月曆、跨日班、假別與人力／工時規則 |
| RB-007 | PLANNED | P2 | 課程附件、測驗題庫、複訓與多維度考核流程 |
| RB-008 | PLANNED | P2 | 預定保養、開關店 SOP、值日表、設備／食安檢查表 |
| RB-009 | PLANNED | P2 | Excel 匯出、庫存成本／營運分析、POS 與報表介接 |
| RB-010 | PLANNED | P1 | 業主 Windows 實機部署、登入／測試帳號／備份還原與簽收 |

| RB-011 | IN_REVIEW | P1 | v3 食材歷史價、叫貨驗收單價、每份配方和估算毛利，待 Hosted CI / Codex 正式審查 |
| RB-012 | PLANNED | P2 | FIFO／移動平均、批次效期、稅費／折扣、POS 出餐扣料與營運會計成本 |
| RB-013 | PLANNED | P2 | 與 AI menu-planner 的可控、版本化資料交換與食材識別碼映射，目前未做 |

| RB-014 | IN_REVIEW | P1 | Vercel Public Demo 增加虛構菜單、歷史價、配方、成本毛利試算與進貨驗收單價；待 Hosted CI、Codex Review、Merge 及 Vercel 部署驗收 |

| RB-015 | IN_REVIEW | P1 | Vercel Demo 虛構智慧備份教學頁：自動檢查、無異動跳過、虛構手動版本、保留份數與刪除。待最新 CI、Codex Review、Merge 授權及實站確認 |

| RB-016 | IN_REVIEW | P1 | 本機登入後 `e.currentTarget.reset()` 非同步 null 錯誤；已修前端並新增 regression，待 Hosted CI／Codex Review、使用者授權 Merge |

| RB-017 | IN_REVIEW | P1 | Owner 初始密碼遺失：本機離線密碼復原工具（先驗證備份、保留 SQLite、撤銷 Session、稽核），待 Hosted CI / Codex Review / Merge 授權 |

| RB-019 | IN_REVIEW | P1 | 安全稽核加入 TCP 來源 IP（owner 查閱、不採信偽造標頭、舊資料無法還原），待 CI／Review／Merge |
| RB-020 | IN_REVIEW | P1 | 透過既有列表 API 權限產製多工作表 .xlsx 與可選欄位／日期／關鍵字的列印預覽，待 CI／Review／Merge |

| RB-020-SEC | IN_REVIEW | P2 | PR #8 登出清除報表快取、即刻鎖定列印 CSS、防範非同步舊報表重現（正式版＋Demo）；待 Hosted CI／最新 Codex 重審 |

| RB-022 | IN_REVIEW | P1 | PR #10 多品項叫貨、依歷史價供應商分單、整張主管核准／驗收、逐行價格及 LINE 人工分享草稿；前輪 CI PASS 但最新重送防護修正須新 HEAD CI／Codex 複審，不得未授權 Merge |

| RB-022-SEC | IN_REVIEW | P2 | PR #10 `caebe207` Codex 重複提交 Finding：正式與 Demo UI 同步提交鎖、停用按鈕、失敗重試；新 VM 非同步雙擊回歸已提交，待最新 SHA Hosted CI、Review Thread 回覆／Resolve 及正式複審 |

| RB-022-MODAL | IN_REVIEW | P2 | PR #10 共用 modal 生命週期：正式／Demo 批次與單品項表單共享 root.__openTicket，防止舊 GET／關閉後遲到回應覆蓋新視窗；保留 DOM instance guards、新 VM 雙向回歸。待最新 HEAD CI、Codex 複審及真人驗收 |

| RB-023 | DONE_STAGING | P1 | Cloudflare Workers＋D1 staging v3 Schema 已經 Run #40172089719 遠端驗證 PASS；prod D1 仍未 migration，正式 API 未上線 |
| RB-024 | PLANNED | P1 | D1 正式/Preview 各建獨立資源與 migration；Worker Auth/RBAC/CSRF/安全初始業主建立；各營運模組 D1 原子性資料存取；加密異地備份與災難復原驗收後才可交付業主 |

| RB-025 | MERGED_CODE_ONLY | P1 | PR #14 的 WebCrypto Password、Session／Origin／CSRF／RBAC 基礎已合併；Preview /api/me 唯讀，Production Auth disabled，雲端登入仍未對外啟用 |

| RB-026 | DONE_STAGING | P1 | PR #15 已合併、Run #40188578478 實際建立 staging D1 active Owner=1、Session=0、Schema/FK 驗證 PASS；Cloudflare 正式 Login API 仍 503 |
| RB-027 | PLANNED | P1 | Workers Free CPU 10ms 下之 PBKDF2 600k 真機成本／相容性驗收，與 login 防暴力破解、帳號鎖定稽核、雲端原生 Session 與登出開發；不可在性能／安全證據前啟用實際登入 |

| RB-028 | MERGED_CODE_ONLY | P1 | PR #17 已合併，內部 D1 Login/Session/Audit/限流及 0002 索引程式已入 main；公開 API 仍 503，遠端 staging 0002 尚未套用，Workers CPU／Access 真機驗收未完成 |
| RB-029 | PLANNED | P1 | Workers Runtime 真機 PBKDF2 600k CPU/付費方案與 Cloudflare CF-Connecting-IP 來源可信度 驗收、Preview Access 限制與獨立 staging Worker；全部完成且驗證前不得開啟公開真實登入 |

| RB-028-P2 | IN_REVIEW | P2 | PR #17 Codex 問題：限流 NOCASE 與來源索引、7 日過期嘗試分批清理；已新增 D1 0002 Versioned Migration 與 EXPLAIN QUERY PLAN 測試，**尚未套用 staging/prod**、Cron 未設；需最新 CI + 正式 Codex 複審與授權 Merge |

| RB-030 | DONE_STAGING | P1 | PR #18 已 Merge；CHECK #40203410303 PASS、APPLY #40204026605 PASS，staging D1 `0002` 實際套用並完成 ledger/三索引/Owner/FK 驗收；production 不變 |

| RB-031 | IN_REVIEW | P1 | PBKDF2 600k 虛構密碼隔離工作：本機 workerd 3 組 wall-clock 探針、獨立無 D1/Secrets/外網入口的手動 GitHub Action、回歸及操作文件；待 Hosted CI/正式 Codex Review，不代表已證明 Hosted CPU 配額 |
| RB-032 | PLANNED | P1 | 在可確認 Cloudflare Access/等效隔離的 staging 環境，用純合成資料驗證 Workers 真正 CPU time、1102/exceededCpu、Free/Paid 適配性；未獲授權不可部署，通過前不得開啟真實登入 |
