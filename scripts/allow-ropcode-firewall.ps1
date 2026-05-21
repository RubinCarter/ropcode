param(
    [string]$RuleName = "Ropcode-WebSocket-Dev-Test",
    [string]$DisplayName = "Ropcode WebSocket Dev/Test",
    [string[]]$LocalPorts = @("5173", "5180-5199")
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Administrator privileges are required. Re-run PowerShell as Administrator."
}

$portList = $LocalPorts -join ", "
$description = "Allows Ropcode server and Go test binaries to listen on stable WebSocket ports without repeated Windows Security prompts."

$existing = Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue
if (-not $existing) {
    $existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue
}
if ($existing) {
    $existing | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any -DisplayName $DisplayName -Description $description
    $existing | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $LocalPorts
    Write-Host "Updated firewall rule '$DisplayName' for TCP ports $portList."
    exit 0
}

New-NetFirewallRule `
    -Name $RuleName `
    -DisplayName $DisplayName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $LocalPorts `
    -Profile Any `
    -Description $description

Write-Host "Created firewall rule '$DisplayName' for TCP ports $portList."
