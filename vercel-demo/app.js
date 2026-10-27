'use strict';
const $=s=>document.querySelector(s);
const S={me:null,csrf:'',page:'dashboard',cache:{},filter:'',authEpoch:0,showArchivedDishes:false};
let logoutInFlight=null;
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nice={todo:'待辦',doing:'處理中',done:'已完成',requested:'待核准',approved:'已核准',received:'已入庫',cancelled:'已取消',pending:'待確認',confirmed:'已確認',reported:'待派工',assigned:'已派工',closed:'已結案',rejected:'已駁回',owner:'業主',manager:'主管',staff:'一般員工',purchase:'進貨',usage:'領用',adjustment:'盤點調整'};
const label=v=>nice[v]||String(v??'—');
const fmt=v=>(v===null||v===undefined||v==='')?'—':E(v);
const pages={

 ingredient_prices:{title:'食材歷史價格',desc:'分門市留存價格日期、供應商；變更後立即重新試算',action:'price.record',permission:'manager',columns:[['price_date','生效日'],['location_name','門市'],['ingredient_name','食材'],['unit_price_twd','單價（元）'],['unit','計價單位'],['supplier','供應商'],['source','來源']]},
 inventory_values:{title:'庫存估算價值',desc:'最新有效單價 × 實際庫存；不是會計成本',permission:'manager',columns:[['location_name','門市'],['ingredient_name','食材'],['on_hand','庫存量'],['unit','庫存單位'],['unit_price_twd','最近單價（元）'],['price_unit','價格單位'],['estimated_value_twd','估值（元）'],['cost_status','狀態']]},
 menu_dishes:{title:'菜品與售價',desc:'新增菜品並調整售價；展示資料不會保存至伺服器',action:'dish.create',permission:'owner',columns:[['name','菜品'],['sale_price_twd','售價（元）'],['ingredient_count','配方食材數'],['active','啟用']]},
 dish_ingredients:{title:'每份菜品配方',desc:'設定食材用量，重複設定同一食材即更新',action:'recipe.set',permission:'owner',columns:[['dish_name','菜品'],['ingredient_name','食材'],['qty','每份用量'],['unit','單位']]},
 dish_costs:{title:'菜品成本／毛利估算',desc:'依門市有效價格估算；缺價不能算成零成本',permission:'manager',columns:[['dish_name','菜品'],['location_name','門市'],['sale_price_twd','售價（元）'],['estimated_cost_twd','食材成本'],['gross_profit_twd','材料毛利'],['gross_margin_pct','毛利率 %'],['cost_status','核算狀態']]},
 dish_cost_lines:{title:'成本逐項明細',desc:'追蹤各項食材用量與缺價情況',permission:'manager',columns:[['dish_name','菜品'],['location_name','門市'],['ingredient_name','食材'],['qty','用量'],['unit','單位'],['unit_price_twd','單價（元）'],['price_unit','計價單位'],['line_cost_twd','單項成本'],['cost_status','狀態']]},
 dashboard:{title:'今日營運總覽',desc:'工作、叫貨、庫存、人事與設備的即時概覽'},
 reports:{title:'虛構 Excel 匯出與列印',desc:'僅使用本瀏覽器的模擬資料'},
 backup_demo:{title:'智慧備份示範',desc:'僅供瀏覽器互動教學，不會執行真正資料庫備份'},
 tasks:{title:'今日工作',desc:'工作指派、完成紀錄與逾期追蹤',action:'task.create',permission:'manager',columns:[['title','工作內容'],['location_name','門市'],['assigned_name','負責人'],['due_date','期限'],['status','狀態']]},
 ingredients:{title:'食材主檔',desc:'管理食材名稱、單位及低庫存告警值',action:'ingredient.create',permission:'manager',columns:[['sku','料號'],['name','食材名稱'],['unit','單位'],['min_stock','安全庫存']]},
 stock:{title:'庫存管理',desc:'各門市實際庫存與安全庫存提示；新增期初庫存僅供未有庫存的食材',action:'stock.opening',permission:'owner',columns:[['location_name','門市'],['name','食材'],['on_hand','現有庫存'],['min_stock','安全庫存'],['unit','單位']]},
 stock_moves:{title:'庫存異動流水',desc:'不可直接修改的入庫、耗用與盤點調整紀錄',columns:[['created_at','時間'],['location_name','門市'],['ingredient_name','食材'],['move_type','類別'],['qty_delta','異動量'],['note','說明']]},
 purchase_orders:{title:'叫貨與驗收',desc:'先申請叫貨，主管核准後才能驗收入庫',action:'order.create',permission:'staff',columns:[['group_number','廠商叫貨單號'],['location_name','門市'],['ingredient_name','食材'],['supplier','供應商'],['qty','數量'],['unit','單位'],['status','狀態']]},
 stocktakes:{title:'食材盤點',desc:'員工申報盤點數，主管確認後產生有稽核紀錄的庫存差異',action:'stocktake.create',permission:'staff',columns:[['location_name','門市'],['ingredient_name','食材'],['expected_qty','帳面數量'],['counted_qty','盤點數量'],['status','狀態']]},
 repairs:{title:'設備維修',desc:'報修、指派、結案與維修追蹤',action:'repair.create',permission:'staff',columns:[['location_name','門市'],['equipment','設備'],['description','問題描述'],['assigned_name','處理人員'],['status','狀態']]},
 shifts:{title:'人事排班',desc:'主管安排班次；一般員工只能查看自己的班表',action:'shift.create',permission:'manager',columns:[['shift_date','日期'],['staff_name','員工'],['location_name','門市'],['start_time','上班'],['end_time','下班'],['note','備註']]},
 leave_requests:{title:'請假申請',desc:'申請及主管審核；禁止自行核准自己的請假',action:'leave.create',permission:'staff',columns:[['staff_name','員工'],['location_name','門市'],['start_date','起始日'],['end_date','結束日'],['reason','原因'],['status','狀態']]},
 training_courses:{title:'教育訓練課程',desc:'建立 SOP 課程、訓練內容與及格門檻',action:'course.create',permission:'manager',columns:[['title','課程'],['description','課程說明'],['required_score','及格分數']]},
 training_records:{title:'訓練與考核紀錄',desc:'課程分派、完成日期、訓練分數',action:'training.assign',permission:'manager',columns:[['course_title','課程'],['staff_name','員工'],['location_name','門市'],['score','分數'],['completed_on','完成日期']]},
 evaluations:{title:'員工績效考核',desc:'主管記錄評分與回饋，員工只可查看自己的紀錄',action:'evaluation.create',permission:'manager',columns:[['staff_name','員工'],['location_name','門市'],['period','考核期別'],['score','分數'],['feedback','回饋']]},
 users:{title:'帳號與權限',desc:'示範角色及門市權限模型；不提供真實帳號管理',action:null,permission:'owner',columns:[['username','登入帳號'],['display_name','姓名'],['role','角色'],['locations','授權門市'],['active','啟用']]},
 locations:{title:'門市管理',desc:'門市資料及資料隔離邊界',action:'location.create',permission:'owner',columns:[['name','門市'],['active','啟用']]},
 audit_logs:{title:'系統安全稽核（虛構資料）',desc:'以下 IP 均為保留的文件範例位址，並非訪客真實 IP',columns:[['at','時間'],['actor_name','操作者'],['ip_address','示意來源 IP'],['action','事件'],['entity','資料類別'],['entity_id','資料識別碼'],['detail','摘要']]}
};
const roleLevel={owner:3,manager:2,staff:1};
const can=p=>S.me && roleLevel[S.me.role]>=roleLevel[p||'staff'];
async function api(path,method='GET',payload){
 const opt={method,headers:{}};
 if(payload!==undefined){opt.headers['Content-Type']='application/json';opt.headers['X-CSRF-Token']=S.csrf;opt.body=JSON.stringify(payload);}
 const r=await fetch(path,opt);const j=await r.json().catch(()=>({error:'伺服器回應格式錯誤'}));
 if(!r.ok){const err=new Error(j.error||'操作失敗');err.status=r.status;throw err;}return j;
}
function toast(text){const n=$('#toast');n.textContent=text;n.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>n.classList.remove('show'),4000);}
function showAuth(flag){
 $('#auth-overlay').hidden=!flag;
 $('#sidebar').style.visibility=flag?'hidden':'visible';
 document.body.classList.toggle('auth-locked',flag);
 if(flag){
  // A shared workstation must not retain prior users' reports, cached rows or
  // forms. This also runs when an existing session expires during bootstrap.
  S.me=null;S.csrf='';S.cache={};S.filter='';S.page='dashboard';S.authEpoch++;
  $('#main').innerHTML='';
  const modal=$('#modal-root');invalidateModalOpens(modal);modal.hidden=true;modal.innerHTML='';
 }
}
function setActive(page){S.page=page;S.filter='';document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('#crumb').textContent=pages[page].title;$('#sidebar').classList.remove('open');}
function head(title,desc,action,permission){return `<div class="heading"><div><div class="eyebrow">RESTAURANT OPERATIONS</div><h1>${E(title)}</h1><p>${E(desc)}</p></div>${action&&can(permission)?`<button class="btn primary" data-create="${E(action)}">＋ 新增${E(title.replace(/管理|紀錄|主檔|與驗收/g,''))}</button>`:''}</div>`;}
function pill(v){let a=['done','approved','received','confirmed','closed','active'].includes(v)?'ok':['todo','requested','pending','reported'].includes(v)?'warn':['rejected','cancelled'].includes(v)?'bad':'';return `<span class="badge ${a}">${E(label(v))}</span>`;}
const colValue=(key,r)=>{
 const v=r[key];if(key==='status'||key==='role'||key==='move_type')return pill(v);
 if(key==='active')return pill(v?'active':'rejected');
 if(key==='on_hand')return `<strong style="color:${r.on_hand<r.min_stock?'#b75e42':'inherit'}">${E(v)}</strong>`;
 if(key==='detail'){try{return E(JSON.stringify(JSON.parse(v))).slice(0,120)}catch{return E(v).slice(0,120)}}
 if(key==='qty_delta')return `<strong>${v>0?'+':''}${E(v)}</strong>`;
 return fmt(v);
};
function rowActions(page,r){const a=[];
 if(page==='purchase_orders'&&typeof r.group_number==='string'&&r.group_number.startsWith('POB-'))return `<button class="btn small ghost" data-batch-preview="${E(r.group_number)}">查看廠商單／LINE</button>`;
 const btn=(act,txt,fields={})=>`<button class="btn small ghost" data-operation="${act}" data-id="${E(r.id)}" data-state="${E(fields.status||'')}">${E(txt)}</button>`;
 if(page==='menu_dishes'&&can('owner')){
   if(r.active===1){a.push(btn('dish.price','修改售價'));a.push(btn('dish.active','封存菜品',{status:'off'}));}
   else a.push(btn('dish.active','恢復菜品',{status:'on'}));
  }
  if(page==='dish_ingredients'&&can('owner'))a.push(btn('recipe.delete','移除食材'));
 if(page==='tasks'&&(can('manager')||r.assigned_to===S.me.id)&&r.status!=='done')a.push(btn('task.status',r.status==='todo'?'開始處理':'標記完成',{status:r.status==='todo'?'doing':'done'}));
 if(page==='purchase_orders'&&can('manager')){if(r.status==='requested')a.push(btn('order.approve','核准'),btn('order.cancel','取消'));if(r.status==='approved')a.push(btn('order.receive','驗收入庫'),btn('order.cancel','取消'));}
 if(page==='stocktakes'&&can('manager')&&r.status==='pending')a.push(btn('stocktake.confirm','確認入帳'));
 if(page==='repairs'&&can('manager')&&r.status!=='closed')a.push(btn('repair.status',r.status==='reported'?'標記派工':'結案',{status:r.status==='reported'?'assigned':'closed'}));
 if(page==='leave_requests'&&can('manager')&&r.status==='pending'&&r.user_id!==S.me.id)a.push(btn('leave.review','核准',{status:'approved'}),btn('leave.review','駁回',{status:'rejected'}));
 if(page==='training_records'&&can('manager')&&r.score===null)a.push(btn('training.score','登記成績'));
 if(false&&page==='users'&&can('owner')&&r.id!==S.me.id)a.push(btn('user.assign-location','加授門市'),btn('user.active',r.active?'停用':'啟用',{status:r.active?'off':'on'}),btn('user.role','變更角色'),btn('user.password','重設密碼'));
 return a.join('');
}
async function dataPage(page){
 const cfg=pages[page];setActive(page);
 $('#main').innerHTML=head(cfg.title,cfg.desc,cfg.action,cfg.permission)+(page==='stock'&&can('manager')?'<div class="toolbar"><button class="btn ghost" data-create="stock.usage">－ 登錄食材耗用</button></div>':'')+(page==='purchase_orders'?'<div class="toolbar"><button class="btn primary" data-new-batch="1">＋ 多品項叫貨／依供應商分單</button><span class="muted">虛構展示，勿向真實供應商發送。</span></div>':'')+(page==='menu_dishes'?`<div class="toolbar"><label><input type="checkbox" data-toggle-archived="1" ${S.showArchivedDishes?'checked':''}> 顯示已封存菜品（可恢復）</label></div>`:'')+`<div class="toolbar"><input id="search" aria-label="搜尋資料" placeholder="搜尋目前列表…"><span class="search-count" id="count"></span><button type="button" class="btn ghost" data-export-current="1">匯出此頁 Excel</button><button type="button" class="btn ghost" data-print-current="1">列印此頁</button></div><div class="table-wrap" id="table-wrap"><div class="loading">讀取中…</div></div>`;
 try{const x=await api('/api/data?entity='+encodeURIComponent(page));S.cache[page]=x.rows;drawTable(page);}catch(e){$('#table-wrap').innerHTML=`<div class="empty">${E(e.message)}</div>`;}
}
function drawTable(page){const cfg=pages[page],filtered=(S.cache[page]||[]).filter(r=>(page!=='menu_dishes'||S.showArchivedDishes||r.active===1)&&JSON.stringify(r).toLowerCase().includes(S.filter.toLowerCase()));
 const cols=cfg.columns;$('#count').textContent=`共 ${filtered.length} 筆`;
 const buttons=filtered.some(r=>rowActions(page,r));
 $('#table-wrap').innerHTML=filtered.length?`<table><thead><tr>${cols.map(c=>`<th>${E(c[1])}</th>`).join('')}${buttons?'<th>操作</th>':''}</tr></thead><tbody>${filtered.map(r=>`<tr>${cols.map(c=>`<td>${colValue(c[0],r)}</td>`).join('')}${buttons?`<td class="actions">${rowActions(page,r)}</td>`:''}</tr>`).join('')}</tbody></table>`:'<div class="empty">目前沒有符合條件的資料</div>';
}
async function dashboard(){setActive('dashboard');$('#main').innerHTML=head('今日營運總覽','掌握待辦、低庫存、叫貨、設備與教育訓練的最新狀態');
 try{const x=await api('/api/overview');const z=x.overview;
  const stat=(title,n,hint,ic)=>`<div class="stat"><span class="ic">${ic}</span><div class="label">${title}</div><div class="metric">${E(n)}</div><div class="hint">${hint}</div></div>`;
  $('#main').innerHTML+=`<div class="stat-grid">${stat('待辦工作',z.todo,'待處理與處理中','☑')}${stat('已逾期工作',z.late,'需優先追蹤','◷')}${stat('庫存不足品項',z.low,'低於安全存量','⬡')}${stat('待核准叫貨',z.orders,'待主管處理','▤')}${stat('設備未結案',z.repairs,'維修追蹤中','⚒')}${stat('未完成訓練',z.trainingPending,'已指派但尚未評分','♙')}</div><div class="dashboard-panels"><section class="hero"><div class="hero-title"><span class="brand-mark">♜</span><div><div class="dark-kicker">餐廳好管家</div><h2>今日營運工作台</h2><p>多層級權限 × 營運工作管理</p></div></div><div class="hero-line"></div><div class="quick-grid"><button class="quick" data-page="tasks"><span class="symbol">☑</span><strong>今日工作</strong><small>待辦、逾期、完成紀錄</small></button><button class="quick" data-page="purchase_orders"><span class="symbol">⬡</span><strong>叫貨與庫存</strong><small>缺貨、安全庫存、進貨</small></button><button class="quick" data-page="repairs"><span class="symbol">⚒</span><strong>設備維修</strong><small>報修、派工、保養</small></button><button class="quick" data-page="training_records"><span class="symbol">♙</span><strong>人事與訓練</strong><small>班表、請假、SOP、考核</small></button></div></section><section class="panel"><h2>帳號與資料保護</h2><div class="rowlist"><div class="item"><strong>目前登入</strong><span>${E(S.me.display_name)}</span></div><div class="item"><strong>身分角色</strong><span>${E(label(S.me.role))}</span></div><div class="item"><strong>授權門市</strong><span>${E(S.me.role==='owner'?'全部門市':String(S.me.locations.length)+' 間')}</span></div><div class="item"><strong>操作稽核</strong><span>僅展示虛構稽核紀錄</span></div><div class="item"><strong>正式資料模式</strong><span>僅瀏覽器虛構資料</span></div></div><p class="notice warning" style="margin-top:20px">公開展示版沒有實際身分驗證，也不連線正式營運資料庫。請勿輸入任何真實個資或密碼。</p></section></div>`;
 }catch(e){$('#main').innerHTML=`<div class="empty">${E(e.message)}</div>`;}
}
async function getLists(){for(const k of ['locations','ingredients','staff_directory','users','training_courses','menu_dishes']){
 try{S.cache[k]=(await api('/api/data?entity='+k)).rows;}catch{S.cache[k]=[];}
 }}
