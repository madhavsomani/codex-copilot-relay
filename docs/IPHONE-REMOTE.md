# Continue a Copilot-backed desktop task from iPhone

Use **Remote inside the ChatGPT iOS app**, not a public connection to this relay.
OpenAI owns sign-in, device pairing, the Remote connection and mobile UI. The
relay replaces supported model inference on the Windows host; it does not
replace those account services or turn the iPhone app into a Copilot client.

The intended path for a paired desktop task is:

```text
ChatGPT iPhone Remote
  -> OpenAI's authenticated Remote connection
  -> the same desktop task on your awake Windows host
  -> local Copilot relay -> GitHub Copilot model

Desktop search/image feature -> native Codex/OpenAI helper
Explicit public API/voice request -> configured OpenAI Platform service
```

Ordinary mobile ChatGPT conversations and cloud tasks do not inherit the
Windows relay's provider configuration. They continue using their own OpenAI
services. Using Remote is also different from using the mobile voice mode.

## Keep the existing connection

1. Update ChatGPT on iPhone and the Codex/ChatGPT desktop app on Windows. Use
   the **same OpenAI account and workspace** on both.
2. Open **Remote** on the phone and choose the Windows PC where the relay runs.
   Continue an existing desktop task there.
3. Keep the PC awake, online and the desktop app running. The relay must also
   remain running for Copilot-backed inference. Do not sign out merely to
   change the model provider: OpenAI documents that sign-out disables Remote
   Control even though pairings are retained.
4. If the host is missing, use desktop **Settings -> Connections -> Control
   this Mac or PC -> Set up / Add**, approve the app's Remote setup, and scan
   its QR code with the phone. Complete any account/workspace verification.
   Pairing and workspace policy must be handled through the official UI.

Keep existing pairings; there is no need to unpair/reinstall as part of a relay
update. Remote account/workspace availability and managed policy still apply.
For foreground Windows Computer Use, the host must also be unlocked and
available for the task. Do not weaken account or device security to work around
an availability error.

## Prove this installation works end to end

Official documentation describes Remote and custom providers separately. It
does **not explicitly certify this unofficial Copilot relay with iPhone Remote**.
An auth/config test is necessary evidence, not an end-to-end phone test.

From iPhone **Remote**, open the same desktop task and send:

> Remote connection test: reply REMOTE_COPILOT_OK. No tools needed.

Then verify all three conditions:

- The prompt and reply appear in that same task on both phone and desktop.
- The host's relay dashboard records the matching-time model call as
  **GitHub Copilot**, with the requested/selected model you expected.
- A second follow-up from the phone reaches that task and receives a reply.

Do not treat a paired-device flag, a QR code, an online host, or a healthy relay
alone as proof. If the host appears but the turn fails, keep the error text and
time; distinguish a Remote/account failure from a relay model/streaming failure.

## What the relay preserves

The Windows config helper keeps these settings paired:

```toml
requires_openai_auth = true
experimental_bearer_token = "codex-copilot-local-only"
```

The first keeps desktop ChatGPT identity available. The second is a **nonsecret
local placeholder**, preventing the model request from using the ChatGPT login
credential at the relay. It does not protect a network-exposed server. Do not
replace it with a real credential, or remove it while retaining the first flag.

Repair manages the model-provider block and documented model/search settings.
It must not modify the ChatGPT account-service endpoint, credential storage,
desktop pairing state, or an administrator's Remote policy. The normal restore
path restores the protected original TOML; app pairing state is separate. A
full TOML restore still returns to the old backup, so later unrelated TOML edits
need review before using it.

Regression checks (no iPhone or real credentials used):

```powershell
powershell -NoProfile -File .\remote-compatibility.test.ps1
node probe-desktop-auth.mjs C:\path\to\installed\codex.exe
```

The installed-engine probe verifies desktop auth metadata and placeholder-only
model requests against synthetic accounts. It must be rerun after Codex upgrades.

## Limits and visibility

- Never port-forward `4144`, bind it to `0.0.0.0`, or put it behind a public
  tunnel. The official Remote service provides the phone connection; the relay
  and its dashboard remain loopback-only on Windows.
- Copilot remains the default model provider. OpenAI is used for designated
  native features and explicitly routed services, **not automatic model fallback**.
- No Platform API key is needed merely to use official iPhone Remote. Optional
  public API/Realtime features have their own setup and billing.
- Dashboard provider usage covers calls the relay actually sees. OpenAI sign-in,
  Remote transport, normal mobile chats, and app-owned voice sessions are not
  model calls passing through this relay and must not be shown as metered here.
- OpenAI image/search/voice limits do not deliberately disable independent
  Copilot work. The relay cannot bypass an OpenAI account/workspace restriction
  that blocks the Remote connection or the desktop app itself.

Sources checked September 10, 2026:
[official Remote setup](https://learn.chatgpt.com/docs/remote-connections),
[custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers),
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
