/**
 * NinjaChat v1 API client. Zero runtime dependencies, fetch-based.
 *
 * Reliability model:
 * - Automatic retries (default 2) on 429 and 5xx, honoring `Retry-After`,
 *   with exponential backoff + jitter otherwise.
 * - Billed, non-idempotent calls (chat, presets, images, video, search,
 *   compare, batch, pipelines) are NEVER retried without an
 *   `Idempotency-Key`: when retries are enabled and no key was supplied, the
 *   SDK generates one via crypto.randomUUID() so a retry can only replay —
 *   never double-bill. A 409 `request_in_flight` on a keyed request is also
 *   retried (the first attempt is still running server-side).
 * - Endpoints with no idempotency support (webhooks.create) are never
 *   auto-retried.
 */

import { NinjaChatError } from "./errors.js";
import {
  iterateBatchStream,
  iterateChatStream,
  iterateCompareStream,
  iterateResponseStream,
  iterateMessagesStream,
} from "./streaming.js";
import type {
  BalanceResponse,
  BatchCreateParams,
  BatchResponse,
  BatchStreamEvent,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  CompareCreateParams,
  CompareResponse,
  CompareStreamEvent,
  EstimateCreateParams,
  EstimateResponse,
  HealthResponse,
  ImageGenerateParams,
  ImageGenerateResponse,
  ModelList,
  PipelineCreateParams,
  PipelineCreateResponse,
  PipelineState,
  PresetRunParams,
  PricingResponse,
  PublicModel,
  RequestRecord,
  ResponseCreateParams,
  ResponseObject,
  ResponseStreamEvent,
  SearchQueryParams,
  SearchResponse,
  UsageResponse,
  VideoGenerateParams,
  VideoGenerateResponse,
  VideoStatusResponse,
  WebhookCreateParams,
  WebhookCreateResponse,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookTestResult,
} from "./types.js";

import { NinjaChatTransport } from "./transport.js";
import { ManagementResource } from "./management.js";
import type { NinjaChatOptions, RequestOptions } from "./transport.js";
export { DEFAULT_BASE_URL } from "./transport.js";
export type { NinjaChatOptions, RequestOptions } from "./transport.js";

