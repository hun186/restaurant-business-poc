@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo ERROR: Node.js 22.13 or later is required.
 pause
 exit /b 1
)
echo.
echo ===== Cloudflare PUBLIC Worker read-only HTTP smoke =====
echo Fixed workers.dev domain, GET/HEAD only; no secrets, login or writes.
echo Version, deployment, Access policy and production release are NOT verified.
echo.
node tools\cloudflare-public-runtime-readonly.mjs
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo BLOCKED: public Worker HTTP contract NOT verified.
pause
exit /b %RESULT%
