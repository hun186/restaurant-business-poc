'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const ps=fs.readFileSync(path.join(root,'tools/native-owner-public-assets-readonly.ps1'),'utf8');
const bat=fs.readFileSync(path.join(root,'run-native-owner-public-readonly.bat'),'utf8');

test('PowerShell 5.1 script checks only four public Owner assets and native status',()=>{
 assert.equal(ps.charCodeAt(0),0xfeff);
 assert.match(ps,/https:\/\/restaurant-business-poc\.hungyuan-chen\.workers\.dev/);
 for(const url of ['/api/native/status','/owner-app','/owner-app.css','/owner-app.js','/native-owner-display.mjs'])
  assert(ps.includes(url),url);
 assert(ps.includes("route='/owner-app';file='vercel-demo/owner-app.html'"));
 assert(!ps.includes("route='/owner-app.html'"));
 assert.match(ps,/HttpMethod\]::Get/);
 assert.match(ps,/AllowAutoRedirect=\$false/);
 assert.match(ps,/UseCookies=\$false/);
 assert.match(ps,/UseDefaultCredentials=\$false/);
 assert.match(ps,/Get-Only/);
 assert.match(ps,/Read-Bounded/);
 assert.match(ps,/Fingerprint/);
 assert.match(ps,/Content_MISMATCH|CONTENT_MISMATCH/);
 assert.match(ps,/NATIVE_OWNER_PUBLIC_ASSETS_READONLY_PASS/);
 assert.match(ps,/active_worker_version_verified=\$false/);
 assert.match(ps,/owner_login_logout_uat_verified=\$false/);
 assert.doesNotMatch(ps,/HttpMethod\]::Post|HttpMethod\]::Put|PostAsync\(|SendAsync\(.*DELETE|wrangler deploy/);
 assert.doesNotMatch(ps,/CLOUDFLARE_API_TOKEN|Invoke-Expression|Start-Process|Read-Host|Get-Credential/);
 assert.match(bat,/powershell\.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass/);
 assert.match(bat,/native-owner-public-assets-readonly\.ps1/);
 assert.doesNotMatch(bat,/node\s|curl\s|CLOUDFLARE_API_TOKEN|wrangler/);
});
test('public Owner asset smoke checks fail-closed login and all five business write gates',()=>{
 assert.match(ps,/LOGIN_NOT_CLOSED/);
 assert.match(ps,/BUSINESS_GATE_NOT_CLOSED/);
 for(const gate of ['task_write_enabled','catalog_write_enabled','order_write_enabled',
  'stocktake_write_enabled','repair_write_enabled'])assert(ps.includes(gate));
 assert.match(ps,/mode -cne 'demo'/);
 assert.match(ps,/MaxAssetBytes=98304/);
 assert.match(ps,/MaxStatusBytes=4096/);
 assert.match(ps,/assets_match_current_checkout=\$true/);
 assert.match(ps,/request_methods='GET_ONLY'/);
});
test('Windows PowerShell standalone offline synthetic self-test',()=>{
 if(process.platform!=='win32')return;
 const {spawnSync}=require('node:child_process');
 const proc=spawnSync('powershell.exe',[
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
  '-File',path.join(root,'tools/native-owner-public-assets-readonly.ps1'),'-SelfTest'
 ],{encoding:'utf8',timeout:45000});
 assert.equal(proc.status,0,'PowerShell self-test exited nonzero: '+(proc.stderr||'').slice(-1400));
 assert.match(proc.stdout,/NATIVE_OWNER_PUBLIC_ASSET_SELFTEST_PASS/);
});