async function pollJob<T extends { status: string }>(
  id: string, options: WaitForOptions, retrieve: (options: RequestOptions) => Promise<T>,
  failed: (state: T) => NinjaChatError,
): Promise<T> {
  const pollMs = options.pollMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isFinite(pollMs) || pollMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new NinjaChatError({ message: "pollMs and timeoutMs must be positive finite numbers.", status: 0, code: "invalid_options" });
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    for (;;) {
      const state = await retrieve({ ...options, signal: controller.signal });
      if (state.status === "completed") return state;
      if (state.status === "failed") throw failed(state);
      await new Promise<void>((resolve, reject) => {
        const done = () => { controller.signal.removeEventListener("abort", cancel); resolve(); };
        const sleep = setTimeout(done, pollMs);
        const cancel = () => { clearTimeout(sleep); controller.signal.removeEventListener("abort", cancel); reject(new NinjaChatError({ message: "Polling aborted.", status: 0, code: "aborted" })); };
        controller.signal.addEventListener("abort", cancel, { once: true });
        if (controller.signal.aborted) cancel();
      });
    }
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted)
      throw new NinjaChatError({ message: `Timed out waiting for ${id}. This stops polling, not the server job; retrieve its status later.`, status: 0, code: "poll_timeout", requestId: id });
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export class NinjaChat extends NinjaChatTransport {
  readonly rerank: RerankResource;
  readonly audio: AudioResource;
  readonly messages: MessagesResource;
  readonly sessions: SessionsResource;

  readonly chat: ChatResource;
  readonly responses: ResponsesResource;
  readonly presets: PresetsResource;
  readonly models: ModelsResource;
  readonly pricing: PricingResource;
  readonly images: ImagesResource;
  readonly videos: VideosResource;
  readonly search: SearchResource;
  readonly embeddings: EmbeddingsResource;
  readonly compare: CompareResource;
  readonly batch: BatchResource;
  readonly estimate: EstimateResource;
  readonly pipelines: PipelinesResource;
  readonly requests: RequestsResource;
  readonly webhooks: WebhooksResource;
  readonly management: ManagementResource;
  readonly battles: BattlesResource;

  constructor(options: NinjaChatOptions) {
    super(options);
    this.rerank = new RerankResource(this);
    this.audio = new AudioResource(this);
    this.messages = new MessagesResource(this);
    this.sessions = new SessionsResource(this);

    this.chat = new ChatResource(this);
    this.responses = new ResponsesResource(this);
    this.presets = new PresetsResource(this);
    this.models = new ModelsResource(this);
    this.pricing = new PricingResource(this);
    this.images = new ImagesResource(this);
    this.videos = new VideosResource(this);
    this.search = new SearchResource(this);
    this.embeddings = new EmbeddingsResource(this);
    this.compare = new CompareResource(this);
    this.batch = new BatchResource(this);
    this.estimate = new EstimateResource(this);
    this.pipelines = new PipelinesResource(this);
    this.requests = new RequestsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.management = new ManagementResource(this);
    this.battles = new BattlesResource(this);
  }

  /** GET /balance — current prepaid credit balance. */
  async balance(options?: RequestOptions): Promise<BalanceResponse> {
    return this.requestJson<BalanceResponse>({
      method: "GET",
      path: "/balance",
      idempotentMethod: true,
      options,
    });
  }

  /** GET /usage — metered request, token, latency, and cost analytics. */
  async usage(period: "1d" | "7d" | "30d" = "7d", options?: RequestOptions): Promise<UsageResponse> {
    return this.requestJson<UsageResponse>({
      method: "GET",
      path: "/usage",
      query: { period },
      idempotentMethod: true,
      options,
    });
  }

  /** GET /health — public measured gateway health and resilience snapshot. */
  async health(options?: RequestOptions): Promise<HealthResponse> {
    return this.requestJson<HealthResponse>({ method: "GET", path: "/health", idempotentMethod: true, options });
  }

  async network(options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.requestJson({ method: "GET", path: "/network", idempotentMethod: true, options });
  }

}

// ── Resources ────────────────────────────────────────────────────────────────

class RerankResource {
  constructor(private readonly client: NinjaChat) {}
  create(params: import("./types.js").RerankCreateParams, options?: RequestOptions): Promise<import("./types.js").RerankResponse> {
    return this.client.requestJson({method:"POST",path:"/rerank",body:params,supportsIdempotency:true,options});
  }
}
class AudioResource {
  readonly speech: SpeechResource;
  constructor(client: NinjaChat) { this.speech = new SpeechResource(client); }
}
class SpeechResource {
  constructor(private readonly client: NinjaChat) {}
  /** Binary Response: use arrayBuffer(), blob(), or body; metadata is in headers. */
  create(params: import("./types.js").SpeechCreateParams, options?: RequestOptions): Promise<Response> {
    return this.client.requestRaw({method:"POST",path:"/audio/speech",body:params,supportsIdempotency:true,options});
  }
}
class MessagesResource {
  constructor(private readonly client: NinjaChat) {}
  create(params: import("./types.js").MessagesCreateParams & {stream:true}, options?: RequestOptions): Promise<AsyncGenerator<import("./types.js").MessageStreamEvent>>;
  create(params: import("./types.js").MessagesCreateParams & {stream?:false}, options?: RequestOptions): Promise<import("./types.js").AnthropicMessage>;
  create(params: import("./types.js").MessagesCreateParams, options?: RequestOptions): Promise<import("./types.js").AnthropicMessage | AsyncGenerator<import("./types.js").MessageStreamEvent>>;
  async create(params: import("./types.js").MessagesCreateParams, options?: RequestOptions) {
    const request = {method:"POST" as const,path:"/messages",body:params,supportsIdempotency:true,stream:params.stream,options};
    return params.stream ? iterateMessagesStream(await this.client.requestRaw(request)) : this.client.requestJson<import("./types.js").AnthropicMessage>(request);
  }
}

