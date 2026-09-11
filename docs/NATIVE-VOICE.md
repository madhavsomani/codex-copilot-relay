# Native Codex voice: unsupported with the relay

The relay supports **unmodified stock Codex**. It does not ship or install a
custom Codex engine. The earlier isolated voice experiment was not installed
and is excluded from releases.

On tested Codex 0.153.4, native voice call setup inherits the custom provider
URL and authentication. It reaches `/v1/live` on the relay, which cannot serve
that native protocol. A URL-only override retains the relay placeholder token.

Do not remove the model bearer override, extract account credentials or copy
login tokens into the relay. The optional public Platform Realtime transport
is a different, separately billed service; it does not fix native app voice.
Use normal OpenAI-backed Codex for that feature where your account supports it.

Normal relay restoration changes provider configuration, not the installed
engine or account pairings. See [Remote compatibility](IPHONE-REMOTE.md) and
[the official voice guide](https://learn.chatgpt.com/docs/features/voice).
