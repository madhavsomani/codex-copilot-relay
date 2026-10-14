$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
function Assert([bool]$Condition,[string]$Message) { if(-not $Condition){throw $Message} }
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('relay-manual-stop-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'runtime') -Force | Out-Null
try {
    # Mocked processes only: no running client or production listener is stopped.
    $script:instance=[guid]::NewGuid().ToString();$script:modern=$false;$script:changed=$false
    $script:evidenceReads=0;$script:busy=3;$script:commandSeen=$false
    $script:created=(Get-Date).AddMinutes(-1);$script:terminated=@()
    $rootProcess=[pscustomobject]@{ProcessId=101;ParentProcessId=90;Name='node.exe';CreationDate=$script:created;CommandLine='"C:\node.exe" "'+(Join-Path $testRoot 'server.mjs')+'"'}
    $sdk=[pscustomobject]@{ProcessId=102;ParentProcessId=101;Name='node.exe';CreationDate=$script:created.AddSeconds(1);CommandLine='owned SDK worker'}
    $grandchild=[pscustomobject]@{ProcessId=103;ParentProcessId=102;Name='node.exe';CreationDate=$script:created.AddSeconds(2);CommandLine='owned SDK child'}
    $foreign=[pscustomobject]@{ProcessId=104;ParentProcessId=99;Name='node.exe';CreationDate=$script:created;CommandLine='client-owned browser job'}
    $script:processes=@($rootProcess,$sdk,$grandchild,$foreign)
    function Get-RelayListenerEvidence {
        param($Root,$Port)
        $script:evidenceReads++
        if(-not ($script:processes|Where-Object ProcessId -eq 101)){return $null}
        [pscustomobject]@{Pid=101;Created=$script:created;Health=[pscustomobject]@{activeExchanges=$script:busy;
            lifecycle=[pscustomobject]@{control='local-file-v1';cancelActive=$script:modern;instanceId=if($script:changed -and $script:evidenceReads -gt 1){[guid]::NewGuid().ToString()}else{$script:instance}}}}
    }
    function Get-CimInstance {
        param($ClassName,$Filter,$ErrorAction)
        if($Filter -match '^ProcessId=(\d+)$'){return $script:processes|Where-Object ProcessId -eq ([int]$Matches[1])}
        if($Filter -match '^ParentProcessId=(\d+)$'){return $script:processes|Where-Object ParentProcessId -eq ([int]$Matches[1])}
        throw 'Unexpected process query in cancellation.'
    }
    function Stop-Process { param($Id,[switch]$Force,$ErrorAction)
        $script:terminated+=@($Id);$script:processes=@($script:processes|Where-Object ProcessId -ne $Id)
    }
    function Start-Sleep { param($Milliseconds,$Seconds)
        $file=Join-Path $testRoot 'runtime\relay-stop.json'
        if($script:modern -and (Test-Path -LiteralPath $file)){
            $command=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
            Assert ($command.instanceId -ceq $script:instance -and $command.mode -eq 'cancel-active') 'Wrong cancellation command.'
            $script:commandSeen=$true;$script:processes=@($foreign)
        }
    }
    Assert (-not (Stop-RelayOwnedListener -Root $testRoot -Port 4567)) 'Ordinary busy stop must refuse.'
    Assert ($script:terminated.Count -eq 0) 'Ordinary stop killed work.'
    $script:changed=$true;$script:evidenceReads=0;$rejected=$false
    try { Stop-RelayOwnedListener -Root $testRoot -Port 4567 -CancelActive | Out-Null } catch {$rejected=$true}
    Assert $rejected 'Stale incarnation cancellation must fail.'
    Assert ($script:terminated.Count -eq 0) 'Stale incarnation killed work.'
    $script:changed=$false
    Assert ([bool](Stop-RelayOwnedListener -Root $testRoot -Port 4567 -CancelActive)) 'Legacy busy cancellation failed.'
    Assert (($script:terminated -join ',') -eq '101,102,103') 'Owned descendants did not stop or unrelated process was targeted.'
    Assert ($script:processes.Count -eq 1 -and $script:processes[0].ProcessId -eq 104) 'Client-owned tool changed.'
    Assert (Stop-RelayOwnedListener -Root $testRoot -Port 4567 -CancelActive) 'Repeated cancellation failed.'
    $script:processes=@($rootProcess,$sdk,$foreign);$script:modern=$true;$script:terminated=@()
    Assert (Stop-RelayOwnedListener -Root $testRoot -Port 4567 -CancelActive) 'Modern busy cancellation failed.'
    Assert ($script:commandSeen -and $script:terminated.Count -eq 0) 'Modern stop did not use cooperative cancellation.'
    $script:processes=@($rootProcess,$sdk,$foreign);$script:modern=$false
    $wrongEvidence=[pscustomobject]@{Pid=101;Created=$script:created.AddSeconds(-1)};$rejected=$false
    try { Stop-RelayOwnedProcessTree -Root $testRoot -Evidence $wrongEvidence | Out-Null } catch {$rejected=$true}
    Assert $rejected 'Reused root PID was not rejected.'
    Assert ($script:terminated.Count -eq 0) 'Reused process was terminated.'
    $outside=Join-Path ([IO.Path]::GetTempPath()) 'outside-relay-control.json';$rejected=$false
    try { Assert-RelayLocalPath -Root $testRoot -Path $outside } catch {$rejected=$true}
    Assert $rejected 'Outside-checkout control path accepted.'
    # Entrypoint contract: no automatic lifecycle script opts into cancellation.
    Assert ((Get-Content (Join-Path $PSScriptRoot 'Stop-Relay.ps1') -Raw).Contains('-CancelActive')) 'Desktop Stop lost its explicit cancel behavior.'
    Assert ((Get-Content (Join-Path $PSScriptRoot 'Start-Relay.ps1') -Raw).Contains('-CancelActive')) 'Desktop Start lost its explicit restart behavior.'
    foreach($name in @('Repair-Codex-CopilotProxy.ps1','Start-Codex-CopilotProxy.ps1','Watch-Codex-CopilotProxy.ps1')) {
        Assert (-not (Get-Content (Join-Path $PSScriptRoot $name) -Raw).Contains('-CancelActive')) 'Automatic path acquired manual cancellation.'
    }
    Write-Output 'MANUAL_STOP_BUSY_BOTH_MODES_DESCENDANTS_IDENTITY_AND_AUTOMATIC_DRAIN_GUARDS_OK'
} finally {
    $resolved=[IO.Path]::GetFullPath($testRoot)
    if(-not $resolved.StartsWith((Join-Path ([IO.Path]::GetTempPath()) 'relay-manual-stop-'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup target.'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
