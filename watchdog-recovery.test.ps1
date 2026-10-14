$ErrorActionPreference='Stop'
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('relay-watchdog-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'runtime') | Out-Null
$global:watchdogFixture_fixtureRoot=$fixtureRoot
$global:watchdogFixture_phase=0;$global:watchdogFixture_serverStarts=0;$global:watchdogFixture_consoleStarts=0;$global:watchdogFixture_backupChecks=0
$global:watchdogFixture_health=$null
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Set-FixtureHealth([string]$Version='fixture-current',[int]$Active=0){
    $global:watchdogFixture_health=[pscustomobject]@{ok=$true;model='gpt-6.1-sol';version=$Version;unified=$true;activeExchanges=$Active;routing=[pscustomobject]@{mode='per-request'}}
}
# All network/process effects are replaced in this dedicated child process.
function Invoke-RestMethod { param($Method,$Uri,$TimeoutSec) return $global:watchdogFixture_health }
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction)
    [pscustomobject]@{Name='powershell.exe';CommandLine='"'+(Join-Path $global:watchdogFixture_fixtureRoot 'Show-Codex-CopilotGateway.ps1')+'"'}
}
function Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle)
    $global:watchdogFixture_consoleStarts++
    [IO.File]::WriteAllText((Join-Path $global:watchdogFixture_fixtureRoot 'runtime\codex-copilot-console.pid'),'12345')
}
function Start-Sleep { param($Seconds,$Milliseconds)
    if(-not $Seconds){return}
    $global:watchdogFixture_phase++
    switch($global:watchdogFixture_phase){
        1 { Remove-Item -LiteralPath (Join-Path $global:watchdogFixture_fixtureRoot 'runtime\codex-copilot-console.pid') }
        2 { Set-FixtureHealth -Version 'fixture-old' -Active 1 }
        3 { Assert ($global:watchdogFixture_serverStarts -eq 1) 'Busy version change restarted the relay.';Set-FixtureHealth -Version 'fixture-old' }
        4 { [IO.File]::WriteAllText((Join-Path $global:watchdogFixture_fixtureRoot 'runtime\relay-disabled.flag'),'intentional stop') }
        default { throw 'Watchdog did not honor the stop flag.' }
    }
}
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Watch-Codex-CopilotProxy.ps1') -Destination $fixtureRoot
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'package.json'),'{"version":"fixture-current"}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'runtime\desktop-relay.json'),'{}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'runtime\codex-copilot-proxy.state.json'),(@{Port=4546;Model='gpt-6.1-sol';ConfigPath=(Join-Path $fixtureRoot 'config.toml')}|ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Start-Codex-CopilotProxy.ps1'),'param($Port,$Model); $global:watchdogFixture_serverStarts++; Set-FixtureHealth; "fixture restarted"')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'Codex-Copilot-Config.ps1'),@'
function Assert-CodexCopilotConfigBackup { param($State) $global:watchdogFixture_backupChecks++ }
function New-CodexCopilotModelCatalog { param($Health,$Model,$Directory) 'fixture-catalog' }
function Set-CodexCopilotConfig { param($ConfigPath,$Port,$Model,$RestoreState,$ModelHealth,$ModelCatalogPath) $RestoreState }
'@)
    $preserved=@{}
    foreach($name in @('config.toml.pre-copilot.bak','claude-local-key.dpapi','history-fixture.json')){
        $file=Join-Path $fixtureRoot ('runtime\'+$name);[IO.File]::WriteAllText($file,'synthetic preserved data');$preserved[$file]=(Get-FileHash -LiteralPath $file).Hash
    }
    & (Join-Path $fixtureRoot 'Watch-Codex-CopilotProxy.ps1') -Port 4546 -CheckIntervalSeconds 2 | Out-Null
    Assert ($global:watchdogFixture_phase -eq 4) 'Unexpected fixture phase count.'
    Assert ($global:watchdogFixture_serverStarts -eq 2) 'Expected stopped-server recovery and idle promotion only.'
    Assert ($global:watchdogFixture_consoleStarts -eq 2) 'Expected initial console and recovery after closing it.'
    Assert ($global:watchdogFixture_backupChecks -gt 0) 'Config synchronization skipped protected-backup validation.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot 'runtime\codex-copilot-watchdog.pid'))) 'Watchdog PID survived intentional shutdown.'
    foreach($file in $preserved.Keys){Assert ((Get-FileHash -LiteralPath $file).Hash -eq $preserved[$file]) 'Persistent fixture data changed.'}
    Write-Output 'WATCHDOG_STOPPED_SERVER_CONSOLE_RECOVERY_BUSY_DEFERRAL_STOP_FLAG_AND_DATA_PRESERVATION_OK'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    if(-not $resolved.StartsWith((Join-Path ([IO.Path]::GetTempPath()) 'relay-watchdog-fixture-'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
