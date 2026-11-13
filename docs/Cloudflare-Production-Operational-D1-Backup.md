# 正式營運期 Production D1 加密備份（Issue #176）

本工具**備份現有餐廳營運資料**，不是 Owner 首次建立、不是資料庫還原，也不會修改 Production D1 的任何 SQL。它與原本只接受空白庫／初始 Owner 的備份選項 **分離**，避免把原有嚴格驗收條件放寬。

## Windows 業主／管理員一鍵操作

1. 由受信任的管理員在已審查且已合併的 `main` 執行，須為乾淨 checkout、Node.js >=22.13、具 Cloudflare Production D1 **Read + Export** 權限的最小權限 API Token。**不要把 Token、密碼、原始 SQL、備份檔上傳到 GitHub／聊天／圖片。**
2. 在低流量時段雙擊 `run-production-d1-backup.bat`，選 **4**「營運期加密匯出」，然後逐字確認 `EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP`。輸入隱藏 Token 和兩次至少 16 字的加密密碼。Cloudflare 官方匯出可能短暫阻塞查詢；不可在尖峰時段反覆重試。
3. 程式先以官方 API 核對固定 Production D1 名稱與 UUID，從官方 `/export` 取得 SQL；把 SQL 於本機記憶體完整重播到 SQLite，核對 **固定 Schema v3、兩筆 Migration、全部資料表與索引、完整性、外鍵、唯一合法 Owner、對應首次建立稽核**。可允許已有門市、食材、交易、登入稽核與 Session。驗證不通過就停止，不保存不可信備份。
4. 只有重播驗證成功後才寫出加密檔：**AES-256-GCM**、PBKDF2 衍生金鑰、獨立隨機 Salt/IV。營運期的新檔案使用 **`RBPOC_D1_AES256_GCM_OPERATIONAL_SQL_V1`**（包含 GCM 認證的格式附加資料）；舊版 `RBPOC_D1_AES256_GCM_SQL_V1` 的嚴格空庫／初始 Owner 驗證保持不變。新舊檔案都使用 `.sql.aes` 且不落地明文 SQL。
5. 執行相同 BAT **2**，離線驗證剛產出的加密封存；將密文檔案複製到另一個受保護設備，再選 **3** 同時解密驗證來源和副本、確認 SHA-256 一致。**工具不會自己替你複製文件，也不保證設備真正在異地。**
6. 保留非機密的 `PROD_D1_ENCRYPTED_LOCAL_EXPORT_PASS`、`...VERIFY_PASS`、`...COPY_VERIFY_PASS`、`operational_backup=true` 及校驗結果供簽核；不要貼絕對備份路徑、Token、Salt、原始表格、密碼或加密檔。

## 安全與範圍限制

- 原本的 **1**（初始空庫／單 Owner）不變。正式營運後請選 **4**；若選 1 遇到 `OWNER_STATE` 是預期的安全拒絕，並不表示 D1 壞掉。
- 仍受原工具 **32 MiB 明文 SQL 上限**和匯出回應的時間／大小限制；資料量超出時停在 `DOWNLOAD_SIZE`／`SQL_SIZE`，**不能為了繼續上線任意關閉上限或降低完整性檢查**。增長後需另案設計經審核的大資料備份。
- 匯出包含正式員工和營運資訊以及可能尚未過期的 Session 雜湊。**務必保護密文備份與密碼，還原時應先撤銷舊 Session**，不能因備份內容完整就直接重新啟用舊 Session。還原涉及正式資料庫寫入，仍由獨立程序與核准處理。
- 本次僅加入程式及離線合成測試；GitHub CI、Cloudflare Workers Build、Code Review 即使 PASS，也**不能視為真正營運 D1 匯出、離線副本檢驗或異機復原已完成**。#31 的異機還原、#46 的 Remote Restore、安全部署 Vars/Secrets、最新 G0 Active Worker 版本與正式登入 UAT 仍是獨立關卡。
- 只允許固定 Production D1 UUID 的匯出，沒有 `wrangler deploy`、`import`、`restore`、`migrate`、新增 Owner、密碼重設、GitHub Secrets 或業務 Write Gate 變更。
