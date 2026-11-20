// Shared, zero-I/O, fail-closed SQL pre-replay scanner.
// Do not weaken checks in backup Export / Verify / Copy Verify or v4 rehearsal.
// This scanner alone does not control SQLite temp spill: callers MUST also set
// PRAGMA temp_store=MEMORY on their own SQLite connections before replay.
const fail=()=>{throw new Error('E_D1_MEMORY_SQL_UNSAFE');};
// Reject disk-capable SQL before *either* SQLite replay. An authenticated
// archive can still contain unsafe statements. Ignore literals and comments.
// Linear-time SQL token scan: keep only the preceding significant token, never
// regex-match a growing SQL prefix or slice the entire remaining suffix.
// Authentication proves archive provenance, NOT that the SQL is safe to replay.
const FORBIDDEN_SQL_TOKENS=new Set([
 'ATTACH','DETACH','VACUUM','LOAD_EXTENSION','TEMP','TEMPORARY',
 'TEMP_STORE','TEMP_STORE_DIRECTORY','VIRTUAL'
]);
const IDENTIFIER_CONTEXT_TOKENS=new Set([
 'PRAGMA','TABLE','VIEW','INDEX','TRIGGER','ON','FROM','JOIN','INTO',
 'UPDATE','DELETE','DATABASE','SCHEMA'
]);
const sqlWordChar=c=>c!==undefined&&/^[A-Za-z0-9_]$/.test(c);
const sqlWhitespace=c=>c!==undefined&&/\s/.test(c);
export function assertMemoryOnlySql(sql){
 if(typeof sql!=='string'||!sql)fail();
 let lastToken='',word='',overlong=false,pragmaStatement=false;
 const finishWord=()=>{
  if(!word&&!overlong)return;
  const token=overlong?'':word.toUpperCase();
  if(FORBIDDEN_SQL_TOKENS.has(token))fail();
  // Preserve PRAGMA context through schema qualifiers (main.'temp_store')
  // and comments, until the statement terminator. SQLite accepts quoted
  // identifiers for PRAGMA names even when the preceding token is 'main'.
  if(token==='PRAGMA')pragmaStatement=true;
  lastToken=token;
  word='';overlong=false;
 };
 for(let i=0;i<sql.length;i++){
  const c=sql[i],next=sql[i+1];
  if(c==='-'&&next==='-'){
   finishWord();i+=2;
   while(i<sql.length&&sql[i]!=='\n')i++;
   continue;
  }
  if(c==='/'&&next==='*'){
   finishWord();
   const end=sql.indexOf('*/',i+2);
   if(end<0)fail();
   i=end+1;continue;
  }
  if(c==="'"||c==='"'||c===String.fromCharCode(96)||c==='['){
   finishWord();
   const endChar=c==='['?']':c;
   // SQLite accepts single-quoted identifiers after PRAGMA/TABLE and
   // before schema-qualified names ('temp'.spill), but VALUES('temp')
   // is ordinary business data. Keep only the token context.
   const before=pragmaStatement||IDENTIFIER_CONTEXT_TOKENS.has(lastToken);
   let identifier='',ended=false;
   for(++i;i<sql.length;i++){
    if(sql[i]===endChar){
     if(sql[i+1]===endChar){identifier+=endChar;i++;continue;}
     ended=true;break;
    }
    identifier+=sql[i];
   }
   if(!ended)fail();
   // Ignore whitespace and SQL comments between a quoted schema and dot.
   // Each lookahead traverses only the gap after this quote, never the
   // complete suffix or an accumulated prefix.
   let j=i+1;
   for(;;){
    while(sqlWhitespace(sql[j]))j++;
    if(sql[j]==='/'&&sql[j+1]==='*'){
     const stop=sql.indexOf('*/',j+2);
     if(stop<0)fail();
     j=stop+2;continue;
    }
    if(sql[j]==='-'&&sql[j+1]==='-'){
     j+=2;while(j<sql.length&&sql[j]!=='\n')j++;
     continue;
    }
    break;
   }
   const isIdentifier=c!=="'"||before||sql[j]==='.';
   const token=identifier.toUpperCase();
   if(isIdentifier&&FORBIDDEN_SQL_TOKENS.has(token))fail();
   lastToken=isIdentifier?token:'';
   continue;
  }
  if(sqlWordChar(c)){
   if(!overlong){
    if(word.length<64)word+=c;
    else {word='';overlong=true;}
   }
  }else{
   finishWord();
   if(c===';')pragmaStatement=false;
   if(!sqlWhitespace(c))lastToken='';
  }
 }
 finishWord();
 return true;
}