class SessionsResource {
  constructor(private readonly client: NinjaChat) {}
  create(params: import("./types.js").SessionCreateParams = {}, options?: RequestOptions): Promise<import("./types.js").SessionCreated> {
    return this.client.requestJson({method:"POST",path:"/sessions",body:params,options});
  }
  retrieve(id: string, options?: RequestOptions): Promise<import("./types.js").SessionState> {
    return this.client.requestJson({method:"GET",path:`/sessions/${encodeURIComponent(id)}`,idempotentMethod:true,options});
  }
  delete(id: string, options?: RequestOptions): Promise<{deleted:boolean}> {
    return this.client.requestJson({method:"DELETE",path:`/sessions/${encodeURIComponent(id)}`,options});
  }
  export(id: string, format: "markdown", options?: RequestOptions): Promise<string>;
  export(id: string, format?: "json", options?: RequestOptions): Promise<import("./types.js").SessionExport>;
  async export(id: string, format: "json" | "markdown" = "json", options?: RequestOptions) {
    const request = {method:"GET" as const,path:`/sessions/${encodeURIComponent(id)}/export`,query:{format},idempotentMethod:true,options};
    return format === "markdown" ? (await this.client.requestRaw(request)).text() : this.client.requestJson<import("./types.js").SessionExport>(request);
  }
}

class BattlesResource {
  constructor(private readonly client: NinjaChat) {}
  list(type: "leaderboard" | "recent" = "leaderboard", options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.client.requestJson({ method: "GET", path: "/battles", query: { type }, idempotentMethod: true, options });
  }
  create(params: { ranked_models: string[]; compare_request_id: string; prompt_snippet?: string; rank_by?: string; category?: string }, options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.client.requestJson({ method: "POST", path: "/battles", body: params, options });
  }
}

class ChatResource {
  readonly completions: ChatCompletionsResource;
  constructor(client: NinjaChat) {
    this.completions = new ChatCompletionsResource(client);
  }
}

class ResponsesResource {
  constructor(private readonly client: NinjaChat) {}

  create(params: ResponseCreateParams & { stream: true }, options?: RequestOptions): Promise<AsyncIterable<ResponseStreamEvent>>;
  create(params: ResponseCreateParams & { stream?: false }, options?: RequestOptions): Promise<ResponseObject>;
  async create(params: ResponseCreateParams, options?: RequestOptions): Promise<ResponseObject | AsyncIterable<ResponseStreamEvent>> {
    if (params.stream) {
      const response = await this.client.requestRaw({
        method: "POST",
        path: "/responses",
        body: params,
        supportsIdempotency: true,
        stream: true,
        options,
      });
      return iterateResponseStream(response);
    }
    return this.client.requestJson<ResponseObject>({
      method: "POST",
      path: "/responses",
      body: params,
      supportsIdempotency: true,
      options,
    });
  }
}

/**
 * Saved model + routing bundles, applied server-side. The preset owns the
 * model chain, routing policy, system prompt and parameters, so config ships
 * without a redeploy and the caller sends only its turn.
 */
class PresetsResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * POST /presets/{slug}/chat/completions — same request and response as
   * chat.completions.create, except `model`/`models` are optional: pass one
   * to override the preset's chain for this call only.
   */
  run(slug: string, params: PresetRunParams & { stream: true }, options?: RequestOptions): Promise<AsyncIterable<ChatCompletionChunk>>;
  run(slug: string, params: PresetRunParams & { stream?: false }, options?: RequestOptions): Promise<ChatCompletion>;
  async run(
    slug: string,
    params: PresetRunParams,
    options?: RequestOptions,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const path = `/presets/${encodeURIComponent(slug)}/chat/completions`;
    if (params.stream) {
      const response = await this.client.requestRaw({
        method: "POST",
        path,
        body: params,
        supportsIdempotency: true,
        stream: true,
        options,
      });
      return iterateChatStream(response);
    }
    return this.client.requestJson<ChatCompletion>({
      method: "POST",
      path,
      body: params,
      supportsIdempotency: true,
      options,
    });
  }
}

