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

Step '로컬 데이터 초기화'
Write-Host '   입력한 주문·입고·출고 데이터와 계정이 모두 지워지고 예시 데이터로 돌아갑니다.' -ForegroundColor Yellow
$a = Read-Host '   계속하려면 RESET 을 입력하세요'
if ($a -ne 'RESET') { Write-Host '   취소했습니다.'; Read-Host '엔터를 누르면 창이 닫힙니다'; exit 0 }
Need-Docker
npx --yes $SB db reset
if ($LASTEXITCODE -ne 0) { Fail '초기화에 실패했습니다. start-local.bat로 먼저 서버를 켠 뒤 다시 실행하세요.' }
Remove-Item '.local-ready' -ErrorAction SilentlyContinue
Ok '초기화했습니다. start-local.bat를 실행하면 데모 계정이 다시 만들어집니다.'
Read-Host '엔터를 누르면 창이 닫힙니다'
