<#
.SYNOPSIS
    Warm up the Nexent frontend dev server so menu clicks feel instant.

.DESCRIPTION
    Next.js dev mode compiles each route on first visit. This project's routes are
    large (15k-17k modules each), so the first click on a side-menu item can take
    10-25 seconds per route. Because `router.push()` only updates the URL once the
    server responds, and there is no `loading.tsx`, the UI looks frozen.

    This script requests every side-menu route once, paying the compile cost up
    front. Afterwards navigation is instant until the dev server restarts or the
    source changes.

.NOTES
    The dev server is single-threaded: while it compiles, other requests stall.
    Expect the whole machine's dev server to be busy for a few minutes.
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Locale = "zh",
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Continue'

# Side-menu routes, mirrored from components/navigation/SideNavigation.tsx
$Routes = @(
    "/newchat",
    "/agent-tasks",
    "/agent-dev",
    "/models",
    "/knowledges",
    "/agents",
    "/memory",
    "/evaluation",
    "/resource-space",
    "/agent-space",
    "/mcp-space",
    "/skill-space",
    "/resource-manage",
    "/owner-manage"
)

Write-Host "Warming up $($Routes.Count) routes on $BaseUrl (this takes a few minutes)..." -ForegroundColor Cyan
Write-Host ""

$total = [TimeSpan]::Zero
foreach ($route in $Routes) {
    $url = "$BaseUrl/$Locale$route"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $code = curl.exe -s -o NUL -w '%{http_code}' --max-time $TimeoutSeconds $url
    } catch {
        $code = "ERR"
    }
    $sw.Stop()
    $total += $sw.Elapsed

    $seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $color = if ($code -eq "200") { "Green" } else { "Yellow" }
    Write-Host ("{0,-22} {1,8}s  {2}" -f $route, $seconds, $code) -ForegroundColor $color
}

Write-Host ""
Write-Host ("Done. Total {0}s. Menu navigation should now be instant." -f [math]::Round($total.TotalSeconds, 1)) -ForegroundColor Cyan
