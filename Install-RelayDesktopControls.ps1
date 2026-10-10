[CmdletBinding()]
param([string]$Desktop=[Environment]::GetFolderPath('Desktop'),[int]$Port=4144,[string]$Model='gpt-6.1-sol')
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
New-CodexCopilotDesktopShortcut -ShortcutPath $start -ScriptPath (Join-Path $PSScriptRoot 'Start-Relay.ps1') -ScriptArguments "-Port $Port -Model $Model" -Description 'Start or repair the shared Codex + Claude relay, visible terminal and dashboard.' | Out-Null
New-CodexCopilotDesktopShortcut -ShortcutPath $stop -ScriptPath (Join-Path $PSScriptRoot 'Stop-Relay.ps1') -KeepOpen -Description 'Stop owned recovery and both adapters after work drains; restore protected Codex config. Claude profile remains user-controlled.' | Out-Null
if ($archiveFiles.Count) {
    $archive=Join-Path $desktopPath ('Copilot Relay Backups\old-desktop-controls-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
    Assert-RelayLocalPath -Root $desktopPath -Path $archive
    New-Item -ItemType Directory -Path $archive -ErrorAction Stop | Out-Null
    foreach($file in $archiveFiles) {
        $target=Join-Path $archive ([IO.Path]::GetFileName($file))
        Assert-RelayLocalPath -Root $desktopPath -Path $target
        Move-Item -LiteralPath $file -Destination $target -ErrorAction Stop
    }
    Write-Output "Old relay controls archived (recoverable): $archive"
}
Write-Output $start
Write-Output $stop
