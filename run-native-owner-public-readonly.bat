@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
echo.
echo ===== Native Owner PUBLIC asset and release-gate check =====
echo Only fixed HTTPS GET. No password, Cookie, Token, POST or D1 SQL.
echo Compares current checkout assets against public Cloudflare response.
echo Active Worker Version and real login/logout UAT are NOT verified.
echo.
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo BLOCKED: Windows PowerShell 5.1 or newer is required.
  pause
  exit /b 1
)
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\native-owner-public-assets-readonly.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo BLOCKED: public Owner assets or closed-gate contract NOT verified.
pause
exit /b %RESULT%
