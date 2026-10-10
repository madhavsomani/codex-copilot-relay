# Claude gateway policy review

Reviewed October 7, 2026. This is an engineering release-risk record, not legal
advice, provider endorsement or a guarantee against account restriction. The
preview remains local and opt-in. Publishing and commercial hosting are separate
decisions; successful inference does not prove every deployment is authorized.

## Documented interfaces

GitHub's official SDK supports application integration, signed-in CLI
authentication and runtime model discovery. Requests count toward the Copilot
allowance. Its MIT source license does not replace service terms or promise
unlimited access. [Official SDK README](https://github.com/github/copilot-sdk).

Claude documents third-party gateways using supported protocols. It does not
endorse/audit them or support non-Claude models through them. This adapter exposes
only SDK-advertised Claude models; GPT is never relabelled as Claude.
[Gateway guide](https://code.claude.com/docs/en/llm-gateway).

## GitHub obligations

The additional terms direct individual accounts to Terms of Service Section J,
direct Business/Enterprise purchases to Generative AI Services Terms, and
Microsoft purchases to Microsoft Product Terms. Determine the actual agreement
and organization restrictions for each deployment.
[Copilot additional terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot).

Excessive API frequency/abuse can result in suspension; sharing tokens to exceed
rate limits is prohibited. Section J describes individual-account Input/Output
training use with an account opt-out. Check data controls before sensitive work;
this audit does not read/change them. Do not assume direct Anthropic API privacy
terms govern Copilot traffic.
[GitHub API/AI terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms).

GitHub's commercial module separately assigns customers responsibility for
created agents and third-party products under their agreement. Personal-account
tests do not certify corporate licensing or data handling.
[Commercial module](https://github.com/customer-terms/github-generative-ai-services-terms).

## Claude licensing and unresolved provider question

Claude's legal guide assigns commercial/consumer terms by use. Its conditions
for running Claude Code in products/services require an unmodified binary,
retained authentication methods and each end user's qualifying credential.
Paying for, reselling or intermediating end-user usage is restricted. It names
Bedrock, Google Cloud and Foundry; Copilot is not explicitly named. Thus the
guide alone does not resolve this provider combination. Broader rollout,
redistributing the client or commercialization needs licensing/provider
clarification. No confirmation has been requested or received. This project
does not bundle Claude Code or provide a shared hosted service. Branding must
not imply Anthropic endorsement.
[Claude legal guide](https://code.claude.com/docs/en/legal-and-compliance).

Anthropic's commercial terms restrict competing/resold services and reverse
engineering, and require policy compliance. Its consumer terms restrict account
sharing, competing/resold services, reverse engineering, unpermitted automated
access and bypassing protections. Copilot sign-in alone does not establish the
applicable client agreement. Never advertise hiding identity or defeating quotas.
[Commercial terms](https://www.anthropic.com/legal/commercial-terms),
[consumer terms](https://www.anthropic.com/legal/consumer-terms).

## Engineering controls and release gate

The gateway uses official SDK authentication without replacing its upstream
credential, destination or actual model. Its random loopback bearer is not a
copied GitHub/Claude OAuth token. Settings are child-scoped; tools and permission
checks remain in stock Claude. Neither client binary nor saved account state is
patched. Requested/selected/actual routing and usage are disclosed; unknown
usage stays unknown. No provider is silently substituted after failure.

Claude's documented gateway mode also limits Remote Control, cloud sessions and
voice dictation. Exposing localhost or obtaining account tokens is not a fix.
[Gateway surface limits](https://code.claude.com/docs/en/llm-gateway-connect#slack-cloud-sessions-and-remote-control).

Before broad release: resolve the provider/licensing question with providers or
qualified counsel; retain per-user entitlement/organization policy; complete
compatibility/security gates; preserve the unofficial disclaimer; obtain separate
publication authorization. This audit initiated no support contact or legal
review. Tests are not an account-safety guarantee.
