# NinjaChat Python SDK

Typed client for the clean NinjaChat API v1.

```bash
pip install ninjachat
```

```python
import os
from ninjachat import NinjaChat

client = NinjaChat(api_key=os.environ["NINJACHAT_API_KEY"])
response = client.responses.create(
    model="ninja/auto",
    input="Write one sentence about clean APIs.",
    max_output_tokens=64,
    routing={"strategy": "balanced", "data_policy": "no_training"},
)
print(response["output_text"], response["cost_usd"], response["request_id"])
```

Ordered fallbacks and provider constraints are explicit:

```python
completion = client.chat.completions.create(
    models=["gpt-5", "claude-sonnet-4.6"],
    messages=[{"role": "user", "content": "Hello"}],
    max_completion_tokens=100,
    routing={"strategy": "latency", "allow_fallbacks": True, "caching": "auto", "max_cost_usd": 0.10},
)
```

Streaming responses are iterators of event dictionaries:

```python
for event in client.responses.create(model="ninja/auto", input="Hello", stream=True):
    if event.get("type") == "response.output_text.delta":
        print(event.get("delta", ""), end="")
```

## Async client

Use `AsyncNinjaChat` with `async with` to close connections when finished:

```python
import asyncio
import os
from ninjachat import AsyncNinjaChat

async def main():
    async with AsyncNinjaChat(api_key=os.environ["NINJACHAT_API_KEY"]) as client:
        response = await client.responses.create(model="ninja/auto", input="Hello")
        print(response["output_text"])

asyncio.run(main())
```

## Beyond one completion

Run one prompt across several models and get them back ranked by quality, speed
and cost — one hold, one settlement, one request id. A model that fails costs
nothing and lands in `failed`:

```python
comparison = client.compare.create(
    messages=[{"role": "user", "content": "Explain CRDTs in three sentences."}],
    models=["gpt-5", "claude-sonnet-4.6", "gemini-3.1-pro"],
    rank_by="balanced",
)
print(comparison["winner"]["model"], comparison["total_cost_cents"])
```

Streaming interleaves per-model deltas and closes with the rankings. A
`model_error` is one model's problem, not the stream's — the rest keep going:

```python
for event in client.compare.create(messages=messages, models=models, stream=True):
    if event["type"] == "delta":
        print(event["model"], event["delta"]["content"])
```

Fan out independent requests with `client.batch.create()`, and chain modalities
with `client.pipelines.create()` / `client.pipelines.wait_for()`:

```python
batch = client.batch.create(
    requests=[
        {"model": "gpt-5", "messages": [{"role": "user", "content": "Headline A"}]},
        {"model": "gemini-3-flash", "messages": [{"role": "user", "content": "Headline B"}]},
    ],
)

pipeline = client.pipelines.create(
    steps=[
        {"id": "script", "type": "chat", "model": "gpt-5-mini", "input": "One line about a paper crane."},
        {"id": "art", "type": "image", "prompt": "{{script.output}}"},
    ],
)
finished = client.pipelines.wait_for(pipeline["id"])
```

Price a request before running it with `client.estimate.create()`, and read the
rate sheet billing itself uses with `client.pricing.retrieve()`. Both are public
endpoints — the key is ignored, and nothing is deducted.

Saved presets carry the model chain, routing and system prompt server-side, so
configuration ships without a redeploy:

```python
reply = client.presets.run("support-agent", messages=[{"role": "user", "content": "Where is my order?"}])
```

Models and prices come from `client.models.list()`. Images use `client.images.generate()`, videos use `client.videos.generate()` and `client.videos.wait_for()`, and observability is available through `client.usage()`, `client.balance()`, `client.health()`, and `client.requests.get()`.

The image `storage` parameter is optional. It defaults to `storage="durable"` and returns a permanent NinjaChat URL. Use `storage="provider"` for the lowest latency; depending on the provider, the response contains a temporary URL or inline `b64_json` plus `mime_type`.

Signed webhooks replace video polling and fire spend alerts: `client.webhooks.create(...)` or the [console](https://www.ninjachat.ai/developers/webhooks). Verify deliveries with `verify_webhook_signature`.

The base URL is `https://www.ninjachat.ai/api/v1`. Chat and Responses are billed by actual token usage. See [docs.ninjachat.ai](https://docs.ninjachat.ai).

## Official package

`ninjachat` is the official Python client for [NinjaChat](https://www.ninjachat.ai),
published and maintained by Helium Technologies, Inc., the company that operates
NinjaChat. The source lives in the `bloon-ai/ninjachat-sdk` repository — that
organization is ours; the package is first-party, not a community wrapper.

Requires Python 3.10 or newer.
