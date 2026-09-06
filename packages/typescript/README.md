# NinjaChat SDK for TypeScript

Clean API v1 client for Responses, Chat Completions, presets, model comparison, batching, pipelines, cost estimation, models, pricing, images, videos, search, usage, balance, request traces, and webhooks.

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
  models: ["gpt-5", "claude-sonnet-4.6"],
  messages: [{ role: "user", content: "Hello" }],
  max_completion_tokens: 100,
  routing: {
    strategy: "latency",
    providers: { exclude: ["deepinfra"] },
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
const image = await client.images.generate({
  prompt: "A paper crane",
  model: "nano-banana-2",
  storage: "provider", // Optional. Omit it for the durable default.
});
const job = await client.videos.generate({ prompt: "Ocean at dusk" });
const done = await client.videos.waitFor(job.id);
const models = await client.models.list();
const usage = await client.usage("7d");
const balance = await client.balance();
const health = await client.health();
const trace = await client.requests.get(completion.request_id);
```

## Beyond one completion

Run the same prompt across several models and get them back ranked by quality,
speed and cost — one hold, one settlement, one request id. A model that fails
costs nothing and lands in `failed`:

```ts
const comparison = await client.compare.create({
  messages: [{ role: "user", content: "Explain CRDTs in three sentences." }],
  models: ["gpt-5", "claude-sonnet-4.6", "gemini-3.1-pro"],
  rank_by: "balanced",
});
console.log(comparison.winner?.model, comparison.total_cost_cents);
```

Streaming interleaves per-model deltas and closes with the rankings. A
`model_error` is one model's problem, not the stream's — the rest keep going:

```ts
for await (const event of await client.compare.create({ messages, models, stream: true })) {
  if (event.type === "delta") render(event.model, event.delta.content);
}
```

Fan out independent requests with `batch`, chain modalities with `pipelines`:

```ts
const batch = await client.batch.create({
  requests: [
    { model: "gpt-5", messages: [{ role: "user", content: "Headline A" }] },
    { model: "gemini-3-flash", messages: [{ role: "user", content: "Headline B" }] },
  ],
});

const pipeline = await client.pipelines.create({
  steps: [
    { id: "script", type: "chat", model: "gpt-5-mini", input: "One line about a paper crane." },
    { id: "art", type: "image", prompt: "{{script.output}}" },
  ],
});
const finished = await client.pipelines.waitFor(pipeline.id);
```

Price a request before you run it, and read the rate sheet billing itself uses
(both public — the key is ignored):

```ts
const estimate = await client.estimate.create({ model: "gpt-5", messages, count: 10_000 });
const pricing = await client.pricing.retrieve();
```

Saved presets carry the model chain, routing and system prompt server-side, so
configuration ships without a redeploy:

```ts
const reply = await client.presets.run("support-agent", {
  messages: [{ role: "user", content: "Where is my order?" }],
});
```

Signed webhooks replace video polling and fire spend alerts — `client.webhooks.create(...)` or the [console](https://www.ninjachat.ai/developers/webhooks). Verify deliveries with `verifyWebhookSignature`.

The default base URL is `https://www.ninjachat.ai/api/v1`. Billed requests automatically receive an idempotency key when retries are enabled. Chat and Responses are billed from actual token usage; image and video use model-catalog unit pricing.

See [docs.ninjachat.ai](https://docs.ninjachat.ai) and the [OpenAPI document](https://www.ninjachat.ai/api/v1/openapi).

## Official package

`@ninjachat/sdk` is the official TypeScript client for [NinjaChat](https://www.ninjachat.ai),
published and maintained by Helium Technologies, Inc., the company that operates
NinjaChat. The source lives in the `bloon-ai/ninjachat-sdk` repository — that
organization is ours; the package is first-party, not a community wrapper.

Requires Node.js 18 or newer.
