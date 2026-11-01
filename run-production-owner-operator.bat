@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 22 or newer is required.
  pause
  exit /b 1
)
echo.
echo Production D1 Owner local operator - no token or password written to disk.
echo [1] Check status only, no database writes
echo [2] Enroll first Owner ONCE, authorized Production D1 write
echo.
choice /C 12 /N /M "Select 1 or 2: "
if errorlevel 2 goto enroll
if errorlevel 1 goto check
exit /b 1
:check
node tools\cloudflare-prod-owner-operator.mjs --check
set "RESULT=%ERRORLEVEL%"
goto finish
:enroll
node tools\cloudflare-prod-owner-operator.mjs --enroll
set "RESULT=%ERRORLEVEL%"
:finish
echo.
if not "%RESULT%"=="0" echo ABORTED: do NOT blindly repeat Owner enrollment. Run read-only check first.
pause
exit /b %RESULT%
