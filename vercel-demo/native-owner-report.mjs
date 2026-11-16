// Safe one-sheet Excel projection from existing Native D1 table display.
// Operates only on previously authenticated and already loaded <=500 rows.
// Never exports unprojected D1 fields, opaque ids, credentials or raw objects.
import {presentNativeRows} from './native-owner-display.mjs';

const NUMBERS=new Set(['qty','on_hand','min_stock','expected_qty','counted_qty',
  'required_score','score','qty_delta']);
const CELL_LIMIT=32767;
export function nativeOwnerReportSheet(entity,rows,{keyword='',name}={}){
  if(typeof entity!=='string'||typeof keyword!=='string'||keyword.length>80||
     typeof name!=='string'||!name||name.length>31)
    throw Error('E_NATIVE_REPORT_INPUT');
  const model=presentNativeRows(entity,rows); // fail closed on invalid or >500 rows
  const term=keyword.trim().toLocaleLowerCase('zh-TW');
  const selected=model.entries.map((entry,index)=>({entry,record:rows[index]}))
    .filter(x=>!term||x.entry.search.includes(term));
  return {
    name,
    headers:model.columns.map(c=>c.label),
    rows:selected.map(({entry,record})=>model.columns.map((col,i)=>{
      const v=record[col.key];
      if(NUMBERS.has(col.key)&&typeof v==='number'&&Number.isFinite(v))return v;
      const text=entry.cells[i].text;
      return typeof text==='string'?text.slice(0,CELL_LIMIT):'';
    }))
  };
}
