$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'unified-recovery.ps1')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('unified-recovery-test-' + [guid]::NewGuid().ToString('N'))
$fixtureDirectory = Join-Path $fixtureRoot 'runtime\unified\4265'
$launcherFile = Join-Path $fixtureDirectory 'gateway.owner.json'
$workerFile = Join-Path $fixtureDirectory 'claude\gateway.owner.json'
$script:evidenceMode = 'stopped'
$script:sample = 0
function Get-UnifiedRecoveryEvidence {
    param([string]$Root,[int]$Port)
    $script:sample++
    if ($script:evidenceMode -eq 'unavailable') { throw 'fixture enumeration unavailable' }
    if ($script:evidenceMode -eq 'changing' -and $script:sample -eq 2) { [IO.File]::WriteAllText($workerFile,'{"version":1,"pid":9999}') }
    $processes = @()
    if ($script:evidenceMode -eq 'owner') { $processes = @([pscustomobject]@{ProcessId=1111;ParentProcessId=42}) }
    if ($script:evidenceMode -eq 'child') { $processes = @([pscustomobject]@{ProcessId=3333;ParentProcessId=2222}) }
    return [pscustomobject]@{Processes=$processes;ListenerCount=[int]($script:evidenceMode -eq 'listener');AmbiguousCount=[int]($script:evidenceMode -eq 'worker')}
}
function Set-FixtureReceipts {
    New-Item -ItemType Directory -Path (Split-Path -Parent $workerFile) -Force | Out-Null
    $recentUtc=[DateTime]::UtcNow.AddMinutes(-1).ToString('o')
    [IO.File]::WriteAllText($launcherFile,(@{version=1;pid=1111;owner=[guid]::NewGuid().ToString();at=$recentUtc} | ConvertTo-Json))
    [IO.File]::WriteAllText($workerFile,(@{version=1;pid=2222;owner=[guid]::NewGuid().ToString();at=$recentUtc} | ConvertTo-Json))
}
function Assert-Refused {
    param([scriptblock]$Action)
    $refused = $false
    try { & $Action | Out-Null } catch { $refused = $true }
    if (-not $refused) { throw 'Expected recovery refusal.' }
}
try {
    Set-FixtureReceipts
    $historyFile = Join-Path $fixtureDirectory 'claude\ledger.json'
    [IO.File]::WriteAllText($historyFile,'{"received":8,"completed":8,"fixture":"KEEP_HISTORY"}')
    $historyHash = (Get-FileHash -LiteralPath $historyFile).Hash
    foreach ($mode in @('owner','child','listener','worker','unavailable','changing')) {
        Set-FixtureReceipts
        $script:evidenceMode=$mode; $script:sample=0
        $original=(Get-FileHash -LiteralPath $launcherFile).Hash
        Assert-Refused { Repair-UnifiedGatewayOwnership -Root $fixtureRoot }
        if ((Get-FileHash -LiteralPath $launcherFile).Hash -ne $original -or -not(Test-Path -LiteralPath $workerFile)) { throw 'Refusal changed ownership.' }
    }
    $script:evidenceMode='stopped'
    foreach ($invalid in @('{bad', '{"version":2,"pid":1111}', '{"version":1,"pid":"1111"}',('x' * 4097))) {
        Set-FixtureReceipts; [IO.File]::WriteAllText($workerFile,$invalid)
        Assert-Refused { Repair-UnifiedGatewayOwnership -Root $fixtureRoot }
        if (-not(Test-Path -LiteralPath $launcherFile)) { throw 'Invalid receipt removed launcher guard.' }
    }
    Assert-Refused { Repair-UnifiedGatewayOwnership -Root $fixtureRoot -Port 4144 }
    Assert-Refused { Assert-UnifiedRecoveryPath -Root $fixtureRoot -Path (Split-Path -Parent $fixtureRoot) }
    Set-FixtureReceipts
    $linked = Join-Path $fixtureRoot 'linked'
    New-Item -ItemType Junction -Path $linked -Target (Join-Path $fixtureDirectory 'claude') | Out-Null
    Assert-Refused { Assert-UnifiedRecoveryPath -Root $fixtureRoot -Path (Join-Path $linked 'gateway.owner.json') }
    # Delete only the verified junction entry, never recurse through its target.
    if (-not ((Get-Item -LiteralPath $linked).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Fixture link changed.' }
    [IO.Directory]::Delete($linked)
    $launcherBefore=[IO.File]::ReadAllText($launcherFile);$workerBefore=[IO.File]::ReadAllText($workerFile)
    Repair-UnifiedGatewayOwnership -Root $fixtureRoot | Out-Null
    if (Test-Path -LiteralPath $launcherFile) { throw 'Stopped launcher ownership not archived.' }
    if (Test-Path -LiteralPath $workerFile) { throw 'Stopped child ownership not archived.' }
    $archives=@(Get-ChildItem -LiteralPath (Join-Path $fixtureDirectory 'ownership-recovery') -Directory)
    if ($archives.Count -ne 1) { throw 'Unexpected archive count.' }
    if ([IO.File]::ReadAllText((Join-Path $archives[0].FullName 'launcher.owner.json')) -cne $launcherBefore -or
        [IO.File]::ReadAllText((Join-Path $archives[0].FullName 'claude.owner.json')) -cne $workerBefore) { throw 'Archive not byte-exact.' }
    Repair-UnifiedGatewayOwnership -Root $fixtureRoot | Out-Null
    if ((Get-FileHash -LiteralPath $historyFile).Hash -ne $historyHash) { throw 'History changed.' }
    Write-Output 'UNIFIED_STOPPED_OWNERS_ARCHIVED_HISTORY_PRESERVED_OK'
    Write-Output 'LIVE_OWNERS_CHILDREN_WORKERS_LISTENERS_CHANGING_INVALID_AND_LINKED_PATHS_REFUSED_OK'
} finally {
    $resolvedFixture=[IO.Path]::GetFullPath($fixtureRoot)
    $expectedPrefix=Join-Path ([IO.Path]::GetTempPath()) 'unified-recovery-test-'
    if (-not $resolvedFixture.StartsWith($expectedPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture cleanup path.' }
    $fixtureLink=Join-Path $resolvedFixture 'linked'
    if(Test-Path -LiteralPath $fixtureLink) {
        if((Get-Item -LiteralPath $fixtureLink).Attributes -band [IO.FileAttributes]::ReparsePoint){[IO.Directory]::Delete($fixtureLink)}
        else{throw 'Fixture link changed; cleanup refused.'}
    }
    if(Test-Path -LiteralPath $resolvedFixture){Remove-Item -LiteralPath $resolvedFixture -Recurse -Force}
}