class ModelsResource {
  constructor(private readonly client: NinjaChat) {}

  list(options?: RequestOptions): Promise<ModelList> {
    return this.client.requestJson<ModelList>({ method: "GET", path: "/models", idempotentMethod: true, options });
  }

  retrieve(id: string, options?: RequestOptions): Promise<PublicModel> {
    return this.client.requestJson<PublicModel>({
      method: "GET", path: `/models/${encodeURIComponent(id)}`, idempotentMethod: true, options,
    });
  }
}

class PricingResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * GET /pricing — the machine-readable rate sheet billing itself uses, so a
   * price claim anywhere can be checked against it. Public endpoint; the key
   * is ignored.
   */
  retrieve(options?: RequestOptions): Promise<PricingResponse> {
    return this.client.requestJson<PricingResponse>({
      method: "GET",
      path: "/pricing",
      idempotentMethod: true,
      options,
    });
  }
}

class ChatCompletionsResource {
  constructor(private readonly client: NinjaChat) {}

  create(
    params: ChatCompletionCreateParams & { stream: true },
    options?: RequestOptions
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  create(
    params: ChatCompletionCreateParams & { stream?: false },
    options?: RequestOptions
  ): Promise<ChatCompletion>;
  async create(
    params: ChatCompletionCreateParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    if (params.stream) {
      const response = await this.client.requestRaw({
        method: "POST",
        path: "/chat/completions",
        body: params,
        supportsIdempotency: true,
        stream: true,
        options,
      });
      return iterateChatStream(response);
    }
    return this.client.requestJson<ChatCompletion>({
      method: "POST",
      path: "/chat/completions",
      body: params,
      supportsIdempotency: true,
      options,
    });
  }
}

class ImagesResource {
  constructor(private readonly client: NinjaChat) {}

  /** POST /images/generations — durable by default; storage="provider" skips the persistence hop. */
  generate(params: ImageGenerateParams, options?: RequestOptions): Promise<ImageGenerateResponse> {
    return this.client.requestJson<ImageGenerateResponse>({
      method: "POST",
      path: "/images/generations",
      body: params,
      supportsIdempotency: true,
      timeoutMs: 300_000,
      options,
    });
  }
}

export interface WaitForOptions extends RequestOptions {
  /** Poll interval in ms (default 5000). */
  pollMs?: number;
  /** Give up after this many ms (default 600000 = 10 min). */
  timeoutMs?: number;
}

class VideosResource {
  constructor(private readonly client: NinjaChat) {}

  /** POST /videos — submit an async video job at catalog-defined unit pricing. */
  generate(params: VideoGenerateParams, options?: RequestOptions): Promise<VideoGenerateResponse> {
    return this.client.requestJson<VideoGenerateResponse>({
      method: "POST",
      path: "/videos",
      body: params,
      supportsIdempotency: true,
      timeoutMs: 300_000,
      options,
    });
  }

  /** GET /videos/{id} — retrieve an async video job. */
  retrieve(requestId: string, options?: RequestOptions): Promise<VideoStatusResponse> {
    return this.client.requestJson<VideoStatusResponse>({
      method: "GET",
      path: `/videos/${encodeURIComponent(requestId)}`,
      idempotentMethod: true,
      options,
    });
  }

  /**
   * Poll until the job completes. Resolves with the completed status (carrying
   * `result.video_url`); throws NinjaChatError on failure (`generation_failed`
   * — the charge was refunded server-side) or timeout (`poll_timeout`).
   */
  async waitFor(requestId: string, options: WaitForOptions = {}): Promise<VideoStatusResponse> {
    return pollJob(requestId, options, opts => this.retrieve(requestId, opts), state =>
      new NinjaChatError({ message: state.error || "Video generation failed.", status: 200, code: "generation_failed", requestId }));
  }
}

class EmbeddingsResource {
  constructor(private readonly client: NinjaChat) {}
  create(params: import("./types.js").EmbeddingCreateParams, options?: RequestOptions): Promise<import("./types.js").EmbeddingResponse> {
    return this.client.requestJson({method:"POST",path:"/embeddings",body:params,supportsIdempotency:true,options});
  }
}

class SearchResource {
  constructor(private readonly client: NinjaChat) {}

