$ErrorActionPreference='Stop'
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('relay-manual-start-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Relay.ps1') -Destination $fixtureRoot
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Codex-Copilot-Config.ps1'),'')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Relay-Control.ps1'),@'
function Enter-RelayControlLock { param($Root) $m=[Threading.Mutex]::new();$null=$m.WaitOne();return $m }
function Assert-RelayLocalPath { param($Root,$Path) }
function Get-RelayLocalKey { param($Root,[switch]$Create) 'fixture-key' }
'@)
    $global:manualStartTrace=@();$global:manualStartFail=$false
    foreach($entry in @(@('Stop-Codex-CopilotWatchdog.ps1','watchdog'),@('Stop-Codex-CopilotGatewayConsole.ps1','console'))){
        [IO.File]::WriteAllText((Join-Path $fixtureRoot $entry[0]),('$global:manualStartTrace+='''+$entry[1]+''';if(-not (Test-Path (Join-Path $PSScriptRoot ''runtime\relay-disabled.flag''))){throw ''Recovery not disabled before stop''}'))
    }
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Stop-Codex-CopilotProxy.ps1'),@'
param($Port,[switch]$CancelActive)
if($Port -ne 4546 -or -not $CancelActive){throw 'Manual restart must cancel both adapters on requested port'}
$global:manualStartTrace+='cancel'
if($global:manualStartFail){throw 'synthetic unproven listener'}
'@)
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Repair-Codex-CopilotProxy.ps1'),@'
param($Port,$Model,[switch]$NoDashboard)
if($Port -ne 4546 -or $Model -ne 'gpt-6-astra' -or -not $NoDashboard){throw 'Launch preferences changed'}
$global:manualStartTrace+='repair'
Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\relay-disabled.flag')
'@)
    & (Join-Path $fixtureRoot 'Start-Relay.ps1') -Port 4546 -Model 'gpt-6-astra' -NoDashboard | Out-Null
    Assert (($global:manualStartTrace -join ',') -eq 'watchdog,console,cancel,repair') 'Start ordering failed.'
    $global:manualStartTrace=@();$global:manualStartFail=$true;$failed=$false
    try { & (Join-Path $fixtureRoot 'Start-Relay.ps1') -Port 4546 -Model 'gpt-6-astra' -NoDashboard | Out-Null } catch {$failed=$true}
    Assert $failed 'Unproven listener did not fail closed.'
    Assert (($global:manualStartTrace -join ',') -eq 'watchdog,console,cancel') 'Start continued after failed stop.'
    Assert (Test-Path (Join-Path $fixtureRoot 'runtime\relay-disabled.flag')) 'Failed stop re-enabled recovery.'
    Write-Output 'MANUAL_START_CANCEL_ORDER_PREFERENCES_AND_FAILURE_GUARDS_OK'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    if(-not $resolved.StartsWith((Join-Path ([IO.Path]::GetTempPath()) 'relay-manual-start-'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
