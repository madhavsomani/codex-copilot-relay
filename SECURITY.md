# Security

## Local trust boundary

Codex Copilot Relay listens only on `127.0.0.1`. Persistent mode is not
authenticated, so any process running locally as the same user can submit
requests and consume that user's GitHub Copilot allowance.

Do not bind the relay to a public or LAN interface. Do not place it behind a
public tunnel or reverse proxy.

The dashboard, its JSON API, and its live Server-Sent Events feed share this
same loopback trust boundary. Browser-visible quota data is limited to safe
numeric entitlement fields and reset dates. GitHub tokens, usernames, account
identifiers, provider trace IDs, and service request IDs are never included.
Usage records contain numeric aggregates; detailed prompts and outputs remain in
the bounded, sanitized local history tier and are fetched only on row selection.

## Sensitive local files

Never commit or share `runtime/`. It can contain sanitized model history,
diagnostic logs, process state, and a protected backup of the user's complete
Codex configuration. The repository `.gitignore` excludes this directory,
along with environment files, logs, backups, and installed dependencies.

The relay does not intentionally copy GitHub Copilot OAuth credentials into its
own files. Authentication is handled by the official GitHub Copilot SDK/CLI.
Interactive Copilot OAuth credentials should remain in the operating system
keychain. Do not add tokens to `.env`, scripts, command history, issue reports,
or Codex `config.toml`; the normal personal setup does not require one.

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

For a vulnerability that should not be public, use the repository's **Security**
tab and **Report a vulnerability** to open a private security advisory. Include
only the minimum sanitized reproduction needed to investigate it.

## Maintainer release checks

Before a public release:

1. Run `npm ci`, `npm test`, `npm run probe:codex-heartbeat`, and
   `./proxy-config.test.ps1` on Windows.
2. Run a secret scanner against both the working tree and all reachable Git
   history, with findings redacted.
3. Confirm `git ls-files` contains no `runtime/`, `.env`, logs, config backup,
   PID file, installed dependency, or captured prompt data.
4. Run `npm audit --omit=dev` and review dependency changes.
5. Verify the listener still binds only to `127.0.0.1`.
