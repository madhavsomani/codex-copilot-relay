param(
    [string]$RuntimeDirectory = $PSScriptRoot,
    [ValidateRange(1024,65535)][int]$Port = 4261,
    [ValidateRange(1024,65535)][int]$SetupPort = 4263
)
$ErrorActionPreference = 'Stop'
$entryPoint = Join-Path $RuntimeDirectory 'launch.mjs'
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw 'Reviewed relay entry point not found. Select an installed checkout with -RuntimeDirectory.'
}
$nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
& $nodeExecutable $entryPoint claude-desktop --port $Port --setup-port $SetupPort --open-setup
if ($LASTEXITCODE -notin @(0,130)) { throw 'The desktop gateway stopped with an error. Saved app settings were not changed by this launcher.' }
