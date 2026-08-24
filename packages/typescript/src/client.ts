/**
 * NinjaChat v1 API client. Zero runtime dependencies, fetch-based.
 *
 * Reliability model:
 * - Automatic retries (default 2) on 429 and 5xx, honoring `Retry-After`,
 *   with exponential backoff + jitter otherwise.
 * - Billed, non-idempotent calls (chat, images, video, search) are NEVER
 *   retried without an `Idempotency-Key`: when retries are enabled and no key
 *   was supplied, the SDK generates one via crypto.randomUUID() so a retry can
 *   only replay — never double-bill. A 409 `request_in_flight` on a keyed
 *   request is also retried (the first attempt is still running server-side).
 * - Endpoints with no idempotency support (webhooks.create) are never
 *   auto-retried.
 */

import { NinjaChatError } from "./errors.js";
import { iterateChatStream, iterateResponseStream } from "./streaming.js";
import type {
  BalanceResponse,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ImageGenerateParams,
  ImageGenerateResponse,
  ModelList,
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

export const DEFAULT_BASE_URL = "https://www.ninjachat.ai/api/v1";
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

export interface NinjaChatOptions {
  /** Your secret API key (nj_sk_...). Never expose it in browser or client-side code. */
  apiKey: string;
  /** Defaults to https://www.ninjachat.ai/api/v1. HTTPS is required except on localhost. */
  baseUrl?: string;
  /**
   * Allows a secret key in a browser runtime. This exposes the key to end users
   * and is almost never safe. Server-side use is strongly recommended.
   */
  dangerouslyAllowBrowser?: boolean;
  /** Retries on 429/5xx (default 2). Set 0 to disable. */
  maxRetries?: number;
  /** Per-request timeout in ms (default 120000; video submits use 300000). */
  timeoutMs?: number;
  /** Custom fetch implementation (testing, proxies). */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  /**
   * Idempotency-Key for billed calls. When omitted and retries are enabled,
   * the SDK generates one so retries are billing-safe.
   */
  idempotencyKey?: string;
  /** Override the client-level maxRetries for this call. */
  maxRetries?: number;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Override the client-level timeout for this call. */
  timeoutMs?: number;
}

interface InternalRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Endpoint accepts an Idempotency-Key header (billed generation calls). */
  supportsIdempotency?: boolean;
  /** Safe to retry without an idempotency key (GET/DELETE, or naturally idempotent). */
  idempotentMethod?: boolean;
  stream?: boolean;
  options?: RequestOptions;
  timeoutMs?: number;
}