const field=(name,display,type='text',required=true,extra={})=>({name,display,type,required,...extra});
const def={
 'location.create':{title:'新增門市',fields:[field('name','門市名稱')]},
 'user.create':{title:'新增員工帳號',fields:[field('username','登入帳號（英文與數字）'),field('display_name','員工姓名'),field('password','初始密碼（至少 12 字元）','password'),field('role','角色','role'),field('location_id','授權門市','locations')]},
 'price.record':{title:'新增食材歷史單價',fields:[field('location_id','門市','locations'),field('ingredient_id','食材','ingredients'),field('unit_price_twd','單價（元）','number'),field('unit','計價單位（例如：公斤、顆）'),field('price_date','生效日期','date',true,{value:new Date().toLocaleDateString('sv-SE')}),field('supplier','供應商','text',false)]},
 'dish.create':{title:'新增菜品',fields:[field('name','菜品名稱'),field('sale_price_twd','售價（元）','number')]},
 'dish.price':{title:'修改菜品售價',fields:[field('sale_price_twd','新售價（元）','number')]},
 'recipe.set':{title:'新增／調整每份食材配方',fields:[field('dish_id','菜品','menu_dishes'),field('ingredient_id','食材','ingredients'),field('qty','每份用量','number'),field('unit','計量單位（例如：公克、顆）')]},
 'order.receive':{title:'示範驗收入庫（可選填進價）',fields:[field('unit_price_twd','本次進價（元；不填則不記價格）','number',false),field('unit','計價單位（例如：公斤）','text',false),field('price_date','價格生效日','date',false),field('supplier','供應商','text',false)]},
 'task.create':{title:'新增工作',fields:[field('location_id','所屬門市','locations'),field('title','工作名稱'),field('due_date','期限','date',false),field('assigned_to','指派員工','users',false),field('description','工作說明','textarea',false)]},
 'ingredient.create':{title:'新增食材',fields:[field('sku','料號'),field('name','食材名稱'),field('unit','計量單位'),field('min_stock','安全庫存','number')]},
 'stock.usage':{title:'登錄食材耗用',fields:[field('location_id','門市','locations'),field('ingredient_id','食材','ingredients'),field('qty','耗用數量','number'),field('note','用途說明','textarea',false)]},
 'stock.opening':{title:'建立期初庫存（不可重複）',fields:[field('location_id','門市','locations'),field('ingredient_id','食材','ingredients'),field('qty','期初數量','number'),field('note','期初庫存來源','textarea',false)]},
 'order.create':{title:'建立叫貨申請',fields:[field('location_id','門市','locations'),field('ingredient_id','食材','ingredients'),field('supplier','供應商'),field('qty','叫貨數量','number')]},
 'stocktake.create':{title:'新增盤點記錄',fields:[field('location_id','門市','locations'),field('ingredient_id','食材','ingredients'),field('counted_qty','實際數量','number')]},
 'repair.create':{title:'回報設備問題',fields:[field('location_id','門市','locations'),field('equipment','設備名稱'),field('description','故障描述','textarea')]},
 'shift.create':{title:'安排員工班表',fields:[field('location_id','門市','locations'),field('user_id','員工','users'),field('shift_date','排班日期','date'),field('start_time','上班時間','time'),field('end_time','下班時間','time'),field('note','備註','textarea',false)]},
 'leave.create':{title:'申請請假',fields:[field('location_id','門市','locations'),field('start_date','起始日期','date'),field('end_date','結束日期','date'),field('reason','請假原因','textarea')]},
 'course.create':{title:'新增訓練課程',fields:[field('title','課程名稱'),field('description','SOP／課程內容','textarea',false),field('required_score','及格分數','number',true,{value:80})]},
 'training.assign':{title:'分派教育訓練',fields:[field('location_id','門市','locations'),field('course_id','訓練課程','training_courses'),field('user_id','受訓員工','users')]},
 'evaluation.create':{title:'新增員工考核',fields:[field('location_id','門市','locations'),field('user_id','員工','users'),field('period','考核期別（例如 2026-10）'),field('score','評分 0–100','number'),field('feedback','評語','textarea',false)]},
 'training.score':{title:'登記訓練成績',fields:[field('score','成績 0–100','number'),field('completed_on','完成日期','date',true,{value:new Date().toLocaleDateString('sv-SE')})]},
 'user.assign-location':{title:'新增員工門市授權',fields:[field('location_id','授權門市','locations')]},
 'user.role':{title:'調整員工角色',fields:[field('role','新角色','role')]},
 'user.password':{title:'重設員工密碼',fields:[field('password','新密碼（至少 12 字元）','password')]}
};
function options(type){let data=S.cache[type]||[];
 if(type==='users'&&S.me.role!=='owner')data=S.cache.staff_directory||[];
 if(type==='locations'&&S.me.role!=='owner')data=data.filter(x=>S.me.locations.includes(x.id));
 if(type==='role')return [['staff','一般員工'],['manager','主管'],['owner','業主']];
 return data.filter(x=>x.active!==0).map(x=>[x.id,x.display_name||x.name||x.title]);
}
function inputHtml(f){const req=f.required?'required':'',name=E(f.name),value=E(f.value||''),label=E(f.display);
 if(['role','locations','ingredients','users','training_courses','menu_dishes'].includes(f.type)){const opts=options(f.type);return `<label>${label}<select name="${name}" ${req}><option value="">請選擇…</option>${opts.map(o=>`<option value="${E(o[0])}">${E(o[1])}</option>`).join('')}</select></label>`;}
 if(f.type==='textarea')return `<label class="full">${label}<textarea name="${name}" rows="3" ${req}></textarea></label>`;
 const step=f.type==='number'?'step="any" min="0"':'';
 return `<label>${label}<input name="${name}" type="${E(f.type)}" ${req} ${step} value="${value}"></label>`;
}
function invalidateModalOpens(root){return (root.__openTicket=(root.__openTicket||0)+1);}
async function showForm(action,id){
 const d=def[action];if(!d){toast('此操作目前未提供表單');return;}
 // Invalidate pending batch preview/create GETs *before* await getLists().
 const root=$('#modal-root'),ticket=invalidateModalOpens(root),epoch=S.authEpoch,userId=S.me?.id;
 await getLists();
 if(root.__openTicket!==ticket||S.authEpoch!==epoch||S.me?.id!==userId)return;
 root.hidden=false;
 root.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${E(d.title)}"><h2>${E(d.title)}</h2><p>僅修改本次瀏覽器中的虛構示範資料，不產生正式紀錄。</p><form id="record-form"><div class="form-grid">${d.fields.map(inputHtml).join('')}</div><div class="form-actions"><button type="button" class="btn" id="cancel-modal">取消</button><button type="submit" class="btn primary">確認儲存</button></div></form></div>`;
 const close=()=>{invalidateModalOpens(root);root.hidden=true;root.innerHTML=''};$('#cancel-modal').addEventListener('click',close);
 $('#record-form').addEventListener('submit',async e=>{e.preventDefault();const raw=Object.fromEntries(new FormData(e.currentTarget).entries());Object.keys(raw).forEach(k=>{if(raw[k]==='')delete raw[k]});if(id)raw[action.startsWith('user.')?'user_id':action==='dish.price'?'dish_id':'id']=id;
 try{await api('/api/command','POST',{action,data:raw});close();toast(action==='user.password'?'密碼已變更，請重新登入':'已成功儲存');if(action==='user.password'){S.me=null;S.csrf='';showAuth(true);}else await refresh();}catch(err){toast(err.message);}});
}
async function operation(action,id,status){try{
 if(['training.score','user.role','user.password','dish.price','order.receive'].includes(action))return showForm(action,id);
 if(['stocktake.confirm','order.cancel','user.active','repair.status','leave.review'].includes(action)&&!window.confirm('確定執行「'+label(status||action)+'」？此操作會留下稽核紀錄。'))return;
 if(action==='dish.active'||action==='recipe.delete'){
   const prompt=action==='recipe.delete'
    ?'確定移除此配方食材？菜品成本估算將重新計算；不會刪除食材主檔或歷史價格。'
    :status==='off'
     ?'確定封存這道菜品？預設列表與成本試算不再顯示，但配方會保留，可重新恢復。'
     :'確定恢復這道菜品，重新納入菜單與成本試算？';
   if(!window.confirm(prompt))return;
  }
  let data={id};if(status)data.status=status;
 if(action==='user.active')data={user_id:id,active:status==='on'};
  if(action==='dish.active')data={id,active:status==='on'?1:0};
 if(action==='repair.status')data={id,status};
 await api('/api/command','POST',{action,data});toast('操作完成');await refresh();
 }catch(e){toast(e.message);}}
