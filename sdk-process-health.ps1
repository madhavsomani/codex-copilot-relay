function Test-LegacyDeadCopilotEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Health,
        [Parameter(Mandatory)]$RelayProcess,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Children,
        [Parameter(Mandatory)][string]$ServerPath,
        [Parameter(Mandatory)][int]$ListenerPid,
        [Parameter(Mandatory)][AllowEmptyString()][string]$CrashLogText,
        [Parameter(Mandatory)][datetime]$CrashLogWrittenAt
    )
    # This exception is only for pre-supervisor releases: a live parent, a fatal
    # CLI OOM after that parent's startup, and no remaining worker subprocess.
    # A nonzero exchange counter alone is never evidence of a dead backend.
    if ($Health.PSObject.Properties.Name -contains 'sdk') { return $false }
    if ($Health.provider -ne 'github-copilot-sdk') { return $false }
    if ($RelayProcess.Name -ne 'node.exe' -or $RelayProcess.ProcessId -ne $ListenerPid) { return $false }
    if (([string]$RelayProcess.CommandLine) -notlike "*$ServerPath*") { return $false }
    if ($CrashLogWrittenAt -lt [datetime]$RelayProcess.CreationDate) { return $false }
    if ($CrashLogText -notmatch '\[CLI subprocess\].*FATAL ERROR:.*JavaScript heap out of memory') { return $false }
    if (@($Children | Where-Object { $_.Name -ne 'conhost.exe' }).Count -gt 0) { return $false }
    return $true
}
