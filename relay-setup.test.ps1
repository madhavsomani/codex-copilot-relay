$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Setup.ps1')
$offline=Get-RelaySetupInstructions
if ($offline -notmatch 'NOT VERIFIED' -or $offline -notmatch 'NOT READY') { throw 'Offline guide invented readiness.' }
$customPort=Get-RelaySetupInstructions -Port 54321
if (-not $customPort.Contains('http://127.0.0.1:54321/claude') -or $customPort.Contains('127.0.0.1:4144')) { throw 'Guide ignored the configured port.' }
$health=[pscustomobject]@{version='1.3.69';model='gpt-6.1-sol';unified=$true;compatibility=@{defaultReasoningEffort='xhigh'};claude=@{sdkState='ready';models=@('claude-opus-5-5',"claude-bad`r`nPRIVATE",'gpt-not-claude')};key='PRIVATE_KEY';token='PRIVATE_TOKEN'}
$guide=Get-RelaySetupInstructions -Health $health -CodexConfigured $true
foreach($expected in @('CONFIGURED','GATEWAY: READY','Static API key','Bearer','Key: hidden','claude-opus-5-5','gpt-6.1-sol / xhigh','Commands: setup','Stop & Restore','normal sign-in','not restoration')) {
    if (-not $guide.Contains($expected)) { throw ('Guide omitted: '+$expected) }
}
if ($guide -match 'PRIVATE|gpt-not-claude') { throw 'Untrusted metadata entered the guide.' }
$console=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Show-Codex-CopilotGateway.ps1'))
foreach($command in @('setup','models','key','status')) {
    if (-not $console.Contains("'$command' {")) { throw 'Advertised terminal command is missing.' }
}
if ($console -notmatch 'IsOutputRedirected' -or $console -match '-Tail 15') { throw 'Key output or first-frame behavior regressed.' }
Write-Output 'SETUP_GUIDE_READINESS_MODEL_FILTERING_COMMANDS_NO_SECRET_DISCLOSURE_OK'