async function refresh(){return S.page==='dashboard'?dashboard():S.page==='backup_demo'?demoBackupPage():S.page==='reports'?reportPage():dataPage(S.page);}
async function bootstrap(){try{const out=await api('/api/me');S.me=out.user;S.csrf=out.csrf;showAuth(false);$('#avatar').textContent=S.me.display_name.slice(0,1)||'餐';
 document.querySelectorAll('[data-owner]').forEach(x=>x.hidden=S.me.role!=='owner');$('#today').textContent=new Date().toLocaleDateString('zh-TW',{weekday:'long',month:'long',day:'numeric'});
 dashboard();}catch(e){showAuth(true);}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;$('#login-error').textContent='';const data=Object.fromEntries(new FormData(form));try{if(logoutInFlight)await logoutInFlight.catch(()=>{});await api('/api/login','POST',data);form.reset();await bootstrap();}catch(err){$('#login-error').textContent=err.message;}});
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;const p=b.dataset.page;if(p==='dashboard')dashboard();else if(p==='backup_demo')demoBackupPage();else if(p==='reports')reportPage();else dataPage(p);});
$('#main').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.page){const p=b.dataset.page;p==='dashboard'?dashboard():p==='backup_demo'?demoBackupPage():p==='reports'?reportPage():dataPage(p);return;}
 if(b.dataset.exportCurrent)exportCurrentPage('xlsx');
 if(b.dataset.printCurrent)exportCurrentPage('print');
 if(b.dataset.create)showForm(b.dataset.create);
 if(b.dataset.newBatch)OrderBatchUI.start().catch(e=>toast(e.message));
  if(b.dataset.batchPreview)OrderBatchUI.preview(b.dataset.batchPreview).catch(e=>toast(e.message));
  if(b.dataset.operation)operation(b.dataset.operation,b.dataset.id,b.dataset.state);
});
$('#main').addEventListener('change',e=>{if(e.target.matches('[data-toggle-archived]')){S.showArchivedDishes=e.target.checked;drawTable('menu_dishes');}});
$('#main').addEventListener('input',e=>{if(e.target.id==='search'){S.filter=e.target.value;drawTable(S.page);}});
$('#menu-btn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#change-password').addEventListener('click',()=>{if(S.me)showForm('user.password',S.me.id);});
$('#logout').addEventListener('click',async()=>{
 if(logoutInFlight)return;
 // Start the logout request with the original CSRF. Lock the display now,
 // then wait for the previous response before issuing any new login:
 // the old logout's Set-Cookie deletion could erase the new login cookie.
 const pending=api('/api/logout','POST',{});
 logoutInFlight=pending;
 showAuth(true);$('#sidebar').classList.remove('open');
 try{await pending;}catch{toast('伺服器尚未確認登出，請關閉此分頁並通知管理者。');}
 finally{if(logoutInFlight===pending)logoutInFlight=null;}
});
$('#modal-root').addEventListener('click',e=>{if(e.target.id==='modal-root'){invalidateModalOpens(e.currentTarget);e.currentTarget.hidden=true;e.currentTarget.innerHTML='';}});
bootstrap();
