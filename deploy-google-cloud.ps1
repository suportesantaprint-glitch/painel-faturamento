param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Zone = "us-east1-b",
  [string]$InstanceName = "controle-faturamento-vm",
  [string]$MachineType = "e2-micro"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "controle-faturamento"
$artifactPath = Join-Path $projectRoot "$appName-deploy.tgz"
$provisionScriptPath = Join-Path $projectRoot "infra\\google-cloud\\provision-vm.sh"
$firewallRuleName = "$appName-allow-http"
$networkTag = "$appName-http"
$alwaysFreeRegions = @("us-east1", "us-central1", "us-west1")
$zoneRegion = $Zone.Substring(0, $Zone.LastIndexOf("-"))

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: gcloud $($Arguments -join ' ')"
  }
}

if ($zoneRegion -notin $alwaysFreeRegions) {
  Write-Warning "A zona $Zone nao pertence a uma regiao Always Free do Compute Engine. Para ficar no free, prefira us-east1, us-central1 ou us-west1."
}

if (-not (Test-Path $provisionScriptPath)) {
  throw "Arquivo nao encontrado: $provisionScriptPath"
}

Write-Host "Configurando projeto $ProjectId..."
Invoke-Gcloud -Arguments @("config", "set", "project", $ProjectId)

$instanceExists = $false
try {
  & gcloud compute instances describe $InstanceName --zone $Zone --format="value(name)" 2>$null | Out-Null
  $instanceExists = $true
} catch {
  $instanceExists = $false
}

if (-not $instanceExists) {
  Write-Host "Criando VM $InstanceName em $Zone..."
  Invoke-Gcloud -Arguments @(
    "compute", "instances", "create", $InstanceName,
    "--zone", $Zone,
    "--machine-type", $MachineType,
    "--image-family", "debian-12",
    "--image-project", "debian-cloud",
    "--boot-disk-type", "pd-standard",
    "--boot-disk-size", "20GB",
    "--tags", $networkTag,
    "--quiet"
  )
} else {
  Write-Host "VM $InstanceName ja existe. Vou reutilizar."
}

$firewallExists = $false
try {
  & gcloud compute firewall-rules describe $firewallRuleName --format="value(name)" 2>$null | Out-Null
  $firewallExists = $true
} catch {
  $firewallExists = $false
}

if (-not $firewallExists) {
  Write-Host "Criando regra de firewall HTTP..."
  Invoke-Gcloud -Arguments @(
    "compute", "firewall-rules", "create", $firewallRuleName,
    "--allow", "tcp:80",
    "--target-tags", $networkTag,
    "--description", "Permite acesso HTTP ao Controle de Faturamento",
    "--quiet"
  )
}

if (Test-Path $artifactPath) {
  Remove-Item $artifactPath -Force
}

Write-Host "Empacotando aplicacao..."
Push-Location $projectRoot
try {
  & tar `
    --exclude="./node_modules" `
    --exclude="./build" `
    --exclude="./data" `
    --exclude="./.git" `
    --exclude="./*.pem" `
    --exclude="./*.tgz" `
    --exclude="./.env*" `
    -czf $artifactPath .
} finally {
  Pop-Location
}

Write-Host "Enviando arquivos para a VM..."
Invoke-Gcloud -Arguments @("compute", "scp", $artifactPath, "${InstanceName}:~/app.tgz", "--zone", $Zone, "--quiet")
Invoke-Gcloud -Arguments @("compute", "scp", $provisionScriptPath, "${InstanceName}:~/provision-vm.sh", "--zone", $Zone, "--quiet")

Write-Host "Provisionando a VM e publicando a aplicacao..."
Invoke-Gcloud -Arguments @(
  "compute", "ssh", $InstanceName,
  "--zone", $Zone,
  "--command", "chmod +x ~/provision-vm.sh && bash ~/provision-vm.sh ~/app.tgz",
  "--quiet"
)

$publicIp = (& gcloud compute instances describe $InstanceName --zone $Zone --format="get(networkInterfaces[0].accessConfigs[0].natIP)").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($publicIp)) {
  throw "Nao foi possivel obter o IP publico da VM."
}

Write-Host ""
Write-Host "Deploy concluido."
Write-Host "URL: http://$publicIp"
Write-Host "Logs: gcloud compute ssh $InstanceName --zone $Zone --command ""sudo journalctl -u controle-faturamento -n 100 --no-pager"""
