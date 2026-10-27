'use strict';
// IP comes from the actual TCP connection, not spoofable HTTP proxy headers.
const {AsyncLocalStorage}=require('node:async_hooks');
const {isIP}=require('node:net');
const storage=new AsyncLocalStorage();
function clientIp(req){
 const raw=req?.socket?.remoteAddress;
 if(typeof raw!=='string')return null;
 const ip=raw.startsWith('::ffff:')&&isIP(raw.slice(7))===4?raw.slice(7):raw;
 return isIP(ip)?ip:null;
}
function withRequestIp(ip,work){return storage.run({ip:isIP(ip||'')?ip:null},work);}
function requestIp(){return storage.getStore()?.ip||null;}
module.exports={clientIp,requestIp,withRequestIp};
