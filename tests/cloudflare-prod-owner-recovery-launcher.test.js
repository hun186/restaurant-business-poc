'use strict';
// Static and offline regression of the local Windows operator entry point.
// Never starts Wrangler, reads credentials, or calls Production Cloudflare D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const bat=fs.readFileSync(path.join(__dirname,'..','重設雲端業主密碼.bat'),'utf8')
 .replace(/\r\n/g,'\n'); // Git may check out Windows BAT files with CRLF.
const at=needle=>{
 const pos=bat.indexOf(needle);
 assert.notEqual(pos,-1,'expected launcher marker: '+needle);
 return pos;
};

test('cloud Owner recovery launcher enters and leaves its own project directory',()=>{
 assert.match(bat,/setlocal EnableExtensions DisableDelayedExpansion/);
 assert.match(bat,/pushd "%~dp0" 2>nul/);
 assert.ok(at('pushd "%~dp0"')<at('where node'),'path check must precede commands');
 assert.match(bat,/if errorlevel 1 \(\s*echo ERROR E_RECOVERY_PATH/);
 assert.match(bat,/\r?\npopd\r?\npause\r?\nexit \/b %RESULT%/);
 assert.doesNotMatch(bat,/\b(?:rd|rmdir|del|erase|format)\s/i);
});

test('cloud Owner recovery launcher rejects unsupported Node and missing runtime',()=>{
 assert.ok(at('where node')<at('node -e "const v=process.versions.node.split'));
 assert.ok(at('node -e "const v=process.versions.node.split')<at('choice /C 12'));
 assert.match(bat,/v\[0\]>22\|\|\(v\[0\]===22&&v\[1\]>=13\)/);
 assert.match(bat,/E_RECOVERY_NODE_VERSION/);
 assert.match(bat,/E_RECOVERY_NODE:/);
});

test('cloud Owner recovery menu never turns an error or Ctrl+C into a write',()=>{
 assert.match(bat,/choice \/C 12 \/N \/M "Select 1 or 2: "/);
 assert.match(bat,/set "MENU_RESULT=%ERRORLEVEL%"/);
 assert.match(bat,/if "%MENU_RESULT%"=="1" goto inspect/);
 assert.match(bat,/if "%MENU_RESULT%"=="2" goto reset/);
 assert.match(bat,/E_RECOVERY_CANCELLED/);
 assert.doesNotMatch(bat,/if errorlevel 2 goto reset/i);
 assert.ok(at('if "%MENU_RESULT%"=="2" goto reset')<at(':reset'));
 assert.ok(at(':inspect')<at('--inspect'));
 assert.ok(at(':reset')<at('--reset'));
});

test('Production write branch fail-closes before loading privileged Wrangler',()=>{
 const start=at('\n:reset\n'),end=at('\n:end\n');
 const reset=bat.slice(start,end);
 for(const x of ['where npm','where git','if exist "cloudflare\\.dev.vars"',
  'E_RECOVERY_NPM','E_RECOVERY_GIT','E_RECOVERY_STALE_SECRET'])
  assert.ok(reset.includes(x),'missing required reset preflight: '+x);
 assert.ok(reset.indexOf('where npm')<reset.indexOf('node tools\\cloudflare-prod-owner-password-recovery.mjs --reset'));
 assert.ok(reset.indexOf('if exist "cloudflare\\.dev.vars"')<reset.indexOf('node tools\\cloudflare-prod-owner-password-recovery.mjs --reset'));
 assert.doesNotMatch(reset,/\b(?:wrangler\s+deploy|d1\s+execute|--skip-approval)\b/i);
 assert.doesNotMatch(bat,/echo[^\r\n]*\b(?:password_salt|password_hash|CLOUDFLARE_API_TOKEN)\b/i);
});
