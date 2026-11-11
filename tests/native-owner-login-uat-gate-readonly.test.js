'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'tools/native-owner-login-uat-gate-readonly.ps1'),'utf8');
const pre=fs.readFileSync(path.join(root,'run-native-owner-login-uat-preflight.bat'),'utf8');
const end=fs.readFileSync(path.join(root,'run-native-owner-login-uat-closeout.bat'),'utf8');
const worker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
const login=fs.readFileSync(path.join(root,'cloudflare/native-login-http.mjs'),'utf8');
const identity=fs.readFileSync(path.join(root,'cloudflare/identity.mjs'),'utf8');
const lines=script.split('\n');

test('UAT gate check uses fixed anonymous GET only and cannot enable remote services',()=>{
 assert.equal(script.charCodeAt(0),0xfeff);
 assert.match(script,/https:\/\/restaurant-business-poc\.hungyuan-chen\.workers\.dev/);
 assert.match(script,/HttpMethod\]::Get/);
 assert.match(script,/AllowAutoRedirect=\$false/);
 assert.match(script,/UseCookies=\$false/);
 assert.match(script,/UseDefaultCredentials=\$false/);
 assert.match(script,/PreAuthenticate=\$false/);
 assert.match(script,/Get-Fixed \$client '\/api\/native\/status' 200/);
 assert.match(script,/Get-Fixed \$client '\/api\/login' 405/);
 assert.match(script,/Get-Fixed \$client '\/api\/me' 401/);
 assert.match(script,/Get-Fixed \$client '\/api\/login' 503/);
 assert.match(script,/Get-Fixed \$client '\/api\/me' 503/);
 assert.match(script,/Read-Limited/);
 assert.match(script,/CacheControl\.ToString/);
 assert.match(script,/Set-Cookie/);
 for(const bad of [
  /HttpMethod\]::Post/i,/Invoke-RestMethod/i,/Invoke-WebRequest/i,
  /Get-Credential/i,/Read-Host/i,/Start-Process/i,/Invoke-Expression/i,
  /wrangler/i,/CLOUDFLARE_API_TOKEN/i,/NATIVE_AUTH_SOURCE_PEPPER/i,
  /CLOUD_NATIVE_LOGIN_GATE\s*=/i,/CLOUD_AUTH_PHASE\s*=/i
 ])assert.doesNotMatch(script,bad);
 for(const status of ['NATIVE_OWNER_LOGIN_UAT_PREFLIGHT_PASS',
  'NATIVE_OWNER_LOGIN_UAT_CLOSEOUT_PASS','NATIVE_OWNER_LOGIN_UAT_GATE_FAIL'])
  assert(script.includes(status));
 assert.match(script,/session_revoked_verified=\$false/);
 assert.match(script,/owner_login_logout_uat_verified=\$false/);
 assert.match(script,/release_authorized=\$false/);
});

test('both Windows BAT launchers keep fixed phase, do not prompt for secrets or mutate Cloudflare',()=>{
 for(const [bat,phase] of [[pre,'preflight'],[end,'closeout']]){
  assert.match(bat,/powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File/);
  assert(bat.includes('native-owner-login-uat-gate-readonly.ps1" -Phase '+phase));
  assert.match(bat,/if not "%RESULT%"=="0"/);
  assert.match(bat,/exit \/b %RESULT%/);
  assert.doesNotMatch(bat,/node |curl |wrangler |CLOUDFLARE_|password|token\s*=/i);
 }
});

test('strict fail-closed UAT phase contract requires zero writes and anonymous auth boundary',()=>{
 for(const x of ['mode','login_enabled','task_write_enabled','catalog_write_enabled',
 'order_write_enabled','stocktake_write_enabled','repair_write_enabled']){
  assert(script.includes("'"+x+"'"),'missing validated gate '+x);
 }
 assert.match(script,/if\(\$mode -cne 'native' -or !\$login\)/);
 assert.match(script,/if\(\$mode -cne 'demo' -or \$login\)/);
 assert.match(script,/if\(\$val -isnot \[bool\] -or \$val\)/);
 assert.match(script,/ANON_IDENTITY_EXPOSED/);
 assert.match(script,/ANON_LOGIN_METHOD_NOT_BLOCKED/);
 assert.match(script,/LOGIN_ROUTE_NOT_CLOSED/);
 assert.match(script,/Write-Output 'NATIVE_OWNER_LOGIN_UAT_GATE_SELFTEST_PASS'/);
 // Cross-check against reviewed Worker routing and auth contracts, not
 // synthetic UI claims. No server login attempt is sent by this probe.
 assert.match(worker,/pathname === '\/api\/native\/status'/);
 assert.match(worker,/pathname === '\/api\/login' \|\| pathname === '\/api\/logout'/);
 assert.match(login,/if\(!nativeLoginEnabled\(env\)\)return reply\(503,\{code:'E_NOT_READY'\}\)/);
 assert.match(login,/const valid=requestSafe\(request,route\)/);
 assert.match(login,/valid===405\?'METHOD_NOT_ALLOWED'/);
 assert.match(identity,/return response\(401, \{ error: '請先登入' \}\)/);
});

test('Windows PowerShell 5.1 offline synthetic self-test, with no network calls',()=>{
 if(process.platform!=='win32')return;
 const run=spawnSync('powershell.exe',[
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
  '-File',path.join(root,'tools/native-owner-login-uat-gate-readonly.ps1'),'-SelfTest'
 ],{cwd:root,encoding:'utf8',timeout:45000});
 assert.equal(run.status,0,'PowerShell self-test failed: '+(run.stderr||'').slice(-300));
 assert.match(run.stdout,/NATIVE_OWNER_LOGIN_UAT_GATE_SELFTEST_PASS/);
});
