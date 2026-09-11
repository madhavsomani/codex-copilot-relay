[CmdletBinding()]
param([string]$CodexPath, [switch]$Disable, [switch]$NoRepair)
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$settingsPath = Join-Path $bridgeRoot 'runtime\native-tools.json'
if (-not $Disable) {
    if (-not $CodexPath) {
        $candidates = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
        foreach ($candidate in $candidates) {
            $executable = Join-Path $candidate.FullName 'codex.exe'
            if (Test-Path -LiteralPath $executable -PathType Leaf) { $CodexPath = $executable; break }
        }
    }
    if (-not $CodexPath -or -not (Test-Path -LiteralPath $CodexPath -PathType Leaf)) { throw 'Pass -CodexPath with an installed Codex executable (0.153.4 or newer) and sign in with codex login.' }
    $CodexPath = [IO.Path]::GetFullPath($CodexPath)
    $version = & $CodexPath --version
    if ($LASTEXITCODE -ne 0) { throw 'The selected Codex executable did not start.' }
    if ($version -notmatch '(\d+)\.(\d+)\.(\d+)' -or [version]$Matches[0] -lt [version]'0.153.4') { throw 'Native tools require Codex 0.153.4 or newer.' }
}
New-Item -ItemType Directory -Path (Split-Path -Parent $settingsPath) -Force | Out-Null
$settings = @{enabled = $false; searchEnabled = $false; imageEnabled = (-not $Disable); codexPath = $CodexPath; model = 'gpt-6-astra'} | ConvertTo-Json
$staged = $settingsPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllText($staged, $settings, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $staged -Destination $settingsPath -Force
if ($Disable) { Write-Output 'Native tools disabled in settings. Version 1.3.19 or newer reads this on the next request.' }
else { Write-Output 'Native images enabled: GPT Image 2 use separate OpenAI/ChatGPT usage. Copilot remains the conversation provider.' }
if (-not $NoRepair) { & (Join-Path $bridgeRoot 'Repair-Codex-CopilotProxy.ps1') -NoDashboard }
