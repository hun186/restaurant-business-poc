'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),asset=name=>fs.readFileSync(path.join(root,'vercel-demo',name),'utf8');

test('native Owner shell mirrors dashboard navigation without using demo entry points',()=>{
  const html=asset('owner-app.html'),css=asset('owner-app.css'),js=asset('owner-app.js');
  for(const id of ['login','login-form','workspace','sidebar','nav','menu-btn','nav-backdrop','identity','avatar','crumb','notice','title','section-hint','capability','content','logout','refresh']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const entity of ['overview','tasks','repairs','ingredients','stock','purchase_orders','stocktakes','shifts','training_courses','locations']){
    assert.match(html,new RegExp('data-view="'+entity+'"'));
  }
  assert.match(html,/class="sidebar"/);
  assert.match(html,/class="topbar"/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.sidebar\.open/);
  assert.match(css,/\.nav-backdrop:not\(\[hidden\]\)/);
  assert.match(js,/\$\('menu-btn'\)\.addEventListener/);
  assert.match(js,/setAttribute\('aria-current'/);
  assert.match(js,/\$\('nav-backdrop'\)\.addEventListener/);
  for(const source of [html,js]){
    assert.doesNotMatch(source,/mock\.js|(?:localStorage|sessionStorage)|demo-reset|restaurantDemoReset|\/api\/access\/|\/api\/command/);
  }
  assert.match(html,/default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'/);
  assert.doesNotMatch(html,/on(?:click|submit|load)\s*=|<script[^>]*src="\/app\.js"/i);
  assert.match(js,/document\.createElement/);
  assert.doesNotMatch(js,/\.innerHTML\s*=/);
});

test('native status must be checked before exposing credentials or enabling write controls',()=>{
  const js=asset('owner-app.js'),html=asset('owner-app.html');
  assert.match(html,/<section id="login"[^>]*hidden/);
  assert.match(html,/<div id="workspace"[^>]*hidden/);
  assert.match(js,/await api\('\/api\/native\/status'\)/);
  assert.match(js,/status\.mode!=='native'\|\|status\.login_enabled!==true/);
  assert.match(js,/writeEnabled=status\.task_write_enabled===true/);
  assert.match(js,/catalogWriteEnabled=status\.catalog_write_enabled===true/);
  assert.match(js,/orderWriteEnabled=status\.order_write_enabled===true/);
  assert.match(js,/stocktakeWriteEnabled=status\.stocktake_write_enabled===true/);
  assert.match(js,/repairWriteEnabled=status\.repair_write_enabled===true/);
  assert.match(js,/await api\('\/api\/me'\)/);
  assert.match(js,/await api\('\/api\/logout'/);
  assert.match(js,/headers:\{Accept:'application\/json','X-CSRF-Token':token\}/);
});
