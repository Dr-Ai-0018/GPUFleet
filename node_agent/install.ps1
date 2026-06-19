param(
  [string]$Url = "",
  [string]$Token = "",
  [string]$NodeId = "",
  [string]$WheelUrl = "",
  [string]$InstallDir = "$env:ProgramFiles\GPUFleetAgent",
  [switch]$DryRun,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ServiceName = "GPUFleetAgent"
$ConfigDir = Join-Path $env:APPDATA "GPUFleet"
$ConfigToml = Join-Path $ConfigDir "config.toml"
$ConfigEnv = Join-Path $ConfigDir "agent.env"
$RunScript = Join-Path $InstallDir "run-agent.ps1"
$Venv = Join-Path $InstallDir ".venv"

function Invoke-Step {
  param([scriptblock]$Script, [string]$Label)
  if ($DryRun) {
    Write-Host "[dry-run] $Label"
  } else {
    & $Script
  }
}

if ($Uninstall) {
  Invoke-Step { sc.exe stop $ServiceName | Out-Null } "Stop service $ServiceName"
  Invoke-Step { sc.exe delete $ServiceName | Out-Null } "Delete service $ServiceName"
  Invoke-Step { Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue } "Remove $InstallDir"
  Invoke-Step { Remove-Item -LiteralPath $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue } "Remove $ConfigDir"
  exit 0
}

if (-not $Url) {
  $Url = Read-Host "Control plane URL"
}
if (-not $NodeId) {
  $NodeId = Read-Host "Node id"
}
if (-not $Token) {
  $secure = Read-Host "Node token / secret" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if (-not $Url -or -not $NodeId -or -not $Token) {
  throw "Url, NodeId and Token are required."
}

Invoke-Step { New-Item -ItemType Directory -Force -Path $InstallDir, $ConfigDir | Out-Null } "Create install/config directories"
Invoke-Step { py -3 -m venv $Venv } "Create Python venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$AgentExe = Join-Path $Venv "Scripts\gpufleet-agent.exe"

Invoke-Step { & $Python -m pip install --upgrade pip } "Upgrade pip"
if ($WheelUrl) {
  Invoke-Step { & $Python -m pip install $WheelUrl } "Install agent from $WheelUrl"
} else {
  Invoke-Step { & $Python -m pip install $PSScriptRoot } "Install agent from local source"
}

$ConfigTomlContent = @"
[agent]
control_plane_url = "$Url"
node_id = "$NodeId"
heartbeat_interval_sec = 5
deployment_mode = "windows_server"
agent_root = "$($InstallDir -replace '\\','/')"
"@

$ConfigEnvContent = @"
GPUFLEET_AGENT_CONTROL_PLANE_URL=$Url
GPUFLEET_AGENT_NODE_ID=$NodeId
GPUFLEET_AGENT_NODE_SECRET=$Token
GPUFLEET_AGENT_NODE_SECRET_ENCRYPTED_PATH=$($ConfigDir -replace '\\','/')/node_secret.enc
GPUFLEET_AGENT_HEARTBEAT_INTERVAL_SEC=5
GPUFLEET_AGENT_DEPLOYMENT_MODE=windows_server
GPUFLEET_AGENT_AGENT_ROOT=$($InstallDir -replace '\\','/')
GPUFLEET_AGENT_REPOS_DIR=$($InstallDir -replace '\\','/')/repos
GPUFLEET_AGENT_RUNS_DIR=$($InstallDir -replace '\\','/')/runs
GPUFLEET_AGENT_ARTIFACTS_DIR=$($InstallDir -replace '\\','/')/artifacts
GPUFLEET_AGENT_LOGS_DIR=$($InstallDir -replace '\\','/')/logs
GPUFLEET_AGENT_STATE_DIR=$($InstallDir -replace '\\','/')/state
GPUFLEET_AGENT_MODAL_PROFILES_DIR=$($InstallDir -replace '\\','/')/modal_profiles
"@

$RunScriptContent = @"
`$ErrorActionPreference = "Stop"
Get-Content -LiteralPath "$ConfigEnv" | Where-Object { `$_ -and -not `$_.StartsWith("#") } | ForEach-Object {
  `$idx = `$_.IndexOf("=")
  if (`$idx -gt 0) {
    `$name = `$_.Substring(0, `$idx)
    `$value = `$_.Substring(`$idx + 1)
    [Environment]::SetEnvironmentVariable(`$name, `$value, "Process")
  }
}
Set-Location -LiteralPath "$InstallDir"
& "$AgentExe" heartbeat-loop
"@

Invoke-Step { Set-Content -LiteralPath $ConfigToml -Value $ConfigTomlContent -Encoding UTF8 } "Write $ConfigToml"
Invoke-Step { Set-Content -LiteralPath $ConfigEnv -Value $ConfigEnvContent -Encoding UTF8 } "Write $ConfigEnv"
Invoke-Step { Set-Content -LiteralPath $RunScript -Value $RunScriptContent -Encoding UTF8 } "Write $RunScript"

$PwshCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if ($PwshCommand) {
  $PowerShellExe = $PwshCommand.Source
} else {
  $PowerShellExe = (Get-Command powershell.exe).Source
}
$BinPath = "`"$PowerShellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""

Invoke-Step { sc.exe stop $ServiceName | Out-Null } "Stop existing $ServiceName if present"
Invoke-Step { sc.exe delete $ServiceName | Out-Null } "Delete existing $ServiceName if present"
Invoke-Step { sc.exe create $ServiceName binPath= $BinPath start= auto DisplayName= "GPUFleet Node Agent" | Out-Null } "Create Windows service $ServiceName"
Invoke-Step { sc.exe start $ServiceName | Out-Null } "Start Windows service $ServiceName"

Write-Host "GPUFleet agent installed. Check status with: sc.exe query $ServiceName"
