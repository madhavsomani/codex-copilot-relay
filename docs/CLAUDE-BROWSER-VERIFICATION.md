# Browser integration handoff - 2026-10-10

Source: **1.3.72**. This is a scoped implementation, not native-parity certification.

## Implemented

- Optional pinned Playwright MCP extension setup in the supported Desktop config.
- Source-citing browser research skill. No paid search provider is configured.
- Ownership journal and conflict-safe removal of only our configuration/skill
  additions; Stop & Restore and subsequent opted-in Start are integrated.
- Browser guidance on the existing dashboard and connection page. Configuration,
  offered tools and client-reported results are distinguished. No dashboard writes.
- Explicit family IDs from the entitled catalog; no forced GUI model changes.
- Actionable rejection for unsupported Anthropic hosted search; no fallback.

## Verified

| Check | Result |
|---|---|
| Maintained tests | 463 total: 462 pass, 1 skip, 0 fail |
| Basic revert / Remote compatibility | Exact TOML restoration and account/pairing/policy preservation pass in fixtures |
| Two desktop controls | Identity, busy-work protection, persistent-key and archive tests pass |
| Installed stdio command | Real initialize + tools/list succeeds; no browser connection claimed |
| Stock Claude CLI 2.1.296 browser loop | Real Playwright/Edge isolated headless page navigation, click, hidden marker reading and screenshot pass; 5 completed gateway requests |
| Browser model receipts | Actual Opus 5.5; 8.544780 reported SDK AI credits |
| Parallel model override probe | Actual Opus 5.5 parent, Sonnet 5.5 and Haiku 4.5 children; 4 completed requests; 6.649205 reported SDK AI credits |
| Skill validator | Pass |
| Dashboard candidate | Desktop 1440, tablet 820, phone 390: no page overflow or console errors |
| Browser search smoke | Bing result page accessible in an isolated browser; Google returned 429. Not a model-driven/GUI research certification |
| Protected live files | Account file, persistent Claude key and original config backup hashes unchanged across Start/Repair |

The two bounded live inference probes reported **15.193985 SDK AI credits** total.
This is not USD, not the whole coding session cost, and not account-billing reconciliation.

## Still requires user/external state

- Install the Playwright extension in the intended browser and approve its
  connection/tab selection. Neither logged-in browser access nor Desktop GUI
  browser actions have been verified. The agent session cannot operate native
  Claude windows. Save work and reopen Claude to load the MCP configuration.
- Check the built-in Browser tools setting manually in Claude. No internal app
  flags, binaries, registry policies or browser profiles were modified.
- GUI family mappings remain user-controlled; CLI mixed-model proof is not GUI
  mapping proof. Compare real GUI parent/worker receipts after applying IDs there.
- At the deployment check, **v1.3.70** was serving **13 active exchanges**. Start
  staged **v1.3.72** for the fresh watchdog to promote after work drains. Do not
  force-stop active continuations. Read `/health` to confirm actual promotion.
- No GitHub commit or push was performed in this change. Existing dirty-worktree
  changes from earlier work were preserved.

Read [setup and rollback](CLAUDE-BROWSER.md). The app still owns permissions and
browser authentication. Hosted Anthropic web search remains unsupported;
browser research is a documented alternative, not a transparent replacement.
