'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const contract=import('../cloudflare/shift-time-contract.mjs');
test('civil window exact dates, clocks, extreme years and no equal-time shifts',async()=>{
 const {shiftTimeWindow:w,shiftConflictBindings:b}=await contract;
 assert.equal(w('2026-12-31','23:30','01:30').endAt-w('2026-12-31','23:30','01:30').startAt,7200);
 assert.equal(w('2026-12-31','23:30','01:30').next,'2027-01-01');
 assert.equal(w('2028-02-29','09:00','17:00').prev,'2028-02-28');
 assert.equal(w('0000-01-01','09:00','17:00').prev,'0000-01-01');
 assert.equal(w('9999-12-31','23:00','01:00').next,'9999-12-31');
 assert.equal(w('9999-12-31','23:00','01:00').endAt-w('9999-12-31','23:00','01:00').startAt,7200);
 for(const [d,s,e] of [['2026-02-30','09:00','17:00'],['2026-1-01','09:00','17:00'],
 ['2026-01-01','24:00','01:00'],['2026-01-01','09:00','09:00'],
 ['2026-01-01','9:00','17:00'],['10000-01-01','09:00','17:00']])
  assert.throws(()=>w(d,s,e),/E_SHIFT_/);
 assert(Object.isFrozen(w('2026-01-01','09:00','17:00')));
 assert(Object.isFrozen(b('staff','2026-01-01','09:00','17:00')));
});
test('fixed SQL matches independent half-open reference across dates, midnight and all stores',async t=>{
 const {SHIFT_CONFLICT_SQL:sql,shiftConflictBindings:b}=await contract;
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE shifts(user_id TEXT,location_id TEXT,shift_date TEXT,start_time TEXT,end_time TEXT)');
 const insert=db.prepare('INSERT INTO shifts VALUES(?,?,?,?,?)');
 const query=db.prepare(sql);
 const dateSets=[
  ['2026-12-30','2026-12-31','2027-01-01'],
  ['2028-02-28','2028-02-29','2028-03-01'],
  ['0000-01-01','0000-01-02'],
  ['9999-12-30','9999-12-31']
 ];
 const times=['00:00','00:30','06:00','09:00','17:00','22:00','23:30','23:59'];
 const interval=(d,s,e)=>[Date.parse(d+'T'+s+':00Z'),Date.parse(d+'T'+e+':00Z')+(e<s?86400000:0)];
 let comparisons=0;
 for(const dates of dateSets){
  const cases=dates.flatMap(d=>times.flatMap(s=>times.filter(e=>e!==s).map(e=>[d,s,e])));
  // Deterministic matrix: each stored interval against all candidate windows.
  for(const stored of cases){
   db.exec('DELETE FROM shifts');insert.run('staff','other-store',...stored);
   insert.run('different-staff','other-store',...stored);
   const [a,z]=interval(...stored);
   for(const candidate of cases){
    const [c,y]=interval(...candidate);
    assert.equal(Boolean(query.get(...b('staff',...candidate))),a<y&&z>c,JSON.stringify({stored,candidate}));
    assert.equal(Boolean(query.get(...b('no-shifts',...candidate))),false);
    comparisons++;
   }
  }
 }
 assert(comparisons>50000);
});
test('malformed stored neighboring clock intervals fail closed, unrelated staff/date remain unaffected',async t=>{
 const {SHIFT_CONFLICT_SQL:sql,shiftConflictBindings:b}=await contract;
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE shifts(user_id TEXT,location_id TEXT,shift_date TEXT,start_time TEXT,end_time TEXT)');
 const insert=db.prepare('INSERT INTO shifts VALUES(?,?,?,?,?)'),query=db.prepare(sql);
 for(const [start,end] of [['24:00','06:00'],['09:00','09:00'],['9:00','17:00'],[null,'06:00']]){
  db.exec('DELETE FROM shifts');insert.run('staff','other-store','2026-12-01',start,end);
  assert(query.get(...b('staff','2026-12-02','17:00','18:00')));
  assert.equal(query.get(...b('other','2026-12-02','17:00','18:00')),undefined);
  assert.equal(query.get(...b('staff','2026-12-04','17:00','18:00')),undefined);
 }
});
