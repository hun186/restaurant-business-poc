@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0" 2>nul
if errorlevel 1 (
 echo [E_PATH] 無法進入餐廳好管家程式目錄，已取消。
 pause
 exit /b 1
)
title 餐廳好管家 - 備份隔離還原演練（不覆寫正式資料）
echo.
echo =====================================================
echo     備份隔離驗證（不覆寫 data 或 backups）
echo =====================================================
echo.
echo 本工具只讀取最新既有備份，建立短暫的受保護隔離副本、
echo 檢查 SQLite 完整性及內容，完成後會清除隔離副本。
echo 不會停用或還原正式系統，也不會代替業主 Windows 實機驗收。
echo.
where node >nul 2>nul
if errorlevel 1 (
 echo [E_NODE] 找不到 Node.js，請安裝 Node.js 24 LTS。
 goto :failed
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=13))?0:1)"
if errorlevel 1 (
 echo [E_NODE] Node.js 版本需至少 22.13，建議使用 24 LTS。
 goto :failed
)
if not exist "tools\restore-drill.js" (
 echo [E_TOOL] 找不到安全隔離演練工具，請取得完整版專案。
 goto :failed
)
node --disable-warning=ExperimentalWarning "tools\restore-drill.js"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
 echo [E_DRILL] 驗證沒有通過。請保留正式資料，勿刪除 data/backups。
) else (
 echo.
 echo 驗證已完成；請另行安排跨磁碟備份和業主 Windows 實機還原簽收。
)
popd
pause
exit /b %EXITCODE%
:failed
echo.
echo 已取消，不會自動更動正式資料庫。
popd
pause
exit /b 1
