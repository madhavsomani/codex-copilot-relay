$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('relay-two-controls-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $server=Join-Path $testRoot 'server.mjs'
    $process=[pscustomobject]@{Name='node.exe';CommandLine='"C:\Program Files\nodejs\node.exe" "'+$server+'"'}
    Assert (Test-RelayServerIdentity $process $testRoot) 'Expected exact server identity.'
    foreach($suffix in @('.evil',' --extra','; other')) {
        $wrong=[pscustomobject]@{Name='node.exe';CommandLine='"C:\Program Files\nodejs\node.exe" "'+$server+$suffix+'"'}
        Assert (-not (Test-RelayServerIdentity $wrong $testRoot)) 'Unsafe process identity accepted.'
    }
    $key1=Get-RelayLocalKey -Root $testRoot -Create
    $key2=Get-RelayLocalKey -Root $testRoot
    Assert ($key1 -ceq $key2) 'Key rotated across restart.'
    $stored=[IO.File]::ReadAllText((Join-Path $testRoot 'runtime\claude-local-key.dpapi'))
    Assert (-not $stored.Contains($key1)) 'Plaintext key was stored.'
    $acl=Get-Acl -LiteralPath (Join-Path $testRoot 'runtime\claude-local-key.dpapi')
    Assert $acl.AreAccessRulesProtected 'Key ACL inherits broader permissions.'

    # Controlled evidence injection: never call the real process enumerators or stop.
    $script:alive=$true;$script:busy=1;$script:stopped=0;$script:reused=$false;$script:samples=0
    function Get-RelayListenerEvidence {
        param($Root,$Port)
        $script:samples++
        if (-not $script:alive) { return $null }
        [pscustomobject]@{Pid=123;Created=if($script:reused -and $script:samples -gt 1){'new'}else{'old'};Health=[pscustomobject]@{activeExchanges=$script:busy}}
    }
    function Stop-Process { param($Id,[switch]$Force,$ErrorAction) $script:stopped++;$script:alive=$false }
    function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) if($script:alive){[pscustomobject]@{ProcessId=123;CreationDate='old'}} }
    function Start-Sleep { param($Milliseconds,$Seconds) }
    Assert (-not (Stop-RelayOwnedListener -Root $testRoot -Port 4567)) 'Busy relay must not stop.'
    Assert ($script:stopped -eq 0) 'Busy relay was killed.'
    $script:busy=0
    Assert (Stop-RelayOwnedListener -Root $testRoot -Port 4567) 'Missing PID file blocked an owned idle relay stop.'
    Assert ($script:stopped -eq 1) 'Expected one owned stop.'
    Assert (Stop-RelayOwnedListener -Root $testRoot -Port 4567) 'Repeated stop failed.'
    Assert ($script:stopped -eq 1) 'Repeated stop killed again.'
    $script:alive=$true;$script:reused=$true;$script:samples=0;$rejected=$false
    try { Stop-RelayOwnedListener -Root $testRoot -Port 4567 | Out-Null } catch { $rejected=$true }
    Assert $rejected 'Reused process identity was not rejected.'
    Assert ($script:stopped -eq 1) 'Reused identity was killed.'
    Remove-Item Function:\Get-RelayListenerEvidence,Function:\Get-CimInstance,Function:\Stop-Process,Function:\Start-Sleep

    $desktop=Join-Path $testRoot 'desktop';New-Item -ItemType Directory -Path $desktop | Out-Null
    $shell=New-Object -ComObject WScript.Shell
    $old=Join-Path $desktop 'Start or Repair Codex Copilot Bridge.lnk'
    $link=$shell.CreateShortcut($old);$link.TargetPath=(Get-Command powershell.exe).Source
    $link.Arguments='-NoProfile -File "'+(Join-Path $PSScriptRoot 'Repair-Codex-CopilotProxy.ps1')+'"';$link.Save()
    [IO.File]::WriteAllText((Join-Path $desktop 'unrelated-screenshot.txt'),'untouched')
    $hash=(Get-FileHash -LiteralPath $old).Hash
    $archiveRoot=Join-Path $testRoot 'relay\runtime\desktop-backups'
    & (Join-Path $PSScriptRoot 'Install-RelayDesktopControls.ps1') -Desktop $desktop -ArchiveDirectory $archiveRoot | Out-Null
    & (Join-Path $PSScriptRoot 'Install-RelayDesktopControls.ps1') -Desktop $desktop -ArchiveDirectory $archiveRoot | Out-Null
    Assert (@(Get-ChildItem -LiteralPath $desktop -File -Filter '*.lnk').Count -eq 2) 'Expected exactly two controls after repeated installation.'
    $archived=@(Get-ChildItem -LiteralPath $archiveRoot -File -Recurse -Filter '*.lnk')
    Assert (-not (Test-Path -LiteralPath (Join-Path $desktop 'Copilot Relay Backups'))) 'Archive clutter reappeared on the desktop.'
    Assert ($archived.Count -eq 1 -and (Get-FileHash -LiteralPath $archived[0].FullName).Hash -eq $hash) 'Old control was not archived byte-for-byte.'
    Assert ([IO.File]::ReadAllText((Join-Path $desktop 'unrelated-screenshot.txt')) -ceq 'untouched') 'Unrelated desktop file changed.'
    # Real Enable entrypoint with fixture-only process hooks: a startup failure
    # must restore the immediately prior working TOML/state, not an old baseline.
    $fixture=Join-Path $testRoot 'startup-failure';New-Item -ItemType Directory -Path $fixture | Out-Null
    $helper=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1'))
    $helper += "`n" + 'function Get-CodexCopilotConfigPath { Join-Path $PSScriptRoot ''config.toml'' }'
    [IO.File]::WriteAllText((Join-Path $fixture 'Codex-Copilot-Config.ps1'),$helper)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Enable-Codex-CopilotProxy.ps1') -Destination $fixture
    [IO.File]::WriteAllText((Join-Path $fixture 'Start-Codex-CopilotProxy.ps1'),'throw ''synthetic startup failure''')
    foreach($name in @('Stop-Codex-CopilotProxy.ps1','Stop-Codex-CopilotWatchdog.ps1','Stop-Codex-CopilotGatewayConsole.ps1')) {
        [IO.File]::WriteAllText((Join-Path $fixture $name),'param([int]$Port)')
    }
    $fixtureRuntime=Join-Path $fixture 'runtime';New-Item -ItemType Directory -Path $fixtureRuntime | Out-Null
    $config=Join-Path $fixture 'config.toml';[IO.File]::WriteAllText($config,'model_provider = "openai"')
    $backup=New-CodexCopilotConfigBackup -ConfigPath $config -BackupPath (Join-Path $fixtureRuntime 'original.bak')
    $state=Set-CodexCopilotConfig -ConfigPath $config -Port 4567 -Model 'gpt-6.1-sol'
    $state=Add-CodexCopilotBackupToState -State $state -Backup $backup
    $stateFile=Join-Path $fixtureRuntime 'codex-copilot-proxy.state.json'
    [IO.File]::WriteAllText($stateFile,($state|ConvertTo-Json -Depth 12))
    [IO.File]::AppendAllText($config,"`r`n# later user setting retained")
    $beforeConfig=(Get-FileHash -LiteralPath $config).Hash;$beforeState=(Get-FileHash -LiteralPath $stateFile).Hash
    $startupFailed=$false
    try { & (Join-Path $fixture 'Enable-Codex-CopilotProxy.ps1') -Port 4567 -Model 'gpt-6.1-sol' -SkipStartup | Out-Null } catch { $startupFailed=$true }
    Assert $startupFailed 'Startup failure fixture unexpectedly succeeded.'
    Assert ((Get-FileHash -LiteralPath $config).Hash -eq $beforeConfig) 'Startup failure lost the prior working config.'
    Assert ((Get-FileHash -LiteralPath $stateFile).Hash -eq $beforeState) 'Startup failure lost original restore state.'
    Write-Output 'TWO_CONTROLS_IDENTITY_BUSY_MISSING_PID_REPEATED_STOP_DPAPI_AND_ARCHIVE_OK'
} finally {
    $resolved=[IO.Path]::GetFullPath($testRoot)
    if (-not $resolved.StartsWith((Join-Path ([IO.Path]::GetTempPath()) 'relay-two-controls-'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup target.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
