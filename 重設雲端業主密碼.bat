@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo ERROR: Node.js 22.13 or newer is required.
 pause
 exit /b 1
)
echo.
echo ===== Production D1 Owner password recovery =====
echo Only for a forgotten Owner password. Existing users, shops and inventory are preserved.
echo No Cloudflare token or password is stored in this launcher.
echo Safe reset uses localhost Wrangler remote D1 Binding, not REST batch.
echo [1] Check existing Owner and database integrity - READ ONLY
echo [2] Reset existing Owner password - ONE explicitly approved Production D1 write
echo.
choice /C 12 /N /M "Select 1 or 2: "
if errorlevel 2 goto reset
if errorlevel 1 goto inspect
exit /b 1
:inspect
node tools\cloudflare-prod-owner-password-recovery.mjs --inspect
set "RESULT=%ERRORLEVEL%"
goto end
:reset
echo.
echo IMPORTANT: Use in a scheduled maintenance moment. Secure your backup first.
echo Cloudflare Wrangler login must already be completed on this trusted PC.
echo The reset will revoke ALL active Owner sessions, and cannot be auto-retried.
node tools\cloudflare-prod-owner-password-recovery.mjs --reset
set "RESULT=%ERRORLEVEL%"
:end
echo.
if not "%RESULT%"=="0" echo INCOMPLETE: do not blindly repeat a reset. Use read-only inspection and contact maintainer.
pause
exit /b %RESULT%
