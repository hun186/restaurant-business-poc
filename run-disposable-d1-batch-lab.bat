@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo ERROR: Node.js 22.13 or newer is required.
  pause
  exit /b 1
)
echo.
echo ===== Disposable D1 REST Batch Transaction Lab =====
echo No production, staging or existing recovery D1 databases are accepted.
echo Create a NEW EMPTY Cloudflare D1 named restaurant-business-owner-batch-lab-YYYYMMDD
echo Do not paste your Cloudflare token into this window until Node prompts for it.
echo.
set /p "SCRATCH_D1_UUID=Paste the NEW disposable D1 database UUID: "
echo.
echo [1] Verify disposable database identity and emptiness; NO WRITES
echo [2] Run live REST batch rollback experiment on disposable database ONLY
choice /C 12 /N /M "Select 1 or 2: "
if errorlevel 2 goto test
if errorlevel 1 goto probe
exit /b 1
:probe
node tools\cloudflare-d1-rest-batch-lab.mjs --probe "%SCRATCH_D1_UUID%"
set "EXIT=%ERRORLEVEL%"
goto finish
:test
node tools\cloudflare-d1-rest-batch-lab.mjs --test "%SCRATCH_D1_UUID%"
set "EXIT=%ERRORLEVEL%"
:finish
echo.
if not "%EXIT%"=="0" echo ABORTED. Do NOT retry writes on the same scratch DB. Do not use Production Owner option 2.
pause
exit /b %EXIT%
