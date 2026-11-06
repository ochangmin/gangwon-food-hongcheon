$ErrorActionPreference = 'Continue'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Root
$SB = 'supabase@2.121.0'
function Step($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Fail($m) { Write-Host "`n[실패] $m" -ForegroundColor Red; Read-Host '엔터를 누르면 창이 닫힙니다'; exit 1 }
function Need-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker Desktop이 필요합니다. https://www.docker.com/products/docker-desktop 에서 설치한 뒤 다시 실행하세요.' }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop이 꺼져 있습니다. Docker Desktop을 실행하고 고래 아이콘이 Running이 되면 다시 실행하세요.' }
}

$DemoPw = 'eum-local-2026'

Step '필수 프로그램 확인'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js가 필요합니다. https://nodejs.org 에서 LTS(20 이상)를 설치하세요.' }
$nv = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nv -lt 20) { Fail "Node.js 20 이상이 필요합니다. 현재 $(node -v)" }
Need-Docker
Ok "Node $(node -v), Docker 실행 중"

Step '패키지 설치'
if (-not (Test-Path 'node_modules\next')) {
  npm install
  if ($LASTEXITCODE -ne 0) { Fail 'npm install에 실패했습니다. 인터넷 연결을 확인하세요.' }
}
Ok '완료'

Step '로컬 DB·로그인 서버 시작 (처음 한 번은 이미지를 내려받느라 5~10분 걸립니다)'
npx --yes $SB start
if ($LASTEXITCODE -ne 0) { Fail 'Supabase를 시작하지 못했습니다. Docker Desktop 메모리를 4GB 이상으로 두고 다시 실행하세요. 포트 54321~54323이 다른 프로그램에 쓰이고 있지 않은지도 확인하세요.' }

Step '접속 정보 작성 (.env.local)'
$envs = @{}
npx --yes $SB status -o env 2>$null | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="?([^"]*)"?$') { $envs[$matches[1]] = $matches[2] }
}
$url = $envs['API_URL']
$anon = $envs['ANON_KEY']; if (-not $anon) { $anon = $envs['PUBLISHABLE_KEY'] }
$svc = $envs['SERVICE_ROLE_KEY']; if (-not $svc) { $svc = $envs['SECRET_KEY'] }
if (-not $url -or -not $anon -or -not $svc) { Fail 'Supabase 접속 정보를 읽지 못했습니다.' }
$token = ''
if (Test-Path '.env.local') {
  $m = Select-String -Path '.env.local' -Pattern '^UMJI_INGEST_TOKENS=HC:(.+)$'
  if ($m) { $token = $m.Matches[0].Groups[1].Value }
}
if (-not $token) { $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) }
$content = @"
NEXT_PUBLIC_SUPABASE_URL=$url
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon
SUPABASE_SERVICE_ROLE_KEY=$svc
UMJI_INGEST_TOKENS=HC:$token
"@
[IO.File]::WriteAllText((Join-Path $Root '.env.local'), $content, (New-Object Text.UTF8Encoding $false))
Ok $url

if (-not (Test-Path '.local-ready')) {
  Step '데모 계정 만들기 (처음 한 번)'
  $env:NEXT_PUBLIC_SUPABASE_URL = $url
  $env:SUPABASE_SERVICE_ROLE_KEY = $svc
  $env:DEMO_PASSWORD = $DemoPw
  node scripts/create-demo-users.mjs
  if ($LASTEXITCODE -ne 0) { Fail '데모 계정을 만들지 못했습니다.' }
  New-Item -ItemType File '.local-ready' -Force | Out-Null
}

if (-not (Test-Path '.next\BUILD_ID') -or $args -contains '-Rebuild') {
  Step '웹 빌드 (1~2분)'
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail '빌드에 실패했습니다. 위 오류 내용을 알려주세요.' }
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Yellow
Write-Host '  강원 먹거리 이음 · 로컬 실행' -ForegroundColor Yellow
Write-Host '  주소      http://localhost:3000'
Write-Host "  비밀번호  $DemoPw  (모든 데모 계정 공통)"
Write-Host '  도 관리자      province@demo.eum'
Write-Host '  홍천센터       hongcheon@demo.eum'
Write-Host '  춘천센터       chuncheon@demo.eum'
Write-Host '  홍천초 영양교사 s101@demo.eum'
Write-Host '  공급업체       p01@demo.eum'
Write-Host '  DB 관리 화면   http://127.0.0.1:54323'
Write-Host "  umji 수집 토큰 $token"
Write-Host '  끝내려면 이 창에서 Ctrl+C, DB까지 끄려면 stop-local.bat'
Write-Host '=================================================================' -ForegroundColor Yellow
Start-Job { Start-Sleep 4; Start-Process 'http://localhost:3000' } | Out-Null
npm start
