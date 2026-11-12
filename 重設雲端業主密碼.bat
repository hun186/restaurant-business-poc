@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" 2>nul
if errorlevel 1 (
 echo ERROR E_RECOVERY_PATH: Unable to open the project directory.
 pause
 exit /b 1
)
set "RESULT=1"
where node >nul 2>&1
if errorlevel 1 (
 echo ERROR E_RECOVERY_NODE: Node.js 22.13 or newer is required.
 goto end
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)" >nul 2>&1
if errorlevel 1 (
 echo ERROR E_RECOVERY_NODE_VERSION: Node.js 22.13 or newer is required.
 goto end
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
set "MENU_RESULT=%ERRORLEVEL%"
if "%MENU_RESULT%"=="1" goto inspect
if "%MENU_RESULT%"=="2" goto reset
echo ERROR E_RECOVERY_CANCELLED: No operation selected.
goto end
:inspect
node tools\cloudflare-prod-owner-password-recovery.mjs --inspect
set "RESULT=%ERRORLEVEL%"
goto end
:reset
echo.
echo IMPORTANT: Use in a scheduled maintenance moment. Secure your backup first.
echo Cloudflare Wrangler login must already be completed on this trusted PC.
echo The reset will revoke ALL active Owner sessions, and cannot be auto-retried.
where npm >nul 2>&1
if errorlevel 1 (
 echo ERROR E_RECOVERY_NPM: npm is required for the pinned inspector-free Wrangler runner.
 goto end
)
where git >nul 2>&1
if errorlevel 1 (
 echo ERROR E_RECOVERY_GIT: Git is required to verify a clean approved main checkout.
 goto end
)
if exist "cloudflare\.dev.vars" (
 echo ERROR E_RECOVERY_STALE_SECRET: An existing local Wrangler .dev.vars file blocks safe reset.
 echo Check for a leftover privileged Worker before removing that file manually.
 goto end
)
node tools\cloudflare-prod-owner-password-recovery.mjs --reset
set "RESULT=%ERRORLEVEL%"
:end
echo.
if not "%RESULT%"=="0" echo INCOMPLETE: do not blindly repeat a reset. Use read-only inspection and contact maintainer.
popd
pause
exit /b %RESULT%
