// Append-only Native D1 historical ingredient prices. Disabled unless independently released.
// Mirrors local SQLite / demo price.record inputs but never uses demo records.
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import pricingUnits from './pricing-units.cjs';
const {conversion}=pricingUnits;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'});
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const changed=r=>r?.meta?.changes??r?.changes;
const validDb=db=>!!db&&typeof db.prepare==='function'&&typeof db.batch==='function';
export const nativePriceWriteEnabled=env=>nativeLoginEnabled(env)&&
  env?.CLOUD_NATIVE_PRICE_WRITE_GATE==='operator-released';

function cents(input){
 const raw=String(input??'').trim();
 if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(raw))return null;
 const [whole,decimal='']=raw.split('.');
 const result=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 return Number.isSafeInteger(result)&&result>0&&result<=100000000000?result:null;
}
function date(input){
 if(typeof input!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(input))return null;
 const when=new Date(input+'T00:00:00Z');
 return Number.isFinite(when.getTime())&&when.toISOString().slice(0,10)===input?input:null;
}
const taipeiToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
function parse(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='action,data'||body.action!=='price.record')return null;
 const d=body.data;
 if(!d||typeof d!=='object'||Array.isArray(d)||
    Object.keys(d).some(k=>!['ingredient_id','location_id','price_date','unit_price_twd','unit','supplier'].includes(k))||
    !UUID.test(d.ingredient_id)||!UUID.test(d.location_id))return null;
 const priceCents=cents(d.unit_price_twd),priceDate=date(d.price_date??taipeiToday());
 if(priceCents===null||priceDate===null)return null;
 if(d.unit!==undefined&&(typeof d.unit!=='string'||!d.unit.trim()||
    d.unit!==d.unit.trim()||d.unit.length>20||/[\u0000-\u001f\u007f]/.test(d.unit)))return null;
 if(d.supplier!==undefined&&(typeof d.supplier!=='string'||
    d.supplier!==d.supplier.trim()||d.supplier.length>120||
    /[\u0000-\u001f\u007f]/.test(d.supplier)))return null;
 return {ingredientId:d.ingredient_id,locationId:d.location_id,
   priceDate,priceCents,unit:d.unit??null,supplier:d.supplier??''};
}

export async function nativePriceHttp(request,env){
 if(!nativePriceWriteEnabled(env)||!validDb(env?.DB))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 let url;try{url=new URL(request.url);}catch{return reply(400,{code:'E_INVALID_REQUEST'});}
 if(url.protocol!=='https:'||url.pathname!=='/api/price'||url.search||url.hash)
   return reply(400,{code:'E_INVALID_REQUEST'});
 if(request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')
   return reply(403,{code:'E_FORBIDDEN'});
 if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(400,{code:'E_INVALID_REQUEST'});
 if(request.headers.get('content-type')!=='application/json'||
    request.headers.has('content-encoding'))return reply(415,{code:'E_INVALID_REQUEST'});
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
   return reply(413,{code:'E_INVALID_REQUEST'});
 try{
   const principal=await loadPrincipal(env.DB,request);
   if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
   if(!authorizedMutation(request,principal,'manager'))
     return reply(403,{code:'E_FORBIDDEN'});
   const marker=await env.DB.prepare(
     'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
   if(Number(marker?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
   let payload;
   try{payload=JSON.parse(await bodyWithinLimit(request));}
   catch{return reply(400,{code:'E_INVALID_JSON'});}
   const data=parse(payload);
   if(!data)return reply(400,{code:'E_INVALID_INPUT'});
   if(!hasAccess(principal,'manager',data.locationId))return reply(403,{code:'E_FORBIDDEN'});
   const store=await env.DB.prepare('SELECT active FROM locations WHERE id=?')
     .bind(data.locationId).first();
   const ingredient=await env.DB.prepare('SELECT unit,active FROM ingredients WHERE id=?')
     .bind(data.ingredientId).first();
   if(store?.active!==1||ingredient?.active!==1)return reply(404,{code:'E_NOT_FOUND'});
   const unit=data.unit??ingredient.unit;
   if(typeof unit!=='string'||!unit||unit.length>20||
      conversion(1,unit,ingredient.unit)===null)return reply(400,{code:'E_INVALID_UNIT'});
   const id=crypto.randomUUID(),auditId=crypto.randomUUID();
   // Verify live Manager/Owner, session, and active-store membership again INSIDE D1 batch.
   // A revoked role/grant between initial validation and INSERT must not commit.
   const actor="EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id "+
     "WHERE u.id=? AND u.active=1 AND u.role IN ('owner','manager') "+
     "AND s.token_hash=? AND s.csrf_token=? AND "+
     "s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
     "AND (u.role='owner' OR EXISTS (SELECT 1 FROM user_locations ul "+
     "WHERE ul.user_id=u.id AND ul.location_id=?)))";
   const insert=env.DB.prepare(
     'INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,'+
     'price_cents,unit,supplier,source,reference_id,created_by) '+
     "SELECT ?,?,?,?,?,?,?,'manual',NULL,? WHERE "+
     'EXISTS(SELECT 1 FROM locations WHERE id=? AND active=1) AND '+
     'EXISTS(SELECT 1 FROM ingredients WHERE id=? AND active=1) AND '+actor
   ).bind(id,data.ingredientId,data.locationId,data.priceDate,data.priceCents,
     unit,data.supplier,principal.id,data.locationId,data.ingredientId,
     principal.id,principal.token_hash,principal.csrf,data.locationId);
   const audit=env.DB.prepare(
     'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
     "SELECT ?,u.id,u.username,'price.record','ingredient_prices',p.id,p.location_id,? "+
     'FROM ingredient_prices p JOIN users u ON u.id=p.created_by '+
     'JOIN sessions s ON s.user_id=u.id WHERE p.id=? AND u.id=? AND u.active=1 '+
     "AND u.role IN ('owner','manager') AND s.token_hash=? AND s.csrf_token=? "+
     "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND "+
     "(u.role='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
     'WHERE ul.user_id=u.id AND ul.location_id=p.location_id))'
   ).bind(auditId,JSON.stringify({price_date:data.priceDate,source:'manual',
     unit,price_cents:data.priceCents}),id,principal.id,
     principal.token_hash,principal.csrf);
   // NULL sentinel forces a rollback if INSERT or audit/CAS failed.
   const guard=env.DB.prepare(
     'UPDATE users SET display_name=CASE WHEN '+
     'EXISTS(SELECT 1 FROM ingredient_prices WHERE id=? AND created_by=?) AND '+
     "EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND action='price.record' AND entity_id=?) "+
     'THEN display_name ELSE NULL END WHERE id=?'
   ).bind(id,principal.id,auditId,id,principal.id);
   const out=await env.DB.batch([insert,audit,guard]);
   if(!Array.isArray(out)||out.length!==3||out.some(r=>changed(r)!==1))
     return reply(503,{code:'E_PRICE_UNAVAILABLE'});
   return reply(200,{code:'OK',result:{id}});
 }catch{return reply(503,{code:'E_PRICE_UNAVAILABLE'});}
}
