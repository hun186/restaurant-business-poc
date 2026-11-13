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
echo ===== Cloudflare Production D1 ENCRYPTED LOCAL BACKUP =====
echo This is an export only; NO Owner creation, migration or restore.
echo Cloudflare export may temporarily block Production D1 queries.
echo Encrypted archives stay under your Windows user profile.
echo [1] Export Production D1 to encrypted local backup ^(requires operator confirmation^)
echo [2] Verify an existing encrypted local backup ^(offline^)
echo [3] Verify a separately copied encrypted archive ^(offline, no Cloudflare access^)
echo [4] Export normal operational D1 with shops/stock/auth history to encrypted archive
echo.
choice /C 1234 /N /M "Select 1, 2, 3 or 4: "
set "MENU_CHOICE=%ERRORLEVEL%"
if "%MENU_CHOICE%"=="4" goto export-operational
if "%MENU_CHOICE%"=="3" goto verify-copy
if "%MENU_CHOICE%"=="2" goto verify
if "%MENU_CHOICE%"=="1" goto export
echo ABORTED: invalid choice; no export requested.
set "RESULT=1"
goto finish
:export
node tools\cloudflare-prod-d1-encrypted-backup.mjs --export
set "RESULT=%ERRORLEVEL%"
goto finish
:export-operational
echo IMPORTANT: this is a live operational data backup, not a restore.
echo Encrypted archives must be separately copied and verified before regular production use.
node tools\cloudflare-prod-d1-encrypted-backup.mjs --export-operational
set "RESULT=%ERRORLEVEL%"
goto finish
:verify
set "BACKUP_FILE="
set /p "BACKUP_FILE=Enter full path of .sql.aes backup: "
if not defined BACKUP_FILE (
  echo ABORTED: no path supplied.
  pause
  exit /b 1
)
node tools\cloudflare-prod-d1-encrypted-backup.mjs --verify "%BACKUP_FILE%"
set "RESULT=%ERRORLEVEL%"
goto finish
:verify-copy
echo.
echo Copy the existing .sql.aes to a separate protected drive or device first.
echo This checks ciphertext equality and SQLite replay. It does NOT certify an offsite location.
node tools\cloudflare-prod-d1-encrypted-backup.mjs --verify-copy
set "RESULT=%ERRORLEVEL%"
goto finish
:finish
echo.
if not "%RESULT%"=="0" echo ABORTED: backup NOT accepted; no production SQL writes were attempted.
pause
exit /b %RESULT%
