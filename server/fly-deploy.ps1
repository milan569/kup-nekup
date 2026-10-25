# Nasadí server Kup / Nekup na Fly.io. Lze spouštět opakovaně (co existuje, přeskočí).
# Spouštějte ze složky server:  .\fly-deploy.ps1
# Tajné hodnoty (Claude klíč ze server/.env, přístupový klíč ze server/.env.fly) se nikde nevypisují.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Read-EnvValue([string]$file, [string]$name) {
  $line = Get-Content $file | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -Last 1
  if (-not $line) { throw "V souboru $file chybí $name" }
  return ($line -replace "^\s*$name\s*=\s*", "").Trim().Trim('"').Trim("'")
}

if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
  throw "Nástroj fly není nainstalovaný nebo terminál nezná jeho cestu. Otevřete nový terminál po instalaci."
}

$app   = Read-EnvValue ".env.fly" "FLY_APP"
$token = Read-EnvValue ".env.fly" "APP_TOKEN"
$key   = Read-EnvValue ".env" "ANTHROPIC_API_KEY"
if (-not $key.StartsWith("sk-ant-")) { throw "ANTHROPIC_API_KEY v server/.env nevypadá jako klíč z Claude Console." }

Write-Host "1/5 Aplikace $app"
fly status --app $app *> $null
if ($LASTEXITCODE -ne 0) {
  fly apps create $app --org personal
  if ($LASTEXITCODE -ne 0) { throw "Aplikaci se nepodařilo vytvořit (je fly přihlášený? je ve Fly.io zadaná platební karta?)" }
} else { Write-Host "    už existuje" }

Write-Host "2/5 Disk pro cache"
$vols = fly volumes list --app $app --json | ConvertFrom-Json
if (-not ($vols | Where-Object { $_.name -eq "kupnekup_cache" })) {
  fly volumes create kupnekup_cache --region fra --size 1 --app $app --yes
  if ($LASTEXITCODE -ne 0) { throw "Disk se nepodařilo vytvořit." }
} else { Write-Host "    už existuje" }

Write-Host "3/5 Tajné hodnoty (nevypisují se)"
"ANTHROPIC_API_KEY=$key`nAPP_TOKEN=$token" | fly secrets import --app $app --stage
if ($LASTEXITCODE -ne 0) { throw "Tajné hodnoty se nepodařilo uložit." }

Write-Host "4/5 Sestavení a nasazení (sestavuje se na serverech Fly.io, trvá několik minut)"
fly deploy --app $app --remote-only --ha=false
if ($LASTEXITCODE -ne 0) { throw "Nasazení selhalo – výpis výše ukáže proč." }

Write-Host "5/5 Kontrola"
$health = Invoke-RestMethod "https://$app.fly.dev/api/health"
Write-Host ("    server běží: https://{0}.fly.dev  | Claude klíč: {1} | aditiv: {2}" -f $app, $health.hasKey, $health.additives)
Write-Host "Hotovo. Do aplikace zadejte adresu https://$app.fly.dev a přístupový klíč ze server/.env.fly."
