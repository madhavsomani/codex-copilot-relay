# Shared Windows lifecycle helpers. Only this checkout's exact executable/script
# identities are eligible; a missing PID file is not proof that nothing is running.
function Assert-RelayLocalPath {
    param([string]$Root,[string]$Path)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($absolute -ne $base -and -not $absolute.StartsWith($base + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Relay path escapes its checkout.' }
    $cursor = $absolute
    while ($cursor.Length -ge $base.Length) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Relay control refuses linked paths.' }
        if ($cursor -eq $base) { break }; $cursor = Split-Path -Parent $cursor
    }
}
function Enter-RelayControlLock {
    param([string]$Root,[string]$Kind = 'desktop')
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $tag = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Root).ToLowerInvariant()))).Replace('-','').Substring(0,16) } finally { $hash.Dispose() }
    $mutex = [Threading.Mutex]::new($false,"Local\CopilotRelay_${Kind}_$tag")
    $owned = $false
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { $mutex.Dispose(); throw 'Another relay control is already running. Wait for that window to finish.' }
    return $mutex
}
function Test-RelayServerIdentity {
    param([object]$Process,[string]$Root)
    $entry = [regex]::Escape((Join-Path ([IO.Path]::GetFullPath($Root)) 'server.mjs'))
    return [bool]($Process -and $Process.Name -eq 'node.exe' -and
        ([string]$Process.CommandLine) -match ('^\s*(?:"[^"\r\n]*node\.exe"|[^\s"]*node\.exe)\s+(?:"' + $entry + '"|' + $entry + ')\s*$'))
}
function Get-RelayListenerEvidence {
    param([string]$Root,[int]$Port)
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port)
    if ($listeners.Count -eq 0) { return $null }
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1 -or @($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count) { throw 'Relay port is not an exclusive loopback listener.' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])" -ErrorAction Stop
    if (-not (Test-RelayServerIdentity -Process $process -Root $Root)) { throw 'Port belongs to another or unproven process. Nothing was stopped.' }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 -ErrorAction Stop
    if ($health.provider -ne 'github-copilot-sdk' -or -not ($health.PSObject.Properties.Name -contains 'activeExchanges') -or $health.activeExchanges -lt 0) { throw 'Relay health cannot prove safe ownership/work state.' }
    return [pscustomobject]@{Pid=[int]$process.ProcessId;Created=$process.CreationDate;Health=$health}
}
function Stop-RelayOwnedListener {
    param([string]$Root,[int]$Port,[int]$WaitSeconds = 0,[switch]$CancelActive)
    $first = Get-RelayListenerEvidence -Root $Root -Port $Port
    if (-not $first) { return $true }
    $runtime = Join-Path $Root 'runtime'
    $command = Join-Path $runtime 'relay-stop.json'
    Assert-RelayLocalPath -Root $Root -Path $command
    if ($CancelActive) {
        $current=Get-RelayListenerEvidence -Root $Root -Port $Port
        if (-not $current) { return $true }
        if ($current.Pid -ne $first.Pid -or $current.Created -ne $first.Created -or
            $current.Health.lifecycle.instanceId -cne $first.Health.lifecycle.instanceId) { throw 'Listener incarnation changed; cancellation refused.' }
        if ($current.Health.lifecycle.cancelActive -eq $true) {
            $id=[guid]::Empty
            if (-not [guid]::TryParse([string]$current.Health.lifecycle.instanceId,[ref]$id)) { throw 'Invalid process incarnation.' }
            $temp=Join-Path $runtime ('.relay-stop-'+[guid]::NewGuid().ToString('N'))
            try {
                [IO.File]::WriteAllText($temp,(@{instanceId=$id.ToString();mode='cancel-active'}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
                Protect-CodexCopilotConfigBackup -BackupPath $temp
                Move-Item -LiteralPath $temp -Destination $command -Force
            } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
            # Cancellation starts at once; this bounded wait is only for cleanup,
            # never for completion of a model request or client-owned tool job.
            for ($attempt=0;$attempt -lt 60;$attempt++) {
                $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($first.Pid)" -ErrorAction Stop
                if (-not $process) { return $true }
                if ($process.CreationDate -ne $first.Created -or -not (Test-RelayServerIdentity -Process $process -Root $Root)) { throw 'PID reused during cancellation; stop refused.' }
                Start-Sleep -Milliseconds 250
            }
        }
        # Explicit manual stop only: older releases cannot understand cancellation;
        # a hung cleanup also needs a bounded exit. Revalidate each owned process.
        Stop-RelayOwnedProcessTree -Root $Root -Evidence $first
        return $true
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    $notified = $false
    do {
        $current = Get-RelayListenerEvidence -Root $Root -Port $Port
        if (-not $current) { return $true }
        if ($current.Pid -ne $first.Pid -or $current.Created -ne $first.Created) { throw 'Listener ownership changed; stop refused.' }
        if ($current.Health.activeExchanges -gt 0) {
            if (-not $notified) { Write-Host "Waiting for $($current.Health.activeExchanges) active exchange(s). No work will be force-stopped." -ForegroundColor Yellow; $notified = $true }
        }
        else {
            $idle = $true
            for ($sample = 0; $sample -lt 3; $sample++) {
                $check = Get-RelayListenerEvidence -Root $Root -Port $Port
                if (-not $check) { return $true }
                if ($check.Pid -ne $first.Pid -or $check.Created -ne $first.Created) { throw 'Listener identity changed during stop.' }
                if ($check.Health.activeExchanges -gt 0) { $idle = $false; break }
                if ($sample -lt 2) { Start-Sleep -Milliseconds 200 }
            }
            if ($idle) {
                if ($check.Health.lifecycle.control -eq 'local-file-v1') {
                    $id = [guid]::Empty
                    if (-not [guid]::TryParse([string]$check.Health.lifecycle.instanceId,[ref]$id)) { throw 'Invalid process incarnation.' }
                    $temp = Join-Path $runtime ('.relay-stop-' + [guid]::NewGuid().ToString('N'))
                    try {
                        [IO.File]::WriteAllText($temp,(@{instanceId=$id.ToString()} | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
                        Protect-CodexCopilotConfigBackup -BackupPath $temp
                        Move-Item -LiteralPath $temp -Destination $command -Force
                    } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
                    # The server rechecks admitted uploads and both protocols
                    # atomically, then cleans SDK children and releases its lease.
                    for ($attempt = 0; $attempt -lt 60; $attempt++) {
                        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($first.Pid)" -ErrorAction Stop
                        if (-not $process) { return $true }
                        if ($process.CreationDate -ne $first.Created) { throw 'PID was reused; no further stop attempted.' }
                        Start-Sleep -Milliseconds 250
                    }
                    if ($WaitSeconds -le 0 -or [DateTime]::UtcNow -ge $deadline) {
                        throw 'Graceful stop remains pending. No force-kill or restoration was attempted; run Stop & Restore again after work finishes.'
                    }
                    continue
                }
                # One-time compatibility for older servers without local control.
                # All samples above must be idle; never trust a stale PID file.
                $last = Get-RelayListenerEvidence -Root $Root -Port $Port
                if (-not $last) { return $true }
                if ($last.Pid -ne $first.Pid -or $last.Created -ne $first.Created) { throw 'Listener changed before legacy stop.' }
                if ($last.Health.activeExchanges -eq 0) {
                    Stop-Process -Id $first.Pid -Force -ErrorAction Stop
                    for ($attempt=0; $attempt -lt 40; $attempt++) {
                        if (-not (Get-CimInstance Win32_Process -Filter "ProcessId=$($first.Pid)" -ErrorAction Stop)) { return $true }
                        Start-Sleep -Milliseconds 100
                    }
                    throw 'Legacy process exit was not confirmed.'
                }
            }
        }
        if ([DateTime]::UtcNow -ge $deadline) { return $false }
        Start-Sleep -Seconds 2
    } while ($true)
}
function Stop-RelayOwnedProcessTree {
    param([string]$Root,[object]$Evidence)
    $rootProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($Evidence.Pid)" -ErrorAction Stop
    if (-not $rootProcess) { return }
    if ($rootProcess.CreationDate -ne $Evidence.Created -or -not (Test-RelayServerIdentity -Process $rootProcess -Root $Root)) { throw 'Unproven relay process; cancellation refused.' }
    $queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue($rootProcess)
    $seen=@{}
    while ($queue.Count) {
        $expected=$queue.Dequeue();$processId=[int]$expected.ProcessId
        if ($seen.ContainsKey($processId)) { continue };$seen[$processId]=$true
        $fresh=Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
        if ($fresh -and ($fresh.CreationDate -ne $expected.CreationDate -or $fresh.CommandLine -cne $expected.CommandLine -or $fresh.ParentProcessId -ne $expected.ParentProcessId)) { throw 'Owned process identity changed; no further termination attempted.' }
        # Snapshot before and after stopping the parent to catch a worker created
        # during shutdown. The creation-time boundary excludes reused parent PIDs.
        $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction Stop)
        if ($fresh) { Stop-Process -Id $processId -Force -ErrorAction Stop }
        $exited=$false
        for ($attempt=0;$attempt -lt 40;$attempt++) {
            $remaining=Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
            if (-not $remaining) { $exited=$true;break }
            if ($remaining.CreationDate -ne $expected.CreationDate) { throw 'PID reused before exit confirmation.' }
            Start-Sleep -Milliseconds 100
        }
        if (-not $exited) { throw 'Owned process exit was not confirmed.' }
        $exitBoundary=Get-Date
        $children+=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction Stop)
        foreach ($child in $children) {
            if ($child.CreationDate -ge $expected.CreationDate -and $child.CreationDate -le $exitBoundary) { $queue.Enqueue($child) }
        }
    }
    Write-Output 'Explicit cancellation stopped the verified relay process and its owned descendants. Client-owned tools were not targeted.'
}
function Get-RelayScriptProcesses {
    param([string]$Script)
    $escaped = [regex]::Escape([IO.Path]::GetFullPath($Script))
    return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.Name -in @('powershell.exe','pwsh.exe') -and
        ([string]$_.CommandLine) -match ('(?i)\s-File\s+"' + $escaped + '"(?:\s+-Port\s+\d+)?(?:\s+-Model\s+[\w.:-]+)?(?:\s+-CheckIntervalSeconds\s+\d+)?\s*$')
    })
}
function Get-RelayLocalKey {
    param([string]$Root,[switch]$Create)
    $file = Join-Path $Root 'runtime\claude-local-key.dpapi'
    Assert-RelayLocalPath -Root $Root -Path $file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        if (-not $Create) { throw 'Local Claude key is missing. Run Start Relay.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $text = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
        $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $text -AsPlainText -Force)
        $stream = [IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $data=[Text.Encoding]::UTF8.GetBytes($encrypted); $stream.Write($data,0,$data.Length) } finally { $stream.Dispose(); $text=$null }
    }
    Protect-CodexCopilotConfigBackup -BackupPath $file
    $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($file))
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ($key -notmatch '^[a-f0-9]{64}$') { throw 'Invalid local Claude key. Key was not rotated.' }
        return $key
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
}
function Repair-RelayClaudeLease {
    param([string]$Root,[int]$Port)
    $file = Join-Path $Root 'runtime\claude\gateway.owner.json'
    Assert-RelayLocalPath -Root $Root -Path $file
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
    if ((Get-Item -LiteralPath $file).Length -gt 4096) { throw 'Oversized Claude ownership receipt.' }
    $raw = [IO.File]::ReadAllText($file); $receipt = $raw | ConvertFrom-Json
    $owner = [guid]::Empty
    if ($receipt.version -ne 1 -or $receipt.pid -isnot [int] -and $receipt.pid -isnot [long] -or $receipt.pid -le 0 -or -not [guid]::TryParse([string]$receipt.owner,[ref]$owner)) { throw 'Invalid Claude ownership receipt.' }
    for ($sample=0;$sample -lt 3;$sample++) {
        $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        if (@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port).Count -or
            @($processes | Where-Object { $_.ProcessId -eq $receipt.pid -or $_.ParentProcessId -eq $receipt.pid }).Count) { throw 'Claude owner or child may still be live. History left untouched.' }
        if ([IO.File]::ReadAllText($file) -cne $raw) { throw 'Claude ownership changed.' }
        if ($sample -lt 2) { Start-Sleep -Milliseconds 200 }
    }
    $archive = Join-Path $Root ('runtime\claude\ownership-recovery\' + [guid]::NewGuid().ToString('N') + '.json')
    Assert-RelayLocalPath -Root $Root -Path $archive
    New-Item -ItemType Directory -Path (Split-Path -Parent $archive) -Force | Out-Null
    Move-Item -LiteralPath $file -Destination $archive -ErrorAction Stop
}
