# First run: guided connection center

Use an unmodified stock Codex installation. The relay changes model routing;
Codex still owns memory, skills, tools, filesystem access and approvals.

1. Install [Node.js 22 LTS or newer](https://nodejs.org/en/download) and
   [Codex for Windows](https://developers.openai.com/codex/app/windows/).
   Git is needed to clone; downloading and extracting the repository ZIP also works.
2. Open PowerShell in the repository folder and run `npm run setup`.
   It opens `http://127.0.0.1:4143/dashboard/setup` without requiring `npm ci`.
   Leave this terminal open; use another terminal for the remaining commands.
3. Run `npm ci`. Sign in to the bundled official Copilot CLI:
   `node node_modules/@github/copilot/npm-loader.js login`.
   See [Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli).
   You need Copilot access and an account-available model.
4. Refresh the connection center. Its checks are cached for up to 30 seconds.
   `node probe-setup-auth.mjs` also checks authentication/model access without
   performing a model inference. It returns no account tokens.
5. Enable routing using the existing lifecycle entrypoint:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Repair-Codex-CopilotProxy.ps1 -Port 4144 -Model gpt-6-astra
   ```

   Substitute a model listed for your account. The command creates/uses the
   protected original-config backup, enables routing, and starts the watchdog.
   It stages a runtime update until idle when an existing relay has active work.
6. Reopen the Codex task and send an ordinary prompt. Visit
   `http://127.0.0.1:4144/dashboard` to inspect connection cards and traffic.
   A prompt uses Copilot allowance; the read-only setup checks do not.

## What the cards mean

- **Copilot connected:** authenticated SDK plus accessible models; not proof of
  remaining quota or successful inference.
- **Codex configured:** the expected provider and local endpoint are in TOML.
- **Recent Codex traffic:** a Codex-labelled request header was observed within
  two minutes. This is an observation, not cryptographic app authentication.
- **Backup verified:** the saved original configuration passes the SHA-256 check.

The center is guided and read-only. It does not install software, perform login,
change TOML, launch model inference, or replace the Codex executable. Those
steps remain explicit local commands; it is not a one-click installer.
Closing the setup portal does not stop the relay.

## Restore or repair

Use **Restore Normal Codex** on the desktop, or `./Disable-Codex-CopilotProxy.ps1`,
to stop the managed relay/watchdog and restore the verified original TOML.
This restores the saved file exactly, not a merge with later unrelated edits.
Copy any later configuration changes you want to preserve before restoring.
Use **Start / Repair Codex Copilot Relay** to enable it again. Do not terminate
a relay with active exchanges: their in-memory tool continuations cannot survive.

## Optional features

[Native images](NATIVE-TOOLS.md) are explicitly enabled and use separate OpenAI
allowance for both image generation and the helper turn. Native OpenAI search
is removed. Browser and connector search remain available through Codex tools.
The [public Platform gateway](HYBRID-SETUP.md) is a separate opt-in, not an
automatic fallback. [Native voice](NATIVE-VOICE.md) is unsupported with the
tested stock custom-provider configuration. No patched engine is required or shipped.

Keep setup and relay endpoints on loopback. Do not expose them to your LAN or
internet, and never paste login tokens into chat, the dashboard or this repository.
