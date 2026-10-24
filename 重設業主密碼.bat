@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 餐廳好管家 - 業主密碼復原
echo.
echo ==========================================================
echo   餐廳好管家 - 忘記業主密碼 安全復原
echo ==========================================================
echo.
echo 請先關閉「啟動餐廳好管家」視窗或 npm start 服務。
echo 若已有有效登入，可直接在網頁「變更密碼」，不必使用本工具。
echo.
echo 此工具將先驗證並備份現有資料庫，之後才重設 owner 密碼。
echo 請勿刪除 data、backups、.installed 或任何 SQLite 檔案。
echo.
where node >nul 2>nul
if errorlevel 1 (
 echo [E_NODE] 找不到 Node.js。
 echo 請先從官方網站 https://nodejs.org/ 安裝 Node.js 24 LTS。
 goto :failed
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=13))?0:1)"
if errorlevel 1 (
 echo [E_NODE] Node.js 版本太舊，請先更新到 22.13 以上，建議 24 LTS。
 goto :failed
)
if not exist "tools\reset-owner-password.js" (
 echo [E_TOOL] 找不到密碼復原工具。
 echo 請重新下載完整版餐廳好管家程式，保留原本的 data 和 backups。
 goto :failed
)
if not defined DATA_DIR (
 if not exist "data\restaurant.sqlite" (
  echo [E_DB] 找不到現有 data\restaurant.sqlite。
  echo 請先確認使用的是原本存放資料庫的資料夾，不要建立新資料庫。
  goto :failed
 )
 if not exist "data\.installed" (
  echo [E_DB] 找不到 data\.installed 註記。
  echo 不可刪除資料庫重建密碼，請交由管理者確認。
  goto :failed
 )
)
echo 現在將啟動復原程序，依指示輸入數字 1 並按 Enter。
echo 輸入其他內容會取消，不會重設密碼。
echo.
node --disable-warning=ExperimentalWarning "tools\reset-owner-password.js" --guided
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
 echo.
 echo [E_RECOVERY] 未完成密碼復原。請閱讀上方錯誤訊息。
 echo 切勿刪除 data、backups 或 .installed。
) else (
 echo.
 echo 操作已結束。如果看到新密碼，請先抄下後再關閉此視窗。
 echo 然後重新雙擊「啟動餐廳好管家.bat」登入。
)
echo.
pause
exit /b %EXITCODE%
:failed
echo.
echo 未重設密碼，現有營運資料不應受此工具影響。
pause
exit /b 1
