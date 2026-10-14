[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4144,
    [ValidatePattern('^lease_[a-f0-9-]{36}$')][string]$Cancel,
    [switch]$ConfirmCancel)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$evidence=Get-RelayListenerEvidence -Root $PSScriptRoot -Port $Port
if (-not $evidence) { throw 'Relay is not running.' }
$status=$evidence.Health
if ($status.sessionControl.control -ne 'local-session-file-v1') {
    throw 'The live relay does not support safe individual cancellation yet. Let work drain; do not force-restart to deploy.'
}
if (-not $Cancel) {
    $status.sessionControl.sessions | Select-Object id,client,model,taskId,state,pendingTools,
        @{n='AgeMinutes';e={[math]::Round($_.ageMs/60000,1)}},
        @{n='WaitingMinutes';e={[math]::Round($_.waitingMs/60000,1)}},expiresAt | Format-List
    Write-Output 'To abandon ONE waiting tool continuation: .\Relay-Sessions.ps1 -Cancel <id> -ConfirmCancel'
    Write-Output 'Only do this for work you no longer want. The tool itself is client-owned; save or stop it in the client first.'
    return
}
if (-not $ConfirmCancel) { throw 'Cancellation discards the selected waiting continuation. Add -ConfirmCancel only after saving/stopping that client work.' }
$target=@($status.sessionControl.sessions | Where-Object id -eq $Cancel)
if ($target.Count -ne 1 -or $target[0].state -ne 'waiting-for-tools') { throw 'Target is absent or not waiting for tools. Nothing was cancelled.' }
$command=Join-Path $PSScriptRoot 'runtime\relay-session-cancel.json'
Assert-RelayLocalPath -Root $PSScriptRoot -Path $command
$payload=@{instanceId=$status.lifecycle.instanceId;id=$Cancel;revision=$target[0].revision}|ConvertTo-Json -Compress
$stream=[IO.File]::Open($command,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $bytes=[Text.Encoding]::UTF8.GetBytes($payload);$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
Start-Sleep -Seconds 2
$current=Get-RelayListenerEvidence -Root $PSScriptRoot -Port $Port
if (-not $current -or $current.Health.lifecycle.instanceId -ne $status.lifecycle.instanceId) {
    Write-Output 'Relay instance changed; cancellation is not confirmed. Inspect the current relay.'
} elseif (@($current.Health.sessionControl.sessions | Where-Object id -eq $Cancel).Count -eq 0) {
    Write-Output 'Selected relay continuation is no longer retained. No client transcript or client tool was deleted.'
} else { Write-Output 'Not cancelled yet or refused because work resumed. Run the listing again; no automatic retry was made.' }
