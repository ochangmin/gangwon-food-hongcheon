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

Step '로컬 DB·로그인 서버 중지 (데이터는 보존됩니다)'
Need-Docker
npx --yes $SB stop
Ok '중지했습니다. 다시 쓰려면 start-local.bat'
Read-Host '엔터를 누르면 창이 닫힙니다'
