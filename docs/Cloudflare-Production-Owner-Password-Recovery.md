# Cloudflare Production D1 業主忘記密碼：維護者一次性重設

## 何時使用

只有當業主**完全忘記目前密碼、無法用「我的帳號／變更密碼」**時才使用。平常改密碼請在登入後自己變更，不需要維護者，也不需要操作 Cloudflare 或 GitHub Actions。

此復原工具**只限固定 Production D1 中已存在、唯一啟用的 `owner`**。不會新增 Owner、重新套 Migration、清空 D1、刪除門市／食材／訂單、改寫其他使用者密碼或打開 Cloudflare Gate。沒有公開忘記密碼 API／Email 或短信重設連結。

## Windows 業主管理員的一鍵工具

在**原有 Git main 專案、已更新至已審核主線且 Git 工作目錄無修改**的 Windows 管理電腦，雙擊 `重設雲端業主密碼.bat`。

- **1（只檢查）**：輸入受限 Cloudflare Production D1 Read Token（不顯示），確認固定 Production 身分、Schema v3、兩筆 Migration、唯一 Owner、唯一對應的 Bootstrap 稽核、SQLite Integrity/FK。只印固定的 `PRODUCTION_OWNER_PASSWORD_RECOVERY_PRECHECK_PASS`；不顯示 ID、hash、salt 或人員資料。
- **2（一次性重設）**：先確認**已有可使用的加密備份及受控維護窗口**，使用具 Production D1 寫入權限的 Token，讀取相同唯讀狀態後，**逐字輸入 `RESET_EXISTING_OWNER_PASSWORD_ONCE`**，在遮蔽的終端機輸入新密碼及確認（長度 12–256）。在正式操作前**不要把 Token、舊密碼／新密碼存成命令列參數、環境變數、GitHub Secret／Issue、截圖或聊天文字**。
- 程式建立隨機 Salt + PBKDF2-SHA256-100k 密碼雜湊，以 D1 REST 一次性 guarded `batch` 更新**既有 Owner**、撤銷全部 Owner Session、寫入 `auth.password_reset` 稽核，再以**唯讀**檢查新憑證、Session=0、稽核筆數 +1、業務資料表總筆數不變。成功才印固定狀態 `PRODUCTION_OWNER_PASSWORD_RESET_VERIFIED`；不會印密碼、Salt、雜湊、Token、Cookie 或 SQL 原文。
- 若收到 `REMOTE_WRITE_UNCERTAIN` 或 `READ_POSTCHECK` 等錯誤，**不得直接再按一次重設**；一次 API 寫入即使遇到超時仍可能成功。先用唯讀檢查確認情況，必要時由維護者核對備份及真實資料，避免重複旋轉密碼。

### 建議操作順序

1. 業主通知維護者忘記密碼；維護者確認申請者身份（不使用匿名遠端請求）。
2. 短暫安排維護窗口，盡量避免期間新增訂單／其他人登入；確認已保存 D1 加密備份及還原方法。**工具本身不會關閉或打開 Login Gate**。
3. 執行 BAT 選 **1**，確定唯讀 PASS。
4. 再執行 BAT 選 **2**；新密碼只交給業主並保存於私人密碼管理器，避免透過公開聊天傳遞。
5. 成功後所有舊 Session 已失效，業主重新使用新的密碼登入。建議業主再至「我的帳號」換成只有他本人知道的密碼。
6. 進行一次**真正的 Owner 登入**與既有資料查詢確認；工具 PASS 並不代表瀏覽器登入 UAT 自動完成。

## 實作與安全界線

- `tools/cloudflare-prod-owner-password-recovery.mjs` **僅 Node 本機互動 CLI**；不能由 Worker 匯入，不能由 GitHub Actions 直接執行重設，不能通過 URL、查詢參數或一般遠端使用者觸發。
- 程式拒絕非 TTY 密碼輸入、非 main／本機有修改／GitHub Actions，嚴格固定正式 D1 UUID 與帳戶。Cloudflare Token 是授權者在本機遮蔽輸入，並未硬寫在程式。
- 使用既有受控 Cloudflare D1 REST Transport；只有經明確確認後會呼叫 `{batch:[UPDATE users, DELETE sessions, INSERT audit_logs]}`。不會寫入任何其他資料表。
- 本工具不是復原 Owner 帳號被竄改、密碼雜湊格式不合法、多位 Owner、缺 Bootstrap Audit、Schema/FK 不正確的救援通道。這些情況會拒絕自動復原，需另行調查。
- **開發、CI、PR Merge 不會執行任何 Production D1 寫入**；需維護者獨立執行工具並確認正式 Token 才會觸發。正式 D1 一旦重設密碼，這是具有真實影響的操作，不屬於唯讀檢查。
