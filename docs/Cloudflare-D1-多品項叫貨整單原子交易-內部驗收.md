# D1 多品項叫貨單整張核准／驗收：內部交易驗收（P0 #34）

## 安全邊界
此增量只提供 `cloudflare/group-order-write-internal.mjs` 與合成測試，不接 Cloudflare Worker 的公開 API 路由；正式 `/api/command` 繼續回 503。僅限 `CLOUD_AUTH_PHASE=preview-readonly` 與 `GROUP_ORDER_WRITE_STAGE=internal-test-only` 雙重配置的離線／受控測試；不可對正式門市輸入個資或真實進貨資料。本次沒有 migration、正式部署、真正 D1 遠端驗證或 Owner 實場 UAT。

## 工作流程與契約
依既有 `src/order-batches.js` 的 `POB-[A-F0-9]{32}` 整單編號及後綴 `-001` 至 `-060`，本內部 API 只接受 `order.batch-approve` 和 `order.batch-receive`，不含手動送出確認、作廢、進價／採購成本、重複收貨修正和退貨。Owner/Manager 可核准／驗收，Staff 不可操作。

SQL batch 先以附帶必要欄位的稽核 INSERT 執行**強制約束守衛**：確認單據行數未變、連號、同門市同供應商、全部有效食材與有效門市、狀態一致、活躍 Session/角色及門市授權；收貨需不存在該單據任一 purchase 流水。如果不符，寫入 `audit_logs.detail=NULL` 觸發 NOT NULL，讓整個 D1.batch 回滾（不是無聲 0-row）。審核成功後，一條 UPDATE 核准整單；驗收成功後，一條 INSERT…SELECT 追加整單的 `stock_moves`，再 UPDATE 整單為 received。不直接改寫 `on_hand`。

交易最後同樣透過 NOT NULL 約束驗證行數、最新狀態及（驗收時）庫存流水行數；若有任何項目異常，整批回滾，包括先前已寫入的稽核、庫存及狀態。合成 Fixture 注入角色撤銷、門市停用、單據內容變動與 SQL 錯誤，檢查不會部分入庫。

## 不可過度宣稱
GitHub Hosted CI、Codex Review 和 Cloudflare Workers Build 只驗證程式；仍需獨立完成 Access URL 實地證據、Hosted PBKDF2 CPU、Staging 實際 D1 交易、Production D1 migration/備份還原/RTO-RPO、完整營運功能與業主 UAT。正式 API 不得未審即開放。