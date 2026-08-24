# NinjaChat SDK

Official TypeScript and Python clients for the [NinjaChat API](https://docs.ninjachat.ai): one API for chat, responses, images, video, routing, usage, request traces, and webhooks.

## TypeScript

```bash
npm install @ninjachat/sdk
```

```ts
import { NinjaChat } from "@ninjachat/sdk";

const ninja = new NinjaChat({ apiKey: process.env.NINJACHAT_API_KEY! });
const response = await ninja.responses.create({
  model: "ninja/auto",
  input: "Explain this API in one sentence.",
});

console.log(response.output_text);
```

## Python

```bash
pip install ninjachat
```

```python
import os
from ninjachat import NinjaChat

ninja = NinjaChat(api_key=os.environ["NINJACHAT_API_KEY"])
response = ninja.responses.create(
    model="ninja/auto",
    input="Explain this API in one sentence.",
)

print(response["output_text"])
```

The clients default to `https://www.ninjachat.ai/api/v1` and include typed errors, streaming helpers, retries that honor `Retry-After`, and idempotency keys for billing-safe retries.

Already using the OpenAI SDK? Keep it and change only `base_url` and the API key. The native NinjaChat SDK adds first-class routing, media, account usage, request traces, and webhook helpers.

## Repository layout

- [`packages/typescript`](packages/typescript) — `@ninjachat/sdk`
- [`packages/python`](packages/python) — `ninjachat`
- [`openapi/openapi.json`](openapi/openapi.json) — public OpenAPI 3.1 contract

Create an API key in the [developer console](https://www.ninjachat.ai/developers/keys), browse the [documentation](https://docs.ninjachat.ai), or read the language-specific package guides.

## Releases

TypeScript and Python packages share one version. A signed `vX.Y.Z` tag runs the complete package test matrix and publishes through npm and PyPI Trusted Publishing; the repository stores no registry write tokens.

## Security

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/bloon-ai/ninjachat-sdk/security/advisories/new). Do not open public issues for security reports.

## License

MIT © Helium Technologies, Inc.
