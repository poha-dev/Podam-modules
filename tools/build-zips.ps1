# 포담 공식 모듈 zip 만들기
#
#   powershell -ExecutionPolicy Bypass -File tools\build-zips.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-zips.ps1 -Version 0.2.0
#
# 모듈마다 하나씩, 그리고 넷을 한꺼번에 담은 것 하나를 만든다.
# 받은 사람은 <데이터폴더>/modules 에 풀기만 하면 된다 — 압축 안에 폴더 이름이 그대로 들어 있다.

param(
  [string]$Version = '0.1.0'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dist = Join-Path $root 'dist'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $dist | Out-Null

$mods = Get-ChildItem (Join-Path $root 'modules') -Directory |
        Where-Object { $_.Name -ne 'node_modules' -and (Test-Path (Join-Path $_.FullName 'index.js')) }

if (-not $mods) { throw 'modules 폴더에 모듈이 없습니다' }

Write-Host "포담 공식 모듈 $Version" -ForegroundColor Cyan

# ── 모듈 하나씩 ──────────────────────────────────────────────────────────────
foreach ($m in $mods) {
  $zip = Join-Path $dist "$($m.Name)-$Version.zip"
  Compress-Archive $m.FullName $zip -Force
  $kb = [math]::Round((Get-Item $zip).Length / 1KB)
  Write-Host ("  {0,-14} {1,6} KB" -f $m.Name, $kb)
}

# ── 넷을 한꺼번에 ────────────────────────────────────────────────────────────
$all = Join-Path $dist "포담-공식모듈-$Version.zip"
Compress-Archive ($mods.FullName) $all -Force
$kb = [math]::Round((Get-Item $all).Length / 1KB)
Write-Host ("  {0,-14} {1,6} KB" -f '(전부)', $kb)

Write-Host ""
Write-Host "  됐습니다 — dist\" -ForegroundColor Green
