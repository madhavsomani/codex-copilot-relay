$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sdk-process-health.ps1')
$started = [datetime]'2026-01-01T12:00:00'
$relay = [pscustomobject]@{ Name='node.exe'; ProcessId=1234; CommandLine='node C:\relay\server.mjs'; CreationDate=$started }
$health = [pscustomobject]@{ provider='github-copilot-sdk'; ok=$true; activeExchanges=192 }
$params = @{
    Health=$health; RelayProcess=$relay; Children=@(); ServerPath='C:\relay\server.mjs'; ListenerPid=1234
    CrashLogText='[CLI subprocess] FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'
    CrashLogWrittenAt=$started.AddHours(2)
}
if (-not (Test-LegacyDeadCopilotEvidence @params)) { throw 'Confirmed dead legacy worker was not recognized.' }
$params.Children=@([pscustomobject]@{Name='copilot.exe'})
if (Test-LegacyDeadCopilotEvidence @params) { throw 'A live worker must block forced recovery.' }
$params.Children=@()
$params.ListenerPid=9999
if (Test-LegacyDeadCopilotEvidence @params) { throw 'A foreign listener must block forced recovery.' }
$params.ListenerPid=1234
$params.CrashLogWrittenAt=$started.AddHours(-1)
if (Test-LegacyDeadCopilotEvidence @params) { throw 'An old crash log must not authorize recovery.' }
$params.CrashLogWrittenAt=$started.AddHours(2)
$params.CrashLogText='Unrelated error'
if (Test-LegacyDeadCopilotEvidence @params) { throw 'Missing fatal CLI evidence must block recovery.' }
$params.CrashLogText='[CLI subprocess] FATAL ERROR: JavaScript heap out of memory'
$health | Add-Member -NotePropertyName sdk -NotePropertyValue ([pscustomobject]@{state='ready'})
if (Test-LegacyDeadCopilotEvidence @params) { throw 'Supervised SDKs must use their own recovery path.' }
'LEGACY_DEAD_SDK_RECOVERY_GUARDS_OK'
