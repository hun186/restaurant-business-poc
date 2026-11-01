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
echo [3] Check Owner + Time Travel bookmark (READ ONLY)
echo.
choice /C 123 /N /M "Select 1, 2 or 3: "
if errorlevel 3 goto preflight
if errorlevel 2 goto enroll
if errorlevel 1 goto check
exit /b 1
:check
node tools\cloudflare-prod-owner-operator.mjs --check
set "RESULT=%ERRORLEVEL%"
goto finish
:preflight
node tools\cloudflare-prod-owner-operator.mjs --preflight
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
