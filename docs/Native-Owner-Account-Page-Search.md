# Native Owner 帳號清單：目前分頁搜尋與篩選組合（2026-11-17）

## 目的

當正式業主帳號清單越來越多時，業主需要快速定位某一個員工／主管、查看其門市授權是否可用，但不應因此擴大後端讀取範圍。本次在已合併 #201 的本頁篩選之上，增加「搜尋本頁帳號」欄位。

## 實作與界線

- 僅搜尋當次經合法 Owner Session 的 `GET /api/accounts` 已回傳、且已渲染的**目前伺服器分頁**，每頁最多 50 筆；只比對帳號、顯示名稱與畫面已出現的門市授權文案。輸入最長 80 個字元；搜尋不經過伺服器、SQL 或其他 API，不擴大權限。
- 文字搜尋可與「全部帳號／需核對門市授權／已停用帳號」同時使用，兩者採交集。門市授權的既有警示定義不變；沒有新增角色授權或修改帳號的途徑。
- 換到下一個伺服器分頁，搜尋與篩選都重設為初始狀態；清楚標示「本頁」，避免誤以為查遍全部帳號。登出或舊畫面失效後，`live()` 判斷阻止舊欄位再次改動畫面。
- 使用 `textContent` 以及先前安全的 `effectiveStoreGrantLabel` 投影，不顯示帳號原始內部 ID、CSRF、Token 或其他 D1 隱藏欄位。

## 驗證與發佈

Node DOM 合成測包含帳號／姓名／門市搜尋、與警示篩選交集、清除搜尋恢復原列、兩頁 50+1 帳號換頁重設、失效 Session 忽略輸入、無額外網路呼叫，並更新保守 SHA-256 閉鎖清單。

不修改 Worker / D1 Schema / SQL / 任何正式資料、Cloudflare Secrets、Variables 或 Write Gates。最新 HEAD 的 Hosted CI 5/5、正式 Codex Review completed/0 Findings/0 unresolved、clean mergeable 為合併必要條件；合併後 main Verify、G0 及業主真實平板／桌機 UAT 各自獨立驗收。