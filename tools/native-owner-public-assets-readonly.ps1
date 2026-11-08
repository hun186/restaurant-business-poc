param([switch]$SelfTest)
# Native Owner publicly visible assets only. No secrets, cookies, login or D1 writes.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Base='https://restaurant-business-poc.hungyuan-chen.workers.dev'
$MaxAssetBytes=98304
$MaxStatusBytes=4096
$TimeoutMs=12000
$Utf8=New-Object System.Text.UTF8Encoding($false,$true)
function Block([string]$stage,[string]$code){
 throw [System.InvalidOperationException]::new("E_OWNER_ASSET_CHECK|$stage|$code")
}
function Decode([byte[]]$bytes){
 try{return $Utf8.GetString($bytes)}
 catch{Block 'DECODE' 'INVALID_UTF8'}
}
function Canonical([byte[]]$bytes){
 $value=Decode $bytes
 return ,($Utf8.GetBytes($value.Replace("`r`n","`n")))
}
function Fingerprint([byte[]]$bytes){
 $h=[System.Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($h.ComputeHash((Canonical $bytes))).Replace('-','')}
 finally{$h.Dispose()}
}
function Assert-Status([string]$json){
 try{$data=ConvertFrom-Json -InputObject $json -ErrorAction Stop}
 catch{Block 'STATUS' 'INVALID_JSON'}
 if($null -eq $data -or $data -is [array]){Block 'STATUS' 'INVALID_JSON'}
 if($data.mode -cne 'demo' -or $data.login_enabled -isnot [bool] -or
    $data.login_enabled -ne $false){Block 'STATUS' 'LOGIN_NOT_CLOSED'}
 foreach($name in @('task_write_enabled','catalog_write_enabled',
   'order_write_enabled','stocktake_write_enabled','repair_write_enabled')){
  $p=$data.PSObject.Properties[$name]
  if($null -eq $p -or $p.Value -isnot [bool] -or $p.Value -ne $false){
   Block 'STATUS' 'BUSINESS_GATE_NOT_CLOSED'
  }
 }
}
function Read-Bounded($stream,[int]$max,$cts){
 $buffer=New-Object byte[] 8192
 $memory=New-Object System.IO.MemoryStream
 try{
  while($true){
   $n=$stream.ReadAsync($buffer,0,$buffer.Length,$cts.Token).GetAwaiter().GetResult()
   if($n -le 0){break}
   if($memory.Length+$n -gt $max){Block 'HTTP' 'OVERSIZED_RESPONSE'}
   $memory.Write($buffer,0,$n)
  }
  return ,$memory.ToArray()
 }finally{$memory.Dispose()}
}
function Get-Only($client,[string]$route,[string]$mime,[int]$limit){
 $stage=if($route -eq '/api/native/status'){'STATUS'}else{'ASSET'}
 $request=$null;$response=$null;$stream=$null;$cts=$null
 try{
  $request=[System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get,$Base+$route)
  $request.Headers.Accept.ParseAdd($mime)
  [void]$request.Headers.TryAddWithoutValidation('Cache-Control','no-cache')
  $cts=[System.Threading.CancellationTokenSource]::new($TimeoutMs)
  $response=$client.SendAsync($request,
   [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cts.Token).GetAwaiter().GetResult()
  if([int]$response.StatusCode -ne 200){Block $stage 'HTTP_STATUS'}
  if($null -eq $response.Content){Block $stage 'MISSING_BODY'}
  $type=$response.Content.Headers.ContentType
  if($null -eq $type){Block $stage 'CONTENT_TYPE'}
  $actual=$type.MediaType
  if($mime -eq 'application/json'){
   if($actual -cne 'application/json'){Block $stage 'CONTENT_TYPE'}
  }elseif($mime -eq 'text/html'){
   if($actual -cne 'text/html'){Block $stage 'CONTENT_TYPE'}
  }elseif($mime -eq 'text/css'){
   if($actual -cne 'text/css'){Block $stage 'CONTENT_TYPE'}
  }elseif($actual -cne 'text/javascript' -and $actual -cne 'application/javascript'){
   Block $stage 'CONTENT_TYPE'
  }
  if($response.Content.Headers.ContentLength -gt $limit){Block $stage 'OVERSIZED_RESPONSE'}
  $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  return ,(Read-Bounded $stream $limit $cts)
 }catch{
  if($_.Exception.Message -like 'E_OWNER_ASSET_CHECK|*'){throw}
  Block $stage 'REQUEST_UNAVAILABLE'
 }finally{
  if($null -ne $stream){$stream.Dispose()}
  if($null -ne $response){$response.Dispose()}
  if($null -ne $request){$request.Dispose()}
  if($null -ne $cts){$cts.Dispose()}
 }
}
function Check-Asset([string]$relative,[byte[]]$remote){
 $full=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('..\'+$relative)))
 if(![IO.File]::Exists($full)){Block 'LOCAL' 'CHECKOUT_MISSING'}
 try{$local=[IO.File]::ReadAllBytes($full)}
 catch{Block 'LOCAL' 'CHECKOUT_UNREADABLE'}
 if($local.Length -gt $MaxAssetBytes){Block 'LOCAL' 'CHECKOUT_OVERSIZED'}
 if((Fingerprint $local) -cne (Fingerprint $remote)){Block 'ASSET' 'CONTENT_MISMATCH'}
}
function Run-SelfTest {
 Assert-Status '{"mode":"demo","login_enabled":false,"task_write_enabled":false,"catalog_write_enabled":false,"order_write_enabled":false,"stocktake_write_enabled":false,"repair_write_enabled":false}'
 $rejections=0
 foreach($s in @(
  '{"mode":"native","login_enabled":true,"task_write_enabled":false,"catalog_write_enabled":false,"order_write_enabled":false,"stocktake_write_enabled":false,"repair_write_enabled":false}',
  '{"mode":"demo","login_enabled":false,"task_write_enabled":true,"catalog_write_enabled":false,"order_write_enabled":false,"stocktake_write_enabled":false,"repair_write_enabled":false}',
  '{"mode":"demo","login_enabled":false}',
  '{not-json'
 )){
  try{Assert-Status $s}catch{if($_.Exception.Message -like 'E_OWNER_ASSET_CHECK|*'){$rejections++}}
 }
 if($rejections -ne 4){Block 'SELFTEST' 'ASSERTION'}
 $a=$Utf8.GetBytes("A`r`nB")
 $b=$Utf8.GetBytes("A`nB")
 if((Fingerprint $a) -cne (Fingerprint $b)){Block 'SELFTEST' 'ASSERTION'}
 if((Fingerprint $a) -ceq (Fingerprint ($Utf8.GetBytes('DIFFERENT')))){
  Block 'SELFTEST' 'ASSERTION'
 }
 Write-Output 'NATIVE_OWNER_PUBLIC_ASSET_SELFTEST_PASS'
}
try{
 if($SelfTest){Run-SelfTest;exit 0}
 Add-Type -AssemblyName System.Net.Http
 [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12
 $handler=[System.Net.Http.HttpClientHandler]::new()
 $handler.AllowAutoRedirect=$false
 $handler.UseCookies=$false
 $handler.UseDefaultCredentials=$false
 $handler.PreAuthenticate=$false
 $handler.AutomaticDecompression=[System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
 $client=[System.Net.Http.HttpClient]::new($handler)
 $client.Timeout=[TimeSpan]::FromMilliseconds($TimeoutMs)
 try{
  Assert-Status (Decode (Get-Only $client '/api/native/status' 'application/json' $MaxStatusBytes))
  # Default Cloudflare html_handling redirects /owner-app.html to /owner-app.
  # Check canonical 200 route directly; never follow redirects.
  $assets=@(
   @{route='/owner-app';file='vercel-demo/owner-app.html';mime='text/html'},
   @{route='/owner-app.css';file='vercel-demo/owner-app.css';mime='text/css'},
   @{route='/owner-app.js';file='vercel-demo/owner-app.js';mime='text/javascript'},
   @{route='/native-owner-display.mjs';file='vercel-demo/native-owner-display.mjs';mime='text/javascript'}
  )
  foreach($asset in $assets){
   $bytes=Get-Only $client $asset.route $asset.mime $MaxAssetBytes
   Check-Asset $asset.file $bytes
  }
 }finally{$client.Dispose();$handler.Dispose()}
 [pscustomobject]@{
  status='NATIVE_OWNER_PUBLIC_ASSETS_READONLY_PASS'
  asset_count=4
  assets_match_current_checkout=$true
  login_gate_closed=$true
  five_business_write_gates_closed=$true
  request_methods='GET_ONLY'
  token_used=$false
  production_write_performed=$false
  active_worker_version_verified=$false
  owner_login_logout_uat_verified=$false
 }|ConvertTo-Json -Compress
}catch{
 $stage='UNKNOWN';$code='UNKNOWN'
 if($_.Exception.Message -match '^E_OWNER_ASSET_CHECK\|([A-Z_]+)\|([A-Z_]+)$'){
  $stages=@('STATUS','ASSET','HTTP','LOCAL','DECODE','SELFTEST')
  $codes=@('INVALID_JSON','LOGIN_NOT_CLOSED','BUSINESS_GATE_NOT_CLOSED',
    'HTTP_STATUS','MISSING_BODY','CONTENT_TYPE','OVERSIZED_RESPONSE',
    'REQUEST_UNAVAILABLE','CHECKOUT_MISSING','CHECKOUT_UNREADABLE',
    'CHECKOUT_OVERSIZED','CONTENT_MISMATCH','INVALID_UTF8','ASSERTION')
  if($stages -contains $Matches[1]){$stage=$Matches[1]}
  if($codes -contains $Matches[2]){$code=$Matches[2]}
 }
 [Console]::Error.WriteLine("NATIVE_OWNER_PUBLIC_ASSETS_READONLY_FAIL stage=$stage code=$code")
 exit 1
}
