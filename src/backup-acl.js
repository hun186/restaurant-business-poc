'use strict';
// On Windows, POSIX chmod does not enforce NTFS privacy. Restrict and verify
// dedicated backup directories and their SQLite copies before exposing them.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
function protect(target){
 if(process.platform!=='win32'){
  // SQLite VACUUM INTO creates its .partial with the process umask, which
  // can be 0644. Secure the *existing* backup directory before this write.
  // Use a no-follow file descriptor so chmod cannot follow a swapped symlink.
  const st=fs.lstatSync(target);
  if((!st.isFile()&&!st.isDirectory())||st.isSymbolicLink())
   throw Object.assign(new Error('E_BACKUP: 不安全的備份路徑'),{code:'E_BACKUP'});
  const mode=st.isDirectory()?0o700:0o600;
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(st.isDirectory()?(fs.constants.O_DIRECTORY||0):0);
  const fd=fs.openSync(target,flags);
  try{
   const actual=fs.fstatSync(fd);
   if((st.isDirectory()&&!actual.isDirectory())||(st.isFile()&&!actual.isFile()))
    throw Object.assign(new Error('E_BACKUP: 備份路徑類型已變更'),{code:'E_BACKUP'});
   fs.fchmodSync(fd,mode);
   if((fs.fstatSync(fd).mode&0o777)!==mode)
    throw Object.assign(new Error('E_BACKUP: POSIX 備份權限保護失敗'),{code:'E_BACKUP'});
  }finally{fs.closeSync(fd);}
  return;
 }
 const st=fs.lstatSync(target);
 if((!st.isFile()&&!st.isDirectory())||st.isSymbolicLink())throw new Error('E_BACKUP: 不安全的備份路徑');
 try{
  const who=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=who.match(/S-1-\d+(?:-\d+)+/)?.[0];if(!sid)throw Error('cannot get Windows SID');
  const script=String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:RESTAURANT_ACL_PATH
$sid = $env:RESTAURANT_ACL_SID
$allowed = @($sid,'S-1-5-18','S-1-5-32-544')
$isFolder = [System.IO.Directory]::Exists($target)
$acl = if($isFolder){[System.IO.Directory]::GetAccessControl($target)}else{[System.IO.File]::GetAccessControl($target)}
$acl.SetAccessRuleProtection($true,$false)
foreach($e in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($e)}
$inherit = if($isFolder){[System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'}else{[System.Security.AccessControl.InheritanceFlags]::None}
foreach($who in $allowed){
 $identity=[System.Security.Principal.SecurityIdentifier]::new($who)
 $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($identity,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)
 [void]$acl.AddAccessRule($rule)
}
if($isFolder){[System.IO.Directory]::SetAccessControl($target,$acl)}else{[System.IO.File]::SetAccessControl($target,$acl)}
$verified = if($isFolder){[System.IO.Directory]::GetAccessControl($target)}else{[System.IO.File]::GetAccessControl($target)}
if(-not $verified.AreAccessRulesProtected){throw 'Inherited permissions remain'}
foreach($e in $verified.Access){
 $principal=$e.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
 if($allowed -notcontains $principal -or $e.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow){throw 'Unexpected ACE'}
}
`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,RESTAURANT_ACL_PATH:target,RESTAURANT_ACL_SID:sid},encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']});
 }catch(e){throw Object.assign(new Error('E_BACKUP: Windows NTFS 備份權限保護失敗，已拒絕操作'),{code:'E_BACKUP'});}
}
module.exports={protect};
