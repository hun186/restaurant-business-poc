# Cloudflare D1 REST batch 回滾：獨立測試庫實機驗收

## 現狀與目的

- Production D1 Schema v3、Migration 0001/0002 已完成，不得重跑 first-init。Windows 與 GitHub 唯讀檢查已證明 Owner=0；正式 Owner 與登入均未開通。
- Cloudflare D1 REST /query 支援 batch；Worker Binding batch() 的交易保證不能直接視為 REST /query 的遠端實測證據。
- **這次只針對全新、空白、完全獨立的 Scratch D1**。不修改 Production、Staging、既有 Recovery Drill D1。沒有 Cloudflare API Token 時只能做合成 CI，不宣稱實機成功。

## 操作說明（Windows）

1. Cloudflare Dashboard → Storage & databases → D1 → Create database，建立一個全新空白 D1，名稱為 restaurant-business-owner-batch-lab-20261101（或相同固定前綴，後接 4–40 個小寫字母、數字、連字號）。
2. 取得這個**全新 Scratch D1 的 UUID**。不要拿 Production、Staging 或 G5 recovery drill 的 UUID 替代。工具會先查 Cloudflare GET metadata，必須完全符合 UUID + 指定測試庫名稱，並檢查沒有任何應用資料表。
3. 在可信任電腦、合併過的 main 版本，執行：

    git checkout main
    git pull --ff-only origin main
    run-disposable-d1-batch-lab.bat

   Linux 可執行 bash run-disposable-d1-batch-lab.sh。Node.js >=22.13 必要。
4. 輸入新的 Scratch DB UUID，先選 **1 / Probe**。隱藏輸入持有 D1 權限的 Cloudflare Token（可以使用限權、短效 Token）。成功回報 SCRATCH_D1_EMPTY_VERIFIED，並且完全沒有寫入。
5. 要正式驗證批次回滾，選 **2 / Test**。需乾淨的 main、隱藏 Token、輸入精確確認文字 RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT，才會對 **Scratch DB** 寫入。**不要在聊天、GitHub 或命令參數中貼 Token**。
6. 工具在 Scratch DB 建立 owner_batch_lab_* 測試表，使用 REST batch 成功新增 ID 1、2，確認 2 筆；然後第二個 batch 故意讓兩筆 INSERT 的主鍵都是 ID 3，必須證實 API 返回真實 UNIQUE 衝突。
7. 若第一筆也回滾、總數仍是 2，且 ID 3 不存在，輸出狀態 DISPOSABLE_D1_REST_BATCH_ROLLBACK_PASS。若仍剩 3 筆即 ROLLBACK_NOT_ATOMIC，或 API 回應無法證明 UNIQUE 衝突即 FAILURE_NOT_PROVEN_UNIQUE，均不得進入正式 Owner 建立。
8. **不會自動清除任何資料庫**。Scratch DB 會保留測試表及控制資料供人工檢閱，可由操作者在 Cloudflare Dashboard 另外刪除整個 Scratch DB；這種操作絕對不可對 Production D1 進行。
9. 失敗後不可反覆按 2 對同一庫重試。請僅分享非敏感 phase/status 代碼，不要分享 Token、原始 API 回應、SQL、密碼或雜湊。

## 驗收限制

GitHub Hosted CI 與合成測試 PASS 並不代表真實 Cloudflare D1 通過。本實驗即使實機 PASS，也只證明所測的 SQL UNIQUE 衝突回滾場景，並不能證明網路斷線、部分執行、服務崩潰等所有事故下的原子性。**不得因此自動執行正式 Owner 建立**。

Production Owner 建立與正式登入仍須另行授權和驗收：固定資料庫 ID、v3 + Migration=2、Owner=1、初始稽核=1、FK/quick_check、備份、Session/CSRF/Rate Limit、Cloudflare Worker 實站安全性。

## 官方文件

- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
- https://developers.cloudflare.com/d1/worker-api/d1-database/

程式：tools/cloudflare-d1-rest-batch-lab.mjs；合成測試：tests/cloudflare-d1-rest-batch-lab.test.js。