const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);
    }
  }
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.random() * base, MAX_BACKOFF_MS);
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NinjaChatError({
      message: "baseUrl must be a valid absolute URL.",
      status: 0,
      code: "invalid_base_url",
    });
  }

  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && localHostnames.has(url.hostname);
  if (!secure && !localHttp) {
    throw new NinjaChatError({
      message: "baseUrl must use HTTPS. Plain HTTP is allowed only for localhost development.",
      status: 0,
      code: "insecure_base_url",
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new NinjaChatError({
      message: "baseUrl must not contain credentials, query parameters, or a fragment.",
      status: 0,
      code: "invalid_base_url",
    });
  }

  return url.toString().replace(/\/+$/, "");
}

export class NinjaChat {
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;

  readonly chat: ChatResource;
  readonly responses: ResponsesResource;
  readonly models: ModelsResource;
  readonly images: ImagesResource;
  readonly videos: VideosResource;
  readonly search: SearchResource;
  readonly requests: RequestsResource;
  readonly webhooks: WebhooksResource;

  constructor(options: NinjaChatOptions) {
    if (!options?.apiKey) {
      throw new NinjaChatError({
        message: "Missing apiKey. Create one at https://www.ninjachat.ai/developers/keys",
        status: 0,
        code: "missing_api_key",
      });
    }
    if (isBrowserRuntime() && !options.dangerouslyAllowBrowser) {
      throw new NinjaChatError({
        message:
          "Secret NinjaChat API keys must not be used in browser code. Keep API calls on your server, or set dangerouslyAllowBrowser only if you fully accept the exposure risk.",
        status: 0,
        code: "browser_api_key_forbidden",
      });
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);

    this.chat = new ChatResource(this);
    this.responses = new ResponsesResource(this);
    this.models = new ModelsResource(this);
    this.images = new ImagesResource(this);
    this.videos = new VideosResource(this);
    this.search = new SearchResource(this);
    this.requests = new RequestsResource(this);
    this.webhooks = new WebhooksResource(this);
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

  /** @internal */
  async requestJson<T>(req: InternalRequest): Promise<T> {
    const response = await this.requestRaw(req);
    return (await response.json()) as T;
  }

  /** @internal Runs the request with retry/idempotency semantics; returns the ok Response. */
  async requestRaw(req: InternalRequest): Promise<Response> {
    const options = req.options ?? {};
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? req.timeoutMs ?? this.timeoutMs;

    let idempotencyKey = options.idempotencyKey;
    if (req.supportsIdempotency && !idempotencyKey && maxRetries > 0) {
      // Never retry a billed call without a key — generate one so a retry can
      // only replay the stored result, never double-charge.
      idempotencyKey = crypto.randomUUID();
    }
    const retriable = Boolean(req.idempotentMethod || idempotencyKey);
    const attempts = retriable ? maxRetries + 1 : 1;

    const url = new URL(this.baseUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: req.stream ? "text/event-stream" : "application/json",
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let lastError: NinjaChatError | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onOuterAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onOuterAbort, { once: true });

      let response: Response | null = null;
      try {
        response = await this.fetchFn(url.toString(), {
          method: req.method,
          headers,
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        lastError = new NinjaChatError({
          message:
            options.signal?.aborted
              ? "Request aborted."
              : err instanceof Error
                ? `Network error: ${err.message}`
                : "Network error.",
          status: 0,
          code: options.signal?.aborted ? "aborted" : "network_error",
        });
        if (options.signal?.aborted || attempt === attempts - 1) {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onOuterAbort);
          throw lastError;
        }
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onOuterAbort);
        await sleep(retryDelayMs(null, attempt));
        continue;
      }

      // Streamed responses hand the body (and the timeout teardown) to the caller.
      if (response.ok) {
        if (req.stream) {
          // Clear the request timeout — streams have their own lifetime.
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onOuterAbort);
        } else {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onOuterAbort);
        }
        return response;
      }

      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);

      let errorBody: unknown = null;
      try {
        errorBody = await response.json();
      } catch {
        // non-JSON error body
      }
      const error = NinjaChatError.fromResponse(
        response.status,
        errorBody,
        response.headers.get("x-request-id")
      );
      lastError = error;

      const inFlightRetry =
        response.status === 409 && error.code === "request_in_flight" && Boolean(idempotencyKey);
      const shouldRetry =
        retriable &&
        attempt < attempts - 1 &&
        (RETRIABLE_STATUSES.has(response.status) || inFlightRetry);

      if (!shouldRetry) throw error;
      await sleep(retryDelayMs(response, attempt));
    }

    // Unreachable, but keeps TypeScript satisfied.
    throw lastError ?? new NinjaChatError({ message: "Request failed.", status: 0, code: "unknown" });
  }
}

// ── Resources ────────────────────────────────────────────────────────────────

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

  /** POST /images/generations — generate images at catalog-defined unit pricing. */
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
    const pollMs = options.pollMs ?? 5_000;
    const deadline = Date.now() + (options.timeoutMs ?? 600_000);

    for (;;) {
      const status = await this.retrieve(requestId, {
        signal: options.signal,
        maxRetries: options.maxRetries,
      });
      if (status.status === "completed") return status;
      if (status.status === "failed") {
        throw new NinjaChatError({
          message: status.error || "Video generation failed (charge refunded).",
          status: 200,
          code: "generation_failed",
          requestId,
        });
      }
      if (Date.now() + pollMs > deadline) {
        throw new NinjaChatError({
          message: `Timed out waiting for video job ${requestId}. It may still complete — keep polling videos.retrieve().`,
          status: 0,
          code: "poll_timeout",
          requestId,
        });
      }
      await sleep(pollMs);
    }
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
