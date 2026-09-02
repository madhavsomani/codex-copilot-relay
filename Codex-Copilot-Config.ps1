$script:CodexCopilotProviderId = 'github_copilot_bridge'
$script:CodexCopilotConfigBegin = '# BEGIN CODEX_COPILOT_BRIDGE MANAGED BLOCK'
$script:CodexCopilotConfigEnd = '# END CODEX_COPILOT_BRIDGE MANAGED BLOCK'
$script:CodexCopilotRestoreStatePrefix = '# CODEX_COPILOT_RESTORE_STATE_B64='
$script:CodexCopilotBackupStateProperties = @(
    'BackupPath',
    'BackupSha256',
    'BackupCreatedAt',
    'BackupMode',
    'BackupOriginalConfigExisted'
)

function Get-CodexCopilotConfigPath {
    param(
        [AllowEmptyString()]
        [string]$CodexHome = $env:CODEX_HOME,

        [AllowEmptyString()]
        [string]$UserProfile = $env:USERPROFILE
    )

    $selectedHome = if ([string]::IsNullOrWhiteSpace($CodexHome)) {
        if ([string]::IsNullOrWhiteSpace($UserProfile)) {
            throw 'Neither CODEX_HOME nor USERPROFILE is available; the Codex config path cannot be resolved safely.'
        }
        Join-Path $UserProfile '.codex'
    }
    else {
        [Environment]::ExpandEnvironmentVariables($CodexHome.Trim())
    }

    if ($selectedHome -eq '~' -or $selectedHome.StartsWith('~\') -or $selectedHome.StartsWith('~/')) {
        if ([string]::IsNullOrWhiteSpace($UserProfile)) {
            throw 'CODEX_HOME uses ~ but USERPROFILE is unavailable.'
        }
        $suffix = if ($selectedHome.Length -gt 1) { $selectedHome.Substring(2) } else { '' }
        $selectedHome = if ($suffix) { Join-Path $UserProfile $suffix } else { $UserProfile }
    }

    if (-not [IO.Path]::IsPathRooted($selectedHome)) {
        throw "CODEX_HOME must resolve to an absolute path: $selectedHome"
    }
    return [IO.Path]::GetFullPath((Join-Path $selectedHome 'config.toml'))
}

function Find-CodexTopLevelKeyIndex {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [string[]]$Lines,

        [Parameter(Mandatory)]
        [string]$Key
    )

    $escapedKey = [regex]::Escape($Key)
    for ($index = 0; $index -lt $Lines.Count; $index++) {
        $trimmed = $Lines[$index].Trim()
        if ($trimmed -match '^\[\[?.+\]\]$') {
            break
        }
        if ($trimmed -match "^$escapedKey\s*=") {
            return $index
        }
    }
    return -1
}

function Write-CodexConfigLines {
    param(
        [Parameter(Mandatory)]
        [string]$ConfigPath,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [string[]]$Lines
    )

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $text = if ($Lines.Count -gt 0) {
        ($Lines -join [Environment]::NewLine) + [Environment]::NewLine
    }
    else {
        ''
    }
    [System.IO.File]::WriteAllText($ConfigPath, $text, $utf8NoBom)
}

function Read-CodexConfigLines {
    param([Parameter(Mandatory)][string]$ConfigPath)

    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $ConfigPath) {
        foreach ($line in [System.IO.File]::ReadAllLines($ConfigPath)) {
            $lines.Add($line)
        }
    }
    return ,$lines
}

function ConvertTo-CodexCopilotRestoreStateLine {
    param([Parameter(Mandatory)][psobject]$State)

    $json = $State | ConvertTo-Json -Compress -Depth 5
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    return "$script:CodexCopilotRestoreStatePrefix$encoded"
}

function Get-CodexCopilotEmbeddedStateFromLines {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [AllowEmptyString()]
        [string[]]$Lines
    )

    $stateLine = $Lines | Where-Object { $_.StartsWith($script:CodexCopilotRestoreStatePrefix) } | Select-Object -First 1
    if (-not $stateLine) {
        return $null
    }
    try {
        $encoded = $stateLine.Substring($script:CodexCopilotRestoreStatePrefix.Length)
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
        return $json | ConvertFrom-Json
    }
    catch {
        throw 'The embedded Codex Copilot restore metadata is invalid. Refusing to edit config.toml.'
    }
}

