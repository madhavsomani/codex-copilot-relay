# Security

## Local trust boundary

Codex Copilot Relay listens only on `127.0.0.1`. Persistent mode is not
authenticated, so any process running locally as the same user can submit
requests and consume that user's GitHub Copilot allowance.

Do not bind the relay to a public or LAN interface. Do not place it behind a
public tunnel or reverse proxy.

## Sensitive local files

Never commit or share `runtime/`. It can contain sanitized model history,
diagnostic logs, process state, and a protected backup of the user's complete
Codex configuration. The repository `.gitignore` excludes this directory,
along with environment files, logs, backups, and installed dependencies.

The relay does not intentionally copy GitHub Copilot OAuth credentials into its
own files. Authentication is handled by the official GitHub Copilot SDK/CLI.

Codex child-agent tool declarations can include an `encrypted` annotation that
is specific to the OpenAI provider. Copilot cannot decrypt that provider
envelope, so the relay removes the annotation from the schema sent upstream and
passes the delegation task as ordinary text over loopback. Codex still owns the
tool boundary and approval checks. This compatibility behavior is another
reason the listener must never be exposed to a LAN, public tunnel, or proxy.

## Reporting an issue

Do not paste secrets, private prompts, config backups, or raw runtime logs into
a public issue. Provide a minimal reproduction with sensitive data removed.
If a credential was exposed, revoke or rotate it before reporting the issue.
