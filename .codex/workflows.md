# Workflows

- Node.js >=22.13（建議 Node 24）；不需 `npm install`。
- `npm start`：首次建立本機 SQLite、業主帳號、在終端機顯示一次隨機密碼，綁定 127.0.0.1:3000。
- `npm run check`：語法與 Node.js 內建回歸測試，測試隔離 SQLite，不影響業主資料。
- `node tools/backup.js`：只對已存在的資料庫進行一致性快照，驗證 quick_check 與 foreign_key_check。
- `.github/workflows/verify.yml`：Ubuntu/Windows × Node22/24；GitHub repo push 後才可得知 Hosted 實際結果。
- 重要注意：不要把 `data/`、`backups/`、`.env` 提交，也不要以公開 Vercel 作正式 SQLite 後端。