  /** POST /search — AI-augmented web search. Billed; retries are idempotency-keyed. */
  query(params: SearchQueryParams, options?: RequestOptions): Promise<SearchResponse> {
    return this.client.requestJson<SearchResponse>({
      method: "POST",
      path: "/search",
      body: params,
      supportsIdempotency: true,
      options,
    });
  }
}

class CompareResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * POST /compare — one prompt against several concrete models, returned
   * ranked by quality, speed and cost. Every model is held and settled under
   * one request id; a model that fails costs nothing and lands in `failed`.
   *
   * Streaming interleaves per-model token deltas and closes with a `rankings`
   * event. A streamed comparison cannot be replayed from its idempotency key.
   */
  create(params: CompareCreateParams & { stream: true }, options?: RequestOptions): Promise<AsyncIterable<CompareStreamEvent>>;
  create(params: CompareCreateParams & { stream?: false }, options?: RequestOptions): Promise<CompareResponse>;
  async create(
    params: CompareCreateParams,
    options?: RequestOptions,
  ): Promise<CompareResponse | AsyncIterable<CompareStreamEvent>> {
    if (params.stream) {
      const response = await this.client.requestRaw({
        method: "POST",
        path: "/compare",
        body: params,
        supportsIdempotency: true,
        stream: true,
        options,
      });
      return iterateCompareStream(response);
    }
    return this.client.requestJson<CompareResponse>({
      method: "POST",
      path: "/compare",
      body: params,
      supportsIdempotency: true,
      options,
    });
  }
}

class BatchResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * POST /batch — up to 20 independent chat requests fanned out in parallel
   * under one hold, one request id and one settlement. Each job keeps its own
   * fallback chain, so `results[i].model` is the model that actually served.
   *
   * Streaming emits a `result` per job as it lands, then a `summary`. A
   * streamed batch cannot be replayed from its idempotency key.
   */
  create(params: BatchCreateParams & { stream: true }, options?: RequestOptions): Promise<AsyncIterable<BatchStreamEvent>>;
  create(params: BatchCreateParams & { stream?: false }, options?: RequestOptions): Promise<BatchResponse>;
  async create(
    params: BatchCreateParams,
    options?: RequestOptions,
  ): Promise<BatchResponse | AsyncIterable<BatchStreamEvent>> {
    if (params.stream) {
      const response = await this.client.requestRaw({
        method: "POST",
        path: "/batch",
        body: params,
        supportsIdempotency: true,
        stream: true,
        timeoutMs: 300_000,
        options,
      });
      return iterateBatchStream(response);
    }
    return this.client.requestJson<BatchResponse>({
      method: "POST",
      path: "/batch",
      body: params,
      supportsIdempotency: true,
      timeoutMs: 300_000,
      options,
    });
  }
}

class EstimateResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * POST /estimate — price a request before running it, from the same pricing
   * engine and token estimator that settle real traffic. Public endpoint (the
   * key is ignored), nothing is deducted, and the call is free of side effects
   * so it retries without an idempotency key.
   */
  create(params: EstimateCreateParams, options?: RequestOptions): Promise<EstimateResponse> {
    return this.client.requestJson<EstimateResponse>({
      method: "POST",
      path: "/estimate",
      body: params,
      idempotentMethod: true,
      options,
    });
  }
}

class PipelinesResource {
  constructor(private readonly client: NinjaChat) {}

  /**
   * POST /pipelines — up to 5 chat/image/video steps run in order, with
   * `{{stepId.output}}` / `{{stepId.url}}` interpolation between them. The full
   * price is reserved up front and unexecuted steps refund automatically.
   * Returns immediately (202) with the id to poll.
   */
  create(params: PipelineCreateParams, options?: RequestOptions): Promise<PipelineCreateResponse> {
    return this.client.requestJson<PipelineCreateResponse>({
      method: "POST",
      path: "/pipelines",
      body: params,
      supportsIdempotency: true,
      options,
    });
  }

