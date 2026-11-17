# 三版食材耗用（stock.usage）一致性契約／Native D1 安全上線

## 業務語義
使用者以「授權門市 + 食材 + 耗用數量 + 選填用途」登錄耗用。
耗用只允許 **Owner / Manager**；成功後新增 \`stock_moves\` 負量 \`usage\` 流水
與 \`stock.usage\` 安全稽核。**不得直接覆寫既有流水或更新快取 on_hand**。
庫存由 \`stock_moves.qty_delta\` 加總計算；不得扣至負數。
\`stock_moves\` 的既有 SQLite / Cloudflare v3 CHECK 已包含 \`usage\`，不需 Schema 遷移。

| 平台 | 操作 | 資料來源 |
|---|---|---|
| 落地 SQLite | \`POST /api/command\`，\`action=stock.usage\` | 本機 SQLite 原子交易＋稽核 |
| Vercel 公開展示 | \`stock.usage\` 示範操作 | 瀏覽器虛構資料，**不會寫正式伺服器** |
| Cloudflare Native D1 | \`POST /api/stock/usage\`，\`action=stock.usage\` | 真實 D1，獨立 Gate + HTTPS Session/CSRF + 原子批次 |

## Cloudflare Native API
\`CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE=operator-released\` 僅由業主另行受控放行。
未設定或 disabled 時，\`stock_usage_write_enabled=false\` 且 HTTP 503 fail closed，
**與帳號新增、價格、叫貨、盤點五個業務 Gate 獨立**。不得在 PR 中預設啟用或寫入正式 D1。

正文：
\`\`\`json
{
  "action": "stock.usage",
  "data": {
    "location_id": "<valid UUID>",
    "ingredient_id": "<valid UUID>",
    "qty": 1.25,
    "note": "備餐耗用"
  }
}
\`\`\`

- 只允許 HTTPS 同源 POST＋合法 Cookie Session＋CSRF，\`Owner/Manager\` 且授權有效門市與食材。
- \`qty\` 為大於零、最多 1,000,000、最多三位小數的 JSON number；備註選填最多 300 字。
- 為保護遠端網路重試，須有獨立 \`X-Idempotency-Key\` UUID 標頭。同帳號使用同一 key 重送不會新增第二筆 \`usage\` 流水；原版地端/展示版不需 HTTP 專屬重試識別，**業務行為一致、網路防重送機制依平台加強**。
- 餘額核對、活躍門市/食材、Owner/Manager 即時 Session／角色／門市授權以及重複 key 拒絕，在同一筆 D1 transaction 的 \`INSERT ... SELECT\` 再檢查；Audit 與 rollback sentinel 同批提交，寫入/稽核不允許只成功一半。
- HTTP 200 僅表示新增該筆耗用；HTTP 409 代表已重送／餘額不足（沒有扣帳）；HTTP 503 可能是併發衝突或 DB 暫不可用，**不得盲目重送**。務必先查看最新庫存流水確認結果。
- 原始 \`stock_moves\` 和庫存估值頁維持唯讀。Ledger 寫入後估值重新讀取現有累積庫存與有效食材單價，不會更動價格歷史。

## 發布／驗收邊界
PR 的 Hosted CI／Codex Review、Main CI、G0 僅是程式與版本驗證，不是 D1
實機 write UAT。部署整合前不得打開 Gate；正式放行需要操作員核准、
新近加密備份、Owner/Manager/Staff 的作用域與拒絕情境、庫存不足、HTTP
重送、流水／audit、估值更新實機驗收。

> 退貨／報廢／任意正負庫存調整尚未實作，另見 Issue #212。現有
> \`stock_moves.move_type\` 僅允許 purchase/usage/adjustment；未授權
> Schema 變更前不得冒用 \`usage\` 當作退貨或報廢，也不允許直接改舊流水。
