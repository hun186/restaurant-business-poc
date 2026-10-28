'use strict';
// RB-006: half-open local wall-clock shift intervals, including a next-day end.
// Synthetic SQLite only; never reads operator databases.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb}=require('../src/db');
const {command,rows}=require('../src/service');

function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-overnight-shifts-'));
 const {db}=openDb(folder);
 t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();
 const location=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const staffId=command(db,owner,'user.create',{username:'shift-worker',display_name:'虛構排班員',role:'staff',password:'synthetic-pass-234',location_id:location}).id;
 return {db,owner,location,staffId};
}
const shift=(f,date,start,end,extra={})=>command(f.db,f.owner,'shift.create',{
 location_id:f.location,user_id:f.staffId,shift_date:date,start_time:start,end_time:end,...extra
});

test('overnight shift is persisted and remains visible with the original end clock time',t=>{
 const f=fixture(t);
 const id=shift(f,'2026-11-01','22:00','06:00').id;
 const record=f.db.prepare('SELECT shift_date,start_time,end_time FROM shifts WHERE id=?').get(id);
 assert.deepEqual(record,{shift_date:'2026-11-01',start_time:'22:00',end_time:'06:00'});
 assert.equal(rows(f.db,f.owner,'shifts').find(r=>r.id===id).end_time,'06:00');
 // No schema change: end < start signifies the following calendar day.
 const ui=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 assert.match(ui,/下班（早於上班視為隔日）/);
 assert.match(ui,/key==='end_time'&&r\.shift_date/);
});

test('reject overlapping next-day and previous-day shifts; allow boundary-touching shifts',t=>{
 const f=fixture(t);
 shift(f,'2026-11-01','22:00','06:00');
 for(const [date,start,end] of [
  ['2026-11-01','23:59','00:30'],
  ['2026-11-02','00:00','02:00'],
  ['2026-11-02','05:59','09:00'],
  ['2026-11-01','21:00','23:00']
 ])assert.throws(()=>shift(f,date,start,end),{status:409});
 shift(f,'2026-11-01','20:00','22:00'); // directly before the night shift
 shift(f,'2026-11-02','06:00','09:00'); // directly after the night shift
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM shifts').get().n,3);
});

test('overlap detection crosses stores and year/leap-day boundaries',t=>{
 const f=fixture(t);
 const other=command(f.db,f.owner,'location.create',{name:'虛構第二分店'}).id;
 command(f.db,f.owner,'user.assign-location',{user_id:f.staffId,location_id:other});
 shift(f,'2026-12-31','23:30','01:30');
 assert.throws(()=>shift(f,'2027-01-01','01:00','03:00',{location_id:other}),{status:409});
 shift(f,'2027-01-01','01:30','03:00',{location_id:other});
 shift(f,'2028-02-28','23:15','00:45');
 assert.throws(()=>shift(f,'2028-02-29','00:30','01:00'),{status:409});
 shift(f,'2028-02-29','00:45','08:00');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM shifts').get().n,4);
});

test('invalid equal time, invalid calendar day, and unauthorized staff writes leave no shift or audit',t=>{
 const f=fixture(t),before=f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
 assert.throws(()=>shift(f,'2026-11-01','09:00','09:00'),{status:400});
 assert.throws(()=>shift(f,'2026-02-30','22:00','06:00'),{status:400});
 assert.throws(()=>shift(f,'2026-11-01','24:00','06:00'),{status:400});
 assert.throws(()=>command(f.db,{id:f.staffId,role:'staff',username:'shift-worker'},'shift.create',{
  location_id:f.location,user_id:f.staffId,shift_date:'2026-11-01',start_time:'23:00',end_time:'07:00'
 }),{status:403});
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM shifts').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,before);
});
