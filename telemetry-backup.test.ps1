$ErrorActionPreference = 'Stop'

$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupScript = Join-Path $bridgeRoot 'Backup-Codex-CopilotTelemetry.ps1'
$startScript = Join-Path $bridgeRoot 'Start-Codex-CopilotProxy.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("codex-telemetry-backup-test-" + [Guid]::NewGuid().ToString('N'))
$runtimeDirectory = Join-Path $testRoot 'runtime'

try {
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $historyPath = Join-Path $runtimeDirectory 'proxy-events.jsonl'
    $metricsPath = Join-Path $runtimeDirectory 'proxy-metrics.json'
    $records = @(
        '{"id":"one","receivedAt":"2026-08-24T00:00:00.000Z","status":"completed"}',
        '{"id":"two","receivedAt":"2026-08-24T00:00:01.000Z","status":"completed"}'
    )
    Set-Content -LiteralPath $historyPath -Value $records -Encoding utf8
    Set-Content -LiteralPath $metricsPath -Value '{"version":1,"lifetime":{"received":2,"completed":2,"failed":0}}' -Encoding utf8
    $historyHashBefore = (Get-FileHash -LiteralPath $historyPath -Algorithm SHA256).Hash
    $manualFolder = Join-Path $runtimeDirectory 'telemetry-backups\manual-preserve'
    New-Item -ItemType Directory -Path $manualFolder -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $manualFolder 'backup.manifest.json') -Value '{"managed":false}' -Encoding utf8

    $first = & $backupScript -RuntimeDirectory $runtimeDirectory -Reason 'test one' -Keep 2
    Add-Content -LiteralPath $historyPath -Value '{"id":"three","receivedAt":"2026-08-24T00:00:02.000Z","status":"completed"}' -Encoding utf8
    Set-Content -LiteralPath $metricsPath -Value '{"version":2,"lifetime":{"received":3,"completed":3,"failed":0}}' -Encoding utf8
    $second = & $backupScript -RuntimeDirectory $runtimeDirectory -Reason 'test two' -Keep 2
    $third = & $backupScript -RuntimeDirectory $runtimeDirectory -Reason 'test three' -Keep 2

    $managed = @(Get-ChildItem -LiteralPath (Join-Path $runtimeDirectory 'telemetry-backups') -Directory |
        Where-Object {
            $manifestPath = Join-Path $_.FullName 'backup.manifest.json'
            (Test-Path -LiteralPath $manifestPath) -and
            ((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).managed -eq $true)
        })
    if ($managed.Count -ne 2) { throw "Expected 2 managed backups, found $($managed.Count)." }
    if (-not (Test-Path -LiteralPath $manualFolder -PathType Container)) { throw 'Manual backup folder was pruned.' }
    if (Test-Path -LiteralPath $first.Path) { throw 'Oldest managed backup was not pruned.' }
    if (-not (Test-Path -LiteralPath $second.Path) -or -not (Test-Path -LiteralPath $third.Path)) { throw 'Newest backups are missing.' }

    $manifest = Get-Content -LiteralPath (Join-Path $third.Path 'backup.manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.history.records -ne 3) { throw "Expected 3 validated records, found $($manifest.history.records)." }
    if ($manifest.metrics.version -ne 2 -or $manifest.metrics.lifetimeReceived -ne 3) { throw 'Metrics metadata was not preserved.' }
    if ($manifest.history.sha256 -ne (Get-FileHash -LiteralPath (Join-Path $third.Path 'proxy-events.jsonl') -Algorithm SHA256).Hash) { throw 'History backup hash mismatch.' }
    if ($historyHashBefore -eq (Get-FileHash -LiteralPath $historyPath -Algorithm SHA256).Hash) { throw 'Test fixture did not change as expected.' }
    if ($third.RecordCount -ne 3) { throw 'Backup result did not report the validated record count.' }

    $largeRecord = '{"id":"four","receivedAt":"2026-08-24T00:00:03.000Z","status":"completed","preview":"' + ('x' * 1100000) + '"}'
    Add-Content -LiteralPath $historyPath -Value $largeRecord -Encoding utf8
    $sizeLimited = & $backupScript -RuntimeDirectory $runtimeDirectory -Reason 'size limit' -Keep 8 -MaxTotalMiB 1
    $managedAfterSizeLimit = @(Get-ChildItem -LiteralPath (Join-Path $runtimeDirectory 'telemetry-backups') -Directory |
        Where-Object {
            $manifestPath = Join-Path $_.FullName 'backup.manifest.json'
            (Test-Path -LiteralPath $manifestPath) -and
            ((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).managed -eq $true)
        })
    if ($managedAfterSizeLimit.Count -ne 1 -or -not (Test-Path -LiteralPath $sizeLimited.Path)) { throw 'Managed backup byte ceiling did not retain only the newest recovery point.' }
    if (-not (Test-Path -LiteralPath $manualFolder -PathType Container)) { throw 'Byte-based pruning removed a manual backup.' }
    $startText = Get-Content -LiteralPath $startScript -Raw
    if ($startText -notmatch "Backup-Codex-CopilotTelemetry\.ps1") { throw 'Persistent startup does not invoke telemetry backup.' }
    if ($startText -notmatch '\$env:BRIDGE_RUNTIME_DIRECTORY = \$runtimeDirectory') { throw 'Persistent startup does not pin the production runtime directory.' }

    Write-Output 'TELEMETRY_BACKUP_VALIDATION_AND_RETENTION_OK'
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedTest = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
        ([IO.Path]::GetFileName($resolvedTest) -like 'codex-telemetry-backup-test-*')) {
        Remove-Item -LiteralPath $resolvedTest -Recurse -Force -ErrorAction SilentlyContinue
    }
}
