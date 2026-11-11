@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
echo.
echo ===== Native Owner LOGIN UAT PREFLIGHT - public GET only =====
echo Fixed HTTPS origin; no password, Cookie, Token, POST, D1 SQL or Cloudflare changes.
echo Does NOT certify real login/logout, Session revocation or release authorization.
echo.
where powershell.exe >nul 2>&1
if errorlevel 1 (
 echo BLOCKED: Windows PowerShell 5.1+ is required.
 pause
 exit /b 1
)
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\native-owner-login-uat-gate-readonly.ps1" -Phase preflight
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo BLOCKED: phase preflight public gate and anonymous access NOT verified.
pause
exit /b %RESULT%
