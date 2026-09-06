import assert from "node:assert/strict";
import test from "node:test";

import { NinjaChat, NinjaChatError } from "../dist/index.js";

test("header deadline does not rely on custom fetch observing its signal", { timeout: 2_000 }, async () => {
  let releaseHeaders;
  let lateCancelled = false;
  const headers = new Promise(resolve => { releaseHeaders = resolve; });
  const client = new NinjaChat({
    apiKey: "test", maxRetries: 0, timeoutMs: 5,
    fetch: () => headers,
  });
  try {
    // Headers remain pending until after the SDK's timeout rejects the call.
    await assert.rejects(client.models.list(), error => error.code === "timeout");
  } finally {
    releaseHeaders(new Response(new ReadableStream({ cancel() { lateCancelled = true; } })));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateCancelled, true);
});

test("reranking and binary speech share authenticated, idempotent transport",async()=>{
  const client=new NinjaChat({apiKey:"test",fetch:async(url,init)=>{
    assert.ok(new Headers(init.headers).get("idempotency-key"));
    return url.endsWith("/rerank")?Response.json({results:[{index:0,relevance_score:.9}]}):new Response(new Uint8Array([0,1,255]),{headers:{"content-type":"audio/pcm","x-request-id":"audio"}});
  }});
  assert.equal((await client.rerank.create({model:"rerank-2.5",query:"q",documents:["a"]})).results[0].index,0);
  const audio=await client.audio.speech.create({model:"tts-1",input:"hello",voice:"alloy",response_format:"pcm"});
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())],[0,1,255]);
  assert.equal(audio.headers.get("x-request-id"),"audio");
});

test("creates embeddings with one idempotency key across retries", async () => {
  const calls = [];
  const client = new NinjaChat({apiKey:"test-only",fetch:async (url,init) => {
    calls.push({url,init});
    return calls.length === 1 ? new Response("busy",{status:503,headers:{"retry-after":"0"}}) : new Response(JSON.stringify({data:[{index:0,embedding:[1,2]}],usage:{total_tokens:2}}));
  }});
  const result = await client.embeddings.create({model:"text-embedding-3-small",input:["hello"],dimensions:2});
  assert.deepEqual(result.data[0].embedding,[1,2]);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,"https://www.ninjachat.ai/api/v1/embeddings");
  assert.ok(new Headers(calls[0].init.headers).get("Idempotency-Key"));
  assert.equal(new Headers(calls[0].init.headers).get("Idempotency-Key"),new Headers(calls[1].init.headers).get("Idempotency-Key"));
  assert.deepEqual(JSON.parse(calls[0].init.body),{model:"text-embedding-3-small",input:["hello"],dimensions:2});
});

test("rejects insecure URLs and keeps credentials out of enumerable properties", () => {
  for (const baseUrl of ["http://example.com", "https://user:pass@example.com", "https://example.com?token=x"]) {
    assert.throws(() => new NinjaChat({ apiKey: "secret-test", baseUrl }), NinjaChatError);
  }
  const client = new NinjaChat({ apiKey: "secret-test", baseUrl: "http://[::1]:1234/api/v1" });
  assert.ok(!JSON.stringify(client, (key, value) => key === "client" ? undefined : value).includes("secret-test"));
});