function Get-CodexCopilotEmbeddedState {
    param([Parameter(Mandatory)][string]$ConfigPath)

    $lines = Read-CodexConfigLines -ConfigPath $ConfigPath
    return Get-CodexCopilotEmbeddedStateFromLines -Lines ([string[]]$lines.ToArray())
}

function Get-CodexCopilotFileSha256 {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "File not found while calculating SHA-256: $Path"
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Protect-CodexCopilotConfigBackup {
    param([Parameter(Mandatory)][string]$BackupPath)

    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
        throw "Config backup not found: $BackupPath"
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSecurity = Get-Acl -LiteralPath $BackupPath
    $currentRules = @($currentSecurity.Access)
    $alreadyProtected = $currentSecurity.AreAccessRulesProtected -and $currentRules.Count -eq 1
    if ($alreadyProtected) {
        try {
            $ruleSid = $currentRules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier])
            $hasFullControl = ($currentRules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl
            $alreadyProtected = $ruleSid -eq $identity.User -and
                $currentRules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                $hasFullControl
        }
        catch {
            $alreadyProtected = $false
        }
    }
    if ($alreadyProtected) {
        return
    }

    $security = [Security.AccessControl.FileSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($identity.User)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $identity.User,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow
    )
    $security.AddAccessRule($rule)
    Set-Acl -LiteralPath $BackupPath -AclObject $security
}

function New-CodexCopilotConfigBackup {
    param(
        [Parameter(Mandatory)][string]$ConfigPath,
        [Parameter(Mandatory)][string]$BackupPath,
        [psobject]$ManagedState
    )

    $backupDirectory = Split-Path -Parent $BackupPath
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $temporaryBackup = Join-Path $backupDirectory ('.config-backup-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $originalConfigExisted = Test-Path -LiteralPath $ConfigPath -PathType Leaf
    $mode = 'ExactPreEnableCopy'

    try {
        if ($ManagedState) {
            if (-not $originalConfigExisted) {
                throw 'Cannot migrate a full config backup because the managed config.toml is missing.'
            }
            [IO.File]::Copy($ConfigPath, $temporaryBackup, $true)
            Restore-CodexCopilotConfig -ConfigPath $temporaryBackup -State $ManagedState | Out-Null
            $mode = 'ReconstructedLegacyBaseline'
            $originalConfigExisted = $true
        }
        elseif ($originalConfigExisted) {
            [IO.File]::Copy($ConfigPath, $temporaryBackup, $true)
        }
        else {
            [IO.File]::WriteAllBytes($temporaryBackup, [byte[]]@())
        }

        [IO.File]::Copy($temporaryBackup, $BackupPath, $true)
        Protect-CodexCopilotConfigBackup -BackupPath $BackupPath
    }
    finally {
        Remove-Item -LiteralPath $temporaryBackup -Force -ErrorAction SilentlyContinue
    }

    return [pscustomobject][ordered]@{
        BackupPath = [IO.Path]::GetFullPath($BackupPath)
        BackupSha256 = Get-CodexCopilotFileSha256 -Path $BackupPath
        BackupCreatedAt = (Get-Date).ToUniversalTime().ToString('o')
        BackupMode = $mode
        BackupOriginalConfigExisted = [bool]$originalConfigExisted
    }
}

function Add-CodexCopilotBackupToState {
    param(
        [Parameter(Mandatory)][psobject]$State,
        [Parameter(Mandatory)][psobject]$Backup
    )

    foreach ($propertyName in $script:CodexCopilotBackupStateProperties) {
        $value = $Backup.$propertyName
        $State | Add-Member -MemberType NoteProperty -Name $propertyName -Value $value -Force
    }
    return $State
}

function Assert-CodexCopilotConfigBackup {
    param([Parameter(Mandatory)][psobject]$State)

    $propertyNames = @($State.PSObject.Properties.Name)
    foreach ($required in @('BackupPath', 'BackupSha256', 'BackupOriginalConfigExisted')) {
        if ($propertyNames -notcontains $required) {
            throw "The bridge state does not contain the required full-config backup field '$required'."
        }
    }

    $backupPath = [string]$State.BackupPath
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        throw "The protected full-config backup is missing: $backupPath"
    }
    $actualHash = Get-CodexCopilotFileSha256 -Path $backupPath
    $expectedHash = ([string]$State.BackupSha256).ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "The protected full-config backup failed its SHA-256 check: $backupPath"
    }
    return $true
}

