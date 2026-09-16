<#
.SYNOPSIS
    Start Nexent backend services locally (Windows, no Docker).

.DESCRIPTION
    Launches one or more backend services in separate PowerShell windows, using the
    interpreter from backend\.venv directly. Calling the venv interpreter by path
    avoids the PowerShell execution policy restriction that blocks Activate.ps1.

    Each service loads configuration from the repository root .env file.

.PARAMETER Service
    Which service(s) to start. Defaults to all services.
    Valid values: all, config, data-process, northbound, runtime, mcp

.EXAMPLE
    .\scripts\start_backend_services.ps1
    Starts all five backend services.

.EXAMPLE
    .\scripts\start_backend_services.ps1 -Service config,runtime
    Starts only config_service and runtime_service.
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'config', 'data-process', 'northbound', 'runtime', 'mcp')]
    [string[]]$Service = @('all')
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $RepoRoot 'backend\.venv\Scripts\python.exe'

if (-not (Test-Path $Python)) {
    Write-Error @"
Backend virtual environment not found at:
    $Python

Create it first:
    cd backend
    uv sync --extra data-process --extra test
    uv pip install -e "../sdk[dev]"
"@
    exit 1
}

$EnvFile = Join-Path $RepoRoot '.env'
if (-not (Test-Path $EnvFile)) {
    Write-Warning "Repository root .env not found. Services may fail to start. Generate it with: bash deploy.sh docker --components infrastructure --port-policy development"
}

# Service name -> relative script path and listening port.
$AllServices = [ordered]@{
    'config'       = @{ Script = 'backend\config_service.py';       Port = 5010 }
    'data-process' = @{ Script = 'backend\data_process_service.py'; Port = 5012 }
    'northbound'   = @{ Script = 'backend\northbound_service.py';   Port = 5013 }
    'runtime'      = @{ Script = 'backend\runtime_service.py';      Port = 5014 }
    'mcp'          = @{ Script = 'backend\mcp_service.py';          Port = 5015 }
}

if ($Service -contains 'all') {
    $selected = $AllServices.Keys
} else {
    $selected = $Service
}

foreach ($name in $selected) {
    $svc = $AllServices[$name]
    $scriptPath = Join-Path $RepoRoot $svc.Script

    if (-not (Test-Path $scriptPath)) {
        Write-Warning "Skipping '$name': script not found at $scriptPath"
        continue
    }

    Write-Host ("Starting {0,-13} (port {1}) ..." -f $name, $svc.Port)
    Start-Process -FilePath $Python `
        -ArgumentList "`"$scriptPath`"" `
        -WorkingDirectory $RepoRoot
}

Write-Host ''
Write-Host "Launched $($selected.Count) service(s). Ports: 5010 5012 5013 5014 5015"
Write-Host 'Close each service window (or press Ctrl+C in it) to stop that service.'