test("blocks secret keys in browser runtimes unless explicitly opted in", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  try {
    globalThis.window = {};
    globalThis.document = {};
    assert.throws(() => new NinjaChat({ apiKey: "test" }), error => error.code === "browser_api_key_forbidden");
    assert.doesNotThrow(() => new NinjaChat({ apiKey: "test", dangerouslyAllowBrowser: true }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("an already aborted request never reaches fetch", async () => {
  let calls = 0;
  const client = new NinjaChat({ apiKey: "test", fetch: async () => { calls++; return new Response("{}"); } });
  await assert.rejects(client.models.list({ signal: AbortSignal.abort() }), error => error.code === "aborted");
  assert.equal(calls, 0);
});

test("abort after headers cancels a pending stream read and the upstream body", async () => {
  let cancelled = false;
  let upstream;
  const client = new NinjaChat({ apiKey: "test", maxRetries: 0, fetch: async (_, init) => {
    upstream = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  const controller = new AbortController();
  const stream = await client.chat.completions.create({ model: "test", messages: [{ role: "user", content: "hi" }], stream: true }, { signal: controller.signal });
  const read = stream[Symbol.asyncIterator]().next();
  controller.abort();
  await assert.rejects(read, error => error.code === "aborted");
  assert.equal(upstream.aborted, true);
  assert.equal(cancelled, true);
});

test("deadline includes a stalled JSON response body", async () => {
  const client = new NinjaChat({ apiKey: "test", maxRetries: 0, timeoutMs: 15, fetch: async () => new Response(new ReadableStream()) });
  await assert.rejects(client.models.list(), error => error.code === "timeout");
});

test("billing-safe retries reuse one idempotency key", async () => {
  const keys = [];
  const client = new NinjaChat({ apiKey: "test", fetch: async (_, init) => {
    keys.push(new Headers(init.headers).get("idempotency-key"));
    return keys.length === 1 ? new Response(JSON.stringify({ error: { code: "upstream_error", message: "retry" } }), { status: 503, headers: { "retry-after": "0" } }) : new Response("{}");
  } });
  await client.chat.completions.create({ model: "test", messages: [{ role: "user", content: "hi" }] });
  assert.equal(keys.length, 2);
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
});

test("caller can cancel retry backoff immediately", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new NinjaChat({ apiKey: "test", fetch: async () => {
    calls++;
    setTimeout(() => controller.abort(), 10);
    return new Response("{}", { status: 503, headers: { "retry-after": "30" } });
  } });
  await assert.rejects(client.models.list({ signal: controller.signal }), error => error.code === "aborted");
  assert.equal(calls, 1);
});

test("generates secure idempotency keys on Node without global Web Crypto", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {value:undefined,configurable:true});
  try {
    let key;
    const client = new NinjaChat({apiKey:'test',fetch:async(_,init)=>{key=new Headers(init.headers).get('idempotency-key');return new Response('{}');}});
    await client.chat.completions.create({model:'test',messages:[{role:'user',content:'hi'}]});
    assert.match(key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});

test("non-idempotent endpoints cannot opt into unsafe retries by setting a key", async () => {
  let calls = 0;
  const client = new NinjaChat({ apiKey: "test", fetch: async () => { calls++; return new Response("{}", { status: 503 }); } });
  await assert.rejects(client.requestRaw({ method: "POST", path: "/webhooks", options: { idempotencyKey: "test" } }));
  assert.equal(calls, 1);
});

test("lists models with the expected auth and base URL", async () => {
  let request;
  const client = new NinjaChat({
    apiKey: "nj_sk_test",
    maxRetries: 0,
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const models = await client.models.list();
  assert.deepEqual(models, { object: "list", data: [] });
  assert.equal(request.url, "https://www.ninjachat.ai/api/v1/models");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer nj_sk_test");
});

test("reads public gateway health", async () => {
  let request;
  const client = new NinjaChat({
    apiKey: "nj_sk_test",
    maxRetries: 0,
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ status: "operational" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await client.health(), { status: "operational" });
  assert.equal(request.url, "https://www.ninjachat.ai/api/v1/health");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer nj_sk_test");
});

test("fails clearly when an API key is missing", () => {
  assert.throws(
    () => new NinjaChat({ apiKey: "" }),
    (error) => error instanceof NinjaChatError && error.code === "missing_api_key",
  );
});

/** Fake fetch that records every call and replays queued responses in order. */
function recorder(...responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return typeof next === "function" ? next() : next;
    },
  };
}

function json(body, status = 200) {
  return () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(...events) {
  return () =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
}

test("rejects corrupt or truncated chat streams instead of successful partial results", async () => {
  for (const [wire, code] of [
    ['data: {bad}\n\n', 'invalid_stream'],
    ['data: []\n\n', 'invalid_stream'],
    ['data: {"choices":[]}', 'stream_truncated'],
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: [DONE]\n\n', 'stream_truncated'],
  ]) {
    const client = new NinjaChat({ apiKey: 'test', fetch: async () => new Response(wire), maxRetries: 0 });
    const stream = await client.chat.completions.create({model:'test',messages:[{role:'user',content:'hi'}],stream:true});
    await assert.rejects(async () => { for await (const event of stream) {} }, error => error.code === code);
  }
});

test("accepts a Responses incomplete terminal event without pretending completion", async () => {
  const client = new NinjaChat({ apiKey:'test', fetch: sse({type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}}) });
  const stream = await client.responses.create({model:'test',input:'hi',stream:true});
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events[0].response.status, 'incomplete');
});

test("compares models and bills the fan-out under one idempotency key", async () => {
  const rec = recorder(
    json({
      request_id: "req_1",
      winner: { model: "gpt-5", name: "GPT-5", reason: "Best balance" },
      results: [{ rank: 1, model: "gpt-5", content: "hi", success: true }],
      failed: [],
      ranked_by: "balanced",
      total_cost_cents: 0.4,
    }),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const comparison = await client.compare.create({
    messages: [{ role: "user", content: "Hello" }],
    models: ["gpt-5", "claude-sonnet-4.6"],
    rank_by: "balanced",
  });

  assert.equal(comparison.winner.model, "gpt-5");
  assert.equal(rec.calls[0].url, "https://www.ninjachat.ai/api/v1/compare");
  assert.equal(rec.calls[0].init.method, "POST");
  assert.ok(new Headers(rec.calls[0].init.headers).get("idempotency-key"), "billed fan-out must carry a generated key");
  assert.deepEqual(JSON.parse(rec.calls[0].init.body).models, ["gpt-5", "claude-sonnet-4.6"]);
});

test("streams a comparison and treats a per-model error as data, not a stream failure", async () => {
  const rec = recorder(
    sse(
      { type: "start", id: "cmp_1", request_id: "req_1", models: ["gpt-5", "kimi-k2"], rank_by: "speed" },
      { type: "delta", model: "gpt-5", delta: { content: "hi" } },
      { type: "model_error", model: "kimi-k2", error: "Model timeout after 30s" },
      { type: "rankings", winner: { model: "gpt-5" }, results: [], rank_by: "speed" },
    ),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const events = [];
  for await (const event of await client.compare.create({
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  })) {
    events.push(event.type);
  }

  assert.deepEqual(events, ["start", "delta", "model_error", "rankings"]);
  assert.equal(new Headers(rec.calls[0].init.headers).get("accept"), "text/event-stream");
});

test("fans out a batch and keeps per-job failures in the results", async () => {
  const rec = recorder(
    json({
      results: [
        { index: 0, success: true, model: "gpt-5", requested_model: "gpt-5", content: "ok", cost_cents: 0.2 },
        { index: 1, success: false, model: "kimi-k2", requested_model: "kimi-k2", error: "Model error", cost_cents: 0 },
      ],
      succeeded: 1,
      failed: 1,
      request_id: "req_2",
    }),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const batch = await client.batch.create({
    requests: [
      { model: "gpt-5", messages: [{ role: "user", content: "a" }] },
      { model: "kimi-k2", messages: [{ role: "user", content: "b" }] },
    ],
  });

  assert.equal(batch.succeeded, 1);
  assert.equal(batch.results[1].success, false);
  assert.equal(rec.calls[0].url, "https://www.ninjachat.ai/api/v1/batch");
  assert.ok(new Headers(rec.calls[0].init.headers).get("idempotency-key"));
});

test("streams a batch through to its summary", async () => {
  const rec = recorder(
    sse(
      { type: "result", index: 0, success: true, model: "gpt-5", content: "ok", cost_cents: 0.2, latency_ms: 700 },
      { type: "result", index: 1, success: false, model: "kimi-k2", error: "Model error", cost_cents: 0, latency_ms: 90 },
      { type: "summary", succeeded: 1, failed: 1, total_cost_cents: 0.2, total_cost: "$0.0020", request_id: "req_2" },
    ),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const seen = [];
  for await (const event of await client.batch.create({
    requests: [{ messages: [{ role: "user", content: "a" }] }],
    stream: true,
  })) {
    seen.push(event);
  }

  assert.deepEqual(seen.map((e) => e.type), ["result", "result", "summary"]);
  assert.equal(seen[1].error, "Model error");
});

test("estimates cost without an idempotency key — the call is free and side-effect free", async () => {
  const rec = recorder(
    json({ model: "gpt-5", estimated_cents: 0.63, estimated_max_cents: 1.2, for_count: 1, billing: "metered" }),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const estimate = await client.estimate.create({
    model: "gpt-5",
    messages: [{ role: "user", content: "Summarize this." }],
    count: 1,
  });

  assert.equal(estimate.estimated_cents, 0.63);
  assert.equal(rec.calls[0].url, "https://www.ninjachat.ai/api/v1/estimate");
  assert.equal(new Headers(rec.calls[0].init.headers).get("idempotency-key"), null);
});

test("reads the public rate sheet", async () => {
  const rec = recorder(json({ object: "pricing", currency: "usd", chat: [], images: [], video: [] }));
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const pricing = await client.pricing.retrieve();
  assert.equal(pricing.object, "pricing");
  assert.equal(rec.calls[0].url, "https://www.ninjachat.ai/api/v1/pricing");
  assert.equal(rec.calls[0].init.method, "GET");
});

test("submits a pipeline and polls it to completion", async () => {
  const pipelineId = "pl_" + "a".repeat(32);
  const rec = recorder(
    json({ id: pipelineId, status: "running", steps: [], poll: `/api/v1/pipelines/${pipelineId}` }, 202),
    json({ id: pipelineId, status: "running", steps: [] }),
    json({
      id: pipelineId,
      status: "completed",
      steps: [{ id: "script", type: "chat", model: "gpt-5-mini", status: "completed", output: "text", cost_cents: 0.1 }],
      cost: { reserved_cents: 5, charged_cents: 0.1, refunded_cents: 4.9 },
    }),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const job = await client.pipelines.create({
    steps: [
      { id: "script", type: "chat", model: "gpt-5-mini", input: "Write a caption." },
      { id: "art", type: "image", prompt: "{{script.output}}" },
    ],
  });
  assert.equal(job.status, "running");
  assert.ok(new Headers(rec.calls[0].init.headers).get("idempotency-key"));

  const done = await client.pipelines.waitFor(pipelineId, { pollMs: 1 });
  assert.equal(done.status, "completed");
  assert.equal(done.steps[0].output, "text");
  assert.equal(rec.calls[1].url, `https://www.ninjachat.ai/api/v1/pipelines/${pipelineId}`);
});

test("surfaces a failed pipeline as a NinjaChatError naming the step", async () => {
  const pipelineId = "pl_" + "b".repeat(32);
  const rec = recorder(
    json({ id: pipelineId, status: "failed", steps: [], error: { step_id: "art", message: "provider rejected the prompt" } }),
  );
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  await assert.rejects(
    () => client.pipelines.waitFor(pipelineId, { pollMs: 1 }),
    (error) =>
      error instanceof NinjaChatError &&
      error.code === "pipeline_failed" &&
      error.message.includes("art"),
  );
});

test("job polling deadlines cover stalled retrievals and cancellation interrupts sleeps", async () => {
  const stalled = new NinjaChat({apiKey:'test', maxRetries:0, fetch:async()=>new Response(new ReadableStream())});
  await assert.rejects(stalled.videos.waitFor('video_test',{timeoutMs:15}),error=>error.code==='poll_timeout');
  let calls=0;
  const abort = new AbortController();
  const client = new NinjaChat({apiKey:'test',fetch:async()=>{ calls++; setTimeout(()=>abort.abort(),10); return new Response('{"status":"running"}'); }});
  await assert.rejects(client.pipelines.waitFor('pl_test',{signal:abort.signal,pollMs:30000}),error=>error.code==='aborted');
  assert.equal(calls,1);
  await assert.rejects(client.videos.waitFor('video_test',{pollMs:0}),error=>error.code==='invalid_options');
});

test("runs a saved preset against its slug path", async () => {
  const rec = recorder(json({ id: "chatcmpl_1", object: "chat.completion", choices: [], request_id: "req_3" }));
  const client = new NinjaChat({ apiKey: "nj_sk_test", fetch: rec.fetch });

  const completion = await client.presets.run("support agent", {
    messages: [{ role: "user", content: "Where is my order?" }],
  });

  assert.equal(completion.object, "chat.completion");
  assert.equal(rec.calls[0].url, "https://www.ninjachat.ai/api/v1/presets/support%20agent/chat/completions");
  assert.ok(new Headers(rec.calls[0].init.headers).get("idempotency-key"));
  assert.equal(JSON.parse(rec.calls[0].init.body).model, undefined);
});

test("Messages and sessions wrap the real endpoints and preserve native SSE/Markdown", async()=>{
  const rec=recorder(sse({type:'message_start',message:{}},{type:'message_stop'}),json({session_id:'sess'}),()=>new Response('# transcript'));
  const client=new NinjaChat({apiKey:'test',fetch:rec.fetch});
  const events=[];for await(const event of await client.messages.create({model:'test',max_tokens:16,messages:[{role:'user',content:'hi'}],stream:true}))events.push(event.type);
  assert.deepEqual(events,['message_start','message_stop']);assert.ok(rec.calls[0].url.endsWith('/messages'));
  await client.sessions.create({session_id:'sess'});assert.equal(new Headers(rec.calls[1].init.headers).get('idempotency-key'),null);
  assert.equal(await client.sessions.export('a/b','markdown'),'# transcript');assert.ok(rec.calls[2].url.endsWith('/sessions/a%2Fb/export?format=markdown'));
});
