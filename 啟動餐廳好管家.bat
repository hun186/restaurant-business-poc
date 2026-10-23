@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo [E_NODE] 找不到 Node.js，請安裝 Node.js 24 LTS 再執行。
 pause
 exit /b 1
)
node server.js
if errorlevel 1 echo [E_START] 啟動失敗，請檢查畫面顯示的錯誤及 README。
pause
