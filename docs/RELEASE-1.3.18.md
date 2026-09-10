# 1.3.18 — Desktop authentication with Copilot routing

The persistent Windows provider configuration now keeps the saved ChatGPT
desktop identity available without using that identity to authenticate model
requests to the Copilot relay. The selected provider and loopback URL are
unchanged. The standalone isolated CLI launcher remains unauthenticated.

The paired settings are:

```toml
requires_openai_auth = true
experimental_bearer_token = "codex-copilot-local-only"
```

The literal bearer is deliberately nonsecret. It is not an access-control
mechanism. Never replace it with an OpenAI credential or remove it while
leaving the desktop-auth flag enabled. Existing API-key environment variables
are not required for this configuration.

## Verification

`proxy-config.test.ps1` checks creation, repair, and restoration of the paired
settings. `probe-desktop-auth.mjs` runs the installed Codex against isolated
temporary homes containing synthetic ChatGPT credentials and a local HTTP
fixture. It checks the original configuration, the unsafe flag-only control,
the paired configuration, and paired configuration without a ChatGPT login.
It requests only authentication metadata, never real credential values.
The corrected configuration must send only the placeholder and no ChatGPT
account ID on any captured request. No external model is called.

```powershell
pwsh -NoProfile -File .\proxy-config.test.ps1
npm run probe:desktop-auth -- C:\path\to\codex.exe
npm test
git diff --check
```

Validated against Codex CLI 0.153.4. Re-run the probe before applying this
configuration to a different Codex version; provider auth precedence is an
implementation behavior, not a reason to forward real credentials for testing.

## Apply and recovery

Run Repair with the existing model and port. It preserves the protected
configuration backup, recycles the watchdog, and defers relay version promotion
while active exchanges exist. Do not force-restart the live relay.

Retest browser discovery after applying. A task-specific missing-browser-route
error may still need the task/browser association reopened in the desktop app.
Do not delete website cookies or claim end-to-end browser repair solely from
an authentication-metadata test.
