# 三平台食材／門市 CRUD 共用契約（P1）

## 目前產品與優先順序

- 落地版：`public/` + `server.js` + `src/service.js`，Node SQLite，真正持久資料。
- Vercel：`vercel-demo/app.js` + `mock.js`，**僅虛構資料展示**，不存真實員工及財務資料。
- Cloudflare：`vercel-demo/owner-app.js` + `cloudflare/native-catalog-http.mjs`，正式 Worker/D1，原生 Session/CSRF/Owner RBAC 及獨立寫入 Gate。
- **共同契約是 `src/catalog-crud-contract.mjs`**，僅做無副作用命令及輸入正規化，**不是**授權器、儲存層或前端 Demo 模擬器。

## 命令形狀與資料生命週期

| 資源 | 建立 | 編輯 | 停用／恢復 | 永久刪除 |
| --- | --- | --- | --- | --- |
| 食材 | `ingredient.create` | `ingredient.update` | `ingredient.active` | 不提供 |
| 門市 | `location.create` | `location.update` | `location.active` | 不提供 |

`update` 使用 `{id,expected,changes}`。食材 `expected` 包含 `sku/name/unit/min_stock`；`changes` 僅 `name/unit/min_stock`，SKU 是不變識別碼。門市 `expected={name}`、`changes={name}`。後端務必執行 **compare-and-set**，不接受資料過期後無聲覆寫。停用/恢復使用 `{id,expected_active,active}`，二者必須是數字 0/1 且不同；操作需交易、稽核且不可刪歷史交易與庫存流水。

## 三平台後續接線規範

1. 後端各自適配 SQLite／瀏覽器虛構 Mock／D1，同一組操作名稱及相同欄位；後端必須**獨立**檢查角色、門市範圍、Session、CSRF、競態、FK、Audit，不能依賴共用前端驗證決定權限。
2. 正式 Cloudflare `CLOUD_AUTH_PHASE=disabled`、`CLOUD_NATIVE_CATALOG_WRITE_GATE` 預設關閉，開發與 merge **不得**為了展示而啟用；現有 G0 Worker/Build/Main 版本證據有效範圍只到當時 SHA，每次新正式部署需重新查驗。
3. 前端單列「查看／編輯／停用或恢復／歷程」需根據 API 可用能力顯示；未接線的能力標「待提供」，不可給假成功。
4. 貨品與門市一旦被業務流水引用，**永不物理刪除**；停用後應阻止新交易（後端確認）但允許閱讀舊紀錄。
5. Phase 1（此 PR）僅建置經檢查的契約及回歸測試，尚**沒有**新增正式 CRUD 端點或畫面；Phase 2 本機 SQLite 與 Vercel 虛構演示接線、Phase 3 Cloudflare gated D1、Phase 4 完成三平台門市與食材測試。不可將第一階段當成 CRUD 功能已上線。