  /** GET /pipelines/{id} — per-step status, output and cost. Polling also drives the run forward. */
  retrieve(pipelineId: string, options?: RequestOptions): Promise<PipelineState> {
    return this.client.requestJson<PipelineState>({
      method: "GET",
      path: `/pipelines/${encodeURIComponent(pipelineId)}`,
      idempotentMethod: true,
      options,
    });
  }

  /**
   * Poll until the pipeline settles. Resolves with the completed state; throws
   * NinjaChatError on failure (`pipeline_failed` — unexecuted steps were
   * refunded server-side) or timeout (`poll_timeout`).
   */
  async waitFor(pipelineId: string, options: WaitForOptions = {}): Promise<PipelineState> {
    return pollJob(pipelineId, options, opts => this.retrieve(pipelineId, opts), state =>
      new NinjaChatError({ message: state.error ? `Pipeline step "${state.error.step_id}" failed: ${state.error.message}` : "Pipeline failed.",
        status: 200, code: "pipeline_failed", requestId: pipelineId }));
  }
}

class RequestsResource {
  constructor(private readonly client: NinjaChat) {}

  /** GET /requests/{id} — unit-economics record for one of your requests. */
  get(id: string, options?: RequestOptions): Promise<RequestRecord> {
    return this.client.requestJson<RequestRecord>({
      method: "GET",
      path: `/requests/${encodeURIComponent(id)}`,
      idempotentMethod: true,
      options,
    });
  }
}

class WebhooksResource {
  constructor(private readonly client: NinjaChat) {}

  /** GET /webhooks — list endpoints (secrets redacted). */
  async list(options?: RequestOptions): Promise<WebhookEndpoint[]> {
    const res = await this.client.requestJson<{ endpoints: WebhookEndpoint[] }>({
      method: "GET",
      path: "/webhooks",
      idempotentMethod: true,
      options,
    });
    return res.endpoints;
  }

  /**
   * POST /webhooks — register an https endpoint. The `secret` in the response
   * is shown only once. Not auto-retried (no server-side idempotency): a retry
   * could register the endpoint twice.
   */
  create(params: WebhookCreateParams, options?: RequestOptions): Promise<WebhookCreateResponse> {
    return this.client.requestJson<WebhookCreateResponse>({
      method: "POST",
      path: "/webhooks",
      body: params,
      options: { ...options, maxRetries: 0 },
    });
  }

  /** DELETE /webhooks?id=... — disable an endpoint. */
  async delete(id: string, options?: RequestOptions): Promise<{ id: string; disabled: boolean }> {
    return this.client.requestJson<{ id: string; disabled: boolean }>({
      method: "DELETE",
      path: "/webhooks",
      query: { id },
      idempotentMethod: true,
      options,
    });
  }

  /**
   * GET /webhooks/deliveries — recent delivery attempts, newest first.
   * Optionally narrowed to one endpoint.
   */
  async listDeliveries(
    params?: { endpointId?: string; limit?: number },
    options?: RequestOptions,
  ): Promise<WebhookDelivery[]> {
    const query: Record<string, string> = {};
    if (params?.endpointId) query.endpoint_id = params.endpointId;
    if (params?.limit) query.limit = String(params.limit);
    const res = await this.client.requestJson<{ deliveries: WebhookDelivery[] }>({
      method: "GET",
      path: "/webhooks/deliveries",
      query,
      idempotentMethod: true,
      options,
    });
    return res.deliveries;
  }

  /**
   * POST /webhooks/test — send one synthetic event to an endpoint right now
   * and get the real delivered/failed outcome back inline.
   */
  test(endpointId: string, options?: RequestOptions): Promise<WebhookTestResult> {
    return this.client.requestJson<WebhookTestResult>({
      method: "POST",
      path: "/webhooks/test",
      body: { endpoint_id: endpointId },
      options: { ...options, maxRetries: 0 },
    });
  }
}
