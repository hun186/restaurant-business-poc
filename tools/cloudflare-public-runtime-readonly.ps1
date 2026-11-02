# Public Worker G0 smoke for Windows PowerShell 5.1+. Read-only GET/HEAD.
# Fixed URL, no token/cookie/password, Cloudflare admin API, SQL or deployment.
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WorkerUrl='https://restaurant-business-poc.hungyuan-chen.workers.dev'
$MaxBodyBytes=8192
$DeadlineMs=8000
function Fail([string]$stage,[string]$detail) {
 throw [System.InvalidOperationException]::new("E_PUBLIC_WORKER_READONLY|$stage|$detail")
}
function Field($object,[string]$name) {
 if($null -eq $object){return $null}
 $p=$object.PSObject.Properties[$name]
 if($null -eq $p){return $null}
 return $p.Value
}
function Validate-Reply([string]$route,[string]$method,[int]$status,
 [string]$mime,[string]$cache,[string]$body) {
 $stage=if($route -eq '/'){'ASSETS'}else{$route.TrimStart('/').Replace('/','_').ToUpperInvariant()}
 if($method -eq 'HEAD'){$stage+='_HEAD'}
 if($status -ge 300 -and $status -lt 400){Fail $stage 'REDIRECT_BLOCKED'}
 $expected=if($route -eq '/api/health' -or $route -eq '/'){200}else{503}
 if($status -ne $expected){Fail $stage 'HTTP_STATUS'}
 if($method -eq 'HEAD'){return}
 $expectedMime=if($route -eq '/'){'text/html'}else{'application/json'}
 if($null -eq $mime -or !$mime.StartsWith($expectedMime,[StringComparison]::OrdinalIgnoreCase)){
  Fail $stage 'MIME'
 }
 if($route -eq '/'){
  if(!$body.Contains('公開示範版') -or !$body.Contains('虛構資料')){
   Fail $stage 'DEMO_ASSETS_MISSING'
  }
  return
 }
 try{$obj=ConvertFrom-Json -InputObject $body -ErrorAction Stop}
 catch{Fail $stage 'JSON_INVALID'}
 if($null -eq $obj -or $obj -is [array] -or $obj -is [string]){Fail $stage 'JSON_SHAPE'}
 if($route -eq '/api/health'){
  if($null -eq $cache -or !$cache.Contains('no-store')){Fail $stage 'CACHE_CONTROL'}
  if((Field $obj 'status') -cne 'demo_only' -or
     (Field $obj 'api') -cne 'not_implemented' -or
     (Field $obj 'production_ready') -isnot [bool] -or
     (Field $obj 'production_ready') -ne $false){Fail $stage 'PROD_GUARD'}
  if((Field $obj 'database') -cne 'schema_only'){Fail $stage 'SCHEMA_NOT_READY'}
 }elseif((Field $obj 'code') -cne 'E_NOT_READY'){Fail $stage 'ROUTE_NOT_CLOSED'}
}
function Read-Bounded($stream,$cts) {
 $buf=New-Object byte[] ($MaxBodyBytes+1)
 $count=0
 while($count -lt $buf.Length){
  $n=$stream.ReadAsync($buf,$count,$buf.Length-$count,$cts.Token).GetAwaiter().GetResult()
  if($n -le 0){break}
  $count+=$n
 }
 if($count -gt $MaxBodyBytes){Fail 'HTTP' 'BODY_LIMIT_OR_INVALID'}
 $encoding=New-Object System.Text.UTF8Encoding($false,$true)
 try{return $encoding.GetString($buf,0,$count)}
 catch{Fail 'HTTP' 'BODY_LIMIT_OR_INVALID'}
}
function Invoke-FixedRequest($client,[string]$route,[string]$method) {
 $stage=if($route -eq '/'){'ASSETS'}else{$route.TrimStart('/').Replace('/','_').ToUpperInvariant()}
 if($method -eq 'HEAD'){$stage+='_HEAD'}
 $req=$null;$response=$null;$stream=$null;$cts=$null
 try{
  $verb=if($method -eq 'HEAD'){[System.Net.Http.HttpMethod]::Head}else{[System.Net.Http.HttpMethod]::Get}
  $req=[System.Net.Http.HttpRequestMessage]::new($verb,($WorkerUrl+$route))
  $req.Headers.Accept.ParseAdd($(if($route -eq '/'){'text/html'}else{'application/json'}))
  $cts=[System.Threading.CancellationTokenSource]::new($DeadlineMs)
  $response=$client.SendAsync($req,
   [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cts.Token).GetAwaiter().GetResult()
  $status=[int]$response.StatusCode
  if($status -ge 300 -and $status -lt 400){Fail $stage 'REDIRECT_BLOCKED'}
  $mime=if($null -ne $response.Content -and $null -ne $response.Content.Headers.ContentType){
    $response.Content.Headers.ContentType.MediaType
   }else{''}
  $cache=if($null -ne $response.Headers.CacheControl){
    $response.Headers.CacheControl.ToString()
   }else{''}
  $body=''
  if($method -ne 'HEAD'){
   if($null -eq $response.Content){Fail $stage 'BODY_LIMIT_OR_INVALID'}
   if($response.Content.Headers.ContentLength -gt $MaxBodyBytes){
    Fail $stage 'BODY_LIMIT_OR_INVALID'
   }
   $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
   $body=Read-Bounded $stream $cts
  }
  Validate-Reply $route $method $status $mime $cache $body
 }catch{
  $message=$_.Exception.Message
  if($message -like 'E_PUBLIC_WORKER_READONLY|*'){throw}
  Fail $stage 'REQUEST_UNAVAILABLE'
 }finally{
  if($null -ne $stream){$stream.Dispose()}
  if($null -ne $response){$response.Dispose()}
  if($null -ne $req){$req.Dispose()}
  if($null -ne $cts){$cts.Dispose()}
 }
}
function Run-SyntheticSelfTest {
 $healthy='{"status":"demo_only","api":"not_implemented","database":"schema_only","production_ready":false}'
 Validate-Reply '/api/health' 'GET' 200 'application/json' 'no-store' $healthy
 Validate-Reply '/api/health' 'HEAD' 200 '' '' ''
 foreach($route in @('/api/command','/api/login','/api/data','/api/me')){
  Validate-Reply $route 'GET' 503 'application/json' '' '{"code":"E_NOT_READY"}'
 }
 Validate-Reply '/' 'GET' 200 'text/html' '' '<p>公開示範版 · 全部為虛構資料</p>'
 $failures=0
 foreach($case in @(
  @{path='/api/health';status=200;mime='application/json';cache='no-store';
   body='{"status":"demo_only","api":"not_implemented","database":"schema_only","production_ready":true}'},
  @{path='/api/command';status=200;mime='application/json';cache='';
   body='{"code":"E_NOT_READY"}'},
  @{path='/api/health';status=302;mime='application/json';cache='no-store';
   body=$healthy},
  @{path='/';status=200;mime='text/html';cache='';body='<html>other</html>'}
 )){
  try{Validate-Reply $case.path 'GET' $case.status $case.mime $case.cache $case.body}
  catch{if($_.Exception.Message -like 'E_PUBLIC_WORKER_READONLY|*'){$failures++}}
 }
 if($failures -ne 4){Fail 'SELFTEST' 'ASSERTION'}
 Write-Output 'PUBLIC_WORKER_POWERSHELL_SELFTEST_PASS'
}
try{
 if($SelfTest){Run-SyntheticSelfTest;exit 0}
 Add-Type -AssemblyName System.Net.Http
 $handler=[System.Net.Http.HttpClientHandler]::new()
 $handler.AllowAutoRedirect=$false
 $handler.UseCookies=$false
 $handler.UseDefaultCredentials=$false
 $handler.PreAuthenticate=$false
 $client=[System.Net.Http.HttpClient]::new($handler)
 $client.Timeout=[TimeSpan]::FromMilliseconds($DeadlineMs)
 try{
  Invoke-FixedRequest $client '/api/health' 'GET'
  Invoke-FixedRequest $client '/api/health' 'HEAD'
  foreach($route in @('/api/command','/api/login','/api/data','/api/me')){
   Invoke-FixedRequest $client $route 'GET'
  }
  Invoke-FixedRequest $client '/' 'GET'
 }finally{$client.Dispose();$handler.Dispose()}
 [pscustomobject]@{status='PUBLIC_WORKER_READONLY_HTTP_PASS';
  demo_http_verified=$true;production_ready=$false;
  d1_schema_contract_visible=$true;mutation_routes_fail_closed=$true;
  request_methods='GET_AND_HEAD_ONLY';token_used=$false;
  production_write_performed=$false;active_worker_version_verified=$false;
  deployed_commit_verified=$false;access_policy_verified=$false;
  staging_login_verified=$false;recovery_signoff_granted=$false
 }|ConvertTo-Json -Compress
}catch{
 $message=$_.Exception.Message
 $stage='UNKNOWN';$detail='UNKNOWN'
 if($message -match '^E_PUBLIC_WORKER_READONLY\|([A-Z_]+)\|([A-Z_]+)$'){
  $allowedStages=@('CONFIG','CLI','ASSETS','API_HEALTH','API_HEALTH_HEAD',
   'API_COMMAND','API_LOGIN','API_DATA','API_ME','HTTP','SELFTEST')
  $allowedDetails=@('REQUEST_UNAVAILABLE','RESPONSE_INVALID','REDIRECT_BLOCKED',
   'HTTP_STATUS','MIME','BODY_LIMIT_OR_INVALID','DEMO_ASSETS_MISSING',
   'JSON_INVALID','JSON_SHAPE','CACHE_CONTROL','PROD_GUARD',
   'SCHEMA_NOT_READY','ROUTE_NOT_CLOSED','ASSERTION')
  if($allowedStages -contains $Matches[1]){$stage=$Matches[1]}
  if($allowedDetails -contains $Matches[2]){$detail=$Matches[2]}
 }
 [Console]::Error.WriteLine("PUBLIC_WORKER_READONLY_FAIL stage=$stage detail=$detail")
 exit 1
}
