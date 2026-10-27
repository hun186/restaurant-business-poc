@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0" 2>nul
if errorlevel 1 (
 echo [E_PATH] 無法進入程式所在資料夾，已取消。
 pause
 exit /b 1
)
title 餐廳好管家 - 外接備份獨立電腦驗證
echo.
echo ==========================================================
echo   外接磁碟 / 異機備份唯讀驗證
echo ==========================================================
echo.
echo 請在此電腦準備完整版程式，以及從另一台電腦複製過來的備份檔。
echo 本工具不需要原主機的 data 資料庫，也不執行還原覆寫。
echo 備份檔完整路徑與原主機另行留存的 SHA-256 將在下方輸入。
echo 重要：備份包含敏感營運及人事資料，請勿放在公開共享空間。
echo.
where node >nul 2>nul
if errorlevel 1 (
 echo [E_NODE] 找不到 Node.js，請安裝 Node.js 24 LTS。
 goto :failed
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=13))?0:1)"
if errorlevel 1 (
 echo [E_NODE] Node.js 需至少 22.13，建議 24 LTS。
 goto :failed
)
if not exist "tools\offsite-backup-verify.js" (
 echo [E_TOOL] 找不到異機備份驗證工具，請取得完整版本。
 goto :failed
)
node --disable-warning=ExperimentalWarning "tools\offsite-backup-verify.js" --interactive
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
 echo [E_VERIFY] 備份驗證失敗。請保留來源備份，勿覆蓋任何正式資料。
) else (
 echo.
 echo 隔離副本已清理；這僅證明備份可讀，不代表已完成異機啟動及業主登入。
)
popd
pause
exit /b %EXITCODE%
:failed
echo.
echo 驗證已取消，未執行正式資料庫還原。
popd
pause
exit /b 1