function Restore-CodexCopilotConfigFromBackup {
    param(
        [Parameter(Mandatory)][string]$ConfigPath,
        [Parameter(Mandatory)][psobject]$State
    )

    Assert-CodexCopilotConfigBackup -State $State | Out-Null
    if (-not [bool]$State.BackupOriginalConfigExisted) {
        Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
        return
    }

    $configDirectory = Split-Path -Parent $ConfigPath
    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    $temporaryRestore = Join-Path $configDirectory ('.config-restore-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::Copy([string]$State.BackupPath, $temporaryRestore, $true)
        if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
            [IO.File]::Copy($temporaryRestore, $ConfigPath, $true)
            Remove-Item -LiteralPath $temporaryRestore -Force
        }
        else {
            [IO.File]::Move($temporaryRestore, $ConfigPath)
        }
    }
    finally {
        Remove-Item -LiteralPath $temporaryRestore -Force -ErrorAction SilentlyContinue
    }

    $restoredHash = Get-CodexCopilotFileSha256 -Path $ConfigPath
    if ($restoredHash -ne ([string]$State.BackupSha256).ToLowerInvariant()) {
        throw 'The restored config.toml does not match the protected full-config backup.'
    }
}

function Set-CodexCopilotConfig {
    param(
        [Parameter(Mandatory)]
        [string]$ConfigPath,

        [Parameter(Mandatory)]
        [int]$Port,

        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
        [string]$Model,

        [psobject]$RestoreState
    )

    $configDirectory = Split-Path -Parent $ConfigPath
    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    $lines = Read-CodexConfigLines -ConfigPath $ConfigPath

    $providerHeader = "[model_providers.$script:CodexCopilotProviderId]"
    $existingProviderHeader = $lines | Where-Object {
        $_.Trim() -eq $providerHeader
    }
    $managedBeginIndex = $lines.IndexOf($script:CodexCopilotConfigBegin)
    $managedEndIndex = $lines.IndexOf($script:CodexCopilotConfigEnd)
    $embeddedState = Get-CodexCopilotEmbeddedStateFromLines -Lines ([string[]]$lines.ToArray())

    if ($existingProviderHeader -and ($managedBeginIndex -lt 0 -or $managedEndIndex -lt $managedBeginIndex)) {
        throw "The provider id '$script:CodexCopilotProviderId' already exists without a managed block. Refusing to overwrite it."
    }

    if ($managedBeginIndex -ge 0 -or $managedEndIndex -ge 0) {
        if ($managedBeginIndex -lt 0 -or $managedEndIndex -lt $managedBeginIndex) {
            throw 'The Codex Copilot managed block is incomplete. Refusing to edit config.toml.'
        }
        if (-not $RestoreState -and -not $embeddedState) {
            throw 'The managed provider block has no restore metadata and no state file is available. Refusing an unsafe repair.'
        }
        $lines.RemoveRange($managedBeginIndex, $managedEndIndex - $managedBeginIndex + 1)
        while ($managedBeginIndex -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$managedBeginIndex])) {
            $lines.RemoveAt($managedBeginIndex)
        }
    }

    $modelLine = "model = `"$Model`""
    $providerLine = "model_provider = `"$script:CodexCopilotProviderId`""
    $modelIndex = Find-CodexTopLevelKeyIndex -Lines ([string[]]$lines.ToArray()) -Key 'model'
    $currentModelLine = if ($modelIndex -ge 0) { $lines[$modelIndex] } else { $null }
    $savedState = if ($RestoreState) { $RestoreState } else { $embeddedState }
    $originalModelLine = if ($savedState) { $savedState.OriginalModelLine } else { $currentModelLine }
    if ($modelIndex -ge 0) {
        $lines[$modelIndex] = $modelLine
    }
    else {
        $lines.Insert(0, $modelLine)
    }

    $providerIndex = Find-CodexTopLevelKeyIndex -Lines ([string[]]$lines.ToArray()) -Key 'model_provider'
    $currentProviderLine = if ($providerIndex -ge 0) { $lines[$providerIndex] } else { $null }
    $originalProviderLine = if ($savedState) { $savedState.OriginalProviderLine } else { $currentProviderLine }
    if ($providerIndex -ge 0) {
        $lines[$providerIndex] = $providerLine
    }
    else {
        $lines.Insert(1, $providerLine)
    }

    $stateProperties = [ordered]@{
        ConfigPath = $ConfigPath
        ProviderId = $script:CodexCopilotProviderId
        Model = $Model
        Port = $Port
        OriginalModelLine = $originalModelLine
        OriginalProviderLine = $originalProviderLine
        ManagedModelLine = $modelLine
        ManagedProviderLine = $providerLine
    }
    if ($savedState) {
        $savedPropertyNames = @($savedState.PSObject.Properties.Name)
        foreach ($propertyName in $script:CodexCopilotBackupStateProperties) {
            if ($savedPropertyNames -contains $propertyName) {
                $stateProperties[$propertyName] = $savedState.$propertyName
            }
        }
    }
    $state = [pscustomobject]$stateProperties

    if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) {
        $lines.Add('')
    }
    foreach ($line in @(
        $script:CodexCopilotConfigBegin,
        (ConvertTo-CodexCopilotRestoreStateLine -State $state),
        $providerHeader,
        'name = "GitHub Copilot local bridge"',
        "base_url = `"http://127.0.0.1:$Port/v1`"",
        "wire_api = `"responses`"",
        'requires_openai_auth = false',
        'request_max_retries = 0',
        'stream_max_retries = 3',
        'stream_idle_timeout_ms = 900000',
        $script:CodexCopilotConfigEnd
    )) {
        $lines.Add($line)
    }
    Write-CodexConfigLines -ConfigPath $ConfigPath -Lines ([string[]]$lines.ToArray())
    return $state
}

function Restore-CodexCopilotConfig {
    param(
        [Parameter(Mandatory)]
        [string]$ConfigPath,

        [Parameter(Mandatory)]
        [psobject]$State
    )

    $lines = Read-CodexConfigLines -ConfigPath $ConfigPath
    $managedBeginIndex = $lines.IndexOf($script:CodexCopilotConfigBegin)
    $managedEndIndex = $lines.IndexOf($script:CodexCopilotConfigEnd)
    if ($managedBeginIndex -ge 0 -or $managedEndIndex -ge 0) {
        if ($managedBeginIndex -lt 0 -or $managedEndIndex -lt $managedBeginIndex) {
            throw 'The Codex Copilot managed block is incomplete. Refusing to edit config.toml.'
        }
        $lines.RemoveRange($managedBeginIndex, $managedEndIndex - $managedBeginIndex + 1)
        while ($managedBeginIndex -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$managedBeginIndex])) {
            $lines.RemoveAt($managedBeginIndex)
        }
    }

    $warnings = [System.Collections.Generic.List[string]]::new()
    $modelIndex = Find-CodexTopLevelKeyIndex -Lines ([string[]]$lines.ToArray()) -Key 'model'
    if ($null -ne $State.OriginalModelLine) {
        if ($modelIndex -ge 0 -and $lines[$modelIndex] -eq $State.ManagedModelLine) {
            $lines[$modelIndex] = [string]$State.OriginalModelLine
        }
        else {
            $warnings.Add('model was changed after proxy enablement; leaving the current value untouched.')
        }
    }
    elseif ($modelIndex -ge 0 -and $lines[$modelIndex] -eq $State.ManagedModelLine) {
        $lines.RemoveAt($modelIndex)
    }

    $providerIndex = Find-CodexTopLevelKeyIndex -Lines ([string[]]$lines.ToArray()) -Key 'model_provider'
    if ($null -ne $State.OriginalProviderLine) {
        if ($providerIndex -ge 0 -and $lines[$providerIndex] -eq $State.ManagedProviderLine) {
            $lines[$providerIndex] = [string]$State.OriginalProviderLine
        }
        else {
            $warnings.Add('model_provider was changed after proxy enablement; leaving the current value untouched.')
        }
    }
    elseif ($providerIndex -ge 0 -and $lines[$providerIndex] -eq $State.ManagedProviderLine) {
        $lines.RemoveAt($providerIndex)
    }

    Write-CodexConfigLines -ConfigPath $ConfigPath -Lines ([string[]]$lines.ToArray())
    return $warnings.ToArray()
}

function Get-CodexCopilotStartupShortcutPath {
    return Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Codex Copilot Local Bridge.lnk'
}

function Get-CodexCopilotScheduledTaskName {
    return 'Codex Copilot Local Bridge Watchdog'
}

function Install-CodexCopilotStartupShortcut {
    param(
        [Parameter(Mandatory)]
        [string]$StartScript,

        [Parameter(Mandatory)]
        [int]$Port,

        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
        [string]$Model
    )

    $shortcutPath = Get-CodexCopilotStartupShortcutPath
    $startupDirectory = Split-Path -Parent $shortcutPath
    New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        if ($existing.TargetPath -and $existing.TargetPath -ne $powerShell) {
            throw "Startup shortcut already exists and is not managed by this bridge: $shortcutPath"
        }
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShell
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`" -Port $Port -Model $Model"
    $shortcut.WorkingDirectory = Split-Path -Parent $StartScript
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Keeps the loopback Codex GitHub Copilot Responses bridge healthy.'
    $shortcut.Save()
    return $shortcutPath
}

function Remove-CodexCopilotStartupShortcut {
    param(
        [Parameter(Mandatory)]
        [string]$StartScript,

        [string]$ShortcutPath = (Get-CodexCopilotStartupShortcutPath)
    )

    if (-not (Test-Path -LiteralPath $ShortcutPath)) {
        return $false
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $resolvedStartScript = [IO.Path]::GetFullPath($StartScript)
    $targetArguments = [string]$shortcut.Arguments
    if ($shortcut.TargetPath -and $shortcut.TargetPath -ne (Get-Command powershell.exe).Source) {
        throw "Startup shortcut is not managed by this bridge: $ShortcutPath"
    }
    if ($targetArguments -notlike "*`"$resolvedStartScript`"*") {
        throw "Startup shortcut does not target this bridge: $ShortcutPath"
    }
    Remove-Item -LiteralPath $ShortcutPath -Force
    return $true
}

function Test-CodexCopilotTaskTargetsScript {
    param(
        [Parameter(Mandatory)][psobject]$Task,
        [Parameter(Mandatory)][string]$ScriptPath
    )

    $resolvedScript = [IO.Path]::GetFullPath($ScriptPath)
    return [bool]($Task.Actions | Where-Object {
        ([string]$_.Execute) -like '*powershell.exe' -and
        ([string]$_.Arguments) -like "*`"$resolvedScript`"*"
    })
}

function Install-CodexCopilotAutoStart {
    param(
        [Parameter(Mandatory)][string]$WatchScript,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
        [string]$Model
    )

    $resolvedWatchScript = [IO.Path]::GetFullPath($WatchScript)
    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $taskName = Get-CodexCopilotScheduledTaskName
    try {
        if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
            throw 'Scheduled Tasks cmdlets are unavailable.'
        }
        $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existingTask -and -not (Test-CodexCopilotTaskTargetsScript -Task $existingTask -ScriptPath $resolvedWatchScript)) {
            throw "Scheduled task '$taskName' exists but is not managed by this bridge."
        }

        $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$resolvedWatchScript`" -Port $Port -Model $Model"
        $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory (Split-Path -Parent $resolvedWatchScript)
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -MultipleInstances IgnoreNew `
            -RestartCount 10 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero)
        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description 'Keeps the local Codex GitHub Copilot Responses bridge healthy.' `
            -Force | Out-Null

        $startupPath = Get-CodexCopilotStartupShortcutPath
        if (Test-Path -LiteralPath $startupPath) {
            Remove-CodexCopilotStartupShortcut -StartScript $resolvedWatchScript -ShortcutPath $startupPath | Out-Null
        }
        return [pscustomobject]@{ Mode = 'ScheduledTask'; Name = $taskName }
    }
    catch {
        Write-Warning "Scheduled-task auto-recovery was unavailable: $($_.Exception.Message) Falling back to the per-user Startup folder."
        $shortcutPath = Install-CodexCopilotStartupShortcut -StartScript $resolvedWatchScript -Port $Port -Model $Model
        return [pscustomobject]@{ Mode = 'StartupShortcut'; Name = $shortcutPath }
    }
}

function Start-CodexCopilotAutoStart {
    param(
        [Parameter(Mandatory)][string]$WatchScript,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
        [string]$Model,
        [switch]$RestartRunning
    )

    $taskName = Get-CodexCopilotScheduledTaskName
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task -and (Test-CodexCopilotTaskTargetsScript -Task $task -ScriptPath $WatchScript)) {
        if ($RestartRunning -and $task.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $taskName
            for ($attempt = 0; $attempt -lt 40; $attempt++) {
                Start-Sleep -Milliseconds 100
                $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
                if (-not $task -or $task.State -ne 'Running') {
                    break
                }
            }
            if (-not $task) {
                throw "Scheduled task '$taskName' disappeared while its watchdog was being refreshed."
            }
            if ($task.State -eq 'Running') {
                throw "Scheduled task '$taskName' did not stop before its watchdog refresh."
            }
        }
        if ($task.State -ne 'Running') {
            Start-ScheduledTask -TaskName $taskName
        }
        return 'ScheduledTask'
    }

    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WatchScript`" -Port $Port -Model $Model"
    Start-Process -FilePath $powerShell -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    return 'Process'
}

