# Workflows

- Node.js >=22.13（建議 Node 24）；不需 `npm install`。
- `npm start`：首次建立本機 SQLite、業主帳號、在終端機顯示一次隨機密碼，綁定 127.0.0.1:3000。
- `npm run check`：語法與 Node.js 內建回歸測試，測試隔離 SQLite，不影響業主資料。
- `node tools/backup.js`：手動一致性 SQLite 快照（含 quick_check、foreign_key_check、版本檢驗）；需現有資料庫。
- `npm start` 自動啟用後端備份排程；業主從「系統管理 → 備份管理」設定間隔與保留數。
- `npm run check` 額外包含 `tests/backup-manager.test.js`；Vercel 靜態展示站不含真實 SQLite 及備份 API。
- `.github/workflows/verify.yml`：Ubuntu/Windows × Node22/24；GitHub repo push 後才可得知 Hosted 實際結果。
- 重要注意：不要把 `data/`、`backups/`、`.env` 提交，也不要以公開 Vercel 作正式 SQLite 後端。
