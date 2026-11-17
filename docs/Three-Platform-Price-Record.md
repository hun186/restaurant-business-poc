# 三版食材歷史價格維護一致性契約（2026-11-17）

此工項為 **三版行為一致**，不是三個環境共用同一個正式資料庫：

| 平台 | 執行與資料來源 | 歷史新增操作 | 寫入安全 |
|---|---|---|---|
| 落地版 | Node + SQLite \`src/pricing.js\` | \`POST /api/command\` / \`price.record\` | Manager/Owner，授權門市，SQLite transaction + audit |
| Vercel 公開展示 | \`vercel-demo/pricing-demo.js\` 瀏覽器模擬 | \`price.record\`（既有 demo command） | 僅虛構資料，沒有真正登入/伺服器寫入 |
| Cloudflare 正式 | Worker + D1 \`native-price-http.mjs\` | \`POST /api/price\` / \`price.record\` | **預設關閉**、獨立 \`CLOUD_NATIVE_PRICE_WRITE_GATE\`、CSRF、Manager/Owner 範圍、D1 batch audit rollback |

統一：\`location_id\`、\`ingredient_id\`、\`unit_price_twd\`、\`unit\`（選填）、
\`price_date\`（選填，Asia/Taipei 當日）、\`supplier\`（選填），歷史資料追加不覆寫。
價格以整數分記錄，最多兩位小數、**1～100000000000 分**；
單位需與食材主檔一致或可換算（公斤／公克、升／毫升等）。
若同門市、食材、生效日已有價格，仍追加歷史列，以 latest price_date、
created_at 與 rowid 決定有效價格。不得直接刪除或覆寫既有價格；
未來生效單價不影響當日估值；未定義價格顯示缺價，不得當零元成本。

Cloudflare 使用固定 HTTPS + same-origin + Cookie Session + CSRF，
生效門市/食材與角色/門市授權在寫入前及同筆 D1 transaction 內檢查；
稽核 \`price.record\` 與新增 row 同批執行，失敗回滾。
寫入成功不直接改 stock_moves、既有收貨單、目前庫存。
不延伸 Vercel Demo 至真實身分認證或伺服器資料；不得在展示版填真實資料。

**Release Gate**：GitHub Hosted CI、正式 Codex Review、Zero Findings、
Clean Mergeable、Main CI、Cloudflare G0 必須分開驗證。
PR 合併不代表正式價格寫入已啟用。正式 \`CLOUD_NATIVE_PRICE_WRITE_GATE\`
必須由業主另行批准/設定/Deploy，先有最新加密備份及 Owner/Manager/Staff
權限、價格/單位/生效日、重送/失敗回滾、稽核/估值現場 UAT。
\`CLOUD_NATIVE_ACCOUNT_WRITE_GATE\` 與 \`CLOUD_NATIVE_PRICE_WRITE_GATE\`
相互獨立。退貨/報廢/耗用另做獨立工項，不與此價格記錄 PR 混寫。
