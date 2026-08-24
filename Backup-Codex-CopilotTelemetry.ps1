[CmdletBinding()]
param(
    [string]$RuntimeDirectory,

    [ValidateRange(1, 50)]
    [int]$Keep = 8,

    [ValidateRange(1, 768)]
    [int]$MaxTotalMiB = 512,

    [ValidateLength(1, 64)]
    [string]$Reason = 'manual'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RuntimeDirectory)) {
    $RuntimeDirectory = Join-Path $bridgeRoot 'runtime'
}
$RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
$historyPath = Join-Path $RuntimeDirectory 'proxy-events.jsonl'
$metricsPath = Join-Path $RuntimeDirectory 'proxy-metrics.json'
$backupRoot = Join-Path $RuntimeDirectory 'telemetry-backups'

if (-not (Test-Path -LiteralPath $historyPath -PathType Leaf) -and
    -not (Test-Path -LiteralPath $metricsPath -PathType Leaf)) {
    return [pscustomobject]@{
        Created = $false
        Path = $null
        RecordCount = 0
        Message = 'No telemetry files exist yet.'
    }
}

$safeReason = ($Reason.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($safeReason)) { $safeReason = 'manual' }
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ', [Globalization.CultureInfo]::InvariantCulture)
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$backupName = "$timestamp-$safeReason-$suffix"
$stagingPath = Join-Path $backupRoot (".pending-" + $backupName)
$finalPath = Join-Path $backupRoot $backupName

function Get-ValidatedHistoryMetadata {
    param([Parameter(Mandatory)][string]$Path)

    $count = 0
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $earliest = $null
    $latest = $null
    foreach ($line in [IO.File]::ReadLines($Path)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $record = $line | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "Telemetry backup contains invalid JSON at record $($count + 1): $($_.Exception.Message)"
        }
        $count++
        if ($record.id) { $null = $ids.Add([string]$record.id) }
        if ($record.receivedAt) {
            $receivedAt = [string]$record.receivedAt
            if (-not $earliest -or [string]::CompareOrdinal($receivedAt, $earliest) -lt 0) { $earliest = $receivedAt }
            if (-not $latest -or [string]::CompareOrdinal($receivedAt, $latest) -gt 0) { $latest = $receivedAt }
        }
    }
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        file = $item.Name
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
        records = $count
        uniqueIds = $ids.Count
        earliest = $earliest
        latest = $latest
    }
}

function Get-ValidatedMetricsMetadata {
    param([Parameter(Mandatory)][string]$Path)

    try {
        $metrics = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Telemetry metrics backup is invalid JSON: $($_.Exception.Message)"
    }
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        file = $item.Name
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
        version = $metrics.version
        lifetimeReceived = $metrics.lifetime.received
        lifetimeCompleted = $metrics.lifetime.completed
        lifetimeFailed = $metrics.lifetime.failed
        updatedAt = $metrics.updatedAt
    }
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
try {
    New-Item -ItemType Directory -Path $stagingPath | Out-Null
    $historyMetadata = $null
    $metricsMetadata = $null
    if (Test-Path -LiteralPath $historyPath -PathType Leaf) {
        $historyBackup = Join-Path $stagingPath 'proxy-events.jsonl'
        Copy-Item -LiteralPath $historyPath -Destination $historyBackup
        $historyMetadata = Get-ValidatedHistoryMetadata -Path $historyBackup
    }
    if (Test-Path -LiteralPath $metricsPath -PathType Leaf) {
        $metricsBackup = Join-Path $stagingPath 'proxy-metrics.json'
        Copy-Item -LiteralPath $metricsPath -Destination $metricsBackup
        $metricsMetadata = Get-ValidatedMetricsMetadata -Path $metricsBackup
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        managed = $true
        createdAt = [DateTime]::UtcNow.ToString('o')
        reason = $Reason
        sourceRuntimeDirectory = $RuntimeDirectory
        history = $historyMetadata
        metrics = $metricsMetadata
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stagingPath 'backup.manifest.json') -Encoding utf8
    Move-Item -LiteralPath $stagingPath -Destination $finalPath
}
catch {
    $resolvedBackupRoot = [IO.Path]::GetFullPath($backupRoot)
    $resolvedStaging = [IO.Path]::GetFullPath($stagingPath)
    if ((Test-Path -LiteralPath $stagingPath) -and
        $resolvedStaging.StartsWith(($resolvedBackupRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}

function Test-ManagedTelemetryBackup {
    param([Parameter(Mandatory)][string]$Path)

    $manifestPath = Join-Path $Path 'backup.manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
    try {
        $candidateManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
        return $candidateManifest.managed -eq $true
    }
    catch {
        return $false
    }
}

$managedBackups = @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-ManagedTelemetryBackup -Path $_.FullName } |
    Sort-Object Name)

function Get-TelemetryBackupBytes {
    param([Parameter(Mandatory)][string]$Path)

    $measurement = Get-ChildItem -LiteralPath $Path -File -Recurse -ErrorAction Stop | Measure-Object -Property Length -Sum
    if ($null -eq $measurement.Sum) { return [long]0 }
    return [long]$measurement.Sum
}

$managedBackupBytes = @{}
$managedTotalBytes = [long]0
foreach ($managedBackup in $managedBackups) {
    $backupBytes = Get-TelemetryBackupBytes -Path $managedBackup.FullName
    $managedBackupBytes[$managedBackup.FullName] = $backupBytes
    $managedTotalBytes += $backupBytes
}
$managedByteLimit = [long]$MaxTotalMiB * 1MB
while ($managedBackups.Count -gt 1 -and
    ($managedBackups.Count -gt $Keep -or $managedTotalBytes -gt $managedByteLimit)) {
    $oldest = $managedBackups[0]
    $resolvedBackupRoot = [IO.Path]::GetFullPath($backupRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedOldest = [IO.Path]::GetFullPath($oldest.FullName)
    $resolvedParent = [IO.Directory]::GetParent($resolvedOldest).FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $resolvedParent.Equals($resolvedBackupRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to prune telemetry backup outside $resolvedBackupRoot."
    }
    $managedTotalBytes -= [long]$managedBackupBytes[$oldest.FullName]
    Remove-Item -LiteralPath $resolvedOldest -Recurse -Force
    $managedBackups = @($managedBackups | Select-Object -Skip 1)
}

return [pscustomobject]@{
    Created = $true
    Path = $finalPath
    RecordCount = if ($historyMetadata) { [int]$historyMetadata.records } else { 0 }
    ManagedBackupBytes = $managedTotalBytes
    Message = "Telemetry backup validated and retained at $finalPath."
}
