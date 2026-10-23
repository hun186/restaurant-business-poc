'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const p=f=>fs.readFileSync(path.join(__dirname,'..','vercel-demo',f),'utf8');
test('public demo is clearly labeled and loads mock before frontend',()=>{
 const html=p('index.html'),mock=p('mock.js');
 assert.match(html,/公開示範版/);assert.match(html,/虛構資料/);
 assert.ok(html.indexOf('/mock.js')<html.indexOf('/app.js'));
 assert.match(mock,/window\.fetch=async/);
 assert.match(mock,/sessionStorage/);
 assert.doesNotMatch(mock,/APP_ADMIN_PASSWORD|AUTH_SECRET|node:sqlite|process\.env/);
});
test('demo frontend is independently parseable',()=>{
 const vm=require('node:vm');new vm.Script(p('app.js'));new vm.Script(p('mock.js'));
});