function Remove-CodexCopilotAutoStart {
    param([Parameter(Mandatory)][string]$WatchScript)

    $removed = [System.Collections.Generic.List[string]]::new()
    $taskName = Get-CodexCopilotScheduledTaskName
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        if (-not (Test-CodexCopilotTaskTargetsScript -Task $task -ScriptPath $WatchScript)) {
            throw "Scheduled task '$taskName' is not managed by this bridge. Refusing to remove it."
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        $removed.Add("Scheduled task: $taskName")
    }

    $startupPath = Get-CodexCopilotStartupShortcutPath
    if (Test-Path -LiteralPath $startupPath) {
        if (Remove-CodexCopilotStartupShortcut -StartScript $WatchScript -ShortcutPath $startupPath) {
            $removed.Add("Startup shortcut: $startupPath")
        }
    }
    return $removed.ToArray()
}

function New-CodexCopilotDesktopShortcut {
    param(
        [Parameter(Mandatory)][string]$ShortcutPath,
        [Parameter(Mandatory)][string]$ScriptPath,
        [string]$ScriptArguments,
        [switch]$KeepOpen,
        [Parameter(Mandatory)][string]$Description
    )

    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $resolvedScript = [IO.Path]::GetFullPath($ScriptPath)
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $ShortcutPath) {
        $existing = $shell.CreateShortcut($ShortcutPath)
        if ($existing.TargetPath -ne $powerShell -or ([string]$existing.Arguments) -notlike "*`"$resolvedScript`"*") {
            throw "Desktop shortcut exists but is not managed by this bridge: $ShortcutPath"
        }
    }
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $powerShell
    $suffix = if ($ScriptArguments) { " $ScriptArguments" } else { '' }
    $noExit = if ($KeepOpen) { ' -NoExit' } else { '' }
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass$noExit -File `"$resolvedScript`"$suffix"
    $shortcut.WorkingDirectory = Split-Path -Parent $resolvedScript
    $shortcut.WindowStyle = 1
    $shortcut.Description = $Description
    $shortcut.Save()
    return $ShortcutPath
}

function Install-CodexCopilotDesktopShortcuts {
    param(
        [Parameter(Mandatory)][string]$RepairScript,
        [Parameter(Mandatory)][string]$DisableScript,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
        [string]$Model
    )

    $desktop = [Environment]::GetFolderPath('Desktop')
    $repairPath = Join-Path $desktop 'Start or Repair Codex Copilot Bridge.lnk'
    $restorePath = Join-Path $desktop 'Restore Normal Codex (Disable Copilot Bridge).lnk'
    New-CodexCopilotDesktopShortcut `
        -ShortcutPath $repairPath `
        -ScriptPath $RepairScript `
        -ScriptArguments "-Port $Port -Model $Model" `
        -Description 'Starts or repairs the Codex GitHub Copilot bridge, watchdog, visible event console, and dashboard.' | Out-Null
    New-CodexCopilotDesktopShortcut `
        -ShortcutPath $restorePath `
        -ScriptPath $DisableScript `
        -KeepOpen `
        -Description 'Restores the previous Codex provider and stops the Copilot bridge.' | Out-Null
    return @($repairPath, $restorePath)
}
