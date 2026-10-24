# 餐廳好管家 Codex 長期規範

## 專案目的與事實來源

本專案是 `restaurant-business-poc`，不是 `plumber-business-poc` 的分支或覆寫。介面參照其深藍／青綠 RWD 視覺；業務邏輯、資料與權限獨立。實際程式碼、Schema、測試及目前 GitHub Hosted 狀態優先於舊對話敘述。長期脈絡見 `.codex/project.md`、`.codex/memory.md`；進度見 `.codex/backlog.md`。

## 安全／資料邊界

1. 公開 GitHub 只放程式、文件、虛構資料，不得提交 `.env`、`data/`、`backups/`、Cookie、員工個資、密碼或測試金鑰。
2. 所有資料變更必須由後端確認角色＋門市範圍，不能僅隱藏前端按鈕；員工不可自行核准採購與盤點。
3. 叫貨核准後方可入庫，重複收貨不得重複扣帳／入庫。庫存唯一事實來源為 `stock_moves` 帳本；不得直接修改 `on_hand`。
4. 盤點確認若帳面庫存已變動，應拒絕確認並請求重算。
5. 不可把 Node.js SQLite 本機服務暴露於公網，或聲稱 Vercel 有持久 SQLite。需要多店跨網連線時，先明確定義部署架構、TLS、管理員權限、備份與法遵措施。
6. 更新 schema 必須有版本遷移與完整性檢查，不可靜默重建或覆蓋正式庫。
7. 稽核應記錄登入與業務變更，避免寫入密碼、Token 或可回復密碼的資訊；若權限被改動應撤銷 Session。

## 工作流程

- 先讀 `.codex/project.md` 的 Current State 與 `.codex/memory.md` 的 Current Focus。
- 依任務讀 `.codex/backlog.md`；勿一次載入全部歷史。
- 修改時保持最小作用範圍，先新增測試並執行 `npm run check`，再建立 PR。
- Hosted GitHub 的**最新 Head SHA** 才是 PR／CI／正式 Codex Review 權威；Running 不等於 Completed。任何未取得使用者明確合併授權的 PR 不得 Merge。
- 不可將規劃、開發中、測試中寫成已完成。維持 README、測試和專案記憶同步。
- 新專案 README 若已有實質內容，應最小修訂；本 Repo 首次初始化的 README 已為充分狀態，不要無故整份重寫。
