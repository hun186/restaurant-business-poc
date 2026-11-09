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

## Phase 2（本機 SQLite＋Vercel Demo 編輯、停用與恢復）

- 本機：`ingredient.update/active`、`location.update/active` 以同一共用合約正規化，Node SQLite 在交易中 Compare-And-Set、角色驗證、稽核、待辦叫貨／盤點阻擋停用、保留至少一間啟用門市、停用門市時撤銷其授權使用者 Session，歷史交易與庫存流水不物理刪除。
- Vercel Demo：同樣編輯／停用／恢復的操作名稱與前端 UI，但 `mock.js` 僅變更瀏覽器虛構資料，不提供真實帳號、實際 Session 或 D1 寫入。
- `src/catalog-crud-contract.mjs` 是權威來源；`public/`、`vercel-demo/` 的模組副本必須完全相同，新增回歸測試會於副本失同步時 FAIL。合約改動須同步修正三處並逐平台驗證，不得任意直接改某個副本。
- **Cloudflare Native D1 API 在本階段仍維持原有功能和安全 Gate，未提供新的編輯／停用 endpoint**；正式部署有新版前端資產不等於 Owner CRUD 已開通。

## Phase 3A（2026-11-10｜Cloudflare Native D1 後端 CAS 變更）

正式 D1 的既有 /api/catalog（HTTPS／同源／Owner Session／CSRF／獨立 Catalog Write Gate）新增四種命令：ingredient.update、ingredient.active、location.update、location.active，與本機／Vercel 使用相同欄位及 compare-and-set 操作名稱。

後端在 D1 交易內重新確認 Owner Session、舊值快照、啟用狀態、未完成叫貨／盤點、最後一間啟用門市；食材已有庫存、交易、價格或配方引用時，拒絕改變計量單位。使用 D1.batch 原子更新、稽核，停用門市時撤銷該店所屬使用者 Session，不物理刪除既有門市／食材／帳本。

**範圍限制：**此階段只增加正式 D1 後端命令和合成 SQLite adapter 回歸，尚未提供 Native Owner 正式瀏覽器的編輯／停用控制項，不能宣稱 Cloudflare 已驗收或發布。CLOUD_AUTH_PHASE、五種業務 Write Gate、Cloudflare Secret、正式 D1 Schema 和遠端資料均不修改，預設維持 fail-closed。
