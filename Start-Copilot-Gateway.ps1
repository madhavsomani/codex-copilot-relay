[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port = 4265,[switch]$RecoverStopped)
$ErrorActionPreference = 'Stop'
$relayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($RecoverStopped) {
    . (Join-Path $relayRoot 'unified-recovery.ps1')
    Repair-UnifiedGatewayOwnership -Root $relayRoot -Port $Port
}
$relayNode = @(Get-Command node.exe -CommandType Application -ErrorAction Stop)[0].Source
& $relayNode (Join-Path $relayRoot 'launch.mjs') gateway --port $Port --open
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Gateway was not started. See the specific message above. Existing client settings were not changed.' -ForegroundColor Yellow
    exit $LASTEXITCODE
}
