@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
echo.
echo ===== Cloudflare PUBLIC Worker read-only HTTP smoke =====
echo Fixed workers.dev domain, GET/HEAD only; no secrets, login or writes.
echo Version, deployment, Access policy and production release are NOT verified.
echo.
rem Prefer modern Node, but the Windows-only public HTTP probe works even without it.
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>&1
if not errorlevel 1 goto using_node
where powershell.exe >nul 2>&1
if errorlevel 1 goto missing_runtime
echo Node.js 22.13+ not found; using built-in Windows PowerShell (GET/HEAD only).
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\cloudflare-public-runtime-readonly.ps1"
set "RESULT=%ERRORLEVEL%"
goto done
:using_node
node tools\cloudflare-public-runtime-readonly.mjs
set "RESULT=%ERRORLEVEL%"
goto done
:missing_runtime
echo ERROR: Neither Node.js 22.13+ nor Windows PowerShell is available.
set "RESULT=1"
:done
if not "%RESULT%"=="0" echo BLOCKED: public Worker HTTP contract NOT verified.
pause
exit /b %RESULT%
