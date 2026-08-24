# Security policy

## Supported versions

Security fixes are applied to the latest released minor version. Preview releases may receive breaking changes before `1.0.0`.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/bloon-ai/ninjachat-sdk/security/advisories/new). Include the affected package and version, reproduction steps, expected impact, and any suggested remediation.

Please do not disclose a vulnerability publicly until a fix is available. We will acknowledge a report as quickly as practical and coordinate disclosure with the reporter.

## Protecting API keys

- Treat every `nj_sk_` key as a server-side secret. Never embed it in browser, mobile, desktop, or other distributed client code.
- Load keys from a secret manager or environment variable; never commit them to source control.
- The SDK requires HTTPS for remote API base URLs. Plain HTTP is accepted only for local development on `localhost`, `127.0.0.1`, or `::1`.
- Rotate a key immediately if it may have appeared in source code, logs, build artifacts, screenshots, or client-side bundles.
