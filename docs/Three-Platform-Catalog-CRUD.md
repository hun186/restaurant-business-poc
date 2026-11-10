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

## Phase 3B（2026-11-10｜Native Owner 操作畫面）

正式 Owner 清單在取得 `/api/native/status` 的 `catalog_write_enabled=true`、同源已驗證身分且 Role=owner 後，才顯示食材／門市列內的「編輯」「停用／恢復」。所有操作使用目前已授權載入（最多 500 筆）的真實 D1 列資料作 expected CAS 快照，編輯時 SKU 唯讀，停用需使用者明確確認；錯誤或未確認結果提醒先刷新，禁止假成功或無限重試。取消、導航、重新整理與登出會使前次 UI Revision 失效。

正式 Owner 不引入 Demo Mock、localStorage/sessionStorage 或額外 Cookie；仍從原生 Session 記憶體 CSRF 使用同源 /api/catalog。當 Write Gate 關閉、登入未完成或 Role 非 Owner 時，表格沒有任何寫入按鈕。仍不提供永久刪除。

範圍：純 Native Owner 前端／樣式／合成靜態回歸；不開啟正式 Gate、不新增 D1 Schema、秘密、部署、資料異動。正式瀏覽器、真實 Owner 登出/Session 撤銷與 Cloudflare 活躍版號仍需獨立實機 UAT；Phase 4 待跨平台整合驗收。


## Phase 4A（2026-11-10｜三平台主檔行為一致性回歸）

針對真實差異，以三種**獨立執行環境的合成資料**驗證同一契約：本機 SQLite `command()`、Vercel 公開 Demo 的 VM/browser `/api/command`，以及 Cloudflare Native Worker 的 in-memory D1 adapter `/api/catalog`。既有三平台回歸已涵蓋 SKU 不可編、CAS 過期、停用後保留歷史與最後啟用門市。此次補強**已停用門市仍可更名**的跨平台行為：食材停用後仍不可編輯，門市更名採原始名稱 CAS，恢復不重置歷史。

Vercel Demo 的 `location.create`／`ingredient.create` 現使用權威 `normalizeCatalogCommand` 驗證精確欄位、長度與必填項，並拒絕既有門市名稱與食材 SKU 重複；這些拒絕不得增加紀錄或稽核。Demo 中的合成測試以 Node VM 內存載入頁面 Mock，並以經檢查的同一模組副本提供瀏覽器 `import` 的測試替身，不做網路連線、Cloudflare 操作或真實 Login/Write。

**已知設計差異不擅自改動：**本機管理者可建立食材；Cloudflare 正式食材主檔變更目前限定 Owner；Native D1 的既有長門市名稱可讀取並以快照更名，正式 Owner 新名稱限制 60 字。此 PR 不改 Owner RBAC、Worker Schema、Gate、Secrets、D1 正式資料或部署。Phase 4B 仍需受控的桌機／手機真實 Owner、登出 Session 撤銷與 Cloudflare 目前版本實機驗收。

Phase 4A 第一輪正式 Codex Review 另指出 Vercel Demo 新增食材表單的 `FormData` 會將 `min_stock` 傳成字串，而嚴格契約要求 number。已改由 `showForm()` 透過可測試的 `catalogCreatePayload()` 先轉型再驗證（包括新增門市），並在測試中以 **FormData 等價字串輸入 → 同一 UI 轉換函式 → Mock /api/command** 實際測試；格式錯誤或缺值應拒絕，不能藉放鬆共用契約解決。仍待修正後最新 HEAD Hosted CI 和正式 Codex 複審。

## Phase 4B-Dev（2026-11-10｜正式 Owner 寫入結果跨 Session 競態防護）

使用者暫時無法操作實機，因此先補強 **真實 Owner 瀏覽器端非同步寫入**，不變更正式授權或資料。過去任一工作／主檔／叫貨／盤點／維修 POST 在使用者已登出並重新登入後才返回 401、409 或成功時，前端可能將舊 Session 結果套用到新 Session（例如錯誤要求重新登入，或以新 Session 刷新資料）。現為每次已驗證的身分建立單調遞增 `authEpoch`，在請求發出時綁定 Epoch + CSRF，回應時確認同一身分；若身分已切換，**忽略舊回應的 UI 效果**。另外寫入按鈕／表單需要相同渲染 `revision`，不得從切換後已移除的 DOM 發出新操作；同身分導覽變更後，舊 POST 不會替目前畫面觸發多餘刷新。

所有原生 API 仍由後端檢查 Cookie Session／CSRF／RBAC／Gate／交易一致性。此修正只影響瀏覽器接收舊回應時的行為，**不代表能取消已提交的伺服器交易**，也不代表正式 Owner 登出或 Cloudflare 上線 UAT 已完成。新增 Node VM 合成測，直接執行正式 UI 原始碼中的五類寫入函式，模擬遲到 401／成功以及新 Session 行為，不用外部網路、帳密或 D1。正式 Production Gate、Secrets、Worker、D1 Schema、資料與部署一律不修改。
