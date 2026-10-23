@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo [E_NODE] 找不到 Node.js。請先安裝 Node.js 24 LTS。
 pause
 exit /b 1
)
node --version
npm run check
if errorlevel 1 echo [E_TEST] 自動測試沒有全部通過。
pause
