[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$version=[string](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Launcher requires a numeric release version.' }
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The Windows .NET Framework 4 C# compiler is required. No compiler is downloaded automatically.' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory=$PSScriptRoot }
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$target=Join-Path $output 'Copilot-Relay.exe'
Assert-RelayLocalPath -Root $output -Path $target
if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target).VersionInfo.ProductName -ne 'Codex Copilot Relay Launcher') { throw 'Existing EXE is not a known relay launcher; it was left untouched.' }
}
$stage=Join-Path $output ('.relay-launcher-build-'+[guid]::NewGuid().ToString('N'))
Assert-RelayLocalPath -Root $output -Path $stage
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $metadata=Join-Path $stage 'AssemblyInfo.cs'
    $attributes=@(
        'using System.Reflection;'
        '[assembly: AssemblyTitle("Copilot Relay")]'
        '[assembly: AssemblyProduct("Codex Copilot Relay Launcher")]'
        '[assembly: AssemblyDescription("Windows controller for the installed Codex and Claude Copilot relay; not a standalone SDK bundle")]'
        "[assembly: AssemblyVersion(`"$version.0`")]"
        "[assembly: AssemblyFileVersion(`"$version.0`")]"
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($metadata,$attributes,[Text.UTF8Encoding]::new($false))
    $candidate=Join-Path $stage 'Copilot-Relay.exe'
    & $compiler /nologo /target:exe /platform:anycpu /optimize+ /debug- /reference:System.Web.Extensions.dll "/out:$candidate" $metadata (Join-Path $PSScriptRoot 'launcher\RelayLauncher.cs')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $candidate)) { throw 'Launcher compilation failed; existing EXE was not replaced.' }
    # Backup only a known existing binary. Never package the checkout or runtime.
    if (Test-Path -LiteralPath $target) {
        $backup=Join-Path $output ('runtime\launcher-backups\'+[guid]::NewGuid().ToString('N'))
        Assert-RelayLocalPath -Root $output -Path $backup
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    }
    Copy-Item -LiteralPath $candidate -Destination $target -Force -ErrorAction Stop
    Write-Output "Built launcher $version`: $target"
    Write-Output "SHA256: $((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)"
    Write-Output 'Source/dependencies remain beside the EXE. No runtime, history, keys, or SDK binaries are embedded.'
} finally {
    $resolved=[IO.Path]::GetFullPath($stage)
    if (-not $resolved.StartsWith($output.TrimEnd('\')+'\.relay-launcher-build-',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build cleanup path.' }
    Assert-RelayLocalPath -Root $output -Path $resolved
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
