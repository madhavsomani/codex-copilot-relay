[CmdletBinding()]
param([string]$Desktop=[Environment]::GetFolderPath('Desktop'),
    [ValidateRange(1024,65535)][int]$Port=4144,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')][string]$Model='gpt-6.1-sol',
    # Retained for compatibility; both controls always use PowerShell now.
    [switch]$UsePowerShell,[string]$ArchiveDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$desktopPath=[IO.Path]::GetFullPath($Desktop)
$shell=New-Object -ComObject WScript.Shell
$known=@{
    'Claude Desktop - Copilot Preview.lnk'='Start-Claude-Desktop-With-Copilot.ps1'
    'Copilot Gateway - Codex + Claude.lnk'='Start-Copilot-Gateway.ps1'
    'Restore Normal Codex (Disable Copilot Bridge).lnk'='Disable-Codex-CopilotProxy.ps1'
    'Start or Repair Codex Copilot Bridge.lnk'='Repair-Codex-CopilotProxy.ps1'
}
$archiveFiles=@()
foreach ($name in $known.Keys) {
    $file=Join-Path $desktopPath $name
    Assert-RelayLocalPath -Root $desktopPath -Path $file
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $link=$shell.CreateShortcut($file)
    $expected='"'+(Join-Path $PSScriptRoot $known[$name])+'"'
    if ([IO.Path]::GetFileName($link.TargetPath) -notin @('powershell.exe','pwsh.exe') -or
        ([string]$link.Arguments).IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -lt 0) { throw "Old control has an unexpected target; left untouched: $name" }
    $archiveFiles += $file
}
# Historical controls are recognized narrowly by both name and launcher target.
$ancient=Join-Path $desktopPath 'Codex via Copilot GPT-5.6 Sol.lnk'
if (Test-Path -LiteralPath $ancient) {
    Assert-RelayLocalPath -Root $desktopPath -Path $ancient
    $link=$shell.CreateShortcut($ancient)
    if ([IO.Path]::GetFileName($link.TargetPath) -ne 'cmd.exe' -or $link.Arguments -notmatch '(?i)^/d /k .*\\outputs\\copilot-codex-bridge\\codex-copilot\.cmd$') { throw 'Unrecognized legacy Codex control; left untouched.' }
    $archiveFiles += $ancient
}
$rollback=Join-Path $desktopPath 'Restore Relay v1.3.19.cmd'
if (Test-Path -LiteralPath $rollback) {
    Assert-RelayLocalPath -Root $desktopPath -Path $rollback
    if ((Get-Item -LiteralPath $rollback).Length -gt 4096 -or [IO.File]::ReadAllText($rollback) -notmatch '\\Restore-v1\.3\.19\.ps1"') { throw 'Unrecognized version rollback control; left untouched.' }
    $archiveFiles += $rollback
}
$start=Join-Path $desktopPath 'Start Relay.lnk'
$stop=Join-Path $desktopPath 'Stop & Restore.lnk'
foreach($file in @($start,$stop)){Assert-RelayLocalPath -Root $desktopPath -Path $file}
$binary=Join-Path $PSScriptRoot 'Copilot-Relay.exe'
Assert-RelayLocalPath -Root $PSScriptRoot -Path $binary
$powerShell=(Get-Command powershell.exe -ErrorAction Stop).Source
$plans=@(
    @{Path=$start;Script='Start-Relay.ps1';Command='start';Extra=" -Port $Port -Model $Model";NoExit='';BinaryArgs="start --port $Port --model $Model";Description='Cancel existing relay sessions and start the latest local Codex + Claude relay, terminal and dashboard.'}
    @{Path=$stop;Script='Stop-Relay.ps1';Command='stop';Extra='';NoExit=' -NoExit';BinaryArgs='stop';Description='Cancel active relay requests, stop owned recovery and both adapters; restore protected Codex config. History and keys retained.'}
)
# Validate BOTH destinations before rewriting either. Permit only migration
# between this checkout's known script and binary controls, never foreign links.
foreach($plan in $plans) {
    $script=Join-Path $PSScriptRoot $plan.Script
    if (-not (Test-Path -LiteralPath $plan.Path)) { continue }
    $existing=$shell.CreateShortcut($plan.Path)
    $scriptPattern='^-NoProfile -ExecutionPolicy Bypass(?: -NoExit)? -File "'+[regex]::Escape($script)+'"(?: -Port \d+ -Model [A-Za-z0-9][A-Za-z0-9._:/-]{0,127})?$'
    $binaryPattern=if($plan.Command -eq 'start'){'^start --port \d+ --model [A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'}else{'^stop$'}
    $ownedScript=$existing.TargetPath -ieq $powerShell -and ([string]$existing.Arguments) -match $scriptPattern
    $ownedBinary=$existing.TargetPath -ieq $binary -and ([string]$existing.Arguments) -match $binaryPattern
    if (-not ($ownedScript -or $ownedBinary)) { throw 'A desktop control has an unrecognized target; neither control was changed.' }
}
foreach($plan in $plans) {
    $link=$shell.CreateShortcut($plan.Path)
    $link.TargetPath=$powerShell
    $link.Arguments='-NoProfile -ExecutionPolicy Bypass'+$plan.NoExit+' -File "'+(Join-Path $PSScriptRoot $plan.Script)+'"'+$plan.Extra
    $link.WorkingDirectory=$PSScriptRoot
    $link.WindowStyle=1
    $link.Description=$plan.Description
    $link.Save()
}
if ($archiveFiles.Count) {
    if (-not $ArchiveDirectory) {
        $ArchiveDirectory=Join-Path $PSScriptRoot 'runtime\desktop-backups'
        Assert-RelayLocalPath -Root $PSScriptRoot -Path $ArchiveDirectory
    }
    $archiveRoot=[IO.Path]::GetFullPath($ArchiveDirectory)
    $archive=Join-Path $archiveRoot ('old-desktop-controls-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
    Assert-RelayLocalPath -Root $archiveRoot -Path $archive
    New-Item -ItemType Directory -Path $archive -ErrorAction Stop | Out-Null
    foreach($file in $archiveFiles) {
        $target=Join-Path $archive ([IO.Path]::GetFileName($file))
        Assert-RelayLocalPath -Root $archiveRoot -Path $target
        Move-Item -LiteralPath $file -Destination $target -ErrorAction Stop
    }
    Write-Output "Old relay controls archived (recoverable): $archive"
}
Write-Output $start
Write-Output $stop
