'use strict';
const crypto = require('node:crypto');
const ROLES = Object.freeze({owner: 3, manager: 2, staff: 1});
function uuid(){ return crypto.randomUUID(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw Object.assign(new Error('密碼長度必須介於 12 至 256 字元'),{status:400});
  return {salt, hash:crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')};
}
function checkPassword(password,salt,expected){
  if(typeof password !== 'string' || password.length > 256) return false;
  try{const b=crypto.scryptSync(password, Buffer.from(salt,'hex'),64);const e=Buffer.from(expected,'hex');return e.length===b.length && crypto.timingSafeEqual(b,e);}catch{return false;}
}
function randomToken(){return crypto.randomBytes(32).toString('base64url');}
function sha(t){return crypto.createHash('sha256').update(t).digest('hex');}
function cleanText(v,max=200,required=false){
 if(typeof v!=='string')throw Object.assign(new Error('欄位格式不正確'),{status:400});
 const x=v.trim();if(x.length>max ||(required && !x))throw Object.assign(new Error('必填或欄位長度不符'),{status:400});return x;
}
function nonneg(v,positive=false){const n=Number(v);if(v===null||v===''||!Number.isFinite(n)||n<0||(positive&&n<=0)||n>1e9)throw Object.assign(new Error('數量必須為有效的非負數'),{status:400});return n;}
function requiredRole(u,role){if(!u || ROLES[u.role]<ROLES[role]) throw Object.assign(new Error('權限不足'),{status:403});}
module.exports={uuid,hashPassword,checkPassword,randomToken,sha,cleanText,nonneg,requiredRole,ROLES};
