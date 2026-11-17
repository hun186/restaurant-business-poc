@echo off
setlocal
REM Readonly anonymous admission check. No credentials or production writes.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  exit /b 1
)
node "%~dp0tools\native-owner-grant-uat-readonly.mjs"
set "RESULT=%ERRORLEVEL%"
exit /b %RESULT%
