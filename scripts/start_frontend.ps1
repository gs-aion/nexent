<#
.SYNOPSIS
    Start the Nexent frontend dev server with an adequate Node heap.

.DESCRIPTION
    The Next.js dev server for this project compiles 17k-18k modules per route.
    With the default Node heap (~4 GB) it exhausts memory after warming a handful
    of routes and crashes with:

        FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory

    Before crashing it thrashes in GC (mutator utilization drops to ~0.02), which
    makes the UI appear frozen: side-menu clicks call router.push(), the URL only
    updates after the server responds, and there is no loading.tsx to show progress.

    This script raises the heap limit and starts the dev server.

.PARAMETER HeapSizeMb
    Node --max-old-space-size value in MB. Default 8192.

.EXAMPLE
    .\scripts\start_frontend.ps1
#>
[CmdletBinding()]
param(
    [int]$HeapSizeMb = 8192
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot 'frontend'

if (-not (Test-Path (Join-Path $FrontendDir 'server.js'))) {
    Write-Error "Frontend not found at $FrontendDir"
    exit 1
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Warning "frontend/node_modules is missing. Run: pnpm -C `"$FrontendDir`" install"
}

# Required because pnpm.ps1 is blocked by the default PowerShell execution policy.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# The actual fix: give Node enough heap to hold all compiled routes.
$env:NODE_OPTIONS = "--max-old-space-size=$HeapSizeMb"

Write-Host "Starting frontend with NODE_OPTIONS=$env:NODE_OPTIONS" -ForegroundColor Cyan
Write-Host "Open http://localhost:3000 (redirects to /zh)" -ForegroundColor Cyan

pnpm -C $FrontendDir run dev
