# NinjaChat SDK for TypeScript

Clean API v1 client for Responses, Chat Completions, models, images, videos, search, usage, balance, request traces, and webhooks.

> [!IMPORTANT]
> `nj_sk_` API keys are server-side secrets. Never put one in browser, mobile, desktop, or other distributed client code. The SDK rejects browser use by default; send requests through your backend instead. `dangerouslyAllowBrowser` is an explicit escape hatch for exceptional cases where exposing the key is understood and accepted.

```bash
npm install @ninjachat/sdk
```

```ts
import { NinjaChat } from "@ninjachat/sdk";

const client = new NinjaChat({ apiKey: process.env.NINJACHAT_API_KEY! });
const response = await client.responses.create({
  model: "ninja/auto",
  input: "Write one sentence about clean APIs.",
  max_output_tokens: 64,
  routing: { strategy: "balanced", data_policy: "no_training" },
});

console.log(response.output_text, response.cost_usd, response.request_id);
```

Ordered fallbacks use `models`; provider controls stay inside `routing`:

```ts
const completion = await client.chat.completions.create({
  models: ["gpt-5", "claude-sonnet-4"],
  messages: [{ role: "user", content: "Hello" }],
  max_completion_tokens: 100,
  routing: {
    strategy: "latency",
    providers: { exclude: ["example-provider"] },
    allow_fallbacks: true,
    caching: "auto",
    max_cost_usd: 0.10,
  },
});
```

Streams are typed async iterables:

```ts
const events = await client.responses.create({ model: "ninja/auto", input: "Hello", stream: true });
for await (const event of events) {
  if (event.type === "response.output_text.delta") process.stdout.write(event.delta ?? "");
}
```

```ts
const image = await client.images.generate({ prompt: "A paper crane", model: "nano-banana-2" });
const job = await client.videos.generate({ prompt: "Ocean at dusk" });
const done = await client.videos.waitFor(job.id);
const models = await client.models.list();
const usage = await client.usage("7d");
const balance = await client.balance();
const trace = await client.requests.get(completion.request_id);
```

Signed webhooks replace video polling and fire spend alerts — `client.webhooks.create(...)` or the [console](https://www.ninjachat.ai/developers/keys#webhooks). Verify deliveries with `verifyWebhookSignature`.

The default base URL is `https://www.ninjachat.ai/api/v1`. Billed requests automatically receive an idempotency key when retries are enabled. Chat and Responses are billed from actual token usage; image and video use model-catalog unit pricing.

See [docs.ninjachat.ai](https://docs.ninjachat.ai) and the [OpenAPI document](https://www.ninjachat.ai/api/v1/openapi).
