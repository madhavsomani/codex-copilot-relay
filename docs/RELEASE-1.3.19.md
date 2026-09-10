# 1.3.19 — Optional native search and image tools

Codex's built-in image tool was visible after the desktop-auth fix, but it used
the active custom provider's Images endpoint. The relay had no such endpoint and
returned 404. This release adds generations and reference-image edits, backed by
the installed native Codex engine using GPT Image 2.

An explicit native-tool opt-in also enables live hosted search. Copilot receives
a search declaration; the relay executes that operation through native Codex and
streams actual search actions back as web_search_call items. The Copilot answer
can cite explicit source URLs. The generated model catalog and web_search setting
are synchronized together and restored through the existing protected backup.

The main conversation remains on Copilot. Native tools consume separate
OpenAI/ChatGPT usage, with an additional native model turn per operation. They
are disabled by default for other installations. The relay never reads native
login credentials. Two native jobs may run concurrently; each is bounded and
cancelled with its caller. See [full limits and setup](NATIVE-TOOLS.md).

The wrapper also directs the model to continue routine authorized work without
redundant conversational permission requests. Actual outer approval requirements
and missing user decisions remain authoritative.

This release includes the previously verified 1.3.18 desktop-auth configuration
and its synthetic credential-isolation probe.

## Verification

- 121 automated Node tests pass.
- PowerShell configuration, paired-auth, search opt-in, rollback and backup hash
  checks pass.
- Native search through the isolated relay produces real search actions, source
  URLs and a terminal Responses event.
- Installed Codex 0.153.4 recognizes and completes the relay's native search when
  given the updated model catalog.
- Images generations and edits return real PNGs. Visual inspection confirms the
  edit changes the synthetic robot's blue book to red while retaining the scene.
- Existing parallel outer-tool live probe passes.
- Synthetic desktop-auth probe passes: only the nonsecret placeholder, no account
  token or account header, reaches the local provider.

Live evidence is stored locally under ignored runtime/native-probe-* folders.
There is no claim of full native parity: structured-output enforcement, other
hosted tools and native opaque citation identity remain outside this change.
