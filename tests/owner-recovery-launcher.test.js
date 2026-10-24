'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {cliMode,confirmed}=require('../tools/reset-owner-password');
const bat=fs.readFileSync(path.join(__dirname,'..','重設業主密碼.bat'),'utf8');
const cli=fs.readFileSync(path.join(__dirname,'..','tools/reset-owner-password.js'),'utf8');

test('guided Windows confirmation accepts only numeric 1; old CLI is unchanged',()=>{
 assert.equal(cliMode([]),'advanced');
 assert.equal(cliMode(['--guided']),'guided');
 for(const args of [['--skip-confirmation'],['--guided','--yes'],['1']])
  assert.throws(()=>cliMode(args),{code:'E_RECOVERY'});
 assert.equal(confirmed('guided','1'),true);
 assert.equal(confirmed('guided',' 1 '),true);
 for(const input of ['', '0','Y','yes','yes 1','RESET owner','11','1 1'])
  assert.equal(confirmed('guided',input),false);
 assert.equal(confirmed('advanced','RESET owner'),true);
 assert.equal(confirmed('advanced','1'),false);
});
test('batch launcher always stays inside its own project directory and keeps failure visible',()=>{
 assert.match(bat,/chcp 65001\s*>nul/);
 assert.match(bat,/cd \/d "%~dp0"/i);
 assert.match(bat,/where node\s*>nul/);
 assert.match(bat,/process\.versions\.node\.split/);
 assert.match(bat,/if not defined DATA_DIR/);
 assert.match(bat,/if not exist "data\\restaurant\.sqlite"/i);
 assert.match(bat,/if not exist "data\\\.installed"/i);
 assert.match(bat,/node --disable-warning=ExperimentalWarning "tools\\reset-owner-password\.js" --guided/);
 assert.doesNotMatch(bat,/--no-warnings(?:\s|$)|NODE_NO_WARNINGS/);
 assert.match(bat,/set "EXITCODE=%ERRORLEVEL%"/);
 assert.match(bat,/pause/);
 assert.doesNotMatch(bat,/\b(del|rmdir|erase|format)\b/i,'launcher must not remove data');
 assert.doesNotMatch(bat,/echo\s+(?:.*)?(?:password_salt|password_hash)/i);
});
test('the guided mode still requires a terminal, explicit consent, and the same verified backup recovery',()=>{
 assert.match(cli,/!process\.stdin\.isTTY\|\|!process\.stdout\.isTTY/);
 assert.match(cli,/rl\.question\(mode==='guided'/);
 assert.match(cli,/if\(!confirmed\(mode,answer\)\)/);
 assert.match(cli,/const result=recoverOwner\(\)/);
 assert.match(cli,/const backup=perform\(\{\.\.\.dirs,type:'manual'\}\)/);
 assert.match(cli,/if\(backup\.result!=='created'/);
 assert.match(cli,/if\(latest\.password_salt!==owner\.password_salt/);
 assert.match(cli,/db\.prepare\('DELETE FROM sessions WHERE user_id=\?'\)/);
 assert.match(cli,/不會刪除原有資料/);
 assert.doesNotMatch(cli,/process\.argv\[3\]|--force|--unsafe|--skip-backup/);
});
