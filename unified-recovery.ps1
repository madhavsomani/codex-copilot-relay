# Explicit Windows recovery, never a background PID-file reaper. No process is
# killed and no telemetry is deleted. The launcher receipt is archived LAST so
# another launcher cannot acquire its history while the child receipt is moving.
function Assert-UnifiedRecoveryPath {
    param([string]$Root,[string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if ($absolute -ne $base -and -not $absolute.StartsWith($base + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Recovery path escapes its checkout; no files changed.'
    }
    $cursor = $absolute
    while ($cursor.Length -ge $base.Length) {
        if (Test-Path -LiteralPath $cursor) {
            $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Recovery refuses junctions or links; no files changed.' }
        }
        if ($cursor -eq $base) { break }
        $cursor = Split-Path -Parent $cursor
    }
}
function Get-UnifiedRecoveryEvidence {
    param([string]$Root,[int]$Port)
    # Failure to enumerate is not evidence that no process is running.
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port)
    $unknownNodes = @($processes | Where-Object { $_.Name -eq 'node.exe' -and -not $_.CommandLine })
    $candidates = @($processes | Where-Object { $_.Name -eq 'node.exe' -and
        $_.CommandLine -match '(server-child\.mjs|launch\.mjs["\s]+gateway(?:\s|$)|unified-launch\.mjs)' })
    # Old receipts do not record SDK worker IDs. Refuse ambiguous workers from
    # this checkout; the existing ordinary Codex server's live children are OK.
    $ambiguousWorkers = @($processes | Where-Object {
        $worker = $_
        if ($worker.Name -ne 'node.exe' -or -not $worker.CommandLine -or
            $worker.CommandLine.IndexOf($Root,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or
            $worker.CommandLine -notmatch '@github[\\/]copilot') { return $false }
        $parent = @($processes | Where-Object ProcessId -eq $worker.ParentProcessId)
        $ordinary = $parent.Count -eq 1 -and $parent[0].Name -eq 'node.exe' -and
            $parent[0].CommandLine -and $parent[0].CommandLine -match ([regex]::Escape((Join-Path $Root 'server.mjs')) + '(?:"|\s|$)') -and
            $parent[0].CreationDate -le $worker.CreationDate
        return (-not $ordinary)
    })
    return [pscustomobject]@{
        Processes = @($processes | Select-Object ProcessId,ParentProcessId)
        ListenerCount = $listeners.Count
        AmbiguousCount = $unknownNodes.Count + $candidates.Count + $ambiguousWorkers.Count
    }
}
function Repair-UnifiedGatewayOwnership {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Root,[ValidateRange(1024,65535)][int]$Port = 4265)
    $ErrorActionPreference = 'Stop'
    if ($Port -in @(4144,4246,4261,4263)) { throw 'Recovery cannot target a production or standalone preview port.' }
    $rootPath = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
    $directory = Join-Path $rootPath "runtime\unified\$Port"
    $launcherFile = Join-Path $directory 'gateway.owner.json'
    $workerFile = Join-Path $directory 'claude\gateway.owner.json'
    foreach ($file in @($launcherFile,$workerFile)) { Assert-UnifiedRecoveryPath -Root $rootPath -Path $file }
    if (-not (Test-Path -LiteralPath $launcherFile -PathType Leaf)) {
        if (Test-Path -LiteralPath $workerFile) { throw 'Child ownership remains without launcher ownership. Inspect it manually; no files changed.' }
        Write-Output 'No retained combined ownership files; normal startup can proceed.'
        return
    }
    $receipts = @()
    foreach ($file in @($workerFile,$launcherFile)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        if ((Get-Item -LiteralPath $file).Length -gt 4096) { throw 'Oversized ownership receipt; no files changed.' }
        $raw = [IO.File]::ReadAllText($file)
        try { $data = $raw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Malformed ownership receipt; no files changed.' }
        $ownerGuid = [guid]::Empty
        $at = [DateTimeOffset]::MinValue
        # Windows PowerShell returns JSON dates as strings; PowerShell 7 can
        # return UTC DateTime objects. Do not stringify a UTC object as local time.
        $atValid = if ($data.at -is [DateTime] -or $data.at -is [DateTimeOffset]) {
            $at = [DateTimeOffset]$data.at
            $true
        } else { [DateTimeOffset]::TryParse([string]$data.at,[ref]$at) }
        if ($data.version -ne 1 -or ($data.pid -isnot [long] -and $data.pid -isnot [int]) -or $data.pid -le 0 -or $data.pid -gt [int]::MaxValue -or
            -not [guid]::TryParse([string]$data.owner,[ref]$ownerGuid) -or
            -not $atValid -or $at -gt [DateTimeOffset]::UtcNow) {
            throw 'Unrecognized ownership receipt; no files changed.'
        }
        $receipts += [pscustomobject]@{Path=$file;Raw=$raw;Pid=[int]$data.pid}
    }
    # Sample repeatedly and fail closed for live/reused owner IDs, surviving
    # children, any matching gateway, an occupied port, or ambiguous SDK workers.
    for ($sample = 0; $sample -lt 3; $sample++) {
        $evidence = Get-UnifiedRecoveryEvidence -Root $rootPath -Port $Port
        if ($evidence.ListenerCount -ne 0 -or $evidence.AmbiguousCount -ne 0) { throw 'A gateway/listener/worker may still be running. Recovery refused; no files changed.' }
        foreach ($receipt in $receipts) {
            if (@($evidence.Processes | Where-Object { $_.ProcessId -eq $receipt.Pid -or $_.ParentProcessId -eq $receipt.Pid }).Count -gt 0) {
                throw 'A recorded owner or child process still exists. Recovery refused; no files changed.'
            }
            Assert-UnifiedRecoveryPath -Root $rootPath -Path $receipt.Path
            if ([IO.File]::ReadAllText($receipt.Path) -cne $receipt.Raw) { throw 'Ownership changed during recovery; no files changed.' }
        }
        if ($sample -lt 2) { Start-Sleep -Milliseconds 150 }
    }
    $archive = Join-Path $directory ('ownership-recovery\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    Assert-UnifiedRecoveryPath -Root $rootPath -Path $archive
    New-Item -ItemType Directory -Path $archive -ErrorAction Stop | Out-Null
    foreach ($receipt in $receipts) {
        Assert-UnifiedRecoveryPath -Root $rootPath -Path $receipt.Path
        if ([IO.File]::ReadAllText($receipt.Path) -cne $receipt.Raw) { throw 'Ownership changed before archival; stopped without removing the launcher guard.' }
        $name = if ($receipt.Path -eq $launcherFile) { 'launcher.owner.json' } else { 'claude.owner.json' }
        $target = Join-Path $archive $name
        Assert-UnifiedRecoveryPath -Root $rootPath -Path $target
        Move-Item -LiteralPath $receipt.Path -Destination $target -ErrorAction Stop
    }
    Write-Output "Recovered $($receipts.Count) stopped ownership file(s). Recoverable archive: $archive"
    Write-Output 'Request history, counters, client settings and other relays were not changed.'
}
