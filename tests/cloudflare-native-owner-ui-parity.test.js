'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),asset=name=>fs.readFileSync(path.join(root,'vercel-demo',name),'utf8');

test('native Owner shell mirrors dashboard navigation without using demo entry points',()=>{
  const html=asset('owner-app.html'),css=asset('owner-app.css'),js=asset('owner-app.js');
  for(const id of ['locked','login','login-form','workspace','sidebar','nav','menu-btn','nav-backdrop','identity','avatar','crumb','notice','title','section-hint','capability','content','logout','refresh']){
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
  assert.ok(js.includes("window.matchMedia('(max-width: 760px)')"));
  assert.ok(js.includes("$('sidebar').inert=mobileNav.matches"));
  assert.ok(js.includes("$('sidebar').inert=false"));
  assert.ok(js.includes("closeMenu(true)"));
  assert.ok(js.includes("mobileNav.addEventListener('change'"));
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
  assert.match(html,/<section id="locked"[^>]*hidden/);
  assert.match(js,/\$\('locked'\)\.hidden=false/);
  assert.match(html,/前往公開功能展示（全部為虛構資料）/);
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

test('native Owner write forms keep visible labels attached to their controls',()=>{
 const js=asset('owner-app.js'),css=asset('owner-app.css');
 assert.match(js,/const labeledField=\(caption,control\)=>/);
 assert.match(js,/label\.append\(control\);return label/);
 for(const expected of [
  "form.append(labeledField(label,input))",
  "labeledField('門市',store)","labeledField('門市',select)",
  "labeledField('食材',ingredient)","labeledField('供應商',supplier)",
  "labeledField('數量',qty)","labeledField('實際數量',counted)",
  "labeledField('設備',equipment)","labeledField('故障內容',description)",
  "labeledField('指派給',assignee)","labeledField('工作內容',input)",
  "labeledField('期限（選填）',due)"
 ])assert(js.includes(expected),expected);
 assert.doesNotMatch(js,/form\.append\(el\('label'/);
 assert.match(css,/\.panel form label>input,\.panel form label>select,\.panel form label>textarea/);
 // No browser-side synthetic authentication or mock data is introduced.
 assert.doesNotMatch(js,/mock\.js|localStorage|sessionStorage|\.innerHTML\s*=/);
});
