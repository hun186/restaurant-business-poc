param(
 [ValidateSet('preflight','closeout')][string]$Phase='preflight',
 [switch]$SelfTest
)
# Operator UAT gates ONLY: fixed anonymous GETs; no credentials or D1 writes.
# Never enable/disable live gates, and never claim session logout from this probe.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Base='https://restaurant-business-poc.hungyuan-chen.workers.dev'
$MaxBytes=4096
$TimeoutMs=10000
$Utf8=New-Object System.Text.UTF8Encoding($false,$true)
$WriteFlags=@('task_write_enabled','catalog_write_enabled','order_write_enabled',
 'stocktake_write_enabled','repair_write_enabled')
function Deny([string]$stage,[string]$code){
 throw [System.InvalidOperationException]::new("E_OWNER_LOGIN_UAT_GATE|$stage|$code")
}
function Field($obj,[string]$key){
 if($null -eq $obj){return $null}
 $p=$obj.PSObject.Properties[$key]
 if($null -eq $p){return $null}
 return $p.Value
}
function Assert-Status([string]$phase,$obj){
 if($null -eq $obj -or $obj -is [array] -or $obj -is [string]){
  Deny 'STATUS' 'INVALID_SHAPE'
 }
 $mode=Field $obj 'mode'
 $login=Field $obj 'login_enabled'
 if($login -isnot [bool]){Deny 'STATUS' 'INVALID_SHAPE'}
 if($phase -eq 'preflight'){
  if($mode -cne 'native' -or !$login){Deny 'STATUS' 'LOGIN_NOT_READY'}
 }elseif($phase -eq 'closeout'){
  if($mode -cne 'demo' -or $login){Deny 'STATUS' 'LOGIN_NOT_CLOSED'}
 }else{Deny 'CLI' 'INVALID_PHASE'}
 foreach($name in $WriteFlags){
  $val=Field $obj $name
  if($val -isnot [bool] -or $val){Deny 'STATUS' 'BUSINESS_WRITE_NOT_CLOSED'}
 }
}
function Assert-Route([string]$phase,[string]$route,[int]$status,$data){
 if($null -eq $data -or $data -is [array] -or $data -is [string]){
  Deny 'HTTP' 'INVALID_SHAPE'
 }
 if($phase -eq 'preflight'){
  if($route -eq '/api/login'){
   if($status -ne 405 -or (Field $data 'code') -cne 'METHOD_NOT_ALLOWED'){
    Deny 'HTTP' 'ANON_LOGIN_METHOD_NOT_BLOCKED'
   }
  }elseif($route -eq '/api/me'){
   if($status -ne 401 -or (Field $data 'user') -ne $null -or
      (Field $data 'csrf') -ne $null){Deny 'HTTP' 'ANON_IDENTITY_EXPOSED'}
  }else{Deny 'HTTP' 'ROUTE_NOT_ALLOWED'}
 }elseif($phase -eq 'closeout'){
  if($route -ne '/api/login' -and $route -ne '/api/me'){
   Deny 'HTTP' 'ROUTE_NOT_ALLOWED'
  }
  if($status -ne 503 -or (Field $data 'code') -cne 'E_NOT_READY'){
   Deny 'HTTP' 'LOGIN_ROUTE_NOT_CLOSED'
  }
 }else{Deny 'CLI' 'INVALID_PHASE'}
}
function Read-Limited($stream,$cts){
 $buf=New-Object byte[] 1024
 $mem=New-Object System.IO.MemoryStream
 try{
  while($true){
   $n=$stream.ReadAsync($buf,0,$buf.Length,$cts.Token).GetAwaiter().GetResult()
   if($n -le 0){break}
   if($mem.Length+$n -gt $MaxBytes){Deny 'HTTP' 'OVERSIZED_RESPONSE'}
   $mem.Write($buf,0,$n)
  }
  try{return $Utf8.GetString($mem.ToArray())}
  catch{Deny 'HTTP' 'INVALID_UTF8'}
 }finally{$mem.Dispose()}
}
function Get-Fixed($client,[string]$route,[int]$expected){
 $req=$null;$res=$null;$stream=$null;$cts=$null
 try{
  $req=[System.Net.Http.HttpRequestMessage]::new(
   [System.Net.Http.HttpMethod]::Get,$Base+$route)
  $req.Headers.Accept.ParseAdd('application/json')
  [void]$req.Headers.TryAddWithoutValidation('Cache-Control','no-cache')
  $cts=[System.Threading.CancellationTokenSource]::new($TimeoutMs)
  $res=$client.SendAsync($req,
   [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,
   $cts.Token).GetAwaiter().GetResult()
  if([int]$res.StatusCode -ne $expected){Deny 'HTTP' 'HTTP_STATUS'}
  if($null -ne $res.Headers.Location -or
     $res.Headers.Contains('Set-Cookie')){Deny 'HTTP' 'UNEXPECTED_HEADER'}
  if($null -eq $res.Content -or
     $null -eq $res.Content.Headers.ContentType -or
     $res.Content.Headers.ContentType.MediaType -cne 'application/json'){
   Deny 'HTTP' 'CONTENT_TYPE'
  }
  $cache=if($null -ne $res.Headers.CacheControl){
   $res.Headers.CacheControl.ToString()
  }else{''}
  $hasNoStore=$false
  foreach($directive in ($cache -split ',')){
   if($directive.Trim().ToLowerInvariant() -ceq 'no-store'){$hasNoStore=$true}
  }
  if(-not $hasNoStore){Deny 'HTTP' 'CACHE_CONTROL'}
  if($res.Content.Headers.ContentLength -gt $MaxBytes){
   Deny 'HTTP' 'OVERSIZED_RESPONSE'
  }
  $stream=$res.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $text=Read-Limited $stream $cts
  try{$body=ConvertFrom-Json -InputObject $text -ErrorAction Stop}
  catch{Deny 'HTTP' 'INVALID_JSON'}
  return $body
 }catch{
  if($_.Exception.Message -like 'E_OWNER_LOGIN_UAT_GATE|*'){throw}
  Deny 'HTTP' 'REQUEST_UNAVAILABLE'
 }finally{
  if($null -ne $stream){$stream.Dispose()}
  if($null -ne $res){$res.Dispose()}
  if($null -ne $req){$req.Dispose()}
  if($null -ne $cts){$cts.Dispose()}
 }
}
function Test-Synthetic{
 $open='{"mode":"native","login_enabled":true,"task_write_enabled":false,"catalog_write_enabled":false,"order_write_enabled":false,"stocktake_write_enabled":false,"repair_write_enabled":false}'
 $closed='{"mode":"demo","login_enabled":false,"task_write_enabled":false,"catalog_write_enabled":false,"order_write_enabled":false,"stocktake_write_enabled":false,"repair_write_enabled":false}'
 Assert-Status 'preflight' (ConvertFrom-Json $open)
 Assert-Status 'closeout' (ConvertFrom-Json $closed)
 Assert-Route 'preflight' '/api/login' 405 (ConvertFrom-Json '{"code":"METHOD_NOT_ALLOWED"}')
 Assert-Route 'preflight' '/api/me' 401 (ConvertFrom-Json '{"error":"請先登入"}')
 Assert-Route 'closeout' '/api/login' 503 (ConvertFrom-Json '{"code":"E_NOT_READY"}')
 Assert-Route 'closeout' '/api/me' 503 (ConvertFrom-Json '{"code":"E_NOT_READY"}')
 $rejections=0
 foreach($sample in @(
  @{phase='preflight';data=$closed},
  @{phase='closeout';data=$open},
  @{phase='preflight';data=$open.Replace('"task_write_enabled":false','"task_write_enabled":true')},
  @{phase='preflight';data=$open.Replace('"login_enabled":true','"login_enabled":"true"')},
  @{phase='closeout';data='{"mode":"demo","login_enabled":false}'}
 )){
  try{Assert-Status $sample.phase (ConvertFrom-Json $sample.data)}
  catch{if($_.Exception.Message -like 'E_OWNER_LOGIN_UAT_GATE|*'){$rejections++}}
 }
 foreach($entry in @(
  @{phase='preflight';route='/api/me';status=200;body='{"user":{"role":"owner"}}'},
  @{phase='preflight';route='/api/login';status=200;body='{"code":"OK"}'},
  @{phase='closeout';route='/api/me';status=401;body='{"code":"E_UNAUTHENTICATED"}'}
 )){
  try{Assert-Route $entry.phase $entry.route $entry.status (ConvertFrom-Json $entry.body)}
  catch{if($_.Exception.Message -like 'E_OWNER_LOGIN_UAT_GATE|*'){$rejections++}}
 }
 if($rejections -ne 8){Deny 'SELFTEST' 'ASSERTION'}
 Write-Output 'NATIVE_OWNER_LOGIN_UAT_GATE_SELFTEST_PASS'
}
try{
 if($SelfTest){Test-Synthetic;exit 0}
 Add-Type -AssemblyName System.Net.Http
 [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12
 $handler=[System.Net.Http.HttpClientHandler]::new()
 $handler.AllowAutoRedirect=$false
 $handler.UseCookies=$false
 $handler.UseDefaultCredentials=$false
 $handler.PreAuthenticate=$false
 $client=[System.Net.Http.HttpClient]::new($handler)
 $client.Timeout=[TimeSpan]::FromMilliseconds($TimeoutMs)
 try{
  $status=Get-Fixed $client '/api/native/status' 200
  Assert-Status $Phase $status
  if($Phase -eq 'preflight'){
   Assert-Route $Phase '/api/login' 405 (Get-Fixed $client '/api/login' 405)
   Assert-Route $Phase '/api/me' 401 (Get-Fixed $client '/api/me' 401)
  }else{
   Assert-Route $Phase '/api/login' 503 (Get-Fixed $client '/api/login' 503)
   Assert-Route $Phase '/api/me' 503 (Get-Fixed $client '/api/me' 503)
  }
 }finally{$client.Dispose();$handler.Dispose()}
 $result=if($Phase -eq 'preflight'){
  'NATIVE_OWNER_LOGIN_UAT_PREFLIGHT_PASS'
 }else{'NATIVE_OWNER_LOGIN_UAT_CLOSEOUT_PASS'}
 [pscustomobject]@{
  status=$result
  phase=$Phase
  five_business_write_gates_closed=$true
  anonymous_identity_exposure_detected=$false
  request_methods='GET_ONLY'
  cookie_sent=$false
  password_or_token_used=$false
  production_write_performed=$false
  owner_login_logout_uat_verified=$false
  session_revoked_verified=$false
  active_worker_version_verified=$false
  release_authorized=$false
 }|ConvertTo-Json -Compress
}catch{
 $stage='UNKNOWN';$reason='UNKNOWN'
 if($_.Exception.Message -match '^E_OWNER_LOGIN_UAT_GATE\|([A-Z_]+)\|([A-Z_]+)$'){
  if(@('STATUS','HTTP','CLI','SELFTEST') -contains $Matches[1]){$stage=$Matches[1]}
  if(@('INVALID_SHAPE','LOGIN_NOT_READY','LOGIN_NOT_CLOSED','BUSINESS_WRITE_NOT_CLOSED',
    'INVALID_PHASE','ANON_LOGIN_METHOD_NOT_BLOCKED','ANON_IDENTITY_EXPOSED',
    'LOGIN_ROUTE_NOT_CLOSED','ROUTE_NOT_ALLOWED','REQUEST_UNAVAILABLE',
    'HTTP_STATUS','UNEXPECTED_HEADER','CONTENT_TYPE','CACHE_CONTROL',
    'OVERSIZED_RESPONSE','INVALID_UTF8','INVALID_JSON','ASSERTION') -contains $Matches[2]){
    $reason=$Matches[2]
  }
 }
 [Console]::Error.WriteLine("NATIVE_OWNER_LOGIN_UAT_GATE_FAIL phase=$Phase stage=$stage code=$reason")
 exit 1
}
